package com.conlangs.web;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

/**
 * Missing words: meanings a language has no word for yet. People mark them by hand (a to-do list for
 * coining words), and the saved sentences add the meanings they need but can't find. An entry counts
 * as filled once the language has a word for the meaning (its own or inherited), found the same way
 * the sentence builder finds words.
 *
 * The list is a planning note, not part of the language, so editors change it directly (no approval).
 */
@Service
public class MissingService {
    private final Db db;
    private final Access access;
    private final SentenceService sentences;
    private final AppLog applog;

    public MissingService(Db db, Access access, SentenceService sentences, AppLog applog) {
        this.db = db;
        this.access = access;
        this.sentences = sentences;
        this.applog = applog;
    }

    /** {entries: [{id, gloss, pos, notes, created, created_by_name, word}], fromSentences: [{meaning, reason, sentences}]} */
    public Map<String, Object> list(long uid, long langId) {
        access.need(uid, langId, Access.VIEWER);
        List<Map<String, Object>> entries = db.rows("select m.id, m.gloss, m.pos, m.notes, m.created, u.username as created_by_name "
                + "from missing_words m left join users u on u.id=m.created_by where m.language_id=? order by lower(m.gloss), m.id", langId);
        List<String> glosses = new ArrayList<>();
        for (Map<String, Object> e : entries) glosses.add((String) e.get("gloss"));
        Map<String, Map<String, Object>> found = sentences.wordsFor(uid, langId, glosses);
        Set<String> marked = new HashSet<>();
        for (Map<String, Object> e : entries) {
            e.put("word", found.get((String) e.get("gloss")));
            marked.add(((String) e.get("gloss")).trim().toLowerCase());
        }
        List<Map<String, Object>> fromSentences = new ArrayList<>();
        for (Map<String, Object> g : sentences.sentenceGaps(uid, langId)) {
            if (!marked.contains(g.get("meaning").toString().toLowerCase())) fromSentences.add(g);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("entries", entries);
        out.put("fromSentences", fromSentences);
        return out;
    }

    public long add(long uid, long langId, String gloss, String pos, String notes) {
        access.need(uid, langId, Access.EDITOR);
        String g = clean(gloss, 400);
        if (g == null) throw new ApiException(400, "Write the meaning that's missing.");
        if (g.contains("(") || g.contains(")")) throw new ApiException(400, "A meaning can't contain brackets.");
        if (db.count("select count(*) from missing_words where language_id=? and lower(gloss)=lower(?)", langId, g) > 0)
            throw new ApiException(409, "'" + g + "' is on the list already.");
        long id = db.insert("insert into missing_words(language_id, gloss, pos, notes, created_by) values (?,?,?,?,?)",
                langId, g, clean(pos, 64), clean(notes, 4000), uid);
        applog.info("edit", uid, "Marked '" + g + "' as a missing word in language #" + langId);
        return id;
    }

    /**
     * Several at once, one per line: "meaning", "meaning; type" or "meaning; type; note" (a tab works too).
     * Skips meanings that are on the list already or that the language has a word for.
     */
    public Map<String, Object> bulk(long uid, long langId, String text) {
        access.need(uid, langId, Access.EDITOR);
        List<String[]> lines = new ArrayList<>();
        for (String line : (text == null ? "" : text).split("\\R")) {
            if (line.isBlank()) continue;
            String[] f = line.split("[;\\t]", 3);
            lines.add(new String[]{f[0].trim(), f.length > 1 ? f[1].trim() : null, f.length > 2 ? f[2].trim() : null});
        }
        List<String> glosses = new ArrayList<>();
        for (String[] l : lines) glosses.add(l[0]);
        Map<String, Map<String, Object>> found = sentences.wordsFor(uid, langId, glosses);
        List<String> added = new ArrayList<>(), onList = new ArrayList<>(), haveWord = new ArrayList<>(), bad = new ArrayList<>();
        for (String[] l : lines) {
            String g = l[0];
            if (g.isEmpty() || g.length() > 400 || g.contains("(") || g.contains(")")) { bad.add(g); continue; }
            if (found.containsKey(g)) { haveWord.add(g + " (" + found.get(g).get("form") + ")"); continue; }
            if (db.count("select count(*) from missing_words where language_id=? and lower(gloss)=lower(?)", langId, g) > 0) { onList.add(g); continue; }
            db.insert("insert into missing_words(language_id, gloss, pos, notes, created_by) values (?,?,?,?,?)",
                    langId, g, clean(l[1], 64), clean(l[2], 4000), uid);
            added.add(g);
        }
        if (!added.isEmpty()) applog.info("edit", uid, "Marked " + added.size() + " missing words in language #" + langId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("added", added);
        out.put("onList", onList);
        out.put("haveWord", haveWord);
        out.put("bad", bad);
        return out;
    }

    public void delete(long uid, long id) {
        Map<String, Object> m = db.one("select language_id, gloss from missing_words where id=?", id);
        if (m == null) throw new ApiException(404, "That entry doesn't exist.");
        long langId = Db.num(m.get("language_id"));
        access.need(uid, langId, Access.EDITOR);
        db.update("delete from missing_words where id=?", id);
        applog.info("edit", uid, "Removed '" + m.get("gloss") + "' from the missing words of language #" + langId);
    }

    /** Removes the entries the language now has a word for. Returns how many. */
    public int clearFilled(long uid, long langId) {
        access.need(uid, langId, Access.EDITOR);
        int n = 0;
        for (Map<String, Object> e : (List<Map<String, Object>>) list(uid, langId).get("entries")) {
            if (e.get("word") != null) n += db.update("delete from missing_words where id=?", e.get("id"));
        }
        if (n > 0) applog.info("edit", uid, "Cleared " + n + " filled missing words in language #" + langId);
        return n;
    }

    private static String clean(String s, int max) {
        if (s == null || s.isBlank()) return null;
        String t = s.trim();
        if (t.length() > max) throw new ApiException(400, "Too long (at most " + max + " characters): " + t.substring(0, 40) + "…");
        return t;
    }
}
