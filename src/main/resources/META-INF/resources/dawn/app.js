// Dawn of Mankind — browser client. Plain JS: the server sends the whole state after every change; we redraw.
'use strict';

const API = 'api';
const RES = ['food', 'production', 'culture', 'influence', 'research'];
const RES_SHORT = { food: 'Food', production: 'Prod', culture: 'Cult', influence: 'Infl', research: 'Res' };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let ws = null, state = null, room = null, code = null, token = null, retry = 0, tab = 'log', gone = false;

// ------------------------------------------------------------------ start page

async function boot() {
  const params = new URLSearchParams(location.search);
  code = (params.get('room') || '').toUpperCase() || null;
  try {
    const me = await (await fetch(API + '/me')).json();
    if (me.name) {
      $('name').value = me.name;
      $('name').disabled = true;
      $('loggedIn').textContent = 'Playing as your account name.';
      $('loggedIn').hidden = false;
    }
  } catch (e) { /* no login available */ }
  if (!$('name').value) $('name').value = localStorage.getItem('dawn.name') || '';
  if (code) {
    $('code').value = code;
    token = localStorage.getItem('dawn.seat.' + code);
    if (token) return connect();
  }
  show('start');
}

function show(which) {
  for (const id of ['start', 'lobby', 'game']) $(id).hidden = id !== which;
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

async function enter(promise) {
  try {
    const j = await promise;
    code = j.code; token = j.token;
    localStorage.setItem('dawn.seat.' + code, token);
    if (!$('name').disabled) localStorage.setItem('dawn.name', $('name').value.trim());
    history.replaceState(null, '', '?room=' + code);
    connect();
  } catch (e) { toast(e.message); }
}

$('create').onclick = () => enter(post(API + '/rooms', { name: $('name').value }));
$('join').onclick = () => {
  const c = $('code').value.trim().toUpperCase();
  if (!c) return toast('Type the room code.');
  enter(post(API + '/rooms/' + encodeURIComponent(c) + '/join', { name: $('name').value }));
};
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('join').click(); });

// ------------------------------------------------------------------ connection

function connect() {
  gone = false;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = location.pathname.replace(/[^/]*$/, '');
  ws = new WebSocket(proto + '//' + location.host + base + 'ws?code=' + encodeURIComponent(code) + '&token=' + encodeURIComponent(token));
  ws.onopen = () => { retry = 0; };
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.kind === 'state') { retry = 0; render(m); }
    else if (m.kind === 'error') toast(m.message);
    else if (m.kind === 'kicked' || m.kind === 'gone') {
      gone = true;
      localStorage.removeItem('dawn.seat.' + code);
      toast(m.message || 'You were removed from the room.');
      history.replaceState(null, '', './');
      show('start');
    }
  };
  ws.onclose = () => {
    if (gone) return;
    $('status').innerHTML = '<span class="bad">Connection lost — reconnecting…</span>';
    setTimeout(connect, Math.min(10000, 500 * 2 ** retry++));
  };
}

function send(msg) {
  if (!ws || ws.readyState !== 1) return toast('Not connected.');
  ws.send(JSON.stringify(msg));
}

