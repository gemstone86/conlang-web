package com.conlangs.web;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.springframework.stereotype.Service;

/**
 * One-time import of the Yggheim Elven workbook ("Ygg Elven dict" sheet) into a chosen language.
 * Imports root / derived / phrase rows as words; "shifted" and "indexed" rows are skipped because the
 * app regenerates dated forms from the sound-change rules.
 */
@Service
public class ImportService {
    private final Store store;
    private final Db db;

    public ImportService(Store store, Db db) {
        this.store = store;
        this.db = db;
    }

    private static String text(Cell c) {
        try {
            return textUnsafe(c);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static String textUnsafe(Cell c) {
        if (c == null) return null;
        if (c.getCellType() == CellType.FORMULA) {
            try {
                return c.getStringCellValue();
            } catch (Exception e) {
                return null;
            }
        }
        if (c.getCellType() == CellType.NUMERIC) {
            double d = c.getNumericCellValue();
            return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
        }
        return c.getStringCellValue();
    }

    public Map<String, Object> importDictionary(InputStream in, long langId, long uid) throws Exception {
        List<String> skipped = new ArrayList<>();
        int imported = 0, already = 0;
        // Route each row to the language whose name equals its 'group' (case-insensitive); anything else goes to langId.
        Map<String, Long> byName = new HashMap<>();
        for (Map<String, Object> l : db.rows("select id, name from languages where world_id=(select world_id from languages where id=?)", langId)) {
            byName.put(((String) l.get("name")).trim().toLowerCase(), Db.num(l.get("id")));
        }
        Map<String, Integer> perGroup = new LinkedHashMap<>();
        java.util.Set<Long> touched = new java.util.HashSet<>();
        touched.add(langId);
        try (Workbook wb = WorkbookFactory.create(in)) {
            Sheet sh = wb.getSheet("Ygg Elven dict");
            if (sh == null) throw new ApiException(400, "No sheet named 'Ygg Elven dict' in that file.");
            Row head = sh.getRow(0);
            Map<String, Integer> col = new HashMap<>();
            for (Cell c : head) {
                String h = text(c);
                if (h != null) col.putIfAbsent(h.trim().toLowerCase(), c.getColumnIndex());
            }
            for (String need : List.of("dictionary", "build", "year", "elven")) {
                if (!col.containsKey(need)) throw new ApiException(400, "Missing column '" + need + "'.");
            }
            for (int i = 1; i <= sh.getLastRowNum(); i++) {
                Row r = sh.getRow(i);
                if (r == null) continue;
                String gloss = text(r.getCell(col.get("dictionary")));
                String form = text(r.getCell(col.get("elven")));
                String build = text(r.getCell(col.get("build")));
                String yr = text(r.getCell(col.get("year")));
                if (gloss == null || gloss.isBlank() || form == null || form.isBlank() || yr == null) {
                    skipped.add("row " + (i + 1) + ": incomplete");
                    continue;
                }
                String b = build == null ? "" : build.trim().toLowerCase();
                if (b.equals("shifted") || b.equals("indexed")) continue;
                String grp = col.containsKey("group") ? text(r.getCell(col.get("group"))) : null;
                long target = grp == null ? langId : byName.getOrDefault(grp.trim().toLowerCase(), langId);
                // importing the same file again doesn't add the words twice
                if (db.count("select count(*) from words where language_id=? and lower(gloss)=lower(?) and form=?", target, gloss.trim(), form.trim()) > 0) {
                    already++;
                    continue;
                }
                Map<String, Object> p = new LinkedHashMap<>();
                p.put("gloss", gloss.trim());
                p.put("form", form.trim());
                p.put("year", yr);
                p.put("build", b);
                if (col.containsKey("type")) p.put("pos", text(r.getCell(col.get("type"))));
                if (col.containsKey("notes")) p.put("notes", text(r.getCell(col.get("notes"))));
                try {
                    Map<String, Object> clean = store.validate(target, "word", "CREATE", null, p);
                    store.apply(target, uid, "word", "CREATE", null, clean);
                    touched.add(target);
                    perGroup.merge(grp == null ? "(none)" : grp.trim(), 1, Integer::sum);
                    imported++;
                } catch (ApiException e) {
                    skipped.add("row " + (i + 1) + ": " + e.getMessage());
                }
            }
        }
        // The import is not undoable word-by-word: clear its log entries so Undo doesn't walk through thousands of rows.
        for (long t : touched) db.update("delete from edit_log where language_id=?", t);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("imported", imported);
        out.put("alreadyThere", already);
        out.put("perGroup", perGroup);
        out.put("skipped", skipped.size() > 50 ? skipped.subList(0, 50) : skipped);
        out.put("skippedCount", skipped.size());
        return out;
    }
}
