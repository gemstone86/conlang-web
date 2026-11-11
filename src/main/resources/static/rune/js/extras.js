'use strict';
// Root and Rune: Check, Etymology and Texts tabs. The files in js/ are loaded in order by index.html and share one scope.
// ---------- Check, Etymology, Texts ----------
const ORIGIN = { own: 'own word', inherited: 'inherited', borrowed: 'borrowed' };
function familyTree(langs, cell) {
  const ids = new Set(langs.map(l => l.id));
  const walk = parent => {
    const kids = langs.filter(l => (parent == null ? !l.parent_id || !ids.has(l.parent_id) : l.parent_id === parent));
    return kids.length ? '<ul class="etree">' + kids.map(l => '<li>' + cell(l) + walk(l.id) + '</li>').join('') + '</ul>' : '';
  };
  return walk(null);
}
function etymWord(l, w) {
  const how = w.origin === 'inherited' ? `inherited from ${esc(w.from || '?')}${w.from_form ? ` <span class="form">${esc(w.from_form)}</span>` : ''}`
    : w.origin === 'borrowed' ? `borrowed from ${esc(w.from || '?')}` : `own word, coined ${w.coined ?? '?'}`;
  return `<span class="chip${w.lost_year != null ? ' lost' : ''}"><a data-act="goOrigin" data-lang="${l.id}" data-id="${w.id}" class="form" title="Open the word">${esc(w.form)}</a>${sayBtn(w.form, l.id)}
    <span class="small muted">${esc(w.gloss)} · ${how}${w.lost_year != null ? ` · <span class="gap">lost ${w.lost_year}</span>` : ''}${w.note ? ' · ' + esc(w.note) : ''}</span></span>`;
}
const ETYM_STATUS = { has: '', none: '<span class="badge">no word</span>', lost: '<span class="badge lostb">lost</span>' };
async function wordElsewhere(w) {
  const r = await api('GET', '/rune/api/languages/' + w.language_id + '/etymology?meaning=' + encodeURIComponent(w.gloss));
  const e = $('#w_etym'); if (!e) return;
  e.className = 'small';
  e.innerHTML = r.languages.length > 1 || r.found > 1
    ? familyTree(r.languages, l => `<strong>${esc(l.name)}</strong> ${ETYM_STATUS[l.status]} ` + l.words.map(x => etymWord(l, x)).join(' '))
      + `<p class="muted">Every language in the world with a word meaning “${esc(r.meaning)}”. More on the Etymology tab.</p>`
    : '<span class="muted">No other language in this world has a word for “' + esc(r.meaning) + '”.</span>';
}

