/*
 * FieldMap — draws the weather over an uploaded map image.
 *
 * Each region is pinned to the map with one or more anchor points. A value at any
 * spot on the map is a weighted blend of nearby regions (inverse-distance weighting),
 * fading out beyond the "reach" from the nearest anchor. Clouds and rain get
 * structure from noise that drifts with the prevailing wind, so stepping through
 * days and hours shows weather moving across the map. Magic storms start at the
 * region where the generator rolled them and drift downwind for a few days.
 */
(function () {
  "use strict";

  // ── Noise ─────────────────────────────────────────────────────────────
  function hash3(x, y, z) {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h & 0xffffff) / 0xffffff;
  }
  const fade = (t) => t * t * (3 - 2 * t);
  function vnoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
    let v = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const w = (dx ? xf : 1 - xf) * (dy ? yf : 1 - yf) * (dz ? zf : 1 - zf);
      v += w * hash3(xi + dx, yi + dy, zi + dz);
    }
    return v;
  }
  function fbm(x, y, z, oct) {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, z * f + i * 17.3); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }
  const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  // The cloud noise is bunched around its middle, so a plain "noise above (1 - cover)" test
  // covers far more than the cover says. Instead, look up the noise level that exactly
  // `area` of the map lies above (from a sorted sample of the noise), so the drawn area matches.
  const FBM_Q = (() => {
    const n = 4096, s = new Float32Array(n);
    for (let i = 0; i < n; i++) s[i] = fbm(hash3(i, 1, 7) * 400, hash3(i, 2, 7) * 400, hash3(i, 3, 7) * 50, 4);
    return s.sort();
  })();
  const fbmQuantile = (q) => FBM_Q[Math.max(0, Math.min(FBM_Q.length - 1, Math.round(q * (FBM_Q.length - 1))))];
  const FBM_SPREAD = fbmQuantile(0.7) - fbmQuantile(0.3);
  // How much of the map is drawn under cloud for a given cloud cover (0..1): a little sparser
  // than the number, so the map stays readable (30 % -> ~15 %, 50 % -> ~33 %, 80 % -> ~70 %).
  const cloudArea = (cc) => Math.pow(Math.max(0, Math.min(1, cc)), 1.6);
  // Share of a spot's rain that actually falls there, from how cloudy the spot is drawn:
  // none in the clear, full rain well inside the cloud.
  const rainUnderCloud = (density) => smooth(0.25, 0.6, density);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ── Colour ramps ──────────────────────────────────────────────────────
  function ramp(stops, v) {
    if (v <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) {
        const [a, ca] = stops[i - 1], [b, cb] = stops[i];
        const t = (v - a) / (b - a);
        return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
      }
    }
    return stops[stops.length - 1][1];
  }
  const TEMP_STOPS = [[-35, [40, 50, 160]], [-15, [70, 120, 220]], [-3, [150, 200, 240]], [3, [225, 235, 230]],
    [12, [235, 215, 130]], [22, [235, 150, 70]], [32, [215, 70, 50]], [42, [140, 20, 40]]];
  const RAIN_STOPS = [[0, [130, 200, 230]], [2, [70, 160, 220]], [4, [40, 100, 200]], [6, [110, 60, 200]]];
  const FORCE_COLOURS = {
    Grundkrafter: "#d9d2ff", Primalkrafter: "#ff8296", Elementarkrafter: "#4fd6c4",
    Livskrafter: "#93df6a", Himlakrafter: "#7fb8ff", Symbolkrafter: "#f0a8ff",
  };
  const MAGIC_DEFAULT = "#a98bf2";
  const DIRS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
  /** Unit vector the wind blows TOWARD (engine direction = where it blows FROM). Screen y points down. */
  function toVec(dir) {
    const b = (DIRS[dir] ?? 0) * Math.PI / 180;
    return [-Math.sin(b), Math.cos(b)];
  }

  const GRID_W = 340, TOP_K = 4;
  // Cloud speed: pattern units (1/6 of the map's width) per day per step of wind strength.
  // Wind 5 on Mundana is then about 30 km/h.
  const FLOW = 0.03;

  // Leyline (kraftlinje) colours, one per aspect, matched to the aspect symbols.
  const LEY_COLOURS = {
    Kronotropi: "#c9a24a", Nomotropi: "#a9b8d0", Ataxatropi: "rainbow",
    Termotropi: "#e0505a", Kryotropi: "#3fb0a0", Fototropi: "#f4f1e6", Skototropi: "#0d0d12",
    Pyrotropi: "#ee8a33", Geotropi: "#a2703a", Pneumotropi: "#4cc6e6", Hydrotropi: "#4d6fd6",
    Biotropi: "#3fb34f", Nekrotropi: "#8f8f8f", Heliotropi: "#ffd23f", Selenotropi: "#c8c8ff",
    Astrotropi: "#6a5ae0", Ikonotropi: "#9b5fc8",
  };
  const LEY_SAMPLES = 480;

  class FieldMap {
    constructor(stage, canvas, opts) {
      this.stage = stage;
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.opts = opts || {};
      this.img = null; this.imgW = 1; this.imgH = 1;
      this.anchors = [];       // {region, x, y} in 0..1
      this.field = null;
      this.regionIndex = new Map();
      this.layers = new Set(["cloud", "rain", "magic"]);
      this.reach = 0.2;
      this.editing = false;
      this.view = { s: 1, ox: 0, oy: 0 };
      this.grid = null;
      this.off = document.createElement("canvas");
      this.offCtx = this.off.getContext("2d");
      this.selectedRegion = null;
      this.opacity = 1;        // fades everything drawn over the map image
      this.symbols = {};       // aspect or force name → loaded Image
      this.height = null;      // { data: Float32Array 0..255, w, h, canvas } stretched over the map
      this.blockHeight = 200;  // terrain this much higher than a spot blocks all wind behind it
      this.showHeight = false;
      this.fields = new Map();   // day serial → field data (yesterday, today, tomorrow…)
      this.T = 0;                // the running clock: day serial + hour/24
      this.fv = null;            // per-region values at time T (computed once per frame)
      this.oroCache = new Map(); // day serial → orographic factors per grid cell
      this.fx = { rain: true, cloud: true };
      this.fxCanvas = this.opts.fxCanvas || null;
      this.fxCtx = this.fxCanvas ? this.fxCanvas.getContext("2d") : null;
      this.particles = [];
      this.reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.highlight = null;   // {x, y} popup marker
      this.leylines = [];      // {aspect, a:{x,y}, b:{x,y}}; each is the great circle through a and b
      this.editMode = "regions"; // or "ley" (placing leylines)
      this.leyAspect = "Pyrotropi";
      this.selectedLey = -1;
      this.leyHidden = new Set(); // aspects whose leylines and areas are not drawn
      this.zones = [];          // högmagiska områden: {aspect, points: [{x, y}, …]}
      this.selectedZone = -1;   // the area being edited (clicks add points to it)
      this._bindEvents();
      new ResizeObserver(() => this._resize()).observe(stage);
    }

    // ── Public API ──────────────────────────────────────────────────────
    setImage(img, w, h) {
      this.img = img; this.imgW = w || 1; this.imgH = h || 1;
      this.userMoved = false;
      this.grid = null;
      this._resize(true);
    }
    setAnchors(list) { this.anchors = list.map((a) => ({ ...a })); this.grid = null; this._offsets = null; this.fv = null; this.draw(); }
    getAnchors() { return this.anchors.map((a) => ({ region: a.region, x: a.x, y: a.y })); }
    setReach(r) { this.reach = r; this.grid = null; this.draw(); }
    /**
     * Sharper map tiles shown over the map image when zoomed in (only where the full-size map has
     * real detail). path: folder with manifest.json and {level}/{x}_{y}.jpg, or null for none.
     */
    async setTiles(path) {
      this.tiles = null; this.tileCache = new Map();
      // only the app's own tile folders (tiles/<name>/), never another site
      if (path && !/^tiles\/[\w.-]+\/$/.test(path)) path = null;
      this._tilePath = path || null;
      if (!path) { this.draw(); return; }
      const base = "/weather/" + path; // the page lives under /weather/ in the combined app
      try {
        const r = await fetch(base + "manifest.json");
        if (!r.ok || this._tilePath !== path) return;
        const m = await r.json();
        const T = { base, ts: m.tileSize, fullW: m.fullWidth || this.imgW, levels: m.levels.map((l) => ({ level: l.level, w: l.width, h: l.height, have: new Set(l.tiles) })) };
        // map layers (manifest "base" and "layers"): the zoom images as they are hold all default
        // layers; any other choice is drawn as the base map with the chosen see-through layers on top
        const sets = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, a]) => [k, new Set(a)]));
        T.baseMap = m.base ? { tiles: sets(m.base.tiles), hide: sets(m.base.hide), map: m.base.map || null } : null;
        T.layers = T.baseMap ? (m.layers || []).map((v) => ({ id: String(v.id), name: v.name || v.id, def: !!v.default, tiles: sets(v.tiles), map: v.map || null })) : [];
        T.chosen = null;                                       // null: the default layers (the zoom images as they are)
        /** The images that make zoom image level/x_y for the chosen layers, bottom first ([] = none). */
        T.srcs = (level, id) => {
          const L = T.levels.find((l) => l.level === level), own = L && L.have.has(id) ? base + level + "/" + id + ".jpg" : null;
          if (!T.chosen) return own ? [own] : [];
          const B = T.baseMap, out = [];
          if (B.tiles[level] && B.tiles[level].has(id)) out.push(base + "base/" + level + "/" + id + ".jpg");
          else if (!(B.hide[level] && B.hide[level].has(id)) && own) out.push(own);
          for (const v of T.chosen) if (v.tiles[level] && v.tiles[level].has(id)) out.push(base + "layers/" + v.id + "/" + level + "/" + id + ".webp");
          return out;
        };
        this.tiles = T;
        this.setTileLayers(this._tileLayers === undefined ? null : this._tileLayers);
        if (this.onTilesLoaded) this.onTilesLoaded(T.layers);
      } catch (e) { /* no tiles: the map image alone is shown */ }
    }
    /** Which map layers to show over the base map: a list of layer ids, or null for the default ones. */
    setTileLayers(ids) {
      this._tileLayers = Array.isArray(ids) ? ids.slice() : null;
      const T = this.tiles;
      if (!T) return;
      let chosen = null;
      if (this._tileLayers && T.layers.length) {
        const want = new Set(this._tileLayers);
        const same = T.layers.every((v) => v.def === want.has(v.id));
        if (!same) chosen = T.layers.filter((v) => want.has(v.id));      // in drawing order
      }
      const sig = (c) => (c ? c.map((v) => v.id).join(",") : "*");
      if (sig(chosen) !== sig(T.chosen)) {
        T.chosen = chosen; this.tileCache = new Map();
        const need = chosen ? [{ key: "base", src: T.base + "base/map.jpg", map: T.baseMap.map }, ...chosen.map((v) => ({ key: v.id, src: T.base + "layers/" + v.id + "/map.webp", map: v.map }))] : [];
        T.patches = T.patches || {};
        for (const n of need) if (n.map && !T.patches[n.key]) {
          const p = T.patches[n.key] = { img: new Image(), ok: false, map: n.map };
          p.img.onload = () => { p.ok = true; this.draw(); };
          p.img.src = n.src;
        }
      }
      this.draw();
    }
    /** The map layers there are ([{ id, name, def }]); empty when the zoom images have none. */
    tileLayers() { return this.tiles && this.tiles.layers ? this.tiles.layers : []; }
    /** The parts of the map picture to draw over it for the chosen layers, bottom first. */
    _mapPatches() {
      const T = this.tiles;
      if (!T || !T.chosen || !T.patches) return [];
      return ["base", ...T.chosen.map((v) => v.id)].map((k) => T.patches[k]).filter((p) => p && p.map);
    }
    _drawTiles() {
      const T = this.tiles, ctx = this.ctx, { s, ox, oy } = this.view, dpr = this.dpr || 1;
      const shownW = this.imgW * s * dpr;              // device pixels across the whole map
      if (shownW <= this.imgW * 1.15) return;           // the map image is sharp enough
      // coarse → fine; use the first level that is at least as sharp as the screen
      const lv = [...T.levels].sort((a, b) => a.w - b.w);
      let target = lv.length - 1;
      for (let i = 0; i < lv.length; i++) if (lv[i].w * 1.15 >= shownW) { target = i; break; }
      const [vx0, vy0] = this.toMap(0, 0), [vx1, vy1] = this.toMap(this.cssW, this.cssH);
      const W = this.imgW * s, H = this.imgH * s;
      ctx.save();
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      const want = new Set();
      for (let i = 0; i <= target; i++) {
        const L = lv[i], ts = T.ts;
        const tx0 = Math.max(0, Math.floor(vx0 * L.w / ts)), tx1 = Math.min(Math.ceil(L.w / ts) - 1, Math.floor(vx1 * L.w / ts));
        const ty0 = Math.max(0, Math.floor(vy0 * L.h / ts)), ty1 = Math.min(Math.ceil(L.h / ts) - 1, Math.floor(vy1 * L.h / ts));
        if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 400) continue; // far too many: wait until zoomed in further
        for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
          const id = tx + "_" + ty;
          const key = L.level + "/" + id;
          let t = this.tileCache.get(key);
          if (!t && i === target) {
            const srcs = T.srcs(L.level, id);
            if (!srcs.length) continue;
            // one or more images (base, then see-through layers); shown once all have come
            t = { imgs: srcs.map(() => new Image()), left: srcs.length, ok: false };
            t.imgs.forEach((im, k) => {
              const done = () => { if (--t.left === 0) { t.ok = true; this.draw(); } };
              im.onload = done; im.onerror = () => { im.bad = true; done(); };
              im.src = srcs[k];
            });
            this.tileCache.set(key, t);
          }
          if (i === target) want.add(key);
          if (!t || !t.ok) continue;
          t.used = performance.now();
          const tw = Math.min(ts, L.w - tx * ts), th = Math.min(ts, L.h - ty * ts);
          const x0 = Math.floor(ox + tx * ts / L.w * W), y0 = Math.floor(oy + ty * ts / L.h * H);
          const x1 = Math.ceil(ox + (tx * ts + tw) / L.w * W), y1 = Math.ceil(oy + (ty * ts + th) / L.h * H);
          for (const im of t.imgs) if (!im.bad) ctx.drawImage(im, x0, y0, x1 - x0, y1 - y0);
        }
      }
      ctx.restore();
      // keep memory in check: forget the least recently used tiles that are not on screen
      if (this.tileCache.size > 220) {
        const old = [...this.tileCache.entries()].filter(([k, t]) => !want.has(k)).sort((a, b) => (a[1].used || 0) - (b[1].used || 0));
        for (const [k] of old.slice(0, this.tileCache.size - 160)) this.tileCache.delete(k);
      }
    }
    setLeylines(list) {
      this.leylines = (list || []).map((l) => ({ aspect: l.aspect, a: { x: l.a.x, y: l.a.y }, b: { x: l.b.x, y: l.b.y } }));
      this.selectedLey = -1; this._leyCache = new Map(); this.draw();
    }
    getLeylines() { return this.leylines.map((l) => ({ aspect: l.aspect, a: { ...l.a }, b: { ...l.b } })); }
    setEditMode(m) {
      this.editMode = m === "ley" || m === "zone" || m === "height" || m === "river" || m === "nation" || m === "range" || m === "road" ? m : "regions"; this.selectedLey = -1; this.selectedZone = -1;
      if (m !== "road" && this.wyCancelDraft) this.wyCancelDraft();
      if (m !== "range" && this.rgDrawing && this.rgFinish) this.rgFinish();
      if (m !== "river" && this.rvCancel) { this.rvDraft = null; this._rvSnap = null; }
      if (m !== "nation" && this.ntDrawing && this.ntFinish) this.ntFinish();
      this.draw();
    }
    setZones(list) {
      this.zones = (list || []).map((z) => ({ aspect: z.aspect, points: (z.points || []).map((p) => ({ x: p.x, y: p.y })) }));
      this.selectedZone = -1; this.draw();
    }
    getZones() { return this.zones.filter((z) => z.points.length).map((z) => ({ aspect: z.aspect, points: z.points.map((p) => ({ ...p })) })); }
    /** The next click starts a new area instead of adding to the selected one. */
    newZone() { this.selectedZone = -1; this.draw(); }
    /** Areas (shown aspects only) containing a spot: [aspect, …]. */
    zonesAt(nx, ny) {
      const W = this._leyW(), out = [];
      for (const z of this.zones) {
        if (z.points.length < 3 || !this._leyShown(z)) continue;
        if ([0, -W, W].some((o) => this._inPoly(nx + o, ny, z.points))) out.push(z.aspect);
      }
      return out;
    }
    _inPoly(x, y, pts) {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    }
    setLeyAspect(a) {
      this.leyAspect = a;
      if (this.editMode === "zone") {
        // picking an aspect while an area is being edited re-colours that area
        if (this.selectedZone >= 0 && this.zones[this.selectedZone]) {
          this.zones[this.selectedZone].aspect = a;
          this.opts.onZonesChanged && this.opts.onZonesChanged();
        }
        this.draw();
        return;
      }
      // changing the aspect while a line is selected re-colours that line
      if (this.selectedLey >= 0 && this.leylines[this.selectedLey]) {
        this.leylines[this.selectedLey].aspect = a;
        this.opts.onLeylinesChanged && this.opts.onLeylinesChanged();
      }
      this.draw();
    }
    setLeyHidden(list) { this.leyHidden = new Set(list || []); if (this.selectedZone >= 0 && this.zones[this.selectedZone] && this.leyHidden.has(this.zones[this.selectedZone].aspect)) this.selectedZone = -1; if (this.selectedLey >= 0 && this.leylines[this.selectedLey] && this.leyHidden.has(this.leylines[this.selectedLey].aspect)) this.selectedLey = -1; this.draw(); }
    _leyShown(l) { return !this.leyHidden.has(l.aspect); }
    static leyColour(aspect) { return LEY_COLOURS[aspect] || "#e7e1d1"; }
    /** Leylines passing within km of a spot (or about 1.5° when the map has no scale): [{aspect, km}]. */
    leylinesNear(nx, ny, km) {
      const R = this._globeRadiusKm(), out = [];
      const p = this._leyVec(nx, ny), lim = R ? km / R : 1.5 * Math.PI / 180;
      for (const l of this.leylines) {
        if (!this._leyShown(l)) continue;
        const n = this._leyNormal(l);
        const ang = Math.abs(Math.asin(Math.max(-1, Math.min(1, p[0] * n[0] + p[1] * n[1] + p[2] * n[2]))));
        if (ang <= lim) out.push({ aspect: l.aspect, km: R ? Math.round(ang * R) : null });
      }
      return out;
    }
    /** map: day serial → field data. Keep yesterday, today and tomorrow in it. */
    setFields(map) {
      this.fields = map;
      const cur = map.get(Math.floor(this.T)) || this.field || map.values().next().value;
      if (cur && (!this.field || this.regionIndex.size !== cur.regions.length)) {
        this.regionIndex = new Map();
        cur.regions.forEach((r, i) => this.regionIndex.set(r.name, i));
        this.grid = null;
      }
      if (cur) this.field = cur;
      this.oroCache.clear();
      this.fv = null;
      this.draw();
    }
    /** T = day serial + hour/24, a continuous clock. */
    setTime(T) {
      this.T = T;
      const f = this.fields.get(Math.floor(T));
      if (f) this.field = f;
      this.fv = null;
      this.draw();
    }
    get hourOfDay() { return (this.T - Math.floor(this.T)) * 24; }
    setFx(kind, on) { this.fx[kind] = on; this.draw(); }
    setLayers(set) { this.layers = new Set(set); this.draw(); }
    setOpacity(o) { this.opacity = o; this.draw(); }

    // ── Height map ──────────────────────────────────────────────────────
    /** img: a greyscale image (black 0 = low, white 255 = high), or null to remove. */
    /**
     * The height map (greyscale image, or a canvas from the height painter). For wind and rain a
     * copy at most 1024 wide is kept; with a sea level set, everything below it counts as a flat
     * water surface there (the sea floor's depth doesn't steer wind).
     */
    setHeightImage(img) {
      this.heightSource = img || null;
      if (!img) { this.height = null; this.grid = null; this.oroCache.clear(); this.draw(); return; }
      const w = Math.min(img.naturalWidth || img.width, 1024);
      const h = Math.max(1, Math.round(w * this.imgH / this.imgW)); // stretched to the map's shape
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const c = cv.getContext("2d", { willReadFrequently: true });
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
      c.drawImage(img, 0, 0, w, h);
      const px = c.getImageData(0, 0, w, h).data;
      const raw = new Float32Array(w * h), data = new Float32Array(w * h), sea = this.seaLevel;
      for (let i = 0; i < w * h; i++) {
        const v = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
        raw[i] = v; data[i] = sea != null && v < sea ? sea : v;
      }
      this.height = { data, raw, w, h, canvas: cv };
      this.grid = null;
      this.oroCache.clear();
      this.draw();
    }
    /** The forest map (greyscale, 0 = no trees … 100 = trees everywhere), or a canvas from the painter. */
    setForestImage(img) {
      this.forestSource = img || null;
      this._fview = null;
      this._iceGrid = null; this._forestGrid = null;
      this.draw();
    }
    /** The ice map (greyscale, 0 = no ice … 100 = all ice), or a canvas from the painter. */
    setIceImage(img) {
      this.iceSource = img || null;
      this._iview = null;
      this._iceGrid = null;
      this.draw();
    }
    /**
     * A painted layer's value at a map point, 0–100 ("forest" or "ice"), from a copy at most 2048 wide
     * kept until the layer changes. 0 without the layer.
     */
    layerAt(kind, nx, ny) {
      const src = kind === "ice" ? this.iceSource : this.forestSource;
      if (!src) return 0;
      const key = kind === "ice" ? "_iceGrid" : "_forestGrid";
      let G = this[key];
      if (!G || G.src !== src) {
        const w = Math.min(src.naturalWidth || src.width, 2048), h = Math.max(1, Math.round(w * this.imgH / this.imgW));
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        const c = cv.getContext("2d", { willReadFrequently: true });
        c.drawImage(src, 0, 0, w, h);
        const px = c.getImageData(0, 0, w, h).data, d = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) d[i] = Math.min(100, px[i * 4]);
        G = this[key] = { src, w, h, d };
      }
      const x = clamp(Math.floor(nx * G.w), 0, G.w - 1), y = clamp(Math.floor(ny * G.h), 0, G.h - 1);
      return G.d[y * G.w + x];
    }
    /** Height scale: grey value of sea level and metres per grey step (null = no scale). */
    setHeightScale(seaLevel, metersPerStep) {
      this.seaLevel = Number.isFinite(seaLevel) ? seaLevel : null;
      this.metersPerStep = metersPerStep > 0 ? metersPerStep : null;
      if (this.heightSource) this.setHeightImage(this.heightSource);
    }
    /** Ground height at a spot as stored (including sea depth), 0–255. */
    rawHeightAt(nx, ny) {
      const E = this.hp && this.hp.data && this.hp.target === "height" ? this.hp : null;
      if (E) {
        const x = clamp(Math.floor(nx * E.w), 0, E.w - 1), y = clamp(Math.floor(ny * E.h), 0, E.h - 1);
        return E.data[y * E.w + x];
      }
      const H = this.height;
      if (!H) return null;
      const x = clamp(Math.floor(nx * H.w), 0, H.w - 1), y = clamp(Math.floor(ny * H.h), 0, H.h - 1);
      return H.raw[y * H.w + x];
    }
    setBlockHeight(v) { this.blockHeight = v; this.grid = null; this.oroCache.clear(); this.draw(); }
    /**
     * East-west wrap: the number of unique pixel columns once around the world (0 = no wrap).
     * Columns from there to the image's right edge repeat the left edge (Mundana: 3110 of 3192).
     */
    setWrap(px) { this.wrapP = px > 0 && this.imgW ? Math.min(1, px / this.imgW) : 0; this.grid = null; this.oroCache.clear(); this.draw(); }
    /** Map x (0..1) folded into the first lap when the map wraps. */
    _wrapX(nx) { const P = this.wrapP; return P ? ((nx % P) + P) % P : nx; }
    /**
     * Noise that continues across the wrap seam: just before the seam it blends into the
     * noise at the matching spot on the left edge, so the right edge and the left edge show
     * the same clouds. f takes x in cloud-pattern units (map x × 6).
     */
    _wrapNoise(mx, f) {
      let n = f(mx * 6);
      const P = this.wrapP, band = 0.03;
      if (P && mx > P - band) { const w = smooth(P - band, P, mx); n = n * (1 - w) + f((mx - P) * 6) * w; }
      return n;
    }
    /** Map scale: kilometres per pixel of the original map image (0 = unknown, no scale bar). */
    setScale(kmPerPixel) { this.kmPerPx = kmPerPixel > 0 ? kmPerPixel : 0; this.draw(); }
    /** Distance in km between two map points (0..1 coordinates), or null without a scale. */
    distanceKm(ax, ay, bx, by) {
      if (!this.kmPerPx) return null;
      return Math.hypot((bx - ax) * this.imgW, (by - ay) * this.imgH) * this.kmPerPx;
    }
    setShowHeight(on) { this.showHeight = on; this.draw(); }
    /** Height 0..255 at a map point (bilinear). */
    heightAt(nx, ny) {
      const H = this.height;
      if (!H) return 0;
      if (this.wrapP && (nx < 0 || nx > 1)) nx = this._wrapX(nx);
      const x = clamp(nx * H.w - 0.5, 0, H.w - 1), y = clamp(ny * H.h - 0.5, 0, H.h - 1);
      const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, H.w - 1), y1 = Math.min(y0 + 1, H.h - 1);
      const fx = x - x0, fy = y - y0, d = H.data;
      const a = d[y0 * H.w + x0] * (1 - fx) + d[y0 * H.w + x1] * fx;
      const b = d[y1 * H.w + x0] * (1 - fx) + d[y1 * H.w + x1] * fx;
      return a * (1 - fy) + b * fy;
    }
    /**
     * Wind at a spot after terrain: looks upwind and finds the highest ground that rises above
     * this spot. Ground blockHeight higher blocks the wind completely; less blocks proportionally,
     * fading with distance. Wind running into a slope is also turned to flow along it.
     * (ux, uy) = unit direction the wind blows toward, in map-width units.
     * Returns { factor 0..1 (share of wind left), ux, uy (possibly deflected) }.
     */
    terrainWind(nx, ny, ux, uy) {
      if (!this.height) return { factor: 1, ux, uy };
      const aspect = this.imgH / this.imgW;
      const here = this.heightAt(nx, ny);
      const steps = 24, reach = 0.09; // look this far upwind (fraction of the map's width)
      let block = 0, sumUp = 0, nUp = 0;
      for (let k = 1; k <= steps; k++) {
        const d = reach * k / steps;
        const qx = nx - ux * d, qy = ny - uy * d / aspect;
        if (qx < 0 || qx > 1 || qy < 0 || qy > 1) break;
        const hq = this.heightAt(qx, qy);
        sumUp += hq; nUp++;
        const rise = hq - here;
        if (rise <= 0) continue;
        const fade = 1 - Math.pow(k / steps, 2);
        block = Math.max(block, clamp(rise / this.blockHeight, 0, 1) * fade);
      }
      // steer along slopes the wind is running into
      const e = 0.004;
      const gx = (this.heightAt(nx + e, ny) - this.heightAt(nx - e, ny)) / (2 * e);
      const gy = (this.heightAt(nx, ny + e / aspect) - this.heightAt(nx, ny - e / aspect)) / (2 * e);
      const gm = Math.hypot(gx, gy);
      let vx = ux, vy = uy;
      if (gm > 1e-6) {
        const nxg = gx / gm, nyg = gy / gm, into = vx * nxg + vy * nyg;
        if (into > 0) {
          const steer = clamp(gm / (this.blockHeight * 6), 0, 1);
          vx -= nxg * into * steer; vy -= nyg * into * steer;
          const m = Math.hypot(vx, vy) || 1;
          vx /= m; vy /= m;
        }
      }
      // exposed high ground (peaks, ridges) catches more wind than the land the wind came over
      const exposure = nUp ? clamp((here - sumUp / nUp) / this.blockHeight, 0, 1) : 0;
      return { factor: (1 - block) * (1 + 0.35 * exposure), ux: vx, uy: vy };
    }

    /**
     * Orographic weather at a spot: air pushed up a slope gives more cloud and rain (windward side);
     * air that has crossed higher ground is dried out (rain shadow on the lee side).
     * wind = strength there; calm days give a weak effect.
     */
    orographic(nx, ny, ux, uy, wind) {
      const none = { rainMul: 1, rainAdd: 0, cloudAdd: 0, lift: 0, shadow: 0 };
      if (!this.height) return none;
      const aspect = this.imgH / this.imgW;
      const here = this.heightAt(nx, ny);
      // rise of the ground just upwind → how hard the air is pushed up right here
      // (rises under ~15% of blockHeight, like a low coast, barely count)
      const near = 0.025;
      const ux0 = nx - ux * near, uy0 = ny - uy * near / aspect;
      const lift = (ux0 < 0 || ux0 > 1 || uy0 < 0 || uy0 > 1) ? 0
        : clamp((here - this.heightAt(ux0, uy0) - this.blockHeight * 0.15) / (this.blockHeight * 0.4), 0, 1);
      // highest ground upwind (relative to here) → how much moisture the air has already lost
      const steps = 28, reach = 0.15;
      let shadow = 0;
      for (let k = 2; k <= steps; k++) {
        const d = reach * k / steps;
        const qx = nx - ux * d, qy = ny - uy * d / aspect;
        if (qx < 0 || qx > 1 || qy < 0 || qy > 1) break;
        const rise = this.heightAt(qx, qy) - here;
        if (rise <= 0) continue;
        shadow = Math.max(shadow, clamp(rise / this.blockHeight, 0, 1) * (1 - Math.pow(k / steps, 1.5)));
      }
      const w = clamp(wind / 6, 0.25, 1);
      return {
        rainMul: (1 + 1.5 * lift * w) * (1 - 0.85 * shadow * w),
        rainAdd: 1.5 * lift * w,               // drizzle on windward slopes when it's cloudy anyway
        cloudAdd: (30 * lift - 40 * shadow) * w,
        lift, shadow,
      };
    }
    setSymbols(map) { this.symbols = map || {}; this.draw(); }
    /** The symbol images a storm will be drawn with (dominant aspects, else its force), possibly empty. */
    symbolsFor(s) {
      const imgs = (s.dominant || []).map((a) => this.symbols[a]).filter(Boolean);
      if (imgs.length) return imgs;
      return s.force && this.symbols[s.force] ? [this.symbols[s.force]] : [];
    }

    setEditing(on, region) { this.editing = on; this.stage.style.touchAction = on ? "none" : ""; this.selectedRegion = region || null; this.stage.classList.toggle("editing", on); this.draw(); }
    setSelectedRegion(r) { this.selectedRegion = r; this.draw(); }
    setHighlight(p) { this.highlight = p; this.draw(); }
    hasAnchors() { return this.anchors.length > 0; }

    /** Weather at a map point (0..1 coords) for the current hour. */
    sample(nx, ny) {
      if (!this.field) return null;
      const w = this._weightsAt(nx, ny * this.imgH / this.imgW);
      if (!w) return null;
      const vals = this._blend(w.idx, w.wt);
      const regions = this.field.regions;
      let best = 0;
      for (let k = 1; k < w.idx.length; k++) if (w.wt[k] > w.wt[best]) best = k;
      const near = regions[w.idx[best]];
      const storms = this._stormPositions().filter((s) => Math.hypot(s.x - nx, (s.y - ny) * this.imgH / this.imgW) < s.r * 1.1);
      let windHere = vals.wind, shelter = 0, elevation = null, lift = 0, rainShadow = 0;
      if (this.height) {
        const m = Math.hypot(vals.vx, vals.vy) || 1;
        const tw = this.terrainWind(nx, ny, vals.vx / m, vals.vy / m);
        windHere = vals.wind * tw.factor; shelter = Math.max(0, 1 - tw.factor); elevation = this.rawHeightAt(nx, ny);
        const o = this.orographic(nx, ny, vals.vx / m, vals.vy / m, vals.wind);
        vals.cloud = clamp(vals.cloud + o.cloudAdd, 0, 100);
        const base = vals.rain;
        vals.rain = Math.min(base * o.rainMul + (vals.cloud > 60 ? o.rainAdd * (vals.cloud - 60) / 40 : 0), Math.max(base, 6));
        lift = o.lift; rainShadow = o.shadow;
      }
      {
        const aspect = this.imgH / this.imgW;
        vals.rain *= rainUnderCloud(this._cloudDensity(nx * 6, ny * aspect * 6, vals.cloud, this._flowAt(w.idx, w.wt)));
      }
      return { ...vals, windOpen: vals.wind, wind: windHere, shelter, elevation, lift, rainShadow, region: near, coverage: w.cov, storms };
    }

    // ── Geometry ────────────────────────────────────────────────────────
    _resize(fit) {
      const dpr = window.devicePixelRatio || 1;
      const r = this.stage.getBoundingClientRect();
      // When only the height or position of the map area changes (a toolbar opened or closed above
      // it), keep the map still on the screen instead of re-fitting it or letting it slide along.
      const top = r.top + window.scrollY, prevTop = this._stageTop, prevW = this.cssW;
      this._stageTop = top;
      const sameWidth = this._fitted && prevW && Math.abs(r.width - prevW) < 1;
      if (!fit && sameWidth && prevTop != null) {
        this.view.oy -= top - prevTop;
        this._keepView = true;
      } else this._keepView = false;
      this.cssW = r.width; this.cssH = r.height;
      this.canvas.width = Math.max(1, Math.round(r.width * dpr));
      this.canvas.height = Math.max(1, Math.round(r.height * dpr));
      if (this.fxCanvas) { this.fxCanvas.width = this.canvas.width; this.fxCanvas.height = this.canvas.height; }
      this.dpr = dpr;
      if (fit || !this._fitted || (!this.userMoved && !this._keepView)) this.fit();
      this.draw();
    }
    fit() {
      if (!this.img || !this.cssW) return;
      const s = Math.min(this.cssW / this.imgW, this.cssH / this.imgH) * 0.98;
      this.view = { s, ox: (this.cssW - this.imgW * s) / 2, oy: (this.cssH - this.imgH * s) / 2 };
      this._fitted = true;
    }
    toScreen(nx, ny) { return [nx * this.imgW * this.view.s + this.view.ox, ny * this.imgH * this.view.s + this.view.oy]; }
    toMap(sx, sy) { return [(sx - this.view.ox) / (this.view.s * this.imgW), (sy - this.view.oy) / (this.view.s * this.imgH)]; }

    // ── Blending ────────────────────────────────────────────────────────
    _anchorPoints() {
      // [x, y (in width units), regionIdx]
      const aspect = this.imgH / this.imgW;
      const pts = [];
      const regs = this.field ? this.field.regions : [];
      for (const a of this.anchors) {
        const ri = this.regionIndex.get(a.region);
        if (ri === undefined) continue;
        // contained regions (e.g. a hot valley): their weather stays within this radius
        const R = (regs[ri] && regs[ri].containedRadius) || 0;
        pts.push([a.x, a.y * aspect, ri, R]);
      }
      return pts;
    }
    _weightsAt(x, y, pts, topK = TOP_K) {
      pts = pts || this._anchorPoints();
      if (!pts.length) return null;
      // Per-region weight sums in reusable arrays (this runs for every cell of the map grid).
      const n = Math.max(1, this.regionIndex.size);
      if (!this._wPer || this._wPer.length < n) {
        this._wPer = new Float64Array(n); this._wRaw = new Float64Array(n); this._wTouched = new Int32Array(n);
      }
      const per = this._wPer, raw = this._wRaw, touched = this._wTouched, P = this.wrapP || 0;
      let nt = 0, anyPer = false, dmin = Infinity;
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k], ri = p[2], R = p[3];
        let dx = p[0] - x;
        if (P) dx -= P * Math.round(dx / P);           // the shorter way round the world
        const dy = p[1] - y, d2 = dx * dx + dy * dy;
        if (d2 < dmin) dmin = d2;
        const b = d2 + 1e-5;
        let w = 1 / (b * Math.sqrt(b));            // inverse distance, power 3
        if (raw[ri] === 0) touched[nt++] = ri;
        raw[ri] += w;
        if (R > 0) {
          // A contained region rules inside its radius (with a soft edge over the outer
          // 40 %) and has no influence at all outside it, so its weather doesn't spread.
          const core = 1 - smooth(R * 0.6, R, Math.sqrt(d2));
          w = core > 0 ? w * (1 + 400 * core) : 0;
        }
        if (w > 0) { per[ri] += w; anyPer = true; }
      }
      const src = anyPer ? per : raw; // only contained regions nearby: fall back to plain blending
      const idx = [], wt = [];
      let sum = 0;
      for (let k = 0; k < topK; k++) {
        let best = -1, bv = 0;
        for (let t = 0; t < nt; t++) { const ri = touched[t], v = src[ri]; if (v > bv && !idx.includes(ri)) { bv = v; best = ri; } }
        if (best < 0) break;
        idx.push(best); wt.push(bv); sum += bv;
      }
      for (let t = 0; t < nt; t++) { per[touched[t]] = 0; raw[touched[t]] = 0; }
      for (let k = 0; k < wt.length; k++) wt[k] /= sum;
      const cov = 1 - smooth(this.reach * 0.55, this.reach, Math.sqrt(dmin));
      return { idx, wt, cov };
    }
    _buildGrid() {
      const gw = GRID_W, gh = Math.max(1, Math.round(GRID_W * this.imgH / this.imgW));
      const aspect = this.imgH / this.imgW;
      const pts = this._anchorPoints();
      const n = gw * gh;
      const idx = new Int16Array(n * TOP_K).fill(-1), wt = new Float32Array(n * TOP_K), cov = new Float32Array(n);
      if (pts.length) {
        for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
          const x = (i + 0.5) / gw, y = (j + 0.5) / gh * aspect;
          const w = this._weightsAt(x, y, pts);
          const c = j * gw + i;
          cov[c] = w.cov;
          for (let k = 0; k < w.idx.length; k++) { idx[c * TOP_K + k] = w.idx[k]; wt[c * TOP_K + k] = w.wt[k]; }
        }
      }
      this.off.width = gw; this.off.height = gh;
      this.grid = { gw, gh, idx, wt, cov, image: this.offCtx.createImageData(gw, gh), hasAnchors: pts.length > 0,
        // last painted values per cell, used by the rain effect and cloud symbols
        rainV: new Float32Array(n), tempV: new Float32Array(n), densV: new Float32Array(n),
        vxV: new Float32Array(n), vyV: new Float32Array(n) };
      this.oroCache.clear();
    }
    /**
     * Every region's values at time T, computed once per frame. Within a day the hourly values
     * are interpolated; from 22:00 to 02:00 the two days are blended, so nothing jumps at midnight.
     */
    /**
     * The weather at a map spot as the map draws it (for the 3D view): how cloudy it is drawn
     * (density 0..1), rain, temperature, cloud cover, fog and wind, at the current time.
     * Lighter than sample(): no terrain wind, but with the orographic cloud and rain of the map grid.
     */
    weatherCell(nx, ny) {
      if (!this.field) return null;
      if (!this.grid) this._buildGrid();
      const g = this.grid;
      if (!g.hasAnchors) return null;
      // the region weights of the map's weather grid (as the map itself draws), nearest cell
      const c = clamp(Math.floor(ny * g.gh), 0, g.gh - 1) * g.gw + clamp(Math.floor(nx * g.gw), 0, g.gw - 1);
      const cov = g.cov[c];
      if (cov <= 0.001) return null;
      const idx = this._wcIdx || (this._wcIdx = new Int16Array(TOP_K)), wt = this._wcWt || (this._wcWt = new Float32Array(TOP_K));
      for (let k = 0; k < TOP_K; k++) { idx[k] = g.idx[c * TOP_K + k]; wt[k] = g.wt[c * TOP_K + k]; }
      const v = this._blend(idx, wt), fv = this._frameVals();
      const oroA = this._oroFor(fv.dayA), oroB = fv.dayB ? this._oroFor(fv.dayB) : null, ow = fv.w;
      if (oroA) {
        const mix = (q) => oroB ? oroA[c * 3 + q] * (1 - ow) + oroB[c * 3 + q] * ow : oroA[c * 3 + q];
        v.cloud = clamp(v.cloud + mix(2), 0, 100);
        const base = v.rain;
        v.rain = Math.min(base * mix(0) + (v.cloud > 60 ? mix(1) * (v.cloud - 60) / 40 : 0), Math.max(base, 6));
      }
      const aspect = this.imgH / this.imgW;
      const density = this._cloudDensity(nx * 6, ny * aspect * 6, v.cloud, this._flowAt(idx, wt));
      v.rain *= rainUnderCloud(density);
      v.density = density * cov; v.coverage = cov;
      // the same temperature brought down to sea level: each region's is for its base_heat_height
      let bh = 0;
      for (let k = 0; k < TOP_K; k++) if (idx[k] >= 0) bh += wt[k] * ((this.field.regions[idx[k]] || {}).baseHeight || 0);
      v.seaTemp = v.temperature + 6.5 * bh / 1000;
      return v;
    }
    /**
     * The climate at a map spot: the 12 monthly mean temperatures of its regions, blended with the
     * same weights as the weather (for the 3D view's snow and ice). byName: region name → 12 values.
     * Null where no region reaches.
     */
    climateCell(nx, ny, byName) {
      if (!this.field || !byName) return null;
      if (!this.grid) this._buildGrid();
      const g = this.grid;
      if (!g.hasAnchors) return null;
      const c = clamp(Math.floor(ny * g.gh), 0, g.gh - 1) * g.gw + clamp(Math.floor(nx * g.gw), 0, g.gw - 1);
      if (g.cov[c] <= 0.001) return null;
      const out = new Float32Array(12), regs = this.field.regions;
      let sum = 0;
      for (let k = 0; k < TOP_K; k++) {
        const i = g.idx[c * TOP_K + k], w = g.wt[c * TOP_K + k];
        if (i < 0 || !(w > 0)) continue;
        const t = regs[i] && byName[regs[i].name];
        if (!t) continue;
        for (let m = 0; m < 12; m++) out[m] += w * t[m];
        sum += w;
      }
      if (sum <= 0) return null;
      for (let m = 0; m < 12; m++) out[m] /= sum;
      return out;
    }
    /** Direction to the sun at a map spot now: east, north and up parts of a unit vector, and its height (°). */
    sunVector(nx, ny) {
      const sun = this._sunState(), R = Math.PI / 180;
      const lat = clamp((0.5 - ny) * this._degPerY(), -90, 90) * R;
      const H = (nx / this._leyW() * 360 - sun.subLon) * R, d = sun.decl * R;
      const up = Math.sin(lat) * Math.sin(d) + Math.cos(lat) * Math.cos(d) * Math.cos(H);
      const east = -Math.cos(d) * Math.sin(H);
      const north = Math.cos(lat) * Math.sin(d) - Math.sin(lat) * Math.cos(d) * Math.cos(H);
      return { east, north, up, alt: Math.asin(clamp(up, -1, 1)) / R };
    }
    /** Pauses drawing (while the 3D view covers the map); unpausing redraws. */
    setPaused(on) {
      this.paused = !!on;
      if (on) { if (this._fxRaf) { cancelAnimationFrame(this._fxRaf); this._fxRaf = 0; } }
      else this.draw();
    }
    /**
     * The clock: the map's hour is global time, the solar time on the meridian through the
     * prime-meridian point (Calnia on Mundana: map setting clockX, a fraction of the map's width).
     * Every region keeps its own local time: its weather is taken at its own hour, the hour of the
     * global clock plus (its longitude − the meridian's) / 15°.
     */
    setClockX(x) { this.clockX = Number.isFinite(x) ? x : null; this._offsets = null; this.fv = null; this.draw(); }
    _clockLon() { return ((this.clockX != null ? this.clockX : 0.6287) / this._leyW() * 360 % 360 + 360) % 360; }
    /** A longitude's offset from global time, in hours (−12…12). */
    _lonOffset(lon) { let d = lon - this._clockLon(); d = ((d + 180) % 360 + 360) % 360 - 180; return d / 15; }
    /** Each region's offset from global time (hours), from the middle of its points. */
    _regionOffsets() {
      if (this._offsets && this._offsetsN === this.anchors.length && this._offsetsF === this.field) return this._offsets;
      const n = this.field ? this.field.regions.length : 0, W = this._leyW(), out = new Float32Array(n);
      const sx = new Float64Array(n), sy = new Float64Array(n);
      for (const p of this.anchors) {
        const i = this.regionIndex.get(p.region);
        if (i == null || i >= n) continue;
        const t = p.x / W * 2 * Math.PI; sx[i] += Math.cos(t); sy[i] += Math.sin(t);
      }
      for (let i = 0; i < n; i++) out[i] = (sx[i] || sy[i]) ? this._lonOffset(((Math.atan2(sy[i], sx[i]) * 180 / Math.PI) + 360) % 360) : 0;
      this._offsets = out; this._offsetsN = this.anchors.length; this._offsetsF = this.field;
      return out;
    }
    /** Local time offset (hours) of a region by name, and of a map spot. */
    regionOffset(name) { const i = this.regionIndex.get(name); const o = this._regionOffsets(); return i != null && i < o.length ? o[i] : 0; }
    spotOffset(nx) { return this._lonOffset((nx / this._leyW() * 360 % 360 + 360) % 360); }
    _frameVals() {
      if (this.fv && this.fvT === this.T) return this.fv;
      const T = this.T, s = Math.floor(T), h = (T - s) * 24;
      const cur = this.fields.get(s) || this.field;
      const n = cur.regions.length, off = this._regionOffsets();
      const fv = { temp: new Float32Array(n), wind: new Float32Array(n), rain: new Float32Array(n),
        cloud: new Float32Array(n), fog: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n) };
      // one region's values on a day's field at an hour
      const add = (F, i, hh, k) => {
        if (k <= 0 || !F) return;
        const r = F.regions[i]; if (!r) return;
        hh = clamp(hh, 0, 23);
        const h0 = Math.floor(hh), h1 = Math.min(h0 + 1, 23), f = hh - h0, H = r.hourly;
        const ws = H.wind[h0] * (1 - f) + H.wind[h1] * f;
        fv.temp[i] += k * (H.temperature[h0] * (1 - f) + H.temperature[h1] * f);
        fv.wind[i] += k * ws;
        fv.rain[i] += k * (H.rain[h0] * (1 - f) + H.rain[h1] * f);
        fv.cloud[i] += k * (H.cloud[h0] * (1 - f) + H.cloud[h1] * f);
        if (H.fog) fv.fog[i] += k * (H.fog[h0] * (1 - f) + H.fog[h1] * f);
        const v = toVec(r.direction);
        fv.vx[i] += k * v[0] * Math.max(ws, 0.3); fv.vy[i] += k * v[1] * Math.max(ws, 0.3);
      };
      for (let i = 0; i < n; i++) {
        // the region's own clock (its day can be yesterday or tomorrow)
        const Ti = T + (off[i] || 0) / 24, si = Math.floor(Ti), hi = (Ti - si) * 24;
        const day = this.fields.get(si) || cur;
        // around midnight the two days are blended, so nothing jumps
        if (hi >= 22 && this.fields.get(si + 1)) { const w = smooth(0, 1, (hi - 22) / 4); add(day, i, hi, 1 - w); add(this.fields.get(si + 1), i, 0, w); }
        else if (hi < 2 && this.fields.get(si - 1)) { const w = smooth(0, 1, (hi + 2) / 4); add(this.fields.get(si - 1), i, 23, 1 - w); add(day, i, hi, w); }
        else add(day, i, hi, 1);
      }
      // the days used for the mountains' effect on cloud and rain (by global time, as before)
      let A = cur, B = null, w = 0;
      if (h >= 22 && this.fields.get(s + 1)) { B = this.fields.get(s + 1); w = smooth(0, 1, (h - 22) / 4); }
      else if (h < 2 && this.fields.get(s - 1)) { A = this.fields.get(s - 1); B = cur; w = smooth(0, 1, (h + 2) / 4); }
      fv.dayA = A; fv.dayB = B; fv.w = w;
      this.fv = fv; this.fvT = T;
      return fv;
    }
    _blend(idx, wt) {
      const fv = this._frameVals();
      let temp = 0, wind = 0, rain = 0, cloud = 0, fog = 0, vx = 0, vy = 0;
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        if (i < 0) continue;
        const w = wt[k];
        temp += w * fv.temp[i]; wind += w * fv.wind[i]; rain += w * fv.rain[i];
        cloud += w * fv.cloud[i]; fog += w * fv.fog[i]; vx += w * fv.vx[i]; vy += w * fv.vy[i];
      }
      return { temperature: temp, wind, rain, cloud, fog, vx, vy };
    }
    /** Cloud-pattern offset: a steady drift plus a lean towards the current wind (continuous in time). */
    /**
     * Cloud movement. Two copies of the cloud pattern each live one day, half a day apart:
     * copy A from midnight to midnight, copy B from noon to noon. Each fades in, travels with
     * the wind, and fades out again, so clouds drift with the local wind as they form and
     * dissolve, and nothing jumps when a copy restarts (it is invisible then).
     * How far a copy has travelled at a spot is its regions' wind added up hour by hour since
     * the copy started, blended with the same weights as the rest of the weather.
     */
    _flowState() {
      const T = this.T, cur = this.field;
      if (this._flow && this._flow.T === T && this._flow.field === cur) return this._flow;
      const n = cur.regions.length, H = 1 / 24;
      const integrate = (t0, t1) => {
        const ox = new Float32Array(n), oy = new Float32Array(n);
        for (let t = t0; t < t1 - 1e-9; t += H) {
          const day = Math.floor(t + 1e-9), F = this.fields.get(day) || cur;
          const hour = clamp(Math.floor((t - day) * 24 + 1e-6), 0, 23), dt = Math.min(H, t1 - t);
          for (let i = 0; i < n; i++) {
            const r = F.regions[i]; if (!r) continue;
            const v = toVec(r.direction), ws = Math.max(r.hourly.wind[hour], 0.3) * FLOW * dt;
            ox[i] += v[0] * ws; oy[i] += v[1] * ws;
          }
        }
        return [ox, oy];
      };
      const eA = Math.floor(T), eB = Math.floor(T + 0.5) - 0.5;
      const [ax, ay] = integrate(eA, T), [bx, by] = integrate(eB, T);
      const fA = T - eA, wa = 1 - Math.abs(1 - 2 * fA);
      this._flow = { T, field: cur, ax, ay, bx, by, wa, wb: 1 - wa, zA: (eA % 997) * 1.913 + 0.31, zB: (eB % 997) * 1.913 + 0.77 };
      return this._flow;
    }
    /** How far the two copies have travelled at a spot: blend of its regions' travel (pattern units). */
    _flowAt(idx, wt) {
      const fl = this._flowState();
      let ax = 0, ay = 0, bx = 0, by = 0;
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k]; if (i < 0) continue; const w = wt[k];
        ax += w * fl.ax[i]; ay += w * fl.ay[i]; bx += w * fl.bx[i]; by += w * fl.by[i];
      }
      return { ax, ay, bx, by, wa: fl.wa, wb: fl.wb, zA: fl.zA, zB: fl.zB };
    }
    /** The two travelling copies of a noise pattern, faded together without losing contrast. */
    _flowNoise(x, y, o, f) {
      const a = o.wa > 0 ? f(x - o.ax, y - o.ay, o.zA) : 0.5;
      const b = o.wb > 0 ? f(x - o.bx, y - o.by, o.zB) : 0.5;
      return 0.5 + (o.wa * (a - 0.5) + o.wb * (b - 0.5)) / Math.sqrt(o.wa * o.wa + o.wb * o.wb);
    }
    /** How cloudy a spot is drawn (0..1); x, y in cloud-pattern units, cloud in percent, o from _flowAt. */
    _cloudDensity(x, y, cloud, o) {
      const n = this._wrapNoise(x / 6, (xx) => this._flowNoise(xx, y, o, (X, Y, z) => fbm(X, Y, z, 4)));
      const thr = fbmQuantile(1 - cloudArea(clamp(cloud / 100, 0, 1)));
      return smooth(thr - 0.25 * FBM_SPREAD, thr + 0.3 * FBM_SPREAD, n);
    }
    /** Slowly running clock for noise that changes over time (the cloud pattern itself moves via _flowNoise). */
    _drift() { return [0, 0, this.T % 997]; }
    /** Orographic factors per grid cell for one day's wind (cached per day). */
    _oroFor(F) {
      if (!this.height || !F || !this.grid || !this.grid.hasAnchors) return null;
      const hit = this.oroCache.get(F.serial);
      if (hit) return hit;
      const g = this.grid, n = g.gw * g.gh, oro = new Float32Array(n * 3), regions = F.regions;
      for (let c = 0; c < n; c++) {
        if (g.cov[c] <= 0.001) continue;
        let vx = 0, vy = 0, ws = 0;
        for (let k = 0; k < TOP_K; k++) {
          const ri = g.idx[c * TOP_K + k]; if (ri < 0) continue;
          const r = regions[ri], wgt = g.wt[c * TOP_K + k], u = toVec(r.direction);
          vx += wgt * u[0] * Math.max(r.wind, 0.3); vy += wgt * u[1] * Math.max(r.wind, 0.3); ws += wgt * r.wind;
        }
        const m = Math.hypot(vx, vy);
        if (m < 1e-6) { oro[c * 3] = 1; continue; }
        const i = c % g.gw, j = Math.floor(c / g.gw);
        const o = this.orographic((i + 0.5) / g.gw, (j + 0.5) / g.gh, vx / m, vy / m, ws);
        oro[c * 3] = o.rainMul; oro[c * 3 + 1] = o.rainAdd; oro[c * 3 + 2] = o.cloudAdd;
      }
      this.oroCache.set(F.serial, oro);
      return oro;
    }

    // ── Storms ──────────────────────────────────────────────────────────
    /** All storms in the loaded days, once each. */
    _stormList() {
      const s = Math.floor(this.T), seen = new Map();
      for (const d of [s - 1, s, s + 1, s + 2]) {
        const F = this.fields.get(d);
        if (F) for (const st of F.storms) if (!seen.has(st.id)) seen.set(st.id, st);
      }
      return [...seen.values()];
    }
    /** 0..1 strength of one pulse at time T, following its growth curve. */
    static envelope(p, T) {
      if (T < p.start || T >= p.end) return 0;
      const f = (T - p.start) / (p.end - p.start), pk = 0.05 + 0.9 * (1 - p.growth / 100);
      return f < pk ? smooth(0, 1, f / pk) : smooth(0, 1, (1 - f) / (1 - pk));
    }
    _hash01(seed, k) { return hash3(seed | 0, k | 0, 977); }
    /** Where the storm formed: one of its region's points (picked by its seed) plus a small offset. */
    _stormOrigin(s) {
      const pts = this.anchors.filter((a) => a.region === s.region);
      if (!pts.length) return null;
      const a = pts[s.seed % pts.length];
      const ang = this._hash01(s.seed, 1) * Math.PI * 2, d = this._hash01(s.seed, 2) * 0.02;
      return [clamp(a.x + Math.cos(ang) * d, 0, 1), clamp(a.y + Math.sin(ang) * d * this.imgW / this.imgH, 0, 1)];
    }
    /** Name of the region that dominates a map point (or null outside the weather area). */
    _regionAt(nx, ny) {
      if (!this.grid) this._buildGrid();
      const g = this.grid;
      if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
      const c = clamp(Math.floor(ny * g.gh), 0, g.gh - 1) * g.gw + clamp(Math.floor(nx * g.gw), 0, g.gw - 1);
      const i = g.idx[c * TOP_K];
      if (i < 0 || g.cov[c] < 0.05) return null;
      return this.field.regions[i].name;
    }
    /**
     * Position at time T: stays put, wanders randomly (wander_speed px/hour), or rides its region's wind
     * hour by hour. Storms with stay_in_region never leave their home region: a wandering storm turns
     * back at the border, a wind-driven one stalls there until the wind turns.
     */
    _stormPos(s, T) {
      const o = this._stormOrigin(s);
      if (!o) return null;
      let [x, y] = o;
      const aspect = this.imgH / this.imgW;
      if (s.motion === "wander") {
        const hours = Math.max(0, (T - s.start) * 24);
        let th = this._hash01(s.seed, 3) * Math.PI * 2;
        const px = this._stormPxPerHour(s, s.speedKmh);
        const sx = px / this.imgW, sy = px / this.imgH;
        for (let k = 0; k < hours; k++) {
          const dt = Math.min(1, hours - k);
          th += (this._hash01(s.seed, 10 + k) - 0.5) * 1.4;
          const nx2 = x + Math.cos(th) * sx * dt, ny2 = y + Math.sin(th) * sy * dt;
          if (s.stayInRegion && this._regionAt(this._wrapX(nx2), ny2) !== s.region) { th += Math.PI * (0.6 + 0.8 * this._hash01(s.seed, 500 + k)); continue; }
          x = nx2; y = ny2;
          if (this.wrapP) x = this._wrapX(x);
          else if (x < 0 || x > 1) { th = Math.PI - th; x = clamp(x, 0, 1); }
          if (y < 0 || y > 1) { th = -th; y = clamp(y, 0, 1); }
        }
      } else if (s.motion === "wind" && s.track) {
        const H = T * 24, hs = s.start * 24, tr = s.track;
        for (let k = 0; k < tr.dirs.length; k++) {
          const h0 = tr.startHour + k;
          if (h0 >= H) break;
          const a0 = Math.max(hs, h0), a1 = Math.min(H, h0 + 1);
          if (a1 <= a0) continue;
          // The storm's own speed, a little faster in strong wind and slower in calm
          // (wind 0 -> x0.6, wind 10 -> x1.4), kept within its speed_min-speed_max range.
          const kmh = clamp(s.speedKmh * clamp(0.6 + 0.08 * tr.winds[k], 0.6, 1.4), s.speedMin, s.speedMax);
          const v = toVec(tr.dirs[k]), px = this._stormPxPerHour(s, kmh) * (a1 - a0);
          const nx2 = x + v[0] * px / this.imgW, ny2 = y + v[1] * px / this.imgH;
          if (s.stayInRegion && this._regionAt(this._wrapX(nx2), ny2) !== s.region) continue; // held at the border
          x = this._wrapX(nx2); y = ny2;
        }
      }
      return [x, y];
    }
    /** Storm speed (km/h) in map pixels per hour; maps without a scale count 2 km per pixel. */
    _stormPxPerHour(s, kmh) { return (kmh || 10) / (this.kmPerPx || 2); }
    _stormPositions() {
      if (!this.field) return [];
      const T = this.T, out = [];
      for (const s of this._stormList()) {
        if (T < s.start || T >= s.end) continue;
        let now = 0, later = 0;
        for (const p of s.pulses) {
          now = Math.max(now, p.peak * FieldMap.envelope(p, T));
          later = Math.max(later, p.peak * FieldMap.envelope(p, T + 0.02));
        }
        if (now <= 0.05) continue;
        const pos = this._stormPos(s, T);
        if (!pos) continue;
        const rel = now / (s.peak || 1);
        const r = (0.015 + 0.00125 * Math.min(s.peak, 40)) * (0.3 + 0.7 * rel);   // at most 0.065 of the map across
        const st = { ...s, x: pos[0], y: pos[1], r, life: rel, strengthNow: now, growing: later > now,
          colour: FORCE_COLOURS[s.force] || MAGIC_DEFAULT };
        out.push(st);
        const P = this.wrapP;
        if (P && P < 1 && st.x < 1 - P + r) out.push({ ...st, x: st.x + P });  // copy in the repeated strip
        if (P && st.x > P - r) out.push({ ...st, x: st.x - P });              // and across the seam
      }
      return out;
    }

    // ── Drawing ─────────────────────────────────────────────────────────
    draw() {
      if (this._raf || this.paused) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); });
    }
    _draw() {
      const ctx = this.ctx, dpr = this.dpr || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.cssW, this.cssH);
      if (!this.img) return;
      const { s, ox, oy } = this.view;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(this.img, ox, oy, this.imgW * s, this.imgH * s);
      for (const p of this._mapPatches()) if (p.ok) ctx.drawImage(p.img, ox + p.map.x * s, oy + p.map.y * s, p.map.w * s, p.map.h * s);
      if (this.tiles) this._drawTiles();

      if (this.field) {
        if (!this.grid) this._buildGrid();
        ctx.save();
        ctx.globalAlpha = this.opacity;
        if (this.grid.hasAnchors) {
          const raster = ["temp", "rain", "cloud"].some((l) => this.layers.has(l));
          if (raster) {
            this._paintRaster();
            ctx.drawImage(this.off, ox, oy, this.imgW * s, this.imgH * s);
            if (this.layers.has("cloud") && this.fx.cloud) this._drawCartoonClouds();
          }
          if (this.layers.has("wind")) this._drawWind();
          if (this.layers.has("magic")) {
            ctx.save();
            ctx.beginPath(); ctx.rect(ox, oy, this.imgW * s, this.imgH * s); ctx.clip();   // storm copies at the wrap seam stay on the map
            this._drawStorms();
            ctx.restore();
          }
        }
        ctx.restore();
      }
      // the height map in colours, for everyone (while painting heights the painter shows its own)
      if (this.layers.has("height") && this.heightSource && this.heightColours && !(this.editing && this.editMode === "height" && (this.hpTarget || "height") === "height")) {
        const cv = this.heightColours();
        if (cv) {
          ctx.save();
          ctx.globalAlpha = 0.75;
          ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";   // smooth, not blocky, when zoomed in
          ctx.drawImage(cv, ox, oy, this.imgW * s, this.imgH * s);
          ctx.restore();
        }
      }
      // forests: green, darker the denser (while painting forest the painter shows its own)
      if (this.layers.has("forest") && this.forestSource && this.forestColours && !(this.editing && this.editMode === "height" && this.hpTarget === "forest")) {
        const cv = this.forestColours();
        if (cv) {
          ctx.save();
          ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
          ctx.drawImage(cv, ox, oy, this.imgW * s, this.imgH * s);
          ctx.restore();
        }
      }
      // ice: white with a blue tint (while painting ice the painter shows its own)
      if (this.layers.has("ice") && this.iceSource && this.iceColours && !(this.editing && this.editMode === "height" && this.hpTarget === "ice")) {
        const cv = this.iceColours();
        if (cv) {
          ctx.save();
          ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
          ctx.drawImage(cv, ox, oy, this.imgW * s, this.imgH * s);
          ctx.restore();
        }
      }
      if (this.layers.has("night")) this._drawNight();
      if (this.editing && this.showHeight && this.height) {
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.drawImage(this.height.canvas, ox, oy, this.imgW * s, this.imgH * s);
        ctx.restore();
      }
      const leyEdit = this.editing && this.editMode === "ley", zoneEdit = this.editing && this.editMode === "zone";
      const heightEdit = this.editing && this.editMode === "height";
      if (heightEdit && this._hpDraw) this._hpDraw();
      if (this._sgDraw) this._sgDraw();                   // height map suggestions (outlines, the chosen one)
      const nationEdit = this.editing && this.editMode === "nation";
      if ((this.layers.has("nation") || nationEdit) && this._ntDraw) this._ntDraw();
      const riverEdit = this.editing && this.editMode === "river";
      const rangeEdit = this.editing && this.editMode === "range";
      if ((this.layers.has("range") || rangeEdit) && this._rgDraw) this._rgDraw();
      if ((this.layers.has("river") || riverEdit) && this._rvDraw) this._rvDraw();
      const roadEdit = this.editing && this.editMode === "road";
      if ((this.layers.has("road") || roadEdit) && this._wyDraw) this._wyDraw();
      if (this._lsDraw) this._lsDraw();                   // the other layers' suggestions (the chosen one)
      if (this._trDraw) this._trDraw();                   // journeys (the travel calculator): routes and tokens
      const regionEdit = this.editing && !leyEdit && !zoneEdit && !heightEdit && !riverEdit && !nationEdit && !rangeEdit && !roadEdit;   // only when placing regions
      if (regionEdit && this.grid && this.grid.hasAnchors) this._drawTerritories();
      if (this.layers.has("zone") || zoneEdit) this._drawZones(zoneEdit);
      if (this.layers.has("ley") || leyEdit) this._drawLeylines(leyEdit);
      if (regionEdit) this._drawAnchors();
      if (this.kmPerPx) this._drawScaleBar();
      this._startFx();
      if (this.highlight) {
        const [hx, hy] = this.toScreen(this.highlight.x, this.highlight.y);
        ctx.strokeStyle = "#e7e1d1"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(hx - 11, hy); ctx.lineTo(hx - 7, hy); ctx.moveTo(hx + 7, hy); ctx.lineTo(hx + 11, hy);
        ctx.moveTo(hx, hy - 11); ctx.lineTo(hx, hy - 7); ctx.moveTo(hx, hy + 7); ctx.lineTo(hx, hy + 11); ctx.stroke();
      }
    }

    _paintRaster() {
      const g = this.grid, data = g.image.data;
      const fv = this._frameVals();
      const oroA = this._oroFor(fv.dayA), oroB = fv.dayB ? this._oroFor(fv.dayB) : null, ow = fv.w;
      let rainy = 0;
      const showT = this.layers.has("temp"), showR = this.layers.has("rain"), showC = this.layers.has("cloud");
      const toon = showC && this.fx.cloud;
      const [dx, dy, days] = this._drift();
      const aspect = this.imgH / this.imgW;
      const idx = new Int16Array(TOP_K), wt = new Float32Array(TOP_K);
      for (let j = 0; j < g.gh; j++) for (let i = 0; i < g.gw; i++) {
        const c = j * g.gw + i, p = c * 4, cov = g.cov[c];
        if (cov <= 0.001) { data[p + 3] = 0; g.rainV[c] = 0; g.densV[c] = 0; continue; }
        for (let k = 0; k < TOP_K; k++) { idx[k] = g.idx[c * TOP_K + k]; wt[k] = g.wt[c * TOP_K + k]; }
        const v = this._blend(idx, wt);
        if (oroA) {
          const mix = (q) => oroB ? oroA[c * 3 + q] * (1 - ow) + oroB[c * 3 + q] * ow : oroA[c * 3 + q];
          v.cloud = clamp(v.cloud + mix(2), 0, 100);
          const base = v.rain;
          v.rain = Math.min(base * mix(0) + (v.cloud > 60 ? mix(1) * (v.cloud - 60) / 40 : 0), Math.max(base, 6));
        }
        const x = (i + 0.5) / g.gw * 6, y = (j + 0.5) / g.gh * aspect * 6;
        const fo = (showC || showR) ? this._flowAt(idx, wt) : null;
        const density = fo ? this._cloudDensity(x, y, v.cloud, fo) : 0;
        // Rain only falls from clouds: where the cloud pattern is clear, there is no rain.
        v.rain *= rainUnderCloud(density);
        g.rainV[c] = v.rain; g.tempV[c] = v.temperature; g.vxV[c] = v.vx; g.vyV[c] = v.vy;
        if (v.rain > 0.3) rainy++;
        let r = 0, gr = 0, b = 0, a = 0;
        const over = (cr, cg, cb, ca) => { // "source over" onto the running colour
          const na = ca + a * (1 - ca);
          if (na <= 0) return;
          r = (cr * ca + r * a * (1 - ca)) / na; gr = (cg * ca + gr * a * (1 - ca)) / na; b = (cb * ca + b * a * (1 - ca)) / na; a = na;
        };
        if (showT) { const col = ramp(TEMP_STOPS, v.temperature); over(col[0], col[1], col[2], 0.5); }
        if (showR && v.rain > 0.15) {
          const m = this._wrapNoise(x / 6, (xx) => this._flowNoise(xx, y, fo, (X, Y, z) => fbm(X * 2.3 + 40, Y * 2.3, z * 1.7, 3)));
          const inten = clamp(v.rain / 6, 0, 1) * (0.35 + 0.65 * smooth(0.35, 0.7, m)) * (0.5 + 0.5 * density);
          const col = ramp(RAIN_STOPS, v.rain * (0.6 + 0.6 * m));
          over(col[0], col[1], col[2], clamp(0.15 + inten * 0.75, 0, 0.85));
        }
        g.densV[c] = density;
        if (showC && density > 0.01) {
          const dark = clamp(v.rain / 5, 0, 1);
          // with cartoon clouds on, only a light haze here: the puffs carry the look
          const ca = density * (toon ? 0.22 + 0.15 * dark : 0.42 + 0.2 * dark);
          over(238 - 80 * dark, 242 - 75 * dark, 246 - 65 * dark, ca);
        }
        if (showC && v.fog > 0.02) {
          // mist: a low grey haze in slow, stretched banks (greyer than cloud so it shows over pale sea and ice)
          const m = fbm(x * 0.8 - dx * 0.3 + 70, y * 3.2 - dy * 0.3, days * 0.15, 3);
          over(146, 156, 168, clamp(v.fog, 0, 1) * (0.36 + 0.4 * smooth(0.3, 0.75, m)));
        }
        data[p] = r; data[p + 1] = gr; data[p + 2] = b; data[p + 3] = a * cov * 255;
      }
      this.offCtx.putImageData(g.image, 0, 0);
      g.rainyCells = rainy;
      g.drift = [dx, dy];
    }

    _drawWind() {
      const ctx = this.ctx, g = this.grid, step = this.height ? 40 : 54;
      const [x0, y0] = this.toScreen(0, 0), [x1, y1] = this.toScreen(1, 1);
      const idx = new Int16Array(TOP_K), wt = new Float32Array(TOP_K);
      ctx.lineCap = "round";
      for (let sy = Math.max(y0, 0) + step / 2; sy < Math.min(y1, this.cssH); sy += step) {
        for (let sx = Math.max(x0, 0) + step / 2; sx < Math.min(x1, this.cssW); sx += step) {
          const [nx, ny] = this.toMap(sx, sy);
          const gi = clamp(Math.floor(nx * g.gw), 0, g.gw - 1), gj = clamp(Math.floor(ny * g.gh), 0, g.gh - 1);
          const c = gj * g.gw + gi, cov = g.cov[c];
          if (cov < 0.15) continue;
          for (let k = 0; k < TOP_K; k++) { idx[k] = g.idx[c * TOP_K + k]; wt[k] = g.wt[c * TOP_K + k]; }
          const v = this._blend(idx, wt);
          const mag = Math.hypot(v.vx, v.vy);
          if (mag < 0.05) continue;
          let ux = v.vx / mag, uy = v.vy / mag, strength = v.wind, open = 1;
          if (this.height) {
            const tw = this.terrainWind(nx, ny, ux, uy);
            ux = tw.ux; uy = tw.uy; strength *= tw.factor; open = tw.factor;
            if (strength < 0.4) { // sheltered: a small dot instead of an arrow
              ctx.beginPath(); ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(255,252,240,${0.75 * cov})`; ctx.fill();
              ctx.strokeStyle = `rgba(14,19,25,${0.7 * cov})`; ctx.lineWidth = 1.2; ctx.stroke();
              continue;
            }
          }
          const len = 10 + Math.min(strength, 16) * 1.7;
          const col = strength < 4 ? "255,252,240" : strength < 8 ? "255,204,77" : "255,110,90";
          const a = cov * (0.45 + 0.55 * open);
          const lw = 2.6 + Math.min(strength, 14) * 0.2;
          const hx = sx + ux * len / 2, hy = sy + uy * len / 2, head = 8;
          ctx.beginPath();
          ctx.moveTo(sx - ux * len / 2, sy - uy * len / 2); ctx.lineTo(hx, hy);
          ctx.moveTo(hx - ux * head - uy * head * 0.65, hy - uy * head + ux * head * 0.65); ctx.lineTo(hx, hy);
          ctx.lineTo(hx - ux * head + uy * head * 0.65, hy - uy * head - ux * head * 0.65);
          ctx.lineJoin = "round";
          // dark outline first, then the coloured arrow on top: readable over clouds and pale land
          ctx.strokeStyle = `rgba(14,19,25,${0.8 * a})`;
          ctx.lineWidth = lw + 3;
          ctx.stroke();
          ctx.strokeStyle = `rgba(${col},${a})`;
          ctx.lineWidth = lw;
          ctx.stroke();
        }
      }
    }

    _drawStorms() {
      const ctx = this.ctx, spin = (this.T % 100) * Math.PI * 2 * 0.9;
      for (const s of this._stormPositions()) {
        const [cx, cy] = this.toScreen(s.x, s.y);
        const R = s.r * this.imgW * this.view.s;
        const alpha = 0.35 + 0.55 * s.life;
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        grad.addColorStop(0, this._rgba(s.colour, 0.55 * alpha));
        grad.addColorStop(0.45, this._rgba(s.colour, 0.22 * alpha));
        grad.addColorStop(1, this._rgba(s.colour, 0));
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
        const imgs = this.symbolsFor(s);
        if (imgs.length) {
          ctx.restore();
          this._drawSymbols(imgs, cx, cy, R, alpha, s.colour);
          continue;
        }
        // spiral arms
        ctx.strokeStyle = this._rgba(s.colour, 0.75 * alpha);
        ctx.lineWidth = Math.max(1.2, R * 0.035);
        const arms = s.kind === "storm" ? 3 : 2;
        for (let a = 0; a < arms; a++) {
          ctx.beginPath();
          for (let k = 0; k <= 40; k++) {
            const f = k / 40, ang = spin + a * (Math.PI * 2 / arms) + f * 4.2, rr = R * (0.12 + 0.82 * f);
            const px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr;
            k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
          }
          ctx.stroke();
        }
        ctx.restore();
        ctx.fillStyle = this._rgba(s.colour, 0.95);
        ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // ── Cloud symbols ───────────────────────────────────────────────────
    /**
     * Cartoon clouds (cloud symbols on): puffy round shapes laid over the cloud cover, with one
     * shared dark outline around each cluster. They sit on a jittered grid in the cloud pattern's
     * own coordinates, so they drift with the clouds. Rain clouds are greyer with a darker edge.
     */
    _drawCartoonClouds() {
      const g = this.grid;
      if (!g || !g.drift || !g.densV) return;
      const [dx, dy] = g.drift, aspect = this.imgH / this.imgW;
      const pxPerUnit = this.imgW * this.view.s / 6;          // screen px per cloud-pattern unit
      // Fixed spacing in map space (about 1 % of the map's width), so every puff keeps its
      // place and size on the map: zooming only enlarges the same clouds, it never reshapes them.
      const sp = 0.06;
      const [vx0, vy0] = this.toMap(0, 0), [vx1, vy1] = this.toMap(this.cssW, this.cssH);
      const L0 = Math.floor((Math.max(0, vx0) * 6 - dx) / sp) - 1, L1 = Math.ceil((Math.min(1, vx1) * 6 - dx) / sp) + 1;
      const M0 = Math.floor((Math.max(0, vy0) * aspect * 6 - dy) / sp) - 1, M1 = Math.ceil((Math.min(1, vy1) * aspect * 6 - dy) / sp) + 1;
      const spPx = sp * pxPerUnit, puffs = [];
      for (let i = L0; i <= L1; i++) for (let j = M0; j <= M1; j++) {
        const jx = (hash3(i, j, 131) - 0.5) * 0.5 * sp, jy = (hash3(i, j, 157) - 0.5) * 0.5 * sp;
        const nx = (i * sp + jx + dx) / 6, ny = (j * sp + jy + dy) / (aspect * 6);
        if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;
        const c = clamp(Math.floor(ny * g.gh), 0, g.gh - 1) * g.gw + clamp(Math.floor(nx * g.gw), 0, g.gw - 1);
        const d = g.densV[c] * Math.min(1, g.cov[c] * 1.5);
        if (d < 0.42) continue;
        if (d < 0.5) continue;
        // small puffs at the edge (bumpy outline), big ones inside so the cloud has no holes
        const r = spPx * (0.45 + 0.5 * smooth(0.5, 0.75, d)) * (0.85 + 0.3 * hash3(i, j, 173));
        const [sx, sy] = this.toScreen(nx, ny);
        puffs.push([sx, sy, r, clamp(g.rainV[c] / 5, 0, 1)]);
      }
      if (!puffs.length) return;
      // Two layers, so overlapping puffs merge into one shape: the fill (blended in half
      // transparent, so the map shows through) and the outline ring around the merged shape.
      const dpr = this.dpr || 1, W = this.canvas.width, H = this.canvas.height;
      const layer = (k) => {
        const key = "toon" + k;
        if (!this[key]) this[key] = document.createElement("canvas");
        const cv = this[key];
        if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
        const c = cv.getContext("2d");
        c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = "source-over"; c.clearRect(0, 0, W, H);
        c.save();                                                    // restored below, so the clip doesn't pile up
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        const [x0, y0] = this.toScreen(0, 0), [x1, y1] = this.toScreen(1, 1);
        c.beginPath(); c.rect(x0, y0, x1 - x0, y1 - y0); c.clip();   // stay on the map
        return [cv, c];
      };
      const disc = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
      const lw = clamp(spPx * 0.08, 1.2, 3);
      const [fillCv, f] = layer("Fill");
      for (const [x, y, r, dk] of puffs) {
        f.fillStyle = `rgb(${Math.round(250 - 70 * dk)},${Math.round(251 - 66 * dk)},${Math.round(253 - 58 * dk)})`;
        disc(f, x, y, r);
      }
      const [lineCv, o] = layer("Line");
      for (const [x, y, r, dk] of puffs) {
        o.fillStyle = `rgb(${Math.round(70 - 30 * dk)},${Math.round(82 - 30 * dk)},${Math.round(98 - 30 * dk)})`;
        disc(o, x, y, r + lw);
      }
      o.globalCompositeOperation = "destination-out";            // cut out the inside: only the rim is left
      for (const [x, y, r] of puffs) disc(o, x, y, r);
      f.restore(); o.restore();
      const ctx = this.ctx, a = ctx.globalAlpha;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = a * 0.55; ctx.drawImage(fillCv, 0, 0);
      ctx.globalAlpha = a * 0.9; ctx.drawImage(lineCv, 0, 0);
      ctx.restore();
    }
    /** Small cloud icons spread over the cloud cover; they sit in the cloud pattern and drift with it. */
    _drawCloudIcons() {
      const g = this.grid, ctx = this.ctx;
      if (!g.drift) return;
      const [dx, dy] = g.drift, aspect = this.imgH / this.imgW;
      const pxPerUnit = this.imgW * this.view.s / 6;            // screen px per noise unit
      let sp = 0.7;
      while (sp * pxPerUnit < 64) sp *= 2;                      // keep icons ~64px+ apart when zoomed out
      const [vx0, vy0] = this.toMap(0, 0), [vx1, vy1] = this.toMap(this.cssW, this.cssH);
      const L0 = Math.floor((Math.max(0, vx0) * 6 - dx) / sp), L1 = Math.ceil((Math.min(1, vx1) * 6 - dx) / sp);
      const M0 = Math.floor((Math.max(0, vy0) * aspect * 6 - dy) / sp), M1 = Math.ceil((Math.min(1, vy1) * aspect * 6 - dy) / sp);
      for (let i = L0; i <= L1; i++) for (let j = M0; j <= M1; j++) {
        const jx = (hash3(i, j, 31) - 0.5) * 0.6 * sp, jy = (hash3(i, j, 57) - 0.5) * 0.6 * sp;
        const nx = (i * sp + jx + dx) / 6, ny = (j * sp + jy + dy) / (aspect * 6);
        if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;
        const c = clamp(Math.floor(ny * g.gh), 0, g.gh - 1) * g.gw + clamp(Math.floor(nx * g.gw), 0, g.gw - 1);
        const dens = g.densV[c] * g.cov[c];
        if (dens < 0.55) continue;
        const [sx, sy] = this.toScreen(nx, ny);
        const size = 13 + 9 * dens, dark = clamp(g.rainV[c] / 5, 0, 1);
        this._cloudIcon(sx, sy, size, 0.55 + 0.4 * dens, dark);
      }
    }
    _cloudIcon(x, y, w, alpha, dark) {
      const ctx = this.ctx, h = w * 0.62;
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.5, y + h * 0.35);
      ctx.arc(x - w * 0.25, y + h * 0.05, h * 0.32, Math.PI * 0.6, Math.PI * 1.55);
      ctx.arc(x + w * 0.02, y - h * 0.12, h * 0.42, Math.PI * 1.1, Math.PI * 1.95);
      ctx.arc(x + w * 0.3, y + h * 0.08, h * 0.3, Math.PI * 1.45, Math.PI * 0.4);
      ctx.closePath();
      const c = Math.round(250 - 85 * dark);
      ctx.fillStyle = `rgb(${c},${c + 2},${Math.min(255, c + 6)})`;
      ctx.strokeStyle = "rgba(14,19,25,0.55)";
      ctx.lineWidth = 1.4;
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // ── Rain / snow effect ──────────────────────────────────────────────
    _fxActive() {
      return !!(!this.paused && this.fxCtx && this.fx.rain && this.layers.has("rain") && this.img && this.grid
        && this.grid.hasAnchors && this.grid.rainyCells > 0);
    }
    _cellAt(sx, sy) {
      const g = this.grid, [nx, ny] = this.toMap(sx, sy);
      if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return -1;
      return clamp(Math.floor(ny * g.gh), 0, g.gh - 1) * g.gw + clamp(Math.floor(nx * g.gw), 0, g.gw - 1);
    }
    _spawn(p) {
      const g = this.grid;
      const [x0, y0] = this.toScreen(0, 0), [x1, y1] = this.toScreen(1, 1);
      const ax = Math.max(0, x0), ay = Math.max(0, y0), bx = Math.min(this.cssW, x1), by = Math.min(this.cssH, y1);
      for (let tries = 0; tries < 10; tries++) {
        const sx = ax + Math.random() * (bx - ax), sy = ay + Math.random() * (by - ay);
        const c = this._cellAt(sx, sy);
        if (c < 0) continue;
        const r = g.rainV[c] * g.cov[c];
        if (r < 0.3 || Math.random() > r / 4) continue;
        const snow = g.tempV[c] < 0.5;
        const wx = clamp(g.vxV[c], -14, 14), wy = clamp(g.vyV[c], -14, 14);
        p.x = sx; p.y = sy; p.snow = snow; p.r = r;
        if (snow) { if (Math.random() < 0.45) continue; p.vx = wx * 4; p.vy = 38 + Math.random() * 22 + wy * 2; p.life = 1.2 + Math.random() * 1.8; p.phase = Math.random() * 6.3; }
        else { p.vx = wx * 14; p.vy = 380 + Math.random() * 160 + wy * 6; p.life = 0.18 + Math.random() * 0.3; }
        p.age = 0;
        return true;
      }
      p.life = 0;
      return false;
    }
    _startFx() {
      if (!this.fxCtx) return;
      if (!this._fxActive()) {
        if (this._fxRaf) { cancelAnimationFrame(this._fxRaf); this._fxRaf = 0; }
        this.fxCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.fxCtx.clearRect(0, 0, this.fxCanvas.width, this.fxCanvas.height);
        return;
      }
      if (this.reducedMotion) { this._fxFrame(0, true); return; }   // one still frame, no animation
      if (this._fxRaf) return;
      let last = performance.now();
      const tick = (now) => {
        this._fxRaf = 0;
        if (!this._fxActive()) { this._startFx(); return; }
        this._fxFrame(Math.min(0.05, (now - last) / 1000));
        last = now;
        this._fxRaf = requestAnimationFrame(tick);
      };
      this._fxRaf = requestAnimationFrame(tick);
    }
    _fxFrame(dt, still) {
      const g = this.grid, ctx = this.fxCtx, dpr = this.dpr || 1;
      const area = (this.cssW * this.cssH) / (1000 * 700);
      const target = Math.min(900, Math.round(60 + 1100 * area * g.rainyCells / (g.gw * g.gh)));
      while (this.particles.length < target) this.particles.push({ life: 0, age: 0 });
      if (this.particles.length > target) this.particles.length = target;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.cssW, this.cssH);
      ctx.globalAlpha = this.opacity;
      ctx.lineCap = "round";
      for (const p of this.particles) {
        if (still || p.age >= p.life) { if (!this._spawn(p)) continue; if (still) p.age = Math.random() * p.life; }
        p.age += dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.snow) p.x += Math.sin(p.age * 3 + p.phase) * 12 * dt;
        const c = this._cellAt(p.x, p.y);
        if (c < 0 || g.rainV[c] * g.cov[c] < 0.15) { p.age = p.life; continue; }
        const fade = Math.min(1, p.age * 8, (p.life - p.age) * 8);
        if (p.snow) {
          ctx.fillStyle = `rgba(255,255,255,${0.7 * fade})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, 1.1 + p.r * 0.18, 0, Math.PI * 2); ctx.fill();
        } else {
          const len = 0.028;
          ctx.strokeStyle = `rgba(205,228,255,${(0.45 + 0.08 * p.r) * fade})`;
          ctx.lineWidth = 1.1 + p.r * 0.12;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * len, p.y - p.vy * len); ctx.stroke();
        }
      }
    }

    /** One or more aspect symbols at a storm's centre, gently pulsing. */
    _drawSymbols(imgs, cx, cy, R, alpha, colour) {
      const ctx = this.ctx, n = imgs.length;
      const pulse = 1 + 0.04 * Math.sin(this.T * Math.PI * 12);
      const size = Math.max(18, R * (n === 1 ? 0.95 : n === 2 ? 0.7 : 0.58)) * pulse;
      const ring = n === 1 ? 0 : size * (n === 2 ? 0.55 : 0.68);
      ctx.save();
      ctx.globalAlpha *= Math.min(1, 0.45 + 0.6 * alpha);
      ctx.shadowColor = colour;
      ctx.shadowBlur = Math.min(24, size * 0.35);
      imgs.forEach((img, i) => {
        const ang = -Math.PI / 2 + i * 2 * Math.PI / n;
        const x = cx + Math.cos(ang) * ring, y = cy + Math.sin(ang) * ring;
        const w = img.naturalWidth || img.width || 1, h = img.naturalHeight || img.height || 1;
        const k = size / Math.max(w, h);
        ctx.drawImage(img, x - w * k / 2, y - h * k / 2, w * k, h * k);
      });
      ctx.restore();
    }

    /** Scale bar in the lower left corner: a round distance about 100–200 px long on screen. */
    _drawScaleBar() {
      const ctx = this.ctx, kmPerScreenPx = this.kmPerPx / this.view.s;
      const target = 140 * kmPerScreenPx;
      const p = Math.pow(10, Math.floor(Math.log10(target)));
      const km = [5, 2, 1].map((m) => m * p).find((v) => v <= target) || p;
      const len = km / kmPerScreenPx, x = 16, y = this.cssH - 22;
      const label = km >= 1 ? `${km.toLocaleString("sv-SE")} km` : `${Math.round(km * 1000)} m`;
      ctx.save();
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.lineCap = "butt";
      const bar = () => { ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x, y); ctx.lineTo(x + len, y); ctx.lineTo(x + len, y - 6); ctx.moveTo(x + len / 2, y - 3); ctx.lineTo(x + len / 2, y); ctx.stroke(); };
      ctx.strokeStyle = "rgba(14,19,25,0.85)"; ctx.lineWidth = 5; bar();      // dark outline for contrast
      ctx.strokeStyle = "#f3efe4"; ctx.lineWidth = 2; bar();
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(14,19,25,0.85)"; ctx.fillStyle = "#f3efe4";
      ctx.strokeText(label, x + len + 8, y + 1); ctx.fillText(label, x + len + 8, y + 1);
      ctx.restore();
    }
    // ── Day and night ───────────────────────────────────────────────────
    // The hour on the clock is local time where the selected region sits on the map; the sun's
    // position follows from that, the season (a 336-day year, northern summer around month 6)
    // and an Earth-like 23.4° axial tilt.
    _sunState() {
      const T = this.T || 0, day = Math.floor(T), hour = (T - day) * 24;
      const doy = (((day - 1) % 336) + 336) % 336 + hour / 24;
      const decl = 23.44 * Math.cos(2 * Math.PI * (doy - 158) / 336);
      // the clock is global time: solar time on the prime meridian (Calnia)
      const refLon = this._clockLon();
      return { decl, refLon, hour, subLon: refLon + (12 - hour) * 15 };
    }
    /** Sun height above the horizon (degrees) at a map spot. */
    _sunAlt(nx, ny, sun) {
      const lat = Math.max(-90, Math.min(90, (0.5 - ny) * this._degPerY())) * Math.PI / 180;
      const H = (nx / this._leyW() * 360 - sun.subLon) * Math.PI / 180, d = sun.decl * Math.PI / 180;
      return Math.asin(Math.sin(lat) * Math.sin(d) + Math.cos(lat) * Math.cos(d) * Math.cos(H)) * 180 / Math.PI;
    }
    /**
     * Sunrise and sunset at a spot, as times on the map's clock (the selected region's local time):
     * {alt, rise, set} in hours, or {alt, polar: "day" | "night"}.
     */
    sunAt(nx, ny) {
      const sun = this._sunState(), alt = this._sunAlt(nx, ny, sun);
      const lat = Math.max(-89.9, Math.min(89.9, (0.5 - ny) * this._degPerY())) * Math.PI / 180, d = sun.decl * Math.PI / 180;
      const c = (Math.sin(-0.83 * Math.PI / 180) - Math.sin(lat) * Math.sin(d)) / (Math.cos(lat) * Math.cos(d));
      if (c <= -1) return { alt, polar: "day" };
      if (c >= 1) return { alt, polar: "night" };
      const h0 = Math.acos(c) * 180 / Math.PI / 15;                    // half the day, in hours
      const shift = (nx / this._leyW() * 360 - sun.refLon) / 15;       // how far ahead this spot's clock is
      const wrap = (h) => ((h % 24) + 24) % 24;
      return { alt, rise: wrap(12 - h0 - shift), set: wrap(12 + h0 - shift) };
    }
    _drawNight() {
      const sun = this._sunState();
      const key = [Math.round(this.T * 480), sun.refLon.toFixed(2), this.wrapP, this.imgW, this.imgH].join("|");
      if (!this.night || this.night.key !== key) {
        const gw = 320, gh = Math.max(8, Math.round(gw * this.imgH / this.imgW));
        const cv = this.night && this.night.canvas || document.createElement("canvas");
        cv.width = gw; cv.height = gh;
        const cx = cv.getContext("2d"), img = cx.createImageData(gw, gh), px = img.data;
        for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
          const alt = this._sunAlt((i + 0.5) / gw, (j + 0.5) / gh, sun);
          // full light with the sun more than 1.5° up, darkening through twilight to full night
          // when it is 6° below the horizon (where civil twilight ends on Earth)
          let t = Math.max(0, Math.min(1, (1.5 - alt) / 7.5));
          t = t * t * (3 - 2 * t);
          const p = (j * gw + i) * 4;
          px[p] = 6; px[p + 1] = 10; px[p + 2] = 32; px[p + 3] = Math.round(t * 150);
        }
        cx.putImageData(img, 0, 0);
        this.night = { key, canvas: cv };
      }
      const { s, ox, oy } = this.view, ctx = this.ctx;
      ctx.save();
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(this.night.canvas, ox, oy, this.imgW * s, this.imgH * s);
      ctx.restore();
    }

    // ── High-magic areas (högmagiska områden) ───────────────────────────
    _drawZones(editing) {
      const ctx = this.ctx, { s, ox, oy } = this.view, W = this._leyW();
      const kMax = Math.ceil(1 / W) + 1;
      ctx.save();
      ctx.beginPath(); ctx.rect(ox, oy, this.imgW * s, this.imgH * s); ctx.clip();
      // symbols sit on a fixed lattice in map space, thinned out when zoomed out, so they don't swim
      const pxPerX = this.imgW * s;
      let sp = 0.0005;
      while (sp * pxPerX < 18) sp *= 2;
      const spY = sp * this.imgW / this.imgH;
      const icon = Math.max(9, Math.min(18, sp * pxPerX * 0.6));
      this.zones.forEach((z, zi) => {
        if (!this._leyShown(z) || !z.points.length) return;
        const col = FieldMap.leyColour(z.aspect), rainbow = col === "rainbow", base = rainbow ? "#e98bd8" : col;
        const sel = editing && zi === this.selectedZone;
        const xs = z.points.map((p) => p.x), ys = z.points.map((p) => p.y);
        const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
        for (let k = -kMax; k <= kMax; k++) {
          const off = k * W;
          if (bx1 + off < -0.01 || bx0 + off > 1.01) continue;
          const path = new Path2D();
          z.points.forEach((p, i) => {
            const [px, py] = this.toScreen(p.x + off, p.y);
            i ? path.lineTo(px, py) : path.moveTo(px, py);
          });
          if (z.points.length >= 3) {
            path.closePath();
            ctx.fillStyle = z.aspect === "Skototropi" ? "rgba(10,10,16,0.28)" : this._rgba(base, sel ? 0.2 : 0.13);
            ctx.fill(path);
            // the symbols: every lattice spot whose centre is inside the area
            ctx.save();
            const img = this.symbols[z.aspect];
            const i0 = Math.floor(bx0 / sp) - 1, i1 = Math.ceil(bx1 / sp) + 1;
            const j0 = Math.floor(by0 / spY) - 1, j1 = Math.ceil(by1 / spY) + 1;
            for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
              const nx = (i + 0.5 + (hash3(i, j, 71) - 0.5) * 0.5 + (j % 2) * 0.5) * sp;
              const ny = (j + 0.5 + (hash3(i, j, 113) - 0.5) * 0.5) * spY;
              if (!this._inPoly(nx, ny, z.points)) continue;
              const [cx, cy] = this.toScreen(nx + off, ny);
              if (cx < -icon || cy < -icon || cx > this.cssW + icon || cy > this.cssH + icon) continue;
              this._zoneIcon(img, z.aspect, cx, cy, icon * (0.85 + 0.3 * hash3(i, j, 5)), i, j);
            }
            ctx.restore();
          }
          ctx.save();
          ctx.setLineDash(sel ? [] : [6, 4]);
          ctx.lineWidth = sel ? 2.2 : 1.5;
          ctx.strokeStyle = z.aspect === "Skototropi" ? "rgba(225,225,255,0.75)" : this._rgba(base, 0.85);
          ctx.stroke(path);
          ctx.restore();
        }
      });
      ctx.restore();
      if (!editing) return;
      ctx.save();
      this.zones.forEach((z, zi) => {
        if (!this._leyShown(z)) return;
        const col = FieldMap.leyColour(z.aspect), sel = zi === this.selectedZone;
        z.points.forEach((p) => {
          const [x, y] = this.toScreen(p.x, p.y), r = sel ? 6 : 4.5;
          ctx.fillStyle = col === "rainbow" ? "#e98bd8" : col;
          ctx.strokeStyle = z.aspect === "Skototropi" ? "#e7e1d1" : "#18212a"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
          ctx.fill(); ctx.stroke();
        });
      });
      ctx.restore();
    }
    _zoneIcon(img, aspect, x, y, size, i, j) {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha *= 0.85;
      if (img) {
        const w = img.naturalWidth || img.width || 1, h = img.naturalHeight || img.height || 1, k = size / Math.max(w, h);
        ctx.drawImage(img, x - w * k / 2, y - h * k / 2, w * k, h * k);
      } else {
        // no symbol uploaded for this aspect: a small four-pointed star in its colour
        const col = FieldMap.leyColour(aspect), r = size * 0.45;
        ctx.fillStyle = col === "rainbow" ? `hsl(${Math.floor(hash3(i, j, 9) * 360)},85%,62%)` : col;
        ctx.strokeStyle = aspect === "Skototropi" ? "rgba(231,225,209,0.8)" : "rgba(14,19,25,0.6)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let q = 0; q < 8; q++) {
          const a = q * Math.PI / 4 - Math.PI / 2, rr = q % 2 ? r * 0.35 : r;
          const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
          q ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    _hitZonePoint(sx, sy, radius) {
      let best = null, bd = radius;
      this.zones.forEach((z, zi) => this._leyShown(z) && z.points.forEach((p, pi) => {
        const [x, y] = this.toScreen(p.x, p.y), d = Math.hypot(x - sx, y - sy);
        if (d < bd || (d === bd && zi === this.selectedZone)) { bd = d; best = { zi, pi }; }
      }));
      return best;
    }
    /** Where a new point goes in an area: into the edge nearest the click. */
    _zoneInsertIndex(z, sx, sy) {
      if (z.points.length < 3) return z.points.length;
      let best = z.points.length, bd = Infinity;
      for (let i = 0; i < z.points.length; i++) {
        const a = this.toScreen(z.points[i].x, z.points[i].y), b = this.toScreen(z.points[(i + 1) % z.points.length].x, z.points[(i + 1) % z.points.length].y);
        const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((sx - a[0]) * dx + (sy - a[1]) * dy) / L));
        const d = Math.hypot(sx - a[0] - t * dx, sy - a[1] - t * dy);
        if (d < bd) { bd = d; best = i + 1; }
      }
      return best;
    }

    // ── Leylines: great circles on the globe ────────────────────────────
    // The map is equirectangular: one wrap width is 360° of longitude, and a pixel is as many
    // degrees tall as it is wide, with the equator across the middle of the image.
    _leyW() { return this.wrapP || 1; }
    _degPerY() { return 360 / this._leyW() * this.imgH / this.imgW; } // degrees of latitude per unit of ny
    _globeRadiusKm() { return this.kmPerPx ? this._leyW() * this.imgW * this.kmPerPx / (2 * Math.PI) : 0; }
    _leyVec(nx, ny) {
      const lon = nx / this._leyW() * 2 * Math.PI;
      const lat = Math.max(-90, Math.min(90, (0.5 - ny) * this._degPerY())) * Math.PI / 180;
      return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    }
    _leyPoint(v) {
      const lat = Math.asin(Math.max(-1, Math.min(1, v[2]))) * 180 / Math.PI;
      let lon = Math.atan2(v[1], v[0]) / (2 * Math.PI);
      lon = ((lon % 1) + 1) % 1;
      return [lon * this._leyW(), 0.5 - lat / this._degPerY()];
    }
    /** Unit normal of the line's great circle (falls back to an east–west heading when a ≈ b). */
    _leyNormal(l) {
      const A = this._leyVec(l.a.x, l.a.y), B = this._leyVec(l.b.x, l.b.y);
      let n = [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]];
      let len = Math.hypot(n[0], n[1], n[2]);
      if (len < 1e-6) { // same or opposite points: head east from a
        const lon = l.a.x / this._leyW() * 2 * Math.PI, E = [-Math.sin(lon), Math.cos(lon), 0];
        n = [A[1] * E[2] - A[2] * E[1], A[2] * E[0] - A[0] * E[2], A[0] * E[1] - A[1] * E[0]];
        len = Math.hypot(n[0], n[1], n[2]) || 1;
      }
      return n.map((c) => c / len);
    }
    /** Where the second point goes for a new line at a: 20° due east, so the line starts out heading east. */
    _leyPartner(nx, ny) {
      const A = this._leyVec(nx, ny), lon = nx / this._leyW() * 2 * Math.PI, d = 20 * Math.PI / 180;
      const E = [-Math.sin(lon), Math.cos(lon), 0];
      const [bx, by] = this._leyPoint(A.map((c, i) => Math.cos(d) * c + Math.sin(d) * E[i]));
      return { x: Math.min(1, bx), y: Math.max(0, Math.min(1, by)) };
    }
    /**
     * The great circle as runs of map points [[x, y], …]. x is unwrapped so each run is continuous;
     * runs break only where the line goes over a pole.
     */
    _leyPath(l) {
      const key = [this.wrapP, this.imgW, this.imgH, l.a.x, l.a.y, l.b.x, l.b.y].join(",");
      this._leyCache = this._leyCache || new Map();
      const hit = this._leyCache.get(key);
      if (hit) return hit;
      const A = this._leyVec(l.a.x, l.a.y), n = this._leyNormal(l);
      const U = [n[1] * A[2] - n[2] * A[1], n[2] * A[0] - n[0] * A[2], n[0] * A[1] - n[1] * A[0]];
      const W = this._leyW(), runs = [];
      let run = [], prevX = null;
      for (let i = 0; i <= LEY_SAMPLES; i++) {
        const t = i / LEY_SAMPLES * 2 * Math.PI, c = Math.cos(t), sn = Math.sin(t);
        const v = [c * A[0] + sn * U[0], c * A[1] + sn * U[1], c * A[2] + sn * U[2]];
        let [x, y] = this._leyPoint(v);
        if (Math.abs(v[2]) > 0.99995 && prevX !== null) x = prevX; // right on a pole the longitude means nothing
        else if (prevX !== null) {
          x += Math.round((prevX - x) / W) * W;         // nearest copy to the previous point
          if (Math.abs(x - prevX) > W / 8) { runs.push(run); run = []; } // jumped across a pole
        }
        run.push([x, y]); prevX = x;
      }
      runs.push(run);
      if (this._leyCache.size > 400) this._leyCache.clear();
      this._leyCache.set(key, runs);
      return runs;
    }
    _drawLeylines(editing) {
      if (!this.leylines.some((l) => this._leyShown(l))) return;
      const ctx = this.ctx, { s, ox, oy } = this.view, W = this._leyW();
      ctx.save();
      ctx.beginPath(); ctx.rect(ox, oy, this.imgW * s, this.imgH * s); ctx.clip();
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      const kMax = Math.ceil(1 / W) + 1;
      this.leylines.forEach((l, li) => {
        if (!this._leyShown(l)) return;
        const runs = this._leyPath(l), col = FieldMap.leyColour(l.aspect), sel = editing && li === this.selectedLey;
        const trace = (k, from, to) => {
          const off = k * W;
          for (const run of runs) {
            const a = from == null ? 0 : from, b = to == null ? run.length - 1 : to;
            ctx.beginPath();
            for (let i = a; i <= b && i < run.length; i++) {
              const [px, py] = this.toScreen(run[i][0] + off, run[i][1]);
              i === a ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.stroke();
          }
        };
        for (let k = -kMax; k <= kMax; k++) {
          // skip copies that lie entirely off the map
          if (runs.every((run) => run.every(([x]) => x + k * W < -0.02 || x + k * W > 1.02))) continue;
          if (col === "rainbow") {
            ctx.lineWidth = sel ? 9 : 7; ctx.strokeStyle = "rgba(255,255,255,0.18)"; trace(k);
            ctx.lineWidth = sel ? 3.5 : 2.5;
            for (const run of runs) {
              for (let i = 0; i + 1 < run.length; i += 4) {
                ctx.strokeStyle = `hsl(${(i / LEY_SAMPLES * 360 * 6) % 360},90%,62%)`;
                ctx.beginPath();
                const [x0, y0] = this.toScreen(run[i][0] + k * W, run[i][1]);
                ctx.moveTo(x0, y0);
                for (let j = i + 1; j <= Math.min(i + 4, run.length - 1); j++) {
                  const [x1, y1] = this.toScreen(run[j][0] + k * W, run[j][1]); ctx.lineTo(x1, y1);
                }
                ctx.stroke();
              }
            }
          } else {
            const dark = l.aspect === "Skototropi";
            ctx.lineWidth = sel ? 10 : 7;
            ctx.strokeStyle = dark ? "rgba(225,225,255,0.35)" : this._rgba(col, 0.28);
            trace(k);
            ctx.lineWidth = sel ? 3.5 : 2.2;
            ctx.strokeStyle = this._rgba(col, 0.95);
            trace(k);
          }
        }
      });
      ctx.restore();
      if (!editing) return;
      // handles: both points of every line, labelled with the aspect at the first point
      ctx.save();
      ctx.font = "500 12px 'Alegreya Sans', sans-serif";
      this.leylines.forEach((l, li) => {
        if (!this._leyShown(l)) return;
        const col = FieldMap.leyColour(l.aspect), sel = li === this.selectedLey;
        [l.a, l.b].forEach((p, pi) => {
          const [x, y] = this.toScreen(p.x, p.y);
          ctx.fillStyle = col === "rainbow" ? "#e98bd8" : col;
          ctx.strokeStyle = l.aspect === "Skototropi" ? "#e7e1d1" : "#18212a"; ctx.lineWidth = 2;
          ctx.beginPath();
          if (pi === 0) ctx.arc(x, y, sel ? 8 : 6, 0, Math.PI * 2);
          else { const r = sel ? 7 : 5; ctx.rect(x - r, y - r, 2 * r, 2 * r); }
          ctx.fill(); ctx.stroke();
          if (pi === 0) {
            const w = ctx.measureText(l.aspect).width;
            ctx.fillStyle = "rgba(24,33,42,0.8)"; ctx.fillRect(x + 10, y - 9, w + 8, 17);
            ctx.fillStyle = sel ? "#c9a24a" : "#e7e1d1"; ctx.fillText(l.aspect, x + 14, y + 4);
          }
        });
      });
      ctx.restore();
    }
    _hitLeyHandle(sx, sy, radius) {
      let best = null, bd = radius;
      this.leylines.forEach((l, li) => this._leyShown(l) && ["a", "b"].forEach((end) => {
        const [x, y] = this.toScreen(l[end].x, l[end].y), d = Math.hypot(x - sx, y - sy);
        if (d < bd) { bd = d; best = { li, end }; }
      }));
      return best;
    }

    /** Distinct colour per region (golden-angle hues), as [r, g, b]. */
    regionColour(ri) {
      const h = (ri * 137.508) % 360 / 360, s = 0.68, l = ri % 2 ? 0.52 : 0.6;
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
      return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
    }
    /**
     * While placing regions: colour the area each region currently covers, outline the borders
     * between regions, and make the region being placed stand out.
     */
    _drawTerritories() {
      const g = this.grid, key = this.selectedRegion || "";
      const stale = this._dragging && this.terr; // while a point is dragged, redraw colours on release
      if (!stale && (!this.terr || this.terr.grid !== g || this.terr.key !== key)) {
        const cv = this.terr && this.terr.canvas || document.createElement("canvas");
        // twice the weather grid's resolution, so borders stay thin when zoomed in
        const tw = g.gw * 2, th = g.gh * 2, aspect = this.imgH / this.imgW, pts = this._anchorPoints();
        cv.width = tw; cv.height = th;
        const own = new Int16Array(tw * th);
        for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
          const w = this._weightsAt((i + 0.5) / tw, (j + 0.5) / th * aspect, pts, 1);
          own[j * tw + i] = !w || w.cov < 0.05 ? -1 : w.idx[0];
        }
        const cx = cv.getContext("2d"), img = cx.createImageData(tw, th), d = img.data;
        const sel = this.selectedRegion != null ? this.regionIndex.get(this.selectedRegion) : undefined;
        const cols = new Map();
        for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
          const c = j * tw + i, ri = own[c], p = c * 4;
          if (ri < 0) { d[p + 3] = 0; continue; }
          const r2 = i + 1 < tw ? own[c + 1] : ri, b2 = j + 1 < th ? own[c + tw] : ri;
          if ((r2 >= 0 && r2 !== ri) || (b2 >= 0 && b2 !== ri)) { d[p] = 20; d[p + 1] = 26; d[p + 2] = 32; d[p + 3] = 200; continue; }
          if (!cols.has(ri)) cols.set(ri, this.regionColour(ri));
          const [r, gg, b] = cols.get(ri);
          d[p] = r; d[p + 1] = gg; d[p + 2] = b;
          d[p + 3] = sel === undefined ? 95 : ri === sel ? 150 : 55;
        }
        cx.putImageData(img, 0, 0);
        this.terr = { grid: g, key, canvas: cv };
      }
      const { s, ox, oy } = this.view, ctx = this.ctx;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.terr.canvas, ox, oy, this.imgW * s, this.imgH * s);
      ctx.restore();
    }
    _drawAnchors() {
      const ctx = this.ctx;
      ctx.font = "500 12px 'Alegreya Sans', sans-serif";
      for (const a of this.anchors) {
        const [x, y] = this.toScreen(a.x, a.y);
        const sel = a.region === this.selectedRegion;
        const gone = this.regionIndex.size > 0 && !this.regionIndex.has(a.region); // region no longer exists
        const ri = this.regionIndex.get(a.region), rc = ri !== undefined ? this.regionColour(ri) : null;
        ctx.fillStyle = gone ? "rgba(125,142,155,0.9)" : sel ? "#c9a24a" : rc ? `rgb(${rc[0]},${rc[1]},${rc[2]})` : "rgba(231,225,209,0.9)";
        ctx.strokeStyle = "#18212a"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, sel ? 7 : 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        const label = gone ? a.region + " ✕" : a.region;
        const w = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(24,33,42,0.8)";
        ctx.fillRect(x + 9, y - 9, w + 8, 17);
        ctx.fillStyle = sel ? "#c9a24a" : "#e7e1d1";
        ctx.fillText(label, x + 13, y + 4);
      }
    }

    _rgba(hex, a) {
      const n = parseInt(hex.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }

    // ── Input ───────────────────────────────────────────────────────────
    _hitAnchor(sx, sy, radius) {
      let best = -1, bd = radius;
      this.anchors.forEach((a, i) => {
        const [x, y] = this.toScreen(a.x, a.y);
        const d = Math.hypot(x - sx, y - sy);
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    }
    _bindEvents() {
      const st = this.stage;
      let down = null;
      const pos = (e) => { const r = st.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      st.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || !this.img) return;
        // presses on the info box, its buttons or the zoom controls are not map clicks
        if (e.target.closest && e.target.closest(".popup, button, a, input, select, textarea, label")) return;
        const [x, y] = pos(e);
        if (this.mapTool && this.mapTool.down && this.mapTool.down(x, y, e.button)) { this._toolActive = true; st.setPointerCapture(e.pointerId); return; }
        if (this.editing && this.editMode === "road" && this.wyPointerDown && this.wyPointerDown(x, y)) {
          this._wyActive = true; st.setPointerCapture(e.pointerId); return;
        }
        if (this.editing && this.editMode === "height" && this.hpPointerDown && this.hpPointerDown(x, y, e.button)) {
          this._hpActive = true; st.setPointerCapture(e.pointerId); return;
        }
        if (this.editing && this.editMode === "river" && this.rvPointerDown && this.rvPointerDown(x, y)) {
          this._rvActive = true; st.setPointerCapture(e.pointerId); return;
        }
        if (this.editing && this.editMode === "nation" && this.ntPointerDown && this.ntPointerDown(x, y)) {
          this._ntActive = true; st.setPointerCapture(e.pointerId); return;
        }
        if (this.editing && this.editMode === "range" && this.rgPointerDown && this.rgPointerDown(x, y)) {
          this._rgActive = true; st.setPointerCapture(e.pointerId); return;
        }
        const leyEdit = this.editing && this.editMode === "ley", zoneEdit = this.editing && this.editMode === "zone";
        const anchor = this.editing && !this.mapTool && !leyEdit && !zoneEdit && this.editMode !== "river" && this.editMode !== "nation" && this.editMode !== "range" && this.editMode !== "road" ? this._hitAnchor(x, y, 10) : -1;
        const zp = zoneEdit ? this._hitZonePoint(x, y, 10) : null;
        if (zp && zp.zi !== this.selectedZone) { this.selectedZone = zp.zi; this.opts.onLeySelected && this.opts.onLeySelected(this.zones[zp.zi].aspect); this.draw(); }
        const ley = leyEdit ? this._hitLeyHandle(x, y, 11) : null;
        if (ley) { this.selectedLey = ley.li; this.opts.onLeySelected && this.opts.onLeySelected(this.leylines[ley.li].aspect); this.draw(); }
        down = { x, y, ox: this.view.ox, oy: this.view.oy, anchor, ley, zp, moved: false };
        st.setPointerCapture(e.pointerId);
      });
      st.addEventListener("pointermove", (e) => {
        if (this.mapTool && this.mapTool.move) { const [tx, ty] = pos(e); this.mapTool.move(tx, ty); if (this._toolActive) return; }
        if (this.editing && this.editMode === "road" && this.wyPointerMove) { const [wx, wy] = pos(e); this.wyPointerMove(wx, wy); if (this._wyActive) return; }
        if (this.editing && this.editMode === "height" && this.hpPointerMove) {
          const [hx, hy] = pos(e);
          this.hpPointerMove(hx, hy);
          if (this._hpActive) return;
        }
        if (this.editing && this.editMode === "river" && this.rvPointerMove) {
          const [rx, ry] = pos(e);
          this.rvPointerMove(rx, ry);
          if (this._rvActive) return;
        }
        if (this._ntActive && this.ntPointerMove) { const [nx2, ny2] = pos(e); this.ntPointerMove(nx2, ny2); return; }
        if (this.editing && this.editMode === "range" && this.rgPointerMove) { const [gx, gy] = pos(e); this.rgPointerMove(gx, gy); if (this._rgActive) return; }
        if (!down) return;
        const [x, y] = pos(e);
        if (Math.hypot(x - down.x, y - down.y) > 4) down.moved = true;
        if (!down.moved) return;
        st.classList.add("dragging");
        if (down.zp) {
          const [nx, ny] = this.toMap(x, y);
          const p = this.zones[down.zp.zi].points[down.zp.pi];
          p.x = clamp(nx, 0, 1); p.y = clamp(ny, 0, 1);
          this.opts.onZonesChanged && this.opts.onZonesChanged();
        } else if (down.ley) {
          const [nx, ny] = this.toMap(x, y);
          const p = this.leylines[down.ley.li][down.ley.end];
          p.x = clamp(nx, 0, 1); p.y = clamp(ny, 0, 1);
          this.opts.onLeylinesChanged && this.opts.onLeylinesChanged();
        } else if (down.anchor >= 0) {
          this._dragging = true;
          const [nx, ny] = this.toMap(x, y);
          const a = this.anchors[down.anchor];
          a.x = clamp(nx, 0, 1); a.y = clamp(ny, 0, 1);
          this.grid = null;
          this.opts.onAnchorsChanged && this.opts.onAnchorsChanged();
        } else {
          this.view.ox = down.ox + (x - down.x); this.view.oy = down.oy + (y - down.y);
          this.userMoved = true;
        }
        this.draw();
      });
      st.addEventListener("pointerup", (e) => {
        if (this._toolActive) { this._toolActive = false; const [tx, ty] = pos(e); this.mapTool && this.mapTool.up && this.mapTool.up(tx, ty); return; }
        if (this._wyActive) { this._wyActive = false; const [wx, wy] = pos(e); this.wyPointerUp(wx, wy); return; }
        if (this._hpActive) { this._hpActive = false; this.hpPointerUp(); return; }
        if (this._rvActive) { this._rvActive = false; this.rvPointerUp(); return; }
        if (this._ntActive) { this._ntActive = false; const [ux, uy] = pos(e); this.ntPointerUp(ux, uy); return; }
        if (this._rgActive) { this._rgActive = false; const [gx, gy] = pos(e); this.rgPointerUp(gx, gy); return; }
        if (!down) return;
        if (this._dragging) { this._dragging = false; this.draw(); }
        st.classList.remove("dragging");
        const [x, y] = pos(e);
        const [nx, ny] = this.toMap(x, y);
        const inside = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
        if (!down.moved && inside && this.mapTool && this.mapTool.click && this.mapTool.click(nx, ny, x, y)) {
          // a map tool (the travel calculator) took the click
        } else if (!down.moved && inside && this.editing && this.editMode === "road") {
          this.wyClick && this.wyClick(nx, ny, x, y);
        } else if (!down.moved && inside) {
          if (this.editing && this.editMode === "river") {
            this.rvClick && this.rvClick(nx, ny, x, y);
          } else if (this.editing && this.editMode === "nation") {
            this.ntClick && this.ntClick(nx, ny, x, y);
          } else if (this.editing && this.editMode === "range") {
            this.rgClick && this.rgClick(nx, ny, x, y);
          } else if (this.editing && this.editMode === "zone") {
            if (!down.zp) {
              const p = { x: nx, y: ny };
              const z = this.zones[this.selectedZone];
              if (z) z.points.splice(this._zoneInsertIndex(z, x, y), 0, p);
              else {
                this.zones.push({ aspect: this.leyAspect, points: [p] });
                this.selectedZone = this.zones.length - 1;
                if (this.leyHidden.has(this.leyAspect)) { this.leyHidden.delete(this.leyAspect); this.opts.onLeyHiddenChanged && this.opts.onLeyHiddenChanged([...this.leyHidden]); }
              }
              this.opts.onZonesChanged && this.opts.onZonesChanged();
              this.draw();
            }
          } else if (this.editing && this.editMode === "ley") {
            if (!down.ley) {
              this.leylines.push({ aspect: this.leyAspect, a: { x: nx, y: ny }, b: this._leyPartner(nx, ny) });
              if (this.leyHidden.has(this.leyAspect)) { this.leyHidden.delete(this.leyAspect); this.opts.onLeyHiddenChanged && this.opts.onLeyHiddenChanged([...this.leyHidden]); }
              this.selectedLey = -1; // only a line picked by clicking its point gets recoloured
              this.opts.onLeylinesChanged && this.opts.onLeylinesChanged();
              this.draw();
            }
          } else if (this.editing) {
            if (down.anchor < 0 && this.selectedRegion) {
              this.anchors.push({ region: this.selectedRegion, x: nx, y: ny });
              this.grid = null;
              this.opts.onAnchorsChanged && this.opts.onAnchorsChanged();
              this.draw();
            }
          } else if (this.opts.onPick) {
            this.opts.onPick(nx, ny, x, y);
          }
        }
        down = null;
      });
      st.addEventListener("pointerleave", () => { if (this.hp && this.hp.hover) { this.hp.hover = null; this.draw(); } });
      // Space held: drag pans the map even in the height painter
      window.addEventListener("keydown", (e) => { if (e.code === "Space" && this.editing && this.editMode === "height" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) { this._spaceDown = true; st.classList.add("pan"); e.preventDefault(); } });
      window.addEventListener("keyup", (e) => { if (e.code === "Space") { this._spaceDown = false; st.classList.remove("pan"); } });
      st.addEventListener("pointercancel", () => { if (this._hpActive) { this._hpActive = false; this.hpPointerUp(); } down = null; this._dragging = false; st.classList.remove("dragging"); this.draw(); });
      st.addEventListener("contextmenu", (e) => {
        if (this.mapTool && this.mapTool.context) { e.preventDefault(); const [cx, cy] = pos(e); this.mapTool.context(cx, cy); return; }
        if (!this.editing) return;
        e.preventDefault();
        const [x, y] = pos(e);
        if (this.editMode === "road") { this.wyContextMenu && this.wyContextMenu(x, y); return; }
        if (this.editMode === "height") { this.hpContextMenu && this.hpContextMenu(); return; }
        if (this.editMode === "river") { this.rvContextMenu && this.rvContextMenu(x, y); return; }
        if (this.editMode === "nation") { this.ntContextMenu && this.ntContextMenu(x, y); return; }
        if (this.editMode === "range") { this.rgContextMenu && this.rgContextMenu(x, y); return; }
        if (this.editMode === "zone") {
          const h = this._hitZonePoint(x, y, 14);
          if (h) {
            const z = this.zones[h.zi];
            z.points.splice(h.pi, 1);
            if (!z.points.length) { this.zones.splice(h.zi, 1); this.selectedZone = -1; }
            else this.selectedZone = h.zi;
            this.opts.onZonesChanged && this.opts.onZonesChanged();
            this.draw();
          }
          return;
        }
        if (this.editMode === "ley") {
          const h = this._hitLeyHandle(x, y, 14);
          if (h) {
            this.leylines.splice(h.li, 1);
            this.selectedLey = -1;
            this.opts.onLeylinesChanged && this.opts.onLeylinesChanged();
            this.draw();
          }
          return;
        }
        const i = this._hitAnchor(x, y, 14);
        if (i >= 0) {
          this.anchors.splice(i, 1);
          this.grid = null;
          this.opts.onAnchorsChanged && this.opts.onAnchorsChanged();
          this.draw();
        }
      });
      st.addEventListener("wheel", (e) => {
        if (!this.img) return;
        e.preventDefault();
        const [x, y] = pos(e);
        this.zoomAt(x, y, Math.exp(-e.deltaY * 0.0015));
      }, { passive: false });
      st.addEventListener("keydown", (e) => {
        if (e.key === "+" || e.key === "=") this.zoomAt(this.cssW / 2, this.cssH / 2, 1.25);
        else if (e.key === "-") this.zoomAt(this.cssW / 2, this.cssH / 2, 0.8);
        else if (e.key === "0") { this.fit(); this.draw(); }
        else if (e.key === "Escape" && this.editing && this.editMode === "zone") this.newZone();
      });
    }
    zoomBy(f) { this.zoomAt(this.cssW / 2, this.cssH / 2, f); }
    refit() { this.userMoved = false; this.fit(); this.draw(); }
    zoomAt(x, y, f) {
      if (!this.img) return;
      this.userMoved = true;
      const minS = Math.min(this.cssW / this.imgW, this.cssH / this.imgH) * 0.5;
      // with zoom tiles: zoom on until the full-size map's pixels are 3× magnified
      const maxS = this.tiles ? Math.max(8, this.tiles.fullW / this.imgW * 3) : 8;
      const s = clamp(this.view.s * f, minS, maxS);
      const k = s / this.view.s;
      this.view.ox = x - (x - this.view.ox) * k;
      this.view.oy = y - (y - this.view.oy) * k;
      this.view.s = s;
      this.draw();
    }
  }

  FieldMap.FORCE_COLOURS = FORCE_COLOURS;
  FieldMap.TEMP_STOPS = TEMP_STOPS;
  FieldMap.RAIN_STOPS = RAIN_STOPS;
  window.FieldMap = FieldMap;
})();
