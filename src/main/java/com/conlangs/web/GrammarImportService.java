package com.conlangs.web;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * One-time import of the grammar / phonology tables from the "Ygg Elven" sheet (columns A-G):
 * settings, proto-vs-later table, sound modifiers, pronunciation rules, the grammar tables and the
 * consonant / vowel grids.
 */
@Service
public class GrammarImportService {
    private static final Set<String> TITLES = Set.of("grammar", "positions, prepositions, time, and directions",
            "prefixes and suffixes", "tenses", "references", "comparative adjectives", "sound modifier");
    private static final int COLS = 7;

    private final Db db;

    public GrammarImportService(Db db) {
        this.db = db;
    }

    private static String text(Cell c) {
        try {
            if (c == null) return null;
            CellType t = c.getCellType() == CellType.FORMULA ? c.getCachedFormulaResultType() : c.getCellType();
            if (t == CellType.NUMERIC) {
                double d = c.getNumericCellValue();
                return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
            }
            if (t == CellType.STRING) return c.getStringCellValue();
            return null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private record Sec(String title, List<String> headings) {}
    private record Ent(String category, String name, List<String> cells) {}
    private record Ph(String kind, String row, String col, String symbol, String note) {}

    private static boolean any(String[] r, int from) {
        for (int i = from; i < r.length; i++) if (r[i] != null) return true;
        return false;
    }

    private static List<String> tokens(String cell) {
        List<String> out = new ArrayList<>();
        if (cell == null) return out;
        if (cell.contains("=")) {
            out.add(cell);
            return out;
        }
        for (String t : cell.split(",")) if (!t.trim().isEmpty()) out.add(t.trim());
        return out;
    }

    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> importSheet(InputStream in, long langId, boolean replace) throws Exception {
        long existing = db.count("select count(*) from grammar_entries where language_id=?", langId)
                + db.count("select count(*) from grammar_sections where language_id=?", langId)
                + db.count("select count(*) from phonemes where language_id=?", langId);
        if (existing > 0 && !replace)
            throw new ApiException(409, "This language already has grammar or sounds. Pass replace=true to overwrite them.");

        List<String[]> rows = new ArrayList<>();
        try (Workbook wb = WorkbookFactory.create(in)) {
            Sheet sh = wb.getSheet("Ygg Elven");
            if (sh == null) throw new ApiException(400, "No sheet named 'Ygg Elven' in that file.");
            for (int i = 0; i <= sh.getLastRowNum(); i++) {
                Row r = sh.getRow(i);
                String[] a = new String[COLS];
                if (r != null) {
                    for (int j = 0; j < COLS; j++) {
                        String t = text(r.getCell(j));
                        a[j] = t == null || t.isBlank() ? null : t.trim();
                    }
                }
                rows.add(a);
            }
        }
        List<Sec> secs = new ArrayList<>();
        List<Ent> ents = new ArrayList<>();
        List<Ph> phs = new ArrayList<>();

        int consonantRow = -1, vowelRow = -1, protoHdr = -1, pronHdr = -1;
        for (int i = 0; i < rows.size(); i++) {
            String[] r = rows.get(i);
            if (consonantRow < 0 && "Consonant".equals(r[0])) consonantRow = i;
            if (vowelRow < 0 && "Vowel".equals(r[0])) vowelRow = i;
            if (protoHdr < 0 && "proto".equals(r[5]) && "later".equals(r[6])) protoHdr = i;
            if (pronHdr < 0 && r[5] != null && r[5].toLowerCase().startsWith("pronounciation")) pronHdr = i;
        }

        // settings (top-left block)
        secs.add(new Sec("Settings", List.of("value")));
        int settingsEnd = consonantRow < 0 ? Math.min(6, rows.size()) : consonantRow;
        for (int i = 0; i < settingsEnd; i++) {
            String[] r = rows.get(i);
            if (r[0] != null && r[1] != null) ents.add(new Ent("Settings", r[0], java.util.Arrays.asList(r[1])));
            if (r[2] != null && !"next id".equalsIgnoreCase(r[2])) ents.add(new Ent("Settings", r[2], java.util.Arrays.asList(r[3])));
        }
        if (protoHdr >= 0) {
            secs.add(new Sec("Proto vs later", List.of("proto", "later")));
            for (int j = protoHdr + 1; j < rows.size() && rows.get(j)[4] != null; j++) {
                ents.add(new Ent("Proto vs later", rows.get(j)[4], java.util.Arrays.asList(rows.get(j)[5], rows.get(j)[6])));
            }
        }

        // header-driven tables in columns A-G
        Sec cur = null;
        int curN = 0;
        for (String[] r : rows) {
            String a = r[0];
            if (a != null && TITLES.contains(a.toLowerCase()) && any(r, 1)) {
                curN = a.equalsIgnoreCase("sound modifier") ? 3 : 6;
                List<String> hd = new ArrayList<>();
                for (int k = 1; k <= curN; k++) hd.add(r[k] == null ? "" : r[k]);
                cur = new Sec(a, hd);
                secs.add(cur);
                if (a.equalsIgnoreCase("sound modifier") && pronHdr >= 0) secs.add(new Sec("Pronunciation rules", List.of("rule")));
                continue;
            }
            if (cur != null && a != null) {
                List<String> cells = new ArrayList<>();
                for (int k = 1; k <= curN; k++) cells.add(r[k]);
                ents.add(new Ent(cur.title(), a, cells));
            }
        }
        if (pronHdr >= 0) {
            for (int j = pronHdr + 1; j < rows.size() && rows.get(j)[5] != null; j++) {
                ents.add(new Ent("Pronunciation rules", rows.get(j)[5], java.util.Arrays.asList(rows.get(j)[6])));
            }
        }

        // consonant grid
        if (consonantRow >= 0 && consonantRow + 3 < rows.size()) {
            String[] h1 = rows.get(consonantRow + 1), h2 = rows.get(consonantRow + 2);
            for (int j = consonantRow + 3; j < rows.size() && rows.get(j)[0] != null; j++) {
                String[] r = rows.get(j);
                for (int k = 1; k <= 5; k++) {
                    String col = (h1[k] == null ? "" : h1[k]) + (h2[k] == null ? "" : " / " + h2[k]);
                    for (String t : tokens(r[k])) phs.add(splitSymbol("consonant", r[0], col, t));
                }
            }
        }
        // vowel grid
        if (vowelRow >= 0) {
            String[] h = rows.get(vowelRow);
            for (int j = vowelRow + 1; j < rows.size() && rows.get(j)[0] != null; j++) {
                String[] r = rows.get(j);
                for (int k = 1; k <= 3; k++) {
                    for (String t : tokens(r[k])) phs.add(splitSymbol("vowel", r[0], h[k], t));
                }
            }
        }

        if (existing > 0) {
            db.update("delete from grammar_entries where language_id=?", langId);
            db.update("delete from grammar_sections where language_id=?", langId);
            db.update("delete from phonemes where language_id=?", langId);
        }
        int ord = 0;
        for (Sec s : secs) {
            db.insert("insert into grammar_sections(language_id, title, headings, ord) values (?,?,?,?)",
                    langId, s.title(), String.join("\t", s.headings()), ord++);
        }
        ord = 0;
        for (Ent e : ents) {
            Object[] args = new Object[11];
            args[0] = langId;
            args[1] = e.category();
            args[2] = e.name();
            for (int k = 0; k < 6; k++) args[3 + k] = k < e.cells().size() ? e.cells().get(k) : null;
            args[9] = ord++;
            db.insert("insert into grammar_entries(language_id, category, name, c1, c2, c3, c4, c5, c6, ord) values (?,?,?,?,?,?,?,?,?,?)",
                    java.util.Arrays.copyOf(args, 10));
        }
        for (Ph p : phs) {
            db.insert("insert into phonemes(language_id, symbol, kind, row_label, col_label, notes) values (?,?,?,?,?,?)",
                    langId, p.symbol(), p.kind(), p.row(), p.col(), p.note());
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sections", secs.size());
        out.put("rows", ents.size());
        out.put("sounds", phs.size());
        return out;
    }

    private static Ph splitSymbol(String kind, String row, String col, String token) {
        String t = token.trim();
        int sp = t.indexOf(' ');
        if (sp > 0) return new Ph(kind, row, col, t.substring(0, sp), t.substring(sp + 1).trim());
        return new Ph(kind, row, col, t, null);
    }
}
