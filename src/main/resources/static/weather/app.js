(function () {
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
      rainFx: S.rainFx, cloudFx: S.cloudFx, religion: S.religion, leyHidden: S.leyHidden, riversKnown: true, nationsKnown: true, rangesKnown: true, roadsKnown: true, marshKnown: true, cityKnown: true, treeLine: S.treeLine, showTreeLine: !!S.showTreeLine, mapLayers: S.mapLayers || null, w3Rivers: S.w3Rivers !== false, heightPick: S.heightPick || "base", rvSuggest: !!S.rvSuggest, rvSuggestAmt: S.rvSuggestAmt || "many", travel: S.travel || null };
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

  // ── Maps ──────────────────────────────────────────────────────────────
  let popupAt = null;
  const fieldMap = new FieldMap($("stage"), $("mapCanvas"), {
    fxCanvas: $("fxCanvas"),
    sunRegion: () => S.region,
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
    if (document.activeElement !== $("ctName")) $("ctName").value = c ? c.name : "";
    if (document.activeElement !== $("ctPopulation")) $("ctPopulation").value = c ? c.population : "";
    $("ctHarbour").checked = !!(c && c.harbour);
    const list = fieldMap.cities || [], harbours = list.filter((x) => x.harbour).length;
    $("ctInfo").textContent = c ? T("ctInfoText", c.name || T("ctUnnamed"), (c.population || 0).toLocaleString(S.lang === "EN" ? "en" : "sv")) : T("ctStartHint", list.length, harbours);
  }
  function wireCities() {
    $("ctName").oninput = (e) => fieldMap.ctSetName(e.target.value);
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
    $("hpTreeLineBox").hidden = $("hpTreeClear").hidden = $("hpTreeShowBox").hidden = mode !== "forest";
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
  const CLIENT_VERSION = "2.23";
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
})();
