package com.eonweather.core;

import context.*;
import date.Calendar;
import weather.*;

import java.io.File;
import java.util.*;

/**
 * Everything loaded from the world folder: regions, events, holy days,
 * influx aspects and calendars. Loaded once at startup; read-only afterwards.
 *
 * Folder layout:
 *   world/regions/*.yaml        one file per region (same format as before)
 *   world/additional-events.yaml
 *   world/important_dates.yaml
 *   world/influx.yaml
 *   world/calendars.yaml        (was data/eon.yaml)
 */
public final class World {
    public final File dir;
    private final fileHandler regions;
    private final List<GlobalEvent> globalEvents;
    private final List<ReligiousDate> religiousDates;
    private final String[][] influxLists;
    private final List<String> regionNames;
    private final List<Calendar> calendars;
    private final Map<String, MapExtras> extras;

    /**
     * Optional region settings that only affect how the weather is drawn on the map, never the
     * generated weather itself:
     *   cloud_cover: 2            more (or, negative, less) cloud; a number or a value per month
     *   contained_radius: 0.015   the region's weather stays within this distance of its points
     *                             (share of the map's width) and doesn't spread into neighbours
     *   base_heat_height: 1500    the height (m above the sea) the region's temperatures are for; the
     *                             3D view's snow, ice and falling snow count 6.5° colder per km above it
     */
    public record MapExtras(int[] cloudCover, double containedRadius, int baseHeatHeight) {
        static final MapExtras NONE = new MapExtras(new int[12], 0, 0);
        public int cloudCover(int month) { return cloudCover[month - 1]; }
    }

    public World(File dir) {
        this.dir = dir;
        Logger.setLevel(LogLevel.WARNING);
        File regionDir = new File(dir, "regions");
        if (!regionDir.isDirectory())
            throw new IllegalStateException("World folder not found: " + regionDir.getAbsolutePath()
                    + " (set EON_WORLD_DIR or run from the project folder)");
        this.regions = new fileHandler(regionDir.getAbsolutePath());
        this.globalEvents = GlobalEventLoader.load(new File(dir, "additional-events.yaml").getPath());
        this.religiousDates = ImportantDatesLoader.load(new File(dir, "important_dates.yaml").getPath());
        this.influxLists = InfluxLoader.load(new File(dir, "influx.yaml").getPath());
        List<String> names = new ArrayList<>(Arrays.asList(regions.getListOfNations()));
        names.sort(String.CASE_INSENSITIVE_ORDER);
        this.regionNames = Collections.unmodifiableList(names);
        this.extras = loadExtras(regionDir);
        // Calendars only use their own arithmetic, so one shared list is safe.
        this.calendars = CalendarLoader.load(new File(dir, "calendars.yaml").getPath(),
                new weatherCalculator(new Random()));
    }

    public List<Calendar> calendars() { return calendars; }

    private Map<String, Object> travel = Map.of();
    private long travelStamp = -1;

    /**
     * The travel calculator's rules from world/travel.yaml (empty without the file). Read again when the
     * file changes, so editing it needs no restart.
     */
    public synchronized Map<String, Object> travelRules() {
        File f = new File(dir, "travel.yaml");
        long stamp = f.isFile() ? f.lastModified() ^ f.length() : 0;
        if (stamp != travelStamp) {
            travelStamp = stamp;
            travel = Map.of();
            if (f.isFile()) {
                try (java.io.InputStream in = new java.io.FileInputStream(f)) {
                    Object o = new org.yaml.snakeyaml.Yaml().load(new java.io.InputStreamReader(in, java.nio.charset.StandardCharsets.UTF_8));
                    if (o instanceof Map<?, ?> m) travel = Api.checkTravelRules(m);
                } catch (Exception e) {
                    System.err.println("world/travel.yaml: " + e.getMessage());
                }
            }
        }
        return travel;
    }

    private Map<String, Object> events = Map.of();
    private long eventsStamp = -1;

