package context;

import org.yaml.snakeyaml.Yaml;

import java.io.*;
import java.util.*;

/**
 * Loads the four influx aspect lists from src/data/influx.yaml.
 */
public class InfluxLoader {

    @SuppressWarnings("unchecked")
    public static String[][] load(String basePath) {
        String path = basePath;
        File file = new File(path);

        if (!file.exists()) {
            Logger.log(LogLevel.WARNING, 1, "influx.yaml not found at: " + path);
            return new String[4][0];
        }

        try (FileInputStream fis = new FileInputStream(file)) {
            Yaml yaml = new Yaml();
            Map<String, Object> root = yaml.load(fis);

            String[] year  = toArray((List<String>) root.get("year"));
            String[] month = toArray((List<String>) root.get("month"));
            String[] week  = toArray((List<String>) root.get("week"));
            String[] day   = toArray((List<String>) root.get("day"));

            Logger.log(LogLevel.INFO, 1, "Loaded influx lists: year=" + year.length
                + " month=" + month.length + " week=" + week.length + " day=" + day.length);

            return new String[][]{ year, month, week, day };

        } catch (IOException e) {
            Logger.log(LogLevel.WARNING, 1, "Error loading influx.yaml: " + e.getMessage());
            return new String[4][0];
        }
    }

    private static String[] toArray(List<String> list) {
        if (list == null) return new String[0];
        return list.toArray(new String[0]);
    }
}