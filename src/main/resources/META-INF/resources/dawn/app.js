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
  pickEnd = state.pickLeftMs > 0 ? Date.now() + state.pickLeftMs : null;
  tickPickTimer.closed = state.pickLeftMs === 0;
  renderStatus();
  renderQueue();
  renderRealm();
  renderWonders();
  renderEvents();
  renderCiv();
  checkPickReveal();
  checkNotices();
  checkTurnDraw();
  renderStarvation();
  renderSetup();
  renderTechs();
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
      ${p.ai ? '<span class="chip">AI</span>' : ''}${p.seat === room.host ? '<span class="chip">host</span>' : ''}${p.seat === room.you ? '<span class="chip">you</span>' : ''}
      ${room.you === room.host && p.seat !== room.host ? `<button class="tiny danger" data-kick="${p.seat}">remove</button>` : ''}</li>`).join('');
  $('startGame').hidden = room.you !== room.host;
  $('addAi').hidden = room.you !== room.host || room.players.length >= 6;
  $('lobbyNote').textContent = room.you === room.host ? 'Start when everyone is in (1–6 players). AI players make simple moves on their own.' : 'Waiting for the host to start.';
}
$('lobbyPlayers').onclick = e => { const b = e.target.closest('[data-kick]'); if (b) send({ type: 'kick', seat: +b.dataset.kick }); };
$('startGame').onclick = () => send({ type: 'start' });
$('addAi').onclick = () => send({ type: 'addAi' });
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
const myTurn = () => state.phase === 'turns' && !me().done && !state.result;
const canAct = () => myTurn() && state.actionsLeft > 0;
const resList = (r, opts = {}) => RES.filter(k => (r?.[k] ?? 0) !== 0 || opts.all)
  .map(k => `<span class="res r-${k}">${opts.signed && r[k] > 0 ? '+' : ''}${r[k] ?? 0}<i>${RES_SHORT[k]}</i></span>`).join('') || '<span class="muted">—</span>';
const affordable = cost => !cost || RES.every(k => (me().resources[k] || 0) >= (cost[k] || 0));

function renderStatus() {
  const s = state, waiting = s.players.filter(o => !o.done && !o.away).map(o => esc(o.name));
  const phase = s.result ? (s.result === 'victory' ? 'Victory' : 'Defeat')
    : s.phase === 'setup' ? 'Choosing starting lands'
    : s.phase === 'events' ? 'Events' : s.phase === 'starvation' ? 'Starvation — choosing who goes' : myTurn() ? `<span class="turn">${s.actionsLeft} action${s.actionsLeft === 1 ? '' : 's'} left</span>` : `You are done — waiting for ${waiting.join(', ') || 'the others'}`;
  $('status').innerHTML = `<span>${esc(s.era)} era (${s.eraIndex + 1}/${s.eraCount})</span><span>Round <b>${s.round}</b></span>
    <span>${phase}</span><span>Stability <b class="${s.stability <= 3 ? 'bad' : ''}">${s.stability}</b></span>
    <span>Health <b>${s.health}</b></span><span class="${s.threat ? 'threat' : ''}">Enemies massing <b>${s.threat}</b></span><span>Era deck <b>${s.eraDeck}</b></span><span>Points <b>${s.score}</b></span>
    <span class="muted small">Room ${esc(room.code)}</span>`;
}

function cardHtml(c, extra = '', cls = '') {
  const kind = c.type === 'event' ? `event ${c.category || ''} ${c.crisis ? 'crisis' : ''}` : c.type;
  const typeLabel = c.type === 'event' ? (c.crisis ? 'Crisis' : 'Event · ' + (c.category || ''))
    : c.type === 'great_wonder' ? `Great wonder · ${c.victoryPoints} points` : c.type === 'leader' ? 'great person' : c.type.replace('_', ' ');
  const art = c.art ? ` hasart" style="--art:url('${c.art}')` : '';
  return `<div class="cardx ${kind} ${cls}${art}"><div class="type">${esc(typeLabel)}</div><div class="name">${esc(c.name)}</div>
    ${c.cost ? `<div class="small">${c.type === 'great_wonder' ? 'Team cost' : 'Cost'}: ${resList(c.cost)}</div>` : ''}<div class="text">${esc(c.text)}</div>${extra}</div>`;
}

function renderQueue() {
  // the queue runs right to left: new cards come in on the right, the leftmost cards leave at the end of the round
  const s = state, leaving = s.queueRemoved, n = s.queue.length;
  const items = s.queue.map((c, i) => {
    const isLeaving = i >= n - leaving;
    const fd = c.faceDown ? '<div class="facedown">+ a face-down card underneath</div>' : '';
    const label = c.type === 'event' ? 'Take on' : c.type === 'great_wonder' ? 'Start building' : 'Pick';
    if (c.taken) return `<div class="cardx gap" title="Taken; the queue closes up at the end of the round"><div class="muted small">taken</div></div>`;
    const btn = `<div class="actions"><button ${canAct() && !pickClosed() ? '' : 'disabled'} data-pick="${i}">${label} (1 action)</button></div>`;
    return cardHtml(c, `${isLeaving ? '<div class="leave-x" title="Leaves the queue at the end of the round">✕</div>' : ''}${fd}${btn}`, isLeaving ? 'leaving' : '');
  }).reverse().join('');
  $('queuePanel').innerHTML = `<div class="queue-head"><h2>Card queue</h2><span class="muted small">At the end of the round the ${leaving} leftmost card${leaving > 1 ? 's' : ''} (dashed) leave${leaving > 1 ? '' : 's'}; events that leave go to the future deck.</span></div>
    <div class="row small" id="pickBar"><label style="margin:0">Pick time (s, 0 = no limit) <input type="number" min="0" max="3600" step="10" id="pickSecs" value="${s.pickSeconds}" data-keep="pickSecs" style="width:4.5rem"></label><button class="tiny" data-picktime>Set</button></div>
    <div class="queue-wrap"><div class="queue-row">${items || '<p class="muted">The queue is empty.</p>'}</div><div class="pick-shade" id="pickShade"></div></div>
    <div class="queue-ends"><span>← leaves here</span><span>new cards come in here →</span></div>`;
  tickPickTimer();
}
// Taking on an event gives the face-down card under it: when it arrives in the hand, show it in a pop-up.
let pickWatch = null;
// The time to pick cards: counted down here from what the server says is left.
let pickEnd = null;
const pickClosed = () => state.pickLeftMs === 0 || (pickEnd != null && Date.now() >= pickEnd);
function tickPickTimer() {
  // the time left shows as the queue's background darkening from the right to the left
  const el = $('pickShade');
  if (!el) return;
  if (!state || state.phase !== 'turns' || state.pickLeftMs < 0) { el.style.width = '0'; el.title = ''; return; }
  const total = Math.max(1, (state.pickSeconds || 90) * 1000);
  const left = pickEnd == null ? 0 : Math.max(0, pickEnd - Date.now());
  el.style.width = (100 * (1 - Math.min(1, left / total))) + '%';
  el.title = left > 0 ? `Time to pick cards: ${Math.ceil(left / 1000)}s` : 'The queue is closed until the next round';
  if (left === 0 && !tickPickTimer.closed) { tickPickTimer.closed = true; renderQueue(); }
}
setInterval(tickPickTimer, 250);
$('queuePanel').onclick = e => {
  const pt = e.target.closest('[data-picktime]');
  if (pt) return send({ type: 'pickTime', seconds: Math.max(0, Math.round(+$('pickSecs').value || 0)) });
  const b = e.target.closest('[data-pick]'); if (!b) return;
  const card = state.queue[+b.dataset.pick];
  if (card && card.type === 'event') {
    pickWatch = { ids: new Set((me().hand || []).map(c => c.id)), event: card.name, at: Date.now() , leader: me().leader && me().leader.name};
  }
  send({ type: 'pick', slot: +b.dataset.pick });
};
// The card drawn blind at the start of your turn is shown in a pop-up (once per turn, also after a reload).
function checkTurnDraw() {
  const m = me();
  if (!m || m.turnSeq == null || !room) return;
  const key = 'dawnDraw-' + room.code;
  let seen = null;
  try { seen = sessionStorage.getItem(key); } catch (e) {}
  if (seen === String(m.turnSeq)) return;
  try { sessionStorage.setItem(key, String(m.turnSeq)); } catch (e) {}
  const ev = m.turnEvents ? `<p class="muted small">${m.turnEvents} event${m.turnEvents > 1 ? 's' : ''} came up first and went face down into the future deck.</p>` : '';
  const body = m.turnDraw
    ? `<div class="cards">${cardHtml(m.turnDraw)}</div>${m.turnDraw.type === 'great_wonder' ? '<p class="muted small">A great wonder: it goes on the board for the whole tribe to build.</p>' : ''}${m.turnDraw.type === 'leader' ? '<p class="muted small">A great person: they take over at once and leave when the era ends.</p>' : ''}`
    : '<p class="muted">The era deck is empty: nothing to draw.</p>';
  $('gotBox').innerHTML = `<h2>Round ${state.round}: your turn. You drew</h2>${ev}${body}<div class="row"><button class="primary" data-gotok>OK</button></div>`;
  $('gotModal').hidden = false;
}
// Starvation: when food runs short and your people are in more than one place, you choose who starves.
// Start of the game: each player picks one of two lands to start with.
function renderSetup() {
  const s = state, box = $('setupBox');
  if (s.phase !== 'setup') { $('setupModal').hidden = true; return; }
  const offer = s.setupOffer || [];
  box.innerHTML = offer.length
    ? `<h2>Choose your starting land</h2><p class="muted small">Each player is offered two lands and keeps one. The realm starts with two of the chosen lands; the rest go back on top of the land deck.</p>
       <div class="catalog">${offer.map(l => `<div><div class="nm">${esc(l.name)}</div><div>${esc(l.text)}</div><div class="actions"><button class="primary" data-land="${l.id}">Start here</button></div></div>`).join('')}</div>`
    : `<h2>Waiting for the others</h2><p class="muted">Still choosing: ${(s.setupWaiting || []).map(esc).join(', ') || '…'}</p>`;
  $('setupModal').hidden = false;
}
$('setupModal').onclick = e => {
  const b = e.target.closest('[data-land]');
  if (b) send({ type: 'chooseLand', land: +b.dataset.land });
};
function renderStarvation() {
  const s = state, need = s.starving && s.starving[s.you];
  if (s.phase !== 'starvation' || !need) { $('starveModal').hidden = true; return; }
  if (!$('starveModal').hidden) return;                      // keep what is being chosen across redraws
  const p = me();
  const rows = [['idle', 'Idle', p.idle], ...(p.buildings || []).map(b => [b.id, b.name, b.workers])].filter(r => r[2] > 0);
  $('starveBox').innerHTML = `<h2>Not enough food</h2><p>${need} of your people ${need === 1 ? 'starves' : 'starve'}. Choose who.</p>
    <div class="column">${rows.map(([id, name, have]) => `<label class="row" style="justify-content:space-between">${esc(name)} <span class="muted small">(${have})</span>
      <input type="number" min="0" max="${Math.min(have, need)}" value="0" data-starve="${id}" style="width:4rem"></label>`).join('')}</div>
    <div class="row"><span class="small muted" id="starveSum"></span><button class="primary" id="starveOk">Confirm</button></div>`;
  $('starveModal').hidden = false;
  const upd = () => {
    const sum = [...document.querySelectorAll('[data-starve]')].reduce((t, i) => t + (+i.value || 0), 0);
    $('starveSum').textContent = `${sum} of ${need} chosen`;
    $('starveOk').disabled = sum !== need;
  };
  document.querySelectorAll('[data-starve]').forEach(i => { i.oninput = upd; });
  upd();
  $('starveOk').onclick = () => {
    const lose = {};
    document.querySelectorAll('[data-starve]').forEach(i => { if (+i.value > 0) lose[i.dataset.starve] = +i.value; });
    $('starveModal').hidden = true;
    send({ type: 'starve', lose });
  };
}

// Events that resolve at once (nobody can respond) are shown too, so they don't pass by unseen in the log.
function checkNotices() {
  if (!room || !state.notices) return;
  const key = 'dawnNotice-' + room.code;
  let last = 0, stored = null;
  try { stored = sessionStorage.getItem(key); } catch (e) {}
  if (stored == null) {                                  // first look in this tab: what already happened isn't shown again
    const top = state.notices.length ? state.notices[state.notices.length - 1].seq : 0;
    try { sessionStorage.setItem(key, String(top)); } catch (e) {}
    return;
  }
  last = +stored || 0;
  const fresh = state.notices.filter(n => n.seq > last);
  if (!fresh.length) return;
  try { sessionStorage.setItem(key, String(fresh[fresh.length - 1].seq)); } catch (e) {}
  if (!$('noticeModal').hidden) { noticeQueue.push(...fresh); return; }
  showNotices(fresh);
}
let noticeQueue = [];
function showNotices(list) {
  $('noticeBox').innerHTML = `<h2>${list.length > 1 ? 'Events' : 'An event'} struck</h2>` + list.map(n => cardHtml(n.card,
    `${n.target ? `<div class="small">Struck <b>${esc(n.target)}</b>.</div>` : ''}<div class="small">${n.lines.map(esc).join('<br>')}</div>`)).join('') + `<div class="row"><button class="primary" data-noticeok>OK</button></div>`;
  $('noticeModal').hidden = false;
}
$('noticeModal').onclick = e => {
  if (!e.target.closest('[data-noticeok]') && e.target !== $('noticeModal')) return;
  $('noticeModal').hidden = true;
  if (noticeQueue.length) { const q = noticeQueue; noticeQueue = []; showNotices(q); }
};
function checkPickReveal() {
  if (!pickWatch) return;
  if (Date.now() - pickWatch.at > 5000) { pickWatch = null; return; }
  const got = (me().hand || []).filter(c => !pickWatch.ids.has(c.id));
  if (me().leader && me().leader.name !== pickWatch.leader) got.push(me().leader);      // a great person plays at once
  if (!got.length) return;
  const ev = pickWatch.event;
  pickWatch = null;
  $('gotBox').innerHTML = `<h2>The face-down card</h2><p class="muted small">You took on <b>${esc(ev)}</b> and got:</p>
    <div class="cards">${got.map(c => cardHtml(c)).join('')}</div><div class="row"><button class="primary" data-gotok>OK</button></div>`;
  $('gotModal').hidden = false;
}
$('gotModal').onclick = e => { if (e.target.closest('[data-gotok]') || e.target === $('gotModal')) $('gotModal').hidden = true; };

const slotText = slots => Object.entries(slots || {}).map(([b, n]) => `+${n} ${b}`).join(', ');

let landCardFn;                       // the land card drawing of renderRealm, also used in the event pop-up
function renderRealm() {
  const s = state;
  const lands = s.realm.map(t => `<div class="cardx territory ${t.cored ? 'cored' : ''}"><div class="type">Territory${t.cored ? ' · core' : ''}</div><div class="name">${esc(t.name)}</div>
      <div class="text">${esc(t.text)}</div>${t.wonders.length ? `<div class="small">${t.wonders.map(w => `<span class="chip">★ ${esc(w)}</span>`).join('')}</div>` : ''}</div>`).join('');
  const settleCard = (me().hand || []).find(c => c.target === 'land');
  const landCard = landCardFn = f => {
    const need = RES.filter(k => f.left[k] > 0);
    const troopsLeft = f.troops - f.troopsPaid, settlersLeft = f.settlers - f.settlersPaid;
    const inputs = `<div class="row small">${need.map(k => `<label class="res r-${k}" style="margin:0">${RES_SHORT[k]} <input type="number" min="0" max="${f.left[k]}" value="0" data-keep="f-${f.id}-${k}" data-fres="${k}"></label>`).join('')}
      ${troopsLeft > 0 ? `<label style="margin:0">Troops <input type="number" min="0" max="${troopsLeft}" value="0" data-keep="f-${f.id}-army" data-farmy></label>` : ''}
      ${settlersLeft > 0 ? `<label style="margin:0" title="Idle people go first, then workers">Settlers <input type="number" min="0" max="${settlersLeft}" value="0" data-keep="f-${f.id}-pop" data-fpop></label>` : ''}</div>
      ${settlersLeft > 0 ? '<div class="small muted">Settlers can be idle people or workers (idle people go first).</div>' : ''}`;
    const canSendNow = f.duringEvent ? s.phase === 'events' && s.pending && !s.pending.ready[s.you] : canAct();
    const button = f.fromEvent
      ? `<button ${canSendNow ? '' : 'disabled'} data-colonize="${f.id}">Send (free)</button>`
      : f.opened
        ? `<button ${myTurn() ? '' : 'disabled'} data-colonize="${f.id}">Send (free)</button>`
        : `<button ${canAct() && settleCard ? '' : 'disabled'} data-settle="${f.id}" title="${settleCard ? '' : 'You need a Settle card'}">Play Settle: make it a colony (1 action)</button>${settleCard ? '' : ' <span class="small muted">needs a Settle card</span>'}`;
    const by = Object.entries(f.bySeat).map(([n, r]) => `<div class="small muted">${esc(n)}: ${resList(r)}</div>`).join('');
    return `<div class="cardx frontier ${f.fromEvent ? 'eventland' : ''}" data-f="${f.id}">
      <div class="type">${f.fromEvent ? 'Found by this event · settle it now or lose it' : f.opened ? 'Colony · being settled' : 'Face-up land'}${f.enemy ? ` · enemy strength ${f.enemy}` : ''}</div>
      <div class="name">${esc(f.name)}</div><div class="text">${esc(f.text)}</div>
      <div class="small">Paid ${resList(f.paid)} of ${resList(f.cost)}${f.troops ? ` · military strength ${f.troopsPaid}/${f.troops}` : ''}${f.settlers ? ` · settlers ${f.settlersPaid}/${f.settlers}` : ''}</div>
      ${by}${inputs}<div class="row">${button}</div></div>`;
  };
  const inPopup = f => f.duringEvent && eventPopupOpen();
  const colonies = s.frontier.filter(f => f.opened && !inPopup(f)).map(landCard).join('');
  const front = s.frontier.filter(f => !f.opened && !inPopup(f)).map(landCard).join('');
  $('realmPanel').innerHTML = `<h2>The realm</h2>
    <p class="muted small">Shared land. Each territory gives every player room for buildings and its bonus. A broken invasion takes a territory (a core territory only loses its core status); with none left, the game is lost.
    World deck: ${s.worldDeck} lands · colonization value ${s.colonizationValue}.</p>
    <div class="cards">${lands}</div>
    ${colonies ? `<h3 style="margin-top:.6rem">Colonies</h3><p class="muted small">Lands being settled. Anyone can send to them (free, on their turn) until the whole cost is paid; then they join the realm.</p><div class="cards">${colonies}</div>` : ''}
    <h3 style="margin-top:.6rem">Lands to settle</h3><p class="muted small">Pay toward a land until its whole cost is met: resources, troops against its enemy strength (all the troops sent are lost), settlers. Play a Settle card on a face-up land to make it a colony (a new land is turned up in its place). A land found by an event must be paid for at once, before the event resolves (anyone, free), or it is lost with everything sent.</p>
    <div class="cards">${front || '<p class="muted">None face up.</p>'}</div>`;
}

$('realmPanel').onclick = $('eventPanel').landClick = e => {
  const b = e.target.closest('[data-colonize],[data-settle]'); if (!b) return;
  const box = b.closest('[data-f]'), resources = {};
  box.querySelectorAll('[data-fres]').forEach(i => { resources[i.dataset.fres] = Math.max(0, +i.value || 0); i.value = 0; });
  const army = box.querySelector('[data-farmy]'), pop = box.querySelector('[data-fpop]');
  const msg = { land: +(b.dataset.colonize || b.dataset.settle), resources, army: army ? +army.value || 0 : 0, population: pop ? +pop.value || 0 : 0 };
  if (army) army.value = 0;
  if (pop) pop.value = 0;
  if (b.dataset.colonize) send({ type: 'colonize', ...msg });
  else send({ type: 'play', card: (me().hand || []).find(c => c.target === 'land').id, ...msg });
};

function renderWonders() {
  const s = state;
  const list = s.greatWonders.map(w => {
    const total = RES.reduce((a, k) => a + w.cost[k], 0), paid = RES.reduce((a, k) => a + w.paid[k], 0);
    const need = RES.filter(k => w.cost[k] > 0);
    const form = w.done ? '' : `<div class="row small">${need.map(k => `<label class="res r-${k}" style="margin:0">${RES_SHORT[k]} <input type="number" min="0" value="0" data-keep="w-${w.key}-${k}" data-wres="${k}"></label>`).join('')}</div>
      <div class="row small">If this finishes it, place it in <select data-keep="w-${w.key}-where" data-wwhere>${s.realm.map(t => `<option value="${t.id}">${esc(t.name)}${t.wonders.length ? ' (' + t.wonders.length + ' wonder' + (t.wonders.length > 1 ? 's' : '') + ')' : ''}</option>`).join('')}</select></div>
      <div class="row">${s.sharedPool ? `<label class="small" style="margin:0"><input type="checkbox" data-keep="w-${w.key}-pool" data-wpool> from shared pool</label>` : ''}
      <button ${myTurn() ? '' : 'disabled'} data-wonder="${w.key}">Contribute (free)</button></div>`;
    const by = Object.entries(w.bySeat).map(([n, r]) => `<div class="small muted">${esc(n)}: ${resList(r)}</div>`).join('');
    return `<div class="cardx wonder ${w.done ? 'done' : ''}${w.art ? ` hasart" style="--art:url('${w.art}')` : ''}" data-w="${w.key}"><div class="type">Great wonder · ${w.victoryPoints} points</div>
      <div class="name">${esc(w.name)}${w.done ? ' ✓' : ''}</div><div class="text">${esc(w.text)}</div>
      <div class="small">Paid ${resList(w.paid, { all: false })} of ${resList(w.cost)}</div><div class="prog"><div style="width:${total ? 100 * paid / total : 0}%"></div></div>${by}${form}</div>`;
  }).join('');
  const built = s.builtWonders.length ? `<p class="small">Built: ${s.builtWonders.map(w => `<span class="chip" title="${esc(w.text)}">${esc(w.name)} (${w.victoryPoints})${w.obsolete ? ' · obsolete' : ''}</span>`).join('')}</p>` : '';
  $('wonderPanel').innerHTML = `<h2>Great wonders</h2><p class="muted small">Great wonders turn up in the queue; take one to start building it together. Each stands in a territory: lose the territory, lose the wonder. Their points, plus 1 per territory, are your final score. Unfinished wonders are lost when the era ends (half is returned).</p>${built}<div class="cards">${list || '<p class="muted">None under construction.</p>'}</div>`;
}
$('wonderPanel').onclick = e => {
  const b = e.target.closest('[data-wonder]'); if (!b) return;
  const box = b.closest('[data-w]'), resources = {};
  box.querySelectorAll('[data-wres]').forEach(i => { resources[i.dataset.wres] = Math.max(0, +i.value || 0); });
  const pool = box.querySelector('[data-wpool]');
  const where = box.querySelector('[data-wwhere]');
  send({ type: 'contribute', wonder: b.dataset.wonder, resources, fromPool: !!(pool && pool.checked), territory: where ? +where.value : -1 });
  box.querySelectorAll('[data-wres]').forEach(i => { i.value = 0; });
};

// An event that strikes pops up over the board (with any land it found), so it can't be clicked through unread.
let popupHiddenFor = null, popupLastKey = null;
function pendingKey() { const p = state && state.pending; return p ? (p.id ?? p.name) + '|' + (state.round ?? '') : null; }
function eventPopupOpen() {
  const p = state && state.pending;
  return !!p && !p.ready[state.you] && popupHiddenFor !== pendingKey();
}
function renderEvents() {
  const s = state, p = s.pending;
  if (!p) { popupHiddenFor = null; }
  const popup = eventPopupOpen();
  $('eventPanel').classList.toggle('popup', popup);
  $('eventBackdrop').hidden = !popup;
  let html = popup ? '<h2>An event strikes</h2>' : '<h2>Events</h2>';
  if (p && !popup && !p.ready[s.you]) html += '<button class="primary" data-showpop>Show the event again</button>';
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
      controls += `<button class="primary" data-ready>Done — resolve</button><button data-hidepop title="Look at the board first; it stays pending">Look at the board</button>`;
    } else {
      controls = '<span class="muted small">You are done. Waiting for the others…</span>';
    }
    const waiting = Object.entries(p.ready).filter(([, r]) => !r).map(([seat]) => esc(s.players[seat].name));
    const found = s.frontier.filter(f => f.duringEvent);
    html += cardHtml(p, `${target}<div class="preview">${esc(p.preview)}</div>
      ${found.length ? `<div class="small" style="color:var(--brass)">New land found: ${found.map(f => esc(f.name)).join(', ')}. Settle it before everyone is done, or it is lost.</div>${popup && landCardFn ? '<div class="cards">' + found.map(landCardFn).join('') + '</div>' : ''}` : ''}
      ${p.responses.length ? `<div class="small">Responses: ${p.responses.map(esc).join(', ')}</div>` : ''}
      ${p.kind === 'invasion' ? `<div class="small">Troops sent: ${Object.entries(p.troops).map(([seat, n]) => esc(s.players[seat].name) + ' ' + n).join(', ') || 'none yet'}</div>` : ''}
      <div class="actions">${controls}</div><div class="readylist">${waiting.length ? 'Waiting for: ' + waiting.join(', ') : ''}</div>`, 'pending');
  } else {
    html += `<p class="muted small">After everyone's turn, as many events are drawn from the event deck as the future deck holds (now <b>${s.futureEvents}</b>).</p>`;
    if (s.threat) html += `<p class="threat-note">⚔ ${s.threat} enemies are massing. The next invasion will be ${s.threat} stronger (players × territories = ${s.players.length * s.realm.length}, so ${s.players.length * s.realm.length + s.threat} now).</p>`;
  }
  if (s.crises.length) {
    html += '<h3>Crises in effect</h3><div class="cards">' + s.crises.map(c => cardHtml(c, `<div class="small" style="color:var(--err)">Round ${c.round} of ${c.rounds}</div>`)).join('') + '</div>';
  }
  if (s.persistentEvents.length) {
    html += '<h3>Lasting events</h3><div class="cards">' + s.persistentEvents.map(c => cardHtml(c,
      `<div class="actions"><button ${canAct() && affordable(c.cleanse) ? '' : 'disabled'} data-cleanse="${c.id}">Lift for ${resList(c.cleanse)} (1 action)</button></div>`)).join('') + '</div>';
  }
  $('eventPanel').innerHTML = html;
  $('eventPanel').classList.toggle('pending', !!p);
}
$('eventPanel').onclick = e => {
  if (e.target.closest('[data-colonize],[data-settle]')) return $('eventPanel').landClick(e);
  const t = e.target.closest('button'); if (!t) return;
  if ('hidepop' in t.dataset) { popupHiddenFor = pendingKey(); renderEvents(); renderRealm(); }
  else if ('showpop' in t.dataset) { popupHiddenFor = null; renderEvents(); renderRealm(); }
  else if (t.dataset.respond) send({ type: 'respond', card: +t.dataset.respond });
  else if ('troops' in t.dataset) send({ type: 'troops', troops: +$('troopIn').value || 0 });
  else if (t.dataset.decide) send({ type: 'decide', accept: t.dataset.decide === '1' });
  else if ('ready' in t.dataset) {
    const tin = $('troopIn');
    if (tin && (+tin.value || 0) !== (state.pending.troops[state.you] ?? 0)) send({ type: 'troops', troops: +tin.value || 0 });
    send({ type: 'ready' });
  } else if (t.dataset.cleanse) send({ type: 'cleanse', event: +t.dataset.cleanse });
};

