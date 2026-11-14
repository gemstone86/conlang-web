'use strict';
// Root and Rune: what the buttons do (A.*) and page-wide event handlers. The files in js/ are loaded in order by index.html and share one scope.
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
  missRoot: async (d, el) => {
    const tr = el.closest('tr'), next = tr.nextElementSibling;
    const open = next && next.classList.contains('rootrow') && next.dataset.g === d.g;
    document.querySelectorAll('tr.rootrow').forEach(x => x.remove());
    if (open) return;
    const row = document.createElement('tr');
    row.className = 'rootrow'; row.dataset.g = d.g; row.dataset.p = d.p || '';
    const year = S.rootYear ?? (S.lang.split_year ?? '');
    row.innerHTML = `<td colspan="${tr.children.length}"><div class="row"><strong>Roots for “${esc(d.g)}”</strong>
      <select data-rr="syl"><option value="1-1">1 syllable</option><option value="2-2" selected>2 syllables</option><option value="2-3">2-3 syllables</option><option value="3-4">3-4 syllables</option></select>
      <input data-rr="year" type="number" placeholder="year coined" size="10" value="${esc(year)}" title="The year the word is coined">
      <button data-act="missRootMore">Other suggestions</button>
      <span class="muted small">Click a root to add it as the word${d.p ? ' (' + esc(d.p) + ')' : ''}.</span></div><div class="row" data-rr="out"></div></td>`;
    tr.after(row);
    await fillRoots(row);
  },
  missRootMore: async (d, el) => fillRoots(el.closest('tr.rootrow')),
  missRootUse: async (d, el) => {
    const row = el.closest('tr.rootrow'), yearBox = row.querySelector('[data-rr=year]');
    if (yearBox.value === '') { say('Give the year the word is coined.', true); yearBox.focus(); return; }
    S.rootYear = Number(yearBox.value);
    const payload = { gloss: row.dataset.g, form: d.form, year: S.rootYear, build: 'root' };
    if (row.dataset.p) payload.pos = row.dataset.p;
    const r = await api('POST', base() + '/edit', { entity: 'word', action: 'CREATE', payload });
    S.words = [];
    say(r.status === 'pending' ? 'Submitted for approval: ' + row.dataset.g + ' = ' + d.form + '.' : 'Added: ' + row.dataset.g + ' = ' + d.form + '.');
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

  saveSpelling: async () => {
    await api('PUT', base(), { spellingYears: val('gr_spell') });
    say('Spelling reforms saved.'); await loadWorlds(); renderPanel();
  },
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
    S.ruleImport = { rules, removeMissing: $('#ri_rm').checked, tag: val('ri_tag').trim() };
    const res = await api('POST', base() + '/rules/import', { ...S.ruleImport, dryRun: true });
    const act = { add: 'add', change: 'change', remove: 'remove', same: 'same', skip: 'skip' };
    let h = `<p><strong>${res.added}</strong> to add, <strong>${res.changed}</strong> to change, <strong>${res.removed}</strong> to remove, ${res.unchanged} unchanged.${res.tagAll ? ` Every sound change in the file gets the tag <strong>${esc(res.tagAll)}</strong> (unchanged ones have it already).` : ''}</p>`;
    if (res.errors.length) h += '<div class="gap"><strong>Nothing will be imported until these are fixed:</strong><ul>' + res.errors.map(e => `<li>${esc(e)}</li>`).join('') + '</ul></div>';
    const shown = res.items.filter(i => i.action !== 'same');
    if (shown.length) h += '<table><tr><th></th><th>Language</th><th>Year</th><th>Pattern</th><th>Replacement</th><th>Tags</th><th></th></tr>' +
      shown.map(i => `<tr class="${i.action === 'remove' ? 'pending' : ''}"><td>${act[i.action]}</td><td>${esc(i.language)}</td><td>${i.year ?? ''}</td><td class="form">${esc(i.pattern)}</td><td class="form">${esc(i.replacement)}</td><td class="small">${esc(i.tags || '')}</td><td class="small muted">${esc(i.detail)}</td></tr>`).join('') + '</table>';
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
    // a form given by the rules is not stored yet: the edit stores it (as one made by hand)
    const p = { word_id: S.openId, label: d.label, form: f.trim() };
    if (d.year) p.year = Number(d.year);
    const r = d.id ? await api('POST', wbase() + '/edit', { entity: 'form', action: 'UPDATE', entityId: Number(d.id), payload: { form: f.trim() } })
      : await api('POST', wbase() + '/edit', { entity: 'form', action: 'CREATE', payload: p });
    say(r.status === 'pending' ? 'Submitted for the owner to approve.' : 'Saved.'); await afterWordChange();
  },
  levelForm: async d => {
    let year = null;
    if (!d.off) {
      const y = prompt('Level out the "' + d.label + '" form from which year?\nFrom then on it is what its rule gives then (the word as it is then, with the ending as it is then).');
      if (y == null || y.trim() === '' || !Number.isFinite(Number(y))) return;
      year = Number(y);
    }
    await api('POST', wbase() + '/forms/level', { word_id: S.openId, label: d.label, year });
    say(year == null ? 'Levelling taken away.' : 'Levelled out from ' + year + '.'); await afterWordChange();
  },
  storeIrregular: async () => {
    const r = await api('POST', base() + '/forms/generate', {});
    say(formsDone(r)); renderPanel();
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
      hiatus: $('#fr_hiatus').checked ? 1 : 0, year: val('fr_year'), ord: Number(val('fr_ord') || 0), new_pos: $('#fr_derive').checked ? val('fr_newpos').trim() || null : null, new_gloss: $('#fr_derive').checked ? val('fr_newgloss').trim() || null : null };
    if ($('#fr_derive').checked && !p.new_pos) { say('Give the type of the new word (e.g. verb), or untick "Makes a new word".', true); return; }
    const r = await api('POST', base() + '/edit', { entity: 'formrule', action: id ? 'UPDATE' : 'CREATE', entityId: id ? Number(id) : null, payload: p });
    S.prefill = null;
    say(r.status === 'pending' ? 'Submitted for the owner to approve.' : 'Saved. New words will use it; owners can add it to existing words with the button below.'); renderPanel();
  },
  editFormRule: async d => {
    const r = S.formrules.find(x => x.id === Number(d.id));
    for (const [k, v] of [['grp', r.grp], ['label', r.label], ['pos', r.pos], ['place', r.placement], ['affix', r.affix], ['link', r.affix_gloss], ['cond', r.cond_re], ['year', r.year], ['ord', r.ord], ['newpos', r.new_pos], ['newgloss', r.new_gloss]]) $('#fr_' + k).value = v ?? '';
    $('#fr_hiatus').checked = !!r.hiatus; $('#fr_derive').checked = !!r.new_pos; $('#fr_derivebox').hidden = !r.new_pos; $('#fr_id').value = r.id; $('#fr_btn').textContent = 'Save changes'; $('#fr_cancel').hidden = false; window.scrollTo(0, 0);
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
  excelDict: async () => {
    const d = await excelUpload('/rune/api/admin/import-elven');
    const per = Object.entries(d.perGroup || {}).map(([g, n]) => (g === '(none)' ? S.lang.name : g) + ': ' + n);
    const groups = per.length > 1 ? per.join(', ') : '';
    say('Imported ' + d.imported + ' words' + (groups ? ' (' + groups + ')' : '') + '.' + (d.alreadyThere ? ' ' + d.alreadyThere + ' were there already.' : '')
      + (d.skippedCount ? ' ' + d.skippedCount + ' rows skipped.' : ''));
    $('#gx_out').innerHTML = d.skippedCount ? '<p class="small"><strong>Skipped rows</strong>' + (d.skippedCount > d.skipped.length ? ' (first ' + d.skipped.length + ')' : '') + ':</p><ul class="small">'
      + d.skipped.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>' : '';
    S.words = []; await loadWorlds();
  },
  excelGrammar: async () => {
    let d;
    try { d = await excelUpload('/rune/api/admin/import-grammar', { replace: $('#gx_replace').checked ? 'true' : 'false' }); }
    catch (e) {
      if (!/already has grammar/.test(e.message) || !confirm(S.lang.name + ' already has grammar or sounds. Replace them with the ones in the file?')) throw e;
      d = await excelUpload('/rune/api/admin/import-grammar', { replace: 'true' });
    }
    say('Imported ' + d.sections + ' sections, ' + d.rows + ' rows and ' + d.sounds + ' sounds.');
    await renderPanel();
  },
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
      r.changes.map(c => `<tr><td>${esc(c.gloss)}</td><td>${esc(c.branch)}</td><td class="form">${esc(c.before)}</td><td class="form">${esc(c.after)}</td></tr>`).join('') + '</table>' : '')
      + ((r.collisions || []).length ? `<p><strong>${r.collisions.length}</strong> group${r.collisions.length === 1 ? '' : 's'} of words would come to sound the same (they don't now):</p><table><tr><th>Branch</th><th>Would both be</th><th>Words (as they are now)</th></tr>` +
        r.collisions.map(c => `<tr><td>${esc(c.branch)}</td><td class="form">${esc(c.form)}</td><td>${c.words.map(esc).join(', ')}</td></tr>`).join('') + '</table>' : '<p class="muted small">No words would come to sound the same.</p>');
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
  toggleLoss: async () => { const f = $('#lform'); if (f) f.hidden = !f.hidden; },
  addLoss: async d => {
    if (val('lo_year') === '') { say('Give the year the word was lost.', true); return; }
    const r = await api('POST', wbase() + '/edit', { entity: 'loss', action: 'CREATE', payload: { word_id: Number(d.w), lang_id: Number(val('lo_lang')), year: Number(val('lo_year')), note: val('lo_note') } });
    say(r.status === 'pending' ? 'Submitted for approval.' : 'Marked as lost.'); await afterWordChange();
  },
  delLoss: async d => { const r = await api('POST', wbase() + '/edit', { entity: 'loss', action: 'DELETE', entityId: Number(d.id) }); say(r.status === 'pending' ? 'Submitted for approval.' : 'In use again.'); await afterWordChange(); },
  toggleMeaning: async () => { const f = $('#mform'); if (f) f.hidden = !f.hidden; },
  addMeaning: async d => {
    if (!val('m_year') || !val('m_text')) { say('Give a year and a meaning.', true); return; }
    const r = await api('POST', wbase() + '/edit', { entity: 'meaning', action: 'CREATE', payload: { word_id: Number(d.w), lang_id: Number(val('m_lang')), year: Number(val('m_year')), mode: val('m_mode'), meaning: val('m_text'), pos: val('m_pos').trim() || null } });
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
      classes: val('g_classes'), erosion: val('g_erosion'), erosionTarget: Number(val('g_target') || 0), ipaMap: val('g_ipa'), grammar: val('g_grammar'),
      speechVoice: val('g_voice'), speechStress: val('g_stress'), speechSpeed: val('g_speed') === '' ? null : Number(val('g_speed')) });
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
