package com.conlangs.web;

import java.sql.Timestamp;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.IntFunction;
import org.springframework.stereotype.Service;

/**
 * Notifications under the bell (start page and Root and Rune): someone suggested a change to your language, changed
 * it, approved or denied your suggestion, or shared something with you. Repeats of the same thing by the same person
 * within a day are counted in one notification ("suggested 4 changes") instead of piling up. The newest 100 per
 * account are kept.
 */
@Service
public class Notifications {
    private static final long MERGE_MS = 24L * 3600 * 1000;
    private final Db db;

    public Notifications(Db db) {
        this.db = db;
    }

    private String username(long id) {
        Map<String, Object> u = db.one("select username from users where id=?", id);
        return u == null ? "Someone" : (String) u.get("username");
    }

    /** text(n): the text for n of the same thing. Nothing is sent to the person who did it. */
    public void notify(long userId, String kind, Long langId, long actorId, String link, IntFunction<String> text) {
        if (userId == actorId || userId <= 0) return;
        Map<String, Object> same = db.one("select id, times from notifications where user_id=? and kind=? and seen=false and actor_id=? and "
                + (langId == null ? "language_id is null" : "language_id=?") + " and created > ? order by id desc limit 1",
                langId == null ? new Object[]{userId, kind, actorId, new Timestamp(System.currentTimeMillis() - MERGE_MS)}
                        : new Object[]{userId, kind, actorId, langId, new Timestamp(System.currentTimeMillis() - MERGE_MS)});
        if (same != null) {
            int n = ((Number) same.get("times")).intValue() + 1;
            db.update("update notifications set times=?, text=?, link=?, created=? where id=?", n, cut(text.apply(n)), link, new Timestamp(System.currentTimeMillis()), same.get("id"));
            return;
        }
        long id = db.insert("insert into notifications(user_id, kind, language_id, actor_id, text, link) values (?,?,?,?,?,?)",
                userId, kind, langId, actorId, cut(text.apply(1)), link);
        if (id % 50 == 0) db.update("delete from notifications where user_id=? and id not in (select id from notifications where user_id=? order by id desc limit 100)", userId, userId);
    }

    private static String cut(String s) {
        return s.length() > 1000 ? s.substring(0, 997) + "…" : s;
    }

    private static String what(String action, String entity) {
        String e = switch (entity) {
            case "word" -> "a word"; case "rule" -> "a sound change"; case "form" -> "a word form"; case "formrule" -> "a form rule";
            case "meaning" -> "a meaning"; case "loss" -> "a lost word"; case "override" -> "a locked form"; case "grammar" -> "a grammar row";
            case "gsection" -> "a grammar section"; case "phoneme" -> "a sound"; default -> entity;
        };
        return switch (action) { case "CREATE" -> "add " + e; case "DELETE" -> "remove " + e; default -> "change " + e; };
    }

    /** The people who should hear about changes to a language: its owner and the world's owner. */
    private List<Long> owners(Map<String, Object> lang) {
        Long a = lang.get("owner_id") == null ? null : Db.num(lang.get("owner_id"));
        Long b = lang.get("world_owner") == null ? null : Db.num(lang.get("world_owner"));
        return a == null ? (b == null ? List.of() : List.of(b)) : b == null || b.equals(a) ? List.of(a) : List.of(a, b);
    }

    /** A change waits for approval. */
    public void suggested(Map<String, Object> lang, long actorId, String action, String entity, String detail) {
        String who = username(actorId), name = (String) lang.get("name");
        long lid = Db.num(lang.get("id"));
        for (long o : owners(lang))
            notify(o, "suggestion", lid, actorId, "/rune/?lang=" + lid + "&tab=changes", n -> n == 1
                    ? who + " suggests to " + what(action, entity) + " in " + name + (detail == null ? "" : ": " + detail) + ". It waits for your approval."
                    : who + " suggested " + n + " changes to " + name + ". They wait for your approval.");
    }

    /** Someone else changed the language directly (an editor whose changes needn't be approved). */
    public void edited(Map<String, Object> lang, long actorId, String action, String entity) {
        String who = username(actorId), name = (String) lang.get("name");
        long lid = Db.num(lang.get("id"));
        for (long o : owners(lang))
            notify(o, "edit", lid, actorId, "/rune/?lang=" + lid + "&tab=log", n -> n == 1
                    ? who + " " + what(action, entity).replaceFirst("^add", "added").replaceFirst("^remove", "removed").replaceFirst("^change", "changed") + " in " + name + "."
                    : who + " made " + n + " changes in " + name + ".");
    }

    /** The owner decided on someone's suggestion. */
    public void decided(Map<String, Object> lang, long authorId, long deciderId, boolean approved, String action, String entity) {
        String who = username(deciderId), name = (String) lang.get("name");
        long lid = Db.num(lang.get("id"));
        notify(authorId, approved ? "approved" : "denied", lid, deciderId, "/rune/?lang=" + lid + "&tab=" + (approved ? "dict" : "changes"), n -> n == 1
                ? who + (approved ? " approved" : " turned down") + " your suggestion to " + what(action, entity) + " in " + name + "."
                : who + (approved ? " approved " : " turned down ") + n + " of your suggestions in " + name + ".");
    }

    /** A language or world was shared with someone. */
    public void shared(long userId, long actorId, String scope, long target, String level) {
        String who = username(actorId);
        if ("LANGUAGE".equals(scope)) {
            Map<String, Object> l = db.one("select name from languages where id=?", target);
            if (l == null) return;
            notify(userId, "share", target, actorId, "/rune/?lang=" + target, n -> who + " shared the language " + l.get("name") + " with you (" + level.toLowerCase() + ").");
        } else {
            Map<String, Object> w = db.one("select name from worlds where id=?", target);
            if (w == null) return;
            Map<String, Object> first = db.one("select id from languages where world_id=? order by id limit 1", target);
            notify(userId, "share", null, actorId, first == null ? "/rune/" : "/rune/?lang=" + first.get("id"),
                    n -> who + " shared the world " + w.get("name") + " with you (" + level.toLowerCase() + ").");
        }
    }

    public Map<String, Object> list(long userId) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("unread", db.count("select count(*) from notifications where user_id=? and seen=false", userId));
        out.put("items", db.rows("select id, kind, text, link, times, created, seen from notifications where user_id=? order by id desc limit 30", userId));
        return out;
    }

    public void seen(long userId, Long id) {
        if (id == null) db.update("update notifications set seen=true where user_id=? and seen=false", userId);
        else db.update("update notifications set seen=true where user_id=? and id=?", userId, id);
    }
}
