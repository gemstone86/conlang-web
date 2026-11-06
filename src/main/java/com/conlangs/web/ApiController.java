package com.conlangs.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api")
public class ApiController {
    private final Db db;
    private final Auth auth;
    private final Access access;
    private final Store store;
    private final DictService dict;
    private final ExportService export;
    private final ImportService imports;
    private final GrammarImportService grammarImport;
    private final FormGenerator forms;
    private final AppLog applog;
    private final SentenceService sentences;
    private final GraphService graphs;
    private final RuleTransferService ruleTransfer;

    public ApiController(Db db, Auth auth, Access access, Store store, DictService dict, ExportService export, ImportService imports, GrammarImportService grammarImport, FormGenerator forms, AppLog applog, SentenceService sentences, GraphService graphs, RuleTransferService ruleTransfer) {
        this.db = db;
        this.auth = auth;
        this.access = access;
        this.store = store;
        this.dict = dict;
        this.export = export;
        this.imports = imports;
        this.grammarImport = grammarImport;
        this.forms = forms;
        this.applog = applog;
        this.sentences = sentences;
        this.graphs = graphs;
        this.ruleTransfer = ruleTransfer;
    }

    private static String str(Map<String, Object> b, String k) {
        Object v = b == null ? null : b.get(k);
        return v == null ? null : v.toString();
    }

    private static Long lng(Map<String, Object> b, String k) {
        Object v = b == null ? null : b.get(k);
        if (v == null || v.toString().isBlank()) return null;
        try {
            return v instanceof Number n ? n.longValue() : Long.parseLong(v.toString().trim());
        } catch (NumberFormatException e) {
            throw new ApiException(400, "'" + k + "' must be a number.");
        }
    }

    @Value("${app.version:dev}")
    private String appVersion;
    @Value("${app.built:}")
    private String appBuilt;

    @GetMapping("/version")
    public Map<String, Object> version() {
        return Map.of("version", appVersion, "built", appBuilt);
    }

    // ---------------- auth ----------------

    @GetMapping("/auth/me")
    public Map<String, Object> me(HttpSession s) {
        Map<String, Object> u = auth.current(s);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("user", u);
        out.put("registrationOpen", auth.registrationOpen());
        return out;
    }

    @PostMapping("/auth/register")
    public Map<String, Object> register(@RequestBody Map<String, Object> b, HttpServletRequest req) {
        auth.register(str(b, "username"), str(b, "password"));
        auth.login(str(b, "username"), str(b, "password"), req);
        return me(req.getSession());
    }

    @PostMapping("/auth/login")
    public Map<String, Object> login(@RequestBody Map<String, Object> b, HttpServletRequest req) {
        auth.login(str(b, "username"), str(b, "password"), req);
        return me(req.getSession());
    }

    @PostMapping("/auth/logout")
    public Map<String, Object> logout(HttpSession s) {
        auth.logout(s);
        return Map.of("ok", true);
    }

    @PostMapping("/auth/reset")
    public Map<String, Object> reset(@RequestBody Map<String, Object> b) {
        auth.resetPassword(str(b, "username"), str(b, "code"), str(b, "password"));
        return Map.of("ok", true);
    }

    @PostMapping("/admin/reset-code")
    public Map<String, Object> resetCode(@RequestBody Map<String, Object> b, HttpSession s) {
        long admin = auth.requireAdmin(s);
        String code = auth.issueResetCode(str(b, "username"));
        applog.info("auth", admin, "Issued a password reset code for '" + str(b, "username") + "'");
        return Map.of("username", str(b, "username"), "code", code, "validHours", 24);
    }

    @GetMapping("/admin/users")
    public List<Map<String, Object>> users(HttpSession s) {
        auth.requireAdmin(s);
        return db.rows("select id, username, is_admin, created from users order by username");
    }

    @PostMapping("/admin/import-elven")
    public Map<String, Object> importElven(@RequestParam("file") MultipartFile file, @RequestParam("languageId") long languageId, HttpSession s) throws Exception {
        long uid = auth.requireAdmin(s);
        access.need(uid, languageId, Access.OWNER);
        Map<String, Object> res = imports.importDictionary(file.getInputStream(), languageId, uid);
        applog.info("import", uid, "Dictionary import into language " + languageId + ": " + res.get("imported") + " words, " + res.get("skippedCount") + " skipped",
                "per group: " + res.get("perGroup") + "\nskipped (first 50): " + res.get("skipped"));
        return res;
    }

