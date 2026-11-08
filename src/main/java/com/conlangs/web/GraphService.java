package com.conlangs.web;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** Data for the graphs. Divergence: how far apart two languages' versions of the shared vocabulary are, over time. */
@Service
public class GraphService {
    private final Db db;
    private final Access access;
    private final EvolverFactory evolvers;

    public GraphService(Db db, Access access, EvolverFactory evolvers) {
        this.db = db;
        this.access = access;
        this.evolvers = evolvers;
    }

    private static int niceStep(double raw) {
        int[] nice = {1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000};
        for (int n : nice) if (n >= raw) return n;
        return 10000;
    }

    private List<Long> pathNearestFirst(long lang, Map<Long, Long> parent) {
        List<Long> p = new ArrayList<>();
        Long cur = lang;
        for (int i = 0; cur != null && i < 100; i++) {
            p.add(cur);
            cur = parent.get(cur);
        }
        return p;
    }

    /** When a language begins: its split year, or for a root language its earliest word (null if it has none). */
    private static Integer start(long lang, Map<Long, Long> parent, Map<Long, Integer> splitYear, Map<Long, Integer> firstWord, Integer worldFirst) {
        if (parent.get(lang) != null && splitYear.get(lang) != null) return splitYear.get(lang);
        if (parent.get(lang) != null) return start(parent.get(lang), parent, splitYear, firstWord, worldFirst);
        return firstWord.getOrDefault(lang, worldFirst);
    }

