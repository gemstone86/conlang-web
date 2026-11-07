package com.eonweather.core;

import date.Calendar;
import date.Day;
import date.InfluxCalculator;
import gui.Localization;
import weather.Nation;
import weather.weatherCalculator;

import java.util.*;

/** Weather for one region: a single day (with hourly curves) or a whole month. */
public final class WeatherService {
    public static final int DAYS_PER_MONTH = 28, MONTHS_PER_YEAR = 12, DAYS_PER_YEAR = 336;

    private static final String[] WIND_SV = {
            "Stiltje", "Nästan stiltje", "Lätt bris", "God bris", "Frisk bris", "Styv bris", "Hård bris",
            "Styv kuling", "Hård kuling", "Halv storm", "Storm", "Svår storm", "Lätt orkan", "Orkan",
            "Svår orkan", "Extrem orkan", "Extrem orkan", "Extrem orkan"};
    private static final String[] WIND_EN = {
            "Calm", "Light air", "Light breeze", "Gentle breeze", "Moderate breeze", "Fresh breeze",
            "Strong breeze", "Near gale", "Gale", "Strong gale", "Storm", "Violent storm", "Light hurricane",
            "Hurricane", "Severe hurricane", "Extreme hurricane", "Extreme hurricane", "Extreme hurricane"};
    private static final String[] WIND_MS = {
            "0–0.2", "0.3–1.5", "1.6–3.3", "3.4–5.4", "5.5–7.9", "8.0–10.7", "10.8–13.8", "13.9–17.1",
            "17.2–20.7", "20.8–24.4", "24.5–28.4", "28.5–32.6", "32.7–36.9", "37.0–41.4", "41.5–46.1",
            "46.2–50.9", "51.0–56.0", "56.1–61.2"};
    private static final String[] RAIN_SV = {
            "Ingen nederbörd", "Enstaka droppar/snöflingor", "Duggregn/lätt snöfall", "Lätt regn/snöfall",
            "Regn/snöfall", "Tungt regn/snöfall", "Hällregn/snöstorm"};
    private static final String[] RAIN_EN = {
            "No precipitation", "Scattered drops/flakes", "Drizzle/light snow", "Light rain/snow",
            "Rain/snow", "Heavy rain/snow", "Downpour/blizzard"};

    private final World world;

    public WeatherService(World world) { this.world = world; }

    // ── Dates ────────────────────────────────────────────────────────────
    public static int serial(int y, int m, int d) { return (y - 1) * DAYS_PER_YEAR + (m - 1) * DAYS_PER_MONTH + d; }

    public static int[] fromSerial(int serial) {
        int s = serial - 1;
        int y = Math.floorDiv(s, DAYS_PER_YEAR) + 1;
        int r = Math.floorMod(s, DAYS_PER_YEAR);
        return new int[]{y, r / DAYS_PER_MONTH + 1, r % DAYS_PER_MONTH + 1};
    }

    public static void checkDate(int y, int m, int d) {
        if (y < -20000 || y > 20000) throw new ApiException(400, "Year out of range");
        if (m < 1 || m > 12) throw new ApiException(400, "Month must be 1–12");
        if (d < 1 || d > 28) throw new ApiException(400, "Day must be 1–28");
    }

    public static String windName(int w, String lang) {
        String[] n = "EN".equalsIgnoreCase(lang) ? WIND_EN : WIND_SV;
        return n[Math.max(0, Math.min(w, n.length - 1))];
    }

    public static String windMs(int w) { return WIND_MS[Math.max(0, Math.min(w, WIND_MS.length - 1))]; }

    public static String rainName(int r, String lang) {
        String[] n = "EN".equalsIgnoreCase(lang) ? RAIN_EN : RAIN_SV;
        return n[Math.max(0, Math.min(r, n.length - 1))];
    }

    // ── Weather ──────────────────────────────────────────────────────────
    /** Raw engine result for one region/day plus its hourly curves (temps, winds, rains). */
    public record Computed(Day day, double[][] hourly) {}

    public Computed compute(Nation n, int y, int m, int d) {
        weatherCalculator c = world.newCalculator();
        Day day = c.getWeather(y, m, d, n);
        double[][] hourly = c.getHourlyWeather(y, m, d, n, day);
        return new Computed(day, hourly);
    }

    public Map<String, Object> day(String region, int y, int m, int d, String lang) {
        checkDate(y, m, d);
        Localization.setLangFromString(lang);
        Nation n = world.region(region);
        Computed comp = compute(n, y, m, d);
        Day day = comp.day();
        int serial = serial(y, m, d);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("region", n.getName());
        out.put("year", y); out.put("month", m); out.put("day", d);
        out.put("serial", serial);
        out.put("temperature", day.getTemperature());
        out.put("wind", day.getWindStrength());
        out.put("windName", windName(day.getWindStrength(), lang));
        out.put("windMs", windMs(day.getWindStrength()));
        out.put("direction", day.getDirection().name());
        out.put("rain", day.getRain());
        out.put("rainName", rainName(day.getRain(), lang));
        out.put("events", day.getEventList());

        InfluxCalculator ic = new InfluxCalculator(influxLists());
        String influx = ic.isLoaded() ? ic.getInfluxString(y, m, d, serial) : "";
        out.put("influx", influx);
        out.put("aspects", ic.isLoaded() ? Arrays.asList(ic.getActiveAspects(y, m, d, serial)) : List.of());

        List<Map<String, Object>> dates = new ArrayList<>();
        for (Calendar cal : world.calendars()) {
            Map<String, Object> e = new LinkedHashMap<>();
            e.put("calendar", cal.getName());
            e.put("text", cal.toString(serial, influx));
            dates.add(e);
        }
        out.put("dates", dates);

        Map<String, Object> hourly = new LinkedHashMap<>();
        hourly.put("temperature", comp.hourly()[0]);
        hourly.put("wind", comp.hourly()[1]);
        hourly.put("rain", comp.hourly()[2]);
        out.put("hourly", hourly);
        return out;
    }

    /** Compact summary of all 28 days in a month, for the calendar grid. */
    public List<Map<String, Object>> month(String region, int y, int m, String lang) {
        checkDate(y, m, 1);
        Localization.setLangFromString(lang);
        Nation n = world.region(region);
        List<Map<String, Object>> days = new ArrayList<>();
        for (int d = 1; d <= DAYS_PER_MONTH; d++) {
            Day day = world.newCalculator().getWeather(y, m, d, n);
            Map<String, Object> e = new LinkedHashMap<>();
            e.put("day", d);
            e.put("temperature", day.getTemperature());
            e.put("wind", day.getWindStrength());
            e.put("rain", day.getRain());
            e.put("events", day.getEventList());
            days.add(e);
        }
        return days;
    }

    private String[][] influxLists() { return world.influxLists(); }
}
