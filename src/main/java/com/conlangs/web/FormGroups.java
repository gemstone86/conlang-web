package com.conlangs.web;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * The order in which the endings of the Word forms tab's groups go onto a word when they are stacked
 * (e.g. number before case before definiteness). A branch can set its own order; otherwise it uses its parent's,
 * and groups with no position go after the others in the order they first appear.
 */
@Service
public class FormGroups {
    private final Db db;
    private final Access access;
    private final AppLog applog;

    public FormGroups(Db db, Access access, AppLog applog) {
        this.db = db;
        this.access = access;
        this.applog = applog;
    }

    /** {groups: [{name, position (1, 2, ...), rules}], own: whether this language sets the order itself, from: language it comes from}. */
    public Map<String, Object> list(long uid, long langId) {
        access.need(uid, langId, Access.VIEWER);
        List<Long> path = new ArrayList<>();
        path.add(langId);
        path.addAll(access.ancestors(langId));
        Map<String, Integer> pos = new HashMap<>();
        Map<String, String> names = new LinkedHashMap<>();
        Map<String, Integer> count = new HashMap<>();
        Long from = null;
        for (long l : path) {
            for (Map<String, Object> r : db.rows("select grp from form_rules where language_id=? and grp is not null and trim(grp)<>'' order by ord, id", l)) {
                String n = ((String) r.get("grp")).trim(), k = n.toLowerCase();
                names.putIfAbsent(k, n);
                count.merge(k, 1, Integer::sum);
            }
            List<Map<String, Object>> set = db.rows("select name, position from form_groups where language_id=?", l);
            if (from == null && !set.isEmpty()) from = l;
            for (Map<String, Object> g : set) pos.putIfAbsent(((String) g.get("name")).trim().toLowerCase(), ((Number) g.get("position")).intValue());
        }
        List<String> keys = new ArrayList<>(names.keySet());
        List<String> appear = new ArrayList<>(keys);
        keys.sort(java.util.Comparator.comparingInt(k -> pos.getOrDefault(k, 100_000 + appear.indexOf(k))));
        List<Map<String, Object>> out = new ArrayList<>();
        int i = 1;
        for (String k : keys) {
            Map<String, Object> g = new LinkedHashMap<>();
            g.put("name", names.get(k));
            g.put("position", i++);
            g.put("rules", count.get(k));
            g.put("set", pos.containsKey(k));
            out.add(g);
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("groups", out);
        res.put("own", from != null && from == langId);
        res.put("from", from == null ? null : access.language(from).get("name"));
        return res;
    }

    /** Saves the order (group names, first = closest to the word). An empty list goes back to the parent's order. */
    public void save(long uid, long langId, List<String> order) {
        access.need(uid, langId, Access.EDITOR);
        db.update("delete from form_groups where language_id=?", langId);
        int i = 1;
        for (String n : order == null ? List.<String>of() : order) {
            if (n == null || n.isBlank()) continue;
            if (n.length() > 100) throw new ApiException(400, "Group name too long.");
            db.update("insert into form_groups(language_id, name, position) values (?,?,?)", langId, n.trim(), i++);
        }
        applog.info("edit", uid, "Set the order of word-form groups of language #" + langId + ": " + String.join(", ", order == null ? List.of() : order));
    }
}
