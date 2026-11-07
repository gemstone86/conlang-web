// Eon Weather – nations: areas drawn as polygons, each with a name and a colour, made of one or more
// parts (e.g. a mainland and islands), and divided into subdivisions (provinces, counties…), which are
// drawn the same way inside it. Adds methods to FieldMap: drawing (layer "nation"), editing (edit mode
// "nation") and finding the nation (and subdivision) at a spot.
(function () {
  "use strict";
  const FM = window.FieldMap;
  if (!FM) return;
  const P = FM.prototype;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const HIT = 9;            // px: how close counts as clicking on a corner or an edge
  const SAME = 1e-7;        // corners this close (in map fractions) are one shared corner
  const COLOURS = ["#c0504d", "#4f81bd", "#9bbb59", "#8064a2", "#f79646", "#4bacc6", "#c9a227", "#d16ba5", "#5b8c5a", "#a0522d"];
  const copyParts = (parts) => (parts || []).map((pt) => (pt || []).map((p) => ({ x: p.x, y: p.y }))).filter((pt) => pt.length);
  const outParts = (parts) => parts.filter((pt) => pt.length).map((pt) => pt.map((p) => ({ x: +p.x.toFixed(7), y: +p.y.toFixed(7) })));

  // ── data ──
  P.setNations = function (list) {
    this.nations = (list || []).map((n) => ({ id: n.id, name: n.name || "", color: /^#[0-9a-f]{6}$/i.test(n.color || "") ? n.color : COLOURS[0],
      parts: copyParts(n.parts), subs: (n.subs || []).map((s) => ({ id: s.id, name: s.name || "", parts: copyParts(s.parts) })) }));
    this.ntSel = null; this.ntSub = null; this.ntPart = 0; this.ntDrawing = false;
    this.draw();
  };
  P.getNations = function () {
    return (this.nations || []).map((n) => ({ id: n.id, name: n.name, color: n.color, parts: outParts(n.parts),
      subs: (n.subs || []).map((s) => ({ id: s.id, name: s.name, parts: outParts(s.parts) })) }));
  };
  P._ntChanged = function () { this.opts.onNationsChanged && this.opts.onNationsChanged(); this.draw(); };
  P._ntById = function (id) { return (this.nations || []).find((n) => n.id === id) || null; };
  /** What is being edited: the chosen subdivision, else the chosen nation (or null). */
  P.ntTarget = function () {
    const n = this._ntById(this.ntSel);
    if (!n) return null;
    return (this.ntSub != null && (n.subs || []).find((s) => s.id === this.ntSub)) || n;
  };
  P.ntChosenSub = function () {
    const n = this._ntById(this.ntSel);
    return n && this.ntSub != null ? (n.subs || []).find((s) => s.id === this.ntSub) || null : null;
  };
  /** Every shape (nations and their subdivisions) with its owner, for corner snapping and hit tests. */
  P._ntShapes = function () {
    const out = [];
    for (const n of this.nations || []) { out.push({ shape: n, nation: n, sub: null }); for (const s of n.subs || []) out.push({ shape: s, nation: n, sub: s }); }
    return out;
  };

  /** Area in km² of one outline (shoelace in map pixels), and of a nation or subdivision (all its parts). */
  P._ntArea = function (pt) {
    const W = this.imgW, H = this.imgH, k = this.kmPerPx || 0;
    let a = 0;
    for (let i = 0; i < pt.length; i++) { const p = pt[i], q = pt[(i + 1) % pt.length]; a += p.x * W * q.y * H - q.x * W * p.y * H; }
    return Math.abs(a) / 2 * k * k;
  };
  P.nationArea = function (shape) { return shape ? shape.parts.reduce((s, pt) => s + (pt.length >= 3 ? this._ntArea(pt) : 0), 0) : 0; };
  const inPoly = (pt, x, y) => {
    let c = false;
    for (let i = 0, j = pt.length - 1; i < pt.length; j = i++) {
      const a = pt[i], b = pt[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  const inShape = (shape, x, y) => {
    for (let k = 0; k < shape.parts.length; k++) if (shape.parts[k].length >= 3 && inPoly(shape.parts[k], x, y)) return k;
    return -1;
  };
  /** The nation at a map point (0–1): { nation, sub (or null), part } or null (the last drawn wins where they overlap). */
  P.nationAt = function (nx, ny) {
    const ns = this.nations || [];
    for (let i = ns.length - 1; i >= 0; i--) {
      const n = ns[i];
      for (let j = (n.subs || []).length - 1; j >= 0; j--) {
        const k = inShape(n.subs[j], nx, ny);
        if (k >= 0) return { nation: n, sub: n.subs[j], part: k };
      }
      const k = inShape(n, nx, ny);
      if (k >= 0) return { nation: n, sub: null, part: k };
    }
    return null;
  };

  // ── drawing ──
  P._ntPath = function (shape, open) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (const pt of shape.parts) {
      if (pt.length < 2) continue;
      pt.forEach((p, i) => { const [x, y] = this.toScreen(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      if (pt.length >= 3 && !(open && pt === open)) ctx.closePath();
    }
  };
  P._ntDraw = function () {
    const ns = this.nations || [], editing = this.editing && this.editMode === "nation";
    if (!ns.length) return;
    const ctx = this.ctx, target = editing ? this.ntTarget() : null;
    const openPart = target && this.ntDrawing ? target.parts[this.ntPart] : null;
    ctx.save();
    ctx.lineJoin = "round";
    for (const n of ns) {
      const sel = editing && this.ntSel === n.id;
      this._ntPath(n, openPart);
      ctx.globalAlpha = sel ? 0.28 : 0.18; ctx.fillStyle = n.color; ctx.fill("evenodd");
      // subdivisions: a lighter fill for the chosen one, and dashed borders
      for (const s of n.subs || []) {
        if (editing && target === s) { this._ntPath(s, openPart); ctx.globalAlpha = 0.25; ctx.fillStyle = "#fff"; ctx.fill("evenodd"); }
        this._ntPath(s, openPart);
        ctx.globalAlpha = 0.9; ctx.setLineDash([5, 4]);
        ctx.strokeStyle = editing && target === s ? "#ffe08a" : "rgba(20,24,30,0.7)"; ctx.lineWidth = editing && target === s ? 2.2 : 1.2; ctx.stroke();
        ctx.setLineDash([]);
      }
      this._ntPath(n, openPart);
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = "rgba(20,24,30,0.55)"; ctx.lineWidth = sel ? 5 : 3.5; ctx.stroke();
      ctx.strokeStyle = editing && target === n ? "#ffe08a" : n.color; ctx.lineWidth = sel ? 2.5 : 1.8; ctx.stroke();
    }
    // names: nations in the middle of their largest part, subdivisions smaller (when zoomed in enough)
    ctx.globalAlpha = 1;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const zoom = Math.log2(Math.max(this.view.s * this.imgW / 1500, 0.25));
    const label = (shape, size, colour, weight, lift = 0) => {
      if (!shape.name) return;
      let best = null, ba = 0;
      for (const pt of shape.parts) if (pt.length >= 3) { const a = this._ntArea(pt) || 1e-9; if (a > ba) { ba = a; best = pt; } }
      if (!best) return;
      const c = this._ntCentre(best), [x, y0] = this.toScreen(c.x, c.y), y = y0 - lift;
      ctx.font = `${weight} ${size}px system-ui, sans-serif`;
      ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(15,18,24,0.85)"; ctx.strokeText(shape.name, x, y);
      ctx.fillStyle = colour; ctx.fillText(shape.name, x, y);
    };
    const subSize = clamp(9 + zoom * 2, 9, 14), nSize = clamp(11 + zoom * 2.5, 10, 18);
    const subsShown = (n) => (n.subs || []).length && (zoom > 0.5 || (editing && this.ntSel === n.id));
    for (const n of ns) if (subsShown(n)) for (const s of n.subs) label(s, subSize, "#e6e0d0", 500);
    // with its subdivisions named, the nation's own name goes a little higher, clear of theirs
    for (const n of ns) label(n, nSize, "#f4efe2", 600, subsShown(n) ? nSize * 1.3 : 0);
    // corners of what is being edited (the part being drawn bigger), and of the rest of the chosen nation (small)
    if (target) {
      const n = this._ntById(this.ntSel);
      for (const sh of [n, ...(n.subs || [])]) {
        if (sh === target) continue;
        for (const pt of sh.parts) for (const p of pt) {
          const [x, y] = this.toScreen(p.x, p.y);
          ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
        }
      }
      target.parts.forEach((pt, k) => pt.forEach((p, i) => {
        const [x, y] = this.toScreen(p.x, p.y), cur = k === this.ntPart;
        ctx.fillStyle = cur && this.ntDrawing && i === pt.length - 1 ? "#ffe08a" : "#fff"; ctx.strokeStyle = "#18212a"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, cur ? 4.5 : 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }));
    }
    ctx.restore();
  };
  /** A point inside a polygon to put its name on: the centroid, or (for odd shapes) the inside point nearest it. */
  P._ntCentre = function (pt) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pt.length; i++) {
      const p = pt[i], q = pt[(i + 1) % pt.length], f = p.x * q.y - q.x * p.y;
      a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
    }
    if (Math.abs(a) < 1e-12) return pt[0];
    const c = { x: cx / (3 * a), y: cy / (3 * a) };
    if (inPoly(pt, c.x, c.y)) return c;
    let best = pt[0], bd = Infinity;                      // e.g. a crescent: the nearest inside spot along a few lines
    for (let i = 0; i < pt.length; i++) {
      const q = { x: (pt[i].x + pt[(i + 2) % pt.length].x) / 2, y: (pt[i].y + pt[(i + 2) % pt.length].y) / 2 };
      const d = (q.x - c.x) ** 2 + (q.y - c.y) ** 2;
      if (d < bd && inPoly(pt, q.x, q.y)) { bd = d; best = q; }
    }
    return best;
  };

  // ── finding things under the pointer (screen px) ──
  /** The corner nearest a screen point (within HIT): those of `only` if given, else any nation's or subdivision's (the edited one first). */
  P._ntHitPoint = function (sx, sy, only) {
    const target = this.editing && this.editMode === "nation" ? this.ntTarget() : null;
    let best = null, bd = HIT + 2;
    const shapes = only ? [{ shape: only, nation: this._ntById(this.ntSel), sub: this.ntChosenSub() }] : this._ntShapes();
    for (const o of shapes) o.shape.parts.forEach((pt, k) => pt.forEach((p, i) => {
      const [x, y] = this.toScreen(p.x, p.y), d = Math.hypot(x - sx, y - sy);
      if (d < bd || (d === bd && o.shape === target)) { bd = d; best = { ...o, k, i, p }; }
    }));
    return best;
  };
  /** An existing corner to put a new or moved corner on (shared borders), other than those listed. */
  P._ntSnap = function (sx, sy, skip) {
    let best = null, bd = HIT;
    for (const o of this._ntShapes()) for (const pt of o.shape.parts) for (const p of pt) {
      if (skip && skip.has(p)) continue;
      const [x, y] = this.toScreen(p.x, p.y), d = Math.hypot(x - sx, y - sy);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };
  /** The edited shape's edge nearest a screen point (within HIT): { k, i } = between corner i and i + 1 of part k. */
  P._ntHitEdge = function (sx, sy) {
    const t = this.ntTarget();
    if (!t) return null;
    let best = null;
    t.parts.forEach((pt, k) => {
      if (pt.length < 2) return;
      const m = pt.length >= 3 ? pt.length : pt.length - 1;
      for (let i = 0; i < m; i++) {
        const [ax, ay] = this.toScreen(pt[i].x, pt[i].y), [bx, by] = this.toScreen(pt[(i + 1) % pt.length].x, pt[(i + 1) % pt.length].y);
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
        const t_ = L ? clamp(((sx - ax) * dx + (sy - ay) * dy) / L, 0, 1) : 0;
        const d = Math.hypot(ax + dx * t_ - sx, ay + dy * t_ - sy);
        if (d < HIT && (!best || d < best.d)) best = { k, i, d, at: this.toMap(ax + dx * t_, ay + dy * t_) };
      }
    });
    return best;
  };

  // ── editing ──
  P.ntSelect = function (id, sub, part) {
    if (this.ntDrawing) this.ntFinish();
    this.ntSel = id; this.ntSub = sub != null ? sub : null; this.ntPart = part || 0;
    this.opts.onNationSelected && this.opts.onNationSelected(this._ntById(id));
    this.draw();
  };
  /** A new nation, chosen at once: the next clicks on the map draw its outline. */
  P.ntNew = function (name) {
    this.nations = this.nations || [];
    const id = this.nations.reduce((m, n) => Math.max(m, n.id), 0) + 1;
    const used = new Set(this.nations.map((n) => n.color));
    const color = COLOURS.find((c) => !used.has(c)) || COLOURS[id % COLOURS.length];
    this.nations.push({ id, name: String(name || "").slice(0, 100), color, parts: [[]], subs: [] });
    this.ntSelect(id, null, 0);
    this.ntDrawing = true;
    this._ntChanged();
    return id;
  };
  /** A new subdivision of the chosen nation, chosen at once: the next clicks draw its outline. */
  P.ntNewSub = function (name) {
    const n = this._ntById(this.ntSel);
    if (!n) return null;
    n.subs = n.subs || [];
    const id = n.subs.reduce((m, s) => Math.max(m, s.id), 0) + 1;
    n.subs.push({ id, name: String(name || "").slice(0, 100), parts: [[]] });
    this.ntSelect(n.id, id, 0);
    this.ntDrawing = true;
    this._ntChanged();
    return id;
  };
  /** Another part (an island, an exclave) of what is being edited: the next clicks draw it. */
  P.ntNewPart = function () {
    const t = this.ntTarget();
    if (!t) return false;
    if (this.ntDrawing) this.ntFinish();
    const empty = t.parts.findIndex((pt) => !pt.length);
    if (empty >= 0) this.ntPart = empty;
    else { t.parts.push([]); this.ntPart = t.parts.length - 1; }
    this.ntDrawing = true;
    this.draw();
    return true;
  };
  /** Ends drawing an outline (it closes); a part with fewer than three corners goes. */
  P.ntFinish = function () {
    const t = this.ntTarget();
    this.ntDrawing = false;
    if (!t) return false;
    const before = t.parts.length;
    t.parts = t.parts.filter((pt) => pt.length >= 3);
    if (this.ntPart >= t.parts.length) this.ntPart = Math.max(0, t.parts.length - 1);
    if (t.parts.length !== before) this._ntChanged(); else this.draw();
    return true;
  };
  P.ntSetName = function (v) { const t = this.ntTarget(); if (t) { t.name = String(v).slice(0, 100); this._ntChanged(); } };
  P.ntSetColor = function (v) { const n = this._ntById(this.ntSel); if (n && /^#[0-9a-f]{6}$/i.test(v)) { n.color = v.toLowerCase(); this._ntChanged(); } };
  /** Removes what is being edited: the chosen subdivision, or the nation with all its subdivisions. */
  P.ntDelete = function () {
    const n = this._ntById(this.ntSel), s = this.ntChosenSub();
    if (!n) return;
    this.ntDrawing = false;
    if (s) { n.subs = n.subs.filter((x) => x !== s); this.ntSelect(n.id, null, 0); }
    else { this.nations = this.nations.filter((x) => x !== n); this.ntSelect(null); }
    this._ntChanged();
  };
  P.ntDeletePart = function () {
    const t = this.ntTarget();
    if (!t || !t.parts[this.ntPart]) return;
    this.ntDrawing = false;
    t.parts.splice(this.ntPart, 1);
    this.ntPart = 0;
    this._ntChanged();
  };
  /**
   * Suggests `count` subdivisions covering the chosen nation (all its parts), of about the same size and
   * compact: centres spread evenly over the nation (k-means on points inside it), each subdivision the
   * part of the nation nearer its centre than any other (Voronoi cells cut out of the nation with
   * vendor/polygon-clipping). They replace the nation's subdivisions; named "<base> 1…n", north to
   * south. Returns how many were made.
   */
  P.ntSuggestSubs = function (count, base) {
    const n = this._ntById(this.ntSel), PC = window.polygonClipping;
    if (!n || !PC) return 0;
    if (this.ntDrawing) this.ntFinish();
    const W = this.imgW, H = this.imgH;
    const parts = n.parts.filter((pt) => pt.length >= 3);
    if (!parts.length) return 0;
    count = clamp(Math.round(count) || 2, 2, 60);
    // the nation in map pixels (so north–south and east–west distances count alike)
    const ring = (pt) => { const r = pt.map((p) => [p.x * W, p.y * H]); r.push(r[0]); return r; };
    let shape = parts.map((pt) => [ring(pt)]);
    try { shape = PC.union(shape); } catch (e) { /* self-touching outlines: use them as they are */ }
    // even points inside it
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const pt of parts) for (const p of pt) { x0 = Math.min(x0, p.x * W); y0 = Math.min(y0, p.y * H); x1 = Math.max(x1, p.x * W); y1 = Math.max(y1, p.y * H); }
    const area = this.nationArea(n) / Math.max(1e-9, (this.kmPerPx || 1) ** 2) || (x1 - x0) * (y1 - y0);
    const step = Math.max(1e-3, Math.sqrt(area / 6000));
    const pts = [];
    for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step)
      if (inShape(n, x / W, y / H) >= 0) pts.push([x, y]);
    if (pts.length < count) return 0;
    // centres: spread out first (each the point farthest from those chosen), then k-means
    let mx = 0, my = 0; for (const p of pts) { mx += p[0]; my += p[1]; } mx /= pts.length; my /= pts.length;
    const cs = [pts.reduce((b, p) => ((p[0] - mx) ** 2 + (p[1] - my) ** 2 < (b[0] - mx) ** 2 + (b[1] - my) ** 2 ? p : b)).slice()];
    const dmin = pts.map((p) => (p[0] - cs[0][0]) ** 2 + (p[1] - cs[0][1]) ** 2);
    while (cs.length < count) {
      let bi = 0; for (let i = 1; i < pts.length; i++) if (dmin[i] > dmin[bi]) bi = i;
      cs.push(pts[bi].slice());
      for (let i = 0; i < pts.length; i++) dmin[i] = Math.min(dmin[i], (pts[i][0] - pts[bi][0]) ** 2 + (pts[i][1] - pts[bi][1]) ** 2);
    }
    const near = new Int32Array(pts.length);
    for (let it = 0; it < 40; it++) {
      const sx = new Float64Array(count), sy = new Float64Array(count), sn = new Float64Array(count);
      for (let i = 0; i < pts.length; i++) {
        let b = 0, bd = Infinity;
        for (let c = 0; c < count; c++) { const d = (pts[i][0] - cs[c][0]) ** 2 + (pts[i][1] - cs[c][1]) ** 2; if (d < bd) { bd = d; b = c; } }
        near[i] = b; sx[b] += pts[i][0]; sy[b] += pts[i][1]; sn[b]++;
      }
      let moved = 0;
      for (let c = 0; c < count; c++) if (sn[c]) { const nx = sx[c] / sn[c], ny = sy[c] / sn[c]; moved = Math.max(moved, Math.hypot(nx - cs[c][0], ny - cs[c][1])); cs[c] = [nx, ny]; }
      if (moved < step * 0.01) break;
    }
    // each centre's cell: a big box cut by the halfway line to every other centre, then cut out of the nation
    const pad = (x1 - x0 + y1 - y0) + 10;
    const box = [[x0 - pad, y0 - pad], [x1 + pad, y0 - pad], [x1 + pad, y1 + pad], [x0 - pad, y1 + pad]];
    const cutHalf = (poly, a, b) => {                      // keep the side of poly nearer a than b
      const nx = b[0] - a[0], ny = b[1] - a[1], k = (b[0] * b[0] + b[1] * b[1] - a[0] * a[0] - a[1] * a[1]) / 2;
      const f = (p) => p[0] * nx + p[1] * ny - k, out = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length], fp = f(p), fq = f(q);
        if (fp <= 0) out.push(p);
        if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
      }
      return out;
    };
    const order = cs.map((c, i) => i).sort((a, b) => (Math.round(cs[a][1] / (step * 20)) - Math.round(cs[b][1] / (step * 20))) || cs[a][0] - cs[b][0]);
    const subs = [];
    for (const i of order) {
      let cell = box;
      for (let j = 0; j < count && cell.length >= 3; j++) if (j !== i) cell = cutHalf(cell, cs[i], cs[j]);
      if (cell.length < 3) continue;
      let piece;
      try { piece = PC.intersection(shape, [[...cell, cell[0]]]); } catch (e) { continue; }
      const sp = [];
      for (const poly of piece) {
        const r = poly[0].slice(0, -1);                       // the outline (holes, if any, are left out)
        if (r.length >= 3) sp.push(r.map((p) => ({ x: clamp(p[0] / W, 0, 1), y: clamp(p[1] / H, 0, 1) })));
      }
      if (sp.length) subs.push({ id: subs.length + 1, name: `${base || "Provins"} ${subs.length + 1}`, parts: sp });
    }
    // corners meant to be the same spot (a border between two subdivisions, or the nation's own corners)
    // become exactly the same, so dragging one moves them all
    const all = [...n.parts.flat(), ...subs.flatMap((s) => s.parts.flat())], grid = new Map(), key = (x, y) => `${Math.round(x * 2e6)},${Math.round(y * 2e6)}`;
    for (const p of all) {
      const k = key(p.x, p.y);
      let hit = null;
      for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
        const [a, b] = k.split(",").map(Number), g = grid.get(`${a + dx},${b + dy}`);
        if (g && !hit && Math.abs(g.x - p.x) < 1e-6 && Math.abs(g.y - p.y) < 1e-6) hit = g;
      }
      if (hit) { p.x = hit.x; p.y = hit.y; } else grid.set(k, p);
    }
    n.subs = subs;
    this.ntSelect(n.id, null, 0);
    this._ntChanged();
    return subs.length;
  };
  /** Esc: stop drawing; then from a subdivision back to its nation; then let go. */
  P.ntCancel = function () {
    if (this.ntDrawing) { this.ntFinish(); return true; }
    if (this.ntSub != null) { this.ntSelect(this.ntSel, null, 0); return true; }
    if (this.ntSel != null) { this.ntSelect(null); return true; }
    return false;
  };

  // A press on a corner (of any nation or subdivision; while drawing, only the outline being drawn)
  // grabs it: dragging moves it, together with the corners shared with it (the same spot in a
  // neighbouring subdivision or nation), and it snaps onto another corner when dropped on one.
  // A press without dragging is a click.
  P.ntPointerDown = function (sx, sy) {
    const t = this.ntTarget();
    const h = this._ntHitPoint(sx, sy, this.ntDrawing ? t : null);
    if (!h) return false;
    const shared = [];
    for (const o of this._ntShapes()) for (const pt of o.shape.parts) for (const p of pt)
      if (Math.abs(p.x - h.p.x) < SAME && Math.abs(p.y - h.p.y) < SAME) shared.push(p);
    this._ntDrag = { ...h, shared, sx, sy, moved: false };
    return true;
  };
  P.ntPointerMove = function (sx, sy) {
    const D = this._ntDrag;
    if (!D) return;
    if (!D.moved && Math.hypot(sx - D.sx, sy - D.sy) < 4) return;
    if (!D.moved && !this.ntDrawing) this.ntSelect(D.nation.id, D.sub ? D.sub.id : null, D.k);   // what is moved gets chosen
    D.moved = true;
    const snap = this._ntSnap(sx, sy, new Set(D.shared));
    const [nx, ny] = snap ? [snap.x, snap.y] : this.toMap(sx, sy);
    for (const p of D.shared) { p.x = clamp(nx, 0, 1); p.y = clamp(ny, 0, 1); }
    this.draw();
  };
  P.ntPointerUp = function (sx, sy) {
    const D = this._ntDrag;
    this._ntDrag = null;
    if (!D) return;
    if (D.moved) { this.ntPart = D.k; this._ntChanged(); return; }
    // no drag: while drawing, it is a click (on the first corner it closes the outline); otherwise
    // it chooses the corner's nation or subdivision
    if (this.ntDrawing) { const [nx, ny] = this.toMap(sx, sy); this.ntClick(nx, ny, sx, sy); return; }
    this.ntSelect(D.nation.id, D.sub ? D.sub.id : null, D.k);
  };
  /** A click (not a drag) in nation mode. */
  P.ntClick = function (nx, ny, sx, sy) {
    const now = performance.now();
    const dbl = this._ntLastClick && now - this._ntLastClick.t < 380 && Math.hypot(sx - this._ntLastClick.x, sy - this._ntLastClick.y) < 6;
    this._ntLastClick = { t: now, x: sx, y: sy };
    const t = this.ntTarget();
    if (t && this.ntDrawing) {
      if (!t.parts[this.ntPart]) { t.parts.push([]); this.ntPart = t.parts.length - 1; }
      const pt = t.parts[this.ntPart];
      // drawing the outline: each click is its next corner (on an existing corner nearby, if any, so
      // borders can be shared); a click on the first corner (or a double-click) closes it
      if (pt.length >= 3) {
        const [fx, fy] = this.toScreen(pt[0].x, pt[0].y);
        if (dbl || Math.hypot(fx - sx, fy - sy) < HIT) { this.ntFinish(); return; }
      }
      const snap = this._ntSnap(sx, sy, new Set(pt));
      pt.push(snap ? { x: snap.x, y: snap.y } : { x: nx, y: ny });
      this._ntChanged();
      return;
    }
    if (t) {
      // on the edge of what is being edited: a new corner there
      const e = this._ntHitEdge(sx, sy);
      if (e) { t.parts[e.k].splice(e.i + 1, 0, { x: e.at[0], y: e.at[1] }); this.ntPart = e.k; this._ntChanged(); return; }
    }
    const h = this.nationAt(nx, ny);
    if (h) {
      // a nation is chosen first; once it is, a click inside one of its subdivisions chooses that
      if (h.nation.id === this.ntSel && h.sub) this.ntSelect(h.nation.id, h.sub.id, h.part);
      else this.ntSelect(h.nation.id, null, h.sub ? 0 : h.part);
      return;
    }
    if (t) this.ntSelect(null);                                   // empty ground: let go
  };
  /** Right-click: the corner under the pointer of what is being edited goes. */
  P.ntContextMenu = function (sx, sy) {
    const t = this.ntTarget();
    const h = t ? this._ntHitPoint(sx, sy, t) : null;
    if (!h) return;
    t.parts[h.k].splice(h.i, 1);
    this.ntPart = h.k;
    this._ntChanged();
  };
})();
