package com.eonweather.core;

import date.Day;
import date.InfluxCalculator;
import gui.Localization;
import weather.Nation;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Data for the map: every region's weather for a date (daily + hourly), a derived
 * cloud cover, and the magic storms currently active.
 *
 * The browser blends these per-region values into smooth fields using the anchor
 * points placed on the map, and moves clouds and storms along the wind.
 *
 * Nothing here changes the weather the generator produces: cloud cover uses its own
 * seeded RNG, and magic storms are read from the events the engine already rolls.
 */
public final class FieldService {
    /** How many days back storm births are scanned (long storms, and storms that swell again, reach far). */
    public static final int STORM_LOOKBACK_DAYS = 10;
    /** Rolls this far ahead are also scanned: a storm that swells again tomorrow must look the same today. */
    public static final int STORM_LOOKAHEAD_DAYS = 6;

    /** Region weather per (region, day), shared across requests; the engine is deterministic. */
    private final Map<String, WeatherService.Computed> computedCache = Collections.synchronizedMap(
            new LinkedHashMap<>(4096, 0.75f, true) {
                @Override protected boolean removeEldestEntry(Map.Entry<String, WeatherService.Computed> e) { return size() > 8000; }
            });

    private static final Pattern STRENGTH = Pattern.compile("(?i)styrka\\s*(\\d+)");
    private static final Pattern ASPECT_NUMBER = Pattern.compile("(?i)\\p{L}+tropi\\s+(\\d+)");
    private static final Pattern ALSTRA = Pattern.compile("(?i)\\+\\s*(\\d+)\\s*alstra");
    private static final Pattern ASPECT = Pattern.compile("(?i)(\\p{L}+?tropi)(?:skt|sk|s)?\\b");
    private static final Pattern FORCE = Pattern.compile("(?i)(\\p{L}+krafter)");
    private static final Pattern ANY_NUMBER = Pattern.compile("(\\d+)");

    /** The aspects grouped into their forces (from the old aspekt enum). */
    static final Map<String, String> FORCE_OF = new HashMap<>();
    static {
        for (String a : List.of("Kronotropi", "Nomotropi", "Ataxatropi", "Topotropi")) FORCE_OF.put(a, "Grundkrafter");
        for (String a : List.of("Termotropi", "Kryotropi", "Fototropi", "Skototropi")) FORCE_OF.put(a, "Primalkrafter");
        for (String a : List.of("Pyrotropi", "Geotropi", "Pneumotropi", "Hydrotropi")) FORCE_OF.put(a, "Elementarkrafter");
        for (String a : List.of("Biotropi", "Nekrotropi")) FORCE_OF.put(a, "Livskrafter");
        for (String a : List.of("Heliotropi", "Selenotropi", "Astrotropi", "Kosmotropi")) FORCE_OF.put(a, "Himlakrafter");
        for (String a : List.of("Ikonotropi", "Semotropi")) FORCE_OF.put(a, "Symbolkrafter");
        for (String a : List.of("Teotropi", "Psykotropi", "Daimotropi", "Oneirotropi")) FORCE_OF.put(a, "Själakrafter");
    }

    private final World world;
    private final WeatherService weather;
    private final StormConfig stormConfig;
    private final Map<String, Map<String, Object>> cache = Collections.synchronizedMap(
            new LinkedHashMap<>(64, 0.75f, true) {
                @Override protected boolean removeEldestEntry(Map.Entry<String, Map<String, Object>> e) { return size() > 96; }
            });

    public FieldService(World world, WeatherService weather) {
        this.world = world;
        this.weather = weather;
        this.stormConfig = new StormConfig(world.dir);
    }

    public Map<String, Object> field(int y, int m, int d, String lang) {
        WeatherService.checkDate(y, m, d);
        String key = y + "-" + m + "-" + d + "-" + lang;
        Map<String, Object> hit = cache.get(key);
        if (hit != null) return hit;
        Map<String, Object> out = build(y, m, d, lang);
        cache.put(key, out);
        return out;
    }