    @GetMapping("/admin/log")
    public List<Map<String, Object>> adminLog(@RequestParam(defaultValue = "") String level, @RequestParam(defaultValue = "") String category,
            @RequestParam(defaultValue = "") String q, @RequestParam(defaultValue = "0") long before,
            @RequestParam(defaultValue = "100") int limit, HttpSession s) {
        auth.requireAdmin(s);
        StringBuilder sql = new StringBuilder("select id, ts, lvl, category, username, request, status, message, (detail is not null) as has_detail from app_log where 1=1");
        List<Object> args = new ArrayList<>();
        if (level.equalsIgnoreCase("ERROR")) sql.append(" and lvl='ERROR'");
        else if (level.equalsIgnoreCase("WARN")) sql.append(" and lvl in ('WARN','ERROR')");
        if (!category.isBlank()) {
            sql.append(" and category=?");
            args.add(category);
        }
        if (!q.isBlank()) {
            sql.append(" and (lower(message) like ? or lower(request) like ? or lower(username) like ?)");
            String like = "%" + q.toLowerCase() + "%";
            args.add(like);
            args.add(like);
            args.add(like);
        }
        if (before > 0) {
            sql.append(" and id < ?");
            args.add(before);
        }
        sql.append(" order by id desc limit ?");
        args.add(Math.max(1, Math.min(limit, 500)));
        return db.rows(sql.toString(), args.toArray());
    }

    @GetMapping("/admin/log/{id}")
    public Map<String, Object> adminLogEntry(@PathVariable long id, HttpSession s) {
        auth.requireAdmin(s);
        Map<String, Object> r = db.one("select * from app_log where id=?", id);
        if (r == null) throw new ApiException(404, "No such log entry.");
        return r;
    }

    @GetMapping(value = "/admin/log.txt", produces = "text/plain;charset=UTF-8")
    public String adminLogText(@RequestParam(defaultValue = "300") int limit, HttpSession s) {
        auth.requireAdmin(s);
        StringBuilder sb = new StringBuilder();
        for (Map<String, Object> r : db.rows("select * from app_log order by id desc limit ?", Math.max(1, Math.min(limit, 2000)))) {
            sb.append('#').append(r.get("id")).append(' ').append(r.get("ts")).append(' ').append(r.get("lvl")).append(" [").append(r.get("category")).append("] ")
              .append(r.get("username") == null ? "-" : r.get("username")).append(' ');
            if (r.get("request") != null) sb.append(r.get("request")).append(' ');
            if (r.get("status") != null) sb.append(r.get("status")).append(' ');
            sb.append(r.get("message")).append('\n');
            if (r.get("detail") != null) sb.append(r.get("detail")).append('\n');
        }
        return sb.toString();
    }

    @DeleteMapping("/admin/log")
    public Map<String, Object> clearLog(HttpSession s) {
        long admin = auth.requireAdmin(s);
        db.update("delete from app_log");
        applog.info("system", admin, "Log cleared");
        return Map.of("ok", true);
    }

    @PostMapping("/admin/import-grammar")
    public Map<String, Object> importGrammar(@RequestParam("file") MultipartFile file, @RequestParam("languageId") long languageId,
            @RequestParam(value = "replace", defaultValue = "false") boolean replace, HttpSession s) throws Exception {
        long uid = auth.requireAdmin(s);
        access.need(uid, languageId, Access.OWNER);
        Map<String, Object> res = grammarImport.importSheet(file.getInputStream(), languageId, replace);
        applog.info("import", uid, "Grammar import into language " + languageId + ": " + res);
        return res;
    }

    // ---------------- worlds & languages ----------------

    @GetMapping("/worlds")
    public List<Map<String, Object>> worlds(HttpSession s) {
        long uid = auth.requireUid(s);
        Map<Long, Map<String, Object>> worlds = new LinkedHashMap<>();
        for (Map<String, Object> w : db.rows("select * from worlds where owner_id=? order by lower(name)", uid)) {
            w.put("mine", true);
            w.put("languages", new ArrayList<Map<String, Object>>());
            worlds.put(Db.num(w.get("id")), w);
        }
        String sql = "select l.*, w.name as world_name, w.owner_id as world_owner from languages l join worlds w on w.id=l.world_id "
                + "where l.owner_id=? or w.owner_id=? or exists (select 1 from shares s where s.user_id=? and "
                + "((s.scope='LANGUAGE' and s.target_id=l.id) or (s.scope='WORLD' and s.target_id=l.world_id))) order by lower(l.name)";
        for (Map<String, Object> l : db.rows(sql, uid, uid, uid)) {
            long wid = Db.num(l.get("world_id"));
            Map<String, Object> w = worlds.get(wid);
            if (w == null) {
                w = new LinkedHashMap<>();
                w.put("id", wid);
                w.put("name", l.get("world_name"));
                w.put("owner_id", l.get("world_owner"));
                w.put("mine", false);
                w.put("languages", new ArrayList<Map<String, Object>>());
                worlds.put(wid, w);
            }
            l.put("level", access.level(uid, l));
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> langs = (List<Map<String, Object>>) w.get("languages");
            langs.add(l);
        }
        return new ArrayList<>(worlds.values());
    }

