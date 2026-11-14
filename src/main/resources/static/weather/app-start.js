// Eon Weather – the page, part 7 of 7: the hour playback, wiring the page up, the version in the corner, and the start.
// The app-*.js files are loaded in this order by index.html and share one scope (they are one program in parts:
// app-core.js, app-maps.js, app-painter.js, app-suggestions.js, app-layers.js, app-view.js, app-start.js).
"use strict";
  // ── Hour playback ─────────────────────────────────────────────────────
  let playing = false, playStart = 0, playFrom = 0;
  function setHour(h, fromSlider) {
    S.hourF = ((h % 24) + 24) % 24;
    S.hour = Math.floor(S.hourF);
    fieldMap.setTime(curSerial() + S.hourF / 24);
    $("hourOut").textContent = T("globalTime", String(S.hour).padStart(2, "0") + ":00");
    showLocalTime();
    if (!fromSlider) $("hour").value = S.hour;
    drawHourly();
    if (popupAt) refreshPopup();
  }
  /** Time of day as hh:mm. */
  const clockText = (h) => { const m = ((Math.round(h * 60) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
  /** The selected region's local time (global time + its offset), shown under the hour slider. */
  function localHour() { return ((S.hourF + fieldMap.regionOffset(S.region)) % 24 + 24) % 24; }
  function showLocalTime() {
    const el = $("localTime");
    if (el) el.textContent = T("localTime", clockText(localHour()), S.region || "");
  }
  function togglePlay() {
    playing = !playing;
    $("play").textContent = playing ? "❚❚" : "▶";
    $("play").title = playing ? T("pause") : T("play");
    if (!playing) { setHour(S.hour); saveState(); return; }
    playStart = performance.now(); playFrom = S.hour;
    const tick = (now) => {
      if (!playing) return;
      const h = playFrom + (now - playStart) / 650; // one hour every 0.65 s
      if (h >= 24) { playFrom = h - 24; playStart = now; S.hourF = playFrom; step(1); } // midnight: next day, clock keeps running
      else setHour(h);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ── Wiring ────────────────────────────────────────────────────────────
  function wire() {
    $("allReligions").onchange = (e) => {
      S.religion = e.target.checked ? null : ($("religion").value || (S.world.religions || [])[0] || null);
      religionChanged();
    };
    $("religion").onchange = (e) => { S.religion = e.target.value || null; religionChanged(); };
    $("region").onchange = (e) => { S.region = e.target.value; dateChanged(); showLocalTime(); };
    $("year").onchange = (e) => { const y = parseInt(e.target.value, 10); if (!isNaN(y)) { S.year = y; dateChanged(); } };
    $("month").onchange = (e) => { S.month = +e.target.value; dateChanged(); };
    $("day").onchange = (e) => { S.day = +e.target.value; dateChanged(); };
    $("calendar").onchange = (e) => { S.calendar = +e.target.value; renderDay(); saveState(); };
    $("prevDay").onclick = () => step(-1);
    $("nextDay").onclick = () => step(1);
    $("prevMonth").onclick = () => step(-28);
    $("nextMonth").onclick = () => step(28);
    $("lang").onclick = () => { S.lang = S.lang === "EN" ? "SV" : "EN"; applyText(); dateChanged({ forceMonth: true }); };
    document.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (["input", "textarea", "select"].includes(tag) || e.target.isContentEditable || document.querySelector("dialog[open]") || walk3d) return;   // keys steer the walker in 3D
      if (e.key === "ArrowLeft") { step(e.shiftKey ? -28 : -1); e.preventDefault(); }
      if (e.key === "ArrowRight") { step(e.shiftKey ? 28 : 1); e.preventDefault(); }
      if (e.key === "Escape") { closePopup(); if (walkPick) setWalkPick(false); }
    });

    $("comment").oninput = (e) => queueNote(0, e.target);
    $("campaignNote").oninput = (e) => queueNote(S.campaignId, e.target);
    $("comment").onblur = $("campaignNote").onblur = flushNotes;
    $("campaign").onchange = (e) => switchCampaign(+e.target.value);
    $("newCampaign").onclick = async () => {
      const name = await ask({ title: T("newCampaign"), input: { label: T("campaignName") } });
      if (!name) return;
      try {
        const r = await api("POST", "/campaigns", { name });
        await api("PUT", `/campaigns/${r.id}`, { region: S.region, year: S.year, month: S.month, day: S.day });
        await loadCampaigns(); await switchCampaign(r.id);
      } catch (e) { setStatus(e.message); }
    };
    $("renameCampaign").onclick = async () => {
      const c = S.campaigns.find((x) => x.id === S.campaignId); if (!c) return;
      const name = await ask({ title: T("renameCampaign"), input: { label: T("campaignName") }, value: c.name });
      if (!name) return;
      try { await api("PUT", `/campaigns/${c.id}`, { name }); await loadCampaigns(); } catch (e) { setStatus(e.message); }
    };
    $("deleteCampaign").onclick = async () => {
      const c = S.campaigns.find((x) => x.id === S.campaignId); if (!c) return;
      const choice = await ask({ title: T("deleteCampaign"), text: T("deleteCampaignText", c.name),
        buttons: [{ id: "delete", label: T("deleteNotes") }, { id: "merge", label: T("moveToComments"), primary: true }] });
      if (!choice) return;
      flushNotes();
      await api("DELETE", `/campaigns/${c.id}` + (choice === "merge" ? "?merge=true" : ""));
      S.campaignId = 0;
      await loadCampaigns(); await loadNotes(); await dateChanged({ forceMonth: true });
    };
    $("importNotes").onclick = () => $("importFile").click();
    $("importFile").onchange = async (e) => {
      const target = S.campaignId ? S.campaigns.find((c) => c.id === S.campaignId).name : T("generalComments");
      const msgs = [];
      for (const f of e.target.files) {
        try {
          const r = await api("POST", `/import?campaign=${S.campaignId}`, await f.text(), "text/plain; charset=utf-8");
          msgs.push(T("imported", r.imported, f.name));
        } catch (err) { msgs.push(`${f.name}: ${err.message}`); }
      }
      e.target.value = "";
      setStatus(T("importHint", target) + ". " + msgs.join(" "));
      await loadNotes(); renderMonth(); showNotes();
    };
    $("exportNotes").onclick = () => { flushNotes(); window.location.href = `/weather/api/export?campaign=${S.campaignId}`; };


    document.querySelectorAll(".layers input[value]").forEach((cb) => {
      cb.onchange = () => {
        S.layers = [...document.querySelectorAll(".layers input[value]:checked")].map((x) => x.value);
        fieldMap.setLayers(S.layers); renderLegend(); syncFxToggles(); saveState();
      };
    });
    $("rainFx").onchange = (e) => { S.rainFx = e.target.checked; fieldMap.setFx("rain", S.rainFx); saveState(); };
    $("cloudFx").onchange = (e) => { S.cloudFx = e.target.checked; fieldMap.setFx("cloud", S.cloudFx); saveState(); };
    $("hour").oninput = (e) => setHour(+e.target.value, true);
    $("opacity").oninput = (e) => { S.opacity = +e.target.value; fieldMap.setOpacity(S.opacity); };
    $("opacity").onchange = saveState;
    $("symbolsBtn").onclick = openSymbols;
    $("symbolFile").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; uploadSymbol(f); };
    $("hour").onchange = saveState;
    $("play").onclick = togglePlay;
    $("mapSelect").onchange = async (e) => {
      if (e.target.value === "new") { $("mapFile").click(); renderMapSelect(); return; }
      S.mapId = +e.target.value; saveState(); await showMap();
    };
    $("uploadMap").onclick = () => $("mapFile").click();
    $("mapFile").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; uploadMap(f, false); };
    $("replaceMap").onclick = () => { $("mapFile").dataset.replace = "1"; $("replaceFile").click(); };
    $("editMap").onclick = async () => {
      if (S.editing && S.riversDirty) await saveRivers();
      if (S.editing && fieldMap.ntDrawing) fieldMap.ntFinish();
      if (S.editing && S.nationsDirty) await saveNations();
      if (S.editing && fieldMap.rgDrawing) fieldMap.rgFinish();
      if (S.editing && S.rangesDirty) await saveRanges();
      if (S.editing && S.anchorsDirty && S.map && S.map.mine) await saveAnchors();
      if (S.editing && S.heightDirty) { fieldMap.hpSetTarget("height"); await saveHeight(); }
      if (S.editing && S.forestDirty) { fieldMap.hpSetTarget("forest"); await saveForest(); }
      if (S.editing && S.iceDirty) { fieldMap.hpSetTarget("ice"); await saveForest(); }
      if (S.editing && S.marshDirty) { fieldMap.hpSetTarget("marsh"); await saveForest(); }
      if (S.editing && fieldMap.wyDraft) fieldMap.wyFinish && fieldMap.wyFinish(null);
      if (S.editing && S.roadsDirty) await saveRoads();
      if (S.editing && S.citiesDirty) await saveCities();
      setEditing(!S.editing);
    };
    $("anchorRegion").onchange = (e) => fieldMap.setSelectedRegion(e.target.value || null);
    wireHeightPainter();
    wireSuggestions();
    wireRivers();
    wireRoads();
    wireCities();
    initTravel();
    wireNations();
    wireRanges();
    wireRegionEditor();
    renderLeyAspects();
    $("editMode").onchange = applyEditMode;
    $("leyAspect").onchange = (e) => fieldMap.setLeyAspect(e.target.value);
    fieldMap.setLeyHidden(S.leyHidden || []);
    renderLeyFilter();
    $("leyFilterBox").addEventListener("toggle", () => {
      // open towards whichever side has room
      const box = $("leyFilterBox"), panel = box.querySelector(".ley-panel");
      panel.style.left = "0"; panel.style.right = "auto";
      if (box.open && panel.getBoundingClientRect().right > window.innerWidth - 8) { panel.style.left = "auto"; panel.style.right = "0"; }
    });
    $("zoneNew").onclick = () => { fieldMap.newZone(); $("stage").focus(); };
    $("leyAll").onclick = () => setLeyHidden([]);
    $("leyNone").onclick = () => setLeyHidden([...new Set(Object.values(S.world.forces || {}).flat())]);
    // close the aspect list when clicking anywhere else
    document.addEventListener("pointerdown", (e) => {
      const box = $("leyFilterBox");
      if (box.open && !box.contains(e.target)) box.open = false;
    });
    $("unplacedOnly").onchange = () => renderAnchorRegions();
    $("reach").oninput = (e) => fieldMap.setReach(+e.target.value);
    $("reach").onchange = (e) => {
      S.map.settings = { ...(S.map.settings || {}), reach: +e.target.value };
      api("PUT", `/maps/${S.map.id}`, { settings: S.map.settings })
        .then((m) => { Object.assign(S.map, m); }).catch(() => {});
    };
    $("wrapWidth").onchange = (e) => {
      const v = Math.max(0, Math.round(Number(e.target.value) || 0));
      fieldMap.setWrap(v);
      const settings = { ...(S.map.settings || {}) };
      if (v > 0) settings.wrapWidth = v; else delete settings.wrapWidth;
      (S.map.settings = settings, api("PUT", `/maps/${S.map.id}`, { settings })).then((m) => Object.assign(S.map, m)).catch(() => {});
    };
    $("kmPerPixel").onchange = (e) => {
      const v = Math.max(0, Number(String(e.target.value).replace(",", ".")) || 0);
      fieldMap.setScale(v);
      const settings = { ...(S.map.settings || {}) };
      if (v > 0) settings.kmPerPixel = v; else delete settings.kmPerPixel;
      (S.map.settings = settings, api("PUT", `/maps/${S.map.id}`, { settings })).then((m) => Object.assign(S.map, m)).catch(() => {});
    };
    $("mlDefault").onclick = () => setMapLayers(null);
    $("mlNone").onclick = () => setMapLayers([]);
    $("mapLayerDrop").addEventListener("toggle", () => {
      const box = $("mapLayerDrop"), panel = box.querySelector(".ley-panel");
      panel.style.left = "0"; panel.style.right = "auto";
      if (box.open && panel.getBoundingClientRect().right > window.innerWidth - 8) { panel.style.left = "auto"; panel.style.right = "0"; }
    });
    document.addEventListener("pointerdown", (e) => {
      const box = $("mapLayerDrop");
      if (box && box.open && !box.contains(e.target)) box.open = false;
    });
    $("mapTiles").onchange = (e) => {
      const v = e.target.value;
      const settings = { ...(S.map.settings || {}) };
      if (v) settings.tiles = v; else delete settings.tiles;
      fieldMap.setTiles(v || null);
      (S.map.settings = settings, api("PUT", `/maps/${S.map.id}`, { settings })).then((m) => Object.assign(S.map, m)).catch((err) => setStatus(T("saveFailed") + err.message));
    };
    $("mapPublic").onchange = (e) => {
      api("PUT", `/maps/${S.map.id}`, { isPublic: e.target.checked }).then((m) => Object.assign(S.map, m)).catch(() => {});
    };
    $("saveAnchors").onclick = saveAnchors;
    $("heightUpload").onclick = () => $("heightFile").click();
    $("heightFile").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; uploadHeight(f); };
    $("heightRemove").onclick = async () => {
      const ok = await ask({ title: T("heightRemove"), text: T("heightRemoveText", S.map.name), buttons: [{ id: "yes", label: T("remove"), primary: true }] });
      if (!ok) return;
      Object.assign(S.map, await api("DELETE", `/maps/${S.map.id}/height`));
      loadHeight();
    };
    $("heightShow").onchange = (e) => fieldMap.setShowHeight(e.target.checked);
    $("walk3dBtn").onclick = () => setWalkPick(!walkPick);
    $("blockHeight").oninput = (e) => { $("blockOut").textContent = e.target.value; fieldMap.setBlockHeight(+e.target.value); };
    $("blockHeight").onchange = (e) => {
      S.map.settings = { ...(S.map.settings || {}), blockHeight: +e.target.value };
      api("PUT", `/maps/${S.map.id}`, { settings: S.map.settings })
        .then((m) => Object.assign(S.map, m)).catch(() => {});
    };
    $("zoomIn").onclick = () => fieldMap.zoomBy(1.3);
    $("zoomOut").onclick = () => fieldMap.zoomBy(1 / 1.3);
    $("zoomFit").onclick = () => fieldMap.refit();
    $("renameMap").onclick = async () => {
      const name = await ask({ title: T("rename"), input: { label: T("mapName") }, value: S.map.name });
      if (!name) return;
      await api("PUT", `/maps/${S.map.id}`, { name });
      await loadMaps();
      setEditing(true);
    };
    $("deleteMap").onclick = async () => {
      const ok = await ask({ title: T("deleteMap"), text: T("deleteMapText", S.map.name), buttons: [{ id: "yes", label: T("delete"), primary: true }] });
      if (!ok) return;
      try { await api("DELETE", `/maps/${S.map.id}`); } catch (e) { setStatus(T("saveFailed") + e.message); return; }
      await loadMaps();   // the map stays in your own list, marked as removed, until it is deleted for good
    };
    $("heightBlank").onclick = blankHeight;
    $("exportMap").onclick = exportMap;
    window.addEventListener("resize", () => drawHourly());
    window.addEventListener("beforeunload", flushNotes);
    // warn before leaving with changes that aren't saved yet (rivers save themselves after a moment)
    window.addEventListener("beforeunload", (e) => {
      if (S.riversDirty || S.nationsDirty || S.rangesDirty || S.roadsDirty || S.citiesDirty || (S.editing && (S.anchorsDirty || S.heightDirty || S.forestDirty || S.iceDirty || S.marshDirty))) {
        if (S.riversDirty) saveRivers();
        if (S.nationsDirty) saveNations();
        if (S.rangesDirty) saveRanges();
        e.preventDefault(); e.returnValue = "";
      }
    });
    // a choice made just before closing or reloading the page is kept (the save is otherwise delayed)
    window.addEventListener("pagehide", () => {
      if (!saveStateTimer) return;
      try { localStorage.setItem("eon-weather-state", JSON.stringify(snapshot())); } catch (e) { /* storage unavailable */ }
      if (S.user) fetch("/weather/api/state", { method: "PUT", keepalive: true, credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Eon-Request": "1" }, body: JSON.stringify(snapshot()) }).catch(() => {});
    });
  }
  async function restoreMap() {
    if (!S.map) return;
    try { await api("POST", `/maps/${S.map.id}/restore`); } catch (e) { setStatus(T("saveFailed") + e.message); return; }
    await loadMaps();
    setStatus(T("mapRestored"));
  }
  /** A height map where everything lies at one height, on Mundana's scale (sea level 120, 100 m per step). */
  async function blankHeight() {
    if (!S.map) return;
    const st = S.map.settings || {};
    const sea = Number.isFinite(st.seaLevel) ? st.seaLevel : 120, mps = st.metersPerStep || 100;
    const choice = await ask({ title: T("heightBlank"), text: T("heightBlankText") + (S.map.hasHeight ? " " + T("heightBlankReplace") : ""),
      buttons: [{ id: "sea", label: T("heightBlankSea", -5 * mps) }, { id: "land", label: T("heightBlankLand", mps), primary: true }] });
    if (!choice) return;
    try {
      Object.assign(S.map, await api("POST", `/maps/${S.map.id}/height/blank`, { value: choice === "sea" ? sea - 5 : sea + 1 }));
      await loadHeight();
      $("heightShow").checked = true; fieldMap.setShowHeight(true);
      setStatus(T("heightBlankDone"));
    } catch (e) { await ask({ title: T("heightBlank"), text: e.message, buttons: [] }); }
  }
  /** For admins: download what differs between this map and the release's standard map, to send on. */
  async function exportMap() {
    if (!S.map) return;
    if (S.riversDirty) await saveRivers();
    if (S.nationsDirty) await saveNations();
    if (S.rangesDirty) await saveRanges();
    let sum;
    setStatus(T("expWorking"));
    try { sum = await api("GET", `/maps/${S.map.id}/export?summary=1`); } catch (e) { setStatus(T("saveFailed") + e.message); return; }
    setStatus("");
    const parts = Object.entries(sum.changes || {}).map(([k, v]) => {
      const name = T("exp_" + k);
      if (k === "height" && v.changedPixels != null) return `${name}: ${T("expPixels", v.changedPixels.toLocaleString())}`;
      if (Array.isArray(v)) return `${name}: ${v.length}`;
      if (v && v.count != null) return `${name}: ${v.count}`;
      if (k === "settings") return `${name}: ${Object.keys(v).join(", ")}`;
      return name;
    });
    const text = (parts.length ? T("expChanged") + "\n• " + parts.join("\n• ") : T("expNothing")) + "\n\n" + T("expHow");
    const choice = await ask({ title: T("exportMap"), text,
      buttons: [{ id: "all", label: T("expAll") }, ...(parts.length ? [{ id: "diff", label: T("expDiff"), primary: true }] : [])] });
    if (!choice) return;
    const a = document.createElement("a");
    a.href = `/weather/api/maps/${S.map.id}/export${choice === "all" ? "?all=1" : ""}`;
    a.download = "";
    document.body.append(a); a.click(); a.remove();
  }
  async function saveAnchors() {
    try {
      // points for regions that no longer exist (e.g. after a region was split) are dropped
      const known = new Set(S.world.regions.map((r) => r.name));
      const keep = fieldMap.getAnchors().filter((a) => known.has(a.region));
      await api("PUT", `/maps/${S.map.id}/anchors`, keep);
      if (S.leyDirty) { await api("PUT", `/maps/${S.map.id}/leylines`, fieldMap.getLeylines()); S.leyDirty = false; }
      if (S.zoneDirty) { await api("PUT", `/maps/${S.map.id}/zones`, fieldMap.getZones()); S.zoneDirty = false; }
      if (keep.length !== fieldMap.getAnchors().length) fieldMap.setAnchors(keep);
      S.anchorsDirty = false;
      $("saveAnchors").textContent = T("savePositions");
      setStatus(T("positionsSaved"));
    } catch (e) { setStatus(T("saveFailed") + e.message); }
  }

  /** For admins: a note in the corner if zoom pieces are missing on the server (see /api/tiles/check). */
  async function checkTiles() {
    try {
      const r = await api("GET", "/tiles/check");
      const el = $("tilesWarn");
      if (!el) return;
      el.hidden = r.ok;
      if (!r.ok) { el.textContent = T("tilesMissing", r.missing); el.href = "/weather/api/tiles/check"; }
    } catch (e) { /* not important */ }
  }

  // ── Version in the corner: the server's, and this page's if they differ (old files cached) ──
  const CLIENT_VERSION = window.APP_VERSION || "dev";   // from /version.js, which the build fills in from pom.xml
  function showVersion(server) {
    const el = $("appVersion");
    if (!el) return;
    if (!server || server === CLIENT_VERSION) { el.textContent = "v" + CLIENT_VERSION; el.className = "app-version"; el.title = ""; return; }
    el.textContent = `v${server} · ${S.lang === "EN" ? "page" : "sidan"} v${CLIENT_VERSION} — ${S.lang === "EN" ? "reload" : "ladda om"}`;
    el.className = "app-version stale";
    el.title = S.lang === "EN" ? "The browser is showing older files. Reload the page (Ctrl+F5)." : "Webbläsaren visar äldre filer. Ladda om sidan (Ctrl+F5).";
  }

  // ── Start ─────────────────────────────────────────────────────────────
  async function start() {
    // a hidden second file input for "replace image"
    const rf = document.createElement("input");
    rf.type = "file"; rf.id = "replaceFile"; rf.hidden = true; rf.accept = $("mapFile").accept;
    rf.onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; uploadMap(f, true); };
    document.body.append(rf);

    S.world = await api("GET", "/world");
    showVersion(S.world.version);
    S.region = S.world.regions[0].name;
    try { applySnapshot(JSON.parse(localStorage.getItem("eon-weather-state") || "null")); } catch (e) { /* ignore */ }
    const me = await api("GET", "/me");
    wire();
    fieldMap.setLayers(S.layers);
    setHour(S.hour);
    await afterAuth(me);
  }
  start().catch((e) => { document.body.insertAdjacentHTML("afterbegin", `<p class="error" style="padding:1rem">${e.message}</p>`); });
