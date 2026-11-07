package weather;

import context.Logger;
import context.LogLevel;
import context.ReligiousDate;
import date.Calendar;
import date.Day;
import date.InfluxCalculator;
import gui.Localization;

import java.util.LinkedList;
import java.util.List;
import java.util.Random;

public class weatherCalculator {
    Random rng;
    Random yearRng  = new Random();
    Random monthRng = new Random();
    Random weekRng  = new Random();
    int dateSerial;
    int bonusWind = 0, bonusRain = 0, bonusTemp = 0;

    private List<GlobalEvent> globalEvents = new java.util.ArrayList<>();
    private List<ReligiousDate> religiousDates = new java.util.ArrayList<>();
    private List<Calendar> calendars = new java.util.ArrayList<>();
    private InfluxCalculator influxCalculator = null;
    /** Events triggered by the last generateEvents/appendReligiousDates call, one per entry. */
    private List<String> lastEventList = new java.util.ArrayList<>();
    
    public weatherCalculator(Random rng) { 
    	this.rng = rng; 
    }

    public void setDateSerial(int serial) {
    	dateSerial = serial;
    }
    
    public void setGlobalEvents(List<GlobalEvent> events) { this.globalEvents = events; }
    public void setReligiousDates(List<ReligiousDate> dates) { this.religiousDates = dates; }
    public List<ReligiousDate> getReligiousDates() { return religiousDates; }
    public void setInfluxLists(String[][] lists) { this.influxCalculator = new InfluxCalculator(lists); }
    public InfluxCalculator getInfluxCalculator() { return influxCalculator; }
    public void setYearSeed(int n)  { yearRng.setSeed(n); }
    public void setMonthSeed(int n) { monthRng.setSeed(n); }
    public void setWeekSeed(int n)  { weekRng.setSeed(n); }
    public void setSeed(int n)      { rng.setSeed(n); }

    public int obd6() {
        int die = rng.nextInt(6) + 1;
        if (die == 6) return obd6() + obd6();
        return die;
    }

    public int daySeed(int year, int month, int day) {
        int sum = (year-1) * (12*28) + (month-1)*28 + day;
        Logger.log(LogLevel.INFO, 2, "Dayseed is: " + sum);
        return sum;
    }
    public int monthSeed(int year, int month) {
        int sum = (year-1) * (12*28) + (month-1)*28;
        Logger.log(LogLevel.DEBUG, 1, "Monthseed is: " + sum);
        return sum;
    }
    public int yearSeed(int year) {
        int sum = (year-1) * (12*28);
        Logger.log(LogLevel.DEBUG, 1, "Yearseed is: " + sum);
        return sum;
    }

    public double windStrengthYear(int year) {
        setYearSeed(yearSeed(year));
        return randomBetweenFrom(yearRng, -2, 3);
    }
    public double windStrengthMonth(int year, int month) {
        setMonthSeed(monthSeed(year, month));
        return randomBetweenFrom(monthRng, -2, 3);
    }
    public int weekSeed(int year, int month, int day) {
        // week 1 = days 1-7, week 2 = days 8-14, etc.
        int week = (day - 1) / 7;
        return (year - 1) * (12 * 4) + (month - 1) * 4 + week;
    }
    public double windStrengthWeek(int year, int month, int day) {
        weekRng.setSeed(weekSeed(year, month, day));
        weekRng.nextDouble(); // discard first draw for better distribution
        return weekRng.nextDouble() * 4; // 0..4
    }
    /**
     * Fractal wind: year(-2..4) + month(-2..2) + week(0..4) + day(0..4) + bonus.
     * Max theoretical: 4+2+4+4 = 14 (force 12 storm).
     * A storm of strength 12 requires a very windy year AND month AND week AND day.
     */
    public int windStrengthFractal(int year, int month, int day, int windBonus) {
        int dayStrength   = (int) randomBetweenInt(0, 4);
        int yearStrength  = 0;
        int monthStrength  = 0;
        
        if(randomBetweenInt(0,4)>3) {
        	yearStrength = (int) windStrengthYear(year);
        }
        
        if(randomBetween(0,3)>2) {
        	monthStrength = (int) windStrengthMonth(year, month);
        }
        int weekStrength  = (int) windStrengthWeek(year, month, day);
        int strength = dayStrength + yearStrength + monthStrength + weekStrength + windBonus + bonusWind();
        Logger.log(LogLevel.INFO, 2, "Windstrength is... Year: " + yearStrength
            + " + Month: " + monthStrength
            + " + Week: " + weekStrength
            + " + Day: " + dayStrength
            + " + bonus: " + windBonus + " = " + strength);
        if (strength < 0) strength = 0;
        return strength;
    }
    public int windStrengthNR(int windBonus) {
        int strength = obd6() + windBonus + bonusWind();
        if (strength < 0) strength = 0;
        return strength;
    }
    public int windStrength(int previousDay, int windBonus) {
        int die = obd6(), strength;
        if (die > previousDay + 4)      strength = previousDay + 4 + windBonus;
        else if (die < previousDay - 4) strength = previousDay - 4 + windBonus;
        else                            strength = die + windBonus;
        strength += bonusWind();
        if (strength < 0) strength = 0;
        return strength;
    }
    private int bonusWind() { int t = bonusWind; bonusWind = 0; return t; }

