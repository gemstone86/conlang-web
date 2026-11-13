// Eon Weather – height painter: edit a map's height map (0–255 grey) right on the map.
// Adds methods to FieldMap. Tools: brush (set a height), raise, lower, smooth, polygon fill,
// bucket fill, eyedropper and pan; undo; export/save as an 8-bit greyscale PNG.
(function () {
  "use strict";
  const FM = window.FieldMap;
  if (!FM) return;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const MAX_W = 8192;

  // ── Colours for the "colours" view: sea in blues by depth, land green → brown → white ──
  function colourLut(sea) {
    const lut = new Uint32Array(256);
    const pack = (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;  // little-endian RGBA
    const land = [[0, [86, 140, 74]], [8, [140, 170, 92]], [20, [205, 190, 120]], [40, [160, 120, 80]], [65, [140, 130, 125]], [90, [245, 245, 245]]];
    for (let v = 0; v < 256; v++) {
      if (v < sea) {
        const d = clamp((sea - v) / 60, 0, 1);
        lut[v] = pack(Math.round(150 - 120 * d), Math.round(200 - 120 * d), Math.round(235 - 90 * d), 255);
      } else {
        const m = v - sea;
        let i = 0;
        while (i < land.length - 2 && m > land[i + 1][0]) i++;
        const [a0, c0] = land[i], [a1, c1] = land[i + 1], f = clamp((m - a0) / (a1 - a0), 0, 1);
        lut[v] = pack(...c0.map((c, k) => Math.round(c + (c1[k] - c) * f)), 255);
      }
    }
    return lut;
  }
  /**
   * Forest density 0–100 while painting: see-through where there are no trees (the map shows), then
   * green, darker and more solid the denser (over 100 counts as 100). Never the height map's colours.
   */
  function forestLut() {
    const lut = new Uint32Array(256);
    for (let v = 0; v < 256; v++) {
      const f = Math.min(v, 100) / 100;
      const r = Math.round(70 - 55 * f), g = Math.round(170 - 110 * f), b = Math.round(60 - 35 * f);
      const a = v === 0 ? 0 : Math.round(110 + 145 * f);
      lut[v] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }
    return lut;
  }
  /** Ice cover 0–100 while painting: see-through where there is none, then pale blue-white. */
  function iceLut() {
    const lut = new Uint32Array(256);
    for (let v = 0; v < 256; v++) {
      const f = Math.min(v, 100) / 100;
      const r = Math.round(150 + 90 * f), g = Math.round(200 + 50 * f), b = 255;
      const a = v === 0 ? 0 : Math.round(110 + 135 * f);
      lut[v] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }
    return lut;
  }
  /** Marshland cover 0–100 while painting: see-through where dry, then murky olive-teal. */
  function marshLut() {
    const lut = new Uint32Array(256);
    for (let v = 0; v < 256; v++) {
      const f = Math.min(v, 100) / 100;
      const r = Math.round(120 - 50 * f), g = Math.round(140 - 20 * f), b = Math.round(70 + 10 * f);
      const a = v === 0 ? 0 : Math.round(100 + 140 * f);
      lut[v] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }
    return lut;
  }
  function greyLut() {
    const lut = new Uint32Array(256);
    for (let v = 0; v < 256; v++) lut[v] = ((255 << 24) | (v << 16) | (v << 8) | v) >>> 0;
    return lut;
  }

  // ── 8-bit greyscale PNG encoder (zlib via CompressionStream) ──
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }
  async function encodeGreyPNG(data, w, h) {
    // filter "Sub" on every row: small numbers for smooth terrain, so it packs well
    const raw = new Uint8Array((w + 1) * h);
    for (let y = 0; y < h; y++) {
      const o = y * (w + 1), r = y * w;
      raw[o] = 1;
      raw[o + 1] = data[r];
      for (let x = 1; x < w; x++) raw[o + 1 + x] = (data[r + x] - data[r + x - 1]) & 255;
    }
    const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
    const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    return new Blob([sig, chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))], { type: "image/png" });
  }
  FM.encodeGreyPNG = encodeGreyPNG;
  /** Grey + alpha PNG (colour type 4): grey = height, alpha 255 where mask is set. */
  async function encodeGreyAlphaPNG(vals, mask, w, h) {
    const raw = new Uint8Array((w * 2 + 1) * h);
    for (let y = 0; y < h; y++) {
      const o = y * (w * 2 + 1), r = y * w;
      raw[o] = 1;                                   // "Sub": each byte minus the one a pixel before
      let pv = 0, pa = 0;
      for (let x = 0; x < w; x++) {
        const v = mask[r + x] ? vals[r + x] : 0, a = mask[r + x] ? 255 : 0;
        raw[o + 1 + x * 2] = (v - pv) & 255; raw[o + 2 + x * 2] = (a - pa) & 255;
        pv = v; pa = a;
      }
    }
    const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
    const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 4; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    return new Blob([sig, chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))], { type: "image/png" });
  }
  /** A suggestion's patch image → { w, h, vals, mask } (decoded by the browser). */
  async function decodePatch(blob) {
    const bm = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const cv = document.createElement("canvas"); cv.width = bm.width; cv.height = bm.height;
    const c = cv.getContext("2d", { willReadFrequently: true }); c.drawImage(bm, 0, 0);
    const px = c.getImageData(0, 0, bm.width, bm.height).data, n = bm.width * bm.height;
    const vals = new Uint8Array(n), mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) { vals[i] = px[i * 4]; mask[i] = px[i * 4 + 3] >= 128 ? 1 : 0; }
    return { w: bm.width, h: bm.height, vals, mask };
  }
  FM.decodePatch = decodePatch;

  const P = FM.prototype;

  /** Painter settings (tool, height, size…), kept between edits. */
  P.hpSettings = function () {
    if (!this.hpSet) this.hpSet = { tool: "brush", value: 140, radius: 12, soft: true, strength: 2, tol: 0, coast: true, view: "colour", alpha: 0.75, riverW: 8, riverDepth: 1, ridgeW: 16, coastW: 14, plateauW: 4, grain: 6 };
    return this.hpSet;
  };
  P.hpSet_ = function (k, v) { this.hpSettings()[k] = v; if (k === "view" || k === "alpha") this._hpRelut(); this.draw(); };

  /**
   * What the painter edits: "height" (the height map) or "forest" (forest density 0–100, see
   * setForestImage). Each keeps its own edits (and undo) while you switch between them.
   */
  P.hpSetTarget = function (t) {
    t = t === "forest" || t === "ice" || t === "marsh" ? t : "height";
    if ((this.hpTarget || "height") === t) return;
    this._hpStash = this._hpStash || {};
    this._hpStash[this.hpTarget || "height"] = this.hp;
    this.hp = this._hpStash[t] || null;
    this.hpTarget = t;
    if (this.hp) this._hpRelut();
    this.draw();
  };
  /** Painting a layer over the map (forest, ice: 0–100) rather than heights. */
  const isForest = (fm) => fm.hpTarget === "forest" || fm.hpTarget === "ice" || fm.hpTarget === "marsh";
  /** Sea level for the painter's tools (none while painting forest or ice). */
  P._hpSea = function (dflt) { return !isForest(this) && this.seaLevel != null ? this.seaLevel : dflt; };
  /** Start editing: full-size copy of the current height map (or forest map), or a new flat one. */
  P.hpOpen = function (fallbackW) {
    if (this.hp && this.hp.data) return true;
    const src = this.hpTarget === "ice" ? this.iceSource : this.hpTarget === "marsh" ? this.marshSource : isForest(this) ? this.forestSource : this.heightSource;
    if (!src && isForest(this)) {             // no forest (ice) yet: none anywhere
      const w = Math.min(this.imgW || 4096, MAX_W), h = Math.max(1, Math.round(w * this.imgH / this.imgW));
      this._hpInit(new Uint8Array(w * h), w, h);
      return true;
    }
    let w, h, data;
    if (src) {
      w = Math.min(src.naturalWidth || src.width, MAX_W);
      h = Math.max(1, Math.round(w * this.imgH / this.imgW));
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const c = cv.getContext("2d", { willReadFrequently: true });
      c.drawImage(src, 0, 0, w, h);
      const px = c.getImageData(0, 0, w, h).data;
      data = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) data[i] = px[i * 4];
    } else {
      return false;
    }
    this._hpInit(data, w, h);
    return true;
  };
  /** A new height map: everything at one height (default: just above sea level). */
  P.hpNew = function (w, value) {
    w = clamp(Math.round(w || this.imgW), 256, MAX_W);
    const h = Math.max(1, Math.round(w * this.imgH / this.imgW));
    const data = new Uint8Array(w * h).fill(clamp(value | 0, 0, 255));
    this._hpInit(data, w, h);
    this._hpCommitWind();
    this.opts.onHeightChanged && this.opts.onHeightChanged(this.hpTarget || "height");
  };
  /** Load an image (e.g. another map's height map) into the editor. */
  P.hpLoad = function (img) {
    const w = Math.min(img.naturalWidth || img.width, MAX_W), h = Math.max(1, Math.round(w * this.imgH / this.imgW));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const c = cv.getContext("2d", { willReadFrequently: true });
    c.drawImage(img, 0, 0, w, h);
    const px = c.getImageData(0, 0, w, h).data, data = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) data[i] = px[i * 4];
    this._hpInit(data, w, h);
    this._hpCommitWind();
    this.opts.onHeightChanged && this.opts.onHeightChanged(this.hpTarget || "height");
  };
  /**
   * The height map in colours for the "Höjdkarta" layer, which anyone can turn on (no editing).
   * Made at the image's own size (at most MAX_W wide) and kept until the height map or sea level changes.
   */
  P.heightColours = function () {
    const src = this.heightSource;
    if (!src) return null;
    const sea = this.seaLevel != null ? this.seaLevel : 0;
    const V = this._hview;
    if (V && V.src === src && V.sea === sea && !V.stale) return V.canvas;
    const w = Math.min(src.naturalWidth || src.width, MAX_W), h = Math.max(1, Math.round(w * this.imgH / this.imgW));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const c = cv.getContext("2d", { willReadFrequently: true });
    c.drawImage(src, 0, 0, w, h);
    const img = c.getImageData(0, 0, w, h), px = img.data, out = new Uint32Array(px.buffer), lut = colourLut(sea);
    for (let i = 0; i < w * h; i++) out[i] = lut[px[i * 4]];
    c.putImageData(img, 0, 0);
    this._hview = { src, sea, canvas: cv };
    return cv;
  };
  P.hpClose = function () { this.hp = null; this._hpStash = null; this.draw(); };
  P.hpHas = function () { return !!(this.hp && this.hp.data); };

  P._hpInit = function (data, w, h) {
    const grey = document.createElement("canvas"); grey.width = w; grey.height = h;
    const view = document.createElement("canvas"); view.width = w; view.height = h;
    this.hp = { data, w, h, grey, view, undo: [], poly: [], hover: null, orig: data.slice(), target: this.hpTarget || "height" };
    this._hpOutliersSoon();
    this._hpDividesSoon();
    this._hpRelut();
    this._hpPaintRect(grey, greyLut(), 0, 0, w, h);
  };
  P._hpRelut = function () {
    const E = this.hp;
    if (!E) return;
    const S = this.hpSettings();
    E.lut = S.view === "grey" ? greyLut() : this.hpTarget === "ice" ? iceLut() : this.hpTarget === "marsh" ? marshLut() : isForest(this) ? forestLut() : colourLut(this.seaLevel != null ? this.seaLevel : 0);
    this._hpPaintRect(E.view, E.lut, 0, 0, E.w, E.h);
  };
  P._hpPaintRect = function (cv, lut, x0, y0, x1, y1) {
    const E = this.hp;
    x0 = clamp(x0, 0, E.w); y0 = clamp(y0, 0, E.h); x1 = clamp(x1, 0, E.w); y1 = clamp(y1, 0, E.h);
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    const c = cv.getContext("2d"), img = c.createImageData(w, h), out = new Uint32Array(img.data.buffer);
    for (let y = 0; y < h; y++) {
      const r = (y0 + y) * E.w + x0, o = y * w;
      for (let x = 0; x < w; x++) out[o + x] = lut[E.data[r + x]];
    }
    c.putImageData(img, x0, y0);
  };
  /**
   * Forest and marshland are never painted on water: a pixel of the painter's map at or below the sea level
   * of the height map (the one shown; none: no limit) keeps what it had when the stroke began.
   */
  P._hpWaterMask = function () {
    const E = this.hp, G = this.heightGrid && this.seaLevel != null ? this.heightGrid() : null;
    if (!G) return null;
    if (E.water && E.waterKey === G.key + ":" + G.sea) return E.water;
    const m = new Uint8Array(E.w * E.h);
    for (let y = 0; y < E.h; y++) {
      const gy = Math.min(G.h - 1, Math.floor((y + 0.5) * G.h / E.h)), r = gy * G.w;
      for (let x = 0; x < E.w; x++) m[y * E.w + x] = G.d[r + Math.min(G.w - 1, Math.floor((x + 0.5) * G.w / E.w))] <= G.sea ? 1 : 0;
    }
    E.water = m; E.waterKey = G.key + ":" + G.sea;
    return m;
  };
  P._hpKeepDry = function (x0, y0, x1, y1) {
    const E = this.hp, m = this._hpWaterMask();
    if (!m || !E.before) return;
    for (let y = Math.max(0, y0); y < Math.min(E.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(E.w, x1); x++) {
      const i = y * E.w + x;
      if (m[i]) E.data[i] = E.before[i];
    }
  };
  P._hpRefresh = function (x0, y0, x1, y1) {
    const E = this.hp;
    x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.ceil(x1); y1 = Math.ceil(y1);
    if (E.bbox && (E.target === "forest" || E.target === "marsh")) this._hpKeepDry(x0, y0, x1, y1);
    this._hpPaintRect(E.view, E.lut, x0, y0, x1, y1);
    this._hpPaintRect(E.grey, this._greyLut || (this._greyLut = greyLut()), x0, y0, x1, y1);
    const b = E.bbox;
    if (b) { b[0] = Math.min(b[0], x0); b[1] = Math.min(b[1], y0); b[2] = Math.max(b[2], x1); b[3] = Math.max(b[3], y1); }
  };

  // ── one undoable operation: begin → changes → end ──
  P._hpBegin = function () {
    const E = this.hp;
    if (!E.before || E.before.length !== E.data.length) E.before = new Uint8Array(E.data.length);
    E.before.set(E.data);
    E.bbox = [Infinity, Infinity, -Infinity, -Infinity];
  };
  P._hpEnd = function () {
    const E = this.hp, b = E.bbox;
    E.bbox = null;
    if (!b || b[2] <= b[0]) return;
    const x0 = clamp(b[0], 0, E.w), y0 = clamp(b[1], 0, E.h), x1 = clamp(b[2], 0, E.w), y1 = clamp(b[3], 0, E.h);
    const w = x1 - x0, h = y1 - y0, pix = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) pix.set(E.before.subarray((y0 + y) * E.w + x0, (y0 + y) * E.w + x1), y * w);
    E.undo.push({ x0, y0, w, h, pix });
    if (E.undo.length > 30) E.undo.shift();
    if (this._hview) this._hview.stale = true;
    this._hpOutliersSoon();
    this._hpDividesSoon();
    this._hpCommitWind();
    this.opts.onHeightChanged && this.opts.onHeightChanged(this.hpTarget || "height");
  };
  P.hpUndo = function () {
    const E = this.hp;
    if (!E || !E.undo.length) return false;
    const u = E.undo.pop();
    E.frac = null;
    for (let y = 0; y < u.h; y++) E.data.set(u.pix.subarray(y * u.w, (y + 1) * u.w), (u.y0 + y) * E.w + u.x0);
    E.bbox = null;
    this._hpRefresh(u.x0, u.y0, u.x0 + u.w, u.y0 + u.h);
    this._hpOutliersSoon();
    this._hpDividesSoon();
    this._hpCommitWind();
    this.opts.onHeightChanged && this.opts.onHeightChanged(this.hpTarget || "height");
    this.draw();
    return true;
  };
  // ── odd pixels: a spike or pit that stands out from (nearly) all its neighbours, marked in blue ──
  /**
   * Finds pixels at least thr steps above the second highest of their 8 neighbours, or below the
   * second lowest: lone spikes and pits (one or two pixels), not slopes or coastlines.
   */
  P._hpFindOutliers = function () {
    const E = this.hp, S = this.hpSettings();
    if (!E || !S.outliers) { if (E) E.out = null; return; }
    const d = E.data, w = E.w, h = E.h, thr = Math.max(1, S.outlierThr || 5), out = [];
    for (let y = 1; y < h - 1; y++) {
      const r = y * w;
      for (let x = 1; x < w - 1; x++) {
        const i = r + x, v = d[i];
        let m1 = -1, m2 = -1, n1 = 999, n2 = 999;
        for (const j of [i - w - 1, i - w, i - w + 1, i - 1, i + 1, i + w - 1, i + w, i + w + 1]) {
          const u = d[j];
          if (u > m1) { m2 = m1; m1 = u; } else if (u > m2) m2 = u;
          if (u < n1) { n2 = n1; n1 = u; } else if (u < n2) n2 = u;
        }
        if (v - m2 >= thr || n2 - v >= thr) out.push(i);
        if (out.length > 200000) break;
      }
    }
    E.out = Int32Array.from(out);
    this.opts.onOutliers && this.opts.onOutliers(E.out.length);
  };
  /** Turns the marking of odd pixels on or off (thr: steps, default 5 = 500 m on Mundana's scale). */
  P.hpSetOutliers = function (on, thr) {
    const S = this.hpSettings();
    S.outliers = !!on;
    if (thr != null) S.outlierThr = thr;
    this._hpFindOutliers();
    this.draw();
  };
  P._hpOutliersSoon = function () {
    if (!this.hpSettings().outliers) return;
    clearTimeout(this._hpOutT);
    this._hpOutT = setTimeout(() => { this._hpFindOutliers(); this.draw(); }, 250);
  };
  // ── what the drawn rivers say about the ground (the work is in terrain.js) ──
  /** Finds the divides between the drawn rivers, the too-low parts, and where rivers climb downstream. */
  P._hpFindDivides = function () {
    const E = this.hp, S = this.hpSettings();
    if (!E) return;
    E.div = null;
    if (!S.divides || E.target !== "height" || !window.EonTerrain) return;
    const V = window.EonTerrain.findDivides(E.data, E.w, E.h, this._hpSea(-1), this.rivers || []);
    E.div = { ...V, canvas: null };
    this.opts.onDivides && this.opts.onDivides({ ok: V.nOk, low: V.nLow, up: V.up.length, rivers: V.rivers });
  };
  /** The divides as a see-through picture (yellow: high enough, orange-red: too low), a little thickened. */
  P._hpDivCanvas = function () {
    const E = this.hp, V = E && E.div;
    if (!V) return null;
    if (V.canvas) return V.canvas;
    const w = E.w, h = E.h, cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const c = cv.getContext("2d"), img = c.createImageData(w, h), out = new Uint32Array(img.data.buffer);
    const OK = ((200 << 24) | (110 << 16) | (225 << 8) | 255) >>> 0, LOW = ((255 << 24) | (30 << 16) | (70 << 8) | 255) >>> 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, k = V.kind[i];
      if (!k) continue;
      const col = k === 2 ? LOW : OK;
      for (const j of [i, i - 1, i + 1, i - w, i + w]) if (k === 2 || !out[j]) out[j] = col;
    }
    c.putImageData(img, 0, 0);
    return (V.canvas = cv);
  };
  /** Turns the divides overlay on or off. */
  P.hpSetDivides = function (on) {
    this.hpSettings().divides = !!on;
    this._hpFindDivides();
    this.draw();
  };
  P._hpDividesSoon = function () {
    if (!this.hpSettings().divides) return;
    clearTimeout(this._hpDivT);
    this._hpDivT = setTimeout(() => { this._hpFindDivides(); this.draw(); }, 600);
  };
  /**
   * Lifts the too-low divides: each is raised to what it needs, and the ground towards both rivers
   * rises with it, less and less the closer to a river (nothing at the river itself), on a smooth
   * curve. Only raises, only land; one step to undo. Returns how many pixels changed.
   */
  P.hpLiftDivides = function () {
    const E = this.hp;
    if (!E || E.target !== "height" || !window.EonTerrain) return 0;
    if (!E.div) { this.hpSettings().divides = true; this._hpFindDivides(); }
    const V = E.div;
    if (!V || !V.nLow) return 0;
    this._hpBegin();
    const r = window.EonTerrain.liftDivides(E.data, E.w, E.h, this._hpSea(-1), V);
    if (r.n) this._hpRefresh(r.x0, r.y0, r.x1 + 1, r.y1 + 1);
    this._hpEnd();
    this._hpFindDivides();
    this.draw();
    return r.n;
  };
  /** Puts the calculated height map (ranges, divides and rivers on the current heights) into the painter, as one step to undo. */
  P.hpUseDerived = function () {
    const E = this.hp;
    if (!E || E.target !== "height" || !window.EonTerrain) return 0;
    const D = window.EonTerrain.derive(E.data, E.w, E.h, { sea: this._hpSea(0), mps: this.metersPerStep || 100, rivers: this.rivers || [], ranges: this.ranges || [], imgW: this.imgW, imgH: this.imgH });
    this._hpBegin();
    let n = 0;
    for (let i = 0; i < D.length; i++) if (D[i] !== E.data[i]) { E.data[i] = D[i]; n++; }
    if (n) this._hpRefresh(0, 0, E.w, E.h);
    this._hpEnd();
    this.draw();
    return n;
  };
  P.hpCanUndo = function () { return !!(this.hp && this.hp.undo.length); };
  /** Wind and rain use the edited heights (after each finished stroke). */
  P._hpCommitWind = function () {
    if (!this.hp) return;
    if (this.hp.target === "forest") this.setForestImage(this.hp.grey);
    else if (this.hp.target === "ice") this.setIceImage(this.hp.grey);
    else if (this.hp.target === "marsh") this.setMarshImage(this.hp.grey);
    else this.setHeightImage(this.hp.grey);
  };

  // ── tools ──
  P._hpDab = function (hx, hy) {
    const E = this.hp, S = this.hpSettings(), r = Math.max(0.5, S.radius), d = E.data;
    const x0 = Math.max(0, Math.floor(hx - r)), x1 = Math.min(E.w - 1, Math.ceil(hx + r));
    const y0 = Math.max(0, Math.floor(hy - r)), y1 = Math.min(E.h - 1, Math.ceil(hy + r));
    if (x1 < x0 || y1 < y0) return;
    const fall = (dist) => { const t = dist / r; if (t > 1) return 0; if (!S.soft) return 1; const u = 1 - t * t; return u * u; };
    if (S.tool === "erode") { this._hpErode(hx, hy, r, fall); return; }
    if (S.tool === "rough") { this._hpRough(hx, hy, r, fall); return; }
    if (S.tool === "smooth") {
      // blur the patch (box blur via a summed-area table), blended in by the falloff
      const k = Math.max(1, Math.round(r / 5)), px0 = Math.max(0, x0 - k), py0 = Math.max(0, y0 - k);
      const px1 = Math.min(E.w - 1, x1 + k), py1 = Math.min(E.h - 1, y1 + k), pw = px1 - px0 + 1, ph = py1 - py0 + 1;
      const sat = new Float64Array((pw + 1) * (ph + 1));
      for (let y = 0; y < ph; y++) {
        let row = 0;
        for (let x = 0; x < pw; x++) { row += d[(py0 + y) * E.w + px0 + x]; sat[(y + 1) * (pw + 1) + x + 1] = sat[y * (pw + 1) + x + 1] + row; }
      }
      const box = (ax, ay, bx, by) => sat[(by + 1) * (pw + 1) + bx + 1] - sat[ay * (pw + 1) + bx + 1] - sat[(by + 1) * (pw + 1) + ax] + sat[ay * (pw + 1) + ax];
      const out = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const f = fall(Math.hypot(x + 0.5 - hx, y + 0.5 - hy)) * 0.7;
        if (f <= 0) continue;
        const ax = Math.max(0, x - k - px0), ay = Math.max(0, y - k - py0), bx = Math.min(pw - 1, x + k - px0), by = Math.min(ph - 1, y + k - py0);
        const mean = box(ax, ay, bx, by) / ((bx - ax + 1) * (by - ay + 1));
        out.push(y * E.w + x, d[y * E.w + x] + (mean - d[y * E.w + x]) * f);
      }
      for (let i = 0; i < out.length; i += 2) d[out[i]] = clamp(Math.round(out[i + 1]), 0, 255);
    } else {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const f = fall(Math.hypot(x + 0.5 - hx, y + 0.5 - hy));
        if (f <= 0) continue;
        const i = y * E.w + x, v = d[i];
        let nv = v;
        if (S.tool === "brush") nv = S.soft ? v + (S.value - v) * Math.min(1, f * 0.6) : S.value;
        else if (S.tool === "raise") nv = v + S.strength * f;
        else if (S.tool === "lower") nv = v - S.strength * f;
        d[i] = clamp(Math.floor(nv + (S.soft ? Math.random() : 0.5)), 0, 255);
      }
    }
    this._hpRefresh(x0, y0, x1 + 1, y1 + 1);
  };
  /**
   * Erode: rain on the ground under the brush runs downhill; where it gathers it cuts gullies and
   * valleys, it wears peaks and sharp edges down, and drops what it carried where the slope eases
   * (at the foot of the mountain). Strength sets how much each dab takes. Sea is left alone and land
   * stays land.
   */
  P._hpErode = function (hx, hy, r, fall) {
    const E = this.hp, S = this.hpSettings(), d = E.data, W = E.w, H = E.h;
    const sea = this._hpSea(-1), m = Math.ceil(r) + 3;
    const x0 = Math.max(0, Math.floor(hx - m)), x1 = Math.min(W - 1, Math.ceil(hx + m));
    const y0 = Math.max(0, Math.floor(hy - m)), y1 = Math.min(H - 1, Math.ceil(hy + m));
    const pw = x1 - x0 + 1, ph = y1 - y0 + 1, n = pw * ph;
    if (pw < 3 || ph < 3) return;
    // the patch in floats (the editor's own fractions where it has them, so small dabs add up)
    const h = new Float32Array(n), wgt = new Float32Array(n);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const i = y * pw + x, k = (y0 + y) * W + x0 + x;
      h[i] = d[k] + (E.frac && E.frac.has(k) ? E.frac.get(k) : 0);
      wgt[i] = fall(Math.hypot(x0 + x + 0.5 - hx, y0 + y + 0.5 - hy));
    }
    const K = 0.012 * S.strength;                   // how hard the water bites
    const NB = [[-1, -1, Math.SQRT2], [0, -1, 1], [1, -1, Math.SQRT2], [-1, 0, 1], [1, 0, 1], [-1, 1, Math.SQRT2], [0, 1, 1], [1, 1, Math.SQRT2]];
    const order = new Uint32Array(n), area = new Float32Array(n), load = new Float32Array(n), low = new Int32Array(n), slope = new Float32Array(n);
    for (let it = 0; it < 2; it++) {
      // where each point drains to (steepest way down), highest first
      for (let i = 0; i < n; i++) order[i] = i;
      order.sort((a, b) => h[b] - h[a]);
      for (let i = 0; i < n; i++) {
        const x = i % pw, y = (i - x) / pw;
        let best = -1, bs = 0;
        for (const [dx, dy, dl] of NB) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= pw || yy >= ph) continue;
          const sl = (h[i] - h[yy * pw + xx]) / dl;
          if (sl > bs) { bs = sl; best = yy * pw + xx; }
        }
        low[i] = best; slope[i] = bs; area[i] = 1; load[i] = 0;
      }
      for (let o = 0; o < n; o++) {
        const i = order[o];
        if (h[i] <= sea) continue;
        const j = low[i], f = wgt[i];
        if (j >= 0 && f > 0) {
          // what the water can carry: nothing where it only just fell (ridges and peaks keep their
          // shape), more where it has gathered from the slopes above (gullies and valleys)
          const cap = (Math.sqrt(area[i]) - 1) * slope[i] * 0.6;
          if (load[i] > cap) {                                 // slows down: drops some
            const dep = (load[i] - cap) * 0.5;
            h[i] += dep; load[i] -= dep;
          } else {                                             // picks up: cuts down, never below where it goes
            const cut = Math.min((cap - load[i]) * K * f, Math.max(0, h[i] - h[j]) * 0.3);
            h[i] -= cut; load[i] += cut;
          }
        }
        if (j >= 0) { area[j] += area[i]; load[j] += load[i]; }
      }
      // loose ground slides off slopes steeper than about two steps per pixel
      for (let o = 0; o < n; o++) {
        const i = order[o], j = low[i], f = wgt[i];
        if (j < 0 || f <= 0 || h[i] <= sea) continue;
        const ex = slope[i] - 3;
        if (ex > 0) { const mv = ex * 0.2 * f * Math.min(1, K * 3); h[i] -= mv; h[j] += mv; }
      }
    }
    // the change, softened a little (gullies a few pixels wide instead of single-pixel scratches)
    const h0 = new Float32Array(n);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const k = (y0 + y) * W + x0 + x; h0[y * pw + x] = d[k] + (E.frac && E.frac.has(k) ? E.frac.get(k) : 0); }
    const dl = new Float32Array(n);
    for (let i = 0; i < n; i++) dl[i] = h[i] - h0[i];
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      let sum = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= pw || yy >= ph) continue;
        const wgt_ = dx || dy ? 1 : 2; sum += dl[yy * pw + xx] * wgt_; c += wgt_;
      }
      h[y * pw + x] = h0[y * pw + x] + sum / c;
    }
    // back into the height map: whole steps, the fractions kept for the next dab
    if (!E.frac) E.frac = new Map();
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const i = y * pw + x, k = (y0 + y) * W + x0 + x;
      if (d[k] <= sea) continue;                         // sea stays as it is
      let v = Math.max(h[i], sea + 1);
      v = Math.min(255, v);
      const whole = Math.floor(v);
      d[k] = whole;
      const fr = v - whole;
      if (fr > 0.01) E.frac.set(k, fr); else E.frac.delete(k);
    }
    if (E.frac.size > 400000) E.frac.clear();
    this._hpRefresh(x0, y0, x1 + 1, y1 + 1);
  };
  /**
   * Roughness: adds bumps, knolls and hollows under the brush. The pattern belongs to the place (the
   * same bumps grow with every pass), as much up as down, so the ground keeps its height on the whole.
   * Grain (S.grain, height-map pixels) sets their size, strength how fast they grow. Only adds roughness;
   * the sea is left alone and land stays land.
   */
  P._hpRough = function (hx, hy, r, fall) {
    const E = this.hp, S = this.hpSettings(), d = E.data, W = E.w, H = E.h;
    const sea = this._hpSea(-1), g = Math.max(1, S.grain || 6), amt = 0.12 * (S.strength || 2);
    const x0 = Math.max(0, Math.floor(hx - r)), x1 = Math.min(W - 1, Math.ceil(hx + r));
    const y0 = Math.max(0, Math.floor(hy - r)), y1 = Math.min(H - 1, Math.ceil(hy + r));
    if (!E.frac) E.frac = new Map();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const f = fall(Math.hypot(x + 0.5 - hx, y + 0.5 - hy));
      if (f <= 0) continue;
      const k = y * W + x;
      if (d[k] <= sea) continue;
      // three octaves around the grain: knolls with smaller bumps on them, about −1…1
      const n = (noise2(x / g, y / g) - 0.5) * 1.2 + (noise2(x / (g * 0.45) + 17.3, y / (g * 0.45) - 4.1) - 0.5) * 0.55
        + (noise2(x / (g * 2.2) - 9.7, y / (g * 2.2) + 3.3) - 0.5) * 0.5;
      let v = d[k] + (E.frac.get(k) || 0) + n * 2 * amt * f;
      v = clamp(v, sea >= 0 ? sea + 1 : 0, 255);
      const whole = Math.floor(v), fr = v - whole;
      d[k] = whole;
      if (fr > 0.01) E.frac.set(k, fr); else E.frac.delete(k);
    }
    if (E.frac.size > 400000) E.frac.clear();
    this._hpRefresh(x0, y0, x1 + 1, y1 + 1);
  };
  P._hpFlood = function (hx, hy) {
    const E = this.hp, S = this.hpSettings(), d = E.data, w = E.w, h = E.h;
    const sx = clamp(Math.floor(hx), 0, w - 1), sy = clamp(Math.floor(hy), 0, h - 1);
    const v0 = d[sy * w + sx], sea = this._hpSea(null), side0 = sea != null && v0 > sea;
    const target = S.value;
    const ok = (v) => Math.abs(v - v0) <= S.tol && (!S.coast || sea == null || (v > sea) === side0);
    if (target === v0 && S.tol === 0) return;
    const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
    let sp = 0, bx0 = sx, by0 = sy, bx1 = sx, by1 = sy;
    stack[sp++] = sy * w + sx; seen[sy * w + sx] = 1;
    while (sp) {
      const i = stack[--sp], x = i % w, y = (i - x) / w;
      d[i] = target;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) if (j >= 0 && !seen[j] && ok(d[j])) { seen[j] = 1; stack[sp++] = j; }
    }
    this._hpRefresh(bx0, by0, bx1 + 1, by1 + 1);
  };
  P._hpFillPoly = function () {
    const E = this.hp, S = this.hpSettings(), pts = E.poly;
    if (pts.length < 3) return false;
    const xs = pts.map((p) => p.x * E.w), ys = pts.map((p) => p.y * E.h);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const x1 = Math.min(E.w, Math.ceil(Math.max(...xs)) + 1), y1 = Math.min(E.h, Math.ceil(Math.max(...ys)) + 1);
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return false;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const c = cv.getContext("2d", { willReadFrequently: true });
    c.beginPath();
    xs.forEach((x, i) => (i ? c.lineTo(x - x0, ys[i] - y0) : c.moveTo(x - x0, ys[i] - y0)));
    c.closePath(); c.fillStyle = "#fff"; c.fill();
    const a = c.getImageData(0, 0, w, h).data;
    this._hpBegin();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[(y * w + x) * 4 + 3] >= 128) E.data[(y0 + y) * E.w + x0 + x] = S.value;
    this._hpRefresh(x0, y0, x1, y1);
    this._hpEnd();
    E.poly = [];
    this.draw();
    return true;
  };
  /**
   * River: the points run from the source to the mouth. Along the line the valley floor is the lowest
   * ground found so far going downstream (so it never runs uphill: where the line crosses a ridge,
   * a gorge is cut through it at the level of the river above), and the bed lies riverDepth steps
   * below that, but stays on land. Around the line the ground is lowered into a U-shaped valley,
   * riverW pixels to each side; nothing is ever raised, and sea and lakes are left alone.
   */
  P._hpCarveRiver = function () {
    const E = this.hp, S = this.hpSettings(), pts = E.poly, w = E.w, h = E.h, d = E.data;
    if (pts.length < 2) return false;
    const sea = this.seaLevel != null ? this.seaLevel : null, W = Math.max(1, S.riverW);
    const val = (x, y) => d[clamp(Math.floor(y), 0, h - 1) * w + clamp(Math.floor(x), 0, w - 1)];
    // points along the line, a little closer than the valley's width
    const step = Math.max(0.5, W / 8), samp = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const ax = pts[i].x * w, ay = pts[i].y * h, bx = pts[i + 1].x * w, by = pts[i + 1].y * h;
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let k = 0; k < n; k++) samp.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
    }
    samp.push([pts[pts.length - 1].x * w, pts[pts.length - 1].y * h]);
    // the bed: lowest ground so far (looking 1 px around the line), never rising downstream
    let floor = Infinity;
    const bed = samp.map(([x, y]) => {
      let lo = 255;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) lo = Math.min(lo, val(x + dx, y + dy));
      floor = Math.min(floor, lo);
      const b = floor - S.riverDepth;
      return sea != null && floor > sea ? Math.max(b, sea + 1) : floor;   // on land the bed stays above the sea
    });
    // nearest point of the line for every pixel near it
    const xs = samp.map((p) => p[0]), ys = samp.map((p) => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - W - 1)), x1 = Math.min(w, Math.ceil(Math.max(...xs) + W + 2));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - W - 1)), y1 = Math.min(h, Math.ceil(Math.max(...ys) + W + 2));
    const bw = x1 - x0, bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return false;
    const dist = new Float32Array(bw * bh).fill(Infinity), bedAt = new Float32Array(bw * bh);
    samp.forEach(([sx, sy], k) => {
      const ax = Math.max(x0, Math.floor(sx - W)), bx = Math.min(x1 - 1, Math.ceil(sx + W));
      const ay = Math.max(y0, Math.floor(sy - W)), by = Math.min(y1 - 1, Math.ceil(sy + W));
      for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
        const dd = Math.hypot(x + 0.5 - sx, y + 0.5 - sy), i = (y - y0) * bw + (x - x0);
        if (dd < dist[i]) { dist[i] = dd; bedAt[i] = bed[k]; }
      }
    });
    this._hpBegin();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y - y0) * bw + (x - x0), t = dist[i] / W;
      if (!(t < 1)) continue;
      const j = y * w + x, cur = d[j], b = bedAt[i];
      if (cur <= b || (sea != null && cur <= sea)) continue;                // already low enough, or water
      const f = t * t * (3 - 2 * t);                                          // U-shaped valley
      let nv = Math.round(b + (cur - b) * f);
      if (sea != null) nv = Math.max(nv, sea + 1);
      d[j] = Math.min(cur, nv);
    }
    this._hpRefresh(x0, y0, x1, y1);
    this._hpEnd();
    E.poly = [];
    this.draw();
    return true;
  };
  P.hpCarveRiver = function () { return this.hp ? this._hpCarveRiver() : false; };

  // a little irregularity for ridges: smooth value noise from a hash
  const hash2 = (x, y) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const noise2 = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;          // 0–1
  };
  /** Points along a line through pts (0–1 coordinates), in height-map pixels, about `step` apart: [[x, y, s]], s = distance from the start. */
  P._hpAlong = function (pts, step) {
    const E = this.hp, out = [];
    let s = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const ax = pts[i].x * E.w, ay = pts[i].y * E.h, bx = pts[i + 1].x * E.w, by = pts[i + 1].y * E.h, L = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.ceil(L / step));
      for (let k = 0; k < n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n, s + L * k / n]);
      s += L;
    }
    const l = pts[pts.length - 1];
    out.push([l.x * E.w, l.y * E.h, s]);
    return out;
  };
  /**
   * Ridge: the points run along the crest. The crest rises to the height set (S.value), a little
   * uneven along its length and tapering at both ends; to the sides the ground falls away steeply
   * (sharper than a brush) over ridgeW pixels, with uneven flanks (spurs and gullies). The ground is
   * only ever raised.
   */
  P._hpRidge = function () {
    const E = this.hp, S = this.hpSettings(), pts = E.poly, w = E.w, h = E.h, d = E.data;
    if (pts.length < 2) return false;
    const W = Math.max(2, S.ridgeW), crest = S.value, samp = this._hpAlong(pts, Math.max(0.5, W / 10));
    const len = samp[samp.length - 1][2] || 1, seed = (pts[0].x * 9973 + pts[0].y * 7919) * 1000;
    const val = (x, y) => d[clamp(Math.floor(y), 0, h - 1) * w + clamp(Math.floor(x), 0, w - 1)];
    // the crest's height along the line: the set height, uneven (±12 %), down to the ground at the ends
    const taper = Math.min(len * 0.25, W * 2.5);
    const top = samp.map(([x, y, s]) => {
      const base = val(x, y);
      const e = Math.min(1, s / Math.max(1e-6, taper), (len - s) / Math.max(1e-6, taper)), te = e * e * (3 - 2 * e);
      const wob = 1 + 0.24 * (noise2(s / (W * 1.5) + seed, 3.7) - 0.5);
      return Math.max(base, base + (crest - base) * te * wob);
    });
    const xs = samp.map((p) => p[0]), ys = samp.map((p) => p[1]), R = W * 1.3;
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - R - 1)), x1 = Math.min(w, Math.ceil(Math.max(...xs) + R + 2));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - R - 1)), y1 = Math.min(h, Math.ceil(Math.max(...ys) + R + 2));
    const bw = x1 - x0, bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return false;
    const target = new Float32Array(bw * bh).fill(-1);
    samp.forEach(([sx, sy], k) => {
      const ax = Math.max(x0, Math.floor(sx - R)), bx = Math.min(x1 - 1, Math.ceil(sx + R));
      const ay = Math.max(y0, Math.floor(sy - R)), by = Math.min(y1 - 1, Math.ceil(sy + R));
      for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
        // uneven flanks: the width wanders with the place (spurs reach out, gullies cut in)
        const We = W * (0.75 + 0.55 * noise2(x / (W * 0.45) + seed, y / (W * 0.45) - seed));
        const t = Math.hypot(x + 0.5 - sx, y + 0.5 - sy) / We;
        if (t >= 1) continue;
        const i = (y - y0) * bw + (x - x0), base = val(x, y);
        const v = base + (top[k] - base) * Math.pow(1 - t, 1.7);         // steep sides, a sharp crest
        if (v > target[i]) target[i] = v;
      }
    });
    this._hpBegin();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const t = target[(y - y0) * bw + (x - x0)];
      if (t < 0) continue;
      const j = y * w + x, nv = clamp(Math.round(t), 0, 255);
      if (nv > d[j]) d[j] = nv;
    }
    this._hpRefresh(x0, y0, x1, y1);
    this._hpEnd();
    E.poly = [];
    this.draw();
    return true;
  };
  /**
   * Coast: the points come in pairs, inland first and then the coast. From each inland point the ground
   * is lowered gently down to sea level at its coast point. Pairs clicked one after another along a
   * coast (not too far apart) are joined: the band between them slopes the same way. A single pair
   * makes a band coastW pixels to each side. The ground is only ever lowered; past the coast and
   * inland of the inland points nothing changes.
   */
  P._hpCoast = function () {
    const E = this.hp, S = this.hpSettings(), w = E.w, h = E.h, d = E.data;
    const ribs = [];
    for (let i = 0; i + 1 < E.poly.length; i += 2) ribs.push({ a: [E.poly[i].x * w, E.poly[i].y * h], b: [E.poly[i + 1].x * w, E.poly[i + 1].y * h] });
    if (!ribs.length) return false;
    const sea = this.seaLevel != null ? this.seaLevel : 120, W = Math.max(2, S.coastW);
    const val = (x, y) => d[clamp(Math.floor(y), 0, h - 1) * w + clamp(Math.floor(x), 0, w - 1)];
    ribs.forEach((r) => { r.ha = Math.max(sea, val(r.a[0], r.a[1])); r.len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]); r.mid = [(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2]; });
    // which neighbouring pairs belong to the same stretch of coast
    const link = [];
    for (let i = 0; i + 1 < ribs.length; i++) {
      const A = ribs[i], B = ribs[i + 1];
      link.push(Math.hypot(A.mid[0] - B.mid[0], A.mid[1] - B.mid[1]) < 3 * Math.max(A.len, B.len, W));
    }
    const ease = (t) => 0.5 + 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));    // 1 inland → 0 at the coast, gentle at both ends
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of ribs) for (const p of [r.a, r.b]) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    x0 = Math.max(0, Math.floor(x0 - W - 2)); y0 = Math.max(0, Math.floor(y0 - W - 2)); x1 = Math.min(w, Math.ceil(x1 + W + 3)); y1 = Math.min(h, Math.ceil(y1 + W + 3));
    const bw = x1 - x0, bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return false;
    const tgt = new Float32Array(bw * bh).fill(Infinity), wt = new Float32Array(bw * bh);
    const put = (x, y, T, f) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      if (xi < x0 || yi < y0 || xi >= x1 || yi >= y1) return;
      const i = (yi - y0) * bw + (xi - x0);
      if (f > wt[i] || (f === wt[i] && T < tgt[i])) { wt[i] = f; tgt[i] = T; }
    };
    // between linked pairs: the four-sided band they span, sloping from the inland side to the coast
    for (let i = 0; i + 1 < ribs.length; i++) {
      if (!link[i]) continue;
      const A = ribs[i], B = ribs[i + 1];
      const nu = Math.max(2, Math.ceil(Math.max(Math.hypot(A.a[0] - B.a[0], A.a[1] - B.a[1]), Math.hypot(A.b[0] - B.b[0], A.b[1] - B.b[1])) * 2));
      const nt = Math.max(2, Math.ceil(Math.max(A.len, B.len) * 2));
      for (let u = 0; u <= nu; u++) {
        const fu = u / nu, ha = A.ha + (B.ha - A.ha) * fu;
        const ax = A.a[0] + (B.a[0] - A.a[0]) * fu, ay = A.a[1] + (B.a[1] - A.a[1]) * fu, bx = A.b[0] + (B.b[0] - A.b[0]) * fu, by = A.b[1] + (B.b[1] - A.b[1]) * fu;
        for (let t = 0; t <= nt; t++) { const ft = t / nt; put(ax + (bx - ax) * ft, ay + (by - ay) * ft, sea + (ha - sea) * ease(ft), 1); }
      }
    }
    // at the ends of a stretch (and around a single pair): a band W to the side, fading out
    ribs.forEach((r, i) => {
      const openBefore = i === 0 || !link[i - 1], openAfter = i === ribs.length - 1 || !link[i];
      if (!openBefore && !openAfter) return;
      const ux = (r.b[0] - r.a[0]) / (r.len || 1), uy = (r.b[1] - r.a[1]) / (r.len || 1), nx = -uy, ny = ux;
      // which side faces away from the neighbour (both sides for a pair on its own)
      const sides = [];
      const nb = !openBefore ? ribs[i - 1] : !openAfter ? ribs[i + 1] : null;
      if (!nb) sides.push(1, -1);
      else { const towards = (nb.mid[0] - r.mid[0]) * nx + (nb.mid[1] - r.mid[1]) * ny; sides.push(towards > 0 ? -1 : 1); }
      const nt = Math.max(2, Math.ceil(r.len * 2)), nl = Math.max(2, Math.ceil(W * 2));
      for (const sd of sides) for (let l = 0; l <= nl; l++) {
        const fl = l / nl, off = fl * W * sd, fade = 1 - fl * fl * (3 - 2 * fl);
        for (let t = 0; t <= nt; t++) { const ft = t / nt; put(r.a[0] + ux * r.len * ft + nx * off, r.a[1] + uy * r.len * ft + ny * off, sea + (r.ha - sea) * ease(ft), fade); }
      }
    });
    this._hpBegin();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y - y0) * bw + (x - x0), f = wt[i];
      if (!(f > 0)) continue;
      const j = y * w + x, cur = d[j];
      const nv = Math.round(cur + (Math.min(cur, tgt[i]) - cur) * f);   // only lowered, softly at the sides
      if (nv < cur) d[j] = Math.max(0, nv);
    }
    this._hpRefresh(x0, y0, x1, y1);
    this._hpEnd();
    E.poly = [];
    this.draw();
    return true;
  };
  /**
   * Plateau: the points go round the outline. Inside it the ground is lifted to the height set (S.value)
   * as a raised block: a short, steep edge (plateauW pixels, uneven so it doesn't follow the clicked
   * line exactly) up from the outline, then an upland at about that height. The relief already there is
   * kept (the area is lifted, not flattened), ground already higher than the plateau (peaks) is left
   * alone, and nothing outside the outline changes; nor do the sea and lakes inside it. Only raises.
   */
  P._hpPlateau = function () {
    const E = this.hp, S = this.hpSettings(), pts = E.poly, w = E.w, h = E.h, d = E.data;
    if (pts.length < 3) return false;
    const W = Math.max(1, S.plateauW || 4), top = S.value, sea = this._hpSea(-1);
    const xs = pts.map((p) => p.x * w), ys = pts.map((p) => p.y * h), n = xs.length;
    const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 1), y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1);
    const x1 = Math.min(w, Math.ceil(Math.max(...xs)) + 2), y1 = Math.min(h, Math.ceil(Math.max(...ys)) + 2);
    const bw = x1 - x0, bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return false;
    // inside the outline
    const cv = document.createElement("canvas"); cv.width = bw; cv.height = bh;
    const c = cv.getContext("2d", { willReadFrequently: true });
    c.beginPath(); xs.forEach((x, i) => (i ? c.lineTo(x - x0, ys[i] - y0) : c.moveTo(x - x0, ys[i] - y0))); c.closePath();
    c.fillStyle = "#fff"; c.fill();
    const a = c.getImageData(0, 0, bw, bh).data;
    // the ground's broad shape (blurred), so lifting keeps the small relief on top
    const R = Math.max(3, Math.round(W * 2)), base = new Float32Array(bw * bh), tmp = new Float32Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) base[y * bw + x] = d[(y0 + y) * w + x0 + x];
    const blur = (src, dst, horiz) => {
      const L = horiz ? bw : bh, M = horiz ? bh : bw;
      for (let m = 0; m < M; m++) {
        let sum = 0; const at = (l) => src[horiz ? m * bw + clamp(l, 0, bw - 1) : clamp(l, 0, bh - 1) * bw + m];
        for (let l = -R; l <= R; l++) sum += at(l);
        for (let l = 0; l < L; l++) { dst[horiz ? m * bw + l : l * bw + m] = sum / (2 * R + 1); sum += at(l + R + 1) - at(l - R); }
      }
    };
    blur(base, tmp, true); const broad = new Float32Array(bw * bh); blur(tmp, broad, false);
    const seed = (pts[0].x * 7919 + pts[0].y * 104729) * 100;
    const segDist = (px, py) => {
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        const ax = xs[i], ay = ys[i], bx = xs[(i + 1) % n], by = ys[(i + 1) % n], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
        const t = clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1), dd = Math.hypot(ax + dx * t - px, ay + dy * t - py);
        if (dd < best) best = dd;
      }
      return best;
    };
    this._hpBegin();
    let changed = 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      if (a[i * 4 + 3] < 128) continue;
      if (sea >= 0 && d[(y0 + y) * w + x0 + x] <= sea) continue;      // the sea (and lakes) stay as they are
      const gx = x0 + x + 0.5, gy = y0 + y + 0.5;
      // how far inside the outline, made uneven (the edge wanders by up to about its own width)
      const dIn = segDist(gx, gy) + W * 1.1 * (noise2(gx / (W * 2.5) + seed, gy / (W * 2.5) - seed) - 0.5);
      const t = clamp(dIn / W, 0, 1), f = t * t * (3 - 2 * t);
      if (f <= 0) continue;
      // the upland's own gentle swell (about ±1 step) where the ground was flat
      const tp = top + 2 * (noise2(gx / 22 - seed, gy / 22 + seed) - 0.5);
      const lift = Math.max(0, tp - broad[i]) * f;
      if (lift <= 0) continue;
      const j = (y0 + y) * w + x0 + x, nv = clamp(Math.round(d[j] + lift), 0, 255);
      if (nv > d[j]) { d[j] = nv; changed++; }
    }
    this._hpRefresh(x0, y0, x1, y1);
    this._hpEnd();
    E.poly = [];
    this.draw();
    return changed;
  };
  P.hpMakePlateau = function () { return this.hp ? this._hpPlateau() : false; };
  P.hpMakeRidge = function () { return this.hp ? this._hpRidge() : false; };
  P.hpMakeCoast = function () { return this.hp ? this._hpCoast() : false; };
  P.hpFillPolygon = function () { return this.hp ? this._hpFillPoly() : false; };
  P.hpClearPolygon = function () { if (this.hp) { this.hp.poly = []; this.draw(); } };
  P.hpPolygonSize = function () { return this.hp ? this.hp.poly.length : 0; };
  P.hpValueAt = function (nx, ny) {
    const E = this.hp;
    if (!E || nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
    return E.data[clamp(Math.floor(ny * E.h), 0, E.h - 1) * E.w + clamp(Math.floor(nx * E.w), 0, E.w - 1)];
  };

  // ── pointer handling (called from FieldMap's own handlers while in height mode) ──
  P._hpToPx = function (sx, sy) { const [nx, ny] = this.toMap(sx, sy); return [nx * this.hp.w, ny * this.hp.h, nx, ny]; };
  /** Returns true when the press was used by a tool (so it doesn't pan the map). */
  P.hpPointerDown = function (sx, sy, button) {
    const E = this.hp, S = this.hpSettings();
    if (!E || S.tool === "pan" || this._spaceDown) return false;
    const [hx, hy, nx, ny] = this._hpToPx(sx, sy);
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return false;
    if (button === 2) return true;
    if (S.tool === "pick") {
      const v = this.hpValueAt(nx, ny);
      if (v != null) { S.value = v; this.opts.onHeightPicked && this.opts.onHeightPicked(v); }
      return true;
    }
    if (S.tool === "polygon" || S.tool === "river" || S.tool === "ridge" || S.tool === "coast" || S.tool === "plateau") { E.poly.push({ x: nx, y: ny }); this.opts.onHeightPoly && this.opts.onHeightPoly(E.poly.length); this.draw(); return true; }
    if (S.tool === "fill") { this._hpBegin(); this._hpFlood(hx, hy); this._hpEnd(); this.draw(); return true; }
    // brush-like tools: a stroke until the button is released
    this._hpBegin();
    this._hpStroke = { x: hx, y: hy };
    this._hpDab(hx, hy);
    this.draw();
    return true;
  };
  P.hpPointerMove = function (sx, sy) {
    const E = this.hp;
    if (!E) return;
    const [hx, hy, nx, ny] = this._hpToPx(sx, sy);
    E.hover = { sx, sy, nx, ny };
    if (this._hpStroke) {
      const S = this.hpSettings(), st = this._hpStroke, step = Math.max(1, S.radius / 3);
      const dist = Math.hypot(hx - st.x, hy - st.y), n = Math.floor(dist / step);
      for (let k = 1; k <= n; k++) this._hpDab(st.x + (hx - st.x) * k / n, st.y + (hy - st.y) * k / n);
      if (n) { st.x = hx; st.y = hy; }
    }
    this.opts.onHeightHover && this.opts.onHeightHover(this.hpValueAt(nx, ny));
    this.draw();
  };
  P.hpPointerUp = function () {
    if (this._hpStroke) { this._hpStroke = null; this._hpEnd(); this.draw(); return true; }
    return false;
  };
  P.hpContextMenu = function () {
    const E = this.hp;
    if (E && E.poly.length) { E.poly.pop(); this.opts.onHeightPoly && this.opts.onHeightPoly(E.poly.length); this.draw(); }
  };

  // ── drawing: the height map over the map, the polygon being drawn, the brush outline ──
  P._hpDraw = function () {
    const E = this.hp;
    if (!E) return;
    const S = this.hpSettings(), ctx = this.ctx, { s, ox, oy } = this.view;
    ctx.save();
    ctx.globalAlpha = S.alpha;
    ctx.imageSmoothingEnabled = s * this.imgW / E.w < 8;   // smooth; single pixels show only when zoomed far in
    ctx.drawImage(E.view, ox, oy, this.imgW * s, this.imgH * s);
    ctx.restore();
    if (E.poly.length && S.tool === "coast") {
      // coast: each pair as an arrow from inland (green) to the coast (blue); joined pairs outlined
      ctx.save();
      const sc = (p) => this.toScreen(p.x, p.y);
      for (let i = 0; i + 1 < E.poly.length; i += 2) {
        const [ax, ay] = sc(E.poly[i]), [bx, by] = sc(E.poly[i + 1]);
        ctx.strokeStyle = "#ffe08a"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        const L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L;
        ctx.fillStyle = "#ffe08a"; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - ux * 10 - uy * 5, by - uy * 10 + ux * 5); ctx.lineTo(bx - ux * 10 + uy * 5, by - uy * 10 - ux * 5); ctx.closePath(); ctx.fill();
        if (i >= 2) {
          const [px, py] = sc(E.poly[i - 2]), [qx, qy] = sc(E.poly[i - 1]);
          ctx.setLineDash([4, 4]); ctx.strokeStyle = "rgba(255,224,138,0.6)"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ax, ay); ctx.moveTo(qx, qy); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
        }
      }
      E.poly.forEach((p, i) => { const [x, y] = sc(p); ctx.fillStyle = i % 2 ? "#5aa9e6" : "#7bd88f"; ctx.strokeStyle = "#18212a"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
      if (E.hover && E.poly.length % 2) { const [ax, ay] = sc(E.poly[E.poly.length - 1]); ctx.setLineDash([6, 4]); ctx.strokeStyle = "#ffe08a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(E.hover.sx, E.hover.sy); ctx.stroke(); }
      ctx.restore();
    } else if (E.poly.length) {
      ctx.save();
      const river = S.tool === "river" || S.tool === "ridge", ridge = S.tool === "ridge";
      ctx.strokeStyle = ridge ? "#e0b07a" : river ? "#7fd0ff" : "#ffe08a"; ctx.lineWidth = 2; ctx.setLineDash(river ? [] : [6, 4]);
      if (river) {   // the valley's (or the ridge's) width
        ctx.save(); ctx.globalAlpha = 0.25; ctx.strokeStyle = ridge ? "#e0b07a" : "#7fd0ff"; ctx.lineWidth = Math.max(2, 2 * (ridge ? S.ridgeW : S.riverW) / E.w * this.imgW * s); ctx.lineCap = ctx.lineJoin = "round";
        ctx.beginPath(); E.poly.forEach((p, i) => { const [x, y] = this.toScreen(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.restore();
      }
      ctx.beginPath();
      E.poly.forEach((p, i) => { const [x, y] = this.toScreen(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      if (E.hover && (S.tool === "polygon" || S.tool === "river" || S.tool === "ridge" || S.tool === "plateau")) { const [x, y] = this.toScreen(E.hover.nx, E.hover.ny); ctx.lineTo(x, y); }
      if (S.tool === "plateau" && E.poly.length >= 2) {
        // the plateau's outline, closed, shaded inside
        ctx.closePath(); ctx.strokeStyle = "#f0c070";
        ctx.save(); ctx.fillStyle = "rgba(240,192,112,0.18)"; ctx.fill(); ctx.restore();
      }
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = ridge ? "#e0b07a" : river ? "#7fd0ff" : "#ffe08a"; ctx.strokeStyle = "#18212a";
      E.poly.forEach((p, i) => { const [x, y] = this.toScreen(p.x, p.y); ctx.beginPath(); ctx.arc(x, y, river && !ridge && i === 0 ? 6.5 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
      ctx.restore();
    }
    if (S.divides && E.div && E.target === "height") {
      // divides between the rivers (yellow; orange-red where too low), and red rings where a river climbs
      const cv = this._hpDivCanvas();
      if (cv) {
        ctx.save();
        ctx.imageSmoothingEnabled = s * this.imgW / E.w < 3;
        ctx.drawImage(cv, ox, oy, this.imgW * s, this.imgH * s);
        ctx.restore();
      }
      if (E.div.up.length) {
        ctx.save();
        const cw = this.canvas.width / (window.devicePixelRatio || 1), ch = this.canvas.height / (window.devicePixelRatio || 1), px = this.imgW * s / E.w;
        ctx.strokeStyle = "rgba(230,30,40,0.95)"; ctx.lineWidth = 2; ctx.beginPath();
        for (let k = 0; k < E.div.up.length; k++) {
          const i = E.div.up[k], x = ox + ((i % E.w) + 0.5) * px, y = oy + (Math.floor(i / E.w) + 0.5) * px;
          if (x < -10 || y < -10 || x > cw + 10 || y > ch + 10) continue;
          const r = Math.max(5, px / 2 + 3); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
        }
        ctx.stroke(); ctx.restore();
      }
    }
    if (S.outliers && E.out && E.out.length) {
      // each odd pixel as a blue ring (a dot when there are very many), so it shows at any zoom
      ctx.save();
      const many = E.out.length > 4000, cw = this.canvas.width / (window.devicePixelRatio || 1), ch = this.canvas.height / (window.devicePixelRatio || 1);
      const px = this.imgW * s / E.w, half = Math.max(0.5, px / 2);
      ctx.fillStyle = "rgba(30,110,255,0.95)"; ctx.strokeStyle = "rgba(30,110,255,0.95)"; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k < E.out.length; k++) {
        const i = E.out[k], x = ox + ((i % E.w) + 0.5) * px, y = oy + (Math.floor(i / E.w) + 0.5) * px;
        if (x < -10 || y < -10 || x > cw + 10 || y > ch + 10) continue;
        if (many) ctx.rect(x - Math.max(1.5, half), y - Math.max(1.5, half), Math.max(3, px), Math.max(3, px));
        else { ctx.moveTo(x + Math.max(6, half + 4), y); ctx.arc(x, y, Math.max(6, half + 4), 0, Math.PI * 2); }
      }
      many ? ctx.fill() : ctx.stroke();
      ctx.restore();
    }
    if (E.hover && ["brush", "raise", "lower", "smooth", "erode"].includes(S.tool) && !this._spaceDown) {
      const R = S.radius / E.w * this.imgW * s;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(E.hover.sx, E.hover.sy, Math.max(2, R), 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(E.hover.sx, E.hover.sy, Math.max(2, R) + 1.5, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  };

  // ── suggestions: what was painted, as a patch; a patch put into the painter ──
  /** The painted changes against the layer the painter opened with: { x, y, w, h, iw, ih, changed, blob } or null. */
  P.hpDiffPatch = async function () {
    const E = this.hp;
    if (!E || !E.orig) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, n = 0;
    for (let y = 0; y < E.h; y++) {
      const r = y * E.w;
      for (let x = 0; x < E.w; x++) if (E.data[r + x] !== E.orig[r + x]) {
        n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (!n) return null;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, vals = new Uint8Array(w * h), mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = (y0 + y) * E.w + x0 + x, i = y * w + x;
      vals[i] = E.data[k]; mask[i] = E.data[k] !== E.orig[k] ? 1 : 0;
    }
    if (E.target !== "height") for (let i = 0; i < vals.length; i++) if (vals[i] > 100) vals[i] = 100;   // forest, ice: 0–100
    return { x: x0, y: y0, w, h, iw: E.w, ih: E.h, changed: n, blob: await encodeGreyAlphaPNG(vals, mask, w, h) };
  };
  /** Puts a suggestion's patch into the painter (one undoable step; the painter's starting point stays). */
  P.hpApplyPatch = function (x0, y0, p) {
    const E = this.hp;
    if (!E) return;
    this._hpBegin();
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const i = y * p.w + x, gx = x0 + x, gy = y0 + y;
      if (p.mask[i] && gx >= 0 && gy >= 0 && gx < E.w && gy < E.h) E.data[gy * E.w + gx] = p.vals[i];
    }
    this._hpRefresh(x0, y0, x0 + p.w, y0 + p.h);
    this._hpEnd();
    this.draw();
  };

  /**
   * Suggestions on the map: outlines of their areas, and the chosen one drawn over the height map.
   * list: [{ id, x, y, w, h, status }] in the height map's pixels; sel: { id, x, y, w, h, vals, mask, old } or null
   * (old: the heights an accepted suggestion replaced, used as "before" instead of today's map);
   * mode: "after" (the suggested heights), "before" (today's) or "diff" (red higher, blue lower).
   */
  P.setSuggestions = function (list, sel, mode) {
    this.sg = { list: list || [], sel: sel || null, mode: mode || "after", canvas: null };
    this.draw();
  };
  P._sgCanvas = function () {
    const G = this.sg, sel = G.sel, src = this.heightSource;
    if (!sel || !src) return null;
    if (G.canvas && G.canvasMode === G.mode && G.canvasSel === sel) return G.canvas;
    const hw = src.naturalWidth || src.width, hh = src.naturalHeight || src.height;
    // today's heights under the patch
    const cv0 = document.createElement("canvas"); cv0.width = sel.w; cv0.height = sel.h;
    const c0 = cv0.getContext("2d", { willReadFrequently: true });
    c0.drawImage(src, -sel.x, -sel.y, hw, hh);
    const base = c0.getImageData(0, 0, sel.w, sel.h).data;
    const cv = document.createElement("canvas"); cv.width = sel.w; cv.height = sel.h;
    const c = cv.getContext("2d"), img = c.createImageData(sel.w, sel.h), out = new Uint32Array(img.data.buffer);
    const lut = colourLut(this.seaLevel != null ? this.seaLevel : 0);
    const pack = (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
    for (let i = 0; i < sel.w * sel.h; i++) {
      const was = sel.old ? (sel.mask[i] ? sel.old[i] : base[i * 4]) : base[i * 4], now = sel.mask[i] ? sel.vals[i] : was;
      if (G.mode === "before") out[i] = lut[was];
      else if (G.mode === "after") out[i] = lut[now];
      else {
        const d = now - was;
        if (!sel.mask[i] || d === 0) out[i] = sel.mask[i] ? pack(235, 235, 235, 150) : 0;
        else { const t = Math.min(1, Math.abs(d) / 20); out[i] = d > 0 ? pack(255, Math.round(200 - 170 * t), Math.round(190 - 170 * t), 235) : pack(Math.round(190 - 170 * t), Math.round(200 - 120 * t), 255, 235); }
      }
    }
    c.putImageData(img, 0, 0);
    G.canvas = cv; G.canvasMode = G.mode; G.canvasSel = sel;
    return cv;
  };
  P._sgDraw = function () {
    const G = this.sg, src = this.heightSource;
    if (!G || !src || (!G.list.length && !G.sel)) return;
    const hw = src.naturalWidth || src.width, hh = src.naturalHeight || src.height;
    const ctx = this.ctx, { s, ox, oy } = this.view, kx = this.imgW / hw * s, ky = this.imgH / hh * s;
    ctx.save();
    if (G.sel) {
      const cv = this._sgCanvas();
      if (cv) {
        ctx.imageSmoothingEnabled = kx < 6;
        ctx.globalAlpha = G.mode === "diff" ? 1 : 0.9;
        ctx.drawImage(cv, ox + G.sel.x * kx, oy + G.sel.y * ky, G.sel.w * kx, G.sel.h * ky);
        ctx.globalAlpha = 1;
      }
    }
    const colour = { open: "#ffd166", accepted: "#7bd88f", rejected: "#ef6f6c", undone: "#9aa8b4", withdrawn: "#9aa8b4", replaced: "#9aa8b4" };
    G.list.forEach((r) => {
      const selected = G.sel && G.sel.id === r.id;
      const x = ox + r.x * kx, y = oy + r.y * ky, w = Math.max(3, r.w * kx), h = Math.max(3, r.h * ky);
      ctx.lineWidth = selected ? 2.5 : 1.5;
      ctx.setLineDash(r.status === "open" ? [5, 3] : []);
      ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
      ctx.strokeStyle = colour[r.status] || "#fff"; ctx.strokeRect(x, y, w, h);
      if (selected || s * this.imgW > 2500) {
        ctx.setLineDash([]);
        ctx.font = "600 11px system-ui, sans-serif";
        const t = "#" + r.id, tw = ctx.measureText(t).width + 6;
        ctx.fillStyle = "rgba(24,33,42,0.85)"; ctx.fillRect(x, y - 15, tw, 14);
        ctx.fillStyle = colour[r.status] || "#fff"; ctx.fillText(t, x + 3, y - 4);
      }
    });
    ctx.restore();
  };
  /** The suggestion whose outline is under a screen point (smallest first), or null. */
  P.suggestionAt = function (sx, sy) {
    const G = this.sg, src = this.heightSource;
    if (!G || !src || !G.list.length) return null;
    const hw = src.naturalWidth || src.width, hh = src.naturalHeight || src.height;
    const [nx, ny] = this.toMap(sx, sy), hx = nx * hw, hy = ny * hh;
    const hits = G.list.filter((r) => hx >= r.x - 2 && hx <= r.x + r.w + 2 && hy >= r.y - 2 && hy <= r.y + r.h + 2);
    hits.sort((a, b) => a.w * a.h - b.w * b.h);
    return hits[0] || null;
  };
  /** Moves the view so that a rectangle of the height map (its pixels) fills most of the map area. */
  P.showHeightRect = function (x, y, w, h) {
    const src = this.heightSource;
    if (!src || !this.cssW) return;
    const hw = src.naturalWidth || src.width, hh = src.naturalHeight || src.height;
    const mw = (w + 40) / hw * this.imgW, mh = (h + 40) / hh * this.imgH;
    const maxS = this.tiles ? Math.max(8, this.tiles.fullW / this.imgW * 3) : 8;
    const s = clamp(Math.min(this.cssW / mw, this.cssH / mh) * 0.7, Math.min(this.cssW / this.imgW, this.cssH / this.imgH), maxS);
    const cx = (x + w / 2) / hw * this.imgW, cy = (y + h / 2) / hh * this.imgH;
    this.view = { s, ox: this.cssW / 2 - cx * s, oy: this.cssH / 2 - cy * s };
    this.userMoved = true;
    this.draw();
  };

  /** The height map as an 8-bit greyscale PNG. */
  P.hpPNG = function () {
    const E = this.hp;
    if (!E) return Promise.resolve(null);
    if (E.target === "height") return encodeGreyPNG(E.data, E.w, E.h);
    const d = E.data.slice();
    for (let i = 0; i < d.length; i++) if (d[i] > 100) d[i] = 100;
    return encodeGreyPNG(d, E.w, E.h);
  };
  /** The ice map in colours for the "Is" layer: transparent without ice, white with a blue tint where it lies. */
  P.iceColours = function () {
    const src = this.iceSource;
    if (!src) return null;
    const V = this._iview;
    if (V && V.src === src && !V.stale) return V.canvas;
    const w = Math.min(src.naturalWidth || src.width, MAX_W), h = Math.max(1, Math.round(w * this.imgH / this.imgW));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const c = cv.getContext("2d", { willReadFrequently: true });
    c.drawImage(src, 0, 0, w, h);
    const img = c.getImageData(0, 0, w, h), px = img.data;
    let any = false;
    for (let i = 0; i < w * h; i++) {
      const f = Math.min(px[i * 4], 100) / 100;
      px[i * 4] = 236; px[i * 4 + 1] = 246; px[i * 4 + 2] = 255; px[i * 4 + 3] = Math.round(230 * Math.sqrt(f));
      if (f > 0) any = true;
    }
    c.putImageData(img, 0, 0);
    this._iview = { src, canvas: cv, any };
    return cv;
  };
  /** The marshland map in colours for the "Sumpmark" layer: transparent where dry, murky olive where marshy. */
  P.marshColours = function () {
    const src = this.marshSource;
    if (!src) return null;
    const V = this._mview;
    if (V && V.src === src && !V.stale) return V.canvas;
    const w = Math.min(src.naturalWidth || src.width, MAX_W), h = Math.max(1, Math.round(w * this.imgH / this.imgW));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const c = cv.getContext("2d", { willReadFrequently: true });
    c.drawImage(src, 0, 0, w, h);
    const img = c.getImageData(0, 0, w, h), px = img.data;
    for (let i = 0; i < w * h; i++) {
      const f = Math.min(px[i * 4], 100) / 100;
      px[i * 4] = 84; px[i * 4 + 1] = 112; px[i * 4 + 2] = 78; px[i * 4 + 3] = Math.round(225 * Math.sqrt(f));
    }
    c.putImageData(img, 0, 0);
    this._mview = { src, canvas: cv };
    return cv;
  };
  /** The forest map in colours for the "Skog" layer: transparent without trees, dark green where dense. */
  P.forestColours = function () {
    const src = this.forestSource;
    if (!src) return null;
    const V = this._fview;
    if (V && V.src === src && !V.stale) return V.canvas;
    const w = Math.min(src.naturalWidth || src.width, MAX_W), h = Math.max(1, Math.round(w * this.imgH / this.imgW));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const c = cv.getContext("2d", { willReadFrequently: true });
    c.drawImage(src, 0, 0, w, h);
    const img = c.getImageData(0, 0, w, h), px = img.data;
    let any = false;
    for (let i = 0; i < w * h; i++) {
      const f = Math.min(px[i * 4], 100) / 100;
      px[i * 4] = 18; px[i * 4 + 1] = 70; px[i * 4 + 2] = 28; px[i * 4 + 3] = Math.round(235 * Math.sqrt(f));
      if (f > 0) any = true;
    }
    c.putImageData(img, 0, 0);
    this._fview = { src, canvas: cv, any };
    return cv;
  };
})();
