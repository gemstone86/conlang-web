// Eon Weather – events on journeys (Restid → "Händelser").
//
// A journey with events rolls once in every slot (6 hours), at a random hour inside the slot. The day is
// split into two cycles (day from cycleStart, night 12 hours later); after an event the rest of its cycle is
// quiet. A roll is "a in b", from the rules (world/events.yaml, or the admins' version in the app) and the
// terrain where the party is at that hour: the road, forest, ice, height, steepness, sea or river boat,
// high-magic areas and nations.
//
// The dice are fixed per journey and slot (from the journey's seed), so everyone sees the same events, and
// winding the clock back and forth changes nothing. They are read on the journey as planned, without its
// delays (trip.plan), so each event belongs to a place on the route; a delay moves the coming events on in
// time by its hours, so nothing happens while the party waits and the events come where the party was going
// to be. The owner can look ahead, choose which events pop up, and roll a coming slot again ("Slå om").
(function () {
  "use strict";
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // the rules when there are none from the world or the admins: 1 in 8, no modifiers
  const FALLBACK = { cycleStart: 6, slotHours: 6, base: { day: { a: 1, b: 8 }, night: { a: 1, b: 8 } }, combine: "all", limits: { minB: 2, maxB: 20 }, modifiers: [] };

  // ── dice: a small seeded generator (the same numbers for the same journey and slot) ──
  function hash(...parts) {
    let h = 2166136261 >>> 0;
    for (const p of parts) {
      const s = String(p);
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      h ^= 0x9e37; h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── the rules ──
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);
  const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  /** The rules in force, filled out and checked: the admins' (when they can be read), else the file's, else 1 in 8. */
  function rulesFrom(world) {
    const E = world && world.events, src = E && E.admin && E.admin.rules ? E.admin.rules : E && E.file && E.file.rules ? E.file.rules : FALLBACK;
    const slot = [1, 2, 3, 4, 6, 12].includes(num(src.slotHours, 6)) ? num(src.slotHours, 6) : 6;
    const base = src.base || {};
    const ab = (o, d) => ({ a: num(o && o.a, d.a), b: num(o && o.b, d.b) });
    const R = {
      cycleStart: ((num(src.cycleStart, 6) % 24) + 24) % 24, slotHours: slot,
      base: { day: ab(base.day || base, { a: 1, b: 8 }), night: ab(base.night || base, { a: 1, b: 8 }) },
      combine: src.combine === "first" ? "first" : "all",
      limits: { minB: Math.max(1, num(src.limits && src.limits.minB, 2)), maxB: Math.max(1, num(src.limits && src.limits.maxB, 20)) },
      modifiers: list(src.modifiers).filter((m) => m && typeof m === "object"),
    };
    R.coastKm = Math.min(60, Math.max(0, ...R.modifiers.map((m) => (m.when && m.when.coast != null ? num(m.when.coast, 0) : 0))));
    return R;
  }

  // ── the terrain at a spot ──
  const MODE = (k) => (k === 5 ? "sea" : k === 4 || k === 6 || k === 7 ? "river" : "foot");
  const ROAD = ["none", "path", "road", "highway"];
  function inPoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  /** What a modifier can ask about, at a spot (x, y 0–1) on a stretch of the given kind. */
  function terrainAt(fm, x, y, kind, coastKm) {
    const HG = fm.heightGrid ? fm.heightGrid() : null;
    const t = { travel: MODE(kind), road: MODE(kind) === "foot" ? ROAD[kind] || "none" : "none",
      forest: fm.layerAt ? fm.layerAt("forest", x, y) : 0, ice: fm.layerAt ? fm.layerAt("ice", x, y) : 0,
      height: HG ? Math.max(0, fm.groundM(x, y, HG)) : 0, steep: 0, zones: [], nations: [] };
    if (HG && window.Travel && Travel._steepAt) t.steep = Travel._steepAt(fm, HG, x, y);
    // how far to the shore (km, up to the farthest any rule asks about): from land to the sea, or from the sea to land
    t.coast = Infinity;
    if (HG && coastKm > 0) {
      const wet = fm.groundM(x, y, HG) <= 0, kmpx = fm.kmPerMapPx(), stepKm = Math.max(1, kmpx / 2);
      for (let r = stepKm; r <= coastKm + 1e-9 && t.coast === Infinity; r += stepKm)
        for (let k = 0; k < 16; k++) {
          const ang = k * Math.PI / 8, px = x + Math.cos(ang) * r / kmpx / fm.imgW, py = y + Math.sin(ang) * r / kmpx / fm.imgH;
          if (px < 0 || py < 0 || px > 1 || py > 1) continue;
          if ((fm.groundM(px, py, HG) <= 0) !== wet) { t.coast = r; break; }
        }
    }
    for (const z of fm.zones || []) if (z.points && z.points.length >= 3 && inPoly(x, y, z.points)) t.zones.push(z.aspect);
    for (const n of fm.nations || []) {
      if ((n.parts || []).some((p) => p.length >= 3 && inPoly(x, y, p))) t.nations.push(n.name);
      for (const s of n.subs || []) if ((s.parts || []).some((p) => p.length >= 3 && inPoly(x, y, p))) t.nations.push(s.name);
    }
    return t;
  }
  const lower = (s) => String(s).trim().toLowerCase();
  /** Does a number fit: 50 (at least 50) or { min, max }? */
  function inRange(v, cond) {
    if (cond && typeof cond === "object") return (cond.min == null || v >= +cond.min) && (cond.max == null || v <= +cond.max);
    return v >= num(cond, Infinity);
  }
  function matches(when, t) {
    if (!when || typeof when !== "object") return true;
    for (const [k, c] of Object.entries(when)) {
      switch (k) {
        case "travel": if (!list(c).map(lower).includes(t.travel)) return false; break;
        case "road": if (!list(c).map(lower).includes(t.road)) return false; break;
        case "forest": case "ice": case "height": case "steep": if (!inRange(t[k], c)) return false; break;
        case "zone":
          if (c === true) { if (!t.zones.length) return false; }
          else if (c === false) { if (t.zones.length) return false; }
          else if (!list(c).map(lower).some((a) => t.zones.map(lower).includes(a))) return false;
          break;
        case "nation":
          // "any": inside some nation; "none": outside every nation; else names
          if (lower(c) === "any") { if (!t.nations.length) return false; }
          else if (lower(c) === "none") { if (t.nations.length) return false; }
          else if (!list(c).map(lower).some((a) => t.nations.map(lower).includes(a))) return false;
          break;
        case "coast": if (!(t.coast <= num(c, 0))) return false; break;
        default: return false;                       // something the app doesn't know: never matches (so it is noticed)
      }
    }
    return true;
  }
  /** The chance at a spot: { a, b, names (the modifiers that counted) }. */
  function chance(R, t, night) {
    let { a, b } = R.base[night ? "night" : "day"];
    const names = [];
    for (const m of R.modifiers) {
      if (!matches(m.when, t)) continue;
      const e = m[night ? "night" : "day"] || m.both;
      if (!e) continue;
      if (e.setA != null) a = num(e.setA, a);
      if (e.setB != null) b = num(e.setB, b);
      a += num(e.a, 0); b += num(e.b, 0);
      names.push(String(m.name || "?"));
      if (R.combine === "first") break;
    }
    b = Math.round(clamp(b, R.limits.minB, Math.max(R.limits.minB, R.limits.maxB)));
    a = Math.round(clamp(a, 0, b));
    return { a, b, names };
  }

  // ── a journey's events ──
  /**
   * Every roll of a journey with events, between its departure and its arrival: [{ slot, t (the app's time),
   * night, x, y, a, b, die (1–b), hit, names, cycle }]. Cached until the journey, its rules or the map change.
   */
  function rolls(fm, trip, R, rulesKey) {
    if (!trip.events || !trip.timeline || !trip.route || trip.route.length < 2 || !window.Travel) return [];
    // the journey as planned, without its delays: the events belong to its places, and a delay only moves
    // them on in time (by as much as the party is behind the plan there)
    const plan = trip.plan || trip.timeline;
    const key = [rulesKey, plan.arriveT, trip.timeline.arriveT, trip.timeline.total, (trip.delays || []).length, JSON.stringify(trip.rerolls || {}), trip.seed, fm.zones && fm.zones.length, fm.nations && fm.nations.length].join("|");
    if (trip._ev && trip._evKey === key) return trip._ev;
    const off = (trip.offset || 0), H = R.slotHours, per = 12 / H;
    const localH = (T) => T * 24 + off;                                    // hours since day 0, local time
    const first = Math.floor((localH(trip.startT) - R.cycleStart) / H), last = Math.floor((localH(plan.arriveT) - R.cycleStart) / H);
    const planned = { route: trip.route, startT: trip.startT, timeline: plan };
    // the delays, in order: each moves everything after it on by its hours (one from before 2.16 counted
    // travel hours: about hours × 24 / hours a day)
    const perDay = clamp(+trip.hoursPerDay || 10, 0.5, 24);
    const delays = (trip.delays || []).map((d) => ({ at: d.at, days: Math.max(0, +d.hours || 0) * (d.clock ? 1 : 24 / perDay) / 24 })).sort((a, b) => a.at - b.at);
    const shifted = (t0) => {
      let t = t0;
      for (const d of delays) if (d.at <= t + 1e-9) t += d.days;
      return t;
    };
    const out = [];
    let hitCycle = null;
    for (let s = first; s <= last && out.length < 4000; s++) {
      const cycle = Math.floor(s / per), night = ((cycle % 2) + 2) % 2 === 1;
      const r = rng(hash(trip.seed || 1, s, (trip.rerolls || {})[s] || 0));
      const t = (s * H + R.cycleStart + r() * H - off) / 24, die = 1 + Math.floor(r() * 1000000);
      if (t < trip.startT || t > plan.arriveT) continue;
      const at = Travel._tripAt(planned, t);                               // where it was planned: the terrain
      if (!at) continue;
      const kind = trip.route[Math.min(at.i, trip.route.length - 1)][2] || 0;
      const c = chance(R, terrainAt(fm, at.x, at.y, kind, R.coastKm), night);
      const d = 1 + (die % c.b);                                            // a b-sided die
      const quiet = hitCycle === cycle;                                     // one event per cycle
      const hit = !quiet && d <= c.a;
      if (hit) hitCycle = cycle;
      // when it really happens: moved on by the delays before it; and where the party is then
      const tA = Math.min(shifted(t), trip.timeline.arriveT), now = Travel._tripAt(trip, tA) || at;
      out.push({ slot: s, t: tA, planT: t, km: at.km, night, x: now.x, y: now.y, kind, a: c.a, b: c.b, die: d, hit, quiet, names: c.names, cycle });
    }
    out.sort((a, b) => a.t - b.t);
    trip._ev = out; trip._evKey = key;
    return out;
  }

  const TravelEvents = {
    rules: rulesFrom,
    rolls,
    /** Only the events: the rolls that hit. */
    events(fm, trip, R, key) { return rolls(fm, trip, R, key).filter((e) => e.hit); },
    _chance: chance, _matches: matches, _terrainAt: terrainAt,
  };
  window.TravelEvents = TravelEvents;
})();
