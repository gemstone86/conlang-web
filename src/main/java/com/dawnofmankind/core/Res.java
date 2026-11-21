package com.dawnofmankind.core;

import java.util.EnumMap;
import java.util.Locale;
import java.util.Map;

/** The five resources. Each player keeps their own; a shared pool exists only when a card creates one. */
public enum Res {
    FOOD, PRODUCTION, CULTURE, INFLUENCE, RESEARCH;

    public String key() {
        return name().toLowerCase(Locale.ROOT);
    }

    public static Res of(String s) {
        try {
            return valueOf(s.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Unknown resource: " + s);
        }
    }

    public static EnumMap<Res, Integer> empty() {
        EnumMap<Res, Integer> m = new EnumMap<>(Res.class);
        for (Res r : values()) m.put(r, 0);
        return m;
    }

    /** {"food":3} (from YAML or JSON) to an EnumMap; missing resources are 0. */
    public static EnumMap<Res, Integer> parse(Object o) {
        EnumMap<Res, Integer> m = empty();
        if (o instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> e : map.entrySet()) {
                m.put(of(String.valueOf(e.getKey())), Y.toInt(e.getValue()));
            }
        } else if (o != null) {
            throw new IllegalArgumentException("Expected resources like {food: 2}, got " + o);
        }
        return m;
    }

    public static boolean isZero(Map<Res, Integer> m) {
        return m.values().stream().allMatch(v -> v == 0);
    }

    public static String describe(Map<Res, Integer> m) {
        StringBuilder sb = new StringBuilder();
        for (Res r : values()) {
            int v = m.getOrDefault(r, 0);
            if (v == 0) continue;
            if (!sb.isEmpty()) sb.append(", ");
            sb.append(v).append(' ').append(r.key());
        }
        return sb.isEmpty() ? "nothing" : sb.toString();
    }
}
