'use strict';
// Root and Rune: stacked endings, All forms, derived words. The files in js/ are loaded in order by index.html and share one scope.
// ---------- stacked endings (plural-definite) ----------
async function stackOrderCard() {
  let g;
  try { g = await api('GET', base() + '/form-groups'); } catch (e) { return ''; }
  S.stackGroups = g.groups.map(x => x.name);
  const ce = canEdit();
  let h = `<div class="card"><h3>Ending order when stacked</h3>
    <p class="muted small">In a sentence, <code>(elf-plural-definite)</code> puts several endings on one word: one from each group, in the order below
    (the first is closest to the word), whatever order you write them in. Each ending is chosen by its rules as usual (type, condition, year),
    looking at the word as it is so far. If the word has a stored form for the first ending (an irregular plural, say), the rest go on top of that.
    A form stored under the full name (e.g. <em>definite plural</em>) still wins.</p>`;
  if (!g.groups.length) return h + '<p class="small">No groups yet: give form rules a group (e.g. <em>number</em>, <em>case</em>, <em>definiteness</em>) to stack them.</p></div>';
  h += '<ol id="sg_list">' + g.groups.map((x, i) => `<li><strong>${esc(x.name)}</strong> <span class="small muted">${x.rules} rule${x.rules === 1 ? '' : 's'}</span>
    ${ce ? `<button data-act="sgMove" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} title="Closer to the word">↑</button><button data-act="sgMove" data-i="${i}" data-d="1" ${i === g.groups.length - 1 ? 'disabled' : ''} title="Further from the word">↓</button>` : ''}</li>`).join('') + '</ol>';
  h += `<p class="small muted">${g.own ? 'This language sets its own order.' : g.from ? 'Order from ' + esc(g.from) + '.' : 'Not set yet: groups go in the order they first appear in the table below.'}</p>`;
  if (ce) h += `<div class="row"><button class="primary" data-act="sgSave" id="sg_save" disabled>Save order</button>${g.own && S.lang.parent_id ? '<button data-act="sgReset">Use the parent\'s order</button>' : ''}</div>`;
  return h + '</div>';
}
async function drawParadigm(wordId) {
  const box = $('#w_parabody'); if (!box) return;
  const langId = (S.lang && S.words.some(x => x.id === wordId)) ? S.lang.id : S.openLang;
  const y = S.paraYear ? '?year=' + encodeURIComponent(S.paraYear) : '';
  const r = await api('GET', '/rune/api/languages/' + langId + '/words/' + wordId + '/paradigm' + y);
  if (!r.groups.length) { box.innerHTML = 'No form rules apply to this word type' + (r.word.pos ? ' (' + esc(r.word.pos) + ')' : '') + '.'; return; }
  const cols = r.groups.map(g => g.name || g.labels[0]);
  let h = `<div class="row"><input id="w_parayear" type="number" placeholder="year (blank = latest)" size="14" value="${esc(S.paraYear || '')}"><button data-act="paraYear" data-w="${wordId}">Show at year</button>
    <span class="small muted">Written in a sentence as <code>(${esc(r.word.gloss)}-…)</code>, e.g. <code>(${esc(r.word.gloss)}-${esc(r.groups.map(g => g.labels[0]).slice(0, 2).join('-'))})</code></span></div>`;
  h += '<table class="paradigm"><tr>' + cols.map(c => `<th>${esc(c)}</th>`).join('') + '<th>Form</th></tr>';
  for (const row of r.rows) {
    const cells = r.groups.map(g => { const l = row.labels.find(x => g.labels.some(y => y.toLowerCase() === x.toLowerCase())); return `<td>${l ? esc(l) : '<span class="muted">–</span>'}</td>`; }).join('');
    h += `<tr class="${row.reason ? 'pending' : ''}">${cells}<td>${row.form ? `<span class="form">${esc(row.form)}</span>${sayBtn(row.form, langId)}` : ''}${row.reason ? `<div class="gap small">${esc(row.reason)}</div>` : ''}${row.from_stored ? `<div class="small muted">on the stored ${esc(row.from_stored)} form</div>` : ''}</td></tr>`;
  }
  h += '</table>';
  if ((r.derived || []).length) {
    h += '<h4>Derived words</h4><table><tr><th>Derivation</th><th>New word</th><th>Form</th><th></th></tr>' + r.derived.map(d => `<tr class="${d.reason ? 'pending' : ''}"><td>${esc(d.label)}</td>
      <td>${esc(d.gloss)} <span class="badge">${esc(d.pos)}</span></td>
      <td>${d.form ? `<span class="form">${esc(d.form)}</span>${sayBtn(d.form, langId)}` : ''}${d.reason ? `<div class="gap small">${esc(d.reason)}</div>` : ''}</td>
      <td>${d.saved_id ? `saved as <a data-act="openWord" data-id="${d.saved_id}" style="cursor:pointer">${esc(d.saved_gloss)} #${d.saved_id}</a>`
        : canSuggest() && d.form ? `<button data-act="deriveSave" data-w="${wordId}" data-l="${esc(d.label)}" data-g="${esc(d.gloss)}" data-lang="${langId}">Save as a word</button>` : ''}</td></tr>`).join('') + '</table>'
      + `<p class="muted small">In a sentence: <code>(${esc(r.word.gloss)}-${esc(r.derived[0].label)})</code>, with its endings after it. Saving one adds it to the dictionary, so it can get its own forms, meanings and losses.</p>`;
  }
  box.className = 'small';
  box.innerHTML = h;
}
document.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.frderive) { $('#fr_derivebox').hidden = !e.target.checked; if (e.target.checked) $('#fr_newpos').focus(); } });
document.addEventListener('toggle', e => {
  if (e.target.id === 'w_para' && e.target.open) drawParadigm(Number(e.target.dataset.w)).catch(err => { const b = $('#w_parabody'); if (b) b.textContent = err.message; });
}, true);
Object.assign(A, {
  sgMove: async d => {
    const i = Number(d.i), j = i + Number(d.d), g = S.stackGroups;
    if (j < 0 || j >= g.length) return;
    [g[i], g[j]] = [g[j], g[i]];
    const ol = $('#sg_list'), items = [...ol.children];
    ol.insertBefore(items[Math.max(i, j)], items[Math.min(i, j)]);
    [...ol.children].forEach((li, k) => li.querySelectorAll('button').forEach(b => { b.dataset.i = k; b.disabled = (b.dataset.d === '-1' && k === 0) || (b.dataset.d === '1' && k === g.length - 1); }));
    $('#sg_save').disabled = false;
  },
  sgSave: async () => { await api('PUT', base() + '/form-groups', { order: S.stackGroups }); say('Order saved.'); renderPanel(); },
  sgReset: async () => { await api('PUT', base() + '/form-groups', { order: [] }); say('Using the parent language\'s order.'); renderPanel(); },
  paraYear: async d => { S.paraYear = val('w_parayear').trim(); await drawParadigm(Number(d.w)); },
  deriveSave: async d => {
    const lang = Number(d.lang) || S.lang.id;
    const g = prompt('Meaning of the new word:', d.g);
    if (g === null) return;
    const r = await api('POST', '/rune/api/languages/' + lang + '/words/' + d.w + '/derive', { label: d.l, gloss: g.trim() || d.g });
    say(r.status === 'pending' ? 'Sent for approval: “' + r.gloss + '”.' : 'Saved “' + r.gloss + '” as a word (#' + r.id + ').');
    if ($('#w_parabody') && $('#w_para') && $('#w_para').open) await drawParadigm(Number($('#w_para').dataset.w));
    else if (S.tab === 'sentences' && $('#s_src')) await A.sentBuild();
    else if (S.tab === 'dict') await refreshDict();
  }
});