    /**
     * This function returns a random double from between end and start.
     * Note that it draws twice to improve randomness as I noticed a bug
     * in the randomness that sometimes drew the same number far to many
     * times in a row.
     * @param rand
     * @param start
     * @param end
     * @return
     */
    public double randomBetweenFrom(Random rand, double start, double end) {
        rand.nextDouble(); //discard for better distribution
    	return (rand.nextDouble() * (end - start)) + start;
    }
    public double randomBetween(double start, double end) {
        return (rng.nextDouble() * end + 1 + start);
    }
    
    /**
     * see discussion on randomBetweenFrom
     * @param low
     * @param high
     * @return
     */
    public int randomBetweenInt(int low, int high) {
        rng.nextInt();
    	return rng.nextInt(high - low) + low +1;
        //return rng.nextInt(high - low + 1) + low;
    }
    
    public double getProceduralTemperature(double prev, double cur, double next, int day) {
        double variance = randomBetween(-5, 5);
        if (day < 15) {
            double step = (cur - prev) / 28;
            return (14 + day) * step + prev + variance;
        } else {
            double step = (next - cur) / 28;
            return (day - 14) * step + cur + variance;
        }
    }

    public int rainfall(double temperature, double average, int wind, int rain) {
        int limit = 6;
        // The region's precipitation modifier counts both ways: negative values make rain rarer.
        // (The old "+wind/2 when wind > 5" bonus is gone: it was a leftover quirk.)
        int bonus = rain;
        int die = obd6() + bonus + bonusRain();
        if (die < limit) return 0;
        return die - (limit - 1);
    }
    private int bonusRain() { int t = bonusRain; bonusRain = 0; return t; }

    public boolean chance(int occurs, int days) {
        // WEB CHANGE: "occurs: 1, days: N" now means exactly 1 chance in N per day.
        // The desktop version rolled nextInt(days - 1) + 1 < occurs + 1, which is
        // occurs in (N - 1): a bit too often, and it threw (= never happened) for days 1.
        if (days <= 1) return occurs >= 1;
        return rng.nextInt(days) < occurs;
    }

