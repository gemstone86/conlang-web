// Eon Weather – rivers: a network of lines drawn from source to mouth. Each river has a size of its
// own (1 = small stream … 10 = the Amazon) and ends either in the sea or a lake, or on another river.
// The flow downstream of a junction is the river's own size plus everything that has joined it.
// Adds methods to FieldMap: drawing (layer "river"), editing (edit mode "river") and flow sums.
//
// Lakes are points in the network that rivers run into and out of, without being part of any river:
// everything that flows into a lake leaves it through its outflow (a river drawn from the lake;
// shared evenly if it has several, nothing leaves one without). Stored in the same list as the
// rivers, as { id, lake: true, name, x, y }; a river ending in one has joins { lake: id, x, y }, and
// one starting from one has from { lake: id }.
(function () {
  "use strict";
  const FM = window.FieldMap;
  if (!FM) return;
  const P = FM.prototype;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const SNAP = 9;         // px: how close to a river a click joins it
  const HIT = 9;          // px: how close counts as clicking on a point or a line

  // ── data ──
  P.setRivers = function (list) {
    list = list || [];
    this.lakes = list.filter((r) => r && r.lake).map((l) => ({ id: l.id, name: l.name || "", x: l.x, y: l.y }));
    this.rivers = list.filter((r) => r && !r.lake).map((r) => ({ id: r.id, name: r.name || "", size: clamp(Math.round(r.size || 1), 1, 10),
      speed: Number.isFinite(+r.speed) && r.speed !== null && r.speed !== "" ? clamp(+r.speed, 0, 30) : null,
      points: (r.points || []).map((p) => ({ x: p.x, y: p.y })),
      joins: r.joins ? (r.joins.lake != null ? { lake: r.joins.lake, x: r.joins.x, y: r.joins.y } : { river: r.joins.river, x: r.joins.x, y: r.joins.y }) : null,
      from: r.from && r.from.lake != null ? { lake: r.from.lake } : null }));
    this.rvSel = null; this.lkSel = null; this.rvDraft = null; this._rvFlow = null; this.lkPlacing = false;
    this._rvRejoin();
    this.draw();
  };
  /**
   * Rivers whose mouth lies exactly on another river (as a mouth dropped or drawn onto it does) but that
   * have lost the junction (an older version cut it when carrying on drawing was started and left) join
   * that river again. Returns how many.
   */
  P._rvRejoin = function () {
    const rs = this.rivers || [], W = this.imgW || 1, H = this.imgH || 1;
    let n = 0;
    for (const r of rs) {
      if (r.joins || r.points.length < 2) continue;
      const m = r.points[r.points.length - 1];
      let best = null;
      for (const t of rs) {
        if (t === r || t.points.length < 2) continue;
        const pr = this._rvProject(t, m.x, m.y);
        if (pr.d < 0.02 && (!best || pr.d < best.d)) best = { t, d: pr.d };      // within ~100 m
      }
      if (best && this._rvCanJoin(r, best.t)) { r.joins = { river: best.t.id, x: m.x, y: m.y }; n++; }
    }
    if (n) this._rvFlow = null;
    return n;
  };
  /** The rivers (not the lakes). */
  P.getRivers = function () {
    return (this.rivers || []).map((r) => {
      const o = { id: r.id, name: r.name, size: r.size, points: r.points.map((p) => ({ x: +p.x.toFixed(6), y: +p.y.toFixed(6) })), joins: null };
      if (r.speed != null) o.speed = +r.speed.toFixed(2);
      if (r.joins) o.joins = r.joins.lake != null ? { lake: r.joins.lake, x: +r.joins.x.toFixed(6), y: +r.joins.y.toFixed(6) }
        : { river: r.joins.river, x: +r.joins.x.toFixed(6), y: +r.joins.y.toFixed(6) };
      if (r.from) o.from = { lake: r.from.lake };
      return o;
    });
  };
  P.getLakes = function () {
    return (this.lakes || []).map((l) => ({ id: l.id, lake: true, name: l.name, x: +l.x.toFixed(6), y: +l.y.toFixed(6) }));
  };
  /** Rivers and lakes, as saved. */
  P.getRiverData = function () { return [...this.getRivers(), ...this.getLakes()]; };
  P._rvChanged = function () { this._rvFlow = null; this.opts.onRiversChanged && this.opts.onRiversChanged(); this.draw(); };
  P._rvById = function (id) { return (this.rivers || []).find((r) => r.id === id) || null; };
  P._lkById = function (id) { return (this.lakes || []).find((l) => l.id === id) || null; };
  P._rvNewId = function () { return [...(this.rivers || []), ...(this.lakes || [])].reduce((m, r) => Math.max(m, r.id), 0) + 1; };
  /** Can water get from node a to node b ("r<id>" a river, "l<id>" a lake) along the network? */
  P._rvReaches = function (a, b) {
    const seen = new Set([a]), todo = [a];
    while (todo.length) {
      const k = todo.pop();
      if (k === b) return true;
      const id = +k.slice(1), nx = [];
      if (k[0] === "r") { const r = this._rvById(id); if (r && r.joins) nx.push(r.joins.lake != null ? "l" + r.joins.lake : "r" + r.joins.river); }
      else for (const r of this.rivers || []) if (r.from && r.from.lake === id) nx.push("r" + r.id);
      for (const n of nx) if (!seen.has(n)) { seen.add(n); todo.push(n); }
    }
    return false;
  };
  /** May river r end on river t / in lake l / start from lake l (no water running in a circle)? */
  P._rvCanJoin = function (r, t) { return t !== r && !this._rvReaches("r" + t.id, "r" + r.id); };
  P._rvCanEnterLake = function (r, l) { return !this._rvReaches("l" + l.id, "r" + r.id); };
  P._rvCanLeaveLake = function (r, l) { return !this._rvReaches("r" + r.id, "l" + l.id); };

  /** Distances in map pixels, so a point's x and y count alike. */
  P._rvProject = function (r, x, y) {
    const W = this.imgW, H = this.imgH;
    let best = { d: Infinity, s: 0 };
    for (let k = 0; k + 1 < r.points.length; k++) {
      const a = r.points[k], b = r.points[k + 1];
      const ax = a.x * W, ay = a.y * H, bx = b.x * W, by = b.y * H, px = x * W, py = y * H;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? clamp(((px - ax) * dx + (py - ay) * dy) / L, 0, 1) : 0;
      const d = Math.hypot(ax + dx * t - px, ay + dy * t - py);
      if (d < best.d) best = { d, s: k + t };
    }
    return best;
  };
  /**
   * Flow along every river: { [id]: { total, events: [{ s, add }] } }, where s is the position along the
   * river (segment index + fraction) at which a tributary carrying `add` joins.
   */
  P.riverFlows = function () {
    if (this._rvFlow && this._rvFlowN === (this.rivers || []).length + "/" + (this.lakes || []).length) return this._rvFlow;
    const rs = this.rivers || [], out = {}, byId = new Map(rs.map((r) => [r.id, r])), lakes = new Map((this.lakes || []).map((l) => [l.id, l]));
    rs.forEach((r) => { out[r.id] = { total: r.size, base: r.size, events: [] }; });
    const into = new Map(), inLake = new Map(), outLake = new Map();   // river id → tributaries; lake id → rivers in / out
    const add = (m, k, v) => (m.get(k) || m.set(k, []).get(k)).push(v);
    rs.forEach((r) => {
      if (r.joins && r.joins.lake != null) { if (lakes.has(r.joins.lake)) add(inLake, r.joins.lake, r); }
      else if (r.joins && byId.has(r.joins.river) && r.joins.river !== r.id) add(into, r.joins.river, r);
      if (r.from && lakes.has(r.from.lake)) add(outLake, r.from.lake, r);
    });
    const lakeOut = {}, lakeIn = (id, seen) => {
      if (lakeOut[id]) return lakeOut[id].in;
      if (seen.has("l" + id)) return 0;
      seen.add("l" + id);
      let t = 0;
      for (const r of inLake.get(id) || []) t += total(r, seen);
      seen.delete("l" + id);
      lakeOut[id] = { in: t, outs: (outLake.get(id) || []).length };
      return t;
    };
    const total = (r, seen) => {
      if (seen.has(r.id)) return r.size;                     // a loop (shouldn't happen): stop
      if (out[r.id].done) return out[r.id].total;
      seen.add(r.id);
      let base = r.size;
      if (r.from && lakes.has(r.from.lake)) base += lakeIn(r.from.lake, seen) / (outLake.get(r.from.lake) || [r]).length;
      let t = base;
      const ev = [];
      for (const trib of into.get(r.id) || []) {
        const add = total(trib, seen);
        ev.push({ s: this._rvProject(r, trib.joins.x, trib.joins.y).s, add, from: trib.id });
        t += add;
      }
      ev.sort((a, b) => a.s - b.s);
      out[r.id] = { total: t, base, events: ev, done: true };
      seen.delete(r.id);
      return t;
    };
    rs.forEach((r) => total(r, new Set()));
    for (const id of lakes.keys()) lakeIn(id, new Set());
    this._lkFlow = lakeOut;
    this._rvFlow = out; this._rvFlowN = rs.length + "/" + (this.lakes || []).length;
    return out;
  };
  /** { in, outs }: what flows into a lake, and how many rivers leave it. */
  P.lakeFlow = function (id) { this.riverFlows(); return (this._lkFlow || {})[id] || { in: 0, outs: 0 }; };
  /** A flow for showing: whole numbers as they are, shares of a lake split between outflows to one decimal. */
  P.flowText = function (v) { return Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toLocaleString(); };
  /** Length along a river (map pixels) from its source to position s (segment + fraction; default: the mouth). */
  P._rvLen = function (r, s) {
    const W = this.imgW, H = this.imgH, end = s == null ? r.points.length - 1 : s;
    let L = 0;
    for (let k = 0; k + 1 < r.points.length && k < end; k++) {
      const a = r.points[k], b = r.points[k + 1], t = Math.min(1, end - k);
      L += Math.hypot((b.x - a.x) * W, (b.y - a.y) * H) * t;
    }
    return L;
  };
  /**
   * { own, longest } in map pixels: the river's own length, and the longest way water can flow to its
   * mouth from any source upstream (through its tributaries, and theirs): a tributary counts with the
   * stretch of this river below where it joins.
   */
  P.riverLength = function (r) {
    const memo = new Map(), byInto = new Map();
    for (const t of this.rivers || []) if (t.joins) (byInto.get(t.joins.river) || byInto.set(t.joins.river, []).get(t.joins.river)).push(t);
    const longest = (x, seen) => {
      if (memo.has(x.id)) return memo.get(x.id);
      if (seen.has(x.id)) return this._rvLen(x);
      seen.add(x.id);
      const total = this._rvLen(x);
      let best = total;
      for (const t of byInto.get(x.id) || []) {
        const below = total - this._rvLen(x, this._rvProject(x, t.joins.x, t.joins.y).s);
        best = Math.max(best, longest(t, seen) + below);
      }
      seen.delete(x.id);
      memo.set(x.id, best);
      return best;
    };
    return { own: this._rvLen(r), longest: longest(r, new Set()) };
  };
  /** The flow at position s along a river. */
  P._rvFlowAt = function (r, s) {
    const f = this.riverFlows()[r.id];
    let v = f.base;
    for (const e of f.events) if (e.s <= s + 1e-9) v += e.add;
    return v;
  };
  // ── the current (km/h) ──
  // A river's own water flows at its own speed: set by hand (speed), or worked out from how steeply it falls
  // along its course in the height map. Where a tributary runs in, its water keeps the speed it had at its
  // mouth, and the river below flows at the average of all the water in it, weighted by how much there is of
  // each (a size 1 river at 5 km/h into a size 20 at 2: (1 × 5 + 20 × 2) / 21 ≈ 2.1). A river out of a lake
  // starts calm: its water, the lake's share included, flows at its own speed.
  // km/h = 1 + 4 × √(fall in %): flat 1, 0.5 % ≈ 3.8, 2 % ≈ 6.7, 5 % ≈ 9.9, 10 % ≈ 13.6 (at most 20). On
  // Mundana that puts half the rivers' stretches below about 4 km/h and a tenth above about 9.
  const CUR_MIN = 1, CUR_BASE = 1, CUR_PER_ROOT = 4, CUR_MAX = 20, CUR_WIN = 40;   // km/h; km either side
  /** The current a river falling this steeply (% over about 80 km) would have: 1 km/h flat … 20 at most. */
  const currentForSlope = (pct) => clamp(CUR_BASE + CUR_PER_ROOT * Math.sqrt(Math.max(0, pct)), CUR_MIN, CUR_MAX);
  P.currentForSlope = currentForSlope;
  /** Each river's own speed for each of its segments (km/h): { [id]: [km/h per segment] }. */
  P._rvOwnSpeeds = function () {
    // worked out again whenever the rivers change (the flows are) or the height map does
    const HG = this.heightGrid ? this.heightGrid() : null, F = this.riverFlows(), key = HG ? HG.key : "-";
    if (this._rvOwn && this._rvOwnKey === key && this._rvOwnF === F) return this._rvOwn;
    const W = this.imgW, H = this.imgH, kmpx = this.kmPerMapPx ? this.kmPerMapPx() : 5, out = {};
    for (const r of this.rivers || []) {
      const P = r.points || [], n = Math.max(0, P.length - 1);
      if (r.speed != null || !HG || n === 0) { out[r.id] = new Array(n).fill(r.speed != null ? r.speed : CUR_BASE); continue; }
      // the course every map pixel, with its height and distance from the source
      const d = [0], h = [];
      const pts = [];
      for (let k = 0; k < n; k++) {
        const a = P[k], b = P[k + 1], L = Math.hypot((b.x - a.x) * W, (b.y - a.y) * H), m = Math.max(1, Math.ceil(L));
        for (let t = k ? 1 : 0; t <= m; t++) pts.push([a.x + (b.x - a.x) * t / m, a.y + (b.y - a.y) * t / m, k + t / m]);
      }
      for (let i = 0; i < pts.length; i++) {
        if (i) d.push(d[i - 1] + Math.hypot((pts[i][0] - pts[i - 1][0]) * W, (pts[i][1] - pts[i - 1][1]) * H) * kmpx);
        h.push(Math.max(0, this.groundM(pts[i][0], pts[i][1], HG)));
      }
      // the fall over CUR_WIN km either side of each segment's middle
      const sp = [];
      for (let k = 0; k < n; k++) {
        let mid = 0;
        while (mid + 1 < pts.length && pts[mid][2] < k + 0.5) mid++;
        let a = mid, b = mid;
        while (a > 0 && d[mid] - d[a - 1] <= CUR_WIN) a--;
        while (b + 1 < pts.length && d[b + 1] - d[mid] <= CUR_WIN) b++;
        const run = d[b] - d[a];
        sp.push(currentForSlope(run > 0 ? Math.max(0, h[a] - h[b]) / (run * 1000) * 100 : 0));
      }
      out[r.id] = sp;
    }
    this._rvOwn = out; this._rvOwnKey = key; this._rvOwnF = F;
    return out;
  };
  /** The current (km/h) at position s along a river (segment + fraction), with the tributaries' water mixed in. */
  P.currentAt = function (r, s) {
    const F = this.riverFlows(), own = this._rvOwnSpeeds();
    if (this._rvCur && this._rvCurOwn === own && this._rvCurF === F) { /* cached mouths */ } else { this._rvCur = new Map(); this._rvCurOwn = own; this._rvCurF = F; }
    const f = F[r.id], sp = own[r.id] || [CUR_BASE];
    const seg = clamp(Math.floor(s), 0, sp.length - 1);
    let water = f.base, sum = f.base * sp[seg];
    for (const e of f.events) if (e.s <= s + 1e-9) {
      const t = this._rvById(e.from);
      water += e.add; sum += e.add * (t ? this._rvMouthCurrent(t) : sp[seg]);
    }
    return water > 0 ? sum / water : sp[seg];
  };
  P._rvMouthCurrent = function (r) {
    if (!this._rvCur) this._rvCur = new Map();
    if (this._rvCur.has(r.id)) return this._rvCur.get(r.id);
    this._rvCur.set(r.id, CUR_BASE);                          // (a loop, which shouldn't happen, stops here)
    const v = this.currentAt(r, Math.max(0, r.points.length - 1.5));
    this._rvCur.set(r.id, v);
    return v;
  };
  /** Does river a (eventually) flow into river b? */
  P._rvDrainsInto = function (a, b) { return a !== b && this._rvReaches("r" + a.id, "r" + b.id); };

  // ── drawing ──
  P._rvWidth = function (flow) {
    const z = clamp(Math.sqrt(this.view.s * this.imgW / 1500), 0.6, 3.2);
    return (0.7 + 0.42 * Math.min(flow, 14)) * z;
  };
  P._rvDraw = function () {
    const rs = this.rivers || [], editing = this.editing && this.editMode === "river";
    if (editing && this.rvSuggest) this._rvDrawSuggest();
    if (!rs.length && !this.rvDraft && !(editing && (this.lakes || []).length)) return;
    const ctx = this.ctx, flows = this.riverFlows();
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // each river in pieces between its junctions, wider downstream
    const pieces = [];
    rs.forEach((r) => {
      if (r.points.length < 2) return;
      const f = flows[r.id];
      const cuts = [0, ...f.events.map((e) => e.s), r.points.length - 1];
      for (let c = 0; c + 1 < cuts.length; c++) {
        const s0 = cuts[c], s1 = cuts[c + 1];
        if (s1 - s0 < 1e-6) continue;
        const pts = [this._rvAt(r, s0)];
        for (let k = Math.floor(s0) + 1; k < s1; k++) pts.push(r.points[k]);
        pts.push(this._rvAt(r, s1));
        pieces.push({ r, pts, flow: this._rvFlowAt(r, s0 + 1e-6) });
      }
    });
    for (const pass of [0, 1]) {
      for (const pc of pieces) {
        const sel = editing && this.rvSel === pc.r.id;
        ctx.beginPath();
        pc.pts.forEach((p, i) => { const [x, y] = this.toScreen(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        const w = this._rvWidth(pc.flow);
        if (pass === 0) { ctx.strokeStyle = sel ? "rgba(255,224,138,0.95)" : "rgba(12,32,52,0.55)"; ctx.lineWidth = w + (sel ? 4 : 2); }
        else { ctx.strokeStyle = "#4f9fe3"; ctx.lineWidth = w; }
        ctx.stroke();
      }
    }
    if (editing) {
      // flow numbers, sources, mouths, and the chosen river's points and direction
      ctx.font = "600 11px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      rs.forEach((r) => {
        if (r.points.length < 2) return;
        const [sx, sy] = this.toScreen(r.points[0].x, r.points[0].y);
        ctx.fillStyle = "#cfe8ff"; ctx.strokeStyle = "#18212a"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        // the size at the mouth (all that flows out there), just past the river's last point
        const n = r.points.length, m1 = r.points[n - 1], m0 = r.points[n - 2];
        const [ex, ey] = this.toScreen(m1.x, m1.y), [px, py] = this.toScreen(m0.x, m0.y);
        const dl = Math.hypot(ex - px, ey - py) || 1, label = this.flowText(flows[r.id].total);
        const lw = Math.max(16, ctx.measureText(label).width + 8);
        const off = 12 + lw / 4, mx = ex + (ex - px) / dl * off, my = ey + (ey - py) / dl * off;
        ctx.fillStyle = "rgba(24,33,42,0.88)"; ctx.fillRect(mx - lw / 2, my - 8, lw, 15);
        ctx.strokeStyle = "#4f9fe3"; ctx.lineWidth = 1; ctx.strokeRect(mx - lw / 2 + 0.5, my - 7.5, lw - 1, 14);
        ctx.fillStyle = "#cfe8ff"; ctx.fillText(label, mx, my);
      });
      this._lkDraw();
      const r = this._rvById(this.rvSel);
      if (r) {
        this._rvArrows(r);
        r.points.forEach((p, i) => {
          const [x, y] = this.toScreen(p.x, p.y);
          ctx.fillStyle = i === r.points.length - 1 && r.joins ? "#ffe08a" : "#fff"; ctx.strokeStyle = "#18212a"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(x, y, i === 0 ? 5.5 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        });
      }
    }
    // the river being drawn, and where it would join
    const D = this.rvDraft, DP = this._rvDraftPoints();
    if (editing && D && DP.length) {
      ctx.setLineDash([6, 4]); ctx.strokeStyle = "#ffe08a"; ctx.lineWidth = 2;
      ctx.beginPath();
      DP.forEach((p, i) => { const [x, y] = this.toScreen(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      if (D.hover) { const [x, y] = this.toScreen(D.hover.x, D.hover.y); ctx.lineTo(x, y); }
      ctx.stroke(); ctx.setLineDash([]);
      DP.forEach((p, i) => { const [x, y] = this.toScreen(p.x, p.y); ctx.fillStyle = "#ffe08a"; ctx.strokeStyle = "#18212a"; ctx.beginPath(); ctx.arc(x, y, i ? 3.5 : 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
    }
    if (editing && this._rvSnap) {
      const [x, y] = this.toScreen(this._rvSnap.x, this._rvSnap.y);
      ctx.strokeStyle = "#ffe08a"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  };
  /** Lakes (edit mode): a blue disc, what flows in beside it, and the name. */
  P._lkDraw = function () {
    const ctx = this.ctx;
    ctx.font = "600 11px system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    for (const l of this.lakes || []) {
      const [x, y] = this.toScreen(l.x, l.y), sel = this.lkSel === l.id, F = this.lakeFlow(l.id);
      ctx.fillStyle = "#2a74c4"; ctx.strokeStyle = sel ? "#ffe08a" : "#e8f3ff"; ctx.lineWidth = sel ? 3 : 2;
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "#e8f3ff"; ctx.lineWidth = 1.2;                 // waves
      for (const dy of [-2, 2]) { ctx.beginPath(); ctx.moveTo(x - 4.5, y + dy); ctx.quadraticCurveTo(x - 2.2, y + dy - 2, x, y + dy); ctx.quadraticCurveTo(x + 2.2, y + dy + 2, x + 4.5, y + dy); ctx.stroke(); }
      const label = (l.name ? l.name + " · " : "") + this.flowText(F.in) + (F.outs ? " →" : " ⊘");
      const lw = ctx.measureText(label).width + 8;
      ctx.fillStyle = "rgba(24,33,42,0.88)"; ctx.fillRect(x + 12, y - 8, lw, 15);
      ctx.fillStyle = "#cfe8ff"; ctx.fillText(label, x + 16, y);
    }
    if (this.lkPlacing && this._lkHover) {
      const [x, y] = this.toScreen(this._lkHover.x, this._lkHover.y);
      ctx.setLineDash([3, 3]); ctx.strokeStyle = "#ffe08a"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
  };
  /** The suggested rivers (set with rvSetSuggest): dashed orange, wider where more water gathers. */
  P._rvDrawSuggest = function () {
    const ctx = this.ctx, list = this.rvSuggest, z = clamp(Math.sqrt(this.view.s * this.imgW / 1500), 0.6, 3.2);
    const [vx0, vy0] = this.toMap(0, 0), [vx1, vy1] = this.toMap(this.cssW, this.cssH);
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const pass of [0, 1]) {
      for (let c = 1; c <= 5; c++) {
        ctx.beginPath();
        for (const pc of list) {
          if (pc.cls !== c) continue;
          const p = pc.pts;
          if (pc.x1 < vx0 || pc.x0 > vx1 || pc.y1 < vy0 || pc.y0 > vy1) continue;
          for (let q = 0; q < p.length; q += 2) { const [x, y] = this.toScreen(p[q], p[q + 1]); q ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        }
        const w = (0.6 + 0.45 * c) * z;
        // dashed, so a suggestion never passes for a drawn river or a border
        ctx.setLineDash(pass === 0 ? [] : [Math.max(4, 3 * w), Math.max(3, 2 * w)]);
        if (pass === 0) { ctx.strokeStyle = "rgba(40,20,0,0.55)"; ctx.lineWidth = w + 2.5; }
        else { ctx.strokeStyle = "rgba(255,170,40,0.95)"; ctx.lineWidth = w; }
        ctx.stroke();
      }
    }
    ctx.restore();
  };
  /** Shows suggested rivers (pieces from EonTerrain.suggestRivers), or none. Changes nothing else. */
  P.rvSetSuggest = function (list) {
    if (list) for (const pc of list) {
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (let q = 0; q < pc.pts.length; q += 2) { x0 = Math.min(x0, pc.pts[q]); x1 = Math.max(x1, pc.pts[q]); y0 = Math.min(y0, pc.pts[q + 1]); y1 = Math.max(y1, pc.pts[q + 1]); }
      Object.assign(pc, { x0, y0, x1, y1 });
    }
    this.rvSuggest = list || null;
    this.draw();
  };
  /** The point at position s (segment + fraction) along a river. */
  P._rvAt = function (r, s) {
    const k = clamp(Math.floor(s), 0, r.points.length - 2), t = clamp(s - k, 0, 1), a = r.points[k], b = r.points[k + 1];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  P._rvArrows = function (r) {
    const ctx = this.ctx;
    ctx.fillStyle = "#ffe08a";
    for (let k = 0; k + 1 < r.points.length; k++) {
      const [ax, ay] = this.toScreen(r.points[k].x, r.points[k].y), [bx, by] = this.toScreen(r.points[k + 1].x, r.points[k + 1].y);
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 24) continue;
      const ux = (bx - ax) / L, uy = (by - ay) / L;
      for (let d = Math.min(L / 2, 45); d < L - 10; d += 90) {
        const x = ax + ux * d, y = ay + uy * d;
        ctx.beginPath();
        ctx.moveTo(x + ux * 6, y + uy * 6); ctx.lineTo(x - ux * 4 - uy * 4.5, y - uy * 4 + ux * 4.5); ctx.lineTo(x - ux * 4 + uy * 4.5, y - uy * 4 - ux * 4.5);
        ctx.closePath(); ctx.fill();
      }
    }
  };
  // ── finding things under the pointer (screen px) ──
  P._rvHitPoint = function (sx, sy) {
    const r = this._rvById(this.rvSel);
    if (!r) return null;
    let best = null, bd = HIT + 2;
    r.points.forEach((p, i) => { const [x, y] = this.toScreen(p.x, p.y); const d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = { r, i }; } });
    return best;
  };
  /** The river line nearest a screen point (within px), with the spot on it. */
  P._rvHitLine = function (sx, sy, px, skip) {
    let best = null;
    for (const r of this.rivers || []) {
      if (r === skip || r.points.length < 2) continue;
      for (let k = 0; k + 1 < r.points.length; k++) {
        const [ax, ay] = this.toScreen(r.points[k].x, r.points[k].y), [bx, by] = this.toScreen(r.points[k + 1].x, r.points[k + 1].y);
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
        const t = L ? clamp(((sx - ax) * dx + (sy - ay) * dy) / L, 0, 1) : 0;
        const d = Math.hypot(ax + dx * t - sx, ay + dy * t - sy);
        if (d < px && (!best || d < best.d)) best = { r, k, t, d, at: this.toMap(ax + dx * t, ay + dy * t) };
      }
    }
    return best;
  };
  /** The river under a map point (normalized), for the info box: { river, flow } or null. */
  P.riverAt = function (nx, ny, px = 8) {
    const [sx, sy] = this.toScreen(nx, ny), h = this._rvHitLine(sx, sy, px, null);
    if (!h) return null;
    return { river: h.r, flow: this._rvFlowAt(h.r, h.k + h.t) };
  };

  // ── editing ──
  P.rvSelect = function (id) { this.rvSel = id; if (id != null) this.lkSel = null; this._rvFlow = null; this.opts.onRiverSelected && this.opts.onRiverSelected(this._rvById(id)); this.draw(); };
  P.lkSelect = function (id) { this.rvSel = null; this.lkSel = id; this.opts.onRiverSelected && this.opts.onRiverSelected(null); this.draw(); };
  P.rvNew = function () { this.rvDraft = null; this._rvSnap = null; this.lkPlacing = false; this.lkSel = null; this.rvSelect(null); };
  /** The next click on the map puts a lake there. */
  P.lkNew = function () { this.rvDraft = null; this._rvSnap = null; this.rvSel = null; this.lkSel = null; this.lkPlacing = true; this.opts.onRiverSelected && this.opts.onRiverSelected(null); this.draw(); };
  /** Starts drawing a river out of the chosen lake (its outflow). */
  P.lkOutflow = function () {
    const l = this._lkById(this.lkSel);
    if (!l) return false;
    this.rvDraft = { points: [{ x: l.x, y: l.y }], from: l.id, hover: null };
    this.opts.onRiverSelected && this.opts.onRiverSelected(null);
    this.draw();
    return true;
  };
  P._lkHit = function (sx, sy) {
    let best = null, bd = 11;
    for (const l of this.lakes || []) { const [x, y] = this.toScreen(l.x, l.y), d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = l; } }
    return best;
  };
  /** Moves a lake, and the ends of the rivers running into and out of it. */
  P._lkMove = function (l, x, y) {
    l.x = clamp(x, 0, 1); l.y = clamp(y, 0, 1);
    for (const r of this.rivers || []) {
      if (r.joins && r.joins.lake === l.id) { r.joins.x = l.x; r.joins.y = l.y; r.points[r.points.length - 1] = { x: l.x, y: l.y }; }
      if (r.from && r.from.lake === l.id) r.points[0] = { x: l.x, y: l.y };
    }
  };
  /** The chosen river's own current (km/h), or null: worked out from the height map. */
  P.rvSetSpeed = function (v) {
    const r = this._rvById(this.rvSel);
    if (!r) return;
    r.speed = v === null || v === "" || !Number.isFinite(+v) ? null : clamp(+v, 0, 30);
    this._rvCur = null;
    this._rvChanged();
  };
  P.rvSetSize = function (v) { const r = this._rvById(this.rvSel); this.rvNextSize = clamp(Math.round(v) || 1, 1, 10); if (r) { r.size = this.rvNextSize; this._rvChanged(); } };
  P.rvSetName = function (v) {
    const r = this._rvById(this.rvSel) || this._lkById(this.lkSel);
    if (r) { r.name = String(v).slice(0, 100); this._rvChanged(); }
  };
  P.rvDelete = function () {
    const l = this._lkById(this.lkSel);
    if (l) {
      // the rivers stay: those running into it now end there, those out of it start there
      this.lakes = this.lakes.filter((x) => x !== l);
      for (const t of this.rivers || []) { if (t.joins && t.joins.lake === l.id) t.joins = null; if (t.from && t.from.lake === l.id) t.from = null; }
      this.lkSelect(null);
      this._rvChanged();
      return;
    }
    const r = this._rvById(this.rvSel);
    if (!r) return;
    this.rivers = this.rivers.filter((x) => x !== r);
    this.rivers.forEach((x) => { if (x.joins && x.joins.river === r.id) x.joins = null; });   // its tributaries now end where they are
    this.rvSelect(null);
    this._rvChanged();
  };
  /** Finishes the river being drawn: it ends where it is (in the sea or a lake) or on the river it was snapped to. */
  P.rvFinish = function (snap) {
    const D = this.rvDraft;
    this.rvDraft = null; this._rvSnap = null;
    if (!D) return false;
    // snap: { r, at } a river to join, or { lake } a lake to end in (or, carrying on upstream, to start from)
    const lk = snap && snap.lake;
    if (D.extend != null) {                                   // carrying on from an end of an existing river
      const r = this._rvById(D.extend);
      if (!r) { this.draw(); return false; }
      if (!D.points.length && !snap) { this.rvSelect(r.id); return false; }   // nothing drawn: the river stays as it was
      if (D.end === "tail") {
        // the mouth moves on: it joins the river (or lake) clicked last, or ends where the drawing ended
        r.points.push(...D.points);
        if (lk) { r.points.push({ x: lk.x, y: lk.y }); r.joins = { lake: lk.id, x: lk.x, y: lk.y }; }
        else if (snap) { r.points.push({ x: snap.at[0], y: snap.at[1] }); r.joins = { river: snap.r.id, x: snap.at[0], y: snap.at[1] }; }
        else r.joins = null;
      } else {
        // the source moves up: out of the lake clicked last, or where the drawing ended
        r.points.unshift(...D.points.reverse());
        if (lk) { r.points.unshift({ x: lk.x, y: lk.y }); r.from = { lake: lk.id }; }
        else r.from = null;
      }
      this.rvSelect(r.id);
      this._rvChanged();
      return true;
    }
    if (lk) D.points.push({ x: lk.x, y: lk.y });
    else if (snap) D.points.push({ x: snap.at[0], y: snap.at[1] });
    if (D.points.length < 2) { this.draw(); return false; }
    const r = { id: this._rvNewId(), name: "", size: this.rvNextSize || 1, points: D.points,
      joins: lk ? { lake: lk.id, x: lk.x, y: lk.y } : snap ? { river: snap.r.id, x: snap.at[0], y: snap.at[1] } : null,
      from: D.from != null && this._lkById(D.from) ? { lake: D.from } : null };
    this.rivers = this.rivers || [];
    this.rivers.push(r);
    this.rvSelect(r.id);
    this._rvChanged();
    return true;
  };
  P.rvCancel = function () {
    if (this.lkPlacing) { this.lkPlacing = false; this._lkHover = null; this.draw(); return true; }
    if (this.lkSel != null) { this.lkSelect(null); return true; }
    if (this.rvDraft) { this.rvDraft = null; this._rvSnap = null; this.draw(); return true; }   // nothing was changed yet
    if (this.rvSel != null) { this.rvSelect(null); return true; }
    return false;
  };
  P.rvDrafting = function () { return !!this.rvDraft; };
  /** Carries on drawing the chosen river from its mouth ("tail") or upstream from its source ("head"). */
  P.rvExtend = function (end = "tail") {
    const r = this._rvById(this.rvSel);
    if (!r) return false;
    // the river itself only changes when the new stretch is finished (rvFinish); until then it keeps
    // its mouth and junction, so cancelling, or leaving the edit mode, changes nothing
    this.rvDraft = { extend: r.id, end, points: [], hover: null };
    this._rvSnap = null;
    this.opts.onRiverSelected && this.opts.onRiverSelected(r);
    this.draw();
    return true;
  };
  /** Where the line being drawn starts: the river's end when carrying on, otherwise the first click. */
  P._rvDraftPoints = function () {
    const D = this.rvDraft;
    if (!D) return [];
    if (D.extend == null) return D.points;
    const r = this._rvById(D.extend);
    if (!r) return D.points;
    return [D.end === "tail" ? r.points[r.points.length - 1] : r.points[0], ...D.points];
  };
  /** Press: grabs a point of the chosen river to drag it (returns true), otherwise the press pans or clicks. */
  P.rvPointerDown = function (sx, sy) {
    if (this.rvDraft || this.lkPlacing) return false;
    const l = this._lkHit(sx, sy);
    if (l) { this._lkDrag = { l, sx, sy, moved: false }; return true; }
    const h = this._rvHitPoint(sx, sy);
    if (!h) return false;
    this._rvDrag = { ...h, sx, sy, moved: false };
    return true;
  };
  P.rvPointerMove = function (sx, sy) {
    const [nx, ny] = this.toMap(sx, sy);
    if (this.lkPlacing) { this._lkHover = { x: nx, y: ny }; this.draw(); return; }
    if (this._lkDrag) {
      if (!this._lkDrag.moved && Math.hypot(sx - this._lkDrag.sx, sy - this._lkDrag.sy) < 4) return;
      this._lkDrag.moved = true;
      this._lkMove(this._lkDrag.l, nx, ny);
      this.draw();
      return;
    }
    if (this._rvDrag) {
      if (!this._rvDrag.moved && Math.hypot(sx - this._rvDrag.sx, sy - this._rvDrag.sy) < 4) return;
      this._rvDrag.moved = true;
      const { r, i } = this._rvDrag, p = r.points[i];
      p.x = clamp(nx, 0, 1); p.y = clamp(ny, 0, 1);
      // the mouth can be dropped onto another river (not one upstream of it) or into a lake, and the
      // source into a lake (its outflow)
      this._rvSnapLake = null;
      const l = (i === 0 || i === r.points.length - 1) ? this._lkHit(sx, sy) : null;
      if (l && (i === 0 ? this._rvCanLeaveLake(r, l) && !(r.joins && r.joins.lake === l.id) : this._rvCanEnterLake(r, l) && !(r.from && r.from.lake === l.id))) {
        this._rvSnapLake = l; this._rvSnap = { x: l.x, y: l.y }; this._rvSnapHit = null;
      } else if (i === r.points.length - 1) {
        const h = this._rvHitLine(sx, sy, SNAP, r);
        this._rvSnap = h && this._rvCanJoin(r, h.r) ? { x: h.at[0], y: h.at[1] } : null;
        this._rvSnapHit = this._rvSnap ? h : null;
      } else this._rvSnap = null;
      this._rvFlow = null;
      this.draw();
      return;
    }
    if (this.rvDraft) {
      this.rvDraft.hover = { x: nx, y: ny };
      const lk = this._rvDraftLake(sx, sy), h = lk ? null : this._rvDraftSnap(sx, sy);
      this._rvSnap = lk ? { x: lk.x, y: lk.y } : h ? { x: h.at[0], y: h.at[1] } : null;
      this.draw();
    }
  };
  P.rvPointerUp = function () {
    const K = this._lkDrag;
    this._lkDrag = null;
    if (K) {
      if (K.moved) { this._rvChanged(); return; }
      // a click on a lake chooses it; on the chosen lake, starts its outflow
      if (this.lkSel === K.l.id) this.lkOutflow(); else this.lkSelect(K.l.id);
      return;
    }
    const D = this._rvDrag;
    this._rvDrag = null;
    if (!D) return;
    const { r, i } = D;
    if (!D.moved) {
      // a click (no drag) on the source or the mouth: carry on drawing from there
      if (i === r.points.length - 1) this.rvExtend("tail");
      else if (i === 0) this.rvExtend("head");
      return;
    }
    const L = this._rvSnapLake;
    if (i === r.points.length - 1) {
      const h = this._rvSnapHit;
      if (L) { r.points[i] = { x: L.x, y: L.y }; r.joins = { lake: L.id, x: L.x, y: L.y }; }
      else if (h) { r.points[i] = { x: h.at[0], y: h.at[1] }; r.joins = { river: h.r.id, x: h.at[0], y: h.at[1] }; }
      else r.joins = null;
    } else if (i === 0) {
      // a river's source moved: out of the lake it was dropped in, or none
      if (L) { r.points[0] = { x: L.x, y: L.y }; r.from = { lake: L.id }; }
      else r.from = null;
    }
    this._rvSnap = null; this._rvSnapHit = null; this._rvSnapLake = null;
    // anything joining this river keeps its junction on the new line
    (this.rivers || []).forEach((t) => {
      if (t.joins && t.joins.river === r.id) {
        const pr = this._rvProject(r, t.joins.x, t.joins.y), at = this._rvAt(r, pr.s);
        t.joins.x = at.x; t.joins.y = at.y; t.points[t.points.length - 1] = { x: at.x, y: at.y };
      }
    });
    this._rvChanged();
  };
  /** The river a click would join while drawing (new rivers and mouths carried on; not upstream ones, not itself). */
  P._rvDraftSnap = function (sx, sy) {
    const D = this.rvDraft;
    if (!D) return null;
    if (D.extend == null) {
      if (!D.points.length) return null;
      const h = this._rvHitLine(sx, sy, SNAP, null);
      // out of a lake: not into a river that runs (on) into that same lake
      return h && (D.from == null || !this._rvReaches("r" + h.r.id, "l" + D.from)) ? h : null;
    }
    if (D.end !== "tail") return null;
    const r = this._rvById(D.extend);
    const h = this._rvHitLine(sx, sy, SNAP, r);
    return h && this._rvCanJoin(r, h.r) ? h : null;
  };
  /** The lake a click would end the drawing in (or, carrying on upstream, start it from). */
  P._rvDraftLake = function (sx, sy) {
    const D = this.rvDraft, l = D && this._lkHit(sx, sy);
    if (!l) return null;
    if (D.extend == null) return D.points.length && D.from !== l.id && (D.from == null || !this._rvReaches("l" + l.id, "l" + D.from)) ? l : null;
    const r = this._rvById(D.extend);
    if (!r) return null;
    if (D.end === "tail") return this._rvCanEnterLake(r, l) && !(r.from && r.from.lake === l.id) ? l : null;
    return this._rvCanLeaveLake(r, l) && !(r.joins && r.joins.lake === l.id) ? l : null;
  };
  /** A click (not a drag) in river mode. */
  P.rvClick = function (nx, ny, sx, sy) {
    const now = performance.now();
    const dbl = this._rvLastClick && now - this._rvLastClick.t < 380 && Math.hypot(sx - this._rvLastClick.x, sy - this._rvLastClick.y) < 6;
    this._rvLastClick = { t: now, x: sx, y: sy };
    if (this.lkPlacing) {                                               // a new lake here
      this.lkPlacing = false; this._lkHover = null;
      const l = { id: this._rvNewId(), name: "", x: clamp(nx, 0, 1), y: clamp(ny, 0, 1) };
      this.lakes = this.lakes || [];
      this.lakes.push(l);
      this.lkSelect(l.id);
      this._rvChanged();
      return;
    }
    if (this.rvDraft) {
      if (dbl) { this.rvFinish(null); return; }                       // double-click: ends here
      const lk = this._rvDraftLake(sx, sy);
      if (lk) { this.rvFinish({ lake: lk }); return; }                 // on a lake: runs into it (or out of it)
      const h = this._rvDraftSnap(sx, sy);
      if (h) { this.rvFinish(h); return; }                            // on another river: joins it
      this.rvDraft.points.push({ x: nx, y: ny });
      this.draw();
      return;
    }
    if (this.lkSel != null) { this.lkSelect(null); return; }           // let go of the chosen lake
    const sel = this._rvById(this.rvSel);
    if (sel) {
      // on the chosen river's line: a new point there
      const h = this._rvHitLine(sx, sy, HIT, null);
      if (h && h.r === sel) {
        sel.points.splice(h.k + 1, 0, { x: h.at[0], y: h.at[1] });
        this._rvChanged();
        return;
      }
    }
    const h = this._rvHitLine(sx, sy, HIT, null);
    if (h) { this.rvSelect(h.r.id); return; }                          // a river: choose it
    if (sel) { this.rvSelect(null); return; }                           // empty ground: let go of the chosen one
    this.rvDraft = { points: [{ x: nx, y: ny }], hover: null };          // empty ground: a new river starts here
    this.draw();
  };
  /** Right-click: the chosen river's point under the pointer goes (a river needs two). */
  P.rvContextMenu = function (sx, sy) {
    if (this.rvDraft) {
      this.rvDraft.points.pop();
      if (!this.rvDraft.points.length && this.rvDraft.extend == null) this.rvDraft = null;
      this.draw(); return;
    }
    const h = this._rvHitPoint(sx, sy);
    if (!h) return;
    const { r, i } = h;
    if (r.points.length <= 2) return;
    r.points.splice(i, 1);
    if (i === r.points.length && r.joins) r.joins = null;   // the mouth went: it no longer joins
    if (i === 0 && r.from) r.from = null;                   // the source went: it no longer leaves the lake
    this._rvChanged();
  };
})();
