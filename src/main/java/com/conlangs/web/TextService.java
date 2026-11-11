package com.conlangs.web;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * The Texts tab: longer pieces in a language (a story, a prayer, a song) written line by line in the sentence
 * builder's notation, each line with an optional translation, and shown at several years side by side, so the
 * language's change over time can be read in one text. Editors write them; anyone who can read the language
 * can read them.
 */
@Service
public class TextService {
    private static final TypeReference<List<Map<String, Object>>> LINES = new TypeReference<>() {};
    private final Db db;
    private final Access access;
    private final SentenceService sentences;
    private final AppLog applog;
    private final ObjectMapper json;

    public TextService(Db db, Access access, SentenceService sentences, AppLog applog, ObjectMapper json) {
        this.db = db;
        this.access = access;
        this.sentences = sentences;
        this.applog = applog;
        this.json = json;
    }

    /**
     * The language's own texts, then the texts of its ancestors that are marked "branches inherit it" (built in this
     * language when opened). Each has language_id, from (the language it belongs to) and inherited.
     */
    public List<Map<String, Object>> list(long uid, long langId) {
        access.need(uid, langId, Access.VIEWER);
        List<Long> langs = new ArrayList<>();
        langs.add(langId);
        langs.addAll(access.ancestors(langId));
        List<Map<String, Object>> out = new ArrayList<>();
        for (long l : langs) {
            boolean own = l == langId;
            for (Map<String, Object> t : db.rows("select t.id, t.language_id, t.title, t.years, t.notes, t.inherit, t.updated, u.username as created_by_name, t.lines_json, l.name as from_lang "
                    + "from texts t join languages l on l.id=t.language_id left join users u on u.id=t.created_by where t.language_id=?"
                    + (own ? "" : " and t.inherit=true") + " order by lower(t.title), t.id", l)) {
                t.put("lines", lines((String) t.remove("lines_json")).size());
                t.put("inherited", !own);
                out.add(t);
            }
        }
        return out;
    }

    /** May the text be read as part of this language: its own, or inherited from an ancestor? */
    private boolean visibleIn(Map<String, Object> t, long langId) {
        long tl = Db.num(t.get("language_id"));
        return tl == langId || (Boolean.TRUE.equals(t.get("inherit")) && access.ancestors(langId).contains(tl));
    }

    /** Moves a text to another language of the same world (editors of both). */
    public void move(long uid, long id, long targetLangId) {
        Map<String, Object> t = text(id);
        long from = Db.num(t.get("language_id"));
        Map<String, Object> a = access.need(uid, from, Access.EDITOR);
        Map<String, Object> b = access.need(uid, targetLangId, Access.EDITOR);
        if (Db.num(a.get("world_id")) != Db.num(b.get("world_id"))) throw new ApiException(400, "A text can only move within its world.");
        if (from == targetLangId) return;
        db.update("update texts set language_id=?, updated=? where id=?", targetLangId, new Timestamp(System.currentTimeMillis()), id);
        applog.info("edit", uid, "Moved text '" + t.get("title") + "' (#" + id + ") from " + a.get("name") + " to " + b.get("name"));
    }

    private List<Map<String, Object>> lines(String js) {
        try {
            return js == null ? List.of() : json.readValue(js, LINES);
        } catch (Exception e) {
            return List.of();
        }
    }

    /** The years a text is shown at: "500, 800, 1200" → [500, 800, 1200] (at most 6). */
    static List<Integer> years(String text) {
        List<Integer> out = new ArrayList<>();
        if (text != null) for (String y : text.split("[,;\\s]+")) {
            if (y.isBlank()) continue;
            try {
                int v = Integer.parseInt(y.trim());
                if (!out.contains(v)) out.add(v);
            } catch (NumberFormatException e) {
                throw new ApiException(400, "Years must be whole numbers, like 500, 800, 1200.");
            }
        }
        if (out.size() > 6) throw new ApiException(400, "At most 6 years side by side.");
        out.sort(Integer::compare);
        return out;
    }

