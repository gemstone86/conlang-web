package com.conlangs.web;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeSet;
import org.springframework.stereotype.Service;

/**
 * The Etymology tab: one meaning across every language of a world the viewer can see, as the family tree. For each
 * language, the words it uses for the meaning: its own, inherited (from where), borrowed (from where), or lost.
 */
@Service
public class EtymologyService {
    private final Db db;
    private final Access access;
    private final DictService dict;

    public EtymologyService(Db db, Access access, DictService dict) {
        this.db = db;
        this.access = access;
        this.dict = dict;
    }

    private static String norm(Object o) {
        return o == null ? "" : o.toString().trim().toLowerCase(Locale.ROOT);
    }

    /** Does the word mean this (its gloss, or one of its meanings in this language)? */
    private static boolean means(Map<String, Object> w, String meaning) {
        if (norm(w.get("gloss")).equals(meaning)) return true;
        for (String m : String.valueOf(w.getOrDefault("meaning", "")).split(";")) if (norm(m).equals(meaning)) return true;
        return false;
    }

    private List<Map<String, Object>> visibleLanguages(long uid, long worldId) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> l : db.rows("select l.*, w.owner_id as world_owner from languages l join worlds w on w.id=l.world_id where l.world_id=? order by l.id", worldId)) {
            int lv = access.level(uid, l);
            if (lv < Access.VIEWER) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            for (String k : List.of("id", "name", "parent_id", "split_year")) m.put(k, l.get(k));
            m.put("level", lv);
            out.add(m);
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> trace(long uid, long langId, String meaningText) {
        Map<String, Object> lang = access.need(uid, langId, Access.VIEWER);
        String meaning = norm(meaningText);
        if (meaning.isEmpty()) throw new ApiException(400, "Give a meaning to trace.");
        List<Map<String, Object>> langs = visibleLanguages(uid, Db.num(lang.get("world_id")));
        int found = 0;
        for (Map<String, Object> l : langs) {
            long lid = Db.num(l.get("id"));
            String name = (String) l.get("name");
            List<Map<String, Object>> ws = new ArrayList<>();
            for (Map<String, Object> w : dict.words(uid, lid)) {
                if (w.get("ref_to") != null || !means(w, meaning)) continue;
                Map<String, Object> o = new LinkedHashMap<>();
                o.put("id", w.get("id"));
                o.put("gloss", w.get("gloss"));
                Object now = ((Map<String, Object>) w.getOrDefault("latest", Map.of())).get(name);
                o.put("form", now == null ? w.get("form") : now);
                o.put("coined", w.get("year"));
                if (Boolean.TRUE.equals(w.get("inherited"))) {
                    o.put("origin", "inherited");
                    o.put("from", w.get("origin_lang"));
                    o.put("from_form", w.get("origin_form"));
                } else if (w.get("loan_from") != null) {
                    o.put("origin", "borrowed");
                    o.put("from", w.get("loan_from"));
                } else {
                    o.put("origin", "own");
                }
                if (w.get("lost_year") != null) o.put("lost_year", w.get("lost_year"));
                if (!norm(w.get("gloss")).equals(meaning)) o.put("note", "means: " + w.get("meaning"));
                ws.add(o);
            }
            l.put("words", ws);
            boolean has = ws.stream().anyMatch(o -> o.get("lost_year") == null);
            if (has) found++;
            l.put("status", has ? "has" : ws.isEmpty() ? "none" : "lost");
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("meaning", meaningText.trim());
        out.put("languages", langs);
        out.put("found", found);
        return out;
    }

    /** All meanings in the world's languages the viewer can see, for the search box. */
    public List<String> meanings(long uid, long langId) {
        Map<String, Object> lang = access.need(uid, langId, Access.VIEWER);
        TreeSet<String> out = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (Map<String, Object> l : visibleLanguages(uid, Db.num(lang.get("world_id"))))
            for (Map<String, Object> w : db.rows("select gloss from words where language_id=?", l.get("id"))) {
                if (out.size() >= 5000) break;
                out.add(w.get("gloss").toString().trim());
            }
        return new ArrayList<>(out);
    }
}
