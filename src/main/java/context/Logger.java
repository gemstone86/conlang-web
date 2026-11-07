package context;

public class Logger {

    private static LogLevel setLevel = LogLevel.DEBUG;

    public static void setLevel(LogLevel level) {
        setLevel = level;
    }

    public static void log(LogLevel logLevel, int level, String message) {
        if (logLevel.getLevel() >= setLevel.getLevel()) {
            String finalMessage = "";
            for(int i = 0;i<level;i++) {
            	finalMessage = finalMessage + "  ";
            }
        	System.out.println(finalMessage + "[" + logLevel.name() + "] " + message);
        }
    }
}