    /**
     * The rules for events on journeys from world/events.yaml: { yaml (the file's text), rules (checked) } and
     * error when the file can't be read. Read again when the file changes.
     */
    public synchronized Map<String, Object> eventRules() {
        File f = new File(dir, "events.yaml");
        long stamp = f.isFile() ? f.lastModified() ^ f.length() : 0;
        if (stamp != eventsStamp) {
            eventsStamp = stamp;
            events = Map.of();
            if (f.isFile()) {
                try {
                    String text = java.nio.file.Files.readString(f.toPath(), java.nio.charset.StandardCharsets.UTF_8);
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("yaml", text);
                    try { m.put("rules", Api.parseEventRules(text)); }
                    catch (ApiException e) { m.put("error", e.getMessage()); System.err.println("world/events.yaml: " + e.getMessage()); }
                    events = m;
                } catch (java.io.IOException e) {
                    System.err.println("world/events.yaml: " + e.getMessage());
                }
            }
        }
        return events;
    }

    public List<String> regionNames() { return regionNames; }

    /** Names of the religions in important_dates.yaml, in file order. */
    public List<String> religions() {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (ReligiousDate r : religiousDates) if (r.religion != null && !r.religion.isBlank()) out.add(r.religion.trim());
        return new ArrayList<>(out);
    }

    public Nation region(String name) {
        Nation n = name == null ? null : regions.getNation(name);
        if (n == null) throw new ApiException(404, "Unknown region: " + name);
        return n;
    }

    /**
     * A fresh, fully configured calculator. The engine keeps per-call state
     * (pending bonuses, RNGs), so every request gets its own instance — this keeps
     * the same date giving the same weather no matter what was viewed before.
     */
    public weatherCalculator newCalculator() {
        weatherCalculator c = new weatherCalculator(new Random(3118725));
        c.setGlobalEvents(globalEvents);
        c.setReligiousDates(religiousDates);
        c.setInfluxLists(influxLists);
        c.setCalendars(calendars);
        return c;
    }

    public MapExtras extras(String regionName) { return extras.getOrDefault(regionName, MapExtras.NONE); }

    private static final String[] MONTHS = {"jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"};

    private static Map<String, MapExtras> loadExtras(File regionDir) {
        Map<String, MapExtras> out = new HashMap<>();
        File[] files = regionDir.listFiles((d, n) -> n.endsWith(".yaml") || n.endsWith(".yml"));
        if (files == null) return out;
        for (File f : files) {
            try (java.io.InputStream in = new java.io.FileInputStream(f)) {
                Object o = new org.yaml.snakeyaml.Yaml().load(new java.io.InputStreamReader(in, java.nio.charset.StandardCharsets.UTF_8));
                if (!(o instanceof Map<?, ?> m) || !(m.get("name") instanceof String name)) continue;
                int[] cover = new int[12];
                Object cc = m.get("cloud_cover");
                if (cc instanceof Number n) Arrays.fill(cover, n.intValue());
                else if (cc instanceof Map<?, ?> cm)
                    for (int i = 0; i < 12; i++) if (cm.get(MONTHS[i]) instanceof Number n) cover[i] = n.intValue();
                double radius = m.get("contained_radius") instanceof Number n ? n.doubleValue() : 0;
                int base = m.get("base_heat_height") instanceof Number n ? (int) Math.round(n.doubleValue()) : 0;
                if (radius > 0 || base != 0 || Arrays.stream(cover).anyMatch(v -> v != 0))
                    out.put(name, new MapExtras(cover, Math.max(0, Math.min(0.5, radius)), Math.max(-1000, Math.min(9000, base))));
            } catch (Exception e) {
                System.err.println("Could not read map settings from " + f.getName() + ": " + e.getMessage());
            }
        }
        return out;
    }

    public List<GlobalEvent> globalEvents() { return globalEvents; }

    public String[][] influxLists() { return influxLists; }
}
