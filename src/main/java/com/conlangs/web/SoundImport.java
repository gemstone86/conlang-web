package com.conlangs.web;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Reads a pasted table of sounds: one sound per line, cells separated by a tab, a vertical bar or a semicolon, in the order
 * Symbol, Kind, Row, Column, Notes, From, Until. A header line, markdown "---" lines and blank lines are ignored.
 * Pure Java, no Spring.
 */
public final class SoundImport {
    private SoundImport() {}

    /** Each result has symbol, kind, row_label, col_label, notes and optionally year / year_to; problems go to errors. */
    public static List<Map<String, Object>> parse(String text, List<String> errors) {
        List<Map<String, Object>> out = new ArrayList<>();
        int n = 0;
        for (String raw : (text == null ? "" : text).split("\\R")) {
            n++;
            String line = raw.strip();
            if (line.isEmpty() || line.matches("[|:\\-\\s]+")) continue;
            String[] f;
            if (line.contains("\t")) f = line.split("\t", -1);
            else if (line.contains("|")) {
                String t = line;
                if (t.startsWith("|")) t = t.substring(1);
                if (t.endsWith("|")) t = t.substring(0, t.length() - 1);
                f = t.split("\\|", -1);
            } else f = line.split(";", -1);
            for (int i = 0; i < f.length; i++) f[i] = f[i].strip();
            if (f[0].equalsIgnoreCase("symbol")) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("symbol", f[0]);
            String kind = f.length > 1 ? f[1].toLowerCase() : "";
            if (kind.equals("c")) kind = "consonant";
            if (kind.equals("v")) kind = "vowel";
            m.put("kind", kind);
            m.put("row_label", f.length > 2 ? f[2] : "");
            m.put("col_label", f.length > 3 ? f[3] : "");
            m.put("notes", f.length > 4 ? f[4] : "");
            try {
                if (f.length > 5 && !f[5].isEmpty()) m.put("year", Long.parseLong(f[5]));
                if (f.length > 6 && !f[6].isEmpty()) m.put("year_to", Long.parseLong(f[6]));
            } catch (NumberFormatException e) {
                errors.add("Line " + n + ": the From and Until years must be whole numbers.");
                continue;
            }
            out.add(m);
        }
        return out;
    }
}
