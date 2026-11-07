package context;

/**
 * Represents a single named date for a religion.
 * Can be a fixed date, a repeating interval in days, or a repeating interval in months.
 *
 * Fixed:          month + day set, no repeat fields
 * repeat_days:    repeats every N days from anchor (start_month, start_day)
 * repeat_months:  repeats on the same day-of-month every N months from anchor month
 */
public class ReligiousDate {
    public enum Tier { HOLIEST, HOLY, UNHOLY, UNHOLIEST }

    public final String religion;
    public final String name;
    public final Tier tier;

    // Fixed date (used when no repeat)
    public final int month;
    public final int day;

    // Repeat fields (0 = not used)
    public final int repeatDays;
    public final int repeatMonths;

    // Anchor for repeat calculation
    public final int startMonth;
    public final int startDay;

    public ReligiousDate(String religion, String name, Tier tier,
                         int month, int day,
                         int repeatDays, int repeatMonths,
                         int startMonth, int startDay) {
        this.religion     = religion;
        this.name         = name;
        this.tier         = tier;
        this.month        = month;
        this.day          = day;
        this.repeatDays   = repeatDays;
        this.repeatMonths = repeatMonths;
        this.startMonth   = startMonth;
        this.startDay     = startDay;
    }

    public boolean matches(int year, int month, int day) {
        if (repeatDays > 0) {
            // Calculate total days from anchor and check if divisible by repeatDays
            int anchorTotal = dayOfYear(year, startMonth, startDay);
            int currentTotal = dayOfYear(year, month, day);
            int diff = currentTotal - anchorTotal;
            return diff >= 0 && diff % repeatDays == 0;
        } else if (repeatMonths > 0) {
            // Same day-of-month, every N months from anchor
            int anchorMonthTotal = (year - 1) * 12 + (startMonth - 1);
            int currentMonthTotal = (year - 1) * 12 + (month - 1);
            int diff = currentMonthTotal - anchorMonthTotal;
            return day == startDay && diff >= 0 && diff % repeatMonths == 0;
        } else {
            // Fixed date
            return this.month == month && this.day == day;
        }
    }

    /** Convert year/month/day to an absolute day count (28-day months, 12 months). */
    private int dayOfYear(int year, int month, int day) {
        return (year - 1) * 12 * 28 + (month - 1) * 28 + day;
    }
}
