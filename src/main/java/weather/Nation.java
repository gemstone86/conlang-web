package weather;

import java.util.LinkedList;

public class Nation {

    private String nationName;
    private int[] temperature  = new int[12];
    private int[] rainfall     = new int[12];
    private int[] windStrength = new int[12];
    private int shift;
    private int wind;
    private int temperatureDrop;
    private double dropSpeed;
    private LinkedList<GlobalEvent> listOfEvents = new LinkedList<>();

    public Nation(String nationName, int[] temperature, int[] rainfall, int shift, int[] windStrength, LinkedList<GlobalEvent> events, int temperatureDrop, double dropSpeed) {
        this.nationName   = nationName;
        this.temperature  = temperature;
        this.shift        = shift;
        this.windStrength = windStrength;
        this.listOfEvents    = events;
        this.rainfall        = rainfall;
        this.temperatureDrop = temperatureDrop;
        this.dropSpeed       = dropSpeed;
    }

    public String getName()           { return nationName; }
    public int getShift()             { return shift; }
    public int getWind()              { return wind; }
    public int getWind(int month)     { return windStrength[month-1]; }
    public int[] getTemperature()     { return temperature; }
    public int[] getWindStrength()    { return windStrength; }
    /** Raw monthly precipitation values, index 0 = month 1 (added for the web map). */
    public int[] getRainfall()        { return rainfall; }
    public int getTemperatureDrop()            { return temperatureDrop; }
    public double getDropSpeed()               { return dropSpeed; }
    public LinkedList<GlobalEvent> getEvents()  { return listOfEvents; }

    // WEB CHANGE: prevailing wind (direction the wind usually comes FROM) and how often, in %.
    private direction prevailingWind = null;
    private int prevailingChance = 50;
    public direction getPrevailingWind()        { return prevailingWind; }
    public int getPrevailingChance()            { return prevailingChance; }
    public void setPrevailingWind(direction d, int chance) {
        this.prevailingWind = d;
        this.prevailingChance = Math.max(0, Math.min(100, chance));
    }

    public int getTemperature(int month) {
        if (month == 0)  return temperature[11];
        if (month == 13) return temperature[0];
        return temperature[month-1];
    }

    public int getRain(int month) {
        if (month == 0)  return rainfall[11];
        if (month == 12) return rainfall[0];
        return rainfall[month];
    }
}
