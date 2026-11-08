'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const val = id => { const e = document.getElementById(id); return e ? e.value : ''; };
const LEVELS = ['', 'viewer', 'editor', 'owner'];
const S = { me: null, regOpen: true, worlds: [], lang: null, tab: 'dict', words: [], editId: null, page: 0, q: '', pageSize: 25, openId: null, page: 'work', logTimer: null, logRows: [], logFilter: { level: '', category: '', q: '' }, prefill: null, wordnames: [], soundYear: '', grammar: { sections: [], entries: [] } };
try { const ps = Number(localStorage.getItem('pageSize')); if ([25, 50, 100, 250].includes(ps)) S.pageSize = ps; } catch (e) { /* storage unavailable */ }

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    if (res.status === 401 && S.me) { S.me = null; render(); }
    throw new Error((data && data.error) || data && data.message || ('Request failed (' + res.status + ')'));
  }
  return data;
}
function say(text, err) {
  const m = $('#msg'); m.hidden = !text; m.textContent = text || ''; m.className = err ? 'err' : '';
  if (text && !err) setTimeout(() => { if (m.textContent === text) m.hidden = true; }, 6000);
}
const wrap = fn => async (d, el) => { try { await fn(d, el); } catch (e) { say(e.message, true); } };


// ---------- admin log ----------
function logShell() {
  const f = S.logFilter, opt = (v, t, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${t}</option>`;
  return `<div class="card"><h2>Log</h2>
    <div class="row"><select id="lg_level">${opt('', 'All levels', f.level)}${opt('WARN', 'Warnings and errors', f.level)}${opt('ERROR', 'Errors only', f.level)}</select>
    <select id="lg_cat">${opt('', 'All categories', f.category)}${['api', 'auth', 'connector', 'edit', 'export', 'import', 'share', 'system'].map(c => opt(c, c, f.category)).join('')}</select>
    <input id="lg_q" placeholder="Search message, request, user…" size="30" value="${esc(f.q)}">
    <button class="primary" data-act="logSearch">Search</button><button data-act="logSearch">Refresh</button>
    <label style="display:inline;margin:0"><input type="checkbox" id="lg_auto" data-logauto="1" ${S.logTimer ? 'checked' : ''}> auto-refresh (10 s)</label>
    <a href="/rune/api/admin/log.txt?limit=500" target="_blank"><button>Download as text</button></a><button class="danger" data-act="logClear">Clear log</button></div>
    <p class="muted small">Errors include the full stack trace: click a row. An "Internal error (log #N)" message in the app points to entry N here.</p>
    <table id="lg_table"><thead><tr><th>#</th><th>Time</th><th>Level</th><th>Category</th><th>User</th><th>Request</th><th>Status</th><th>Message</th></tr></thead><tbody id="lg_body"></tbody></table>
    <div class="row"><button data-act="logMore" id="lg_more" hidden>Load older</button></div></div>`;
}
async function loadLog(reset) {
  const f = S.logFilter;
  if (reset) S.logRows = [];
  const before = !reset && S.logRows.length ? S.logRows[S.logRows.length - 1].id : 0;
  const qs = new URLSearchParams({ level: f.level, category: f.category, q: f.q, before, limit: 100 });
  try {
    const rows = await api('GET', '/rune/api/admin/log?' + qs);
    S.logRows = S.logRows.concat(rows);
    drawLog(rows.length === 100);
  } catch (e) { say(e.message, true); }
}
function drawLog(more) {
  const body = $('#lg_body'); if (!body) return;
  body.innerHTML = S.logRows.map(r => `<tr class="lv-${r.lvl}" data-act="logRow" data-id="${r.id}" style="cursor:pointer"><td>${r.id}</td><td class="small">${esc(new Date(r.ts).toLocaleString())}</td>
    <td>${esc(r.lvl)}</td><td>${esc(r.category)}</td><td>${esc(r.username)}</td><td class="small form">${esc(r.request)}</td><td>${r.status ?? ''}</td><td>${esc(r.message)}${r.has_detail ? ' <span class="badge">details</span>' : ''}</td></tr>`).join('')
    || '<tr><td colspan="8" class="muted">No entries.</td></tr>';
  const m = $('#lg_more'); if (m) m.hidden = !more;
}
function stopLogTimer() { if (S.logTimer) { clearInterval(S.logTimer); S.logTimer = null; } }

// ---------- Claude connector (admin) ----------
async function connectorPage() {
  const [keys, users] = await Promise.all([api('GET', '/rune/api/admin/connector-keys'), api('GET', '/rune/api/admin/users')]);
  const fresh = S.connectorNew;
  S.connectorNew = null;
  $('#app').innerHTML = `<div class="card narrow" style="max-width:860px"><h2>Claude connector</h2>
  <p>Lets Claude (claude.ai) read your languages and weather data, so it can look things up while helping you: words, sound
  changes, word histories, missing words, sentences, and the weather generator's regions, days, maps and notes. It can't change anything.</p>
  <p>Each connector address acts as one account and sees exactly what that account sees. Safest: register an account for it on
  the start page (e.g. <em>Claude</em>) and share the worlds or languages it should read with it as <em>viewer</em>.
  Or pick your own account to let it see everything you see.</p>
  ${fresh ? `<div class="card pending"><strong>New connector address for ${esc(fresh.username)}</strong> (shown only now, copy it):
    <div class="row"><input id="cn_url" value="${esc(fresh.url)}" readonly size="70" onclick="this.select()"><button data-act="connectorCopy">Copy</button></div>
    <ol class="small"><li>In claude.ai open <strong>Settings → Connectors</strong> and click <strong>Add custom connector</strong>.</li>
    <li>Give it a name (e.g. <em>Root and Rune</em>), paste the address as the URL and add it.</li>
    <li>In a chat, turn the connector on in the tools menu, and ask away.</li></ol>
    <p class="small muted">Anyone with the address can read what that account can see, so keep it to yourself. Revoke it below if it leaks.</p></div>` : ''}
  <h3>Make an address</h3>
  <div class="row"><select id="cn_user">${users.map(u => `<option value="${esc(u.username)}" ${u.username.toLowerCase() === 'claude' ? 'selected' : ''}>${esc(u.username)}${u.is_admin ? ' (admin)' : ''}</option>`).join('')}</select>
  <input id="cn_label" placeholder="label, e.g. claude.ai" size="20"><button class="primary" data-act="connectorCreate">Make connector address</button></div>
  <h3>Addresses in use</h3>` + (keys.length ? `<table><tr><th>#</th><th>Account</th><th>Label</th><th>Made</th><th>Last used</th><th>Calls</th><th></th></tr>` +
    keys.map(k => `<tr><td class="muted small">${k.id}</td><td>${esc(k.username)}</td><td>${esc(k.label || '')}</td><td class="small">${esc(String(k.created || '').slice(0, 16).replace('T', ' '))}</td>
      <td class="small">${k.last_used ? esc(String(k.last_used).slice(0, 16).replace('T', ' ')) : '<span class="muted">never</span>'}</td><td>${k.calls}</td>
      <td><button class="danger" data-act="connectorRevoke" data-id="${k.id}">Revoke</button></td></tr>`).join('') + '</table>'
    : '<p class="muted">None yet.</p>') + '<p class="small muted">Every call is in the Log (category <em>connector</em>).</p></div>';
}

// ---------- boot ----------
async function boot() {
  const r = await api('GET', '/api/auth/me');
  S.me = r.user; S.regOpen = r.registrationOpen;
  if (S.me) await loadWorlds();
  render();
}
async function loadWorlds() {
  S.worlds = await api('GET', '/rune/api/worlds');
  if (S.lang) {
    const all = S.worlds.flatMap(w => w.languages);
    S.lang = all.find(l => l.id === S.lang.id) || null;
  }
}
function render() {
  $('#who').innerHTML = S.me ? esc(S.me.username) + (S.me.is_admin ? ' <span class="badge">admin</span>' : '') +
    (S.me.is_admin ? ` <button data-act="page" data-p="work" class="${['log', 'connector'].includes(S.page) ? '' : 'primary'}">Workspace</button> <button data-act="page" data-p="log" class="${S.page === 'log' ? 'primary' : ''}">Log</button> <button data-act="page" data-p="connector" class="${S.page === 'connector' ? 'primary' : ''}" title="Let Claude read your languages and weather data">Claude connector</button> <button data-act="resetCode">Issue reset code</button> <button data-act="exportAll" title="All worlds, languages, words, rules, forms, grammar, sounds, sentences, sharing and accounts, as one file">Export everything</button> <button data-act="importAll" title="Read an Export everything file (e.g. from the separate Root and Rune app). Replaces Root and Rune's data here.">Import everything</button>` : '') + ' <button data-act="logout">Log out</button>' : '';
  if (!S.me) { location.href = '/?next=' + encodeURIComponent(location.pathname); return; }
  if (S.me.is_admin && S.page === 'log') { $('#app').innerHTML = logShell(); loadLog(true); return; }
  if (S.me.is_admin && S.page === 'connector') { $('#app').innerHTML = '<div class="card">Loading…</div>'; connectorPage().catch(e => say(e.message, true)); return; }
  $('#app').innerHTML = '<div class="layout"><div class="card tree" id="side">' + sideView() + '</div><div id="panel">' +
    (S.lang ? '<div class="card" id="panelbody">Loading…</div>' : '<div class="card"><h2>Welcome</h2><p>Create a world, then a language in it. Pick a language on the left to work on it.</p></div>') + '</div></div>';
  if (S.lang) renderPanel();
}

// ---------- auth ----------
// Logging in, registering and password resets happen on the start page (/), shared with the weather generator.

// ---------- sidebar ----------
function langTree(langs, parent) {
  const kids = langs.filter(l => (l.parent_id ?? null) === parent);
  if (!kids.length) return '';
  return '<ul>' + kids.map(l => `<li><a data-act="pick" data-id="${l.id}" class="${S.lang && S.lang.id === l.id ? 'on' : ''}">${esc(l.name)}</a>` +
    `<span class="badge">${LEVELS[l.level]}</span>${l.split_year != null ? `<span class="muted small"> (splits ${l.split_year})</span>` : ''}` +
    langTree(langs, l.id) + '</li>').join('') + '</ul>';
}
function sideView() {
  let h = '<h3>Worlds</h3>';
  for (const w of S.worlds) {
    const roots = w.languages.filter(l => !l.parent_id || !w.languages.some(p => p.id === l.parent_id));
    h += `<div><strong>${esc(w.name)}</strong>${w.mine ? '' : ' <span class="badge">shared</span>'}
      ${w.mine ? `<button data-act="newLang" data-w="${w.id}" title="Add a root language">+ lang</button> <button class="danger" data-act="delWorld" data-w="${w.id}" title="Delete world">✕</button>` : ''}</div>`;
    const rootsOnly = w.languages.map(l => roots.includes(l) ? { ...l, parent_id: null } : l);
    h += langTree(rootsOnly, null);
  }
  return h + '<div class="row"><button data-act="newWorld">+ New world</button></div>';
}

// ---------- panel ----------
const TABS = [['dict', 'Dictionary'], ['missing', 'Missing words'], ['rules', 'Sound changes'], ['grammar', 'Grammar'], ['forms', 'Word forms'], ['sounds', 'Sounds'], ['compound', 'Compound'], ['sentences', 'Sentences'], ['graphs', 'Graphs'], ['bulk', 'Bulk entry'],
  ['changes', 'Changes'], ['log', 'Edit log'], ['share', 'Sharing'], ['settings', 'Settings']];
function descendants(l) {
  const all = S.worlds.flatMap(w => w.languages), out = [];
  const walk = id => all.filter(x => x.parent_id === id).forEach(c => { out.push(c); walk(c.id); });
  walk(l.id); return out;
}
function canEdit() { return S.lang && S.lang.level >= 2; }
function isOwner() { return S.lang && S.lang.level >= 3; }
async function renderPanel() {
  const l = S.lang;
  let h = `<h2>${esc(l.name)} <span class="badge">${LEVELS[l.level]}</span></h2>
  <div class="row">${canEdit() ? '<button data-act="undo">↶ Undo</button><button data-act="redo">↷ Redo</button>' : ''}
  <a href="/rune/api/languages/${l.id}/export.xlsx"><button>Export Excel</button></a></div><div class="tabs">` +
    TABS.filter(t => isOwner() || !['share', 'settings'].includes(t[0])).map(t => `<button data-act="tab" data-t="${t[0]}" class="${S.tab === t[0] ? 'on' : ''}">${t[1]}</button>`).join('') +
    '</div><div id="tabbody">Loading…</div>';
  $('#panelbody').innerHTML = h;
  try { $('#tabbody').innerHTML = await TAB[S.tab](); if (AFTER[S.tab]) AFTER[S.tab](); } catch (e) { $('#tabbody').innerHTML = ''; say(e.message, true); }
}
const base = () => '/rune/api/languages/' + S.lang.id;

