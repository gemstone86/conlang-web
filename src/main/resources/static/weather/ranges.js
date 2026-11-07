// Eon Weather – mountain ranges (bergskedjor): a crest line drawn with points, like a river, and at any
// of its points a width line out to each side, showing where the range ends and the lowland begins.
// Between the width lines the range's footprint is shaded. Adds methods to FieldMap: drawing (layer
// "range"), editing (edit mode "range") and the data (setRanges / getRanges).
//
// A range can split off another: a branch's first point lies on the other range's crest, and it keeps
// that place when the other range is changed (from: { range, x, y }). Start one with Ny förgrening (or
// by starting a new range with a click on a crest), or by dropping a range's first point on a crest.
(function () {
  "use strict";
  const FM = window.FieldMap;
  if (!FM) return;
  const P = FM.prototype;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const HIT = 9;            // px: how close counts as clicking a point, a handle or the crest
  const GHOST = 16;         // px: where an unset width handle waits, beside its crest point
  const SIDES = ["l", "r"];

  // ── data ──
  P.setRanges = function (list) {
    this.ranges = (list || []).map((r) => ({ id: r.id, name: r.name || "", height: Number.isFinite(r.height) ? r.height : null,
      points: (r.points || []).map((p) => ({ x: p.x, y: p.y, l: p.l != null ? p.l : null, r: p.r != null ? p.r : null })),
      from: r.from && r.from.range != null ? { range: r.from.range, x: r.from.x, y: r.from.y } : null }));
    this.rgSel = null; this.rgDrawing = false; this._rgDrag = null; this._rgHover = null;
    this.draw();
  };
  P.getRanges = function () {
    return (this.ranges || []).filter((r) => r.points.length >= 2).map((r) => {
      const o = { id: r.id, name: r.name };
      if (Number.isFinite(r.height)) o.height = Math.round(r.height);
      o.points = r.points.map((p) => {
        const q = { x: +p.x.toFixed(7), y: +p.y.toFixed(7) };
        if (p.l != null) q.l = +p.l.toFixed(2);
        if (p.r != null) q.r = +p.r.toFixed(2);
        return q;
      });
      if (r.from) o.from = { range: r.from.range, x: +r.from.x.toFixed(7), y: +r.from.y.toFixed(7) };
      return o;
    });
  };
  P._rgChanged = function () { this._rgFollow(); this.opts.onRangesChanged && this.opts.onRangesChanged(); this.draw(); };
  /** Is b the range a branches off (or one it branches off, further back)? */
  P._rgBranchOf = function (a, b) {
    let cur = a, n = 0;
    while (cur && cur.from && n++ < 1000) { if (cur.from.range === b.id) return true; cur = this._rgById(cur.from.range); }
    return false;
  };
  /** May range r split off range t (not itself, not one that splits off r)? */
  P._rgCanBranch = function (r, t) { return !!t && t !== r && t.points.length >= 2 && !this._rgBranchOf(t, r); };
  /** The nearest spot on a range's crest to a map point (0..1). */
  P._rgProject = function (t, x, y) {
    const W = this.imgW, H = this.imgH;
    let best = null;
    for (let i = 0; i + 1 < t.points.length; i++) {
      const ax = t.points[i].x * W, ay = t.points[i].y * H, bx = t.points[i + 1].x * W, by = t.points[i + 1].y * H;
      const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1, u = clamp(((x * W - ax) * (bx - ax) + (y * H - ay) * (by - ay)) / L2, 0, 1);
      const qx = ax + (bx - ax) * u, qy = ay + (by - ay) * u, d = Math.hypot(qx - x * W, qy - y * H);
      if (!best || d < best.d) best = { d, x: qx / W, y: qy / H };
    }
    return best;
  };
  /** Branches stay on the crest they split off (it may have moved); one whose range is gone is free. */
  P._rgFollow = function () {
    for (const r of this.ranges || []) {
      if (!r.from) continue;
      const t = this._rgById(r.from.range);
      if (!t || t.points.length < 2 || !r.points.length) { r.from = null; continue; }
      const q = this._rgProject(t, r.from.x, r.from.y);
      r.from.x = q.x; r.from.y = q.y;
      r.points[0].x = q.x; r.points[0].y = q.y;
    }
  };
  P._rgById = function (id) { return (this.ranges || []).find((r) => r.id === id) || null; };
  P.rgChosen = function () { return this._rgById(this.rgSel); };

  // ── geometry (map pixels) ──
  const px = (fm, p) => [p.x * fm.imgW, p.y * fm.imgH];
  /** Unit normals to the left of the crest at each point (left as seen walking from the first point to the last). */
  P._rgNormals = function (r) {
    const pts = r.points, n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const [ax, ay] = px(this, pts[Math.max(0, i - 1)]), [bx, by] = px(this, pts[Math.min(n - 1, i + 1)]);
      let tx = bx - ax, ty = by - ay;
      const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
      out.push([ty, -tx]);                                          // left of the direction (y points down)
    }
    return out;
  };
  /**
   * Width on one side at each point: set ones as they are, the rest straight between them. An end of
   * the crest without a width line of its own tapers to nothing, as ranges do.
   */
  P._rgWidths = function (r, side) {
    const pts = r.points, n = pts.length, w = new Array(n).fill(null), known = [];
    pts.forEach((p, i) => { if (p[side] != null) known.push(i); });
    if (!known.length) return null;
    const val = (i) => (pts[i][side] != null ? pts[i][side] : 0);
    if (known[0] !== 0) known.unshift(0);
    if (known[known.length - 1] !== n - 1) known.push(n - 1);
    const along = [0];
    for (let i = 1; i < n; i++) { const [ax, ay] = px(this, pts[i - 1]), [bx, by] = px(this, pts[i]); along.push(along[i - 1] + Math.hypot(bx - ax, by - ay)); }
    for (let i = 0; i < n; i++) {
      let a = null, b = null;
      for (const k of known) { if (k <= i) a = k; if (k >= i && b == null) b = k; }
      if (a === b) w[i] = val(a);
      else { const t = (along[i] - along[a]) / ((along[b] - along[a]) || 1); w[i] = val(a) + (val(b) - val(a)) * t; }
    }
    return w;
  };
  /** Length of the crest in km (null without a scale) and the average total width in km. */
  P.rangeInfo = function (r) {
    if (!r || r.points.length < 2) return null;
    let len = 0;
    for (let i = 1; i < r.points.length; i++) { const [ax, ay] = px(this, r.points[i - 1]), [bx, by] = px(this, r.points[i]); len += Math.hypot(bx - ax, by - ay); }
    const wl = this._rgWidths(r, "l"), wr = this._rgWidths(r, "r");
    let width = null;
    if (wl || wr) width = r.points.reduce((s, _, i) => s + (wl ? wl[i] : 0) + (wr ? wr[i] : 0), 0) / r.points.length;
    const k = this.kmPerPx || 0;
    return { lengthPx: len, widthPx: width, lengthKm: k ? len * k : null, widthKm: k && width != null ? width * k : null };
  };

  // ── drawing ──
  P._rgDraw = function () {
    const ctx = this.ctx, s = this.view.s, list = this.ranges || [];
    if (!list.length) return;
    const edit = this.editing && this.editMode === "range";
    ctx.save();
    for (const r of list) {
      if (!r.points.length) continue;
      const sel = edit && r.id === this.rgSel;
      const sc = r.points.map((p) => this.toScreen(p.x, p.y));
      const nm = this._rgNormals(r);
      // the footprint: between the width lines on both sides
      const wl = this._rgWidths(r, "l"), wr = this._rgWidths(r, "r");
      if ((wl || wr) && r.points.length >= 2) {
        ctx.beginPath();
        sc.forEach(([x, y], i) => { const w = (wl ? wl[i] : 0) * s; const X = x + nm[i][0] * w, Y = y + nm[i][1] * w; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
        for (let i = sc.length - 1; i >= 0; i--) { const w = (wr ? wr[i] : 0) * s; ctx.lineTo(sc[i][0] - nm[i][0] * w, sc[i][1] - nm[i][1] * w); }
        ctx.closePath();
        ctx.fillStyle = sel ? "rgba(150,105,60,0.26)" : "rgba(140,100,60,0.18)";
        ctx.fill();
        ctx.setLineDash([5, 4]); ctx.strokeStyle = "rgba(110,70,35,0.6)"; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
      }
      // the crest
      if (sc.length >= 2) {
        ctx.lineJoin = ctx.lineCap = "round";
        ctx.beginPath(); sc.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.strokeStyle = "rgba(255,250,240,0.85)"; ctx.lineWidth = sel ? 6 : 5; ctx.stroke();
        ctx.strokeStyle = sel ? "#8a4b1c" : "#6b4423"; ctx.lineWidth = sel ? 3.2 : 2.6; ctx.stroke();
        // small peaks along it
        ctx.fillStyle = sel ? "#8a4b1c" : "#6b4423";
        let acc = 0;
        for (let i = 1; i < sc.length; i++) {
          const [ax, ay] = sc[i - 1], [bx, by] = sc[i], L = Math.hypot(bx - ax, by - ay);
          for (let t = (30 - acc) % 30; t < L; t += 30) {
            const x = ax + (bx - ax) * t / L, y = ay + (by - ay) * t / L;
            ctx.beginPath(); ctx.moveTo(x - 5, y + 3); ctx.lineTo(x, y - 6); ctx.lineTo(x + 5, y + 3); ctx.closePath(); ctx.fill();
          }
          acc = (acc + L) % 30;
        }
      }
      // where a branch splits off
      if (r.from && edit && sc.length) {
        ctx.beginPath(); ctx.arc(sc[0][0], sc[0][1], 4, 0, Math.PI * 2);
        ctx.fillStyle = "#e9a34a"; ctx.fill(); ctx.strokeStyle = "#5a3418"; ctx.lineWidth = 1.5; ctx.stroke();
      }
      // the name (and height) at the middle
      if ((r.name || Number.isFinite(r.height)) && sc.length >= 2) {
        const m = sc[Math.floor(sc.length / 2)];
        const label = (r.name || "") + (Number.isFinite(r.height) ? (r.name ? " · " : "") + r.height + " m" : "");
        ctx.font = "italic 600 12px system-ui, sans-serif"; ctx.textAlign = "center";
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,250,240,0.9)"; ctx.strokeText(label, m[0], m[1] - 12);
        ctx.fillStyle = "#5a3418"; ctx.fillText(label, m[0], m[1] - 12);
      }
      if (!sel) continue;
      // chosen: its points, and a width handle on each side of every point (hollow until set)
      sc.forEach(([x, y], i) => {
        for (const side of SIDES) {
          const sg = side === "l" ? 1 : -1, w = r.points[i][side];
          const d = w != null ? w * s : GHOST, hx = x + sg * nm[i][0] * d, hy = y + sg * nm[i][1] * d;
          if (w != null) { ctx.setLineDash([4, 3]); ctx.strokeStyle = "#8a4b1c"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hx, hy); ctx.stroke(); ctx.setLineDash([]); }
          ctx.beginPath(); ctx.arc(hx, hy, w != null ? 4.5 : 3.5, 0, Math.PI * 2);
          if (w != null) { ctx.fillStyle = "#e9a34a"; ctx.fill(); ctx.strokeStyle = "#5a3418"; ctx.lineWidth = 1.2; ctx.stroke(); }
          else { ctx.strokeStyle = "rgba(90,52,24,0.55)"; ctx.lineWidth = 1.2; ctx.stroke(); }
        }
        ctx.beginPath(); ctx.arc(x, y, i === 0 ? 6 : 5, 0, Math.PI * 2);
        ctx.fillStyle = "#fff8ec"; ctx.fill(); ctx.strokeStyle = "#8a4b1c"; ctx.lineWidth = 2; ctx.stroke();
      });
      if (this.rgDrawing && this._rgHover && sc.length) {
        const [lx, ly] = this.rgDrawEnd === "head" ? sc[0] : sc[sc.length - 1];
        ctx.setLineDash([6, 4]); ctx.strokeStyle = "#8a4b1c"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(this._rgHover[0], this._rgHover[1]); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    ctx.restore();
  };

  // ── hit tests (screen px) ──
  P._rgHitHandle = function (sx, sy) {
    const r = this.rgChosen();
    if (!r) return null;
    const s = this.view.s, nm = this._rgNormals(r);
    let best = null, bd = HIT;
    r.points.forEach((p, i) => {
      const [x, y] = this.toScreen(p.x, p.y);
      for (const side of SIDES) {
        const sg = side === "l" ? 1 : -1, d = p[side] != null ? p[side] * s : GHOST;
        const dd = Math.hypot(x + sg * nm[i][0] * d - sx, y + sg * nm[i][1] * d - sy);
        if (dd < bd) { bd = dd; best = { r, i, side }; }
      }
    });
    return best;
  };
  P._rgHitPoint = function (sx, sy, only) {
    let best = null, bd = HIT;
    for (const r of only ? [only] : this.ranges || []) r.points.forEach((p, i) => {
      const [x, y] = this.toScreen(p.x, p.y), d = Math.hypot(x - sx, y - sy);
      if (d < bd) { bd = d; best = { r, i }; }
    });
    return best;
  };
  /** The crest segment under (sx, sy): its range, the index of its first point, and the spot on it (map 0..1). */
  P._rgHitEdge = function (sx, sy, only) {
    let best = null, bd = HIT;
    for (const r of only ? [only] : this.ranges || []) for (let i = 0; i + 1 < r.points.length; i++) {
      const [ax, ay] = this.toScreen(r.points[i].x, r.points[i].y), [bx, by] = this.toScreen(r.points[i + 1].x, r.points[i + 1].y);
      const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1, t = clamp(((sx - ax) * (bx - ax) + (sy - ay) * (by - ay)) / L2, 0, 1);
      const qx = ax + (bx - ax) * t, qy = ay + (by - ay) * t, d = Math.hypot(qx - sx, qy - sy);
      if (d < bd) { bd = d; best = { r, i, t, at: this.toMap(qx, qy) }; }
    }
    return best;
  };

  /** A crest under (sx, sy) that range r may split off (not its own, not one of its branches). */
  P._rgHitEdgeOther = function (sx, sy, r) {
    let best = null, bd = Infinity;
    for (const t of this.ranges || []) {
      if (!this._rgCanBranch(r, t)) continue;
      const e = this._rgHitEdge(sx, sy, t);
      if (!e) continue;
      const [ex, ey] = this.toScreen(e.at[0], e.at[1]), d = Math.hypot(ex - sx, ey - sy);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };

  // ── editing ──
  P.rgSelect = function (id) { this.rgSel = id; if (id == null) this.rgDrawing = false; this.opts.onRangeSelected && this.opts.onRangeSelected(); this.draw(); };
  /** A new range: click along its crest, then Enter (or Klar). */
  P.rgNew = function (name) {
    if (this.rgDrawing) this.rgFinish();
    this.ranges = this.ranges || [];
    const id = this.ranges.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    this.ranges.push({ id, name: String(name || "").slice(0, 100), height: null, points: [] });
    this.rgSel = id; this.rgDrawing = true; this.rgDrawEnd = "tail"; this._rgAdded = 0; this.rgBranching = false;
    this._rgChanged();
  };
  /** A new range splitting off another: the first click goes on the crest where it splits off. */
  P.rgNewBranch = function (name) { this.rgNew(name); this.rgBranching = true; this.opts.onRangeSelected && this.opts.onRangeSelected(); };
  /**
   * Goes on drawing the chosen range's crest from one of its ends ("tail": the last point, "head": the
   * first), like continuing a river. Clicks add points there until Enter, a double-click or Klar.
   */
  P.rgExtend = function (end) {
    const r = this.rgChosen();
    if (!r || this.rgDrawing) return false;
    this.rgDrawing = true; this.rgDrawEnd = end === "head" ? "head" : "tail"; this._rgAdded = 0; this._rgHover = null;
    this.opts.onRangeSelected && this.opts.onRangeSelected();
    this.draw();
    return true;
  };
  /** Stops drawing the crest; a range with fewer than two points is dropped. */
  P.rgFinish = function () {
    const r = this.rgChosen();
    this.rgDrawing = false; this._rgHover = null; this.rgBranching = false;
    if (r && r.points.length < 2) { this.ranges = this.ranges.filter((x) => x !== r); this.rgSel = null; }
    this._rgChanged();
    this.opts.onRangeSelected && this.opts.onRangeSelected();
  };
  P.rgDelete = function () {
    const r = this.rgChosen();
    if (!r) return;
    this.ranges = this.ranges.filter((x) => x !== r);
    this.rgSel = null; this.rgDrawing = false;
    this._rgChanged();
    this.opts.onRangeSelected && this.opts.onRangeSelected();
  };
  P.rgSetName = function (v) { const r = this.rgChosen(); if (r) { r.name = String(v).slice(0, 100); this._rgChanged(); } };
  P.rgSetHeight = function (v) { const r = this.rgChosen(); if (r) { const n = Number(v); r.height = v === "" || !Number.isFinite(n) ? null : clamp(Math.round(n), -1000, 12000); this._rgChanged(); } };
  /** Esc: stop drawing, then let go of the chosen range. */
  P.rgCancel = function () {
    if (this.rgDrawing) { this.rgFinish(); return true; }
    if (this.rgSel != null) { this.rgSelect(null); return true; }
    return false;
  };

  // A press on a width handle drags the width out (or in); on a crest point it moves the point (and
  // chooses its range). Without dragging it is a click.
  P.rgPointerDown = function (sx, sy) {
    const h = !this.rgDrawing ? this._rgHitHandle(sx, sy) : null;
    if (h) { this._rgDrag = { kind: "width", ...h, sx, sy, moved: false }; return true; }
    const p = this._rgHitPoint(sx, sy, this.rgDrawing ? this.rgChosen() : null);
    if (p) { this._rgDrag = { kind: "point", ...p, sx, sy, moved: false }; return true; }
    return false;
  };
  P.rgPointerMove = function (sx, sy) {
    const D = this._rgDrag;
    if (!D) { if (this.rgDrawing) { this._rgHover = [sx, sy]; this.draw(); } return; }
    if (!D.moved && Math.hypot(sx - D.sx, sy - D.sy) < 4) return;
    if (!D.moved && D.r.id !== this.rgSel) this.rgSelect(D.r.id);
    D.moved = true;
    const p = D.r.points[D.i];
    if (D.kind === "point") {
      const [nx, ny] = this.toMap(sx, sy);
      p.x = clamp(nx, 0, 1); p.y = clamp(ny, 0, 1);
      // a range's first point dropped on another crest makes it split off there
      D.snap = null;
      if (D.i === 0) {
        const e = this._rgHitEdgeOther(sx, sy, D.r);
        if (e) { D.snap = e; p.x = e.at[0]; p.y = e.at[1]; }
      }
    } else {
      // the width: how far the pointer is from the crest point, along that side's normal (map px)
      const nm = this._rgNormals(D.r)[D.i], sg = D.side === "l" ? 1 : -1, [x, y] = this.toScreen(p.x, p.y);
      const w = ((sx - x) * nm[0] * sg + (sy - y) * nm[1] * sg) / this.view.s;
      p[D.side] = w * this.view.s < 4 ? null : Math.min(5000, w);
    }
    this.draw();
  };
  P.rgPointerUp = function (sx, sy) {
    const D = this._rgDrag;
    this._rgDrag = null;
    if (!D) return;
    if (D.moved) {
      if (D.kind === "point" && D.i === 0) D.r.from = D.snap ? { range: D.snap.r.id, x: D.snap.at[0], y: D.snap.at[1] } : null;
      this._rgChanged(); return;
    }
    if (this.rgDrawing) { const [nx, ny] = this.toMap(sx, sy); this.rgClick(nx, ny, sx, sy); return; }
    if (D.r.id !== this.rgSel) { this.rgSelect(D.r.id); return; }
    // a click on the chosen range's first or last point: go on drawing from there
    if (D.kind === "point" && (D.i === 0 || D.i === D.r.points.length - 1)) this.rgExtend(D.i === 0 ? "head" : "tail");
  };
  /** A click (not a drag) in range mode. */
  P.rgClick = function (nx, ny, sx, sy) {
    const now = performance.now();
    const dbl = this._rgLastClick && now - this._rgLastClick.t < 380 && Math.hypot(sx - this._rgLastClick.x, sy - this._rgLastClick.y) < 6;
    this._rgLastClick = { t: now, x: sx, y: sy };
    const r = this.rgChosen();
    if (r && this.rgDrawing) {
      if (dbl && r.points.length >= 2) {
        // the double-click's first click added a point: take it back, then finish
        if (this._rgAdded > 0) { this.rgDrawEnd === "head" ? r.points.shift() : r.points.pop(); this._rgAdded--; }
        this.rgFinish(); return;
      }
      // the start on another crest: the range splits off there (the first click of a new range, or
      // carrying on upstream onto a crest, which then ends the drawing)
      const first = this.rgDrawEnd === "head" || !r.points.length;
      const e = first ? this._rgHitEdgeOther(sx, sy, r) : null;
      if (this.rgBranching && !r.points.length && !e) return;           // a branch starts on a crest
      const np = e ? { x: e.at[0], y: e.at[1], l: null, r: null } : { x: clamp(nx, 0, 1), y: clamp(ny, 0, 1), l: null, r: null };
      if (this.rgDrawEnd === "head") r.points.unshift(np); else r.points.push(np);
      if (first) r.from = e ? { range: e.r.id, x: e.at[0], y: e.at[1] } : null;
      this.rgBranching = false;
      this._rgAdded = (this._rgAdded || 0) + 1;
      if (e && this.rgDrawEnd === "head" && r.points.length >= 2) { this.rgFinish(); return; }
      this._rgChanged();
      return;
    }
    if (r) {
      // on the chosen range's crest: a new point there (widths carried over from the neighbours)
      const e = this._rgHitEdge(sx, sy, r);
      if (e) {
        const a = r.points[e.i], b = r.points[e.i + 1], mix = (u, v) => (u != null && v != null ? u + (v - u) * e.t : null);
        r.points.splice(e.i + 1, 0, { x: e.at[0], y: e.at[1], l: mix(a.l, b.l), r: mix(a.r, b.r) });
        this._rgChanged();
        return;
      }
    }
    const e = this._rgHitEdge(sx, sy);
    if (e) { this.rgSelect(e.r.id); return; }
    if (r) this.rgSelect(null);
  };
  /** Right-click: while drawing, the last point goes; else a set width handle is cleared, or a crest point removed. */
  P.rgContextMenu = function (sx, sy) {
    const r = this.rgChosen();
    if (!r) return;
    if (this.rgDrawing) {
      // only points added while drawing this time go (a range being continued keeps what it had)
      if (this._rgAdded > 0) {
        if (this.rgDrawEnd === "head" || r.points.length === 1) r.from = null;
        this.rgDrawEnd === "head" ? r.points.shift() : r.points.pop(); this._rgAdded--; this._rgChanged();
      }
      return;
    }
    const h = this._rgHitHandle(sx, sy);
    if (h && r.points[h.i][h.side] != null) { r.points[h.i][h.side] = null; this._rgChanged(); return; }
    const p = this._rgHitPoint(sx, sy, r);
    if (p) {
      r.points.splice(p.i, 1);
      if (p.i === 0) r.from = null;                                    // its start left the crest it split off
      if (r.points.length < 2) { this.ranges = this.ranges.filter((x) => x !== r); this.rgSel = null; this.opts.onRangeSelected && this.opts.onRangeSelected(); }
      this._rgChanged();
    }
  };
})();
