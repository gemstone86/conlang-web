'use strict';
// Root and Rune: Excel import, sound-change tags and versions, missing-word helpers. The files in js/ are loaded in order by index.html and share one scope.
// ---------- import from Excel (admins, language owners) ----------
function excelImportCard() {
  if (!(S.me && S.me.is_admin && isOwner())) return '';
  return `<details class="card"><summary><strong>Import from Excel</strong> <span class="small muted">a language's dictionary, grammar and sounds from an .xlsx workbook (admins)</span></summary>
    <div class="row"><input type="file" id="gx_file" accept=".xlsx"></div>
    <div class="row"><button class="primary" data-act="excelDict">Import dictionary</button>
      <span class="small muted">Reads the sheet <strong>"Ygg Elven dict"</strong>: columns <em>dictionary</em> (meaning), <em>elven</em> (form), <em>build</em>, <em>year</em>,
      and optionally <em>type</em>, <em>notes</em> and <em>group</em> (a row whose group is the name of another language in this world goes to that language).
      Rows built as "shifted" or "indexed" are skipped (the sound changes make those). Words already here with the same meaning and form are skipped, so a file can be imported again.</span></div>
    <div class="row"><button class="primary" data-act="excelGrammar">Import grammar and sounds</button>
      <label style="display:inline;margin:0"><input type="checkbox" id="gx_replace"> replace the grammar and sounds this language already has</label>
      <span class="small muted">Reads the sheet <strong>"Ygg Elven"</strong> (grammar tables in columns A-G, and the consonant and vowel grids if it has them).</span></div>
    <div id="gx_out"></div></details>`;
}
async function excelUpload(url, extra) {
  const f = $('#gx_file') && $('#gx_file').files[0];
  if (!f) throw new Error('Choose an .xlsx file first.');
  const fd = new FormData(); fd.append('file', f); fd.append('languageId', S.lang.id);
  for (const [k, v] of Object.entries(extra || {})) fd.append(k, v);
  say('Importing ' + f.name + '…');
  const res = await fetch(url, { method: 'POST', body: fd });
  let d = null; try { d = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error((d && (d.error || d.message)) || 'Import failed (' + res.status + ')');
  return d;
}

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

// ---------- missing words: suggest a root ----------
async function fillRoots(row) {
  const [lo, hi] = row.querySelector('[data-rr=syl]').value.split('-');
  const out = row.querySelector('[data-rr=out]');
  out.innerHTML = '<span class="muted small">Finding roots…</span>';
  const r = await api('GET', base() + '/suggest-roots?count=8&min=' + lo + '&max=' + hi);
  const shape = r.shape ? `<span class="muted small">Shape ${esc(r.shape)}${r.mode === 'shape' ? ' (from the shape and the Sounds tab: too few words to learn from)' : ''}: </span>` : '';
  out.innerHTML = shape + (r.roots.length ? r.roots.map(x => `<button class="form" data-act="missRootUse" data-form="${esc(x)}" title="Add as the word for “${esc(row.dataset.g)}”">${esc(x)}</button>`).join(' ')
    : `<span class="muted small">${esc(r.reason || 'No free form was found. Try again or allow more syllables.')}</span>`);
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
document.addEventListener('change', wrap(async e => {
  const k = e.target.dataset && e.target.dataset.publish;
  if (!k || !S.lang) return;
  const r = await api('POST', base() + '/publish', { [k]: e.target.checked });
  S.lang.is_public = r.is_public; S.lang.public_suggestions = r.public_suggestions;
  say(r.is_public ? (r.public_suggestions ? 'Public, and anyone logged in can suggest changes.' : 'Public: anyone can read it.') : 'Private again.');
  await loadWorlds(); render();
}));
document.addEventListener('toggle', e => { if (e.target.dataset && e.target.dataset.versions) S.ruleVersionsOpen = e.target.open; }, true);
