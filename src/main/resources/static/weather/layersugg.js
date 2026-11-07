// Eon Weather – suggestions for the map's other layers, drawn over the map (the height map's own
// suggestions are drawn by heightpaint.js). A list layer's suggestion (rivers, roads, mountain ranges,
// nations) is a change by id: what it removes or changes is drawn red and dashed ("before"), what it adds
// or changes to green ("after"). A painted layer's (forest, ice) is a patch, drawn like the layer itself
// ("after"), not at all ("before": the layer as it is), or green where it adds and red where it takes away.
(function () {
  "use strict";
  const FM = window.FieldMap;
  if (!FM) return;
  const P = FM.prototype;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const RED = "#ef4f4f", GREEN = "#3fd16a";

  /** sel: { layer, diff } or { layer, x, y, w, h, iw, ih, vals, mask } (or null); mode: "before", "after" or "diff". */
  P.setLayerSuggestion = function (sel, mode) {
    const old = this.lsg;
    if (!sel && !old) return;
    this.lsg = sel ? { sel, mode: mode || "after", canvas: old && old.sel === sel ? old.canvas : null, canvasMode: old && old.sel === sel ? old.canvasMode : null } : null;
    this.draw();
  };

  /** Moves the view so that a box of the map (0–1) fills most of the map area. */
  P.showNormRect = function (x0, y0, x1, y1) {
    if (!this.cssW) return;
    const pad = 0.004;
    const mw = Math.max(x1 - x0 + 2 * pad, 0.01) * this.imgW, mh = Math.max(y1 - y0 + 2 * pad, 0.01) * this.imgH;
    const maxS = this.tiles ? Math.max(8, this.tiles.fullW / this.imgW * 3) : 8;
    const s = clamp(Math.min(this.cssW / mw, this.cssH / mh) * 0.75, Math.min(this.cssW / this.imgW, this.cssH / this.imgH), maxS);
    const cx = (x0 + x1) / 2 * this.imgW, cy = (y0 + y1) / 2 * this.imgH;
    this.view = { s, ox: this.cssW / 2 - cx * s, oy: this.cssH / 2 - cy * s };
    this.userMoved = true;
    this.draw();
  };

  // ── list layers ──
  P._lsLine = function (pts) {
    const ctx = this.ctx;
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = this.toScreen(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  };
  /** One item of a layer: its lines (and a lake's or a nation's shape), in a colour. */
  P._lsItem = function (layer, it, colour, dashed) {
    const ctx = this.ctx, z = clamp(Math.sqrt(this.view.s * this.imgW / 1500), 0.7, 2.4);
    const stroke = (w) => {
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(15,20,25,0.75)"; ctx.lineWidth = (w + 3) * z; ctx.stroke();
      ctx.setLineDash(dashed ? [7 * z, 5 * z] : []);
      ctx.strokeStyle = colour; ctx.lineWidth = w * z; ctx.stroke();
      ctx.setLineDash([]);
    };
    if (layer === "rivers" && it.lake) {
      const [x, y] = this.toScreen(it.x, it.y);
      ctx.beginPath(); ctx.arc(x, y, 7 * z, 0, Math.PI * 2);
      ctx.fillStyle = colour + "55"; ctx.fill(); stroke(2.5);
    } else if (layer === "nations") {
      const parts = [...(it.parts || []), ...(it.subs || []).flatMap((s) => s.parts || [])];
      parts.forEach((pt, k) => {
        if (!pt || pt.length < 2) return;
        this._lsLine(pt); ctx.closePath();
        if (k < (it.parts || []).length) { ctx.fillStyle = colour + "30"; ctx.fill(); }
        stroke(k < (it.parts || []).length ? 2.5 : 1.5);
      });
    } else if (it.points && it.points.length >= 2) {
      this._lsLine(it.points);
      stroke(layer === "ranges" ? 4 : layer === "rivers" ? 2 + (it.size || 1) * 0.4 : 3);
    }
    // the name, at the item's middle
    if (it.name && this.view.s * this.imgW > 1800) {
      const p = it.lake ? it : it.points ? it.points[Math.floor(it.points.length / 2)] : it.parts && it.parts[0] && it.parts[0][0];
      if (p) {
        const [x, y] = this.toScreen(p.x, p.y);
        ctx.font = "600 11px system-ui, sans-serif";
        const w = ctx.measureText(it.name).width + 6;
        ctx.fillStyle = "rgba(24,33,42,0.85)"; ctx.fillRect(x + 6, y - 16, w, 14);
        ctx.fillStyle = colour; ctx.fillText(it.name, x + 9, y - 5);
      }
    }
  };

  // ── painted layers ──
  P._lsCanvas = function () {
    const L = this.lsg, sel = L.sel;
    if (L.canvas && L.canvasMode === L.mode) return L.canvas;
    const src = sel.layer === "ice" ? this.iceSource : this.forestSource;
    // the layer as it is, under the patch (at the size the suggestion was painted on)
    let base = null;
    if (src) {
      const c0 = document.createElement("canvas"); c0.width = sel.w; c0.height = sel.h;
      const g0 = c0.getContext("2d", { willReadFrequently: true });
      g0.imageSmoothingEnabled = false;
      g0.drawImage(src, -sel.x, -sel.y, sel.iw, sel.ih);
      base = g0.getImageData(0, 0, sel.w, sel.h).data;
    }
    const cv = document.createElement("canvas"); cv.width = sel.w; cv.height = sel.h;
    const c = cv.getContext("2d"), img = c.createImageData(sel.w, sel.h), out = new Uint32Array(img.data.buffer);
    const pack = (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
    const ice = sel.layer === "ice";
    const look = (v) => (v <= 0 ? 0 : ice ? pack(232, 244, 255, Math.round(60 + 1.7 * v)) : pack(34, 120, 48, Math.round(50 + 1.7 * v)));
    for (let i = 0; i < sel.w * sel.h; i++) {
      if (!sel.mask[i]) { out[i] = 0; continue; }
      const was = base ? Math.min(100, base[i * 4]) : 0, now = Math.min(100, sel.vals[i]);
      if (L.mode === "after") out[i] = now > 0 ? look(now) : pack(120, 80, 40, 90);       // bare ground: a brown tint
      else if (L.mode === "diff") {
        const d = now - was;
        if (d === 0) out[i] = pack(235, 235, 235, 110);
        else { const t = Math.min(1, Math.abs(d) / 60); out[i] = d > 0 ? pack(47, 191, 79, Math.round(120 + 120 * t)) : pack(239, 79, 79, Math.round(120 + 120 * t)); }
      } else out[i] = 0;
    }
    c.putImageData(img, 0, 0);
    L.canvas = cv; L.canvasMode = L.mode;
    return cv;
  };

  P._lsDraw = function () {
    const L = this.lsg;
    if (!L || !L.sel) return;
    const sel = L.sel, ctx = this.ctx;
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (sel.diff) {
      const d = sel.diff, before = L.mode !== "after", after = L.mode !== "before";
      if (before) {
        (d.removed || []).forEach((it) => this._lsItem(sel.layer, it, RED, true));
        (d.changed || []).forEach((c) => this._lsItem(sel.layer, c.before, RED, true));
      }
      if (after) {
        (d.added || []).forEach((it) => this._lsItem(sel.layer, it, GREEN, false));
        (d.changed || []).forEach((c) => this._lsItem(sel.layer, c.after, GREEN, false));
      }
    } else if (sel.mask) {
      const [x0, y0] = this.toScreen(sel.x / sel.iw, sel.y / sel.ih), [x1, y1] = this.toScreen((sel.x + sel.w) / sel.iw, (sel.y + sel.h) / sel.ih);
      if (L.mode !== "before") {
        ctx.imageSmoothingEnabled = (x1 - x0) / sel.w < 6;
        ctx.drawImage(this._lsCanvas(), x0, y0, x1 - x0, y1 - y0);
      }
      ctx.setLineDash([5, 3]); ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.strokeRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
      ctx.strokeStyle = "#ffd166"; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
    ctx.restore();
  };
})();
