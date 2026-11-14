// Eon Weather – the page, part 5 of 7: the layers edited on the map: rivers, mountain ranges, nations, roads, cities; the travel calculator; the edit modes.
// The app-*.js files are loaded in this order by index.html and share one scope (they are one program in parts:
// app-core.js, app-maps.js, app-painter.js, app-suggestions.js, app-layers.js, app-view.js, app-start.js).
"use strict";
  // ── Rivers ────────────────────────────────────────────────────────────
  // ── Mountain ranges ───────────────────────────────────────────────────
  // Saved like the nations: a moment after each change, with the same check that nobody else
  // changed them meanwhile.
  async function loadRanges() {
    const map = S.map;
    clearTimeout(rangeSaveTimer); rangeSaveTimer = 0;
    S.rangesDirty = false; $("rgSave").textContent = T("rgSave");
    if (!map || !fieldMap.setRanges) { fieldMap.setRanges && fieldMap.setRanges([]); S.rangesRev = null; return; }
    try {
      const d = await api("GET", `/maps/${map.id}/ranges?v=${Date.now()}`);
      if (S.map === map) { fieldMap.setRanges(d.ranges || []); S.rangesRev = d.rev || null; }
    } catch (e) { fieldMap.setRanges([]); S.rangesRev = null; }
    renderRangeBar();
  }
  let rangeSaveTimer = 0, rangeSaving = null;
  function scheduleRangeSave() {
    clearTimeout(rangeSaveTimer);
    rangeSaveTimer = setTimeout(() => { rangeSaveTimer = 0; if (S.rangesDirty && !fieldMap.rgDrawing) saveRanges(); else if (S.rangesDirty) scheduleRangeSave(); }, 1500);
  }
  async function saveRanges(force) {
    if (!S.map || SG.suggesting) return;         // a suggestion's edits are sent as a suggestion, not saved
    clearTimeout(rangeSaveTimer); rangeSaveTimer = 0;
    if (rangeSaving) { await rangeSaving; if (!S.rangesDirty) return; }
    const map = S.map, list = fieldMap.getRanges();
    rangeSaving = (async () => {
      try {
        const rev = !force && S.rangesRev ? `?rev=${encodeURIComponent(S.rangesRev)}` : "";
        const r = await api("PUT", `/maps/${map.id}/ranges${rev}`, list);
        if (S.map !== map) return;
        S.rangesRev = r && r.rev || null;
        if (JSON.stringify(fieldMap.getRanges()) === JSON.stringify(list)) { S.rangesDirty = false; $("rgSave").textContent = T("rgSave"); }
      } catch (e) {
        if (e.status === 409) {
          const pick = await ask({ title: T("rgConflict"), text: T("rgConflictText"), buttons: [{ id: "mine", label: T("rvConflictMine"), primary: true }, { id: "theirs", label: T("rvConflictTheirs") }] });
          if (pick === "mine") { rangeSaving = null; return saveRanges(true); }
          if (pick === "theirs") { await loadRanges(); return; }
        } else setStatus(T("saveFailed") + e.message);
      }
    })();
    try { await rangeSaving; } finally { rangeSaving = null; }
  }
  function renderRangeBar() {
    if ($("rangeBar").hidden || !fieldMap.ranges) return;
    const r = fieldMap.rgChosen();
    ["rgDelete", "rgName", "rgHeight"].forEach((id) => { $(id).disabled = !r; });
    $("rgExtend").disabled = !r || fieldMap.rgDrawing;
    $("rgFinish").hidden = !fieldMap.rgDrawing;
    if (document.activeElement !== $("rgName")) $("rgName").value = r ? r.name : "";
    if (document.activeElement !== $("rgHeight")) $("rgHeight").value = r && Number.isFinite(r.height) ? r.height : "";
    const km = (v) => Math.round(v).toLocaleString(S.lang === "EN" ? "en" : "sv");
    let info;
    const parent = r && r.from ? (fieldMap.ranges || []).find((x) => x.id === r.from.range) : null;
    if (r && fieldMap.rgDrawing && fieldMap.rgBranching) info = T("rgBranchStart", r.name || T("rgUnnamed"));
    else if (r && fieldMap.rgDrawing) info = T(fieldMap.rgDrawEnd === "head" ? "rgExtendingHead" : "rgDrawing", r.name || T("rgUnnamed"), r.points.length);
    else if (r) {
      const i = fieldMap.rangeInfo(r), set = r.points.filter((p) => p.l != null || p.r != null).length;
      info = T("rgInfoText", r.name || T("rgUnnamed"), i && i.lengthKm != null ? km(i.lengthKm) + " km" : "—",
        i && i.widthKm != null ? km(i.widthKm) + " km" : i && i.widthPx != null ? "—" : T("rgNoWidth"), set, r.points.length);
      if (parent) info += " · " + T("rgBranchOf", parent.name || T("rgUnnamed"));
    } else info = T("rgStartHint", (fieldMap.ranges || []).length);
    $("rgInfo").textContent = info;
  }
  function wireRanges() {
    $("rgNew").onclick = async () => {
      const name = await ask({ title: T("rgNew"), input: { label: T("rgNewName"), optional: true }, buttons: [{ id: "ok", label: T("rgNew"), primary: true }] });
      if (name == null) return;
      fieldMap.rgNew(name);
      renderRangeBar(); $("stage").focus();
    };
    $("rgBranch").onclick = async () => {
      const name = await ask({ title: T("rgBranch"), input: { label: T("rgNewName"), optional: true }, buttons: [{ id: "ok", label: T("rgBranch"), primary: true }] });
      if (name == null) return;
      fieldMap.rgNewBranch(name);
      renderRangeBar(); $("stage").focus();
    };
    $("rgName").oninput = (e) => fieldMap.rgSetName(e.target.value);
    $("rgHeight").onchange = (e) => fieldMap.rgSetHeight(e.target.value);
    $("rgFinish").onclick = () => { fieldMap.rgFinish(); renderRangeBar(); };
    $("rgExtend").onclick = () => { if (fieldMap.rgExtend("tail")) { renderRangeBar(); $("stage").focus(); } };
    $("rgDelete").onclick = async () => {
      const r = fieldMap.rgChosen();
      if (!r) return;
      if (!(await ask({ title: T("rgDelete"), text: T("rgDeleteText", r.name || T("rgUnnamed")), buttons: [{ id: "yes", label: T("rgDelete"), primary: true }] }))) return;
      fieldMap.rgDelete(); renderRangeBar();
    };
    $("rgSave").onclick = () => saveRanges();
    $("rgExport").onclick = async () => {
      if (S.rangesDirty) await saveRanges();
      const a = document.createElement("a");
      a.href = `/weather/api/maps/${S.map.id}/ranges?download=1&v=${Date.now()}`;
      document.body.append(a); a.click(); a.remove();
    };
    window.addEventListener("keydown", (e) => {
      if (!S.editing || $("editMode").value !== "range" || /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
      if (e.key === "Enter" && fieldMap.rgDrawing) { e.preventDefault(); fieldMap.rgFinish(); renderRangeBar(); }
      else if (e.key === "Escape") { if (fieldMap.rgCancel()) { e.preventDefault(); renderRangeBar(); } }
    });
    $("stage").addEventListener("pointerup", () => { if (S.editing && $("editMode").value === "range") setTimeout(renderRangeBar, 0); });
  }

  // ── Nations ───────────────────────────────────────────────────────────
  // Like the rivers: loaded with the map, saved by themselves a moment after each change (and when
  // leaving the edit mode), with the same check against overwriting a newer version.
  async function loadNations() {
    const map = S.map;
    clearTimeout(nationSaveTimer); nationSaveTimer = 0;
    S.nationsDirty = false; $("ntSave").textContent = T("ntSave");
    if (!map || !fieldMap.setNations) { fieldMap.setNations && fieldMap.setNations([]); S.nationsRev = null; return; }
    try {
      const d = await api("GET", `/maps/${map.id}/nations?v=${Date.now()}`);
      if (S.map === map) { fieldMap.setNations(d.nations || []); S.nationsRev = d.rev || null; }
    } catch (e) { fieldMap.setNations([]); S.nationsRev = null; }
    renderNationBar();
  }
  let nationSaveTimer = 0, nationSaving = null;
  function scheduleNationSave() {
    clearTimeout(nationSaveTimer);
    nationSaveTimer = setTimeout(() => { nationSaveTimer = 0; if (S.nationsDirty) saveNations(); }, 1500);
  }
  async function saveNations(force) {
    if (!S.map || SG.suggesting) return;         // a suggestion's edits are sent as a suggestion, not saved
    clearTimeout(nationSaveTimer); nationSaveTimer = 0;
    if (nationSaving) { await nationSaving; if (!S.nationsDirty) return; }
    const map = S.map, list = fieldMap.getNations();
    nationSaving = (async () => {
      try {
        const rev = !force && S.nationsRev ? `?rev=${encodeURIComponent(S.nationsRev)}` : "";
        const r = await api("PUT", `/maps/${map.id}/nations${rev}`, list);
        if (S.map !== map) return;
        S.nationsRev = r && r.rev || null;
        if (JSON.stringify(fieldMap.getNations()) === JSON.stringify(list)) { S.nationsDirty = false; $("ntSave").textContent = T("ntSave"); }
        else scheduleNationSave();
        $("ntInfo").textContent = T("ntSaved");
      } catch (e) {
        if (e.status === 409 && S.map === map) {
          const pick = await ask({ title: T("ntConflictTitle"), text: T("ntConflictText"),
            buttons: [{ id: "mine", label: T("rvConflictMine"), primary: true }, { id: "theirs", label: T("rvConflictTheirs") }] });
          if (pick === "mine") { nationSaving = null; return saveNations(true); }
          if (pick === "theirs") { await loadNations(); return; }
        }
        $("ntInfo").textContent = T("saveFailed") + e.message;
      }
    })();
    try { await nationSaving; } finally { nationSaving = null; }
  }
  /** The new-subdivision dialog: a name, or (ticked) a suggested division into a number of parts. */
  function askSubdivision() {
    return new Promise((resolve) => {
      const dlg = $("promptDialog"), body = $("promptBody"), acts = $("promptActions");
      $("promptTitle").textContent = T("ntSub");
      body.innerHTML = "";
      const lab = document.createElement("label"); lab.className = "field stack";
      const ls = document.createElement("span"); ls.textContent = T("ntSubName");
      const name = document.createElement("input"); name.type = "text"; name.maxLength = 100;
      lab.append(ls, name);
      const chk = document.createElement("label"); chk.className = "check";
      const cb = document.createElement("input"); cb.type = "checkbox";
      const cs = document.createElement("span"); cs.textContent = T("ntSuggest");
      chk.append(cb, cs);
      const cnt = document.createElement("label"); cnt.className = "field";
      const cl = document.createElement("span"); cl.textContent = T("ntSuggestCount");
      const num = document.createElement("input"); num.type = "number"; num.min = "2"; num.max = "60"; num.value = "6"; num.className = "num-small"; num.disabled = true;
      cnt.append(cl, num);
      const help = document.createElement("p"); help.className = "hint"; help.textContent = T("ntSuggestHelp"); help.hidden = true;
      cb.onchange = () => { num.disabled = !cb.checked; help.hidden = !cb.checked; ls.textContent = T(cb.checked ? "ntSuggestBaseLabel" : "ntSubName"); if (cb.checked) num.focus(); };
      const row = document.createElement("div"); row.className = "nt-suggest-row";
      row.append(chk, cnt);
      body.append(lab, row, help);
      acts.innerHTML = "";
      const sp = document.createElement("div"); sp.className = "spacer";
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = T("cancel");
      const ok = document.createElement("button"); ok.type = "submit"; ok.className = "primary"; ok.textContent = T("ntSub");
      let done = false;
      const finish = (v) => { if (done) return; done = true; dlg.onclose = null; dlg.close(); resolve(v); };
      cancel.onclick = () => finish(null);
      ok.onclick = (ev) => {
        ev.preventDefault();
        if (cb.checked) {
          const k = Math.round(+num.value);
          if (!(k >= 2 && k <= 60)) { num.focus(); return; }
          finish({ suggest: true, count: k, name: name.value.trim() });
        } else {
          if (!name.value.trim()) { name.focus(); return; }
          finish({ suggest: false, name: name.value.trim() });
        }
      };
      acts.append(sp, cancel, ok);
      dlg.onclose = () => { if (!dlg.open) finish(null); };
      dlg.showModal();
      name.focus();
    });
  }
  function renderNationBar() {
    if ($("nationBar").hidden || !fieldMap.nations) return;
    const n = fieldMap.ntSel != null ? fieldMap.nations.find((x) => x.id === fieldMap.ntSel) : null;
    const sub = fieldMap.ntChosenSub(), t = sub || n;
    ["ntDelete", "ntPart", "ntName", "ntSub"].forEach((id) => { $(id).disabled = !n; });
    $("ntColor").disabled = !n || !!sub;                   // a subdivision has its nation's colour
    $("ntDelPart").disabled = !t || t.parts.length < 2;
    $("ntFinish").hidden = !fieldMap.ntDrawing;
    $("ntDelete").textContent = T(sub ? "ntDeleteSub" : "ntDelete");
    if (document.activeElement !== $("ntName")) $("ntName").value = t ? t.name : "";
    if (n) $("ntColor").value = n.color;
    const km = (v) => Math.round(v).toLocaleString(S.lang === "EN" ? "en" : "sv");
    let info;
    if (t && fieldMap.ntDrawing) info = T("ntDrawing", t.name || T(sub ? "ntSubUnnamed" : "ntUnnamed"), (t.parts[fieldMap.ntPart] || []).length);
    else if (sub) {
      // the subdivision's area, and the whole nation's
      const a = fieldMap.nationArea(sub), all = fieldMap.nationArea(n);
      info = T("ntSubInfo", sub.name || T("ntSubUnnamed"), km(a), all ? Math.round(a / all * 100) : 0, n.name || T("ntUnnamed"), km(all));
    } else if (n) {
      info = T("ntInfoText", n.name || T("ntUnnamed"), km(fieldMap.nationArea(n)), n.parts.length);
      if ((n.subs || []).length) info += T("ntSubsText", n.subs.length, km(n.subs.reduce((s, x) => s + fieldMap.nationArea(x), 0)));
    } else info = T("ntStartHint");
    $("ntInfo").textContent = info;
  }
  function wireNations() {
    $("ntNew").onclick = async () => {
      const name = await ask({ title: T("ntNew"), input: { label: T("ntNewName") }, buttons: [{ id: "ok", label: T("ntNew"), primary: true }] });
      if (name == null) return;
      fieldMap.ntNew(name);
      renderNationBar(); $("stage").focus();
    };
    $("ntName").oninput = (e) => fieldMap.ntSetName(e.target.value);
    $("ntSub").onclick = async () => {
      if (fieldMap.ntSel == null) return;
      const n = fieldMap.nations.find((x) => x.id === fieldMap.ntSel);
      const r = await askSubdivision();
      if (!r) return;
      if (r.suggest) {
        // a suggested division covering the whole nation, in place of the subdivisions it has
        if ((n.subs || []).length && !(await ask({ title: T("ntSuggest"), text: T("ntSuggestReplace", n.subs.length), buttons: [{ id: "yes", label: T("ntSuggestDo"), primary: true }] }))) return;
        const made = fieldMap.ntSuggestSubs(r.count, r.name || T("ntSuggestBase"));
        renderNationBar();
        if (!made) $("ntInfo").textContent = T("ntSuggestNone");
        return;
      }
      fieldMap.ntNewSub(r.name);
      renderNationBar(); $("stage").focus();
    };
    $("ntColor").oninput = (e) => fieldMap.ntSetColor(e.target.value);
    $("ntFinish").onclick = () => { fieldMap.ntFinish(); renderNationBar(); };
    $("ntPart").onclick = () => { if (fieldMap.ntNewPart()) { renderNationBar(); $("stage").focus(); } };
    $("ntDelPart").onclick = () => { fieldMap.ntDeletePart(); renderNationBar(); };
    $("ntDelete").onclick = async () => {
      const n = (fieldMap.nations || []).find((x) => x.id === fieldMap.ntSel), sub = fieldMap.ntChosenSub();
      if (!n) return;
      const k = sub ? "ntDeleteSub" : "ntDelete", txt = sub ? T("ntDeleteSubText", sub.name || T("ntSubUnnamed")) : T("ntDeleteText", n.name || T("ntUnnamed"));
      if (!(await ask({ title: T(k), text: txt, buttons: [{ id: "yes", label: T(k), primary: true }] }))) return;
      fieldMap.ntDelete(); renderNationBar();
    };
    $("ntSave").onclick = () => saveNations();
    $("ntExport").onclick = async () => {
      if (S.nationsDirty) await saveNations();
      const a = document.createElement("a");
      a.href = `/weather/api/maps/${S.map.id}/nations?download=1&v=${Date.now()}`;
      document.body.append(a); a.click(); a.remove();
    };
    window.addEventListener("keydown", (e) => {
      if (!S.editing || $("editMode").value !== "nation" || /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
      if (e.key === "Enter" && fieldMap.ntDrawing) { e.preventDefault(); fieldMap.ntFinish(); renderNationBar(); }
      else if (e.key === "Escape") { if (fieldMap.ntCancel()) { e.preventDefault(); renderNationBar(); } }
    });
    $("stage").addEventListener("pointerup", () => { if (S.editing && $("editMode").value === "nation") setTimeout(renderNationBar, 0); });
  }

  async function loadRivers() {
    const map = S.map;
    clearTimeout(riverSaveTimer); riverSaveTimer = 0;
    S.riversDirty = false; $("rvSave").textContent = T("rvSave");
    if (!map) { fieldMap.setRivers([]); S.riversRev = null; return; }
    try {
      const d = await api("GET", `/maps/${map.id}/rivers?v=${Date.now()}`);
      if (S.map === map) { fieldMap.setRivers(d.rivers || []); S.riversRev = d.rev || null; }
    } catch (e) { fieldMap.setRivers([]); S.riversRev = null; }
  }
  // River edits save themselves a moment after each change (and when leaving the edit mode), so a reload
  // doesn't lose them. A save based on an older version than the server's (saved meanwhile from another
  // tab or by another admin) is refused, and you choose whose rivers to keep.
  let riverSaveTimer = 0, riverSaving = null;
  function scheduleRiverSave() {
    clearTimeout(riverSaveTimer);
    riverSaveTimer = setTimeout(() => { riverSaveTimer = 0; if (S.riversDirty) saveRivers(); }, 1500);
  }
  async function saveRivers(force) {
    if (!S.map || SG.suggesting) return;         // a suggestion's edits are sent as a suggestion, not saved
    clearTimeout(riverSaveTimer); riverSaveTimer = 0;
    if (riverSaving) { await riverSaving; if (!S.riversDirty) return; }
    const map = S.map, list = fieldMap.getRiverData();
    $("rvInfo").textContent = T("rvSaving");
    riverSaving = (async () => {
      try {
        const rev = !force && S.riversRev ? `?rev=${encodeURIComponent(S.riversRev)}` : "";
        const r = await api("PUT", `/maps/${map.id}/rivers${rev}`, list);
        if (S.map !== map) return;
        S.riversRev = r && r.rev || null;
        // still dirty if something changed while saving
        if (JSON.stringify(fieldMap.getRiverData()) === JSON.stringify(list)) { S.riversDirty = false; $("rvSave").textContent = T("rvSave"); }
        else scheduleRiverSave();
        $("rvInfo").textContent = T("rvSaved");
      } catch (e) {
        if (e.status === 409 && S.map === map) {
          const pick = await ask({ title: T("rvConflictTitle"), text: T("rvConflictText"),
            buttons: [{ id: "mine", label: T("rvConflictMine"), primary: true }, { id: "theirs", label: T("rvConflictTheirs") }] });
          if (pick === "mine") { riverSaving = null; return saveRivers(true); }
          if (pick === "theirs") { await loadRivers(); renderRiverBar(); return; }
        }
        $("rvInfo").textContent = T("saveFailed") + e.message;
      }
    })();
    try { await riverSaving; } finally { riverSaving = null; }
  }
  const fmtKmh = (v) => (Math.round(v * 10) / 10).toLocaleString(S.lang === "EN" ? "en" : "sv");
  function renderRiverBar() {
    if ($("riverBar").hidden) return;
    const r = fieldMap.rvSel != null ? (fieldMap.rivers || []).find((x) => x.id === fieldMap.rvSel) : null;
    const lake = fieldMap.lkSel != null ? (fieldMap.lakes || []).find((x) => x.id === fieldMap.lkSel) : null;
    $("rvDelete").disabled = !r && !lake;
    $("rvDelete").textContent = T(lake ? "lkDelete" : "rvDelete");
    $("rvExtend").hidden = !!lake;
    $("rvExtend").disabled = !r || !!fieldMap.rvDraft;
    $("lkOut").hidden = !lake;
    $("lkOut").disabled = !!fieldMap.rvDraft;
    $("lkNew").classList.toggle("active", !!fieldMap.lkPlacing);
    $("rvName").disabled = !r && !lake;
    // the current: set by hand (shown), or worked out (shown greyed, as the placeholder)
    const sp = $("rvSpeed");
    sp.disabled = !r;
    if (document.activeElement !== sp) {
      sp.value = r && r.speed != null ? r.speed : "";
      sp.placeholder = r ? fmtKmh(fieldMap.currentAt(r, 0)) : "";
    }
    const size = r ? r.size : fieldMap.rvNextSize || 1;
    $("rvSize").value = size; $("rvSizeNum").value = size;
    if (document.activeElement !== $("rvName")) $("rvName").value = r ? r.name : lake ? lake.name : "";
    let info;
    const D = fieldMap.rvDraft, fl = (v) => fieldMap.flowText(v);
    const lakeName = (id) => { const l = (fieldMap.lakes || []).find((x) => x.id === id); return (l && l.name) || T("lkUnnamed"); };
    if (fieldMap.lkPlacing) info = T("lkPlaceHint");
    else if (D && D.extend != null && r) info = T(D.end === "tail" ? "rvExtendingTail" : "rvExtendingHead", r.name || T("rvUnnamed"), D.points.length);
    else if (lake) {
      const F = fieldMap.lakeFlow(lake.id);
      info = F.outs ? T("lkFlowOut", fl(F.in), F.outs) : T("lkFlowNone", fl(F.in));
    } else if (r) {
      const total = fl(fieldMap.riverFlows()[r.id].total);
      if (r.joins && r.joins.lake != null) info = T("rvFlowLake", total, lakeName(r.joins.lake));
      else {
        const into = r.joins ? (fieldMap.rivers || []).find((x) => x.id === r.joins.river) : null;
        info = into ? T("rvFlowInto", total, into.name || T("rvUnnamed")) : T("rvFlowSea", total);
      }
      if (r.from) info = T("rvFromLake", lakeName(r.from.lake)) + " " + info;
      // the current where it starts and at its mouth (with the tributaries' water)
      const c0 = fieldMap.currentAt(r, 0), c1 = fieldMap.currentAt(r, Math.max(0, r.points.length - 1.5));
      info += " · " + T(r.speed != null ? "rvCurrentSet" : "rvCurrentAuto", fmtKmh(c0), fmtKmh(c1));
    } else if (D && D.from != null) info = T("lkDrawingOut", lakeName(D.from), D.points.length - 1);
    else if (D) info = T("rvDrawing", D.points.length);
    else info = T("rvStartHint", size);
    $("rvInfo").textContent = info;
    // the chosen river's length, and the longest course to its mouth through its tributaries
    const lenOut = $("rvLen");
    if (r && !(D && D.extend != null)) {
      const L = fieldMap.riverLength(r), k = Number(S.map && S.map.settings && S.map.settings.kmPerPixel) || 0;
      const fmt = (px) => k ? `${Math.round(px * k).toLocaleString(S.lang === "EN" ? "en" : "sv")} km` : `${px.toFixed(1)} px`;
      lenOut.textContent = T("rvLenText", fmt(L.own), fmt(L.longest)); lenOut.title = T("rvLenTip");
    } else { lenOut.textContent = ""; lenOut.title = ""; }
  }
  // ── Suggested rivers ──────────────────────────────────────────────────
  // Where water would run on the base height map (terrain.js: drainage, suggestRivers), shown in orange
  // in the river mode. Reads the height map, never changes it. The drainage is worked out once per
  // height map; drawn rivers and the amount only change which courses are shown.
  let sugDrain = null, sugTimer = 0;
  const SUG_AREA = { few: 3000, some: 800, many: 250, all: 80 };   // full-size height pixels draining through
  function updateSuggestions() {
    const on = !!S.rvSuggest && S.editing && $("editMode").value === "river" && !!S.heightBase && fieldMap.seaLevel != null;
    $("rvSuggest").checked = !!S.rvSuggest;
    $("rvSuggestAmt").value = SUG_AREA[S.rvSuggestAmt] ? S.rvSuggestAmt : "many";
    $("rvSuggestAmt").disabled = !S.rvSuggest;
    $("rvSuggestBox").hidden = !(S.map && S.map.hasHeight);
    if (!on) { if (fieldMap.rvSuggest) fieldMap.rvSetSuggest(null); return; }
    clearTimeout(sugTimer);
    sugTimer = setTimeout(() => {
      const src = S.heightBase;
      if (!sugDrain || sugDrain.src !== src || sugDrain.sea !== fieldMap.seaLevel) {
        setStatus(T("rvSuggestWorking"));
        const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        const c = cv.getContext("2d", { willReadFrequently: true });
        c.drawImage(src, 0, 0);
        const px = c.getImageData(0, 0, w, h).data, base = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) base[i] = px[i * 4];
        sugDrain = { src, sea: fieldMap.seaLevel, D: window.EonTerrain.drainage(base, w, h, fieldMap.seaLevel) };
      }
      if (!(S.rvSuggest && S.editing && $("editMode").value === "river")) return;
      const list = window.EonTerrain.suggestRivers(sugDrain.D, fieldMap.getRivers(), SUG_AREA[$("rvSuggestAmt").value] || 250);
      fieldMap.rvSetSuggest(list);
      setStatus(T("rvSuggestDone", list.length));
    }, sugDrain ? 200 : 30);
  }
  /**
   * The climate at map spots on a date: (x, y) → { now, warm, cold } (mean temperatures at sea level for that
   * date, of the warmest and of the coldest month), or null where no region reaches. For snow and ice in 3D
   * and deep snow on journeys.
   */
  function climateOn(month, day) {
    const byName = {};
    // a region's temperatures are for its base_heat_height: brought down to sea level (6.5° per km)
    for (const r of S.world.regions) if (Array.isArray(r.temperature) && r.temperature.length === 12)
      byName[r.name] = r.temperature.map((t) => t + 6.5 * (r.baseHeight || 0) / 1000);
    // mean temperatures are for the middle of each month; between them, interpolated (28-day months)
    const f = ((month - 1) + (day - 14.5) / 28 + 12) % 12, m0 = Math.floor(f), w = f - m0;
    return (x, y) => {
      const t = fieldMap.climateCell(x, y, byName);
      if (!t) return null;
      let warm = -99, cold = 99;
      for (const v of t) { if (v > warm) warm = v; if (v < cold) cold = v; }
      return { now: t[m0] * (1 - w) + t[(m0 + 1) % 12] * w, warm, cold };
    };
  }

  // ── The travel calculator (travel.js) ─────────────────────────────────
  /** A time on the app's clock (day serial + hour / 24) as "d/m år kl hh:mm". */
  function fmtTime(t) {
    const s = Math.floor(t + 1e-9), d = dateOfSerial(s);
    return T("trDate", d.day, d.month, d.year, clockText((t - s) * 24));
  }
  /** A duration in days as "3 dygn 4 h". */
  function fmtDuration(days) {
    const h = Math.max(0, Math.round(days * 24)), dd = Math.floor(h / 24), hh = h % 24;
    return dd ? T("trDur", dd, hh) : T("trDurH", hh);
  }
  function initTravel() {
    if (!window.Travel) return;
    Travel.init({ fieldMap, api, T, S, ask, saveState, fetchField,
      // the clock: pause (returns whether it was running) and start again
      pause: () => { const was = playing; if (playing) togglePlay(); return was; }, play: () => { if (!playing) togglePlay(); },
      fmtT: fmtTime, fmtDur: fmtDuration,
      climateFor: (serial) => { const d = dateOfSerial(serial); return climateOn(d.month, d.day); } });
    fieldMap.monthOf = (serial) => dateOfSerial(serial).month;
    if (S.map) Travel.load();
  }
  function loadTrips() { if (window.Travel && Travel.ctx) Travel.load(); }

  // ── Roads and paths ───────────────────────────────────────────────────
  // Drawn like rivers (roads.js); saved like them, a moment after each change, with the same check
  // against changes saved elsewhere. Stretches steeper than the road's kind takes are red while editing.
  let roadSaveTimer = 0, roadSaving = null;
  async function loadRoads() {
    const map = S.map;
    clearTimeout(roadSaveTimer); roadSaveTimer = 0;
    S.roadsDirty = false; $("wySave").textContent = T("wySave");
    if (!map) { fieldMap.setRoads([]); S.roadsRev = null; return; }
    try {
      const d = await api("GET", `/maps/${map.id}/roads?v=${Date.now()}`);
      if (S.map === map) { fieldMap.setRoads(d.roads || []); S.roadsRev = d.rev || null; }
    } catch (e) { fieldMap.setRoads([]); S.roadsRev = null; }
    if (window.Travel) Travel.roadsChanged();
  }
  function scheduleRoadSave() {
    clearTimeout(roadSaveTimer);
    roadSaveTimer = setTimeout(() => { roadSaveTimer = 0; if (S.roadsDirty) saveRoads(); }, 1500);
  }
  async function saveRoads(force) {
    if (!S.map || SG.suggesting) return;         // a suggestion's edits are sent as a suggestion, not saved
    clearTimeout(roadSaveTimer); roadSaveTimer = 0;
    if (roadSaving) { await roadSaving; if (!S.roadsDirty) return; }
    const map = S.map, list = fieldMap.getRoads();
    $("wyInfo").textContent = T("rvSaving");
    roadSaving = (async () => {
      try {
        const rev = !force && S.roadsRev ? `?rev=${encodeURIComponent(S.roadsRev)}` : "";
        const r = await api("PUT", `/maps/${map.id}/roads${rev}`, list);
        if (S.map !== map) return;
        S.roadsRev = r && r.rev || null;
        if (JSON.stringify(fieldMap.getRoads()) === JSON.stringify(list)) { S.roadsDirty = false; $("wySave").textContent = T("wySave"); }
        else scheduleRoadSave();
        $("wyInfo").textContent = T("wySaved");
      } catch (e) {
        if (e.status === 409 && S.map === map) {
          const pick = await ask({ title: T("wyConflictTitle"), text: T("wyConflictText"),
            buttons: [{ id: "mine", label: T("rvConflictMine"), primary: true }, { id: "theirs", label: T("rvConflictTheirs") }] });
          if (pick === "mine") { roadSaving = null; return saveRoads(true); }
          if (pick === "theirs") { await loadRoads(); renderRoadBar(); return; }
        }
        $("wyInfo").textContent = T("saveFailed") + e.message;
      }
    })();
    try { await roadSaving; } finally { roadSaving = null; }
  }
  function renderRoadBar() {
    if ($("roadBar").hidden) return;
    const r = fieldMap.wyChosen ? fieldMap.wyChosen() : null, D = fieldMap.wyDraft;
    $("wyDelete").disabled = !r;
    $("wyExtend").disabled = !r || !!D;
    $("wyName").disabled = !r;
    $("wyKind").value = r ? r.kind : fieldMap.wyNextKind || "road";
    if (document.activeElement !== $("wyName")) $("wyName").value = r ? r.name : "";
    const km = (px) => { const k = Number(S.map && S.map.settings && S.map.settings.kmPerPixel) || 0; return k ? `${Math.round(px * k).toLocaleString(S.lang === "EN" ? "en" : "sv")} km` : `${px.toFixed(1)} px`; };
    let info;
    if (D) info = T(D.extend != null ? "wyExtending" : "wyDrawing", fieldMap._wyDraftPoints().length);
    else if (r) {
      let len = 0;
      for (let i = 1; i < r.points.length; i++) len += Math.hypot((r.points[i].x - r.points[i - 1].x) * fieldMap.imgW, (r.points[i].y - r.points[i - 1].y) * fieldMap.imgH);
      const st = fieldMap.roadSteepness(r);
      info = T("wyInfoText", r.name || T("wyUnnamed"), T("wyKind_" + r.kind), km(len), st.max.toFixed(1), fieldMap.roadSteep[r.kind]);
      if (st.pieces.length) info += " · " + T("wySteepHere", st.pieces.length);
    } else info = T("wyStartHint", (fieldMap.roads || []).length);
    $("wyInfo").textContent = info;
  }
  // ── Cities ────────────────────────────────────────────────────────────
  // Placed and saved like the roads (cities.js): a moment after each change, with the same check against
  // changes saved elsewhere. A city on a road joins the roads through it; a road ended on a city joins it.
  let citySaveTimer = 0, citySaving = null;
  async function loadCities() {
    const map = S.map;
    clearTimeout(citySaveTimer); citySaveTimer = 0;
    S.citiesDirty = false; $("ctSave").textContent = T("ctSave");
    if (!map) { fieldMap.setCities([]); S.citiesRev = null; return; }
    try {
      const d = await api("GET", `/maps/${map.id}/cities?v=${Date.now()}`);
      if (S.map === map) { fieldMap.setCities(d.cities || []); S.citiesRev = d.rev || null; }
    } catch (e) { fieldMap.setCities([]); S.citiesRev = null; }
    if (window.Travel) Travel.roadsChanged();
  }
  function scheduleCitySave() {
    clearTimeout(citySaveTimer);
    citySaveTimer = setTimeout(() => { citySaveTimer = 0; if (S.citiesDirty) saveCities(); }, 1500);
  }
  async function saveCities(force) {
    if (!S.map || SG.suggesting) return;
    clearTimeout(citySaveTimer); citySaveTimer = 0;
    if (citySaving) { await citySaving; if (!S.citiesDirty) return; }
    const map = S.map, list = fieldMap.getCities();
    $("ctInfo").textContent = T("rvSaving");
    citySaving = (async () => {
      try {
        const rev = !force && S.citiesRev ? `?rev=${encodeURIComponent(S.citiesRev)}` : "";
        const r = await api("PUT", `/maps/${map.id}/cities${rev}`, list);
        if (S.map !== map) return;
        S.citiesRev = r && r.rev || null;
        if (JSON.stringify(fieldMap.getCities()) === JSON.stringify(list)) { S.citiesDirty = false; $("ctSave").textContent = T("ctSave"); }
        else scheduleCitySave();
        $("ctInfo").textContent = T("ctSaved");
      } catch (e) {
        if (e.status === 409 && S.map === map) {
          const pick = await ask({ title: T("ctConflictTitle"), text: T("ctConflictText"),
            buttons: [{ id: "mine", label: T("rvConflictMine"), primary: true }, { id: "theirs", label: T("rvConflictTheirs") }] });
          if (pick === "mine") { citySaving = null; return saveCities(true); }
          if (pick === "theirs") { await loadCities(); renderCityBar(); return; }
        }
        $("ctInfo").textContent = T("saveFailed") + e.message;
      }
    })();
    try { await citySaving; } finally { citySaving = null; }
  }
  function renderCityBar() {
    if ($("cityBar").hidden) return;
    const c = fieldMap.ctChosen ? fieldMap.ctChosen() : null;
    for (const id of ["ctName", "ctPopulation", "ctHarbour", "ctDelete"]) $(id).disabled = !c;
    const kind = c ? c.kind || "city" : fieldMap.ctNewDefaults.kind || "city";
    $("ctKind").value = kind;
    $("ctPopBox").hidden = $("ctHarbourBox").hidden = kind !== "city";
    $("ctFloodBox").hidden = kind !== "ford";
    if (document.activeElement !== $("ctFloodFrom")) $("ctFloodFrom").value = c && c.kind === "ford" ? c.floodFrom : "";
    if (document.activeElement !== $("ctFloodTo")) $("ctFloodTo").value = c && c.kind === "ford" ? c.floodTo : "";
    $("ctFloodFrom").disabled = $("ctFloodTo").disabled = !(c && c.kind === "ford");
    if (document.activeElement !== $("ctName")) $("ctName").value = c ? c.name : "";
    if (document.activeElement !== $("ctPopulation")) $("ctPopulation").value = c ? c.population : "";
    $("ctHarbour").checked = !!(c && c.harbour);
    const list = fieldMap.cities || [], harbours = list.filter((x) => x.harbour).length;
    $("ctInfo").textContent = c && c.kind === "bridge" ? T("ctInfoBridge", c.name || T("ctKind_bridge")) : c && c.kind === "ford" ? T("ctInfoFord", c.name || T("ctKind_ford")) : c ? T("ctInfoText", c.name || T("ctUnnamed"), (c.population || 0).toLocaleString(S.lang === "EN" ? "en" : "sv")) : T("ctStartHint", list.length, harbours);
  }
  function wireCities() {
    $("ctName").oninput = (e) => fieldMap.ctSetName(e.target.value);
    $("ctKind").onchange = (e) => { fieldMap.ctSetKind(e.target.value); renderCityBar(); };
    $("ctFloodFrom").onchange = $("ctFloodTo").onchange = () => fieldMap.ctSetFlood($("ctFloodFrom").value, $("ctFloodTo").value);
    $("ctPopulation").oninput = (e) => fieldMap.ctSetPopulation(e.target.value);
    $("ctHarbour").onchange = (e) => { fieldMap.ctSetHarbour(e.target.checked); fieldMap.ctNewDefaults.harbour = e.target.checked; };
    $("ctDelete").onclick = async () => {
      const c = fieldMap.ctChosen();
      if (!c) return;
      if (!(await ask({ title: T("ctDelete"), text: T("ctDeleteText", c.name || T("ctUnnamed")), buttons: [{ id: "yes", label: T("ctDelete"), primary: true }] }))) return;
      fieldMap.ctDelete();
    };
    $("ctSave").onclick = () => saveCities();
    $("ctExport").onclick = async () => {
      if (S.citiesDirty) await saveCities();
      const a = document.createElement("a");
      a.href = `/weather/api/maps/${S.map.id}/cities?download=1&v=${Date.now()}`;
      document.body.append(a); a.click(); a.remove();
    };
    window.addEventListener("keydown", (e) => {
      if (!S.editing || $("editMode").value !== "city" || /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
      if (e.key === "Escape") { if (fieldMap.ctCancel()) { e.preventDefault(); renderCityBar(); } }
      else if (e.key === "Delete" && fieldMap.ctSel != null) $("ctDelete").click();
    });
    $("stage").addEventListener("pointerup", () => { if (S.editing && $("editMode").value === "city") setTimeout(renderCityBar, 0); });
  }
  function wireRoads() {
    $("wyNew").onclick = () => { fieldMap.wyNew(); renderRoadBar(); $("stage").focus(); };
    $("wyKind").onchange = (e) => { fieldMap.wySetKind(e.target.value); renderRoadBar(); };
    $("wyName").oninput = (e) => fieldMap.wySetName(e.target.value);
    $("wyExtend").onclick = () => { if (fieldMap.wyExtend("tail")) { renderRoadBar(); $("stage").focus(); } };
    $("wyDelete").onclick = async () => {
      const r = fieldMap.wyChosen();
      if (!r) return;
      if (!(await ask({ title: T("wyDelete"), text: T("wyDeleteText", r.name || T("wyUnnamed")), buttons: [{ id: "yes", label: T("wyDelete"), primary: true }] }))) return;
      fieldMap.wyDelete();
    };
    $("wySave").onclick = () => saveRoads();
    $("wyExport").onclick = async () => {
      if (S.roadsDirty) await saveRoads();
      const a = document.createElement("a");
      a.href = `/weather/api/maps/${S.map.id}/roads?download=1&v=${Date.now()}`;
      document.body.append(a); a.click(); a.remove();
    };
    window.addEventListener("keydown", (e) => {
      if (!S.editing || $("editMode").value !== "road" || /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
      if (e.key === "Enter" && fieldMap.wyDrafting()) { e.preventDefault(); fieldMap.wyFinish(); renderRoadBar(); }
      else if (e.key === "Escape") { if (fieldMap.wyCancel()) { e.preventDefault(); renderRoadBar(); } }
      else if (e.key === "Delete" && fieldMap.wySel != null) $("wyDelete").click();
    });
    $("stage").addEventListener("pointerup", () => { if (S.editing && $("editMode").value === "road") setTimeout(renderRoadBar, 0); });
  }
  function wireRivers() {
    const setSize = (v) => { v = Math.max(1, Math.min(10, Math.round(+v) || 1)); $("rvSize").value = v; $("rvSizeNum").value = v; fieldMap.rvSetSize(v); renderRiverBar(); };
    $("rvSize").oninput = (e) => setSize(e.target.value);
    $("rvSizeNum").oninput = (e) => { if (e.target.value !== "" && +e.target.value >= 1 && +e.target.value <= 10) setSize(e.target.value); };
    $("rvSizeNum").onchange = (e) => setSize(e.target.value);
    $("rvName").oninput = (e) => fieldMap.rvSetName(e.target.value);
    $("rvSpeed").onchange = (e) => { fieldMap.rvSetSpeed(e.target.value === "" ? null : String(e.target.value).replace(",", ".")); renderRiverBar(); };
    $("rvNew").onclick = () => { fieldMap.rvNew(); renderRiverBar(); $("stage").focus(); };
    $("rvExtend").onclick = () => { if (fieldMap.rvExtend("tail")) { renderRiverBar(); $("stage").focus(); } };
    $("lkNew").onclick = () => { fieldMap.lkNew(); renderRiverBar(); $("stage").focus(); };
    $("lkOut").onclick = () => { if (fieldMap.lkOutflow()) { renderRiverBar(); $("stage").focus(); } };
    $("rvSuggest").onchange = () => { S.rvSuggest = $("rvSuggest").checked; saveState(); updateSuggestions(); };
    $("rvSuggestAmt").onchange = () => { S.rvSuggestAmt = $("rvSuggestAmt").value; saveState(); updateSuggestions(); };
    $("rvDelete").onclick = async () => {
      const lake = (fieldMap.lakes || []).find((x) => x.id === fieldMap.lkSel);
      if (lake) {
        if (!(await ask({ title: T("lkDelete"), text: T("lkDeleteText", lake.name || T("lkUnnamed")), buttons: [{ id: "yes", label: T("lkDelete"), primary: true }] }))) return;
        fieldMap.rvDelete();
        return;
      }
      const r = (fieldMap.rivers || []).find((x) => x.id === fieldMap.rvSel);
      if (!r) return;
      if (!(await ask({ title: T("rvDelete"), text: T("rvDeleteText", r.name || T("rvUnnamed")), buttons: [{ id: "yes", label: T("rvDelete"), primary: true }] }))) return;
      fieldMap.rvDelete();
    };
    $("rvSave").onclick = () => saveRivers();
    $("rvExport").onclick = async () => {
      if (S.riversDirty) await saveRivers();
      const a = document.createElement("a");
      a.href = `/weather/api/maps/${S.map.id}/rivers?download=1&v=${Date.now()}`;
      document.body.append(a); a.click(); a.remove();
    };
    window.addEventListener("keydown", (e) => {
      if (!S.editing || $("editMode").value !== "river" || /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
      if (e.key === "Enter" && fieldMap.rvDrafting()) { e.preventDefault(); fieldMap.rvFinish(null); renderRiverBar(); }
      else if (e.key === "Escape") { if (fieldMap.rvCancel()) { e.preventDefault(); renderRiverBar(); } }
      else if (e.key === "Delete" && (fieldMap.rvSel != null || fieldMap.lkSel != null)) $("rvDelete").click();
    });
    // the bar's text follows the drawing as points are added
    $("stage").addEventListener("pointerup", () => { if (S.editing && $("editMode").value === "river") setTimeout(renderRiverBar, 0); });
  }

  /**
   * Map layers ("Kartbild"): which of the detailed regional maps lie over the base map. S.mapLayers is
   * the chosen ids, or null for the default ones (as the zoom images are made). Only shown when the
   * map's zoom images come with layers.
   */
  /** The order of the map layers (bottom first): the standard map's, also for a map that borrows its zoom images. */
  function layerOrderFor(map) {
    const def = map && map.isDefault ? map : (S.maps || []).find((m) => m.isDefault);
    const o = def && def.settings && def.settings.layerOrder;
    return Array.isArray(o) ? o : null;
  }
  /** Admins: move a layer one place in the list (a place further down lies over the ones above); saved for everyone. */
  async function moveMapLayer(id, dir) {
    const ids = fieldMap.tileLayers().map((v) => v.id), i = ids.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      const m = await api("PUT", `/maps/${S.map.id}/layer-order`, { order: ids });
      S.map.settings = m.settings;
      const d = (S.maps || []).find((x) => x.id === S.map.id);
      if (d) d.settings = m.settings;
      fieldMap.setLayerOrder(ids);
      renderMapViews();
    } catch (e) { setStatus(e.message); }
  }
  function renderMapViews() {
    let layers = [];
    try { layers = fieldMap.tileLayers(); } catch (e) { return; } // called before the map exists
    const box = $("mapLayerBox"), list = $("mapLayerList");
    if (!box || !list) return;
    box.hidden = !layers.length;
    if (!layers.length) return;
    const lang = S.lang === "EN" ? "en" : "sv";
    const on = new Set(S.mapLayers || layers.filter((v) => v.def).map((v) => v.id));
    list.innerHTML = "";
    const canOrder = !!(S.admin && S.map && S.map.isDefault);   // only the admins set the order, and only on the standard map
    for (const v of layers) {
      const lab = document.createElement("label");
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = on.has(v.id);
      cb.onchange = () => {
        const set = new Set(S.mapLayers || layers.filter((x) => x.def).map((x) => x.id));
        cb.checked ? set.add(v.id) : set.delete(v.id);
        setMapLayers(layers.filter((x) => set.has(x.id)).map((x) => x.id));
      };
      const name = document.createElement("span");
      name.textContent = typeof v.name === "string" ? v.name : (v.name[lang] || v.name.sv || v.id);
      lab.append(cb, name);
      if (canOrder) {
        const idx = layers.indexOf(v), moves = document.createElement("span");
        moves.className = "ml-moves";
        const mk = (txt, title, dir, off) => {
          const b = document.createElement("button"); b.type = "button"; b.className = "ml-move"; b.textContent = txt; b.title = title; b.disabled = off;
          b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); moveMapLayer(v.id, dir); };
          return b;
        };
        moves.append(mk("▲", T("mlUp"), -1, idx === 0), mk("▼", T("mlDown"), 1, idx === layers.length - 1));
        lab.append(moves);
      }
      list.append(lab);
    }
    const hint = document.createElement("div"); hint.className = "ml-hint"; hint.textContent = T("mlHint") + (canOrder ? " " + T("mlAdminHint") : "");
    list.append(hint);
    const n = layers.filter((v) => on.has(v.id)).length, isDef = layers.every((v) => v.def === on.has(v.id));
    $("mapLayerSummary").textContent = isDef ? T("mlSumDefault") : n === 0 ? T("mlSumNone") : T("mlSumSome", n, layers.length);
  }
  function setMapLayers(ids) {
    S.mapLayers = ids;
    fieldMap.setTileLayers(ids);
    renderMapViews();
    saveState();
  }
  /** Zoom tiles a map can borrow: those of the built-in maps (same world, same framing). */
  function renderTileChoices() {
    const sel = $("mapTiles");
    if (!sel || !S.map) return;
    sel.innerHTML = "";
    sel.add(new Option(T("tilesNone"), ""));
    const seen = new Set();
    (S.maps || []).forEach((m) => {
      const t = m.settings && m.settings.tiles;
      if (typeof t === "string" && !seen.has(t)) { seen.add(t); sel.add(new Option(T("tilesFrom", m.name), t)); }
    });
    const cur = S.map.settings && S.map.settings.tiles;
    if (cur && !seen.has(cur)) sel.add(new Option(cur, cur));
    sel.value = cur || "";
    $("tilesBox").hidden = !S.map.mine || S.map.isDefault || sel.options.length < 2;
  }
  /** Edit bar: placing region points, or drawing leylines. */
  function applyEditMode() {
    // a suggestion is for one layer only (sending forest values as heights would wreck the ground)
    if (SG.suggesting && $("editMode").value !== SG.layer) $("editMode").value = SG.layer;
    const mode = $("editMode").value, regions = mode === "regions", forest = mode === "forest" || mode === "ice" || mode === "marsh", height = mode === "height" || forest;
    $("editBar").classList.toggle("mode-forest", forest);
    // the brush value is kept separately for heights, forest density and ice cover
    S.hpVals = S.hpVals || { height: 140, forest: 60, ice: 100, marsh: 100 };
    S.hpVals[fieldMap.hpTarget || "height"] = +$("hpValue").value;
    fieldMap.hpSetTarget(forest ? mode : "height");
    $("anchorRegionBox").hidden = !regions; $("unplacedBox").hidden = !regions; $("leyAspectBox").hidden = regions || height;
    $("zoneNew").hidden = mode !== "zone";
    $("heightBar").hidden = !height;
    $("hpTreeLineBox").hidden = $("hpTreeClear").hidden = $("hpTreeShowBox").hidden = $("hpTreeTempBox").hidden = mode !== "forest";
    $("hpTreeTemp").checked = S.treeTemp !== false; fieldMap.hpSettings().treeTemp = S.treeTemp !== false;
    $("hpTreeShow").checked = !!S.showTreeLine; fieldMap.hpSettings().showTreeLine = !!S.showTreeLine;
    $("hpTreeLine").value = S.treeLine != null ? S.treeLine : 3000;
    fieldMap.hpSettings().treeLine = S.treeLine != null ? S.treeLine : 3000;
    $("editBar").classList.toggle("mode-height", height);
    const river = mode === "river", nation = mode === "nation", range = mode === "range", road = mode === "road", city = mode === "city";
    $("cityBar").hidden = !city;
    $("rangeBar").hidden = !range;
    $("riverBar").hidden = !river;
    $("roadBar").hidden = !road;
    $("nationBar").hidden = !nation;
    $("editBar").classList.toggle("mode-river", river || nation || range || road || city);
    if (road) { $("leyAspectBox").hidden = true; renderRoadBar(); }
    if (city) { $("leyAspectBox").hidden = true; renderCityBar(); }
    if (range) { $("leyAspectBox").hidden = true; renderRangeBar(); }
    if (river) { $("leyAspectBox").hidden = true; renderRiverBar(); }
    updateSuggestions();
    if (nation) { $("leyAspectBox").hidden = true; renderNationBar(); }
    $("editHint").hidden = height;                       // the painter's help sits in its tooltip instead
    $("heightBar").title = height ? T("heightHint") : "";
    $("editHint").textContent = T(mode === "ley" ? "leyHint" : mode === "zone" ? "zoneHint" : height ? "heightHint" : river ? "rvHint" : nation ? "ntHint" : range ? "rgHint" : road ? "wyHint" : city ? "ctHint" : "editHint");
    if (height) $("heightBar").title = forest ? T(LK[mode].hint) : T("heightHint");
    fieldMap.setEditMode(forest ? "height" : mode);   // forest and ice are painted with the height painter
    // painting heights works on the base height map; elsewhere the chosen one (base or calculated) is shown
    if (mode === "height" && fieldMap.heightSource && fieldMap.heightSource._derived && S.heightBase) { fieldMap.setHeightImage(S.heightBase); derivedKey = null; }
    if (height) openHeightPainter();
    if (mode !== "height") applyHeightPick();
    fieldMap.setLeyAspect($("leyAspect").value);
  }
  /**
   * The aspect filter next to the Kraftlinjer switch: tick which aspects' leylines to show.
   * Aspects with lines on this map come first, with how many lines each has.
   */
  function renderLeyFilter() {
    const list = $("leyAspectList");
    if (!list || !S.world) return;
    const aspects = [...new Set(Object.values(S.world.forces || {}).flat())];
    const count = {};
    fieldMap.getLeylines().forEach((l) => { count[l.aspect] = (count[l.aspect] || 0) + 1; });
    fieldMap.getZones().forEach((z) => { count[z.aspect] = (count[z.aspect] || 0) + 1; });
    const hidden = new Set(S.leyHidden || []);
    const ordered = aspects.filter((a) => count[a]).concat(aspects.filter((a) => !count[a]));
    list.innerHTML = "";
    ordered.forEach((a) => {
      const lab = document.createElement("label");
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !hidden.has(a);
      cb.onchange = () => {
        const h = new Set(S.leyHidden || []);
        cb.checked ? h.delete(a) : h.add(a);
        setLeyHidden([...h]);
      };
      const c = FieldMap.leyColour(a), i = document.createElement("i");
      i.style.background = c === "rainbow" ? "linear-gradient(90deg,#f55,#fd4,#5d5,#5cf,#a6f)" : c;
      if (a === "Skototropi") i.style.boxShadow = "0 0 4px #ddd";
      const name = document.createElement("span"); name.textContent = a;
      const n = document.createElement("span"); n.className = "count"; n.textContent = count[a] ? count[a] : "";
      lab.append(cb, i, name, n);
      list.append(lab);
    });
    const shown = aspects.filter((a) => !hidden.has(a)).length;
    $("leyFilterSummary").textContent = shown === aspects.length ? T("leyAllAspects")
      : shown === 0 ? T("leyNoAspects") : T("leySomeAspects", shown, aspects.length);
  }
  function setLeyHidden(list) {
    S.leyHidden = list;
    fieldMap.setLeyHidden(list);
    renderLeyFilter(); renderLegend(); saveState();
    if (popupAt) refreshPopup();
  }
  function renderLeyAspects() {
    const sel = $("leyAspect"), keep = sel.value;
    sel.innerHTML = "";
    const aspects = [...new Set(Object.values(S.world.forces || {}).flat())];
    aspects.forEach((a) => sel.add(new Option(a, a)));
    if (aspects.includes(keep)) sel.value = keep;
    else if (aspects.includes("Pyrotropi")) sel.value = "Pyrotropi";
  }
  async function uploadMap(file, replace) {
    if (!file) return;
    const name = replace ? null : await ask({ title: T("newMap"), input: { label: T("mapName") }, value: file.name.replace(/\.[^.]+$/, "") });
    if (!replace && !name) return;
    try {
      const m = replace
        ? await api("PUT", `/maps/${S.map.id}/image`, file, file.type || true)
        : await api("POST", "/maps" + q({ name, public: "false" }), file, file.type || true);
      S.mapId = m.id;
      await loadMaps();
      if (!replace) setEditing(true);
      saveState();
    } catch (e) { await ask({ title: T("uploadMap"), text: e.message, buttons: [] }); }
  }
