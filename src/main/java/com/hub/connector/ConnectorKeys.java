package com.hub.connector;

import com.conlangs.web.ApiException;
import com.conlangs.web.Auth;
import com.conlangs.web.Db;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Keys for the Claude connector. A key is part of the connector's address (/mcp/&lt;key&gt;) and makes the
 * connector act as one account: it sees exactly what that account may see. Only a hash of the key is
 * stored; the key itself is shown once, when it is made.
 */
@Service
public class ConnectorKeys {
    private static final SecureRandom RND = new SecureRandom();
    private final Db db;

    public ConnectorKeys(Db db) {
        this.db = db;
    }

    static String hash(String key) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** Makes a key for the account; returns {id, key, username}. */
    public Map<String, Object> create(String username, String label) {
        Map<String, Object> u = username == null ? null
                : db.one("select id, username from users where lower(username)=lower(?) and " + Auth.REAL_USER, username.trim());
        if (u == null) throw new ApiException(404, "No account called '" + username + "'.");
        byte[] b = new byte[32];
        RND.nextBytes(b);
        String key = "rr" + Base64.getUrlEncoder().withoutPadding().encodeToString(b);
        String lbl = label == null || label.isBlank() ? "Claude" : label.trim();
        if (lbl.length() > 200) lbl = lbl.substring(0, 200);
        long id = db.insert("insert into connector_keys(user_id, label, key_hash) values (?,?,?)", u.get("id"), lbl, hash(key));
        return Map.of("id", id, "key", key, "username", u.get("username"), "label", lbl);
    }

    public List<Map<String, Object>> list() {
        return db.rows("select k.id, k.label, k.created, k.last_used, k.calls, u.username from connector_keys k "
                + "join users u on u.id=k.user_id order by k.id");
    }

    public Map<String, Object> revoke(long id) {
        Map<String, Object> k = db.one("select k.id, k.label, u.username from connector_keys k join users u on u.id=k.user_id where k.id=?", id);
        if (k == null) throw new ApiException(404, "No such key.");
        db.update("delete from connector_keys where id=?", id);
        return k;
    }

    /** The account a key acts as ({user_id, username, key_id}), or null for an unknown key. Counts the use. */
    public Map<String, Object> resolve(String key) {
        if (key == null || key.length() < 20 || key.length() > 100) return null;
        Map<String, Object> k = db.one("select k.id as key_id, k.user_id, u.username from connector_keys k join users u on u.id=k.user_id where k.key_hash=?", hash(key));
        if (k == null) return null;
        db.update("update connector_keys set last_used=?, calls=calls+1 where id=?", Timestamp.from(Instant.now()), k.get("key_id"));
        return k;
    }
}
