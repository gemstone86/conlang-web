// Eon Weather – walk and fly around the map in 3D, in the map area of the app.
//
// The ground is the map's height map (grey 0–255, sea level and metres per step from the map's
// settings), sharpened where there is detailed terrain (tiles/<map>/height/, made by
// tools/detail-height.py: 4× the map, ridges and eroded valleys), with the painted map and its zoom
// images as the surface. Only a piece of the world around you is built (PATCH map pixels across).
//
// Smooth movement: two pieces of ground take turns. While you move over one, the next is built
// around where you are heading, a few milliseconds per frame (and its images load meanwhile); when
// it is ready the two are swapped in a single frame, so moving never freezes the view.
//
// Weather (the ☁ button): clouds where the map draws them (two layers), rain or snow falling around
// you when it rains where you are (snow when it is below freezing at your height: the weather's
// temperatures are for low ground, and it gets 6.5° colder per km up), a greyer sky and less visibility in bad weather, and the sun
// where the day/night layer has it (night is dark when that layer is on). It follows the app's
// date and hour.
import * as THREE from "./vendor/three-0.160.0.module.min.js";

const PATCH = 128;          // map pixels across a piece of ground
const FAR = 640;            // map pixels across the coarse far ground around it (you see twice as far)
const FAR_STEP = 2;         // map pixels per corner on the far ground
const FAR_TEX = 3;          // texture pixels per map pixel on the far ground
const SUB = 4;              // ground corners per map pixel (the detailed terrain is 4× the map)
const TEX = 8;              // texture pixels per map pixel (the zoom images are 8× the map)
const EYE = 1.7;            // eye height when walking (m)
const SHORE_RISE_KM = 130;  // land rises at most this many metres per km away from the water (no walls)
const BUDGET_MS = 6;        // background building per frame
const MAX_KMH = 200000;     // fastest flight (high up; the far ground covers what isn't built yet)
const CLOUD_N = 96;         // weather samples across a piece of ground
const CLOUD_TEX = 512;      // cloud texture size
const CLOUD_G = 48;         // cloud layer corners across a piece of ground (it bends over high ground)
const CLOUD_BASE = 2400;    // cloud base over low ground (m, real); the upper layer is CLOUD_GAP above
const CLOUD_GAP = 900;
const CLOUD_CLEAR = 1500;   // over mountains the clouds stay at least this far above the ground under them
const CLOUD_POW = 1.25;     // with the height exaggeration, the air under the clouds grows a little more than the ground
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/**
 * opts: { mapImage, imgW, imgH, heightSource, seaLevel, metersPerStep, kmPerPixel, wrapP, tiles,
 *         start: {nx, ny}, startAlt, startPitch, container, regionAt(nx, ny), T(key, ...args),
 *         weatherAt(nx, ny), sunAt(nx, ny), time(), nightOn(), onMove(nx, ny, region), onClose }
 */
