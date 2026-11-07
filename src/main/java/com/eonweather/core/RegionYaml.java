package com.eonweather.core;

import org.yaml.snakeyaml.Yaml;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;

/**
 * Region files made in the app: turns the form's data into a region YAML file in the same
 * format as the files in world/regions, and reads any region file back into form data.
 *
 * Form data (all but name optional):
 *   name, description, temperature[12], precipitation[12], wind[12], temperature_drop, drop_speed,
 *   prevailing_wind ("" or N…NW), prevailing_chance, cloud_cover, contained_radius, base_heat_height,
 *   events[{name, occurs, days, bonus_temp, bonus_rain, bonus_wind, start_month, end_month,
 *           min_wind, max_wind, min_temp, max_temp, list[], follow_wind, wander, growth,
 *           duration_min, duration_max, speed_min, speed_max, stay_in_region}]
 */
public final class RegionYaml {
    private RegionYaml() {}

    static final String[] MONTHS = {"jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"};
    static final List<String> DIRECTIONS = List.of("N", "NE", "E", "SE", "S", "SW", "W", "NW");
    /** Event fields written as whole numbers, with allowed ranges. */
    private static final Map<String, int[]> EVENT_INTS = new LinkedHashMap<>();
    /** Event fields that may have decimals (magic storms). */
    private static final Map<String, double[]> EVENT_NUMS = new LinkedHashMap<>();
    static {
        EVENT_INTS.put("occurs", new int[]{1, 1000});
        EVENT_INTS.put("days", new int[]{1, 100000});
        EVENT_INTS.put("start_month", new int[]{0, 12});
        EVENT_INTS.put("end_month", new int[]{0, 12});
        EVENT_INTS.put("min_wind", new int[]{-50, 999});
        EVENT_INTS.put("max_wind", new int[]{-50, 999});
        EVENT_INTS.put("min_temp", new int[]{-999, 999});
        EVENT_INTS.put("max_temp", new int[]{-999, 999});
        EVENT_INTS.put("bonus_temp", new int[]{-60, 60});
        EVENT_INTS.put("bonus_rain", new int[]{-20, 20});
        EVENT_INTS.put("bonus_wind", new int[]{-20, 20});
        EVENT_INTS.put("follow_wind", new int[]{0, 100});
        EVENT_INTS.put("wander", new int[]{0, 100});
        EVENT_INTS.put("growth", new int[]{0, 100});
        EVENT_NUMS.put("duration_min", new double[]{0, 1000});
        EVENT_NUMS.put("duration_max", new double[]{0, 1000});
        EVENT_NUMS.put("speed_min", new double[]{0, 500});
        EVENT_NUMS.put("speed_max", new double[]{0, 500});
    }

    /** Checks a region name: 2–60 characters, letters, digits, spaces and a few signs. */
    public static String checkName(Object o) {
        String name = o == null ? "" : o.toString().trim().replaceAll("\\s+", " ");
        if (name.length() < 2 || name.length() > 60) throw new ApiException(400, "The region name must be 2–60 characters");
        if (!name.matches("[\\p{L}\\p{N} ()'.,\\-]+")) throw new ApiException(400, "The region name may only have letters, digits, spaces and ( ) ' . , -");
        return name;
    }