// The technologies researched so far (global: they help every player), with what each does.
function renderTechs() {
  const s = state, list = s.players.flatMap(o => o.techs.map(t => ({ t, by: o.name })));
  $('techPanel').innerHTML = `<h2>Technologies <span class="muted small">(${list.length})</span></h2>` + (list.length
    ? list.map(({ t, by }) => `<div class="techrow"><b>${esc(t.name)}</b> <span class="muted small">by ${esc(by)}</span><div class="small">${esc(t.text)}</div></div>`).join('')
    : '<p class="muted small">None yet. Technologies help every player once anyone has researched them.</p>');
  // the lasting bonuses that aren't technologies: minor wonders such as Roman Roads
  const bonus = s.players.flatMap(o => o.minorWonders.map(t => ({ t, by: o.name })));
  $('bonusPanel').innerHTML = `<h2>Bonuses <span class="muted small">(${bonus.length})</span></h2>` + (bonus.length
    ? bonus.map(({ t, by }) => `<div class="techrow"><b>★ ${esc(t.name)}</b> <span class="muted small">by ${esc(by)}</span><div class="small">${esc(t.text)}</div></div>`).join('')
    : '<p class="muted small">None yet. Minor wonders (like Roman Roads) and other lasting bonuses show here.</p>');
}
let growCb = null;
function openGrowChoice(free, cb) {
  growCb = cb || (id => send({ type: 'grow', building: id }));
  const box = $('growBox');
  box.innerHTML = `<h2>Where does the new person work?</h2><div class="column">${free.map(b =>
    `<button data-gb="${b.id}">${esc(b.name)} <span class="muted small">(${b.workers}/${b.slots} workers)</span></button>`).join('')}</div>
    <div class="row"><button data-gcancel>Cancel</button></div>`;
  $('growModal').hidden = false;
}
$('growModal').onclick = e => {
  const t = e.target.closest('button');
  if (t && t.dataset.gb && growCb) growCb(+t.dataset.gb);
  if (t || e.target === $('growModal')) $('growModal').hidden = true;
};