export function open(opts) {
  const T = opts.T;
  const imgW = opts.imgW || opts.mapImage.naturalWidth || opts.mapImage.width;
  const imgH = opts.imgH || opts.mapImage.naturalHeight || opts.mapImage.height;
  const sea = Number.isFinite(opts.seaLevel) ? opts.seaLevel : 0;
  const mps = opts.metersPerStep > 0 ? opts.metersPerStep : 100;
  const mpp = (opts.kmPerPixel > 0 ? opts.kmPerPixel : 5) * 1000;          // metres per map pixel
  const wrapPx = opts.wrapP > 0 ? opts.wrapP * imgW : 0;                    // map pixels once around the world
  const N = PATCH * SUB, NC = N + 1;                                        // cells / corners across

  // ── the height map, one byte per pixel ──
  const hs = opts.heightSource, hw = hs.naturalWidth || hs.width, hh = hs.naturalHeight || hs.height;
  const H = new Uint8Array(hw * hh);
  {
    const c = document.createElement("canvas"); c.width = hw; c.height = hh;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(hs, 0, 0);
    const px = x.getImageData(0, 0, hw, hh).data;
    for (let i = 0; i < hw * hh; i++) H[i] = px[i * 4];
  }
  const wrapX = (x) => (wrapPx ? ((x % wrapPx) + wrapPx) % wrapPx : clamp(x, 0, imgW - 1e-6));
  const sx = hw / imgW, sy = hh / imgH;
  /** height-map metres at map pixel (x, y), bilinear (negative: sea floor) */
  function baseMetres(x, y) {
    x = wrapX(x); y = clamp(y, 0, imgH - 1e-6);
    const fx = x * sx - 0.5, fy = y * sy - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const xa = ((x0 % hw) + hw) % hw, xb = (xa + 1) % hw, ya = clamp(y0, 0, hh - 1), yb = clamp(y0 + 1, 0, hh - 1);
    const g = (H[ya * hw + xa] * (1 - tx) + H[ya * hw + xb] * tx) * (1 - ty) + (H[yb * hw + xa] * (1 - tx) + H[yb * hw + xb] * tx) * ty;
    return (g - sea) * mps;
  }

  // ── detailed terrain: 256×256 grey tiles at 4× the map, metres added = (grey − 128) × step ──
  let detail = null;
  const noDetail = Array.isArray(opts.noDetail) ? opts.noDetail : [];
  const detailMask = opts.detailMask && opts.detailMask.f ? opts.detailMask : null;   // own map: where its heights differ
  const detailBase = opts.tiles ? opts.tiles.base + "height/" : null;
  const detailReady = detailBase ? fetch(detailBase + "manifest.json").then((r) => (r.ok ? r.json() : null)).then((m) => {
    if (m && m.tiles && m.tiles.length) detail = { scale: m.scale || 4, tile: m.tile || 256, step: m.step || 24, have: new Set(m.tiles), cache: new Map() };
  }).catch(() => {}) : Promise.resolve();
  function loadDetailTile(key) {
    const D = detail;
    const hit = D.cache.get(key);
    if (hit) { D.cache.delete(key); D.cache.set(key, hit); return hit.ready; }   // most recently used last
    const e = { data: null, ready: null };
    e.ready = fetch(detailBase + key + ".png").then((r) => r.blob())
      .then((b) => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" })).then((bm) => {
        const c = document.createElement("canvas"); c.width = bm.width; c.height = bm.height;
        const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(bm, 0, 0);
        const p = x.getImageData(0, 0, bm.width, bm.height).data, n = bm.width * bm.height, out = new Float32Array(n);
        for (let i = 0; i < n; i++) out[i] = (p[i * 4] - 128) * D.step;
        e.data = out;
      }).catch(() => { e.data = null; });
    D.cache.set(key, e);
    if (D.cache.size > 300) for (const k of [...D.cache.keys()].slice(0, 60)) D.cache.delete(k);
    return e.ready;
  }
  async function loadDetailFor(x0, y0) {
    await detailReady;
    const D = detail;
    if (!D) return;
    const ts = D.tile, sc = D.scale, keys = [];
    const lap = wrapPx ? Math.round(wrapPx * sc) : 0;
    for (let ty = Math.floor(y0 * sc / ts); ty <= Math.floor((y0 + PATCH) * sc / ts); ty++)
      for (let tx = Math.floor(x0 * sc / ts); tx <= Math.floor((x0 + PATCH) * sc / ts); tx++) {
        let X = tx * ts;
        if (lap) X = ((X % lap) + lap) % lap;
        const k = Math.floor(X / ts) + "_" + ty;
        if (D.have.has(k)) keys.push(k);
      }
    await Promise.all(keys.map(loadDetailTile));
  }
  /** Detailed-terrain metres added along corner row j of a piece whose corner (0, 0) is map pixel (x0, y0). */
  function detailRow(x0, my, out) {
    out.fill(0);
    const D = detail;
    if (!D) return;
    const ts = D.tile, Y = Math.round(my * SUB), ty = Math.floor(Y / ts), ry = Y - ty * ts;
    const lap = wrapPx ? Math.round(wrapPx * SUB) : 0, X0 = Math.round(x0 * SUB);
    let i = 0;
    while (i < NC) {
      let X = X0 + i;
      if (lap) X = ((X % lap) + lap) % lap;
      const tx = Math.floor(X / ts), e = D.cache.get(tx + "_" + ty);
      const run = Math.min(NC - i, ts - (X - tx * ts));
      if (e && e.data) { const off = ry * ts + (X - tx * ts); for (let k = 0; k < run; k++) out[i + k] = e.data[off + k]; }
      i += run;
    }
    if (detailMask) {
      const DM = detailMask, row = Math.min(DM.h - 1, Math.max(0, Math.floor(my / imgH * DM.h))) * DM.w;
      for (let k = 0; k < NC; k++) {
        let mx = x0 + k / SUB;
        if (wrapPx) mx = ((mx % wrapPx) + wrapPx) % wrapPx;
        out[k] *= DM.f[row + Math.min(DM.w - 1, Math.max(0, Math.floor(mx / imgW * DM.w)))];
      }
    }
    // where the height map was changed in the app after the detailed terrain was made, the detail
    // (made for the old ground) is left out, fading back in over a few map pixels around the change
    if (noDetail.length) {
      const M = 6;
      for (const r of noDetail) {
        const dy = Math.max(r.y - my, my - (r.y + r.h), 0);
        if (dy >= M) continue;
        for (let k = 0; k < NC; k++) {
          let mx = x0 + k / SUB;
          if (wrapPx) { const c = r.x + r.w / 2; mx = c + ((((mx - c) % wrapPx) + wrapPx * 1.5) % wrapPx) - wrapPx / 2; }   // the copy nearest the rectangle
          const dx = Math.max(r.x - mx, mx - (r.x + r.w), 0);
          const f = Math.min(1, Math.max(dx, dy) / M);
          if (f < 1) out[k] *= f;
        }
      }
    }
  }

  // ── drawn rivers (opts.rivers): each gets a bed that only goes down from source to mouth, and the
  // ground shown here is cut (or, rarely, filled) to it in a channel with soft banks, so a river never
  // runs uphill because of a slip in the height map. The height map itself isn't changed. The rivers
  // are also painted on the ground. A switch in the bar turns this off and on. ──
  const RV_STEP = 0.25;                                        // map pixels between samples along a river
  let riversOn = opts.riversOn !== false;
  const rvMin = (f) => Math.min(Math.max(f, 1), 14);
  const rvHalf = (f) => 0.15 + 0.025 * rvMin(f);               // channel bottom, half width (map px)
  const rvBank = (f) => 0.9 + 0.08 * rvMin(f);                 // banks back up to the ground (map px)
  const rvDepth = (f) => 6 + 4 * rvMin(f);                     // metres below the bed line
  const rv = (() => {
    const list = (Array.isArray(opts.rivers) ? opts.rivers : []).filter((r) => r && r.points && r.points.length >= 2);
    if (!list.length) return null;
    const byId = new Map(list.map((r) => [r.id, r])), done = new Map();
    const flowAt = (r, s) => { let v = r.size || 1; for (const e of r.events || []) if (e.s <= s + 1e-9) v += e.add; return v; };
    const prep = (r, depth) => {
      if (done.has(r.id)) return done.get(r.id);
      done.set(r.id, null);                                     // (a loop, which can't be saved, stops here)
      const xs = [], ys = [], ss = [];
      let px = r.points[0].x * imgW, py = r.points[0].y * imgH;
      for (let k = 0; k + 1 < r.points.length; k++) {
        let bx = r.points[k + 1].x * imgW;
        const by = r.points[k + 1].y * imgH;
        if (wrapPx) { const d = bx - px; bx = px + d - wrapPx * Math.round(d / wrapPx); }   // the shorter way round
        const n = Math.max(1, Math.ceil(Math.hypot(bx - px, by - py) / RV_STEP));
        for (let t = 0; t < n; t++) { xs.push(px + (bx - px) * t / n); ys.push(py + (by - py) * t / n); ss.push(k + t / n); }
        px = bx; py = by;
      }
      xs.push(px); ys.push(py); ss.push(r.points.length - 1);
      const n = xs.length, bed = new Float32Array(n), flow = new Float32Array(n);
      // the bed only goes down. Half of it is the lowest height so far (rivers cut through what rises in
      // their way), half the closest heights that only go down (an isotonic fit: a ridge is cut part way and
      // a dip before it filled part way), so one low spot doesn't drag the whole rest of the river down
      // into a deep trench. Water counts at its surface (0 m), not at its bottom (a river through a lake
      // or an arm of the sea used to be cut to the sea floor from there on).
      const iso = new Float32Array(n);
      let m = Infinity;
      for (let i = 0; i < n; i++) { iso[i] = Math.max(0, baseMetres(xs[i], ys[i])); flow[i] = flowAt(r, ss[i]); }
      for (let i = 0; i < n; i++) { m = Math.min(m, iso[i]); bed[i] = m; }
      isoDown(iso);
      for (let i = 0; i < n; i++) bed[i] = (bed[i] + iso[i]) / 2;
      // a tributary ends at or above the river it flows into
      const into = r.joins && depth < 500 ? byId.get(r.joins.river) : null;
      const t = into ? prep(into, depth + 1) : null;
      if (t) {
        const jx = r.joins.x * imgW, jy = r.joins.y * imgH;
        let bi = 0, bd = Infinity;
        for (let i = 0; i < t.n; i++) {
          let dx = t.xs[i] - jx; if (wrapPx) dx -= wrapPx * Math.round(dx / wrapPx);
          const d = dx * dx + (t.ys[i] - jy) ** 2; if (d < bd) { bd = d; bi = i; }
        }
        const c = t.bed[bi];
        for (let i = 0; i < n; i++) if (bed[i] < c) bed[i] = c;
      }
      const R = { n, xs: Float32Array.from(xs), ys: Float32Array.from(ys), bed, flow, river: r };
      done.set(r.id, R);
      return R;
    };
    return list.map((r) => prep(r, 0)).filter(Boolean);
  })();
  // ── snow and ice: the regions' monthly mean temperatures count as at sea level (opts.climateAt), and it
  // gets 6.5° colder per km up. Snow lies where the mean for the date is below about 0° at that height,
  // glacier ice where even the warmest month is; rivers freeze where the date's mean at their bed is. ──
  const LAPSE = 6.5 / 1000;
  /** The climate on a coarse grid over a square (map px): date mean and warmest month (NaN: no region). */
  function climateGrid(x0, y0, size, step) {
    const n = Math.round(size / step) + 1, now = new Float32Array(n * n), warm = new Float32Array(n * n), ice = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const nx = wrapX(x0 + i * step) / imgW, ny = clamp((y0 + j * step) / imgH, 0, 1);
      const c = opts.climateAt ? opts.climateAt(nx, ny) : null;
      now[j * n + i] = c ? c.now : NaN; warm[j * n + i] = c ? c.warm : NaN;
      ice[j * n + i] = opts.iceAt ? clamp(opts.iceAt(nx, ny) / 100, 0, 1) : 0;    // painted ice (Redigera → Is)
    }
    return { x0, y0, step, n, now, warm, ice };
  }
  /** Date mean and warmest month (sea level) at map px (x, y) from a climate grid, bilinear; null without. */
  function climAt(G, x, y) {
    if (!G) return null;
    let dx = x - G.x0;
    if (wrapPx) dx -= wrapPx * Math.round((dx - (G.n - 1) * G.step / 2) / wrapPx);   // the copy nearest the grid
    const u = dx / G.step, v = (y - G.y0) / G.step, fx = clamp(u, 0, G.n - 1.001), fy = clamp(v, 0, G.n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, k = j * G.n + i;
    const bl = (a) => (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - ty) + (a[k + G.n] * (1 - tx) + a[k + G.n + 1] * tx) * ty;
    const now = bl(G.now), warm = bl(G.warm);
    return Number.isFinite(now) ? { now, warm } : null;
  }
  /** Painted ice (0–1) at map px (x, y) from a climate grid, bilinear. */
  function paintedIce(G, x, y) {
    if (!G || !G.ice) return 0;
    let dx = x - G.x0;
    if (wrapPx) dx -= wrapPx * Math.round((dx - (G.n - 1) * G.step / 2) / wrapPx);
    const fx = clamp(dx / G.step, 0, G.n - 1.001), fy = clamp((y - G.y0) / G.step, 0, G.n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, k = j * G.n + i, a = G.ice;
    return (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - ty) + (a[k + G.n] * (1 - tx) + a[k + G.n + 1] * tx) * ty;
  }
  /** How snowy (0–1) and how glaciated (0–1) ground at h metres is, from the sea-level climate there. */
  const snowOf = (c, h) => c ? smooth(1.5, -2.5, c.now - LAPSE * Math.max(0, h)) : 0;
  const iceOf = (c, h) => c ? smooth(1, -2, c.warm - LAPSE * Math.max(0, h)) : 0;
  /** Fills a piece's snow and ice per corner (n corners across, step map px apart, from x0, y0). */
  function fillCold(p, n, x0, y0, step, water) {
    const G = p.clim, out = p.cold;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, h = p.vh[k];
      if ((water && water[k] === 1) || h <= 0 || !G) { out[k * 2] = 0; out[k * 2 + 1] = 0; continue; }
      const c = climAt(G, x0 + i * step, y0 + j * step), pi = paintedIce(G, x0 + i * step, y0 + j * step);
      out[k * 2] = Math.max(snowOf(c, h), pi); out[k * 2 + 1] = Math.max(iceOf(c, h), pi);
    }
    p.geo.getAttribute("aCold").needsUpdate = true;
  }
  const nearCold = (p) => { p.clim = climateGrid(p.cx - PATCH / 2, p.cy - PATCH / 2, PATCH, 4); fillCold(p, NC, p.cx - PATCH / 2, p.cy - PATCH / 2, 1 / SUB, p.water); };
  const farCold = (p) => { p.clim = climateGrid(p.cx - FAR / 2, p.cy - FAR / 2, FAR, 16); fillCold(p, FNC, p.cx - FAR / 2, p.cy - FAR / 2, FAR_STEP, null); };
  /** Pool-adjacent-violators: replaces v (in place) with the non-increasing sequence nearest to it (least squares). */
  function isoDown(v) {
    const val = [], cnt = [];
    for (let i = 0; i < v.length; i++) {
      val.push(v[i]); cnt.push(1);
      while (val.length > 1 && val[val.length - 2] < val[val.length - 1]) {
        const b = val.pop(), nb = cnt.pop(), a = val.length - 1;
        val[a] = (val[a] * cnt[a] + b * nb) / (cnt[a] + nb); cnt[a] += nb;
      }
    }
    for (let k = 0, i = 0; k < val.length; k++) for (let c = 0; c < cnt[k]; c++) v[i++] = val[k];
  }
  // a cut through rising ground (or a fill across a dip) gets sides no steeper than this on average (true
  // slope, before the exaggeration): a V-shaped valley instead of a narrow trench with smeared walls
  const RV_WALL = 0.15;
  /** For each corner of a piece near a river: how far into the banks (q < 0: in the channel, ≥ 1: outside) and the channel's height. */
  function riverStamp(p) {
    if (!rv || !riversOn) return null;
    const x0 = p.cx - PATCH / 2, y0 = p.cy - PATCH / 2;
    const q = new Float32Array(NC * NC).fill(9), tgt = new Float32Array(NC * NC);
    let any = false;
    for (const R of rv) for (let i = 0; i < R.n; i++) {
      const f = R.flow[i], hw = rvHalf(f), t = R.bed[i] - rvDepth(f);
      const cut = Math.abs(Math.max(0, baseMetres(R.xs[i], R.ys[i])) - t);
      const bw = Math.min(10, Math.max(rvBank(f), cut / (RV_WALL * mpp))), reach = hw + bw;
      let u = R.xs[i] - x0;
      if (wrapPx) u = ((u + wrapPx / 2 - PATCH / 2) % wrapPx + wrapPx) % wrapPx - wrapPx / 2 + PATCH / 2;
      const v = R.ys[i] - y0;
      if (u < -reach || v < -reach || u > PATCH + reach || v > PATCH + reach) continue;
      const i0 = Math.max(0, Math.ceil((u - reach) * SUB)), i1 = Math.min(NC - 1, Math.floor((u + reach) * SUB));
      const j0 = Math.max(0, Math.ceil((v - reach) * SUB)), j1 = Math.min(NC - 1, Math.floor((v + reach) * SUB));
      for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
        const k = jj * NC + ii, qq = (Math.hypot(ii / SUB - u, jj / SUB - v) - hw) / bw;
        if (qq < q[k]) { q[k] = qq; tgt[k] = t; any = true; }
      }
    }
    return any ? { q, tgt } : null;
  }
  /** The rivers painted on a piece's ground (wider downstream). */
  function paintRivers(p) {
    if (!rv || !riversOn) return;
    const c = p.ctx, x0 = p.cx - PATCH / 2, y0 = p.cy - PATCH / 2;
    c.save(); c.lineCap = "round"; c.lineJoin = "round";
    for (const pass of [0, 1]) for (const R of rv) for (const kw of (wrapPx ? [-wrapPx, 0, wrapPx] : [0])) {
      let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
      for (let i = 0; i < R.n; i += 8) { minx = Math.min(minx, R.xs[i]); maxx = Math.max(maxx, R.xs[i]); miny = Math.min(miny, R.ys[i]); maxy = Math.max(maxy, R.ys[i]); }
      minx = Math.min(minx, R.xs[R.n - 1]); maxx = Math.max(maxx, R.xs[R.n - 1]); miny = Math.min(miny, R.ys[R.n - 1]); maxy = Math.max(maxy, R.ys[R.n - 1]);
      if (maxx + kw < x0 - 4 || minx + kw > x0 + PATCH + 4 || maxy < y0 - 4 || miny > y0 + PATCH + 4) continue;
      for (let i = 0; i + 4 < R.n + 3; i += 4) {
        const a = i, b = Math.min(R.n - 1, i + 4);
        if (a === b) break;
        const w = (0.08 + 0.022 * rvMin(R.flow[a])) * 2 * TEX;     // about 1 km (a stream) to 4 km wide
        c.lineWidth = pass ? w : w + 2;
        // frozen where the date's mean temperature at the bed is below freezing (white-blue ice)
        const cl = climAt(p.clim, R.xs[a], R.ys[a]), fz = cl ? Math.max(snowOf(cl, R.bed[a]), iceOf(cl, R.bed[a])) : 0;
        c.strokeStyle = pass ? `rgba(${Math.round(74 + 150 * fz)},${Math.round(140 + 95 * fz)},${Math.round(200 + 47 * fz)},0.95)` : "rgba(40,70,90,0.35)";
        c.beginPath();
        c.moveTo((R.xs[a] + kw - x0) * TEX, (R.ys[a] - y0) * TEX);
        for (let k = a + 1; k <= b; k++) c.lineTo((R.xs[k] + kw - x0) * TEX, (R.ys[k] - y0) * TEX);
        c.stroke();
      }
    }
    c.restore();
  }

  // ── page (in the map area, or on its own) ──
  const host = opts.container || document.body;
  const root = document.createElement("div");
  root.className = "walk3d" + (opts.container ? " embedded" : "");
  root.innerHTML = `
    <div class="w3-hud">
      <div class="w3-where"><b class="w3-region"></b><span class="w3-info"></span></div>
      <div class="w3-ctrl">
        <label>${T("w3Speed")} <input type="range" class="w3-speed" min="0" max="100" value="45"><output class="w3-speedOut"></output></label>
        <label>${T("w3Exag")} <input type="range" class="w3-exag" min="1" max="10" step="0.5" value="2"><output class="w3-exagOut"></output></label>
        <button type="button" class="w3-weather" aria-pressed="true" title="${T("w3WeatherTip")}">${T("w3Weather")}</button>
        ${rv ? `<button type="button" class="w3-rivers" aria-pressed="${riversOn}" title="${T("w3RiversTip")}">${T("w3Rivers")}</button>` : ""}
        <button type="button" class="w3-mode"></button>
        <button type="button" class="w3-helpbtn" title="${T("w3KeysTitle")} (H)">?</button>
        <button type="button" class="w3-close" title="${T("w3Close")}">✕</button>
      </div>
    </div>
    <div class="w3-help">${T("w3HelpHint")}</div>
    <div class="w3-keys" hidden>
      <h3>${T("w3KeysTitle")}</h3>
      <table>${T("w3Keys").split("|").map((row) => { const [k, d] = row.split("="); return `<tr><th>${k}</th><td>${d}</td></tr>`; }).join("")}</table>
      <button type="button" class="w3-keys-close">${T("w3KeysClose")}</button>
    </div>
    <div class="w3-loading">${T("w3Loading")}</div>
    <div class="w3-touch"><button type="button" data-k="fwd">▲</button><button type="button" data-k="back">▼</button></div>
    <div class="w3-compass"></div>`;
  host.appendChild(root);
  const $ = (s) => root.querySelector(s);
  // the map underneath mustn't see these (it would pan, or open its info box)
  for (const t of ["pointerdown", "pointermove", "pointerup", "click", "dblclick", "wheel", "contextmenu"]) root.addEventListener(t, (e) => e.stopPropagation());
  root.querySelectorAll(".w3-ctrl input, .w3-ctrl button").forEach((el) => el.addEventListener("change", () => el.blur()));
  root.querySelectorAll(".w3-ctrl button").forEach((el) => el.addEventListener("click", () => el.blur()));

  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  root.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const skyCol = new THREE.Color(0x9cc4e4);
  scene.background = skyCol;
  scene.fog = new THREE.Fog(skyCol.clone(), 60e3, 330e3);
  const camera = new THREE.PerspectiveCamera(65, 1, 0.5, 2.5e6);
  camera.rotation.order = "YXZ";
  const hemi = new THREE.HemisphereLight(0xdfefff, 0x5a5040, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.1);
  sun.position.set(-0.55, 0.55, -0.6);
  scene.add(sun);

  // ── rock on steep ground ──
  // The map picture is laid on the ground from straight above, so on a steep slope a few of its pixels
  // are stretched over the whole height of the slope: forests and colours run down a mountainside in
  // long smooth streaks ("melting" mountains). Where the ground (as shown, with the height
  // exaggeration) is steeper than about 33°, the picture gives way to rock, fully from about 57°: a
  // grey-brown tone that keeps a little of the picture's own colour, with horizontal strata and
  // speckles that follow the real height, so cliffs look like cliffs.
  function addRock(mat) {
    if (window.__eonNoRock) return mat;                  // (for comparing in tests)
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 aCold;\nvarying vec2 vCold;\nvarying vec3 vRockPos;\nvarying vec3 vRockNor;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvRockPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRockNor = normalize(mat3(modelMatrix) * objectNormal);\nvCold = aCold;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>
#define ROCK_HI ${window.__eonRockAll ? "1.01" : "0.84"}
#define ROCK_LO ${window.__eonRockAll ? "1.00" : "0.55"}
varying vec3 vRockPos;
varying vec3 vRockNor;
varying vec2 vCold;
float rockH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float rockN(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rockH(i), rockH(i + vec3(1.0, 0.0, 0.0)), f.x), mix(rockH(i + vec3(0.0, 1.0, 0.0)), rockH(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(rockH(i + vec3(0.0, 0.0, 1.0)), rockH(i + vec3(1.0, 0.0, 1.0)), f.x), mix(rockH(i + vec3(0.0, 1.0, 1.0)), rockH(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}`)
        .replace("#include <map_fragment>", `#include <map_fragment>
{
  float steep = smoothstep(ROCK_HI, ROCK_LO, normalize(vRockNor).y);
  if (steep > 0.0) {
    vec3 q = vRockPos / 420.0;
    float strata = rockN(vec3(q.x * 0.6, q.y * 5.0, q.z * 0.6));      // thin horizontal layers
    float speck = rockN(q * 3.3) * 0.6 + rockN(q * 9.7) * 0.4;
    vec3 tex = diffuseColor.rgb;
    float lum = dot(tex, vec3(0.299, 0.587, 0.114));
    vec3 rock = mix(vec3(0.47, 0.44, 0.40), tex * 0.85 + vec3(lum) * 0.15, 0.3) * (0.62 + 0.30 * strata + 0.22 * speck);
    diffuseColor.rgb = mix(tex, rock, steep * 0.9);
  }
  // snow (x: how cold it is now) and glacier ice (y: how cold the warmest month is), with ragged edges;
  // they don't stay on the steepest rock
  if (vCold.x + vCold.y > 0.0) {
    float ny = normalize(vRockNor).y;
    float nz = rockN(vRockPos / 2600.0) * 0.6 + rockN(vRockPos / 700.0) * 0.4;
    float sn = clamp(vCold.x * 1.5 - 0.25 + (nz - 0.5) * 0.7, 0.0, 1.0) * smoothstep(0.42, 0.72, ny);
    float gl = clamp(vCold.y * 1.5 - 0.25 + (nz - 0.5) * 0.5, 0.0, 1.0) * smoothstep(0.30, 0.60, ny);
    vec3 c = diffuseColor.rgb;
    c = mix(c, vec3(0.80, 0.87, 0.94) * (0.92 + 0.16 * nz), gl * 0.92);
    c = mix(c, vec3(0.94, 0.96, 0.99) * (0.95 + 0.08 * nz), sn * 0.9);
    diffuseColor.rgb = c;
  }
}`);
    };
    mat.customProgramCacheKey = () => "rock2";
    return mat;
  }

  // ── two pieces of ground ──
  const uvs = (() => { const g = new THREE.PlaneGeometry(1, 1, N, N); g.rotateX(-Math.PI / 2); return g; })();
  function makePiece() {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(NC * NC * 3), nor = new Float32Array(NC * NC * 3);
    const half = PATCH * mpp / 2, cell = PATCH * mpp / N;
    for (let j = 0; j < NC; j++) for (let i = 0; i < NC; i++) {
      const k = (j * NC + i) * 3;
      pos[k] = -half + i * cell; pos[k + 2] = -half + j * cell; nor[k + 1] = 1;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("uv", uvs.getAttribute("uv"));
    const cold = new Float32Array(NC * NC * 2);
    geo.setAttribute("aCold", new THREE.BufferAttribute(cold, 2));
    geo.setIndex(uvs.getIndex());
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), half * 1.5);
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = PATCH * TEX;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const mat = addRock(new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    scene.add(mesh);
    return { geo, pos, nor, cold, canvas, ctx, texture, mat, mesh, vh: new Float32Array(NC * NC), water: new Int8Array(NC * NC),
      shore: new Float32Array(NC * NC), cx: 0, cy: 0, ready: false, exag: 0, clim: null };
  }
  const pieces = [makePiece(), makePiece()];
  let active = null, building = null, buildGen = null;
  const stats = { forced: [], swaps: 0, workMs: 0 };
  let exag = 2;

  /** Where a corner of a piece is, in map pixels. */
  const cornerX = (p, i) => p.cx - PATCH / 2 + i / SUB;
  const cornerY = (p, j) => p.cy - PATCH / 2 + j / SUB;

  /** Paints the map onto a piece (only the part under it). */
  function paintBase(p) {
    const c = p.ctx, x0 = p.cx - PATCH / 2, y0 = p.cy - PATCH / 2;
    c.fillStyle = "#6f8fa8"; c.fillRect(0, 0, p.canvas.width, p.canvas.height);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "medium";
    for (const k of (wrapPx ? [-wrapPx, 0, wrapPx] : [0])) {
      const ax = Math.max(0, x0 - k), bx = Math.min(imgW, x0 - k + PATCH), ay = Math.max(0, y0), by = Math.min(imgH, y0 + PATCH);
      if (bx <= ax || by <= ay) continue;
      c.drawImage(opts.mapImage, ax, ay, bx - ax, by - ay, (ax + k - x0) * TEX, (ay - y0) * TEX, (bx - ax) * TEX, (by - ay) * TEX);
    }
  }
  /** The zoom images over a piece, painted as they arrive. */
  function paintZoom(p) {
    const Tl = opts.tiles;
    if (!Tl) return Promise.resolve();
    const c = p.ctx, x0 = p.cx - PATCH / 2, y0 = p.cy - PATCH / 2;
    const L = Tl.levels.filter((l) => !l.extra).reduce((a, b) => (b.w > a.w ? b : a));   // the ordinary levels; extra (finer) ones are sparse
    const f = L.w / imgW, ts = Tl.ts, jobs = [];
    for (const k of (wrapPx ? [-wrapPx, 0, wrapPx] : [0])) {
      const ax = (x0 - k) * f, ay = y0 * f, bx = (x0 - k + PATCH) * f, by = (y0 + PATCH) * f;
      for (let ty = Math.max(0, Math.floor(ay / ts)); ty <= Math.min(Math.ceil(L.h / ts) - 1, Math.floor(by / ts)); ty++)
        for (let tx = Math.max(0, Math.floor(ax / ts)); tx <= Math.min(Math.ceil(L.w / ts) - 1, Math.floor(bx / ts)); tx++) {
          const srcs = Tl.srcs ? Tl.srcs(L.level, tx + "_" + ty) : (L.have.has(tx + "_" + ty) ? [Tl.base + L.level + "/" + tx + "_" + ty + ".jpg"] : []);
          if (!srcs.length) continue;
          jobs.push({ srcs, dx: ((tx * ts) / f + k - x0) * TEX, dy: ((ty * ts) / f - y0) * TEX, s: TEX / f });
        }
    }
    // a zoom image can be several images (base map, then see-through layers): drawn in that order
    return Promise.all(jobs.map((j) => Promise.all(j.srcs.map((src) => new Promise((done) => {
      const im = new Image();
      im.onload = () => done(im);
      im.onerror = () => done(null);
      im.src = src;
    }))).then((ims) => {
      if (building !== p) return;
      for (const im of ims) if (im) c.drawImage(im, j.dx, j.dy, im.width * j.s, im.height * j.s);
    })));
  }

  /**
   * Builds a piece of ground around (cx, cy), a little at a time: yields often, and yields "wait"
   * while images load (nothing to do then).
   */
  function* build(p, cx, cy) {
    p.ready = false; p.cx = cx; p.cy = cy;
    paintBase(p);
    yield;
    let loaded = false;
    Promise.all([paintZoom(p), loadDetailFor(cx - PATCH / 2, cy - PATCH / 2)]).then(() => { loaded = true; });
    while (!loaded) yield "wait";
    // water and land, read from the painted ground: bluer than red and hardly less blue than green
    const T_ = p.canvas.width, px = p.ctx.getImageData(0, 0, T_, T_).data, st = TEX / SUB, w = p.water;
    yield;
    for (let j = 0; j < NC; j++) {
      for (let i = 0; i < NC; i++) {
        let wet = 0, dry = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = clamp(Math.round(i * st + dx * 2), 0, T_ - 1), y = clamp(Math.round(j * st + dy * 2), 0, T_ - 1), k = (y * T_ + x) * 4;
          const r = px[k], g = px[k + 1], b = px[k + 2];
          if (b - r > 4 && b - g > -14) wet++;
          else if (g - b > 15) dry++;
        }
        w[j * NC + i] = wet >= 6 ? 1 : dry >= 6 && wet <= 1 ? -1 : 0;
      }
      if ((j & 31) === 31) yield;
    }
    // names, dots, white: what the drawing shows around them (a name on the sea is sea)
    const q = new Int32Array(NC * NC);
    let qh = 0, qt = 0;
    for (let k = 0; k < NC * NC; k++) if (w[k]) q[qt++] = k;
    while (qh < qt) {
      const k = q[qh++], x = k % NC, y = (k - x) / NC;
      if (x > 0 && !w[k - 1]) { w[k - 1] = w[k]; q[qt++] = k - 1; }
      if (x < NC - 1 && !w[k + 1]) { w[k + 1] = w[k]; q[qt++] = k + 1; }
      if (y > 0 && !w[k - NC]) { w[k - NC] = w[k]; q[qt++] = k - NC; }
      if (y < NC - 1 && !w[k + NC]) { w[k + NC] = w[k]; q[qt++] = k + NC; }
    }
    yield;
    // drawn rivers are thin lines: only water a few km across that reaches the height map's own
    // water counts (opened by 2 corners, then joined to the sea); the rest keeps the ground's height
    const wet = new Uint8Array(NC * NC);
    for (let k = 0; k < NC * NC; k++) wet[k] = w[k] === 1 ? 1 : 0;
    const morph = function* (src, grow, dst) {
      for (let y = 0; y < NC; y++) {
        for (let x = 0; x < NC; x++) {
          let v = grow ? 0 : 1;
          outer: for (let dy = -2; dy <= 2; dy++) {
            const yy = clamp(y + dy, 0, NC - 1) * NC;
            for (let dx = -2; dx <= 2; dx++) {
              const s_ = src[yy + clamp(x + dx, 0, NC - 1)];
              if (grow ? s_ : !s_) { v = grow ? 1 : 0; break outer; }
            }
          }
          dst[y * NC + x] = v;
        }
        if ((y & 63) === 63) yield;
      }
    };
    const er = new Uint8Array(NC * NC), op = new Uint8Array(NC * NC);
    yield* morph(wet, false, er);
    yield* morph(er, true, op);
    const keep = new Uint8Array(NC * NC);
    qh = 0; qt = 0;
    for (let j = 0; j < NC; j++) for (let i = 0; i < NC; i++) {
      const k = j * NC + i;
      if (op[k] && wet[k] && baseMetres(cornerX(p, i), cornerY(p, j)) <= 0) { keep[k] = 1; q[qt++] = k; }
    }
    while (qh < qt) {
      const k = q[qh++], x = k % NC, y = (k - x) / NC;
      for (const m of [x > 0 ? k - 1 : -1, x < NC - 1 ? k + 1 : -1, y > 0 ? k - NC : -1, y < NC - 1 ? k + NC : -1])
        if (m >= 0 && !keep[m] && wet[m] && op[m]) { keep[m] = 1; q[qt++] = m; }
    }
    for (let k = 0; k < NC * NC; k++) if (w[k] === 1 && !keep[k]) w[k] = 0;
    p.clim = climateGrid(p.cx - PATCH / 2, p.cy - PATCH / 2, PATCH, 4);
    paintRivers(p);                                    // after the water was read, so they don't count as sea
    const rs = riverStamp(p);
    yield;
    // distance from the water (corners), so land rises from the shore
    const d = p.shore, D2 = Math.SQRT2;
    for (let k = 0; k < NC * NC; k++) d[k] = w[k] === 1 ? 0 : 1e9;
    for (let y = 0; y < NC; y++) {
      for (let x = 0; x < NC; x++) {
        const k = y * NC + x; let v = d[k];
        if (x > 0) v = Math.min(v, d[k - 1] + 1);
        if (y > 0) { v = Math.min(v, d[k - NC] + 1); if (x > 0) v = Math.min(v, d[k - NC - 1] + D2); if (x < NC - 1) v = Math.min(v, d[k - NC + 1] + D2); }
        d[k] = v;
      }
      if ((y & 127) === 127) yield;
    }
    for (let y = NC - 1; y >= 0; y--) {
      for (let x = NC - 1; x >= 0; x--) {
        const k = y * NC + x; let v = d[k];
        if (x < NC - 1) v = Math.min(v, d[k + 1] + 1);
        if (y < NC - 1) { v = Math.min(v, d[k + NC] + 1); if (x < NC - 1) v = Math.min(v, d[k + NC + 1] + D2); if (x > 0) v = Math.min(v, d[k + NC - 1] + D2); }
        d[k] = v;
      }
      if ((y & 127) === 0) yield;
    }
    // heights
    const row = new Float32Array(NC), rise = SHORE_RISE_KM * mpp / SUB / 1000;
    for (let j = 0; j < NC; j++) {
      const my = cornerY(p, j), polar = my <= imgH * 0.16 || my >= imgH * 0.84;
      detailRow(p.cx - PATCH / 2, my, row);
      for (let i = 0; i < NC; i++) {
        const k = j * NC + i;
        let h = baseMetres(cornerX(p, i), my) + row[i];
        const ww = polar ? 0 : w[k];        // near the poles the ice is bluish white: the height map decides
        if (ww === 1 && h > -20) h = -20;
        else if (ww === -1) { if (h < 8 && h > -300) h = 8; h = Math.min(h, 8 + d[k] * rise); }
        if (rs && ww !== 1 && rs.q[k] < 1) {
          // in a river's channel: its bed; on the banks: back up to the ground
          const qq = Math.max(0, rs.q[k]), t = qq * qq * (3 - 2 * qq);
          h = rs.tgt[k] + (h - rs.tgt[k]) * t;
        }
        p.vh[k] = h;
      }
      if ((j & 31) === 31) yield;
    }
    yield* shape(p);
    fillCold(p, NC, p.cx - PATCH / 2, p.cy - PATCH / 2, 1 / SUB, p.water);
    p.texture.needsUpdate = true;
    p.ready = true;
  }
  /** Ground heights → positions and normals (with the height exaggeration). */
  function* shape(p) {
    const cell = PATCH * mpp / N, e = exag;
    for (let j = 0; j < NC; j++) {
      for (let i = 0; i < NC; i++) {
        const k = j * NC + i;
        p.pos[k * 3 + 1] = p.vh[k] * e;
        const hl = p.vh[j * NC + Math.max(0, i - 1)], hr = p.vh[j * NC + Math.min(NC - 1, i + 1)];
        const hu = p.vh[Math.max(0, j - 1) * NC + i], hd = p.vh[Math.min(NC - 1, j + 1) * NC + i];
        const nx = -(hr - hl) * e / (2 * cell), nz = -(hd - hu) * e / (2 * cell), len = Math.hypot(nx, 1, nz);
        p.nor[k * 3] = nx / len; p.nor[k * 3 + 1] = 1 / len; p.nor[k * 3 + 2] = nz / len;
      }
      if ((j & 63) === 63) yield;
    }
    p.geo.getAttribute("position").needsUpdate = true;
    p.geo.getAttribute("normal").needsUpdate = true;
    p.exag = e;
  }
  const runAll = (gen) => { for (let r = gen.next(); !r.done; r = gen.next()); };
  function startBuild(cx, cy) {
    const p = pieces[0] === active ? pieces[1] : pieces[0];
    building = p;
    buildGen = build(p, Math.round(wrapX(cx)), clamp(Math.round(cy), 0, imgH));
  }
  /** Background work for this frame. */
  function work(budget) {
    if (!buildGen) return;
    const t0 = performance.now();
    while (performance.now() - t0 < budget) {
      const ts = performance.now(), r = buildGen.next();
      stats.workMs += performance.now() - ts;
      if (r.done) { buildGen = null; break; }
      if (r.value === "wait") break;
    }
  }
  function swapIn(p) {
    stats.swaps++;
    if (p.exag !== exag) runAll(shape(p));
    if (active) active.mesh.visible = false;
    p.mesh.visible = true;
    active = p; building = null;
    weatherDirty = true;
  }

  // ── water surface: one plane that follows you ──
  const waterMat = new THREE.MeshPhongMaterial({ color: 0x356f9c, transparent: true, opacity: 0.9, shininess: 30, specular: 0x223344 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(FAR * mpp * 1.2, FAR * mpp * 1.2).rotateX(-Math.PI / 2), waterMat);
  scene.add(water);

  // ── far ground: a coarse piece, one corner per map pixel, under and around the near ground ──
  // (a little lower, so the near ground covers it where they overlap)
  const FN = FAR / FAR_STEP, FNC = FN + 1, FAR_DROP = 120;
  const farUv = (() => { const g = new THREE.PlaneGeometry(1, 1, FN, FN); g.rotateX(-Math.PI / 2); return g; })();
  function makeFar() {
    const geo = new THREE.BufferGeometry(), pos = new Float32Array(FNC * FNC * 3), nor = new Float32Array(FNC * FNC * 3);
    const half = FAR * mpp / 2, cell = mpp * FAR_STEP;
    for (let j = 0; j < FNC; j++) for (let i = 0; i < FNC; i++) { const k = (j * FNC + i) * 3; pos[k] = -half + i * cell; pos[k + 2] = -half + j * cell; nor[k + 1] = 1; }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("uv", farUv.getAttribute("uv")); geo.setIndex(farUv.getIndex());
    const cold = new Float32Array(FNC * FNC * 2);
    geo.setAttribute("aCold", new THREE.BufferAttribute(cold, 2));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), half * 1.5);
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = FAR * FAR_TEX;
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const mat = addRock(new THREE.MeshLambertMaterial({ map: texture }));
    const mesh = new THREE.Mesh(geo, mat); mesh.visible = false; scene.add(mesh);
    return { geo, pos, nor, cold, canvas, ctx, texture, mat, mesh, vh: new Float32Array(FNC * FNC), cx: 0, cy: 0, ready: false, exag: 0, clim: null };
  }
  const fars = [makeFar(), makeFar()];
  let farActive = null, farBuilding = null, farGen = null;
  function* buildFar(p, cx, cy) {
    p.ready = false; p.cx = cx; p.cy = cy;
    const c = p.ctx, x0 = cx - FAR / 2, y0 = cy - FAR / 2;
    c.fillStyle = "#356f9c"; c.fillRect(0, 0, p.canvas.width, p.canvas.height);
    c.imageSmoothingEnabled = true;
    for (const k of (wrapPx ? [-wrapPx, 0, wrapPx] : [0])) {
      const ax = Math.max(0, x0 - k), bx = Math.min(imgW, x0 - k + FAR), ay = Math.max(0, y0), by = Math.min(imgH, y0 + FAR);
      if (bx <= ax || by <= ay) continue;
      c.drawImage(opts.mapImage, ax, ay, bx - ax, by - ay, (ax + k - x0) * FAR_TEX, (ay - y0) * FAR_TEX, (bx - ax) * FAR_TEX, (by - ay) * FAR_TEX);
    }
    yield;
    for (let j = 0; j < FNC; j++) {
      const my = y0 + j * FAR_STEP;
      for (let i = 0; i < FNC; i++) { const h = baseMetres(x0 + i * FAR_STEP, my); p.vh[j * FNC + i] = h > 0 ? h : Math.min(h, -20); }
      if ((j & 63) === 63) yield;
    }
    yield* shapeFar(p);
    farCold(p);
    p.texture.needsUpdate = true;
    p.ready = true;
  }
  function* shapeFar(p) {
    const e = exag, cell = mpp * FAR_STEP;
    for (let j = 0; j < FNC; j++) {
      for (let i = 0; i < FNC; i++) {
        const k = j * FNC + i;
        p.pos[k * 3 + 1] = p.vh[k] * e - FAR_DROP * e;
        const hl = p.vh[j * FNC + Math.max(0, i - 1)], hr = p.vh[j * FNC + Math.min(FNC - 1, i + 1)];
        const hu = p.vh[Math.max(0, j - 1) * FNC + i], hd = p.vh[Math.min(FNC - 1, j + 1) * FNC + i];
        const nx = -(hr - hl) * e / (2 * cell), nz = -(hd - hu) * e / (2 * cell), len = Math.hypot(nx, 1, nz);
        p.nor[k * 3] = nx / len; p.nor[k * 3 + 1] = 1 / len; p.nor[k * 3 + 2] = nz / len;
      }
      if ((j & 127) === 127) yield;
    }
    p.geo.getAttribute("position").needsUpdate = true; p.geo.getAttribute("normal").needsUpdate = true;
    p.exag = e;
  }
  function farWork(budget) {
    if (!farGen) return;
    const t0 = performance.now();
    while (performance.now() - t0 < budget) if (farGen.next().done) { farGen = null; break; }
    if (farBuilding && farBuilding.ready) {
      if (farBuilding.exag !== exag) runAll(shapeFar(farBuilding));
      if (farActive) farActive.mesh.visible = false;
      farBuilding.mesh.visible = true; farActive = farBuilding; farBuilding = null;
    }
  }
  function startFar(cx, cy) {
    farBuilding = fars[0] === farActive ? fars[1] : fars[0];
    farGen = buildFar(farBuilding, Math.round(wrapX(cx)), clamp(Math.round(cy), 0, imgH));
  }

  // ── the walker ──
  const me = { x: opts.start.nx * imgW, y: opts.start.ny * imgH, yaw: 0, pitch: opts.startPitch != null ? opts.startPitch : -0.3, alt: 0, fly: true, vx: 0, vy: 0 };
  /** Ground height (m, not exaggerated) on the active piece's own triangles, so you never sink into it. */
  function groundMetres(x, y) {
    const p = active;
    if (!p) return baseMetres(x, y);
    let u = x - (p.cx - PATCH / 2);
    if (wrapPx) u = ((u + wrapPx / 2 - PATCH / 2) % wrapPx + wrapPx) % wrapPx - wrapPx / 2 + PATCH / 2;
    const v = y - (p.cy - PATCH / 2);
    if (u < 0 || v < 0 || u >= PATCH || v >= PATCH) return baseMetres(x, y);
    const U = u * SUB, V = v * SUB, i = Math.floor(U), j = Math.floor(V), fx = U - i, fy = V - j;
    const a = p.vh[j * NC + i], b = p.vh[(j + 1) * NC + i], c = p.vh[(j + 1) * NC + i + 1], d = p.vh[j * NC + i + 1];
    return fx + fy <= 1 ? a + (d - a) * fx + (b - a) * fy : c + (b - c) * (1 - fx) + (d - c) * (1 - fy);
  }
  const groundY = (x, y) => Math.max(groundMetres(x, y) * exag, 0);      // on water you float (by boat)

  let speedKmh = 0;
  const setSpeed = (v) => { speedKmh = 5 * Math.pow(1000, v / 100); $(".w3-speedOut").textContent = speedKmh < 100 ? speedKmh.toFixed(0) + " km/h" : Math.round(speedKmh / 10) * 10 + " km/h"; };
  setSpeed(+$(".w3-speed").value);
  $(".w3-speed").oninput = (e) => setSpeed(+e.target.value);
  $(".w3-exag").oninput = (e) => {
    const above = me.alt - groundY(me.x, me.y);
    exag = +e.target.value; $(".w3-exagOut").textContent = "×" + exag;
    if (active) runAll(shape(active));
    if (farActive) runAll(shapeFar(farActive));
    me.alt = groundY(me.x, me.y) + (me.fly ? Math.max(EYE, above) : EYE);
  };
  $(".w3-exagOut").textContent = "×" + exag;
  const setMode = (fly) => { me.fly = fly; $(".w3-mode").textContent = fly ? T("w3Fly") : T("w3Walk"); if (!fly) me.alt = groundY(me.x, me.y) + EYE; };
  $(".w3-mode").onclick = () => setMode(!me.fly);
  $(".w3-mode").textContent = T("w3Fly");
  let weatherOn = true;
  if (rv) $(".w3-rivers").onclick = () => {
    riversOn = !riversOn;
    $(".w3-rivers").setAttribute("aria-pressed", String(riversOn));
    opts.onRiversToggle && opts.onRiversToggle(riversOn);
    buildGen = null; building = null;                   // build the ground here again, with or without them
    startBuild(me.x, me.y);
  };
  const toggleWeather = () => { weatherOn = !weatherOn; $(".w3-weather").setAttribute("aria-pressed", String(weatherOn)); weatherDirty = true; here = null; };
  $(".w3-weather").onclick = toggleWeather;
  const toggleKeys = (show) => {
    const box = $(".w3-keys"), on = show != null ? show : box.hidden;
    box.hidden = !on;
    if (on && document.pointerLockElement) document.exitPointerLock();
  };
  $(".w3-helpbtn").onclick = () => toggleKeys();
  $(".w3-keys-close").onclick = () => toggleKeys(false);

  // keyboard (not while typing in the app's fields), mouse (pointer lock), touch
  const keys = new Set();
  const typing = (t) => t && (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || (t.tagName === "INPUT" && t.type !== "range"));
  const onKey = (e) => {
    if (typing(e.target)) return;
    if (e.target && e.target.type === "range" && /^arrow/i.test(e.key)) return;
    if (document.querySelector("dialog[open]")) return;
    const k = e.key.toLowerCase();
    if (e.type === "keydown") {
      if (k === "escape" && !$(".w3-keys").hidden) { toggleKeys(false); return; }
      if (k === "escape" && !document.pointerLockElement) { close(); return; }
      if (k === "f") setMode(!me.fly);
      if (k === "m" && !e.repeat) toggleWeather();
      if (k === "h" && !e.repeat) toggleKeys();
      keys.add(k);
      if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
    } else keys.delete(k);
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);
  const onBlur = () => keys.clear();
  window.addEventListener("blur", onBlur);
  const look = (dx, dy, k) => { me.yaw -= dx * k; me.pitch = clamp(me.pitch - dy * k, -1.45, 1.45); };
  const cv = renderer.domElement;
  let touchUsed = false, drag = null;
  cv.addEventListener("click", () => { if (!document.pointerLockElement && cv.requestPointerLock && !touchUsed) cv.requestPointerLock(); });
  const onMouse = (e) => { if (document.pointerLockElement === cv) look(e.movementX, e.movementY, 0.0022); };
  document.addEventListener("mousemove", onMouse);
  cv.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") touchUsed = true; if (!document.pointerLockElement) drag = { x: e.clientX, y: e.clientY }; });
  const onUp = () => { drag = null; };
  window.addEventListener("pointerup", onUp);
  cv.addEventListener("pointermove", (e) => { if (drag) { look(e.clientX - drag.x, e.clientY - drag.y, 0.005); drag = { x: e.clientX, y: e.clientY }; } });
  root.querySelectorAll(".w3-touch button").forEach((b) => {
    const k = b.dataset.k === "fwd" ? "w" : "s";
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); keys.add(k); });
    ["pointerup", "pointerleave", "pointercancel"].forEach((t) => b.addEventListener(t, () => keys.delete(k)));
  });

  // ── weather: clouds, rain and snow, sky ──
  const cloudCanvas = document.createElement("canvas"); cloudCanvas.width = cloudCanvas.height = CLOUD_TEX;
  const cloudCtx = cloudCanvas.getContext("2d");
  const cloudTex = new THREE.CanvasTexture(cloudCanvas);
  cloudTex.colorSpace = THREE.SRGBColorSpace;
  const cloudMats = [0, 1].map(() => new THREE.MeshLambertMaterial({ map: cloudTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, emissive: 0x404448 }));
  const cloudLayers = cloudMats.map((m, i) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PATCH * mpp, PATCH * mpp, CLOUD_G, CLOUD_G).rotateX(-Math.PI / 2), m);
    mesh.visible = false; mesh.renderOrder = 2 + i;
    scene.add(mesh);
    return mesh;
  });
  // fine puffs: a tiling noise, so clouds aren't smooth blobs
  const puff = (() => {
    const n = 128, a = new Float32Array(n * n);
    for (const [g, amp] of [[8, 0.5], [16, 0.3], [32, 0.2]]) {
      const v = new Float32Array(g * g); for (let i = 0; i < g * g; i++) v[i] = Math.random();
      const c = n / g, gv = (xx, yy) => v[((yy % g) + g) % g * g + ((xx % g) + g) % g];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const fx = x / c, fy = y / c, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = smooth(0, 1, fx - x0), ty = smooth(0, 1, fy - y0);
        a[y * n + x] += amp * ((gv(x0, y0) * (1 - tx) + gv(x0 + 1, y0) * tx) * (1 - ty) + (gv(x0, y0 + 1) * (1 - tx) + gv(x0 + 1, y0 + 1) * tx) * ty);
      }
    }
    return { n, a };
  })();
  let weatherDirty = true, weatherGen = null, lastT = null, cloudAt = null, here = null, hereAt = 0;
  // the highest ground under the clouds (real metres, smoothed), per cloud corner
  const CG1 = CLOUD_G + 1, cloudGround = new Float32Array(CG1 * CG1);
  let cloudShaped = null;
  function cloudGroundBuild(p) {
    const step = PATCH / CLOUD_G, x0 = p.cx - PATCH / 2, y0 = p.cy - PATCH / 2, r = Math.ceil(step);
    const g = new Float32Array(CG1 * CG1);
    for (let j = 0; j < CG1; j++) for (let i = 0; i < CG1; i++) {
      let m = 0;
      for (let b = -r; b <= r; b += 2) for (let a = -r; a <= r; a += 2) m = Math.max(m, baseMetres(x0 + i * step + a, y0 + j * step + b));
      g[j * CG1 + i] = m;
    }
    // soften twice (each corner takes the mean of itself and its neighbours, but never drops below its own ground)
    for (let pass = 0; pass < 2; pass++) {
      const s = g.slice();
      for (let j = 0; j < CG1; j++) for (let i = 0; i < CG1; i++) {
        let sum = 0, n = 0;
        for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
          const jj = j + b, ii = i + a; if (jj < 0 || ii < 0 || jj >= CG1 || ii >= CG1) continue;
          sum += s[jj * CG1 + ii]; n++;
        }
        g[j * CG1 + i] = Math.max(sum / n, s[j * CG1 + i] * 0.85);
      }
    }
    cloudGround.set(g);
  }
  /** Real cloud height (m) over ground gm, and where that is in the exaggerated scene. */
  const cloudReal = (gm, upper) => Math.max(CLOUD_BASE, gm + CLOUD_CLEAR) + (upper ? CLOUD_GAP : 0);
  const cloudSceneY = (gm, upper) => { const g = Math.max(gm, 0); return g * exag + (cloudReal(gm, upper) - g) * Math.pow(exag, CLOUD_POW); };
  function cloudShape() {
    cloudLayers.forEach((m, i) => {
      const pos = m.geometry.getAttribute("position");
      for (let k = 0; k < CG1 * CG1; k++) pos.array[k * 3 + 1] = cloudSceneY(cloudGround[k], i === 1);
      pos.needsUpdate = true;
      m.geometry.computeBoundingSphere(); m.geometry.computeBoundingBox();
    });
    cloudShaped = { exag, at: cloudAt };
  }
  /** The cloud base in the scene at map pixel (x, y) (for rain: are you under it?). */
  function cloudBaseAt(x, y) {
    if (!cloudAt) return cloudSceneY(0, false);
    let u = x - (cloudAt.cx - PATCH / 2); if (wrapPx) u = ((u + wrapPx / 2 - PATCH / 2) % wrapPx + wrapPx) % wrapPx - wrapPx / 2 + PATCH / 2;
    const i = clamp(Math.round(u / PATCH * CLOUD_G), 0, CLOUD_G), j = clamp(Math.round((y - (cloudAt.cy - PATCH / 2)) / PATCH * CLOUD_G), 0, CLOUD_G);
    return cloudSceneY(cloudGround[j * CG1 + i], false);
  }
  const wx = { dens: new Float32Array(CLOUD_N * CLOUD_N), dark: new Float32Array(CLOUD_N * CLOUD_N) };
  function* weatherBuild(p) {
    const step = PATCH / CLOUD_N, x0 = p.cx - PATCH / 2, y0 = p.cy - PATCH / 2;
    for (let j = 0; j < CLOUD_N; j++) {
      for (let i = 0; i < CLOUD_N; i++) {
        const nx = wrapX(x0 + (i + 0.5) * step) / imgW, ny = clamp((y0 + (j + 0.5) * step) / imgH, 0, 1);
        const v = opts.weatherAt ? opts.weatherAt(nx, ny) : null;
        wx.dens[j * CLOUD_N + i] = v ? v.density : 0;
        wx.dark[j * CLOUD_N + i] = v ? clamp(v.rain / 5, 0, 1) : 0;
        if ((i & 15) === 15) yield;
      }
    }
    // the cloud texture: density (smooth) × puffs, grey where it rains
    const img = cloudCtx.createImageData(CLOUD_TEX, CLOUD_TEX), out = img.data, sc = CLOUD_N / CLOUD_TEX, pn = puff.n;
    for (let y = 0; y < CLOUD_TEX; y++) {
      const fy = clamp(y * sc - 0.5, 0, CLOUD_N - 1.001), j0 = Math.floor(fy), ty = fy - j0;
      for (let x = 0; x < CLOUD_TEX; x++) {
        const fx = clamp(x * sc - 0.5, 0, CLOUD_N - 1.001), i0 = Math.floor(fx), tx = fx - i0, k = j0 * CLOUD_N + i0;
        const dns = (wx.dens[k] * (1 - tx) + wx.dens[k + 1] * tx) * (1 - ty) + (wx.dens[k + CLOUD_N] * (1 - tx) + wx.dens[k + CLOUD_N + 1] * tx) * ty;
        const dk = (wx.dark[k] * (1 - tx) + wx.dark[k + 1] * tx) * (1 - ty) + (wx.dark[k + CLOUD_N] * (1 - tx) + wx.dark[k + CLOUD_N + 1] * tx) * ty;
        const pf = puff.a[(y % pn) * pn + (x % pn)];
        const a = smooth(0.15, 0.75, dns * (0.55 + 0.9 * pf));
        const o = (y * CLOUD_TEX + x) * 4, c = 250 - 120 * dk;
        out[o] = c; out[o + 1] = c + 3; out[o + 2] = Math.min(255, c + 8); out[o + 3] = 255 * a * 0.92;
      }
      if ((y & 63) === 63) yield;
    }
    cloudCtx.putImageData(img, 0, 0);
    cloudTex.needsUpdate = true;
    cloudGroundBuild(p);
    cloudAt = { cx: p.cx, cy: p.cy };
  }
  // rain (streaks) and snow (flakes) in a box around you
  const DROPS = 3000, BOX = 60;
  const rainGeo = new THREE.BufferGeometry(), rainPos = new Float32Array(DROPS * 6);
  const snowGeo = new THREE.BufferGeometry(), snowPos = new Float32Array(DROPS * 3);
  const seeds = new Float32Array(DROPS * 3);
  for (let i = 0; i < DROPS * 3; i++) seeds[i] = Math.random();
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.55, fog: false }));
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.5, sizeAttenuation: false, transparent: true, opacity: 0.85, fog: false }));
  rain.frustumCulled = snow.frustumCulled = false;
  rain.visible = snow.visible = false;
  scene.add(rain); scene.add(snow);
  const cSky = new THREE.Color(), cDay = new THREE.Color(0x9cc4e4), cDusk = new THREE.Color(0xd9a27c), cNight = new THREE.Color(0x0b1424);
  const cGrey = new THREE.Color(0x8d969e), cGreyDim = new THREE.Color(), sunDir = new THREE.Vector3();

  // ── every frame ──
  let nowKmh = 0, last = performance.now(), alive = true, hudAt = 0, helpUntil = last + 9000, lastRegion, fallT = 0;
  const dirs = [T("w3N"), T("w3NE"), T("w3E"), T("w3SE"), T("w3S"), T("w3SW"), T("w3W"), T("w3NW")];
  let coldKey = opts.climateKey ? opts.climateKey() : "", coldCheckAt = 0;
  function frame(now) {
    // another date: snow and ice follow (rivers freeze or thaw when the ground here is next built)
    if (opts.climateKey && now > coldCheckAt) {
      coldCheckAt = now + 1000;
      const k = opts.climateKey();
      if (k !== coldKey) { coldKey = k; if (active) nearCold(active); if (farActive) farCold(farActive); }
    }
    if (!alive) return;
    const dt = Math.min(0.25, (now - last) / 1000); last = now;   // a slow frame still moves you the full way (up to ¼ s)
    if (!active) {                                      // the first piece: as fast as it can
      work(40);
      if (building && building.ready) {
        swapIn(building);
        me.alt = groundY(me.x, me.y) + (opts.startAlt || 4000);
        const l = $(".w3-loading"); if (l) l.remove();
      } else { requestAnimationFrame(frame); return; }
    }
    // moving
    let f = 0, s = 0, u = 0;
    if (keys.has("w") || keys.has("arrowup")) f += 1;
    if (keys.has("s") || keys.has("arrowdown")) f -= 1;
    if (keys.has("d")) s += 1;
    if (keys.has("a")) s -= 1;
    if (keys.has("arrowleft")) me.yaw += 1.6 * dt;
    if (keys.has("arrowright")) me.yaw -= 1.6 * dt;
    if (keys.has(" ") || keys.has("e")) u += 1;
    if (keys.has("c") || keys.has("q")) u -= 1;
    const boost = keys.has("shift") ? 5 : 1;
    const g0 = groundY(me.x, me.y);
    const lift = me.fly ? Math.max(1, (me.alt - g0) / 250) : 1;            // high up, faster
    const kmh = Math.min(MAX_KMH, speedKmh * boost * lift), v = kmh / 3.6 * dt;
    nowKmh = (f || s) ? kmh : 0;
    me.vx = 0; me.vy = 0;
    if ((f || s) && dt > 0) {
      const len = Math.hypot(f, s), syw = Math.sin(me.yaw), cyw = Math.cos(me.yaw);
      const dxm = (-syw * f + cyw * s) / len * v, dym = (-cyw * f - syw * s) / len * v;
      me.vx = dxm / mpp / dt; me.vy = dym / mpp / dt;
      me.x += dxm / mpp; me.y = clamp(me.y + dym / mpp, 1, imgH - 1);
      me.x = wrapPx ? wrapX(me.x) : clamp(me.x, 1, imgW - 1);
    }
    const g = groundY(me.x, me.y);
    const climb = Math.max(15, (me.alt - g) * 0.9) * boost * dt;
    if (me.fly) me.alt = Math.max(g + EYE, me.alt + u * climb);
    else me.alt += (g + EYE - me.alt) * Math.min(1, dt * 12);

    // the next piece of ground: started early, a little ahead of you; swapped in when ready
    let ox = me.x - active.cx; if (wrapPx) ox = ((ox + wrapPx / 2) % wrapPx + wrapPx) % wrapPx - wrapPx / 2;
    const oy = me.y - active.cy, off = Math.max(Math.abs(ox), Math.abs(oy));
    if (!buildGen && !building && off > PATCH / 10) {
      const sp = Math.hypot(me.vx, me.vy), ahead = sp > 0 ? Math.min(PATCH / 8 / sp, 4) : 0;
      startBuild(me.x + me.vx * ahead, me.y + me.vy * ahead);
    }
    work(BUDGET_MS);
    if (building && building.ready) swapIn(building);
    else if (off > PATCH / 2 - 8 && buildGen && me.alt - g < 3000) {
      // low down and faster than the ground can be built: give it more time this frame
      // (high up, the far ground covers it until it is ready, so nothing is forced)
      work(20);
    }

    // the far ground: rebuilt in the background when you have gone a good way from its middle
    if (farActive || farGen) {
      let fx = me.x - (farActive ? farActive.cx : me.x); if (wrapPx) fx = ((fx + wrapPx / 2) % wrapPx + wrapPx) % wrapPx - wrapPx / 2;
      const fy = me.y - (farActive ? farActive.cy : me.y);
      if (!farGen && Math.max(Math.abs(fx), Math.abs(fy)) > FAR / 8) {
        const sp = Math.hypot(me.vx, me.vy), ahead = sp > 0 ? Math.min(FAR / 6 / sp, 8) : 0;
        startFar(me.x + me.vx * ahead, me.y + me.vy * ahead);
      }
    }
    farWork(buildGen ? 2 : 5);
    // placing things relative to the active piece
    let rx = me.x - active.cx; if (wrapPx) rx = ((rx + wrapPx / 2) % wrapPx + wrapPx) % wrapPx - wrapPx / 2;
    camera.position.set(rx * mpp, me.alt, (me.y - active.cy) * mpp);
    camera.rotation.set(me.pitch, me.yaw, 0);
    water.position.set(camera.position.x, 0, camera.position.z);
    if (farActive) {
      let dx_ = farActive.cx - active.cx; if (wrapPx) dx_ = ((dx_ + wrapPx / 2) % wrapPx + wrapPx) % wrapPx - wrapPx / 2;
      farActive.mesh.position.set(dx_ * mpp, 0, (farActive.cy - active.cy) * mpp);
    }
    const above = me.alt - g;

    // weather and light (follow the app's date and hour)
    const tNow = opts.time ? opts.time() : 0;
    if (tNow !== lastT) { lastT = tNow; weatherDirty = true; here = null; }
    if (weatherDirty && !weatherGen && weatherOn && active) { weatherDirty = false; weatherGen = weatherBuild(active); }
    if (weatherGen) {
      const t0 = performance.now();
      while (performance.now() - t0 < 3) {
        if (weatherGen.next().done) { weatherGen = null; break; }
      }
    }
    const nx = me.x / imgW, ny = me.y / imgH;
    if (weatherOn && opts.weatherAt && (!here || now > hereAt)) { here = opts.weatherAt(nx, ny); hereAt = now + 500; }
    const wHere = weatherOn ? here : null;
    if (cloudAt && (!cloudShaped || cloudShaped.exag !== exag || cloudShaped.at !== cloudAt)) cloudShape();
    const cloudBase = cloudBaseAt(me.x, me.y), cloudTop = Math.max(cloudSceneY(0, true), cloudBase + CLOUD_GAP * Math.pow(exag, CLOUD_POW)), under = me.alt < cloudBase;
    cloudLayers.forEach((m, i) => {
      m.visible = !!(weatherOn && cloudAt);
      if (!m.visible) return;
      let cx_ = cloudAt.cx - active.cx; if (wrapPx) cx_ = ((cx_ + wrapPx / 2) % wrapPx + wrapPx) % wrapPx - wrapPx / 2;
      m.position.set(cx_ * mpp + (i ? 9000 : 0), 0, (cloudAt.cy - active.cy) * mpp + (i ? 6000 : 0));
      m.material.opacity = i ? 0.5 : 0.9;
    });
    const nightOn = opts.nightOn ? opts.nightOn() : true, sunV = nightOn && opts.sunAt ? opts.sunAt(nx, ny) : null;
    const alt = sunV ? sunV.alt : 45;
    const day = smooth(-6, 8, alt), dusk = (1 - smooth(4, 14, alt)) * smooth(-6, 2, alt);
    const oc = wHere && under ? clamp((wHere.density || 0) * 0.85 + clamp(wHere.rain / 6, 0, 1) * 0.3, 0, 1) : 0;
    cGreyDim.copy(cGrey).multiplyScalar(0.25 + 0.75 * day);
    cSky.copy(cNight).lerp(cDay, day).lerp(cDusk, dusk * 0.6).lerp(cGreyDim, oc * 0.75);
    scene.background.copy(cSky); scene.fog.color.copy(cSky);
    if (sunV) sunDir.set(sunV.east, Math.max(sunV.up, 0.05), -sunV.north).normalize();
    else sunDir.set(-0.55, 0.55, -0.6).normalize();
    sun.position.copy(sunDir);
    sun.intensity = 2.1 * day * (1 - 0.65 * oc);
    sun.color.setRGB(1, 0.95 - 0.25 * dusk, 0.87 - 0.4 * dusk);
    hemi.intensity = 0.12 + 0.63 * day * (1 - 0.3 * oc);
    cloudMats.forEach((m) => m.emissive.setScalar(0.08 + 0.3 * day));
    const murk = wHere ? clamp((wHere.fog || 0) + clamp(wHere.rain / 6, 0, 1) * 0.7, 0, 1) * (under ? 1 : 0.2) : 0;
    scene.fog.near = (80e3 + above * 8) * (1 - 0.85 * murk);
    scene.fog.far = Math.min(FAR * mpp * 0.42, 520e3 + above * 24) * (1 - 0.8 * murk);   // twice as far as before
    // depth range to fit what can be seen
    const nearP = clamp(above * 0.02, 0.5, 3000), farP = Math.max(scene.fog.far * 1.15, cloudTop * 3 + 1000);
    if (Math.abs(camera.near - nearP) > nearP * 0.1 || Math.abs(camera.far - farP) > farP * 0.05) { camera.near = nearP; camera.far = farP; camera.updateProjectionMatrix(); }

    // rain or snow around you (below the clouds)
    // the weather's temperatures are for low ground: it gets colder with height (6.5° per km)
    const realAlt = Math.max(0, groundMetres(me.x, me.y)) + above / exag;     // metres above the sea, as it really is
    const tempHere = wHere ? (wHere.seaTemp != null ? wHere.seaTemp : wHere.temperature) - 6.5 * realAlt / 1000 : null;
    const inten = wHere && under ? clamp(wHere.rain / 5, 0, 1) : 0, snowing = !!(wHere && tempHere < 1);
    rain.visible = inten > 0.02 && !snowing; snow.visible = inten > 0.02 && snowing;
    if (rain.visible || snow.visible) {
      fallT += dt;
      const n = Math.round(DROPS * inten), m = Math.hypot(wHere.vx || 0, wHere.vy || 0) || 1, wf = Math.min(1, (wHere.wind || 0) / 8);
      const slx = (wHere.vx || 0) / m * wf, slz = (wHere.vy || 0) / m * wf;
      const fall = snowing ? 1.2 : 9, P = camera.position, k = snowing ? 0.4 : 0.25;
      for (let i = 0; i < n; i++) {
        const a = seeds[i * 3], b = seeds[i * 3 + 1], c = seeds[i * 3 + 2];
        const y = BOX / 2 - (((c * BOX + fallT * fall * (0.8 + 0.4 * a)) % BOX) + BOX) % BOX;
        const drift = snowing ? Math.sin(fallT * 0.8 + a * 20) * 0.6 : 0;
        const x = (a - 0.5) * BOX - y * slx * k + drift, z = (b - 0.5) * BOX - y * slz * k;
        if (snowing) { snowPos[i * 3] = P.x + x; snowPos[i * 3 + 1] = P.y + y; snowPos[i * 3 + 2] = P.z + z; }
        else {
          rainPos[i * 6] = P.x + x; rainPos[i * 6 + 1] = P.y + y; rainPos[i * 6 + 2] = P.z + z;
          rainPos[i * 6 + 3] = P.x + x + slx * 0.22; rainPos[i * 6 + 4] = P.y + y + 0.9; rainPos[i * 6 + 5] = P.z + z + slz * 0.22;
        }
      }
      if (snowing) { snowGeo.setDrawRange(0, n); snowGeo.getAttribute("position").needsUpdate = true; }
      else { rainGeo.setDrawRange(0, n * 2); rainGeo.getAttribute("position").needsUpdate = true; }
    }

    renderer.render(scene, camera);

    if (now > hudAt) {
      hudAt = now + 250;
      const h = groundMetres(me.x, me.y), region = opts.regionAt ? opts.regionAt(nx, ny) : null;
      $(".w3-region").textContent = region || "";
      let info = (h >= 0 ? T("w3Ground", Math.round(h / 10) * 10) : T("w3Depth", Math.round(-h / 10) * 10))
        + (me.fly ? " · " + T("w3Above", Math.round(above)) : "")
        + (nowKmh ? " · " + (nowKmh < 100 ? nowKmh.toFixed(0) : Math.round(nowKmh / 10) * 10) + " km/h" : "");
      if (wHere) info += " · " + Math.round(tempHere) + "°" + (inten > 0.02 ? (snowing ? " ❄" : " 🌧") : "");
      if (opts.clock) info += " · " + T("w3Local", opts.clock(nx));
      $(".w3-info").textContent = info;
      root.dataset.pos = me.x.toFixed(2) + "," + me.y.toFixed(2);
      const deg = ((-me.yaw * 180 / Math.PI) % 360 + 360) % 360;
      $(".w3-compass").textContent = dirs[Math.round(deg / 45) % 8] + " " + Math.round(deg) + "°";
      if (now > helpUntil) $(".w3-help").classList.add("faded");
      if (region !== lastRegion) { lastRegion = region; opts.onMove && opts.onMove(nx, ny, region); }
    }
    requestAnimationFrame(frame);
  }
  function resize() {
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(root); resize();
  startBuild(me.x, me.y);
  startFar(me.x, me.y);
  requestAnimationFrame((t) => { last = t; frame(t); });

  function close() {
    if (!alive) return;
    alive = false;
    if (document.pointerLockElement) document.exitPointerLock();
    window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKey);
    window.removeEventListener("blur", onBlur); window.removeEventListener("pointerup", onUp);
    document.removeEventListener("mousemove", onMouse);
    ro.disconnect();
    for (const p of [...pieces, ...fars]) { p.geo.dispose(); p.texture.dispose(); p.mat.dispose(); }
    farUv.dispose();
    uvs.dispose(); water.geometry.dispose(); waterMat.dispose();
    cloudLayers.forEach((m) => m.geometry.dispose()); cloudMats.forEach((m) => m.dispose()); cloudTex.dispose();
    rainGeo.dispose(); snowGeo.dispose(); rain.material.dispose(); snow.material.dispose();
    renderer.dispose();
    root.remove();
    opts.onClose && opts.onClose();
  }
  $(".w3-close").onclick = close;
  // for tests: what the background building has done, and a way to move without the keyboard
  root._stats = () => ({ ...stats, active: !!active, building: !!buildGen, pos: [me.x, me.y], centre: active ? [active.cx, active.cy] : null });
  root._cloud = () => ({ base: cloudBaseAt(me.x, me.y), alt: me.alt, ground: groundY(me.x, me.y), exag });
  root._view = (above, pitch, yaw) => { me.alt = groundY(me.x, me.y) + above; if (pitch != null) me.pitch = pitch; if (yaw != null) me.yaw = yaw; };
  root._groundAt = (x, y) => groundMetres(x, y);
  root._riversOn = () => riversOn;
  root._coldAt = (x, y) => {                              // (tests) snow and ice at a map spot on the active piece
    const p = active; if (!p) return null;
    const i = Math.round((x - (p.cx - PATCH / 2)) * SUB), j = Math.round((y - (p.cy - PATCH / 2)) * SUB);
    if (i < 0 || j < 0 || i >= NC || j >= NC) return null;
    const k = j * NC + i; return { snow: p.cold[k * 2], ice: p.cold[k * 2 + 1], h: p.vh[k], clim: climAt(p.clim, x, y) };
  };
  root._nudge = (dx, dy) => { me.x = wrapPx ? wrapX(me.x + dx) : me.x + dx; me.y = clamp(me.y + dy, 1, imgH - 1); me.vx = dx; me.vy = dy; };
  return { close };
}
