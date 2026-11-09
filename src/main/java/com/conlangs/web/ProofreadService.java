package com.conlangs.web;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

/**
 * The Check tab: things in a language that are probably mistakes or loose ends, in one list per kind. Each item has a
 * text and, where it helps, the word it's about (word_id) so the page can open it.
 */
@Service
public class ProofreadService {
    private final Db db;
    private final Access access;
    private final DictService dict;
    private final SentenceService sentences;
    private final MissingService missing;

    public ProofreadService(Db db, Access access, DictService dict, SentenceService sentences, MissingService missing) {
        this.db = db;
        this.access = access;
        this.dict = dict;
        this.sentences = sentences;
        this.missing = missing;
    }

    private static Map<String, Object> item(String text, Object wordId) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("text", text);
        if (wordId != null) m.put("word_id", wordId);
        return m;
    }

    private static Map<String, Object> check(String key, String title, String help, List<Map<String, Object>> items) {
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("key", key);
        c.put("title", title);
        c.put("help", help);
        c.put("count", items.size());
        c.put("items", items.size() > 300 ? items.subList(0, 300) : items);
        return c;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> report(long uid, long langId) {
        Map<String, Object> lang = access.need(uid, langId, Access.VIEWER);
        String name = (String) lang.get("name");
        List<Map<String, Object>> words = dict.words(uid, langId);
        List<Map<String, Object>> checks = new ArrayList<>();

        // 1. the dictionary's own warnings: no year, empty form, sound-change errors, broken references and loans
        List<Map<String, Object>> problems = new ArrayList<>();
        for (Map<String, Object> w : words) {
            if (Boolean.TRUE.equals(w.get("inherited"))) continue;   // shown in the language it belongs to
            for (Object p : (List<Object>) w.getOrDefault("problems", List.of()))
                problems.add(item("'" + w.get("gloss") + "' (" + w.get("form") + "): " + p, w.get("id")));
        }
        checks.add(check("problems", "Word problems", "Words with no year, an empty form, a sound change that fails on them, or a reference or loan to a word that's gone.", problems));

        // 2. homophones now: different words that end up with the same form in this language
        Map<String, List<Map<String, Object>>> byForm = new LinkedHashMap<>();
        for (Map<String, Object> w : words) {
            if (w.get("lost_year") != null || w.get("ref_to") != null) continue;
            Object latest = ((Map<String, Object>) w.getOrDefault("latest", Map.of())).get(name);
            String f = latest == null ? (String) w.get("form") : latest.toString();
            if (f == null || f.isBlank() || Evolver.isLiteral(f)) continue;
            byForm.computeIfAbsent(f.trim().toLowerCase(Locale.ROOT), k -> new ArrayList<>()).add(w);
        }
        List<Map<String, Object>> homophones = new ArrayList<>();
        for (Map.Entry<String, List<Map<String, Object>>> e : byForm.entrySet()) {
            if (e.getValue().size() < 2) continue;
            List<String> gl = new ArrayList<>();
            for (Map<String, Object> w : e.getValue()) gl.add("'" + w.get("gloss") + "'" + (Boolean.TRUE.equals(w.get("inherited")) ? " (from " + w.get("origin_lang") + ")" : ""));
            homophones.add(item(e.getKey() + ": " + String.join(", ", gl), e.getValue().get(0).get("id")));
        }
        checks.add(check("homophones", "Words that sound the same", "Different words with the same form today in " + name + ". Sometimes wanted; often a sound change merged them.", homophones));

        // 3. sound changes of this language that change no word (or word form) passing through it
        Evolver ev = dict.evolverFor(Db.num(lang.get("world_id")), null);
        List<Long> path = new ArrayList<>(access.ancestors(langId));
        java.util.Collections.reverse(path);
        path.add(langId);
        Set<Long> only = new HashSet<>(path);
        Set<String> used = new HashSet<>();
        for (long src : path) {
            if (src != langId && access.level(uid, src) < Access.VIEWER) continue;
            for (Map<String, Object> w : db.rows("select form, year from words where language_id=?", src))
                collect(ev.evolve(src, (String) w.get("form"), ((Number) w.get("year")).intValue(), List.of(), only), langId, used);
            for (Map<String, Object> f : db.rows("select f.form, coalesce(f.year, w.year) as year from word_forms f join words w on w.id=f.word_id where w.language_id=?", src))
                collect(ev.evolve(src, (String) f.get("form"), ((Number) f.get("year")).intValue(), List.of(), only), langId, used);
        }
        Map<Long, Map<String, String>> off = RuleTags.effectiveOff(db, Db.num(lang.get("world_id")));
        List<Map<String, Object>> unused = new ArrayList<>();
        for (Map<String, Object> r : db.rows("select * from rules where language_id=? order by year, ord, id", langId)) {
            if (RuleTags.offTag((String) r.get("tags"), off.getOrDefault(langId, Map.of())) != null) continue;   // switched off on purpose
            String label = r.get("name") == null || r.get("name").toString().isBlank() ? r.get("pattern") + " > " + r.get("replacement") : r.get("name").toString();
            if (!used.contains(((Number) r.get("year")).intValue() + "|" + label))
                unused.add(item(r.get("year") + ": " + label + "  (" + r.get("pattern") + " > " + r.get("replacement") + ")", null));
        }
        checks.add(check("unused", "Sound changes that change nothing", "Sound changes of " + name + " that don't change any word or word form passing through it. A typo in the pattern, a missing class, or a change that comes too early or too late.", unused));

        // 4. sounds in today's forms that aren't on the Sounds tab
        List<Map<String, Object>> phonemes = db.rows("select symbol from phonemes where language_id=?", langId);
        List<Map<String, Object>> unknown = new ArrayList<>();
        if (!phonemes.isEmpty()) {
            Set<String> symbols = new HashSet<>(), multi = new HashSet<>();
            for (Map<String, Object> p : phonemes) {
                String sy = p.get("symbol").toString().trim().toLowerCase(Locale.ROOT);
                symbols.add(sy);
                if (sy.codePointCount(0, sy.length()) > 1) multi.add(sy);
            }
            Map<String, List<String>> where = new LinkedHashMap<>();
            Map<String, Object> firstWord = new HashMap<>();
            for (Map<String, Object> w : words) {
                if (w.get("lost_year") != null || w.get("ref_to") != null) continue;
                Object latest = ((Map<String, Object>) w.getOrDefault("latest", Map.of())).get(name);
                String f = latest == null ? (String) w.get("form") : latest.toString();
                if (f == null || Evolver.isLiteral(f)) continue;
                for (String g : InventoryBuilder.segment(f, multi)) {
                    if (symbols.contains(g) || g.codePoints().allMatch(cp -> symbols.contains(new String(Character.toChars(cp))))) continue;
                    List<String> l = where.computeIfAbsent(g, k -> new ArrayList<>());
                    if (l.size() < 5) l.add("'" + w.get("gloss") + "' " + f);
                    firstWord.putIfAbsent(g, w.get("id"));
                }
            }
            for (Map.Entry<String, List<String>> e : where.entrySet())
                unknown.add(item(e.getKey() + ": " + String.join(", ", e.getValue()), firstWord.get(e.getKey())));
        }
        checks.add(check("sounds", "Sounds missing from the Sounds tab", phonemes.isEmpty()
                ? "The Sounds tab is empty, so this can't be checked yet."
                : "Sounds in today's forms that aren't on the Sounds tab: either add them there or a sound change produces something unplanned.", unknown));

        // 5. saved sentences that can't be built fully
        List<Map<String, Object>> gaps = new ArrayList<>();
        for (Map<String, Object> s : sentences.list(uid, langId)) {
            Map<String, Object> built = (Map<String, Object>) s.get("built");
            if (((Number) built.get("gaps")).intValue() == 0) continue;
            List<String> why = new ArrayList<>();
            for (Map<String, Object> w : (List<Map<String, Object>>) built.get("words"))
                for (Map<String, Object> p : (List<Map<String, Object>>) w.get("parts"))
                    if (Boolean.FALSE.equals(p.get("ok"))) why.add(p.get("input") + ": " + p.get("reason"));
            gaps.add(item("#" + s.get("id") + " " + (s.get("translation") == null ? s.get("source") : s.get("translation")) + " (" + s.get("year") + "). " + String.join("; ", why), null));
        }
        checks.add(check("sentences", "Sentences with gaps", "Saved sentences where a word or form can't be found for their year.", gaps));

        // 6. loose ends: open missing words, the family tree
        List<Map<String, Object>> loose = new ArrayList<>();
        Map<String, Object> m = missing.list(uid, langId);
        long open = ((List<Map<String, Object>>) m.get("entries")).stream().filter(e -> e.get("word") == null).count();
        if (open > 0) loose.add(item(open + " meaning" + (open == 1 ? " is" : "s are") + " marked as missing (Missing words tab).", null));
        int needed = ((List<?>) m.get("fromSentences")).size();
        if (needed > 0) loose.add(item(needed + " meaning" + (needed == 1 ? " is" : "s are") + " needed by sentences but has no word.", null));
        for (Object p : (List<Object>) dict.treeCheck(uid, langId).get("problems")) loose.add(item(p.toString(), null));
        if (access.level(uid, langId) >= Access.OWNER) {
            long pending = db.count("select count(*) from changes where language_id=? and status='PENDING'", langId);
            if (pending > 0) loose.add(item(pending + " change" + (pending == 1 ? " waits" : "s wait") + " for your approval (Changes tab).", null));
        }
        checks.add(check("loose", "Loose ends", "Things waiting to be done.", loose));

        int total = 0;
        for (Map<String, Object> c : checks) total += (int) c.get("count");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("language", name);
        out.put("words", words.size());
        out.put("total", total);
        out.put("checks", checks);
        return out;
    }

    private static void collect(List<Evolver.Row> rows, long langId, Set<String> used) {
        for (Evolver.Row r : rows) if (r.langId() == langId && r.source().equals("RULE")) used.add(r.year() + "|" + r.rule());
    }
}
