package com.conlangs.web;

import java.util.LinkedHashMap;
import java.util.Map;

/** Pure: which fields of a sound-change rule differ between the stored rule and an imported entry. */
public final class RuleDiff {
    private RuleDiff() {}

    private static String text(Object o) {
        return o == null ? "" : o.toString();
    }

    private static Long whole(Object o) {
        if (o == null || o.toString().isBlank()) return null;
        if (o instanceof Number n) return n.longValue();
        try {
            return Long.parseLong(o.toString().trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** Returns only the fields (using the stored column names) that are present in the entry and differ from the stored rule. */
    public static Map<String, Object> changed(Map<String, Object> stored, Map<String, Object> entry) {
        Map<String, Object> out = new LinkedHashMap<>();
        Object year = entry.get("year");
        if (year != null && !java.util.Objects.equals(whole(year), whole(stored.get("year")))) out.put("year", whole(year));
        Object ord = entry.containsKey("order") ? entry.get("order") : entry.get("ord");
        if (ord != null && !java.util.Objects.equals(whole(ord), whole(stored.get("ord")))) out.put("ord", whole(ord));
        for (String f : new String[]{"name", "pattern", "replacement", "note"}) {
            if (entry.containsKey(f) && !text(entry.get(f)).equals(text(stored.get(f)))) out.put(f, text(entry.get(f)));
        }
        if (entry.containsKey("tags")) {
            String now = RuleTags.normalize(tagsText(entry.get("tags")));
            if (!text(now).equals(text(RuleTags.normalize(stored.get("tags"))))) out.put("tags", now == null ? "" : now);
        }
        return out;
    }

    /** Tags in an imported entry: "a, b" or ["a", "b"]. */
    public static String tagsText(Object o) {
        if (o instanceof java.util.Collection<?> c) return String.join(", ", c.stream().map(String::valueOf).toList());
        return o == null ? null : o.toString();
    }
}