    /**
     * The text written out: one line per row in "source | translation" (the translation is optional). Lines in the
     * notation can't contain "|"; empty lines are kept as paragraph breaks.
     */
    static List<Map<String, Object>> parseBody(String body) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (body == null) return out;
        for (String raw : body.split("\\R", -1)) {
            String line = raw.strip();
            Map<String, Object> l = new LinkedHashMap<>();
            int bar = line.indexOf('|');
            l.put("source", (bar < 0 ? line : line.substring(0, bar)).trim());
            l.put("translation", bar < 0 ? "" : line.substring(bar + 1).trim());
            out.add(l);
        }
        while (!out.isEmpty() && out.get(out.size() - 1).get("source").toString().isEmpty() && out.get(out.size() - 1).get("translation").toString().isEmpty())
            out.remove(out.size() - 1);
        return out;
    }

    private Map<String, Object> text(long id) {
        Map<String, Object> t = db.one("select * from texts where id=?", id);
        if (t == null) throw new ApiException(404, "No such text.");
        return t;
    }

    public long save(long uid, long langId, Long id, String title, String years, String body, String notes, Boolean inherit) {
        access.need(uid, langId, Access.EDITOR);
        String tt = title == null ? "" : title.trim();
        if (tt.isEmpty()) throw new ApiException(400, "Give the text a title.");
        if (tt.length() > 200) throw new ApiException(400, "The title can be at most 200 characters.");
        List<Integer> ys = years(years);
        if (ys.isEmpty()) throw new ApiException(400, "Give at least one year to show it at.");
        List<Map<String, Object>> lines = parseBody(body);
        if (lines.stream().noneMatch(l -> !l.get("source").toString().isEmpty())) throw new ApiException(400, "Write at least one line.");
        String js;
        try {
            js = json.writeValueAsString(lines);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        if (js.length() > 200_000) throw new ApiException(400, "The text is too long.");
        String yStr = String.join(", ", ys.stream().map(String::valueOf).toList());
        String nt = notes == null || notes.isBlank() ? null : notes.trim();
        if (id == null) {
            long nid = db.insert("insert into texts(language_id, title, lines_json, years, notes, created_by, inherit) values (?,?,?,?,?,?,?)", langId, tt, js, yStr, nt, uid,
                    Boolean.TRUE.equals(inherit));
            applog.info("edit", uid, "Added text '" + tt + "' (#" + nid + ") in language #" + langId);
            return nid;
        }
        Map<String, Object> t = text(id);
        if (Db.num(t.get("language_id")) != langId) throw new ApiException(404, "No such text.");
        db.update("update texts set title=?, lines_json=?, years=?, notes=?, inherit=?, updated=? where id=?", tt, js, yStr, nt,
                inherit == null ? Boolean.TRUE.equals(t.get("inherit")) : inherit, new Timestamp(System.currentTimeMillis()), id);
        applog.info("edit", uid, "Changed text '" + tt + "' (#" + id + ") in language #" + langId);
        return id;
    }

    public void delete(long uid, long id) {
        Map<String, Object> t = text(id);
        access.need(uid, Db.num(t.get("language_id")), Access.EDITOR);
        db.update("delete from texts where id=?", id);
        applog.info("edit", uid, "Deleted text '" + t.get("title") + "' (#" + id + ")");
    }

    /**
     * The text built at each of its years (or the given ones): {id, title, notes, years, body, lines: [{source,
     * translation, at: {year: {surface, gloss, gaps, missing: [...]}}}], gaps: {year: count}}.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> render(long uid, long id, String yearsOverride) {
        return render(uid, id, yearsOverride, null);
    }

    /** As above, built in viewLang (a branch that inherits the text) instead of the text's own language. */
    public Map<String, Object> render(long uid, long id, String yearsOverride, Long viewLang) {
        Map<String, Object> t = text(id);
        long own = Db.num(t.get("language_id"));
        long langId = own;
        if (viewLang != null && viewLang != own) {
            access.need(uid, viewLang, Access.VIEWER);
            if (!visibleIn(t, viewLang)) throw new ApiException(404, "That text isn't part of this language.");
            langId = viewLang;
        } else access.need(uid, langId, Access.VIEWER);
        List<Integer> ys = yearsOverride == null || yearsOverride.isBlank() ? years((String) t.get("years")) : years(yearsOverride);
        List<Map<String, Object>> lines = lines((String) t.get("lines_json"));
        Map<String, Integer> gapCount = new LinkedHashMap<>();
        for (int y : ys) gapCount.put(String.valueOf(y), 0);
        StringBuilder body = new StringBuilder();
        var build = sentences.builder(uid, langId);   // the dictionary is loaded once for the whole text
        for (Map<String, Object> l : lines) {
            String src = String.valueOf(l.getOrDefault("source", ""));
            String tr = String.valueOf(l.getOrDefault("translation", ""));
            body.append(src).append(tr.isEmpty() ? "" : " | " + tr).append('\n');
            Map<String, Object> at = new LinkedHashMap<>();
            if (!src.isBlank()) for (int y : ys) {
                Map<String, Object> b = build.apply(src, y);
                Map<String, Object> cell = new LinkedHashMap<>();
                cell.put("surface", b.get("surface"));
                cell.put("gloss", b.get("gloss"));
                int g = ((Number) b.get("gaps")).intValue();
                cell.put("gaps", g);
                if (g > 0) {
                    List<String> why = new ArrayList<>();
                    for (Map<String, Object> w : (List<Map<String, Object>>) b.get("words"))
                        for (Map<String, Object> p : (List<Map<String, Object>>) w.get("parts"))
                            if (Boolean.FALSE.equals(p.get("ok"))) why.add(p.get("input") + ": " + p.get("reason"));
                    cell.put("missing", why);
                    gapCount.merge(String.valueOf(y), g, Integer::sum);
                }
                at.put(String.valueOf(y), cell);
            }
            l.put("at", at);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", t.get("id"));
        out.put("title", t.get("title"));
        out.put("notes", t.get("notes"));
        out.put("years", ys);
        out.put("saved_years", t.get("years"));
        out.put("language_id", own);
        out.put("from_lang", access.language(own).get("name"));
        out.put("built_in", access.language(langId).get("name"));
        out.put("inherit", Boolean.TRUE.equals(t.get("inherit")));
        out.put("body", body.toString().stripTrailing());
        out.put("lines", lines);
        out.put("gaps", gapCount);
        return out;
    }
}
