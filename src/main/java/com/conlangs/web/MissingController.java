package com.conlangs.web;

import jakarta.servlet.http.HttpSession;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The Missing words tab ({@link MissingService}). */
@RestController
@RequestMapping("/rune/api")
public class MissingController {
    private final Auth auth;
    private final MissingService missing;

    public MissingController(Auth auth, MissingService missing) {
        this.auth = auth;
        this.missing = missing;
    }

    private static String str(Map<String, Object> b, String k) {
        Object v = b == null ? null : b.get(k);
        return v == null ? null : v.toString();
    }

    @GetMapping("/languages/{id}/missing")
    public Map<String, Object> list(@PathVariable long id, HttpSession s) {
        return missing.list(auth.viewerUid(s), id);
    }

    @PostMapping("/languages/{id}/missing")
    public Map<String, Object> add(@PathVariable long id, @RequestBody Map<String, Object> b, HttpSession s) {
        return Map.of("id", missing.add(auth.requireUid(s), id, str(b, "gloss"), str(b, "pos"), str(b, "notes")));
    }

    @PostMapping("/languages/{id}/missing/bulk")
    public Map<String, Object> bulk(@PathVariable long id, @RequestBody Map<String, Object> b, HttpSession s) {
        return missing.bulk(auth.requireUid(s), id, str(b, "text"));
    }

    @PostMapping("/languages/{id}/missing/clear-filled")
    public Map<String, Object> clearFilled(@PathVariable long id, HttpSession s) {
        return Map.of("removed", missing.clearFilled(auth.requireUid(s), id));
    }

    @DeleteMapping("/missing/{id}")
    public Map<String, Object> delete(@PathVariable long id, HttpSession s) {
        missing.delete(auth.requireUid(s), id);
        return Map.of("ok", true);
    }
}
