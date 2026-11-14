// Eon Weather – the page, part 6 of 7: walking in 3D, the height map shown, the aspect symbols.
// The app-*.js files are loaded in this order by index.html and share one scope (they are one program in parts:
// app-core.js, app-maps.js, app-painter.js, app-suggestions.js, app-layers.js, app-view.js, app-start.js).
"use strict";
  // ── Walking in 3D (walk3d.js, loaded only when used) ──────────────────
  let walk3d = null, walkPick = false, walkRegionTimer = 0;
  /** "Gå i 3D": the next click on the map picks where to start. */
  function setWalkPick(on) {
    walkPick = on;
    $("walk3dBtn").textContent = T(on ? "walk3dPick" : "walk3d");
    $("walk3dBtn").classList.toggle("active", on);
    $("stage").classList.toggle("pick", on);
  }
  /**
   * For a map of one's own that borrows the default map's zoom images: the detailed terrain was made
   * for the default height map, so where this map's heights differ from it (painted, or a different
   * height map altogether) the detail is left out, fading back in over a few map pixels around the
   * changes. Returns { w, h, f } (f = how much detail to keep, 0–1, on a grid over the map) or null.
   */
  let defHeightImg = null;
  async function ownHeightMask() {
    const src = fieldMap.heightSource;
    if (!S.map || S.map.isDefault || !fieldMap.tiles || !src) return null;
    const def = (S.maps || []).find((m) => m.isDefault && m.hasHeight);
    if (!def) return null;
    try {
      if (!defHeightImg || defHeightImg.id !== def.id) {
        const img = new Image();
        img.src = `/weather/api/maps/${def.id}/height`;
        await img.decode();
        defHeightImg = { id: def.id, img };
      }
    } catch (e) { return null; }
    const w = Math.min(4096, src.naturalWidth || src.width), h = Math.max(1, Math.round(w * fieldMap.imgH / fieldMap.imgW));
    const grey = (im) => {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
      x.drawImage(im, 0, 0, w, h);
      return x.getImageData(0, 0, w, h).data;
    };
    const a = grey(src), b = grey(defHeightImg.img), n = w * h;
    let near = new Float32Array(n), any = false;
    for (let i = 0; i < n; i++) if (Math.abs(a[i * 4] - b[i * 4]) >= 2) { near[i] = 1; any = true; }
    if (!any) return null;
    // spread the changes out (box blur twice each way), so the detail fades in around them
    const r = Math.max(1, Math.round(6 * w / fieldMap.imgW)), tmp = new Float32Array(n);
    const blur = (from, to, horiz) => {
      const len = horiz ? w : h, lines = horiz ? h : w, st = horiz ? 1 : w, ls = horiz ? w : 1;
      for (let l = 0; l < lines; l++) {
        const o = l * ls;
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += from[o + Math.min(len - 1, Math.max(0, k)) * st];
        for (let k = 0; k < len; k++) {
          to[o + k * st] = sum / (2 * r + 1);
          sum += from[o + Math.min(len - 1, k + r + 1) * st] - from[o + Math.max(0, k - r) * st];
        }
      }
    };
    for (let pass = 0; pass < 2; pass++) { blur(near, tmp, true); blur(tmp, near, false); }
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = Math.max(0, 1 - near[i] * 4);
    return { w, h, f };
  }
  async function openWalk3d(nx, ny) {
    if (walk3d || !fieldMap.heightSource || !fieldMap.img) return;
    $("walk3dBtn").disabled = true;
    try {
      if (SG.open) openSgPanel(false);
      const mod = await import("./walk3d.js?v=121");
      fieldMap.setPaused(true);                                  // the flat map rests underneath
      $("stage").classList.add("in3d");
      walk3d = mod.open({
        mapImage: fieldMap.img, imgW: fieldMap.imgW, imgH: fieldMap.imgH, heightSource: fieldMap.heightSource,
        seaLevel: fieldMap.seaLevel, metersPerStep: fieldMap.metersPerStep,
        kmPerPixel: Number(S.map && S.map.settings && S.map.settings.kmPerPixel) || 0,
        wrapP: fieldMap.wrapP, tiles: fieldMap.tiles,
        noDetail: sgChangedRects(),
        // the drawn rivers, for the 3D view's river beds (see walk3d.js), and whether that's on
        rivers: (() => { const fl = fieldMap.riverFlows(); return (fieldMap.rivers || []).map((r) => ({ id: r.id, size: r.size, points: r.points, joins: r.joins, events: (fl[r.id] || {}).events || [] })); })(),
        riversOn: S.w3Rivers !== false,
        onRiversToggle: (on) => { S.w3Rivers = on; saveState(); },                              // changed in the app since the detailed terrain was made
        detailMask: await ownHeightMask(),                       // own map: where its height map differs from the default
        start: { nx: Math.min(1, Math.max(0, nx)), ny: Math.min(1, Math.max(0, ny)) },   // where you clicked
        regionAt: (x, y) => fieldMap._regionAt(x, y), T,
        container: $("stage"),                                   // in the map area: the rest of the app stays
        weatherAt: (x, y) => fieldMap.weatherCell(x, y),
        // snow and ice: the regions' monthly mean temperatures (at sea level) for the date shown
        climateAt: climateOn(S.month, S.day),
        iceAt: (x, y) => fieldMap.layerAt("ice", x, y),           // painted ice (Redigera → Is)
        climateKey: () => S.month + "-" + S.day,
        sunAt: (x, y) => fieldMap.sunVector(x, y),
        time: () => fieldMap.T,
        clock: (x) => clockText(S.hourF + fieldMap.spotOffset(x)),
        nightOn: () => S.layers.includes("night"),
        onMove: (x, y, region) => {
          // the side panel follows the region you are in (after a moment, not at every border)
          clearTimeout(walkRegionTimer);
          if (!region || region === S.region || !S.world.regions.some((r) => r.name === region)) return;
          walkRegionTimer = setTimeout(() => { if (!walk3d) return; S.region = region; $("region").value = region; dateChanged(); }, 800);
        },
        onClose: () => { walk3d = null; clearTimeout(walkRegionTimer); fieldMap.setPaused(false); $("stage").classList.remove("in3d"); },
      });
    } catch (e) {
      console.error(e);
      walk3d = null; fieldMap.setPaused(false); $("stage").classList.remove("in3d");
      await ask({ title: T("walk3d"), text: String(e && e.message || e), buttons: [] });
    } finally { $("walk3dBtn").disabled = false; }
  }

  // ── Height map ────────────────────────────────────────────────────────
  async function loadHeight() {
    const map = S.map;
    $("heightLayerBox").hidden = !(map && map.hasHeight);   // the height layer, for everyone
    $("walk3dBtn").hidden = !(map && map.hasHeight);       // walking in 3D needs a height map
    const st = (map && map.settings) || {};
    fieldMap.setHeightScale(Number.isFinite(st.seaLevel) ? st.seaLevel : null, st.metersPerStep || null);
    $("hpSea").value = Number.isFinite(st.seaLevel) ? st.seaLevel : "";
    $("hpMps").value = st.metersPerStep || "";
    updateHpValueLabel();
    const block = st.blockHeight || (st.metersPerStep ? 30 : 200);
    $("blockHeight").value = block; $("blockOut").textContent = block;
    fieldMap.setBlockHeight(block);
    renderHeightTools();
    $("heightPick").hidden = !(map && map.hasHeight);
    $("heightPick").value = S.heightPick === "calc" ? "calc" : "base";
    S.heightBase = null;
    if (!map || !map.hasHeight) { fieldMap.setHeightImage(null); return; }
    const img = new Image();
    img.src = `/weather/api/maps/${map.id}/height?v=${Date.now()}`;
    try { await img.decode(); } catch (e) { fieldMap.setHeightImage(null); return; }
    if (S.map === map) { S.heightBase = img; fieldMap.setHeightImage(img); applyHeightPick(); }
    return img;
  }
  // ── Base or calculated height map ─────────────────────────────────────
  // The calculated one is the base height map with the mountain ranges raised, the divides between
  // rivers lifted and the rivers' valleys cut (terrain.js). It is made here, never saved, and made
  // again a moment after rivers or ranges change. While the height map is being painted, the base one
  // is shown (that is what is painted and saved).
  let derivedTimer = 0, derivedKey = null;
  function heightPainting() { return S.editing && $("editMode").value === "height"; }
  function applyHeightPick() {
    if (!S.map || !S.map.hasHeight || !S.heightBase) return;
    const calc = S.heightPick === "calc" && !heightPainting() && !SG.suggesting && fieldMap.seaLevel != null;
    if (!calc) { if (fieldMap.heightSource !== S.heightBase && !fieldMap.hpHas()) { fieldMap.setHeightImage(S.heightBase); derivedKey = null; } return; }
    const key = JSON.stringify([S.map.id, fieldMap.getRanges ? fieldMap.getRanges() : [], fieldMap.getRivers ? fieldMap.getRivers() : []]);
    if (key === derivedKey && fieldMap.heightSource && fieldMap.heightSource._derived) return;
    setStatus(T("heightPickWorking"));
    setTimeout(() => {
      const src = S.heightBase, w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const c = cv.getContext("2d", { willReadFrequently: true });
      c.drawImage(src, 0, 0);
      const img = c.getImageData(0, 0, w, h), px = img.data, base = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) base[i] = px[i * 4];
      const t0 = performance.now();
      const D = window.EonTerrain.derive(base, w, h, { sea: fieldMap.seaLevel, mps: fieldMap.metersPerStep || 100,
        rivers: fieldMap.getRivers ? fieldMap.getRivers() : [], ranges: fieldMap.getRanges ? fieldMap.getRanges() : [], imgW: fieldMap.imgW, imgH: fieldMap.imgH });
      for (let i = 0; i < w * h; i++) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = D[i]; px[i * 4 + 3] = 255; }
      c.putImageData(img, 0, 0);
      cv._derived = true;
      if (S.heightPick !== "calc" || heightPainting()) { setStatus(""); return; }
      derivedKey = key;
      fieldMap.setHeightImage(cv);
      let n = 0;
      for (let i = 0; i < w * h; i++) if (D[i] !== base[i]) n++;
      setStatus(T("heightPickDone", n.toLocaleString(S.lang === "EN" ? "en-GB" : "sv-SE"), Math.round(performance.now() - t0)));
    }, 30);
  }
  /** After rivers or ranges change: make the calculated height map again (a moment later). */
  function scheduleDerived() {
    if (S.heightPick !== "calc") return;
    clearTimeout(derivedTimer);
    derivedTimer = setTimeout(applyHeightPick, 1500);
  }
  function renderHeightTools() {
    const has = !!(S.map && S.map.hasHeight);
    $("heightUpload").textContent = has ? T("heightReplace") : T("heightUpload");
    $("heightRemove").hidden = $("heightShowBox").hidden = $("blockBox").hidden = !has;
  }
  async function uploadHeight(file) {
    if (!file || !S.map) return;
    try {
      const m = await api("PUT", `/maps/${S.map.id}/height`, file, file.type || true);
      Object.assign(S.map, m);
      const img = await loadHeight();
      if (img) {
        const a = img.naturalWidth / img.naturalHeight, b = S.map.width / S.map.height;
        setStatus(Math.abs(a / b - 1) > 0.02 ? T("heightAspect", a.toFixed(2), b.toFixed(2)) : "");
      }
      $("heightShow").checked = true; fieldMap.setShowHeight(true);
    } catch (e) { await ask({ title: T("heightUpload"), text: e.message, buttons: [] }); }
  }

  // ── Aspect symbols ────────────────────────────────────────────────────
  async function loadMapSymbols() {
    const map = S.map;
    if (!map) { fieldMap.setSymbols({}); return; }
    let list = {};
    try { list = await api("GET", `/maps/${map.id}/symbols`); } catch (e) { /* no symbols */ }
    const loaded = {};
    await Promise.all(Object.entries(list).map(async ([aspect, ver]) => {
      const img = new Image();
      img.src = `/weather/api/maps/${map.id}/symbols/${encodeURIComponent(aspect)}?v=${ver}`;
      try { await img.decode(); loaded[aspect] = img; } catch (e) { /* skip broken image */ }
    }));
    if (S.map === map) { fieldMap.setSymbols(loaded); if (S.dayData) renderInfluxBar(S.dayData.aspects || []); }
  }

  let symbolTarget = null;
  async function openSymbols() {
    $("symbolError").textContent = "";
    try { S.mySymbols = await api("GET", "/symbols"); } catch (e) { S.mySymbols = {}; }
    renderSymbolGrid();
    if (!$("symbolsDialog").open) $("symbolsDialog").showModal();
  }
  function renderSymbolGrid() {
    const grid = $("symbolGrid");
    grid.innerHTML = "";
    const cell = (name, label, isForce) => {
      const div = document.createElement("div");
      div.className = "sym" + (isForce ? " force" : "");
      const pic = document.createElement("div"); pic.className = "pic";
      const ver = S.mySymbols[name];
      if (ver) { const im = document.createElement("img"); im.alt = ""; im.src = `/weather/api/symbols/${encodeURIComponent(name)}?v=${ver}`; pic.append(im); }
      else pic.textContent = "—";
      const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = label;
      const acts = document.createElement("span"); acts.className = "acts";
      const up = document.createElement("button"); up.type = "button"; up.textContent = ver ? T("replace") : T("upload");
      up.onclick = () => { symbolTarget = name; $("symbolFile").click(); };
      acts.append(up);
      if (ver) {
        const rm = document.createElement("button"); rm.type = "button"; rm.textContent = T("remove");
        rm.onclick = async () => {
          try { S.mySymbols = await api("DELETE", `/symbols/${encodeURIComponent(name)}`); renderSymbolGrid(); loadMapSymbols(); }
          catch (e) { $("symbolError").textContent = e.message; }
        };
        acts.append(rm);
      }
      div.append(pic, nm, acts);
      return div;
    };
    Object.entries(S.world.forces).forEach(([force, aspects]) => {
      const row = document.createElement("section"); row.className = "force-row";
      const h = document.createElement("h3");
      h.innerHTML = `<i style="background:${FieldMap.FORCE_COLOURS[force] || "#a98bf2"}"></i>`;
      h.append(force);
      const cells = document.createElement("div"); cells.className = "force-cells";
      aspects.forEach((a) => cells.append(cell(a, a, false)));
      cells.append(cell(force, `${T("forceSymbol")}: ${force}`, true));
      row.append(h, cells);
      grid.append(row);
    });
  }
  async function uploadSymbol(file) {
    if (!file || !symbolTarget) return;
    $("symbolError").textContent = "";
    try {
      const type = file.type || (file.name.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "application/octet-stream");
      S.mySymbols = await api("PUT", `/symbols/${encodeURIComponent(symbolTarget)}`, file, type);
      renderSymbolGrid();
      loadMapSymbols();
    } catch (e) { $("symbolError").textContent = `${symbolTarget}: ${e.message}`; }
  }

  /** The coming three days at a spot, under a city's info: lowest–highest temperature, the strongest wind, the rain. */
  function cityForecast(box, at) {
    const w = fieldMap._weightsAt(at.nx, at.ny * fieldMap.imgH / fieldMap.imgW);
    if (!w) return;
    const wrap = document.createElement("div"); wrap.className = "city-forecast";
    const cap = document.createElement("b"); cap.textContent = T("ctForecast"); wrap.append(cap);
    box.append(wrap);
    const now = curSerial();
    Promise.all([1, 2, 3].map((d) => fetchField(now + d).catch(() => null))).then((fields) => {
      if (popupAt !== at || !wrap.isConnected) return;
      fields.forEach((F, n) => {
        if (!F || !F.regions) return;
        let lo = 99, hi = -99, wind = 0, rain = 0;
        for (let hr = 0; hr < 24; hr++) {
          let t = 0, ws = 0, rr = 0, sw = 0;
          for (let k = 0; k < w.idx.length; k++) {
            const r = F.regions[w.idx[k]];
            if (w.idx[k] < 0 || !r || !r.hourly) continue;
            t += w.wt[k] * r.hourly.temperature[hr]; ws += w.wt[k] * (r.hourly.wind[hr] || 0); rr += w.wt[k] * (r.hourly.rain[hr] || 0); sw += w.wt[k];
          }
          if (!sw) continue;
          t /= sw; lo = Math.min(lo, t); hi = Math.max(hi, t); wind = Math.max(wind, ws / sw); rain += rr / sw / 24;
        }
        if (hi < lo) return;
        const d = dateOfSerial(now + n + 1), p = document.createElement("div");
        p.textContent = T("ctForecastDay", d.day, d.month, fmtT(lo), fmtT(hi), wind.toFixed(0), rain.toFixed(1));
        wrap.append(p);
      });
    });
  }
  function closePopup() { popupAt = null; $("popup").hidden = true; fieldMap.setHighlight(null); }
  function refreshPopup() {
    if (!popupAt) return;
    const s = fieldMap.sample(popupAt.nx, popupAt.ny);
    const box = $("popup");
    if (!s || s.coverage < 0.05) { closePopup(); return; }
    fieldMap.setHighlight({ x: popupAt.nx, y: popupAt.ny });
    const dir = s.region.direction;
    box.innerHTML = "";
    const close = document.createElement("button"); close.className = "close"; close.textContent = "×"; close.setAttribute("aria-label", "Stäng");
    close.onclick = closePopup;
    const h = document.createElement("h4"); h.textContent = s.region.name;
    const dl = document.createElement("dl");
    const row = (k, v) => { const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; dl.append(dt, dd); };
    // a city (or a bridge, a ford) under the click: its name on top, and for a city the weather of the coming days below
    const place = S.layers.includes("city") && fieldMap.cityAt ? fieldMap.cityAt(popupAt.nx, popupAt.ny, 12) : null;
    if (place) {
      const kind = place.kind || "city";
      h.textContent = place.name || T(kind === "city" ? "ctUnnamed" : "ctKind_" + kind);
      if (kind === "city") row(T("ctPopulation"), (place.population || 0).toLocaleString(S.lang === "EN" ? "en" : "sv") + (place.harbour ? " · " + T("ctHarbour") : ""));
      else row(T("ctKind"), T("ctKind_" + kind) + (kind === "ford" && place.floodFrom && place.floodTo ? ` (${T("ctFlood").toLowerCase()} ${place.floodFrom}–${place.floodTo})` : ""));
      row(T("ctRegion"), s.region.name);
    }
    row(T("temperature"), fmtT(s.temperature));
    row(T("wind"), `${s.wind.toFixed(1)} (${T("windFrom")} ${dir})`);
    if (s.shelter >= 0.05) row("", T("sheltered", Math.round(s.shelter * 100)));
    if (s.rainShadow >= 0.1) row("", T("rainShadow", Math.round(s.rainShadow * 100)));
    else if (s.lift >= 0.1) row("", T("windward"));
    if (s.elevation != null) row(T("elevation"), heightText(s.elevation));
    if (S.layers.includes("nation") && fieldMap.nationAt) {
      const nt = fieldMap.nationAt(popupAt.nx, popupAt.ny);
      if (nt) row(T("ntAt"), (nt.nation.name || T("ntUnnamed")) + (nt.sub ? ` – ${nt.sub.name || T("ntSubUnnamed")}` : ""));
    }
    if (S.layers.includes("river") && fieldMap.riverAt) {
      const rv = fieldMap.riverAt(popupAt.nx, popupAt.ny);
      if (rv) row(T("rvAt"), T("rvAtText", rv.river.name || T("rvUnnamed"), rv.flow));
    }
    row(T("rain"), s.rain.toFixed(1));
    row(T("cloud"), `${Math.round(s.cloud)} %`);
    if (S.layers.includes("night")) {
      const sun = fieldMap.sunAt(popupAt.nx, popupAt.ny);
      const hm = (h) => { const m = Math.round(h * 60) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
      const off = fieldMap.spotOffset(popupAt.nx);            // sunrise and sunset in the spot's local time
      row(T("sun"), sun.polar ? T(sun.polar === "day" ? "midnightSun" : "polarNight")
        : T(sun.alt > 0 ? "sunUp" : sun.alt > -6 ? "sunTwilight" : "sunDown", hm((sun.rise + off + 24) % 24), hm((sun.set + off + 24) % 24)));
      row(T("localClock"), clockText(S.hourF + off));
    }
    if (s.fog >= 0.15) row("", T(s.fog >= 0.75 ? "fogThick" : "fogLight"));
    box.append(close, h, dl);
    if (place && (place.kind || "city") === "city") cityForecast(box, popupAt);
    const events = s.region.events.filter((e) => e && e.trim() && !isMagic(e));
    if (events.length) { const p = document.createElement("p"); p.textContent = events.join(", "); p.style.margin = "0 0 .4rem"; box.append(p); }
    s.storms.forEach((st) => {
      const p = document.createElement("p"); p.className = "storm";
      p.style.color = st.colour;
      const left = Math.max(0, (st.end - fieldMap.T) * 24);
      let t = `${st.name} — ${T("strength")} ${Math.round(st.strengthNow)} ${T("ofPeak", st.peak)} (${st.growing ? T("growing") : T("fading")}), `
        + `${T("motion_" + st.motion)}${st.motion !== "still" && st.speedKmh ? ` (~${Math.round(st.speedKmh)} km/h)` : ""}, ${T("hoursLeft", Math.round(left))}, ${st.region}`;
      if (st.dominant && st.dominant.length) t += ` · ${T("dominant")}: ${st.dominant.join(", ")}`;
      const boost = Math.max(0, ...st.pulses.map((p) => p.influxBoost || 0));
      if (boost) t += ` (${T("influxBoost", boost)})`;
      p.textContent = t;
      box.append(p);
    });
    if (S.layers.includes("zone")) {
      const inZones = [...new Set(fieldMap.zonesAt(popupAt.nx, popupAt.ny))];
      if (inZones.length) {
        const p = document.createElement("p"); p.className = "ley"; p.style.margin = "0 0 .4rem";
        p.append(T("zoneAt") + ": ");
        inZones.forEach((a, i) => {
          const c = FieldMap.leyColour(a), sp = document.createElement("span");
          sp.style.color = c === "rainbow" ? "#e98bd8" : a === "Skototropi" ? "#b9b9c8" : c;
          sp.textContent = a;
          p.append(sp, i + 1 < inZones.length ? ", " : "");
        });
        box.append(p);
      }
    }
    if (S.layers.includes("ley")) {
      const near = fieldMap.leylinesNear(popupAt.nx, popupAt.ny, 60);
      if (near.length) {
        const p = document.createElement("p"); p.className = "ley"; p.style.margin = "0 0 .4rem";
        p.append(T("leylines") + ": ");
        near.forEach((l, i) => {
          const c = FieldMap.leyColour(l.aspect), sp = document.createElement("span");
          sp.style.color = c === "rainbow" ? "#e98bd8" : l.aspect === "Skototropi" ? "#b9b9c8" : c;
          sp.textContent = l.aspect + (l.km != null ? ` (${l.km} km)` : "");
          p.append(sp, i + 1 < near.length ? ", " : "");
        });
        box.append(p);
      }
    }
    const go = document.createElement("button"); go.textContent = T("showRegion");
    go.onclick = () => { S.region = s.region.name; closePopup(); dateChanged({ forceMonth: true }); };
    box.append(go);
    box.hidden = false;
    const st = $("stage").getBoundingClientRect();
    const bw = box.offsetWidth, bh = box.offsetHeight;
    box.style.left = Math.min(Math.max(8, popupAt.sx + 14), st.width - bw - 8) + "px";
    box.style.top = Math.min(Math.max(8, popupAt.sy + 14), st.height - bh - 8) + "px";
  }

  function renderLegend() {
    const L = $("mapLegend");
    L.innerHTML = "";
    const grad = (stops, lo, hi) => {
      const parts = stops.map(([v, c]) => `rgb(${c.join(",")}) ${((v - lo) / (hi - lo) * 100).toFixed(0)}%`);
      return `linear-gradient(90deg, ${parts.join(",")})`;
    };
    const add = (html) => { const s = document.createElement("span"); s.className = "ramp"; s.innerHTML = html; L.append(s); };
    if (S.layers.includes("temp")) add(`${T("legendTemp")} −35° <i style="background:${grad(FieldMap.TEMP_STOPS, -35, 42)}"></i> 42°`);
    if (S.layers.includes("rain")) add(`${T("legendRain")} <i style="background:${grad(FieldMap.RAIN_STOPS, 0, 6)}"></i>`);
    if (S.layers.includes("zone")) {
      const hiddenZ = new Set(S.leyHidden || []);
      [...new Set(fieldMap.getZones().map((z) => z.aspect))].filter((a) => !hiddenZ.has(a)).forEach((a) => {
        const c = FieldMap.leyColour(a), s = document.createElement("span"); s.className = "force";
        const bg = c === "rainbow" ? "linear-gradient(90deg,#f55,#fd4,#5d5,#5cf,#a6f)" : c;
        s.innerHTML = `<i class="zone" style="background:${bg};color:${c === "rainbow" ? "#e98bd8" : c}"></i>`;
        s.append(T("zoneAt") + ": " + a);
        L.append(s);
      });
    }
    if (S.layers.includes("ley")) {
      const hiddenSet = new Set(S.leyHidden || []);
      const used = [...new Set(fieldMap.getLeylines().map((l) => l.aspect))].filter((a) => !hiddenSet.has(a));
      used.forEach((a) => {
        const c = FieldMap.leyColour(a), s = document.createElement("span"); s.className = "force";
        const bg = c === "rainbow" ? "linear-gradient(90deg,#f55,#fd4,#5d5,#5cf,#a6f)" : c;
        s.innerHTML = `<i class="ley" style="background:${bg};box-shadow:0 0 6px ${c === "rainbow" ? "#e98bd8" : a === "Skototropi" ? "#ddd" : c}"></i>`;
        s.append(a);
        L.append(s);
      });
    }
    if (S.layers.includes("magic") && S.field) {
      const forces = [...new Set(fieldMap._stormPositions().map((s) => s.force || "?"))];
      forces.forEach((f) => {
        const s = document.createElement("span"); s.className = "force";
        const c = FieldMap.FORCE_COLOURS[f] || "#a98bf2";
        s.innerHTML = `<i style="background:${c};box-shadow:0 0 6px ${c}"></i>`;
        s.append(f === "?" ? T("storms") : f);
        L.append(s);
      });
      if (S.field.influx) {
        const s = document.createElement("span"); s.style.color = "var(--magic)";
        s.textContent = `${S.lang === "EN" ? "Influx" : "Inflöde"}: ${S.field.influx}`;
        L.append(s);
      }
    }
  }

  /** The effect toggles appear next to their layer when the layer is switched on. */
  function syncFxToggles() {
    $("rainFxBox").hidden = !S.layers.includes("rain");
    const magicShapes = S.layers.includes("ley") || S.layers.includes("zone");
    $("leyFilterBox").hidden = !magicShapes;
    if (!magicShapes) $("leyFilterBox").open = false;
    $("cloudFxBox").hidden = !S.layers.includes("cloud");
    fieldMap.setFx("rain", S.rainFx);
    fieldMap.setFx("cloud", S.cloudFx);
  }
