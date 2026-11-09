package com.conlangs.web;

import jakarta.servlet.http.HttpSession;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Sound-change versions and switching tags off ({@link RuleVersions}). */
@RestController
@RequestMapping("/rune/api")
public class RuleVersionController {
    private final Auth auth;
    private final RuleVersions versions;

    public RuleVersionController(Auth auth, RuleVersions versions) {
        this.auth = auth;
        this.versions = versions;
    }

    private static String str(Map<String, Object> b, String k) {
        Object v = b == null ? null : b.get(k);
        return v == null ? null : v.toString();
    }

    @GetMapping("/languages/{id}/rule-versions")
    public List<Map<String, Object>> list(@PathVariable long id, HttpSession s) {
        return versions.list(auth.viewerUid(s), id);
    }

    @PostMapping("/languages/{id}/rule-versions")
    public Map<String, Object> save(@PathVariable long id, @RequestBody Map<String, Object> b, HttpSession s) {
        return Map.of("id", versions.save(auth.requireUid(s), id, str(b, "name"), str(b, "note")));
    }

    @GetMapping("/rule-versions/{vid}/compare")
    public Map<String, Object> compare(@PathVariable long vid, HttpSession s) {
        return versions.compare(auth.viewerUid(s), vid);
    }

    @PostMapping("/rule-versions/{vid}/restore")
    public Map<String, Object> restore(@PathVariable long vid, HttpSession s) {
        return versions.restore(auth.requireUid(s), vid);
    }

    @DeleteMapping("/rule-versions/{vid}")
    public Map<String, Object> delete(@PathVariable long vid, HttpSession s) {
        versions.delete(auth.requireUid(s), vid);
        return Map.of("ok", true);
    }

    /** {tag, off: true|false}: switch the sound changes with that tag off or on, in this language and its branches. */
    @PostMapping("/languages/{id}/tag-switch")
    public Map<String, Object> switchTag(@PathVariable long id, @RequestBody Map<String, Object> b, HttpSession s) {
        return versions.switchTag(auth.requireUid(s), id, str(b, "tag"), Boolean.parseBoolean(str(b, "off")));
    }
}