    private Map<String, Object> build(int y, int m, int d, String lang) {
        Localization.setLangFromString(lang);
        int serial = WeatherService.serial(y, m, d);
        InfluxCalculator ic = new InfluxCalculator(world.influxLists());
        String influx = ic.isLoaded() ? ic.getInfluxString(y, m, d, serial) : "";

        List<Map<String, Object>> regions = new ArrayList<>();

        for (String name : world.regionNames()) {
            Nation n = world.region(name);
            WeatherService.Computed today = weather.compute(n, y, m, d);
            Day day = today.day();
            double[][] h = today.hourly();

            World.MapExtras extras = world.extras(n.getName());
            CloudInfo cloud = cloud(n, day, h[2], serial, extras.cloudCover(m));

            Map<String, Object> r = new LinkedHashMap<>();
            r.put("name", n.getName());
            r.put("temperature", day.getTemperature());
            r.put("wind", day.getWindStrength());
            r.put("windName", WeatherService.windName(day.getWindStrength(), lang));
            r.put("direction", day.getDirection().name());
            r.put("rain", day.getRain());
            r.put("rainName", WeatherService.rainName(day.getRain(), lang));
            r.put("cloud", cloud.daily);
            r.put("fog", cloud.fog);
            r.put("thunder", cloud.thunder);
            r.put("events", day.getEventList());
            if (extras.containedRadius() > 0) r.put("containedRadius", extras.containedRadius());
            if (extras.baseHeatHeight() != 0) r.put("baseHeight", extras.baseHeatHeight());
            Map<String, Object> hourly = new LinkedHashMap<>();
            hourly.put("temperature", h[0]);
            hourly.put("wind", h[1]);
            hourly.put("rain", h[2]);
            hourly.put("cloud", cloud.hourly);
            hourly.put("fog", cloud.hourlyFog);
            r.put("hourly", hourly);
            regions.add(r);

        }

        List<Map<String, Object>> storms = stormsAlive(serial, ic);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("year", y); out.put("month", m); out.put("day", d);
        out.put("serial", serial);
        out.put("influx", influx);
        out.put("aspects", ic.isLoaded() ? Arrays.asList(ic.getActiveAspects(y, m, d, serial)) : List.of());
        out.put("regions", regions);
        out.put("storms", storms);
        return Collections.unmodifiableMap(out);
    }

    // ── Storm lifecycle ──────────────────────────────────────────────────
    /** One roll of a magic event: a swell of strength between start and end (days, continuous clock). */
    private record Pulse(String name, double start, double end, int peak, int boost, int growth) {}

    private static final class Chain {
        final String key, region, seedName;
        final long seed;
        final Map<String, Object> first;     // parsed info of the first roll
        final StormConfig.Params params;
        final String motion;
        final List<Pulse> pulses = new ArrayList<>();
        double start, end;
        Chain(String key, String region, String seedName, long seed, Map<String, Object> first, StormConfig.Params params, String motion) {
            this.key = key; this.region = region; this.seedName = seedName; this.seed = seed;
            this.first = first; this.params = params; this.motion = motion;
        }
    }

    /** Position (0..1) of the peak within a storm's life: growth 50 → middle, 1 → near the end, 100 → near the start. */
    public static double peakAt(int growth) { return 0.05 + 0.9 * (1 - growth / 100.0); }

