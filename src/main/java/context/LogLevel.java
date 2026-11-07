package context;

public enum LogLevel {
    ALL(0),
	DEBUG(1),
    INFO(2),
    WARNING(3),
    ERROR(4);

    private final int level;

    LogLevel(int level) {
        this.level = level;
    }

    public int getLevel() {
        return level;
    }
}