    /*
     * generates a list of events from the list of regionalEvents and list of globalEvents.
     * @return a string of events that occurs on the given day.
     */
    public String generateEvents(LinkedList<GlobalEvent> regionEvents, List<GlobalEvent> globalEvents, int month, int wind, double temperature) {
        StringBuilder result = new StringBuilder();
        lastEventList = new java.util.ArrayList<>();

        // Merge and process uniformly
        List<GlobalEvent> allEvents = new java.util.ArrayList<>(globalEvents);
        allEvents.addAll(regionEvents);
        Logger.log(LogLevel.DEBUG, 2, "Checking " + allEvents.size() + " events (" + globalEvents.size() + " global, " + regionEvents.size() + " regional)");

        for (GlobalEvent e : allEvents) {
            Logger.log(LogLevel.DEBUG, 2, "Checking event: " + e.getName());
            if (e.conditionsMet(month, wind, temperature) && chance(e.getOccurs(), e.getDays())) {
                int variantIdx = e.hasVariants() ? rng.nextInt(e.getVariantCount()) : 0;
                String displayName = e.getDisplayName(variantIdx);
                lastEventList.add(displayName);
                if (result.isEmpty()) result.append(displayName);
                else { result.append(", "); result.append(displayName); }
                bonusWind += e.getBonusWind();
                bonusTemp += e.getBonusTemp();
                bonusRain += e.getBonusRain();
            }
        }
        return result.toString();
    }

    /**
     * returns a wind (or stream direction)
     * @return a direction type object.
     */
    /**
     * WEB CHANGE: the day's wind direction (where it blows FROM). With a prevailing wind the
     * region gets that direction on prevailing_chance % of days; of the rest, 60 % are one of
     * its two neighbours (45° off) and 40 % any direction. Without one, all eight directions are
     * equally likely. (The old roll below gave N on 25 % of days and never NW.)
     */
    private direction windDirection(Nation nation) {
        direction[] all = direction.values();
        direction p = nation.getPrevailingWind();
        if (p == null) return all[rng.nextInt(8)];
        int r = rng.nextInt(100), chance = nation.getPrevailingChance();
        if (r < chance) return p;
        if (r < chance + (100 - chance) * 0.6) {
            int i = p.ordinal() + (rng.nextBoolean() ? 1 : -1);
            return all[(i + 8) % 8];
        }
        return all[rng.nextInt(8)];
    }

    /** The desktop version's roll, kept for reference: N twice as often, NW never. */
    @SuppressWarnings("unused")
    private direction getNonRandomDirection() {
        switch (rng.nextInt(8)) {
            case 1: return direction.N;  case 2: return direction.NE;
            case 3: return direction.E;  case 4: return direction.SE;
            case 5: return direction.S;  case 6: return direction.SW;
            case 7: return direction.W;  case 8: return direction.NW;
            default: return direction.N;
        }
    }

    /**
     * this method generaes the weather for a single day.
     * @param year the year of the weather
     * @param month the month of the weather
     * @param day the day of the weather
     * @param nation the nation to generate the weather 
     * @return
     */
    public Day getWeather(int year, int month, int day, Nation nation) {
        int previous    = nation.getTemperature(month - 1);
        int average     = nation.getTemperature(month);
        int next        = nation.getTemperature(month + 1);
        int nationWindFromMonth = nation.getWind(month);
        int rain        = nation.getRain(month);
//        rng.setSeed(daySeed(year, month, day));
        rng = new Random(daySeed(year, month, day) * 31L + 7 + Math.abs(nation.getName().hashCode()));
        int wind = windStrengthFractal(year, month, day, nationWindFromMonth);
        double temperature = getProceduralTemperature(previous, average, next, day);
        String events = generateEvents(nation.getEvents(), globalEvents, month, wind, temperature);
        events = appendReligiousDates(events, year, month, day);
        // WEB CHANGE: an event's wind bonus applies to the day it happens. The desktop
        // version left it pending until the *next* getWeather call, so the wind depended
        // on which day you had looked at before.
        wind = Math.max(0, wind + bonusWind());
        temperature += bonusTemp;
        bonusTemp = 0;
        Day result = new Day(year, month, day, temperature, wind,
                rainfall(temperature, average, wind, rain), events,
                windDirection(nation));
        result.setEventList(lastEventList);
        return result;
    }

