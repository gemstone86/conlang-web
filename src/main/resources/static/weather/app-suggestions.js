// Eon Weather – the page, part 4 of 7: suggested changes: to the height map and to the other layers.
// The app-*.js files are loaded in this order by index.html and share one scope (they are one program in parts:
// app-core.js, app-maps.js, app-painter.js, app-suggestions.js, app-layers.js, app-view.js, app-start.js).
"use strict";
  // ── Height map suggestions ────────────────────────────────────────────
  // Anyone with an account can paint a change and send it as a suggestion; everyone sees them; the map's
  // owner (for the default map: the admins) accepts or rejects them. A suggestion is a patch: the
  // rectangle around what was painted, with the new heights and which pixels changed.
  // data: the height map's suggestions, ldata: the other layers' (selId / lselId: the chosen one of either)
  const SG = { open: false, data: null, filter: "open", selId: null, sel: null, mode: "after", suggesting: false, replaces: null, baseRev: 0, msg: "",
    layer: "height", ldata: null, lselId: null, lsel: null, base: null };
  const sgUrl = (path = "") => `/maps/${S.map.id}/suggestions${path}`;
  async function loadSuggestions() {
    const map = S.map;
    if (!map) { SG.data = null; SG.ldata = null; renderSgButton(); if (SG.open) openSgPanel(false); syncSgOverlay(); return; }
    const [h, l] = await Promise.all([
      map.hasHeight ? api("GET", sgUrl()).catch(() => null) : null,
      api("GET", lsgUrl()).catch(() => null)]);
    if (S.map !== map) return;
    SG.data = h; SG.ldata = l;
    if (SG.sel && !(SG.data && SG.data.items.some((i) => i.id === SG.sel.id))) { SG.sel = null; SG.selId = null; }
    if (SG.lselId != null && !lsgItem(SG.lselId)) { SG.lsel = null; SG.lselId = null; }
    renderSgButton();
    if (SG.open) renderSgPanel();
    syncSgOverlay();
  }
  function renderSgButton() {
    const b = $("sgBtn");
    b.hidden = !S.map;
    const n = (SG.data ? SG.data.items.filter((i) => i.status === "open").length : 0) + (SG.ldata ? SG.ldata.items.filter((i) => i.status === "open").length : 0);
    b.textContent = T("sgBtn") + (n ? ` (${n})` : "");
    b.classList.toggle("active", SG.open);
  }
  function openSgPanel(on) {
    SG.open = on;
    $("sgPanel").hidden = !on;
    $("stage").classList.toggle("sg-open", on);
    if (on) { closePopup(); renderSgPanel(); } else { SG.selId = null; SG.sel = null; SG.lselId = null; SG.lsel = null; }
    syncSgOverlay();
    renderSgButton();
  }
  const sgItems = () => (SG.data ? SG.data.items.filter((i) => SG.filter === "all" || i.status === "open") : []);
  const sgItem = (id) => (SG.data ? SG.data.items.find((i) => i.id === id) : null);
  function syncSgOverlay() {
    fieldMap.setLayerSuggestion(SG.open && !SG.suggesting && SG.lsel ? SG.lsel : null, SG.mode);
    if (!SG.open || !SG.data || SG.suggesting) { fieldMap.setSuggestions([], null); return; }
    const list = sgItems().map((i) => ({ id: i.id, x: i.x, y: i.y, w: i.w, h: i.h, status: i.status }));
    const sel = SG.sel && sgItem(SG.sel.id);
    if (sel && !list.some((r) => r.id === sel.id)) list.push({ id: sel.id, x: sel.x, y: sel.y, w: sel.w, h: sel.h, status: sel.status });
    fieldMap.setSuggestions(list, SG.sel, SG.mode);
  }
  function sgMsg(t) { SG.msg = t || ""; $("sgMsg").textContent = SG.msg; }
  /** Height-map pixels → km² (with the map's scale), or null. */
  function sgArea(px) {
    const kpp = Number(S.map && S.map.settings && S.map.settings.kmPerPixel) || 0, src = fieldMap.heightSource;
    if (!kpp || !src) return null;
    const k = kpp * S.map.width / (src.naturalWidth || src.width);
    return px * k * k;
  }
  const sgAreaText = (px) => { const a = sgArea(px); return a == null ? T("sgPixels", fmtInt(px)) : T("sgKm2", fmtInt(a < 100 ? Math.round(a) : Math.round(a / 10) * 10)); };
  const sgSteps = (n) => (fieldMap.metersPerStep ? T("sgMetres", fmtInt(n * fieldMap.metersPerStep)) : T("sgStepsN", n));
  const sgDate = (iso) => { try { return new Date(iso).toLocaleDateString(S.lang === "EN" ? "en-GB" : "sv-SE", { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return iso; } };
  const sgWho = (name) => name || T("sgGone");
  function sgBadges(i) {
    const out = [`<span class="sg-badge ${i.status}">${esc(T("sgStatus_" + i.status))}</span>`];
    if (i.toLand || i.toSea) out.push(`<span class="sg-badge coast">${esc(T("sgCoast"))}</span>`);
    if (i.status === "open" && i.conflicts && i.conflicts.length) out.push(`<span class="sg-badge warn">${esc(T("sgConflictShort"))}</span>`);
    if (i.votes) out.push(`<span class="sg-badge">👍 ${i.votes}</span>`);
    return out.join("");
  }
  function renderSgPanel() {
    const d = SG.data;
    $("sgFilter").value = SG.filter;
    $("sgNew").hidden = !S.user;
    $("sgExport").hidden = !(d && d.canReview);
    if (d) $("sgExport").textContent = T("sgExport", d.rev);
    $("sgMsg").textContent = SG.msg || (S.user ? "" : T("sgLoginHint"));
    const list = $("sgList");
    list.innerHTML = "";
    // the height map's and the other layers' suggestions together, newest first
    const items = [...sgItems().map((i) => ({ i, layer: "height" })), ...lsgItems().map((i) => ({ i, layer: i.layer }))]
      .sort((a, b) => (a.i.createdAt < b.i.createdAt ? 1 : a.i.createdAt > b.i.createdAt ? -1 : 0));
    if (!items.length) {
      const li = document.createElement("li"); li.className = "sg-empty";
      li.textContent = T(SG.filter === "open" ? "sgNoneOpen" : "sgNone");
      list.append(li);
    }
    items.forEach(({ i, layer }) => {
      const li = document.createElement("li"), b = document.createElement("button"), h = layer === "height";
      b.type = "button";
      b.setAttribute("aria-current", String(h ? SG.selId === i.id : SG.lselId === i.id));
      b.innerHTML = `<span class="sg-top"><b>${esc(T("sgLayer_" + layer))} #${i.id}</b><span>${esc(sgWho(i.author))}</span><span>${esc(sgDate(i.createdAt))}</span></span>`
        + (i.comment ? `<span class="sg-com">${esc(i.comment)}</span>` : (!h && i.info && i.info.names && i.info.names.length ? `<span class="sg-com">${esc(i.info.names.join(", "))}</span>` : ""))
        + `<span class="sg-badges">${h ? sgBadges(i) : lsgBadges(i)}</span>`;
      b.onclick = () => (h ? selectSuggestion(i.id) : selectLayerSuggestion(i.id));
      li.append(b);
      list.append(li);
    });
    renderSgDetail();
  }
  function renderSgDetail() {
    if (SG.lselId != null) { renderLayerDetail(); return; }
    const box = $("sgDetail"), i = SG.selId != null ? sgItem(SG.selId) : null;
    box.hidden = !i;
    box.innerHTML = "";
    if (!i) return;
    const d = SG.data, open = i.status === "open";
    const h = document.createElement("h4"); h.textContent = T("sgDetailTitle", i.id); box.append(h);
    const meta = document.createElement("div"); meta.className = "sg-meta";
    meta.innerHTML = `${esc(T("sgBy", sgWho(i.author), sgDate(i.createdAt)))} · <span class="sg-badges" style="display:inline-flex">${sgBadges(i)}</span>`;
    box.append(meta);
    if (i.comment) { const p = document.createElement("p"); p.className = "sg-comment"; p.textContent = i.comment; box.append(p); }
    if (i.status !== "open" && i.status !== "withdrawn" && (i.reviewer || i.reply)) {
      const p = document.createElement("p"); p.className = "sg-reply";
      p.textContent = T("sgDecided", T("sgStatus_" + i.status).toLowerCase(), sgWho(i.reviewer), i.reviewedAt ? sgDate(i.reviewedAt) : "") + (i.reply ? "\n" + i.reply : "");
      box.append(p);
    }
    if (i.replacedBy) { const p = document.createElement("p"); p.className = "sg-note"; p.textContent = T("sgReplacedBy", i.replacedBy); box.append(p); }
    const dl = document.createElement("dl");
    const row = (k, v) => { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = k; dd.textContent = v; dl.append(dt, dd); };
    row(T("sgChanged"), sgAreaText(i.changed));
    if (i.raised) row(T("sgRaised"), T("sgUpTo", sgAreaText(i.raised), sgSteps(i.maxUp)));
    if (i.lowered) row(T("sgLowered"), T("sgUpTo", sgAreaText(i.lowered), sgSteps(i.maxDown)));
    if (i.toLand) row(T("sgToLand"), sgAreaText(i.toLand));
    if (i.toSea) row(T("sgToSea"), sgAreaText(i.toSea));
    box.append(dl);
    if (open && i.conflicts && i.conflicts.length) {
      const p = document.createElement("p"); p.className = "sg-warn"; p.textContent = T("sgConflict", i.conflicts.map((c) => "#" + c).join(", ")); box.append(p);
    }
    if (open && i.overlaps && i.overlaps.length) {
      const p = document.createElement("p"); p.className = "sg-note"; p.textContent = T("sgOverlap", i.overlaps.map((c) => "#" + c).join(", ")); box.append(p);
    }
    // before / after / difference
    const view = document.createElement("div"); view.className = "sg-view"; view.setAttribute("role", "radiogroup");
    [["before", "sgBefore"], ["after", "sgAfter"], ["diff", "sgDiff"]].forEach(([v, k]) => {
      const lab = document.createElement("label"), r = document.createElement("input");
      r.type = "radio"; r.name = "sgView"; r.value = v; r.checked = SG.mode === v;
      r.onchange = () => { SG.mode = v; syncSgOverlay(); renderSgLegend(); };
      lab.append(r, document.createTextNode(T(k)));
      view.append(lab);
    });
    box.append(view);
    const legend = document.createElement("div"); legend.className = "sg-legend"; legend.id = "sgLegend"; box.append(legend);
    renderSgLegend();
    // actions
    const acts = document.createElement("div"); acts.className = "sg-actions";
    const btn = (label, fn, cls) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; if (cls) b.className = cls; b.onclick = fn; acts.append(b); return b; };
    if (S.user && !i.mine && open) {
      const v = btn(`👍 ${i.votes || ""}`.trim(), () => sgVote(i), "vote");
      v.setAttribute("aria-pressed", String(!!i.voted)); v.title = T("sgVoteTip");
    }
    if (i.mine && open) btn(T("sgWithdraw"), () => sgWithdraw(i));
    if (d.canReview && open) {
      btn(T("sgAccept"), () => sgAccept(i), "primary");
      btn(T("sgReject"), () => sgReject(i));
      btn(T("sgEditFirst"), () => sgEditFirst(i)).title = T("sgEditFirstTip");
    }
    if (d.canReview && i.status === "accepted") btn(T("sgUndo"), () => sgUndo(i)).title = T("sgUndoTip");
    if (acts.childElementCount) box.append(acts);
  }
  function renderSgLegend() {
    const el = $("sgLegend");
    if (!el) return;
    el.innerHTML = SG.mode === "diff"
      ? `<i style="background:#ff2a2a"></i>${esc(T("sgHigher"))}<i style="background:#2a78ff"></i>${esc(T("sgLower"))}`
      : esc(T(SG.mode === "before" ? "sgShowingBefore" : "sgShowingAfter"));
  }
  async function selectSuggestion(id) {
    const i = sgItem(id);
    if (!i) return;
    if (!SG.open) openSgPanel(true);
    if (SG.filter === "open" && i.status !== "open") SG.filter = "all";
    SG.selId = id; SG.lselId = null; SG.lsel = null;
    renderSgPanel();
    fieldMap.showHeightRect(i.x, i.y, i.w, i.h);
    try {
      const blob = await (await fetch("/weather/api" + sgUrl(`/${id}/patch`), { credentials: "same-origin" })).blob();
      const p = await FieldMap.decodePatch(blob);
      // for an accepted (or undone) suggestion, "before" is what it replaced, not today's map
      let old = null;
      if (i.revApplied) {
        const r = await fetch("/weather/api" + sgUrl(`/${id}/old`), { credentials: "same-origin" });
        if (r.ok) old = (await FieldMap.decodePatch(await r.blob())).vals;
      }
      if (SG.selId !== id) return;
      SG.sel = { id, x: i.x, y: i.y, w: p.w, h: p.h, vals: p.vals, mask: p.mask, old };
    } catch (e) { SG.sel = null; sgMsg(e.message); }
    syncSgOverlay();
  }
  /** After the height map changed on the server: fetch it again, and the list. */
  async function sgHeightChanged() {
    if (fieldMap.hpClose) fieldMap.hpClose();
    try { const m = await api("GET", `/maps/${S.map.id}`); Object.assign(S.map, m); } catch (e) { /* keep */ }
    await loadHeight();
    await loadSuggestions();
  }
  async function sgVote(i) {
    try { const r = await api("POST", sgUrl(`/${i.id}/vote`), { on: !i.voted }); i.voted = !i.voted; i.votes = r.votes; renderSgPanel(); }
    catch (e) { sgMsg(e.message); }
  }
  async function sgWithdraw(i) {
    if (!(await ask({ title: T("sgWithdraw"), text: T("sgWithdrawText", i.id), buttons: [{ id: "yes", label: T("sgWithdraw"), primary: true }] }))) return;
    try { await api("POST", sgUrl(`/${i.id}/withdraw`), {}); sgMsg(T("sgWithdrawn", i.id)); await loadSuggestions(); }
    catch (e) { sgMsg(e.message); }
  }
  async function sgAccept(i) {
    const text = T("sgAcceptText", i.id) + (i.conflicts && i.conflicts.length ? "\n\n" + T("sgConflict", i.conflicts.map((c) => "#" + c).join(", ")) : "");
    const reply = await ask({ title: T("sgAcceptTitle", i.id), text, input: { label: T("sgReplyLabel"), optional: true, multiline: true },
      buttons: [{ id: "ok", label: T("sgAccept"), primary: true }] });
    if (reply === null) return;
    sgBusy(true);
    try {
      await api("POST", sgUrl(`/${i.id}/accept`), { reply });
      await sgHeightChanged();
      sgMsg(T("sgAcceptedMsg", i.id));
      selectSuggestion(i.id);
    } catch (e) { sgMsg(e.message); }
    finally { sgBusy(false); }
  }
  /** While the server works on the height map: buttons off and a note. */
  function sgBusy(on, msg) {
    document.querySelectorAll("#sgPanel .sg-actions button").forEach((b) => (b.disabled = on));
    if (on) sgMsg(T(msg || "sgWorking"));
  }
  async function sgReject(i) {
    const reply = await ask({ title: T("sgRejectTitle", i.id), text: T("sgRejectText"), input: { label: T("sgReplyLabel"), optional: true, multiline: true },
      buttons: [{ id: "ok", label: T("sgReject"), primary: true }] });
    if (reply === null) return;
    try { await api("POST", sgUrl(`/${i.id}/reject`), { reply }); sgMsg(T("sgRejectedMsg", i.id)); await loadSuggestions(); renderSgPanel(); }
    catch (e) { sgMsg(e.message); }
  }
  async function sgUndo(i) {
    if (!(await ask({ title: T("sgUndo"), text: T("sgUndoText", i.id), buttons: [{ id: "yes", label: T("sgUndo"), primary: true }] }))) return;
    sgBusy(true);
    try { await api("POST", sgUrl(`/${i.id}/undo`), {}); await sgHeightChanged(); sgMsg(T("sgUndoneMsg", i.id)); }
    catch (e) { sgMsg(e.message); }
    finally { sgBusy(false); }
  }
  async function sgEditFirst(i) {
    if (!SG.sel || SG.sel.id !== i.id) await selectSuggestion(i.id);
    if (!SG.sel) return;
    startSuggesting({ item: i, patch: SG.sel });
  }
  // painting a suggestion: the height painter, without the owner's tools, with "send" instead of "save"
  function renderSuggestNote() {
    const el = $("suggestNote");
    el.hidden = !SG.suggesting;
    if (SG.suggesting) el.innerHTML = SG.layer !== "height" ? T(SGL[SG.layer] ? "sgEditingLayer" : "sgPaintingLayer", esc(T("sgLayer_" + API_LAYER[SG.layer]).toLowerCase()))
      : SG.replaces != null ? T("sgPaintingEdit", "#" + SG.replaces) : T("sgPainting");
  }
  function startSuggesting(edit, layer = "height") {
    if (!S.user) { openAuth("login"); return; }
    if (!S.map) return;
    if (layer === "height" && (!S.map.hasHeight || !fieldMap.heightSource)) return;
    if (SGL[layer]) { startListSuggesting(layer); return; }
    if (S.editing) setEditing(false);
    SG.layer = layer;
    SG.suggesting = true;
    SG.replaces = edit ? edit.item.id : null;
    SG.baseRev = edit ? edit.item.baseRev : (SG.data ? SG.data.rev : 0);
    if (SG.open) openSgPanel(false);
    fieldMap.setSuggestions([], null);
    if (fieldMap.hpClose) fieldMap.hpClose();
    $("editMode").value = layer;
    $("editBar").classList.add("suggesting");
    $("hpSendAccept").hidden = !sgCanReview();
    $("sgListBar").hidden = true;
    renderSuggestNote();
    setEditing(true);
    if (edit) fieldMap.hpApplyPatch(edit.item.x, edit.item.y, edit.patch);
    if (layer === "height") markHeightDirty(false); else markForestDirty(false);
  }
  /** Leaves painting a suggestion (the painter's changes are dropped; the map's real height map comes back). */
  function endSuggestMode() {
    const layer = SG.layer, L = SGL[layer];
    if (L) S[L.dirty] = false;                 // the suggestion's edits never go to the layer itself
    SG.suggesting = false; SG.replaces = null; SG.base = null; SG.layer = "height";
    $("editBar").classList.remove("suggesting");
    $("sgListBar").hidden = true;
    renderSuggestNote();
    setEditing(false);
    if (fieldMap.hpClose) fieldMap.hpClose();
    // back to the layer as it is on the server
    return L ? L.load() : layer === "forest" ? loadForest() : layer === "ice" ? loadIce() : layer === "marsh" ? loadMarsh() : Promise.resolve();
  }
  async function cancelSuggesting() {
    const changed = SGL[SG.layer] ? lsgChanged() : fieldMap.hpCanUndo();
    if (changed && !(await ask({ title: T("sgCancel"), text: T("sgCancelText"), buttons: [{ id: "yes", label: T("sgCancel"), primary: true }] }))) return;
    const layer = SG.layer;
    await endSuggestMode();
    if (layer === "height") await loadHeight();
    openSgPanel(true);
  }
  async function sendSuggestion(andAccept) {
    if (SGL[SG.layer]) return sendListSuggestion(andAccept);
    if (SG.layer !== "height") return sendPaintedSuggestion(andAccept);
    const d = await fieldMap.hpDiffPatch();
    if (!d) { await ask({ title: T("sgSend"), text: T("sgNothing"), buttons: [] }); return; }
    const orig = SG.replaces != null ? sgItem(SG.replaces) : null;
    const comment = await ask({ title: T(andAccept ? "sgSendAcceptTitle" : "sgSendTitle"), text: T("sgSendText", sgAreaText(d.changed)),
      input: { label: T("sgCommentLabel"), optional: true, multiline: true }, value: orig && orig.comment ? orig.comment : "",
      buttons: [{ id: "ok", label: T(andAccept ? "sgSendAccept" : "sgSend").replace("…", ""), primary: true }] });
    if (comment === null) return;
    const btns = ["hpSend", "hpSendAccept", "hpSuggestCancel"].map($);
    btns.forEach((b) => (b.disabled = true));
    $("suggestNote").textContent = T("sgSending");
    try {
      const params = { x: d.x, y: d.y, baseRev: SG.baseRev, comment };
      if (SG.replaces != null) params.replaces = SG.replaces;
      const r = await api("POST", sgUrl() + q(params), d.blob, "image/png");
      if (andAccept) await api("POST", sgUrl(`/${r.id}/accept`), {});
      endSuggestMode();
      SG.msg = T(andAccept ? "sgAcceptedMsg" : "sgSentMsg", r.id);
      if (andAccept) await sgHeightChanged(); else { await loadHeight(); await loadSuggestions(); }
      openSgPanel(true);
      selectSuggestion(r.id);
    } catch (e) { renderSuggestNote(); await ask({ title: T("sgSend"), text: e.message, buttons: [] }); }
    finally { btns.forEach((b) => (b.disabled = false)); }
  }
  /** Accepted changes since the release's height map: the 3D view leaves its detailed terrain out there. */
  function sgChangedRects() {
    const since = Number(S.map && S.map.settings && S.map.settings.heightRev) || 0, src = fieldMap.heightSource;
    if (!SG.data || !src) return [];
    const k = S.map.width / (src.naturalWidth || src.width);
    return SG.data.items.filter((i) => i.status === "accepted" && i.revApplied > since)
      .map((i) => ({ x: i.x * k, y: i.y * k, w: i.w * k, h: i.h * k }));
  }
  function wireSuggestions() {
    $("sgBtn").onclick = () => openSgPanel(!SG.open);
    $("sgClose").onclick = () => openSgPanel(false);
    $("sgFilter").onchange = (e) => { SG.filter = e.target.value; renderSgPanel(); syncSgOverlay(); };
    $("sgNew").onclick = chooseSuggestLayer;
    $("sgLSend").onclick = () => sendSuggestion(false);
    $("sgLSendAccept").onclick = () => sendSuggestion(true);
    $("sgLCancel").onclick = cancelSuggesting;
    $("sgExport").onclick = () => {
      const a = document.createElement("a");
      a.href = `/weather/api/maps/${S.map.id}/height?download=1&v=${Date.now()}`;
      document.body.append(a); a.click(); a.remove();
    };
    $("hpSend").onclick = () => sendSuggestion(false);
    $("hpSendAccept").onclick = () => sendSuggestion(true);
    $("hpSuggestCancel").onclick = cancelSuggesting;
  }

  // ── Suggestions for the other layers: rivers, roads, ranges, nations (a change by id), forest, ice (painted) ──
  const lsgUrl = (path = "") => `/maps/${S.map.id}/layer-suggestions${path}`;
  // edit mode → the layer's name on the server, how to read it from the map, reload it, and its "unsaved" flag
  const SGL = {
    river: { api: "rivers", get: () => fieldMap.getRiverData(), load: () => loadRivers(), dirty: "riversDirty" },
    road: { api: "roads", get: () => fieldMap.getRoads(), load: () => loadRoads(), dirty: "roadsDirty" },
    range: { api: "ranges", get: () => fieldMap.getRanges(), load: () => loadRanges(), dirty: "rangesDirty" },
    nation: { api: "nations", get: () => fieldMap.getNations(), load: () => loadNations(), dirty: "nationsDirty" },
  };
  const API_LAYER = { river: "rivers", road: "roads", range: "ranges", nation: "nations", forest: "forest", ice: "ice", height: "height" };
  const MODE_OF = { rivers: "river", roads: "road", ranges: "range", nations: "nation", forest: "forest", ice: "ice", height: "height" };
  const sgCanReview = () => !!((SG.data && SG.data.canReview) || (SG.ldata && SG.ldata.canReview));
  const lsgItems = () => (SG.ldata ? SG.ldata.items.filter((i) => SG.filter === "all" || i.status === "open") : []);
  const lsgItem = (id) => (SG.ldata ? SG.ldata.items.find((i) => i.id === id) : null);
  function lsgBadges(i) {
    const out = [`<span class="sg-badge ${i.status}">${esc(T("sgStatus_" + i.status))}</span>`];
    if (i.votes) out.push(`<span class="sg-badge">👍 ${i.votes}</span>`);
    return out.join("");
  }
  /** "Föreslå en ändring": which layer. */
  async function chooseSuggestLayer() {
    if (!S.user) { openAuth("login"); return; }
    const layers = ["height", "forest", "ice", "river", "road", "range", "nation"].filter((l) => l !== "height" || (S.map && S.map.hasHeight && fieldMap.heightSource));
    const pick = await new Promise((resolve) => {
      const dlg = $("promptDialog"), body = $("promptBody"), acts = $("promptActions");
      $("promptTitle").textContent = T("sgChooseTitle");
      body.innerHTML = "";
      const p = document.createElement("p"); p.textContent = T("sgChooseText");
      const grid = document.createElement("div"); grid.className = "sg-choose";
      let done = false;
      const finish = (v) => { if (done) return; done = true; dlg.onclose = null; dlg.close(); resolve(v); };
      layers.forEach((l) => {
        const b = document.createElement("button"); b.type = "button"; b.textContent = T("sgLayer_" + API_LAYER[l]);
        b.onclick = () => finish(l);
        grid.append(b);
      });
      body.append(p, grid);
      acts.innerHTML = "";
      const sp = document.createElement("div"); sp.className = "spacer";
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = T("cancel");
      cancel.onclick = () => finish(null);
      acts.append(sp, cancel);
      dlg.onclose = () => { if (!dlg.open) finish(null); };
      dlg.showModal();
      grid.firstChild.focus();
    });
    if (pick) startSuggesting(null, pick);
  }
  /** Suggesting a change to a list layer: its own editor, but nothing is saved; "Skicka" sends the change. */
  function startListSuggesting(layer) {
    if (S.editing) setEditing(false);
    const L = SGL[layer];
    SG.layer = layer;
    SG.base = L.get();
    SG.suggesting = true;
    SG.replaces = null;
    if (SG.open) openSgPanel(false);
    fieldMap.setSuggestions([], null);
    $("editMode").value = layer;
    $("editBar").classList.add("suggesting");
    $("sgListBar").hidden = false;
    $("sgLSendAccept").hidden = !sgCanReview();
    renderSuggestNote();
    setEditing(true);
  }
  /** What changed against the layer as it was when suggesting began: { added, removed, changed: [{ before, after }] }. */
  function lsgDiff() {
    const base = SG.base || [], cur = SGL[SG.layer].get();
    const bm = new Map(base.map((i) => [i.id, i])), cm = new Map(cur.map((i) => [i.id, i]));
    const added = [], removed = [], changed = [];
    cur.forEach((i) => { const b = bm.get(i.id); if (!b) added.push(i); else if (JSON.stringify(b) !== JSON.stringify(i)) changed.push({ before: b, after: i }); });
    base.forEach((b) => { if (!cm.has(b.id)) removed.push(b); });
    return { added, removed, changed };
  }
  function lsgChanged() { const d = lsgDiff(); return d.added.length + d.removed.length + d.changed.length > 0; }
  async function sendLayerSuggestion(andAccept, summary, post) {
    const comment = await ask({ title: T(andAccept ? "sgSendAcceptTitle" : "sgSendTitle"), text: summary,
      input: { label: T("sgCommentLabel"), optional: true, multiline: true },
      buttons: [{ id: "ok", label: T(andAccept ? "sgSendAccept" : "sgSend").replace("…", ""), primary: true }] });
    if (comment === null) return;
    const btns = ["sgLSend", "sgLSendAccept", "sgLCancel", "hpSend", "hpSendAccept", "hpSuggestCancel"].map($);
    btns.forEach((b) => (b.disabled = true));
    $("suggestNote").textContent = T("sgSending");
    const layer = SG.layer;
    try {
      const r = await post(comment);
      if (andAccept) await api("POST", lsgUrl(`/${r.id}/accept`), {});
      await endSuggestMode();
      if (andAccept) await lsgLayerChanged(API_LAYER[layer]);
      SG.msg = T(andAccept ? "sgLAcceptedMsg" : "sgSentMsg", r.id);
      await loadSuggestions();
      openSgPanel(true);
      selectLayerSuggestion(r.id);
    } catch (e) { renderSuggestNote(); await ask({ title: T("sgSend"), text: e.message, buttons: [] }); }
    finally { btns.forEach((b) => (b.disabled = false)); }
  }
  function lsgSummary(info) {
    const parts = [];
    if (info.added) parts.push(T("sgAddedN", info.added));
    if (info.removed) parts.push(T("sgRemovedN", info.removed));
    if (info.changed) parts.push(T("sgChangedN", info.changed));
    return parts.join(", ");
  }
  async function sendListSuggestion(andAccept) {
    if (fieldMap.rvDraft || fieldMap.ntDrawing || fieldMap.rgDrawing || (fieldMap.wyDrafting && fieldMap.wyDrafting())) {
      await ask({ title: T("sgSend"), text: T("sgFinishFirst"), buttons: [] }); return;
    }
    const diff = lsgDiff(), layer = SG.layer;
    if (!diff.added.length && !diff.removed.length && !diff.changed.length) { await ask({ title: T("sgSend"), text: T("sgNothing"), buttons: [] }); return; }
    const summary = T("sgSendListText", T("sgLayer_" + API_LAYER[layer]).toLowerCase(),
      lsgSummary({ added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length }));
    await sendLayerSuggestion(andAccept, summary, (comment) => api("POST", lsgUrl(), { layer: API_LAYER[layer], comment, diff }));
  }
  async function sendPaintedSuggestion(andAccept) {
    const d = await fieldMap.hpDiffPatch();
    if (!d) { await ask({ title: T("sgSend"), text: T("sgNothing"), buttons: [] }); return; }
    const layer = SG.layer;
    await sendLayerSuggestion(andAccept, T("sgSendText", lsgAreaText(d.changed, d.iw)),
      (comment) => api("POST", lsgUrl() + q({ layer, x: d.x, y: d.y, iw: d.iw, ih: d.ih, comment }), d.blob, "image/png"));
  }
  /** Pixels of a painted layer (iw wide) → km², or pixels. */
  function lsgAreaText(px, iw) {
    const kpp = Number(S.map && S.map.settings && S.map.settings.kmPerPixel) || 0;
    if (!kpp || !iw) return T("sgPixels", fmtInt(px));
    const k = kpp * S.map.width / iw, a = px * k * k;
    return T("sgKm2", fmtInt(a < 100 ? Math.round(a) : Math.round(a / 10) * 10));
  }
  /** A layer changed on the server (a suggestion accepted or undone): fetch it again. */
  async function lsgLayerChanged(apiLayer) {
    if (apiLayer === "forest" || apiLayer === "ice") {
      try { const m = await api("GET", `/maps/${S.map.id}`); Object.assign(S.map, m); } catch (e) { /* keep */ }
      if (fieldMap.hpClose) fieldMap.hpClose();
      await (apiLayer === "ice" ? loadIce() : loadForest());
    } else await SGL[MODE_OF[apiLayer]].load();
    if (apiLayer === "rivers" || apiLayer === "ranges") scheduleDerived();
  }
  async function selectLayerSuggestion(id) {
    const i = lsgItem(id);
    if (!i) return;
    if (!SG.open) openSgPanel(true);
    if (SG.filter === "open" && i.status !== "open") SG.filter = "all";
    SG.lselId = id; SG.selId = null; SG.sel = null; SG.lsel = null;
    renderSgPanel();
    syncSgOverlay();
    try {
      const r = await fetch("/weather/api" + lsgUrl(`/${id}/data`), { credentials: "same-origin" });
      if (!r.ok) throw new Error(r.statusText);
      let sel;
      if (i.layer === "forest" || i.layer === "ice") {
        const p = await FieldMap.decodePatch(await r.blob());
        sel = { id, layer: i.layer, x: i.x, y: i.y, w: p.w, h: p.h, iw: i.iw, ih: i.ih, vals: p.vals, mask: p.mask };
        fieldMap.showNormRect(i.x / i.iw, i.y / i.ih, (i.x + i.w) / i.iw, (i.y + i.h) / i.ih);
      } else {
        sel = { id, layer: i.layer, diff: await r.json() };
        const b = i.info && i.info.box;
        if (b) fieldMap.showNormRect(b[0], b[1], b[2], b[3]);
      }
      if (SG.lselId !== id) return;
      SG.lsel = sel;
    } catch (e) { SG.lsel = null; sgMsg(e.message); }
    syncSgOverlay();
  }
  function renderLayerDetail() {
    const box = $("sgDetail"), i = lsgItem(SG.lselId);
    box.hidden = !i;
    box.innerHTML = "";
    if (!i) return;
    const d = SG.ldata, open = i.status === "open", painted = i.layer === "forest" || i.layer === "ice";
    const h = document.createElement("h4"); h.textContent = T("sgLayerDetailTitle", T("sgLayer_" + i.layer), i.id); box.append(h);
    const meta = document.createElement("div"); meta.className = "sg-meta";
    meta.innerHTML = `${esc(T("sgBy", sgWho(i.author), sgDate(i.createdAt)))} · <span class="sg-badges" style="display:inline-flex">${lsgBadges(i)}</span>`;
    box.append(meta);
    if (i.comment) { const p = document.createElement("p"); p.className = "sg-comment"; p.textContent = i.comment; box.append(p); }
    if (i.status !== "open" && i.status !== "withdrawn" && (i.reviewer || i.reply)) {
      const p = document.createElement("p"); p.className = "sg-reply";
      p.textContent = T("sgDecided", T("sgStatus_" + i.status).toLowerCase(), sgWho(i.reviewer), i.reviewedAt ? sgDate(i.reviewedAt) : "") + (i.reply ? "\n" + i.reply : "");
      box.append(p);
    }
    const dl = document.createElement("dl"), info = i.info || {};
    const row = (k, v) => { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = k; dd.textContent = v; dl.append(dt, dd); };
    if (painted) {
      row(T("sgChanged"), lsgAreaText(info.changed || 0, i.iw));
      if (info.more) row(T(i.layer === "ice" ? "sgMoreIce" : "sgMoreForest"), lsgAreaText(info.more, i.iw));
      if (info.less) row(T(i.layer === "ice" ? "sgLessIce" : "sgLessForest"), lsgAreaText(info.less, i.iw));
    } else {
      if (info.added) row(T("sgAdded"), String(info.added));
      if (info.removed) row(T("sgRemoved"), String(info.removed));
      if (info.changed) row(T("sgChangedItems"), String(info.changed));
      if (info.names && info.names.length) row(T("sgNames"), info.names.join(", "));
    }
    box.append(dl);
    const view = document.createElement("div"); view.className = "sg-view"; view.setAttribute("role", "radiogroup");
    [["before", "sgBefore"], ["after", "sgAfter"], ["diff", painted ? "sgDiff" : "sgBoth"]].forEach(([v, k]) => {
      const lab = document.createElement("label"), r = document.createElement("input");
      r.type = "radio"; r.name = "sgView"; r.value = v; r.checked = SG.mode === v;
      r.onchange = () => { SG.mode = v; syncSgOverlay(); renderLayerLegend(i); };
      lab.append(r, document.createTextNode(T(k)));
      view.append(lab);
    });
    box.append(view);
    const legend = document.createElement("div"); legend.className = "sg-legend"; legend.id = "sgLegend"; box.append(legend);
    renderLayerLegend(i);
    const acts = document.createElement("div"); acts.className = "sg-actions";
    const btn = (label, fn, cls) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; if (cls) b.className = cls; b.onclick = fn; acts.append(b); return b; };
    if (S.user && !i.mine && open) {
      const v = btn(`👍 ${i.votes || ""}`.trim(), () => lsgAct(i, "vote"), "vote");
      v.setAttribute("aria-pressed", String(!!i.voted)); v.title = T("sgVoteTip");
    }
    if (i.mine && open) btn(T("sgWithdraw"), () => lsgAct(i, "withdraw"));
    if (d.canReview && open) {
      btn(T("sgAccept"), () => lsgAct(i, "accept"), "primary");
      btn(T("sgReject"), () => lsgAct(i, "reject"));
    }
    if (d.canReview && i.status === "accepted") btn(T("sgUndo"), () => lsgAct(i, "undo")).title = T("sgLayerUndoTip");
    if (acts.childElementCount) box.append(acts);
  }
  function renderLayerLegend(i) {
    const el = $("sgLegend");
    if (!el) return;
    const painted = i.layer === "forest" || i.layer === "ice";
    if (painted) el.innerHTML = SG.mode === "diff"
      ? `<i style="background:#2fbf4f"></i>${esc(T(i.layer === "ice" ? "sgMoreIce" : "sgMoreForest"))}<i style="background:#ef4f4f"></i>${esc(T(i.layer === "ice" ? "sgLessIce" : "sgLessForest"))}`
      : esc(T(SG.mode === "before" ? "sgShowingBeforeL" : "sgShowingAfterL"));
    else el.innerHTML = (SG.mode !== "after" ? `<i style="background:#ef4f4f"></i>${esc(T("sgOldLines"))}` : "")
      + (SG.mode !== "before" ? `<i style="background:#3fd16a"></i>${esc(T("sgNewLines"))}` : "");
  }
  async function lsgAct(i, action) {
    let body = {};
    if (action === "vote") body = { on: !i.voted };
    else if (action === "withdraw") {
      if (!(await ask({ title: T("sgWithdraw"), text: T("sgWithdrawText", i.id), buttons: [{ id: "yes", label: T("sgWithdraw"), primary: true }] }))) return;
    } else if (action === "accept" || action === "reject") {
      const reply = await ask({ title: T(action === "accept" ? "sgAcceptTitle" : "sgRejectTitle", i.id),
        text: action === "accept" ? T("sgLayerAcceptText", i.id, T("sgLayer_" + i.layer).toLowerCase()) : T("sgLRejectText"),
        input: { label: T("sgReplyLabel"), optional: true, multiline: true },
        buttons: [{ id: "ok", label: T(action === "accept" ? "sgAccept" : "sgReject"), primary: true }] });
      if (reply === null) return;
      body = { reply };
    } else if (action === "undo") {
      if (!(await ask({ title: T("sgUndo"), text: T("sgLayerUndoText", i.id), buttons: [{ id: "yes", label: T("sgUndo"), primary: true }] }))) return;
    }
    sgBusy(true, "sgLWorking");
    try {
      const r = await api("POST", lsgUrl(`/${i.id}/${action}`), body);
      if (action === "vote") { i.voted = !i.voted; i.votes = r.votes; renderSgPanel(); return; }
      if (action === "accept" || action === "undo") await lsgLayerChanged(i.layer);
      await loadSuggestions();
      sgMsg(T({ withdraw: "sgWithdrawn", reject: "sgRejectedMsg", accept: "sgLAcceptedMsg", undo: "sgLUndoneMsg" }[action], i.id));
      renderSgPanel();
      syncSgOverlay();
    } catch (e) { sgMsg(e.message); }
    finally { sgBusy(false); }
  }
