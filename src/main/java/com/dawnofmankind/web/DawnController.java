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
        return m;
    }

    @PostMapping("/rooms")
    public RoomService.Joined create(@RequestBody(required = false) Map<String, Object> body, HttpServletRequest req) {
        return rooms.create(name(body, req));
    }

    @PostMapping("/rooms/{code}/join")
    public RoomService.Joined join(@PathVariable String code, @RequestBody(required = false) Map<String, Object> body, HttpServletRequest req) {
        return rooms.join(code, name(body, req));
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
