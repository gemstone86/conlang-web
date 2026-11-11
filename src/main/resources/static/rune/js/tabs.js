'use strict';
// Root and Rune: the language panel and its tabs. The files in js/ are loaded in order by index.html and share one scope.
// ---------- panel ----------
const TABS = [['dict', 'Dictionary'], ['missing', 'Missing words'], ['rules', 'Sound changes'], ['grammar', 'Grammar'], ['forms', 'Word forms'], ['sounds', 'Sounds'], ['compound', 'Compound'], ['sentences', 'Sentences'], ['texts', 'Texts'], ['etymology', 'Etymology'], ['graphs', 'Graphs'], ['check', 'Check'], ['bulk', 'Bulk entry'],
  ['changes', 'Changes'], ['log', 'Edit log'], ['share', 'Sharing'], ['settings', 'Settings']];
function descendants(l) {
  const all = S.worlds.flatMap(w => w.languages), out = [];
  const walk = id => all.filter(x => x.parent_id === id).forEach(c => { out.push(c); walk(c.id); });
  walk(l.id); return out;
}
function canEdit() { return S.lang && S.lang.level >= 2; }
/** May change things that go through the owner's approval: editors, and anyone logged in on a public language that takes suggestions. */
function canSuggest() { return canEdit() || !!(S.me && S.lang && S.lang.can_suggest); }
function isOwner() { return S.lang && S.lang.level >= 3; }
async function renderPanel() {
  const l = S.lang;
  let h = `<h2>${esc(l.name)} <span class="badge">${LEVELS[l.level]}</span>${l.is_public ? ' <span class="badge public">public</span>' : ''}${l.owner_name && l.level < 3 ? ` <span class="small muted">by ${esc(l.owner_name)}</span>` : ''}</h2>
  ${publishRow(l)}
  <div class="row">${canEdit() ? '<button data-act="undo">↶ Undo</button><button data-act="redo">↷ Redo</button>' : ''}
  <a href="/rune/api/languages/${l.id}/export.xlsx"><button>Export Excel</button></a></div><div class="tabs">` +
    TABS.filter(t => (isOwner() || !['share', 'settings'].includes(t[0])) && (S.me || !['changes', 'log'].includes(t[0])) && (canEdit() || !['bulk', 'compound'].includes(t[0]))).map(t => `<button data-act="tab" data-t="${t[0]}" class="${S.tab === t[0] ? 'on' : ''}">${t[1]}</button>`).join('') +
    '</div><div id="tabbody">Loading…</div>';
  $('#panelbody').innerHTML = h;
  try { $('#tabbody').innerHTML = await TAB[S.tab](); if (AFTER[S.tab]) AFTER[S.tab](); } catch (e) { $('#tabbody').innerHTML = ''; say(e.message, true); }
}
const base = () => '/rune/api/languages/' + S.lang.id;

/** The public switches (admins: public; admins and the owner: suggestions), or a note for readers. */
function publishRow(l) {
  const admin = S.me && S.me.is_admin;
  if (admin || (isOwner() && l.is_public)) {
    return `<div class="row publishrow">${admin ? `<label style="display:inline;margin:0" title="Anyone can read it, also without logging in; it is listed under Community"><input type="checkbox" data-publish="public" ${l.is_public ? 'checked' : ''}> Public</label>` : '<span class="badge public">public</span>'}
      <label style="display:inline;margin:0" title="Anyone logged in can suggest changes; they wait for the owner's approval on the Changes tab"><input type="checkbox" data-publish="suggestions" ${l.public_suggestions ? 'checked' : ''} ${l.is_public ? '' : 'disabled'}> Anyone can suggest changes</label>
      <span class="small muted">${l.is_public ? 'Anyone can read it, also without logging in' + (l.public_suggestions ? '; anyone logged in can suggest changes, which wait for approval on the Changes tab.' : '.') : 'Only you and the people it is shared with can see it.'}</span></div>`;
  }
  if (l.is_public && l.level < 2) {
    if (l.can_suggest) return '<p class="small card pending">This language is public and takes suggestions: what you add or change is sent to its owner for approval (see the Changes tab).</p>';
    if (!S.me && l.public_suggestions) return '<p class="small muted"><a href="/?next=%2Frune%2F">Log in</a> to suggest changes to this language.</p>';
  }
  return '';
}

