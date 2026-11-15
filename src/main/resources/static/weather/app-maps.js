// Eon Weather – the page, part 2 of 7: the maps (the FieldMap on the page, choosing and showing a map) and the region editor.
// The app-*.js files are loaded in this order by index.html and share one scope (they are one program in parts:
// app-core.js, app-maps.js, app-painter.js, app-suggestions.js, app-layers.js, app-view.js, app-start.js).
"use strict";
  // ── Maps ──────────────────────────────────────────────────────────────
  let popupAt = null;
  const fieldMap = new FieldMap($("stage"), $("mapCanvas"), {
    fxCanvas: $("fxCanvas"),
    sunRegion: () => S.region,
    treeClimate: () => (S.world && S.world.regions ? climateOn(1, 15) : null),      // the tree line follows the warmest month
    onPick: (nx, ny, sx, sy) => {
      if (walkPick) { setWalkPick(false); openWalk3d(nx, ny); return; }
      if (SG.open) { const hit = fieldMap.suggestionAt(sx, sy); if (hit) { selectSuggestion(hit.id); return; } }
      popupAt = { nx, ny, sx, sy }; refreshPopup();
    },
    onAnchorsChanged: () => { S.anchorsDirty = true; $("saveAnchors").textContent = T("savePositions") + " •"; afterAnchorsChanged(); },
    onLeylinesChanged: () => { S.anchorsDirty = true; S.leyDirty = true; $("saveAnchors").textContent = T("savePositions") + " •"; renderLegend(); renderLeyFilter(); },
    onLeySelected: (aspect) => { $("leyAspect").value = aspect; },
    onDivides: (r) => { $("hpDivCount").textContent = r.rivers ? T("hpDivCount", r.low, r.ok + r.low, r.up) : T("hpDivNone"); $("hpDivLift").disabled = !r.low; },
    onRoadSteep: (n, r) => { const el = $("hpRoadSteepCount"); if (el) el.textContent = n ? T("hpRoadSteepCount", n, r) : T("hpRoadSteepNone"); },
    onOutliers: (n) => { $("hpOutCount").textContent = T("hpOutCount", n.toLocaleString(S.lang === "EN" ? "en-GB" : "sv-SE")); },
    onHeightChanged: (t) => {
      if (t === "forest" || t === "ice" || t === "marsh") { markForestDirty(true); return; }
      markHeightDirty(true);
      if (fieldMap.heightSource && !fieldMap.heightSource._derived) S.heightBase = fieldMap.heightSource;   // the painted base
      sugDrain = null;                                    // suggested rivers: worked out again from the new heights
    },
    onHeightPicked: (v) => setHpValue(v),
    onHeightHover: (v) => {
      $("hpHover").textContent = v == null ? "\u00a0" : forestMode() ? T("hpHere", T(LK[layerKind()].dens, Math.min(v, 100)))
        : T("hpHere", heightText(v) + (fieldMap.metersPerStep ? ` (${v})` : ""));
    },
    onHeightPoly: () => syncHpToolUi(),
    onZonesChanged: () => { S.anchorsDirty = true; S.zoneDirty = true; $("saveAnchors").textContent = T("savePositions") + " •"; renderLegend(); renderLeyFilter(); },
    onLeyHiddenChanged: (hidden) => { S.leyHidden = hidden; renderLeyFilter(); renderLegend(); saveState(); },
    onRiverSelected: () => renderRiverBar(),
    onRangesChanged: () => { scheduleDerived(); S.rangesDirty = true; $("rgSave").textContent = T("rgSave") + " •"; renderRangeBar(); scheduleRangeSave(); },
    onRangeSelected: () => renderRangeBar(),
    onRoadsChanged: () => { S.roadsDirty = true; $("wySave").textContent = T("wySave") + " •"; renderRoadBar(); scheduleRoadSave(); if (window.Travel) Travel.roadsChanged(); },
    onRoadSelected: () => renderRoadBar(),
    onCitiesChanged: () => { S.citiesDirty = true; $("ctSave").textContent = T("ctSave") + " •"; renderCityBar(); scheduleCitySave(); if (window.Travel) Travel.roadsChanged(); },
    onCitySelected: () => renderCityBar(),
    onNationsChanged: () => { S.nationsDirty = true; $("ntSave").textContent = T("ntSave") + " •"; renderNationBar(); scheduleNationSave(); },
    onNationSelected: () => renderNationBar(),
    onRiversChanged: () => { scheduleDerived(); if (S.rvSuggest) updateSuggestions(); S.riversDirty = true; $("rvSave").textContent = T("rvSave") + " •"; renderRiverBar(); scheduleRiverSave(); },
  });
  window.eonMap = fieldMap; // handy for debugging in the browser console
  fieldMap.onTilesLoaded = () => renderMapViews();

  async function loadMaps() {
    try { S.maps = await api("GET", "/maps"); } catch (e) { S.maps = []; }
    if (!S.maps.some((m) => m.id === S.mapId)) {
      const first = S.maps.find((m) => m.isDefault) || S.maps[0];
      S.mapId = first ? first.id : null;
    }
    renderMapSelect();
    await showMap();
  }
  function renderMapSelect() {
    const sel = $("mapSelect");
    sel.innerHTML = "";
    S.maps.forEach((m) => {
      const who = m.mine ? "" : m.isDefault ? ` (${T("defaultMap")})` : ` (${T("byOwner", m.owner)})`;
      sel.add(new Option((m.removedAt ? "🗑 " : "") + m.name + who + (m.removedAt ? ` (${T("mapRemovedTag")})` : ""), m.id));
    });
    if (S.user) sel.add(new Option("+ " + T("newMap"), "new"));
    sel.value = S.mapId ?? (S.user ? "new" : "");
    sel.disabled = !S.maps.length && !S.user;
    $("uploadMap").hidden = !S.user || S.maps.length > 0;
  }
  async function showMap() {
    if (SG.suggesting) endSuggestMode();
    SG.data = null; SG.selId = null; SG.sel = null; SG.ldata = null; SG.lselId = null; SG.lsel = null;
    setEditing(false);
    if (fieldMap.hpClose) fieldMap.hpClose();
    S.heightDirty = false; S.forestDirty = false; S.iceDirty = false; S.marshDirty = false;
    closePopup();
    S.map = S.maps.find((m) => m.id === S.mapId) || null;
    $("editMap").hidden = !(S.map && !S.map.removedAt && (S.map.mine || (S.map.isDefault && S.admin)));
    document.querySelector(".zoom").hidden = !S.map;
    $("mapLegend").hidden = !S.map;
    $("mapSelect").closest(".field").hidden = $("mapSelect").options.length === 0;
    if (!S.map) {
      fieldMap.setImage(null);
      emptyState();
      return;
    }
    const img = new Image();
    img.src = `/weather/api/maps/${S.map.id}/image`;
    try { await img.decode(); } catch (e) { emptyState(e.message); return; }
    fieldMap.setImage(img, S.map.width, S.map.height);
    fieldMap.setTileLayers(S.mapLayers || null);
    fieldMap.setLayerOrder(layerOrderFor(S.map));
    fieldMap.setTiles(S.map.settings && typeof S.map.settings.tiles === "string" ? S.map.settings.tiles : null);
    renderTileChoices();
    renderMapViews();
    const reach = S.map.settings && S.map.settings.reach;
    $("reach").value = reach || 0.2;
    fieldMap.setReach(Number($("reach").value));
    $("mapPublic").checked = !!S.map.isPublic;
    const kpp = Number(S.map.settings && S.map.settings.kmPerPixel) || 0;
    $("kmPerPixel").value = kpp || "";
    fieldMap.setScale(kpp);
    const wrap = Number(S.map.settings && S.map.settings.wrapWidth) || 0;
    $("wrapWidth").value = wrap || "";
    fieldMap.setWrap(wrap);
    const clockX = Number(S.map.settings && S.map.settings.clockX);
    fieldMap.setClockX(Number.isFinite(clockX) && clockX > 0 ? clockX : null);   // the prime meridian (default: Calnia)
    const anchors = await api("GET", `/maps/${S.map.id}/anchors`);
    fieldMap.setAnchors(anchors);
    renderAnchorRegions();
    const known = new Set(S.world.regions.map((r) => r.name));
    const gone = [...new Set(anchors.filter((a) => !known.has(a.region)).map((a) => a.region))];
    if (gone.length && S.map.mine) setStatus(T("goneRegions", gone.join(", ")));
    let leylines = [];
    try { leylines = await api("GET", `/maps/${S.map.id}/leylines`); } catch (e) { /* none */ }
    fieldMap.setLeylines(leylines);
    let zones = [];
    try { zones = await api("GET", `/maps/${S.map.id}/zones`); } catch (e) { /* none */ }
    fieldMap.setZones(zones);
    S.zoneDirty = false;
    renderLeyFilter();
    loadMapSymbols();
    loadRivers();
    loadNations();
    loadRanges();
    loadHeight().then(() => loadSuggestions());
    loadForest();
    loadIce();
    loadMarsh();
    loadRoads();
    loadCities();
    loadTrips();
    S.anchorsDirty = false; S.leyDirty = false;
    renderLegend();
    pushFieldsToMap();
    emptyState();
  }
  function emptyState(err) {
    const box = $("empty");
    box.innerHTML = "";
    let title = null, text = null, action = null;
    if (err) { title = T("noMapTitle"); text = err; }
    else if (S.map && S.map.removedAt) {
      // a removed map: only its owner sees it, until it is deleted for good
      const hours = Math.max(0, (S.map.purgeAt - Date.now()) / 3600000);
      title = T("mapRemovedTitle");
      text = T("mapRemovedText", hours >= 1 ? Math.floor(hours) + " h" : Math.max(1, Math.round(hours * 60)) + " min");
      action = [T("restoreMap"), restoreMap];
    } else if (!S.map) {
      title = T("noMapTitle");
      text = S.user ? T("noMapLoggedIn") : T("noMapLoggedOut");
      action = S.user ? [T("uploadMap"), () => $("mapFile").click()] : [T("login"), () => openAuth("login")];
    } else if (!fieldMap.hasAnchors() && !S.editing) {
      text = T("noAnchors") + (S.map.mine ? " " + T("noAnchorsOwner") : "");
      if (S.map.mine) action = [T("editMap"), () => setEditing(true)];
    }
    box.hidden = !text;
    if (!text) return;
    if (title) { const h = document.createElement("h3"); h.textContent = title; box.append(h); }
    const p = document.createElement("p"); p.textContent = text; box.append(p);
    if (action) { const b = document.createElement("button"); b.className = "primary"; b.textContent = action[0]; b.onclick = action[1]; box.append(b); }
    box.style.background = S.map ? "rgba(24,33,42,0.55)" : "";
    box.style.pointerEvents = S.map ? "none" : "";
    box.querySelectorAll("button").forEach((b) => (b.style.pointerEvents = "auto"));
  }
  /**
   * The region picker in edit mode. Placed regions are marked with ✓; with "only unplaced"
   * ticked, the list shows just the regions that have no point on this map yet.
   */
  function renderAnchorRegions(preferred) {
    const ar = $("anchorRegion");
    if (!S.world) return;
    const placed = new Set(fieldMap.getAnchors().map((a) => a.region));
    const unplaced = S.world.regions.filter((r) => !placed.has(r.name));
    const only = $("unplacedOnly").checked;
    const keep = preferred || ar.value;
    ar.innerHTML = "";
    (only ? unplaced : S.world.regions).forEach((r) =>
      ar.add(new Option((placed.has(r.name) ? "✓ " : "○ ") + r.name, r.name)));
    if (!ar.options.length) ar.add(new Option(T("allPlaced"), ""));
    if ([...ar.options].some((o) => o.value === keep)) ar.value = keep;
    $("unplacedLabel").textContent = T("unplacedOnly", unplaced.length);
    fieldMap.setSelectedRegion(ar.value || null);
  }
  /** After a point is placed: with the filter on, move straight to the next unplaced region. */
  function afterAnchorsChanged() {
    const ar = $("anchorRegion"), current = ar.value;
    if ($("unplacedOnly").checked && current && fieldMap.getAnchors().some((a) => a.region === current)) {
      const placed = new Set(fieldMap.getAnchors().map((a) => a.region));
      const names = S.world.regions.map((r) => r.name);
      const after = names.slice(names.indexOf(current) + 1).concat(names.slice(0, names.indexOf(current)));
      renderAnchorRegions(after.find((n) => !placed.has(n)));
    } else renderAnchorRegions();
  }

  function setEditing(on) {
    S.editing = on;
    $("exportMap").hidden = !S.admin;
    $("heightBlank").hidden = !(S.map && S.map.mine);
    // on a map you don't own (the default map, as an admin) only the rivers can be edited here
    const ownerOnly = !!(S.map && !S.map.mine);
    // while suggesting a change, only the layer it is for
    // modes open to someone who doesn't own the map (they suggest changes); the owner, and the admins on the standard map, also place cities and paint marshland
    const ownerModes = ["river", "nation", "range", "forest", "ice", "road", ...(S.map && (S.map.mine || (S.map.isDefault && S.admin)) ? ["city", "marsh"] : [])];
    [...$("editMode").options].forEach((o) => { o.disabled = SG.suggesting ? o.value !== SG.layer : ownerOnly && !ownerModes.includes(o.value); });
    if (on && ownerOnly && !SG.suggesting && !ownerModes.includes($("editMode").value)) $("editMode").value = "river";
    if (!on && fieldMap.ntDrawing) fieldMap.ntFinish();
    if (!on && fieldMap.rvCancel) { fieldMap.rvDraft = null; fieldMap.rvSelect && fieldMap.rvSelect(null); }
    if (on) renderAnchorRegions(S.region);
    $("editBar").hidden = !on;
    $("editMap").textContent = on ? T("doneEditing") : T("editMap");
    fieldMap.setEditing(on, $("anchorRegion").value || S.region);
    applyEditMode();
    if (on) closePopup();
    emptyState();
  }
  // ── Region editor: make a new region or change one (admins only) ──────
  const RD = { mode: "new", original: null, events: [], source: null };
  const blankRegion = () => ({ name: "", description: "", temperature: Array(12).fill(10), precipitation: Array(12).fill(0),
    wind: Array(12).fill(0), temperature_drop: 2, drop_speed: 1, prevailing_wind: "", prevailing_chance: 50,
    cloud_cover: 0, contained_radius: 0, events: [] });
  function rdMonthRows() {
    document.querySelectorAll("#regionForm tr[data-row]").forEach((tr) => {
      while (tr.cells.length > 1) tr.deleteCell(1);
      for (let i = 0; i < 12; i++) {
        const td = tr.insertCell(), inp = document.createElement("input");
        inp.type = "number"; inp.step = "1"; inp.dataset.month = i;
        inp.setAttribute("aria-label", `${tr.cells[0].textContent} ${i + 1}`);
        td.append(inp);
      }
    });
  }
  function rdFill(d) {
    $("rdName").value = d.name || "";
    $("rdDesc").value = d.description || "";
    for (const key of ["temperature", "precipitation", "wind"]) {
      const vals = d[key] || [];
      document.querySelectorAll(`#regionForm tr[data-row="${key}"] input`).forEach((inp, i) => { inp.value = vals[i] != null ? vals[i] : 0; });
    }
    $("rdDrop").value = d.temperature_drop != null ? d.temperature_drop : 2;
    $("rdDropSpeed").value = d.drop_speed != null ? d.drop_speed : 1;
    $("rdWindDir").value = d.prevailing_wind || "";
    $("rdWindPct").value = d.prevailing_chance != null ? d.prevailing_chance : 50;
    $("rdCloud").value = d.cloud_cover || 0;
    $("rdRadius").value = d.contained_radius ? d.contained_radius : "";
    $("rdBaseHeight").value = d.base_heat_height ? d.base_heat_height : "";
    RD.events = (d.events || []).map((e) => ({ ...e }));
    rdRenderEvents();
  }
  const isMagicName = (n) => /magistorm|högmagisk|alstra/i.test(n || "");
  function rdRenderEvents() {
    const list = $("rdEventList");
    list.innerHTML = "";
    RD.events.forEach((ev, idx) => {
      const box = document.createElement("div"); box.className = "rd-event" + (isMagicName(ev.name) ? " magic" : "");
      const field = (label, key, opts = {}) => {
        const lab = document.createElement("label"); lab.className = "field slim" + (opts.cls ? " " + opts.cls : "");
        const sp = document.createElement("span"); sp.textContent = label;
        const inp = document.createElement("input");
        inp.type = opts.text ? "text" : "number";
        if (!opts.text) { inp.className = "num-small"; inp.step = opts.step || "1"; if (opts.min != null) inp.min = opts.min; if (opts.max != null) inp.max = opts.max; }
        inp.value = ev[key] != null ? ev[key] : "";
        if (opts.placeholder) inp.placeholder = opts.placeholder;
        inp.oninput = () => {
          ev[key] = opts.text ? inp.value : (inp.value === "" ? null : Number(inp.value));
          if (key === "name") box.classList.toggle("magic", isMagicName(inp.value));
        };
        lab.append(sp, inp);
        return lab;
      };
      const main = document.createElement("div"); main.className = "rd-ev-main";
      main.append(field(T("rdEvName"), "name", { text: true, cls: "rd-ev-name" }));
      if (ev.occurs == null) ev.occurs = 1;
      if (ev.days == null) ev.days = 7;
      const freq = document.createElement("span"); freq.className = "field slim";
      const occ = field("", "occurs", { min: 1, max: 1000 }), days = field(T("rdEvOn"), "days", { min: 1, max: 100000 });
      const unit = document.createElement("span"); unit.textContent = T("rdEvDays");
      freq.append(occ, days, unit);
      main.append(freq,
        field(T("rdEvTemp"), "bonus_temp", { min: -60, max: 60, placeholder: "0" }),
        field(T("rdEvRain"), "bonus_rain", { min: -20, max: 20, placeholder: "0" }),
        field(T("rdEvWind"), "bonus_wind", { min: -20, max: 20, placeholder: "0" }));
      const rm = document.createElement("button"); rm.type = "button"; rm.className = "icon"; rm.textContent = "✕"; rm.title = T("rdEvRemove");
      rm.onclick = () => { RD.events.splice(idx, 1); rdRenderEvents(); };
      main.append(rm);
      const det = document.createElement("details"), sum = document.createElement("summary");
      sum.textContent = T("rdEvMore");
      const more = document.createElement("div"); more.className = "rd-ev-more";
      const h = (t) => { const e = document.createElement("h4"); e.textContent = t; return e; };
      more.append(field(T("rdEvMonths"), "start_month", { min: 0, max: 12, placeholder: "—" }), field(T("rdEvTo"), "end_month", { min: 0, max: 12, placeholder: "—" }),
        h(T("rdEvLimits")),
        field(T("rdEvMinWind"), "min_wind", { placeholder: "—" }), field(T("rdEvMaxWind"), "max_wind", { placeholder: "—" }),
        field(T("rdEvMinTemp"), "min_temp", { placeholder: "—" }), field(T("rdEvMaxTemp"), "max_temp", { placeholder: "—" }),
        h(T("rdEvStorm")),
        field(T("rdEvFollow"), "follow_wind", { min: 0, max: 100, placeholder: "—" }), field(T("rdEvWander"), "wander", { min: 0, max: 100, placeholder: "—" }),
        field(T("rdEvGrowth"), "growth", { min: 0, max: 100, placeholder: "—" }),
        field(T("rdEvDur") + " min", "duration_min", { step: "any", placeholder: "—" }), field("max", "duration_max", { step: "any", placeholder: "—" }),
        field(T("rdEvSpeed") + " min", "speed_min", { step: "any", placeholder: "—" }), field("max", "speed_max", { step: "any", placeholder: "—" }));
      const stay = document.createElement("label"); stay.className = "check";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!ev.stay_in_region;
      cb.onchange = () => { ev.stay_in_region = cb.checked; };
      const st = document.createElement("span"); st.textContent = T("rdEvStay");
      stay.append(cb, st); more.append(stay);
      // variants: one per line
      const vl = document.createElement("label"); vl.className = "field stack"; vl.style.flexBasis = "100%";
      const vs = document.createElement("span"); vs.textContent = T("rdEvVariants");
      const ta = document.createElement("textarea"); ta.rows = 2; ta.value = (ev.list || []).join("\n"); ta.style.width = "100%";
      ta.oninput = () => { const v = ta.value.split("\n").map((x) => x.trim()).filter(Boolean); if (v.length) ev.list = v; else delete ev.list; };
      vl.append(vs, ta); more.append(vl);
      det.append(sum, more);
      // open "More" when the event uses any of its settings
      det.open = ["start_month", "end_month", "min_wind", "max_wind", "min_temp", "max_temp", "follow_wind", "wander", "growth",
        "duration_min", "duration_max", "speed_min", "speed_max", "list"].some((k) => ev[k] != null && ev[k] !== "") || !!ev.stay_in_region;
      box.append(main, det);
      list.append(box);
    });
  }
  function rdCollect() {
    const months = (key) => [...document.querySelectorAll(`#regionForm tr[data-row="${key}"] input`)].map((i) => (i.value === "" ? 0 : Number(i.value)));
    const events = RD.events.filter((e) => (e.name || "").trim()).map((e) => {
      const out = {};
      for (const [k, v] of Object.entries(e)) if (v !== null && v !== "" && v !== undefined) out[k] = typeof v === "string" ? v.trim() : v;
      return out;
    });
    return {
      name: $("rdName").value.trim(), description: $("rdDesc").value.trim(),
      temperature: months("temperature"), precipitation: months("precipitation"), wind: months("wind"),
      temperature_drop: $("rdDrop").value, drop_speed: $("rdDropSpeed").value,
      prevailing_wind: $("rdWindDir").value, prevailing_chance: $("rdWindPct").value,
      cloud_cover: $("rdCloud").value, contained_radius: $("rdRadius").value, base_heat_height: $("rdBaseHeight").value, events,
    };
  }
  async function openRegionEditor(mode) {
    RD.mode = mode; RD.original = null; RD.source = null;
    $("rdError").textContent = "";
    rdMonthRows();
    const from = $("rdFrom");
    from.innerHTML = "";
    from.add(new Option(T("rdFromNone"), ""));
    S.world.regions.forEach((r) => from.add(new Option(r.name, r.name)));
    $("rdFromBox").hidden = mode !== "new";
    if (mode === "edit") {
      let src;
      try { src = await api("GET", "/regions/source" + q({ name: S.region })); } catch (e) { setStatus(e.message); return; }
      RD.original = src.name; RD.source = src;
      $("regionTitle").textContent = T("rdEditTitle", src.name);
      rdFill(src.data);
      $("rdDelete").hidden = !src.custom;
      $("rdDownload").hidden = false;
    } else {
      $("regionTitle").textContent = T("rdNewTitle");
      rdFill(blankRegion());
      $("rdDelete").hidden = true;
      $("rdDownload").hidden = true;
    }
    if (!$("regionDialog").open) $("regionDialog").showModal();
    $("rdName").focus();
  }
  async function reloadWorld(selectName) {
    S.world = await api("GET", "/world");
    S.fieldCache.clear(); S.fieldPending.clear();
    if (selectName && S.world.regions.some((r) => r.name === selectName)) S.region = selectName;
    else if (!S.world.regions.some((r) => r.name === S.region)) S.region = S.world.regions[0].name;
    fillControls();
    renderLeyAspects();
    await dateChanged({ forceMonth: true });
    saveState();
  }
  async function saveRegion(replaceBuiltIn) {
    const data = rdCollect();
    if (!data.name) { $("rdError").textContent = T("rdNeedName"); $("rdName").focus(); return; }
    // a new region with the name of an existing one replaces it, after asking
    const clash = S.world.regions.find((r) => r.name === data.name);
    if (!replaceBuiltIn && clash && data.name !== RD.original) {
      if (clash.custom === "new") { $("rdError").textContent = T("rdReplaceText", data.name); return; }
      const ok = await ask({ title: T("rdSave"), text: T("rdReplaceText", data.name), buttons: [{ id: "yes", label: T("rdSave"), primary: true }] });
      if (!ok) return;
      replaceBuiltIn = true;
    }
    $("rdSave").disabled = true;
    try {
      const res = await api("PUT", "/regions", { originalName: RD.original, data, replaceBuiltIn: !!replaceBuiltIn });
      $("regionDialog").close();
      await reloadWorld(res.name);
      setStatus(T("rdSaved", res.name));
    } catch (e) {
      $("rdError").textContent = e.message;
    } finally { $("rdSave").disabled = false; }
  }
  function wireRegionEditor() {
    $("regionNew").onclick = () => openRegionEditor("new");
    $("regionEdit").onclick = () => openRegionEditor("edit");
    $("rdFrom").onchange = async (e) => {
      if (!e.target.value) { const keep = $("rdName").value; rdFill(blankRegion()); $("rdName").value = keep; return; }
      try {
        const src = await api("GET", "/regions/source" + q({ name: e.target.value }));
        const keep = $("rdName").value;
        rdFill({ ...src.data, name: keep, description: "" });
      } catch (err) { $("rdError").textContent = err.message; }
    };
    $("rdAddEvent").onclick = () => {
      RD.events.push({ name: "", occurs: 1, days: 7 });
      rdRenderEvents();
      const inputs = $("rdEventList").querySelectorAll(".rd-ev-name input");
      if (inputs.length) inputs[inputs.length - 1].focus();
    };
    $("rdCancel").onclick = () => $("regionDialog").close();
    $("regionForm").onsubmit = (e) => { e.preventDefault(); saveRegion(false); };
    $("rdDownload").onclick = () => {
      if (!RD.original) return;
      const a = document.createElement("a");
      a.href = "/weather/api/regions/yaml" + q({ name: RD.original });
      document.body.append(a); a.click(); a.remove();
    };
    $("rdDelete").onclick = async () => {
      if (!RD.source || !RD.source.custom) return;
      const text = RD.source.builtIn ? T("rdDeleteRevert", RD.original) : T("rdDeleteText", RD.original);
      const ok = await ask({ title: T("rdDelete"), text, buttons: [{ id: "yes", label: T("rdDelete"), primary: true }] });
      if (!ok) return;
      try {
        await api("DELETE", "/regions" + q({ name: RD.original }));
        $("regionDialog").close();
        const name = RD.original;
        await reloadWorld(RD.source.builtIn ? name : null);
        setStatus(T("rdDeleted", name));
      } catch (e) { $("rdError").textContent = e.message; }
    };
  }