let toastTimer;
function toast(text, ok) {
  const t = $('toast');
  t.textContent = text;
  t.className = 'toast' + (ok ? ' ok' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

// ------------------------------------------------------------------ render

function render(m) {
  room = m.room;
  state = m.game;
  renderChat(m.chat);
  if (!room.started) return renderLobby();
  show('game');
  // keep what people were typing in forms across redraws
  const kept = {};
  document.querySelectorAll('#game [data-keep]').forEach(el => { kept[el.dataset.keep] = el.type === 'checkbox' ? el.checked : el.value; });
  renderStatus();
  renderQueue();
  renderWonders();
  renderEvents();
  renderCiv();
  renderHand();
  renderTeam();
  renderDecks();
  renderLog();
  renderOver();
  document.querySelectorAll('#game [data-keep]').forEach(el => {
    if (el.dataset.keep in kept) { if (el.type === 'checkbox') el.checked = kept[el.dataset.keep]; else el.value = kept[el.dataset.keep]; }
  });
}

function renderLobby() {
  show('lobby');
  $('status').textContent = '';
  $('lobbyCode').textContent = room.code;
  $('lobbyPlayers').innerHTML = room.players.map(p => `<li><span class="dot ${p.connected ? '' : 'off'}"></span>${esc(p.name)}
      ${p.seat === room.host ? '<span class="chip">host</span>' : ''}${p.seat === room.you ? '<span class="chip">you</span>' : ''}
      ${room.you === room.host && p.seat !== room.host ? `<button class="tiny danger" data-kick="${p.seat}">remove</button>` : ''}</li>`).join('');
  $('startGame').hidden = room.you !== room.host;
  $('lobbyNote').textContent = room.you === room.host ? 'Start when everyone is in (1–6 players).' : 'Waiting for the host to start.';
}
$('lobbyPlayers').onclick = e => { const b = e.target.closest('[data-kick]'); if (b) send({ type: 'kick', seat: +b.dataset.kick }); };
$('startGame').onclick = () => send({ type: 'start' });
$('leave').onclick = () => {
  send({ type: 'leave' });
  gone = true;
  localStorage.removeItem('dawn.seat.' + code);
  history.replaceState(null, '', './');
  setTimeout(() => location.reload(), 200);
};
$('copyLink').onclick = async () => {
  const url = location.origin + location.pathname + '?room=' + room.code;
  try { await navigator.clipboard.writeText(url); toast('Invite link copied.', true); } catch (e) { toast(url, true); }
};

const me = () => state.players[state.you];
const myTurn = () => state.phase === 'turns' && state.currentPlayer === state.you && !state.result;
const canAct = () => myTurn() && state.actionsLeft > 0;
const resList = (r, opts = {}) => RES.filter(k => (r?.[k] ?? 0) !== 0 || opts.all)
  .map(k => `<span class="res r-${k}">${opts.signed && r[k] > 0 ? '+' : ''}${r[k] ?? 0}<i>${RES_SHORT[k]}</i></span>`).join('') || '<span class="muted">—</span>';
const affordable = cost => !cost || RES.every(k => (me().resources[k] || 0) >= (cost[k] || 0));

function renderStatus() {
  const s = state, cur = s.players[s.currentPlayer];
  const phase = s.result ? (s.result === 'victory' ? 'Victory' : 'Defeat')
    : s.phase === 'events' ? 'Events' : myTurn() ? `<span class="turn">Your turn — ${s.actionsLeft} action${s.actionsLeft === 1 ? '' : 's'} left</span>` : `${esc(cur.name)}'s turn`;
  $('status').innerHTML = `<span>${esc(s.era)} era (${s.eraIndex + 1}/${s.eraCount})</span><span>Round <b>${s.round}</b></span>
    <span>${phase}</span><span>Stability <b class="${s.stability <= 3 ? 'bad' : ''}">${s.stability}</b></span>
    <span>Health <b>${s.health}</b></span><span>Era deck <b>${s.eraDeck}</b></span><span>Wonder points <b>${s.score}</b></span>
    <span class="muted small">Room ${esc(room.code)}</span>`;
}

function cardHtml(c, extra = '', cls = '') {
  const kind = c.type === 'event' ? `event ${c.category || ''} ${c.crisis ? 'crisis' : ''}` : c.type;
  const typeLabel = c.type === 'event' ? (c.crisis ? 'Crisis' : 'Event · ' + (c.category || '')) : c.type.replace('_', ' ');
  return `<div class="cardx ${kind} ${cls}"><div class="type">${esc(typeLabel)}</div><div class="name">${esc(c.name)}</div>
    ${c.cost ? `<div class="small">Cost: ${resList(c.cost)}</div>` : ''}<div class="text">${esc(c.text)}</div>${extra}</div>`;
}

function renderQueue() {
  const s = state, leaving = s.queueRemoved;
  const items = s.queue.map((c, i) => {
    const isLeaving = i >= s.queue.length - leaving;
    const fd = c.faceDown ? '<div class="facedown">+ a face-down card underneath</div>' : '';
    const btn = `<div class="actions"><button ${canAct() ? '' : 'disabled'} data-pick="${i}">${c.type === 'event' ? 'Take on (1 action)' : 'Pick (1 action)'}</button></div>`;
    return cardHtml(c, `<span class="slotno">${i + 1}</span>${fd}${btn}`, isLeaving ? 'leaving' : '');
  }).join('');
  $('queuePanel').innerHTML = `<h2>Card queue</h2><p class="muted small">Top to bottom. At the end of the round the bottom ${leaving} card${leaving > 1 ? 's' : ''} (dashed) leave${leaving > 1 ? '' : 's'}; events that leave go to the future deck.</p>
    <div class="cards">${items || '<p class="muted">The queue is empty.</p>'}</div>`;
}
$('queuePanel').onclick = e => { const b = e.target.closest('[data-pick]'); if (b) send({ type: 'pick', slot: +b.dataset.pick }); };

function renderWonders() {
  const s = state;
  const list = s.greatWonders.map(w => {
    const total = RES.reduce((a, k) => a + w.cost[k], 0), paid = RES.reduce((a, k) => a + w.paid[k], 0);
    const need = RES.filter(k => w.cost[k] > 0);
    const form = w.done ? '' : `<div class="row small">${need.map(k => `<label class="res r-${k}" style="margin:0">${RES_SHORT[k]} <input type="number" min="0" value="0" data-keep="w-${w.key}-${k}" data-wres="${k}"></label>`).join('')}</div>
      <div class="row">${s.sharedPool ? `<label class="small" style="margin:0"><input type="checkbox" data-keep="w-${w.key}-pool" data-wpool> from shared pool</label>` : ''}
      <button ${canAct() ? '' : 'disabled'} data-wonder="${w.key}">Contribute (1 action)</button></div>`;
    const by = Object.entries(w.bySeat).map(([n, r]) => `<div class="small muted">${esc(n)}: ${resList(r)}</div>`).join('');
    return `<div class="cardx wonder ${w.done ? 'done' : ''}" data-w="${w.key}"><div class="type">Great wonder · ${w.victoryPoints} points</div>
      <div class="name">${esc(w.name)}${w.done ? ' ✓' : ''}</div><div class="text">${esc(w.text)}</div>
      <div class="small">Paid ${resList(w.paid, { all: false })} of ${resList(w.cost)}</div><div class="prog"><div style="width:${total ? 100 * paid / total : 0}%"></div></div>${by}${form}</div>`;
  }).join('');
  const built = s.builtWonders.length ? `<p class="small">Built: ${s.builtWonders.map(w => `<span class="chip">${esc(w.name)} (${w.victoryPoints})</span>`).join('')}</p>` : '';
  $('wonderPanel').innerHTML = `<h2>Great wonders</h2><p class="muted small">Built together. Their points are your final score. Unfinished wonders are lost when the era ends (half is returned).</p>${built}<div class="cards">${list || '<p class="muted">None this era.</p>'}</div>`;
}
$('wonderPanel').onclick = e => {
  const b = e.target.closest('[data-wonder]'); if (!b) return;
  const box = b.closest('[data-w]'), resources = {};
  box.querySelectorAll('[data-wres]').forEach(i => { resources[i.dataset.wres] = Math.max(0, +i.value || 0); });
  const pool = box.querySelector('[data-wpool]');
  send({ type: 'contribute', wonder: b.dataset.wonder, resources, fromPool: !!(pool && pool.checked) });
  box.querySelectorAll('[data-wres]').forEach(i => { i.value = 0; });
};

function renderEvents() {
  const s = state, p = s.pending;
  let html = '<h2>Events</h2>';
  if (p) {
    const amReady = p.ready[s.you];
    const target = p.target >= 0 ? `<p class="small">Strikes <b>${esc(s.players[p.target].name)}</b>.</p>` : '';
    const matching = (me().hand || []).filter(c => c.type === 'response' && (c.respondsTo.includes('any') || c.respondsTo.includes(p.category) || c.respondsTo.includes(p.key)));
    let controls = '';
    if (!amReady) {
      controls += matching.map(c => `<button data-respond="${c.id}" ${affordable(c.cost) ? '' : 'disabled'}>Play ${esc(c.name)}</button>`).join('');
      if (p.kind === 'invasion') {
        const free = me().army - me().committed;
        controls += `<label class="small" style="margin:0">Send troops <input type="number" min="0" max="${free}" value="${p.troops[s.you] ?? 0}" id="troopIn"> of ${free}</label><button data-troops>Set</button>`;
      }
      if (p.kind === 'opportunity' && p.target === s.you) {
        controls += `<button data-decide="1" class="${p.accept === true ? 'primary' : ''}">Accept</button><button data-decide="0" class="${p.accept === false ? 'primary' : ''}">Decline</button>`;
      }
      controls += `<button class="primary" data-ready>Done — resolve</button>`;
    } else {
      controls = '<span class="muted small">You are done. Waiting for the others…</span>';
    }
    const waiting = Object.entries(p.ready).filter(([, r]) => !r).map(([seat]) => esc(s.players[seat].name));
    html += cardHtml(p, `${target}<div class="preview">${esc(p.preview)}</div>
      ${p.responses.length ? `<div class="small">Responses: ${p.responses.map(esc).join(', ')}</div>` : ''}
      ${p.kind === 'invasion' ? `<div class="small">Troops sent: ${Object.entries(p.troops).map(([seat, n]) => esc(s.players[seat].name) + ' ' + n).join(', ') || 'none yet'}</div>` : ''}
      <div class="actions">${controls}</div><div class="readylist">${waiting.length ? 'Waiting for: ' + waiting.join(', ') : ''}</div>`, 'pending');
  } else {
    html += `<p class="muted small">After everyone's turn, as many events are drawn from the event deck as the future deck holds (now <b>${s.futureEvents.length}</b>).</p>`;
  }
  if (s.persistentEvents.length) {
    html += '<h3>Lasting events</h3><div class="cards">' + s.persistentEvents.map(c => cardHtml(c,
      `<div class="actions"><button ${canAct() && affordable(c.cleanse) ? '' : 'disabled'} data-cleanse="${c.id}">Lift for ${resList(c.cleanse)} (1 action)</button></div>`)).join('') + '</div>';
  }
  $('eventPanel').innerHTML = html;
  $('eventPanel').classList.toggle('pending', !!p);
}
$('eventPanel').onclick = e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.respond) send({ type: 'respond', card: +t.dataset.respond });
  else if ('troops' in t.dataset) send({ type: 'troops', troops: +$('troopIn').value || 0 });
  else if (t.dataset.decide) send({ type: 'decide', accept: t.dataset.decide === '1' });
  else if ('ready' in t.dataset) {
    const tin = $('troopIn');
    if (tin && (+tin.value || 0) !== (state.pending.troops[state.you] ?? 0)) send({ type: 'troops', troops: +tin.value || 0 });
    send({ type: 'ready' });
  } else if (t.dataset.cleanse) send({ type: 'cleanse', event: +t.dataset.cleanse });
};

