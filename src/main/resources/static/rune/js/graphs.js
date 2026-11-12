'use strict';
// Root and Rune: graphs, the dictionary table, the word and sentence windows. The files in js/ are loaded in order by index.html and share one scope.
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
  let h = `<table class="interlinear"><tr>${b.words.map(cell).join('')}</tr></table><p><span class="form">${esc(b.surface)}</span>${S.lang ? sayBtn(b.surface, S.lang.id) : ''}</p>`;
  const notes = b.words.flatMap(w => w.parts).filter(p => p.ok === false || p.note);
  if (b.gaps) h += `<p class="small gap">${b.gaps} word${b.gaps > 1 ? 's' : ''} could not be built:</p>`;
  if (notes.length) h += '<ul class="small">' + notes.map(p => `<li class="${p.ok === false ? 'gap' : 'muted'}"><code>${esc(p.input)}</code>: ${esc(p.reason || p.note)}</li>`).join('') + '</ul>';
  const derived = b.words.flatMap(w => w.parts).filter(p => p.derive);
  if (derived.length && canSuggest()) h += '<div class="row small">' + derived.map(p => `<button data-act="deriveSave" data-w="${p.derive.word_id}" data-l="${esc(p.derive.label)}" data-g="${esc(p.derive.gloss)}"
    title="Add it to the dictionary as a ${esc(p.derive.pos)} of its own, linked to the word it comes from; sentences then use it, and it can get its own forms, meanings and losses">Save “${esc(p.derive.gloss)}” (${esc(p.derive.pos)}) as a word</button>`).join(' ') + '</div>';
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
    : (canSuggest() ? `<button data-act="editWord" data-id="${w.id}">Edit</button> <button class="danger" data-act="delWord" data-id="${w.id}">✕</button>` : '');
  const lost = w.lost_year != null ? ` <span class="badge lostbadge" title="No longer used in ${esc(S.lang.name)} from ${w.lost_year}">lost ${w.lost_year}</span>` : '';
  return `<tr class="${w.inherited ? 'inherited' : ''}${w.lost_year != null ? ' lostword' : ''}"><td class="muted small">${w.id}</td><td><a data-act="openWord" data-id="${w.id}" style="cursor:pointer"><strong>${esc(w.gloss)}</strong></a>${inh}${lost}${w.meaning_changed ? `<div class="small muted">means: ${esc(w.meaning)}</div>` : ''}${w.loan_from ? `<div class="small muted">borrowed from <strong>${esc(w.loan_from)}</strong></div>` : ''}${w.ref_to ? `<div class="small muted">→ same as <strong>${esc(w.ref_gloss)}</strong> (#${w.ref_to})</div>` : ''}${(w.problems || []).map(p => `<div class="small gap">⚠ ${esc(p)}</div>`).join('')}</td><td>${esc(w.pos)}</td><td>${esc(w.build)}</td><td>${w.year}</td>
    <td class="form">${esc(w.form)}</td><td>${d ? lines(d.latest) : '<span class="muted">—</span>'}${more ? ` <span class="badge">+${more}</span>` : ''}</td>
    <td>${w.length}</td><td>${esc(w.pronunciation)}${sayBtn((w.latest || {})[S.lang.name] || w.form, S.lang.id)}</td><td>${esc((w.exists_in || []).join(', '))}</td>
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
  `<tr class="${x.source === 'ERROR' ? 'pending' : ''}"><td>${esc(x.lang)}</td><td>${x.year}</td><td class="form">${esc(x.form)}${sayBtn(x.form, x.lang_id)}</td><td class="small">${esc(x.source.toLowerCase())}${x.rule ? ': ' + esc(x.rule) : ''}</td></tr>`).join('') + '</table>';

function typeSection(r, w) {
  const why = [];
  if (r.derived) why.push(`Made from <strong>${esc(r.derived.gloss || 'a deleted word')}</strong>${r.derived.pos && r.derived.gloss ? ' (' + esc(r.derived.pos) + ')' : ''} by the <strong>${esc(r.derived.label)}</strong> derivation, which sets the type to ${esc(w.pos)}.`);
  else why.push(`Set on the word itself when it was added or last edited.`);
  if (r.ref) why.push(`It is a cross-reference to <strong>${esc(r.ref.gloss)}</strong>: it takes that word's forms, but keeps its own type (${esc(w.pos)}) in sentences.`);
  const ms = (r.meanings || []).filter(m => m.pos);
  if (ms.length) why.push('Other types in particular meanings: ' + ms.map(m => `<strong>${esc(m.meaning)}</strong> as ${esc(m.pos)} (from ${m.year})`).join('; ') + '.');
  return `<div class="small" id="w_type"><h3>Type</h3><p><span class="badge">${esc(w.pos)}</span></p>${why.map(x => '<p class="small">' + x + '</p>').join('')}</div>`;
}

