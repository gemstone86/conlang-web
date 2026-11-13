// Eon Weather – the travel calculator (restid): two suggested routes between two points (the fastest and the
// shortest), and journeys that move a token along the chosen route as the app's clock runs.
//
// Speed (km/h) at a spot: the pace (slow/normal/fast: 3/4/5) plus the road's bonus (path +0.5, road +1,
// highway +1.5; none off the roads), minus forest off the road (0.5 per 25 % trees, smoothly), minus bad weather off the road (−1)
// and really bad weather everywhere (−1 more), minus deep snow everywhere (−2: where the date's mean
// temperature at that height is below −2°, fully below −8°, or on painted ice), minus slopes everywhere (1 per 1 % average climb, 0.5 per 1 %
// down; off the roads the ground's own steepness counts too, whichever way it is crossed), below 1 km/h only ever more slowly (a cliff
// stays much slower than hard going). Fording a river off the roads and paths costs 0.25 h per size of the
// river there (its flow, tributaries included); on a road or path the bridge is there. A day has 10 hours of travel from a set hour (local time where the journey
// starts); the rest of the day the token stands still. Delays (försening) take travel hours. All the numbers
// are settings each user can change (the ⚙ in the panel).
//
// By boat, when the journey is allowed it: "Använd färjor" – ferries across the rivers big enough for boats
// (the boarding hours instead of fording) and river boats along them (7.75 km/h in still water, plus half the
// river's current downstream, minus all of it upstream: no way up where less than 1 km/h would be left);
// "Havsresa" – ships at sea (9.9 km/h, 14.8 in a good wind, 4.9 in a bad one, from the weather where the ship
// is), sailing day and night. Getting on board takes an hour.
//
// Routes are found on a grid over the map (a cell every 4 map pixels, about 20 km on Mundana) joined with the
// drawn roads (a point every map pixel): A* by time (Snabbast: the expected weather left out) or by distance
// (Kortast). Water (below the sea level) can't be crossed. A journey keeps its route and how far it has come
// at every hour from the start (worked out once, with the weather of each hour along the way), so anyone
// looking at it later sees the token at the same place for the same time.
(function () {
  "use strict";
  const FM = window.FieldMap;
  if (!FM) return;
  const P = FM.prototype;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // the kind of a stretch: 0 off the roads, 1 path, 2 road, 3 highway, and by boat: 4 river boat downstream,
  // 5 at sea, 6 river boat upstream, 7 across a lake (between rivers)
  const KIND = { off: 0, path: 1, road: 2, highway: 3 }, KIND_NAME = ["off", "path", "road", "highway", "down", "sea", "up", "lake"];
  const RIVER_K = (k) => k === 4 || k === 6 || k === 7;
  /** 0 on foot, 1 river boat, 2 ship at sea: changing to a boat costs the boarding hours. */
  const MODE_OF = (k) => (k === 5 ? 2 : RIVER_K(k) ? 1 : 0);
  const DIRS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
  const CELL = 4;                       // map px per routing grid cell
  const LAPSE = 6.5 / 1000;
  const MODE_COL = { fast: "#ff5fa2", easy: "#5fd38a", short: "#ffb347", safe: "#5fb6ff" }, MODE_TXT = { fast: "trFast", easy: "trEasy", short: "trShort", safe: "trSafe" };
  const COLOURS = ["#e8833a", "#ff5fa2", "#c678dd", "#7bd88f", "#ef6f6c", "#ffd166", "#56c2b6", "#d4a373"];

  const DEFAULTS = {
    pace: { slow: 3, normal: 4, fast: 5 },
    road: { path: 0.5, road: 1, highway: 1.5 },
    offRoad: 0, riverHoursPerSize: 0.25, forestPer25: 0.5, marshPer25: 0.75, bad: 1, veryBad: 1, snow: 2, slopeUp: 1, slopeDown: 0.5, minSpeed: 1,
    badRain: 2, badWind: 14, veryBadRain: 6, veryBadWind: 20,
    hoursPerDay: 10, dayStart: 7, keepDays: 3,
    steep: { path: 5, road: 3, highway: 2 },
    // boats (used when the journey is allowed them): river boats on rivers of at least boatMinFlow (the flow
    // the river map shows), ships at sea; boardHours to get on board (or change boat); a sea voyage sails
    // day and night when seaAllDay is 1; at sea the wind decides: good (behind or on the quarter, at least
    // windGood m/s), bad (against, or below windCalm m/s, or a storm: the really-bad wind), else normal
    // river boats: still-water speed; downstream they get downShare of the current, upstream it is taken off
    // all of it, and below minUp km/h there is no way up (the current: the river's, see rivers.js)
    boat: { still: 7.75, downShare: 0.5, minUp: 1 },
    sea: { normal: 9.9, good: 14.8, bad: 4.9 },
    // how much routes off the roads and rivers wander (1 = normal, 0 = straight, 2 = twice as much)
    wiggle: 1,
    // Säkrast: off the roads the time counts (off + perKm × km from anything civilised, at most max) times as
    // much (nation: inside a nation's borders instead; path: on a path), plus forest × the share of trees;
    // the route is never allowed to take more than maxTimes the time of Snabbast
    safe: { off: 2, perKm: 0.01, max: 6, nation: 1.4, path: 1.2, forest: 0.5, maxTimes: 3 },
    boatMinFlow: 4, boardHours: 1, seaAllDay: 1, windGood: 5, windCalm: 2,
  };
  const copy = (o) => JSON.parse(JSON.stringify(o));
  /**
   * Values saved in the app (an admin's for everyone, or a user's own) before the rules changed: the
   * changed ones take the newer values instead (2.02: steeper slopes; 2.05: road bonuses, no off-road
   * deduction, river fords).
   */
  function upgrade(saved) {
    if (!saved) return saved;
    const v = +saved.v || (saved.v2 ? 2 : 1);
    if (v >= 4) return saved;
    saved = copy(saved);
    if (v < 2) { delete saved.slopeUp; delete saved.slopeDown; }
    if (v < 3) { delete saved.road; delete saved.offRoad; delete saved.riverHoursPerSize; }
    delete saved.boatMinFlow;                 // 2.13: ferries from size 4
    return saved;
  }
  function merge(base, over) {
    const out = copy(base);
    if (over && typeof over === "object") for (const k of Object.keys(out)) {
      if (over[k] == null) continue;
      if (typeof out[k] === "object") for (const j of Object.keys(out[k])) { const v = +over[k][j]; if (Number.isFinite(v)) out[k][j] = v; }
      else { const v = +over[k]; if (Number.isFinite(v)) out[k] = v; }
    }
    return out;
  }

  // ── speed ──
  /** km/h. kind 0 off road … 3 highway; forest 0–1; grade % (+ up); snow 0–1; wx 0 fine, 1 bad, 2 really bad. */
  function speedAt(cfg, pace, kind, forest, grade, snow, wx, marsh) {
    let v = pace + (kind === 3 ? cfg.road.highway : kind === 2 ? cfg.road.road : kind === 1 ? cfg.road.path : 0);
    const road = kind >= 2;
    if (kind === 0) v -= cfg.offRoad;                       // no road or path at all
    if (!road) v -= cfg.forestPer25 * 4 * forest + cfg.marshPer25 * 4 * (marsh || 0);
    if (wx >= 1 && !road) v -= cfg.bad;
    if (wx >= 2) v -= cfg.veryBad;
    v -= cfg.snow * snow;
    v -= grade > 0 ? cfg.slopeUp * grade : cfg.slopeDown * -grade;
    // below the lowest speed the deductions still count, ever more gently (m² / (2m − v)): a cliff stays
    // much slower than merely hard going, instead of both being the same crawl
    const m = Math.max(0.1, cfg.minSpeed);
    return v >= m ? v : m * m / (2 * m - v);
  }
  /**
   * How steep the ground is at a map point (%), whichever way: the height map's slope over three map
   * pixels (about 15 km). Off the roads this counts even when the way runs across the slope, not up it:
   * rough mountain ground is slow whichever way you cross it (CROSS of it, at least).
   */
  const CROSS = 0.7;
  function steepAt(fm, HG, x, y) {
    const W = fm.imgW, H = fm.imgH, d = 1.5, run = 2 * d * fm.kmPerMapPx() * 1000;
    const g = (ax, ay) => Math.max(0, fm.groundM(ax, ay, HG));
    const gx = (g(x + d / W, y) - g(x - d / W, y)) / run, gy = (g(x, y + d / H) - g(x, y - d / H)) / run;
    return Math.hypot(gx, gy) * 100;
  }
  /** The slope that slows a traveller (%, + uphill): along the way, and off the roads at least CROSS of the ground's steepness. */
  function effGrade(kind, grade, steep) {
    if (kind !== 0) return grade;
    const m = Math.max(Math.abs(grade), CROSS * steep);
    return grade >= 0 ? m : -m;
  }
  /**
   * How much deep snow there is (0–1): where the date's mean temperature at that height (6.5° colder per km
   * up) is below −2° it starts, below −8° it is everywhere; painted ice counts as deep snow too. (Snow that
   * merely lies, around 0°, doesn't slow anyone much.)
   */
  function deepSnow(clim, hM, ice) {
    const deep = clim ? smooth(-2, -8, clim.now - LAPSE * Math.max(0, hM)) : 0;
    return Math.max(deep, clamp(ice / 100, 0, 1));
  }

  // ── the weather at a spot and time (the regions' hourly values, blended as the map does) ──
  function weatherLevel(fm, cfg, nx, ny, F, hourGlobal) {
    const w = weatherAt(fm, nx, ny, F, hourGlobal);
    if (!w) return 0;
    if (w.rain >= cfg.veryBadRain || w.wind >= cfg.veryBadWind) return 2;
    if (w.rain >= cfg.badRain || w.wind >= cfg.badWind) return 1;
    return 0;
  }
  /** The rain, the wind (m/s) and the way it blows (vx, vy: toward, screen y down) at a spot and hour, or null. */
  function weatherAt(fm, nx, ny, F, hourGlobal) {
    if (!F || !fm.field) return null;
    if (!fm.grid) fm._buildGrid();
    const g = fm.grid;
    if (!g || !g.hasAnchors) return null;
    const K = g.idx.length / (g.gw * g.gh);
    const c = clamp(Math.floor(ny * g.gh), 0, g.gh - 1) * g.gw + clamp(Math.floor(nx * g.gw), 0, g.gw - 1);
    if (g.cov[c] <= 0.001) return null;
    const off = fm._regionOffsets ? fm._regionOffsets() : [];
    let rain = 0, wind = 0, sw = 0, vx = 0, vy = 0;
    for (let k = 0; k < K; k++) {
      const i = g.idx[c * K + k], w = g.wt[c * K + k];
      if (i < 0 || !(w > 0)) continue;
      const r = F.regions[i];
      if (!r || !r.hourly) continue;
      const h = clamp(Math.floor((((hourGlobal + (off[i] || 0)) % 24) + 24) % 24), 0, 23);
      const ws = r.hourly.wind[h] || 0, b = (DIRS[r.direction] ?? 0) * Math.PI / 180;
      rain += w * (r.hourly.rain[h] || 0); wind += w * ws; sw += w;
      vx += w * ws * -Math.sin(b); vy += w * ws * Math.cos(b);        // the direction is where it blows from
    }
    if (sw <= 0) return null;
    return { rain: rain / sw, wind: wind / sw, vx: vx / sw, vy: vy / sw };
  }
  /** A ship's speed (km/h) heading (hx, hy) (map px, y down) in the wind w (or none known: normal). */
  function seaSpeed(cfg, w, hx, hy) {
    if (!w) return cfg.sea.normal;
    if (w.wind >= cfg.veryBadWind || w.wind < cfg.windCalm) return cfg.sea.bad;          // a storm, or becalmed
    const L = Math.hypot(hx, hy), V = Math.hypot(w.vx, w.vy), cos = L > 0 && V > 0 ? (w.vx * hx + w.vy * hy) / (L * V) : 0;
    if (cos <= -0.5) return cfg.sea.bad;                                                   // against the wind
    if (cos >= 0.3 && w.wind >= cfg.windGood) return cfg.sea.good;                         // behind or on the quarter
    return cfg.sea.normal;
  }
  /**
   * Hours to get across a river off the roads: fording (hours per size of the river there), or, for a journey
   * that uses ferries, the ferry where the river is big enough for boats (the boarding hours, if fewer).
   */
  const fordHours = (cfg, flow, ferry) => {
    const h = cfg.riverHoursPerSize * flow;
    return ferry && flow >= cfg.boatMinFlow ? Math.min(h, cfg.boardHours) : h;
  };
  /** A river boat's speed (km/h) by the kind of stretch: downstream, upstream or across a lake. */
  // c: the current there (km/h); journeys planned before 2.17 have none: then the old 3 up / 12.5 down
  const OLD_CURRENT = 4.75;
  const boatSpeed = (cfg, k, c) => {
    const cur = Number.isFinite(c) ? c : OLD_CURRENT;
    return k === 4 ? cfg.boat.still + cfg.boat.downShare * cur : k === 6 ? Math.max(0.1, cfg.boat.still - cur) : cfg.boat.still;
  };

  // ── rivers: where a way crosses one off the roads, it costs time (fording) ──
  /**
   * The drawn rivers as segments in map pixels, with the river's flow (its size there, tributaries
   * included) and a spatial index (BUCKET map px). Lakes are left out (they are water in the height map).
   */
  const BUCKET = 8;
  function riverIndex(fm) {
    const W = fm.imgW, H = fm.imgH, seg = [], grid = new Map();
    if (!fm.rivers || !fm.rivers.length || !fm.riverFlows) return { seg, grid };
    fm.riverFlows();
    for (const r of fm.rivers) {
      const P = r.points || [];
      for (let k = 0; k + 1 < P.length; k++) {
        const ax = P[k].x * W, ay = P[k].y * H, bx = P[k + 1].x * W, by = P[k + 1].y * H;
        const id = seg.length;
        seg.push({ ax, ay, bx, by, flow: fm._rvFlowAt ? fm._rvFlowAt(r, k + 0.5) : r.size || 1, river: r.id });
        for (let i = Math.floor(Math.min(ax, bx) / BUCKET); i <= Math.floor(Math.max(ax, bx) / BUCKET); i++)
          for (let j = Math.floor(Math.min(ay, by) / BUCKET); j <= Math.floor(Math.max(ay, by) / BUCKET); j++) {
            const key = i * 65536 + j;
            (grid.get(key) || grid.set(key, []).get(key)).push(id);
          }
      }
    }
    return { seg, grid };
  }
  /** Where the line a→b (map px) crosses the rivers: [{ t (0–1 along a→b), flow }], one per river. */
  function crossings(RI, ax, ay, bx, by) {
    const out = [], seen = new Set();
    if (!RI.seg.length) return out;
    for (let i = Math.floor(Math.min(ax, bx) / BUCKET); i <= Math.floor(Math.max(ax, bx) / BUCKET); i++)
      for (let j = Math.floor(Math.min(ay, by) / BUCKET); j <= Math.floor(Math.max(ay, by) / BUCKET); j++) {
        for (const id of RI.grid.get(i * 65536 + j) || []) {
          if (seen.has(id)) continue;
          seen.add(id);
          const S = RI.seg[id], rx = bx - ax, ry = by - ay, sx = S.bx - S.ax, sy = S.by - S.ay, den = rx * sy - ry * sx;
          if (Math.abs(den) < 1e-12) continue;
          const t = ((S.ax - ax) * sy - (S.ay - ay) * sx) / den, u = ((S.ax - ax) * ry - (S.ay - ay) * rx) / den;
          if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push({ t, flow: S.flow, river: S.river });
        }
      }
    // a river crossed just where two of its segments meet counts once
    out.sort((a, b) => a.t - b.t);
    const res = [];
    for (const c of out) if (!res.some((o) => o.river === c.river && Math.abs(o.t - c.t) < 1e-6)) res.push(c);
    return res;
  }
  /** A route's river crossings off the roads: [{ km, flow }] (on a road or path the bridge or ford is there). */
  function routeCrossings(fm, pts, RI) {
    const W = fm.imgW, H = fm.imgH, kmpx = fm.kmPerMapPx(), out = [];
    let km = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot((b.x - a.x) * W, (b.y - a.y) * H) * kmpx;
      if (!a.k) for (const c of crossings(RI, a.x * W, a.y * H, b.x * W, b.y * H)) out.push({ km: km + c.t * L, flow: c.flow });
      km += L;
    }
    return out;
  }

  // ── the routing grid and the roads joined to it ──
  function buildGrid(fm, climate) {
    const W = fm.imgW, H = fm.imgH, gw = Math.ceil(W / CELL), gh = Math.ceil(H / CELL), n = gw * gh;
    const HG = fm.heightGrid();
    if (!HG) return null;
    const h = new Float32Array(n), water = new Uint8Array(n), forest = new Float32Array(n), marsh = new Float32Array(n), snow = new Float32Array(n), steep = new Float32Array(n);
    // the climate on a coarser grid (every 6 cells)
    const CS = 6, cw = Math.ceil(gw / CS) + 1, ch = Math.ceil(gh / CS) + 1, clim = new Array(cw * ch);
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) clim[j * cw + i] = climate ? climate(Math.min(1, (i * CS + 0.5) * CELL / W), Math.min(1, (j * CS + 0.5) * CELL / H)) : null;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const k = j * gw + i, nx = Math.min(1, (i + 0.5) * CELL / W), ny = Math.min(1, (j + 0.5) * CELL / H);
      const m = fm.groundM(nx, ny, HG);
      h[k] = m; water[k] = m <= 0 ? 1 : 0;

      forest[k] = fm.layerAt("forest", nx, ny) / 100;
      marsh[k] = fm.layerAt("marsh", nx, ny) / 100;
      snow[k] = deepSnow(clim[Math.round(j / CS) * cw + Math.round(i / CS)], m, fm.layerAt("ice", nx, ny));
    }
    // how steep each cell is, from every pixel of the height map, so a narrow ridge or a cliff between
    // cell centres is never missed
    cellSteepness(fm, HG, gw, gh, steep, water);
    // harbours: the cells within two of a city with a harbour (a ship sets out from there, if the map has any)
    const harbour = new Uint8Array(n);
    let hasHarbours = false;
    for (const c of fm.cities || []) {
      if (!c.harbour) continue;
      hasHarbours = true;
      const ci = clamp(Math.floor(c.x * W / CELL), 0, gw - 1), cj = clamp(Math.floor(c.y * H / CELL), 0, gh - 1);
      for (let j = Math.max(0, cj - 2); j <= Math.min(gh - 1, cj + 2); j++) for (let i = Math.max(0, ci - 2); i <= Math.min(gw - 1, ci + 2); i++) harbour[j * gw + i] = 1;
    }
    return { gw, gh, n, h, water, forest, marsh, snow, steep, harbour, hasHarbours, W, H, HG };
  }
  function cellSteepness(fm, HG, gw, gh, steep, water) {
    // half the steepest spot and half the average over the cell: a narrow ridge or cliff still shows, but
    // one rough pixel doesn't make a whole cell a mountain
    const w = HG.w, hh = HG.h, d = HG.d, sea = HG.sea, sx = w / fm.imgW, sy = hh / fm.imgH;
    const run = 2 * fm.kmPerMapPx() / ((sx + sy) / 2) * 1000;           // metres across two height pixels
    const k = HG.mps / run * 100;
    const v = (i) => Math.max(d[i], sea);
    const sum = new Float32Array(steep.length), cnt = new Uint16Array(steep.length);
    for (let y = 1; y < hh - 1; y++) {
      const cj = Math.min(gh - 1, Math.floor(y / sy / CELL));
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (d[i] <= sea) continue;
        const g = Math.hypot(v(i + 1) - v(i - 1), v(i + w) - v(i - w)) * k;
        const c = cj * gw + Math.min(gw - 1, Math.floor(x / sx / CELL));
        if (g > steep[c]) steep[c] = g;
        sum[c] += g; cnt[c]++;
      }
    }
    for (let c = 0; c < steep.length; c++) steep[c] = water[c] || !cnt[c] ? 0 : (steep[c] + sum[c] / cnt[c]) / 2;
  }

  function inPoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  /**
   * How civilised each grid cell is, for Säkrast: nat[cell] 1 inside a nation's borders, and civ[cell] the
   * distance (km, 8-way) to the nearest road point or nation cell. Made once for the roads and nations as they are.
   */
  function buildCivil(fm, G, RD) {
    const sig = (fm.nations || []).length + ":" + (fm.nations || []).reduce((a, n) => a + (n.parts || []).reduce((b, q) => b + q.length, 0) + (n.subs || []).length, 0);
    if (G.civ && G.civRD === RD && G.civSig === sig) return;
    const { gw, gh, n, W, H } = G, nat = new Uint8Array(n), civ = new Float32Array(n).fill(1e9), cellKm = CELL * fm.kmPerMapPx();
    for (const nt of fm.nations || []) {
      const parts = (nt.parts || []).filter((q) => q.length >= 3);
      for (const q of parts) {
        let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
        for (const c of q) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y); }
        const i0 = Math.max(0, Math.floor(x0 * W / CELL)), i1 = Math.min(gw - 1, Math.ceil(x1 * W / CELL));
        const j0 = Math.max(0, Math.floor(y0 * H / CELL)), j1 = Math.min(gh - 1, Math.ceil(y1 * H / CELL));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const k = j * gw + i;
          if (!nat[k] && inPoly(Math.min(1, (i + 0.5) * CELL / W), Math.min(1, (j + 0.5) * CELL / H), q)) nat[k] = 1;
        }
      }
    }
    for (let k = 0; k < n; k++) if (nat[k]) civ[k] = 0;
    for (let p = 0; p < RD.R; p++) civ[RD.cell[p]] = 0;
    // two chamfer passes over the grid
    const D = 1.4142, relax = (k, o, w) => { const v = civ[o] + w * cellKm; if (v < civ[k]) civ[k] = v; };
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const k = j * gw + i;
      if (i > 0) relax(k, k - 1, 1);
      if (j > 0) { relax(k, k - gw, 1); if (i > 0) relax(k, k - gw - 1, D); if (i + 1 < gw) relax(k, k - gw + 1, D); }
    }
    for (let j = gh - 1; j >= 0; j--) for (let i = gw - 1; i >= 0; i--) {
      const k = j * gw + i;
      if (i + 1 < gw) relax(k, k + 1, 1);
      if (j + 1 < gh) { relax(k, k + gw, 1); if (i + 1 < gw) relax(k, k + gw + 1, D); if (i > 0) relax(k, k + gw - 1, D); }
    }
    G.nat = nat; G.civ = civ; G.civRD = RD; G.civSig = sig;
  }

  /** Road points every map pixel: x, y (0–1), kind (1–3), the grid cell, and who they connect to. */
  function buildRoads(fm, G, climate) {
    const W = fm.imgW, H = fm.imgH, xs = [], ys = [], kinds = [], hs = [], fo = [], ma = [], sn = [], nb = [];
    const link = (a, b, k) => { nb[a].push(b, k); nb[b].push(a, k); };
    for (const r of fm.roads || []) {
      if (r.points.length < 2) continue;
      const kind = KIND[r.kind] || 2;
      let prev = -1;
      for (let s = 0; s + 1 < r.points.length; s++) {
        const a = r.points[s], b = r.points[s + 1], L = Math.hypot((b.x - a.x) * W, (b.y - a.y) * H), m = Math.max(1, Math.ceil(L));
        for (let t = s ? 1 : 0; t <= m; t++) {
          const x = a.x + (b.x - a.x) * t / m, y = a.y + (b.y - a.y) * t / m, id = xs.length;
          const hm = fm.groundM(x, y, G.HG);
          xs.push(x); ys.push(y); kinds.push(kind); hs.push(hm); fo.push(fm.layerAt("forest", x, y) / 100); ma.push(fm.layerAt("marsh", x, y) / 100);
          sn.push(deepSnow(climate ? climate(x, y) : null, hm, fm.layerAt("ice", x, y)));
          nb.push([]);
          if (prev >= 0) link(prev, id, kind);
          prev = id;
        }
      }
    }
    const R = xs.length;
    // junctions: points of different roads (or far apart on one) within 1.2 map px of each other
    const hash = new Map(), key = (i, j) => i * 100003 + j;
    for (let p = 0; p < R; p++) { const k = key(Math.floor(xs[p] * W / 2), Math.floor(ys[p] * H / 2)); (hash.get(k) || hash.set(k, []).get(k)).push(p); }
    for (let p = 0; p < R; p++) {
      const ci = Math.floor(xs[p] * W / 2), cj = Math.floor(ys[p] * H / 2);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const q of hash.get(key(ci + di, cj + dj)) || []) {
        if (q <= p || nb[p].includes(q)) continue;
        if (Math.abs(q - p) < 4 && kinds[q] === kinds[p]) continue;               // neighbours on the same line
        if (Math.hypot((xs[q] - xs[p]) * W, (ys[q] - ys[p]) * H) <= 1.2) link(p, q, Math.min(kinds[p], kinds[q]));
      }
    }
    // cities: the roads passing through (or ending at) a city are joined there
    for (const c of fm.cities || []) {
      const near = [], ci = Math.floor(c.x * W / 2), cj = Math.floor(c.y * H / 2);
      for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) for (const q of hash.get(key(ci + di, cj + dj)) || [])
        if (Math.hypot((xs[q] - c.x) * W, (ys[q] - c.y) * H) <= 2.5) near.push(q);
      near.sort((a, b) => Math.hypot((xs[a] - c.x) * W, (ys[a] - c.y) * H) - Math.hypot((xs[b] - c.x) * W, (ys[b] - c.y) * H));
      const use = near.slice(0, 8);
      for (let i = 0; i < use.length; i++) for (let j = i + 1; j < use.length; j++) {
        const p = use[i], q = use[j];
        if (!nb[p].includes(q)) link(p, q, Math.min(kinds[p], kinds[q]));
      }
    }
    const cell = new Int32Array(R);
    for (let p = 0; p < R; p++) cell[p] = clamp(Math.floor(ys[p] * H / CELL), 0, G.gh - 1) * G.gw + clamp(Math.floor(xs[p] * W / CELL), 0, G.gw - 1);
    // each grid cell's road points (to step onto the road from the land around)
    const onCell = new Map();
    for (let p = 0; p < R; p++) (onCell.get(cell[p]) || onCell.set(cell[p], []).get(cell[p])).push(p);
    return { R, xs, ys, kinds, hs, fo, ma, sn, nb, cell, onCell };
  }

  /**
   * The river boats' network: a point every map pixel along the rivers big enough (flow at least minFlow),
   * linked downstream (+1) and upstream (−1); where a river runs into another the two meet, and the rivers
   * running into and out of a lake are linked across it (0). Points: x, y (0–1), the grid cell, links, and
   * the current there (km/h).
   */
  function buildBoats(fm, G, minFlow) {
    const W = fm.imgW, H = fm.imgH, xs = [], ys = [], nb = [], riv = [], cur = [], mouth = new Map(), source = new Map();
    const link = (a, b, dir) => { nb[a].push(b, dir); nb[b].push(a, -dir); };
    if (fm.rivers && fm.rivers.length && fm.riverFlows) {
      fm.riverFlows();
      for (const r of fm.rivers) {
        const P = r.points || [];
        let prev = -1;
        for (let s = 0; s + 1 < P.length; s++) {
          const flow = fm._rvFlowAt ? fm._rvFlowAt(r, s + 0.5) : r.size || 1;
          if (flow < minFlow) { prev = -1; continue; }
          const a = P[s], b = P[s + 1], L = Math.hypot((b.x - a.x) * W, (b.y - a.y) * H), m = Math.max(1, Math.ceil(L));
          for (let t = prev >= 0 ? 1 : 0; t <= m; t++) {
            const id = xs.length;
            xs.push(a.x + (b.x - a.x) * t / m); ys.push(a.y + (b.y - a.y) * t / m); nb.push([]); riv.push(r.id);
            cur.push(fm.currentAt ? fm.currentAt(r, Math.min(s + t / m, P.length - 1.5)) : OLD_CURRENT);
            if (prev >= 0) link(prev, id, 1);
            prev = id;
            if (s === 0 && t === 0) source.set(r.id, id);
            if (s + 2 === P.length && t === m) mouth.set(r.id, id);
          }
        }
      }
    }
    const R = xs.length;
    const hash = new Map(), key = (i, j) => i * 100003 + j;
    for (let p = 0; p < R; p++) { const k = key(Math.floor(xs[p] * W / 2), Math.floor(ys[p] * H / 2)); (hash.get(k) || hash.set(k, []).get(k)).push(p); }
    for (const r of fm.rivers || []) {
      const m = mouth.get(r.id);
      if (m == null || !r.joins) continue;
      if (r.joins.river != null) {
        let best = -1, bd = 3;
        const ci = Math.floor(xs[m] * W / 2), cj = Math.floor(ys[m] * H / 2);
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const q of hash.get(key(ci + di, cj + dj)) || []) {
          if (riv[q] !== r.joins.river) continue;
          const d = Math.hypot((xs[q] - xs[m]) * W, (ys[q] - ys[m]) * H);
          if (d < bd) { bd = d; best = q; }
        }
        if (best >= 0) link(m, best, 1);
      }
    }
    // across a lake: every river's end at it (in and out) to every other's
    for (const lk of fm.lakes || []) {
      const ends = [];
      for (const r of fm.rivers || []) {
        if (r.joins && r.joins.lake === lk.id && mouth.has(r.id)) ends.push(mouth.get(r.id));
        if (r.from && r.from.lake === lk.id && source.has(r.id)) ends.push(source.get(r.id));
      }
      for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) link(ends[i], ends[j], 0);
    }
    const cell = new Int32Array(R), onCell = new Map();
    for (let p = 0; p < R; p++) {
      cell[p] = clamp(Math.floor(ys[p] * H / CELL), 0, G.gh - 1) * G.gw + clamp(Math.floor(xs[p] * W / CELL), 0, G.gw - 1);
      (onCell.get(cell[p]) || onCell.set(cell[p], []).get(cell[p])).push(p);
    }
    let maxCur = 0;
    for (const c of cur) if (c > maxCur) maxCur = c;
    return { R, xs, ys, nb, cell, onCell, cur, maxCur };
  }
  const BOARD_KM = 5;              // Kortast: getting on board counts as this much further (so it doesn't hop on and off)

  // a binary heap of node ids by key
  function Heap() {
    let key = new Float64Array(1024), id = new Int32Array(1024), n = 0;
    return {
      get size() { return n; },
      push(k, v) {
        if (n === key.length) { const k2 = new Float64Array(n * 2), i2 = new Int32Array(n * 2); k2.set(key); i2.set(id); key = k2; id = i2; }
        let i = n++;
        while (i > 0) { const p = (i - 1) >> 1; if (key[p] <= k) break; key[i] = key[p]; id[i] = id[p]; i = p; }
        key[i] = k; id[i] = v;
      },
      pop() {
        const top = id[0], lk = key[--n], lv = id[n];
        let i = 0;
        while (true) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && key[c + 1] < key[c]) c++;
          if (key[c] >= lk) break;
          key[i] = key[c]; id[i] = id[c]; i = c;
        }
        key[i] = lk; id[i] = lv;
        return top;
      },
    };
  }

  /**
   * The route from a to b ({x, y} 0–1): mode "fast" (least time) or "short" (least distance). Returns
   * { pts: [{x, y, k}] (k: the kind of the stretch starting there), km } or null without a way.
   */
  function findRoute(fm, G, RD, a, b, mode, cfg, pace, opt) {
    const { gw, gh, n } = G, W = G.W, H = G.H, kmpx = fm.kmPerMapPx();
    opt = opt || {};
    const BT = opt.ferry ? opt.boats : null, sea = !!opt.sea, nB = n + RD.R;
    const N = nB + (BT ? BT.R : 0);
    // a sea voyage that sails day and night counts its hours as fewer travel hours
    const seaF = cfg.seaAllDay ? clamp(+opt.hours || cfg.hoursPerDay, 0.5, 24) / 24 : 1;
    const cellOf = (p) => clamp(Math.floor(p.y * H / CELL), 0, gh - 1) * gw + clamp(Math.floor(p.x * W / CELL), 0, gw - 1);
    // the nearest land cell to a point
    const landNear = (p) => {
      const c0 = cellOf(p);
      if (!G.water[c0]) return c0;
      const ci = c0 % gw, cj = (c0 - ci) / gw;
      for (let r = 1; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj;
        if (i >= 0 && j >= 0 && i < gw && j < gh && !G.water[j * gw + i]) return j * gw + i;
      }
      return -1;
    };
    const s = landNear(a), t = landNear(b);
    if (s < 0 || t < 0) return null;
    const safe = mode === "safe", sc = clamp(opt.safeScale == null ? 1 : opt.safeScale, 0, 1);
    if (safe) buildCivil(fm, G, RD);
    // how many times as much a stretch counts for Säkrast (1 on roads; more the farther from anything civilised)
    const risk = (u, v, kind, fo) => {
      let m;
      if (kind >= 2) m = 1;
      else if (kind === 1) m = cfg.safe.path;
      else {
        const cu = u < n ? u : RD.cell[u - n], cv = v < n ? v : RD.cell[v - n];
        m = (G.nat[cu] && G.nat[cv]) ? cfg.safe.nation : clamp(cfg.safe.off + (G.civ[cu] + G.civ[cv]) / 2 * cfg.safe.perKm, 1, Math.max(1, cfg.safe.max));
      }
      return 1 + sc * (Math.max(1, m * (1 + cfg.safe.forest * fo * (kind >= 2 ? 0 : 1))) - 1);
    };
    let rc = 0;                                  // the time a stretch really takes, without Säkrast's extra
    const pos = (v) => v < n ? [((v % gw) + 0.5) * CELL / W, (Math.floor(v / gw) + 0.5) * CELL / H] : v < nB ? [RD.xs[v - n], RD.ys[v - n]] : [BT.xs[v - nB], BT.ys[v - nB]];
    const attr = (v) => v < n ? [G.h[v], G.forest[v], G.snow[v], G.steep[v], G.marsh[v]] : [RD.hs[v - n], RD.fo[v - n], RD.sn[v - n], G.steep[RD.cell[v - n]], RD.ma[v - n]];
    const vmax = Math.max(pace + cfg.road.highway, BT ? cfg.boat.still + cfg.boat.downShare * BT.maxCur : 0, sea ? Math.max(cfg.sea.normal, cfg.sea.good) / seaF : 0);
    const [tx, ty] = pos(t);
    const heur = (v) => { const [x, y] = pos(v), km = Math.hypot((x - tx) * W, (y - ty) * H) * kmpx; return mode === "short" ? km : km / vmax; };
    // off the roads a step counts the steeper of its two cells (and, going diagonally, of the two cells
    // beside it too: a ridge running from corner to corner can't be slipped through)
    const cost = (u, v, kind, side) => {
      const [ux, uy] = pos(u), [vx, vy] = pos(v), km = Math.hypot((vx - ux) * W, (vy - uy) * H) * kmpx;
      const [hu, fu, su, tu, mu] = attr(u), [hv, fv, sv, tv, mv] = attr(v);
      const grade = km > 0 ? (Math.max(0, hv) - Math.max(0, hu)) / (km * 1000) * 100 : 0;
      const st = Math.max(tu, tv, side || 0);
      const sp = speedAt(cfg, pace, kind, (fu + fv) / 2, effGrade(kind, grade, st), (su + sv) / 2, 0, (mu + mv) / 2);
      // the shortest way that is still passable: ground slower than half a km/h off the roads (mountains,
      // cliffs) counts twenty times its length, so it is only crossed where there is no way round
      if (mode === "short") return kind === 0 && sp < 0.5 ? km * 20 : km;
      // fording a river off the roads: hours per size of the river there (a road or path has its bridge)
      const ford = kind === 0 ? fordsOn(u, v) : 0;
      if (safe) {
        rc = km / sp + ford;
        return (km / sp) * risk(u, v, kind, (fu + fv + mu + mv) / 2) + ford;
      }
      if (mode === "easy") {
        // the easiest way: roads count as shorter than they are, open ground as longer (a path between),
        // and every 250 m up costs an hour more, so it keeps to roads and low ground even if that is slower
        const climb = Math.max(0, Math.max(0, hv) - Math.max(0, hu));
        return km / sp * (kind >= 2 ? 1 : kind === 1 ? 1.25 : 1.6) + climb / 250 + ford;
      }
      return km / sp + ford;
    };
    const g = new Float64Array(N).fill(Infinity), tm = new Float64Array(N), from = new Int32Array(N).fill(-1), via = new Int8Array(N), done = new Uint8Array(N);
    const heap = Heap();
    g[s] = 0; heap.push(heur(s), s);
    const DX = [-1, 0, 1, -1, 1, -1, 0, 1], DY = [-1, -1, -1, 0, 0, 1, 1, 1];
    const relax = (u, v, kind, side) => {
      if (v < n && G.water[v]) return;
      // full marshland can't be crossed on foot (roads cross it; a river boat goes through)
      if (v < n && kind === 0 && G.marsh[v] >= 0.995) return;
      const c = cost(u, v, kind, side);
      relaxC(u, v, kind, c, safe ? rc : c);
    };
    const relaxC = (u, v, kind, c, real) => {
      c += g[u];
      if (c < g[v]) { g[v] = c; tm[v] = tm[u] + (real == null ? c - g[u] : real); from[v] = u; via[v] = kind; heap.push(c + heur(v), v); }
    };
    const fordsOn = (u, v) => {
      let h = 0;
      if (!G.rivers || !(cfg.riverHoursPerSize > 0)) return 0;
      const [ux, uy] = pos(u), [vx, vy] = pos(v);
      for (const c of crossings(G.rivers, ux * W, uy * H, vx * W, vy * H)) h += fordHours(cfg, c.flow, BT != null);
      return h;
    };
    const kmOf = (u, v) => { const [ux, uy] = pos(u), [vx, vy] = pos(v); return Math.hypot((vx - ux) * W, (vy - uy) * H) * kmpx; };
    // by boat: hours (or km for Kortast), plus the boarding when getting on
    const boatCost = (km, speed, board) => (mode === "short" ? km + (board ? BOARD_KM : 0) : km / speed + (board ? cfg.boardHours : 0));
    const isWater = (v) => v < n && G.water[v];
    while (heap.size) {
      const u = heap.pop();
      if (done[u]) continue;
      done[u] = 1;
      if (u === t) break;
      if (u < n) {
        const ui = u % gw, uj = (u - ui) / gw, wet = G.water[u];
        for (let d = 0; d < 8; d++) {
          const i = ui + DX[d], j = uj + DY[d];
          if (i < 0 || j < 0 || i >= gw || j >= gh) continue;
          const v = j * gw + i;
          if (wet || G.water[v]) {
            // at sea (and out to sea from the shore, or ashore): a ship
            if (sea && (wet || !G.hasHarbours || G.harbour[u])) relaxC(u, v, 5, boatCost(kmOf(u, v), cfg.sea.normal / seaF, !wet));   // a ship sets out from a harbour only
            continue;
          }
          const side = DX[d] && DY[d] ? Math.max(G.steep[uj * gw + i], G.steep[j * gw + ui]) : 0;
          relax(u, v, 0, side);
        }
        if (wet) continue;
        for (const p of RD.onCell.get(u) || []) relax(u, n + p, 0);          // onto a road
        if (BT) for (const p of BT.onCell.get(u) || []) relaxC(u, nB + p, 0, boatCost(kmOf(u, nB + p), pace, true) + (mode === "short" ? 0 : fordsOn(u, nB + p)));   // on board a river boat
      } else if (u >= nB) {
        const p = u - nB, L = BT.nb[p];
        for (let q = 0; q < L.length; q += 2) {
          const k = L[q + 1] > 0 ? 4 : L[q + 1] < 0 ? 6 : 7;
          // the current: downstream the faster of the two points helps, upstream the stronger holds it back
          const c = k === 6 ? Math.max(BT.cur[p], BT.cur[L[q]]) : (BT.cur[p] + BT.cur[L[q]]) / 2;
          if (k === 6 && cfg.boat.still - c < cfg.boat.minUp) continue;                       // too strong to go up
          relaxC(u, nB + L[q], k, boatCost(kmOf(u, nB + L[q]), boatSpeed(cfg, k, c), false));
        }
        const c = BT.cell[p];                                                // ashore (or onto a ship at the mouth)
        if (isWater(c)) { if (sea && (!G.hasHarbours || G.harbour[c])) relaxC(u, c, 5, boatCost(kmOf(u, c), cfg.sea.normal / seaF, true)); }
        else relaxC(u, c, 0, mode === "short" ? kmOf(u, c) : kmOf(u, c) / pace + fordsOn(u, c));
      } else {
        const p = u - n, L = RD.nb[p];
        for (let q = 0; q < L.length; q += 2) relax(u, n + L[q], L[q + 1]);
        relax(u, RD.cell[p], 0);                                             // off the road
      }
    }
    if (!done[t]) return null;
    const nodes = [];
    for (let v = t; v >= 0; v = from[v]) { nodes.push(v); if (v === s) break; }
    nodes.reverse();
    let pts = nodes.map((v, i) => {
      const [x, y] = pos(v), k = i + 1 < nodes.length ? via[nodes[i + 1]] : 0, o = { x, y, k };
      if (RIVER_K(k) && v >= nB) o.c = BT.cur[v - nB];                     // the current there (kept with the journey)
      return o;
    });
    pts = [{ x: a.x, y: a.y, k: 0 }, ...pts, { x: b.x, y: b.y, k: 0 }];
    // rounded off, unless that makes it ford rivers more (a way along a river would weave across it)
    const sm = smoothOffRoad(pts);
    if (G.rivers && G.rivers.seg.length) {
      const fordH = (q) => routeCrossings(fm, q, G.rivers).reduce((t, c) => t + fordHours(cfg, c.flow, BT != null), 0);
      if (fordH(sm) <= fordH(pts)) pts = sm;
    } else pts = sm;
    // nobody walks (or sails) in a straight line: a meander off the roads and rivers
    pts = wiggle(fm, G, pts, cfg.wiggle, (q) => (G.rivers && G.rivers.seg.length ? routeCrossings(fm, q, G.rivers).reduce((t, c) => t + fordHours(cfg, c.flow, BT != null), 0) : 0));
    let km = 0;
    for (let i = 1; i < pts.length; i++) km += Math.hypot((pts[i].x - pts[i - 1].x) * W, (pts[i].y - pts[i - 1].y) * H) * kmpx;
    return { pts, km, hours: tm[t] };
  }
  /**
   * The meander: stretches off the roads and rivers (on foot, or at sea) are bent sideways by a few gentle
   * waves (about 45, 15 and 5 map pixels long; at most about 2.5 map pixels aside, less at sea) and, on a long
   * stretch, one slow bend of about 3 % of its length (at most 15 map pixels aside), fading out
   * towards their ends so they still meet the roads where they did. The waves come from the stretch's own
   * position, so the same route always bends the same way. A bend that would step into the water (or, at
   * sea, onto land) is made smaller there, and if the bends would cost more fording, they are made smaller or
   * dropped.
   */
  const WAVES = [[1.5, 45], [0.75, 15], [0.3, 5]];          // [map px aside, map px long]
  function wiggle(fm, G, pts, amount, fordCost) {
    amount = clamp(+amount || 0, 0, 4);
    if (!amount) return pts;
    const before = fordCost(pts);
    for (const scale of [1, 0.5, 0.25]) {
      const out = wiggleOnce(fm, G, pts, scale * amount);
      if (fordCost(out) <= before + 1e-9) return out;
    }
    return pts;
  }
  function wiggleOnce(fm, G, pts, scale) {
    const W = G.W, H = G.H, HG = G.HG, out = [];
    let i = 0;
    while (i < pts.length - 1) {
      const k0 = pts[i].k;
      if (k0 !== 0 && k0 !== 5) { out.push(pts[i]); i++; continue; }
      let e = i;
      while (e < pts.length - 1 && pts[e].k === k0) e++;            // pts[i..e]: an off-road (or open sea) run
      // the run by its length (map px)
      const run = pts.slice(i, e + 1), cum = [0];
      for (let q = 1; q < run.length; q++) cum.push(cum[q - 1] + Math.hypot((run[q].x - run[q - 1].x) * W, (run[q].y - run[q - 1].y) * H));
      const L = cum[cum.length - 1];
      if (L < 8 || !HG) { for (let q = 0; q < run.length - 1; q++) out.push(run[q]); i = e; continue; }
      const at = (d) => {
        d = clamp(d, 0, L);
        let q = 0;
        while (q + 2 < cum.length && cum[q + 1] < d) q++;
        const f = cum[q + 1] > cum[q] ? (d - cum[q]) / (cum[q + 1] - cum[q]) : 0;
        return [(run[q].x + (run[q + 1].x - run[q].x) * f) * W, (run[q].y + (run[q + 1].y - run[q].y) * f) * H];
      };
      // the waves' phases and lengths, from where the run starts
      let h = Math.floor(run[0].x * 1e6) * 73856093 ^ Math.floor(run[0].y * 1e6) * 19349663 ^ Math.floor(run[run.length - 1].x * 1e6) * 83492791;
      const rnd = () => { h = (Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0; h ^= h >>> 16; return (h >>> 0) / 4294967296; };
      const waves = WAVES.map(([a, len]) => [a * scale * (k0 === 5 ? 0.6 : 1), len * (0.8 + 0.5 * rnd()), rnd() * Math.PI * 2, rnd() < 0.5 ? -1 : 1]);
      // and one long, slow bend that grows with the stretch (about 3 % of its length aside, at most 15 map px)
      if (L > 60) waves.push([Math.min(0.03 * L, 15) * scale, L / (1.2 + 1.3 * rnd()), rnd() * Math.PI * 2, rnd() < 0.5 ? -1 : 1]);
      const fade = Math.min(12, L / 3), n = Math.max(2, Math.ceil(L / 2));
      for (let j = 0; j < n; j++) {
        const d = j * L / n;
        const [px, py] = at(d), [ax, ay] = at(d - 2), [bx, by] = at(d + 2);
        const tl = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / tl, ny = (bx - ax) / tl;
        const t = Math.min(1, d / fade, (L - d) / fade), taper = t * t * (3 - 2 * t);
        let off = 0;
        for (const [a, len, ph, sg] of waves) off += sg * a * Math.sin(2 * Math.PI * d / len + ph);
        off *= taper;
        // not into the water on land, nor onto land at sea: the bend gets smaller there
        let qx = px / W, qy = py / H;
        for (const f of [1, 0.6, 0.35, 0.15]) {
          const tx = clamp((px + nx * off * f) / W, 0, 1), ty = clamp((py + ny * off * f) / H, 0, 1);
          if ((fm.groundM(tx, ty, HG) <= 0) === (k0 === 5)) { qx = tx; qy = ty; break; }
        }
        out.push({ x: clamp(qx, 0, 1), y: clamp(qy, 0, 1), k: k0 });
      }
      i = e;
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  /** Off-road stretches of a grid route are staircases: rounded off twice (Chaikin; the road stretches stay). */
  function smoothOffRoad(pts) {
    const out = [];
    let i = 0;
    while (i < pts.length - 1) {
      const k0 = pts[i].k;
      if (k0 !== 0 && k0 !== 5) { out.push(pts[i]); i++; continue; }
      let e = i;
      while (e < pts.length - 1 && pts[e].k === k0) e++;           // pts[i..e]: an off-road (or open sea) run
      let run = pts.slice(i, e + 1).map((p) => ({ x: p.x, y: p.y }));
      for (let pass = 0; pass < 2 && run.length > 2; pass++) {
        const r2 = [run[0]];
        for (let q = 0; q + 1 < run.length; q++) {
          const a = run[q], b = run[q + 1];
          if (q > 0) r2.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
          if (q + 2 < run.length) r2.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
        }
        r2.push(run[run.length - 1]);
        run = r2;
      }
      for (let q = 0; q < run.length - 1; q++) out.push({ x: run[q].x, y: run[q].y, k: k0 });
      i = e;
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  // ── a route as dense samples (every half map pixel): distance, kind, height, forest, ice, slope ──
  function sampleRoute(fm, pts) {
    const W = fm.imgW, H = fm.imgH, kmpx = fm.kmPerMapPx(), HG = fm.heightGrid(), S = [];
    let km = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot((b.x - a.x) * W, (b.y - a.y) * H), m = Math.max(1, Math.ceil(L * 2));
      for (let t = i ? 1 : 0; t <= m; t++) {
        const x = a.x + (b.x - a.x) * t / m, y = a.y + (b.y - a.y) * t / m;
        const nxt = t === m && i + 1 < pts.length - 1;
        S.push({ km: km + L * kmpx * t / m, x, y, k: nxt ? pts[i + 1].k : a.k, c: nxt ? pts[i + 1].c : a.c,
          h: HG ? fm.groundM(x, y, HG) : 0, f: fm.layerAt("forest", x, y) / 100, m: fm.layerAt("marsh", x, y) / 100, ice: fm.layerAt("ice", x, y) });
      }
      km += L * kmpx;
    }
    // the slope ahead (%), averaged over about three map pixels around each sample
    const win = 1.5 * kmpx;
    let lo = 0, hi = 0;
    for (let i = 0; i < S.length; i++) {
      while (S[lo].km < S[i].km - win) lo++;
      while (hi + 1 < S.length && S[hi + 1].km <= S[i].km + win) hi++;
      const d = (S[hi].km - S[lo].km) * 1000;
      const g = d > 0 ? (Math.max(0, S[hi].h) - Math.max(0, S[lo].h)) / d * 100 : 0;
      S[i].g = S[i].k === 0 && HG ? effGrade(0, g, steepAt(fm, HG, S[i].x, S[i].y)) : g;
    }
    return S;
  }
  function routeSummary(fm, pts, RI, cfg, ferry) {
    const S = sampleRoute(fm, pts), byKind = [0, 0, 0, 0, 0, 0, 0, 0], fords = RI ? routeCrossings(fm, pts, RI) : [];
    let boards = 0;
    for (let i = 1; i < S.length; i++) if (MODE_OF(S[i].k) && MODE_OF(S[i].k) !== MODE_OF(S[i - 1].k)) boards++;
    let climb = 0;
    for (let i = 1; i < S.length; i++) {
      byKind[S[i - 1].k] += S[i].km - S[i - 1].km;
      const dh = Math.max(0, S[i].h) - Math.max(0, S[i - 1].h);
      if (dh > 0 && !MODE_OF(S[i - 1].k)) climb += dh;
    }
    return { km: S.length ? S[S.length - 1].km : 0, byKind, climb, fords: fords.length, fordSize: fords.reduce((a, c) => a + c.flow, 0), boards,
      fordHours: cfg ? fords.reduce((a, c) => a + fordHours(cfg, c.flow, ferry), 0) : 0,
      ferries: cfg && ferry ? fords.filter((c) => c.flow >= cfg.boatMinFlow && cfg.boardHours < cfg.riverHoursPerSize * c.flow).length : 0 };
  }

  // ── the journey hour by hour ──
  /**
   * Works out how far a journey has come at every hour from its start. trip: { route, startT, pace, dayStart,
   * offset, delays: [{ at, hours }] }; fields(serial) → the day's weather or null; climate(serial) → (x, y) →
   * { now } or null. Returns { km: [...], total, arriveT } (km[i] at startT + i / 24), or { need: serial } when
   * a day's weather is missing.
   */
  function simulate(fm, trip, cfg, fields, climate) {
    const S = trip._samples || (trip._samples = sampleRoute(fm, trip.route.map((p) => ({ x: p[0], y: p[1], k: p[2] || 0, c: p[3] }))));
    const total = S.length ? S[S.length - 1].km : 0, dt = 0.25;           // hours per step
    const delays = (trip.delays || []).slice().sort((a, b) => a.at - b.at);
    // fording rivers off the roads: the hours are spent when the party gets there
    const fords = trip._fords || (trip._fords = routeCrossings(fm, trip.route.map((p) => ({ x: p[0], y: p[1], k: p[2] || 0 })), riverIndex(fm)));
    const km = [0];
    // pend: travel hours to spend (fords, boarding, and delays made before 2.16); hold: clock hours the
    // party stands still whatever the hour (a delay: 24 is a whole day)
    let t = trip.startT, d = 0, i = 0, pend = 0, hold = 0, di = 0, h = 0, fi = 0;
    const climCache = new Map();
    while (d < total - 1e-9 && t < trip.startT + 200) {
      while (di < delays.length && delays[di].at <= t + 1e-9) {
        const dl = delays[di++];
        if (dl.clock) hold += Math.max(0, dl.hours); else pend += Math.max(0, dl.hours);
      }
      const serial = Math.floor(t + 1e-9), hourG = (t - serial) * 24;
      const local = (((hourG + (trip.offset || 0)) % 24) + 24) % 24;
      // the journey's own hours a day (chosen when it started), else the rules'
      const end = trip.dayStart + clamp(+trip.hoursPerDay || cfg.hoursPerDay, 0.5, 24);
      while (i + 1 < S.length && S[i + 1].km <= d) i++;
      // at sea a ship sails day and night (when the rules say so)
      const atSea = S[i] && S[i].k === 5 && cfg.seaAllDay;
      const travelling = atSea || (end <= 24 ? local >= trip.dayStart - 1e-6 && local < end - 1e-6 : local >= trip.dayStart - 1e-6 || local < end - 24 - 1e-6);
      if (hold > 0) hold = Math.max(0, hold - dt);
      else if (travelling) {
        if (pend > 0) pend = Math.max(0, pend - dt);
        else {
          const s = S[i];
          const F = fields(serial);
          if (F === undefined) return { need: serial };
          const ck = serial + ":" + (i >> 6);
          if (!climCache.has(ck)) climCache.set(ck, climate ? climate(serial)(s.x, s.y) : null);
          let v;
          if (s.k === 5) {
            // a ship: the wind where it is, against the way it is heading
            const nx = S[Math.min(S.length - 1, i + 2)], px = S[Math.max(0, i - 2)];
            v = seaSpeed(cfg, weatherAt(fm, s.x, s.y, F, hourG), (nx.x - px.x) * fm.imgW, (nx.y - px.y) * fm.imgH);
          } else if (RIVER_K(s.k)) v = boatSpeed(cfg, s.k, s.c);
          else {
            const wx = weatherLevel(fm, cfg, s.x, s.y, F, hourG);
            v = speedAt(cfg, trip.pace, s.k, s.f, s.g, deepSnow(climCache.get(ck), s.h, s.ice), wx, s.m);
          }
          let nd = Math.min(total, d + v * dt);
          if (fi < fords.length && fords[fi].km <= nd) { nd = Math.max(d, fords[fi].km); pend += fordHours(cfg, fords[fi].flow, !!trip.ferry); fi++; }
          // getting on board (a river boat, a ship, or from one to the other) takes the boarding hours
          for (let j = i + 1; j < S.length && S[j].km <= nd; j++) {
            const mj = MODE_OF(S[j].k);
            if (mj && mj !== MODE_OF(S[j - 1].k) && S[j].km > d + 1e-9) { nd = S[j].km; pend += cfg.boardHours; break; }
          }
          d = nd;
        }
      }
      t += dt / 24;
      h += dt;
      if (h >= 1 - 1e-9) { km.push(d); h = 0; }
    }
    if (h > 0) km.push(d);
    return { km, total, arriveT: t };
  }

  // ── journeys on the map ──
  /** Where a journey's token is at time T: { x, y, km, state: "before" | "on" | "after" }. */
  function tripAt(trip, T) {
    const tl = trip.timeline;
    if (!tl || !trip.route || trip.route.length < 2) return null;
    const S = trip._cum || (trip._cum = cumulative(trip.route));
    let km;
    if (T <= trip.startT) km = 0;
    else {
      const f = (T - trip.startT) * 24, i = Math.floor(f);
      km = i + 1 < tl.km.length ? tl.km[i] + (tl.km[i + 1] - tl.km[i]) * (f - i) : tl.km[tl.km.length - 1];
    }
    const state = T < trip.startT ? "before" : T >= tl.arriveT ? "after" : "on";
    const p = pointAtKm(trip, km);
    return { ...p, km, state };
  }
  let ASPECT = 0.5;                       // the map's height / width (set when the calculator starts)
  function cumulative(route) {
    const out = [0];
    for (let i = 1; i < route.length; i++) out.push(out[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], (route[i][1] - route[i - 1][1]) * ASPECT));
    return out;
  }
  /** The point a given distance along a journey (km, by the timeline's total). */
  function pointAtKm(trip, km) {
    const cum = trip._cum || (trip._cum = cumulative(trip.route)), r = trip.route, total = trip.timeline.total || 1;
    const u = clamp(km / total, 0, 1) * cum[cum.length - 1];
    let i = 0;
    while (i + 2 < cum.length && cum[i + 1] < u) i++;
    const seg = cum[i + 1] - cum[i] || 1, f = clamp((u - cum[i]) / seg, 0, 1);
    return { x: r[i][0] + (r[i + 1][0] - r[i][0]) * f, y: r[i][1] + (r[i + 1][1] - r[i][1]) * f, i, f };
  }

  P._trDraw = function () {
    const tv = this._travel;
    if (!tv) return;
    const ctx = this.ctx, T = this.T || 0, show = this.layers.has("trip") || tv.panelOpen;
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const line = (pts, from = 0, to = pts.length - 1) => {
      ctx.beginPath();
      for (let i = from; i <= to; i++) { const [x, y] = this.toScreen(pts[i][0], pts[i][1]); i === from ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    };
    // how hard the ground is to cross off the roads (the ⛰ switch in the panel)
    if (tv.terrain) {
      ctx.save();
      ctx.globalAlpha = 0.6; ctx.imageSmoothingEnabled = false;
      const [ox, oy] = this.toScreen(0, 0), [ex, ey] = this.toScreen(1, 1);
      ctx.drawImage(tv.terrain, ox, oy, ex - ox, ey - oy);
      ctx.restore();
    }
    // the routes being chosen between
    for (const c of tv.candidates || []) {
      const pts = c.pts.map((p) => [p.x, p.y]), sel = tv.chosen === c.mode;
      line(pts);
      ctx.setLineDash(sel ? [] : [8, 6]);
      ctx.strokeStyle = "rgba(10,14,20,0.6)"; ctx.lineWidth = sel ? 7 : 5; ctx.stroke();
      ctx.strokeStyle = MODE_COL[c.mode]; ctx.lineWidth = sel ? 4 : 2.5; ctx.stroke();
      ctx.setLineDash([]);
      this._trBoats(c.pts.map((p) => [p.x, p.y, p.k]), sel ? 2 : 1.5);
    }
    for (const p of [tv.start, tv.end]) if (p) {
      const [x, y] = this.toScreen(p.x, p.y);
      ctx.fillStyle = p === tv.start ? "#7bd88f" : "#ef6f6c"; ctx.strokeStyle = "#18212a"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    if (show) for (const trip of tv.trips || []) {
      const at = tripAt(trip, T);
      if (!at) continue;
      const keep = tv.cfg.keepDays;
      let alpha = 1;
      if (at.state === "before") alpha = 0.5;
      if (at.state === "after") { alpha = 1 - (T - trip.timeline.arriveT) / keep; if (alpha <= 0) { if (tv.selId !== trip.id) continue; alpha = 0.25; } }
      const r = trip.route, col = trip.color || "#e8833a", sel = tv.selId === trip.id;
      ctx.globalAlpha = Math.max(0.15, alpha);
      // travelled: solid; ahead: dashed
      const k = at.state === "before" ? 0 : at.state === "after" ? r.length - 1 : at.i;
      if (k > 0 || at.state === "on") {
        line(r.slice(0, k + 1).concat(at.state === "on" ? [[at.x, at.y]] : []));
        ctx.strokeStyle = "rgba(10,14,20,0.55)"; ctx.lineWidth = 5.5; ctx.stroke();
        ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke();
      }
      if (at.state !== "after") {
        line([[at.x, at.y]].concat(r.slice(k + 1)));
        ctx.strokeStyle = "rgba(10,14,20,0.5)"; ctx.lineWidth = 5; ctx.stroke();
        ctx.setLineDash([7, 5]); ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke(); ctx.setLineDash([]);
      }
      this._trBoats(r, 1.5);
      if (sel && trip.mine && trip.events && tv.evMarks) tv.evMarks(trip, T);
      // the token
      const [x, y] = this.toScreen(at.x, at.y);
      ctx.fillStyle = col; ctx.strokeStyle = sel ? "#ffe08a" : "#fff"; ctx.lineWidth = sel ? 3 : 2;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#18212a"; ctx.font = "700 11px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText((trip.name || "?").trim().charAt(0).toUpperCase(), x, y + 0.5);
      const label = trip.name || "";
      if (label) {
        ctx.font = "600 12px system-ui, sans-serif";
        const w = ctx.measureText(label).width + 10;
        ctx.fillStyle = "rgba(24,33,42,0.85)"; ctx.fillRect(x + 12, y - 9, w, 18);
        ctx.fillStyle = "#f3ead8"; ctx.textAlign = "left"; ctx.fillText(label, x + 17, y + 0.5);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (tv.onDraw) tv.onDraw(T);
  };

  /** The stretches of a route by boat ([x, y, kind] points): a white dotted line along them (blue-white at sea). */
  P._trBoats = function (pts, w) {
    const ctx = this.ctx;
    for (let i = 0; i + 1 < pts.length; i++) {
      const k = pts[i][2];
      if (!MODE_OF(k)) continue;
      let e = i;
      while (e + 1 < pts.length && MODE_OF(pts[e][2]) === MODE_OF(k)) e++;
      ctx.beginPath();
      for (let q = i; q <= e; q++) { const [x, y] = this.toScreen(pts[q][0], pts[q][1]); q === i ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.setLineDash([2, 5]); ctx.lineWidth = w; ctx.strokeStyle = k === 5 ? "#d8f0ff" : "#ffffff"; ctx.stroke(); ctx.setLineDash([]);
      i = e - 1;
    }
  };
  const fmtH = (h) => (Math.round(h * 10) / 10).toLocaleString();
  const newSeed = () => (crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 4294967296)) || 1;
  // ── the panel ──
  const Travel = {
    ctx: null,
    init(ctx) {
      this.ctx = ctx;
      const fm = ctx.fieldMap;
      this.fm = fm;
      ASPECT = (fm.imgH || 1) / (fm.imgW || 2);
      this.tv = fm._travel = { trips: [], candidates: null, start: null, end: null, chosen: null, panelOpen: false, cfg: this.cfg(), selId: null,
        onDraw: (T) => { this._checkEvents(T); this._onTime(T); }, evMarks: (trip, T) => this._drawEvents(trip, T) };
      this.evOpen = new Set();
      fm.roadSteep = this.cfg().steep;
      this.fieldCache = new Map();
      this._wire();
    },
    /**
     * The rules in force for this user: the built-in values, then world/travel.yaml, then what the admins
     * saved for everyone, then the user's own changes (⚙).
     */
    cfg() { return merge(this.common(), this._own()); },
    /** The rules everyone starts from (without the user's own changes). */
    common() {
      const w = this.ctx && this.ctx.S.world && this.ctx.S.world.travel;
      return merge(merge(DEFAULTS, w && w.file), upgrade(w && w.admin));
    },
    _own() { return upgrade(this.ctx && this.ctx.S.travel); },
    roadsChanged() { this._grid = null; if (this.terrainOn) this.tv.terrain = null; },
    $(id) { return document.getElementById(id); },
    T(...a) { return this.ctx.T(...a); },

    // the app's map changed: its journeys
    async load() {
      const { S, api } = this.ctx;
      ASPECT = (this.fm.imgH || 1) / (this.fm.imgW || 2);
      this.tv.cfg = this.cfg(); this.fm.roadSteep = this.tv.cfg.steep;      // the world's rules may have arrived since
      this.tv.trips = [];
      this.tv.candidates = null; this.tv.start = this.tv.end = null;
      this._grid = null;
      if (!S.map) { this.render(); return; }
      try {
        const d = await api("GET", `/maps/${S.map.id}/trips?v=${Date.now()}`);
        this.tv.trips = (d.trips || []).filter((t) => t.route && t.timeline);
        // own journeys with events and delays from before 2.16 have no plan yet: worked out (and saved) in the background
        for (const t of this.tv.trips) if (t.mine && t.events && !t.plan && t.delays && t.delays.length)
          this._ensurePlan(t).then(() => this._save(t)).then(() => { this.renderList(); this.fm.draw(); }).catch(() => {});
      } catch (e) { this.tv.trips = []; }
      this.fm.draw();
      this.render();
    },

    open() {
      this.tv.panelOpen = true;
      this.$("trPanel").hidden = false;
      this.$("travelBtn").classList.add("active");
      this.render();
      this.fm.draw();
    },
    close() {
      this.tv.panelOpen = false;
      this._stopPicking();
      this.tv.candidates = null; this.tv.start = this.tv.end = null; this.tv.chosen = null;
      this.$("trPanel").hidden = true;
      this.$("travelBtn").classList.remove("active");
      this.fm.draw();
    },

    // planning: pick the start and the end on the map
    startPlanning() {
      const tv = this.tv;
      tv.candidates = null; tv.start = tv.end = null; tv.chosen = null;
      this.picking = "start";
      this.fm.mapTool = {
        click: (nx, ny) => {
          if (this.picking === "start") { tv.start = { x: nx, y: ny }; this.picking = "end"; this.render(); this.fm.draw(); return true; }
          if (this.picking === "end") { tv.end = { x: nx, y: ny }; this.picking = null; this.fm.draw(); this._plan(); return true; }
          if (tv.candidates) {                       // a click on one of the two routes chooses it
            const c = this._candidateNear(nx, ny);
            if (c) { tv.chosen = c.mode; this.renderCands(); this.fm.draw(); return true; }
          }
          return false;
        },
        context: () => { if (this.picking === "end") { tv.start = null; this.picking = "start"; this.render(); this.fm.draw(); } else this._stopPicking(true); },
      };
      this.$("stage").classList.add("picking");
      this.render();
    },
    _stopPicking(clear) {
      this.picking = null;
      if (this.fm.mapTool && !this.tv.candidates) this.fm.mapTool = null;
      if (clear) { this.fm.mapTool = null; this.tv.candidates = null; this.tv.start = this.tv.end = null; this.tv.chosen = null; }
      this.$("stage").classList.remove("picking");
      this.render(); this.fm.draw();
    },
    _candidateNear(nx, ny) {
      const fm = this.fm, [sx, sy] = fm.toScreen(nx, ny);
      let best = null, bd = 12;
      for (const c of this.tv.candidates || []) for (let i = 0; i + 1 < c.pts.length; i++) {
        const [ax, ay] = fm.toScreen(c.pts[i].x, c.pts[i].y), [bx, by] = fm.toScreen(c.pts[i + 1].x, c.pts[i + 1].y);
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? clamp(((sx - ax) * dx + (sy - ay) * dy) / L, 0, 1) : 0;
        const d = Math.hypot(ax + dx * t - sx, ay + dy * t - sy);
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    },
    async _plan() {
      const tv = this.tv, cfg = this.cfg(), fm = this.fm, { S } = this.ctx;
      this.msg(this.T("trWorking"));
      await new Promise((r) => setTimeout(r, 30));
      this._ensureGrid();
      if (this.terrainOn && !tv.terrain) this.showTerrain(true);
      if (!this._grid) { this.msg(this.T("trNoHeight")); this._stopPicking(true); return; }
      const pace = cfg.pace.normal;
      const out = [], opt = { ferry: !!this.ferry, sea: !!this.sea, boats: this.ferry ? this._ensureBoats() : null,
        hours: clamp(+String(this._lastHours || cfg.hoursPerDay).replace(",", ".") || cfg.hoursPerDay, 0.5, 24) };
      for (const mode of ["fast", "easy", "short", "safe"]) {
        let r = findRoute(fm, this._grid, this._roads, tv.start, tv.end, mode, cfg, pace, opt);
        // Säkrast may not take more than maxTimes the time of Snabbast: otherwise ease the extra caution
        // off (halving the gap each time) until it fits; at nothing it is Snabbast itself
        const fast = out.find((o) => o.mode === "fast");
        if (r && mode === "safe" && fast && fast.hours > 0 && r.hours > cfg.safe.maxTimes * fast.hours) {
          let lo = 0, hi = 1, best = null;
          for (let i = 0; i < 5; i++) {
            const mid = (lo + hi) / 2, q = findRoute(fm, this._grid, this._roads, tv.start, tv.end, "safe", cfg, pace, { ...opt, safeScale: mid });
            if (q && q.hours <= cfg.safe.maxTimes * fast.hours) { lo = mid; best = q; } else hi = mid;
          }
          r = best || fast;
        }
        if (r) out.push({ mode, ...r, sum: routeSummary(fm, r.pts, this._grid.rivers, cfg, opt.ferry) });
      }
      if (!out.length) { this.msg(this.T(opt.sea ? "trNoWayAtAll" : "trNoWay")); tv.end = null; this.picking = "end"; this.render(); fm.draw(); return; }
      // the same route twice (no roads, flat ground): one is enough
      // (the card then carries both names: "Snabbast och Lättast")
      for (let i = out.length - 1; i > 0; i--) {
        const same = out.slice(0, i).find((o) => Math.abs(o.km - out[i].km) < 0.5);
        if (same) { (same.also = same.also || []).unshift(out[i].mode); out.splice(i, 1); }
      }
      tv.candidates = out; tv.chosen = out[0].mode;
      this._planned = { ferry: opt.ferry, sea: opt.sea };
      this.msg("");
      this.render(); fm.draw();
      await this._etas();
    },
    /** How long each suggested route takes at a normal pace and the hours a day chosen, with the weather along the way. */
    async _etas() {
      const tv = this.tv, cfg = this.cfg(), run = (this._etaRun = (this._etaRun || 0) + 1);
      const hours = clamp(+String(this._lastHours || cfg.hoursPerDay).replace(",", ".") || cfg.hoursPerDay, 0.5, 24);
      for (const c of tv.candidates || []) c.eta = null;
      if (this.$("trCands")) this.renderCands(); else this.render();
      for (const c of tv.candidates || []) {
        const trip = this._tripFrom(c, { pace: cfg.pace.normal, startT: this.fm.T || 0 });
        trip.hoursPerDay = hours;
        const tl = await this._timeline(trip);
        if (run !== this._etaRun) return;                         // the hours were changed meanwhile
        c.eta = tl;
        this.renderCands();
      }
    },
    _tripFrom(c, o) {
      return { route: c.pts.map((p) => (p.c != null ? [+p.x.toFixed(6), +p.y.toFixed(6), p.k, +p.c.toFixed(2)] : [+p.x.toFixed(6), +p.y.toFixed(6), p.k])), startT: o.startT, pace: o.pace,
        dayStart: o.dayStart != null ? o.dayStart : this.cfg().dayStart, offset: this.fm.spotOffset ? this.fm.spotOffset(c.pts[0].x) : 0, delays: o.delays || [],
        ...(this._planned && this._planned.ferry ? { ferry: true } : {}), ...(this._planned && this._planned.sea ? { sea: true } : {}) };
    },
    /** The journey's hour-by-hour progress, fetching the days' weather it needs. */
    async _timeline(trip) {
      const cfg = this.cfg(), { fetchField, climateFor } = this.ctx;
      for (let tries = 0; tries < 400; tries++) {
        const res = simulate(this.fm, trip, cfg, (serial) => (this.fieldCache.has(serial) ? this.fieldCache.get(serial) : undefined), climateFor);
        if (res.need == null) return res;
        // the next few days' weather at once
        const want = [];
        for (let s = res.need; s < res.need + 6; s++) if (!this.fieldCache.has(s)) want.push(s);
        await Promise.all(want.map((s) => fetchField(s).then((f) => this.fieldCache.set(s, f)).catch(() => this.fieldCache.set(s, null))));
      }
      return simulate(this.fm, trip, cfg, (s) => this.fieldCache.get(s) || null, climateFor);
    },

    async startTrip() {
      const tv = this.tv, c = (tv.candidates || []).find((x) => x.mode === tv.chosen);
      if (!c) return;
      const { S, api } = this.ctx, cfg = this.cfg();
      const name = this.$("trName").value.trim() || this.T("trDefaultName");
      const paceSel = this.$("trPace").value, pace = paceSel === "custom" ? Math.max(0.5, +this.$("trPaceNum").value || cfg.pace.normal) : cfg.pace[paceSel] || cfg.pace.normal;
      const dayStart = clamp(+this.$("trDayStart").value || cfg.dayStart, 0, 23.99);
      const hoursPerDay = clamp(+String(this.$("trHours").value).replace(",", ".") || cfg.hoursPerDay, 0.5, 24);
      const trip = this._tripFrom(c, { pace, startT: this.fm.T || 0, dayStart });
      trip.hoursPerDay = hoursPerDay;
      trip.name = name; trip.shared = this.$("trShared").checked; trip.mode = c.mode;
      if (this.$("trEvents").checked) { trip.events = true; trip.seed = newSeed(); }
      trip.color = COLOURS[(tv.trips.length) % COLOURS.length];
      this.msg(this.T("trWorking"));
      const tl = await this._timeline(trip);
      trip.timeline = { km: tl.km.map((v) => +v.toFixed(3)), total: +tl.total.toFixed(3), arriveT: tl.arriveT };
      trip.plan = trip.timeline;                 // the journey as planned, without delays (the events belong to it)
      const body = { ...trip }; delete body._samples; delete body._cum; delete body._fords; delete body._ev; delete body._evKey;
      try {
        const r = await api("POST", `/maps/${S.map.id}/trips`, body);
        trip.id = r.id; trip.mine = true; trip.owner = S.user && S.user.username;
        tv.trips.push(trip);
        tv.selId = trip.id;
      } catch (e) { this.msg(this.T("saveFailed") + e.message); return; }
      tv.candidates = null; tv.start = tv.end = null; tv.chosen = null;
      this.fm.mapTool = null; this.$("stage").classList.remove("picking");
      this.msg(this.T("trStarted", name, this.ctx.fmtT(trip.timeline.arriveT)));
      this.render(); this.fm.draw();
    },
    async _save(trip) {
      const { S, api } = this.ctx, body = { ...trip };
      for (const k of ["_samples", "_cum", "_fords", "_ev", "_evKey", "id", "mine", "owner"]) delete body[k];
      await api("PUT", `/maps/${S.map.id}/trips/${trip.id}`, body);
    },
    async addDelay(trip) {
      const v = await this.ctx.ask({ title: this.T("trDelay"), text: this.T("trDelayText", trip.name), input: { label: this.T("trDelayHours"), type: "number" }, buttons: [{ id: "ok", label: this.T("trDelay"), primary: true }] });
      const hours = +String(v == null ? "" : v).replace(",", ".");
      if (!(hours > 0)) return;
      const T = this.fm.T || 0;
      trip.delays = (trip.delays || []).concat([{ at: Math.max(T, trip.startT), hours, clock: true }]);
      await this._recompute(trip);
    },
    async removeDelay(trip, i) {
      trip.delays.splice(i, 1);
      await this._recompute(trip);
    },
    /** The journey as planned without its delays (for journeys started before 2.16 with delays: worked out now). */
    async _ensurePlan(trip) {
      if (trip.plan) return;
      if (!(trip.delays && trip.delays.length)) { trip.plan = trip.timeline; return; }
      const tl = await this._timeline({ ...trip, delays: [] });
      trip.plan = { km: tl.km.map((v) => +v.toFixed(3)), total: +tl.total.toFixed(3), arriveT: tl.arriveT };
    },
    async _recompute(trip) {
      this.msg(this.T("trWorking"));
      trip._samples = null; trip._fords = null;
      await this._ensurePlan(trip);
      const tl = await this._timeline(trip);
      trip.timeline = { km: tl.km.map((v) => +v.toFixed(3)), total: +tl.total.toFixed(3), arriveT: tl.arriveT };
      try { await this._save(trip); this.msg(this.T("trArrives", trip.name, this.ctx.fmtT(trip.timeline.arriveT))); }
      catch (e) { this.msg(this.T("saveFailed") + e.message); }
      this.render(); this.fm.draw();
    },
    async deleteTrip(trip) {
      if (!(await this.ctx.ask({ title: this.T("trDelete"), text: this.T("trDeleteText", trip.name), buttons: [{ id: "yes", label: this.T("trDelete"), primary: true }] }))) return;
      const { S, api } = this.ctx;
      try { await api("DELETE", `/maps/${S.map.id}/trips/${trip.id}`); } catch (e) { this.msg(this.T("saveFailed") + e.message); return; }
      this.tv.trips = this.tv.trips.filter((t) => t !== trip);
      this.render(); this.fm.draw();
    },
    // ── events (events.js): the rules, the popup when the clock gets there, and the owner's look ahead ──
    evRules() {
      const S = this.ctx.S, E = S.world && S.world.events;
      const key = JSON.stringify(E || null);
      if (this._evRulesKey !== key) { this._evR = window.TravelEvents ? TravelEvents.rules(S.world) : null; this._evRulesKey = key; this._evRulesN = (this._evRulesN || 0) + 1; }
      return this._evR;
    },
    _events(trip) {
      const R = this.evRules();
      return R ? TravelEvents.events(this.fm, trip, R, this._evRulesN) : [];
    },
    async toggleEvents(trip, on) {
      trip.events = on;
      if (on && !trip.seed) trip.seed = newSeed();
      if (on) await this._ensurePlan(trip);
      if (on) { const now = this.fm.T || 0; trip.eventsSeen = this._events(trip).filter((e) => e.t <= now).map((e) => e.slot); }   // what is already past doesn't pop up
      try { await this._save(trip); } catch (e) { this.msg(this.T("saveFailed") + e.message); }
      this.renderList(); this.fm.draw();
    },
    /** Called on every frame: events of the user's own journeys that the clock has just passed. */
    _checkEvents(T) {
      // while a box is open nothing moves on: what the clock passes meanwhile is caught when it closes
      if (this._evBusy || !window.TravelEvents) return;
      const prev = this._evLastT;
      this._evLastT = T;
      if (prev == null || T <= prev) return;               // the first frame, or the clock went back
      const due = [];
      for (const trip of this.tv.trips) {
        if (!trip.mine || !trip.events || !trip.timeline) continue;
        const seen = new Set(trip.eventsSeen || []);
        for (const e of this._events(trip)) if (e.t > prev && e.t <= T && !seen.has(e.slot)) due.push({ trip, e });
      }
      if (!due.length) return;
      due.sort((a, b) => a.e.t - b.e.t);
      this._evBusy = true;
      const wasPlaying = this.ctx.pause ? this.ctx.pause() : false;
      (due.length === 1 ? this._eventPopup(due[0], wasPlaying) : this._eventSummary(due)).finally(() => { this._evBusy = false; });
    },
    _evText(trip, e) {
      const T = (...a) => this.T(...a);
      const where = e.names.length ? e.names.join(", ") : T("evPlain");
      const how = e.kind === 5 ? T("evAtSea") : (e.kind === 4 || e.kind === 6 || e.kind === 7) ? T("evOnRiver") : "";
      return T("evText", trip.name || "?", this._evTime(trip, e), T(e.night ? "evNight" : "evDay"), where + (how ? " · " + how : ""), e.a, e.b);
    },
    /** An event's time in the journey's local time (where it started), which day and night follow. */
    _evTime(trip, e) {
      return this.ctx.fmtT(e.t + (trip.offset || 0) / 24) + " " + this.T("evLocal");
    },
    _markSeen(list) {
      const byTrip = new Map();
      for (const { trip, e } of list) { (byTrip.get(trip) || byTrip.set(trip, []).get(trip)).push(e.slot); }
      for (const [trip, slots] of byTrip) {
        trip.eventsSeen = [...new Set([...(trip.eventsSeen || []), ...slots])];
        this._save(trip).catch((err) => this.msg(this.T("saveFailed") + err.message));
      }
    },
    async _eventPopup({ trip, e }, wasPlaying) {
      this.tv.selId = trip.id;
      this._centre(e.x, e.y);
      const pick = await this.ctx.ask({ title: this.T("evTitle"), text: this._evText(trip, e),
        buttons: [{ id: "show", label: this.T("evShow") }, { id: "delay", label: this.T("trDelay") + "…" }, { id: "go", label: this.T("evContinue"), primary: true }], cancel: false });
      this._markSeen([{ trip, e }]);
      if (pick === "show") { this._centre(e.x, e.y); if (!this.tv.panelOpen) this.open(); this.render(); }
      else if (pick === "delay") await this.addDelay(trip);
      else if (wasPlaying && this.ctx.play) this.ctx.play();
      this.renderList();
    },
    async _eventSummary(due) {
      const T = (...a) => this.T(...a);
      const text = T("evMany", due.length) + "\n\n" + due.map(({ trip, e }) => "• " + this._evText(trip, e)).join("\n");
      const pick = await this.ctx.ask({ title: T("evManyTitle"), text, buttons: [{ id: "show", label: T("evShowFirst") }, { id: "go", label: T("evContinue"), primary: true }], cancel: false });
      this._markSeen(due);
      if (pick === "show") { this.tv.selId = due[0].trip.id; this._centre(due[0].e.x, due[0].e.y); if (!this.tv.panelOpen) this.open(); this.render(); }
      this.renderList();
    },
    _centre(x, y) {
      const fm = this.fm, s = Math.max(fm.view.s, Math.min(fm.cssW / fm.imgW, fm.cssH / fm.imgH) * 4);
      fm.view = { s, ox: fm.cssW / 2 - x * fm.imgW * s, oy: fm.cssH / 2 - y * fm.imgH * s };
      fm.userMoved = true;
      fm.draw();
    },
    /** The owner's look ahead: the journey's events, past ones ticked, coming ones with "Slå om". */
    _eventList(trip, now) {
      const T = (...a) => this.T(...a), box = document.createElement("div"); box.className = "ev-list";
      const evs = this._events(trip);
      const note = document.createElement("p"); note.className = "tr-note"; note.textContent = evs.length ? T("evAheadNote") : T("evNone"); box.append(note);
      const ol = document.createElement("ol"), seen = new Set(trip.eventsSeen || []);
      for (const e of evs) {
        const li = document.createElement("li"), past = e.t <= now;
        li.className = past ? "past" : "";
        // ticked: it pops up when the clock gets there (cleared once it has; tick it again to see it again)
        const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !seen.has(e.slot); cb.title = T("evPopTip");
        cb.onchange = () => this.setEventPopup(trip, e.slot, cb.checked);
        li.append(cb);
        const txt = document.createElement("span");
        txt.textContent = this._evTime(trip, e) + " · " + T(e.night ? "evNight" : "evDay") + " · " + (e.names.length ? e.names.join(", ") : T("evPlain")) + " · " + T("evChance", e.a, e.b);
        li.append(txt);
        const go = document.createElement("button"); go.type = "button"; go.className = "tiny"; go.textContent = T("evShow");
        go.onclick = () => { this.tv.selId = trip.id; this._centre(e.x, e.y); };
        li.append(go);
        if (!past) {
          const rr = document.createElement("button"); rr.type = "button"; rr.className = "tiny"; rr.textContent = T("evReroll"); rr.title = T("evRerollTip");
          rr.onclick = () => this.reroll(trip, e);
          li.append(rr);
        }
        ol.append(li);
      }
      box.append(ol);
      return box;
    },
    async setEventPopup(trip, slot, on) {
      const seen = new Set(trip.eventsSeen || []);
      if (on) seen.delete(slot); else seen.add(slot);
      trip.eventsSeen = [...seen];
      try { await this._save(trip); } catch (err) { this.msg(this.T("saveFailed") + err.message); }
    },
    async reroll(trip, e) {
      trip.rerolls = { ...(trip.rerolls || {}) };
      trip.rerolls[e.slot] = (trip.rerolls[e.slot] || 0) + 1;
      try { await this._save(trip); } catch (err) { this.msg(this.T("saveFailed") + err.message); }
      this.renderList(); this.fm.draw();
    },
    /** On the map: the chosen journey's coming events (for its owner), as small red marks along its route. */
    _drawEvents(trip, T) {
      const ctx = this.fm.ctx;
      for (const e of this._events(trip)) {
        if (e.t <= T) continue;
        const [x, y] = this.fm.toScreen(e.x, e.y);
        ctx.save();
        ctx.translate(x, y); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = "#ef4f4f"; ctx.strokeStyle = "#18212a"; ctx.lineWidth = 1.5;
        ctx.fillRect(-4.5, -4.5, 9, 9); ctx.strokeRect(-4.5, -4.5, 9, 9);
        ctx.restore();
      }
    },
    /** The event rules: everyone can read them; admins can save their own version for everyone (or go back to the file). */
    async editEventRules() {
      const { S, api } = this.ctx, T = (k, ...a) => this.T(k, ...a), E = (S.world && S.world.events) || {};
      const dlg = this.$("evRules"), ta = this.$("evRulesText");
      const src = E.admin ? "admin" : E.file && E.file.yaml ? "file" : "none";
      ta.value = (E.admin && E.admin.yaml) || (E.file && E.file.yaml) || "";
      ta.readOnly = !S.admin;
      const err = (E.admin && E.admin.error) || (!E.admin && E.file && E.file.error);
      this.$("evRulesSource").textContent = T("evSrc_" + src) + (err ? " " + T("evRulesBad", err) : "");
      for (const id of ["evRulesSave", "evRulesReset"]) this.$(id).hidden = !S.admin;
      this.$("evRulesReset").disabled = !E.admin;
      this.$("evRulesMsg").textContent = "";
      dlg.returnValue = "";
      dlg.showModal();
      const run = async (fn) => {
        try { const r = await fn(); S.world.events = r; this._evRulesKey = null; this.renderList(); this.fm.draw(); dlg.close("done"); this.msg(T("evRulesSaved")); }
        catch (e) { this.$("evRulesMsg").textContent = e.message; }
      };
      this.$("evRulesSave").onclick = (ev) => { ev.preventDefault(); run(() => api("PUT", "/events", new Blob([ta.value], { type: "text/plain" }), "text/plain")); };
      this.$("evRulesReset").onclick = (ev) => { ev.preventDefault(); run(() => api("DELETE", "/events")); };
    },
    async toggleShared(trip, on) {
      trip.shared = on;
      try { await this._save(trip); } catch (e) { this.msg(this.T("saveFailed") + e.message); }
    },
    focus(trip) {
      const at = tripAt(trip, this.fm.T || 0);
      if (!at) return;
      this.tv.selId = trip.id;
      const fm = this.fm, s = Math.max(fm.view.s, Math.min(fm.cssW / fm.imgW, fm.cssH / fm.imgH) * 4);
      fm.view = { s, ox: fm.cssW / 2 - at.x * fm.imgW * s, oy: fm.cssH / 2 - at.y * fm.imgH * s };
      fm.userMoved = true;
      fm.draw(); this.render();
    },

    // ── settings (the ⚙): every number of the rules ──
    async editSettings() {
      const cfg = this.cfg(), T = (k) => this.T(k);
      const rows = [
        ["pace.slow", T("trSetSlow")], ["pace.normal", T("trSetNormal")], ["pace.fast", T("trSetFast")],
        ["road.path", T("trSetPath")], ["road.road", T("trSetRoad")], ["road.highway", T("trSetHighway")],
        ["offRoad", T("trSetOffRoad")], ["riverHoursPerSize", T("trSetRiver")], ["forestPer25", T("trSetForest")], ["marshPer25", T("trSetMarsh")], ["bad", T("trSetBad")], ["veryBad", T("trSetVeryBad")], ["snow", T("trSetSnow")],
        ["slopeUp", T("trSetUp")], ["slopeDown", T("trSetDown")], ["minSpeed", T("trSetMin")],
        ["badRain", T("trSetBadRain")], ["badWind", T("trSetBadWind")], ["veryBadRain", T("trSetVeryBadRain")], ["veryBadWind", T("trSetVeryBadWind")],
        ["hoursPerDay", T("trSetHours")], ["dayStart", T("trSetStart")], ["keepDays", T("trSetKeep")],
        ["steep.path", T("trSetSteepPath")], ["steep.road", T("trSetSteepRoad")], ["steep.highway", T("trSetSteepHighway")],
        ["boat.still", T("trSetBoatStill")], ["boat.downShare", T("trSetBoatShare")], ["boat.minUp", T("trSetBoatMinUp")], ["boatMinFlow", T("trSetBoatMin")],
        ["sea.normal", T("trSetSeaNormal")], ["sea.good", T("trSetSeaGood")], ["sea.bad", T("trSetSeaBad")],
        ["wiggle", T("trSetWiggle")], ["safe.off", T("trSetSafeOff")], ["safe.perKm", T("trSetSafePerKm")], ["safe.max", T("trSetSafeMax")], ["safe.nation", T("trSetSafeNation")], ["safe.path", T("trSetSafePath")], ["safe.forest", T("trSetSafeForest")], ["safe.maxTimes", T("trSetSafeMaxTimes")], ["windGood", T("trSetWindGood")], ["windCalm", T("trSetWindCalm")], ["seaAllDay", T("trSetSeaAllDay")], ["boardHours", T("trSetBoard")],
      ];
      const get = (k) => k.split(".").reduce((o, p) => o[p], cfg);
      const dlg = this.$("trSettings"), body = this.$("trSettingsBody");
      body.innerHTML = "";
      for (const [k, label] of rows) {
        const lab = document.createElement("label"); lab.className = "tr-set";
        const span = document.createElement("span"); span.textContent = label;
        const inp = document.createElement("input"); inp.type = "number"; inp.step = "0.05"; inp.value = get(k); inp.dataset.key = k;
        lab.append(span, inp); body.append(lab);
      }
      // where the values come from, and the admins' buttons
      const S = this.ctx.S, w = S.world && S.world.travel;
      this.$("trSetSource").textContent = T(S.travel ? "trSrcOwn" : w && w.admin ? "trSrcAdmin" : "trSrcFile");
      for (const id of ["trSaveAll", "trResetAll"]) this.$(id).hidden = !S.admin;
      this.$("trResetAll").disabled = !(w && w.admin);
      dlg.returnValue = "";
      dlg.showModal();
      const res = await new Promise((resolve) => { dlg.onclose = () => resolve(dlg.returnValue); });
      const read = () => {
        const out = copy(cfg);
        for (const inp of body.querySelectorAll("input")) {
          const v = +String(inp.value).replace(",", ".");
          if (!Number.isFinite(v)) continue;
          const ks = inp.dataset.key.split(".");
          if (ks.length === 2) out[ks[0]][ks[1]] = v; else out[ks[0]] = v;
        }
        return out;
      };
      if (res === "events") { this.editEventRules(); return; }
      if (res === "reset") { S.travel = null; }
      else if (res === "ok") { const out = read(); out.v = 4; S.travel = out; }
      else if (res === "all" || res === "allreset") {
        // for everyone: saved on the server (the admin's own changes go, so they see what everyone sees)
        try {
          const r = res === "all" ? await this.ctx.api("PUT", "/travel", { ...read(), v: 4 }) : await this.ctx.api("DELETE", "/travel");
          if (S.world) S.world.travel = r;
          S.travel = null;
          this.msg(T(res === "all" ? "trSavedAll" : "trResetAllDone"));
        } catch (e) { this.msg(T("saveFailed") + e.message); return; }
      } else return;
      this.ctx.saveState();
      this.tv.cfg = this.cfg();
      this.fm.roadSteep = this.tv.cfg.steep;
      this._grid = null;
      this.fm.draw(); this.render();
    },

    msg(t) { const el = this.$("trMsg"); if (el) el.textContent = t || ""; },
    /** The grid the routes are found on, for the date shown (made again when the date or the heights change). */
    _ensureGrid() {
      const fm = this.fm, serial = Math.floor(fm.T || 0);
      const rivSig = (fm.rivers || []).length + ":" + (fm.rivers || []).reduce((a, r) => a + r.points.length + r.size, 0);
      const key = serial + ":" + (fm.heightGrid() || {}).key + ":" + JSON.stringify(this.cfg().steep) + ":" + (fm._lyrRev || 0);
      if (!this._grid || this._gridKey !== key) {
        const climate = this.ctx.climateFor(serial);
        this._grid = buildGrid(fm, climate);
        this._roads = this._grid ? buildRoads(fm, this._grid, climate) : null;
        this._gridKey = key;
        this.tv.terrain = null;
      }
      if (this._grid && this._rivSig !== rivSig) { this._grid.rivers = riverIndex(fm); this._rivSig = rivSig; }
      return this._grid;
    },
    /** The river boats' network (made again when the rivers or the smallest river boats take change). */
    _ensureBoats() {
      const G = this._ensureGrid(), fm = this.fm, cfg = this.cfg();
      if (!G) return null;
      const key = this._gridKey + "|" + this._rivSig + "|" + cfg.boatMinFlow + "|" + (fm.rivers || []).map((r) => (r.speed == null ? "" : r.speed)).join(",");
      if (!this._boats || this._boatsKey !== key) { this._boats = buildBoats(fm, G, cfg.boatMinFlow); this._boatsKey = key; }
      return this._boats;
    },
    /**
     * Shows (or hides) how hard the ground is to cross off the roads, at a normal pace with no weather:
     * see-through where it's easy, then yellow, orange, red and dark purple (below 0.5 km/h).
     */
    async showTerrain(on) {
      this.terrainOn = on;
      if (!on) { this.tv.terrain = null; this.fm.draw(); return; }
      this.msg(this.T("trWorking"));
      await new Promise((r) => setTimeout(r, 20));
      const G = this._ensureGrid();
      if (!G) { this.msg(this.T("trNoHeight")); return; }
      const cfg = this.cfg(), pace = cfg.pace.normal, cv = document.createElement("canvas");
      cv.width = G.gw; cv.height = G.gh;
      const c = cv.getContext("2d"), img = c.createImageData(G.gw, G.gh), px = img.data;
      for (let k = 0; k < G.n; k++) {
        if (G.water[k]) continue;
        const v = speedAt(cfg, pace, 0, G.forest[k], CROSS * G.steep[k], G.snow[k], 0, G.marsh[k]);
        const col = v >= pace - cfg.offRoad - 0.3 ? null : v >= 2 ? [240, 220, 80, 110] : v >= 1 ? [245, 150, 50, 170] : v >= 0.5 ? [220, 40, 40, 210] : [110, 20, 120, 230];
        if (!col) continue;
        px.set(col, k * 4);
      }
      c.putImageData(img, 0, 0);
      this.tv.terrain = cv;
      this.msg(this.T("trTerrainShown"));
      this.fm.draw();
    },
    _onTime(T) {
      if (!this.tv.panelOpen) return;
      const k = Math.floor(T * 96);                                  // every quarter of an hour of the app's clock
      if (k === this._lastK) return;
      this._lastK = k;
      clearTimeout(this._rt); this._rt = setTimeout(() => this.renderList(), 50);
    },
    render() {
      if (!this.ctx) return;
      const tv = this.tv, T = (...a) => this.T(...a), { S } = this.ctx, cfg = this.cfg();
      const plan = this.$("trPlan");
      plan.innerHTML = "";
      const btn = (label, fn, primary) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; if (primary) b.className = "primary"; b.onclick = fn; return b; };
      const p = (text, cls) => { const e = document.createElement("p"); e.textContent = text; e.className = cls || "tr-note"; return e; };
      if (!S.user) plan.append(p(T("trLogin")));
      else if (this.picking) {
        plan.append(p(T(this.picking === "start" ? "trPickStart" : "trPickEnd")), btn(T("cancel"), () => this._stopPicking(true)));
      } else if (tv.candidates) {
        const list = document.createElement("div"); list.className = "tr-cands"; list.id = "trCands";
        plan.append(list);
        this.renderCands();
        // the journey's details
        const form = document.createElement("div"); form.className = "tr-form";
        form.innerHTML = `
          <label class="field slim"><span></span><input type="text" id="trName" maxlength="80"></label>
          <label class="field slim"><span></span><select id="trPace"></select><input type="number" id="trPaceNum" class="num-small" step="0.5" min="0.5" hidden></label>
          <label class="field slim"><span></span><input type="number" id="trDayStart" class="num-small" min="0" max="23" step="0.5"></label>
          <label class="field slim"><span></span><input type="number" id="trHours" class="num-small" min="1" max="24" step="0.5"></label>
          <label class="check"><input type="checkbox" id="trShared"><span></span></label>
          <label class="check"><input type="checkbox" id="trEvents"><span></span></label>`;
        const sp = form.querySelectorAll("label > span");
        sp[0].textContent = T("trName"); sp[1].textContent = T("trPace"); sp[2].textContent = T("trDayStart"); sp[3].textContent = T("trHours"); sp[4].textContent = T("trShared"); sp[5].textContent = T("evSwitch");
        sp[5].parentElement.title = T("evSwitchTip");
        sp[3].parentElement.title = T("trHoursTip");
        plan.append(form);
        const sel = this.$("trPace");
        for (const [v, k] of [["slow", "trSlow"], ["normal", "trNormal"], ["fast", "trFastPace"], ["custom", "trCustom"]])
          sel.add(new Option(v === "custom" ? T(k) : T(k, cfg.pace[v]), v));
        sel.value = "normal";
        sel.onchange = () => { this.$("trPaceNum").hidden = sel.value !== "custom"; };
        this.$("trPaceNum").value = cfg.pace.normal;
        this.$("trDayStart").value = cfg.dayStart;
        this.$("trHours").value = this._lastHours || cfg.hoursPerDay;
        this.$("trHours").oninput = (e) => { this._lastHours = e.target.value; };
        this.$("trHours").onchange = () => (this.sea && this.cfg().seaAllDay ? this._plan() : this._etas());
        this.$("trEvents").checked = !!this._lastEvents;
        this.$("trEvents").onchange = (e) => { this._lastEvents = e.target.checked; };
        this.$("trName").value = this._lastName || "";
        this.$("trName").oninput = (e) => { this._lastName = e.target.value; };
        const row = document.createElement("div"); row.className = "tr-row";
        row.append(btn(T("trStart"), () => this.startTrip(), true), btn(T("trAgain"), () => this.startPlanning()), btn(T("cancel"), () => this._stopPicking(true)));
        plan.append(row);
        plan.append(p(T("trDeparts", this.ctx.fmtT(this.fm.T || 0))));
      } else {
        plan.append(btn(T("trNew"), () => this.startPlanning(), true));
      }
      // by boat: allowed before the routes are found (changing it finds them again)
      if (S.user) {
        const modes = document.createElement("div"); modes.className = "tr-modes";
        for (const [k, label, tip] of [["ferry", "trFerry", "trFerryTip"], ["sea", "trSea", "trSeaTip"]]) {
          const l = document.createElement("label"); l.className = "check";
          l.title = k === "ferry" ? T(tip, cfg.boat.still, cfg.boat.downShare, cfg.boatMinFlow, cfg.boardHours, cfg.boat.minUp) : T(tip, cfg.sea.normal, cfg.sea.good, cfg.sea.bad, cfg.boardHours);
          l.innerHTML = `<input type="checkbox" id="tr_${k}"><span></span>`; l.lastChild.textContent = T(label); l.firstChild.checked = !!this[k];
          l.firstChild.onchange = (e) => { this[k] = e.target.checked; if (tv.candidates && tv.start && tv.end) this._plan(); };
          modes.append(l);
        }
        plan.append(modes);
      }
      const tl = document.createElement("label"); tl.className = "check"; tl.title = T("trTerrainTip");
      tl.innerHTML = `<input type="checkbox"><span></span>`; tl.firstChild.checked = !!this.terrainOn; tl.lastChild.textContent = T("trTerrain");
      tl.firstChild.onchange = (e) => this.showTerrain(e.target.checked);
      plan.append(tl);
      this.renderList();
    },
    /** The suggested routes in the panel (redrawn alone as their times come in, so the form keeps what was typed). */
    renderCands() {
      const list = this.$("trCands"), tv = this.tv, T = (...a) => this.T(...a), cfg = this.cfg();
      if (!list) return;
      list.innerHTML = "";
      for (const c of tv.candidates || []) {
        const b = document.createElement("button"); b.type = "button"; b.className = "tr-cand" + (tv.chosen === c.mode ? " on" : "");
        const roadKm = c.sum.byKind[1] + c.sum.byKind[2] + c.sum.byKind[3];
        const eta = c.eta ? T("trEta", this.ctx.fmtDur(c.eta.arriveT - (this.fm.T || 0))) : T("trEtaWorking");
        b.innerHTML = `<b></b><span></span><span></span>`;
        b.children[0].textContent = [c.mode, ...(c.also || [])].map((m) => T(MODE_TXT[m])).join(" " + T("trAnd") + " ");
        const by = c.sum.byKind, riverKm = by[4] + by[6] + by[7], seaKm = by[5];
        b.children[1].textContent = T("trCandText", Math.round(c.km), Math.round(roadKm / Math.max(1, c.km) * 100), Math.round(c.sum.climb))
          + (c.sum.fords ? " · " + T(c.sum.ferries ? "trFordsFerries" : "trFords", c.sum.fords, fmtH(c.sum.fordHours), c.sum.ferries) : "")
          + (riverKm >= 1 ? " · " + T("trRiverKm", Math.round(riverKm), Math.round(by[4]), Math.round(by[6])) : "")
          + (seaKm >= 1 ? " · " + T("trSeaKm", Math.round(seaKm)) : "")
          + (c.sum.boards ? " · " + T("trBoards", c.sum.boards, fmtH(c.sum.boards * cfg.boardHours)) : "");
        b.children[2].textContent = eta;
        b.style.borderLeft = `4px solid ${MODE_COL[c.mode]}`;
        b.onclick = () => { tv.chosen = c.mode; this.renderCands(); this.fm.draw(); };
        list.append(b);
      }
    },
    renderList() {
      const list = this.$("trList");
      if (!list) return;
      const T = (...a) => this.T(...a), now = this.fm.T || 0, cfg = this.cfg();
      list.innerHTML = "";
      if (!this.tv.trips.length) { const li = document.createElement("li"); li.className = "sg-empty"; li.textContent = T("trNone"); list.append(li); return; }
      for (const trip of this.tv.trips) {
        const li = document.createElement("li"); li.className = "tr-item" + (this.tv.selId === trip.id ? " on" : "");
        const at = tripAt(trip, now), tl = trip.timeline;
        let status;
        if (!at) status = "";
        else if (at.state === "before") status = T("trBefore", this.ctx.fmtT(trip.startT));
        else if (at.state === "on") status = T("trOn", Math.floor(now - trip.startT) + 1, Math.round(at.km), Math.round(tl.total), this.ctx.fmtT(tl.arriveT));
        else status = T((now - tl.arriveT) > cfg.keepDays ? "trArrivedLong" : "trArrived", this.ctx.fmtT(tl.arriveT));
        const head = document.createElement("div"); head.className = "tr-top";
        const dot = document.createElement("span"); dot.className = "tr-dot"; dot.style.background = trip.color || "#e8833a";
        const nm = document.createElement("b"); nm.textContent = trip.name || "?";
        head.append(dot, nm);
        if (!trip.mine && trip.owner) { const o = document.createElement("span"); o.className = "tr-owner"; o.textContent = trip.owner; head.append(o); }
        const st = document.createElement("div"); st.className = "tr-status"; st.textContent = status;
        const det = document.createElement("div"); det.className = "tr-status";
        det.textContent = T("trDetails", trip.pace, Math.round(tl.total), T(MODE_TXT[trip.mode] || "trFast")) + " · " + T("trHoursShort", fmtH(+trip.hoursPerDay || cfg.hoursPerDay))
          + (trip.ferry ? " · " + T("trFerryShort") : "") + (trip.sea ? " · " + T("trSeaShort") : "");
        li.append(head, st, det);
        if (trip.delays && trip.delays.length) {
          const dl = document.createElement("div"); dl.className = "tr-delays";
          trip.delays.forEach((d, i) => {
            const chip = document.createElement("span"); chip.className = "sg-badge"; chip.textContent = T("trDelayChip", d.hours, this.ctx.fmtT(d.at));
            if (trip.mine) { const x = document.createElement("button"); x.type = "button"; x.className = "icon tiny"; x.textContent = "×"; x.title = T("trDelayRemove"); x.onclick = () => this.removeDelay(trip, i); chip.append(x); }
            dl.append(chip);
          });
          li.append(dl);
        }
        const row = document.createElement("div"); row.className = "tr-row";
        const b = (label, fn) => { const e = document.createElement("button"); e.type = "button"; e.textContent = label; e.onclick = fn; return e; };
        row.append(b(T("trShow"), () => this.focus(trip)));
        if (trip.mine) {
          row.append(b(T("trDelay") + "…", () => this.addDelay(trip)), b(T("trDelete"), () => this.deleteTrip(trip)));
          const sh = document.createElement("label"); sh.className = "check"; sh.innerHTML = `<input type="checkbox"><span></span>`;
          sh.firstChild.checked = !!trip.shared; sh.lastChild.textContent = T("trSharedShort");
          sh.firstChild.onchange = (e) => this.toggleShared(trip, e.target.checked);
          row.append(sh);
          const ev = document.createElement("label"); ev.className = "check"; ev.title = T("evSwitchTip"); ev.innerHTML = `<input type="checkbox"><span></span>`;
          ev.firstChild.checked = !!trip.events; ev.lastChild.textContent = T("evSwitch");
          ev.firstChild.onchange = (e) => this.toggleEvents(trip, e.target.checked);
          row.append(ev);
          if (trip.events) row.append(b(T(this.evOpen.has(trip.id) ? "evHide" : "evAhead"), () => { this.evOpen.has(trip.id) ? this.evOpen.delete(trip.id) : this.evOpen.add(trip.id); this.tv.selId = trip.id; this.renderList(); this.fm.draw(); }));
        }
        li.append(row);
        if (trip.mine && trip.events && this.evOpen.has(trip.id)) li.append(this._eventList(trip, now));
        list.append(li);
      }
    },
    _wire() {
      this.$("travelBtn").onclick = () => (this.tv.panelOpen ? this.close() : this.open());
      this.$("trClose").onclick = () => this.close();
      this.$("trGear").onclick = () => this.editSettings();
      window.addEventListener("keydown", (e) => {
        if (!this.tv.panelOpen || /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
        if (e.key === "Escape" && (this.picking || this.tv.candidates)) { e.preventDefault(); this._stopPicking(true); }
      });
    },
  };
  // for tests
  Travel._steepAt = steepAt;
  Travel._seaSpeed = seaSpeed; Travel._buildBoats = buildBoats;
  Travel._speedAt = speedAt; Travel._simulate = simulate; Travel._findRoute = findRoute; Travel._buildGrid = buildGrid; Travel._buildRoads = buildRoads; Travel._tripAt = tripAt; Travel._defaults = DEFAULTS;
  window.Travel = Travel;
})();