    @PostMapping("/worlds")
    public Map<String, Object> createWorld(@RequestBody Map<String, Object> b, HttpSession s) {
        long uid = auth.requireUid(s);
        String name = str(b, "name");
        if (name == null || name.isBlank()) throw new ApiException(400, "A world needs a name.");
        long wid = db.insert("insert into worlds(name, owner_id) values (?,?)", name.trim(), uid);
        applog.info("edit", uid, "Created world '" + name.trim() + "' (#" + wid + ")");
        return Map.of("id", wid);
    }

    @DeleteMapping("/worlds/{id}")
    public Map<String, Object> deleteWorld(@PathVariable long id, HttpSession s) {
        long uid = auth.requireUid(s);
        Map<String, Object> w = db.one("select * from worlds where id=?", id);
        if (w == null || Db.num(w.get("owner_id")) != uid) throw new ApiException(404, "No such world.");
        db.update("update languages set parent_id=null where world_id=?", id);
        db.update("delete from shares where scope='LANGUAGE' and target_id in (select id from languages where world_id=?)", id);
        db.update("delete from shares where scope='WORLD' and target_id=?", id);
        db.update("delete from worlds where id=?", id);
        applog.info("edit", uid, "Deleted world #" + id + " ('" + w.get("name") + "')");
        return Map.of("ok", true);
    }

    private void checkParent(long worldId, Long selfId, Long parentId) {
        if (parentId == null) return;
        Map<String, Object> p = db.one("select world_id, parent_id from languages where id=?", parentId);
        if (p == null || Db.num(p.get("world_id")) != worldId) throw new ApiException(400, "Parent language must be in the same world.");
        Long cur = parentId;
        for (int i = 0; i < 100 && cur != null; i++) {
            if (selfId != null && cur.equals(selfId)) throw new ApiException(400, "A language can't descend from itself.");
            Map<String, Object> r = db.one("select parent_id from languages where id=?", cur);
            cur = r == null || r.get("parent_id") == null ? null : Db.num(r.get("parent_id"));
        }
    }

    @PostMapping("/languages")
    public Map<String, Object> createLanguage(@RequestBody Map<String, Object> b, HttpSession s) {
        long uid = auth.requireUid(s);
        Long worldId = lng(b, "worldId");
        Map<String, Object> w = worldId == null ? null : db.one("select * from worlds where id=?", worldId);
        if (w == null) throw new ApiException(404, "No such world.");
        boolean ok = Db.num(w.get("owner_id")) == uid
                || db.count("select count(*) from shares where user_id=? and scope='WORLD' and target_id=? and level='EDITOR'", uid, worldId) > 0;
        if (!ok) throw new ApiException(403, "You can't add languages to that world.");
        String name = str(b, "name");
        if (name == null || name.isBlank()) throw new ApiException(400, "A language needs a name.");
        Long parent = lng(b, "parentId");
        Long split = lng(b, "splitYear");
        checkParent(worldId, null, parent);
        if (parent != null && split == null) throw new ApiException(400, "A branch language needs a split year.");
        long id = db.insert("insert into languages(world_id, owner_id, name, parent_id, split_year) values (?,?,?,?,?)",
                worldId, uid, name.trim(), parent, split);
        applog.info("edit", uid, "Created language '" + name.trim() + "' (#" + id + ") in world #" + worldId + (parent == null ? "" : ", branch of #" + parent + " at " + split));
        return Map.of("id", id);
    }

    @GetMapping("/languages/{id}")
    public Map<String, Object> language(@PathVariable long id, HttpSession s) {
        return access.need(auth.requireUid(s), id, Access.VIEWER);
    }

