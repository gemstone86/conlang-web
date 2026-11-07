package context;

import org.yaml.snakeyaml.Yaml;

import java.io.*;
import java.util.*;

/**
 * Loads religious important dates from important_dates.yaml.
 */
public class ImportantDatesLoader {

    @SuppressWarnings("unchecked")
    public static List<ReligiousDate> load(String basePath) {
        String path = basePath;
        File file = new File(path);
        List<ReligiousDate> result = new ArrayList<>();

        if (!file.exists()) {
            Logger.log(LogLevel.INFO, 1, "No important_dates.yaml found — skipping.");
            return result;
        }

        try (FileInputStream fis = new FileInputStream(file)) {
            Yaml yaml = new Yaml();
            Map<String, Object> data = yaml.load(fis);
            List<Map<String, Object>> religions = (List<Map<String, Object>>) data.get("religions");

            for (Map<String, Object> religion : religions) {
                String religionName = (String) religion.get("name");
                loadSingle(result, religionName, religion, "holiest",   ReligiousDate.Tier.HOLIEST);
                loadSingle(result, religionName, religion, "unholiest", ReligiousDate.Tier.UNHOLIEST);
                loadList  (result, religionName, religion, "holy_days",   ReligiousDate.Tier.HOLY);
                loadList  (result, religionName, religion, "unholy_days", ReligiousDate.Tier.UNHOLY);
            }

            Logger.log(LogLevel.INFO, 1, "Loaded " + result.size() + " important dates.");
        } catch (IOException e) {
            Logger.log(LogLevel.WARNING, 1, "Error loading important_dates.yaml: " + e.getMessage());
            e.printStackTrace();
        }

        return result;
    }

    @SuppressWarnings("unchecked")
    private static void loadSingle(List<ReligiousDate> result, String religion,
                                   Map<String, Object> data, String key, ReligiousDate.Tier tier) {
        if (!data.containsKey(key)) return;
        ReligiousDate rd = parseEntry(religion, (Map<String, Object>) data.get(key), tier);
        if (rd != null) result.add(rd);
    }

    @SuppressWarnings("unchecked")
    private static void loadList(List<ReligiousDate> result, String religion,
                                 Map<String, Object> data, String key, ReligiousDate.Tier tier) {
        if (!data.containsKey(key)) return;
        for (Map<String, Object> entry : (List<Map<String, Object>>) data.get(key)) {
            ReligiousDate rd = parseEntry(religion, entry, tier);
            if (rd != null) result.add(rd);
        }
    }

    private static ReligiousDate parseEntry(String religion, Map<String, Object> entry, ReligiousDate.Tier tier) {
        try {
            String name        = (String) entry.get("name");
            int repeatDays     = getInt(entry, "repeat_days",   0);
            int repeatMonths   = getInt(entry, "repeat_months", 0);

            // For repeating dates, anchor is defined by start_month + start_day
            // For fixed dates, month + day are used directly
            int month      = getInt(entry, "month",       0);
            int day        = getInt(entry, "day",         1);
            int startMonth = getInt(entry, "start_month", month);
            int startDay   = getInt(entry, "start_day",   day);

            String desc = repeatDays > 0   ? "every " + repeatDays + " days from " + startMonth + "-" + startDay
                        : repeatMonths > 0 ? "every " + repeatMonths + " months on day " + startDay
                        : "fixed " + month + "-" + day;
            Logger.log(LogLevel.INFO, 2, "  " + religion + " [" + tier + "] " + name + " (" + desc + ")");

            return new ReligiousDate(religion, name, tier,
                    month, day, repeatDays, repeatMonths, startMonth, startDay);
        } catch (Exception e) {
            Logger.log(LogLevel.WARNING, 1, "Could not parse date entry for " + religion + ": " + e.getMessage());
            return null;
        }
    }

    private static int getInt(Map<String, Object> map, String key, int defaultVal) {
        Object val = map.get(key);
        if (val == null) return defaultVal;
        try { return Integer.parseInt(val.toString().trim()); }
        catch (NumberFormatException e) { return defaultVal; }
    }
}