function renderCiv() {
  const s = state, p = me(), act = canAct();
  const blds = p.buildings.map(b => `<div class="bld"><span class="bname">${esc(b.name)}</span>
      <span class="slots">${Array.from({ length: b.slots }, (_, i) => `<span class="slot ${i < b.workers ? 'full' : ''}"></span>`).join('')}</span>
      <button class="tiny" ${act && p.idle > 0 && b.workers < b.slots ? '' : 'disabled'} data-move-in="${b.id}" title="Move an idle worker here (1 action)">+ worker</button>
      <button class="tiny" ${act && b.workers > 0 ? '' : 'disabled'} data-move-out="${b.id}" title="Make a worker idle (1 action)">− worker</button></div>`).join('');
  const moveOpts = [['idle', `Idle (${p.idle})`], ...p.buildings.map(b => [b.id, `${b.name} #${b.id} (${b.workers}/${b.slots})`])]
    .map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
  const build = (s.buildable || []).map(b => `<button ${act && affordable(b.cost) ? '' : 'disabled'} data-build="${b.id}" title="${esc(b.text)}">${esc(b.name)} — ${resList(b.cost)}</button>`).join('');
  $('civPanel').className = 'panel mine';
  $('civPanel').innerHTML = `<h2>Your people — ${esc(p.name)}</h2>
    <div class="row">${resList(p.resources, { all: true })}</div>
    <div class="row small muted">Per round: ${resList(p.income, { signed: true })} (food after feeding your people)</div>
    <div class="row small">Population <b>${p.population}</b> · idle ${p.idle} · Army <b>${p.army}</b>${p.committed ? ` (${p.committed} away at war)` : ''} · raid defense +${p.raidDefense} · hand ${p.handSize}/${p.handLimit}</div>
    ${p.techs.length || p.minorWonders.length ? `<div class="small">${p.techs.map(t => `<span class="chip" title="${esc(t.text)}">${esc(t.name)}</span>`).join('')}${p.minorWonders.map(t => `<span class="chip" title="${esc(t.text)}">★ ${esc(t.name)}</span>`).join('')}</div>` : ''}
    <h3 style="margin-top:.5rem">Buildings</h3>${blds}
    <div class="row small">Move a worker <select id="mvFrom" data-keep="mvFrom">${moveOpts}</select> → <select id="mvTo" data-keep="mvTo">${moveOpts}</select><button ${act ? '' : 'disabled'} data-move>Move (1 action)</button></div>
    <h3>Actions</h3>
    <div class="row">${build}</div>
    <div class="row">
      <button ${act && affordable(s.rules.growthCost) ? '' : 'disabled'} data-grow>Grow +1 Population — ${resList(s.rules.growthCost)}</button>
      <button ${act && affordable(s.rules.recruitCost) ? '' : 'disabled'} data-recruit>Train 1 troop — ${resList(s.rules.recruitCost)}</button>
      <button class="primary" ${myTurn() ? '' : 'disabled'} data-end>End turn</button>
    </div>
    ${s.sharedPool ? `<h3>Shared pool</h3><div class="row">${resList(s.sharedPool, { all: true })}</div>
      <div class="row small">${RES.map(k => `<label class="res r-${k}" style="margin:0">${RES_SHORT[k]} <input type="number" min="0" value="0" data-keep="pool-${k}" data-pres="${k}"></label>`).join('')}</div>
      <div class="row"><button data-deposit>Put in</button><button data-withdraw>Take out</button></div>` : ''}`;
}
$('civPanel').onclick = e => {
  const t = e.target.closest('button'); if (!t) return;
  const d = t.dataset;
  if (d.moveIn) send({ type: 'move', from: 'idle', to: +d.moveIn });
  else if (d.moveOut) send({ type: 'move', from: +d.moveOut, to: 'idle' });
  else if ('move' in d) {
    const f = $('mvFrom').value, to = $('mvTo').value;
    send({ type: 'move', from: f === 'idle' ? 'idle' : +f, to: to === 'idle' ? 'idle' : +to });
  } else if (d.build) send({ type: 'build', building: d.build });
  else if ('grow' in d) send({ type: 'grow' });
  else if ('recruit' in d) send({ type: 'recruit' });
  else if ('end' in d) send({ type: 'endTurn' });
  else if ('deposit' in d || 'withdraw' in d) {
    const resources = {};
    document.querySelectorAll('[data-pres]').forEach(i => { resources[i.dataset.pres] = Math.max(0, +i.value || 0); i.value = 0; });
    send({ type: 'deposit' in d ? 'deposit' : 'withdraw', resources });
  }
};