    /**
     * Every storm alive at some point during day {@code serial}. A storm forms at a random hour of the
     * day its event was rolled, lasts duration_min..duration_max hours, and swells to its peak strength
     * along its growth curve. If the same region rolls the same kind of storm while one is still alive,
     * that storm swells again (another pulse) instead of a second storm appearing.
     * Everything is derived from seeds, so the same storm is described identically on every day it spans.
     */
    private List<Map<String, Object>> stormsAlive(int serial, InfluxCalculator ic) {
        Map<String, WeatherService.Computed> cache = computedCache;
        List<Map<String, Object>> out = new ArrayList<>();
        for (String regionName : world.regionNames()) {
            Nation n = world.region(regionName);
            List<Object[]> births = new ArrayList<>(); // {start, end, name, parsed, params, motion, seed, birthAspects}
            for (int s = serial - STORM_LOOKBACK_DAYS; s <= serial + STORM_LOOKAHEAD_DAYS; s++) {
                Day day = computed(cache, n, s).day();
                int[] bd = WeatherService.fromSerial(s);
                List<String> birthAspects = ic.isLoaded() ? Arrays.asList(ic.getActiveAspects(bd[0], bd[1], bd[2], s)) : List.of();
                for (String ev : day.getEventList()) {
                    if (!isMagic(ev)) continue;
                    Map<String, Object> parsed = storm(ev, "", birthAspects);
                    @SuppressWarnings("unchecked") List<String> dom = (List<String>) parsed.get("dominant");
                    String ruleAspect = parsed.get("aspect") != null ? (String) parsed.get("aspect") : (dom.size() == 1 ? dom.get(0) : null);
                    StormConfig.Params pr = stormConfig.forEvent(regionName, ev, ruleAspect);
                    long seed = Math.abs((long) (regionName + "|" + ev + "|" + s).hashCode());
                    Random r = new Random(seed);
                    double start = s + r.nextDouble();                                       // forms at a random hour
                    double hours = pr.durationMin() + r.nextDouble() * (pr.durationMax() - pr.durationMin());
                    double roll = r.nextDouble() * 100;
                    double fw = Math.max(0, pr.followWind()), wd = Math.max(0, pr.wander()), tot = fw + wd;
                    if (tot > 100) { fw = fw * 100 / tot; wd = wd * 100 / tot; }
                    String motion = roll < fw ? "wind" : roll < fw + wd ? "wander" : "still";
                    births.add(new Object[]{start, start + hours / 24.0, ev, parsed, pr, motion, seed, birthAspects});
                }
            }
            births.sort(Comparator.comparingDouble(b -> (double) b[0]));
            List<Chain> chains = new ArrayList<>();
            for (Object[] b : births) {
                double start = (double) b[0], end = (double) b[1];
                String ev = (String) b[2];
                @SuppressWarnings("unchecked") Map<String, Object> parsed = (Map<String, Object>) b[3];
                StormConfig.Params pr = (StormConfig.Params) b[4];
                String identity = parsed.get("aspect") != null ? (String) parsed.get("aspect")
                        : parsed.get("force") != null ? (String) parsed.get("force") : ev.replaceAll("\\s*\\(.*", "");
                String key = parsed.get("kind") + "|" + identity;
                // influx bonus measured at the time of this pulse's peak
                double peakT = start + peakAt(pr.growth()) * (end - start);
                int pd = (int) Math.floor(peakT);
                int[] pdd = WeatherService.fromSerial(pd);
                String influxAtPeak = ic.isLoaded() ? ic.getInfluxString(pdd[0], pdd[1], pdd[2], pd) : "";
                @SuppressWarnings("unchecked") Map<String, Object> full = storm(ev, influxAtPeak, (List<String>) b[7]);
                Pulse pulse = new Pulse(ev, start, end, ((Number) full.get("strength")).intValue(),
                        ((Number) full.get("influxBoost")).intValue(), pr.growth());
                Chain alive = null;
                for (Chain c : chains) if (c.key.equals(key) && c.end > start) { alive = c; break; }
                if (alive == null) {
                    alive = new Chain(key, regionName, ev, (long) b[6], full, pr, (String) b[5]);
                    alive.start = start; alive.end = end;
                    chains.add(alive);
                } else {
                    alive.end = Math.max(alive.end, end);
                }
                alive.pulses.add(pulse);
            }
            for (Chain c : chains) {
                if (c.end <= serial || c.start >= serial + 1) continue; // not alive during this day
                out.add(stormJson(c, n, cache));
            }
        }
        return out;
    }

    private Map<String, Object> stormJson(Chain c, Nation n, Map<String, WeatherService.Computed> cache) {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("id", c.region + "#" + c.seed);
        s.put("region", c.region);
        s.put("name", c.first.get("name"));
        s.put("aspect", c.first.get("aspect"));
        s.put("force", c.first.get("force"));
        s.put("dominant", c.first.get("dominant"));
        s.put("kind", c.first.get("kind"));
        s.put("motion", c.motion);
        // Each storm's own speed in km/h, log-uniform between min and max, so the typical
        // (median) speed is the geometric mean: 5-20 km/h gives about 10 km/h.
        double sMin = c.params.speedMin(), sMax = c.params.speedMax();
        double u = new Random(c.seed * 1_000_003L + 77).nextDouble();
        double speed = sMin * Math.pow(sMax / sMin, u);
        s.put("speedKmh", Math.round(speed * 10) / 10.0);
        s.put("speedMin", sMin);
        s.put("speedMax", sMax);
        s.put("stayInRegion", c.params.stayInRegion());
        s.put("seed", c.seed);
        s.put("start", c.start);
        s.put("end", c.end);
        int peak = 0;
        List<Map<String, Object>> pulses = new ArrayList<>();
        for (Pulse p : c.pulses) {
            Map<String, Object> pm = new LinkedHashMap<>();
            pm.put("name", p.name()); pm.put("start", p.start()); pm.put("end", p.end());
            pm.put("peak", p.peak()); pm.put("influxBoost", p.boost()); pm.put("growth", p.growth());
            pulses.add(pm);
            peak = Math.max(peak, p.peak());
        }
        s.put("pulses", pulses);
        s.put("peak", peak);
        if (c.motion.equals("wind")) {
            // the home region's wind, hour by hour, for the storm's whole life
            long h0 = (long) Math.floor(c.start * 24), h1 = (long) Math.ceil(c.end * 24);
            List<String> dirs = new ArrayList<>();
            List<Double> winds = new ArrayList<>();
            for (long h = h0; h <= h1; h++) {
                int day = (int) Math.floorDiv(h, 24L), hour = (int) Math.floorMod(h, 24L);
                WeatherService.Computed comp = computed(cache, n, day);
                dirs.add(comp.day().getDirection().name());
                winds.add(Math.round(comp.hourly()[1][hour] * 10) / 10.0);
            }
            Map<String, Object> track = new LinkedHashMap<>();
            track.put("startHour", h0);
            track.put("dirs", dirs);
            track.put("winds", winds);
            s.put("track", track);
        }
        return s;
    }

