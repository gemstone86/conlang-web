package com.eonweather.core;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Looks after the built-in database file (H2, {@code jdbc:h2:file:…}); does nothing for PostgreSQL.
 *
 * <ul>
 * <li><b>One copy at a time.</b> On Azure App Service the file lives on a network share where file locks
 * aren't reliable, and while a new version starts the old one is still running: both would write the file
 * at once, which corrupts it. So the copy using the file keeps an owner file next to it
 * ({@code <db>.owner}, refreshed every 10 s). A new copy asks for the file ({@code <db>.handover}) and
 * waits; the old copy closes the database cleanly and stops, and the new one takes over.</li>
 * <li><b>Repair at start.</b> A file that can't be opened because it is corrupted is moved aside
 * ({@code <db>.corrupt-<time>.mv.db}, never deleted), and the data is taken back from it with H2's
 * recovery tool; failing that, from the newest backup; failing that, the app starts with an empty
 * database (the standard map is installed again). What happened is logged and shown to the admins.</li>
 * <li><b>Backups.</b> Every few hours (EON_DB_BACKUP_HOURS, default 6) the whole database is written as
 * SQL to {@code backups/<db>-<time>.zip} next to the file; the newest EON_DB_BACKUPS (default 14) are
 * kept. Writing one reads every record, so a damaged file is noticed early (it is logged and shown to
 * the admins) while the older backups are still good.</li>
 * </ul>
 */
public final class DbGuard {
    private static final long HEARTBEAT_MS = 10_000, STALE_MS = 45_000, WAIT_MS = 150_000;
    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");
    private static volatile String notice;                   // for the admins: what happened to the database
    private static volatile DbGuard current;

    private final String url, user, password;
    private final Path base;                                 // the file without .mv.db
    private final String id = UUID.randomUUID().toString();
    private ScheduledExecutorService timer;
    private volatile boolean released;

    private DbGuard(String url, String user, String password, Path base) {
        this.url = url; this.user = user; this.password = password; this.base = base;
    }

    /** What the admins should know about the database (a repair, a failed backup), or null. */
    public static String notice() { return notice; }

    private static void note(String s) {
        System.err.println("DATABASE: " + s);
        notice = notice == null ? s : notice + "\n" + s;
    }

    /**
     * Before the app opens the database: waits for any other copy to hand the file over, then makes
     * sure it opens, repairing it if it is corrupted. Returns the guard (null for a database that isn't
     * an H2 file). Call {@link #started(Runnable)} once the app runs.
     */
    public static DbGuard prepare(String url, String user, String password) {
        Path base = h2File(url);
        if (base == null) return null;
        DbGuard g = new DbGuard(url, user, password == null ? "" : password, base);
        try { Files.createDirectories(base.toAbsolutePath().getParent()); } catch (IOException ignored) { }
        g.takeOver();
        g.openOrRepair();
        current = g;
        return g;
    }

    /**
     * Starts the heartbeat (and the hand-over to a newer copy: {@code stop} closes the app) and the backups.
     */
    public void started(Runnable stop) {
        timer = Executors.newSingleThreadScheduledExecutor(r -> { Thread t = new Thread(r, "db-guard"); t.setDaemon(true); return t; });
        timer.scheduleWithFixedDelay(() -> heartbeat(stop), HEARTBEAT_MS, HEARTBEAT_MS, TimeUnit.MILLISECONDS);
        long hours = Math.max(1, envLong("EON_DB_BACKUP_HOURS", 6));
        timer.scheduleWithFixedDelay(this::backup, 5, hours * 60, TimeUnit.MINUTES);
        Runtime.getRuntime().addShutdownHook(new Thread(this::releaseFile, "db-guard-exit"));
    }

    /** The database file of an H2 file URL (without .mv.db), or null. */
    static Path h2File(String url) {
        if (url == null || !url.startsWith("jdbc:h2:")) return null;
        String rest = url.substring("jdbc:h2:".length());
        if (rest.startsWith("mem:") || rest.startsWith("tcp:") || rest.startsWith("ssl:")) return null;
        if (rest.startsWith("file:")) rest = rest.substring(5);
        int semi = rest.indexOf(';');
        if (semi >= 0) rest = rest.substring(0, semi);
        if (rest.startsWith("~")) rest = System.getProperty("user.home") + rest.substring(1);
        return Paths.get(rest);
    }

    private Path sibling(String suffix) { return base.resolveSibling(base.getFileName() + suffix); }
    private Path dbFile() { return sibling(".mv.db"); }

