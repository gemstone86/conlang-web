// Eon Weather – the page, part 3 of 7: the height painter (also forest, ice and marshland).
// The app-*.js files are loaded in this order by index.html and share one scope (they are one program in parts:
// app-core.js, app-maps.js, app-painter.js, app-suggestions.js, app-layers.js, app-view.js, app-start.js).
"use strict";
  // ── Height painter ────────────────────────────────────────────────────
  const fmtInt = (n) => Math.round(n).toLocaleString(S.lang === "EN" ? "en-GB" : "sv-SE");
  /** A grey value as metres (with a height scale) or just the number. */
  function heightText(v) {
    const sea = fieldMap.seaLevel, mps = fieldMap.metersPerStep;
    if (sea == null || !mps) return String(Math.round(v));
    return v >= sea ? T("masl", fmtInt((v - sea) * mps)) : T("seaDepth", fmtInt((sea - v) * mps));
  }
  /** Painting a layer (forest, ice or marshland, 0–100) rather than heights; layerKind() says which. */
  const forestMode = () => fieldMap.hpTarget === "forest" || fieldMap.hpTarget === "ice" || fieldMap.hpTarget === "marsh";
  const layerKind = () => (fieldMap.hpTarget === "ice" || fieldMap.hpTarget === "marsh" ? fieldMap.hpTarget : "forest");
  // what differs between the painted layers: strings, the flag for unsaved changes, the brush default, the file name
  const LK = {
    forest: { dens: "fpDensity", label: "fpDensityLabel", save: "fpSave", saved: "fpSaved", clear: "fpClearText", dirty: "forestDirty", def: 60, hint: "forestHint", sv: "-skog.png", en: "-forest.png" },
    ice: { dens: "ipCover", label: "ipCoverLabel", save: "ipSave", saved: "ipSaved", clear: "ipClearText", dirty: "iceDirty", def: 100, hint: "iceHint", sv: "-is.png", en: "-ice.png" },
    marsh: { dens: "mpCover", label: "mpCoverLabel", save: "mpSave", saved: "mpSaved", clear: "mpClearText", dirty: "marshDirty", def: 100, hint: "marshHint", sv: "-sumpmark.png", en: "-marshland.png" },
  };
  function updateHpValueLabel() {
    const v = +$("hpValue").value;
    $("hpValueM").textContent = forestMode() ? T(LK[layerKind()].dens, v) : fieldMap.seaLevel != null && fieldMap.metersPerStep ? heightText(v) : "";
  }
  function setHpValue(v) {
    v = Math.max(0, Math.min(forestMode() ? 100 : 255, Math.round(+v || 0)));
    $("hpValue").value = v; $("hpValueNum").value = v;
    fieldMap.hpSet_("value", v);
    updateHpValueLabel();
  }
  function markHeightDirty(on) {
    S.heightDirty = on;
    $("hpSave").textContent = T("hpSave") + (on ? " •" : "");
    $("hpUndo").disabled = !fieldMap.hpCanUndo();
  }
  /** The layer being painted (forest or ice) has unsaved changes. */
  function markForestDirty(on) {
    const k = LK[layerKind()];
    S[k.dirty] = on;
    $("hpSave").textContent = T(k.save) + (on ? " •" : "");
    $("hpUndo").disabled = !fieldMap.hpCanUndo();
  }
  /** The ice map, for the "Is" layer, the painter and 3D (none: no ice anywhere). */
  async function loadIce() {
    const map = S.map;
    if (!map || !map.hasIce) { fieldMap.setIceImage(null); return null; }
    const img = new Image();
    img.src = `/weather/api/maps/${map.id}/ice?v=${Date.now()}`;
    try { await img.decode(); } catch (e) { fieldMap.setIceImage(null); return null; }
    if (S.map === map) fieldMap.setIceImage(img);
    return img;
  }
  /** The marshland map, for the "Sumpmark" layer, the painter and the travel calculator (none: dry everywhere). */
  async function loadMarsh() {
    const map = S.map;
    if (!map || !map.hasMarsh) { fieldMap.setMarshImage(null); return null; }
    const img = new Image();
    img.src = `/weather/api/maps/${map.id}/marsh?v=${Date.now()}`;
    try { await img.decode(); } catch (e) { fieldMap.setMarshImage(null); return null; }
    if (S.map === map) fieldMap.setMarshImage(img);
    return img;
  }
  /** The forest map, for the "Skog" layer and the painter (none: no trees anywhere). */
  async function loadForest() {
    const map = S.map;
    if (!map || !map.hasForest) { fieldMap.setForestImage(null); return null; }
    const img = new Image();
    img.src = `/weather/api/maps/${map.id}/forest?v=${Date.now()}`;
    try { await img.decode(); } catch (e) { fieldMap.setForestImage(null); return null; }
    if (S.map === map) fieldMap.setForestImage(img);
    return img;
  }
  async function saveForest() {
    if (!S.map || !fieldMap.hpHas() || !forestMode()) return;
    const kind = layerKind();
    try {
      const blob = await fieldMap.hpPNG();
      Object.assign(S.map, await api("PUT", `/maps/${S.map.id}/${kind}`, blob, "image/png"));
      markForestDirty(false);
      setStatus(T(LK[kind].saved));
    } catch (e) { setStatus(T("saveFailed") + e.message); }
  }
  function openHeightPainter() {
    if (!S.map) return;
    // the same sliders as for heights, but density 0–100
    const forest = forestMode();
    $("hpValue").max = $("hpValueNum").max = forest ? 100 : 255;
    $("hpTol").max = $("hpTolOut").max = forest ? 100 : 255;
    document.querySelector('.hp-value [data-i18n="hpHeight"]').textContent = T(forest ? LK[layerKind()].label : "hpHeight");
    if (forest && ["river", "ridge", "coast", "erode", "rough", "plateau"].includes(fieldMap.hpSettings().tool)) {
      fieldMap.hpSet_("tool", "brush");
      document.querySelector('input[name="hpTool"][value="brush"]').checked = true;
      syncHpToolUi();
    }
    setHpValue((S.hpVals || {})[forest ? layerKind() : "height"] ?? (forest ? LK[layerKind()].def : 140));
    if (!forest && $("hpDiv").checked) setTimeout(() => fieldMap.hpSetDivides(true), 30);   // the rivers may have changed meanwhile
    if (forest) {
      fieldMap.hpOpen();
      markForestDirty(!!S[LK[layerKind()].dirty]);
      return;
    }
    $("hpSave").textContent = T("hpSave") + (S.heightDirty ? " •" : "");
    if (!fieldMap.hpHas() && !fieldMap.hpOpen()) { setStatus(T("hpNone")); }
    const def = (S.maps || []).find((m) => m.isDefault && m.hasHeight);
    $("hpFromDefault").hidden = !def || def.id === S.map.id;
    $("hpUndo").disabled = !fieldMap.hpCanUndo();
  }
  function syncHpToolUi() {
    const S_ = fieldMap.hpSettings(), tool = S_.tool, river = tool === "river", ridge = tool === "ridge", coast = tool === "coast", plateau = tool === "plateau";
    const brushy = ["brush", "raise", "lower", "smooth", "erode", "rough"].includes(tool);
    $("hpSizeBox").hidden = !(brushy || river || ridge || coast || plateau);
    $("hpSoftBox").hidden = !brushy;
    $("hpStrengthBox").hidden = !(tool === "raise" || tool === "lower" || tool === "erode" || tool === "rough" || river);
    $("hpGrainBox").hidden = tool !== "rough";
    $("hpGrain").value = $("hpGrainOut").value = S_.grain || 6;
    $("hpPlateauMake").hidden = !plateau; $("hpPlateauMake").disabled = fieldMap.hpPolygonSize() < 3;
    // the river tool uses the same two sliders for the valley's width and the bed's depth
    $("hpSizeLabel").textContent = T(river ? "hpRiverW" : plateau ? "hpEdgeW" : ridge || coast ? "hpWidth" : "hpSize");
    $("hpStrengthLabel").textContent = T(river ? "hpRiverDepth" : "hpStrength");
    $("hpStrength").min = river ? 0 : 1;
    const sz = river ? S_.riverW : ridge ? S_.ridgeW : coast ? S_.coastW : plateau ? S_.plateauW : S_.radius, st = river ? S_.riverDepth : S_.strength;
    $("hpSize").value = sz; $("hpSizeOut").value = sz;
    $("hpStrength").value = st; $("hpStrengthOut").value = st;
    $("hpStrengthOut").min = $("hpStrength").min;
    $("hpRiverCarve").hidden = !river;
    document.querySelector(".hp-opts").classList.toggle("river", river);
    $("hpSizeBox").title = river ? T("hpRiverWTip") : ridge ? T("hpRidgeWTip") : coast ? T("hpCoastWTip") : plateau ? T("hpEdgeWTip") : ""; $("hpStrengthBox").title = river ? T("hpRiverDepthTip") : "";
    $("hpRiverCarve").disabled = fieldMap.hpPolygonSize() < 2;
    $("hpRidgeMake").hidden = !ridge; $("hpRidgeMake").disabled = fieldMap.hpPolygonSize() < 2;
    $("hpCoastMake").hidden = !coast; $("hpCoastMake").disabled = fieldMap.hpPolygonSize() < 2;
    $("hpTolBox").hidden = $("hpCoastBox").hidden = tool !== "fill";
    $("hpPolyFill").hidden = tool !== "polygon";
    $("hpPolyFill").disabled = fieldMap.hpPolygonSize() < 3;
  }
  /** A height scale for maps that have none yet: sea level 120, 100 m per step. */
  async function ensureHeightScale() {
    const st = { ...(S.map.settings || {}) };
    if (Number.isFinite(st.seaLevel) && st.metersPerStep) return;
    st.seaLevel = 120; st.metersPerStep = 100; if (!st.blockHeight) st.blockHeight = 30;
    S.map.settings = st;
    fieldMap.setHeightScale(120, 100);
    $("hpSea").value = 120; $("hpMps").value = 100;
    $("blockHeight").value = st.blockHeight; $("blockOut").textContent = st.blockHeight; fieldMap.setBlockHeight(st.blockHeight);
    try { Object.assign(S.map, await api("PUT", `/maps/${S.map.id}`, { settings: st })); } catch (e) { /* kept locally */ }
  }
  async function saveHeight() {
    if (!S.map || !fieldMap.hpHas()) return;
    try {
      const blob = await fieldMap.hpPNG();
      const m = await api("PUT", `/maps/${S.map.id}/height`, blob, "image/png");
      Object.assign(S.map, m);
      renderHeightTools();
      markHeightDirty(false);
      setStatus(T("hpSaved"));
    } catch (e) { setStatus(T("saveFailed") + e.message); }
  }
  function wireHeightPainter() {
    fieldMap.hpSettings();
    document.querySelectorAll('input[name="hpTool"]').forEach((r) => {
      r.onchange = () => {
        if (!r.checked) return;
        const prev = fieldMap.hpSettings().tool;
        fieldMap.hpSet_("tool", r.value);
        if (r.value !== prev && r.value !== "pan") fieldMap.hpClearPolygon();   // points belong to one tool
        syncHpToolUi();
      };
    });
    $("hpValue").oninput = (e) => setHpValue(e.target.value);
    $("hpValueNum").onchange = (e) => setHpValue(e.target.value);
    $("hpValueNum").oninput = (e) => { const v = e.target.value; if (v !== "" && +v >= 0 && +v <= 255) { $("hpValue").value = v; fieldMap.hpSet_("value", Math.round(+v)); updateHpValueLabel(); } };
    // each slider has a number box next to it: type an exact value, or use the arrow keys
    const pairSlider = (rangeId, numId, apply, toNum = (v) => v, fromNum = (v) => v) => {
      const r = $(rangeId), n = $(numId);
      r.addEventListener("input", () => { n.value = toNum(+r.value); apply(+r.value); });
      const fromBox = (final) => {
        const raw = String(n.value).replace(",", ".");
        if (raw === "" || !Number.isFinite(+raw)) { if (final) n.value = toNum(+r.value); return; }
        const v = Math.min(+r.max, Math.max(+r.min, fromNum(+raw)));
        r.value = v;
        if (final) n.value = toNum(+r.value);
        apply(+r.value);
      };
      n.addEventListener("input", () => fromBox(false));
      n.addEventListener("change", () => fromBox(true));
      n.addEventListener("keydown", (e) => { if (e.key === "Enter") { fromBox(true); n.blur(); } });
    };
    pairSlider("hpSize", "hpSizeOut", (v) => { const t = fieldMap.hpSettings().tool; fieldMap.hpSet_(t === "river" ? "riverW" : t === "ridge" ? "ridgeW" : t === "coast" ? "coastW" : t === "plateau" ? "plateauW" : "radius", v); });
    pairSlider("hpGrain", "hpGrainOut", (v) => fieldMap.hpSet_("grain", v));
    $("hpSoft").onchange = (e) => fieldMap.hpSet_("soft", e.target.checked);
    pairSlider("hpStrength", "hpStrengthOut", (v) => fieldMap.hpSet_(fieldMap.hpSettings().tool === "river" ? "riverDepth" : "strength", v));
    pairSlider("hpTol", "hpTolOut", (v) => fieldMap.hpSet_("tol", v));
    $("hpCoast").onchange = (e) => fieldMap.hpSet_("coast", e.target.checked);
    $("hpView").onchange = (e) => fieldMap.hpSet_("view", e.target.value);
    $("hpOut").onchange = (e) => {
      $("hpOutThrBox").hidden = !e.target.checked;
      $("hpOutCount").textContent = "";
      fieldMap.hpSetOutliers(e.target.checked, +$("hpOutThr").value || 5);
    };
    $("hpDiv").onchange = (e) => {
      $("hpDivLift").hidden = !e.target.checked;
      $("hpDivCount").textContent = e.target.checked ? T("hpWorking") : "";
      setTimeout(() => fieldMap.hpSetDivides(e.target.checked), 30);
    };
    $("hpDivLift").onclick = () => {
      $("hpDivCount").textContent = T("hpWorking");
      setTimeout(() => {
        const n = fieldMap.hpLiftDivides();
        setStatus(n ? T("hpDivLifted", n.toLocaleString(S.lang === "EN" ? "en-GB" : "sv-SE")) : T("hpDivNothing"));
        $("hpUndo").disabled = !fieldMap.hpCanUndo();
      }, 30);
    };
    $("hpTreeLine").onchange = (e) => { const v = Math.max(0, Math.min(20000, +String(e.target.value).replace(",", ".") || 0)); e.target.value = v; S.treeLine = v; fieldMap.hpSettings().treeLine = v; if (fieldMap.hp) fieldMap.hp.water = null; saveState(); fieldMap.draw(); };
    $("hpTreeTemp").onchange = (e) => { S.treeTemp = e.target.checked; fieldMap.hpSettings().treeTemp = e.target.checked; if (fieldMap.hp) fieldMap.hp.water = null; saveState(); fieldMap.draw(); };
    $("hpTreeShow").onchange = (e) => { S.showTreeLine = e.target.checked; fieldMap.hpSettings().showTreeLine = e.target.checked; saveState(); fieldMap.draw(); };
    $("hpTreeClear").onclick = () => {
      const n = fieldMap.hpClearAboveTreeLine();
      setStatus(n ? T("hpTreeCleared", n.toLocaleString(S.lang === "EN" ? "en-GB" : "sv-SE")) : T("hpTreeNone"));
      $("hpUndo").disabled = !fieldMap.hpCanUndo();
    };
    $("hpRoadSteep").onchange = (e) => {
      fieldMap.hpSettings().roadSteep = e.target.checked;
      $("hpRoadSteepCount").textContent = "";
      fieldMap.draw();
    };
    $("hpOutThr").onchange = (e) => fieldMap.hpSetOutliers($("hpOut").checked, Math.max(1, +e.target.value || 5));
    pairSlider("hpAlpha", "hpAlphaNum", (v) => fieldMap.hpSet_("alpha", v), (v) => Math.round(v * 100), (v) => v / 100);
    $("hpPolyFill").onclick = () => { fieldMap.hpFillPolygon(); syncHpToolUi(); };
    $("hpRiverCarve").onclick = () => { fieldMap.hpCarveRiver(); syncHpToolUi(); $("hpUndo").disabled = !fieldMap.hpCanUndo(); };
    $("hpRidgeMake").onclick = () => { fieldMap.hpMakeRidge(); syncHpToolUi(); $("hpUndo").disabled = !fieldMap.hpCanUndo(); };
    $("hpCoastMake").onclick = () => { fieldMap.hpMakeCoast(); syncHpToolUi(); $("hpUndo").disabled = !fieldMap.hpCanUndo(); };
    $("hpPlateauMake").onclick = () => { fieldMap.hpMakePlateau(); syncHpToolUi(); $("hpUndo").disabled = !fieldMap.hpCanUndo(); };
    $("hpUndo").onclick = () => { fieldMap.hpUndo(); $("hpUndo").disabled = !fieldMap.hpCanUndo(); };
    const saveScale = () => {
      const sea = $("hpSea").value === "" ? null : Math.max(0, Math.min(255, Math.round(+$("hpSea").value)));
      const mps = Math.max(0, +String($("hpMps").value).replace(",", ".") || 0) || null;
      const st = { ...(S.map.settings || {}) };
      if (sea == null) delete st.seaLevel; else st.seaLevel = sea;
      if (!mps) delete st.metersPerStep; else st.metersPerStep = mps;
      fieldMap.setHeightScale(sea, mps);
      fieldMap.hpSet_("view", $("hpView").value);  // recolour for the new sea level
      updateHpValueLabel();
      (S.map.settings = st, api("PUT", `/maps/${S.map.id}`, { settings: st })).then((m) => Object.assign(S.map, m)).catch(() => {});
    };
    $("hpSea").onchange = saveScale;
    $("hpMps").onchange = saveScale;
    $("hpNew").onclick = async () => {
      if (fieldMap.hpHas() && !(await ask({ title: T("hpNewTitle"), text: T("hpReplaceText"), buttons: [{ id: "yes", label: T("hpNew").replace("…", ""), primary: true }] }))) return;
      await ensureHeightScale();
      const sea = fieldMap.seaLevel, mps = fieldMap.metersPerStep;
      const pick = await ask({ title: T("hpNewTitle"), text: T("hpNewText", sea, mps),
        buttons: [{ id: "land", label: T("hpNewLand"), primary: true }, { id: "sea", label: T("hpNewSea") }] });
      if (!pick) return;
      fieldMap.hpNew(Math.min(8192, Math.max(4096, S.map.width)), pick === "sea" ? sea - 20 : sea + 2);
      openHeightPainter();
    };
    $("hpFromDefault").onclick = async () => {
      const def = (S.maps || []).find((m) => m.isDefault && m.hasHeight);
      if (!def) return;
      if (fieldMap.hpHas() && !(await ask({ title: T("hpFromDefault"), text: T("hpReplaceText"), buttons: [{ id: "yes", label: T("hpFromDefault"), primary: true }] }))) return;
      const img = new Image();
      img.src = `/weather/api/maps/${def.id}/height?v=${Date.now()}`;
      try { await img.decode(); } catch (e) { setStatus(e.message); return; }
      // take over the default map's height scale too
      const ds = def.settings || {}, st = { ...(S.map.settings || {}) };
      ["seaLevel", "metersPerStep", "blockHeight"].forEach((k) => { if (ds[k] != null) st[k] = ds[k]; });
      S.map.settings = st;
      try { Object.assign(S.map, await api("PUT", `/maps/${S.map.id}`, { settings: st })); } catch (e) { /* kept locally */ }
      await loadHeight();
      fieldMap.hpLoad(img);
      openHeightPainter();
    };
    $("hpExport").onclick = async () => {
      const blob = await fieldMap.hpPNG();
      if (!blob) { setStatus(T("hpNone")); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (S.map ? S.map.name : "karta").replace(/[\\/:*?"<>|]+/g, "_") + (forestMode() ? LK[layerKind()][S.lang === "EN" ? "en" : "sv"] : S.lang === "EN" ? "-heightmap.png" : "-hojdkarta.png");
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
    $("hpSave").onclick = () => (forestMode() ? saveForest() : saveHeight());
    $("hpUseDerived").onclick = () => {
      setStatus(T("heightPickWorking"));
      setTimeout(() => {
        const n = fieldMap.hpUseDerived();
        setStatus(n ? T("hpUseDerivedDone", n.toLocaleString(S.lang === "EN" ? "en-GB" : "sv-SE")) : T("hpUseDerivedNone"));
        $("hpUndo").disabled = !fieldMap.hpCanUndo();
      }, 30);
    };
    $("heightPick").onchange = (e) => { S.heightPick = e.target.value; saveState(); applyHeightPick(); };
    $("fpUpload").onclick = () => $("forestFile").click();
    $("forestFile").onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = "";
      if (!f) return;
      const img = new Image(); img.src = URL.createObjectURL(f);
      try { await img.decode(); } catch (err) { setStatus(err.message); return; }
      fieldMap.hpLoad(img);           // grey values 0–100 (anything above counts as 100)
      URL.revokeObjectURL(img.src);
      markForestDirty(true);
    };
    $("fpClear").onclick = async () => {
      if (!(await ask({ title: T("fpClear").replace("…", ""), text: T(LK[layerKind()].clear), buttons: [{ id: "yes", label: T("fpClear").replace("…", ""), primary: true }] }))) return;
      fieldMap.hpNew(Math.min(8192, S.map.width), 0);
      markForestDirty(true);
    };
    window.addEventListener("keydown", (e) => {
      if (!S.editing || !["height", "forest", "ice", "marsh"].includes($("editMode").value) || /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); fieldMap.hpUndo(); $("hpUndo").disabled = !fieldMap.hpCanUndo(); }
      else if (e.key === "Enter" && fieldMap.hpSettings().tool === "polygon") { fieldMap.hpFillPolygon(); syncHpToolUi(); }
      else if (e.key === "Enter" && fieldMap.hpSettings().tool === "river") { fieldMap.hpCarveRiver(); syncHpToolUi(); $("hpUndo").disabled = !fieldMap.hpCanUndo(); }
      else if (e.key === "Enter" && fieldMap.hpSettings().tool === "ridge") { fieldMap.hpMakeRidge(); syncHpToolUi(); $("hpUndo").disabled = !fieldMap.hpCanUndo(); }
      else if (e.key === "Enter" && fieldMap.hpSettings().tool === "coast") { fieldMap.hpMakeCoast(); syncHpToolUi(); $("hpUndo").disabled = !fieldMap.hpCanUndo(); }
      else if (e.key === "Enter" && fieldMap.hpSettings().tool === "plateau") { fieldMap.hpMakePlateau(); syncHpToolUi(); $("hpUndo").disabled = !fieldMap.hpCanUndo(); }
      else if (e.key === "Escape") { fieldMap.hpClearPolygon(); syncHpToolUi(); }
    });
    syncHpToolUi();
  }
