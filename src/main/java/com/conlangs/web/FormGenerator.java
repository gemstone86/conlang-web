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
import org.springframework.transaction.annotation.Transactional;

/**
 * Builds word forms (definite, plural, tenses ...) from form rules: "words of type X get affix Y".
 * The affix can be linked to a dictionary word. Then the form uses that word as it was at the year the form
 * starts, after the sound changes up to then, so words coined after e.g. ou &gt; oe get the new affix.
 * The finished form, like any word, evolves with the sound changes from that year on.
 * For one label, the first applicable rule (by order) wins.
 *
 * <p>Compact forms: a form the rules give is <b>not stored</b>. It is worked out when it is shown ({@link #virtualFor}),
 * and comes out the same as a stored one would. A form is stored when it is <b>irregular</b>: made or changed by hand, or
 * when the sound changes have made it something else than its word and its ending give when each goes through the
 * sound changes on its own (imtou &gt; imbou by "t &gt; b between m and a vowel", where im + tou stays imtou). Such a form
 * is stored with the year it became irregular (irregular_year) and is left alone when the rules change.
 * <b>Levelling</b> (level_year, level_form) makes a stored form regular again from a year: it becomes what the rule
 * gives then, and goes on from there.
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
        return run(langId, wordId, onlyLabel, onlyGroup, overwrite, false, false, null);
    }

    /**
     * Owner rebuild. With prune, forms whose word no longer fits any rule of that form type (wrong word type, condition no longer
     * matches, no affix) are removed; forms with no rule at all are never touched. With dryRun nothing is changed, the stale forms are only listed.
     */
    @Transactional
    public Map<String, Object> rebuild(long langId, String onlyLabel, String onlyGroup, boolean overwrite, boolean prune, boolean dryRun) {
        List<Map<String, Object>> stale = new ArrayList<>();
        Map<String, Integer> counts = run(langId, null, onlyLabel, onlyGroup, overwrite, prune, dryRun, stale);
        Map<String, Object> out = new LinkedHashMap<>(counts);
        out.put("stale", stale);
        return out;
    }

    /** What a language's form rules need, prepared once (for all its words). */
    public final class Ctx {
        final long langId, worldId;
        final List<Map<String, Object>> rules = new ArrayList<>();
        final Set<String> ruleKeys = new HashSet<>();
        final Map<String, String> classes;
        final String vowels;
        final Map<Long, Pattern> conds = new HashMap<>();
        final List<Long> path = new ArrayList<>();
        final Set<Long> own;
        final Map<Long, List<Evolver.Row>> affixRows = new HashMap<>();
        final Map<Long, Map<String, Object>> affixWords = new HashMap<>();
        final Map<String, List<Evolver.Row>> literalRows = new HashMap<>();
        private Evolver ev;

        Ctx(long langId, String onlyLabel, String onlyGroup, Evolver ev) {
            this.langId = langId;
            this.ev = ev;
            this.own = Set.of(langId);
            for (Map<String, Object> r : db.rows("select * from form_rules where language_id=? order by ord, id", langId)) {
                if (r.get("new_pos") != null && !r.get("new_pos").toString().isBlank()) continue;   // derivations make new words (on demand), not forms
                String grp = r.get("grp") == null ? "" : ((String) r.get("grp")).trim();
                if ((onlyLabel == null || onlyLabel.equalsIgnoreCase((String) r.get("label"))) && (onlyGroup == null || onlyGroup.equalsIgnoreCase(grp))) rules.add(r);
            }
            for (Map<String, Object> rr : rules) ruleKeys.add(((String) rr.get("label")).toLowerCase());
            classes = rules.isEmpty() ? Map.of() : classesOf(langId);
            vowels = classes.getOrDefault("V", "aeiouy");
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
            path.add(langId);
            Long up = parentOf(langId);
            for (int i = 0; up != null && i < 50; i++) {
                path.add(up);
                up = parentOf(up);
            }
            worldId = rules.isEmpty() ? 0 : Db.num(db.one("select world_id from languages where id=?", langId).get("world_id"));
        }

        Evolver ev() {
            if (ev == null) ev = evolvers.build(worldId, null);
            return ev;
        }

        public boolean hasRules() { return !rules.isEmpty(); }
    }

    /** One form as its rule builds it: the form when it comes into use (start), and what it was made of. */
    record Built(Map<String, Object> rule, String label, String form, int start, Integer formYear, String affix, Long affixWord) {}

    public Ctx prepare(long langId, Evolver ev) {
        return new Ctx(langId, null, null, ev);
    }

    /** The forms the rules give a word (one per form type: the first rule that fits wins). baseRows: the word's own history, asked for only if needed. */
    List<Built> build(Ctx c, Map<String, Object> w, java.util.function.Supplier<List<Evolver.Row>> baseRows) {
        List<Built> out = new ArrayList<>();
        String base = (String) w.get("form");
        if (c.rules.isEmpty() || Evolver.isLiteral(base)) return out;   // cross-references have no forms of their own: they show the target's
        int wyear = ((Number) w.get("year")).intValue();
        Set<String> handled = new HashSet<>();
        for (Map<String, Object> r : c.rules) {
            String label = (String) r.get("label"), key = label.toLowerCase();
            if (handled.contains(key) || !posMatches((String) r.get("pos"), (String) w.get("pos"))) continue;
            long rid = Db.num(r.get("id"));
            if (c.conds.containsKey(rid)) {
                Pattern p = c.conds.get(rid);
                if (p == null || !Patterns.found(p, base)) continue;
            }
            String affix = r.get("affix") == null ? "" : (String) r.get("affix");
            int start = r.get("year") == null ? wyear : Math.max(wyear, ((Number) r.get("year")).intValue());
            String baseAt = base;
            if (start != wyear) {
                String at = FormMath.formAt(baseRows.get(), List.of(c.langId), start);
                if (at != null) baseAt = at;
            }
            Long aw = r.get("affix_word_id") == null ? null : Db.num(r.get("affix_word_id"));
            if (aw != null) {
                List<Evolver.Row> rows = affixRowsOf(c, aw);
                String at = rows == null ? null : FormMath.formAt(rows, c.path, start);
                if (at != null && !at.isEmpty()) affix = at; else aw = null;
            }
            if (affix.isEmpty()) continue;
            handled.add(key);
            String form = FormMath.attach(baseAt, (String) r.get("placement"), affix, ((Number) r.get("hiatus")).intValue() != 0, c.vowels);
            out.add(new Built(r, label, form, start, start != wyear ? Integer.valueOf(start) : null, affix, aw));
        }
        return out;
    }

    private List<Evolver.Row> affixRowsOf(Ctx c, long aw) {
        Map<String, Object> aword = c.affixWords.computeIfAbsent(aw, k -> db.one("select id, language_id, form, year from words where id=?", k));
        if (aword == null) return null;
        return c.affixRows.computeIfAbsent(aw, k -> c.ev().evolve(Db.num(aword.get("language_id")),
                (String) aword.get("form"), ((Number) aword.get("year")).intValue(), overridesOf(k)));
    }

    // an ending written in the rule itself goes through the sound changes on its own behind this mark, so that its
    // inner edge is not taken for the edge of a word (a suffix does not start a word)
    private static final String EDGE = "§";

    /** The ending as it is at a year when it goes through the sound changes on its own. */
    private String affixAt(Ctx c, Built b, int year) {
        if (b.affixWord() != null) {
            List<Evolver.Row> rows = affixRowsOf(c, b.affixWord());
            return rows == null ? b.affix() : FormMath.formAt(rows, c.path, year);
        }
        boolean prefix = "prefix".equalsIgnoreCase(String.valueOf(b.rule().get("placement")));
        List<Evolver.Row> rows = c.literalRows.computeIfAbsent(prefix + "|" + b.start() + "|" + b.affix(),
                k -> c.ev().evolve(c.langId, prefix ? b.affix() + EDGE : EDGE + b.affix(), b.start(), List.of(), c.own));
        String at = FormMath.formAt(rows, List.of(c.langId), year);
        return at == null ? b.affix() : at.replace(EDGE, "");
    }

    /** What the rule gives at a year: the word as it is then with the ending as it is then. */
    String regularAt(Ctx c, Built b, List<Evolver.Row> baseRows, int year) {
        String base = FormMath.formAt(baseRows, List.of(c.langId), year), affix = affixAt(c, b, year);
        if (base == null || affix == null || affix.isEmpty()) return null;
        return FormMath.attach(base, (String) b.rule().get("placement"), affix, ((Number) b.rule().get("hiatus")).intValue() != 0, c.vowels);
    }

    /**
     * The first year the form, going through the sound changes as a whole, is no longer its word plus its ending
     * (each gone through them on its own), in the form's own language; null while it stays regular.
     */
    Integer irregularYear(Ctx c, Built b, List<Evolver.Row> baseRows) {
        List<Evolver.Row> whole = c.ev().evolve(c.langId, b.form(), b.start(), List.of(), c.own);
        java.util.TreeSet<Integer> years = new java.util.TreeSet<>();
        for (Evolver.Row r : whole) if (r.langId() == c.langId && r.year() >= b.start()) years.add(r.year());
        for (Evolver.Row r : baseRows) if (r.langId() == c.langId && r.year() > b.start()) years.add(r.year());
        for (int y : years) {
            String w = FormMath.formAt(whole, List.of(c.langId), y), reg = regularAt(c, b, baseRows, y);
            if (w != null && reg != null && !w.equals(reg)) return y;
        }
        return null;
    }

    private List<Evolver.Row> baseRowsOf(Ctx c, Map<String, Object> w) {
        return c.ev().evolve(c.langId, (String) w.get("form"), ((Number) w.get("year")).intValue(), overridesOf(Db.num(w.get("id"))), c.own);
    }

    private static Map<String, Object> row(long wordId, Built b) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", null);
        m.put("word_id", wordId);
        m.put("label", b.label());
        m.put("form", b.form());
        m.put("year", b.formYear());
        m.put("virtual", true);
        return m;
    }

    /**
     * The forms the rules give a word that are not stored (stored: the labels it has stored forms for, lower case),
     * shaped like word_forms rows with "virtual": true. baseRows: the word's own history in its language.
     */
    public List<Map<String, Object>> virtualFor(Ctx c, Map<String, Object> w, List<Evolver.Row> baseRows, Set<String> stored) {
        if (c.rules.isEmpty()) return List.of();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Built b : build(c, w, () -> baseRows)) if (!stored.contains(b.label().toLowerCase())) out.add(row(Db.num(w.get("id")), b));
        return out;
    }

    /**
     * Every form the rules give one word, for the word window: label, form, year, and irregular_year (the year the
     * sound changes made it irregular, or null).
     */
    public List<Map<String, Object>> describe(long langId, Map<String, Object> w, Evolver ev) {
        Ctx c = new Ctx(langId, null, null, ev);
        List<Map<String, Object>> out = new ArrayList<>();
        if (c.rules.isEmpty()) return out;
        List<Evolver.Row> baseRows = baseRowsOf(c, w);
        for (Built b : build(c, w, () -> baseRows)) {
            Map<String, Object> m = row(Db.num(w.get("id")), b);
            m.put("irregular_year", irregularYear(c, b, baseRows));
            out.add(m);
        }
        return out;
    }

    /**
     * Levels a form out: from that year it is what its rule gives then (the word as it is then with the ending as it
     * is then), and goes on from there. year null takes the levelling away. A form the rules give that is not stored
     * yet is stored first. Returns the stored form's row.
     */
    @Transactional
    public Map<String, Object> level(long langId, long wordId, String label, Integer year) {
        Map<String, Object> w = db.one("select id, gloss, pos, form, year from words where id=? and language_id=?", wordId, langId);
        if (w == null) throw new ApiException(404, "No such word in this language.");
        Ctx c = new Ctx(langId, null, null, null);
        Built b = null;
        List<Evolver.Row> baseRows = c.rules.isEmpty() ? List.of() : baseRowsOf(c, w);
        for (Built x : build(c, w, () -> baseRows)) if (x.label().equalsIgnoreCase(label)) b = x;
        Map<String, Object> f = db.one("select * from word_forms where word_id=? and lower(label)=lower(?)", wordId, label);
        if (year == null) {
            if (f != null) db.update("update word_forms set level_year=null, level_form=null where id=?", f.get("id"));
            return f == null ? Map.of() : db.one("select * from word_forms where id=?", f.get("id"));
        }
        if (b == null) throw new ApiException(400, "No form rule gives this word a '" + label + "' form, so there is nothing to level it to.");
        int from = f == null ? b.start() : f.get("year") == null ? ((Number) w.get("year")).intValue() : ((Number) f.get("year")).intValue();
        if (year <= from) throw new ApiException(400, "The year must be after the form came into use (" + from + ").");
        String reg = regularAt(c, b, baseRows, year);
        if (reg == null) throw new ApiException(400, "The rule gives no form in " + year + ".");
        Object id = f != null ? f.get("id")
                : db.insert("insert into word_forms(word_id, label, form, year, irregular_year) values (?,?,?,?,?)", wordId, b.label(), b.form(), b.formYear(), irregularYear(c, b, baseRows));
        db.update("update word_forms set level_year=?, level_form=? where id=?", year, reg, id);
        return db.one("select * from word_forms where id=?", id);
    }

    private Map<String, Integer> run(long langId, Long wordId, String onlyLabel, String onlyGroup, boolean overwrite, boolean prune, boolean dryRun, List<Map<String, Object>> staleOut) {
        Map<String, Integer> out = new LinkedHashMap<>();
        out.put("created", 0);
        out.put("updated", 0);
        out.put("removed", 0);
        out.put("compacted", 0);
        out.put("irregular", 0);
        Ctx c = new Ctx(langId, onlyLabel, onlyGroup, null);
        if (c.rules.isEmpty()) return out;
        List<Map<String, Object>> words = wordId == null
                ? db.rows("select id, gloss, pos, form, year from words where language_id=?", langId)
                : db.rows("select id, gloss, pos, form, year from words where id=? and language_id=?", wordId, langId);
        Map<Long, Map<String, Map<String, Object>>> existing = new HashMap<>();
        for (Map<String, Object> f : db.rows("select f.* from word_forms f join words w on w.id=f.word_id where w.language_id=?", langId)) {
            existing.computeIfAbsent(Db.num(f.get("word_id")), k -> new HashMap<>()).put(((String) f.get("label")).toLowerCase(), f);
        }
        for (Map<String, Object> w : words) {
            long id = Db.num(w.get("id"));
            List<Evolver.Row>[] baseRows = new List[1];
            java.util.function.Supplier<List<Evolver.Row>> base = () -> baseRows[0] == null ? (baseRows[0] = baseRowsOf(c, w)) : baseRows[0];
            Set<String> handled = new HashSet<>();
            for (Built b : build(c, w, base)) {
                String key = b.label().toLowerCase();
                handled.add(key);
                Integer irr = irregularYear(c, b, base.get());
                if (irr != null) out.merge("irregular", 1, Integer::sum);
                Map<String, Object> ex = existing.getOrDefault(id, Map.of()).get(key);
                if (ex == null) {
                    // a regular form is not stored: it is worked out when shown. An irregular one is.
                    if (irr != null) {
                        if (!dryRun) db.insert("insert into word_forms(word_id, label, form, year, irregular_year) values (?,?,?,?,?)", id, b.label(), b.form(), b.formYear(), irr);
                        out.merge("created", 1, Integer::sum);
                    }
                    continue;
                }
                boolean same = b.form().equals(ex.get("form")) && java.util.Objects.equals(b.formYear(), ex.get("year") == null ? null : ((Number) ex.get("year")).intValue());
                if (!same && !overwrite) continue;                       // made or changed by hand: left alone
                boolean levelled = ex.get("level_year") != null;
                if (irr == null && !levelled) {
                    if (!dryRun) db.update("delete from word_forms where id=?", ex.get("id"));
                    out.merge(same ? "compacted" : "updated", 1, Integer::sum);
                } else {
                    Integer had = ex.get("irregular_year") == null ? null : ((Number) ex.get("irregular_year")).intValue();
                    if (!same || !java.util.Objects.equals(had, irr)) {
                        if (!dryRun) db.update("update word_forms set form=?, year=?, irregular_year=? where id=?", b.form(), b.formYear(), irr, ex.get("id"));
                        if (!same) out.merge("updated", 1, Integer::sum);
                    }
                    if (levelled && !dryRun) {   // the levelled form follows the rule as it is now
                        String reg = regularAt(c, b, base.get(), ((Number) ex.get("level_year")).intValue());
                        if (reg != null && !reg.equals(ex.get("level_form"))) db.update("update word_forms set level_form=? where id=?", reg, ex.get("id"));
                    }
                }
            }
            if (prune) {
                for (Map.Entry<String, Map<String, Object>> e : existing.getOrDefault(id, Map.of()).entrySet()) {
                    if (!c.ruleKeys.contains(e.getKey()) || handled.contains(e.getKey())) continue;
                    Map<String, Object> stale = new LinkedHashMap<>();
                    stale.put("form_id", e.getValue().get("id"));
                    stale.put("word_id", id);
                    stale.put("gloss", w.get("gloss"));
                    stale.put("label", e.getValue().get("label"));
                    stale.put("form", e.getValue().get("form"));
                    if (staleOut != null) staleOut.add(stale);
                    if (!dryRun) {
                        db.update("delete from word_forms where id=?", e.getValue().get("id"));
                        out.merge("removed", 1, Integer::sum);
                    }
                }
            }
        }
        return out;
    }
}
