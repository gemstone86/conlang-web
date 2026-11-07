package date;

import java.text.DecimalFormat;

import weather.direction;

public class Day {

	private int Year, Month, Day;
    private double temperature;
    private int windStrength;
    private int rain;
    private String other;
    private direction direction;
    private java.util.List<String> eventList = new java.util.ArrayList<>();

    public Day(int Year, int Month, int Day, double temp, int windStrength, int rain, String other, direction direction){
        this.Year = Year; this.Month = Month; this.Day = Day;
        this.temperature = temp; this.windStrength = windStrength;
        this.other = other; this.rain = rain; this.direction = direction;
    }

    public int getYear()           { return Year; }
    public int getMonth()          { return Month; }
    public int getDay()            { return Day; }
    public double getTemperature() { return temperature; }
    public int getWindStrength()   { return windStrength; }
    public String getOther()       { return other; }
    public int getRain()           { return rain; }
    public direction getDirection(){ return direction; }
    /** Each triggered event / holy day as its own entry. */
    public java.util.List<String> getEventList() { return eventList; }
    public void setEventList(java.util.List<String> list) { this.eventList = list; }

    public String getMessage(){
        return Year+"\t"+Month+"\t"+Day+"\t"+windStrength+"\t"+temperature+" C"+"\t\t"+rain+"\t\t"+other+"\n";
    }
}
