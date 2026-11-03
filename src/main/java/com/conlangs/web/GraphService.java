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

    /** Pairs of languages in the subtree of langId (or just a/b when both are given). Years default to the span of the data. */
    public Map<String, Object> divergence(long uid, long langId, Long a, Long b, Integer from, Integer to) {
        Map<String, Object> lang = access.need(uid, langId, Access.VIEWER);
        long worldId = Db.num(lang.get("world_id"));
        Map<Long, String> names = new LinkedHashMap<>();
        Map<Long, Long> parent = new HashMap<>();
        Integer firstSplit = null;
        for (Map<String, Object> l : db.rows("select id, name, parent_id, split_year from languages where world_id=? order by id", worldId)) {
            long id = Db.num(l.get("id"));
            names.put(id, (String) l.get("name"));
            parent.put(id, l.get("parent_id") == null ? null : Db.num(l.get("parent_id")));
            if (l.get("split_year") != null) {
                int sy = ((Number) l.get("split_year")).intValue();
                firstSplit = firstSplit == null ? sy : Math.min(firstSplit, sy);
            }
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
        for (Map<String, Object> w : words) {
            int y = ((Number) w.get("year")).intValue();
            minYear = minYear == null ? y : Math.min(minYear, y);
        }
        for (Map<String, Object> r : db.rows("select r.year from rules r join languages l on l.id=r.language_id where l.world_id=?", worldId)) {
            int y = ((Number) r.get("year")).intValue();
            maxYear = maxYear == null ? y : Math.max(maxYear, y);
        }
        int lo = from != null ? from : (firstSplit != null ? firstSplit - 500 : minYear != null ? minYear : -1000);
        int hi = to != null ? to : Math.max(maxYear != null ? maxYear + 200 : lo + 1000, lo + 100);
        if (hi <= lo) throw new ApiException(400, "'To' must be later than 'from'.");
        int step = niceStep((hi - lo) / 40.0);
        List<Integer> years = new ArrayList<>();
        for (int y = Math.floorDiv(lo, step) * step; y <= hi; y += step) years.add(y);

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
                    if (wy > y) continue;
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
        out.put("years", years);
        out.put("series", series);
        out.put("step", step);
        return out;
    }
}
