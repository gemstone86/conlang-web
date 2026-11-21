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

    public RoomService(@Value("${dawn.away-grace-seconds:60}") long graceSeconds,
                       @Value("${dawn.idle-room-minutes:30}") long idleMinutes,
                       @Value("${dawn.finished-room-minutes:10}") long finishedMinutes,
                       @Value("${dawn.ai-move-millis:900}") long aiMoveMillis) {
        aiDelayMillis = aiMoveMillis;
        graceMillis = graceSeconds * 1000;
        idleMillis = idleMinutes * 60_000;
        finishedMillis = finishedMinutes * 60_000;
        timer.scheduleWithFixedDelay(this::tick, 5, 5, TimeUnit.SECONDS);
    }

    public record Joined(String code, String token, int seat) {}

    public Joined create(String name) {
        if (rooms.size() > 2000) throw new GameException("Too many rooms are open right now. Try again later.");
        String code;
        Room room;
        do {
            code = newCode();
            room = new Room(code, content, json::writeValueAsString, timer, aiDelayMillis);
        } while (rooms.putIfAbsent(code, room) != null);
        Room.Seat s = room.join(name);
        return new Joined(code, s.token, 0);
    }

    public Joined join(String code, String name) {
        Room r = room(code);
        Room.Seat s = r.join(name);
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
                long limit = r.finished() ? finishedMillis : idleMillis;
                if (r.idleSince(now - limit)) rooms.remove(r.code);
            } catch (RuntimeException e) {
                // one broken room must not stop the others
            }
        }
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