function renderHand() {
  const s = state, p = me(), act = canAct();
  const others = s.players.filter(o => o.seat !== s.you);
  const over = p.hand.length > p.handLimit;
  const cards = p.hand.map(c => {
    const playable = c.type !== 'response';
    const give = others.length ? `<select data-keep="give-${c.id}" id="give-${c.id}">${others.map(o => `<option value="${o.seat}">${esc(o.name)}</option>`).join('')}</select><button class="tiny" data-givecard="${c.id}">Give</button>` : '';
    return cardHtml(c, `<div class="actions">${playable ? `<button ${act && affordable(c.cost) ? '' : 'disabled'} data-play="${c.id}">Play (1 action)</button>` : '<span class="small muted">Play it when an event strikes.</span>'}
      <button class="tiny" data-discard="${c.id}">Discard</button>${give}</div>`);
  }).join('');
  $('handPanel').innerHTML = `<h2>Your hand (${p.hand.length}/${p.handLimit})</h2>${over ? `<p class="small bad" style="color:var(--err)">Discard down to ${p.handLimit} before ending your turn.</p>` : ''}
    <div class="cards">${cards || '<p class="muted">No cards. Pick from the queue.</p>'}</div>`;
}
$('handPanel').onclick = e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.play) send({ type: 'play', card: +t.dataset.play });
  else if (t.dataset.discard) send({ type: 'discard', card: +t.dataset.discard });
  else if (t.dataset.givecard) send({ type: 'giveCard', card: +t.dataset.givecard, to: +$('give-' + t.dataset.givecard).value });
};