    // ── one copy at a time ──
    private void takeOver() {
        Path owner = sibling(".owner"), handover = sibling(".handover");
        long deadline = System.currentTimeMillis() + WAIT_MS;
        boolean asked = false;
        while (true) {
            String[] o = readOwner();
            boolean free = o == null || System.currentTimeMillis() - parseLong(o[1]) > STALE_MS;
            if (free || System.currentTimeMillis() > deadline) {
                if (!free) System.err.println("DATABASE: the copy using the file didn't hand it over in time; taking it over anyway");
                writeOwner();
                try { Files.deleteIfExists(handover); } catch (IOException ignored) { }
                return;
            }
            if (!asked) {
                System.out.println("Database: another copy of the app is using the file; asking it to hand it over…");
                try { Files.writeString(handover, id, StandardCharsets.UTF_8); } catch (IOException ignored) { }
                asked = true;
            }
            sleep(2000);
        }
    }

    private String[] readOwner() {
        try {
            String s = Files.readString(sibling(".owner"), StandardCharsets.UTF_8).trim();
            String[] p = s.split("\\s+");
            return p.length >= 2 ? p : null;
        } catch (IOException e) { return null; }
    }

    private void writeOwner() {
        try { Files.writeString(sibling(".owner"), id + " " + System.currentTimeMillis(), StandardCharsets.UTF_8); }
        catch (IOException e) { System.err.println("DATABASE: cannot write the owner file: " + e.getMessage()); }
    }

    private void heartbeat(Runnable stop) {
        if (released) return;
        try {
            String want = Files.exists(sibling(".handover")) ? Files.readString(sibling(".handover"), StandardCharsets.UTF_8).trim() : null;
            if (want != null && !want.isEmpty() && !want.equals(id)) {
                // a newer copy of the app is starting: close the database cleanly and stop
                System.out.println("Database: a newer copy of the app wants the database file; closing it and stopping.");
                released = true;
                shutdownDatabase();
                releaseFile();
                new Thread(stop, "db-handover").start();
                return;
            }
            String[] o = readOwner();
            if (o != null && !o[0].equals(id) && System.currentTimeMillis() - parseLong(o[1]) < STALE_MS) {
                // someone else took the file (we were too slow): stop writing to it
                System.err.println("DATABASE: another copy of the app took over the database file; stopping.");
                released = true;
                new Thread(stop, "db-handover").start();
                return;
            }
            writeOwner();
        } catch (Exception e) {
            System.err.println("DATABASE: heartbeat failed: " + e.getMessage());
        }
    }

    private void shutdownDatabase() {
        try (Connection c = DriverManager.getConnection(url, user, password); Statement s = c.createStatement()) {
            s.execute("SHUTDOWN");
        } catch (SQLException e) {
            System.err.println("DATABASE: shutdown: " + e.getMessage());
        }
    }

    private void releaseFile() {
        String[] o = readOwner();
        if (o != null && o[0].equals(id)) {
            try { Files.deleteIfExists(sibling(".owner")); } catch (IOException ignored) { }
        }
    }

    /** True once this copy has handed the database over to a newer one (requests should be refused). */
    public static boolean handedOver() { DbGuard g = current; return g != null && g.released; }

