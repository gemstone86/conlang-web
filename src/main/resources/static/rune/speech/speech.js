'use strict';
/*
 * Pronunciation by sound: spelling -> IPA (the language's pronunciation map) -> eSpeak NG phoneme codes (for the
 * chosen voice) -> a WAV made by eSpeak NG compiled to WebAssembly, right here in the browser. Nothing is sent anywhere.
 *
 * eSpeak NG (GPL-3.0-or-later, https://github.com/espeak-ng/espeak-ng), built for the browser by
 * https://github.com/ianmarmour/espeak-ng.js (npm "espeak-ng" 1.0.2). maps.json was made by asking eSpeak which IPA
 * each of its phoneme codes gives in each voice.
 */
(function (root) {
  const BASE = '/rune/speech/';
  const VOICES = [
    ['fi', 'Finnish: clear, even vowels (good default)'], ['qya', 'Quenya'], ['sjn', 'Sindarin'], ['la', 'Latin'],
    ['en', 'English'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'], ['it', 'Italian'], ['sv', 'Swedish'],
    ['pl', 'Polish'], ['ru', 'Russian'], ['eo', 'Esperanto'], ['cy', 'Welsh']];
  const DEFAULT = { voice: 'fi', stress: 'first', speed: 140 };
  // When a voice has no sound for a symbol, try these (nearest first).
  const FALLBACK = {
    'ɢ': ['g'], 'ɴ': ['ŋ', 'n'], 'ɱ': ['m'], 'ɳ': ['n'], 'ɲ': ['nj', 'n'], 'ɽ': ['ɾ', 'r'], 'ɸ': ['f'], 'ħ': ['h', 'x'], 'ʕ': ['ɣ', 'h'],
    'ɦ': ['h'], 'ɬ': ['ʃ', 'l'], 'ɮ': ['l'], 'ʋ': ['v'], 'ɹ': ['r', 'ɾ'], 'ɻ': ['ɹ', 'r'], 'ɰ': ['ɣ', 'w'], 'ʟ': ['l'], 'ʈ': ['t'],
    'ɖ': ['d'], 'ʂ': ['ʃ', 's'], 'ʐ': ['ʒ', 'z'], 'ʀ': ['ʁ', 'r'], 'ʁ': ['ʀ', 'ɣ', 'r'], 'q': ['k'], 'c': ['k'], 'ɟ': ['g'],
    'ʎ': ['lj', 'l'], 'ç': ['x', 'h'], 'ʝ': ['j'], 'x': ['χ', 'h', 'k'], 'χ': ['x', 'h'], 'ɣ': ['g'], 'β': ['v', 'b'], 'ð': ['d'],
    'θ': ['t'], 'z': ['s'], 'ʒ': ['ʃ', 'z'], 'ʃ': ['s'], 'ʑ': ['ʒ'], 'ɕ': ['ʃ'], 'ɾ': ['r'], 'r': ['ɾ'], 'ɫ': ['l'], 'ɭ': ['l'],
    'ɨ': ['ɪ', 'i'], 'ʉ': ['u', 'y'], 'ɯ': ['u'], 'ʏ': ['y', 'ɪ', 'i'], 'y': ['ʏ', 'i'], 'ø': ['œ', 'e'], 'ɘ': ['ə', 'e'],
    'ɵ': ['ø', 'o'], 'ɤ': ['o', 'ə'], 'ɛ': ['e'], 'œ': ['ø', 'ɛ', 'e'], 'ɜ': ['ə', 'ɛ', 'e'], 'ɞ': ['ɔ', 'o'], 'ʌ': ['ɐ', 'ə', 'a'],
    'ɔ': ['o'], 'æ': ['ɛ', 'a'], 'ɐ': ['ə', 'a'], 'ɶ': ['œ', 'a'], 'ɑ': ['a'], 'ɒ': ['ɔ', 'o'], 'ə': ['ɐ', 'e'], 'ɪ': ['i'],
    'ʊ': ['u'], 'u': ['ʊ'], 'i': ['ɪ'], 'e': ['ɛ'], 'o': ['ɔ'], 'a': ['ɑ', 'ɐ'], 'ʍ': ['w'], 'ɥ': ['j', 'w'], 'w': ['u'],
    'j': ['i'], 'g': ['k'], 'b': ['p'], 'd': ['t'], 'v': ['f'], 'ŋ': ['n'], 'ʔ': [], 'ʰ': ['h'], 'ʲ': ['j'], 'ʷ': ['w'],
    'ɚ': ['ər', 'ə'], 'ɝ': ['ɜ', 'ər']
  };
  const VOWELS = new Set([...'aeiouyæøœɑɒɐəɘɵɤɛɜɞʌɔɨʉɯɪʏʊɶ']);
  const SKIP = new Set(['.', '‿', 'ˑ', '|', '‖', '-', '(', ')', '[', ']', '/']);

  /** Spelling to IPA with "spelling=IPA" lines, longest spelling first (the same as the server's DictService.ipa). */
  function toIpa(form, mapText) {
    form = String(form || '');
    const m = new Map();
    for (const line of String(mapText || '').split(/\r?\n/)) {
      const eq = line.indexOf('=');
      if (eq > 0 && !line.trim().startsWith('//')) m.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
    }
    if (!m.size) return form.replace(/'/g, 'ˈ');
    const keys = [...m.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
    let out = '', i = 0;
    outer: while (i < form.length) {
      for (const k of keys) if (form.startsWith(k, i)) { out += m.get(k); i += k.length; continue outer; }
      const c = form[i++];
      if (c !== "'") out += c;
    }
    return out;
  }

  /** IPA to eSpeak codes for a voice: {codes: "[[...]]", unknown: [symbols left out], tokens}. */
  function toCodes(ipa, map, stress) {
    const keys = Object.keys(map), maxLen = Math.max(1, ...keys.map(k => k.length));
    const unknown = new Set();
    const resolve = (sym, seen = new Set()) => {
      if (map[sym] != null) return map[sym];
      if (seen.has(sym)) return null;
      seen.add(sym);
      const base = sym.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (base !== sym && base) return resolve(base, seen);
      for (const alt of FALLBACK[sym] || []) {
        if (alt.length > 1 && [...alt].every(ch => map[ch] != null || (FALLBACK[ch] || []).length)) return [...alt].map(ch => resolve(ch, new Set(seen))).filter(Boolean).join('|');
        const r = resolve(alt, seen); if (r != null) return r;
      }
      return null;
    };
    const words = String(ipa).normalize('NFC').toLowerCase().split(/[\s,;!?¡¿"“”«»…]+/).filter(Boolean);
    const out = [];
    for (const word of words) {
      const toks = [];   // {code, vowel} or {mark}
      let i = 0;
      while (i < word.length) {
        const ch = word[i];
        if (ch === 'ˈ' || ch === "'") { toks.push({ mark: "'" }); i++; continue; }
        if (ch === 'ˌ') { toks.push({ mark: ',' }); i++; continue; }
        if (ch === 'ː' || ch === ':') { const last = toks[toks.length - 1]; if (last && last.code) last.code += ':'; i++; continue; }
        if (SKIP.has(ch)) { i++; continue; }
        let hit = null;
        for (let L = Math.min(maxLen, word.length - i); L >= 1 && !hit; L--) {
          const s = word.substr(i, L);
          if (map[s] != null) hit = { s, code: map[s] };
        }
        if (!hit) {   // one symbol with its combining marks, through the fallbacks
          let s = ch, j = i + 1;
          while (j < word.length && /[̀-ͯ]/.test(word[j])) s += word[j++];
          const code = resolve(s);
          if (code == null) { if (!(FALLBACK[ch] && !FALLBACK[ch].length)) unknown.add(s); i = j; continue; }
          hit = { s, code };
        }
        toks.push({ code: hit.code, vowel: VOWELS.has([...hit.s.normalize('NFD')][0]) });
        i += hit.s.length;
      }
      if (!toks.some(t => t.code)) continue;
      if (!toks.some(t => t.mark) && stress !== 'written') {
        const v = toks.map((t, k) => t.vowel ? k : -1).filter(k => k >= 0);
        if (v.length > 1 || stress === 'first') {
          let at = 0;
          if (stress === 'last' && v.length) {
            at = v[v.length - 1];
            while (at > 0 && toks[at - 1].vowel) at--;           // a diphthong belongs together
            if (at > 0 && toks[at - 1].code) at--;              // with one consonant before it
          }
          toks.splice(at, 0, { mark: "'" });
        }
      }
      let w = '';
      for (const t of toks) {
        if (t.mark) { w += t.mark; continue; }
        if (w && !/[',]$/.test(w)) w += '|';
        w += t.code;
      }
      out.push(w);
    }
    return { codes: out.length ? '[[' + out.join(' ') + ']]' : '', unknown: [...unknown] };
  }

  let ready = null;
  function load() {
    if (ready) return ready;
    ready = (async () => {
      const [mod, maps, wasm] = await Promise.all([
        import(BASE + 'espeak-ng.js'),
        fetch(BASE + 'maps.json').then(r => r.json()),
        (async () => {
          const res = await fetch(BASE + 'espeak-ng.wasm');
          if (!res.ok) throw new Error('Could not load the speech engine (' + res.status + ')');
          try { return await WebAssembly.compileStreaming(res.clone()); } catch (e) { return WebAssembly.compile(await res.arrayBuffer()); }
        })()]);
      return { make: mod.default, maps, wasm };
    })();
    ready.catch(() => { ready = null; });
    return ready;
  }

  /** Run eSpeak once (it is a command-line program: every run is a fresh instance) and return its file system. */
  async function run(args) {
    const { make, wasm } = await load();
    const es = await make({
      arguments: args, print: () => {}, printErr: () => {},
      instantiateWasm: (imports, done) => { WebAssembly.instantiate(wasm, imports).then(inst => done(inst)); return {}; }
    });
    return es;
  }

  let playing = null;
  /**
   * Say spelled text in a language. profile: {ipaMap, voice, stress, speed}. Returns {ipa, codes, unknown}.
   * Throws if nothing in it can be said.
   */
  async function say(text, profile) {
    const p = Object.assign({}, DEFAULT, Object.fromEntries(Object.entries(profile || {}).filter(([, v]) => v != null && v !== '')));
    const { maps } = await load();
    const map = maps[p.voice] || maps[DEFAULT.voice];
    const ipa = toIpa(text, p.ipaMap);
    const { codes, unknown } = toCodes(ipa, map, p.stress);
    if (!codes) throw new Error('Nothing to say' + (unknown.length ? ': no sound for ' + unknown.join(' ') : '.'));
    const es = await run(['-v', maps[p.voice] ? p.voice : DEFAULT.voice, '-s', String(p.speed), '-w/say.wav', codes]);
    const wav = es.FS.readFile('/say.wav');
    if (playing) { playing.pause(); URL.revokeObjectURL(playing.src); }
    const audio = new Audio(URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })));
    playing = audio;
    await audio.play();
    return { ipa, codes, unknown };
  }

  const api = { say, toIpa, toCodes, load, VOICES, DEFAULT, FALLBACK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Speech = api;
})(typeof window !== 'undefined' ? window : globalThis);