    /** Pairs of languages in the subtree of langId (or just a/b when both are given). Years default to the span of the data. */
    public Map<String, Object> divergence(long uid, long langId, Long a, Long b, Integer from, Integer to) {
        Map<String, Object> lang = access.need(uid, langId, Access.VIEWER);
        long worldId = Db.num(lang.get("world_id"));
        Map<Long, String> names = new LinkedHashMap<>();
        Map<Long, Long> parent = new HashMap<>();
        Map<Long, Integer> splitYear = new HashMap<>();
        for (Map<String, Object> l : db.rows("select id, name, parent_id, split_year from languages where world_id=? order by id", worldId)) {
            long id = Db.num(l.get("id"));
            names.put(id, (String) l.get("name"));
            parent.put(id, l.get("parent_id") == null ? null : Db.num(l.get("parent_id")));
            if (l.get("split_year") != null) splitYear.put(id, ((Number) l.get("split_year")).intValue());
        }
        List<Long> subtree = new ArrayList<>();
        subtree.add(langId);
        for (long d : access.descendants(langId)) if (access.level(uid, d) >= Access.VIEWER) subtree.add(d);
        List<long[]> pairs = new ArrayList<>();
        if (a != null && b != null) {
            if (!names.containsKey(a) || !names.containsKey(b) || access.level(uid, a) < Access.VIEWER || access.level(uid, b) < Access.VIEWER)
                throw new ApiException(404, "Pick two languages you can view in this world.");
            pairs.add(new long[]{a, b});
        } else {
            for (int i = 0; i < subtree.size(); i++) for (int j = i + 1; j < subtree.size(); j++) if (pairs.size() < 15) pairs.add(new long[]{subtree.get(i), subtree.get(j)});
        }
        if (pairs.isEmpty()) throw new ApiException(400, "This language has no branches to compare. Add a branch first, or pick two languages.");

        Map<Long, List<Evolver.Override>> ovr = new HashMap<>();
        for (Map<String, Object> o : db.rows("select o.word_id, o.lang_id, o.year, o.form from word_overrides o join words w on w.id=o.word_id join languages l on l.id=w.language_id where l.world_id=?", worldId)) {
            ovr.computeIfAbsent(Db.num(o.get("word_id")), k -> new ArrayList<>())
                    .add(new Evolver.Override(Db.num(o.get("lang_id")), ((Number) o.get("year")).intValue(), (String) o.get("form")));
        }
        List<Map<String, Object>> words = db.rows("select w.id, w.language_id, w.form, w.year from words w join languages l on l.id=w.language_id where l.world_id=?", worldId);
        Integer minYear = null, maxYear = null;
        Map<Long, Integer> firstWord = new HashMap<>();
        for (Map<String, Object> w : words) {
            int y = ((Number) w.get("year")).intValue();
            minYear = minYear == null ? y : Math.min(minYear, y);
            firstWord.merge(Db.num(w.get("language_id")), y, Math::min);
        }
        // When each language of a pair begins: a branch at its split, a root language at its earliest word. A pair is only
        // drawn from when both exist (before a branch split off it was still its parent, so comparing them means nothing).
        int[] pairStart = new int[pairs.size()];
        Integer earliest = null;
        for (int p = 0; p < pairs.size(); p++) {
            Integer sa = start(pairs.get(p)[0], parent, splitYear, firstWord, minYear), sb = start(pairs.get(p)[1], parent, splitYear, firstWord, minYear);
            pairStart[p] = sa == null && sb == null ? Integer.MIN_VALUE : Math.max(sa == null ? Integer.MIN_VALUE : sa, sb == null ? Integer.MIN_VALUE : sb);
            if (pairStart[p] != Integer.MIN_VALUE) earliest = earliest == null ? pairStart[p] : Math.min(earliest, pairStart[p]);
        }
        for (Map<String, Object> r : db.rows("select r.year from rules r join languages l on l.id=r.language_id where l.world_id=?", worldId)) {
            int y = ((Number) r.get("year")).intValue();
            maxYear = maxYear == null ? y : Math.max(maxYear, y);
        }
        int lo = from != null ? from : earliest != null ? earliest : minYear != null ? minYear : -1000;
        int hi = to != null ? to : Math.max(maxYear != null ? maxYear + 200 : lo + 1000, lo + 100);
        if (hi <= lo) throw new ApiException(400, "'To' must be later than 'from'.");
        int step = niceStep((hi - lo) / 40.0);
        List<Integer> years = new ArrayList<>();
        // from the start year itself, then on round years
        years.add(lo);
        for (int y = Math.floorDiv(lo, step) * step + step; y <= hi; y += step) years.add(y);

        Evolver ev = evolvers.build(worldId, null);
        Map<Long, List<Long>> paths = new HashMap<>();
        for (long l : names.keySet()) paths.put(l, pathNearestFirst(l, parent));
        int np = pairs.size(), ny = years.size();
        double[][] sum = new double[np][ny];
        int[][] same = new int[np][ny], count = new int[np][ny];
        for (Map<String, Object> w : words) {
            String form = (String) w.get("form");
            if (Evolver.isLiteral(form)) continue;
            long id = Db.num(w.get("id"));
            int wy = ((Number) w.get("year")).intValue();
            List<Evolver.Row> rows = ev.evolve(Db.num(w.get("language_id")), form, wy, ovr.getOrDefault(id, List.of()));
            java.util.Set<Long> reached = new java.util.HashSet<>();
            for (Evolver.Row r : rows) reached.add(r.langId());
            for (int p = 0; p < np; p++) {
                long pa = pairs.get(p)[0], pb = pairs.get(p)[1];
                if (!reached.contains(pa) || !reached.contains(pb)) continue;
                for (int yi = 0; yi < ny; yi++) {
                    int y = years.get(yi);
                    if (wy > y || y < pairStart[p]) continue;
                    String fa = FormMath.formAt(rows, paths.get(pa), y), fb = FormMath.formAt(rows, paths.get(pb), y);
                    if (fa == null || fb == null) continue;
                    count[p][yi]++;
                    sum[p][yi] += Distance.normalized(fa, fb);
                    if (fa.equals(fb)) same[p][yi]++;
                }
            }
        }
        List<Map<String, Object>> series = new ArrayList<>();
        for (int p = 0; p < np; p++) {
            List<Object> avg = new ArrayList<>(), ident = new ArrayList<>(), n = new ArrayList<>();
            for (int yi = 0; yi < ny; yi++) {
                n.add(count[p][yi]);
                avg.add(count[p][yi] == 0 ? null : Math.round(sum[p][yi] / count[p][yi] * 1000) / 10.0);
                ident.add(count[p][yi] == 0 ? null : Math.round(same[p][yi] * 1000.0 / count[p][yi]) / 10.0);
            }
            Map<String, Object> s = new LinkedHashMap<>();
            s.put("a", names.get(pairs.get(p)[0]));
            s.put("b", names.get(pairs.get(p)[1]));
            s.put("avg_distance", avg);
            s.put("identical", ident);
            s.put("words", n);
            series.add(s);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        List<Object> starts = new ArrayList<>();
        for (int p : pairStart) starts.add(p == Integer.MIN_VALUE ? null : p);
        for (int p = 0; p < np; p++) series.get(p).put("from", starts.get(p));
        out.put("years", years);
        out.put("series", series);
        out.put("step", step);
        return out;
    }

    /**
     * How much the sound changes of each language merge words: forms that were different when the language began (at its split)
     * but are identical now, which rule causes how many mergers, and the biggest groups of words that now sound the same.
     * Locked overrides are not part of the per-rule count.
     */
    public List<Map<String, Object>> mergers(long uid, long langId) {
        Map<String, Object> lang = access.need(uid, langId, Access.VIEWER);
        long worldId = Db.num(lang.get("world_id"));
        Map<Long, String> names = new LinkedHashMap<>();
        for (Map<String, Object> l : db.rows("select id, name from languages where world_id=? order by id", worldId)) names.put(Db.num(l.get("id")), (String) l.get("name"));
        List<Long> subtree = new ArrayList<>();
        subtree.add(langId);
        for (long d : access.descendants(langId)) if (access.level(uid, d) >= Access.VIEWER) subtree.add(d);

        Map<Long, List<Evolver.Override>> ovr = new HashMap<>();
        for (Map<String, Object> o : db.rows("select o.word_id, o.lang_id, o.year, o.form from word_overrides o join words w on w.id=o.word_id join languages l on l.id=w.language_id where l.world_id=?", worldId)) {
            ovr.computeIfAbsent(Db.num(o.get("word_id")), k -> new ArrayList<>())
                    .add(new Evolver.Override(Db.num(o.get("lang_id")), ((Number) o.get("year")).intValue(), (String) o.get("form")));
        }
        Evolver ev = evolvers.build(worldId, null);
        List<String> glosses = new ArrayList<>();
        List<List<Evolver.Row>> allRows = new ArrayList<>();
        for (Map<String, Object> w : db.rows("select w.id, w.gloss, w.language_id, w.form, w.year from words w join languages l on l.id=w.language_id where l.world_id=?", worldId)) {
            String form = (String) w.get("form");
            if (Evolver.isLiteral(form)) continue;
            glosses.add((String) w.get("gloss"));
            allRows.add(ev.evolve(Db.num(w.get("language_id")), form, ((Number) w.get("year")).intValue(), ovr.getOrDefault(Db.num(w.get("id")), List.of())));
        }

        List<Map<String, Object>> out = new ArrayList<>();
        for (long lid : subtree) {
            List<String> g = new ArrayList<>(), startForm = new ArrayList<>(), finalForm = new ArrayList<>();
            List<Map<String, String>> steps = new ArrayList<>();
            for (int i = 0; i < allRows.size(); i++) {
                String first = null, last = null;
                Map<String, String> byKey = new HashMap<>();
                for (Evolver.Row r : allRows.get(i)) {
                    if (r.langId() != lid || r.source().equals("ERROR")) continue;
                    if (first == null) first = r.form();
                    last = r.form();
                    if (r.source().equals("RULE")) byKey.put(r.year() + "|" + r.rule(), r.form());
                }
                if (first == null) continue;
                g.add(glosses.get(i));
                startForm.add(first);
                finalForm.add(last);
                steps.add(byKey);
            }
            Map<String, Integer> startCount = new HashMap<>();
            for (String f : startForm) startCount.merge(f, 1, Integer::sum);
            int distinctStart = startCount.size();
            int homophoneStart = 0;
            for (int c : startCount.values()) if (c > 1) homophoneStart += c;
            List<Map<String, Object>> ruleRows = new ArrayList<>();
            List<String> keys = new ArrayList<>();
            for (Map<String, Object> r : db.rows("select year, ord, name, pattern, replacement from rules where language_id=? order by year, ord, id", lid)) {
                String label = r.get("name") == null || ((String) r.get("name")).isBlank() ? r.get("pattern") + " > " + r.get("replacement") : (String) r.get("name");
                keys.add(((Number) r.get("year")).intValue() + "|" + label);
                Map<String, Object> pr = new LinkedHashMap<>();
                pr.put("year", r.get("year"));
                pr.put("rule", label);
                pr.put("pattern", r.get("pattern"));
                pr.put("replacement", r.get("replacement"));
                ruleRows.add(pr);
            }
            List<int[]> sim = Mergers.simulate(startForm, steps, keys);
            List<Map<String, Object>> perRule = new ArrayList<>();
            for (int k = 0; k < ruleRows.size(); k++) {
                if (sim.get(k)[0] == 0) continue;
                ruleRows.get(k).put("changed", sim.get(k)[0]);
                ruleRows.get(k).put("merged", sim.get(k)[1]);
                perRule.add(ruleRows.get(k));
            }
            perRule.sort((a, b) -> Integer.compare((Integer) b.get("merged"), (Integer) a.get("merged")));
            Map<String, List<String>> groups = new LinkedHashMap<>();
            for (int i = 0; i < finalForm.size(); i++) groups.computeIfAbsent(finalForm.get(i), k -> new ArrayList<>()).add(g.get(i));
            List<Map<String, Object>> top = new ArrayList<>();
            int homophoneNow = 0;
            List<Map.Entry<String, List<String>>> big = new ArrayList<>();
            for (Map.Entry<String, List<String>> e : groups.entrySet()) if (e.getValue().size() > 1) { big.add(e); homophoneNow += e.getValue().size(); }
            big.sort((a, b) -> Integer.compare(b.getValue().size(), a.getValue().size()));
            for (Map.Entry<String, List<String>> e : big.subList(0, Math.min(12, big.size()))) {
                Map<String, Object> t = new LinkedHashMap<>();
                t.put("form", e.getKey());
                t.put("words", e.getValue());
                top.add(t);
            }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("language", names.get(lid));
            m.put("words", g.size());
            m.put("distinct_start", distinctStart);
            m.put("distinct_now", groups.size());
            m.put("merged", distinctStart - groups.size());
            m.put("homophone_words_start", homophoneStart);
            m.put("homophone_words_now", homophoneNow);
            m.put("rules", perRule.subList(0, Math.min(15, perRule.size())));
            m.put("groups", top);
            out.add(m);
        }
        return out;
    }
}
