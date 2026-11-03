package com.conlangs.web;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/**
 * Builds word forms (definite, plural, tenses ...) from form rules: "words of type X get affix Y".
 * The affix can be linked to a dictionary word. Then the form uses that word as it was at the year the form
 * starts, after the sound changes up to then, so words coined after e.g. ou &gt; oe get the new affix.
 * The finished form is stored and, like any word, evolves with the sound changes from that year on.
 * For one label, the first applicable rule (by order) wins.
 */
@Service
public class FormGenerator {
    private final Db db;
    private final EvolverFactory evolvers;

    public FormGenerator(Db db, EvolverFactory evolvers) {
        this.db = db;
        this.evolvers = evolvers;
    }

    private Long parentOf(long id) {
        Map<String, Object> r = db.one("select parent_id from languages where id=?", id);
        return r == null || r.get("parent_id") == null ? null : Db.num(r.get("parent_id"));
    }

    private Map<String, String> classesOf(long langId) {
        List<String> chain = new ArrayList<>();
        Long cur = langId;
        for (int i = 0; cur != null && i < 50; i++) {
            Map<String, Object> l = db.one("select classes, parent_id from languages where id=?", cur);
            if (l == null) break;
            chain.add(0, (String) l.get("classes"));
            cur = l.get("parent_id") == null ? null : Db.num(l.get("parent_id"));
        }
        Map<String, String> m = new LinkedHashMap<>();
        for (String c : chain) m.putAll(Patterns.parseClasses(c));
        return m;
    }

    private static boolean posMatches(String rulePos, String wordPos) {
        if (rulePos == null || rulePos.isBlank()) return true;
        if (wordPos == null) return false;
        for (String p : rulePos.split(",")) if (p.trim().equalsIgnoreCase(wordPos.trim())) return true;
        return false;
    }

    private List<Evolver.Override> overridesOf(long wordId) {
        List<Evolver.Override> out = new ArrayList<>();
        for (Map<String, Object> o : db.rows("select lang_id, year, form from word_overrides where word_id=?", wordId)) {
            out.add(new Evolver.Override(Db.num(o.get("lang_id")), ((Number) o.get("year")).intValue(), (String) o.get("form")));
        }
        return out;
    }

    /**
     * Creates missing forms (and, with overwrite, recomputes existing ones) for one word or all words of a language.
     * onlyLabel restricts it to one form type. Returns counts of created and updated forms.
     */
    public Map<String, Integer> generate(long langId, Long wordId, String onlyLabel, boolean overwrite) {
        return generate(langId, wordId, onlyLabel, null, overwrite);
    }

