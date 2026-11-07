package date;

import gui.Localization;
import weather.weatherCalculator;

public class Calendar {

    private weatherCalculator calculator;
    private int[] config;      // e.g. {336, 12, 28} as input
    private int[] unitSize;    // e.g. {336, 28, 1} — days per unit at each level
    private int epochOffset;
    private String name;
    private String[] unitNames;

    public Calendar(weatherCalculator calculator, int[] config, int epochOffset) {
        this.calculator = calculator;
        this.config = config;
        this.epochOffset = epochOffset;

        unitSize = new int[config.length];
        unitSize[0] = config[0];
        for (int i = 1; i < config.length; i++) {
            unitSize[i] = unitSize[i - 1] / config[i];
        }
    }

    public Calendar(weatherCalculator calculator, String name,
        String[] unitNames, int[] unitSize, int epochOffset) {
        this.calculator  = calculator;
        this.name        = name;
        this.unitNames   = unitNames;
        this.unitSize    = unitSize;
        this.epochOffset = epochOffset;
    }

    public static Calendar fromConfig(weatherCalculator calc, String name,
        String[] divNames, int[] config, int epochOffset) {
        int[] sizes = new int[config.length];
        sizes[0] = config[0];
        for (int i = 1; i < config.length; i++) {
            sizes[i] = sizes[i - 1] / config[i];
        }
        return new Calendar(calc, name, divNames, sizes, epochOffset);
    }

    public int[] toDate(int serial) {
        int adjusted = serial + epochOffset;
        int[] date = new int[unitSize.length];
        int remaining = adjusted - 1;
        for (int i = 0; i < unitSize.length; i++) {
            date[i] = remaining / unitSize[i] + 1;
            remaining = remaining % unitSize[i];
        }
        return date;
    }

    public String getMoonPhase(int serial) {
        int phase = ((serial - 1) % 28) / 7 + 1;
        switch (phase) {
            case 1: return Localization.get("moon.phase.1");
            case 2: return Localization.get("moon.phase.2");
            case 3: return Localization.get("moon.phase.3");
            case 4: return Localization.get("moon.phase.4");
            default: return Localization.get("moon.phase.0");
        }
    }

    /** Formats the date without influx. */
    public String toString(int serial) {
        return toString(serial, "");
    }

    /** Formats the date with an optional influx string appended inside the parentheses. */
    public String toString(int serial, String influx) {
        int[] date = toDate(serial);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < date.length; i++) {
            if (i > 0) sb.append("-");
            sb.append(date[i]);
        }
        String paren = getDayName(getDayFromSerial(serial)) + ", " + getMoonPhase(serial);
        if (influx != null && !influx.isBlank())
            paren += ", " + influx;
        sb.append(" (").append(paren).append(")");
        return sb.toString();
    }

    public String getDayName(int i) {
        return Localization.get("day." + ((i % 7) + 1));
    }

    public String getDayNameFromSerial(int serial) {
        int day = toDate(serial)[config.length - 1];
        return Localization.get("day." + (((day - 1) % 7) + 1));
    }

    public int getDayFromSerial(int serial) {
        return (((serial - 1) % 7) + 1);
    }

    public String getName() {
        return name;
    }
}