    private WeatherService.Computed computed(Map<String, WeatherService.Computed> cache, Nation n, int serial) {
        return cache.computeIfAbsent(n.getName() + "|" + serial, k -> {
            int[] d = WeatherService.fromSerial(serial);
            return weather.compute(n, d[0], d[1], d[2]);
        });
    }

    // ── Clouds ───────────────────────────────────────────────────────────
    private record CloudInfo(int daily, double[] hourly, boolean fog, boolean thunder, double[] hourlyFog) {}

    /**
     * Cloud cover in percent, derived from rain, the month's wetness and events.
     * {@code cover} is the region's cloud_cover setting: each step adds about 10 points on dry
     * days (more chance of overcast) and 4 on rainy days; negative values clear the sky.
     */
    static CloudInfo cloud(Nation n, Day day, double[] hourlyRain, int serial, int cover) {
        Random rng = new Random(serial * 7919L + n.getName().hashCode() * 31L + 12345);
        int monthWet = n.getRainfall()[day.getMonth() - 1];
        boolean fog = false, thunder = false, dust = false;
        double fogThickness = 0;
        for (String e : day.getEventList()) {
            String l = e.toLowerCase(Locale.ROOT);
            if (l.contains("dimma")) { fog = true; fogThickness = Math.max(fogThickness, l.contains("tjock") ? 1.0 : 0.7); }
            if (l.contains("åska")) thunder = true;
            if (l.contains("sandstorm")) dust = true;
        }
        double base;
        if (day.getRain() > 0) base = 58 + day.getRain() * 7 + rng.nextDouble() * 10;
        else base = 8 + Math.min(monthWet, 6) * 5 + rng.nextDouble() * 50;
        base += cover * (day.getRain() > 0 ? 4 : 10);
        base = Math.max(0, base);
        if (thunder) base = Math.max(base, 85);
        if (fog) base = Math.max(base, 92);
        if (dust) base = Math.max(base, 70);
        int daily = (int) Math.round(Math.min(100, base));

        double[] hourly = new double[24];
        double c = daily + (rng.nextDouble() - 0.5) * 20;
        for (int h = 0; h < 24; h++) {
            c += (rng.nextDouble() - 0.5) * 14;          // drift
            c += (daily - c) * 0.2;                      // pulled back toward the day's value
            double v = c;
            if (hourlyRain[h] > 0.3) v = Math.max(v, 68 + hourlyRain[h] * 5);
            if (fog && (h < 10 || h > 20)) v = Math.max(v, 95); // fog sits in the cool hours
            hourly[h] = Math.max(0, Math.min(100, v));
        }
        // Mist on the map: thickest at night and in the morning, burning off towards midday
        // and settling again in the evening.
        double[] hourlyFog = new double[24];
        if (fog) for (int h = 0; h < 24; h++) {
            double f = h <= 7 || h >= 21 ? 1 : h <= 12 ? 1 - (h - 7) / 5.0 : h >= 18 ? (h - 17) / 4.0 : 0;
            hourlyFog[h] = Math.round(fogThickness * f * 100) / 100.0;
        }
        return new CloudInfo(daily, hourly, fog, thunder, hourlyFog);
    }

    // ── Magic storms ─────────────────────────────────────────────────────
    /** True for the events that make up the magic-storm layer. */
    public static boolean isMagic(String event) {
        String l = event.toLowerCase(Locale.ROOT);
        return l.contains("magistorm") || l.contains("högmagisk") || l.contains("alstra");
    }

    /** Parses an event name into a storm, or null if it is not magical. */
    static Map<String, Object> storm(String event, String influx) { return storm(event, influx, List.of()); }