function renderCiv() {
  const s = state, p = me(), act = canAct();
  const capOf = id => (s.buildable || []).find(x => x.id === id)?.capacity;
  // every building, plus land-bound types the land has room for but that aren't built (all grey)
  const rows = [...p.buildings];
  for (const b of s.buildable || []) {
    if (b.capacity && !p.buildings.some(x => x.type === b.id)) rows.push({ id: null, type: b.id, name: b.name, workers: 0, slots: 0, level: 0 });
  }
  const blds = rows.map(b => {
    const cap = capOf(b.type);
    const room = cap != null ? Math.max(0, cap - b.slots) : 0;
    const dots = Array.from({ length: b.slots }, (_, i) => `<span class="slot ${i < b.workers ? 'full' : ''}" title="${i < b.workers ? 'worker' : 'empty slot'}"></span>`).join('')
      + Array.from({ length: b.inactive || 0 }, (_, i) => `<span class="slot off ${b.slots + i < b.workers ? 'full' : ''}" title="inactive: above what your land allows"></span>`).join('')
      + Array.from({ length: room }, () => '<span class="slot room" title="room on your land: build to use it"></span>').join('');
    const controls = b.id == null ? '<span class="small muted">not built</span>' : `
      <button class="tiny" ${act && p.idle > 0 && b.workers < b.slots ? '' : 'disabled'} data-move-in="${b.id}" title="Move an idle worker here (1 action)">+ worker</button>
      <button class="tiny" ${act && b.workers > 0 ? '' : 'disabled'} data-move-out="${b.id}" title="Make a worker idle (1 action)">− worker</button>`;
    return `<div class="bld"><span class="bname">${esc(b.name)}${b.level > 1 ? ` <span class="chip">level ${b.level}</span>` : ''}</span>
      <span class="slots">${dots}</span>${controls}
      ${b.id != null ? `<span class="makes" title="${esc(Object.entries(b.each || {}).map(([r, n]) => `${n} ${r} per worker`).join(', ') || 'makes nothing')} (technologies included)">${Object.keys(b.makes || {}).length ? resList(b.makes, { signed: true }) : '<span class="muted">—</span>'}</span>` : ''}
      ${cap != null ? `<span class="small muted">${b.slots}/${cap} slots built</span>` : ''}${b.inactive ? `<span class="small bad">${b.inactive} inactive (over the land limit)</span>` : ''}</div>`;
  }).join('');
  const moveOpts = [['idle', `Idle (${p.idle})`], ...p.buildings.map(b => [b.id, `${b.name} #${b.id} (${b.workers}/${b.slots})`])]
    .map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
  const build = (s.buildable || []).map(b => {
    const full = b.capacity != null && b.slots >= b.capacity;
    const add = b.capacity != null ? Math.min(b.slotsAdded, b.capacity - b.slots) : b.slotsAdded;
    return `<button ${act && !full && affordable(b.cost) ? '' : 'disabled'} data-build="${b.id}" title="${esc(b.text)}">${full ? `${esc(b.name)}: no room — settle more land`
      : b.owned ? `Expand ${esc(b.name)} (+${add} slot${add > 1 ? 's' : ''})` : `Build ${esc(b.name)}`}${full ? '' : ' — ' + resList(b.cost)}</button>`;
  }).join('');
  $('civPanel').className = 'panel mine';
  $('civPanel').innerHTML = `<h2>Your people — ${esc(p.name)}</h2>
    <div class="row">${resList(p.resources, { all: true })}</div>
    <div class="row small muted">Per round: ${resList(p.income, { signed: true })} (food after feeding your people)</div>
    <div class="row small">Population <b>${p.population}</b> · idle ${p.idle} · Army <b>${p.army}</b>${p.strength !== p.army ? ` (strength ${p.strength})` : ''}${p.committed ? ` (${p.committed} away at war)` : ''} · raid defense +${p.raidDefense} · hand ${p.handSize}/${p.handLimit}</div>
    ${(() => { const techs = s.players.flatMap(o => o.techs); return techs.length ? `<div class="small">Technologies (they help everyone): ${techs.map(t => `<span class="chip" title="${esc(t.text)}">${esc(t.name)}</span>`).join('')}</div>` : ''; })()}
    ${p.leader ? `<div class="small">Great person: <span class="chip" title="${esc(p.leader.text)}">♛ ${esc(p.leader.name)}</span> <span class="muted">${esc(p.leader.text)} Leaves when the era ends.</span></div>` : ''}
    ${p.minorWonders.length ? `<div class="small">${p.minorWonders.map(t => `<span class="chip" title="${esc(t.text)}">★ ${esc(t.name)}</span>`).join('')}</div>` : ''}
    ${s.strengthPerTwoTroops || s.freeSettlers ? `<div class="small muted">${s.strengthPerTwoTroops ? `Military strength +${s.strengthPerTwoTroops} per 2 troops. ` : ''}${s.freeSettlers ? `Settling takes ${s.freeSettlers} settler${s.freeSettlers > 1 ? 's' : ''} less.` : ''}</div>` : ''}
    <h3 style="margin-top:.5rem">Buildings</h3><p class="small muted" style="margin:0">● worker · ○ empty slot · <span style="opacity:.5">●</span> room on your land, not built yet</p>${blds}
    <div class="row small">Move a worker <select id="mvFrom" data-keep="mvFrom">${moveOpts}</select> → <select id="mvTo" data-keep="mvTo">${moveOpts}</select><button ${act ? '' : 'disabled'} data-move>Move (1 action)</button></div>
    <h3>Actions</h3><p class="small muted" style="margin:0">Building something you already have adds worker slots to it; each level costs 1 more production. Farms and mines need land.</p>
    <div class="row">${build}</div>
    <div class="row">
      <button ${act && affordable(s.rules.growthCost) ? '' : 'disabled'} data-grow>Grow +1 Population — ${resList(s.rules.growthCost)}</button>
      <button ${act && affordable(s.rules.recruitCost) ? '' : 'disabled'} data-recruit>Train 1 troop — ${resList(s.rules.recruitCost)}</button>
      <button class="primary" ${myTurn() ? '' : 'disabled'} data-end>Done for the round</button>
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
  else if ('grow' in d) {
    // more than one building with a free slot: choose where the new person works
    const free = (me().buildings || []).filter(b => b.workers < b.slots);
    if (free.length > 1) openGrowChoice(free); else send({ type: 'grow' });
  }
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
    const give = others.length && p.giveCards ? `<label class="small" style="margin:0"><input type="checkbox" data-pickgive="${c.id}" data-keep="pg-${c.id}"> give</label>` : '';
    if (c.target === 'land') {
      return cardHtml(c, `<div class="actions"><span class="small muted">Use it on a land in the realm panel.</span><button class="tiny" data-discard="${c.id}">Discard</button>${give}</div>`);
    }
    const opts = c.target === 'territory' ? s.realm.filter(t => !t.cored).map(t => [t.id, t.name])
      : c.target === 'player' ? others.map(o => [o.seat, o.name]) : null;
    const tradeText = o => `pay ${resList(o.give)} → your teammate gets ${resList(o.get)}`;
    const tradeInputs = c.trade ? `<div class="row small"><select id="opt-${c.id}" data-keep="opt-${c.id}">${c.trade.map((o, k) => `<option value="${k}">${RES.filter(r => o.give[r]).map(r => o.give[r] + ' ' + r).join(', ')} → ${RES.filter(r => o.get[r]).map(r => '+' + o.get[r] + ' ' + r).join(', ')} for them</option>`).join('')}</select></div>` : '';
    const pickTarget = opts ? `<select id="tgt-${c.id}" data-keep="tgt-${c.id}">${opts.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select>` : '';
    return cardHtml(c, `${tradeInputs}<div class="actions">${pickTarget}${playable ? `<button ${act && (affordable(c.cost) || (c.type === 'tech' && me().freeTech)) && (!opts || opts.length) ? '' : 'disabled'} data-play="${c.id}" data-target="${c.target || ''}">Play (1 action)</button>` : '<span class="small muted">Play it when an event strikes.</span>'}
      <button class="tiny" data-discard="${c.id}">Discard</button>${give}</div>`);
  }).join('');
  const giveBar = others.length && p.giveCards ? `<div class="row small">Roman Roads: give up to ${p.giveCards} ticked cards to
      <select id="giveCardsTo" data-keep="giveCardsTo">${others.map(o => `<option value="${o.seat}">${esc(o.name)}</option>`).join('')}</select>
      <button ${act ? '' : 'disabled'} data-givecards>Give (1 action)</button></div>` : '';
  $('handPanel').innerHTML = `<h2>Your hand (${p.hand.length}/${p.handLimit})</h2>${over ? `<p class="small bad" style="color:var(--err)">Discard down to ${p.handLimit} before you are done.</p>` : ''}${giveBar}
    <div class="cards">${cards || '<p class="muted">No cards. Pick from the queue.</p>'}</div>`;
}
$('handPanel').onclick = e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.play) {
    const msg = { type: 'play', card: +t.dataset.play };
    const sel = $('tgt-' + t.dataset.play);
    if (t.dataset.target === 'territory') msg.territory = +sel.value;
    if (t.dataset.target === 'player') {
      msg.to = +sel.value;
      msg.option = +($('opt-' + t.dataset.play)?.value || 0);
    }
    // a card that brings a person, with more than one building with a free slot: choose where they work
    const card = (me().hand || []).find(c => c.id === msg.card), free = (me().buildings || []).filter(b => b.workers < b.slots);
    if (card && card.population && free.length > 1) openGrowChoice(free, id => send({ ...msg, building: id }));
    else send(msg);
  }
  else if (t.dataset.discard) send({ type: 'discard', card: +t.dataset.discard });
  else if ('givecards' in t.dataset) {
    const cards = [...document.querySelectorAll('[data-pickgive]:checked')].map(i => +i.dataset.pickgive);
    send({ type: 'giveCards', to: +$('giveCardsTo').value, cards });
    document.querySelectorAll('[data-pickgive]').forEach(i => { i.checked = false; });
  }
};

function renderTeam() {
  const s = state;
  const others = s.players.filter(o => o.seat !== s.you);
  const list = s.players.map(o => `<div class="teammate ${s.phase === 'turns' && !o.done ? 'active' : ''}">
      <div class="tname">${s.phase === 'turns' ? (o.done ? '✔ ' : '▶ ') : ''}${esc(o.name)}${o.seat === s.you ? ' (you)' : ''}${room.players[o.seat]?.ai ? ' <span class="chip">AI</span>' : ''}${o.seat === s.firstPlayer ? ' <span class="chip">first</span>' : ''}${o.away ? ' <span class="chip">away</span>' : ''}</div>
      <div class="small">${resList(o.resources)}</div>
      <div class="small muted">Pop ${o.population} · Army ${o.army}${o.strength !== o.army ? ` (strength ${o.strength})` : ''} · Hand ${o.handSize} · ${o.buildings.map(b => esc(b.name) + ' ' + b.workers + '/' + b.slots).join(', ')}</div>
      ${o.techs.length || o.minorWonders.length ? `<div>${o.techs.map(t => `<span class="chip" title="${esc(t.text)}">${esc(t.name)}</span>`).join('')}${o.minorWonders.map(t => `<span class="chip">★ ${esc(t.name)}</span>`).join('')}</div>` : ''}
      ${o.leader ? `<div class="small"><span class="chip" title="${esc(o.leader.text)}">♛ ${esc(o.leader.name)}</span></div>` : ''}
    </div>`).join('');
  $('teamPanel').innerHTML = `<h2>The tribe</h2><p class="small" style="margin:0 0 .3rem">Army ${s.players.reduce((t, o) => t + o.army, 0)} (total strength against an invasion: <b>${s.tribeStrength}</b>)</p>${list}`;
}
function renderDecks() {
  const s = state;
  const contents = Object.entries(s.eventDeckContents).map(([n, c]) => `${esc(n)}${c > 1 ? ' ×' + c : ''}`).join(', ');
  $('deckPanel').innerHTML = `<h2>Event decks</h2>
    <div class="small">Event deck: <b>${s.eventDeck}</b> cards <details><summary>What's in it</summary>${contents || 'empty'}</details></div>
    <div class="small" style="margin-top:.3rem">Future deck (face down): <b>${s.futureEvents}</b> — this many events strike this round</div>
    <div class="small muted" style="margin-top:.3rem">Crisis cards waiting: ${s.crisisPile}</div>
    <details style="margin-top:.3rem"><summary>Past events (${s.pastEvents.length})</summary><div class="cards">${s.pastEvents.map(c => cardHtml(c)).join('')}</div></details>`;
}

function renderLog() {
  const box = $('logBox');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
  box.innerHTML = state.log.map(l => `<div class="${l.startsWith('—') ? 'round' : ''} ${l.startsWith('CRISIS') || l.startsWith('HOSTILITY') || l.includes('they invade!') ? 'crisis' : ''}">${esc(l)}</div>`).join('');
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
    <p>Territories held: ${s.territoryPoints} (1 point each)</p>
    <p class="result" style="font-size:1.6rem">${s.score} points</p>
    <p class="muted small">Reached the ${esc(s.era)} era in round ${s.round}.</p>
    <div class="row"><button id="closeOver">Look at the board</button><a href="./"><button class="primary">New game</button></a></div>`;
  $('over').hidden = false;
  $('closeOver').onclick = () => { $('over').hidden = true; };
}

boot();

// ---- the list of every card in the game ----
let catalogue = null;
async function openAllCards() {
  const box = $('cardsBox');
  $('cardsModal').hidden = false;
  box.innerHTML = '<p class="muted">Loading…</p>';
  try {
    if (!catalogue) catalogue = await (await fetch(API + '/cards')).json();
  } catch (e) { box.innerHTML = '<p class="bad">Could not load the cards.</p>'; return; }
  const cost = c => c ? Object.entries(c).filter(([, v]) => v).map(([k, v]) => v + ' ' + k).join(', ') : '';
  const item = (name, meta, text, art) => `<div${art ? ` class="hasart" style="--art:url('${art}')"` : ''}><div class="nm">${esc(name)}</div><div class="meta">${esc(meta)}</div><div>${esc(text || '')}</div></div>`;
  const group = (title, kinds) => {
    const list = catalogue.cards.filter(c => kinds.includes(c.type));
    return list.length ? `<h3>${title} (${list.length})</h3><div class="catalog">${list.map(c =>
      item(c.name, [c.type === 'leader' ? 'great person' : c.type.replace('_', ' '), c.era, cost(c.cost) && 'cost ' + cost(c.cost), c.minPlayers && c.minPlayers + '+ players only'].filter(Boolean).join(' · '), c.text, c.art)).join('')}</div>` : '';
  };
  const types = [...new Set(catalogue.cards.map(c => c.type))].filter(t => t !== 'great_wonder');
  const names = { leader: 'Great people', era_trigger: 'Era-trigger events', hostility: 'Hostility cards', tech: 'Techs', action: 'Actions', response: 'Responses', minor_wonder: 'Minor wonders', great_wonder: 'Great wonders', event: 'Events' };
  const nice = k => names[k] || k;
  const per = x => !x ? '-' : [x.base ? String(x.base) : '', x.perPlayer ? (x.perPlayer === 1 ? 'X' : x.perPlayer + 'X') : ''].filter(Boolean).join(' + ') || '0';
  const eraNames = catalogue.counts[0].eras.map(e => e.era);
  const totals = { different: 0, eras: eraNames.map(() => 0) };
  const countRows = catalogue.counts.map(c => {
    totals.different += c.different;
    c.eras.forEach((e, i) => totals.eras[i] += e.copies);
    return `<tr><td>${nice(c.kind)}</td><td>${c.different}</td>${c.eras.map(e => `<td>${e.copies}</td>`).join('')}<td>${per(c.deck)}</td></tr>`;
  }).join('');
  const countTable = `<h3>Number of cards</h3><table class="counts"><tr><th>Kind</th><th>Different cards</th>${eraNames.map(n => `<th>${esc(n)} list</th>`).join('')}<th>In each deck (X = players)</th></tr>
    ${countRows}<tr class="total"><td>Total</td><td>${totals.different}</td>${totals.eras.map(n => `<td>${n}</td>`).join('')}<td>${per({ base: catalogue.counts.reduce((a, c) => a + (c.deck ? c.deck.base : 0), 0), perPlayer: catalogue.counts.reduce((a, c) => a + (c.deck ? c.deck.perPlayer : 0), 0) })}</td></tr></table>
    <p class="muted small">"List" is how many cards each era's list holds (copies counted); every deck draws its set number of each kind from that list. Lands (${catalogue.lands.length}) are a separate deck.</p>`;
  box.innerHTML = `<div class="row"><h2 style="margin:0">All cards</h2><button data-close style="margin-left:auto">Close</button></div>
    ${countTable}
    ${types.map(t => group(t === 'leader' ? 'Great people' : t.charAt(0).toUpperCase() + t.slice(1).replace('_', ' ') + ' cards', [t])).join('')}
    <h3>Lands (${catalogue.lands.length})</h3><div class="catalog">${catalogue.lands.map(l => item(l.name, l.special ? 'special land' : 'land', l.text)).join('')}</div>
    <h3>Great wonders (${catalogue.wonders.length})</h3><div class="catalog">${catalogue.wonders.map(w => item(w.name, w.era || '', w.text, w.art)).join('')}</div>`;
}
$('allCards').onclick = openAllCards;
$('cardsModal').onclick = e => { if (e.target === $('cardsModal') || e.target.closest('[data-close]')) $('cardsModal').hidden = true; };
