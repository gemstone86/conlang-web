// Eon Weather – what the drawn rivers and mountain ranges say about the ground, on a greyscale height
// raster (Uint8Array, w × h, one byte per pixel, sea level `sea`). Used by the height painter (the
// "Vattendelare" overlay and "Höj vattendelarna") and for the calculated height map ("Beräknad"),
// which is the base height map with the ranges raised, the divides lifted and the rivers' valleys cut:
//
//   window.EonTerrain.derive(base, w, h, { sea, mps, rivers, ranges, imgW, imgH }) → new Uint8Array
//
// Rivers and ranges are given as on the map (points 0..1; range widths in map pixels).
//
// It also suggests where rivers most likely run on a height map (drainage + suggestRivers), for the
// "Föreslå floder" overlay in the river mode; that only reads the height map.
(function () {
  "use strict";
  const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const vh = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
  /** Smooth value noise, 0..1. */
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return (vh(xi, yi) * (1 - ux) + vh(xi + 1, yi) * ux) * (1 - uy) + (vh(xi, yi + 1) * (1 - ux) + vh(xi + 1, yi + 1) * ux) * uy;
  };

  // Between two rivers there must be higher ground (a divide), or one would run into the other; and a
  // river's bed never rises downstream. Each land pixel near the rivers is given to its nearest river;
  // where two rivers' areas meet, at least DIV_MIN pixels from both and really between them, runs a
  // divide. It should stand above the lower of the two rivers' beds there, by a step per DIV_RISE
  // pixels of distance (100 m per ~80 km on Mundana); lower than that is "too low". (Not above the
  // higher one: a river high on a mountainside has its divide on the slope beside it.) Lifting raises
  // a divide by at most DIV_LIFT steps, so it nudges rather than reshapes.
  const DIV_MAXD = 40, DIV_MIN = 3, DIV_RISE = 15, UP_STEPS = 2, DIV_LIFT = 5;

  /** Each river's course as raster pixel indices (in order, from source to mouth). */
  function riverPixels(r, w, h) {
    const out = [];
    let last = -1;
    for (let k = 0; k + 1 < r.points.length; k++) {
      const a = r.points[k], b = r.points[k + 1];
      const ax = a.x * w, ay = a.y * h, bx = b.x * w, by = b.y * h;
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
      for (let t = 0; t <= n; t++) {
        const x = Math.floor(ax + (bx - ax) * t / n), y = Math.floor(ay + (by - ay) * t / n);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        if (i !== last) { out.push(i); last = i; }
      }
    }
    return out;
  }

  /** Finds the divides between the rivers, the too-low parts, and where rivers climb downstream. */
  function findDivides(d, w, h, sea, riversIn) {
    const N = w * h, bed = (v) => Math.max(v, sea);                // water counts at its surface
    const lab = new Int32Array(N).fill(-1), src = new Int32Array(N).fill(-1), dist = new Float32Array(N).fill(1e9);
    const up = [];
    const rivers = (riversIn || []).filter((r) => r.points && r.points.length >= 2);
    rivers.forEach((r, ri) => {
      let run = Infinity, inUp = false;
      for (const i of riverPixels(r, w, h)) {
        if (lab[i] < 0) { lab[i] = ri; src[i] = i; dist[i] = 0; }
        const v = bed(d[i]);
        const isUp = v >= run + UP_STEPS;                          // higher than somewhere upstream
        if (isUp && !inUp) up.push(i);                             // one mark where each climb starts
        inUp = isUp;
        if (v < run) run = v;
      }
    });
    // the nearest river pixel for every pixel around the rivers: jump flooding, within the rivers' box
    const land = (i) => d[i] > sea;
    let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
    for (let i = 0; i < N; i++) if (src[i] >= 0) { const x = i % w, y = (i - x) / w; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    if (bx1 >= 0) {
      bx0 = Math.max(0, bx0 - DIV_MAXD); by0 = Math.max(0, by0 - DIV_MAXD); bx1 = Math.min(w - 1, bx1 + DIV_MAXD); by1 = Math.min(h - 1, by1 + DIV_MAXD);
      const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
      let cur = new Int32Array(bw * bh).fill(-1), nxt = new Int32Array(bw * bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const i = (y + by0) * w + x + bx0; if (src[i] === i) cur[y * bw + x] = i; }
      const d2 = (k, s_) => { const x = k % bw + bx0, y = ((k / bw) | 0) + by0, sx = s_ % w, sy = (s_ / w) | 0; return (x - sx) * (x - sx) + (y - sy) * (y - sy); };
      for (let step = 1 << Math.ceil(Math.log2(Math.max(bw, bh))); step >= 1; step >>= 1) {
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
          const k = y * bw + x;
          let best = cur[k], bd = best >= 0 ? d2(k, best) : Infinity;
          for (let dy = -step; dy <= step; dy += step) {
            const yy = y + dy; if (yy < 0 || yy >= bh) continue;
            for (let dx = -step; dx <= step; dx += step) {
              const xx = x + dx; if (xx < 0 || xx >= bw || (!dx && !dy)) continue;
              const c = cur[yy * bw + xx];
              if (c >= 0) { const dc = d2(k, c); if (dc < bd) { bd = dc; best = c; } }
            }
          }
          nxt[k] = best;
        }
        const t = cur; cur = nxt; nxt = t;
      }
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const k = y * bw + x, c = cur[k];
        if (c < 0) continue;
        const i = (y + by0) * w + x + bx0, D = Math.sqrt(d2(k, c));
        if (D > DIV_MAXD) continue;
        dist[i] = D; src[i] = c; lab[i] = lab[c];
      }
    }
    // the divides: where two rivers' areas meet, between the two rivers
    const kind = new Uint8Array(N), need = new Float32Array(N), pairB = new Int32Array(N).fill(-1);
    let nOk = 0, nLow = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, L = lab[i], D = dist[i];
      if (L < 0 || D < DIV_MIN || D > DIV_MAXD || !land(i)) continue;
      let other = -1;
      for (const j of [i - 1, i + 1, i - w, i + w]) if (lab[j] > L && land(j)) { other = j; break; }
      if (other < 0) continue;
      // only between the two rivers: their nearest points lie on opposite sides (more than 120° apart).
      // Beyond the head of a river, or where two rivers run on top of each other, it is no divide.
      const pa = src[i], pb = src[other], px_ = x + 0.5, py_ = y + 0.5;
      const ax = pa % w + 0.5 - px_, ay = ((pa / w) | 0) + 0.5 - py_, bx_ = pb % w + 0.5 - px_, by_ = ((pb / w) | 0) + 0.5 - py_;
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx_, by_);
      if (!(la > 0 && lb > 0) || (ax * bx_ + ay * by_) / (la * lb) > -0.5) continue;
      const req = Math.min(bed(d[src[i]]), bed(d[src[other]])) + Math.floor(D / DIV_RISE);
      need[i] = req;
      pairB[i] = lab[other];
      if (d[i] < req) { kind[i] = 2; nLow++; } else { kind[i] = 1; nOk++; }
    }
    return { kind, need, dist, lab, pairB, nOk, nLow, up: Int32Array.from(up), rivers: rivers.length };
  }

  /**
   * Lifts the too-low divides (in place): each is raised to what it needs (at most DIV_LIFT steps), and
   * the ground between it and its own two rivers rises with it on a ridge profile, nothing at the
   * rivers themselves. Only raises, only land. Returns how many pixels changed and their box.
   */
  function liftDivides(d, w, h, sea, V) {
    const N = w * h;
    const lift = new Float32Array(N), dd = new Float32Array(N).fill(1e9), pa = new Int32Array(N).fill(-1), pb = new Int32Array(N).fill(-1);
    for (let i = 0; i < N; i++) if (V.kind[i] === 2) { lift[i] = Math.min(DIV_LIFT, V.need[i] - d[i]); dd[i] = 0; pa[i] = V.lab[i]; pb[i] = V.pairB[i]; }
    const R2 = Math.SQRT2;
    const relax = (i, j, c) => { const nd = dd[j] + c; if (nd < dd[i]) { dd[i] = nd; lift[i] = lift[j]; pa[i] = pa[j]; pb[i] = pb[j]; } };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] <= sea || dd[i] === 0) continue;
      if (x > 0) relax(i, i - 1, 1);
      if (y > 0) { relax(i, i - w, 1); if (x > 0) relax(i, i - w - 1, R2); if (x < w - 1) relax(i, i - w + 1, R2); }
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i] <= sea || dd[i] === 0) continue;
      if (x < w - 1) relax(i, i + 1, 1);
      if (y < h - 1) { relax(i, i + w, 1); if (x < w - 1) relax(i, i + w + 1, R2); if (x > 0) relax(i, i + w - 1, R2); }
    }
    let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let i = 0; i < N; i++) {
      if (d[i] <= sea || dd[i] > DIV_MAXD || !(lift[i] > 0)) continue;
      const D = V.dist[i];
      if (!(D > 0) || D > DIV_MAXD) continue;                      // the rivers themselves stay as they are
      if (V.lab[i] !== pa[i] && V.lab[i] !== pb[i]) continue;      // only between the divide's own two rivers
      const t = D / (D + dd[i]), f = Math.pow(t, 1.6) * (1 - smoothstep(DIV_MAXD * 0.65, DIV_MAXD, D));
      const x = i % w, y = (i - x) / w, wob = 0.85 + 0.3 * vnoise(x / 9, y / 9);
      const nv = Math.min(255, Math.round(d[i] + lift[i] * f * wob));
      if (nv > d[i]) {
        d[i] = nv; n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return { n, x0, y0, x1, y1 };
  }

  /**
   * Raises each mountain range (in place): from its crest out to its width lines the ground rises
   * towards the crest height (the range's height, or else the highest ground already on its crest,
   * at least 1 500 m), steep near the crest and easing out at the foot. A range without width lines
   * gets RANGE_W map pixels on each side. Only raises.
   */
  const RANGE_W = 12;
  function raiseRanges(d, w, h, sea, mps, ranges, imgW, imgH) {
    const sx = w / imgW, sy = h / imgH, sc = (sx + sy) / 2;
    for (const r of ranges || []) {
      const pts = (r.points || []).map((p) => [p.x * w, p.y * h]);
      const n = pts.length;
      if (n < 2) continue;
      // widths per point (raster px), as the range editor shows them: straight between set ones, ends taper
      const widths = (side) => {
        const known = [];
        r.points.forEach((p, i) => { if (p[side] != null) known.push(i); });
        if (!known.length) return pts.map(() => RANGE_W * sc);
        const val = (i) => (r.points[i][side] != null ? r.points[i][side] * sc : 0);
        if (known[0] !== 0) known.unshift(0);
        if (known[known.length - 1] !== n - 1) known.push(n - 1);
        const along = [0];
        for (let i = 1; i < n; i++) along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        return pts.map((_, i) => {
          let a = 0, b = n - 1;
          for (const k of known) { if (k <= i) a = k; }
          for (const k of known) { if (k >= i) { b = k; break; } }
          if (a === b) return val(a);
          const t = (along[i] - along[a]) / ((along[b] - along[a]) || 1);
          return val(a) + (val(b) - val(a)) * t;
        });
      };
      const wl = widths("l"), wr = widths("r");
      // the crest's height (grey value)
      // a branch without a height of its own has the height of the range it splits off
      let hgt = r.height, up = r, guard = 0;
      while (!Number.isFinite(hgt) && up && up.from && guard++ < 100) { up = ranges.find((x) => x.id === up.from.range); hgt = up ? up.height : null; }
      let crest;
      if (Number.isFinite(hgt) && mps > 0) crest = sea + hgt / mps;
      else {
        crest = sea + 1500 / (mps || 100);
        for (const [x, y] of pts) { const i = Math.min(h - 1, Math.max(0, Math.floor(y))) * w + Math.min(w - 1, Math.max(0, Math.floor(x))); crest = Math.max(crest, d[i]); }
      }
      crest = Math.min(255, crest);
      const maxW = Math.max(...wl, ...wr, 1);
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      x0 = Math.max(0, Math.floor(x0 - maxW - 1)); y0 = Math.max(0, Math.floor(y0 - maxW - 1));
      x1 = Math.min(w - 1, Math.ceil(x1 + maxW + 1)); y1 = Math.min(h - 1, Math.ceil(y1 + maxW + 1));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        // the nearest crest segment, and on which side of it the pixel lies
        let best = Infinity, bw = 0;
        for (let k = 0; k + 1 < n; k++) {
          const [ax, ay] = pts[k], [bx, by] = pts[k + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / L2));
          const qx = ax + dx * t, qy = ay + dy * t, dist = Math.hypot(x + 0.5 - qx, y + 0.5 - qy);
          if (dist < best) {
            best = dist;
            // left as seen walking from the first point to the last (y points down): cross product < 0
            const left = dx * (y + 0.5 - ay) - dy * (x + 0.5 - ax) < 0;
            const W = left ? wl[k] + (wl[k + 1] - wl[k]) * t : wr[k] + (wr[k + 1] - wr[k]) * t;
            bw = W;
          }
        }
        if (!(bw > 0.5) || best >= bw) continue;
        const i = y * w + x;
        if (d[i] <= sea) continue;                                  // the sea stays the sea
        const u = best / bw, wob = 0.88 + 0.24 * vnoise(x / 6, y / 6);
        const target = d[i] + (crest - d[i]) * Math.pow(1 - u, 1.7) * wob;
        if (target > d[i]) d[i] = Math.min(255, Math.round(target));
      }
    }
  }

  /** Pool-adjacent-violators: the non-increasing sequence nearest to v (least squares), in place. */
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
  /**
   * Cuts each river's valley (in place): a bed that only goes down from source to mouth (half the
   * lowest ground so far, half the nearest only-falling heights, as in the 3D view), and V-shaped sides
   * rising a step per RIVER_SIDE pixels from it, out to RIVER_REACH pixels. A tributary ends at or above
   * the river it joins. Only lowers.
   */
  const RIVER_SIDE = 1.5, RIVER_REACH = 8;
  function carveRivers(d, w, h, sea, riversIn) {
    const rivers = (riversIn || []).filter((r) => r.points && r.points.length >= 2);
    const byId = new Map(rivers.map((r) => [r.id, r])), beds = new Map();
    const bedOf = (r, depth) => {
      if (beds.has(r.id)) return beds.get(r.id);
      beds.set(r.id, null);
      const px = riverPixels(r, w, h), n = px.length;
      if (!n) return null;
      const lo = new Float32Array(n), iso = new Float32Array(n);
      let m = Infinity;
      for (let k = 0; k < n; k++) { iso[k] = Math.max(sea + 0.5, d[px[k]]); m = Math.min(m, iso[k]); lo[k] = m; }
      isoDown(iso);
      const bed = new Float32Array(n);
      for (let k = 0; k < n; k++) bed[k] = (lo[k] + iso[k]) / 2;
      const into = r.joins && depth < 500 ? byId.get(r.joins.river) : null;
      const t = into ? bedOf(into, depth + 1) : null;
      if (t) {
        const j = Math.min(h - 1, Math.floor(r.joins.y * h)) * w + Math.min(w - 1, Math.floor(r.joins.x * w));
        let c = Infinity, bd = Infinity;
        for (let k = 0; k < t.px.length; k++) { const q = t.px[k], dd = (q % w - j % w) ** 2 + (((q / w) | 0) - ((j / w) | 0)) ** 2; if (dd < bd) { bd = dd; c = t.bed[k]; } }
        for (let k = 0; k < n; k++) if (bed[k] < c) bed[k] = c;
      }
      const R = { px, bed };
      beds.set(r.id, R);
      return R;
    };
    for (const r of rivers) {
      const R = bedOf(r, 0);
      if (!R) continue;
      for (let k = 0; k < R.px.length; k++) {
        const i = R.px[k], cx = i % w, cy = (i - cx) / w, b = R.bed[k];
        for (let dy = -RIVER_REACH; dy <= RIVER_REACH; dy++) {
          const y = cy + dy; if (y < 0 || y >= h) continue;
          for (let dx = -RIVER_REACH; dx <= RIVER_REACH; dx++) {
            const x = cx + dx; if (x < 0 || x >= w) continue;
            const D = Math.hypot(dx, dy); if (D > RIVER_REACH) continue;
            const j = y * w + x;
            if (d[j] <= sea) continue;
            const target = Math.round(b + D / RIVER_SIDE);
            if (target < d[j]) d[j] = Math.max(Math.ceil(sea) + 1, target);
          }
        }
      }
    }
  }

  /** The calculated height map: base + ranges raised, divides lifted, river valleys cut. */
  function derive(base, w, h, o) {
    const d = Uint8Array.from(base), sea = Number.isFinite(o.sea) ? o.sea : 0;
    raiseRanges(d, w, h, sea, o.mps || 100, o.ranges || [], o.imgW || w, o.imgH || h);
    const V = findDivides(d, w, h, sea, o.rivers || []);
    if (V.nLow) liftDivides(d, w, h, sea, V);
    carveRivers(d, w, h, sea, o.rivers || []);
    return d;
  }

  /** A box blur of radius r (each way), edges clamped. */
  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h), k = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let s = 0;
      for (let x = -r; x <= r; x++) s += src[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[o + x] = s / k;
        s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = s / k;
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  // ── Suggested rivers ──
  // Where water would run on the height map as it is: rain falls on every land pixel and runs the
  // steepest way down to the sea or a lake; where enough has gathered, a river most likely runs.
  // Hollows are filled as lakes that spill over at their lowest edge, and across flat ground the water
  // takes the shortest way to lower ground (a little smooth noise lets it wander instead of running
  // ruler-straight). Nothing is changed: it only reads the height map.

  /**
   * The drainage of a height raster, at a working size at most ~2800 pixels wide:
   * { f, ww, hh, rec, acc, land } – rec[i] = the cell water at i runs to (-1 at the sea, a lake or
   * the map's edge), acc[i] = how many full-size pixels drain through i (itself included).
   */
  function drainage(base, w, h, sea) {
    const f = Math.max(1, Math.ceil(w / 2800)), ww = Math.floor(w / f), hh = Math.floor(h / f), n = ww * hh;
    // the working raster: f×f means, then a light 3×3 blur, in 16ths of a step plus smooth noise (half a
    // step) so flat ground has a slight lie of its own
    const m = new Float32Array(n), land = new Uint8Array(n);
    for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) {
      let s = 0, wet = 0;
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) { const v = base[(y * f + dy) * w + x * f + dx]; s += v; if (v <= sea) wet++; }
      m[y * ww + x] = s / (f * f);
      land[y * ww + x] = wet * 2 <= f * f ? 1 : 0;
    }
    // The height map comes in whole steps (100 m), so wide plains are dead flat; there the water follows
    // the lie of the land around it (the height map blurred over ~60 km: away from the hills, towards
    // the coast), which the fine detail rides on top of
    const big = boxBlur(boxBlur(boxBlur(m, ww, hh, 6), ww, hh, 6), ww, hh, 6);
    const Q = 32;                                                     // levels per step in the queue
    const z = new Float32Array(n);
    for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) {
      const i = y * ww + x;
      z[i] = land[i] ? 0.5 * m[i] + 0.5 * big[i] + 0.15 * vnoise(x / 7, y / 7) : 0;
    }
    // priority flood: from the sea, lakes and the map's edge upwards, lowest first (a bucket per level,
    // first in first out within one). Hollows are filled to their spill level (fz), and `rank` says in
    // which order cells were reached, so water only ever runs to cells reached before it.
    const NL = 256 * Q + 2, head = new Int32Array(NL).fill(-1), tail = new Int32Array(NL).fill(-1), next = new Int32Array(n).fill(-1);
    const fz = new Float32Array(n), rank = new Int32Array(n), seen = new Uint8Array(n), order = new Int32Array(n);
    const lv = (v) => Math.max(0, Math.min(NL - 1, Math.floor(v * Q)));
    const push = (i) => { const l = lv(fz[i]); if (tail[l] < 0) head[l] = i; else next[tail[l]] = i; tail[l] = i; };
    for (let i = 0; i < n; i++) {
      const x = i % ww, y = (i - x) / ww;
      if (!land[i] || x === 0 || y === 0 || x === ww - 1 || y === hh - 1) { seen[i] = 1; fz[i] = z[i]; push(i); }
    }
    const DX = [-1, 0, 1, -1, 1, -1, 0, 1], DY = [-1, -1, -1, 0, 0, 1, 1, 1], DL = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];
    let k = 0;
    for (let l = 0; l < NL; l++) {
      while (head[l] >= 0) {
        const c = head[l];
        head[l] = next[c]; if (head[l] < 0) tail[l] = -1;
        rank[c] = k; order[k++] = c;
        const cx = c % ww, cy = (c - cx) / ww;
        for (let d = 0; d < 8; d++) {
          const x = cx + DX[d], y = cy + DY[d];
          if (x < 0 || y < 0 || x >= ww || y >= hh) continue;
          const j = y * ww + x;
          if (seen[j]) continue;
          seen[j] = 1; fz[j] = Math.max(z[j], fz[c]);
          push(j);
        }
      }
    }
    // flow, highest first: each cell hands on all it gathered to the neighbour below it that is
    // steepest down (of those reached before it). Only rain on sloping ground counts: on a plain the
    // water spreads out as a sheet instead of gathering into a stream, so no river starts there; one
    // that comes down from the hills carries on across it to the sea.
    const rec = new Int32Array(n).fill(-1), acc = new Float32Array(n), a0 = f * f;
    for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) {
      const i = y * ww + x;
      if (!land[i]) continue;
      let lo = Infinity, hi = -Infinity;
      for (let dy = -2; dy <= 2; dy++) { const yy = y + dy; if (yy < 0 || yy >= hh) continue;
        for (let dx = -2; dx <= 2; dx++) { const xx = x + dx; if (xx < 0 || xx >= ww) continue; const v = m[yy * ww + xx]; if (v < lo) lo = v; if (v > hi) hi = v; } }
      acc[i] = hi - lo >= 1.25 ? a0 : 0;           // more than one terrace step within ~50 km
    }
    for (let o = k - 1; o >= 0; o--) {
      const i = order[o];
      if (!land[i]) continue;
      const cx = i % ww, cy = (i - cx) / ww, ri = rank[i];
      let best = -1, bs = -1;
      for (let d = 0; d < 8; d++) {
        const x = cx + DX[d], y = cy + DY[d];
        if (x < 0 || y < 0 || x >= ww || y >= hh) continue;
        const j = y * ww + x;
        if (rank[j] >= ri) continue;
        const g = (fz[i] - fz[j]) / DL[d];
        if (g > bs) { bs = g; best = j; }
      }
      if (best < 0) continue;
      rec[i] = best;
      acc[best] += acc[i];
    }
    return { f, ww, hh, rec, acc, land };
  }

  /**
   * The suggested rivers from a drainage (above): every course where at least `minArea` full-size
   * pixels drain, except where a river is already drawn (within ~2 working pixels). Returns pieces
   * { pts: [x0, y0, x1, y1, …] (0..1 over the map), cls: 1..5 (how much water) }.
   */
  function suggestRivers(D, rivers, minArea) {
    const { ww, hh, rec, acc, land } = D, n = ww * hh;
    // where rivers are drawn already
    const drawn = new Uint8Array(n), R = 2;
    for (const r of rivers || []) {
      const p = r.points || [];
      for (let s = 0; s + 1 < p.length; s++) {
        const ax = p[s].x * ww, ay = p[s].y * hh, bx = p[s + 1].x * ww, by = p[s + 1].y * hh;
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
        for (let t = 0; t <= steps; t++) {
          const cx = Math.floor(ax + (bx - ax) * t / steps), cy = Math.floor(ay + (by - ay) * t / steps);
          for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
            const x = cx + dx, y = cy + dy;
            if (x >= 0 && y >= 0 && x < ww && y < hh && dx * dx + dy * dy <= R * R + 1) drawn[y * ww + x] = 1;
          }
        }
      }
    }
    const ch = new Uint8Array(n), up = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (land[i] && acc[i] >= minArea) ch[i] = 1;
    for (let i = 0; i < n; i++) if (ch[i] && rec[i] >= 0 && ch[rec[i]]) up[rec[i]] = 1;
    const cls = (i) => Math.max(1, Math.min(5, 1 + Math.floor(Math.log2(acc[i] / minArea) / 1.5)));
    const done = new Uint8Array(n), out = [];
    const emit = (cells, c) => {
      if (cells.length < 2) return;
      // fewer points: drop the ones within 0.6 working pixels of the line (Douglas–Peucker)
      const xs = cells.map((i) => i % ww + 0.5), ys = cells.map((i) => Math.floor(i / ww) + 0.5);
      const keep = new Uint8Array(cells.length); keep[0] = keep[cells.length - 1] = 1;
      const stack = [[0, cells.length - 1]];
      while (stack.length) {
        const [a, b] = stack.pop();
        let bd = 0, bi = -1;
        const dx = xs[b] - xs[a], dy = ys[b] - ys[a], L = Math.hypot(dx, dy) || 1;
        for (let q = a + 1; q < b; q++) { const d = Math.abs((xs[q] - xs[a]) * dy - (ys[q] - ys[a]) * dx) / L; if (d > bd) { bd = d; bi = q; } }
        if (bd > 0.6) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
      }
      const pts = [];
      for (let q = 0; q < cells.length; q++) if (keep[q]) pts.push(xs[q] / ww, ys[q] / hh);
      out.push({ pts, cls: c });
    };
    for (let s = 0; s < n; s++) {
      if (!ch[s] || up[s]) continue;                                   // a source: no course runs into it
      let run = [], rc = 0, i = s;
      for (;;) {
        const was = done[i];
        done[i] = 1;
        if (drawn[i] || !land[i]) {
          // a drawn river (or the sea, or a lake): the suggestion ends at its bank
          if (run.length) { run.push(i); emit(run, rc); run = []; }
          if (was || !land[i]) break;
        } else {
          const c = cls(i);
          if (run.length && c !== rc) { run.push(i); emit(run, rc); run = [i]; rc = c; }
          else { if (!run.length) rc = c; run.push(i); }
          if (was) break;                                               // joins a course already traced
        }
        i = rec[i];
        if (i < 0) break;
      }
      emit(run, rc);
    }
    return out;
  }

  window.EonTerrain = { findDivides, liftDivides, raiseRanges, carveRivers, derive, DIV_MAXD, drainage, suggestRivers };
})();
