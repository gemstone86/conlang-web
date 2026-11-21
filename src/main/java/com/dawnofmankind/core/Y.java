package com.dawnofmankind.core;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Small helpers for reading loosely typed YAML/JSON maps. */
final class Y {
    private Y() {}

    static int toInt(Object o) {
        if (o == null) return 0;
        if (o instanceof Number n) return n.intValue();
        try {
            return Integer.parseInt(String.valueOf(o).trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("Expected a number, got " + o);
        }
    }

    static int i(Map<String, Object> m, String k, int def) {
        Object o = m.get(k);
        return o == null ? def : toInt(o);
    }

    static String s(Map<String, Object> m, String k, String def) {
        Object o = m.get(k);
        return o == null ? def : String.valueOf(o);
    }

    static boolean b(Map<String, Object> m, String k) {
        Object o = m.get(k);
        return o instanceof Boolean bo ? bo : o != null && Boolean.parseBoolean(String.valueOf(o));
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> map(Object o) {
        if (o == null) return Map.of();
        if (o instanceof Map<?, ?> m) return (Map<String, Object>) m;
        throw new IllegalArgumentException("Expected a map, got " + o);
    }

    @SuppressWarnings("unchecked")
    static List<Object> list(Object o) {
        if (o == null) return List.of();
        if (o instanceof List<?> l) return (List<Object>) l;
        return List.of(o);
    }

    static List<String> strings(Object o) {
        List<String> out = new ArrayList<>();
        for (Object x : list(o)) out.add(String.valueOf(x));
        return out;
    }
}
