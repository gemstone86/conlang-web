package com.conlangs.web;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Pure: a word whose form is a cross-reference such as {@code see "wind"} or {@code see #12} stands for another word. */
public final class Refs {
    private Refs() {}

    /** Exactly one of id / gloss is set. */
    public record Ref(Long id, String gloss) {}

    private static final Pattern P = Pattern.compile("^\\s*see\\s+(?:#(\\d+)|\\\"([^\\\"]+)\\\"|\\(([^)]+)\\)|(.+?))\\s*$", Pattern.CASE_INSENSITIVE);

    public static Ref parse(String form) {
        if (form == null) return null;
        Matcher m = P.matcher(form);
        if (!m.matches()) return null;
        if (m.group(1) != null) return new Ref(Long.parseLong(m.group(1)), null);
        for (int i = 2; i <= 4; i++) if (m.group(i) != null) return new Ref(null, m.group(i).trim());
        return null;
    }

    /** Glosses imported from the workbook may carry their own parentheses, like (you-obj). */
    public static String norm(String t) {
        String x = t == null ? "" : t.trim().toLowerCase();
        if (x.startsWith("(") && x.endsWith(")") && x.length() > 2) x = x.substring(1, x.length() - 1).trim();
        return x;
    }
}