function renderTeam() {
  const s = state;
  const others = s.players.filter(o => o.seat !== s.you);
  const list = s.players.map(o => `<div class="teammate ${o.seat === s.currentPlayer && s.phase === 'turns' ? 'active' : ''}">
      <div class="tname">${o.seat === s.currentPlayer && s.phase === 'turns' ? '▶ ' : ''}${esc(o.name)}${o.seat === s.you ? ' (you)' : ''}${o.seat === s.firstPlayer ? ' <span class="chip">first</span>' : ''}${o.away ? ' <span class="chip">away</span>' : ''}</div>
      <div class="small">${resList(o.resources)}</div>
      <div class="small muted">Pop ${o.population} · Army ${o.army} · Hand ${o.handSize} · ${o.buildings.map(b => b.name + ' ' + b.workers + '/' + b.slots).join(', ')}</div>
      ${o.techs.length || o.minorWonders.length ? `<div>${o.techs.map(t => `<span class="chip" title="${esc(t.text)}">${esc(t.name)}</span>`).join('')}${o.minorWonders.map(t => `<span class="chip">★ ${esc(t.name)}</span>`).join('')}</div>` : ''}
    </div>`).join('');
  const give = others.length ? `<h3 style="margin-top:.5rem">Give resources</h3>
    <div class="row small">${RES.map(k => `<label class="res r-${k}" style="margin:0">${RES_SHORT[k]} <input type="number" min="0" value="0" data-keep="g-${k}" data-gres="${k}"></label>`).join('')}</div>
    <div class="row"><select id="giveTo" data-keep="giveTo">${others.map(o => `<option value="${o.seat}">${esc(o.name)}</option>`).join('')}</select><button data-give>Give (free)</button></div>` : '';
  $('teamPanel').innerHTML = `<h2>The tribe</h2>${list}${give}`;
}
$('teamPanel').onclick = e => {
  if (!e.target.closest('[data-give]')) return;
  const resources = {};
  document.querySelectorAll('[data-gres]').forEach(i => { resources[i.dataset.gres] = Math.max(0, +i.value || 0); i.value = 0; });
  send({ type: 'give', to: +$('giveTo').value, resources });
};

