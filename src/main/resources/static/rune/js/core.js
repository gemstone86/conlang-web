'use strict';
// Root and Rune: helpers, admin log and connector pages, start-up, sidebar. The files in js/ are loaded in order by index.html and share one scope.
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
  await loadWorlds();
  // links like /rune/?lang=12&tab=changes (from notifications) open that language and tab
  const q = new URLSearchParams(location.search), lid = Number(q.get('lang'));
  if (lid) {
    const l = S.worlds.flatMap(w => w.languages).find(x => x.id === lid);
    if (l) { S.lang = l; const t = q.get('tab'); if (t && TAB[t]) S.tab = t; }
    history.replaceState(null, '', location.pathname);
    render();
    if (!l) say('That language was not found, or you can no longer see it.', true);
    return;
  }
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
  $('#who').innerHTML = S.me ? esc(S.me.username) + (S.me.is_admin ? ' <a class="badge" href="/admin/" title="Admin dashboard: all users">admin</a>' : '') +
    (S.me.is_admin ? ` <button data-act="page" data-p="work" class="${['log', 'connector'].includes(S.page) ? '' : 'primary'}">Workspace</button> <button data-act="page" data-p="log" class="${S.page === 'log' ? 'primary' : ''}">Log</button> <button data-act="page" data-p="connector" class="${S.page === 'connector' ? 'primary' : ''}" title="Let Claude read your languages and weather data">Claude connector</button> <button data-act="resetCode">Issue reset code</button> <button data-act="exportAll" title="All worlds, languages, words, rules, forms, grammar, sounds, sentences, sharing and accounts, as one file">Export everything</button> <button data-act="importAll" title="Read an Export everything file (e.g. from the separate Root and Rune app). Replaces Root and Rune's data here.">Import everything</button>` : '') + ' <button data-act="logout">Log out</button>' : '<a href="/?next=%2Frune%2F"><button class="primary">Log in</button></a>';
  if (S.me && window.Bell) { const bh = document.createElement('span'); $('#who').prepend(bh); Bell.mount(bh); }
  if (!S.me && !S.worlds.length) { location.href = '/?next=' + encodeURIComponent(location.pathname); return; }
  if (S.me && S.me.is_admin && S.page === 'log') { $('#app').innerHTML = logShell(); loadLog(true); return; }
  if (S.me && S.me.is_admin && S.page === 'connector') { $('#app').innerHTML = '<div class="card">Loading…</div>'; connectorPage().catch(e => say(e.message, true)); return; }
  $('#app').innerHTML = '<div class="layout"><div class="card tree" id="side">' + sideView() + '</div><div id="panel">' +
    (S.lang ? '<div class="card" id="panelbody">Loading…</div>' : S.me ? '<div class="card"><h2>Welcome</h2><p>Create a world, then a language in it. Pick a language on the left to work on it.</p></div>'
      : '<div class="card"><h2>Welcome</h2><p>These are the languages people have shared with everyone. Pick one on the left to read its dictionary, sound changes and grammar.</p><p><a href="/?next=%2Frune%2F">Log in</a> to build languages of your own.</p></div>') + '</div></div>';
  if (S.lang) renderPanel();
}

// ---------- auth ----------
// Logging in, registering and password resets happen on the start page (/), shared with the weather generator.

// ---------- sidebar ----------
function langTree(langs, parent) {
  const kids = langs.filter(l => (l.parent_id ?? null) === parent);
  if (!kids.length) return '';
  return '<ul>' + kids.map(l => `<li><a data-act="pick" data-id="${l.id}" class="${S.lang && S.lang.id === l.id ? 'on' : ''}">${esc(l.name)}</a>` +
    `<span class="badge">${LEVELS[l.level]}</span>${l.is_public ? ' <span class="badge public" title="Public: anyone can read it' + (l.public_suggestions ? ', and anyone logged in can suggest changes' : '') + '">public</span>' : ''}${l.split_year != null ? `<span class="muted small"> (splits ${l.split_year})</span>` : ''}` +
    langTree(langs, l.id) + '</li>').join('') + '</ul>';
}
function sideView() {
  let h = S.me ? '<h3>Worlds</h3>' : '';
  const own = S.worlds.filter(w => !w.community), community = S.worlds.filter(w => w.community);
  if (S.me && !own.length) h += '<p class="muted small">No worlds yet.</p>';
  for (const w of own) {
    const roots = w.languages.filter(l => !l.parent_id || !w.languages.some(p => p.id === l.parent_id));
    h += `<div><strong>${esc(w.name)}</strong>${w.mine ? '' : ' <span class="badge">shared</span>'}
      ${w.mine ? `<button data-act="newLang" data-w="${w.id}" title="Add a root language">+ lang</button> <button class="danger" data-act="delWorld" data-w="${w.id}" title="Delete world">✕</button>` : ''}</div>`;
    const rootsOnly = w.languages.map(l => roots.includes(l) ? { ...l, parent_id: null } : l);
    h += langTree(rootsOnly, null);
  }
  if (S.me) h += '<div class="row"><button data-act="newWorld">+ New world</button></div>';
  if (community.length) {
    h += '<h3 class="community">Community</h3><p class="muted small">Languages others have made public.</p>';
    for (const w of community) {
      h += `<div><strong>${esc(w.name)}</strong></div>`;
      const roots = w.languages.filter(l => !l.parent_id || !w.languages.some(p => p.id === l.parent_id));
      h += langTree(w.languages.map(l => roots.includes(l) ? { ...l, parent_id: null } : l), null);
    }
  }
  return h;
}
