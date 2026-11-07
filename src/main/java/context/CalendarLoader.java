package context;

import org.yaml.snakeyaml.Yaml;

import date.Calendar;
import weather.weatherCalculator;

import java.io.*;
import java.util.*;

/**
 * Loads calendar definitions from src/data/eon.yaml.
 */
public class CalendarLoader {

    @SuppressWarnings("unchecked")
    public static List<Calendar> load(String basePath, weatherCalculator calculator) {
        String path = basePath;
        File file   = new File(path);
        List<Calendar> result = new ArrayList<>();

        if (!file.exists()) {
            Logger.log(LogLevel.WARNING, 1, "eon.yaml not found at: " + path);
            return result;
        }

        try (FileInputStream fis = new FileInputStream(file)) {
            Yaml yaml = new Yaml();
            Map<String, Object> root = yaml.load(fis);

            List<Map<String, Object>> calendars =
                (List<Map<String, Object>>) root.get("calendar");

            if (calendars == null) {
                Logger.log(LogLevel.INFO, 1, "No 'calendar' block in eon.yaml.");
                return result;
            }

            for (Map<String, Object> cal : calendars) {
                String calName  = (String) cal.get("name");
                int epochOffset = cal.containsKey("offset")
                                  ? ((Number) cal.get("offset")).intValue() : 0;

                List<Map<String, Object>> divisions =
                    (List<Map<String, Object>>) cal.get("division");

                String[] divNames = new String[divisions.size()];
                int[]    config   = new int[divisions.size()];

                for (int i = 0; i < divisions.size(); i++) {
                    Map<String, Object> div = divisions.get(i);
                    divNames[i] = (String) div.get("name");
                    // First division uses "days" (total days per year)
                    // Subsequent divisions use "count" (number of subdivisions)
                    if (div.containsKey("days"))
                        config[i] = ((Number) div.get("days")).intValue();
                    else
                        config[i] = ((Number) div.get("count")).intValue();
                }

                Calendar c = Calendar.fromConfig(calculator, calName,
                                                 divNames, config, epochOffset);
                result.add(c);
                Logger.log(LogLevel.INFO, 2, "Loaded calendar: " + calName
                    + " (offset=" + epochOffset + ", divisions=" + divisions.size() + ")");
            }

        } catch (IOException e) {
            Logger.log(LogLevel.WARNING, 1, "Error loading eon.yaml: " + e.getMessage());
            e.printStackTrace();
        }

        Logger.log(LogLevel.INFO, 1, "Loaded " + result.size() + " calendars.");
        return result;
    }
}
