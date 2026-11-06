package com.conlangs.web;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import org.springframework.stereotype.Service;

/** Read-side logic: computed dictionary fields, word histories, rule previews, compounds, bulk entry. */
@Service
public class DictService {
    private final Db db;
    private final Access access;
    private final Store store;
    private final EvolverFactory evolvers;

    public DictService(Db db, Access access, Store store, EvolverFactory evolvers) {
        this.db = db;
        this.access = access;
        this.store = store;
        this.evolvers = evolvers;
    }

    public Evolver evolverFor(long worldId, Evolver.Rule extra) {
        return evolvers.build(worldId, extra);
    }

    private List<Evolver.Override> overridesOf(long wordId) {
        List<Evolver.Override> out = new ArrayList<>();
        for (Map<String, Object> o : db.rows("select lang_id, year, form from word_overrides where word_id=?", wordId)) {
            out.add(new Evolver.Override(Db.num(o.get("lang_id")), ((Number) o.get("year")).intValue(), (String) o.get("form")));
        }
        return out;
    }

    public static String ipa(String form, String mapText) {
        if (mapText == null || mapText.isBlank()) return "";
        Map<String, String> m = new LinkedHashMap<>();
        for (String line : mapText.split("\\R")) {
            int eq = line.indexOf('=');
            if (eq > 0 && !line.trim().startsWith("//")) m.put(line.substring(0, eq).trim(), line.substring(eq + 1).trim());
        }
        List<String> keys = new ArrayList<>(m.keySet());
        keys.sort(Comparator.comparingInt(String::length).reversed());
        StringBuilder sb = new StringBuilder();
        int i = 0;
        outer:
        while (i < form.length()) {
            for (String k : keys) {
                if (!k.isEmpty() && form.startsWith(k, i)) {
                    sb.append(m.get(k));
                    i += k.length();
                    continue outer;
                }
            }
            char c = form.charAt(i++);
            if (c != '\'') sb.append(c);
        }
        return sb.toString();
    }

