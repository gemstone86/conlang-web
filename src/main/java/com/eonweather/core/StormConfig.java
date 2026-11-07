package com.eonweather.core;

import org.yaml.snakeyaml.Yaml;

import java.io.File;
import java.io.FileInputStream;
import java.util.*;

/**
 * Magic-storm behaviour from the YAML files (see world/magic-storms.yaml for the meaning):
 * follow_wind, wander, speed_min, speed_max (km/h), growth, duration_min, duration_max.
 *
 * Values come from, in increasing priority: magic-storms.yaml "defaults", the event's own
 * entry (region file first, then additional-events.yaml), and the aspect rules.
 */
public final class StormConfig {
    public record Params(int followWind, int wander, double speedMin, double speedMax, int growth, double durationMin, double durationMax, boolean stayInRegion) {}

    private final Map<String, Object> defaults = new HashMap<>();
    private final Map<String, Map<String, Object>> aspectRules = new HashMap<>();
    private final Map<String, Map<String, Object>> global = new LinkedHashMap<>();
    private final Map<String, Map<String, Map<String, Object>>> regional = new HashMap<>();

    @SuppressWarnings("unchecked")
    public StormConfig(File worldDir) {
        defaults.putAll(Map.of("follow_wind", 0, "wander", 0, "speed_min", 5, "speed_max", 20, "growth", 50,
                "duration_min", 12, "duration_max", 48, "stay_in_region", false));
        Map<String, Object> ms = read(new File(worldDir, "magic-storms.yaml"));
        if (ms.get("defaults") instanceof Map<?, ?> d) defaults.putAll((Map<String, Object>) d);
        if (ms.get("aspects") instanceof Map<?, ?> a)
            for (Map.Entry<?, ?> e : a.entrySet())
                if (e.getValue() instanceof Map<?, ?> v) aspectRules.put(String.valueOf(e.getKey()), (Map<String, Object>) v);

        readEvents(read(new File(worldDir, "additional-events.yaml")), global);
        File[] files = new File(worldDir, "regions").listFiles((dir, n) -> n.endsWith(".yaml"));
        if (files != null) for (File f : files) {
            Map<String, Object> root = read(f);
            Object name = root.get("name");
            if (name == null) continue;
            Map<String, Map<String, Object>> events = new LinkedHashMap<>();
            readEvents(root, events);
            regional.put(name.toString(), events);
        }
    }

    @SuppressWarnings("unchecked")
    private static void readEvents(Map<String, Object> root, Map<String, Map<String, Object>> into) {
        if (!(root.get("events") instanceof List<?> list)) return;
        for (Object o : list)
            if (o instanceof Map<?, ?> m && m.get("name") != null) into.put(m.get("name").toString(), (Map<String, Object>) m);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> read(File f) {
        if (!f.isFile()) return new HashMap<>();
        try (FileInputStream in = new FileInputStream(f)) {
            Object o = new Yaml().load(in);
            return o instanceof Map ? (Map<String, Object>) o : new HashMap<>();
        } catch (Exception e) {
            System.err.println("Could not read " + f + ": " + e.getMessage());
            return new HashMap<>();
        }
    }

    /** Settings for a triggered event (its display name may be "Base (Variant)"). */
    public Params forEvent(String region, String displayName, String aspect) {
        Map<String, Object> v = new HashMap<>(defaults);
        Map<String, Object> ev = find(regional.getOrDefault(region, Map.of()), displayName);
        if (ev == null) ev = find(global, displayName);
        if (ev != null) for (String k : defaults.keySet()) if (ev.containsKey(k)) v.put(k, ev.get(k));
        if (aspect != null && aspectRules.containsKey(aspect)) v.putAll(aspectRules.get(aspect));
        double dMin = num(v, "duration_min"), dMax = num(v, "duration_max");
        if (dMax < dMin) dMax = dMin;
        double sMin = Math.max(0.1, num(v, "speed_min")), sMax = Math.max(sMin, num(v, "speed_max"));
        return new Params((int) num(v, "follow_wind"), (int) num(v, "wander"), sMin, sMax,
                (int) Math.max(1, Math.min(100, num(v, "growth"))), Math.max(0.5, dMin), Math.max(0.5, dMax),
                "true".equalsIgnoreCase(String.valueOf(v.get("stay_in_region")).trim()));
    }

    private static Map<String, Object> find(Map<String, Map<String, Object>> events, String displayName) {
        Map<String, Object> exact = events.get(displayName);
        if (exact != null) return exact;
        for (Map.Entry<String, Map<String, Object>> e : events.entrySet())   // variant events: "Base (Variant)"
            if (displayName.startsWith(e.getKey() + " (")) return e.getValue();
        return null;
    }

    private static double num(Map<String, Object> v, String k) {
        Object o = v.get(k);
        if (o instanceof Number n) return n.doubleValue();
        try { return Double.parseDouble(String.valueOf(o).trim()); } catch (Exception e) { return 0; }
    }
}