    @PutMapping("/languages/{id}")
    public Map<String, Object> updateLanguage(@PathVariable long id, @RequestBody Map<String, Object> b, HttpSession s) {
        long uidU = auth.requireUid(s);
        Map<String, Object> l = access.need(uidU, id, Access.OWNER);
        applog.info("edit", uidU, "Saved settings of language #" + id);
        Long parent = b.containsKey("parentId") ? lng(b, "parentId") : (l.get("parent_id") == null ? null : Db.num(l.get("parent_id")));
        Long split = b.containsKey("splitYear") ? lng(b, "splitYear") : (l.get("split_year") == null ? null : Db.num(l.get("split_year")));
        checkParent(Db.num(l.get("world_id")), id, parent);
        if (parent != null && split == null) throw new ApiException(400, "A branch language needs a split year.");
        String name = b.containsKey("name") ? str(b, "name") : (String) l.get("name");
        if (name == null || name.isBlank()) throw new ApiException(400, "A language needs a name.");
        Long target = b.containsKey("erosionTarget") ? lng(b, "erosionTarget") : null;
        db.update("update languages set name=?, parent_id=?, split_year=?, classes=?, erosion=?, erosion_target=?, ipa_map=?, grammar=?, def_suffix=? where id=?",
                name.trim(), parent, split,
                b.containsKey("classes") ? str(b, "classes") : l.get("classes"),
                b.containsKey("erosion") ? str(b, "erosion") : l.get("erosion"),
                target != null ? target : l.get("erosion_target"),
                b.containsKey("ipaMap") ? str(b, "ipaMap") : l.get("ipa_map"),
                b.containsKey("grammar") ? str(b, "grammar") : l.get("grammar"),
                b.containsKey("defSuffix") ? str(b, "defSuffix") : l.get("def_suffix"), id);
        return Map.of("ok", true);
    }

    @DeleteMapping("/languages/{id}")
    public Map<String, Object> deleteLanguage(@PathVariable long id, HttpSession s) {
        long uidD = auth.requireUid(s);
        access.need(uidD, id, Access.OWNER);
        applog.info("edit", uidD, "Deleting language #" + id);
        if (db.count("select count(*) from languages where parent_id=?", id) > 0)
            throw new ApiException(409, "Delete or re-parent its branches first.");
        db.update("delete from shares where scope='LANGUAGE' and target_id=?", id);
        db.update("delete from word_overrides where lang_id=?", id);
        db.update("delete from word_meanings where lang_id=?", id);
        db.update("delete from sentences where language_id=?", id);
        db.update("delete from languages where id=?", id);
        return Map.of("ok", true);
    }

    // ---------------- sharing ----------------

    private void needShareOwner(long uid, String scope, long target) {
        if ("WORLD".equals(scope)) {
            Map<String, Object> w = db.one("select owner_id from worlds where id=?", target);
            if (w == null || Db.num(w.get("owner_id")) != uid) throw new ApiException(404, "No such world.");
        } else if ("LANGUAGE".equals(scope)) {
            access.need(uid, target, Access.OWNER);
        } else {
            throw new ApiException(400, "scope must be WORLD or LANGUAGE.");
        }
    }

    @GetMapping("/shares")
    public List<Map<String, Object>> shares(@RequestParam String scope, @RequestParam long targetId, HttpSession s) {
        needShareOwner(auth.requireUid(s), scope, targetId);
        return db.rows("select s.id, s.scope, s.target_id, s.level, s.auto_approve, u.username from shares s join users u on u.id=s.user_id "
                + "where s.scope=? and s.target_id=? order by lower(u.username)", scope, targetId);
    }

    @PostMapping("/shares")
    public Map<String, Object> share(@RequestBody Map<String, Object> b, HttpSession s) {
        long uid = auth.requireUid(s);
        String scope = str(b, "scope");
        Long target = lng(b, "targetId");
        if (target == null) throw new ApiException(400, "targetId is required.");
        needShareOwner(uid, scope, target);
        String level = "EDITOR".equalsIgnoreCase(str(b, "level")) ? "EDITOR" : "VIEWER";
        Map<String, Object> u = db.one("select id from users where lower(username)=lower(?)", str(b, "username"));
        if (u == null) throw new ApiException(404, "No user with that name.");
        if (Db.num(u.get("id")) == uid) throw new ApiException(400, "You already own this.");
        boolean auto = "EDITOR".equals(level) && Boolean.parseBoolean(String.valueOf(b.get("autoApprove")));
        db.update("delete from shares where scope=? and target_id=? and user_id=?", scope, target, u.get("id"));
        db.insert("insert into shares(scope, target_id, user_id, level, auto_approve) values (?,?,?,?,?)", scope, target, u.get("id"), level, auto);
        applog.info("share", uid, "Shared " + scope.toLowerCase() + " #" + target + " with '" + str(b, "username") + "' as " + level.toLowerCase() + (auto ? " (auto-approve)" : ""));
        return Map.of("ok", true);
    }

