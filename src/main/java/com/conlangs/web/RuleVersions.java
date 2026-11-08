package com.conlangs.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Saved versions of a language's sound changes: its own rules (with their ids) and the tags switched off in
 * it, under a name. A version can be compared with the rules as they are now, and restored (owner only;
 * the rules as they are are saved as a version first, so a restore can always be undone by restoring that).
 */
@Service
public class RuleVersions {
    /** The fields of a rule that a version keeps and compares. */
    static final List<String> FIELDS = List.of("year", "ord", "name", "pattern", "replacement", "note", "tags");

    private final Db db;
    private final Access access;
    private final AppLog applog;
    private final ObjectMapper json;

    public RuleVersions(Db db, Access access, AppLog applog, ObjectMapper json) {
        this.db = db;
        this.access = access;
        this.applog = applog;
        this.json = json;
    }

    private List<Map<String, Object>> currentRules(long langId) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : db.rows("select * from rules where language_id=? order by year, ord, id", langId)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", Db.num(r.get("id")));
            for (String f : FIELDS) m.put(f, r.get(f));
            out.add(m);
        }
        return out;
    }

    private String currentOff(long langId) {
        Map<String, Object> l = db.one("select off_tags from languages where id=?", langId);
        return l == null ? null : (String) l.get("off_tags");
    }

    public List<Map<String, Object>> list(long uid, long langId) {
        access.need(uid, langId, Access.VIEWER);
        return db.rows("select v.id, v.name, v.note, v.created, v.rule_count, v.created_by, u.username as created_by_name from rule_versions v "
                + "left join users u on u.id=v.created_by where v.language_id=? order by v.id desc", langId);
    }

    public long save(long uid, long langId, String name, String note) {
        access.need(uid, langId, Access.EDITOR);
        String n = name == null ? "" : name.trim();
        if (n.isEmpty()) throw new ApiException(400, "Give the version a name.");
        if (n.length() > 200) throw new ApiException(400, "The name can be at most 200 characters.");
        String nt = note == null || note.isBlank() ? null : note.trim();
        if (nt != null && nt.length() > 4000) throw new ApiException(400, "The note can be at most 4000 characters.");
        return insert(uid, langId, n, nt);
    }

    private long insert(long uid, long langId, String name, String note) {
        List<Map<String, Object>> rules = currentRules(langId);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("rules", rules);
        data.put("off_tags", currentOff(langId));
        String text;
        try {
            text = json.writeValueAsString(data);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        if (text.length() > 1_000_000) throw new ApiException(400, "Too many sound changes to save as one version.");
        long id = db.insert("insert into rule_versions(language_id, name, note, created_by, rule_count, data) values (?,?,?,?,?,?)",
                langId, name, note, uid, rules.size(), text);
        applog.info("edit", uid, "Saved sound-change version '" + name + "' (#" + id + ", " + rules.size() + " rules) of language #" + langId);
        return id;
    }

    private Map<String, Object> version(long versionId) {
        Map<String, Object> v = db.one("select * from rule_versions where id=?", versionId);
        if (v == null) throw new ApiException(404, "No such version.");
        return v;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> data(Map<String, Object> v) {
        try {
            return json.readValue((String) v.get("data"), Map.class);
        } catch (Exception e) {
            throw new ApiException(500, "Version #" + v.get("id") + " can't be read.");
        }
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rulesOf(Map<String, Object> data) {
        Object r = data.get("rules");
        return r instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
    }

    private static Object norm(String field, Object v) {
        if (v == null || (v instanceof String s && s.isBlank())) return null;
        if (field.equals("year") || field.equals("ord")) return ((Number) v).longValue();
        return v.toString();
    }

    /**
     * What has changed in the language's sound changes since the version: {version, added, removed, changed,
     * offTags: {then, now}, same}. added/removed hold whole rules; changed holds {id, then, now, fields}.
     */
    public Map<String, Object> compare(long uid, long versionId) {
        Map<String, Object> v = version(versionId);
        long langId = Db.num(v.get("language_id"));
        access.need(uid, langId, Access.VIEWER);
        Map<String, Object> d = data(v);
        Map<Long, Map<String, Object>> then = new LinkedHashMap<>(), now = new LinkedHashMap<>();
        for (Map<String, Object> r : rulesOf(d)) then.put(((Number) r.get("id")).longValue(), r);
        for (Map<String, Object> r : currentRules(langId)) now.put(((Number) r.get("id")).longValue(), r);
        List<Map<String, Object>> added = new ArrayList<>(), removed = new ArrayList<>(), changed = new ArrayList<>();
        for (Map.Entry<Long, Map<String, Object>> e : now.entrySet()) if (!then.containsKey(e.getKey())) added.add(e.getValue());
        for (Map.Entry<Long, Map<String, Object>> e : then.entrySet()) {
            Map<String, Object> n = now.get(e.getKey());
            if (n == null) { removed.add(e.getValue()); continue; }
            List<String> fields = new ArrayList<>();
            for (String f : FIELDS) if (!Objects.equals(norm(f, e.getValue().get(f)), norm(f, n.get(f)))) fields.add(f);
            if (!fields.isEmpty()) {
                Map<String, Object> c = new LinkedHashMap<>();
                c.put("id", e.getKey());
                c.put("then", e.getValue());
                c.put("now", n);
                c.put("fields", fields);
                changed.add(c);
            }
        }
        Set<String> offThen = RuleTags.lower((String) d.get("off_tags")), offNow = RuleTags.lower(currentOff(langId));
        Map<String, Object> out = new LinkedHashMap<>();
        Map<String, Object> info = new LinkedHashMap<>();
        for (String k : List.of("id", "name", "note", "created", "rule_count")) info.put(k, v.get(k));
        out.put("version", info);
        out.put("added", added);
        out.put("removed", removed);
        out.put("changed", changed);
        out.put("offTags", Map.of("then", d.get("off_tags") == null ? "" : d.get("off_tags"), "now", currentOff(langId) == null ? "" : currentOff(langId)));
        out.put("same", added.isEmpty() && removed.isEmpty() && changed.isEmpty() && offThen.equals(offNow));
        return out;
    }

    /** Puts the language's sound changes back as they were in the version. Returns the id of the version saved first. */
    @Transactional
    public Map<String, Object> restore(long uid, long versionId) {
        Map<String, Object> v = version(versionId);
        long langId = Db.num(v.get("language_id"));
        access.need(uid, langId, Access.OWNER);
        Map<String, Object> d = data(v);
        long saved = insert(uid, langId, "Before restoring '" + v.get("name") + "'", "Saved automatically before version #" + versionId + " was restored.");
        db.update("delete from rules where language_id=?", langId);
        int n = 0;
        for (Map<String, Object> r : rulesOf(d)) {
            long rid = ((Number) r.get("id")).longValue();
            Object[] vals = {langId, num(r.get("year")), num(r.get("ord")), r.get("name"), r.get("pattern"),
                    r.get("replacement") == null ? "" : r.get("replacement"), r.get("note"), r.get("tags")};
            // the rule gets its old id back (ids are never given out twice), so comparing and the history still match
            if (db.count("select count(*) from rules where id=?", rid) == 0) {
                Object[] withId = new Object[vals.length + 1];
                withId[0] = rid;
                System.arraycopy(vals, 0, withId, 1, vals.length);
                db.update("insert into rules(id, language_id, year, ord, name, pattern, replacement, note, tags) values (?,?,?,?,?,?,?,?,?)", withId);
            } else {
                db.insert("insert into rules(language_id, year, ord, name, pattern, replacement, note, tags) values (?,?,?,?,?,?,?,?)", vals);
            }
            n++;
        }
        db.update("update languages set off_tags=? where id=?", d.get("off_tags"), langId);
        // the undo steps for sound changes describe rules that may no longer be there
        db.update("delete from edit_log where language_id=? and entity='rule'", langId);
        applog.info("edit", uid, "Restored sound-change version '" + v.get("name") + "' (#" + versionId + ", " + n + " rules) of language #" + langId
                + "; the rules before were saved as version #" + saved);
        return Map.of("restored", n, "savedFirst", saved);
    }

    public void delete(long uid, long versionId) {
        Map<String, Object> v = version(versionId);
        long langId = Db.num(v.get("language_id"));
        Map<String, Object> l = access.need(uid, langId, Access.VIEWER);
        boolean mine = v.get("created_by") != null && Db.num(v.get("created_by")) == uid;
        if ((int) l.get("level") < Access.OWNER && !(mine && (int) l.get("level") >= Access.EDITOR))
            throw new ApiException(403, "Only the owner, or whoever saved it, can delete a version.");
        db.update("delete from rule_versions where id=?", versionId);
        applog.info("edit", uid, "Deleted sound-change version '" + v.get("name") + "' (#" + versionId + ") of language #" + langId);
    }

    /** Switches a tag off (or on again) for the language's sound changes and its branches'. Owner only. */
    public Map<String, Object> switchTag(long uid, long langId, String tag, boolean off) {
        access.need(uid, langId, Access.OWNER);
        List<String> one = RuleTags.parse(tag);
        if (one.size() != 1) throw new ApiException(400, "Give one tag.");
        String t = one.get(0);
        List<String> tags = new ArrayList<>(RuleTags.parse(currentOff(langId)));
        tags.removeIf(x -> x.equalsIgnoreCase(t));
        if (off) tags.add(t);
        String stored = RuleTags.normalize(String.join(", ", tags));
        db.update("update languages set off_tags=? where id=?", stored, langId);
        applog.info("edit", uid, "Switched sound changes tagged '" + t + "' " + (off ? "off" : "on") + " in language #" + langId);
        return Map.of("off_tags", stored == null ? "" : stored);
    }

    private static Object num(Object o) {
        return o == null ? 0 : ((Number) o).longValue();
    }
}
