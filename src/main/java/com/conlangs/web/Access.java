package com.conlangs.web;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** Resolves what a user may do with a language: 0 none, 1 viewer, 2 editor, 3 owner. */
@Service
public class Access {
    public static final int NONE = 0, VIEWER = 1, EDITOR = 2, OWNER = 3;
    private final Db db;

    public Access(Db db) {
        this.db = db;
    }

    public Map<String, Object> language(long langId) {
        Map<String, Object> l = db.one("select l.*, w.owner_id as world_owner from languages l join worlds w on w.id=l.world_id where l.id=?", langId);
        if (l == null) throw new ApiException(404, "No such language.");
        return l;
    }

    public int level(long uid, long langId) {
        return level(uid, language(langId));
    }

    public int level(long uid, Map<String, Object> lang) {
        if (Db.num(lang.get("owner_id")) == uid || Db.num(lang.get("world_owner")) == uid) return OWNER;
        int best = NONE;
        for (Map<String, Object> s : shares(uid, lang)) {
            best = Math.max(best, "EDITOR".equals(s.get("level")) ? EDITOR : VIEWER);
        }
        return best;
    }

    public boolean autoApprove(long uid, long langId) {
        for (Map<String, Object> s : shares(uid, language(langId))) {
            if ("EDITOR".equals(s.get("level")) && Boolean.TRUE.equals(s.get("auto_approve"))) return true;
        }
        return false;
    }

    private List<Map<String, Object>> shares(long uid, Map<String, Object> lang) {
        return db.rows("select level, auto_approve from shares where user_id=? and "
                + "((scope='LANGUAGE' and target_id=?) or (scope='WORLD' and target_id=?))",
                uid, lang.get("id"), lang.get("world_id"));
    }

    public Map<String, Object> need(long uid, long langId, int min) {
        Map<String, Object> l = language(langId);
        int lv = level(uid, l);
        if (lv < min) throw new ApiException(lv == NONE ? 404 : 403, lv == NONE ? "No such language." : "You don't have permission for that.");
        l.put("level", lv);
        return l;
    }

    private Long parentOf(long id) {
        Map<String, Object> r = db.one("select parent_id from languages where id=?", id);
        return r == null || r.get("parent_id") == null ? null : Db.num(r.get("parent_id"));
    }

    /** Ancestors of a language, nearest first (excluding the language itself). */
    public List<Long> ancestors(long langId) {
        List<Long> out = new ArrayList<>();
        Long cur = parentOf(langId);
        for (int i = 0; cur != null && i < 100; i++) {
            out.add(cur);
            cur = parentOf(cur);
        }
        return out;
    }

    /** All branch languages below a language (excluding the language itself). */
    public List<Long> descendants(long langId) {
        List<Map<String, Object>> all = db.rows("select id, parent_id from languages where world_id=(select world_id from languages where id=?)", langId);
        List<Long> out = new ArrayList<>();
        List<Long> frontier = List.of(langId);
        for (int depth = 0; depth < 100 && !frontier.isEmpty(); depth++) {
            List<Long> next = new ArrayList<>();
            for (Map<String, Object> l : all) {
                if (l.get("parent_id") != null && frontier.contains(Db.num(l.get("parent_id")))) next.add(Db.num(l.get("id")));
            }
            out.addAll(next);
            frontier = next;
        }
        return out;
    }
}