    @DeleteMapping("/shares/{id}")
    public Map<String, Object> revoke(@PathVariable long id, HttpSession s) {
        long uid = auth.requireUid(s);
        Map<String, Object> sh = db.one("select * from shares where id=?", id);
        if (sh == null) throw new ApiException(404, "No such share.");
        needShareOwner(uid, (String) sh.get("scope"), Db.num(sh.get("target_id")));
        db.update("delete from shares where id=?", id);
        applog.info("share", uid, "Revoked share #" + id + " (" + sh.get("scope") + " #" + sh.get("target_id") + ")");
        return Map.of("ok", true);
    }

    // ---------------- dictionary, rules, edits ----------------

    @GetMapping("/languages/{id}/words")
    public List<Map<String, Object>> words(@PathVariable long id, HttpSession s) {
        return dict.words(auth.requireUid(s), id);
    }

    @GetMapping("/words/{id}/history")
    public Map<String, Object> history(@PathVariable long id, HttpSession s) {
        return dict.history(auth.requireUid(s), id);
    }

    /** scope: self | branches (this language + all branches) | path (ancestors + this language). */
    @GetMapping("/languages/{id}/rules")
    public List<Map<String, Object>> rules(@PathVariable long id, @RequestParam(defaultValue = "self") String scope, HttpSession s) {
        long uid = auth.requireUid(s);
        access.need(uid, id, Access.VIEWER);
        List<Long> ids = new ArrayList<>();
        ids.add(id);
        if ("branches".equals(scope)) ids.addAll(access.descendants(id));
        else if ("path".equals(scope)) ids.addAll(access.ancestors(id));
        List<Long> visible = new ArrayList<>();
        Map<Long, Integer> levels = new java.util.HashMap<>();
        for (long lid : ids) {
            int lv = access.level(uid, lid);
            if (lv >= Access.VIEWER) {
                visible.add(lid);
                levels.put(lid, lv);
            }
        }
        String qs = String.join(",", java.util.Collections.nCopies(visible.size(), "?"));
        List<Map<String, Object>> rows = db.rows("select r.*, l.name as lang_name from rules r join languages l on l.id=r.language_id "
                + "where r.language_id in (" + qs + ") order by r.year, lower(l.name), r.ord, r.id", visible.toArray());
        for (Map<String, Object> r : rows) r.put("level", levels.get(Db.num(r.get("language_id"))));
        return rows;
    }

    @GetMapping("/languages/{id}/grammar")
    public Map<String, Object> grammar(@PathVariable long id, HttpSession s) {
        access.need(auth.requireUid(s), id, Access.VIEWER);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sections", db.rows("select * from grammar_sections where language_id=? order by ord, id", id));
        out.put("entries", db.rows("select * from grammar_entries where language_id=? order by ord, id", id));
        return out;
    }

    @GetMapping("/languages/{id}/phonemes")
    public List<Map<String, Object>> phonemes(@PathVariable long id, HttpSession s) {
        access.need(auth.requireUid(s), id, Access.VIEWER);
        return db.rows("select * from phonemes where language_id=? order by id", id);
    }

    @PostMapping("/languages/{id}/edit")
    public Map<String, Object> edit(@PathVariable long id, @RequestBody Map<String, Object> b, HttpSession s) {
        @SuppressWarnings("unchecked")
        Map<String, Object> payload = b.get("payload") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        long uidE = auth.requireUid(s);
        if ("word".equals(str(b, "entity")) && !"DELETE".equals(str(b, "action"))) payload = dict.resolveLoan(uidE, id, payload);
        return store.submit(uidE, id, str(b, "entity"), str(b, "action"), lng(b, "entityId"), payload);
    }

    @GetMapping("/languages/{id}/formrules")
    public List<Map<String, Object>> formRules(@PathVariable long id, HttpSession s) {
        access.need(auth.requireUid(s), id, Access.VIEWER);
        return db.rows("select f.*, w.gloss as affix_gloss, w.form as affix_form from form_rules f left join words w on w.id=f.affix_word_id "
                + "where f.language_id=? order by f.ord, f.id", id);
    }

