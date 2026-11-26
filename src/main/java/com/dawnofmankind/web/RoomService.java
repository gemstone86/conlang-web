package com.dawnofmankind.web;

import com.dawnofmankind.core.Content;
import com.dawnofmankind.core.GameException;
import jakarta.annotation.PreDestroy;
import java.security.SecureRandom;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/** All rooms, kept in memory. A restart ends every game. */
@Service
public class RoomService {
    /** Room codes avoid look-alike characters (0/O, 1/I/L). */
    static final String ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final Map<String, Room> rooms = new ConcurrentHashMap<>();
    private final Content content = Content.loadDefault();
    private final JsonMapper json = JsonMapper.builder().build();
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "dawn-rooms");
        t.setDaemon(true);
        return t;
    });
    private final long graceMillis, idleMillis, finishedMillis, aiDelayMillis;
    private final java.nio.file.Path logDir;

    public RoomService(@Value("${dawn.away-grace-seconds:60}") long graceSeconds,
                       @Value("${dawn.idle-room-minutes:30}") long idleMinutes,
                       @Value("${dawn.finished-room-minutes:10}") long finishedMinutes,
                       @Value("${dawn.ai-move-millis:900}") long aiMoveMillis,
                       @Value("${dawn.log-dir:./data/dawn-logs}") String logDir) {
        this.logDir = java.nio.file.Path.of(logDir);
        aiDelayMillis = aiMoveMillis;
        graceMillis = graceSeconds * 1000;
        idleMillis = idleMinutes * 60_000;
        finishedMillis = finishedMinutes * 60_000;
        timer.scheduleWithFixedDelay(this::tick, 5, 5, TimeUnit.SECONDS);
    }

    public record Joined(String code, String token, int seat) {}

    public Joined create(String name) {
        return create(name, false);
    }

    /** Special languages only an admin may pick for a room. */
    private static final java.util.Set<String> ADMIN_LANGUAGES = java.util.Set.of("mundana");

    public Joined create(String name, boolean admin) {
        return create(name, admin, null);
    }

    public Joined create(String name, boolean admin, String language) {
        if (rooms.size() > 2000) throw new GameException("Too many rooms are open right now. Try again later.");
        String code;
        Room room;
        do {
            code = newCode();
            room = new Room(code, content, json::writeValueAsString, timer, aiDelayMillis);
        } while (rooms.putIfAbsent(code, room) != null);
        if (admin && language != null && ADMIN_LANGUAGES.contains(language)) room.language = language;
        Room.Seat s = room.join(name, admin);
        return new Joined(code, s.token, 0);
    }

    public Joined join(String code, String name) {
        return join(code, name, false);
    }

    public Joined join(String code, String name, boolean admin) {
        Room r = room(code);
        Room.Seat s = r.join(name, admin);
        return new Joined(r.code, s.token, r.seatOf(s.token));
    }

    public Room room(String code) {
        Room r = code == null ? null : rooms.get(code.trim().toUpperCase());
        if (r == null) throw new GameException("No room with code " + code + ".");
        return r;
    }

    public Room find(String code) {
        return code == null ? null : rooms.get(code.trim().toUpperCase());
    }

    JsonMapper json() {
        return json;
    }

    static String newCode() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 5; i++) sb.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
        return sb.toString();
    }

    void tick() {
        long now = System.currentTimeMillis();
        for (Room r : rooms.values()) {
            try {
                r.tick(now, graceMillis);
                if (r.finished()) archive(r);                       // a finished game's journal is kept for the admin
                long limit = r.finished() ? finishedMillis : idleMillis;
                if (r.idleSince(now - limit)) {
                    archive(r);                                      // so is one that was abandoned
                    rooms.remove(r.code);
                }
            } catch (RuntimeException e) {
                // one broken room must not stop the others
            }
        }
    }

    /** Saves a started game's journal to disk, once, until an admin downloads (and so deletes) it. */
    synchronized void archive(Room r) {
        if (r.archived) return;
        Map<String, Object> log = r.fullLog();
        if (log == null) return;
        r.archived = true;
        try {
            java.nio.file.Files.createDirectories(logDir);
            String name = "dawn-game-" + r.code + "-" + java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").format(java.time.LocalDateTime.now()) + ".json";
            java.nio.file.Files.write(logDir.resolve(name), json.writeValueAsBytes(log));
        } catch (java.io.IOException | RuntimeException e) {
            r.archived = false;                                      // try again on the next tick
        }
    }

    /** Names of the saved logs. */
    synchronized java.util.List<String> savedLogs() {
        try (var files = java.nio.file.Files.list(logDir)) {
            return files.map(f -> f.getFileName().toString()).filter(n -> n.endsWith(".json")).sorted().toList();
        } catch (java.io.IOException e) {
            return java.util.List.of();
        }
    }

    /**
     * Everything for the admin as one zip: the saved logs (which are deleted once the zip is built) and the games still
     * running right now (which stay).
     */
    synchronized byte[] collectLogs() throws java.io.IOException {
        java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
        java.util.List<java.nio.file.Path> done = new java.util.ArrayList<>();
        try (java.util.zip.ZipOutputStream zip = new java.util.zip.ZipOutputStream(bytes)) {
            for (String n : savedLogs()) {
                java.nio.file.Path f = logDir.resolve(n);
                zip.putNextEntry(new java.util.zip.ZipEntry(n));
                zip.write(java.nio.file.Files.readAllBytes(f));
                zip.closeEntry();
                done.add(f);
            }
            for (Room r : rooms.values()) {
                if (r.archived) continue;
                Map<String, Object> log = r.fullLog();
                if (log == null) continue;
                zip.putNextEntry(new java.util.zip.ZipEntry("dawn-game-" + r.code + "-still-running.json"));
                zip.write(json.writeValueAsBytes(log));
                zip.closeEntry();
            }
        }
        for (java.nio.file.Path f : done) java.nio.file.Files.deleteIfExists(f);
        return bytes.toByteArray();
    }

    int size() {
        return rooms.size();
    }

    @PreDestroy
    void stop() {
        timer.shutdownNow();
    }

    public java.util.Map<String, Object> catalogue() {
        return com.dawnofmankind.core.View.catalogue(content);
    }
}
