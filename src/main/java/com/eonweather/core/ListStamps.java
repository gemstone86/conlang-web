package com.eonweather.core;

import java.util.*;

/**
 * "Last edited" on the items of a map's lists (rivers, roads, cities, mountain ranges, nations): every item carries
 * <code>edited</code> (an ISO time, UTC) and <code>editedBy</code> (the account's name). When a list is saved from the app
 * the items that differ from what was stored (or are new) get the time and the account; the ones that are the same keep
 * what they had. Items nobody has changed since this was added have neither.
 */
public final class ListStamps {
    public static final String EDITED = "edited", BY = "editedBy";

    private ListStamps() {}

    /** The new list (JSON) with the stamps put in; oldJson is what was stored before. Anything that can't be read is left as it is. */
    @SuppressWarnings("unchecked")
    public static String stamp(String oldJson, String newJson, String when, String by) {
        Object o, n;
        try {
            o = oldJson == null || oldJson.isBlank() ? new ArrayList<>() : Json.parse(oldJson);
            n = Json.parse(newJson);
        } catch (RuntimeException e) {
            return newJson;
        }
        if (!(n instanceof List<?> now) || !(o instanceof List<?> was)) return newJson;
        Map<Object, Map<String, Object>> before = new HashMap<>();
        for (Object x : was) if (x instanceof Map<?, ?> m && m.get("id") != null) before.put(key(m.get("id")), (Map<String, Object>) m);
        for (Object x : now) {
            if (!(x instanceof Map<?, ?> raw)) continue;
            Map<String, Object> item = (Map<String, Object>) raw;
            Map<String, Object> old = item.get("id") == null ? null : before.get(key(item.get("id")));
            item.remove(EDITED); item.remove(BY);
            if (old != null && same(old, item)) {
                if (old.get(EDITED) != null) item.put(EDITED, old.get(EDITED));
                if (old.get(BY) != null) item.put(BY, old.get(BY));
            } else {
                item.put(EDITED, when);
                if (by != null) item.put(BY, by);
            }
        }
        return Json.write(now);
    }

    /** id (as text) → [edited, editedBy] of the items that have a stamp: what the page shows as "last edited". */
    @SuppressWarnings("unchecked")
    public static Map<String, List<String>> of(String json) {
        Map<String, List<String>> out = new LinkedHashMap<>();
        try {
            if (Json.parse(json) instanceof List<?> l) for (Object x : l)
                if (x instanceof Map<?, ?> m && m.get("id") != null && m.get(EDITED) != null)
                    out.put(String.valueOf(key(m.get("id"))), Arrays.asList(String.valueOf(m.get(EDITED)), m.get(BY) == null ? "" : String.valueOf(m.get(BY))));
        } catch (RuntimeException e) { /* no stamps */ }
        return out;
    }

    private static Object key(Object id) { return id instanceof Number n ? n.longValue() : String.valueOf(id); }

    /** Equal apart from the stamps. */
    private static boolean same(Map<String, Object> a, Map<String, Object> b) {
        Map<String, Object> x = new LinkedHashMap<>(a), y = new LinkedHashMap<>(b);
        x.remove(EDITED); x.remove(BY); y.remove(EDITED); y.remove(BY);
        return Json.write(x).equals(Json.write(y));
    }
}