    /** Words of this language and its ancestors (for picking a dictionary word as an affix). */
    @GetMapping("/languages/{id}/wordnames")
    public List<Map<String, Object>> wordNames(@PathVariable long id, HttpSession s) {
        long uid = auth.requireUid(s);
        access.need(uid, id, Access.VIEWER);
        List<Map<String, Object>> out = new ArrayList<>();
        List<Long> langs = new ArrayList<>();
        langs.add(id);
        for (long a : access.ancestors(id)) if (access.level(uid, a) >= Access.VIEWER) langs.add(a);
        for (long l : langs) out.addAll(db.rows("select id, gloss, form, year, language_id from words where language_id=? order by lower(gloss)", l));
        return out;
    }

    /** Owner-only: apply the form rules to every word. overwrite=true recomputes existing forms of the given label. */
    @PostMapping("/languages/{id}/forms/generate")
    public Map<String, Object> generateForms(@PathVariable long id, @RequestBody(required = false) Map<String, Object> b, HttpSession s) {
        long uidG = auth.requireUid(s);
        access.need(uidG, id, Access.OWNER);
        String label = str(b, "label");
        boolean overwrite = b != null && Boolean.parseBoolean(String.valueOf(b.get("overwrite")));
        String group = b != null && b.get("group") != null ? b.get("group").toString().trim() : null;
        boolean prune = b != null && Boolean.parseBoolean(String.valueOf(b.get("prune")));
        boolean dry = b != null && Boolean.parseBoolean(String.valueOf(b.get("dryRun")));
        Map<String, Object> res = new LinkedHashMap<>(forms.rebuild(id, label == null || label.isBlank() ? null : label, group, overwrite, prune, dry));
        applog.info("edit", uidG, "Generated forms in language #" + id + (label == null || label.isBlank() ? "" : " (" + label + ")") + (overwrite ? " with overwrite" : "") + (prune ? " with removal" : "") + (dry ? " (dry run)" : "") + ": created=" + res.get("created") + ", updated=" + res.get("updated") + ", removed=" + res.get("removed"));
        return res;
    }

    @PostMapping("/languages/{id}/bulk")
    public Map<String, Object> bulk(@PathVariable long id, @RequestBody Map<String, Object> b, HttpSession s) {
        long uidB = auth.requireUid(s);
        boolean dry = Boolean.parseBoolean(String.valueOf(b.get("dryRun")));
        boolean skip = Boolean.parseBoolean(String.valueOf(b.get("skipExisting")));
        Map<String, Object> res = dict.bulk(uidB, id, str(b, "text"), dry, skip);
        applog.info("edit", uidB, "Bulk entry in language #" + id + ": " + res.get("count") + " words" + (dry ? " (check only)" : ""));
        return res;
    }

    @GetMapping("/languages/{id}/auto-sounds")
    public Map<String, Object> autoSounds(@PathVariable long id, @RequestParam(required = false) Integer to, HttpSession s) {
        return dict.autoSounds(auth.requireUid(s), id, to);
    }

    @PostMapping("/languages/{id}/auto-sounds/apply")
    public Map<String, Object> applyAutoSounds(@PathVariable long id, @RequestBody Map<String, Object> b, HttpSession s) {
        long uidA = auth.requireUid(s);
        Integer to = b.get("to") == null || b.get("to").toString().isBlank() ? null : Integer.valueOf(b.get("to").toString());
        Map<String, Object> res = dict.applyAutoSounds(uidA, id, to);
        applog.info("edit", uidA, "Auto-built sounds in language #" + id + ": added=" + res.get("added") + ", removed=" + res.get("removed"));
        return res;
    }

    @PostMapping("/languages/{id}/phonemes/import")
    public Map<String, Object> importSounds(@PathVariable long id, @RequestBody Map<String, Object> b, HttpSession s) {
        long uidP = auth.requireUid(s);
        boolean dry = Boolean.parseBoolean(String.valueOf(b.get("dryRun")));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> list = b.get("sounds") instanceof List<?> l ? (List<Map<String, Object>>) l : null;
        Map<String, Object> res = dict.importSounds(uidP, id, str(b, "text"), list, dry);
        applog.info("edit", uidP, "Sound import in language #" + id + (dry ? " (check only)" : "") + ": added=" + res.get("added") + ", changed=" + res.get("changed"));
        return res;
    }

    @PostMapping("/languages/{id}/rules/preview")
    public Map<String, Object> previewRule(@PathVariable long id, @RequestBody Map<String, Object> b, HttpSession s) {
        return dict.previewRule(auth.requireUid(s), id, b);
    }