    /** onlyGroup: null = all groups; "" = rules without a group; otherwise that group's name. */
    public Map<String, Integer> generate(long langId, Long wordId, String onlyLabel, String onlyGroup, boolean overwrite) {
        Map<String, Integer> out = new LinkedHashMap<>();
        out.put("created", 0);
        out.put("updated", 0);
        List<Map<String, Object>> rules = new ArrayList<>();
        for (Map<String, Object> r : db.rows("select * from form_rules where language_id=? order by ord, id", langId)) {
            String grp = r.get("grp") == null ? "" : ((String) r.get("grp")).trim();
            if ((onlyLabel == null || onlyLabel.equalsIgnoreCase((String) r.get("label"))) && (onlyGroup == null || onlyGroup.equalsIgnoreCase(grp))) rules.add(r);
        }
        if (rules.isEmpty()) return out;
        Map<String, String> classes = classesOf(langId);
        String vowels = classes.getOrDefault("V", "aeiouy");
        Map<Long, Pattern> conds = new HashMap<>();
        for (Map<String, Object> r : rules) {
            String c = (String) r.get("cond_re");
            if (c != null && !c.isBlank()) {
                try {
                    conds.put(Db.num(r.get("id")), Patterns.compile(c, classes));
                } catch (IllegalArgumentException e) {
                    conds.put(Db.num(r.get("id")), null);
                }
            }
        }
        List<Long> path = new ArrayList<>();
        path.add(langId);
        Long up = parentOf(langId);
        for (int i = 0; up != null && i < 50; i++) {
            path.add(up);
            up = parentOf(up);
        }
        long worldId = Db.num(db.one("select world_id from languages where id=?", langId).get("world_id"));
        Evolver[] evolver = new Evolver[1];
        Map<Long, List<Evolver.Row>> affixRows = new HashMap<>();
        Map<Long, Map<String, Object>> affixWords = new HashMap<>();

        List<Map<String, Object>> words = wordId == null
                ? db.rows("select id, pos, form, year from words where language_id=?", langId)
                : db.rows("select id, pos, form, year from words where id=? and language_id=?", wordId, langId);
        Map<Long, Map<String, Map<String, Object>>> existing = new HashMap<>();
        for (Map<String, Object> f : db.rows("select f.id, f.word_id, f.label, f.form from word_forms f join words w on w.id=f.word_id where w.language_id=?", langId)) {
            existing.computeIfAbsent(Db.num(f.get("word_id")), k -> new HashMap<>()).put(((String) f.get("label")).toLowerCase(), f);
        }
        for (Map<String, Object> w : words) {
            long id = Db.num(w.get("id"));
            String base = (String) w.get("form");
            if (Evolver.isLiteral(base)) continue;   // notes and cross-references have no forms of their own
            int wyear = ((Number) w.get("year")).intValue();
            List<Evolver.Row> baseRows = null;
            Set<String> handled = new HashSet<>();
            for (Map<String, Object> r : rules) {
                String label = (String) r.get("label"), key = label.toLowerCase();
                if (handled.contains(key) || !posMatches((String) r.get("pos"), (String) w.get("pos"))) continue;
                long rid = Db.num(r.get("id"));
                if (conds.containsKey(rid)) {
                    Pattern p = conds.get(rid);
                    if (p == null || !p.matcher(base).find()) continue;
                }
                String affix = r.get("affix") == null ? "" : (String) r.get("affix");
                int start = r.get("year") == null ? wyear : Math.max(wyear, ((Number) r.get("year")).intValue());

                String baseAt = base;
                if (start != wyear) {
                    if (evolver[0] == null) evolver[0] = evolvers.build(worldId, null);
                    if (baseRows == null) baseRows = evolver[0].evolve(langId, base, wyear, overridesOf(id));
                    baseAt = FormMath.formAt(baseRows, List.of(langId), start);
                }
                if (r.get("affix_word_id") != null) {
                    long aw = Db.num(r.get("affix_word_id"));
                    Map<String, Object> aword = affixWords.computeIfAbsent(aw, k -> db.one("select id, language_id, form, year from words where id=?", k));
                    if (aword != null) {
                        if (evolver[0] == null) evolver[0] = evolvers.build(worldId, null);
                        List<Evolver.Row> rows = affixRows.computeIfAbsent(aw, k -> evolver[0].evolve(Db.num(aword.get("language_id")),
                                (String) aword.get("form"), ((Number) aword.get("year")).intValue(), overridesOf(k)));
                        String at = FormMath.formAt(rows, path, start);
                        if (at != null && !at.isEmpty()) affix = at;
                    }
                }
                if (affix.isEmpty()) continue;
                handled.add(key);
                String form = FormMath.attach(baseAt, (String) r.get("placement"), affix, ((Number) r.get("hiatus")).intValue() != 0, vowels);
                Integer formYear = start != wyear ? Integer.valueOf(start) : null;
                Map<String, Object> ex = existing.getOrDefault(id, Map.of()).get(key);
                if (ex == null) {
                    db.insert("insert into word_forms(word_id, label, form, year) values (?,?,?,?)", id, label, form, formYear);
                    out.merge("created", 1, Integer::sum);
                } else if (overwrite && !form.equals(ex.get("form"))) {
                    db.update("update word_forms set form=?, year=? where id=?", form, formYear, ex.get("id"));
                    out.merge("updated", 1, Integer::sum);
                }
            }
        }
        return out;
    }
}
