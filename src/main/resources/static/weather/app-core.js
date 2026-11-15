// Eon Weather – the page, part 1 of 7: state, the API, the controls, the clock, the day and month views, notes, dialogs, the account.
// The app-*.js files are loaded in this order by index.html and share one scope (they are one program in parts:
// app-core.js, app-maps.js, app-painter.js, app-suggestions.js, app-layers.js, app-view.js, app-start.js).
"use strict";
  const $ = (id) => document.getElementById(id);

  // ── State ─────────────────────────────────────────────────────────────
  const S = {
    world: null, user: null, lang: "SV",
    region: null, year: 2977, month: 1, day: 1, calendar: 0,
    campaignId: 0, campaigns: [],
    comments: {}, campaignNotes: {},
    maps: [], mapId: null, map: null, anchorsDirty: false, editing: false,
    layers: ["cloud", "rain", "magic", "night", "ley", "zone", "river", "range", "nation", "ice", "marsh", "city", "road", "trip"], leyHidden: [], hour: 12, opacity: 1, mySymbols: {}, rainFx: true, cloudFx: true,
    fieldCache: new Map(), fieldPending: new Map(), hourF: 12,
    dayData: null, monthData: null, field: null,
  };
  const T = (k, ...a) => {
    let s = (I18N[S.lang] && I18N[S.lang][k]) ?? I18N.SV[k] ?? k;
    a.forEach((v, i) => { s = String(s).split(`{${i}}`).join(v); });   // every {i}, taken literally
    return s;
  };
  const dateKey = (y = S.year, m = S.month, d = S.day) => `${y}-${m}-${d}`;
  const fmtT = (t) => `${t >= 0 ? "" : "−"}${Math.abs(t).toFixed(1)}°`;
  const isMagic = (e) => /magistorm|högmagisk|alstra/i.test(e);
  const isHoly = (e) => /(heligaste|helig|ohelig|oheligaste|holiest|holy|unholy|unholiest) (dag|day)/i.test(e);
  // Holy-day entries look like "Religion - Heligaste dag: Name" (SV) or "Religion - Holiest day: Name" (EN)
  const isHoliest = (e) => /\s-\s(heligaste dag|holiest day):/i.test(e);
  const isHolyDay = (e) => /\s-\s(helig dag|holy day):/i.test(e);
  // Religion filter: holy days of other religions are hidden when one religion is chosen.
  const religionOf = (e) => { const i = e.indexOf(" - "); return i > 0 ? e.slice(0, i).trim() : null; };
  const showEvent = (e) => !S.religion || !isHoly(e) || religionOf(e) === S.religion;

  // ── API ───────────────────────────────────────────────────────────────
  async function api(method, path, body, raw) {
    const opt = { method, headers: {}, credentials: "same-origin" };
    if (method !== "GET") opt.headers["X-Eon-Request"] = "1";
    if (body !== undefined) {
      if (raw) { opt.body = body; if (raw !== true) opt.headers["Content-Type"] = raw; }
      else { opt.body = JSON.stringify(body); opt.headers["Content-Type"] = "application/json"; }
    }
    const res = await fetch("/weather/api" + path, opt);
    const type = res.headers.get("Content-Type") || "";
    const data = type.includes("json") ? await res.json() : await res.text();
    if (!res.ok) {
      const err = new Error((data && data.error) || res.statusText);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  const q = (o) => "?" + new URLSearchParams(o).toString();
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // ── Persisted UI state ────────────────────────────────────────────────
  function snapshot() {
    return { region: S.region, year: S.year, month: S.month, day: S.day, lang: S.lang, calendar: S.calendar,
      campaignId: S.campaignId, mapId: S.mapId, layers: S.layers, hour: S.hour, opacity: S.opacity,
      rainFx: S.rainFx, cloudFx: S.cloudFx, religion: S.religion, leyHidden: S.leyHidden, riversKnown: true, nationsKnown: true, rangesKnown: true, roadsKnown: true, marshKnown: true, cityKnown: true, treeLine: S.treeLine, showTreeLine: !!S.showTreeLine, treeTemp: S.treeTemp !== false, mapLayers: S.mapLayers || null, w3Rivers: S.w3Rivers !== false, heightPick: S.heightPick || "base", rvSuggest: !!S.rvSuggest, rvSuggestAmt: S.rvSuggestAmt || "many", travel: S.travel || null };
  }
  function applySnapshot(s) {
    if (!s) return;
    if (s.region && S.world.regions.some((r) => r.name === s.region)) S.region = s.region;
    if (Number.isInteger(s.year)) S.year = s.year;
    if (s.month >= 1 && s.month <= 12) S.month = s.month;
    if (s.day >= 1 && s.day <= 28) S.day = s.day;
    if (s.lang === "EN" || s.lang === "SV") S.lang = s.lang;
    if (Number.isInteger(s.calendar)) S.calendar = s.calendar;
    if (Array.isArray(s.layers)) S.layers = s.layers;
    // the rivers layer came later: on for anyone whose saved choice is from before it existed
    if (Array.isArray(s.layers) && !s.riversKnown && !S.layers.includes("river")) S.layers = [...S.layers, "river"];
    if (Array.isArray(s.layers) && !s.nationsKnown && !S.layers.includes("nation")) S.layers = [...S.layers, "nation"];
    if (Array.isArray(s.layers) && !s.rangesKnown && !S.layers.includes("range")) S.layers = [...S.layers, "range"];
    // ice, roads and journeys came in 2.01: shown from the start
    if (Array.isArray(s.layers) && !s.roadsKnown) S.layers = [...new Set([...S.layers, "ice", "road", "trip"])];
    if (Array.isArray(s.layers) && !s.marshKnown && !S.layers.includes("marsh")) S.layers = [...S.layers, "marsh"];   // marshland came later: shown from the start
    if (Array.isArray(s.layers) && !s.cityKnown && !S.layers.includes("city")) S.layers = [...S.layers, "city"];   // cities came later: shown from the start
    if (Number.isFinite(s.treeLine)) S.treeLine = s.treeLine;
    if (typeof s.showTreeLine === "boolean") S.showTreeLine = s.showTreeLine;
    if (typeof s.treeTemp === "boolean") S.treeTemp = s.treeTemp;
    if (Number.isInteger(s.hour)) S.hour = s.hour;
    if (typeof s.opacity === "number" && s.opacity >= 0.1 && s.opacity <= 1) S.opacity = s.opacity;
    if (typeof s.rainFx === "boolean") S.rainFx = s.rainFx;
    if (typeof s.cloudFx === "boolean") S.cloudFx = s.cloudFx;
    if (Array.isArray(s.leyHidden)) S.leyHidden = s.leyHidden.filter((a) => typeof a === "string");
    if (s.campaignId != null) S.campaignId = s.campaignId;
    if (s.mapId != null) S.mapId = s.mapId;
    if (s.heightPick === "calc" || s.heightPick === "base") S.heightPick = s.heightPick;
    S.rvSuggest = !!s.rvSuggest; S.rvSuggestAmt = s.rvSuggestAmt || "many";
    if (s.travel && typeof s.travel === "object") S.travel = s.travel;
    if (typeof s.w3Rivers === "boolean") S.w3Rivers = s.w3Rivers;
    if (Array.isArray(s.mapLayers)) S.mapLayers = s.mapLayers.filter((v) => typeof v === "string");
    S.religion = typeof s.religion === "string" && (S.world.religions || []).includes(s.religion) ? s.religion : null;
  }
  let saveStateTimer = 0;
  function saveState() {
    clearTimeout(saveStateTimer);
    saveStateTimer = setTimeout(() => {
      saveStateTimer = 0;
      const snap = snapshot();
      try { localStorage.setItem("eon-weather-state", JSON.stringify(snap)); } catch (e) { /* storage unavailable */ }
      if (S.user) api("PUT", "/state", snap).catch(() => {});
      if (S.user && S.campaignId) {
        api("PUT", `/campaigns/${S.campaignId}`, { region: S.region, year: S.year, month: S.month, day: S.day }).catch(() => {});
      }
    }, 600);
  }

  // ── Static text ───────────────────────────────────────────────────────
  function applyText() {
    document.documentElement.lang = S.lang === "EN" ? "en" : "sv";
    document.title = T("title");
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = T(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = T(el.dataset.i18nTitle); });
    $("editHint").textContent = T({ ley: "leyHint", zone: "zoneHint", height: "heightHint" }[$("editMode").value] || "editHint");
    renderLeyFilter();
    renderMapViews();
    $("lang").textContent = S.lang === "EN" ? "Svenska" : "English";
    const ms = $("month"), cur = S.month;
    ms.innerHTML = "";
    for (let m = 1; m <= 12; m++) ms.add(new Option(`${T("month")} ${m}`, m));
    ms.value = cur;
    $("play").title = playing ? T("pause") : T("play");
    $("editMap").textContent = S.editing ? T("doneEditing") : T("editMap");
    renderAccount();
    renderCampaignSelect();
    renderSgButton();
    if (SG.open) renderSgPanel();
    if (SG.suggesting) renderSuggestNote();
  }

  // ── Controls ──────────────────────────────────────────────────────────
  function fillControls() {
    const rs = $("region");
    rs.innerHTML = "";
    S.world.regions.forEach((r) => rs.add(new Option(r.custom ? `${r.name} (${T(r.custom === "new" ? "rdCustomNew" : "rdCustomChanged")})` : r.name, r.name)));
    renderAnchorRegions();
    const cs = $("calendar");
    cs.innerHTML = "";
    S.world.calendars.forEach((c, i) => cs.add(new Option(c, i)));
    const ds = $("day");
    ds.innerHTML = "";
    for (let d = 1; d <= 28; d++) ds.add(new Option(d, d));
    document.querySelectorAll(".layers input[value]").forEach((cb) => { cb.checked = S.layers.includes(cb.value); });
    $("rainFx").checked = S.rainFx; $("cloudFx").checked = S.cloudFx;
    syncFxToggles();
    $("hour").value = S.hour;
    $("opacity").value = S.opacity;
    const rel = $("religion"), religions = S.world.religions || [];
    rel.innerHTML = "";
    religions.forEach((r) => rel.add(new Option(r, r)));
    document.querySelector(".religion-filter").hidden = religions.length === 0;
    syncReligion();
  }
  function syncReligion() {
    $("allReligions").checked = !S.religion;
    $("religion").hidden = !S.religion;
    if (S.religion) $("religion").value = S.religion;
  }
  function religionChanged() {
    syncReligion();
    saveState();
    renderDay();
    renderMonth();
  }
  function syncControls() {
    $("region").value = S.region;
    $("year").value = S.year;
    $("month").value = S.month;
    $("day").value = S.day;
    $("calendar").value = S.calendar;
  }

  function step(days) {
    let serial = (S.year - 1) * 336 + (S.month - 1) * 28 + S.day + days;
    const s = serial - 1;
    S.year = Math.floor(s / 336) + 1;
    const r = ((s % 336) + 336) % 336;
    S.month = Math.floor(r / 28) + 1;
    S.day = (r % 28) + 1;
    dateChanged();
  }

  async function dateChanged(opts = {}) {
    flushNotes();
    syncControls();
    saveState();
    const monthKey = `${S.region}|${S.year}|${S.month}|${S.lang}`;
    const jobs = [loadDay()];
    if (opts.forceMonth || S._monthKey !== monthKey) { S._monthKey = monthKey; jobs.push(loadMonth()); }
    else renderMonth();
    jobs.push(loadField());
    await Promise.all(jobs);
    showNotes();
  }

  async function loadDay() {
    const req = { region: S.region, year: S.year, month: S.month, day: S.day, lang: S.lang };
    const token = (S._dayToken = JSON.stringify(req));
    try {
      const d = await api("GET", "/day" + q(req));
      if (token !== S._dayToken) return;
      S.dayData = d;
      renderDay();
    } catch (e) { $("dateText").textContent = e.message; }
  }
  async function loadMonth() {
    try {
      S.monthData = await api("GET", "/month" + q({ region: S.region, year: S.year, month: S.month, lang: S.lang }));
      renderMonth();
    } catch (e) { /* the day view shows errors */ }
  }
  // ── The running clock: day serial + hour/24. Yesterday, today and tomorrow stay loaded. ──
  const serialOf = (y, m, d) => (y - 1) * 336 + (m - 1) * 28 + d;
  const curSerial = () => serialOf(S.year, S.month, S.day);
  function dateOfSerial(serial) {
    const s = serial - 1, y = Math.floor(s / 336) + 1, r = ((s % 336) + 336) % 336;
    return { year: y, month: Math.floor(r / 28) + 1, day: (r % 28) + 1 };
  }
  function fetchField(serial) {
    const key = serial + "|" + S.lang;
    if (S.fieldCache.has(key)) return Promise.resolve(S.fieldCache.get(key));
    if (S.fieldPending.has(key)) return S.fieldPending.get(key);
    const d = dateOfSerial(serial);
    const p = api("GET", "/field" + q({ year: d.year, month: d.month, day: d.day, lang: S.lang }))
      .then((f) => { S.fieldCache.set(key, f); S.fieldPending.delete(key); return f; })
      .catch((e) => { S.fieldPending.delete(key); throw e; });
    S.fieldPending.set(key, p);
    return p;
  }
  function pushFieldsToMap() {
    const now = curSerial(), m = new Map();
    for (const [key, f] of S.fieldCache) {
      const [ser, lang] = key.split("|");
      if (lang !== S.lang) continue;
      if (Math.abs(+ser - now) > 3) { S.fieldCache.delete(key); continue; } // keep the cache small
      m.set(+ser, f);
    }
    fieldMap.setFields(m);
    S.field = m.get(now) || S.field;
  }
  async function loadField() {
    const now = curSerial();
    fieldMap.setTime(now + S.hourF / 24);
    try {
      await fetchField(now);
      pushFieldsToMap();
      renderLegend();
      if (popupAt) refreshPopup();
      // yesterday and tomorrow (and the day after while playing) load in the background
      const more = [now - 1, now + 1].concat(playing ? [now + 2] : []);
      Promise.allSettled(more.map(fetchField)).then(() => { pushFieldsToMap(); if (popupAt) refreshPopup(); });
    } catch (e) { /* map just keeps what it has */ }
  }

  // ── Day view ──────────────────────────────────────────────────────────
  function renderDay() {
    const d = S.dayData;
    if (!d) return;
    d.events = d.events.filter((e) => e && e.trim());
    $("regionName").textContent = d.region;
    const cal = d.dates[S.calendar] || d.dates[0];
    $("dateText").textContent = cal ? cal.text : dateKey();
    $("temp").textContent = fmtT(d.temperature);
    $("wind").textContent = `${d.wind} ${d.direction}`;
    $("windName").textContent = `${d.windName} · ${d.windMs} m/s`;
    $("rain").textContent = d.rain;
    $("rainName").textContent = d.rainName;
    const ul = $("events");
    ul.innerHTML = "";
    const events = d.events.filter(showEvent);
    if (!events.length) {
      const li = document.createElement("li"); li.className = "none"; li.textContent = T("noEvents"); ul.append(li);
    }
    events.forEach((e) => {
      const li = document.createElement("li");
      li.textContent = e;
      if (isMagic(e)) li.className = "magic";
      else if (isHoliest(e)) li.className = "holiest";
      else if (isHoly(e)) li.className = "holy";
      ul.append(li);
    });
    $("influx").textContent = d.influx ? `${S.lang === "EN" ? "Influx" : "Inflöde"}: ${d.influx}` : "";
    renderInfluxBar(d.aspects || []);
    drawHourly();
  }

  /** Year, month, week and day influx aspects next to the calendar picker; matching ones are highlighted. */
  function renderInfluxBar(aspects) {
    const bar = $("influxBar");
    bar.innerHTML = "";
    if (!aspects.length) { bar.hidden = true; return; }
    bar.hidden = false;
    const count = {};
    aspects.forEach((a) => { count[a] = (count[a] || 0) + 1; });
    const labels = T("influxLevels");
    aspects.forEach((a, i) => {
      const chip = document.createElement("span");
      chip.className = "influx-chip" + (count[a] > 1 ? " match" : "");
      chip.title = `${T("influxTitle")} – ${labels[i]}: ${a}` + (count[a] > 1 ? ` (+${(count[a] - 1) * 3})` : "");
      const lvl = document.createElement("small"); lvl.textContent = labels[i];
      chip.append(lvl);
      const sym = fieldMap.symbols && fieldMap.symbols[a];
      if (sym && sym.src) { const img = document.createElement("img"); img.src = sym.src; img.alt = ""; chip.append(img); }
      chip.append(document.createTextNode(a));
      bar.append(chip);
    });
  }

  function drawHourly() {
    showLocalTime();
    const d = S.dayData;
    const cv = $("hourly");
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    cv.width = w * dpr; cv.height = h * dpr;
    const c = cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    if (!d) return;
    const L = 30, R = 8, top = 10, bot = 20, H = h - top - bot, W = w - L - R;
    const temps = d.hourly.temperature, winds = d.hourly.wind, rains = d.hourly.rain;
    let lo = Math.min(...temps), hi = Math.max(...temps);
    if (hi - lo < 4) { const m = (hi + lo) / 2; lo = m - 2; hi = m + 2; }
    lo = Math.floor(lo - 1); hi = Math.ceil(hi + 1);
    const xAt = (i) => L + (i + 0.5) * W / 24;
    const yAt = (t) => top + (hi - t) / (hi - lo) * H;
    c.font = "11px 'Alegreya Sans', sans-serif";
    c.fillStyle = "#7d8e9b";
    c.strokeStyle = "rgba(125,142,155,0.25)";
    c.lineWidth = 1;
    const ticks = 4;
    for (let k = 0; k <= ticks; k++) {
      const t = lo + (hi - lo) * k / ticks, y = yAt(t);
      c.beginPath(); c.moveTo(L, y); c.lineTo(w - R, y); c.stroke();
      c.textAlign = "right"; c.fillText(Math.round(t) + "°", L - 5, y + 4);
    }
    c.textAlign = "center";
    for (let i = 0; i < 24; i += 3) c.fillText(String(i).padStart(2, "0"), xAt(i), h - 5);
    const bw = W / 24 * 0.36;
    const maxWind = Math.max(8, ...winds);
    for (let i = 0; i < 24; i++) {
      const wh = winds[i] / maxWind * H * 0.55;
      c.fillStyle = "rgba(125,142,155,0.55)";
      c.fillRect(xAt(i) - bw, top + H - wh, bw, wh);
      const rh = Math.min(rains[i], 8) / 8 * H * 0.55;
      c.fillStyle = "rgba(111,180,214,0.75)";
      c.fillRect(xAt(i), top + H - rh, bw, rh);
    }
    c.strokeStyle = "#c9a24a"; c.lineWidth = 2; c.lineJoin = "round";
    c.beginPath();
    temps.forEach((t, i) => (i ? c.lineTo(xAt(i), yAt(t)) : c.moveTo(xAt(i), yAt(t))));
    c.stroke();
    // current hour marker, tied to the map's hour slider
    const lh = Math.floor(localHour()) % 24;          // the region's own clock
    const hx = xAt(lh);
    c.strokeStyle = "rgba(231,225,209,0.5)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(hx, top); c.lineTo(hx, top + H); c.stroke();
    c.fillStyle = "#e7e1d1";
    c.beginPath(); c.arc(hx, yAt(temps[lh]), 3.5, 0, Math.PI * 2); c.fill();
  }

  // ── Month grid ────────────────────────────────────────────────────────
  function renderMonth() {
    $("monthTitle").textContent = `${T("month")} ${S.month}, ${S.year}`;
    const g = $("monthGrid");
    g.innerHTML = "";
    const days = S.monthData || [];
    const firstSerial = (S.year - 1) * 336 + (S.month - 1) * 28 + 1;
    const head = document.createElement("span"); g.append(head);
    for (let i = 0; i < 7; i++) {
      const dow = document.createElement("span");
      dow.className = "dow";
      dow.textContent = T("days")[((firstSerial - 1 + i) % 7 + 7) % 7];
      g.append(dow);
    }
    const notes = { ...S.comments, ...S.campaignNotes };
    for (let w = 0; w < 4; w++) {
      const wk = document.createElement("span"); wk.className = "wk"; wk.textContent = `${T("week")} ${w + 1}`; g.append(wk);
      for (let i = 0; i < 7; i++) {
        const dn = w * 7 + i + 1, info = days[dn - 1];
        const b = document.createElement("button");
        b.className = "cell" + (dn === S.day ? " sel" : "");
        b.setAttribute("role", "gridcell");
        b.setAttribute("aria-label", `${T("month")} ${S.month}, ${dn}`);
        b.innerHTML = `<span class="n">${dn}</span>`;
        if (info) {
          b.innerHTML += `<span class="t">${Math.round(info.temperature)}°</span>`;
          if (info.rain > 0) b.innerHTML += `<span class="rainbar" style="height:${Math.min(info.rain, 6) / 6 * 45}%"></span>`;
          const marks = document.createElement("span"); marks.className = "marks";
          const evs = info.events.filter((e) => e && e.trim() && showEvent(e));
          if (evs.some(isHoliest)) b.classList.add("holiest");
          else if (evs.some(isHolyDay)) b.classList.add("holy");
          if (evs.some(isMagic)) marks.innerHTML += '<i class="mk mg"></i>';
          else if (evs.length) marks.innerHTML += '<i class="mk ev"></i>';
          if (notes[dateKey(S.year, S.month, dn)]) marks.innerHTML += '<i class="mk nt"></i>';
          b.append(marks);
          b.title = evs.join("\n");
        }
        b.addEventListener("click", () => { S.day = dn; dateChanged(); });
        g.append(b);
      }
    }
  }

  // ── Notes & campaigns ─────────────────────────────────────────────────
  let noteTimer = 0, pending = null;
  function setStatus(t) { $("notesStatus").textContent = t; }

  function showNotes() {
    const locked = !S.user;
    document.querySelector(".notes").classList.toggle("locked", locked);
    if (locked) { setStatus(T("loginToSave")); return; }
    if ($("notesStatus").textContent === T("loginToSave")) setStatus("");
    $("comment").value = S.comments[dateKey()] || "";
    $("campaignNote").value = S.campaignNotes[dateKey()] || "";
    $("campaignNote").hidden = !S.campaignId;
    $("renameCampaign").disabled = $("deleteCampaign").disabled = !S.campaignId;
  }
  function queueNote(campaign, el) {
    const key = dateKey(), text = el.value;
    if (campaign) S.campaignNotes[key] = text; else S.comments[key] = text;
    pending = { campaign, key, text };
    clearTimeout(noteTimer);
    noteTimer = setTimeout(flushNotes, 800);
  }
  function flushNotes() {
    clearTimeout(noteTimer);
    if (!pending || !S.user) { pending = null; return; }
    const p = pending; pending = null;
    setStatus(T("saving"));
    api("PUT", "/notes", { campaign: p.campaign, date: p.key, text: p.text })
      .then(() => { setStatus(T("saved")); renderMonth(); })
      .catch((e) => setStatus(T("saveFailed") + e.message));
  }

  async function loadNotes() {
    if (!S.user) { S.comments = {}; S.campaignNotes = {}; return; }
    const [c, cn] = await Promise.all([
      api("GET", "/notes?campaign=0"),
      S.campaignId ? api("GET", `/notes?campaign=${S.campaignId}`).catch(() => ({})) : Promise.resolve({}),
    ]);
    S.comments = c; S.campaignNotes = cn;
  }
  async function loadCampaigns() {
    S.campaigns = S.user ? await api("GET", "/campaigns") : [];
    if (!S.campaigns.some((c) => c.id === S.campaignId)) S.campaignId = 0;
    renderCampaignSelect();
  }
  function renderCampaignSelect() {
    const sel = $("campaign");
    sel.innerHTML = "";
    sel.add(new Option(T("noCampaign"), 0));
    S.campaigns.forEach((c) => sel.add(new Option(c.name, c.id)));
    sel.value = S.campaignId;
  }
  async function switchCampaign(id) {
    flushNotes();
    S.campaignId = id;
    const c = S.campaigns.find((x) => x.id === id);
    if (c && c.year != null) {
      S.year = c.year; S.month = c.month; S.day = c.day;
      if (c.region && S.world.regions.some((r) => r.name === c.region)) S.region = c.region;
    }
    await loadNotes();
    await dateChanged({ forceMonth: true });
  }

  // ── Small dialogs ─────────────────────────────────────────────────────
  function ask({ title, text, input, value, buttons, cancel: withCancel }) {
    return new Promise((resolve) => {
      const dlg = $("promptDialog");
      $("promptTitle").textContent = title;
      const body = $("promptBody");
      body.innerHTML = "";
      if (text) { const p = document.createElement("p"); p.textContent = text; body.append(p); }
      let inp = null;
      if (input) {
        const lab = document.createElement("label"); lab.className = "field stack";
        lab.innerHTML = `<span></span>`; lab.firstChild.textContent = input.label;
        inp = document.createElement(input.multiline ? "textarea" : "input");
        if (input.multiline) { inp.rows = 4; inp.maxLength = input.maxLength || 2000; } else inp.type = input.type || "text";
        inp.value = value || "";
        if (input.autocomplete) inp.autocomplete = input.autocomplete;
        lab.append(inp); body.append(lab);
        if (input.second) {
          const lab2 = document.createElement("label"); lab2.className = "field stack";
          lab2.innerHTML = `<span></span>`; lab2.firstChild.textContent = input.second.label;
          const inp2 = document.createElement("input"); inp2.type = input.second.type || "text";
          lab2.append(inp2); body.append(lab2); inp._second = inp2;
        }
      }
      const acts = $("promptActions");
      acts.innerHTML = "";
      // (the dialog's close event comes a moment later: by then another box may be using the dialog)
      const finish = (v) => { dlg.onclose = null; dlg.close(); resolve(v); };
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = T("cancel");
      cancel.onclick = () => finish(null);
      if (withCancel !== false) acts.append(cancel);           // (cancel: false – a box whose own buttons are all the choices)
      const sp = document.createElement("div"); sp.className = "spacer"; acts.prepend(sp);
      (buttons || [{ id: "ok", label: T("ok"), primary: true }]).forEach((b) => {
        const el = document.createElement("button"); el.type = b.primary ? "submit" : "button";
        el.textContent = b.label; if (b.primary) el.className = "primary";
        el.onclick = (ev) => {
          ev.preventDefault();
          if (inp && !input.optional && !inp.value.trim()) { inp.focus(); return; }
          finish(inp ? (inp._second ? [inp.value, inp._second.value] : inp.value.trim()) : b.id);
        };
        acts.append(el);
      });
      dlg.onclose = () => { if (!dlg.open) resolve(null); };   // (a late close event from the box before is ignored)
      dlg.showModal();
      (inp || acts.lastChild).focus();
    });
  }

  // ── Account ───────────────────────────────────────────────────────────
  function renderAccount() {
    const box = $("account");
    box.innerHTML = "";
    if (S.user) {
      const menu = document.createElement("details"); menu.className = "menu";
      const sum = document.createElement("summary"); sum.textContent = S.user.username;
      const list = document.createElement("div"); list.className = "menu-list";
      const pw = document.createElement("button"); pw.textContent = T("changePassword");
      pw.onclick = () => { menu.open = false; changePassword(); };
      const out = document.createElement("button"); out.textContent = T("logout");
      out.onclick = async () => { menu.open = false; flushNotes(); await api("POST", "/logout"); await afterAuth(null); };
      list.append(pw, out);
      menu.append(sum, list);
      box.append(menu);
    } else {
      const login = document.createElement("button"); login.className = "primary"; login.textContent = T("login");
      login.onclick = () => openAuth();
      box.append(login);
    }
  }
  // Accounts are shared with Root and Rune: logging in and registering happen on the start page (/),
  // which sends the visitor back here afterwards.
  function openAuth() {
    flushNotes();
    location.href = "/?next=" + encodeURIComponent(location.pathname);
  }
  async function changePassword() {
    const r = await ask({ title: T("changePassword"),
      input: { label: T("oldPassword"), type: "password", autocomplete: "current-password",
        second: { label: T("newPassword"), type: "password" } } });
    if (!r) return;
    try {
      const res = await fetch("/api/auth/password", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current: r[0], password: r[1] }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) || {}).error || res.statusText);
      setStatus(T("passwordChanged"));
    }
    catch (e) { await ask({ title: T("changePassword"), text: e.message, buttons: [] }); }
  }
  async function afterAuth(me) {
    S.user = me && me.user ? me.user : null;
    S.admin = !!(me && me.admin);
    $("regionAdmin").hidden = !S.admin;
    // the server repaired its database file (or a backup failed): tell the admins once per page load
    if (S.admin && me.dbNotice && !S.dbNoticeShown) {
      S.dbNoticeShown = true;
      setTimeout(() => ask({ title: T("dbNoticeTitle"), text: me.dbNotice, buttons: [{ id: "ok", label: "OK", primary: true }] }), 800);
    }
    if (me && me.state) { applySnapshot(me.state); }
    loadTrips();                                          // whose journeys can be seen depends on who is logged in
    fieldMap.setLeyHidden(S.leyHidden || []);
    if (!S.user) { S.campaignId = 0; }
    renderAccount();
    await loadCampaigns();
    await loadNotes();
    await loadMaps();
    applyText();
    fillControls();
    fieldMap.setLayers(S.layers);
    fieldMap.setOpacity(S.opacity);
    setHour(S.hour);
    $("symbolsBtn").hidden = !S.user;
    if (S.admin) checkTiles();
    await dateChanged({ forceMonth: true });
  }