Object.assign(TAB, {
  async check() {
    const r = await api('GET', base() + '/check');
    let h = `<p class="muted small">Likely mistakes and loose ends in ${esc(r.language)} (${r.words} words). Nothing here is necessarily wrong; it is a list to look through.
      <button data-act="tab" data-t="check">Check again</button></p>
      <p><strong>${r.total ? r.total + ' thing' + (r.total === 1 ? '' : 's') + ' to look at' : 'Nothing found. All clear.'}</strong></p>`;
    for (const c of r.checks) {
      h += `<details class="card checkbox" ${c.count ? 'open' : ''}><summary><strong>${esc(c.title)}</strong> <span class="badge ${c.count ? 'warnb' : ''}">${c.count}</span></summary>
        <p class="muted small">${esc(c.help)}</p>` +
        (c.items.length ? '<ul class="small">' + c.items.map(i => `<li>${esc(i.text)}${i.word_id ? ` <a data-act="openWord" data-id="${i.word_id}" style="cursor:pointer">open</a>` : ''}</li>`).join('') + '</ul>'
          + (c.count > c.items.length ? `<p class="small muted">…and ${c.count - c.items.length} more.</p>` : '') : '') + '</details>';
    }
    return h;
  },
  async etymology() {
    let mean = [];
    try { mean = await api('GET', base() + '/etymology/meanings'); } catch (e) { /* the suggestions are optional */ }
    let h = `<p class="muted small">Pick a meaning to see the word for it in every language of the world: its form today, and whether it is the language's own, inherited, borrowed or lost.</p>
      <div class="row"><input id="et_q" list="et_list" placeholder="meaning, e.g. water" size="28" value="${esc(S.etym || '')}"><datalist id="et_list">${mean.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
      <button class="primary" data-act="etymGo">Show</button></div><div id="et_out"></div>`;
    return h;
  },
  async texts() {
    const list = await api('GET', base() + '/texts');
    S.textList = list;
    let h = `<p class="muted small">Longer texts (a story, a prayer, a proverb list) kept as lines and built at several years side by side, so you can watch the language change.
      Each line is written like a sentence on the Sentences tab.</p>`;
    h += list.length ? '<table><tr><th>Title</th><th>Years</th><th>Lines</th><th>Notes</th><th></th></tr>' + list.map(t => `<tr class="${t.inherited ? 'inherited' : ''}"><td><a data-act="textOpen" data-id="${t.id}" style="cursor:pointer"><strong>${esc(t.title)}</strong></a>
      ${t.inherited ? ` <span class="badge" title="Written in ${esc(t.from_lang)}; opened here it is built in ${esc(S.lang.name)}">from ${esc(t.from_lang)}</span>` : t.inherit ? ' <span class="badge" title="Branches of this language have it too">inherited by branches</span>' : ''}</td>
      <td>${esc(t.years || '')}</td><td>${t.lines}</td><td class="small">${esc(t.notes || '')}</td>
      <td><button data-act="textOpen" data-id="${t.id}">Open</button>${t.inherited ? ` <button data-act="textGoOwn" data-id="${t.id}" data-l="${t.language_id}" title="Edit it in the language it belongs to">Open in ${esc(t.from_lang)}</button>`
        : canEdit() ? ` <button data-act="textEdit" data-id="${t.id}">Edit</button> <button class="danger" data-act="textDel" data-id="${t.id}" data-n="${esc(t.title)}">✕</button>` : ''}</td></tr>`).join('') + '</table>'
      : '<p class="muted">No texts yet.</p>';
    if (canEdit()) h += '<div class="row"><button data-act="textNew">+ New text</button></div>';
    h += '<div id="tx_edit"></div><div id="tx_out"></div>';
    return h;
  }
});
Object.assign(AFTER, {
  etymology: () => { if (S.etym) A.etymGo().catch(e => say(e.message, true)); },
  texts: () => { if (S.textOpen && (S.textList || []).some(t => t.id === S.textOpen)) A.textOpen({ id: S.textOpen }).catch(e => say(e.message, true)); }
});
function textForm(t) {
  t = t || { title: '', years: '', body: '', notes: '', inherit: false };
  const moveTo = t.id ? allLangs().filter(l => l.world_id === S.lang.world_id && l.id !== S.lang.id && l.level >= 2) : [];
  $('#tx_edit').innerHTML = `<div class="card"><h3>${t.id ? 'Edit text' : 'New text'}</h3>
    <div class="row"><input id="tx_title" placeholder="title" size="30" value="${esc(t.title)}"><input id="tx_years" placeholder="years, e.g. 0, 500, 1000" size="24" value="${esc(t.saved_years ?? t.years ?? '')}" title="Up to 6 years, comma separated"></div>
    <textarea id="tx_body" rows="10" style="width:100%" placeholder="One line per sentence: source | English translation&#10;e.g. (man-definite)(to see-past)(dog) | The man saw a dog">${esc(t.body || '')}</textarea>
    <div class="row"><input id="tx_notes" placeholder="notes" size="40" value="${esc(t.notes || '')}"><input id="tx_id" type="hidden" value="${t.id || ''}">
    <button class="primary" data-act="textSave">Save</button><button data-act="textCancel">Cancel</button></div>
    <label style="display:inline;margin:0" title="Every branch of ${esc(S.lang.name)} lists the text too, built with that branch's own words and sound changes"><input type="checkbox" id="tx_inherit" ${t.inherit ? 'checked' : ''}> Branches inherit it</label>
    <p class="muted small">Write each line the way you write a sentence on the Sentences tab (meanings, word forms and so on); after a | comes the translation.</p>
    ${moveTo.length ? `<div class="row"><select id="tx_move"><option value="">Move to another language…</option>${moveTo.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
      <button data-act="textMove" data-id="${t.id}">Move</button><span class="small muted">Moves the text with its lines, years and notes; unsaved changes above are saved first.</span></div>` : ''}</div>`;
  $('#tx_edit').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#tx_title').focus({ preventScroll: true });
}
function textView(r) {
  const ys = r.years;
  const own = r.language_id === S.lang.id;
  let h = `<div class="card"><h3>${esc(r.title)} ${own && canEdit() ? `<button data-act="textEdit" data-id="${r.id}">Edit</button>` : ''}</h3>
    ${own ? '' : `<p class="small card pending">Inherited from <strong>${esc(r.from_lang)}</strong>, built here in <strong>${esc(r.built_in)}</strong> with its own words and sound changes. To change the text, <a data-act="textGoOwn" data-id="${r.id}" data-l="${r.language_id}" style="cursor:pointer">open it in ${esc(r.from_lang)}</a>.</p>`}
    ${r.notes ? `<p class="small muted">${esc(r.notes)}</p>` : ''}
    <div class="row"><input id="tx_show" placeholder="show at other years, e.g. 200, 900" size="28" value="${esc(S.textYears || '')}"><button data-act="textYears" data-id="${r.id}">Show</button>
    ${S.textYears ? `<button data-act="textYearsReset" data-id="${r.id}">Back to the saved years</button>` : ''}</div>`;
  if (!ys.length) return h + '<p class="muted">Give the text one or more years (Edit), or type years above.</p></div>';
  h += `<table class="texttable"><tr><th>Line</th>${ys.map(y => `<th>${y}${r.gaps[y] ? ` <span class="badge warnb" title="Words or forms missing at this year">${r.gaps[y]} gap${r.gaps[y] === 1 ? '' : 's'}</span>` : ''}</th>`).join('')}</tr>`;
  for (const l of r.lines) {
    if (!l.source) { h += `<tr><td colspan="${ys.length + 1}">&nbsp;</td></tr>`; continue; }
    h += `<tr><td class="small">${esc(l.translation || l.source)}${l.translation ? `<div class="muted">${esc(l.source)}</div>` : ''}</td>` +
      ys.map(y => { const c = l.at[y] || {}; return `<td class="${c.gaps ? 'pending' : ''}" title="${esc((c.missing || []).join('\n'))}"><span class="form">${esc(c.surface || '')}</span>${sayBtn(c.surface, S.lang.id)}${c.gaps ? `<div class="small gap">${esc((c.missing || []).join('; '))}</div>` : ''}</td>`; }).join('') + '</tr>';
  }
  return h + '</table></div>';
}
Object.assign(A, {
  etymGo: async () => {
    S.etym = val('et_q').trim();
    const out = $('#et_out'); if (!out) return;
    if (!S.etym) { out.innerHTML = ''; return; }
    const r = await api('GET', base() + '/etymology?meaning=' + encodeURIComponent(S.etym));
    out.innerHTML = `<p><strong>“${esc(r.meaning)}”</strong>: ${r.found} word${r.found === 1 ? '' : 's'} across ${r.languages.length} language${r.languages.length === 1 ? '' : 's'}.</p>` +
      familyTree(r.languages, l => `<strong>${esc(l.name)}</strong>${l.split_year != null ? ` <span class="small muted">(splits ${l.split_year})</span>` : ''} ${ETYM_STATUS[l.status]}<div>${l.words.map(x => etymWord(l, x)).join('')}</div>`);
  },
  textNew: async () => textForm(null),
  textCancel: async () => { $('#tx_edit').innerHTML = ''; },
  textEdit: async d => { const r = await api('GET', '/rune/api/texts/' + d.id); textForm(r); },
  textSave: async () => {
    const r = await api('POST', base() + '/texts', { id: val('tx_id'), title: val('tx_title'), years: val('tx_years'), body: val('tx_body'), notes: val('tx_notes'), inherit: $('#tx_inherit').checked });
    S.textOpen = r.id; S.textYears = ''; say('Saved.'); renderPanel();
  },
  textDel: async d => { if (!confirm('Delete the text “' + d.n + '”?')) return; await api('DELETE', '/rune/api/texts/' + d.id); if (S.textOpen === Number(d.id)) S.textOpen = null; renderPanel(); },
  textOpen: async d => {
    if (S.textOpen !== Number(d.id)) S.textYears = '';
    S.textOpen = Number(d.id);
    const out = $('#tx_out'); if (out) out.innerHTML = '<p class="muted">Building…</p>';
    const r = await api('GET', '/rune/api/texts/' + d.id + '?lang=' + S.lang.id + (S.textYears ? '&years=' + encodeURIComponent(S.textYears) : ''));
    if ($('#tx_out')) $('#tx_out').innerHTML = textView(r);
  },
  textYears: async d => { S.textYears = val('tx_show').trim(); await A.textOpen(d); },
  textMove: async d => {
    const to = Number(val('tx_move')); if (!to) { say('Choose the language to move it to.', true); return; }
    const target = langById(to);
    if (!confirm('Move the text “' + val('tx_title') + '” to ' + (target ? target.name : 'that language') + '?')) return;
    await api('POST', base() + '/texts', { id: d.id, title: val('tx_title'), years: val('tx_years'), body: val('tx_body'), notes: val('tx_notes'), inherit: $('#tx_inherit').checked });
    await api('POST', '/rune/api/texts/' + d.id + '/move', { language_id: to });
    S.lang = target || S.lang; S.textOpen = Number(d.id); S.textYears = ''; S.tab = 'texts';
    say('Moved to ' + (target ? target.name : 'the other language') + '.'); render();
  },
  textGoOwn: async d => {
    const l = langById(d.l); if (!l) { say('You can\'t open that language.', true); return; }
    S.lang = l; S.tab = 'texts'; S.textOpen = Number(d.id); S.textYears = ''; render();
  },
  textYearsReset: async d => { S.textYears = ''; await A.textOpen(d); }
});
