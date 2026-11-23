package com.dawnofmankind.web;

import com.dawnofmankind.core.GameException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Rooms over plain HTTP: create, join, look up. Everything after joining goes over the WebSocket at /dawn/ws.
 */
@RestController
@RequestMapping("/dawn/api")
public class DawnController {
    private final RoomService rooms;
    private final ObjectProvider<DawnIdentity> identity;

    public DawnController(RoomService rooms, ObjectProvider<DawnIdentity> identity) {
        this.rooms = rooms;
        this.identity = identity;
    }

    /** The logged-in name, if the host app has a login and the player is logged in. */
    @GetMapping("/me")
    public Map<String, Object> me(HttpServletRequest req) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", loggedInName(req).orElse(null));
        m.put("admin", isAdmin(req));
        return m;
    }

    /** Every card in the game, for the "All cards" button. */
    @GetMapping("/cards")
    public Map<String, Object> cards() {
        return rooms.catalogue();
    }

    @PostMapping("/rooms")
    public RoomService.Joined create(@RequestBody(required = false) Map<String, Object> body, HttpServletRequest req) {
        return rooms.create(name(body, req), isAdmin(req));
    }

    @PostMapping("/rooms/{code}/join")
    public RoomService.Joined join(@PathVariable String code, @RequestBody(required = false) Map<String, Object> body, HttpServletRequest req) {
        return rooms.join(code, name(body, req), isAdmin(req));
    }

    /** The full journal of a game (actions with before/after, every log line, a table snapshot each round). */
    @GetMapping("/rooms/{code}/gamelog")
    public ResponseEntity<Map<String, Object>> gameLog(@PathVariable String code, @org.springframework.web.bind.annotation.RequestParam String token) {
        Map<String, Object> log = rooms.room(code).gameLog(token);
        return ResponseEntity.ok()
                .header("Content-Disposition", "attachment; filename=\"dawn-game-" + code + ".json\"")
                .body(log);
    }

    /** Admins: how many saved game logs are waiting. */
    @GetMapping("/admin/gamelogs")
    public Map<String, Object> savedLogs(HttpServletRequest req) {
        requireAdmin(req);
        return Map.of("logs", rooms.savedLogs());
    }

    /** Admins: every saved game log (and the games running now) as one zip. The saved ones are deleted afterwards. */
    @GetMapping("/admin/gamelogs/download")
    public ResponseEntity<byte[]> downloadLogs(HttpServletRequest req) throws java.io.IOException {
        requireAdmin(req);
        return ResponseEntity.ok()
                .header("Content-Type", "application/zip")
                .header("Content-Disposition", "attachment; filename=\"dawn-game-logs.zip\"")
                .body(rooms.collectLogs());
    }

    private void requireAdmin(HttpServletRequest req) {
        if (!isAdmin(req)) throw new GameException("Only admins can do that.");
    }

    @GetMapping("/rooms/{code}")
    public Map<String, Object> room(@PathVariable String code) {
        return rooms.room(code).summary();
    }

    private String name(Map<String, Object> body, HttpServletRequest req) {
        Optional<String> logged = loggedInName(req);
        if (logged.isPresent()) return logged.get();
        Object n = body == null ? null : body.get("name");
        return n == null ? "" : String.valueOf(n);
    }

    private boolean isAdmin(HttpServletRequest req) {
        DawnIdentity id = identity.getIfAvailable();
        try {
            return id != null && id.isAdmin(req);
        } catch (RuntimeException e) {
            return false;
        }
    }

    private Optional<String> loggedInName(HttpServletRequest req) {
        DawnIdentity id = identity.getIfAvailable();
        if (id == null) return Optional.empty();
        try {
            return id.displayName(req).filter(s -> !s.isBlank());
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }

    @ExceptionHandler(GameException.class)
    public ResponseEntity<Map<String, String>> refused(GameException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", e.getMessage()));
    }
}