    // ── repair at start ──
    private void openOrRepair() {
        SQLException err;
        try (Connection c = DriverManager.getConnection(url, user, password)) {
            return;
        } catch (SQLException e) { err = e; }
        if (!corrupted(err)) return;                      // something else (the app reports it as before)
        String ts = LocalDateTime.now().format(TS);
        String corruptName = base.getFileName() + ".corrupt-" + ts;
        Path moved = base.resolveSibling(corruptName + ".mv.db");
        try {
            Files.move(dbFile(), moved);
        } catch (IOException e) {
            note("The database file is corrupted and could not be moved aside (" + e.getMessage() + ").");
            return;
        }
        note("The database file was corrupted (" + oneLine(err) + "). It was kept as " + moved.getFileName() + ".");
        // 1) H2's recovery tool: reads what it can from the damaged file and writes it as SQL
        Path script = base.resolveSibling(corruptName + ".h2.sql");
        try {
            org.h2.tools.Recover.execute(moved.toAbsolutePath().getParent().toString(), corruptName);
            if (Files.exists(script)) {
                org.h2.tools.RunScript.execute(plainUrl(), user, password, script.toString(), StandardCharsets.UTF_8, true);
                if (looksUsable()) {
                    note("All that could be read from it was recovered with H2's recovery tool.");
                    try { Files.deleteIfExists(script); Files.deleteIfExists(base.resolveSibling(corruptName + ".mv.txt")); } catch (IOException ignored) { }
                    return;
                }
            }
            note("H2's recovery tool could not recover it.");
        } catch (Exception e) {
            note("H2's recovery tool failed: " + oneLine(e));
        }
        deleteNewFile();
        // 2) the newest backup
        for (Path b : backups()) {
            try {
                try (Connection c = DriverManager.getConnection(plainUrl(), user, password); Statement s = c.createStatement()) {
                    s.execute("RUNSCRIPT FROM '" + b.toAbsolutePath().toString().replace("'", "''") + "' COMPRESSION ZIP");
                }
                if (looksUsable()) { note("The database was restored from the backup " + b.getFileName() + " (changes after it are lost)."); return; }
            } catch (SQLException e) {
                note("The backup " + b.getFileName() + " could not be read: " + oneLine(e));
            }
            deleteNewFile();
        }
        note("No usable backup: the app starts with an empty database (the standard map is installed again; accounts, notes and own maps must be made again).");
    }

    /** The URL without a compatibility mode: scripts are written with H2's own type names (BLOB…). */
    private String plainUrl() { return url.replaceAll("(?i);MODE=[^;]*", ""); }

    private static boolean corrupted(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            String m = String.valueOf(t.getMessage()).toLowerCase(Locale.ROOT);
            if (m.contains("corrupt") || m.contains("double mark") || m.contains("chunk") && m.contains("not found")
                || t.getClass().getName().contains("MVStoreException")) return true;
        }
        return false;
    }

    private boolean looksUsable() {
        try (Connection c = DriverManager.getConnection(url, user, password); Statement s = c.createStatement()) {
            s.executeQuery("SELECT COUNT(*) FROM users").close();
            return true;
        } catch (SQLException e) { return false; }
    }

    private void deleteNewFile() {
        try { Files.deleteIfExists(dbFile()); Files.deleteIfExists(sibling(".trace.db")); } catch (IOException ignored) { }
    }

    // ── backups ──
    private Path backupDir() { return base.toAbsolutePath().resolveSibling("backups"); }

    /** Backups of this database, newest first. */
    private List<Path> backups() {
        List<Path> out = new ArrayList<>();
        String prefix = base.getFileName() + "-";
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(backupDir(), prefix + "*.zip")) {
            for (Path p : ds) out.add(p);
        } catch (IOException ignored) { }
        out.sort(Comparator.comparing((Path p) -> p.getFileName().toString()).reversed());
        return out;
    }

    private void backup() {
        if (released) return;
        try {
            Files.createDirectories(backupDir());
            Path f = backupDir().resolve(base.getFileName() + "-" + LocalDateTime.now().format(TS) + ".zip");
            Path tmp = f.resolveSibling(f.getFileName() + ".part");
            try (Connection c = DriverManager.getConnection(url, user, password); Statement s = c.createStatement()) {
                s.execute("SCRIPT TO '" + tmp.toAbsolutePath().toString().replace("'", "''") + "' COMPRESSION ZIP");
            }
            Files.move(tmp, f, StandardCopyOption.REPLACE_EXISTING);
            long keep = Math.max(1, envLong("EON_DB_BACKUPS", 14));
            List<Path> all = backups();
            for (int i = (int) keep; i < all.size(); i++) Files.deleteIfExists(all.get(i));
            System.out.println("Database: backup written, " + f.getFileName() + " (" + Files.size(f) / 1024 + " kB)");
        } catch (Exception e) {
            note("A backup failed (" + oneLine(e) + "). If it says the file is corrupted, download the database folder now; the older backups are still in data/backups.");
        }
    }

    // ── helpers ──
    private static String oneLine(Throwable e) {
        String m = String.valueOf(e.getMessage());
        int nl = m.indexOf('\n');
        return nl >= 0 ? m.substring(0, nl) : m;
    }
    private static long parseLong(String s) { try { return Long.parseLong(s); } catch (Exception e) { return 0; } }
    private static long envLong(String k, long d) {
        try { String v = System.getenv(k); return v == null || v.isBlank() ? d : Long.parseLong(v.trim()); } catch (Exception e) { return d; }
    }
    private static void sleep(long ms) { try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); } }
}