    @PostMapping("/languages/{id}/compound")
    public Map<String, Object> compound(@PathVariable long id, @RequestBody Map<String, Object> b, HttpSession s) {
        @SuppressWarnings("unchecked")
        List<Object> parts = b.get("parts") instanceof List<?> l ? (List<Object>) l : null;
        return dict.compound(auth.requireUid(s), id, parts);
    }

    // ---------------- pending changes, undo/redo, log ----------------

    @GetMapping("/languages/{id}/changes")
    public List<Map<String, Object>> changes(@PathVariable long id, HttpSession s) {
        long uid = auth.requireUid(s);
        Map<String, Object> l = access.need(uid, id, Access.VIEWER);
        String base = "select c.id, c.entity, c.action, c.entity_id, c.payload, c.status, c.created, u.username as author, c.author_id from changes c "
                + "join users u on u.id=c.author_id where c.language_id=? ";
        if ((int) l.get("level") == Access.OWNER) return db.rows(base + "order by c.id desc limit 200", id);
        return db.rows(base + "and c.author_id=? order by c.id desc limit 100", id, uid);
    }

    @PostMapping("/changes/{id}/approve")
    public Map<String, Object> approve(@PathVariable long id, HttpSession s) {
        store.decide(auth.requireUid(s), id, true);
        return Map.of("ok", true);
    }

    @PostMapping("/changes/{id}/deny")
    public Map<String, Object> deny(@PathVariable long id, HttpSession s) {
        store.decide(auth.requireUid(s), id, false);
        return Map.of("ok", true);
    }

    @PostMapping("/languages/{id}/undo")
    public Map<String, Object> undo(@PathVariable long id, HttpSession s) {
        return store.undo(auth.requireUid(s), id);
    }

    @PostMapping("/languages/{id}/redo")
    public Map<String, Object> redo(@PathVariable long id, HttpSession s) {
        return store.redo(auth.requireUid(s), id);
    }

    @GetMapping("/languages/{id}/log")
    public List<Map<String, Object>> log(@PathVariable long id, HttpSession s) {
        access.need(auth.requireUid(s), id, Access.VIEWER);
        return db.rows("select e.id, e.entity, e.action, e.entity_id, e.undone, e.created, u.username from edit_log e join users u on u.id=e.user_id "
                + "where e.language_id=? order by e.id desc limit 50", id);
    }

    // ---------------- export ----------------

