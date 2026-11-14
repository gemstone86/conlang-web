// Eon Weather – roads and paths (vägar): lines drawn with points, like rivers, each of a kind: "path"
// (stig), "road" (väg) or "highway" (huvudväg). Where a road's ground is steeper than suits its kind it is
// marked red while editing (dark red where it is twice that), so it can be moved to where the ground is
// better; the travel calculator (travel.js) uses the roads and the same slopes.
// Adds methods to FieldMap: drawing (layer "road"), editing (edit mode "road"), the data (setRoads /
// getRoads), and the ground under the map (heightGrid / groundM / gradeAt), shared with travel.js.
(function () {
  "use strict";
  const FM = window.FieldMap;
  if (!FM) return;
  const P = FM.prototype;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const HIT = 9;            // px: how close counts as clicking a point or a line
  const SNAP = 10;          // px: how close to another road a click joins it
  const KINDS = ["path", "road", "highway"];
  /** Steepest average slope (%) each kind takes in its stride, over the map's pixels (about 5 km on Mundana). */
  P.roadSteep = { path: 5, road: 3, highway: 2 };

  // ── the ground ──
  /**
   * The height map at full size as bytes: the painter's copy while heights are being painted, otherwise
   * the height map shown. { w, h, d, sea, mps } or null without a height map.
   */
  P.heightGrid = function () {
    const sea = this.seaLevel != null ? this.seaLevel : 0, mps = this.metersPerStep || 100;
    const E = this.hp && this.hp.data && this.hp.target === "height" ? this.hp : null;
    if (E) return { w: E.w, h: E.h, d: E.data, sea, mps, key: "hp" + E.undo.length + ":" + (E.rev || 0) };
    const src = this.heightSource;
    if (!src) return null;
    if (!this._hgrid || this._hgrid.src !== src) {
      const w = Math.min(src.naturalWidth || src.width, 8192), h = Math.max(1, Math.round(w * this.imgH / this.imgW));
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const c = cv.getContext("2d", { willReadFrequently: true });
      c.drawImage(src, 0, 0, w, h);
      const px = c.getImageData(0, 0, w, h).data, d = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) d[i] = px[i * 4];
      this._hgrid = { src, w, h, d, n: (this._hgridN = (this._hgridN || 0) + 1) };
    }
    const G = this._hgrid;
    return { w: G.w, h: G.h, d: G.d, sea, mps, key: "img" + G.n };
  };
  /** Metres above the sea at a map point (0..1), bilinear; negative under water. NaN without a height map. */
  P.groundM = function (nx, ny, G) {
    G = G || this.heightGrid();
    if (!G) return NaN;
    const fx = clamp(nx * G.w - 0.5, 0, G.w - 1.001), fy = clamp(ny * G.h - 0.5, 0, G.h - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, k = j * G.w + i, d = G.d;
    const v = (d[k] * (1 - tx) + d[k + 1] * tx) * (1 - ty) + (d[k + G.w] * (1 - tx) + d[k + G.w + 1] * tx) * ty;
    return (v - G.sea) * G.mps;
  };
  /** Kilometres per map pixel (5.41 on Mundana), from the map's scale. */
  P.kmPerMapPx = function () { return this.kmPerPx || (this.opts && this.opts.kmPerPx) || 5; };

  // ── data ──
  P.setRoads = function (list) {
    this.roads = (list || []).map((r) => ({ id: r.id, name: r.name || "", kind: KINDS.includes(r.kind) ? r.kind : "road",
      points: (r.points || []).map((p) => ({ x: p.x, y: p.y })) }));
    this.wySel = null; this.wyDraft = null; this._wySteepCache = new Map();
    this.draw();
  };
  P.getRoads = function () {
    return (this.roads || []).filter((r) => r.points.length >= 2).map((r) => ({ id: r.id, name: r.name, kind: r.kind,
      points: r.points.map((p) => ({ x: +p.x.toFixed(7), y: +p.y.toFixed(7) })) }));
  };
  P._wyChanged = function () { this.opts.onRoadsChanged && this.opts.onRoadsChanged(); this.draw(); };
  P._wyById = function (id) { return (this.roads || []).find((r) => r.id === id) || null; };
  P._wyNewId = function () { return (this.roads || []).reduce((m, r) => Math.max(m, r.id), 0) + 1; };
  P.wyChosen = function () { return this._wyById(this.wySel); };

  // ── steepness along a road ──
  /**
   * The road's steep stretches: pieces { pts: [{x, y}], level } with level 1 (steeper than its kind takes:
   * red) or 2 (twice that: dark red), and the steepest slope found (%). The slope is the average over about
   * three map pixels around each spot along the line, so single bumps in the height map don't count.
   */
  P.roadSteepness = function (r) {
    const G = this.heightGrid();
    if (!G || r.points.length < 2) return { pieces: [], max: 0 };
    const key = G.key + "|" + r.kind + "|" + this.roadSteep[r.kind] + "|" + r.points.map((p) => p.x.toFixed(6) + "," + p.y.toFixed(6)).join(";");
    this._wySteepCache = this._wySteepCache || new Map();
    const hit = this._wySteepCache.get(r.id);
    if (hit && hit.key === key) return hit.val;
    const W = this.imgW, H = this.imgH, kmpx = this.kmPerMapPx();
    // points every half map pixel along the line, with the distance along it
    const S = [];
    let along = 0;
    for (let k = 0; k + 1 < r.points.length; k++) {
      const a = r.points[k], b = r.points[k + 1], L = Math.hypot((b.x - a.x) * W, (b.y - a.y) * H), n = Math.max(1, Math.ceil(L * 2));
      for (let t = k ? 1 : 0; t <= n; t++) { const x = a.x + (b.x - a.x) * t / n, y = a.y + (b.y - a.y) * t / n; S.push({ x, y, s: along + L * t / n, h: this.groundM(x, y, G) }); }
      along += L;
    }
    const lim = this.roadSteep[r.kind] || 3, half = 1.5;      // map px each way
    const lv = [];
    let max = 0, lo = 0, hi = 0;
    for (let i = 0; i < S.length; i++) {
      while (S[lo].s < S[i].s - half) lo++;
      while (hi + 1 < S.length && S[hi + 1].s <= S[i].s + half) hi++;
      const ds = (S[hi].s - S[lo].s) * kmpx * 1000;
      const g = ds > 0 ? Math.abs(Math.max(0, S[hi].h) - Math.max(0, S[lo].h)) / ds * 100 : 0;
      if (g > max) max = g;
      lv.push(g > 2 * lim ? 2 : g > lim ? 1 : 0);
    }
    const pieces = [];
    let cur = null;
    for (let i = 0; i < S.length; i++) {
      if (lv[i] && (!cur || cur.level !== lv[i])) { cur = { level: lv[i], pts: i ? [S[i - 1]] : [] }; pieces.push(cur); }
      if (lv[i]) cur.pts.push(S[i]);
      else if (cur) { cur.pts.push(S[i]); cur = null; }
    }
    const val = { pieces: pieces.filter((p) => p.pts.length >= 2), max };
    this._wySteepCache.set(r.id, { key, val });
    return val;
  };

  // ── drawing ──
  const STYLE = {
    highway: { w: 4.2, casing: "rgba(70,40,10,0.85)", fill: "#f3c35b", dash: null },
    road: { w: 2.8, casing: "rgba(70,45,20,0.75)", fill: "#e8d7b0", dash: null },
    path: { w: 1.7, casing: "rgba(60,40,20,0.55)", fill: "#c99a5b", dash: [5, 4] },
  };
  /** While painting heights with "Branta vägar" ticked: the roads and their steep stretches are shown over the painter. */
  P._wySteepShown = function () {
    return !!(this.editing && this.editMode === "height" && this.hp && this.hp.target === "height" && this.hpSettings().roadSteep && (this.roads || []).length);
  };
  P._wyDraw = function () {
    const list = this.roads || [], D = this.wyDraft, editing = this.editing && this.editMode === "road", steepOn = editing || this._wySteepShown();
    if (!list.length && !D) return;
    const ctx = this.ctx, z = clamp(Math.sqrt(this.view.s * this.imgW / 1500), 0.6, 2.6);
    const line = (pts) => { ctx.beginPath(); pts.forEach((p, i) => { const [x, y] = this.toScreen(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); };
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // paths first, highways on top
    for (const kind of ["path", "road", "highway"]) {
      const st = STYLE[kind];
      for (const r of list) {
        if (r.kind !== kind || r.points.length < 2) continue;
        const sel = editing && r.id === this.wySel;
        line(r.points);
        ctx.setLineDash([]);
        ctx.strokeStyle = sel ? "rgba(255,224,138,0.95)" : st.casing; ctx.lineWidth = st.w * z + (sel ? 4 : 2); ctx.stroke();
        if (st.dash) ctx.setLineDash(st.dash.map((v) => v * z));
        ctx.strokeStyle = st.fill; ctx.lineWidth = st.w * z; ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (steepOn) {
      // too steep for the road's kind: red (dark red where twice that)
      let pieces = 0, roads = 0;
      for (const r of list) {
        if (r.points.length < 2) continue;
        const P2 = this.roadSteepness(r).pieces;
        if (P2.length) roads++;
        pieces += P2.length;
        for (const pc of P2) {
          line(pc.pts);
          ctx.strokeStyle = pc.level === 2 ? "rgba(140,0,10,0.95)" : "rgba(230,40,40,0.95)";
          ctx.lineWidth = (STYLE[r.kind].w + 1.5) * z; ctx.stroke();
        }
      }
      if (!editing) this.opts.onRoadSteep && this.opts.onRoadSteep(pieces, roads);
    }
    if (editing) {
      const r = this.wyChosen();
      if (r) r.points.forEach((p, i) => {
        const [x, y] = this.toScreen(p.x, p.y);
        ctx.fillStyle = i === 0 || i === r.points.length - 1 ? "#ffe08a" : "#fff"; ctx.strokeStyle = "#18212a"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, i === 0 || i === r.points.length - 1 ? 5 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });
      // the road being drawn
      const DP = this._wyDraftPoints();
      if (D && DP.length) {
        ctx.setLineDash([6, 4]); ctx.strokeStyle = "#ffe08a"; ctx.lineWidth = 2;
        line(DP);
        if (D.hover) { const [x, y] = this.toScreen(D.hover.x, D.hover.y); ctx.lineTo(x, y); }
        ctx.stroke(); ctx.setLineDash([]);
        DP.forEach((p) => { const [x, y] = this.toScreen(p.x, p.y); ctx.fillStyle = "#ffe08a"; ctx.strokeStyle = "#18212a"; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
      }
      if (this._wySnap) {
        const [x, y] = this.toScreen(this._wySnap.x, this._wySnap.y);
        ctx.strokeStyle = "#ffe08a"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
  };

  // ── hit tests (screen px) ──
  P._wyHitPoint = function (sx, sy) {
    const r = this.wyChosen();
    if (!r) return null;
    let best = null, bd = HIT + 2;
    r.points.forEach((p, i) => { const [x, y] = this.toScreen(p.x, p.y), d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = { r, i }; } });
    return best;
  };
  /** The road line nearest a screen point (within px): { r, k, t, d, at: [nx, ny] }. */
  /** What a road point snaps to: a city close by (the road joins the city), else a road line. */
  P._wySnapTo = function (sx, sy, skip) {
    let c = this._ctNear ? this._ctNear(sx, sy, SNAP) : null;
    if (c && c.kind && c.kind !== "city") c = null;
    return c ? { at: [c.x, c.y], city: c } : this._wyHitLine(sx, sy, SNAP, skip);
  };
  P._wyHitLine = function (sx, sy, px, skip) {
    let best = null;
    for (const r of this.roads || []) {
      if (r === skip) continue;
      for (let k = 0; k + 1 < r.points.length; k++) {
        const [ax, ay] = this.toScreen(r.points[k].x, r.points[k].y), [bx, by] = this.toScreen(r.points[k + 1].x, r.points[k + 1].y);
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? clamp(((sx - ax) * dx + (sy - ay) * dy) / L, 0, 1) : 0;
        // the ends (junctions) win over the middle of a line nearby
        const tt = t < 0.04 ? 0 : t > 0.96 ? 1 : t;
        const d = Math.hypot(ax + dx * t - sx, ay + dy * t - sy);
        if (d < px && (!best || d < best.d)) best = { r, k, t: tt, d, at: this.toMap(ax + dx * tt, ay + dy * tt) };
      }
    }
    return best;
  };
  /** The road under a map point (normalized) for the info box, or null. */
  P.roadAt = function (nx, ny, px = 7) { const [sx, sy] = this.toScreen(nx, ny), h = this._wyHitLine(sx, sy, px, null); return h ? h.r : null; };

  // ── editing ──
  P.wySelect = function (id) { this.wySel = id; this.opts.onRoadSelected && this.opts.onRoadSelected(this._wyById(id)); this.draw(); };
  P.wyNew = function () { this.wyDraft = { points: [], hover: null }; this._wySnap = null; this.wySelect(null); };
  P.wyNextKind = "road";
  P.wySetKind = function (k) {
    k = KINDS.includes(k) ? k : "road";
    this.wyNextKind = k;
    const r = this.wyChosen();
    if (r) { r.kind = k; this._wyChanged(); }
  };
  P.wySetName = function (v) { const r = this.wyChosen(); if (r) { r.name = String(v).slice(0, 100); this._wyChanged(); } };
  P.wyDelete = function () {
    const r = this.wyChosen();
    if (!r) return;
    this.roads = this.roads.filter((x) => x !== r);
    this.wySelect(null);
    this._wyChanged();
  };
  P.wyDrafting = function () { return !!this.wyDraft; };
  P.wyCancelDraft = function () { if (this.wyDraft) { this.wyDraft = null; this._wySnap = null; this.draw(); } };
  /** Carries on drawing the chosen road from one of its ends ("tail": the last point, "head": the first). */
  P.wyExtend = function (end = "tail") {
    const r = this.wyChosen();
    if (!r) return false;
    this.wyDraft = { extend: r.id, end, points: [], hover: null };
    this.opts.onRoadSelected && this.opts.onRoadSelected(r);
    this.draw();
    return true;
  };
  P._wyDraftPoints = function () {
    const D = this.wyDraft;
    if (!D) return [];
    if (D.extend == null) return D.points;
    const r = this._wyById(D.extend);
    if (!r) return D.points;
    return [D.end === "tail" ? r.points[r.points.length - 1] : r.points[0], ...D.points];
  };
  /** Finishes the road being drawn (it needs two points). */
  P.wyFinish = function () {
    const D = this.wyDraft;
    this.wyDraft = null; this._wySnap = null;
    if (!D) return false;
    if (D.extend != null) {
      const r = this._wyById(D.extend);
      if (r && D.points.length) {
        if (D.end === "tail") r.points.push(...D.points); else r.points.unshift(...D.points.slice().reverse());
        this.wySelect(r.id); this._wyChanged(); return true;
      }
      if (r) this.wySelect(r.id);
      this.draw(); return false;
    }
    if (D.points.length < 2) { this.draw(); return false; }
    const r = { id: this._wyNewId(), name: "", kind: this.wyNextKind || "road", points: D.points };
    this.roads = this.roads || [];
    this.roads.push(r);
    this.wySelect(r.id);
    this._wyChanged();
    return true;
  };
  /** Esc: the road being drawn is dropped (or ends where it is when carrying on), then the chosen one is let go. */
  P.wyCancel = function () {
    if (this.wyDraft) { if (this.wyDraft.extend != null && this.wyDraft.points.length) this.wyFinish(); else this.wyCancelDraft(); return true; }
    if (this.wySel != null) { this.wySelect(null); return true; }
    return false;
  };
  P.wyPointerDown = function (sx, sy) {
    if (this.wyDraft) return false;
    const h = this._wyHitPoint(sx, sy);
    if (!h) return false;
    this._wyDrag = { ...h, sx, sy, moved: false };
    return true;
  };
  P.wyPointerMove = function (sx, sy) {
    const [nx, ny] = this.toMap(sx, sy);
    const D = this._wyDrag;
    if (D) {
      if (!D.moved && Math.hypot(sx - D.sx, sy - D.sy) < 4) return;
      D.moved = true;
      const p = D.r.points[D.i];
      // an end dropped on another road joins it there
      const h = D.i === 0 || D.i === D.r.points.length - 1 ? this._wySnapTo(sx, sy, D.r) : null;
      p.x = h ? h.at[0] : clamp(nx, 0, 1); p.y = h ? h.at[1] : clamp(ny, 0, 1);
      this._wySnap = h ? { x: h.at[0], y: h.at[1] } : null;
      this.draw();
      return;
    }
    if (this.wyDraft) {
      this.wyDraft.hover = { x: nx, y: ny };
      const skip = this.wyDraft.extend != null ? this._wyById(this.wyDraft.extend) : null;
      const h = this._wySnapTo(sx, sy, skip);
      this._wySnap = h ? { x: h.at[0], y: h.at[1] } : null;
      this.draw();
    }
  };
  P.wyPointerUp = function () {
    const D = this._wyDrag;
    this._wyDrag = null; this._wySnap = null;
    if (!D) return;
    if (!D.moved) {
      // a click on the chosen road's first or last point: carry on drawing from there
      if (D.i === D.r.points.length - 1) this.wyExtend("tail");
      else if (D.i === 0) this.wyExtend("head");
      return;
    }
    this._wyChanged();
  };
  /** A click (not a drag) in road mode. */
  P.wyClick = function (nx, ny, sx, sy) {
    const now = performance.now();
    const dbl = this._wyLastClick && now - this._wyLastClick.t < 380 && Math.hypot(sx - this._wyLastClick.x, sy - this._wyLastClick.y) < 6;
    this._wyLastClick = { t: now, x: sx, y: sy };
    const D = this.wyDraft;
    if (D) {
      if (dbl) { this.wyFinish(); return; }
      const skip = D.extend != null ? this._wyById(D.extend) : null;
      const h = this._wySnapTo(sx, sy, skip);
      const p = h ? { x: h.at[0], y: h.at[1] } : { x: clamp(nx, 0, 1), y: clamp(ny, 0, 1) };
      if (D.extend == null || D.end === "tail") D.points.push(p); else D.points.push(p);
      // on another road (not as the first point of a new one): joins it there and ends
      const enough = D.extend != null ? D.points.length >= 1 : D.points.length >= 2;
      if (h && enough) { this.wyFinish(); return; }
      this.draw();
      return;
    }
    const sel = this.wyChosen();
    if (sel) {
      const h = this._wyHitLine(sx, sy, HIT, null);
      if (h && h.r === sel) {                                            // on the chosen road's line: a new point
        sel.points.splice(h.k + 1, 0, { x: h.at[0], y: h.at[1] });
        this._wyChanged();
        return;
      }
    }
    const cty = this._ctNear ? this._ctNear(sx, sy, SNAP) : null;
    if (cty && (!cty.kind || cty.kind === "city")) { this.wyDraft = { points: [{ x: cty.x, y: cty.y }], hover: null }; this.opts.onRoadSelected && this.opts.onRoadSelected(null); this.draw(); return; }   // a road starts at a city
    const h = this._wyHitLine(sx, sy, HIT, null);
    if (h) { this.wySelect(h.r.id); return; }
    if (sel) { this.wySelect(null); return; }
    this.wyDraft = { points: [{ x: clamp(nx, 0, 1), y: clamp(ny, 0, 1) }], hover: null };   // empty ground: a new road starts
    this.opts.onRoadSelected && this.opts.onRoadSelected(null);
    this.draw();
  };
  /** Right-click: while drawing the last point goes; otherwise the chosen road's point under the pointer. */
  P.wyContextMenu = function (sx, sy) {
    if (this.wyDraft) {
      this.wyDraft.points.pop();
      if (!this.wyDraft.points.length && this.wyDraft.extend == null) this.wyDraft = null;
      this.draw(); return;
    }
    const h = this._wyHitPoint(sx, sy);
    if (!h || h.r.points.length <= 2) return;
    h.r.points.splice(h.i, 1);
    this._wyChanged();
  };
})();
