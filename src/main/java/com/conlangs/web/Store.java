package com.conlangs.web;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * All writes to dictionary data go through here: permission check, pending-approval flow,
 * edit log (undo/redo) and the actual SQL.
 */
@Service
public class Store {
    private static final Map<String, String> TABLE = Map.of("word", "words", "rule", "rules", "override", "word_overrides", "form", "word_forms",
            "gsection", "grammar_sections", "grammar", "grammar_entries", "phoneme", "phonemes", "formrule", "form_rules", "meaning", "word_meanings");
    private static final Map<String, List<String>> FIELDS = Map.of(
            "word", List.of("gloss", "pos", "build", "form", "year", "notes"),
            "rule", List.of("year", "ord", "name", "pattern", "replacement", "note"),
            "override", List.of("word_id", "lang_id", "year", "form"),
            "form", List.of("word_id", "label", "form", "year"),
            "gsection", List.of("title", "headings", "ord"),
            "grammar", List.of("category", "name", "c1", "c2", "c3", "c4", "c5", "c6", "year", "ord"),
            "phoneme", List.of("symbol", "kind", "row_label", "col_label", "notes", "year", "year_to"),
            "formrule", List.of("grp", "label", "pos", "placement", "affix", "affix_word_id", "cond_re", "hiatus", "year", "ord"),
            "meaning", List.of("word_id", "lang_id", "year", "mode", "meaning"));
    private static final Set<String> LANG_OWNED = Set.of("word", "rule", "gsection", "grammar", "phoneme", "formrule");
    private static final Set<String> INTS = Set.of("year", "ord", "word_id", "lang_id", "year_to", "hiatus", "affix_word_id");
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};

    private final Db db;
    private final Access access;
    private final ObjectMapper om;
    private final FormGenerator forms;
    private final AppLog applog;

    public Store(Db db, Access access, ObjectMapper om, FormGenerator forms, AppLog applog) {
        this.db = db;
        this.access = access;
        this.om = om;
        this.forms = forms;
        this.applog = applog;
    }

    // ---------- helpers ----------

    public Map<String, String> classesOf(long langId) {
        List<String> chain = new ArrayList<>();
        Long cur = langId;
        int guard = 0;
        while (cur != null && guard++ < 50) {
            Map<String, Object> l = db.one("select classes, parent_id from languages where id=?", cur);
            if (l == null) break;
            chain.add(0, (String) l.get("classes"));
            cur = l.get("parent_id") == null ? null : Db.num(l.get("parent_id"));
        }
        Map<String, String> m = new LinkedHashMap<>();
        for (String c : chain) m.putAll(Patterns.parseClasses(c));
        return m;
    }

    private Long rowLang(String entity, long id) {
        Map<String, Object> r = switch (entity) {
            case "override", "form", "meaning" -> db.one("select w.language_id as lid from " + TABLE.get(entity) + " o join words w on w.id=o.word_id where o.id=?", id);
            default -> db.one("select language_id as lid from " + TABLE.get(entity) + " where id=?", id);
        };
        return r == null ? null : Db.num(r.get("lid"));
    }

    private static Object coerce(String field, Object v) {
        if (v == null) return null;
        if (INTS.contains(field)) {
            if (v instanceof Number n) return n.longValue();
            if (v.toString().isBlank()) return null;
            try {
                return Long.parseLong(v.toString().trim());
            } catch (NumberFormatException e) {
                throw new ApiException(400, "'" + field + "' must be a whole number.");
            }
        }
        return v.toString();
    }

    private static boolean blank(Object o) {
        return o == null || o.toString().isBlank();
    }

    /** Validates and normalises a change. Throws ApiException(400/404) when it can't be applied. */
    public Map<String, Object> validate(long langId, String entity, String action, Long entityId, Map<String, Object> payload) {
        if (!TABLE.containsKey(entity)) throw new ApiException(400, "Unknown entity '" + entity + "'.");
        if (!Set.of("CREATE", "UPDATE", "DELETE").contains(action)) throw new ApiException(400, "Unknown action '" + action + "'.");
        Map<String, Object> clean = new LinkedHashMap<>();
        if (!action.equals("DELETE")) {
            Map<String, Object> p = payload == null ? Map.of() : payload;
            for (String f : FIELDS.get(entity)) {
                if (p.containsKey(f)) clean.put(f, coerce(f, p.get(f)));
            }
        }
        if (!action.equals("CREATE")) {
            if (entityId == null) throw new ApiException(400, "entityId is required.");
            Long rl = rowLang(entity, entityId);
            if (rl == null || rl != langId) throw new ApiException(404, "That " + entity + " doesn't exist in this language.");
        }
        if (action.equals("CREATE")) {
            switch (entity) {
                case "word" -> {
                    if (blank(clean.get("gloss")) || blank(clean.get("form"))) throw new ApiException(400, "A word needs a gloss and a form.");
                    clean.putIfAbsent("year", 0L);
                }
                case "rule" -> {
                    if (blank(clean.get("pattern"))) throw new ApiException(400, "A rule needs a pattern.");
                    if (clean.get("year") == null) throw new ApiException(400, "A rule needs a year.");
                    clean.putIfAbsent("ord", 0L);
                    clean.putIfAbsent("replacement", "");
                }
                case "meaning" -> {
                    if (clean.get("word_id") == null || clean.get("lang_id") == null || clean.get("year") == null || blank(clean.get("meaning")))
                        throw new ApiException(400, "A meaning change needs word_id, lang_id, year and a meaning.");
                    String md = clean.get("mode") == null ? "" : clean.get("mode").toString().trim().toUpperCase();
                    if (!md.equals("ADD") && !md.equals("CHANGE")) throw new ApiException(400, "Mode must be ADD or CHANGE.");
                    clean.put("mode", md);
                    clean.put("meaning", clean.get("meaning").toString().trim());
                }
                case "override" -> {
                    if (clean.get("word_id") == null || clean.get("lang_id") == null || clean.get("year") == null || blank(clean.get("form")))
                        throw new ApiException(400, "An override needs word_id, lang_id, year and form.");
                }
                case "form" -> {
                    if (clean.get("word_id") == null || blank(clean.get("label")) || blank(clean.get("form")))
                        throw new ApiException(400, "A form needs word_id, label and form.");
                    clean.put("label", clean.get("label").toString().trim());
                }
                case "formrule" -> {
                    if (blank(clean.get("label")) || (blank(clean.get("affix")) && clean.get("affix_word_id") == null))
                        throw new ApiException(400, "A form rule needs a name and either an affix or a dictionary word to take it from.");
                    if (clean.get("affix") == null) clean.put("affix", "");
                    if (clean.get("affix_word_id") != null) {
                        Long wl = rowLang("word", ((Number) clean.get("affix_word_id")).longValue());
                        if (wl == null || (wl != langId && !access.ancestors(langId).contains(wl)))
                            throw new ApiException(400, "The affix word must be in this language or one of its ancestors.");
                    }
                    String pl = clean.get("placement") == null ? "suffix" : clean.get("placement").toString().toLowerCase();
                    if (!pl.equals("prefix") && !pl.equals("suffix")) throw new ApiException(400, "Placement must be prefix or suffix.");
                    clean.put("placement", pl);
                    clean.put("label", clean.get("label").toString().trim());
                    clean.putIfAbsent("hiatus", 0L);
                    if (clean.get("hiatus") == null) clean.put("hiatus", 0L);
                    if (!blank(clean.get("cond_re"))) {
                        try {
                            Patterns.compile((String) clean.get("cond_re"), classesOf(langId));
                        } catch (IllegalArgumentException e) {
                            throw new ApiException(400, e.getMessage());
                        }
                    }
                }
                case "gsection" -> {
                    if (blank(clean.get("title"))) throw new ApiException(400, "A section needs a title.");
                }
                case "grammar" -> {
                    if (blank(clean.get("category")) || blank(clean.get("name")))
                        throw new ApiException(400, "A grammar row needs a section and a name.");
                }
                case "phoneme" -> {
                    if (blank(clean.get("symbol"))) throw new ApiException(400, "A sound needs a symbol.");
                    String k = clean.get("kind") == null ? "" : clean.get("kind").toString().toLowerCase();
                    if (!k.equals("consonant") && !k.equals("vowel")) throw new ApiException(400, "Kind must be consonant or vowel.");
                    clean.put("kind", k);
                }
                default -> { }
            }
        }
        if (clean.containsKey("ord") && clean.get("ord") == null) clean.remove("ord");
        if ((entity.equals("word") || entity.equals("form")) && clean.containsKey("form") && blank(clean.get("form")) && !action.equals("DELETE"))
            throw new ApiException(400, "Form can't be empty.");
        if (entity.equals("rule") && clean.containsKey("pattern")) {
            try {
                Patterns.compile((String) clean.get("pattern"), classesOf(langId));
            } catch (IllegalArgumentException e) {
                throw new ApiException(400, e.getMessage());
            }
        }
        if ((entity.equals("override") || entity.equals("form") || entity.equals("meaning")) && action.equals("CREATE")) {
            Long wl = rowLang("word", ((Number) clean.get("word_id")).longValue());
            if (wl == null || wl != langId) throw new ApiException(404, "That word isn't in this language.");
        }
        if (entity.equals("form") && action.equals("CREATE")
                && db.count("select count(*) from word_forms where word_id=? and lower(label)=lower(?)", clean.get("word_id"), clean.get("label")) > 0)
            throw new ApiException(409, "That word already has a '" + clean.get("label") + "' form.");
        if ((entity.equals("override") || entity.equals("meaning")) && action.equals("CREATE")) {
            Map<String, Object> target = db.one("select l.world_id from languages l where l.id=?", clean.get("lang_id"));
            Map<String, Object> mine = access.language(langId);
            if (target == null || Db.num(target.get("world_id")) != Db.num(mine.get("world_id")))
                throw new ApiException(400, "Override language must be in the same world.");
        }
        return clean;
    }

    private Map<String, Object> snapshot(String entity, long id) {
        return db.one("select * from " + TABLE.get(entity) + " where id=?", id);
    }

    private String json(Object o) {
        try {
            return o == null ? null : om.writeValueAsString(o);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private void restore(String table, Map<String, Object> row) {
        for (String k : row.keySet()) if (!k.matches("[a-z_]+")) throw new IllegalStateException("bad column " + k);
        Object id = row.get("id");
        boolean exists = db.count("select count(*) from " + table + " where id=?", id) > 0;
        List<Object> args = new ArrayList<>();
        if (exists) {
            StringBuilder sb = new StringBuilder("update " + table + " set ");
            boolean first = true;
            for (Map.Entry<String, Object> e : row.entrySet()) {
                if (e.getKey().equals("id")) continue;
                sb.append(first ? "" : ", ").append(e.getKey()).append("=?");
                args.add(e.getValue());
                first = false;
            }
            sb.append(" where id=?");
            args.add(id);
            db.update(sb.toString(), args.toArray());
        } else {
            StringBuilder cols = new StringBuilder(), qs = new StringBuilder();
            for (Map.Entry<String, Object> e : row.entrySet()) {
                if (cols.length() > 0) {
                    cols.append(", ");
                    qs.append(", ");
                }
                cols.append(e.getKey());
                qs.append("?");
                args.add(e.getValue());
            }
            db.update("insert into " + table + "(" + cols + ") values (" + qs + ")", args.toArray());
        }
    }

    // ---------- applying changes ----------

    /** Performs a validated change and writes the edit log. Returns the affected entity id. */
    @Transactional
    public long apply(long langId, long userId, String entity, String action, Long entityId, Map<String, Object> clean) {
        String table = TABLE.get(entity);
        Map<String, Object> before = null, after;
        long id;
        switch (action) {
            case "CREATE" -> {
                List<String> cols = new ArrayList<>();
                List<Object> args = new ArrayList<>();
                if (LANG_OWNED.contains(entity)) {
                    cols.add("language_id");
                    args.add(langId);
                }
                for (Map.Entry<String, Object> e : clean.entrySet()) {
                    cols.add(e.getKey());
                    args.add(e.getValue());
                }
                id = db.insert("insert into " + table + "(" + String.join(", ", cols) + ") values ("
                        + "?, ".repeat(cols.size() - 1) + "?)", args.toArray());
                after = snapshot(entity, id);
            }
            case "UPDATE" -> {
                id = entityId;
                before = snapshot(entity, id);
                if (!clean.isEmpty()) {
                    List<Object> args = new ArrayList<>();
                    StringBuilder sb = new StringBuilder("update " + table + " set ");
                    for (Map.Entry<String, Object> e : clean.entrySet()) {
                        if (!args.isEmpty()) sb.append(", ");
                        sb.append(e.getKey()).append("=?");
                        args.add(e.getValue());
                    }
                    args.add(id);
                    db.update(sb + " where id=?", args.toArray());
                }
                after = snapshot(entity, id);
            }
            default -> {
                id = entityId;
                before = snapshot(entity, id);
                db.update("delete from " + table + " where id=?", id);
                after = null;
            }
        }
        db.update("delete from edit_log where language_id=? and undone=true", langId);
        db.update("insert into edit_log(language_id, user_id, entity, action, entity_id, before_json, after_json) values (?,?,?,?,?,?,?)",
                langId, userId, entity, action, id, json(before), json(after));
        // New words (or words whose type / form changed) automatically get the forms their language's form rules call for.
        if (entity.equals("word") && (action.equals("CREATE") || (action.equals("UPDATE") && (clean.containsKey("form") || clean.containsKey("pos"))))) {
            forms.generate(langId, id, null, false);
        }
        return id;
    }

    /** Entry point for user edits: applies immediately for owners / auto-approved editors, else queues as pending. */
    @Transactional
    public Map<String, Object> submit(long uid, long langId, String entity, String action, Long entityId, Map<String, Object> payload) {
        Map<String, Object> lang = access.need(uid, langId, Access.EDITOR);
        Map<String, Object> clean = validate(langId, entity, action, entityId, payload);
        boolean direct = (int) lang.get("level") == Access.OWNER || access.autoApprove(uid, langId);
        if (direct) {
            long id = apply(langId, uid, entity, action, entityId, clean);
            applog.info("edit", uid, "Applied: " + action.toLowerCase() + " " + entity + " #" + id + " in language " + langId);
            return Map.of("status", "applied", "id", id);
        }
        long cid = db.insert("insert into changes(language_id, author_id, entity, action, entity_id, payload) values (?,?,?,?,?,?)",
                langId, uid, entity, action, entityId, json(clean));
        applog.info("edit", uid, "Pending approval: " + action.toLowerCase() + " " + entity + (entityId == null ? "" : " #" + entityId) + " in language " + langId + " (change #" + cid + ")");
        return Map.of("status", "pending", "changeId", cid);
    }

    @Transactional
    public void decide(long uid, long changeId, boolean approve) {
        Map<String, Object> c = db.one("select * from changes where id=?", changeId);
        if (c == null) throw new ApiException(404, "No such change.");
        long langId = Db.num(c.get("language_id"));
        access.need(uid, langId, Access.OWNER);
        if (!"PENDING".equals(c.get("status"))) throw new ApiException(409, "That change was already decided.");
        if (approve) {
            try {
                Map<String, Object> payload = c.get("payload") == null ? Map.of() : om.readValue((String) c.get("payload"), MAP);
                Long eid = c.get("entity_id") == null ? null : Db.num(c.get("entity_id"));
                String entity = (String) c.get("entity"), action = (String) c.get("action");
                Map<String, Object> clean = validate(langId, entity, action, eid, payload);
                apply(langId, Db.num(c.get("author_id")), entity, action, eid, clean);
            } catch (ApiException e) {
                throw e;
            } catch (Exception e) {
                throw new ApiException(400, "Could not apply: " + e.getMessage());
            }
        }
        db.update("update changes set status=?, decided_by=? where id=?", approve ? "APPROVED" : "DENIED", uid, changeId);
        applog.info("edit", uid, (approve ? "Approved" : "Denied") + " change #" + changeId + " (" + c.get("action") + " " + c.get("entity") + ") in language " + langId);
    }

    // ---------- undo / redo ----------

    @Transactional
    public Map<String, Object> undo(long uid, long langId) {
        Map<String, Object> lang = access.need(uid, langId, Access.EDITOR);
        boolean owner = (int) lang.get("level") == Access.OWNER;
        Map<String, Object> e = owner
                ? db.one("select * from edit_log where language_id=? and undone=false order by id desc limit 1", langId)
                : db.one("select * from edit_log where language_id=? and undone=false and user_id=? order by id desc limit 1", langId, uid);
        if (e == null) throw new ApiException(409, "Nothing to undo.");
        String entity = (String) e.get("entity"), action = (String) e.get("action"), table = TABLE.get(entity);
        long eid = Db.num(e.get("entity_id"));
        try {
            if (action.equals("CREATE")) db.update("delete from " + table + " where id=?", eid);
            else restore(table, om.readValue((String) e.get("before_json"), MAP));
            if (entity.equals("word") && action.equals("DELETE")) forms.generate(langId, eid, null, false);
        } catch (ApiException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new ApiException(409, "Can't undo that any more: " + ex.getMessage());
        }
        db.update("update edit_log set undone=true where id=?", e.get("id"));
        applog.info("edit", uid, "Undo: " + action.toLowerCase() + " " + entity + " #" + eid + " in language " + langId);
        return Map.of("undone", entity + " " + action.toLowerCase());
    }

    @Transactional
    public Map<String, Object> redo(long uid, long langId) {
        Map<String, Object> lang = access.need(uid, langId, Access.EDITOR);
        boolean owner = (int) lang.get("level") == Access.OWNER;
        Map<String, Object> e = owner
                ? db.one("select * from edit_log where language_id=? and undone=true order by id asc limit 1", langId)
                : db.one("select * from edit_log where language_id=? and undone=true and user_id=? order by id asc limit 1", langId, uid);
        if (e == null) throw new ApiException(409, "Nothing to redo.");
        String entity = (String) e.get("entity"), action = (String) e.get("action"), table = TABLE.get(entity);
        try {
            if (action.equals("DELETE")) db.update("delete from " + table + " where id=?", e.get("entity_id"));
            else restore(table, om.readValue((String) e.get("after_json"), MAP));
            if (entity.equals("word") && action.equals("CREATE")) forms.generate(langId, Db.num(e.get("entity_id")), null, false);
        } catch (Exception ex) {
            throw new ApiException(409, "Can't redo that any more: " + ex.getMessage());
        }
        db.update("update edit_log set undone=false where id=?", e.get("id"));
        applog.info("edit", uid, "Redo: " + action.toLowerCase() + " " + entity + " #" + e.get("entity_id") + " in language " + langId);
        return Map.of("redone", entity + " " + action.toLowerCase());
    }
}