    @GetMapping("/languages/{id}/export.xlsx")
    public ResponseEntity<byte[]> exportXlsx(@PathVariable long id, HttpSession s) throws Exception {
        long uid = auth.requireUid(s);
        Map<String, Object> l = access.need(uid, id, Access.VIEWER);
        byte[] data = export.workbook(uid, id);
        String fn = ((String) l.get("name")).replaceAll("[^A-Za-z0-9_-]", "_") + ".xlsx";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + fn + "\"")
                .contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .body(data);
    }

    // ---------------- sentences ----------------

    @GetMapping("/languages/{id}/sentences")
    public List<Map<String, Object>> sentenceList(@PathVariable long id, HttpSession s) {
        return sentences.list(auth.requireUid(s), id);
    }

    @PostMapping("/languages/{id}/sentences/build")
    public Map<String, Object> sentenceBuild(@PathVariable long id, @RequestBody Map<String, Object> b, HttpSession s) {
        Long y = lng(b, "year");
        return sentences.preview(auth.requireUid(s), id, str(b, "source"), y == null ? 0 : y.intValue());
    }

    @PostMapping("/languages/{id}/sentences")
    public Map<String, Object> sentenceSave(@PathVariable long id, @RequestBody Map<String, Object> b, HttpSession s) {
        Long y = lng(b, "year");
        long nid = sentences.save(auth.requireUid(s), id, str(b, "source"), y == null ? 0 : y.intValue(), str(b, "translation"), str(b, "notes"),
                lng(b, "group") == null ? null : lng(b, "group").intValue(), lng(b, "sub") == null ? null : lng(b, "sub").intValue(), str(b, "kind"));
        return Map.of("id", nid);
    }

    @DeleteMapping("/sentences/{id}")
    public Map<String, Object> sentenceDelete(@PathVariable long id, HttpSession s) {
        sentences.delete(auth.requireUid(s), id);
        return Map.of("ok", true);
    }

    @GetMapping("/sentences/{id}/versions")
    public Map<String, Object> sentenceVersions(@PathVariable long id, HttpSession s) {
        return sentences.versions(auth.requireUid(s), id);
    }

    @PutMapping("/sentences/{id}")
    public Map<String, Object> sentenceUpdate(@PathVariable long id, @RequestBody Map<String, Object> b, HttpSession s) {
        Long y = lng(b, "year");
        sentences.update(auth.requireUid(s), id, str(b, "source"), y == null ? 0 : y.intValue(), str(b, "translation"), str(b, "notes"),
                lng(b, "group") == null ? null : lng(b, "group").intValue(), lng(b, "sub") == null ? null : lng(b, "sub").intValue(), str(b, "kind"));
        return Map.of("ok", true);
    }

    @GetMapping("/languages/{id}/divergence")
    public Map<String, Object> divergence(@PathVariable long id, @RequestParam(required = false) Long a, @RequestParam(required = false) Long b,
                                          @RequestParam(required = false) Integer from, @RequestParam(required = false) Integer to, HttpSession s) {
        return graphs.divergence(auth.requireUid(s), id, a, b, from, to);
    }

    // ---------------- sound changes as JSON ----------------

    @GetMapping("/languages/{id}/rules/export.json")
    public ResponseEntity<Map<String, Object>> exportRulesJson(@PathVariable long id, @RequestParam(defaultValue = "branches") String scope, HttpSession s) {
        long uid = auth.requireUid(s);
        Map<String, Object> l = access.need(uid, id, Access.VIEWER);
        List<Map<String, Object>> rules = new ArrayList<>();
        for (Map<String, Object> r : rules(id, scope, s)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r.get("id"));
            m.put("language", r.get("lang_name"));
            m.put("year", r.get("year"));
            m.put("order", r.get("ord"));
            m.put("name", r.get("name") == null ? "" : r.get("name"));
            m.put("pattern", r.get("pattern"));
            m.put("replacement", r.get("replacement") == null ? "" : r.get("replacement"));
            if (r.get("note") != null && !r.get("note").toString().isEmpty()) m.put("note", r.get("note"));
            rules.add(m);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("format", "root-and-rune sound changes");
        body.put("help", "Import adjusts rules that have an id, adds rules without an id (or with an unknown id), and removes rules with \"delete\": true. "
                + "language is a language name in the same world. Fields: year, order, name, pattern, replacement, note.");
        body.put("rules", rules);
        String fn = ((String) l.get("name")).replaceAll("[^A-Za-z0-9_-]", "_") + "-sound-changes.json";
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + fn + "\"").contentType(MediaType.APPLICATION_JSON).body(body);
    }

    @PostMapping("/languages/{id}/rules/import")
    public Map<String, Object> importRulesJson(@PathVariable long id, @RequestBody Map<String, Object> b, HttpSession s) {
        long uid = auth.requireUid(s);
        if (!(b.get("rules") instanceof List<?> raw)) throw new ApiException(400, "The file needs a \"rules\" list.");
        List<Map<String, Object>> entries = new ArrayList<>();
        for (Object o : raw) {
            if (!(o instanceof Map<?, ?> m)) throw new ApiException(400, "Every entry in \"rules\" must be an object.");
            @SuppressWarnings("unchecked")
            Map<String, Object> e = (Map<String, Object>) m;
            entries.add(e);
        }
        boolean removeMissing = Boolean.parseBoolean(String.valueOf(b.get("removeMissing")));
        boolean dry = !Boolean.FALSE.equals(b.get("dryRun"));
        Map<String, Object> res = ruleTransfer.importRules(uid, id, entries, removeMissing, dry);
        applog.info("edit", uid, "Sound change import in language #" + id + (dry ? " (check)" : "") + ": +" + res.get("added") + " ~" + res.get("changed") + " -" + res.get("removed") + ", errors " + ((List<?>) res.get("errors")).size());
        return res;
    }

    @GetMapping("/languages/{id}/suggest-roots")
    public Map<String, Object> suggestRoots(@PathVariable long id, @RequestParam(defaultValue = "10") int count, @RequestParam(defaultValue = "2") int min,
            @RequestParam(defaultValue = "3") int max, @RequestParam(required = false) Long seed, HttpSession s) {
        return dict.suggestRoots(auth.requireUid(s), id, count, min, max, seed);
    }

    @GetMapping("/languages/{id}/tree-check")
    public Map<String, Object> treeCheck(@PathVariable long id, HttpSession s) {
        return dict.treeCheck(auth.requireUid(s), id);
    }

    @GetMapping("/languages/{id}/mergers")
    public List<Map<String, Object>> mergers(@PathVariable long id, HttpSession s) {
        return graphs.mergers(auth.requireUid(s), id);
    }
}