async function showWord() {
  const r = await api('GET', '/rune/api/words/' + S.openId + '/history');
  r.forms = r.forms || [];
  r.overrides = r.overrides || [];
  const w = r.word;
  S.openLang = w.language_id; S.openWordYear = w.year;
  const ownLang = (S.worlds || []).flatMap(x => x.languages || []).find(l => l.id === w.language_id);
  const ce = w.language_id === (S.lang && S.lang.id) ? canSuggest() : !!(ownLang && (ownLang.level >= 2 || (S.me && ownLang.can_suggest)));
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
  h += typeSection(r, w);
  h += `<details id="w_para" data-w="${w.id}"><summary><strong>All forms</strong> <span class="small muted">(endings stacked by group)</span></summary><div id="w_parabody" class="small muted">Opening…</div></details>`;
  h += `<h3>Meaning ${ce ? '<button data-act="toggleMeaning">Change meaning</button>' : ''}</h3>`;
  h += '<table><tr><th>Language</th><th>Meaning now</th></tr>' + Object.entries(r.meaning_by_lang || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('') + '</table>';
  if ((r.meanings || []).length) h += '<div class="small">' + r.meanings.map(m => `<div>${esc((langs.find(l => l[0] === m.lang_id) || [0, '?'])[1])} from ${m.year}: ${m.mode === 'CHANGE' ? 'changes to' : 'also means'} <strong>${esc(m.meaning)}</strong>${m.pos ? ` <span class="badge" title="The word's type in this meaning">${esc(m.pos)}</span>` : ''} ${ce ? `<button class="danger" data-act="delMeaning" data-id="${m.id}">✕</button>` : ''}</div>`).join('') + '</div>';
  if (ce) h += `<div id="mform" class="row" hidden><select id="m_lang">${langs.map(l => `<option value="${l[0]}">${esc(l[1])}</option>`).join('')}</select>
    <input id="m_year" type="number" placeholder="from year" size="8"><select id="m_mode"><option value="ADD">also means</option><option value="CHANGE">changes meaning to</option></select>
    <input id="m_text" placeholder="meaning"><input id="m_pos" list="m_poslist" placeholder="as type (optional)" size="14" title="The word's type in this meaning, if it differs: holy also means seal, as a noun. Sentences that use the word in this meaning use that type's endings."><datalist id="m_poslist">${[...new Set((S.words || []).map(x => x.pos).filter(Boolean))].map(p => `<option value="${esc(p)}">`).join('')}</datalist><button class="primary" data-act="addMeaning" data-w="${w.id}">Save</button>
    <p class="muted small">Applies to the chosen language and every branch that splits off after that year. “Changes to” replaces all earlier meanings. A type is optional: give one when the word behaves differently in this meaning (an adjective used as a noun); sentences that use the word in this meaning then get that type's endings.</p></div>`;
  h += `<h3>Lost ${ce ? '<button data-act="toggleLoss">Mark as lost</button>' : ''}</h3>`;
  h += (r.losses || []).length ? '<div class="small">' + r.losses.map(x => `<div>No longer used in <strong>${esc(x.lang_name)}</strong> from <strong>${x.year}</strong>${x.note ? ' · ' + esc(x.note) : ''} ${ce ? `<button class="danger" data-act="delLoss" data-id="${x.id}">✕</button>` : ''}</div>`).join('') + '</div>'
    : '<p class="small muted">In use (not marked lost anywhere).</p>';
  if (ce) h += `<div id="lform" class="row" hidden><select id="lo_lang">${langs.map(l => `<option value="${l[0]}">${esc(l[1])}</option>`).join('')}</select>
    <input id="lo_year" type="number" placeholder="lost in year" size="10"><input id="lo_note" placeholder="note (optional), e.g. replaced by …" size="28">
    <button class="primary" data-act="addLoss" data-w="${w.id}">Mark as lost</button>
    <p class="muted small">From that year the word is no longer used in the chosen language: sentences built for later years can't use it, it shows as lost in the dictionary,
    and branches that split off after that year never get it. Branches that split off earlier keep it (mark it lost there too if they lose it).</p></div>`;
  h += '<h3>In other languages</h3><div id="w_etym" class="small muted">Looking…</div>';
  h += '<h3>Full history</h3><details open><summary>word</summary>' + histTable(r.history) + '</details>';
  for (const f of r.forms) h += `<details><summary>${esc(f.label)}</summary>${histTable(f.history)}</details>`;
  if (r.overrides.length) h += '<h3>Locked overrides (word)</h3>' + r.overrides.map(o => `<div>${esc((langs.find(l => l[0] === o.lang_id) || [0, '?'])[1])} ${o.year}: <span class="form">${esc(o.form)}</span> ${ce ? `<button class="danger" data-act="delOverride" data-id="${o.id}">Unlock</button>` : ''}</div>`).join('');
  if (ce) h += `<h3>Lock a form of the word</h3><div class="row"><select id="o_lang">${langs.map(l => `<option value="${l[0]}">${esc(l[1])}</option>`).join('')}</select>
    <input id="o_year" type="number" placeholder="year"><input id="o_form" placeholder="form" class="form"><button data-act="addOverride" data-w="${w.id}">Lock</button></div>
    <p class="muted small">A locked form replaces the automatic one at that year; later sound changes continue from it.</p>`;
  let m = $('#modal');
  if (!m) { m = document.createElement('div'); m.id = 'modal'; m.className = 'modal'; document.body.appendChild(m); }
  m.innerHTML = '<div class="modalbox">' + h + '</div>'; m.hidden = false;
  wordElsewhere(w).catch(() => { const e = $('#w_etym'); if (e) e.textContent = 'Could not look it up.'; });
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