function renderDecks() {
  const s = state;
  const contents = Object.entries(s.eventDeckContents).map(([n, c]) => `${esc(n)}${c > 1 ? ' ×' + c : ''}`).join(', ');
  $('deckPanel').innerHTML = `<h2>Event decks</h2>
    <div class="small">Event deck: <b>${s.eventDeck}</b> cards <details><summary>What's in it</summary>${contents || 'empty'}</details></div>
    <div class="small" style="margin-top:.3rem">Future deck (face up): <b>${s.futureEvents.length}</b> — this many events strike this round</div>
    <div class="cards" style="margin-top:.3rem">${s.futureEvents.map(c => cardHtml(c)).join('')}</div>
    <div class="small muted" style="margin-top:.3rem">Crisis cards waiting: ${s.crisisPile}</div>
    <details style="margin-top:.3rem"><summary>Past events (${s.pastEvents.length})</summary><div class="cards">${s.pastEvents.map(c => cardHtml(c)).join('')}</div></details>`;
}

function renderLog() {
  const box = $('logBox');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
  box.innerHTML = state.log.map(l => `<div class="${l.startsWith('—') ? 'round' : ''} ${l.startsWith('CRISIS') ? 'crisis' : ''}">${esc(l)}</div>`).join('');
  if (atBottom || !box.dataset.seen) { box.scrollTop = box.scrollHeight; box.dataset.seen = '1'; }
}

function renderChat(chat) {
  const list = $('chatList');
  list.innerHTML = (chat || []).map(c => `<div><b>${esc(c.from)}:</b> ${esc(c.text)}</div>`).join('');
  list.scrollTop = list.scrollHeight;
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  tab = b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  $('logBox').hidden = tab !== 'log';
  $('chatBox').hidden = tab !== 'chat';
});
$('chatForm').onsubmit = e => {
  e.preventDefault();
  const t = $('chatInput').value.trim();
  if (t) send({ type: 'chat', text: t });
  $('chatInput').value = '';
};

function renderOver() {
  const s = state;
  if (!s.result) { $('over').hidden = true; return; }
  if ($('over').dataset.shown === s.result) return;
  $('over').dataset.shown = s.result;
  $('overBox').innerHTML = `<div class="result ${s.result}">${s.result === 'victory' ? 'Victory' : 'Defeat'}</div>
    <p>${esc(s.endReason)}</p>
    <p>Great wonders built: ${s.builtWonders.length ? s.builtWonders.map(w => `<span class="chip">${esc(w.name)} — ${w.victoryPoints}</span>`).join('') : 'none'}</p>
    <p class="result" style="font-size:1.6rem">${s.score} wonder points</p>
    <p class="muted small">Reached the ${esc(s.era)} era in round ${s.round}.</p>
    <div class="row"><button id="closeOver">Look at the board</button><a href="./"><button class="primary">New game</button></a></div>`;
  $('over').hidden = false;
  $('closeOver').onclick = () => { $('over').hidden = true; };
}

boot();