const TAB = {
  async dict() {
    S.words = await api('GET', base() + '/words');
    S.page = 0;
    let tree = { lineage: [], problems: [] };
    try { tree = await api('GET', base() + '/tree-check'); } catch (e) { /* the note is optional */ }
    let h = '';
    if (canSuggest()) h += `<div class="card"><div class="row">
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
    const targets = [S.lang, ...descendants(S.lang)].filter(l => l.level >= 2 || (S.me && l.can_suggest));
    const seg = (v, t) => `<button data-act="ruleScope" data-v="${v}" class="${scope === v ? 'primary' : ''}">${t}</button>`;
    let h = `<div class="row"><span class="small muted">Show</span> ${seg('self', 'only ' + esc(S.lang.name))} ${seg('branches', esc(S.lang.name) + ' + all its branches')} ${seg('path', 'full path (ancestors + ' + esc(S.lang.name) + ')')}
      <span class="small muted">${rules.length} rule${rules.length === 1 ? '' : 's'}</span></div>`;
    h += `<div class="card"><div class="row"><a href="/rune/api/languages/${S.lang.id}/rules/export.json?scope=${scope}"><button>Export these sound changes (JSON)</button></a>
      ${canEdit() ? `<input type="file" id="ri_file" accept=".json,application/json"><input id="ri_tag" placeholder="tag all imported (optional)" size="22" list="r_taglist" title="Every sound change in the file gets this tag (or several, comma separated), on top of its own tags"><label style="display:inline;margin:0"><input type="checkbox" id="ri_rm"> remove rules that are missing from the file</label>
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
      <td>${r.level >= 2 || (S.me && (S.worlds.flatMap(w => w.languages).find(x => x.id === r.language_id) || {}).can_suggest) ? `<button data-act="editRule" data-id="${r.id}">Edit</button> <button class="danger" data-act="delRule" data-id="${r.id}">✕</button>` : ''}</td></tr>`;
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
    if (canSuggest()) h += `<div class="card"><div class="row"><select id="gr_cat" data-grcat="1">${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select>
      <input id="gr_name" placeholder="name" size="26"><input id="gr_year" type="number" placeholder="from year" size="8"><input id="gr_id" type="hidden"></div>
      <div class="row">${[1, 2, 3, 4, 5, 6].map(k => `<input id="gr_c${k}" placeholder="column ${k}" size="22">`).join('')}</div>
      <div class="row"><button class="primary" data-act="saveGrammar" id="gr_btn">Add row</button><button data-act="cancelGrammar" id="gr_cancel" hidden>Cancel edit</button>
      <button data-act="newSection">+ New section</button></div></div>`;
    h += excelImportCard();
    h += '<div class="row"><input placeholder="Search grammar…" data-gfilter="1"></div>';
    for (const t of cats) {
      const hd = heads(t), list = g.entries.filter(e => e.category === t);
      const vis = [0, 1, 2, 3, 4, 5].filter(k => hd[k] || list.some(e => e['c' + (k + 1)]));
      h += `<h3>${esc(t)} ${canSuggest() ? `<button data-act="editHeadings" data-t="${esc(t)}">Edit columns</button> <button class="danger" data-act="delSection" data-t="${esc(t)}">Delete section</button>` : ''}</h3>
        <table class="gt"><tr><th>${esc(t)}</th>${vis.map(k => `<th>${esc(hd[k])}</th>`).join('')}<th>From</th><th></th></tr>`;
      for (const e of list) h += `<tr><td><strong>${esc(e.name)}</strong></td>${vis.map(k => `<td>${esc(e['c' + (k + 1)])}</td>`).join('')}<td>${e.year ?? ''}</td>
        <td>${canSuggest() ? `<button data-act="editGrammar" data-id="${e.id}">Edit</button> <button data-act="rowToForm" data-id="${e.id}" title="Turn this row into a word form that is added to words automatically">→ word form</button> <button class="danger" data-act="delGrammar" data-id="${e.id}">✕</button>` : ''}</td></tr>`;
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
    h += await stackOrderCard();
    if (S.prefill) h += `<p class="card pending">From grammar row <strong>${esc(S.prefill.label)}</strong>${S.prefill.hint ? ' — ' + esc(S.prefill.hint) : ''}</p>`;
    if (canSuggest()) h += `<div class="card"><div class="row"><input id="fr_grp" list="fr_groups" placeholder="group (e.g. definers; new name creates it)" size="30"><datalist id="fr_groups">${[...new Set(rules.map(x => x.grp).filter(Boolean))].map(g => `<option value="${esc(g)}">`).join('')}</datalist><input id="fr_label" placeholder="form name (e.g. definite)" size="18"><input id="fr_pos" placeholder="applies to types (e.g. noun; blank = all)" size="26">
      <select id="fr_place"><option>suffix</option><option>prefix</option></select></div>
      <div class="row"><input id="fr_link" list="fr_words" placeholder="affix = dictionary word (e.g. definite)" size="30"><datalist id="fr_words">${S.wordnames.map(w => `<option value="${esc(w.gloss)}">${esc(w.form)}</option>`).join('')}</datalist>
      <span class="muted small">or a fixed affix:</span><input id="fr_affix" placeholder="e.g. tou" size="10" class="form"></div>
      <div class="row"><label style="display:inline;margin:0" title="A derivation: the result is a different word (seal → to seal) with its own type and endings. It isn't stored on every word; sentences build it, and you can save it as a word"><input type="checkbox" id="fr_derive" data-frderive="1"> Makes a new word of another type</label>
        <span id="fr_derivebox" hidden><input id="fr_newpos" list="fr_poslist" placeholder="new type, e.g. verb" size="16"><datalist id="fr_poslist">${[...new Set(S.wordnames.map(w => w.pos).concat(rules.map(r => r.pos), rules.map(r => r.new_pos)).filter(Boolean).flatMap(p => String(p).split(',')).map(p => p.trim()).filter(Boolean))].map(p => `<option value="${esc(p)}">`).join('')}</datalist>
        <input id="fr_newgloss" placeholder="meaning, e.g. to {gloss}" size="22" title="{gloss} is the old word's meaning"></span></div>
      <div class="row"><input id="fr_cond" placeholder="only if the word matches (regex, optional; e.g. ^a  or  {V}$)" size="44" class="form">
      <label style="display:inline;margin:0"><input type="checkbox" id="fr_hiatus"> drop the first vowel when two vowels meet</label>
      <input id="fr_year" type="number" placeholder="from year" size="8" data-yearcheck="rule"><span id="fr_warn" class="gap small"></span><input id="fr_ord" type="number" placeholder="order" size="5" value="0"><input id="fr_id" type="hidden"></div>
      <div class="row"><button class="primary" data-act="saveFormRule" id="fr_btn">Add form rule</button><button data-act="cancelFormRule" id="fr_cancel" hidden>Cancel edit</button></div></div>`;
    if (isOwner()) h += '<div class="row"><button data-act="genForms">Add missing forms to all existing words</button></div>';
    h += '<table><tr><th>Form</th><th>Applies to</th><th>Affix</th><th>Condition</th><th>Vowel clash</th><th>From</th><th>Order</th><th></th></tr>';
    const order = []; for (const r of rules) { const g = r.grp || ''; if (!order.includes(g)) order.push(g); }
    order.sort((x, y) => (x === '') - (y === ''));
    const rowOf = r => `<tr><td><strong>${esc(r.label)}</strong>${r.new_pos ? `<div class="small"><span class="badge" title="Derivation: makes a new word">→ ${esc(r.new_pos)}</span> ${esc((r.new_gloss || '{gloss}'))}</div>` : ''}</td><td>${esc(r.pos) || 'all types'}</td><td class="form">${r.affix_word_id ? `⛓ <span class="small">${esc(r.affix_gloss ?? '(deleted word)')}</span> ${r.affix_form ? esc(r.placement === 'prefix' ? r.affix_form + '-' : '-' + r.affix_form) : ''}` : (r.placement === 'prefix' ? esc(r.affix) + '-' : '-' + esc(r.affix))}</td>
      <td class="form">${esc(r.cond_re)}</td><td>${r.hiatus ? 'drop first vowel' : ''}</td><td>${r.year ?? ''}</td><td>${r.ord}</td>
      <td>${canSuggest() ? `<button data-act="editFormRule" data-id="${r.id}">Edit</button> <button class="danger" data-act="delFormRule" data-id="${r.id}">✕</button>` : ''}
      ${isOwner() && !r.new_pos ? `<button data-act="rebuildForm" data-l="${esc(r.label)}" title="Recompute this form for every word (overwrites hand edits)">Rebuild all</button>` : ''}</td></tr>`;
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
    if (canSuggest()) h += `<h3>Add / edit a sound</h3><div class="card"><div class="row"><input id="ph_symbol" placeholder="symbol" size="6" class="form">
      <select id="ph_kind"><option>consonant</option><option>vowel</option></select>
      <input id="ph_row" list="ph_rows" placeholder="row (manner / height)" size="18"><datalist id="ph_rows">${[...new Set(ph.map(p => p.row_label).filter(Boolean))].map(x => `<option>${esc(x)}</option>`).join('')}</datalist>
      <input id="ph_col" list="ph_cols" placeholder="column (place / backness)" size="22"><datalist id="ph_cols">${[...new Set(ph.map(p => p.col_label).filter(Boolean))].map(x => `<option>${esc(x)}</option>`).join('')}</datalist>
      <input id="ph_notes" placeholder="notes" size="18"><input id="ph_from" type="number" placeholder="from year" size="8"><input id="ph_to" type="number" placeholder="until year" size="8"><input id="ph_id" type="hidden"></div>
      <div class="row"><button class="primary" data-act="savePhoneme" id="ph_btn">Add sound</button><button data-act="cancelPhoneme" id="ph_cancel" hidden>Cancel edit</button></div></div>`;
    if (canEdit()) h += `<h3>Import sounds</h3><div class="card"><p class="muted small">Paste a table with one sound per line: <code>Symbol | Kind | Row | Column | Notes | From | Until</code> (tab, | or ; between cells; the last three are optional), or choose a JSON file with a "sounds" list. Sounds with the same symbol, kind and years are updated.</p>
      <textarea id="si_text" rows="6" class="form"></textarea><div class="row"><input type="file" id="si_file" accept=".json,.txt,.csv,.tsv"><button data-act="soundImportCheck">Check</button></div><div id="si_out"></div></div>`;
    h += '<h3>All sounds</h3><table><tr><th>Symbol</th><th>Kind</th><th>Row</th><th>Column</th><th>Notes</th><th>From</th><th>Until</th><th></th></tr>' + ph.map(p =>
      `<tr><td class="form">${esc(p.symbol)}</td><td>${esc(p.kind)}</td><td>${esc(p.row_label)}</td><td>${esc(p.col_label)}</td><td>${esc(p.notes)}</td><td>${p.year ?? ''}</td><td>${p.year_to ?? ''}</td>
      <td>${canSuggest() ? `<button data-act="editPhoneme" data-id="${p.id}">Edit</button> <button class="danger" data-act="delPhoneme" data-id="${p.id}">✕</button>` : ''}</td></tr>`).join('') + '</table>';
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
          : (canEdit() ? `<button class="primary" data-act="missCoin" data-g="${esc(e.gloss)}" data-p="${esc(e.pos || '')}">Coin word</button> <button data-act="missRoot" data-g="${esc(e.gloss)}" data-p="${esc(e.pos || '')}" title="Root forms that sound like the language; click one to add it as the word">Suggest root</button> <button data-act="missCompound" data-g="${esc(e.gloss)}" data-p="${esc(e.pos || '')}" title="Make it a compound of existing words">Compound</button>` : '')}
        ${canEdit() ? ` <button class="danger" data-act="missDel" data-id="${e.id}" title="Remove from the list">✕</button>` : ''}</td></tr>`).join('') + '</table>'
      : '<p class="muted">Nothing marked as missing.</p>';
    if (filled.length && canEdit()) h += `<div class="row"><button data-act="missClear">Remove the ${filled.length} that have a word now</button></div>`;
    h += `<h3>Needed by sentences (${r.fromSentences.length})</h3>`;
    h += r.fromSentences.length ? `<table><tr><th>Meaning</th><th>Why</th><th>Used in</th><th></th></tr>` +
      r.fromSentences.map(g => `<tr><td><strong>${esc(g.meaning)}</strong></td><td class="small muted">${esc(g.reason)}</td>
        <td class="small">${g.sentences.map(x => esc(x.translation || x.source)).join('<br>')}</td>
        <td>${canEdit() ? `<button class="primary" data-act="missCoin" data-g="${esc(g.meaning)}" data-p="">Coin word</button> <button data-act="missRoot" data-g="${esc(g.meaning)}" data-p="" title="Root forms that sound like the language; click one to add it as the word">Suggest root</button> <button data-act="missMark" data-g="${esc(g.meaning)}">Mark as missing</button>` : ''}</td></tr>`).join('') + '</table>'
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
      <div class="row"><label style="display:inline;margin:0" title="Each word is used as it was in that year: its form after the sound changes up to then, its meaning then. Words coined later, or lost by then, can't be used.">built as spoken in year</label><input id="s_year" type="number" placeholder="year" size="8" value="${S.sentYear ?? 0}">
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
    return excelImportCard() + `<p class="muted small">One word per line: <code>gloss;type;form;year;notes</code> (tab-separated also works). Nothing is added if any line has an error.</p>
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
    ${speechSettings(l)}
    <label>Grammar notes</label><textarea id="g_grammar" rows="5">${esc(l.grammar)}</textarea>
    <div class="row"><button class="primary" data-act="saveSettings">Save</button><button class="danger" data-act="delLang">Delete language</button></div>`;
  }
};

function applyHeadings() {
  const t = val('gr_cat'), sec = (S.grammar.sections || []).find(x => x.title === t), hd = sec && sec.headings ? sec.headings.split('\t') : [];
  for (let k = 1; k <= 6; k++) { const e = $('#gr_c' + k); if (e) e.placeholder = hd[k - 1] || 'column ' + k; }
}
const AFTER = { dict: () => drawDict(), grammar: () => { if ($('#gr_cat')) applyHeadings(); } };
const lines = obj => Object.entries(obj || {}).map(([k, v]) => `<span class="small">${esc(k)}:</span> <span class="form">${esc(v)}</span>${sayBtn(v, langIdByName(k))}`).join('<br>');
const defForm = w => (w.forms || []).find(f => f.label.toLowerCase() === 'definite');
