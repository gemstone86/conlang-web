package com.conlangs.web;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;

/** Excel export for backup: dictionary, full dated history, rules, and the language tree. */
@Service
public class ExportService {
    private final Db db;
    private final Access access;
    private final DictService dict;
    private final SentenceService sentences;

    public ExportService(Db db, Access access, DictService dict, SentenceService sentences) {
        this.db = db;
        this.access = access;
        this.dict = dict;
        this.sentences = sentences;
    }

    private static void row(Sheet s, int r, Object... cells) {
        Row row = s.createRow(r);
        for (int i = 0; i < cells.length; i++) {
            Object c = cells[i];
            if (c == null) continue;
            if (c instanceof Number n) row.createCell(i).setCellValue(n.doubleValue());
            else if (c instanceof Boolean b) row.createCell(i).setCellValue(b);
            else row.createCell(i).setCellValue(c.toString());
        }
    }

    public byte[] workbook(long uid, long langId) throws Exception {
        Map<String, Object> lang = access.need(uid, langId, Access.VIEWER);
        long worldId = Db.num(lang.get("world_id"));
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet d = wb.createSheet("Dictionary");
            row(d, 0, "id", "gloss", "pos", "build", "year", "form", "length", "pronunciation", "notes", "inherited from");
            int r = 1;
            List<Map<String, Object>> words = dict.words(uid, langId);
            for (Map<String, Object> w : words) {
                row(d, r++, w.get("id"), w.get("gloss"), w.get("pos"), w.get("build"), w.get("year"), w.get("form"),
                        w.get("length"), w.get("pronunciation"), w.get("notes"), w.get("origin_lang"));
            }
            Sheet h = wb.createSheet("History");
            row(h, 0, "word id", "gloss", "language", "year", "form", "source", "rule");
            Sheet fs = wb.createSheet("Forms");
            row(fs, 0, "word id", "gloss", "form type", "language", "year", "form", "source", "rule");
            r = 1;
            int fr = 1;
            for (Map<String, Object> w : words) {
                Map<String, Object> full = dict.history(uid, Db.num(w.get("id")));
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> hist = (List<Map<String, Object>>) full.get("history");
                for (Map<String, Object> e : hist) {
                    row(h, r++, w.get("id"), w.get("gloss"), e.get("lang"), e.get("year"), e.get("form"), e.get("source"), e.get("rule"));
                }
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> forms = (List<Map<String, Object>>) full.get("forms");
                for (Map<String, Object> f : forms) {
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> fh = (List<Map<String, Object>>) f.get("history");
                    for (Map<String, Object> e : fh) {
                        row(fs, fr++, w.get("id"), w.get("gloss"), f.get("label"), e.get("lang"), e.get("year"), e.get("form"), e.get("source"), e.get("rule"));
                    }
                }
            }
            Sheet ru = wb.createSheet("Rules");
            row(ru, 0, "language", "year", "order", "name", "pattern", "replacement", "note");
            r = 1;
            for (Map<String, Object> x : db.rows("select l.name as lname, r.* from rules r join languages l on l.id=r.language_id where l.world_id=? order by l.name, r.year, r.ord", worldId)) {
                row(ru, r++, x.get("lname"), x.get("year"), x.get("ord"), x.get("name"), x.get("pattern"), x.get("replacement"), x.get("note"));
            }
            Sheet g = wb.createSheet("Grammar");
            row(g, 0, "section", "name", "col 1", "col 2", "col 3", "col 4", "col 5", "col 6", "from year");
            r = 1;
            for (Map<String, Object> x : db.rows("select * from grammar_entries where language_id=? order by ord, id", langId)) {
                row(g, r++, x.get("category"), x.get("name"), x.get("c1"), x.get("c2"), x.get("c3"), x.get("c4"), x.get("c5"), x.get("c6"), x.get("year"));
            }
            Sheet sn = wb.createSheet("Sounds");
            row(sn, 0, "symbol", "kind", "row", "column", "notes", "from year", "until year");
            r = 1;
            for (Map<String, Object> x : db.rows("select * from phonemes where language_id=? order by id", langId)) {
                row(sn, r++, x.get("symbol"), x.get("kind"), x.get("row_label"), x.get("col_label"), x.get("notes"), x.get("year"), x.get("year_to"));
            }
            // Check sheet: one row per word, the latest form of the word and of each form type in every branch, for comparing with the old workbook.
            List<String> branches = new ArrayList<>();
            branches.add((String) lang.get("name"));
            for (long dl : access.descendants(langId)) branches.add((String) access.language(dl).get("name"));
            LinkedHashSet<String> labels = new LinkedHashSet<>();
            for (Map<String, Object> w : words) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> fl = (List<Map<String, Object>>) w.get("forms");
                for (Map<String, Object> f : fl) labels.add((String) f.get("label"));
            }
            Sheet ck = wb.createSheet("Check");
            List<Object> head = new ArrayList<>(List.of("id", "gloss", "meaning", "type", "year", "inherited from"));
            List<String> cols = new ArrayList<>();
            cols.add("word");
            cols.addAll(labels);
            for (String c : cols) for (String b : branches) head.add(c + " @ " + b);
            row(ck, 0, head.toArray());
            r = 1;
            for (Map<String, Object> w : words) {
                List<Object> cells = new ArrayList<>(List.of(w.get("id"), w.get("gloss"), w.get("meaning") == null ? "" : w.get("meaning"), w.get("pos") == null ? "" : w.get("pos"),
                        w.get("year"), w.get("origin_lang") == null ? "" : w.get("origin_lang")));
                @SuppressWarnings("unchecked")
                Map<String, Object> wl = (Map<String, Object>) w.get("latest");
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> fl = (List<Map<String, Object>>) w.get("forms");
                for (String c : cols) {
                    Map<String, Object> src = wl;
                    if (!c.equals("word")) {
                        src = null;
                        for (Map<String, Object> f : fl) if (c.equals(f.get("label"))) {
                            @SuppressWarnings("unchecked")
                            Map<String, Object> m = (Map<String, Object>) f.get("latest");
                            src = m;
                        }
                    }
                    for (String b : branches) cells.add(src == null || src.get(b) == null ? "" : src.get(b));
                }
                row(ck, r++, cells.toArray());
            }
            Sheet fr2 = wb.createSheet("Form rules");
            row(fr2, 0, "group", "form", "applies to", "placement", "affix", "affix word", "condition", "drop first vowel", "from year", "order");
            r = 1;
            for (Map<String, Object> x : db.rows("select f.*, w.gloss as aw from form_rules f left join words w on w.id=f.affix_word_id where f.language_id=? order by f.ord, f.id", langId)) {
                row(fr2, r++, x.get("grp"), x.get("label"), x.get("pos"), x.get("placement"), x.get("affix"), x.get("aw"), x.get("cond_re"), x.get("hiatus"), x.get("year"), x.get("ord"));
            }
            Sheet me = wb.createSheet("Meanings");
            row(me, 0, "word id", "gloss", "language", "from year", "mode", "meaning");
            r = 1;
            for (Map<String, Object> x : db.rows("select m.*, w.gloss as g, l.name as ln from word_meanings m join words w on w.id=m.word_id join languages l on l.id=m.lang_id where l.world_id=? order by m.word_id, m.year", worldId)) {
                row(me, r++, x.get("word_id"), x.get("g"), x.get("ln"), x.get("year"), x.get("mode"), x.get("meaning"));
            }
            Sheet se = wb.createSheet("Sentences");
            row(se, 0, "id", "group", "sub id", "English", "type", "construction", lang.get("name") + " (at its year)", "gloss", "year", "gaps");
            r = 1;
            for (Map<String, Object> x : sentences.list(uid, langId)) {
                @SuppressWarnings("unchecked")
                Map<String, Object> b = (Map<String, Object>) x.get("built");
                row(se, r++, x.get("id"), x.get("group_no"), x.get("sub_no"), x.get("translation"), x.get("kind"), x.get("source"), b.get("surface"), b.get("gloss"), x.get("year"), b.get("gaps"));
            }
            Sheet t = wb.createSheet("Languages");
            row(t, 0, "id", "name", "parent id", "split year", "classes", "erosion steps", "ipa map");
            r = 1;
            for (Map<String, Object> x : db.rows("select * from languages where world_id=? order by id", worldId)) {
                row(t, r++, x.get("id"), x.get("name"), x.get("parent_id"), x.get("split_year"), x.get("classes"), x.get("erosion"), x.get("ipa_map"));
            }
            wb.write(out);
            return out.toByteArray();
        }
    }
}