const TAB = {
  async dict() {
    S.words = await api('GET', base() + '/words');
    S.page = 0;
    let tree = { lineage: [], problems: [] };
    try { tree = await api('GET', base() + '/tree-check'); } catch (e) { /* the note is optional */ }
    let h = '';
    if (canEdit()) h += `<div class="card"><div class="row">
      <input id="w_gloss" placeholder="gloss" size="14"><input id="w_pos" placeholder="type" size="8"><input id="w_build" placeholder="build" size="8">
      <input id="w_form" placeholder="form" size="14" class="form"><input id="w_ref" list="w_refs" placeholder="refers to which word?" size="22" hidden><datalist id="w_refs">${S.words.filter(x => !x.ref_to).map(x => `<option value="${esc(x.gloss)} #${x.id}">${esc(x.form)}</option>`).join('')}</datalist><label style="display:inline;margin:0" title="The word has no form of its own: it shows the forms of another word"><input type="checkbox" id="w_isref" data-isref="1"> reference to another word</label>
      <label style="display:inline;margin:0" title="Take the word from another language, as it sounded there in the year you give"><input type="checkbox" id="w_isloan" data-isloan="1"> borrow</label>
      <select id="w_loanlang" data-loanlang="1" hidden><option value="">from which language?</option>${loanLangs().map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select><input id="w_loanword" list="w_loanwords" placeholder="search by meaning or form" size="28" hidden><datalist id="w_loanwords"></datalist><input id="w_year" placeholder="year" size="6" type="number">
      <input id="w_notes" placeholder="notes" size="20"><input id="w_id" type="hidden">
      <button class="primary" data-act="saveWord" id="w_btn">Add word</button></div>
      <div class="row"><button data-act="suggestRoots">Suggest new roots</button> <input id="sg_n" type="number" value="10" min="1" max="40" size="3" title="how many">
        <select id="sg_syl"><option value="1-1">1 syllable</option><option value="2-2" selected>2 syllables</option><option value="2-3">2-3 syllables</option><option value="3-4">3-4 syllables</option></select>
        <span class="muted small">New forms that sound like this language and are not close to any existing word. Click one to use it.</span></div><div id="sg_out" class="row"></div>
      <div class="muted small">New words get their forms automatically from the rules on the Word forms tab. Click a word to see and edit all its forms.</div></div>`;
    const fromWhere = {};
    S.words.filter(w => w.inherited).forEach(w => { fromWhere[w.origin_lang] = (fromWhere[w.origin_lang] || 0) + 1; });
    const anc = tree.lineage.slice(1);
    if (anc.length) h += `<p class="small muted">Inherits words from ${anc.map(n => `<strong>${esc(n)}</strong> (${fromWhere[n] || 0})`).join(' ← ')}. A word is inherited only if it had been coined when the language split off.</p>`;
    h += tree.problems.map(p => `<p class="small gap">⚠ ${esc(p)}</p>`).join('');
    h += `<div class="row"><input id="q" placeholder="Search (word, form, id)…" data-filter="1" value="${esc(S.q)}">
      <button data-act="toggleProblems" id="probbtn"></button>
      <label style="display:inline;margin:0"><input type="checkbox" data-inh="1" ${S.showInherited === false ? '' : 'checked'}> Show inherited words</label>
      <label style="display:inline;margin:0 0 0 10px">Per page</label> <select data-psize="1">${[25, 50, 100, 250].map(n => `<option ${n === S.pageSize ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <span class="pager"></span></div>
    <table id="wt"><thead><tr><th>ID</th><th>Gloss</th><th>Type</th><th>Build</th><th>Year</th><th>Form</th><th>Definite</th><th>Len</th><th>IPA</th><th>Also in</th><th>Latest per branch</th><th></th></tr>
      <tr class="filters">${['id', 'gloss', 'pos', 'build', 'year', 'form'].map(k => `<th><input data-wf="${k}" value="${esc((S.wf || {})[k] || '')}" placeholder="${k === 'year' ? 'year, a..b, <a, >a' : k === 'id' ? 'id' : 'filter'}" style="width:100%;min-width:${k === 'id' ? 3 : 6}rem"></th>`).join('')}<th colspan="6"><button data-act="clearFilters" class="small">Clear filters</button></th></tr></thead><tbody id="wbody"></tbody></table>
    <div class="row"><span class="pager"></span></div>`;
    return h;
  },
  async rules() {
    if (!S.ruleScope) { try { S.ruleScope = localStorage.getItem('ruleScope') || 'branches'; } catch (x) { S.ruleScope = 'branches'; } }
    const scope = S.ruleScope;
    const [rules, versions] = await Promise.all([api('GET', base() + '/rules?scope=' + scope), api('GET', base() + '/rule-versions').catch(() => [])]);
    S.rules = rules; S.ruleVersions = versions;
    const targets = [S.lang, ...descendants(S.lang)].filter(l => l.level >= 2);
    const seg = (v, t) => `<button data-act="ruleScope" data-v="${v}" class="${scope === v ? 'primary' : ''}">${t}</button>`;
    let h = `<div class="row"><span class="small muted">Show</span> ${seg('self', 'only ' + esc(S.lang.name))} ${seg('branches', esc(S.lang.name) + ' + all its branches')} ${seg('path', 'full path (ancestors + ' + esc(S.lang.name) + ')')}
      <span class="small muted">${rules.length} rule${rules.length === 1 ? '' : 's'}</span></div>`;
    h += `<div class="card"><div class="row"><a href="/rune/api/languages/${S.lang.id}/rules/export.json?scope=${scope}"><button>Export these sound changes (JSON)</button></a>
      ${canEdit() ? `<input type="file" id="ri_file" accept=".json,application/json"><label style="display:inline;margin:0"><input type="checkbox" id="ri_rm"> remove rules that are missing from the file</label>
      <button data-act="ruleImportCheck">Check file</button>` : ''}</div>
      <div class="muted small">Edit the exported file and import it again: a rule with its id is adjusted, a rule without an id is added, <code>"delete": true</code> removes it. Nothing is changed until you have seen the check and pressed Apply.</div><div id="ri_out"></div></div>`;
    if (targets.length || rules.some(r => r.level >= 2)) h += `<div class="card"><div class="row"><label style="margin:0">Apply to</label>
      <select id="r_lang">${targets.map(l => `<option value="${l.id}">${esc(l.name)}${l.id === S.lang.id ? '' : ' (branch)'}</option>`).join('')}</select>
      <select id="r_tpl" data-tpl="1"><option value="">Template…</option>
      <option value="syncope">Syncope (drop vowel between VC_CV)</option><option value="hiatus">Hiatus resolution (drop first vowel)</option>
      <option value="haplology">Haplology</option><option value="geminate">Geminate simplification</option><option value="cluster">Cluster reduction</option></select>
      <input id="r_year" type="number" placeholder="year" size="6"><input id="r_ord" type="number" placeholder="order" size="4" value="0">
      <input id="r_name" placeholder="name"><input id="r_pat" placeholder="pattern (regex, {V} classes, # = word edge)" size="34" class="form">
      <input id="r_rep" placeholder="replacement ($1)" size="14" class="form">
      <input id="r_tags" placeholder="tags, e.g. vowel shift, experimental" size="26" list="r_taglist"><datalist id="r_taglist">${ruleTagList(rules).map(t => `<option value="${esc(t.tag)}">`).join('')}</datalist><input id="r_id" type="hidden"></div>
      <div class="row"><button data-act="previewRule">Preview effect</button><button class="primary" data-act="addRule" id="r_btn">Add rule</button><button data-act="cancelRule" id="r_cancel" hidden>Cancel edit</button>
      <span class="muted small">A rule on a branch only affects that branch and its own branches. Define classes like V=aeiou in Settings.</span></div><div id="rprev"></div></div>`;
    h += ruleVersionsCard(versions);
    h += ruleTagBar(rules);
    const shown = S.ruleTag ? rules.filter(r => ruleTags(r).some(t => t.toLowerCase() === S.ruleTag)) : rules;
    h += '<table><tr><th>Year</th><th>Language</th><th>Order</th><th>Name</th><th>Pattern</th><th>Replacement</th><th>Tags</th><th></th></tr>';
    for (const r of shown) h += `<tr class="${r.off ? 'ruleoff' : ''}" ${r.off ? `title="Switched off in ${esc(r.off_in)}: left out when words evolve"` : ''}><td>${r.year}</td><td>${esc(r.lang_name)}</td><td>${r.ord}</td><td>${esc(r.name)}${r.off ? ' <span class="badge">off</span>' : ''}</td><td class="form">${esc(r.pattern)}</td><td class="form">${esc(r.replacement)}</td>
      <td>${ruleTags(r).map(t => `<a class="tagchip small${S.ruleTag === t.toLowerCase() ? ' on' : ''}" data-act="ruleTagFilter" data-t="${esc(t)}">${esc(t)}</a>`).join(' ')}</td>
      <td>${r.level >= 2 ? `<button data-act="editRule" data-id="${r.id}">Edit</button> <button class="danger" data-act="delRule" data-id="${r.id}">✕</button>` : ''}</td></tr>`;
    if (!shown.length) h += `<tr><td colspan="8" class="muted">${S.ruleTag ? 'No sound changes with that tag here.' : 'No sound changes yet.'}</td></tr>`;
    return h + '</table>';
  },
  async grammar() {
    const g = S.grammar = await api('GET', base() + '/grammar');
    const heads = t => { const s = g.sections.find(x => x.title === t); const a = s && s.headings ? s.headings.split('\t') : []; while (a.length < 6) a.push(''); return a; };
    const cats = g.sections.map(s => s.title);
    for (const e of g.entries) if (!cats.includes(e.category)) cats.push(e.category);
    let h = `<div class="card"><div class="row"><strong>Syllable shape</strong>
      ${isOwner() ? `<input id="gr_shape" value="${esc(S.lang.syllable_shape || '')}" placeholder="e.g. (V)C(C)V(C)" size="20" class="form"><button data-act="saveShape">Save</button>` : `<span class="form">${esc(S.lang.syllable_shape || 'not set')}</span>`}</div>
      <p class="muted small">C = consonant, V = vowel, brackets = optional. A leading (V) is an optional vowel at the start of a word only. sh, ch, gh, ng and diphthongs (ai, ou) count as one sound. "Suggest new roots" only proposes forms of this shape, and a language without its own shape uses its parent's.</p></div>`;
    if (canEdit()) h += `<div class="card"><div class="row"><select id="gr_cat" data-grcat="1">${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select>
      <input id="gr_name" placeholder="name" size="26"><input id="gr_year" type="number" placeholder="from year" size="8"><input id="gr_id" type="hidden"></div>
      <div class="row">${[1, 2, 3, 4, 5, 6].map(k => `<input id="gr_c${k}" placeholder="column ${k}" size="22">`).join('')}</div>
      <div class="row"><button class="primary" data-act="saveGrammar" id="gr_btn">Add row</button><button data-act="cancelGrammar" id="gr_cancel" hidden>Cancel edit</button>
      <button data-act="newSection">+ New section</button></div></div>`;
    h += '<div class="row"><input placeholder="Search grammar…" data-gfilter="1"></div>';
    for (const t of cats) {
      const hd = heads(t), list = g.entries.filter(e => e.category === t);
      const vis = [0, 1, 2, 3, 4, 5].filter(k => hd[k] || list.some(e => e['c' + (k + 1)]));
      h += `<h3>${esc(t)} ${canEdit() ? `<button data-act="editHeadings" data-t="${esc(t)}">Edit columns</button> <button class="danger" data-act="delSection" data-t="${esc(t)}">Delete section</button>` : ''}</h3>
        <table class="gt"><tr><th>${esc(t)}</th>${vis.map(k => `<th>${esc(hd[k])}</th>`).join('')}<th>From</th><th></th></tr>`;
      for (const e of list) h += `<tr><td><strong>${esc(e.name)}</strong></td>${vis.map(k => `<td>${esc(e['c' + (k + 1)])}</td>`).join('')}<td>${e.year ?? ''}</td>
        <td>${canEdit() ? `<button data-act="editGrammar" data-id="${e.id}">Edit</button> <button data-act="rowToForm" data-id="${e.id}" title="Turn this row into a word form that is added to words automatically">→ word form</button> <button class="danger" data-act="delGrammar" data-id="${e.id}">✕</button>` : ''}</td></tr>`;
      h += '</table>';
    }
    return h || '<p class="muted">No grammar yet.</p>';
  },
  async forms() {
    const rules = S.formrules = await api('GET', base() + '/formrules');
    S.wordnames = await api('GET', base() + '/wordnames');
    let h = `<p class="muted small">A form rule says: words of these types get this prefix or suffix, and the result is stored as a form of the word (definite, plural, past ...).
      Every form then goes through the sound changes by itself. If a label has several rules (for example two plural prefixes), the first one whose condition fits the word is used.
      New words get their forms automatically.<br><strong>Linking the affix to a dictionary word</strong> (for example the word "definite" = tou) makes each form use that word as it was in the year the form begins:
      if a sound change turns tou into toe in year 300, words from then on get -toe, while older words change through the same sound change. The finished form is stored, so after you
      edit sound changes or the affix word, use <em>Rebuild all</em> to refresh the forms of existing words.</p>`;
    if (S.prefill) h += `<p class="card pending">From grammar row <strong>${esc(S.prefill.label)}</strong>${S.prefill.hint ? ' — ' + esc(S.prefill.hint) : ''}</p>`;
    if (canEdit()) h += `<div class="card"><div class="row"><input id="fr_grp" list="fr_groups" placeholder="group (e.g. definers; new name creates it)" size="30"><datalist id="fr_groups">${[...new Set(rules.map(x => x.grp).filter(Boolean))].map(g => `<option value="${esc(g)}">`).join('')}</datalist><input id="fr_label" placeholder="form name (e.g. definite)" size="18"><input id="fr_pos" placeholder="applies to types (e.g. noun; blank = all)" size="26">
      <select id="fr_place"><option>suffix</option><option>prefix</option></select></div>
      <div class="row"><input id="fr_link" list="fr_words" placeholder="affix = dictionary word (e.g. definite)" size="30"><datalist id="fr_words">${S.wordnames.map(w => `<option value="${esc(w.gloss)}">${esc(w.form)}</option>`).join('')}</datalist>
      <span class="muted small">or a fixed affix:</span><input id="fr_affix" placeholder="e.g. tou" size="10" class="form"></div>
      <div class="row"><input id="fr_cond" placeholder="only if the word matches (regex, optional; e.g. ^a  or  {V}$)" size="44" class="form">
      <label style="display:inline;margin:0"><input type="checkbox" id="fr_hiatus"> drop the first vowel when two vowels meet</label>
      <input id="fr_year" type="number" placeholder="from year" size="8" data-yearcheck="rule"><span id="fr_warn" class="gap small"></span><input id="fr_ord" type="number" placeholder="order" size="5" value="0"><input id="fr_id" type="hidden"></div>
      <div class="row"><button class="primary" data-act="saveFormRule" id="fr_btn">Add form rule</button><button data-act="cancelFormRule" id="fr_cancel" hidden>Cancel edit</button></div></div>`;
    if (isOwner()) h += '<div class="row"><button data-act="genForms">Add missing forms to all existing words</button></div>';
    h += '<table><tr><th>Form</th><th>Applies to</th><th>Affix</th><th>Condition</th><th>Vowel clash</th><th>From</th><th>Order</th><th></th></tr>';
    const order = []; for (const r of rules) { const g = r.grp || ''; if (!order.includes(g)) order.push(g); }
    order.sort((x, y) => (x === '') - (y === ''));
    const rowOf = r => `<tr><td><strong>${esc(r.label)}</strong></td><td>${esc(r.pos) || 'all types'}</td><td class="form">${r.affix_word_id ? `⛓ <span class="small">${esc(r.affix_gloss ?? '(deleted word)')}</span> ${r.affix_form ? esc(r.placement === 'prefix' ? r.affix_form + '-' : '-' + r.affix_form) : ''}` : (r.placement === 'prefix' ? esc(r.affix) + '-' : '-' + esc(r.affix))}</td>
      <td class="form">${esc(r.cond_re)}</td><td>${r.hiatus ? 'drop first vowel' : ''}</td><td>${r.year ?? ''}</td><td>${r.ord}</td>
      <td>${canEdit() ? `<button data-act="editFormRule" data-id="${r.id}">Edit</button> <button class="danger" data-act="delFormRule" data-id="${r.id}">✕</button>` : ''}
      ${isOwner() ? `<button data-act="rebuildForm" data-l="${esc(r.label)}" title="Recompute this form for every word (overwrites hand edits)">Rebuild all</button>` : ''}</td></tr>`;
    for (const g of order) {
      if (order.length > 1 || g) h += `<tr class="grouprow"><th colspan="8">${g ? esc(g) : 'Ungrouped'} ${isOwner() ? `<button data-act="rebuildGroup" data-g="${esc(g)}" title="Recompute every form in this group for every word (overwrites hand edits)">Rebuild group</button>` : ''}</th></tr>`;
      for (const r of rules.filter(x => (x.grp || '') === g)) h += rowOf(r);
    }
    return h + '</table>';
  },
  async sounds() {
    const ph = S.phonemes = await api('GET', base() + '/phonemes');
    const yr = S.soundYear;
    const shown = p => yr === '' || yr == null ? p.year_to == null : ((p.year == null || p.year <= yr) && (p.year_to == null || p.year_to > yr));
    const grid = kind => {
      const all = ph.filter(p => p.kind === kind), rows = [...new Set(all.map(p => p.row_label || ''))], cols = [...new Set(all.map(p => p.col_label || ''))];
      if (!all.length) return '<p class="muted">None yet.</p>';
      return '<table><tr><th></th>' + cols.map(c => `<th>${esc(c)}</th>`).join('') + '</tr>' + rows.map(r => `<tr><th>${esc(r)}</th>` + cols.map(c =>
        `<td class="form">${all.filter(p => (p.row_label || '') === r && (p.col_label || '') === c && shown(p)).map(p => `<span title="${esc(p.notes)}">${esc(p.symbol)}</span>`).join(', ')}</td>`).join('') + '</tr>').join('') + '</table>';
    };
    let h = `<div class="row"><label style="margin:0">Show inventory as of year</label><input type="number" id="s_year" data-soundyear="1" value="${yr ?? ''}" placeholder="now" size="8">
      <span class="muted small">Blank = sounds currently in the language. Give a sound a "from" / "until" year to make the table change over time.</span></div>
      <h3>Consonants</h3>${grid('consonant')}<h3>Vowels</h3>${grid('vowel')}`;
    h += `<h3>Build from the word list</h3><div class="card"><p class="muted small">Reads the forms of this language's words at every year one of its own sound changes starts, and lists the sounds they use. Letters you have already placed in the table above keep their place; digraphs (sh, ch, th, ng) and diphthongs (ai, ou) count as one sound.</p>
      <div class="row"><label style="margin:0">Up to year</label><input type="number" id="as_to" value="${S.autoTo ?? 900}" size="6"><button data-act="autoSoundsLoad">Build table</button></div><div id="as_out"></div></div>`;
    if (canEdit()) h += `<h3>Add / edit a sound</h3><div class="card"><div class="row"><input id="ph_symbol" placeholder="symbol" size="6" class="form">
      <select id="ph_kind"><option>consonant</option><option>vowel</option></select>
      <input id="ph_row" list="ph_rows" placeholder="row (manner / height)" size="18"><datalist id="ph_rows">${[...new Set(ph.map(p => p.row_label).filter(Boolean))].map(x => `<option>${esc(x)}</option>`).join('')}</datalist>
      <input id="ph_col" list="ph_cols" placeholder="column (place / backness)" size="22"><datalist id="ph_cols">${[...new Set(ph.map(p => p.col_label).filter(Boolean))].map(x => `<option>${esc(x)}</option>`).join('')}</datalist>
      <input id="ph_notes" placeholder="notes" size="18"><input id="ph_from" type="number" placeholder="from year" size="8"><input id="ph_to" type="number" placeholder="until year" size="8"><input id="ph_id" type="hidden"></div>
      <div class="row"><button class="primary" data-act="savePhoneme" id="ph_btn">Add sound</button><button data-act="cancelPhoneme" id="ph_cancel" hidden>Cancel edit</button></div></div>`;
    if (canEdit()) h += `<h3>Import sounds</h3><div class="card"><p class="muted small">Paste a table with one sound per line: <code>Symbol | Kind | Row | Column | Notes | From | Until</code> (tab, | or ; between cells; the last three are optional), or choose a JSON file with a "sounds" list. Sounds with the same symbol, kind and years are updated.</p>
      <textarea id="si_text" rows="6" class="form"></textarea><div class="row"><input type="file" id="si_file" accept=".json,.txt,.csv,.tsv"><button data-act="soundImportCheck">Check</button></div><div id="si_out"></div></div>`;
    h += '<h3>All sounds</h3><table><tr><th>Symbol</th><th>Kind</th><th>Row</th><th>Column</th><th>Notes</th><th>From</th><th>Until</th><th></th></tr>' + ph.map(p =>
      `<tr><td class="form">${esc(p.symbol)}</td><td>${esc(p.kind)}</td><td>${esc(p.row_label)}</td><td>${esc(p.col_label)}</td><td>${esc(p.notes)}</td><td>${p.year ?? ''}</td><td>${p.year_to ?? ''}</td>
      <td>${canEdit() ? `<button data-act="editPhoneme" data-id="${p.id}">Edit</button> <button class="danger" data-act="delPhoneme" data-id="${p.id}">✕</button>` : ''}</td></tr>`).join('') + '</table>';
    return h;
  },
  async compound() {
    if (!canEdit()) return '<p class="muted">Editors only.</p>';
    let miss = { entries: [], fromSentences: [] };
    try { miss = S.missing = await api('GET', base() + '/missing'); } catch (e) { /* the side list is optional */ }
    return `<div class="compwrap"><div class="compmain">
    <p class="muted small">Join existing words (by exact gloss) and literal pieces with +. Example: <code>hand + leaf</code>. Erosion uses the steps in Settings.
    Pick a meaning from the missing words on the right to coin the compound for it.</p>
    <div class="row"><input id="c_gloss" placeholder="gloss of the new word" value="${esc(S.compPick ? S.compPick.g : '')}"><input id="c_pos" placeholder="type" size="8" value="${esc(S.compPick ? S.compPick.p : '')}">
    <input id="c_parts" placeholder="part + part + part" size="40">
    <button class="primary" data-act="compPrev">Erode</button></div><div id="cprev"></div></div>
    <aside class="card compside"><h3>Missing words</h3><input id="c_missq" placeholder="filter" size="16"><div id="c_misslist">${compMissList(miss)}</div></aside></div>`;
  },
  async missing() {
    const r = S.missing = await api('GET', base() + '/missing');
    const filled = r.entries.filter(e => e.word);
    let h = `<div class="card"><p class="muted small">Meanings ${esc(S.lang.name)} has no word for yet. Mark them here as a to-do list;
      <strong>Coin word</strong> opens the dictionary with the meaning filled in. An entry is ticked off once the language has a word
      for it (its own or inherited). Below the list are the meanings your saved sentences need but can't find.</p>`;
    if (canEdit()) h += `<div class="row"><input id="m_gloss" placeholder="meaning, e.g. to forgive" size="24"><input id="m_pos" placeholder="type" size="8">
      <input id="m_notes" placeholder="note (optional)" size="30"><button class="primary" data-act="missAdd">Mark as missing</button></div>
      <details><summary class="small">Add several at once</summary>
      <p class="small muted">One per line: <code>meaning</code>, <code>meaning; type</code> or <code>meaning; type; note</code>.</p>
      <textarea id="m_bulk" rows="5" placeholder="to forgive; verb&#10;thunder; noun; for the storm songs&#10;grandmother"></textarea>
      <div class="row"><button data-act="missBulk">Add all</button></div></details>`;
    h += '</div>';
    h += `<h3>Missing words (${r.entries.length - filled.length})</h3>`;
    h += r.entries.length ? `<table><tr><th>Meaning</th><th>Type</th><th>Note</th><th>Marked by</th><th></th></tr>` +
      r.entries.map(e => `<tr class="${e.word ? 'muted' : ''}"><td><strong>${esc(e.gloss)}</strong></td><td>${esc(e.pos || '')}</td><td>${esc(e.notes || '')}</td>
        <td class="small muted">${esc(e.created_by_name || '')}${e.created ? ' · ' + esc(String(e.created).slice(0, 10)) : ''}</td>
        <td>${e.word ? `✓ now <span class="form">${esc(e.word.form)}</span> <a data-act="openWord" data-id="${e.word.id}" style="cursor:pointer" class="small">#${e.word.id}</a>`
          : (canEdit() ? `<button class="primary" data-act="missCoin" data-g="${esc(e.gloss)}" data-p="${esc(e.pos || '')}">Coin word</button> <button data-act="missCompound" data-g="${esc(e.gloss)}" data-p="${esc(e.pos || '')}" title="Make it a compound of existing words">Compound</button>` : '')}
        ${canEdit() ? ` <button class="danger" data-act="missDel" data-id="${e.id}" title="Remove from the list">✕</button>` : ''}</td></tr>`).join('') + '</table>'
      : '<p class="muted">Nothing marked as missing.</p>';
    if (filled.length && canEdit()) h += `<div class="row"><button data-act="missClear">Remove the ${filled.length} that have a word now</button></div>`;
    h += `<h3>Needed by sentences (${r.fromSentences.length})</h3>`;
    h += r.fromSentences.length ? `<table><tr><th>Meaning</th><th>Why</th><th>Used in</th><th></th></tr>` +
      r.fromSentences.map(g => `<tr><td><strong>${esc(g.meaning)}</strong></td><td class="small muted">${esc(g.reason)}</td>
        <td class="small">${g.sentences.map(x => esc(x.translation || x.source)).join('<br>')}</td>
        <td>${canEdit() ? `<button class="primary" data-act="missCoin" data-g="${esc(g.meaning)}" data-p="">Coin word</button> <button data-act="missMark" data-g="${esc(g.meaning)}">Mark as missing</button>` : ''}</td></tr>`).join('') + '</table>'
      : '<p class="muted">Every word in the saved sentences is in the dictionary.</p>';
    return h;
  },
  async sentences() {
    const list = S.sentList = await api('GET', base() + '/sentences');
    return `<div class="card"><p class="muted small">Write each word as parts in parentheses and separate words with spaces, e.g.
      <code>(to see)(you-obj) (poss)(darkness)(pos-in) (me)</code>. A part is a dictionary meaning; <code>meaning-label</code> picks a word form
      (<code>you-obj</code> = the “obj” form of “you”). Several parts in one word are joined together (hiatus drops the first vowel).
      Use <code>meaning#12</code> to pick a word by its id, and <code>(=text)</code> or plain text for something that must stay as written. Words appear in the order you write them.</p>
      <textarea id="s_src" rows="3" placeholder="(to see)(you-obj) …">${esc(S.sentSrc || '')}</textarea>
      <div class="row"><input id="s_year" type="number" placeholder="year" size="8" value="${S.sentYear ?? 0}">
      <input id="s_tr" placeholder="English" size="30" value="${esc(S.sentTr || '')}"><input id="s_kind" placeholder="type (e.g. greeting)" size="16" value="${esc(S.sentKind || '')}">
      <input id="s_group" type="number" placeholder="group (auto)" size="8"><input id="s_sub" type="number" placeholder="sub id (auto)" size="8"><input id="s_notes" placeholder="notes (optional)" size="24">
      <button class="primary" data-act="sentBuild">Build</button>${canEdit() ? '<button data-act="sentSave">Save sentence</button>' : ''}</div>
      <div id="s_out"></div></div>
      <h3>Saved sentences</h3>` + (list.length ? `<table><tr><th>ID</th><th>Group</th><th>Sub id</th><th>English</th><th>Type</th><th>Construction</th><th>${esc(S.lang.name)}</th><th>Year</th><th></th></tr>` +
      list.map(s => `<tr class="${s.built && s.built.gaps ? 'pending' : ''}"><td class="muted small">${s.id}</td><td>${s.group_no ?? ''}</td><td>${s.sub_no ?? ''}</td><td>${esc(s.translation || '')}${s.notes ? `<div class="small muted">${esc(s.notes)}</div>` : ''}</td>
        <td>${esc(s.kind || '')}</td><td class="form"><a data-act="openSentence" data-id="${s.id}" style="cursor:pointer">${esc(s.source)}</a></td>
        <td>${s.built ? `<span class="form ${s.built.gaps ? 'gap' : ''}"><strong>${esc(s.built.surface)}</strong></span><div class="small muted">${esc(s.built.gloss)}</div>` : ''}</td><td>${s.year}</td>
        <td><button data-act="sentLoad" data-id="${s.id}" title="Copy into the form above">Copy</button>${canEdit() ? ` <button class="danger" data-act="delSentence" data-id="${s.id}">✕</button>` : ''}</td></tr>`).join('') + '</table>' : '<p class="muted">None yet.</p>');
  },
  async graphs() {
    const opts = [S.lang, ...descendants(S.lang)];
    const sel = id => `<select id="${id}"><option value="">(all pairs)</option>${opts.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>`;
    setTimeout(() => A.drawGraph(), 0);
    return `<h3>Divergence between languages</h3><p class="muted small">How different the languages' versions of the same words are, over time. Leave both as "(all pairs)" to compare this language with all its branches and the branches with each other, or pick two languages.</p>
      <div class="row">${sel('g_a')} ↔ ${sel('g_b')}
      <select id="g_metric" data-gmetric="1"><option value="avg_distance">average difference</option><option value="identical">words with identical forms</option></select>
      <input id="g_from" type="number" placeholder="from year" size="8"><input id="g_to" type="number" placeholder="to year" size="8"><button class="primary" data-act="drawGraph">Draw</button></div><div id="g_out">Loading…</div>
      <h3>Mergers: words that end up sounding the same</h3>
      <p class="muted small">For this language and each of its branches: how many words had different forms when the language began (at its split) but are identical now, which sound change causes the most, and the biggest groups of words that now sound alike.
      Mergers make a language hard to decode, so this is the number to watch when you want a language that is readable but hard to hear.</p>
      <div class="row"><button class="primary" data-act="mergersGo">Calculate</button></div><div id="m_out"></div>
      <p class="muted small">The evolution tree of a single word is in the word popup: click a word in the dictionary.</p>`;
  },
  async bulk() {
    if (!canEdit()) return '<p class="muted">Editors only.</p>';
    return `<p class="muted small">One word per line: <code>gloss;type;form;year;notes</code> (tab-separated also works). Nothing is added if any line has an error.</p>
    <textarea id="b_text" rows="12"></textarea><div class="row"><label style="display:inline;margin:0"><input type="checkbox" id="b_skip"> skip words that already exist here (same gloss)</label></div><div class="row"><button data-act="bulkCheck">Check only</button><button class="primary" data-act="bulkGo">Add all</button></div><div id="b_out"></div>`;
  },
  async changes() {
    const cs = await api('GET', base() + '/changes');
    if (!cs.length) return '<p class="muted">No changes.</p>';
    let h = '<table><tr><th>By</th><th>What</th><th>Details</th><th>Status</th><th></th></tr>';
    for (const c of cs) {
      const p = c.payload ? JSON.parse(c.payload) : {};
      const desc = Object.entries(p).map(([k, v]) => k + '=' + v).join(', ');
      h += `<tr class="${c.status === 'PENDING' ? 'pending' : ''}"><td>${esc(c.author)}</td><td>${esc(c.action.toLowerCase())} ${esc(c.entity)}${c.entity_id ? ' #' + c.entity_id : ''}</td>
      <td class="small">${esc(desc)}</td><td>${esc(c.status.toLowerCase())}</td>
      <td>${isOwner() && c.status === 'PENDING' ? `<button class="primary" data-act="approve" data-id="${c.id}">Approve</button> <button class="danger" data-act="deny" data-id="${c.id}">Deny</button>` : ''}</td></tr>`;
    }
    return h + '</table>';
  },
  async log() {
    const rows = await api('GET', base() + '/log');
    return '<table><tr><th>#</th><th>By</th><th>What</th><th>When</th></tr>' + rows.map(r =>
      `<tr class="${r.undone ? 'muted' : ''}"><td>${r.id}</td><td>${esc(r.username)}</td><td>${esc(r.action.toLowerCase())} ${esc(r.entity)} #${r.entity_id}${r.undone ? ' (undone)' : ''}</td><td class="small">${esc(r.created)}</td></tr>`).join('') + '</table>';
  },
  async share() {
    const l = S.lang;
    const [a, b] = await Promise.all([api('GET', '/rune/api/shares?scope=LANGUAGE&targetId=' + l.id), api('GET', '/rune/api/shares?scope=WORLD&targetId=' + l.world_id).catch(() => [])]);
    const list = rows => rows.length ? rows.map(s => `<tr><td>${esc(s.username)}</td><td>${s.level.toLowerCase()}</td><td>${s.auto_approve ? 'auto-approved' : ''}</td>
      <td><button class="danger" data-act="revoke" data-id="${s.id}">Revoke</button></td></tr>`).join('') : '<tr><td class="muted" colspan="4">Nobody.</td></tr>';
    return `<div class="card"><div class="row"><input id="s_user" placeholder="username">
      <select id="s_scope"><option value="LANGUAGE">this language</option><option value="WORLD">the whole world</option></select>
      <select id="s_level"><option value="VIEWER">viewer</option><option value="EDITOR">editor</option></select>
      <label style="display:inline;margin:0"><input type="checkbox" id="s_auto"> auto-approve their changes</label>
      <button class="primary" data-act="addShare">Share</button></div></div>
      <h3>This language</h3><table>${list(a)}</table><h3>Whole world</h3><table>${list(b)}</table>`;
  },
  async settings() {
    const l = await api('GET', base());
    const w = S.worlds.flatMap(x => x.languages).filter(x => x.world_id === l.world_id && x.id !== l.id);
    return `<label>Name</label><input id="g_name" value="${esc(l.name)}">
    <div class="row"><div><label>Parent language</label><select id="g_parent"><option value="">(none, root)</option>${w.map(x => `<option value="${x.id}" ${x.id === l.parent_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    <div><label>Split year</label><input id="g_split" type="number" value="${l.split_year ?? ''}"></div></div>
    <label>Sound classes (one per line, e.g. V=aeiou; used as {V} in patterns)</label><textarea id="g_classes" rows="4">${esc(l.classes)}</textarea>
    <label>Erosion steps for compounds (one per line: pattern =&gt; replacement; // comment)</label><textarea id="g_erosion" rows="5">${esc(l.erosion)}</textarea>
    <label>Erosion target length (0 = run all steps)</label><input id="g_target" type="number" value="${l.erosion_target ?? 0}">
    <label>Pronunciation map (one per line: spelling=IPA)</label><textarea id="g_ipa" rows="4">${esc(l.ipa_map)}</textarea>
    <label>Grammar notes</label><textarea id="g_grammar" rows="5">${esc(l.grammar)}</textarea>
    <div class="row"><button class="primary" data-act="saveSettings">Save</button><button class="danger" data-act="delLang">Delete language</button></div>`;
  }
};

function applyHeadings() {
  const t = val('gr_cat'), sec = (S.grammar.sections || []).find(x => x.title === t), hd = sec && sec.headings ? sec.headings.split('\t') : [];
  for (let k = 1; k <= 6; k++) { const e = $('#gr_c' + k); if (e) e.placeholder = hd[k - 1] || 'column ' + k; }
}
const AFTER = { dict: () => drawDict(), grammar: () => { if ($('#gr_cat')) applyHeadings(); } };
const lines = obj => Object.entries(obj || {}).map(([k, v]) => `<span class="small">${esc(k)}:</span> <span class="form">${esc(v)}</span>`).join('<br>');
const defForm = w => (w.forms || []).find(f => f.label.toLowerCase() === 'definite');
// ---------- graphs ----------
const PALETTE = ['#2a6fdb', '#d9822b', '#2e8b57', '#b3261e', '#7b5ea7', '#008b8b', '#a0522d', '#667085'];
function svgText(x, y, t, o = {}) { return `<text x="${x}" y="${y}" font-size="${o.size || 11}" text-anchor="${o.anchor || 'start'}" fill="${o.fill || 'currentColor'}" ${o.mono ? 'font-family="monospace"' : ''}>${esc(t)}</text>`; }
function lineChart(years, series, yTitle) {
  const W = 900, H = 380, L = 56, R = 16, T = 16, B = 44, pw = W - L - R, ph = H - T - B;
  const x0 = years[0], x1 = years[years.length - 1], X = y => L + (x1 === x0 ? 0 : (y - x0) / (x1 - x0) * pw), Y = v => T + ph - v / 100 * ph;
  let g = '';
  for (const v of [0, 25, 50, 75, 100]) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#8884" />` + svgText(L - 6, Y(v) + 4, v + '%', { anchor: 'end' });
  const every = Math.max(1, Math.ceil(years.length / 9));
  years.forEach((y, i) => { if (i % every === 0) g += `<line x1="${X(y)}" x2="${X(y)}" y1="${T}" y2="${T + ph}" stroke="#8882" />` + svgText(X(y), H - B + 16, String(y), { anchor: 'middle' }); });
  g += svgText(L + pw / 2, H - 6, 'year', { anchor: 'middle' }) + `<text transform="translate(14 ${T + ph / 2}) rotate(-90)" font-size="11" text-anchor="middle" fill="currentColor">${esc(yTitle)}</text>`;
  series.forEach((s, k) => {
    const col = PALETTE[k % PALETTE.length]; let seg = [];
    const flush = () => { if (seg.length > 1) g += `<polyline fill="none" stroke="${col}" stroke-width="2" points="${seg.join(' ')}" />`; seg = []; };
    s.values.forEach((v, i) => { if (v == null) flush(); else seg.push(X(years[i]).toFixed(1) + ',' + Y(v).toFixed(1)); });
    flush();
    s.values.forEach((v, i) => { if (v != null) g += `<circle cx="${X(years[i]).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3" fill="${col}"><title>${esc(s.label)}, ${years[i]}: ${v}% (${s.words[i]} words)</title></circle>`; });
  });
  const legend = series.map((s, k) => `<span style="margin-right:14px"><span style="display:inline-block;width:12px;height:3px;background:${PALETTE[k % PALETTE.length]};vertical-align:middle"></span> ${esc(s.label)}</span>`).join('');
  return `<div class="treewrap"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="max-width:none">${g}</svg></div><div class="small">${legend}</div>`;
}
function drawDivergence() {
  const d = S.divergence, out = $('#g_out'); if (!out || !d) return;
  const metric = val('g_metric') || 'avg_distance';
  const series = d.series.map(s => ({ label: s.a + ' ↔ ' + s.b, values: s[metric], words: s.words }));
  out.innerHTML = lineChart(d.years, series, metric === 'avg_distance' ? 'average difference between the two forms' : 'words with identical forms') +
    '<p class="muted small">Each point compares the form of every shared word in the two languages at that year (words that existed by then and that both languages inherited). ' +
    'Difference = edit distance divided by the length of the longer form, averaged. Before the languages split, both share the same forms, so the line starts at 0%. Hover a point for the number of words.</p>';
}
function wordTree(hist) {
  const langs = (S.worlds || []).flatMap(w => w.languages || []);
  const parentOf = id => (langs.find(l => l.id === id) || {}).parent_id;
  const by = new Map();
  for (const x of hist) { if (x.source === 'ERROR') continue; if (!by.has(x.lang_id)) by.set(x.lang_id, { name: x.lang, rows: [] }); by.get(x.lang_id).rows.push(x); }
  if (!by.size) return '';
  const rootId = hist[0].lang_id, lane = new Map(), order = [];
  const walk = id => {
    lane.set(id, lane.size); order.push(id);
    [...by.keys()].filter(c => parentOf(c) === id && !lane.has(c)).sort((a, b) => by.get(a).rows[0].year - by.get(b).rows[0].year).forEach(walk);
  };
  walk(rootId);
  const yrs = [...new Set([...by.values()].flatMap(v => v.rows.map(r => r.year)))].sort((a, b) => a - b);
  const COL = 104, ROW = 66, GUT = 120, X = y => GUT + 40 + yrs.indexOf(y) * COL, Y = id => 36 + lane.get(id) * ROW;
  const W = GUT + 80 + yrs.length * COL, H = 56 + lane.size * ROW, maxX = X(yrs[yrs.length - 1]);
  let g = '';
  for (const id of order) {
    const v = by.get(id), y = Y(id), xs = X(v.rows[0].year);
    g += svgText(6, y + 4, v.name, { size: 12, fill: 'currentColor' });
    g += `<line x1="${xs}" x2="${maxX}" y1="${y}" y2="${y}" stroke="#8886" stroke-width="2" />`;
    const p = parentOf(id);
    if (id !== rootId && lane.has(p)) g += `<line x1="${xs}" x2="${xs}" y1="${Y(p)}" y2="${y}" stroke="#8886" stroke-width="2" stroke-dasharray="4 3" />`;
  }
  for (const id of order) {
    const y = Y(id);
    for (const r of by.get(id).rows) {
      const x = X(r.year), fill = r.source === 'SPLIT' ? '#fff' : r.source === 'OVERRIDE' ? '#d9822b' : r.source === 'ENTRY' ? '#2e8b57' : '#2a6fdb';
      g += `<circle cx="${x}" cy="${y}" r="5" fill="${fill}" stroke="#2a6fdb" stroke-width="2"><title>${esc(r.lang)} ${r.year}: ${esc(r.form)} (${esc(r.source.toLowerCase())}${r.rule ? ': ' + esc(r.rule) : ''})</title></circle>`;
      g += svgText(x, y - 11, r.form, { anchor: 'middle', size: 13, mono: true });
      const lab = r.source === 'RULE' ? r.rule : r.source === 'SPLIT' ? 'split' : r.source === 'OVERRIDE' ? 'locked' : 'coined';
      g += svgText(x, y + 20, String(r.year), { anchor: 'middle', size: 10, fill: '#888' }) + svgText(x, y + 31, (lab || '').slice(0, 16), { anchor: 'middle', size: 10, fill: '#888' });
    }
  }
  return `<div class="treewrap"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="max-width:none">${g}</svg></div>`;
}
function sentView(b) {
  if (!b || !b.words || !b.words.length) return '<p class="muted small">Nothing to show.</p>';
  const cell = w => `<td class="${w.ok ? '' : 'gap'}"><div class="form"><strong>${esc(w.surface)}</strong></div><div class="small">${esc(w.gloss)}</div></td>`;
  let h = `<table class="interlinear"><tr>${b.words.map(cell).join('')}</tr></table><p><span class="form">${esc(b.surface)}</span></p>`;
  const notes = b.words.flatMap(w => w.parts).filter(p => p.ok === false || p.note);
  if (b.gaps) h += `<p class="small gap">${b.gaps} word${b.gaps > 1 ? 's' : ''} could not be built:</p>`;
  if (notes.length) h += '<ul class="small">' + notes.map(p => `<li class="${p.ok === false ? 'gap' : 'muted'}"><code>${esc(p.input)}</code>: ${esc(p.reason || p.note)}</li>`).join('') + '</ul>';
  return h;
}
function yearMatches(spec, y) {
  const t = spec.trim(); if (!t) return true;
  let m;
  if ((m = t.match(/^(-?\d+)\s*\.\.\s*(-?\d+)$/))) return y >= Math.min(+m[1], +m[2]) && y <= Math.max(+m[1], +m[2]);
  if ((m = t.match(/^<\s*(-?\d+)$/))) return y < +m[1];
  if ((m = t.match(/^>\s*(-?\d+)$/))) return y > +m[1];
  if (/^-?\d+$/.test(t)) return y === +t;
  return String(y).includes(t);
}
function fieldFilter(w) {
  const f = S.wf || {}, has = (v, q) => !q.trim() || String(v ?? '').toLowerCase().includes(q.trim().toLowerCase());
  if (f.id && f.id.trim()) { const ids = f.id.split(/[,\s]+/).filter(Boolean); if (!ids.includes(String(w.id))) return false; }
  return has(w.gloss, f.gloss || '') && has(w.pos, f.pos || '') && has(w.build, f.build || '') && yearMatches(f.year || '', w.year) &&
    (!(f.form || '').trim() || has(w.form, f.form) || has(w.origin_form, f.form) || has(w.ref_text, f.form));
}
function filteredWords() {
  const q = (S.q || '').toLowerCase();
  let all = S.showInherited === false ? S.words.filter(w => !w.inherited) : S.words;
  if (S.onlyProblems) all = all.filter(w => (w.problems || []).length);
  if (S.wf && Object.values(S.wf).some(v => (v || '').trim())) all = all.filter(fieldFilter);
  if (!q) return all;
  return all.filter(w => [w.id, w.gloss, w.meaning, w.ref_text, w.ref_gloss, w.ref_to ? 'reference see' : '', w.form, w.pos, w.notes, ...(w.forms || []).map(f => f.form)].join(' ').toLowerCase().includes(q));
}
function wordRow(w) {
  const d = defForm(w), more = (w.forms || []).filter(f => f !== d).length;
  const inh = w.inherited ? ` <span class="badge" title="Coined in ${esc(w.origin_lang)} as ${esc(w.origin_form)}">from ${esc(w.origin_lang)}</span>` : '';
  const act = w.inherited ? `<button data-act="goOrigin" data-id="${w.id}" data-lang="${w.origin_lang_id}">Open in ${esc(w.origin_lang)}</button>`
    : (canEdit() ? `<button data-act="editWord" data-id="${w.id}">Edit</button> <button class="danger" data-act="delWord" data-id="${w.id}">✕</button>` : '');
  return `<tr class="${w.inherited ? 'inherited' : ''}"><td class="muted small">${w.id}</td><td><a data-act="openWord" data-id="${w.id}" style="cursor:pointer"><strong>${esc(w.gloss)}</strong></a>${inh}${w.meaning_changed ? `<div class="small muted">means: ${esc(w.meaning)}</div>` : ''}${w.loan_from ? `<div class="small muted">borrowed from <strong>${esc(w.loan_from)}</strong></div>` : ''}${w.ref_to ? `<div class="small muted">→ same as <strong>${esc(w.ref_gloss)}</strong> (#${w.ref_to})</div>` : ''}${(w.problems || []).map(p => `<div class="small gap">⚠ ${esc(p)}</div>`).join('')}</td><td>${esc(w.pos)}</td><td>${esc(w.build)}</td><td>${w.year}</td>
    <td class="form">${esc(w.form)}</td><td>${d ? lines(d.latest) : '<span class="muted">—</span>'}${more ? ` <span class="badge">+${more}</span>` : ''}</td>
    <td>${w.length}</td><td>${esc(w.pronunciation)}</td><td>${esc((w.exists_in || []).join(', '))}</td>
    <td>${lines(w.latest)}${w.has_overrides ? ' <span class="badge">locked</span>' : ''}</td>
    <td>${act}</td></tr>`;
}
function drawDict() {
  const body = $('#wbody'); if (!body) return;
  const nProb = S.words.filter(w => (w.problems || []).length).length, pb = $('#probbtn');
  if (pb) { pb.textContent = (S.onlyProblems ? 'Show all words' : 'Show only words with problems') + ' (' + nProb + ')'; pb.className = S.onlyProblems ? 'primary' : ''; }
  const list = filteredWords(), size = S.pageSize, pages = Math.max(1, Math.ceil(list.length / size));
  S.page = Math.min(S.page, pages - 1);
  body.innerHTML = list.slice(S.page * size, (S.page + 1) * size).map(wordRow).join('') || '<tr><td colspan="12" class="muted">No words.</td></tr>';
  const html = `<span class="muted small">${list.length ? S.page * size + 1 : 0}–${Math.min(list.length, (S.page + 1) * size)} of ${list.length}</span>
    <button data-act="pagePrev" ${S.page === 0 ? 'disabled' : ''}>‹ Previous</button> <span class="small">page ${S.page + 1} / ${pages}</span>
    <button data-act="pageNext" ${S.page >= pages - 1 ? 'disabled' : ''}>Next ›</button>`;
  document.querySelectorAll('.pager').forEach(p => { p.innerHTML = html; });
}
async function refreshDict() { S.words = await api('GET', base() + '/words'); drawDict(); }

function lastPerLang(hist) {
  const m = {}; for (const x of hist) if (x.source !== 'ERROR') m[x.lang] = x.form; return m;
}
const histTable = hist => '<table><tr><th>Branch</th><th>Year</th><th>Form</th><th>How</th></tr>' + hist.map(x =>
  `<tr class="${x.source === 'ERROR' ? 'pending' : ''}"><td>${esc(x.lang)}</td><td>${x.year}</td><td class="form">${esc(x.form)}</td><td class="small">${esc(x.source.toLowerCase())}${x.rule ? ': ' + esc(x.rule) : ''}</td></tr>`).join('') + '</table>';

async function showWord() {
  const r = await api('GET', '/rune/api/words/' + S.openId + '/history');
  r.forms = r.forms || [];
  r.overrides = r.overrides || [];
  const w = r.word;
  S.openLang = w.language_id; S.openWordYear = w.year;
  const ownLang = (S.worlds || []).flatMap(x => x.languages || []).find(l => l.id === w.language_id);
  const ce = w.language_id === (S.lang && S.lang.id) ? canEdit() : !!(ownLang && ownLang.level >= 2);
  const langs = [...new Map(r.history.map(x => [x.lang_id, x.lang])).entries()];
  let h = `<button class="modalx" data-act="closeModal">✕</button><h2>${esc(w.gloss)} <span class="badge">#${w.id}</span> <span class="badge">${esc(w.pos)}</span> <span class="badge">${esc(w.build)}</span></h2>
    <p class="muted small">${S.lang && w.language_id !== S.lang.id ? 'Coined in another language; ' + esc(S.lang.name) + "'s own version is shown in the branch table below. " : ''}Coined ${w.year}${r.loan_from ? ' · borrowed from <strong>' + esc(r.loan_from) + '</strong>' : ''}${w.notes ? ' · ' + esc(w.notes) : ''}</p>
    <h3>Forms</h3><table><tr><th>Type</th><th>Entered</th><th>Latest per branch</th><th></th></tr>
    <tr><td>word</td><td class="form">${r.ref ? `reference to <strong>${esc(r.ref.gloss)}</strong> <span class="muted small">(#${r.ref.id}, ${w.year})</span>` : ''}${r.ref ? '' : ce ? `<a data-act="editWordForm" data-id="${w.id}" data-form="${esc(w.form)}" style="cursor:pointer" title="Click to edit">${esc(w.form)}</a>` : esc(w.form)}${r.ref ? '' : ` <span class="muted small">(${w.year})</span>`}</td><td>${lines(lastPerLang(r.history))}</td>
    <td>${ce ? (r.ref ? `<button data-act="popupEdit" data-id="${w.id}">Edit</button>` : `<button data-act="editWordForm" data-id="${w.id}" data-form="${esc(w.form)}">Edit</button>`) : ''}</td></tr>`;
  for (const f of r.forms) h += `<tr><td>${esc(f.label)}</td><td class="form">${ce && !r.ref ? `<a data-act="editForm" data-id="${f.id}" data-form="${esc(f.form)}" style="cursor:pointer" title="Click to edit">${esc(f.form)}</a>` : esc(f.form)} <span class="muted small">(${f.year ?? w.year})</span></td><td>${lines(lastPerLang(f.history))}</td>
    <td>${ce && !r.ref ? `<button data-act="editForm" data-id="${f.id}" data-form="${esc(f.form)}">Edit</button> <button class="danger" data-act="delForm" data-id="${f.id}">✕</button>` : ''}</td></tr>`;
  h += '</table>';
  if (ce && !r.ref) h += `<div class="row"><input id="f_label" list="f_labels" placeholder="form type (e.g. plural)" size="18"><datalist id="f_labels"><option>definite</option><option>plural</option><option>definite plural</option><option>past</option><option>future</option><option>object</option></datalist>
    <input id="f_form" placeholder="form" class="form"><input id="f_year" type="number" placeholder="year" size="8" value="${w.year}" data-yearcheck="form"><span id="f_warn" class="gap small"></span><button class="primary" data-act="addForm">Add form</button></div>
    <p class="muted small">Every form is run through the sound changes on its own, so it can end up different from the base word.</p>`;
  if (r.ref) h += `<p class="small">Cross-reference: this word uses the forms of <strong>${esc(r.ref.gloss)}</strong> (#${r.ref.id}).</p>`;
  if (r.history.length > 1) {
    h += '<h3>Evolution tree</h3>' + wordTree(r.history);
    for (const f of r.forms) if (f.history && f.history.length > 1) h += `<details><summary>tree: ${esc(f.label)}</summary>${wordTree(f.history)}</details>`;
  }
  h += `<h3>Meaning ${ce ? '<button data-act="toggleMeaning">Change meaning</button>' : ''}</h3>`;
  h += '<table><tr><th>Language</th><th>Meaning now</th></tr>' + Object.entries(r.meaning_by_lang || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('') + '</table>';
  if ((r.meanings || []).length) h += '<div class="small">' + r.meanings.map(m => `<div>${esc((langs.find(l => l[0] === m.lang_id) || [0, '?'])[1])} from ${m.year}: ${m.mode === 'CHANGE' ? 'changes to' : 'also means'} <strong>${esc(m.meaning)}</strong> ${ce ? `<button class="danger" data-act="delMeaning" data-id="${m.id}">✕</button>` : ''}</div>`).join('') + '</div>';
  if (ce) h += `<div id="mform" class="row" hidden><select id="m_lang">${langs.map(l => `<option value="${l[0]}">${esc(l[1])}</option>`).join('')}</select>
    <input id="m_year" type="number" placeholder="from year" size="8"><select id="m_mode"><option value="ADD">also means</option><option value="CHANGE">changes meaning to</option></select>
    <input id="m_text" placeholder="meaning"><button class="primary" data-act="addMeaning" data-w="${w.id}">Save</button>
    <p class="muted small">Applies to the chosen language and every branch that splits off after that year. “Changes to” replaces all earlier meanings.</p></div>`;
  h += '<h3>Full history</h3><details open><summary>word</summary>' + histTable(r.history) + '</details>';
  for (const f of r.forms) h += `<details><summary>${esc(f.label)}</summary>${histTable(f.history)}</details>`;
  if (r.overrides.length) h += '<h3>Locked overrides (word)</h3>' + r.overrides.map(o => `<div>${esc((langs.find(l => l[0] === o.lang_id) || [0, '?'])[1])} ${o.year}: <span class="form">${esc(o.form)}</span> ${ce ? `<button class="danger" data-act="delOverride" data-id="${o.id}">Unlock</button>` : ''}</div>`).join('');
  if (ce) h += `<h3>Lock a form of the word</h3><div class="row"><select id="o_lang">${langs.map(l => `<option value="${l[0]}">${esc(l[1])}</option>`).join('')}</select>
    <input id="o_year" type="number" placeholder="year"><input id="o_form" placeholder="form" class="form"><button data-act="addOverride" data-w="${w.id}">Lock</button></div>
    <p class="muted small">A locked form replaces the automatic one at that year; later sound changes continue from it.</p>`;
  let m = $('#modal');
  if (!m) { m = document.createElement('div'); m.id = 'modal'; m.className = 'modal'; document.body.appendChild(m); }
  m.innerHTML = '<div class="modalbox">' + h + '</div>'; m.hidden = false;
}
const wbase = () => '/rune/api/languages/' + (S.openLang || S.lang.id);
async function showSentence() {
  const r = await api('GET', '/rune/api/sentences/' + S.openSent + '/versions');
  const ce = canEdit();
  const dis = ce ? '' : 'disabled';
  let h = `<button class="modalx" data-act="closeModal">✕</button><h2>Sentence <span class="badge">#${r.id}</span></h2>
    <div class="row"><textarea id="e_src" rows="2" ${dis}>${esc(r.source)}</textarea></div>
    <div class="row"><input id="e_year" type="number" value="${r.year}" size="8" ${dis} title="year"><input id="e_tr" placeholder="English" size="28" value="${esc(r.translation || '')}" ${dis}>
      <input id="e_kind" placeholder="type" size="14" value="${esc(r.kind || '')}" ${dis}><input id="e_group" type="number" placeholder="group" size="6" value="${r.group_no ?? ''}" ${dis}>
      <input id="e_sub" type="number" placeholder="sub id" size="6" value="${r.sub_no ?? ''}" ${dis}><input id="e_notes" placeholder="notes" size="24" value="${esc(r.notes || '')}" ${dis}>
      <button data-act="sentRebuild">Preview</button>${ce ? '<button class="primary" data-act="sentUpdate">Save changes</button>' : ''}</div>
    <h3>As written (year ${r.year})</h3><div id="e_out">${sentView(r.built)}</div>
    <h3>Latest possible version</h3>`;
  for (const v of r.latest) h += `<h4>${esc(v.lang)}</h4>${sentView(v.built)}`;
  let m = $('#modal');
  if (!m) { m = document.createElement('div'); m.id = 'modal'; m.className = 'modal'; document.body.appendChild(m); }
  m.innerHTML = '<div class="modalbox">' + h + '</div>'; m.hidden = false;
}
function loanLangs() {
  const w = (S.worlds || []).find(x => (x.languages || []).some(l => S.lang && l.id === S.lang.id));
  return w ? w.languages.filter(l => l.id !== S.lang.id) : [];
}
function syncLoanBox() {
  const on = $('#w_isloan') && $('#w_isloan').checked;
  if ($('#w_loanlang')) $('#w_loanlang').hidden = !on;
  if ($('#w_loanword')) $('#w_loanword').hidden = !on;
  if (on && $('#w_isref') && $('#w_isref').checked) { $('#w_isref').checked = false; syncRefBox(); }
  if ($('#w_form') && on) $('#w_form').hidden = true; else if ($('#w_form') && !($('#w_isref') && $('#w_isref').checked)) $('#w_form').hidden = false;
}
async function fillLoanWords() {
  const id = val('w_loanlang'), dl = $('#w_loanwords');
  if (!dl) return;
  $('#w_loanword').value = '';
  if (!id) { dl.innerHTML = ''; return; }
  try {
    const ws = await api('GET', '/rune/api/languages/' + id + '/words');
    dl.innerHTML = ws.map(x => `<option value="${esc(x.gloss)} · ${esc(x.form)} #${x.id}">${esc(x.pos || '')}</option>`).join('');
  } catch (e) { say(e.message, true); }
}
function syncRefBox() {
  const on = $('#w_isref') && $('#w_isref').checked;
  if ($('#w_ref')) $('#w_ref').hidden = !on;
  if ($('#w_form')) $('#w_form').hidden = !!on;
  if (on && $('#w_isloan') && $('#w_isloan').checked) { $('#w_isloan').checked = false; syncLoanBox(); $('#w_form').hidden = true; }
}
async function rebuildFlow(what, body) {
  if (!confirm('Recompute ' + what + ' for EVERY word? Hand-edited forms will be overwritten.')) return;
  const dry = await api('POST', base() + '/forms/generate', { ...body, overwrite: true, prune: true, dryRun: true });
  let prune = false;
  if (dry.stale && dry.stale.length) {
    const lst = dry.stale.slice(0, 12).map(x => `${x.gloss} (${x.label}: ${x.form})`).join('\n');
    prune = confirm(dry.stale.length + ' existing forms no longer fit any rule (wrong word type, or the condition no longer matches):\n\n' + lst + (dry.stale.length > 12 ? '\n… and ' + (dry.stale.length - 12) + ' more' : '') +
      '\n\nOK = remove them as part of the rebuild.\nCancel = keep them.');
  }
  const r = await api('POST', base() + '/forms/generate', { ...body, overwrite: true, prune });
  say('Added ' + r.created + ', updated ' + r.updated + ', removed ' + (r.removed || 0) + ' forms.'); renderPanel();
}
async function afterWordChange() { await refreshDict(); if (S.openId && $('#modal') && !$('#modal').hidden) await showWord(); }
const TPL = {
  syncope: ['(?<={V}{C}){V}(?={C}{V})', ''], hiatus: ['{V}(?={V})', ''], haplology: ['(.{2,3})\\1', '$1'],
  geminate: ['({C})\\1', '$1'], cluster: ['({C})({C})(?={C})', '$2']
};

// ---------- sound changes: tags and versions ----------
const ruleTags = r => (r.tags || '').split(',').map(t => t.trim()).filter(Boolean);
function ruleTagList(rules) {
  const m = new Map();
  for (const r of rules) for (const t of ruleTags(r)) { const k = t.toLowerCase(); const e = m.get(k) || { tag: t, n: 0, off: 0 }; e.n++; if (r.off) e.off++; m.set(k, e); }
  for (const t of (S.lang.off_tags || '').split(',').map(x => x.trim()).filter(Boolean)) if (!m.has(t.toLowerCase())) m.set(t.toLowerCase(), { tag: t, n: 0, off: 0 });
  return [...m.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}
function ruleTagBar(rules) {
  const tags = ruleTagList(rules);
  if (!tags.length) return '';
  const ownOff = new Set((S.lang.off_tags || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
  return `<div class="card"><div class="row"><strong>Tags</strong> <span class="small muted">click one to show only those sound changes${isOwner() ? '; switching a tag off leaves its sound changes out (here and in all branches) until you switch it on again' : ''}</span>
    ${S.ruleTag ? '<button data-act="ruleTagFilter" data-t="">Show all</button>' : ''}</div><div class="row">` + tags.map(t => {
      const k = t.tag.toLowerCase(), mine = ownOff.has(k), inherited = !mine && t.off > 0;
      return `<span class="tagbox${mine || inherited ? ' isoff' : ''}"><a class="tagchip${S.ruleTag === k ? ' on' : ''}" data-act="ruleTagFilter" data-t="${esc(t.tag)}">${esc(t.tag)} <span class="small">(${t.n})</span></a>`
        + (mine ? ' <span class="small">off</span>' : inherited ? ' <span class="small" title="Switched off in a parent language">off above</span>' : '')
        + (isOwner() && !inherited ? ` <button class="small" data-act="ruleTagSwitch" data-t="${esc(t.tag)}" data-off="${mine ? 'false' : 'true'}">${mine ? 'Switch on' : 'Switch off'}</button>` : '') + '</span>';
    }).join(' ') + '</div></div>';
}
function ruleVersionsCard(versions) {
  const when = v => esc(String(v.created || '').slice(0, 16).replace('T', ' '));
  return `<details class="card" ${S.ruleVersionsOpen ? 'open' : ''} data-versions="1"><summary><strong>Versions</strong> <span class="small muted">(${versions.length}) save ${esc(S.lang.name)}'s sound changes as they are now, compare and restore</span></summary>
    ${canEdit() ? `<div class="row"><input id="rv_name" placeholder="name, e.g. before the vowel shift" size="28"><input id="rv_note" placeholder="note (optional)" size="34">
      <button class="primary" data-act="ruleVersionSave">Save version</button></div>` : ''}
    <p class="small muted">A version holds ${esc(S.lang.name)}'s own sound changes (not its branches') and the tags switched off in it.${isOwner() ? ' Restoring one first saves the sound changes as they are now as a version, so you can always go back.' : ''}</p>`
    + (versions.length ? '<table><tr><th>Name</th><th>Note</th><th>Saved</th><th>Rules</th><th></th></tr>' + versions.map(v => `<tr><td><strong>${esc(v.name)}</strong></td><td class="small">${esc(v.note || '')}</td>
      <td class="small">${when(v)} · ${esc(v.created_by_name || '')}</td><td>${v.rule_count}</td>
      <td><button data-act="ruleVersionCompare" data-id="${v.id}">Compare</button>${isOwner() ? ` <button data-act="ruleVersionRestore" data-id="${v.id}" data-n="${esc(v.name)}">Restore</button>` : ''}${isOwner() || (canEdit() && v.created_by === S.me.id) ? ` <button class="danger" data-act="ruleVersionDel" data-id="${v.id}" data-n="${esc(v.name)}">✕</button>` : ''}</td></tr>`).join('') + '</table>'
      : '<p class="muted">No versions saved yet.</p>') + '<div id="rv_out"></div></details>';
}
function ruleRow(r) { return `<td>${r.year}</td><td>${r.ord ?? 0}</td><td>${esc(r.name || '')}</td><td class="form">${esc(r.pattern)}</td><td class="form">${esc(r.replacement || '')}</td><td class="small">${esc(r.tags || '')}</td>`; }
function ruleCompareView(c) {
  const v = c.version, head = '<tr><th>Year</th><th>Order</th><th>Name</th><th>Pattern</th><th>Replacement</th><th>Tags</th></tr>';
  if (c.same) return `<p class="card">No changes since <strong>${esc(v.name)}</strong>.</p>`;
  let h = `<div class="card"><h4>Since “${esc(v.name)}”: ${c.added.length} added, ${c.removed.length} removed, ${c.changed.length} changed</h4>`;
  if (c.added.length) h += '<p><strong>Added since</strong></p><table>' + head + c.added.map(r => `<tr class="diffadd">${ruleRow(r)}</tr>`).join('') + '</table>';
  if (c.removed.length) h += '<p><strong>Removed since</strong></p><table>' + head + c.removed.map(r => `<tr class="diffdel">${ruleRow(r)}</tr>`).join('') + '</table>';
  if (c.changed.length) h += '<p><strong>Changed since</strong></p><table><tr><th>Sound change</th><th>What</th><th>Then</th><th>Now</th></tr>' + c.changed.map(x => x.fields.map((f, i) =>
    `<tr>${i === 0 ? `<td rowspan="${x.fields.length}">${esc(x.now.name || x.now.pattern)} <span class="small muted">#${x.id}</span></td>` : ''}<td>${esc(f)}</td><td class="form diffdel">${esc(x.then[f] ?? '')}</td><td class="form diffadd">${esc(x.now[f] ?? '')}</td></tr>`).join('')).join('') + '</table>';
  if ((c.offTags.then || '') !== (c.offTags.now || '')) h += `<p>Tags switched off then: <strong>${esc(c.offTags.then || 'none')}</strong>; now: <strong>${esc(c.offTags.now || 'none')}</strong></p>`;
  return h + '</div>';
}

// ---------- compound: missing words on the side ----------
function compMissList(miss) {
  const open = miss.entries.filter(e => !e.word), sel = S.compPick && S.compPick.g.toLowerCase();
  const item = (g, p, note) => `<a class="misspick${sel === g.toLowerCase() ? ' on' : ''}" data-act="compPick" data-g="${esc(g)}" data-p="${esc(p || '')}" title="${esc(note || 'Coin the compound for this meaning')}">${esc(g)}${p ? ` <span class="small muted">${esc(p)}</span>` : ''}</a>`;
  let h = open.length ? open.map(e => item(e.gloss, e.pos, e.notes)).join('') : '<p class="small muted">None marked as missing.</p>';
  if (miss.fromSentences.length) h += '<h4 class="small muted">Needed by sentences</h4>' + miss.fromSentences.map(g => item(g.meaning, '', 'Used in: ' + g.sentences.map(x => x.translation || x.source).join(' / '))).join('');
  return h;
}
function filterMissList() {
  const q = (val('c_missq') || '').trim().toLowerCase();
  document.querySelectorAll('#c_misslist .misspick').forEach(a => { a.hidden = !!q && !a.dataset.g.toLowerCase().includes(q); });
}
document.addEventListener('input', e => { if (e.target.id === 'c_missq') filterMissList(); });
document.addEventListener('toggle', e => { if (e.target.dataset && e.target.dataset.versions) S.ruleVersionsOpen = e.target.open; }, true);

// ---------- actions ----------
const A = {
  logout: async () => { await api('POST', '/api/auth/logout'); location.href = '/'; },
  exportAll: async () => { location.href = '/rune/api/admin/export-all'; },
  importAll: async () => {
    const file = await new Promise(res => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = () => res(inp.files[0] || null); inp.click();
    });
    if (!file) return;
    const send = async replace => {
      const fd = new FormData(); fd.append('file', file); if (replace) fd.append('replace', 'true');
      const res = await fetch('/rune/api/admin/import-all', { method: 'POST', body: fd });
      let data = null; try { data = await res.json(); } catch (e) { /* no body */ }
      return { res, data };
    };
    say('Importing ' + file.name + '…');
    let { res, data } = await send(false);
    if (res.status === 409) {
      if (!confirm(data.error + '\n\nDelete all worlds, languages and everything in them here, and import the file instead? Accounts are kept.')) { say(''); return; }
      ({ res, data } = await send(true));
    }
    if (!res.ok) throw new Error((data && (data.error || data.message)) || ('Import failed (' + res.status + ')'));
    const c = data.counts || {};
    alert('Imported from Root and Rune ' + (data.from || '?') + ':\n\n'
      + (c.worlds || 0) + ' worlds, ' + (c.languages || 0) + ' languages, ' + (c.words || 0) + ' words, ' + (c.rules || 0) + ' sound changes, '
      + (c.word_forms || 0) + ' word forms, ' + (c.form_rules || 0) + ' form rules, ' + (c.sentences || 0) + ' sentences.\n\n'
      + 'Accounts created (their old passwords work): ' + (data.usersCreated.join(', ') || 'none') + '\n'
      + 'Accounts that already existed here (passwords here kept): ' + (data.usersMatched.join(', ') || 'none')
      + (data.warnings.length ? '\n\nNotes:\n' + data.warnings.join('\n') : ''));
    S.lang = null; say('');
    await boot();
  },
  missAdd: async () => {
    await api('POST', base() + '/missing', { gloss: val('m_gloss'), pos: val('m_pos'), notes: val('m_notes') });
    say('Marked as missing.'); await renderPanel(); $('#m_gloss').focus();
  },
  missBulk: async () => {
    const r = await api('POST', base() + '/missing/bulk', { text: val('m_bulk') });
    say('Added ' + r.added.length + '.' + (r.onList.length ? ' On the list already: ' + r.onList.join(', ') + '.' : '')
      + (r.haveWord.length ? ' Has a word already: ' + r.haveWord.join(', ') + '.' : '') + (r.bad.length ? ' Not added (brackets or too long): ' + r.bad.join(', ') + '.' : ''));
    await renderPanel();
  },
  missCompound: async d => { S.compPick = { g: d.g, p: d.p || '' }; S.tab = 'compound'; await renderPanel(); if ($('#c_parts')) $('#c_parts').focus(); },
  missMark: async d => { await api('POST', base() + '/missing', { gloss: d.g }); say('Marked as missing.'); await renderPanel(); },
  missDel: async d => { await api('DELETE', '/rune/api/missing/' + d.id); await renderPanel(); },
  missClear: async () => { const r = await api('POST', base() + '/missing/clear-filled'); say('Removed ' + r.removed + '.'); await renderPanel(); },
  missCoin: async d => {
    S.tab = 'dict'; await renderPanel();
    if (!$('#w_gloss')) return;
    $('#w_gloss').value = d.g; if (d.p && $('#w_pos')) $('#w_pos').value = d.p;
    $('#w_form').focus(); say('Give "' + d.g + '" a form, then add it. It is ticked off on the Missing words tab.');
  },
  resetCode: async () => {
    const u = prompt('Username to issue a reset code for:'); if (!u) return;
    const r = await api('POST', '/rune/api/admin/reset-code', { username: u });
    alert('Reset code for ' + r.username + ' (valid ' + r.validHours + ' hours):\n\n' + r.code + '\n\nGive it to them; it will not be shown again.');
  },
  newWorld: async () => { const n = prompt('World name:'); if (!n) return; await api('POST', '/rune/api/worlds', { name: n }); await loadWorlds(); render(); },
  delWorld: async d => { if (!confirm('Delete this world and ALL its languages and words?')) return; await api('DELETE', '/rune/api/worlds/' + d.w); S.lang = null; await loadWorlds(); render(); },
  newLang: async d => {
    const n = prompt('Language name:'); if (!n) return;
    await api('POST', '/rune/api/languages', { worldId: Number(d.w), name: n }); await loadWorlds(); render();
  },
  pick: async d => { S.lang = S.worlds.flatMap(w => w.languages).find(l => l.id === Number(d.id)); S.tab = 'dict'; render(); },
  tab: async d => { S.tab = d.t; if (d.t !== 'rules') S.ruleTag = null; if (d.t !== 'compound') S.compPick = null; if (d.t !== 'forms') S.prefill = null; renderPanel(); },
  undo: async () => { const r = await api('POST', base() + '/undo'); say('Undid ' + r.undone); renderPanel(); },
  redo: async () => { const r = await api('POST', base() + '/redo'); say('Redid ' + r.redone); renderPanel(); },

  saveShape: async () => {
    await api('PUT', base(), { syllableShape: val('gr_shape') });
    say('Syllable shape saved.'); await loadWorlds(); renderPanel();
  },
  suggestRoots: async () => {
    const [lo, hi] = val('sg_syl').split('-');
    const n = Math.max(1, Math.min(40, Number(val('sg_n')) || 10));
    const r = await api('GET', base() + '/suggest-roots?count=' + n + '&min=' + lo + '&max=' + hi);
    const shapeNote = r.shape ? `<span class="muted small">Shape ${esc(r.shape)}${r.mode === 'shape' ? ' (built from the shape and the Sounds tab, since there are too few words to learn from)' : ''}: </span>` : '';
    $('#sg_out').innerHTML = shapeNote + (r.roots.length ? r.roots.map(x => `<button class="form" data-act="useRoot" data-form="${esc(x)}">${esc(x)}</button>`).join(' ')
      : `<span class="muted small">${esc(r.reason || 'No free form was found. Try again or allow more syllables.')}</span>`);
  },
  useRoot: async d => {
    if ($('#w_isref') && $('#w_isref').checked) { $('#w_isref').checked = false; syncRefBox(); }
    if ($('#w_isloan') && $('#w_isloan').checked) { $('#w_isloan').checked = false; syncLoanBox(); }
    $('#w_form').hidden = false; $('#w_form').value = d.form; $('#w_gloss').focus();
  },
  saveWord: async () => {
    const p = { gloss: val('w_gloss'), pos: val('w_pos'), build: val('w_build'), form: val('w_form'), notes: val('w_notes') };
    if (val('w_year') !== '') p.year = Number(val('w_year'));
    if ($('#w_isref') && $('#w_isref').checked) {
      const t = val('w_ref').trim(), m = t.match(/#(\d+)\s*$/);
      let target = m ? Number(m[1]) : null;
      if (target == null) { const c = S.words.filter(x => !x.ref_to && x.gloss.toLowerCase() === t.toLowerCase()); if (c.length === 1) target = c[0].id; else { say(c.length ? 'Several words are called "' + t + '": pick one from the list.' : 'Pick the word to refer to from the list.', true); return; } }
      p.ref_word_id = target; delete p.form;
    } else if (val('w_id')) p.ref_word_id = null;
    if ($('#w_isloan') && $('#w_isloan').checked) {
      const t = val('w_loanword').trim(), m = t.match(/#(\d+)\s*$/);
      if (!m) { say('Pick the language, then the word to borrow from the list.', true); return; }
      if (val('w_year') === '') { say('Give the year of borrowing.', true); return; }
      p.loan_word_id = Number(m[1]); delete p.form; delete p.ref_word_id;
      if (!p.gloss) p.gloss = t.replace(/\s*#\d+\s*$/, '').replace(/\s*·.*$/, '');
    }
    const id = val('w_id');
    const r = await api('POST', base() + '/edit', { entity: 'word', action: id ? 'UPDATE' : 'CREATE', entityId: id ? Number(id) : null, payload: p });
    say(r.status === 'pending' ? 'Submitted for the owner to approve.' : 'Saved.'); renderPanel();
  },
  editWord: async d => {
    const w = S.words.find(x => x.id === Number(d.id));
    for (const [k, v] of [['gloss', w.gloss], ['pos', w.pos], ['build', w.build], ['form', w.ref_to ? '' : w.form], ['year', w.year], ['notes', w.notes]]) $('#w_' + k).value = v ?? '';
    $('#w_isref').checked = !!w.ref_to; $('#w_ref').value = w.ref_to ? w.ref_gloss + ' #' + w.ref_to : ''; syncRefBox();
    $('#w_id').value = w.id; $('#w_btn').textContent = 'Save changes'; window.scrollTo(0, 0);
  },
  delWord: async d => {
    if (!confirm('Delete this word?')) return;
    const r = await api('POST', base() + '/edit', { entity: 'word', action: 'DELETE', entityId: Number(d.id) });
    say(r.status === 'pending' ? 'Submitted for the owner to approve.' : 'Deleted. (Undo is available.)'); renderPanel();
  },
  page: async d => { S.page = d.p; stopLogTimer(); S.openId = null; const m = $('#modal'); if (m) m.hidden = true; render(); },
  connectorCreate: async () => {
    S.connectorNew = await api('POST', '/rune/api/admin/connector-keys', { username: val('cn_user'), label: val('cn_label') });
    await connectorPage();
  },
  connectorCopy: async () => { const i = $('#cn_url'); i.select(); try { await navigator.clipboard.writeText(i.value); say('Copied.'); } catch (e) { document.execCommand('copy'); say('Copied.'); } },
  connectorRevoke: async d => {
    if (!confirm('Revoke connector address #' + d.id + '? Claude can no longer use it.')) return;
    await api('DELETE', '/rune/api/admin/connector-keys/' + d.id); say('Revoked.'); await connectorPage();
  },
  logSearch: async () => { S.logFilter = { level: val('lg_level'), category: val('lg_cat'), q: val('lg_q').trim() }; await loadLog(true); },
  logMore: async () => { await loadLog(false); },
  logRow: async d => {
    const row = document.querySelector(`#lg_body tr[data-id="${d.id}"]`);
    const next = row.nextElementSibling;
    if (next && next.classList.contains('lg_detail')) { next.remove(); return; }
    const r = await api('GET', '/rune/api/admin/log/' + d.id);
    const tr = document.createElement('tr'); tr.className = 'lg_detail';
    tr.innerHTML = `<td colspan="8"><div class="small"><strong>${esc(r.message)}</strong></div>${r.detail ? `<pre class="trace">${esc(r.detail)}</pre>` : '<div class="muted small">No further details.</div>'}
      <button data-act="logCopy" data-id="${r.id}">Copy entry</button></td>`;
    tr.dataset.text = '#' + r.id + ' ' + r.ts + ' ' + r.lvl + ' [' + r.category + '] ' + (r.username || '-') + ' ' + (r.request || '') + ' ' + (r.status ?? '') + '\n' + (r.message || '') + '\n' + (r.detail || '');
    row.after(tr);
  },
  logCopy: async d => {
    const tr = document.querySelector(`#lg_body tr.lg_detail [data-act="logCopy"][data-id="${d.id}"]`).closest('tr');
    try { await navigator.clipboard.writeText(tr.dataset.text); say('Copied.'); } catch (e) { say('Could not copy; select the text and copy it by hand.', true); }
  },
  logClear: async () => { if (!confirm('Delete all log entries?')) return; await api('DELETE', '/rune/api/admin/log'); say('Log cleared.'); await loadLog(true); },
  openWord: async d => { S.openId = Number(d.id); await showWord(); },
  closeModal: async () => { const m = $('#modal'); if (m) m.hidden = true; S.openId = null; },
  addForm: async () => {
    const p = { word_id: S.openId, label: val('f_label'), form: val('f_form') };
    if (val('f_year') !== '') p.year = Number(val('f_year'));
    if (p.year != null && S.openWordYear != null && p.year < S.openWordYear && !confirm('The year ' + p.year + ' is older than the word itself (' + S.openWordYear + '). Add the form anyway?')) return;
    const r = await api('POST', wbase() + '/edit', { entity: 'form', action: 'CREATE', payload: p });
    say(r.status === 'pending' ? 'Submitted for the owner to approve.' : 'Form added.'); await afterWordChange();
  },
  ruleImportCheck: async () => {
    const f = $('#ri_file') && $('#ri_file').files[0];
    if (!f) { say('Choose a JSON file first.', true); return; }
    let data;
    try { data = JSON.parse(await f.text()); } catch (e) { say('That file is not valid JSON: ' + e.message, true); return; }
    const rules = Array.isArray(data) ? data : data.rules;
    if (!Array.isArray(rules)) { say('The file needs a "rules" list.', true); return; }
    S.ruleImport = { rules, removeMissing: $('#ri_rm').checked };
    const res = await api('POST', base() + '/rules/import', { ...S.ruleImport, dryRun: true });
    const act = { add: 'add', change: 'change', remove: 'remove', same: 'same', skip: 'skip' };
    let h = `<p><strong>${res.added}</strong> to add, <strong>${res.changed}</strong> to change, <strong>${res.removed}</strong> to remove, ${res.unchanged} unchanged.</p>`;
    if (res.errors.length) h += '<div class="gap"><strong>Nothing will be imported until these are fixed:</strong><ul>' + res.errors.map(e => `<li>${esc(e)}</li>`).join('') + '</ul></div>';
    const shown = res.items.filter(i => i.action !== 'same');
    if (shown.length) h += '<table><tr><th></th><th>Language</th><th>Year</th><th>Pattern</th><th>Replacement</th><th></th></tr>' +
      shown.map(i => `<tr class="${i.action === 'remove' ? 'pending' : ''}"><td>${act[i.action]}</td><td>${esc(i.language)}</td><td>${i.year ?? ''}</td><td class="form">${esc(i.pattern)}</td><td class="form">${esc(i.replacement)}</td><td class="small muted">${esc(i.detail)}</td></tr>`).join('') + '</table>';
    if (!res.errors.length && (res.added || res.changed || res.removed)) h += '<div class="row"><button class="primary" data-act="ruleImportApply">Apply these changes</button></div>';
    $('#ri_out').innerHTML = h;
  },
  ruleImportApply: async () => {
    if (!S.ruleImport) return;
    const res = await api('POST', base() + '/rules/import', { ...S.ruleImport, dryRun: false });
    S.ruleImport = null;
    say('Imported: ' + res.added + ' added, ' + res.changed + ' changed, ' + res.removed + ' removed' + (res.pending ? ' (' + res.pending + ' waiting for the owner to approve)' : '') + '. Undo is available.');
    renderPanel();
  },
  ruleScope: async d => { S.ruleScope = d.v; try { localStorage.setItem('ruleScope', d.v); } catch (x) { /* ignore */ } renderPanel(); },
  clearFilters: async () => { S.wf = {}; S.q = ''; S.page = 0; renderPanel(); },
  toggleProblems: async () => { S.onlyProblems = !S.onlyProblems; S.page = 0; drawDict(); },
  popupEdit: async d => {
    const m = $('#modal'); if (m) m.hidden = true; S.openId = null;
    if (S.tab === 'dict' && S.words.some(x => x.id === Number(d.id) && !x.inherited)) await A.editWord(d); else say('Open the word in its own language to edit it.', true);
  },
  editWordForm: async d => {
    const f = prompt('New form of the word (the form it had when coined):', d.form); if (f == null || !f.trim() || f.trim() === d.form) return;
    const r = await api('POST', wbase() + '/edit', { entity: 'word', action: 'UPDATE', entityId: Number(d.id), payload: { form: f.trim() } });
    say(r.status === 'pending' ? 'Submitted for the owner to approve.' : 'Saved. Undo is available.'); await afterWordChange();
  },
  editForm: async d => {
    const f = prompt('New form:', d.form); if (f == null || !f.trim()) return;
    const r = await api('POST', wbase() + '/edit', { entity: 'form', action: 'UPDATE', entityId: Number(d.id), payload: { form: f.trim() } });
    say(r.status === 'pending' ? 'Submitted for the owner to approve.' : 'Saved.'); await afterWordChange();
  },
  delForm: async d => {
    if (!confirm('Delete this form?')) return;
    const r = await api('POST', wbase() + '/edit', { entity: 'form', action: 'DELETE', entityId: Number(d.id) });
    say(r.status === 'pending' ? 'Submitted for the owner to approve.' : 'Deleted.'); await afterWordChange();
  },
  addOverride: async d => {
    const r = await api('POST', wbase() + '/edit', { entity: 'override', action: 'CREATE', payload: { word_id: Number(d.w), lang_id: Number(val('o_lang')), year: Number(val('o_year')), form: val('o_form') } });
    say(r.status === 'pending' ? 'Submitted for the owner to approve.' : 'Locked.'); await afterWordChange();
  },
  delOverride: async d => { await api('POST', wbase() + '/edit', { entity: 'override', action: 'DELETE', entityId: Number(d.id) }); say('Unlocked.'); await afterWordChange(); },
  pagePrev: async () => { S.page = Math.max(0, S.page - 1); drawDict(); },
  pageNext: async () => { S.page++; drawDict(); },
  saveFormRule: async () => {
    const id = val('fr_id');
    const link = val('fr_link').trim();
    let awid = '';
    if (link) {
      const m = S.wordnames.filter(w => w.gloss.toLowerCase() === link.toLowerCase());
      if (!m.length) { say('No dictionary word called "' + link + '" in this language or its ancestors.', true); return; }
      awid = (m.find(w => w.language_id === S.lang.id) || m[0]).id;
    }
    if (awid) {
      const aw = S.wordnames.find(w => w.id === awid), y = val('fr_year');
      if (aw && y !== '' && Number(y) < aw.year && !confirm('The year ' + y + ' is older than the word "' + aw.gloss + '" (' + aw.year + '). Continue anyway?')) return;
    }
    const p = { grp: val('fr_grp').trim(), label: val('fr_label'), pos: val('fr_pos'), placement: val('fr_place'), affix: val('fr_affix'), affix_word_id: awid, cond_re: val('fr_cond'),
      hiatus: $('#fr_hiatus').checked ? 1 : 0, year: val('fr_year'), ord: Number(val('fr_ord') || 0) };
    const r = await api('POST', base() + '/edit', { entity: 'formrule', action: id ? 'UPDATE' : 'CREATE', entityId: id ? Number(id) : null, payload: p });
    S.prefill = null;
    say(r.status === 'pending' ? 'Submitted for the owner to approve.' : 'Saved. New words will use it; owners can add it to existing words with the button below.'); renderPanel();
  },
  editFormRule: async d => {
    const r = S.formrules.find(x => x.id === Number(d.id));
    for (const [k, v] of [['grp', r.grp], ['label', r.label], ['pos', r.pos], ['place', r.placement], ['affix', r.affix], ['link', r.affix_gloss], ['cond', r.cond_re], ['year', r.year], ['ord', r.ord]]) $('#fr_' + k).value = v ?? '';
    $('#fr_hiatus').checked = !!r.hiatus; $('#fr_id').value = r.id; $('#fr_btn').textContent = 'Save changes'; $('#fr_cancel').hidden = false; window.scrollTo(0, 0);
  },
  cancelFormRule: async () => { S.prefill = null; renderPanel(); },
  delFormRule: async d => {
    if (!confirm('Delete this form rule? Forms already created stay on the words.')) return;
    const r = await api('POST', base() + '/edit', { entity: 'formrule', action: 'DELETE', entityId: Number(d.id) });
    say(r.status === 'pending' ? 'Submitted for approval.' : 'Deleted.'); renderPanel();
  },
  genForms: async () => {
    const r = await api('POST', base() + '/forms/generate', {}); say('Added ' + r.created + ' forms.'); renderPanel();
  },
  rebuildGroup: async d => { await rebuildFlow(d.g ? 'every form in the group "' + d.g + '"' : 'every ungrouped form', { group: d.g || '' }); },
  rebuildForm: async d => { await rebuildFlow('the "' + d.l + '" form', { label: d.l }); },
  rowToForm: async d => {
    const e = S.grammar.entries.find(x => x.id === Number(d.id));
    S.prefill = { label: e.name, hint: [e.c1, e.c2].filter(Boolean).join(' · ') }; S.tab = 'forms'; await renderPanel();
    if ($('#fr_label')) $('#fr_label').value = e.name;
  },
  saveGrammar: async () => {
    const id = val('gr_id');
    const p = { category: val('gr_cat'), name: val('gr_name'), year: val('gr_year') };
    for (let k = 1; k <= 6; k++) p['c' + k] = val('gr_c' + k);
    if (!id) p.ord = (S.grammar.entries.reduce((m, e) => Math.max(m, e.ord), 0)) + 1;
    const r = await api('POST', base() + '/edit', { entity: 'grammar', action: id ? 'UPDATE' : 'CREATE', entityId: id ? Number(id) : null, payload: p });
    say(r.status === 'pending' ? 'Submitted for the owner to approve.' : 'Saved.'); renderPanel();
  },
  editGrammar: async d => {
    const e = S.grammar.entries.find(x => x.id === Number(d.id));
    $('#gr_cat').value = e.category; applyHeadings(); $('#gr_name').value = e.name ?? ''; $('#gr_year').value = e.year ?? '';
    for (let k = 1; k <= 6; k++) $('#gr_c' + k).value = e['c' + k] ?? '';
    $('#gr_id').value = e.id; $('#gr_btn').textContent = 'Save changes'; $('#gr_cancel').hidden = false; window.scrollTo(0, 0);
  },
  cancelGrammar: async () => renderPanel(),
  delGrammar: async d => {
    if (!confirm('Delete this row?')) return;
    const r = await api('POST', base() + '/edit', { entity: 'grammar', action: 'DELETE', entityId: Number(d.id) });
    say(r.status === 'pending' ? 'Submitted for approval.' : 'Deleted.'); renderPanel();
  },
  newSection: async () => {
    const t = prompt('Section title:'); if (!t || !t.trim()) return;
    const hd = prompt('Column headings, separated by | (up to 6, e.g. rule | english | construction | elven):', '') || '';
    const heads = hd.split('|').map(x => x.trim()).slice(0, 6);
    const r = await api('POST', base() + '/edit', { entity: 'gsection', action: 'CREATE', payload: { title: t.trim(), headings: heads.join('\t'), ord: S.grammar.sections.length + 1 } });
    say(r.status === 'pending' ? 'Submitted for approval.' : 'Section added.'); renderPanel();
  },
  editHeadings: async d => {
    const sec = S.grammar.sections.find(x => x.title === d.t);
    if (!sec) { say('That section has no heading record (it only exists through its rows). Create it with "+ New section".', true); return; }
    const hd = prompt('Column headings, separated by | (up to 6):', (sec.headings || '').split('\t').join(' | ')); if (hd == null) return;
    const r = await api('POST', base() + '/edit', { entity: 'gsection', action: 'UPDATE', entityId: sec.id, payload: { headings: hd.split('|').map(x => x.trim()).slice(0, 6).join('\t') } });
    say(r.status === 'pending' ? 'Submitted for approval.' : 'Saved.'); renderPanel();
  },
  delSection: async d => {
    if (S.grammar.entries.some(e => e.category === d.t)) { say('Delete the rows in that section first.', true); return; }
    const sec = S.grammar.sections.find(x => x.title === d.t); if (!sec || !confirm('Delete the empty section "' + d.t + '"?')) return;
    const r = await api('POST', base() + '/edit', { entity: 'gsection', action: 'DELETE', entityId: sec.id });
    say(r.status === 'pending' ? 'Submitted for approval.' : 'Deleted.'); renderPanel();
  },
  savePhoneme: async () => {
    const id = val('ph_id');
    const p = { symbol: val('ph_symbol'), kind: val('ph_kind'), row_label: val('ph_row'), col_label: val('ph_col'), notes: val('ph_notes'), year: val('ph_from'), year_to: val('ph_to') };
    const r = await api('POST', base() + '/edit', { entity: 'phoneme', action: id ? 'UPDATE' : 'CREATE', entityId: id ? Number(id) : null, payload: p });
    say(r.status === 'pending' ? 'Submitted for the owner to approve.' : 'Saved.'); renderPanel();
  },
  editPhoneme: async d => {
    const p = S.phonemes.find(x => x.id === Number(d.id));
    for (const [k, v] of [['symbol', p.symbol], ['kind', p.kind], ['row', p.row_label], ['col', p.col_label], ['notes', p.notes], ['from', p.year], ['to', p.year_to]]) $('#ph_' + k).value = v ?? '';
    $('#ph_id').value = p.id; $('#ph_btn').textContent = 'Save changes'; $('#ph_cancel').hidden = false; window.scrollTo(0, 0);
  },
  cancelPhoneme: async () => renderPanel(),
  delPhoneme: async d => {
    if (!confirm('Delete this sound?')) return;
    const r = await api('POST', base() + '/edit', { entity: 'phoneme', action: 'DELETE', entityId: Number(d.id) });
    say(r.status === 'pending' ? 'Submitted for approval.' : 'Deleted.'); renderPanel();
  },
  addRule: async () => {
    const id = val('r_id'), lang = val('r_lang') || S.lang.id;
    const r = await api('POST', '/rune/api/languages/' + lang + '/edit', { entity: 'rule', action: id ? 'UPDATE' : 'CREATE', entityId: id ? Number(id) : null,
      payload: { year: Number(val('r_year')), ord: Number(val('r_ord') || 0), name: val('r_name'), pattern: val('r_pat'), replacement: val('r_rep'), tags: val('r_tags') } });
    say(r.status === 'pending' ? 'Submitted for the owner to approve.' : (id ? 'Rule saved.' : 'Rule added.')); renderPanel();
  },
  editRule: async d => {
    const r = S.rules.find(x => x.id === Number(d.id));
    for (const [k, v] of [['year', r.year], ['ord', r.ord], ['name', r.name], ['pat', r.pattern], ['rep', r.replacement], ['tags', r.tags]]) $('#r_' + k).value = v ?? '';
    $('#r_id').value = r.id; if (![...$('#r_lang').options].some(o => o.value === String(r.language_id))) $('#r_lang').add(new Option(r.lang_name, r.language_id));
    $('#r_lang').value = r.language_id; $('#r_lang').disabled = true; $('#r_btn').textContent = 'Save changes'; $('#r_cancel').hidden = false; window.scrollTo(0, 0);
  },
  cancelRule: async () => renderPanel(),
  ruleTagFilter: async d => { const k = (d.t || '').toLowerCase(); S.ruleTag = !k || S.ruleTag === k ? null : k; await renderPanel(); },
  ruleTagSwitch: async d => {
    const r = await api('POST', base() + '/tag-switch', { tag: d.t, off: d.off === 'true' });
    S.lang.off_tags = r.off_tags; say('Sound changes tagged "' + d.t + '" are ' + (d.off === 'true' ? 'switched off' : 'on again') + '.'); await renderPanel();
  },
  ruleVersionSave: async () => {
    const r = await api('POST', base() + '/rule-versions', { name: val('rv_name'), note: val('rv_note') });
    S.ruleVersionsOpen = true; say('Saved as version #' + r.id + '.'); await renderPanel();
  },
  ruleVersionCompare: async d => { $('#rv_out').innerHTML = ruleCompareView(await api('GET', '/rune/api/rule-versions/' + d.id + '/compare')); },
  ruleVersionRestore: async d => {
    if (!confirm('Restore "' + d.n + '"? ' + S.lang.name + "'s sound changes become as they were in that version. The sound changes as they are now are saved as a version first, so you can go back.")) return;
    const r = await api('POST', '/rune/api/rule-versions/' + d.id + '/restore');
    S.ruleVersionsOpen = true; await loadWorlds(); S.lang = S.worlds.flatMap(w => w.languages).find(l => l.id === S.lang.id) || S.lang;
    say('Restored ' + r.restored + ' sound changes. The ones before were saved as version #' + r.savedFirst + '.'); await renderPanel();
  },
  ruleVersionDel: async d => {
    if (!confirm('Delete the version "' + d.n + '"? The sound changes themselves are not touched.')) return;
    await api('DELETE', '/rune/api/rule-versions/' + d.id); S.ruleVersionsOpen = true; await renderPanel();
  },
  delRule: async d => {
    if (!confirm('Delete this rule?')) return;
    const rule = S.rules.find(x => x.id === Number(d.id));
    const r = await api('POST', '/rune/api/languages/' + rule.language_id + '/edit', { entity: 'rule', action: 'DELETE', entityId: Number(d.id) });
    say(r.status === 'pending' ? 'Submitted for approval.' : 'Deleted.'); renderPanel();
  },
  previewRule: async () => {
    const r = await api('POST', '/rune/api/languages/' + (val('r_lang') || S.lang.id) + '/rules/preview', { year: Number(val('r_year')), ord: Number(val('r_ord') || 0), pattern: val('r_pat'), replacement: val('r_rep') });
    $('#rprev').innerHTML = `<p><strong>${r.wordsAffected}</strong> words would change.</p>` + (r.changes.length ? '<table><tr><th>Word</th><th>Branch</th><th>Before</th><th>After</th></tr>' +
      r.changes.map(c => `<tr><td>${esc(c.gloss)}</td><td>${esc(c.branch)}</td><td class="form">${esc(c.before)}</td><td class="form">${esc(c.after)}</td></tr>`).join('') + '</table>' : '');
  },
  openSentence: async d => { S.openSent = Number(d.id); await showSentence(); },
  sentRebuild: async () => {
    const b = await api('POST', base() + '/sentences/build', { source: val('e_src'), year: Number(val('e_year') || 0) });
    $('#e_out').innerHTML = sentView(b);
  },
  sentUpdate: async () => {
    await api('PUT', '/rune/api/sentences/' + S.openSent, { source: val('e_src'), year: Number(val('e_year') || 0), translation: val('e_tr'), notes: val('e_notes'), kind: val('e_kind'), group: val('e_group'), sub: val('e_sub') });
    say('Saved.'); await showSentence(); renderPanel();
  },
  mergersGo: async () => {
    const o = $('#m_out'); o.textContent = 'Calculating…';
    const res = await api('GET', base() + '/mergers');
    let h = '<table><tr><th>Language</th><th>Words</th><th>Different forms at start</th><th>Different forms now</th><th>Merged</th><th>Words sharing a form: start</th><th>now</th></tr>' +
      res.map(m => `<tr><td><strong>${esc(m.language)}</strong></td><td>${m.words}</td><td>${m.distinct_start}</td><td>${m.distinct_now}</td><td><strong>${m.merged}</strong> (${m.distinct_start ? Math.round(m.merged / m.distinct_start * 100) : 0}%)</td><td>${m.homophone_words_start}</td><td>${m.homophone_words_now}</td></tr>`).join('') + '</table>';
    for (const m of res) {
      if (!m.rules.length && !m.groups.length) continue;
      h += `<details><summary>${esc(m.language)}: rules that merge the most, and words that now sound alike</summary>`;
      if (m.rules.length) h += '<table><tr><th>Year</th><th>Rule</th><th>Words changed</th><th>Forms merged</th></tr>' + m.rules.map(r => `<tr><td>${r.year}</td><td class="form">${esc(r.rule)}</td><td>${r.changed}</td><td>${r.merged}</td></tr>`).join('') + '</table>';
      if (m.groups.length) h += '<p class="small"><strong>Biggest groups of words with the same form now:</strong></p><ul class="small">' + m.groups.map(g => `<li><span class="form">${esc(g.form)}</span>: ${g.words.map(esc).join(', ')}</li>`).join('') + '</ul>';
      h += '</details>';
    }
    o.innerHTML = h;
  },
  drawGraph: async () => {
    const q = new URLSearchParams();
    for (const [k, id] of [['a', 'g_a'], ['b', 'g_b'], ['from', 'g_from'], ['to', 'g_to']]) if (val(id) !== '') q.set(k, val(id));
    if (q.has('a') !== q.has('b')) { say('Pick both languages, or leave both on (all pairs).', true); return; }
    try { S.divergence = await api('GET', base() + '/divergence?' + q); drawDivergence(); }
    catch (e) { const o = $('#g_out'); if (o) o.innerHTML = ''; say(e.message, true); }
  },
  toggleMeaning: async () => { const f = $('#mform'); if (f) f.hidden = !f.hidden; },
  addMeaning: async d => {
    if (!val('m_year') || !val('m_text')) { say('Give a year and a meaning.', true); return; }
    const r = await api('POST', wbase() + '/edit', { entity: 'meaning', action: 'CREATE', payload: { word_id: Number(d.w), lang_id: Number(val('m_lang')), year: Number(val('m_year')), mode: val('m_mode'), meaning: val('m_text') } });
    say(r.status === 'pending' ? 'Submitted for approval.' : 'Meaning saved.'); await afterWordChange();
  },
  delMeaning: async d => { await api('POST', wbase() + '/edit', { entity: 'meaning', action: 'DELETE', entityId: Number(d.id) }); await afterWordChange(); },
  sentBuild: async () => {
    S.sentSrc = val('s_src'); S.sentYear = Number(val('s_year') || 0);
    const b = await api('POST', base() + '/sentences/build', { source: S.sentSrc, year: S.sentYear });
    $('#s_out').innerHTML = sentView(b);
  },
  sentSave: async () => {
    S.sentSrc = val('s_src'); S.sentYear = Number(val('s_year') || 0);
    await api('POST', base() + '/sentences', { source: S.sentSrc, year: S.sentYear, translation: val('s_tr'), notes: val('s_notes'), kind: val('s_kind'), group: val('s_group'), sub: val('s_sub') });
    say('Saved.'); S.sentSrc = ''; S.sentTr = ''; S.sentKind = ''; renderPanel();
  },
  sentLoad: async d => { const x = (S.sentList || []).find(q => q.id === Number(d.id)); if (x) { S.sentSrc = x.source; S.sentYear = x.year; S.sentTr = x.translation || ''; S.sentKind = x.kind || ''; renderPanel(); } },
  delSentence: async d => { if (!confirm('Delete this sentence?')) return; await api('DELETE', '/rune/api/sentences/' + d.id); renderPanel(); },
  goOrigin: async d => {
    const l = (S.worlds || []).flatMap(x => x.languages || []).find(x => x.id === Number(d.lang));
    if (!l) { say('Language not found.', true); return; }
    S.lang = l; S.tab = 'dict'; await render(); S.openId = Number(d.id); await showWord();
  },
  compPrev: async () => {
    if (!S.words.length) S.words = await api('GET', base() + '/words');
    const parts = val('c_parts').split('+').map(t => t.trim()).filter(Boolean).map(t => { const w = S.words.find(x => x.gloss.toLowerCase() === t.toLowerCase()); return w ? (w.inherited ? w.form : w.id) : t; });
    const r = await api('POST', base() + '/compound', { parts });
    S.comp = { gloss: val('c_gloss'), parts: r.parts, steps: r.steps };
    $('#cprev').innerHTML = `<p class="small muted">From: ${esc(r.parts.join(' + '))}</p><table><tr><th>Form</th><th>Step</th><th></th></tr>` +
      r.steps.map((s, i) => `<tr><td class="form">${esc(s.form)}</td><td class="small">${esc(s.rule)}</td><td><button data-act="compUse" data-i="${i}">Use as word</button></td></tr>`).join('') + '</table>';
  },
  compPick: async d => {
    S.compPick = { g: d.g, p: d.p || '' };
    $('#c_gloss').value = d.g; $('#c_pos').value = d.p || '';
    document.querySelectorAll('#c_misslist .misspick').forEach(a => a.classList.toggle('on', a.dataset.g === d.g));
    $('#c_parts').focus();
    say('Now join words for "' + d.g + '" and click Erode.');
  },
  compUse: async d => {
    const s = S.comp.steps[Number(d.i)];
    const gloss = val('c_gloss').trim() || S.comp.gloss, pos = val('c_pos').trim();
    if (!gloss) { say('Enter a gloss first, or pick a missing word on the right.', true); return; }
    const payload = { gloss, build: 'compound', form: s.form, notes: 'compound: ' + S.comp.parts.join(' + ') };
    if (pos) payload.pos = pos;
    const r = await api('POST', base() + '/edit', { entity: 'word', action: 'CREATE', payload });
    S.words = [];
    if (r.status === 'pending') { say('Submitted for approval. "' + gloss + '" leaves the missing words once the owner approves it.'); return; }
    say('Word added: ' + gloss + ' = ' + s.form + '.');
    S.compPick = null; $('#c_gloss').value = ''; $('#c_pos').value = '';
    try { S.missing = await api('GET', base() + '/missing'); $('#c_misslist').innerHTML = compMissList(S.missing); filterMissList(); } catch (e) { /* list refresh is optional */ }
  },
  bulkCheck: async () => {
    const r = await api('POST', base() + '/bulk', { text: val('b_text'), dryRun: true, skipExisting: $('#b_skip').checked });
    say(r.count + ' words would be added.' + (r.skipped.length ? ' Already there, skipped: ' + r.skipped.join(', ') + '.' : ''));
  },
  bulkGo: async () => {
    const r = await api('POST', base() + '/bulk', { text: val('b_text'), skipExisting: $('#b_skip').checked });
    say('Added ' + r.count + ' words.' + (r.skipped.length ? ' Skipped (already there): ' + r.skipped.join(', ') + '.' : '')); S.tab = 'dict'; renderPanel();
  },
  soundImportCheck: async () => {
    const f = $('#si_file') && $('#si_file').files[0];
    let body = { dryRun: true };
    if (f) {
      const t = await f.text();
      if (/^\s*[\[{]/.test(t)) {
        let d; try { d = JSON.parse(t); } catch (e) { say('That file is not valid JSON: ' + e.message, true); return; }
        const list = Array.isArray(d) ? d : (d.sounds || d.phonemes);
        if (!Array.isArray(list)) { say('The JSON needs a "sounds" list.', true); return; }
        body.sounds = list;
      } else body.text = t;
    } else body.text = val('si_text');
    if (!body.sounds && !(body.text || '').trim()) { say('Paste a table or choose a file first.', true); return; }
    S.soundImport = body;
    const res = await api('POST', base() + '/phonemes/import', body);
    let h = `<p><strong>${res.added}</strong> to add, <strong>${res.changed}</strong> to change, ${res.unchanged} already the same.</p>`;
    if (res.errors.length) h += '<div class="gap"><strong>Nothing will be imported until these are fixed:</strong><ul>' + res.errors.map(e => `<li>${esc(e)}</li>`).join('') + '</ul></div>';
    const shown = res.items.filter(i => i.action === 'add' || i.action === 'change');
    if (shown.length) h += '<table><tr><th></th><th>Symbol</th><th>Kind</th><th>Row</th><th>Column</th><th>From</th><th>Until</th></tr>' + shown.map(i => `<tr><td>${i.action}</td><td class="form">${esc(i.symbol)}</td><td>${esc(i.kind)}</td><td>${esc(i.row)}</td><td>${esc(i.col)}</td><td>${i.year ?? ''}</td><td>${i.year_to ?? ''}</td></tr>`).join('') + '</table>';
    if (!res.errors.length && (res.added || res.changed)) h += '<div class="row"><button class="primary" data-act="soundImportApply">Apply these changes</button></div>';
    $('#si_out').innerHTML = h;
  },
  soundImportApply: async () => {
    if (!S.soundImport) return;
    const res = await api('POST', base() + '/phonemes/import', { ...S.soundImport, dryRun: false });
    S.soundImport = null;
    say('Imported: ' + res.added + ' added, ' + res.changed + ' changed.'); renderPanel();
  },
  autoSoundsLoad: async () => {
    S.autoTo = Number(val('as_to')) || 900;
    S.autoData = await api('GET', base() + '/auto-sounds?to=' + S.autoTo);
    S.autoYear = S.autoData.from;
    drawAutoSounds(true);
  },
  autoSoundsApply: async () => {
    if (!confirm('Replace the sounds made by an earlier build with these? Sounds you added by hand are not touched.')) return;
    const res = await api('POST', base() + '/auto-sounds/apply', { to: S.autoTo });
    say('Sounds saved: ' + res.added + ' added, ' + res.removed + ' earlier ones replaced, ' + res.keptYours + ' of yours kept as they were.'); renderPanel();
  },
  approve: async d => { await api('POST', '/rune/api/changes/' + d.id + '/approve'); say('Approved.'); renderPanel(); },
  deny: async d => { await api('POST', '/rune/api/changes/' + d.id + '/deny'); say('Denied.'); renderPanel(); },
  addShare: async () => {
    const scope = val('s_scope');
    await api('POST', '/rune/api/shares', { scope, targetId: scope === 'WORLD' ? S.lang.world_id : S.lang.id, username: val('s_user'), level: val('s_level'), autoApprove: $('#s_auto').checked });
    say('Shared.'); renderPanel();
  },
  revoke: async d => { await api('DELETE', '/rune/api/shares/' + d.id); say('Access revoked.'); renderPanel(); },
  saveSettings: async () => {
    await api('PUT', base(), { name: val('g_name'), parentId: val('g_parent') || null, splitYear: val('g_split') === '' ? null : Number(val('g_split')),
      classes: val('g_classes'), erosion: val('g_erosion'), erosionTarget: Number(val('g_target') || 0), ipaMap: val('g_ipa'), grammar: val('g_grammar') });
    say('Saved.'); await loadWorlds(); render();
  },
  delLang: async () => { if (!confirm('Delete this language and all its words and rules?')) return; await api('DELETE', base()); S.lang = null; await loadWorlds(); render(); }
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || !A[b.dataset.act]) return;
  wrap(A[b.dataset.act])(b.dataset, b);
});
document.addEventListener('input', e => {
  if (e.target.dataset.gfilter) { const q = e.target.value.toLowerCase(); document.querySelectorAll('.gt tr').forEach((tr, i) => { if (tr.querySelector('th')) return; tr.hidden = q && !tr.textContent.toLowerCase().includes(q); }); }
  if (e.target.dataset.wf) { S.wf = S.wf || {}; S.wf[e.target.dataset.wf] = e.target.value; S.page = 0; drawDict(); return; }
  if (e.target.dataset.filter) { S.q = e.target.value; S.page = 0; drawDict(); }
});
document.addEventListener('click', e => { if (e.target.id === 'modal') { e.target.hidden = true; S.openId = null; } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modal') && !$('#modal').hidden) { $('#modal').hidden = true; S.openId = null; } });
function yearWarn() {
  const link = ($('#fr_link') || {}).value, fw = $('#fr_warn');
  if (fw) {
    const aw = link && (S.wordnames || []).find(w => w.gloss.toLowerCase() === link.trim().toLowerCase()), y = val('fr_year');
    fw.textContent = aw && y !== '' && Number(y) < aw.year ? '⚠ older than the word "' + aw.gloss + '" (' + aw.year + ')' : '';
  }
  const w = S.openWordYear, ef = $('#f_warn');
  if (ef) { const y = val('f_year'); ef.textContent = w != null && y !== '' && Number(y) < w ? '⚠ older than the word itself (' + w + ')' : ''; }
}
document.addEventListener('input', e => { if (e.target.dataset.yearcheck || e.target.id === 'fr_link') yearWarn(); });
document.addEventListener('change', e => {
  if (e.target.id === 'fr_link') {
    const aw = (S.wordnames || []).find(w => w.gloss.toLowerCase() === e.target.value.trim().toLowerCase());
    if (aw && $('#fr_year') && $('#fr_year').value === '') $('#fr_year').value = aw.year;
    yearWarn(); return;
  }
  if (e.target.dataset.logauto) { stopLogTimer(); if (e.target.checked) S.logTimer = setInterval(() => { if (S.page === 'log') loadLog(true); else stopLogTimer(); }, 10000); return; }
  if (e.target.id === 'gr_cat') { applyHeadings(); return; }
  if (e.target.dataset.soundyear) { S.soundYear = e.target.value === '' ? '' : Number(e.target.value); renderPanel(); return; }
  if (e.target.dataset.isref) { syncRefBox(); return; }
  if (e.target.dataset.isloan) { syncLoanBox(); return; }
  if (e.target.dataset.loanlang) { fillLoanWords(); return; }
  if (e.target.dataset.gmetric) { drawDivergence(); return; }
  if (e.target.dataset.inh) { S.showInherited = e.target.checked; S.page = 0; drawDict(); return; }
  if (e.target.dataset.psize) { S.pageSize = Number(e.target.value); try { localStorage.setItem('pageSize', String(S.pageSize)); } catch (x) { /* ignore */ } S.page = 0; drawDict(); return; }
  if (e.target.dataset.scope) { S.ruleScope = e.target.value; renderPanel(); return; }
  if (e.target.dataset.tpl && TPL[e.target.value]) { $('#r_pat').value = TPL[e.target.value][0]; $('#r_rep').value = TPL[e.target.value][1]; $('#r_name').value = e.target.selectedOptions[0].textContent; }
});
function autoIndex(d, year) { let k = 0; d.events.forEach((e, i) => { if (e.year <= year) k = i; }); return k; }
function drawAutoSounds(full) {
  const d = S.autoData; if (!d || !$('#as_out')) return;
  const k = autoIndex(d, S.autoYear), ev = d.events[k];
  const here = d.sounds.filter(x => x.counts[k] > 0);
  const grid = kind => {
    const all = here.filter(x => x.known && x.kind === kind), rows = [...new Set(all.map(x => x.row))], cols = [...new Set(all.map(x => x.col))];
    if (!all.length) return '<p class="muted">None.</p>';
    return '<table><tr><th></th>' + cols.map(c => `<th>${esc(c)}</th>`).join('') + '</tr>' + rows.map(r => `<tr><th>${esc(r)}</th>` + cols.map(c =>
      `<td class="form">${all.filter(x => x.row === r && x.col === c).map(x => `<span title="/${esc(x.ipa)}/ in ${x.counts[k]} words, e.g. ${esc(x.examples.join(', '))}"${k > 0 && x.counts[k - 1] === 0 ? ' style="font-weight:bold;text-decoration:underline"' : ''}>${esc(x.symbol)}</span>`).join(', ')}</td>`).join('') + '</tr>').join('') + '</table>';
  };
  const gained = k > 0 ? d.sounds.filter(x => x.counts[k] > 0 && x.counts[k - 1] === 0).map(x => x.symbol) : [];
  const lost = k > 0 ? d.sounds.filter(x => x.counts[k] === 0 && x.counts[k - 1] > 0).map(x => x.symbol) : [];
  const odd = here.filter(x => !x.known).map(x => x.symbol);
  let h = '';
  if (full) h += `<div class="row"><input type="range" id="as_slider" data-autoslider="1" min="${d.from}" max="${d.to}" step="1" value="${S.autoYear}" style="flex:1;min-width:200px"><strong id="as_yr"></strong></div>`;
  h += '<div id="as_table"></div>';
  if (full && canEdit()) h += '<div class="row"><button class="primary" data-act="autoSoundsApply">Save as the sound table</button><span class="muted small">Saves each sound with the years it is in use (from / until), so the table above changes with its year box.</span></div>';
  if (full) $('#as_out').innerHTML = h;
  $('#as_yr').textContent = 'Year ' + S.autoYear + ' · sound-change set of ' + ev.year + ' · ' + ev.words + ' words';
  $('#as_table').innerHTML = `${ev.rules.length ? `<p class="small muted">Sound changes starting ${ev.year}: ${ev.rules.map(esc).join('; ')}</p>` : ''}
    ${gained.length ? `<p class="small">New since the previous step: <span class="form">${gained.map(esc).join(', ')}</span></p>` : ''}
    ${lost.length ? `<p class="small">Gone since the previous step: <span class="form">${lost.map(esc).join(', ')}</span></p>` : ''}
    <h4>Consonants (${here.filter(x => x.kind === 'consonant' && x.known).length})</h4>${grid('consonant')}<h4>Vowels (${here.filter(x => x.kind === 'vowel' && x.known).length})</h4>${grid('vowel')}
    ${odd.length ? `<p class="gap small">Not recognised, so not placed: <span class="form">${odd.map(esc).join(', ')}</span>. Add them to the table above and build again.</p>` : ''}`;
}
document.addEventListener('input', e => {
  if (e.target.dataset.autoslider) { S.autoYear = Number(e.target.value); drawAutoSounds(false); }
});
const UI_VERSION = '1.5.0';   // keep equal to the version in pom.xml
api('GET', '/rune/api/version').then(v => {
  $('#ver').textContent = 'v' + v.version + (v.built ? ' · built ' + v.built.replace('T', ' ').replace('Z', ' UTC') : '');
  if (v.version !== UI_VERSION) {
    const b = document.createElement('div');
    b.style.cssText = 'background:#b3261e;color:#fff;padding:8px 14px;font-size:14px';
    b.textContent = 'The page is version ' + UI_VERSION + ' but the running server is ' + v.version + '. Stop the app completely, then in Eclipse do Maven > Update Project (Force Update), Project > Clean, and start it again. Until then some features will fail.';
    document.body.insertBefore(b, document.body.firstChild);
  }
}).catch(() => {});
boot().catch(e => say(e.message, true));