    /**
     * generates the weather per an hourly basis.
     * @param year
     * @param month
     * @param day
     * @param nation the nation to generate the weather for
     * @return
     */
    public double[][] getHourlyWeather(int year, int month, int day, Nation nation, Day daily) {
        // här borde vi istället bara hämta datan ur DAY. inte räkna om
//    	Day daily = getWeather(year, month, day, nation);
        double dailyTemp = daily.getTemperature();
        int dailyWind    = daily.getWindStrength();
        int dailyRain    = daily.getRain();

//        Random hourRng = new Random(daySeed(year, month, day) * 31L + 7 + Math.abs(nation.getName().hashCode()));
        Random hourRng = rng;
        
        double[] temps = new double[24];
        double[] winds = new double[24];
        double[] rains = new double[24];

        // Base swing ±(3-5 degrees) + half the region's temperature_drop
        // drop_speed: 0 = smooth sine, higher = sharper drop and longer cold spell
        double baseSwing = 3.0 + hourRng.nextDouble() * 2.0;
        double swing     = baseSwing + nation.getTemperatureDrop() / 2.0;
        double dropSpeed = nation.getDropSpeed();
        // exponent < 1 sharpens peaks and flattens troughs on a sine:
        // we apply it to a normalised 0..1 version then restore sign
        double exponent = 1.0 / (1.0 + dropSpeed / 3.0); // drop_speed=3 -> exp=0.5
        for (int h = 0; h < 24; h++) {
            double angle = Math.PI * 2 * (h - 4) / 24.0; // trough at h=4, peak at h=16
            double sinVal = Math.sin(angle);
            // Apply exponent to absolute value, restore sign
            // exponent < 1 makes the curve spend more time near the extremes
            double shaped = Math.signum(sinVal) * Math.pow(Math.abs(sinVal), exponent);
            double noise  = (hourRng.nextDouble() - 0.5) * 2.0;
            temps[h] = dailyTemp + shaped * swing + noise;
        }

        double wind = dailyWind;
        for (int h = 0; h < 24; h++) {
            wind += (hourRng.nextDouble() - 0.5) * 2.0;
            wind = Math.max(0, Math.min(wind, dailyWind * 2.0 + 4));
            wind += (dailyWind - wind) * 0.15;
            winds[h] = wind;
        }

        if (dailyRain > 0) {
            for (int h = 0; h < 24; h++) {
                double r = dailyRain + (hourRng.nextDouble() - 0.5) * dailyRain * 0.8;
                rains[h] = Math.max(0, r);
            }
        }

        return new double[][]{ temps, winds, rains };
    }

    private String appendReligiousDates(String events, int year, int month, int day) {
        StringBuilder sb = new StringBuilder(events);
        for (ReligiousDate rd : religiousDates) {
            if (rd.matches(year, month, day)) {
                String tierKey = switch (rd.tier) {
                    case HOLIEST   -> "tier.holiest";
                    case HOLY      -> "tier.holy";
                    case UNHOLY    -> "tier.unholy";
                    case UNHOLIEST -> "tier.unholiest";
                };
                String entry = rd.religion + " - " + Localization.get(tierKey) + ": " + rd.name;
                lastEventList.add(entry);
                if (sb.length() > 0) sb.append(", ");
                sb.append(entry);
            }
        }
        return sb.toString();
    }
    
    public int getDateSerial() {
    	return dateSerial;
    }
    public int calculateDateSerial(int year, int month, int day) {
    	int calculate =(year-1) * (12*28) + (month-1)*28 + day; 
    	Logger.log(LogLevel.DEBUG, 3, "dateSerial in is: " + year + "-"+month+"-"+day+"="+ calculate);
    	return calculate;
    }
    
    public void updateDateSerial(int i) {
    	dateSerial += i;
    	Logger.log(LogLevel.INFO, 2, "dateSerial is: " + getDateSerial());
    }

	public String getDate(Calendar current) {
		// TODO Auto-generated method stub
		return current.toString(dateSerial);
		//return getYear() + "-" + getMonth() + "-" + getDay() + " (" + Localization.get("day." + ((getDay() % 7) + 1)) + ")";
	}

	public void setCalendars(List<Calendar> calendars) { this.calendars = calendars; }
		// TODO Auto-generated method stub

	public List<Calendar> getCalendars() {
		return calendars;
	}
}