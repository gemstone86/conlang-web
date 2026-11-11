'use strict';
// Root and Rune: listen buttons and voice settings (the engine is in speech/speech.js). The files in js/ are loaded in order by index.html and share one scope.
// ---------- pronunciation by sound (eSpeak NG, see speech/speech.js) ----------
const allLangs = () => (S.worlds || []).flatMap(w => w.languages || []);
const langById = id => allLangs().find(l => l.id === Number(id));
/** A language name in the current world (the evolution tables name languages, not ids). */
function langIdByName(name) {
  const wid = S.lang && S.lang.world_id;
  const l = allLangs().find(x => x.name === name && (wid == null || x.world_id === wid)) || allLangs().find(x => x.name === name);
  return l ? l.id : (S.lang && S.lang.id);
}
/** Pronunciation map and voice of a language, each taken from the nearest ancestor that has one. */
function speechProfile(id) {
  const p = {};
  for (let l = langById(id), n = 0; l && n < 50; l = l.parent_id ? langById(l.parent_id) : null, n++) {
    if (p.ipaMap == null && (l.ipa_map || '').trim()) p.ipaMap = l.ipa_map;
    if (p.voice == null && l.speech_voice) p.voice = l.speech_voice;
    if (p.stress == null && l.speech_stress) p.stress = l.speech_stress;
    if (p.speed == null && l.speech_speed) p.speed = l.speech_speed;
  }
  return p;
}
function sayBtn(text, langId) {
  if (!window.Speech || text == null || !String(text).trim() || /^\[.*\?\]$/.test(String(text).trim())) return '';
  return ` <button class="say" data-act="say" data-t="${esc(text)}" data-l="${langId ?? ''}" title="Listen">▶</button>`;
}
let speechLoaded = false;
async function speak(text, profile, btn) {
  if (!window.Speech) throw new Error('The speech engine is not available.');
  if (btn) btn.classList.add('busy');
  if (!speechLoaded) say('Loading the speech engine (about 9 MB, only the first time)…');
  try {
    const r = await Speech.say(text, profile);
    if (!speechLoaded) { speechLoaded = true; say(''); }
    if (r.unknown.length) say('No sound for ' + r.unknown.join(' ') + ' in this voice, so it was left out. Add it to the pronunciation map, or try another voice.', true);
    return r;
  } finally { if (btn) btn.classList.remove('busy'); }
}
function speechSettings(l) {
  const parent = l.parent_id ? speechProfile(l.parent_id) : {};
  const inherit = what => l.parent_id ? `(as the parent: ${what})` : `(default: ${what})`;
  const voiceName = v => (Speech.VOICES.find(x => x[0] === v) || [v, v])[1].split(':')[0];
  if (!window.Speech) return '';
  return `<h3>Pronunciation by sound</h3>
    <p class="muted small">The ▶ buttons next to forms read them aloud: the spelling goes through the pronunciation map above to IPA (no map: the
    form is read as IPA), then a voice of <a href="https://github.com/espeak-ng/espeak-ng" target="_blank" rel="noopener">eSpeak NG</a> says it. The voice is the accent:
    it decides how each sound comes out. Branches use these settings unless they have their own.</p>
    <div class="row"><div><label>Voice</label><select id="g_voice"><option value="">${esc(inherit(voiceName(parent.voice || Speech.DEFAULT.voice)))}</option>
      ${Speech.VOICES.map(([v, n]) => `<option value="${v}" ${l.speech_voice === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
    <div><label>Stress</label><select id="g_stress"><option value="">${esc(inherit(parent.stress || Speech.DEFAULT.stress))}</option>
      ${[['first', 'first syllable'], ['last', 'last syllable'], ['written', 'only where the IPA has ˈ']].map(([v, n]) => `<option value="${v}" ${l.speech_stress === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div><label>Speed (words a minute)</label><input id="g_speed" type="number" min="60" max="400" step="10" size="6" placeholder="${parent.speed || Speech.DEFAULT.speed}" value="${l.speech_speed ?? ''}"></div></div>
    <div class="row"><input id="g_try" class="form" placeholder="type a form to hear it" size="30"><button data-act="sayTry">▶ Listen</button><span id="g_tryout" class="small muted"></span></div>
    <p class="muted small">A word without ˈ in its IPA gets the stress set here. Sounds a voice doesn't have are replaced by the nearest one it has (ɬ by ʃ, ɛ by e…).</p>`;
}
Object.assign(A, {
  say: async (d, el) => { await speak(d.t, speechProfile(d.l), el); },
  sayTry: async (d, el) => {
    const t = val('g_try').trim(); if (!t) return;
    const p = Object.assign(speechProfile(S.lang.id), { ipaMap: val('g_ipa') || speechProfile(S.lang.parent_id || 0).ipaMap });
    if (val('g_voice')) p.voice = val('g_voice');
    if (val('g_stress')) p.stress = val('g_stress');
    if (val('g_speed')) p.speed = Number(val('g_speed'));
    const r = await speak(t, p, el);
    $('#g_tryout').innerHTML = `IPA <span class="form">${esc(r.ipa)}</span> · eSpeak <code>${esc(r.codes)}</code>`;
  }
});
