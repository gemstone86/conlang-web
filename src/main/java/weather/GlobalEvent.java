package weather;

import java.util.List;

import context.LogLevel;
import context.Logger;

import java.util.ArrayList;

/**
 * Represents a global event that can happen in any region.
 * Conditions (start_month, end_month, min_wind, max_wind) are optional.
 * Bonus fields affect weather calculation for that day.
 * Optional 'list' field provides named variants — one is picked randomly when the event triggers.
 */
public class GlobalEvent {
    private String name;
    private List<String> variants; // optional — if set, result is "Name (Variant)"
    private int occurs;
    private int days;

    // Conditions (defaults = no restriction)
    private int startMonth;
    private int endMonth;
    private int minWind;
    private int maxWind;
    private double minTemperature;
    private double maxTemperature;

    // Bonuses applied when event triggers
    private int bonusWind;
    private int bonusTemp;
    private int bonusRain;

    public GlobalEvent(String name, List<String> variants, int occurs, int days,
                       int startMonth, int endMonth,
                       int minWind, int maxWind,
                       int bonusWind, int bonusTemp, int bonusRain, double minTemperature, double maxTemperature) {
        this.name       = name;
        this.variants   = variants != null ? variants : new ArrayList<>();
        this.occurs     = occurs;
        this.days       = days;
        this.startMonth = startMonth;
        this.endMonth   = endMonth;
        this.minWind    = minWind;
        this.maxWind    = maxWind;
        this.bonusWind  = bonusWind;
        this.bonusTemp  = bonusTemp;
        this.bonusRain  = bonusRain;
        this.maxTemperature = maxTemperature;
        this.minTemperature = minTemperature;
    }

    /**
     * Returns the display name, picking a random variant if any are defined.
     * Needs an index to pick deterministically from the list.
     */
    public String getDisplayName(int randomIndex) {
        if (variants.isEmpty()) return name;
        String variant = variants.get(randomIndex % variants.size());
        return name + " (" + variant + ")";
    }

    public boolean hasVariants() {
        return !variants.isEmpty();
    }

    public int getVariantCount() {
        return variants.size();
    }

    public boolean conditionsMet(int month, int wind, double temperature) {
        if (wind < minWind) { Logger.log(LogLevel.DEBUG, 3, "wind is below min wind: " + wind + "/"+minWind); return false; }
        if (wind > maxWind) { Logger.log(LogLevel.DEBUG, 3, "wind is above max wind: " + wind + "/"+maxWind); return false; }
        else { Logger.log(LogLevel.DEBUG, 3, "wind is within: " +minWind +"<"+ wind + "<"+maxWind); }
        if (temperature < minTemperature) { Logger.log(LogLevel.DEBUG, 3, "temperature is below min temperature: " + temperature + " / "+minTemperature); return false; }
        if (temperature > maxTemperature) { Logger.log(LogLevel.DEBUG, 3, "temperature is above max temperature: " + temperature + " / "+maxTemperature); return false; }
        else { Logger.log(LogLevel.DEBUG, 3, "temperature is within: " +minTemperature +"<"+ temperature + "<"+maxTemperature); }
        Logger.log(LogLevel.DEBUG, 3, "Month is " +startMonth +" < " + month + " < "+endMonth);
        
        // there is a startmonth or endmonth
        if (startMonth != 0 && endMonth != 13) {
        	Logger.log(LogLevel.DEBUG, 3, "Specific months defined for event");
        	// if start and end is on the same year (i.e. January to March)
        	if (startMonth <= endMonth) {
                if (month < startMonth || month > endMonth) return false;
                else { Logger.log(LogLevel.DEBUG, 3, "month is within: " +startMonth +"<="+ month + "<="+endMonth); }
            } 
        	// start is on the year before the end month (i.e. December to January)
        	else {
                if (month < startMonth && month > endMonth) return false;
                Logger.log(LogLevel.DEBUG, 3, "month is within: " +endMonth +"<="+ month + "<="+startMonth);
            }
        }
        else {
        	
        }

        return true;
    }

    public String getName()     { return name; }
    public int getOccurs()      { return occurs; }
    public int getDays()        { return days; }
    public int getBonusWind()   { return bonusWind; }
    public int getBonusTemp()   { return bonusTemp; }
    public int getBonusRain()   { return bonusRain; }
}
