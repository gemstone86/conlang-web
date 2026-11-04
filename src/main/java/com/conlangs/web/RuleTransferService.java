package com.conlangs.web;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

/**
 * Import of sound changes from JSON. An entry with the id of an existing rule adjusts it, an entry without one adds a rule
 * ("delete": true removes it), and with removeMissing the rules of every language in the file that the file doesn't mention are removed.
 * Everything goes through the normal edit pipeline, so approval and undo work as usual.
 */
@Service
public class RuleTransferService {
    private final Db db;
    private final Access access;
    private final Store store;

    public RuleTransferService(Db db, Access access, Store store) {
        this.db = db;
        this.access = access;
        this.store = store;
    }

    private static Long lng(Object o) {
        if (o == null || o.toString().isBlank()) return null;
        if (o instanceof Number n) return n.longValue();
        try {
            return Long.parseLong(o.toString().trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Map<String, Object> item(String action, String lang, Map<String, Object> e, String detail) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("action", action);
        m.put("language", lang);
        m.put("year", e.get("year"));
        m.put("pattern", e.get("pattern"));
        m.put("replacement", e.get("replacement"));
        m.put("detail", detail);
        return m;
    }

    public Map<String, Object> importRules(long uid, long pathLang, List<Map<String, Object>> entries, boolean removeMissing, boolean dryRun) {
        Map<String, Object> pl = access.need(uid, pathLang, Access.VIEWER);
        long worldId = Db.num(pl.get("world_id"));
        Map<String, Long> byName = new HashMap<>();
        Map<Long, String> names = new HashMap<>();
        for (Map<String, Object> l : db.rows("select id, name from languages where world_id=?", worldId)) {
            byName.put(((String) l.get("name")).toLowerCase(), Db.num(l.get("id")));
            names.put(Db.num(l.get("id")), (String) l.get("name"));
        }
        List<Map<String, Object>> items = new ArrayList<>();
        List<String> errors = new ArrayList<>();
        // planned operations
        List<Object[]> ops = new ArrayList<>();   // {langId, action, entityId, payload}
        Set<Long> keep = new HashSet<>(), touchedLangs = new HashSet<>();
        int added = 0, updated = 0, removed = 0, unchanged = 0;
        int n = 0;
        for (Map<String, Object> e : entries) {
            n++;
            String where = "Entry " + n + ": ";
            Object ln = e.get("language");
            Long langId = ln == null || ln.toString().isBlank() ? pathLang : byName.get(ln.toString().trim().toLowerCase());
            if (langId == null) { errors.add(where + "unknown language '" + ln + "'."); continue; }
            Long id = lng(e.get("id"));
            boolean del = Boolean.TRUE.equals(e.get("delete")) || Boolean.TRUE.equals(e.get("remove"));
            Map<String, Object> existing = id == null ? null : db.one("select r.* from rules r join languages l on l.id=r.language_id where r.id=? and l.world_id=?", id, worldId);
            String action;
            Map<String, Object> payload = new LinkedHashMap<>();
            if (del) {
                if (existing == null) { items.add(item("skip", names.get(langId), e, "rule " + id + " doesn't exist (already removed?)")); continue; }
                langId = Db.num(existing.get("language_id"));
                action = "DELETE";
            } else if (existing != null) {
                langId = Db.num(existing.get("language_id"));
                keep.add(id);
                if (ln != null && !ln.toString().isBlank() && byName.get(ln.toString().trim().toLowerCase()) != null
                        && byName.get(ln.toString().trim().toLowerCase()).longValue() != langId) {
                    errors.add(where + "rule " + id + " belongs to " + names.get(langId) + "; to move it to " + ln + " remove it and add a new one.");
                    continue;
                }
                payload = RuleDiff.changed(existing, e);
                if (payload.isEmpty()) { unchanged++; touchedLangs.add(langId); items.add(item("same", names.get(langId), e, "no change")); continue; }
                action = "UPDATE";
            } else {
                if (e.get("pattern") == null || e.get("pattern").toString().isEmpty() || lng(e.get("year")) == null) {
                    errors.add(where + "a new rule needs a year and a pattern.");
                    continue;
                }
                Object ord = e.containsKey("order") ? e.get("order") : e.get("ord");
                Map<String, Object> dup = db.one("select id from rules where language_id=? and year=? and ord=? and pattern=? and replacement=?", langId,
                        lng(e.get("year")), ord == null ? 0L : lng(ord), e.get("pattern").toString(), e.get("replacement") == null ? "" : e.get("replacement").toString());
                if (dup != null) { keep.add(Db.num(dup.get("id"))); unchanged++; touchedLangs.add(langId); items.add(item("same", names.get(langId), e, "already exists")); continue; }
                action = "CREATE";
                payload.put("year", lng(e.get("year")));
                payload.put("ord", ord == null ? 0L : lng(ord));
                payload.put("name", e.get("name") == null ? "" : e.get("name").toString());
                payload.put("pattern", e.get("pattern").toString());
                payload.put("replacement", e.get("replacement") == null ? "" : e.get("replacement").toString());
                if (e.get("note") != null) payload.put("note", e.get("note").toString());
            }
            touchedLangs.add(langId);
            if (access.level(uid, langId) < Access.EDITOR) { errors.add(where + "you can't edit rules in " + names.get(langId) + "."); continue; }
            try {
                store.validate(langId, "rule", action, id, payload);
            } catch (ApiException ex) {
                errors.add(where + names.get(langId) + " " + e.get("year") + " " + e.get("pattern") + ": " + ex.getMessage());
                continue;
            }
            ops.add(new Object[]{langId, action, "DELETE".equals(action) || "UPDATE".equals(action) ? id : null, payload});
            if (action.equals("CREATE")) added++;
            else if (action.equals("UPDATE")) updated++;
            else removed++;
            items.add(item(action.equals("CREATE") ? "add" : action.equals("UPDATE") ? "change" : "remove", names.get(langId), e,
                    action.equals("UPDATE") ? "changes " + String.join(", ", payload.keySet()) : ""));
        }
        if (removeMissing) {
            for (long lid : touchedLangs) {
                for (Map<String, Object> r : db.rows("select * from rules where language_id=? order by year, ord, id", lid)) {
                    long rid = Db.num(r.get("id"));
                    if (keep.contains(rid)) continue;
                    boolean already = false;
                    for (Object[] op : ops) if ("DELETE".equals(op[1]) && op[2] != null && ((Long) op[2]) == rid) already = true;
                    if (already) continue;
                    if (access.level(uid, lid) < Access.EDITOR) { errors.add("You can't edit rules in " + names.get(lid) + ", so its missing rules can't be removed."); break; }
                    ops.add(new Object[]{lid, "DELETE", rid, new LinkedHashMap<String, Object>()});
                    removed++;
                    items.add(item("remove", names.get(lid), r, "not in the file"));
                }
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("added", added);
        out.put("changed", updated);
        out.put("removed", removed);
        out.put("unchanged", unchanged);
        out.put("items", items);
        out.put("errors", errors);
        out.put("applied", false);
        if (!errors.isEmpty() || dryRun) return out;
        int pending = 0;
        for (Object[] op : ops) {
            @SuppressWarnings("unchecked")
            Map<String, Object> payload = (Map<String, Object>) op[3];
            Map<String, Object> res = store.submit(uid, (Long) op[0], "rule", (String) op[1], (Long) op[2], payload);
            if ("pending".equals(res.get("status"))) pending++;
        }
        out.put("applied", true);
        out.put("pending", pending);
        return out;
    }
}
