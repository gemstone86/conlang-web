package date;

import java.util.*;

/**
 * Calculates influx aspects for a given date.
 *
 * Cycle rules:
 *   Year:  16-entry list. Cycle 0 = year -7032. Index = (year + 7032 - 1) % 16
 *   Month: 12-entry list. Repeats every year.   Index = month - 1
 *   Week:  4-entry list.  One per week of month. Index = (day - 1) / 7
 *   Day:   7-entry list.  Fixed per day of week. Index = (serial - 1) % 7
 *
 * Bonus:
 *   2 matching aspects → +3
 *   3 matching aspects → +6
 *   4 matching aspects → +9
 *   (each additional match adds +3)
 */
public class InfluxCalculator {

    private static final int YEAR_CYCLE_OFFSET = 7032; // year + 7032 - 1 gives 0-based cycle index
    private static final int BONUS_PER_EXTRA   = 3;

    private final String[] yearAspects;
    private final String[] monthAspects;
    private final String[] weekAspects;
    private final String[] dayAspects;

    public InfluxCalculator(String[][] lists) {
        this.yearAspects  = lists[0];
        this.monthAspects = lists[1];
        this.weekAspects  = lists[2];
        this.dayAspects   = lists[3];
    }

    /** Returns true if aspect lists are loaded and non-empty. */
    public boolean isLoaded() {
        return yearAspects.length > 0 && monthAspects.length > 0
            && weekAspects.length > 0 && dayAspects.length > 0;
    }

    /**
     * Returns the influx display string for the given date, e.g. "Skototropi +3",
     * or empty string if no duplicate aspects exist.
     *
     * @param year   calendar year (1-indexed)
     * @param month  month (1-12)
     * @param day    day of month (1-28)
     * @param serial absolute day serial (used to determine day-of-week)
     */
    public String getInfluxString(int year, int month, int day, int serial) {
        if (!isLoaded()) return "";

        String yearAspect  = yearAspects [(year + YEAR_CYCLE_OFFSET - 1) % yearAspects.length];
        String monthAspect = monthAspects[(month - 1) % monthAspects.length];
        String weekAspect  = weekAspects [((day - 1) / 7) % weekAspects.length];
        String dayAspect   = dayAspects  [((serial - 1) % 7 + 7) % 7 % dayAspects.length];

        // Count occurrences of each aspect
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (String a : new String[]{yearAspect, monthAspect, weekAspect, dayAspect}) {
            counts.put(a, counts.getOrDefault(a, 0) + 1);
        }

        // Build result — only report aspects that appear more than once
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, Integer> e : counts.entrySet()) {
            if (e.getValue() > 1) {
                int bonus = (e.getValue() - 1) * BONUS_PER_EXTRA;
                if (sb.length() > 0) sb.append(", ");
                sb.append(e.getKey()).append(" +").append(bonus);
            }
        }
        return sb.toString();
    }

    /** Returns all four active aspects for the date (for debugging/tooltips). */
    public String[] getActiveAspects(int year, int month, int day, int serial) {
        if (!isLoaded()) return new String[0];
        return new String[]{
            yearAspects [(year + YEAR_CYCLE_OFFSET - 1) % yearAspects.length],
            monthAspects[(month - 1) % monthAspects.length],
            weekAspects [((day - 1) / 7) % weekAspects.length],
            dayAspects  [((serial - 1) % 7 + 7) % 7 % dayAspects.length]
        };
    }
}