    /** Last form of each language branch: name to form. */
    private static Map<String, Object> latestPerBranch(List<Evolver.Row> rows) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Evolver.Row r : rows) {
            if (!r.source().equals("ERROR")) out.put(r.langName(), r.form());
        }
        return out;
    }

    private Map<Long, Map<String, Object>> langsOf(long worldId) {
        Map<Long, Map<String, Object>> m = new HashMap<>();
        for (Map<String, Object> l : db.rows("select id, name, parent_id, split_year from languages where world_id=?", worldId)) m.put(Db.num(l.get("id")), l);
        return m;
    }

    /** Root first, ending with the language itself. */
    private static List<Long> pathRootFirst(long langId, Map<Long, Map<String, Object>> langs) {
        List<Long> p = new ArrayList<>();
        Long cur = langId;
        for (int i = 0; cur != null && i < 100; i++) {
            p.add(0, cur);
            Map<String, Object> l = langs.get(cur);
            cur = l == null || l.get("parent_id") == null ? null : Db.num(l.get("parent_id"));
        }
        return p;
    }

    private static List<Integer> splitsOf(List<Long> path, Map<Long, Map<String, Object>> langs) {
        List<Integer> out = new ArrayList<>();
        for (int i = 1; i < path.size(); i++) {
            Object sy = langs.get(path.get(i)).get("split_year");
            out.add(sy == null ? null : ((Number) sy).intValue());
        }
        return out;
    }

    private static Meanings.Ev meaningEv(Map<String, Object> m) {
        return new Meanings.Ev(Db.num(m.get("lang_id")), ((Number) m.get("year")).intValue(), (String) m.get("mode"), (String) m.get("meaning"));
    }

    /** Words whose form is a cross-reference (see "wind") take over the forms of the word they point to. */
    private static void resolveRefs(List<Map<String, Object>> out, Map<Long, Map<String, Object>> late) {
        Map<Long, Refs.Ref> refOf = new HashMap<>();
        Map<Long, Map<String, Object>> byId = new HashMap<>();
        for (Map<String, Object> m : out) {
            long id = Db.num(m.get("id"));
            byId.put(id, m);
            Refs.Ref ref = Refs.parse((String) m.get("form"));
            if (ref != null) refOf.put(id, ref);
        }
        for (Map<String, Object> m : out) {
            Refs.Ref ref = refOf.get(Db.num(m.get("id")));
            if (ref == null) continue;
            Map<String, Object> t = m;
            for (int hop = 0; hop < 5 && ref != null; hop++) {
                Map<String, Object> next = null;
                if (ref.id() != null) {
                    next = byId.get(ref.id());
                    if (next == null) next = late.get(ref.id());
                } else {
                    String want = Refs.norm(ref.gloss());
                    for (Map<String, Object> c : out) {
                        if (c != m && Refs.norm((String) c.get("gloss")).equals(want)) {
                            if (next == null || (refOf.containsKey(Db.num(next.get("id"))) && !refOf.containsKey(Db.num(c.get("id"))))) next = c;
                        }
                    }
                }
                if (next == null) {
                    String want = ref.gloss() == null ? null : Refs.norm(ref.gloss());
                    for (Map<String, Object> c : late.values()) if (want != null && Refs.norm((String) c.get("gloss")).equals(want)) { next = c; break; }
                }
                if (next == null || next == m) { t = null; break; }
                t = next;
                ref = refOf.get(Db.num(t.get("id")));
            }
            if (t == null || t == m || refOf.containsKey(Db.num(t.get("id")))) { m.put("ref_missing", true); m.put("ref_text", m.get("form")); continue; }
            m.put("ref_text", m.get("form"));
            if (late.containsKey(Db.num(t.get("id")))) m.put("ref_late", t.get("origin_lang"));
            m.put("ref_to", t.get("id"));
            m.put("ref_gloss", t.get("gloss"));
            m.put("form", t.get("form"));
            m.put("length", t.get("length"));
            m.put("pronunciation", t.get("pronunciation"));
            m.put("latest", t.get("latest"));
            m.put("forms", t.get("forms"));
        }
    }

    /** The word a cross-reference points to, looked up in a language and its ancestors; null if there is none. */
    private Map<String, Object> refTarget(String form, long langId) {
        List<Long> langs = new ArrayList<>();
        langs.add(langId);
        langs.addAll(access.ancestors(langId));
        Refs.Ref ref = Refs.parse(form);
        for (int hop = 0; hop < 5 && ref != null; hop++) {
            Map<String, Object> found = null;
            for (long l : langs) {
                for (Map<String, Object> c : db.rows("select * from words where language_id=? order by year, id", l)) {
                    boolean hit = ref.id() != null ? Db.num(c.get("id")) == ref.id() : Refs.norm((String) c.get("gloss")).equals(Refs.norm(ref.gloss()));
                    if (hit) { found = c; break; }
                }
                if (found != null) break;
            }
            if (found == null) return null;
            ref = Refs.parse((String) found.get("form"));
            if (ref == null) return found;
        }
        return null;
    }

    private static Map<String, Object> latestPerBranch(List<Evolver.Row> rows, Set<Long> only) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Evolver.Row r : rows) {
            if (!r.source().equals("ERROR") && only.contains(r.langId())) out.put(r.langName(), r.form());
        }
        return out;
    }

    /**
     * The dictionary of a language: the words entered in it, plus the words of its ancestors that had already
     * been coined when this language split off, shown in THEIR form in this language (inherited = true).
     */
    public List<Map<String, Object>> words(long uid, long langId) {
        Map<String, Object> lang = access.need(uid, langId, Access.VIEWER);
        long worldId = Db.num(lang.get("world_id"));
        String langName = (String) lang.get("name");
        Evolver ev = evolverFor(worldId, null);

        List<Long> sources = new ArrayList<>();
        sources.add(langId);
        for (long anc : access.ancestors(langId)) if (access.level(uid, anc) >= Access.VIEWER) sources.add(anc);
        Set<Long> branchSet = new HashSet<>();
        branchSet.add(langId);
        branchSet.addAll(access.descendants(langId));
        Map<Long, String> names = new HashMap<>();
        for (Map<String, Object> l : db.rows("select id, name from languages where world_id=?", worldId)) names.put(Db.num(l.get("id")), (String) l.get("name"));
        Set<String> ancestorNames = new HashSet<>();
        for (long src : sources) if (src != langId) ancestorNames.add(names.get(src));

        Map<String, List<String>> elsewhere = new HashMap<>();
        for (Map<String, Object> r : db.rows("select lower(w.gloss) as g, l.name as lname from words w join languages l on l.id=w.language_id where l.world_id=? and l.id<>?", worldId, langId)) {
            elsewhere.computeIfAbsent((String) r.get("g"), k -> new ArrayList<>()).add((String) r.get("lname"));
        }
        String ipaMap = (String) lang.get("ipa_map");
        Map<Long, Map<String, Object>> langMap = langsOf(worldId);
        List<Long> fullPath = pathRootFirst(langId, langMap);
        List<Map<String, Object>> out = new ArrayList<>();
        Map<Long, Map<String, Object>> late = new HashMap<>();   // ancestor words coined after this language split off
        for (long src : sources) {
            List<Long> subPath = fullPath.subList(Math.max(0, fullPath.indexOf(src)), fullPath.size());
            List<Integer> cuts = splitsOf(subPath, langMap);
            Map<Long, List<Meanings.Ev>> meaningsByWord = new HashMap<>();
            for (Map<String, Object> mm : db.rows("select m.* from word_meanings m join words w on w.id=m.word_id where w.language_id=?", src)) {
                meaningsByWord.computeIfAbsent(Db.num(mm.get("word_id")), k -> new ArrayList<>()).add(meaningEv(mm));
            }
            boolean inherited = src != langId;
            Map<Long, List<Evolver.Override>> ovr = new HashMap<>();
            for (Map<String, Object> o : db.rows("select o.word_id, o.lang_id, o.year, o.form from word_overrides o join words w on w.id=o.word_id where w.language_id=?", src)) {
                ovr.computeIfAbsent(Db.num(o.get("word_id")), k -> new ArrayList<>())
                        .add(new Evolver.Override(Db.num(o.get("lang_id")), ((Number) o.get("year")).intValue(), (String) o.get("form")));
            }
            Map<Long, List<Map<String, Object>>> formsByWord = new HashMap<>();
            for (Map<String, Object> f : db.rows("select f.* from word_forms f join words w on w.id=f.word_id where w.language_id=? order by f.id", src)) {
                formsByWord.computeIfAbsent(Db.num(f.get("word_id")), k -> new ArrayList<>()).add(f);
            }
            for (Map<String, Object> w : db.rows("select * from words where language_id=? order by lower(gloss), year, id", src)) {
                long id = Db.num(w.get("id"));
                String form = (String) w.get("form");
                int wyear = ((Number) w.get("year")).intValue();
                List<Evolver.Row> rows = ev.evolve(src, form, wyear, ovr.getOrDefault(id, List.of()));
                if (inherited && rows.stream().noneMatch(r -> r.langId() == langId)) {   // coined after the split
                    String fin = form;
                    for (Evolver.Row rr : rows) if (rr.langId() == src && !rr.source().equals("ERROR")) fin = rr.form();
                    Map<String, Object> lv = new LinkedHashMap<>(w);
                    lv.put("form", fin);
                    lv.put("origin_lang", names.get(src));
                    lv.put("length", Patterns.length(fin));
                    lv.put("pronunciation", ipa(fin, ipaMap));
                    lv.put("latest", Map.of(names.get(src), fin));
                    lv.put("forms", List.of());
                    late.put(id, lv);
                    continue;
                }
                Map<String, Object> latest = latestPerBranch(rows, branchSet);
                String shown = form;
                if (inherited) {
                    Object bf = latest.get(langName);
                    if (bf != null) shown = bf.toString();
                }
                Map<String, Object> m = new LinkedHashMap<>(w);
                m.put("form", shown);
                m.put("inherited", inherited);
                if (inherited) {
                    m.put("origin_lang", names.get(src));
                    m.put("origin_lang_id", src);
                    m.put("origin_form", form);
                }
                m.put("length", Patterns.length(shown));
                m.put("pronunciation", ipa(shown, ipaMap));
                Set<String> also = new HashSet<>(elsewhere.getOrDefault(((String) w.get("gloss")).toLowerCase(), List.of()));
                if (inherited) also.removeAll(ancestorNames);
                m.put("exists_in", also);
                m.put("latest", latest);
                List<String> problems = new ArrayList<>();
                if (wyear == 0) problems.add("no year set (the year is 0)");
                if (form == null || form.isBlank()) problems.add("the form is empty");
                for (Evolver.Row er : rows) {
                    if (er.source().equals("ERROR") && branchSet.contains(er.langId())) problems.add("sound change error in " + er.langName() + ": " + er.rule());
                }
                m.put("problems", problems);
                m.put("has_overrides", ovr.containsKey(id));
                List<String> senses = Meanings.senses((String) w.get("gloss"), meaningsByWord.getOrDefault(id, List.of()), subPath, cuts, null);
                m.put("meaning", String.join("; ", senses));
                m.put("meaning_changed", !senses.equals(List.of((String) w.get("gloss"))));
                List<Map<String, Object>> fs = new ArrayList<>();
                for (Map<String, Object> f : formsByWord.getOrDefault(id, List.of())) {
                    Map<String, Object> fm = new LinkedHashMap<>(f);
                    int fy = f.get("year") == null ? wyear : ((Number) f.get("year")).intValue();
                    fm.put("latest", latestPerBranch(ev.evolve(src, (String) f.get("form"), fy, List.of()), branchSet));
                    fs.add(fm);
                }
                m.put("forms", fs);
                out.add(m);
            }
        }
        resolveRefs(out, late);
        for (Map<String, Object> m : out) {
            if (Boolean.TRUE.equals(m.get("ref_missing"))) {
                @SuppressWarnings("unchecked")
                List<String> pl = (List<String>) m.get("problems");
                pl.add("refers to a word that doesn't exist: " + m.get("ref_text"));
            }
        }
        for (Map<String, Object> m : out) {
            if (m.get("loan_word_id") == null) continue;
            Map<String, Object> lw = db.one("select w.gloss, w.language_id, l.name as lname from words w join languages l on l.id=w.language_id where w.id=?", Db.num(m.get("loan_word_id")));
            m.put("loan_from", lw == null ? "a word that no longer exists" : lw.get("lname") + ": " + lw.get("gloss"));
        }
        out.sort(Comparator.comparing((Map<String, Object> m) -> ((String) m.get("gloss")).toLowerCase())
                .thenComparingInt(m -> ((Number) m.get("year")).intValue())
                .thenComparingLong(m -> Db.num(m.get("id"))));
        return out;
    }

    public Map<String, Object> history(long uid, long wordId) {
        Map<String, Object> w = db.one("select * from words where id=?", wordId);
        if (w == null) throw new ApiException(404, "No such word.");
        long langId = Db.num(w.get("language_id"));
        Map<String, Object> lang = access.need(uid, langId, Access.VIEWER);
        Evolver ev = evolverFor(Db.num(lang.get("world_id")), null);
        List<Evolver.Row> rows = ev.evolve(langId, (String) w.get("form"), ((Number) w.get("year")).intValue(), overridesOf(wordId));
        Map<String, Object> target = refTarget((String) w.get("form"), langId);
        if (target != null) {
            rows = ev.evolve(Db.num(target.get("language_id")), (String) target.get("form"), ((Number) target.get("year")).intValue(), overridesOf(Db.num(target.get("id"))));
        }
        List<Map<String, Object>> forms = new ArrayList<>();
        Map<String, Object> formOwner = target != null ? target : w;   // a cross-reference shows the forms of the word it points to
        long formLang = Db.num(formOwner.get("language_id"));
        for (Map<String, Object> f : db.rows("select * from word_forms where word_id=? order by id", Db.num(formOwner.get("id")))) {
            Map<String, Object> fm = new LinkedHashMap<>(f);
            int fy = f.get("year") == null ? ((Number) formOwner.get("year")).intValue() : ((Number) f.get("year")).intValue();
            fm.put("history", historyMaps(ev.evolve(formLang, (String) f.get("form"), fy, List.of())));
            forms.add(fm);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("word", w);
        if (w.get("loan_word_id") != null) {
            Map<String, Object> lw = db.one("select w.gloss, l.name as lname from words w join languages l on l.id=w.language_id where w.id=?", Db.num(w.get("loan_word_id")));
            out.put("loan_from", lw == null ? "a word that no longer exists" : lw.get("lname") + ": " + lw.get("gloss"));
        }
        if (target != null) out.put("ref", Map.of("id", target.get("id"), "gloss", target.get("gloss"), "form", target.get("form")));
        out.put("history", historyMaps(rows));
        out.put("forms", forms);
        out.put("overrides", db.rows("select * from word_overrides where word_id=? order by year", wordId));
        out.put("meanings", db.rows("select * from word_meanings where word_id=? order by year, id", wordId));
        Map<Long, Map<String, Object>> langMap = langsOf(Db.num(lang.get("world_id")));
        List<Meanings.Ev> evs = new ArrayList<>();
        for (Map<String, Object> mm : db.rows("select * from word_meanings where word_id=?", wordId)) evs.add(meaningEv(mm));
        Map<String, Object> byLang = new LinkedHashMap<>();
        Set<Long> branch = new HashSet<>(access.descendants(langId));
        branch.add(langId);
        for (long lid : branch) {
            List<Long> full = pathRootFirst(lid, langMap);
            List<Long> sub = full.subList(Math.max(0, full.indexOf(langId)), full.size());
            byLang.put((String) langMap.get(lid).get("name"), String.join("; ", Meanings.senses((String) w.get("gloss"), evs, sub, splitsOf(sub, langMap), null)));
        }
        out.put("meaning_by_lang", byLang);
        return out;
    }

    private static List<Map<String, Object>> historyMaps(List<Evolver.Row> rows) {
        List<Map<String, Object>> hist = new ArrayList<>();
        for (Evolver.Row r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("lang_id", r.langId());
            m.put("lang", r.langName());
            m.put("year", r.year());
            m.put("form", r.form());
            m.put("source", r.source());
            m.put("rule", r.rule());
            hist.add(m);
        }
        return hist;
    }

    /** What would change in this language's dictionary if a rule were added? */
    public Map<String, Object> previewRule(long uid, long langId, Map<String, Object> body) {
        Map<String, Object> lang = access.need(uid, langId, Access.EDITOR);
        Map<String, Object> clean = store.validate(langId, "rule", "CREATE", null, body);
        Evolver.Rule extra = new Evolver.Rule(-1, langId, ((Number) clean.get("year")).intValue(), ((Number) clean.get("ord")).intValue(),
                "preview", (String) clean.get("pattern"), (String) clean.get("replacement"));
        long worldId = Db.num(lang.get("world_id"));
        Evolver base = evolverFor(worldId, null), with = evolverFor(worldId, extra);
        List<Map<String, Object>> changes = new ArrayList<>();
        int affected = 0;
        List<Long> sources = new ArrayList<>();
        sources.add(langId);
        for (long anc : access.ancestors(langId)) if (access.level(uid, anc) >= Access.VIEWER) sources.add(anc);
        List<Map<String, Object>> srcWords = new ArrayList<>();
        for (long src : sources) srcWords.addAll(db.rows("select * from words where language_id=? order by lower(gloss)", src));
        for (Map<String, Object> w : srcWords) {
            long id = Db.num(w.get("id"));
            long srcLang = Db.num(w.get("language_id"));
            int yr = ((Number) w.get("year")).intValue();
            Map<String, Object> a = latestPerBranch(base.evolve(srcLang, (String) w.get("form"), yr, overridesOf(id)));
            Map<String, Object> b = latestPerBranch(with.evolve(srcLang, (String) w.get("form"), yr, overridesOf(id)));
            boolean any = false;
            for (String k : b.keySet()) {
                if (!b.get(k).equals(a.get(k))) {
                    any = true;
                    if (changes.size() < 300) {
                        Map<String, Object> m = new LinkedHashMap<>();
                        m.put("gloss", w.get("gloss"));
                        m.put("branch", k);
                        m.put("before", a.get(k));
                        m.put("after", b.get(k));
                        changes.add(m);
                    }
                }
            }
            if (any) affected++;
        }
        return Map.of("wordsAffected", affected, "changes", changes);
    }

    /** Which languages this one inherits from, and whatever stops their words from reaching it. */
    /** New root forms that sound like the language: learned from the forms it has now, never equal to or close to an existing word. */
    public Map<String, Object> suggestRoots(long uid, long langId, int count, int minSyl, int maxSyl, Long seed) {
        access.need(uid, langId, Access.VIEWER);
        List<Map<String, Object>> ws = words(uid, langId);
        List<String> corpus = new ArrayList<>(), taken = new ArrayList<>();
        for (Map<String, Object> w : ws) {
            Object f = w.get("form"), of = w.get("origin_form");
            if (f != null) { corpus.add(f.toString()); taken.add(f.toString()); }
            if (of != null) taken.add(of.toString());
            Object fs = w.get("forms");
            if (fs instanceof List<?> l) for (Object x : l) if (x instanceof Map<?, ?> fm && fm.get("form") != null) taken.add(fm.get("form").toString());
        }
        int c = Math.max(1, Math.min(count, 40)), lo = Math.max(1, Math.min(minSyl, 6)), hi = Math.max(lo, Math.min(maxSyl, 6));
        long sd = seed == null ? System.nanoTime() : seed;
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("roots", RootSuggester.suggest(corpus, taken, c, lo, hi, sd));
        out.put("learnedFrom", corpus.size());
        return out;
    }

    /**
     * The sounds a language uses over time, worked out from the forms of its words. The forms are taken at the language's split year,
     * at every year one of its own sound changes starts, and at {@code to}; each of those years lists the sounds in use and how many words use each.
     */
    public Map<String, Object> autoSounds(long uid, long langId, Integer to) {
        Map<String, Object> lang = access.need(uid, langId, Access.VIEWER);
        long worldId = Db.num(lang.get("world_id"));
        Evolver ev = evolverFor(worldId, null);
        Map<Long, Map<String, Object>> langMap = langsOf(worldId);
        List<Long> nearestFirst = new ArrayList<>(pathRootFirst(langId, langMap));
        java.util.Collections.reverse(nearestFirst);
        List<Long> sources = new ArrayList<>();
        sources.add(langId);
        for (long anc : access.ancestors(langId)) if (access.level(uid, anc) >= Access.VIEWER) sources.add(anc);

        record W(String form, int year, List<Evolver.Row> rows) {}
        List<W> ws = new ArrayList<>();
        Integer minYear = null;
        for (long src : sources) {
            Map<Long, List<Evolver.Override>> ovr = new HashMap<>();
            for (Map<String, Object> o : db.rows("select o.word_id, o.lang_id, o.year, o.form from word_overrides o join words w on w.id=o.word_id where w.language_id=?", src)) {
                ovr.computeIfAbsent(Db.num(o.get("word_id")), k -> new ArrayList<>())
                        .add(new Evolver.Override(Db.num(o.get("lang_id")), ((Number) o.get("year")).intValue(), (String) o.get("form")));
            }
            for (Map<String, Object> w : db.rows("select id, form, year from words where language_id=?", src)) {
                String form = (String) w.get("form");
                if (form == null || form.isBlank() || Evolver.isLiteral(form) || Refs.parse(form) != null) continue;
                int wy = ((Number) w.get("year")).intValue();
                List<Evolver.Row> rows = ev.evolve(src, form, wy, ovr.getOrDefault(Db.num(w.get("id")), List.of()));
                if (src != langId && rows.stream().noneMatch(r -> r.langId() == langId)) continue;   // coined after this language split off
                ws.add(new W(form, wy, rows));
                if (src == langId) minYear = minYear == null ? wy : Math.min(minYear, wy);
            }
        }
        Object sy = lang.get("split_year");
        int from = sy != null ? ((Number) sy).intValue() : minYear != null ? minYear : 0;
        int end = to == null ? Math.max(900, from) : Math.max(to, from);

        TreeMap<Integer, List<String>> events = new TreeMap<>();
        events.put(from, new ArrayList<>());
        events.put(end, new ArrayList<>());
        for (Map<String, Object> r : db.rows("select year, name, pattern from rules where language_id=? order by year, ord, id", langId)) {
            int y = ((Number) r.get("year")).intValue();
            if (y < from || y > end) continue;
            String nm = r.get("name") == null || r.get("name").toString().isBlank() ? r.get("pattern").toString() : r.get("name").toString();
            events.computeIfAbsent(y, k -> new ArrayList<>()).add(nm);
        }
        List<Integer> years = new ArrayList<>(events.keySet());

        Map<String, InventoryBuilder.Sound> own = new HashMap<>();
        Set<String> userSymbols = new HashSet<>();
        for (Map<String, Object> p : db.rows("select symbol, kind, row_label, col_label, notes from phonemes where language_id=?", langId)) {
            String sym = p.get("symbol").toString().toLowerCase();
            String notes = p.get("notes") == null ? "" : p.get("notes").toString();
            if (notes.startsWith(AUTO_SOUND_NOTE)) continue;
            userSymbols.add(sym);
            own.put(sym, new InventoryBuilder.Sound(sym, p.get("kind").toString(), p.get("row_label") == null ? "" : p.get("row_label").toString(),
                    p.get("col_label") == null ? "" : p.get("col_label").toString(), sym, true));
        }

        Map<String, Map<String, Object>> sounds = new LinkedHashMap<>();
        List<Integer> wordCounts = new ArrayList<>();
        for (int yi = 0; yi < years.size(); yi++) {
            int y = years.get(yi);
            List<String> forms = new ArrayList<>();
            for (W w : ws) {
                if (w.year() > y) continue;
                String f = FormMath.formAt(w.rows(), nearestFirst, y);
                if (f != null && !f.isBlank()) forms.add(f);
            }
            wordCounts.add(forms.size());
            for (Map.Entry<String, Object[]> e : InventoryBuilder.inventory(forms, own).entrySet()) {
                Map<String, Object> s = sounds.get(e.getKey());
                if (s == null) {
                    InventoryBuilder.Sound c = InventoryBuilder.classify(e.getKey(), own);
                    s = new LinkedHashMap<>();
                    s.put("symbol", c.symbol()); s.put("kind", c.kind()); s.put("row", c.row()); s.put("col", c.col());
                    s.put("ipa", c.ipa()); s.put("known", c.known()); s.put("own", userSymbols.contains(e.getKey()));
                    s.put("counts", new ArrayList<>(java.util.Collections.nCopies(years.size(), 0)));
                    List<String> ex = new ArrayList<>();
                    if (e.getValue()[1] != null) ex.add((String) e.getValue()[1]);
                    if (e.getValue()[2] != null) ex.add((String) e.getValue()[2]);
                    s.put("examples", ex);
                    sounds.put(e.getKey(), s);
                }
                @SuppressWarnings("unchecked")
                List<Integer> counts = (List<Integer>) s.get("counts");
                counts.set(yi, (Integer) e.getValue()[0]);
            }
        }
        List<Map<String, Object>> ev2 = new ArrayList<>();
        for (int i = 0; i < years.size(); i++) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("year", years.get(i)); m.put("rules", events.get(years.get(i))); m.put("words", wordCounts.get(i));
            ev2.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("from", from); out.put("to", end);
        out.put("events", ev2);
        out.put("sounds", new ArrayList<>(sounds.values()));
        out.put("words", ws.size());
        return out;
    }

    static final String AUTO_SOUND_NOTE = "auto-built";

    /** Replaces the sounds made by an earlier auto-build with a fresh set, one entry per stretch of years a sound is in use. */
    public Map<String, Object> applyAutoSounds(long uid, long langId, Integer to) {
        access.need(uid, langId, Access.EDITOR);
        Map<String, Object> res = autoSounds(uid, langId, to);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> events = (List<Map<String, Object>>) res.get("events");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> sounds = (List<Map<String, Object>>) res.get("sounds");
        int last = events.size() - 1;
        int removed = 0, added = 0, kept = 0;
        for (Map<String, Object> p : db.rows("select id, notes from phonemes where language_id=?", langId)) {
            if (p.get("notes") != null && p.get("notes").toString().startsWith(AUTO_SOUND_NOTE)) {
                store.submit(uid, langId, "phoneme", "DELETE", Db.num(p.get("id")), new LinkedHashMap<>());
                removed++;
            }
        }
        for (Map<String, Object> s : sounds) {
            if (Boolean.TRUE.equals(s.get("own"))) { kept++; continue; }
            @SuppressWarnings("unchecked")
            List<Integer> counts = (List<Integer>) s.get("counts");
            int i = 0;
            while (i <= last) {
                if (counts.get(i) == 0) { i++; continue; }
                int j = i;
                while (j + 1 <= last && counts.get(j + 1) > 0) j++;
                Map<String, Object> p = new LinkedHashMap<>();
                p.put("symbol", s.get("symbol")); p.put("kind", s.get("kind")); p.put("row_label", s.get("row")); p.put("col_label", s.get("col"));
                String ipa = String.valueOf(s.get("ipa"));
                p.put("notes", AUTO_SOUND_NOTE + (ipa.equals(s.get("symbol")) ? "" : ": /" + ipa + "/") + (Boolean.TRUE.equals(s.get("known")) ? "" : " (not recognised – please place it)"));
                if (i > 0) p.put("year", events.get(i).get("year"));
                if (j < last) p.put("year_to", events.get(j + 1).get("year"));
                store.submit(uid, langId, "phoneme", "CREATE", null, p);
                added++;
                i = j + 1;
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("added", added); out.put("removed", removed); out.put("keptYours", kept);
        return out;
    }

    public Map<String, Object> treeCheck(long uid, long langId) {
        Map<String, Object> lang = access.need(uid, langId, Access.VIEWER);
        long worldId = Db.num(lang.get("world_id"));
        List<TreeCheck.Node> nodes = new ArrayList<>();
        Map<Long, String> names = new HashMap<>();
        for (Map<String, Object> l : db.rows("select id, name, parent_id, split_year from languages where world_id=?", worldId)) {
            nodes.add(new TreeCheck.Node(Db.num(l.get("id")), (String) l.get("name"),
                    l.get("parent_id") == null ? null : Db.num(l.get("parent_id")),
                    l.get("split_year") == null ? null : ((Number) l.get("split_year")).intValue()));
            names.put(Db.num(l.get("id")), (String) l.get("name"));
        }
        TreeCheck.Result r = TreeCheck.check(langId, nodes);
        List<String> problems = new ArrayList<>(r.problems());
        for (long anc : access.ancestors(langId)) {
            if (access.level(uid, anc) < Access.VIEWER) problems.add("You don't have access to " + names.get(anc) + ", so its words are not shown here.");
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("lineage", r.lineage());
        out.put("problems", problems);
        return out;
    }

    /** Joins components and runs automatic erosion, returning each intermediate form. */
    public Map<String, Object> compound(long uid, long langId, List<Object> parts) {
        Map<String, Object> lang = access.need(uid, langId, Access.EDITOR);
        if (parts == null || parts.isEmpty()) throw new ApiException(400, "Give at least one part.");
        StringBuilder joined = new StringBuilder();
        List<String> used = new ArrayList<>();
        for (Object p : parts) {
            if (p instanceof Number n) {
                Map<String, Object> w = db.one("select form, gloss from words where id=? and language_id=?", n.longValue(), langId);
                if (w == null) throw new ApiException(404, "Word " + n + " isn't in this language.");
                joined.append(w.get("form"));
                used.add((String) w.get("gloss"));
            } else {
                joined.append(p);
                used.add("'" + p + "'");
            }
        }
        Set<String> avoid = new HashSet<>();
        for (Map<String, Object> w : db.rows("select form from words where language_id=?", langId)) avoid.add((String) w.get("form"));
        StringBuilder classes = new StringBuilder();
        for (Map.Entry<String, String> e : store.classesOf(langId).entrySet()) classes.append(e.getKey()).append('=').append(e.getValue()).append('\n');
        int target = lang.get("erosion_target") == null ? 0 : ((Number) lang.get("erosion_target")).intValue();
        List<Erosion.Step> steps = Erosion.erode(joined.toString(), (String) lang.get("erosion"), classes.toString(), target, avoid);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Erosion.Step s : steps) out.add(Map.of("form", s.form(), "rule", s.rule()));
        return Map.of("joined", joined.toString(), "parts", used, "steps", out);
    }

    /** Bulk entry: lines of gloss;pos;form;year;notes (tab or semicolon separated). All-or-nothing. */
    /**
     * A borrowed word takes the form the source word had in the source language in the year of borrowing. The result is
     * stored as an ordinary form (the borrowing language's own sound changes then apply from that year), with loan_word_id
     * remembering where it came from. Without loan_word_id the payload is returned unchanged.
     */
    public Map<String, Object> resolveLoan(long uid, long langId, Map<String, Object> payload) {
        if (!payload.containsKey("loan_word_id")) return payload;
        Map<String, Object> out = new LinkedHashMap<>(payload);
        Object lw = payload.get("loan_word_id");
        if (lw == null || lw.toString().isBlank()) { out.put("loan_word_id", null); return out; }
        Map<String, Object> lang = access.need(uid, langId, Access.EDITOR);
        long worldId = Db.num(lang.get("world_id"));
        long srcId;
        try { srcId = Long.parseLong(lw.toString().trim()); } catch (NumberFormatException e) { throw new ApiException(400, "Pick the word to borrow."); }
        Map<String, Object> sw = db.one("select * from words where id=?", srcId);
        if (sw == null) throw new ApiException(404, "The word to borrow doesn't exist.");
        long srcLang = Db.num(sw.get("language_id"));
        Map<String, Object> sl = access.need(uid, srcLang, Access.VIEWER);
        if (Db.num(sl.get("world_id")) != worldId) throw new ApiException(400, "A word can only be borrowed from a language in the same world.");
        if (srcLang == langId) throw new ApiException(400, "Pick a word from another language.");
        Object y = payload.get("year");
        if (y == null || y.toString().isBlank()) throw new ApiException(400, "Give the year of borrowing.");
        int year;
        try { year = (int) Math.round(Double.parseDouble(y.toString().trim())); } catch (NumberFormatException e) { throw new ApiException(400, "The year must be a number."); }
        Map<String, Object> base = sw;
        Map<String, Object> target = refTarget((String) sw.get("form"), srcLang);
        if (target != null) base = target;
        long baseLang = Db.num(base.get("language_id"));
        int start = ((Number) base.get("year")).intValue();
        if (year < start) throw new ApiException(400, "\"" + sw.get("gloss") + "\" doesn't exist in " + sl.get("name") + " until " + start + ", so it can't be borrowed in " + year + ".");
        Evolver ev = evolverFor(worldId, null);
        List<Evolver.Row> rows = ev.evolve(baseLang, (String) base.get("form"), start, overridesOf(Db.num(base.get("id"))));
        List<Long> path = new ArrayList<>();
        path.add(srcLang);
        path.addAll(access.ancestors(srcLang));
        String form = FormMath.formAt(rows, path, year);
        if (form == null || form.isBlank()) throw new ApiException(400, "That word has no form in " + sl.get("name") + " in " + year + ".");
        out.put("loan_word_id", srcId);
        out.put("form", form);
        if (out.get("ref_word_id") != null) out.put("ref_word_id", null);
        if (out.get("build") == null || out.get("build").toString().isBlank()) out.put("build", "loan");
        return out;
    }

    /** Import sounds from a pasted table (text) or a ready list of maps (sounds); adds new ones, updates ones with the same symbol, kind and years. */
    public Map<String, Object> importSounds(long uid, long langId, String text, List<Map<String, Object>> sounds, boolean dryRun) {
        access.need(uid, langId, Access.EDITOR);
        List<String> errors = new ArrayList<>();
        List<Map<String, Object>> in = new ArrayList<>();
        if (sounds != null) {
            for (Map<String, Object> s : sounds) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("symbol", String.valueOf(s.getOrDefault("symbol", "")).strip());
                m.put("kind", String.valueOf(s.getOrDefault("kind", "")).strip().toLowerCase());
                Object row = s.get("row_label") != null ? s.get("row_label") : s.get("row");
                Object col = s.get("col_label") != null ? s.get("col_label") : s.get("column") != null ? s.get("column") : s.get("col");
                m.put("row_label", row == null ? "" : row.toString());
                m.put("col_label", col == null ? "" : col.toString());
                m.put("notes", s.get("notes") == null ? "" : s.get("notes").toString());
                Object from = s.get("year") != null ? s.get("year") : s.get("from");
                Object until = s.get("year_to") != null ? s.get("year_to") : s.get("until");
                if (from != null && !from.toString().isBlank()) m.put("year", from);
                if (until != null && !until.toString().isBlank()) m.put("year_to", until);
                in.add(m);
            }
        } else in = SoundImport.parse(text, errors);
        List<Map<String, Object>> have = db.rows("select * from phonemes where language_id=?", langId);
        List<Map<String, Object>> items = new ArrayList<>();
        List<Object[]> ops = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        int added = 0, changed = 0, same = 0, line = 0;
        for (Map<String, Object> m : in) {
            line++;
            String sym = (String) m.get("symbol"), kind = (String) m.get("kind");
            Object y = m.get("year"), yt = m.get("year_to");
            String key = sym + "|" + kind + "|" + (y == null ? "" : y.toString()) + "|" + (yt == null ? "" : yt.toString());
            if (!seen.add(key)) { errors.add("Sound " + line + " (" + sym + "): listed twice."); continue; }
            Map<String, Object> match = null;
            for (Map<String, Object> h : have) {
                if (sym.equals(h.get("symbol")) && kind.equals(String.valueOf(h.get("kind")))
                        && String.valueOf(y == null ? "" : y).equals(String.valueOf(h.get("year") == null ? "" : h.get("year")))
                        && String.valueOf(yt == null ? "" : yt).equals(String.valueOf(h.get("year_to") == null ? "" : h.get("year_to")))) { match = h; break; }
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("symbol", sym); item.put("kind", kind); item.put("row", m.get("row_label")); item.put("col", m.get("col_label"));
            item.put("year", y); item.put("year_to", yt);
            try {
                if (match == null) {
                    store.validate(langId, "phoneme", "CREATE", null, m);
                    item.put("action", "add"); added++;
                    ops.add(new Object[]{"CREATE", null, m});
                } else {
                    boolean eq = String.valueOf(m.get("row_label")).equals(String.valueOf(match.get("row_label") == null ? "" : match.get("row_label")))
                            && String.valueOf(m.get("col_label")).equals(String.valueOf(match.get("col_label") == null ? "" : match.get("col_label")))
                            && String.valueOf(m.get("notes")).equals(String.valueOf(match.get("notes") == null ? "" : match.get("notes")));
                    if (eq) { item.put("action", "same"); same++; }
                    else {
                        store.validate(langId, "phoneme", "UPDATE", Db.num(match.get("id")), m);
                        item.put("action", "change"); changed++;
                        ops.add(new Object[]{"UPDATE", Db.num(match.get("id")), m});
                    }
                }
            } catch (ApiException e) {
                errors.add("Sound " + line + " (" + sym + "): " + e.getMessage());
                item.put("action", "error");
            }
            items.add(item);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("added", added); out.put("changed", changed); out.put("unchanged", same);
        out.put("items", items); out.put("errors", errors); out.put("applied", false);
        if (!errors.isEmpty() || dryRun) return out;
        for (Object[] op : ops) store.submit(uid, langId, "phoneme", (String) op[0], (Long) op[1], castMap(op[2]));
        out.put("applied", true);
        return out;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Object o) { return (Map<String, Object>) o; }

    /** True when the language already has a word with this gloss (a comma-separated gloss counts as several senses). */
    private static boolean glossKnown(String gloss, Set<String> have) {
        for (String g : gloss.split(",")) if (have.contains(g.trim().toLowerCase())) return true;
        return false;
    }

    public Map<String, Object> bulk(long uid, long langId, String text, boolean dryRun) {
        return bulk(uid, langId, text, dryRun, false);
    }

    public Map<String, Object> bulk(long uid, long langId, String text, boolean dryRun, boolean skipExisting) {
        access.need(uid, langId, Access.EDITOR);
        List<Map<String, Object>> parsed = new ArrayList<>();
        List<String> errors = new ArrayList<>();
        List<String> skipped = new ArrayList<>();
        Set<String> have = new HashSet<>();
        if (skipExisting) {
            for (Map<String, Object> r : db.rows("select gloss from words where language_id=?", langId)) {
                for (String g : ((String) r.get("gloss")).split(",")) have.add(g.trim().toLowerCase());
            }
        }
        int n = 0;
        for (String line : (text == null ? "" : text).split("\\R")) {
            n++;
            if (line.isBlank()) continue;
            String[] f = line.contains("\t") ? line.split("\t", -1) : line.split(";", -1);
            if (n == 1 && f[0].trim().equalsIgnoreCase("gloss")) continue;
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("gloss", f[0].trim());
            if (skipExisting && glossKnown(f[0].trim(), have)) { skipped.add(f[0].trim()); continue; }
            if (skipExisting) for (String g : f[0].split(",")) have.add(g.trim().toLowerCase());
            if (f.length > 1) p.put("pos", f[1].trim());
            if (f.length > 2) p.put("form", f[2].trim());
            if (f.length > 3 && !f[3].isBlank()) p.put("year", f[3].trim());
            if (f.length > 4) p.put("notes", f[4].trim());
            try {
                parsed.add(store.validate(langId, "word", "CREATE", null, p));
            } catch (ApiException e) {
                errors.add("Line " + n + ": " + e.getMessage());
            }
        }
        if (!errors.isEmpty()) throw new ApiException(400, String.join("\n", errors));
        if (!dryRun) {
            for (Map<String, Object> p : parsed) store.submit(uid, langId, "word", "CREATE", null, p);
        }
        return Map.of("count", parsed.size(), "dryRun", dryRun, "skipped", skipped);
    }
}
