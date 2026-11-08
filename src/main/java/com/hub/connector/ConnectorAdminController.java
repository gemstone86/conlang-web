package com.hub.connector;

import com.conlangs.web.AppLog;
import com.conlangs.web.Auth;
import jakarta.servlet.http.HttpSession;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

/** Admin only: make, list and revoke Claude connector keys (Root and Rune → Claude connector). */
@RestController
@RequestMapping("/rune/api/admin/connector-keys")
public class ConnectorAdminController {
    private final Auth auth;
    private final ConnectorKeys keys;
    private final AppLog applog;

    public ConnectorAdminController(Auth auth, ConnectorKeys keys, AppLog applog) {
        this.auth = auth;
        this.keys = keys;
        this.applog = applog;
    }

    @GetMapping
    public List<Map<String, Object>> list(HttpSession s) {
        auth.requireAdmin(s);
        return keys.list();
    }

    /** {username, label} → {id, url, username, label}: the url (with the key) is shown only now. */
    @PostMapping
    public Map<String, Object> create(@RequestBody Map<String, Object> b, HttpSession s) {
        long admin = auth.requireAdmin(s);
        Map<String, Object> k = keys.create(b.get("username") == null ? null : b.get("username").toString(),
                b.get("label") == null ? null : b.get("label").toString());
        applog.info("connector", admin, "Made Claude connector key #" + k.get("id") + " ('" + k.get("label") + "') for account '" + k.get("username") + "'");
        Map<String, Object> out = new LinkedHashMap<>(k);
        out.remove("key");
        out.put("url", ServletUriComponentsBuilder.fromCurrentContextPath().path("/mcp/" + k.get("key")).toUriString());
        return out;
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> revoke(@PathVariable long id, HttpSession s) {
        long admin = auth.requireAdmin(s);
        Map<String, Object> k = keys.revoke(id);
        applog.info("connector", admin, "Revoked Claude connector key #" + id + " ('" + k.get("label") + "') of account '" + k.get("username") + "'");
        return Map.of("ok", true);
    }
}
