package context;

import org.yaml.snakeyaml.Yaml;
import weather.GlobalEvent;
import weather.Nation;

import java.io.*;
import java.text.DecimalFormat;
import java.util.*;

public class fileHandler {
    String basePath;

    public String getBasePath() { return basePath; }
    BufferedWriter bufferedWriter;
    LinkedList<Nation> listOfNations = new LinkedList<Nation>();

    public fileHandler(String Path) {
        this.basePath = Path;
        Logger.log(LogLevel.INFO, 2, "Path is: " + basePath);
        initializeDataFiles();
    }

    @SuppressWarnings("unchecked")
    public Nation readYamlFile(String path) {
        File file = new File(path);
        try (FileInputStream fis = new FileInputStream(file)) {
            Yaml yaml = new Yaml();
            Map<String, Object> data = yaml.load(fis);

            String nationName = (String) data.get("name");

            Map<String, Integer> tempMap = (Map<String, Integer>) data.get("temperature");
            int[] temperature = mapToMonthArray(tempMap);

            Map<String, Integer> rainMap = (Map<String, Integer>) data.get("precipitation");
            int[] rainfall = mapToMonthArray(rainMap);

            int shift = data.containsKey("shift") ? (int) data.get("shift") : 0;
            int temperatureDrop = data.containsKey("temperature_drop") ? (int) data.get("temperature_drop") : 0;
            double dropSpeed = data.containsKey("drop_speed") ? ((Number) data.get("drop_speed")).doubleValue() : 0.0;

            Map<String, Integer> windMap = (Map<String, Integer>) data.get("wind");
            int[] windStrength = mapToMonthArray(windMap);

            // Events — full GlobalEvent format, all fields optional
            LinkedList<GlobalEvent> events = new LinkedList<>();
            if (data.containsKey("events")) {
                List<Map<String, Object>> eventList = (List<Map<String, Object>>) data.get("events");
                for (Map<String, Object> e : eventList) {
                    String name    = (String) e.get("name");
                    int occurs     = getInt(e, "occurs", 1);
                    int days       = getInt(e, "days", 365);
                    int startMonth = getInt(e, "start_month", 0);
                    int endMonth   = getInt(e, "end_month", 0);
                    int minWind    = getInt(e, "min_wind", 0);
                    int maxWind    = getInt(e, "max_wind", 999);
                    int bonusWind  = getInt(e, "bonus_wind", 0);
                    int bonusTemp  = getInt(e, "bonus_temp", 0);
                    int bonusRain  = getInt(e, "bonus_rain", 0);
                    double minTemp = getInt(e, "min_temp", -999);
                    double maxTemp = getInt(e, "max_temp", 999);
                    List<String> variants = new ArrayList<>();
                    Object listField = e.get("list");
                    if (listField instanceof List) {
                        for (Object item : (List<?>) listField)
                            if (item != null) variants.add(item.toString().trim());
                    }
                    events.add(new GlobalEvent(name, variants, occurs, days,
                            startMonth, endMonth, minWind, maxWind,
                            bonusWind, bonusTemp, bonusRain, minTemp, maxTemp));
                }
            }

            Nation nation = new Nation(nationName, temperature, rainfall, shift, windStrength, events, temperatureDrop, dropSpeed);
            // WEB CHANGE: optional prevailing wind, e.g. "prevailing_wind: SW" and "prevailing_chance: 50"
            Object pw = data.get("prevailing_wind");
            if (pw != null) {
                try {
                    weather.direction d = weather.direction.valueOf(pw.toString().trim().toUpperCase());
                    nation.setPrevailingWind(d, getInt(data, "prevailing_chance", 50));
                } catch (IllegalArgumentException ex) {
                    System.out.println("Unknown prevailing_wind '" + pw + "' in " + path + " (use N, NE, E, SE, S, SW, W or NW)");
                }
            }
            return nation;

        } catch (IOException e) {
            System.out.println("Couldn't read YAML file: " + path);
            e.printStackTrace();
        }
        return null;
    }

    private static int getInt(Map<String, Object> map, String key, int defaultVal) {
        Object val = map.get(key);
        if (val == null) return defaultVal;
        return (int) val;
    }

    private int[] mapToMonthArray(Map<String, Integer> map) {
        String[] keys = {"jan", "feb", "mar", "apr", "may", "jun",
                         "jul", "aug", "sep", "oct", "nov", "dec"};
        int[] arr = new int[12];
        for (int i = 0; i < 12; i++)
            arr[i] = map.getOrDefault(keys[i], 0);
        return arr;
    }

    public void initializeDataFiles() {
        String folderPath = basePath;
        File folder = new File(folderPath);
        File[] files = folder.listFiles((dir, name) -> name.endsWith(".yaml"));

        if (files == null || files.length == 0) {
            System.out.println("No YAML files found in " + folderPath);
            return;
        }

        for (File f : files) {
            Logger.log(LogLevel.INFO, 3, "Loading: " + f.getName());
            Nation nd = readYamlFile(f.getAbsolutePath());
            if (nd != null) listOfNations.add(nd);
        }
    }

    public String[] getListOfNations() {
        String[] list = new String[listOfNations.size()];
        for (int i = 0; i < listOfNations.size(); i++)
            list[i] = listOfNations.get(i).getName();
        return list;
    }

    public Nation getNation(String nation) {
        for (int i = 0; i < listOfNations.size(); i++)
            if (listOfNations.get(i).getName().equals(nation))
                return listOfNations.get(i);
        System.out.println("Couldn't find area: " + nation);
        return null;
    }

    public int[] getTemperatures(String Name) {
        for (int i = 0; i < listOfNations.size(); i++)
            if (listOfNations.get(i).getName().equals(Name))
                return listOfNations.get(i).getTemperature();
        return null;
    }

    public int[] getWindStrength(String Name) {
        for (int i = 0; i < listOfNations.size(); i++)
            if (listOfNations.get(i).getName().equals(Name))
                return listOfNations.get(i).getWindStrength();
        return null;
    }

    public void addToFile(String add, boolean linebreak) {
        try {
            bufferedWriter.write(add);
            if (linebreak) bufferedWriter.write(System.lineSeparator());
        } catch (IOException e) { e.printStackTrace(); }
    }

    public void createWeatherFile(String name, int from, int to) {
        try {
            File file = new File(basePath + " " + name + " (" + from + " to " + (to - 1) + ").txt");
            if (!file.exists()) file.createNewFile();
            bufferedWriter = new BufferedWriter(new FileWriter(file.getAbsoluteFile()));
        } catch (IOException e) {
            System.out.println("Couldn't create weather file at " + basePath);
            e.printStackTrace();
        }
    }

    public void closeWeatherFile() {
        try { bufferedWriter.close(); } catch (IOException e) { e.printStackTrace(); }
    }

    public String printHeader() {
        return "Year\tMonth\tDay\tWind\tTemperature\tRainfall\tOther\n";
    }

    public String printData(int Year, int Month, int Day, int Wind, double temp, int Rainfall, String Other) {
        DecimalFormat df = new DecimalFormat("##.#");
        return Year + "\t" + Month + "\t" + Day + "\t" + Wind + "\t" + df.format(temp) + " C\t\t" + Rainfall + "\t\t" + Other + "\n";
    }

    public String[] getTemperaturesAsString(String Name) {
        String[] temp = new String[12];
        for (int i = 0; i < listOfNations.size(); i++)
            if (listOfNations.get(i).getName().equals(Name)) {
                for (int j = 0; j < 12; j++)
                    temp[j] = Integer.toString(listOfNations.get(i).getTemperature(j));
                return temp;
            }
        return null;
    }
}