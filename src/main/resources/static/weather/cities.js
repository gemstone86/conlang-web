// Also bridges and fords (kind "bridge" / "ford"): placed on a river, they let a journey cross it there without
// fording; a ford only outside its flood months (floodFrom–floodTo, 0 = never flooded).
// Eon Weather – cities: a place with a name, a population and (or not) a harbour. A city joins the roads that
// pass through it, and a road ended on a city joins the city (roads.js snaps to the cities here). Only a city
// with a harbour lets a sea voyage start (travel.js). Edited under Redigera → Städer; saved like the roads.
(function () {
  "use strict";
  const FM = window.FieldMap;
  if (!FM) return;
  const P = FM.prototype;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const HIT = 11;           // px: how close counts as clicking a city
  const SNAP = 10;          // px: how close to a road a city is placed on it
  const KINDS = ["city", "bridge", "ford"];

  // ── data ──
  P.setCities = function (list) {
    this.cities = (list || []).map((c) => ({ id: c.id, kind: KINDS.includes(c.kind) ? c.kind : "city", name: c.name || "", population: Math.max(0, +c.population || 0), harbour: !!c.harbour,
      floodFrom: clamp(Math.round(+c.floodFrom || 0), 0, 12), floodTo: clamp(Math.round(+c.floodTo || 0), 0, 12), x: c.x, y: c.y }));
    this.ctSel = null; this._ctDrag = null;
    this.draw();
  };
  P.getCities = function () {
    return (this.cities || []).map((c) => ({ id: c.id, kind: c.kind || "city", name: c.name, population: c.kind === "city" ? c.population : 0, harbour: c.kind === "city" && !!c.harbour,
      floodFrom: c.kind === "ford" ? c.floodFrom || 0 : 0, floodTo: c.kind === "ford" ? c.floodTo || 0 : 0, x: +c.x.toFixed(7), y: +c.y.toFixed(7) }));
  };
  P._ctChanged = function () { this.opts.onCitiesChanged && this.opts.onCitiesChanged(); this.draw(); };
  P._ctById = function (id) { return (this.cities || []).find((c) => c.id === id) || null; };
  P._ctNewId = function () { return (this.cities || []).reduce((m, c) => Math.max(m, c.id), 0) + 1; };
  P.ctChosen = function () { return this._ctById(this.ctSel); };
  P.ctSelect = function (id) { this.ctSel = id; this.opts.onCitySelected && this.opts.onCitySelected(this._ctById(id)); this.draw(); };
  /** The city nearest a screen point, within px (the roads snap to it), or null. */
  P._ctNear = function (sx, sy, px = HIT, skipId = null) {
    let best = null, bd = px;
    for (const c of this.cities || []) {
      if (c.id === skipId) continue;
      const [x, y] = this.toScreen(c.x, c.y), d = Math.hypot(x - sx, y - sy);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };
  /** The city under a map point (normalized) for the info box, or null. */
  P.cityAt = function (nx, ny, px = 9) { const [sx, sy] = this.toScreen(nx, ny); return this._ctNear(sx, sy, px); };
  /** A city is placed on a road line close by (so the road passes through it). */
  P._ctSnapToRoad = function (sx, sy, nx, ny, kind) {
    // a bridge or a ford sits on a river; a city on a road
    const h = kind && kind !== "city" ? (this._rvHitLine ? this._rvHitLine(sx, sy, SNAP + 6, null) : null) : this._wyHitLine ? this._wyHitLine(sx, sy, SNAP, null) : null;
    return h ? { x: h.at[0], y: h.at[1], road: true } : { x: clamp(nx, 0, 1), y: clamp(ny, 0, 1), road: false };
  };

  // ── editing ──
  P.ctSetName = function (v) { const c = this.ctChosen(); if (c) { c.name = String(v).slice(0, 100); this._ctChanged(); } };
  P.ctSetPopulation = function (v) { const c = this.ctChosen(); if (c) { c.population = Math.max(0, Math.min(1e9, Math.round(+v) || 0)); this._ctChanged(); } };
  P.ctSetHarbour = function (on) { const c = this.ctChosen(); if (c) { c.harbour = !!on; this._ctChanged(); } };
  P.ctDelete = function () {
    const c = this.ctChosen();
    if (!c) return;
    this.cities = this.cities.filter((x) => x !== c);
    this.ctSelect(null);
    this._ctChanged();
  };
  P.ctNewDefaults = { kind: "city", population: 1000, harbour: false };
  /** A new ford's flood months: the spring thaw, months 3–4 north of the equator (the middle of the map) and 9–10 south of it. */
  P.ctFloodDefault = function (y) { return y > 0.5 ? [9, 10] : [3, 4]; };
  P.ctSetKind = function (k) {
    k = KINDS.includes(k) ? k : "city";
    this.ctNewDefaults.kind = k;
    const c = this.ctChosen();
    if (c && c.kind !== k) { c.kind = k; if (k === "ford" && !c.floodFrom) [c.floodFrom, c.floodTo] = this.ctFloodDefault(c.y); this._ctChanged(); }
  };
  P.ctSetFlood = function (from, to) {
    const c = this.ctChosen(), f = clamp(Math.round(+from || 0), 0, 12), t = clamp(Math.round(+to || 0), 0, 12);
    if (c && c.kind === "ford") { c.floodFrom = f; c.floodTo = t; this._ctChanged(); }
  };
  P.ctPointerDown = function (sx, sy) {
    const c = this._ctNear(sx, sy);
    if (!c) return false;
    this._ctDrag = { c, sx, sy, moved: false };
    if (this.ctSel !== c.id) this.ctSelect(c.id);
    return true;
  };
  P.ctPointerMove = function (sx, sy) {
    const D = this._ctDrag;
    if (!D) return;
    if (!D.moved && Math.hypot(sx - D.sx, sy - D.sy) < 4) return;
    D.moved = true;
    const [nx, ny] = this.toMap(sx, sy), p = this._ctSnapToRoad(sx, sy, nx, ny, D.c.kind);
    D.c.x = p.x; D.c.y = p.y;
    this.draw();
  };
  P.ctPointerUp = function () {
    const D = this._ctDrag;
    this._ctDrag = null;
    if (D && D.moved) this._ctChanged();
  };
  /** A click (not a drag) in city mode: on a city it is chosen, on empty ground a new city is placed (on a road line close by). */
  P.ctClick = function (nx, ny, sx, sy) {
    const c = this._ctNear(sx, sy);
    if (c) { this.ctSelect(c.id); return; }
    const kind = this.ctNewDefaults.kind || "city", p = this._ctSnapToRoad(sx, sy, nx, ny, kind);
    const n = { id: this._ctNewId(), kind, name: "", population: kind === "city" ? this.ctNewDefaults.population : 0, harbour: kind === "city" && this.ctNewDefaults.harbour,
      floodFrom: kind === "ford" ? this.ctFloodDefault(p.y)[0] : 0, floodTo: kind === "ford" ? this.ctFloodDefault(p.y)[1] : 0, x: p.x, y: p.y };
    this.cities = this.cities || [];
    this.cities.push(n);
    this.ctSelect(n.id);
    this._ctChanged();
  };
  P.ctCancel = function () { if (this.ctSel != null) { this.ctSelect(null); return true; } return false; };

  // ── drawing ──
  /** The disc's radius (screen px at zoom z) from the population. */
  const radius = (pop, z) => clamp(2.6 + Math.log10(Math.max(10, pop)) * 1.15, 3.5, 9.5) * z;
  P._ctDraw = function () {
    const list = this.cities || [], editing = this.editing && this.editMode === "city";
    if (!list.length) return;
    const ctx = this.ctx, z = clamp(Math.sqrt(this.view.s * this.imgW / 1500), 0.7, 2);
    const labels = this.view.s * this.imgW > 2600;                       // zoomed in: every name; otherwise the larger cities'
    ctx.save();
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.font = `${Math.round(11 * clamp(z, 0.85, 1.4))}px sans-serif`;
    const big = list.slice().sort((a, b) => a.population - b.population);
    for (const c of big) {
      const [x, y] = this.toScreen(c.x, c.y), r = radius(c.population, z), sel = editing && c.id === this.ctSel;
      if (x < -30 || y < -30 || x > this.cssW + 30 || y > this.cssH + 30) continue;
      if (c.kind === "bridge" || c.kind === "ford") {
        // a bridge: a brown plank across; a ford: a pale dashed bar; both in a ring when chosen
        const L = 6.5 * z;
        ctx.lineCap = "butt";
        ctx.strokeStyle = "#1a1410"; ctx.lineWidth = 5.5 * z; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(x - L, y); ctx.lineTo(x + L, y); ctx.stroke();
        ctx.strokeStyle = c.kind === "bridge" ? "#c58b4a" : "#cfe9ff"; ctx.lineWidth = 3 * z; ctx.setLineDash(c.kind === "ford" ? [2.5 * z, 2 * z] : []);
        ctx.beginPath(); ctx.moveTo(x - L + 1, y); ctx.lineTo(x + L - 1, y); ctx.stroke(); ctx.setLineDash([]);
        if (sel) { ctx.strokeStyle = "#ffe08a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, L + 4, 0, Math.PI * 2); ctx.stroke(); }
        if (c.name && (labels || sel)) { ctx.lineWidth = 3; ctx.strokeStyle = "rgba(20,14,8,0.85)"; ctx.strokeText(c.name, x + L + 4, y); ctx.fillStyle = "#fff3d6"; ctx.fillText(c.name, x + L + 4, y); }
        continue;
      }
      if (c.harbour) {                                                    // a harbour: a blue ring round the disc
        ctx.beginPath(); ctx.arc(x, y, r + 3 * z, 0, Math.PI * 2); ctx.strokeStyle = "#3b9cff"; ctx.lineWidth = 2 * z; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = sel ? "#ffe08a" : "#f4efe4"; ctx.fill();
      ctx.strokeStyle = "#1a1410"; ctx.lineWidth = 1.6; ctx.stroke();
      if (r > 5.5) { ctx.beginPath(); ctx.arc(x, y, r * 0.35, 0, Math.PI * 2); ctx.fillStyle = "#1a1410"; ctx.fill(); }
      if (c.name && (labels || c.population >= 20000 || sel)) {
        const tx = x + r + (c.harbour ? 5 * z : 3) + 2;
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(20,14,8,0.85)"; ctx.strokeText(c.name, tx, y);
        ctx.fillStyle = "#fff3d6"; ctx.fillText(c.name, tx, y);
      }
    }
    ctx.restore();
  };
})();