    /** Form data → YAML text. Throws ApiException (400) for bad input. */
    public static String toYaml(Map<String, Object> d) {
        String name = checkName(d.get("name"));
        StringBuilder y = new StringBuilder();
        Object desc = d.get("description");
        if (desc != null && !desc.toString().isBlank()) {
            String text = desc.toString().trim();
            if (text.length() > 2000) throw new ApiException(400, "The description is too long");
            for (String line : text.split("\\R")) y.append("# ").append(line.strip()).append('\n');
        } else {
            y.append("# ").append(name).append(": skapad i Eon Väder.\n");
        }
        y.append("name: ").append(q(name)).append("\n\n");
        months(y, "temperature", ints(d.get("temperature"), -100, 100, "temperature"));
        y.append("temperature_drop: ").append(intIn(d.get("temperature_drop"), 0, 60, 0, "temperature_drop")).append('\n');
        y.append("drop_speed: ").append(num(numIn(d.get("drop_speed"), 0, 20, 1, "drop_speed"))).append("\n\n");
        months(y, "precipitation", ints(d.get("precipitation"), -20, 20, "precipitation"));
        y.append("shift: 0\n\n");
        months(y, "wind", ints(d.get("wind"), -20, 30, "wind"));

        String pw = d.get("prevailing_wind") == null ? "" : d.get("prevailing_wind").toString().trim().toUpperCase(Locale.ROOT);
        if (!pw.isEmpty()) {
            if (!DIRECTIONS.contains(pw)) throw new ApiException(400, "prevailing_wind must be one of " + DIRECTIONS);
            y.append("# Förhärskande vind: varifrån vinden oftast blåser och hur stor del av dagarna (%).\n");
            y.append("prevailing_wind: ").append(pw).append('\n');
            y.append("prevailing_chance: ").append(intIn(d.get("prevailing_chance"), 0, 100, 50, "prevailing_chance")).append("\n\n");
        }
        int cover = intIn(d.get("cloud_cover"), -10, 10, 0, "cloud_cover");
        if (cover != 0) y.append("cloud_cover: ").append(cover).append('\n');
        double radius = numIn(d.get("contained_radius"), 0, 0.5, 0, "contained_radius");
        if (radius > 0) y.append("contained_radius: ").append(num(radius)).append('\n');
        if (cover != 0 || radius > 0) y.append('\n');
        int base = intIn(d.get("base_heat_height"), -1000, 9000, 0, "base_heat_height");
        if (base != 0) {
            y.append("# Höjden (m ö.h.) som temperaturerna ovan gäller för. I 3D blir det 6,5° kallare per km över den.\n");
            y.append("base_heat_height: ").append(base).append("\n\n");
        }

        List<?> events = d.get("events") instanceof List<?> l ? l : List.of();
        if (events.size() > 100) throw new ApiException(400, "Too many events (at most 100)");
        if (events.isEmpty()) { y.append("events: []\n"); return y.toString(); }
        y.append("events:\n");
        for (Object o : events) {
            if (!(o instanceof Map<?, ?> e)) throw new ApiException(400, "Bad event");
            String en = e.get("name") == null ? "" : e.get("name").toString().trim();
            if (en.isEmpty() || en.length() > 200) throw new ApiException(400, "Every event needs a name (at most 200 characters)");
            y.append("  - name: ").append(q(en)).append('\n');
            for (Map.Entry<String, int[]> f : EVENT_INTS.entrySet()) {
                Object v = e.get(f.getKey());
                boolean required = f.getKey().equals("occurs") || f.getKey().equals("days");
                if (!required && (v == null || v.toString().isBlank())) continue;
                int def = f.getKey().equals("occurs") ? 1 : f.getKey().equals("days") ? 365 : 0;
                y.append("    ").append(f.getKey()).append(": ").append(intIn(v, f.getValue()[0], f.getValue()[1], def, "event " + f.getKey())).append('\n');
            }
            for (Map.Entry<String, double[]> f : EVENT_NUMS.entrySet()) {
                Object v = e.get(f.getKey());
                if (v == null || v.toString().isBlank()) continue;
                y.append("    ").append(f.getKey()).append(": ").append(num(numIn(v, f.getValue()[0], f.getValue()[1], 0, "event " + f.getKey()))).append('\n');
            }
            if (Boolean.TRUE.equals(e.get("stay_in_region"))) y.append("    stay_in_region: true\n");
            if (e.get("list") instanceof List<?> variants && !variants.isEmpty()) {
                if (variants.size() > 100) throw new ApiException(400, "Too many variants in an event");
                y.append("    list:\n");
                for (Object v : variants) if (v != null && !v.toString().isBlank()) y.append("      - ").append(q(v.toString().trim())).append('\n');
            }
        }
        return y.toString();
    }

