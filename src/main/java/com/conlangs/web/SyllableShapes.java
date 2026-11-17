package com.conlangs.web;

import java.util.ArrayList;
import java.util.List;

/**
 * A language's syllable shapes over time. The plain shape ("from the start") is the one in the language's settings; the
 * dated ones are written one per line as <code>year: shape</code>, e.g. <code>500: CV(C)</code>. The shape in force in a
 * year is the latest one that starts in or before it; for a year before them all it is the plain shape, or, without one,
 * the earliest dated one (the nearest). Pure Java, no Spring.
 */
public final class SyllableShapes {
    private SyllableShapes() {}

    public record Entry(int year, String shape) {}

    /** The shape in force and where it comes from (year null: the plain shape, "from the start"). */
    public record Found(String shape, Integer fromYear) {}

    /** The dated lines. Throws IllegalArgumentException (saying which line) for one that can't be read or whose shape is wrong. */
    public static List<Entry> parse(String text) {
        List<Entry> out = new ArrayList<>();
        if (text == null) return out;
        int n = 0;
        for (String raw : text.split("\\R")) {
            n++;
            String line = raw.strip();
            if (line.isEmpty()) continue;
            int c = line.indexOf(':');
            if (c < 0) c = line.indexOf('=');
            if (c <= 0) throw new IllegalArgumentException("Line " + n + ": write it as  year: shape  (e.g. 500: CV(C)).");
            int year;
            try { year = Integer.parseInt(line.substring(0, c).strip()); }
            catch (NumberFormatException e) { throw new IllegalArgumentException("Line " + n + ": '" + line.substring(0, c).strip() + "' is not a year."); }
            String shape = line.substring(c + 1).strip();
            String err = SyllableShape.check(shape);
            if (err != null || shape.isBlank()) throw new IllegalArgumentException("Line " + n + ": " + (err == null ? "no shape given." : err));
            if (out.stream().anyMatch(e -> e.year() == year)) throw new IllegalArgumentException("Line " + n + ": year " + year + " is there twice.");
            out.add(new Entry(year, shape.replaceAll("\\s+", "").toUpperCase()));
        }
        out.sort((a, b) -> Integer.compare(a.year(), b.year()));
        return out;
    }

    /** The text as it is kept: tidy, one line per year, in year order. */
    public static String normalize(String text) {
        List<Entry> l = parse(text);
        if (l.isEmpty()) return null;
        StringBuilder sb = new StringBuilder();
        for (Entry e : l) sb.append(sb.length() > 0 ? "\n" : "").append(e.year()).append(": ").append(e.shape());
        return sb.toString();
    }

    /** The shape in force in a year, or null when the language has none at all. */
    public static Found at(String plain, List<Entry> dated, int year) {
        Entry best = null;
        for (Entry e : dated) if (e.year() <= year && (best == null || e.year() > best.year())) best = e;
        if (best != null) return new Found(best.shape(), best.year());
        if (plain != null && !plain.isBlank()) return new Found(plain.strip(), null);
        if (!dated.isEmpty()) { Entry first = dated.get(0); return new Found(first.shape(), first.year()); }
        return null;
    }
}