    /**
     * @param activeAspects the year/month/week/day aspects of the day the storm formed
     */
    static Map<String, Object> storm(String event, String influx, List<String> activeAspects) {
        if (!isMagic(event)) return null;
        String l = event.toLowerCase(Locale.ROOT);
        String aspect = aspectOf(event);

        int strength;
        Matcher sm = STRENGTH.matcher(event), an = ASPECT_NUMBER.matcher(event), al = ALSTRA.matcher(event);
        if (sm.find()) strength = Integer.parseInt(sm.group(1));
        else if (an.find()) strength = Integer.parseInt(an.group(1));
        else if (al.find()) strength = Integer.parseInt(al.group(1)) * 2;
        else if (l.contains("magistorm")) {
            Matcher num = ANY_NUMBER.matcher(event);
            strength = 10;
            while (num.find()) strength = Integer.parseInt(num.group(1)); // last number, e.g. "Elementarkrafter 15"
        }
        else strength = 8; // Högmagisk ...

        String force = aspect != null ? FORCE_OF.get(aspect) : null;
        if (force == null) {
            Matcher fm = FORCE.matcher(event);
            if (fm.find()) force = Character.toUpperCase(fm.group(1).charAt(0)) + fm.group(1).substring(1).toLowerCase(Locale.ROOT);
        }

        // An influx on the storm's aspect (or any aspect of its force) feeds it.
        int boost = 0;
        if (influx != null && !influx.isBlank()) {
            Matcher im = Pattern.compile("(\\p{L}+)\\s*\\+(\\d+)").matcher(influx);
            while (im.find()) {
                String a = im.group(1);
                boolean match = a.equalsIgnoreCase(aspect != null ? aspect : "")
                        || (aspect == null && force != null && force.equals(FORCE_OF.get(a)));
                if (match) boost = Math.max(boost, Integer.parseInt(im.group(2)));
            }
        }

        Map<String, Object> s = new LinkedHashMap<>();
        s.put("name", event);
        s.put("aspect", aspect);
        s.put("force", force);
        s.put("dominant", dominantAspects(aspect, force, activeAspects));
        s.put("strength", strength + boost);
        s.put("influxBoost", boost);
        s.put("kind", l.contains("magistorm") ? "storm" : "surge");
        s.put("lifetime", l.contains("magistorm") ? 2 + Math.min(strength, 20) / 10 : 1);
        return s;
    }

    /** All aspects of a force, in the canonical order. */
    public static List<String> aspectsOf(String force) {
        List<String> out = new ArrayList<>();
        for (String a : ASPECT_ORDER) if (force != null && force.equals(FORCE_OF.get(a))) out.add(a);
        return out;
    }

    static final List<String> ASPECT_ORDER = List.of(
            "Kronotropi", "Nomotropi", "Ataxatropi", "Topotropi",
            "Termotropi", "Kryotropi", "Fototropi", "Skototropi",
            "Pyrotropi", "Geotropi", "Pneumotropi", "Hydrotropi",
            "Biotropi", "Nekrotropi",
            "Heliotropi", "Selenotropi", "Astrotropi", "Kosmotropi",
            "Ikonotropi", "Semotropi",
            "Teotropi", "Psykotropi", "Daimotropi", "Oneirotropi");
    static final List<String> FORCE_ORDER = List.of(
            "Grundkrafter", "Primalkrafter", "Elementarkrafter", "Livskrafter", "Himlakrafter", "Symbolkrafter", "Själakrafter");

    /**
     * The aspect(s) that dominate a storm, used to pick its symbol:
     *  - the storm names an aspect ("Kryotropisk Magistorm")       → that aspect
     *  - the storm names a force ("Magistorm (Elementarkrafter)")  → the force's aspects that rule the day
     *    most often (year/month/week/day cycle); several if tied; none if no aspect of the force rules
     *  - the storm names neither                                   → the day's influx aspect(s), i.e. an
     *    aspect ruling at least two of the cycles; none otherwise
     */
    static List<String> dominantAspects(String aspect, String force, List<String> active) {
        if (aspect != null) return List.of(aspect);
        List<String> candidates = force != null ? aspectsOf(force) : ASPECT_ORDER;
        Map<String, Integer> count = new LinkedHashMap<>();
        for (String a : active) if (candidates.contains(a)) count.merge(a, 1, Integer::sum);
        int max = count.values().stream().max(Integer::compare).orElse(0);
        int needed = force != null ? 1 : 2;
        if (max < needed) return List.of();
        List<String> out = new ArrayList<>();
        for (Map.Entry<String, Integer> e : count.entrySet()) if (e.getValue() == max) out.add(e.getKey());
        return out;
    }

    static String aspectOf(String event) {
        Matcher m = ASPECT.matcher(event);
        while (m.find()) {
            String a = m.group(1);
            a = Character.toUpperCase(a.charAt(0)) + a.substring(1).toLowerCase(Locale.ROOT);
            if (a.equals("Pneutropi")) a = "Pneumotropi";
            return a;
        }
        return null;
    }
}