    /** Checks that the engine can load the YAML (the same reader as for world/regions). */
    public static void verify(String yaml) {
        try {
            File tmp = Files.createTempFile("eon-region-", ".yaml").toFile();
            try {
                Files.writeString(tmp.toPath(), yaml, StandardCharsets.UTF_8);
                weather.Nation n = new context.fileHandler(tmp.getParent()) {
                    @Override public void initializeDataFiles() { /* don't scan the temp folder */ }
                }.readYamlFile(tmp.getPath());
                if (n == null) throw new ApiException(400, "The region could not be read back");
            } finally {
                tmp.delete();
            }
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The region name inside a YAML text (null if none). */
    public static String nameOf(String yaml) {
        Object o = new Yaml().load(yaml);
        return o instanceof Map<?, ?> m && m.get("name") != null ? m.get("name").toString() : null;
    }

    /** A region file → form data (unknown keys are dropped). */
    public static Map<String, Object> toData(String yaml) {
        Map<String, Object> out = new LinkedHashMap<>();
        Object o = new Yaml().load(yaml);
        if (!(o instanceof Map<?, ?> m)) return out;
        StringBuilder desc = new StringBuilder();
        for (String line : yaml.split("\\R")) {
            String t = line.strip();
            if (t.startsWith("name:")) break;
            if (t.startsWith("#")) desc.append(desc.length() > 0 ? "\n" : "").append(t.substring(1).strip());
        }
        out.put("name", String.valueOf(m.get("name")));
        out.put("description", desc.toString());
        out.put("temperature", monthArray(m.get("temperature")));
        out.put("precipitation", monthArray(m.get("precipitation")));
        out.put("wind", monthArray(m.get("wind")));
        out.put("temperature_drop", m.get("temperature_drop") instanceof Number n ? n.intValue() : 0);
        out.put("drop_speed", m.get("drop_speed") instanceof Number n ? n.doubleValue() : 0);
        out.put("prevailing_wind", m.get("prevailing_wind") == null ? "" : m.get("prevailing_wind").toString());
        out.put("prevailing_chance", m.get("prevailing_chance") instanceof Number n ? n.intValue() : 50);
        Object cc = m.get("cloud_cover");
        out.put("cloud_cover", cc instanceof Number n ? n.intValue() : 0);
        out.put("contained_radius", m.get("contained_radius") instanceof Number n ? n.doubleValue() : 0);
        out.put("base_heat_height", m.get("base_heat_height") instanceof Number n ? (int) Math.round(n.doubleValue()) : 0);
        List<Map<String, Object>> events = new ArrayList<>();
        if (m.get("events") instanceof List<?> list) for (Object e : list) {
            if (!(e instanceof Map<?, ?> em)) continue;
            Map<String, Object> ev = new LinkedHashMap<>();
            ev.put("name", String.valueOf(em.get("name")));
            for (String k : EVENT_INTS.keySet()) if (em.get(k) instanceof Number n) ev.put(k, n.intValue());
            for (String k : EVENT_NUMS.keySet()) if (em.get(k) instanceof Number n) ev.put(k, n.doubleValue());
            if (Boolean.TRUE.equals(em.get("stay_in_region"))) ev.put("stay_in_region", true);
            if (em.get("list") instanceof List<?> v) ev.put("list", v.stream().map(String::valueOf).toList());
            events.add(ev);
        }
        out.put("events", events);
        return out;
    }

    /** Reads a region file from disk as text. */
    public static String read(File f) {
        try (InputStreamReader r = new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8)) {
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[8192];
            int n;
            while ((n = r.read(buf)) > 0) sb.append(buf, 0, n);
            return sb.toString();
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }

    // ── helpers ──
    private static void months(StringBuilder y, String key, int[] v) {
        y.append(key).append(":\n");
        for (int i = 0; i < 12; i++) y.append("  ").append(MONTHS[i]).append(": ").append(v[i]).append('\n');
        y.append('\n');
    }
    private static int[] ints(Object o, int lo, int hi, String what) {
        int[] out = new int[12];
        if (o == null) return out;
        if (!(o instanceof List<?> l) || l.size() != 12) throw new ApiException(400, what + " needs 12 values (one per month)");
        for (int i = 0; i < 12; i++) out[i] = intIn(l.get(i), lo, hi, 0, what);
        return out;
    }
    private static int[] monthArray(Object o) {
        int[] out = new int[12];
        if (o instanceof Map<?, ?> m) for (int i = 0; i < 12; i++) if (m.get(MONTHS[i]) instanceof Number n) out[i] = n.intValue();
        return out;
    }
    private static int intIn(Object o, int lo, int hi, int def, String what) {
        if (o == null || o.toString().isBlank()) return def;
        double v;
        try { v = o instanceof Number n ? n.doubleValue() : Double.parseDouble(o.toString().trim().replace(',', '.')); }
        catch (NumberFormatException e) { throw new ApiException(400, what + ": not a number"); }
        long r = Math.round(v);
        if (r < lo || r > hi) throw new ApiException(400, what + " must be between " + lo + " and " + hi);
        return (int) r;
    }
    private static double numIn(Object o, double lo, double hi, double def, String what) {
        if (o == null || o.toString().isBlank()) return def;
        double v;
        try { v = o instanceof Number n ? n.doubleValue() : Double.parseDouble(o.toString().trim().replace(',', '.')); }
        catch (NumberFormatException e) { throw new ApiException(400, what + ": not a number"); }
        if (!(v >= lo && v <= hi)) throw new ApiException(400, what + " must be between " + num(lo) + " and " + num(hi));
        return v;
    }
    private static String num(double v) {
        if (v == Math.rint(v) && Math.abs(v) < 1e9) return String.valueOf((long) v);
        String s = String.format(Locale.ROOT, "%.4f", v);
        return s.replaceAll("0+$", "").replaceAll("\\.$", "");
    }
    /** A YAML double-quoted string. */
    private static String q(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\t' -> b.append("\\t");
                default -> { if (c < 0x20) b.append(String.format("\\x%02x", (int) c)); else b.append(c); }
            }
        }
        return b.append('"').toString();
    }
}
