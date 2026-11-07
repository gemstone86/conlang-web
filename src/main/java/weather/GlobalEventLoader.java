package weather;

import org.yaml.snakeyaml.Yaml;

import context.LogLevel;
import context.Logger;

import java.io.*;
import java.util.*;

/**
 * Loads global events from additional-events.yaml
 */
public class GlobalEventLoader {

    @SuppressWarnings("unchecked")
    public static List<GlobalEvent> load(String basePath) {
        String path = basePath;
        File file = new File(path);
        List<GlobalEvent> result = new ArrayList<>();

        if (!file.exists()) {
            Logger.log(LogLevel.WARNING, 1, "No additional-events.yaml found at " + path);
            return result;
        }

        try (FileInputStream fis = new FileInputStream(file)) {
            Yaml yaml = new Yaml();
            Map<String, Object> data = yaml.load(fis);
            Logger.log(LogLevel.INFO, 1, "Additional-events path is: " + path);
            List<Map<String, Object>> events = (List<Map<String, Object>>) data.get("events");

            for (Map<String, Object> e : events) {
                String name    = (String) e.get("name");
                int occurs     = getInt(e, "occurs", 1);
                int days       = getInt(e, "days", 365);
                int startMonth = getInt(e, "start_month", 0);
                int endMonth   = getInt(e, "end_month", 13);
                int minWind    = getInt(e, "min_wind", 0);
                int maxWind    = getInt(e, "max_wind", 999);
                double minTemperature = getInt(e, "min_temp", -999);
                double maxTemperature = getInt(e, "max_temp", 999);
                int bonusWind  = getInt(e, "bonus_wind", 0);
                int bonusTemp  = getInt(e, "bonus_temp", 0);
                int bonusRain  = getInt(e, "bonus_rain", 0);

                // Load optional variant list
                List<String> variants = new ArrayList<>();
                Object listField = e.get("list");
                if (listField instanceof List) {
                    for (Object item : (List<?>) listField) {
                        if (item != null) variants.add(item.toString().trim());
                    }
                }

                result.add(new GlobalEvent(name, variants, occurs, days,
                        startMonth, endMonth, minWind, maxWind,
                        bonusWind, bonusTemp, bonusRain, minTemperature, maxTemperature));

                if (variants.isEmpty()) {
                    Logger.log(LogLevel.INFO, 1, "\t" + name + ": " + occurs + " of " + days);
                } else {
                    Logger.log(LogLevel.INFO, 1, "\t" + name + " (" + variants.size() + " variants): " + occurs + " of " + days);
                }
            }

        } catch (IOException e) {
            Logger.log(LogLevel.WARNING, 1, "Error loading additional-events.yaml: " + e.getMessage());
            e.printStackTrace();
        }

        Logger.log(LogLevel.INFO, 1, "Loaded " + result.size() + " global events.");
        return result;
    }

    private static int getInt(Map<String, Object> map, String key, int defaultVal) {
        Object val = map.get(key);
        if (val == null) return defaultVal;
        return (int) val;
    }
}
