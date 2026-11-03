package com.conlangs.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class Auth {
    private static final SecureRandom RND = new SecureRandom();
    private final Db db;
    private final boolean registration;
    private final AppLog applog;

    public Auth(Db db, AppLog applog, @Value("${conlang.registration:true}") boolean registration) {
        this.db = db;
        this.applog = applog;
        this.registration = registration;
    }

    public boolean registrationOpen() {
        return registration || db.count("select count(*) from users") == 0;
    }

    private static String hash(String password, String salt) {
        try {
            PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), Base64.getDecoder().decode(salt), 120_000, 256);
            byte[] h = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
            return Base64.getEncoder().encodeToString(h);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String newSalt() {
        byte[] b = new byte[16];
        RND.nextBytes(b);
        return Base64.getEncoder().encodeToString(b);
    }

    private static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static void checkPassword(String pw) {
        if (pw == null || pw.length() < 8) throw new ApiException(400, "Password must be at least 8 characters.");
    }

    public long register(String username, String password) {
        if (!registrationOpen()) throw new ApiException(403, "Registration is closed.");
        if (username == null || !username.matches("[A-Za-z0-9_.-]{3,32}"))
            throw new ApiException(400, "Username must be 3-32 characters: letters, digits, _ . -");
        checkPassword(password);
        boolean first = db.count("select count(*) from users") == 0;
        if (db.count("select count(*) from users where lower(username)=lower(?)", username) > 0)
            throw new ApiException(409, "That username is taken.");
        String salt = newSalt();
        long id = db.insert("insert into users(username, pw_hash, salt, is_admin) values (?,?,?,?)",
                username, hash(password, salt), salt, first);
        applog.info("auth", id, "Registered account '" + username + "'" + (first ? " (first account, made admin)" : ""));
        return id;
    }

    public long login(String username, String password, HttpServletRequest req) {
        Map<String, Object> u = username == null ? null : db.one("select * from users where lower(username)=lower(?)", username);
        // Always hash, so timing doesn't reveal whether the user exists.
        String salt = u == null ? newSalt() : (String) u.get("salt");
        String h = hash(password == null ? "" : password, salt);
        if (u == null || !MessageDigest.isEqual(h.getBytes(StandardCharsets.UTF_8), ((String) u.get("pw_hash")).getBytes(StandardCharsets.UTF_8))) {
            applog.warn("auth", null, "POST /api/auth/login", 401, "Failed login for '" + username + "'" + (u == null ? " (no such user)" : " (wrong password)"));
            throw new ApiException(401, "Wrong username or password.");
        }
        req.getSession(true);
        req.changeSessionId();
        long id = Db.num(u.get("id"));
        req.getSession().setAttribute("uid", id);
        applog.info("auth", id, "Logged in");
        return id;
    }

    public void logout(HttpSession s) {
        s.invalidate();
    }

    /** Returns the user row or null. */
    public Map<String, Object> current(HttpSession s) {
        Object uid = s == null ? null : s.getAttribute("uid");
        if (uid == null) return null;
        return db.one("select id, username, is_admin from users where id=?", uid);
    }

    public long requireUid(HttpSession s) {
        Map<String, Object> u = current(s);
        if (u == null) throw new ApiException(401, "Please log in.");
        return Db.num(u.get("id"));
    }

    public long requireAdmin(HttpSession s) {
        Map<String, Object> u = current(s);
        if (u == null) throw new ApiException(401, "Please log in.");
        if (!Boolean.TRUE.equals(u.get("is_admin"))) throw new ApiException(403, "Admin only.");
        return Db.num(u.get("id"));
    }

    /** Admin issues a one-time reset code (valid 24h). Returns the plaintext code, shown once. */
    public String issueResetCode(String username) {
        Map<String, Object> u = db.one("select id from users where lower(username)=lower(?)", username);
        if (u == null) throw new ApiException(404, "No such user.");
        byte[] b = new byte[6];
        RND.nextBytes(b);
        String code = HexFormat.of().formatHex(b).toUpperCase();
        db.update("delete from reset_codes where user_id=?", u.get("id"));
        db.update("insert into reset_codes(user_id, code_hash, expires) values (?,?,?)",
                u.get("id"), sha256(code), Timestamp.from(Instant.now().plusSeconds(86400)));
        return code;
    }

    public void resetPassword(String username, String code, String newPassword) {
        checkPassword(newPassword);
        Map<String, Object> u = username == null ? null : db.one("select id from users where lower(username)=lower(?)", username);
        Map<String, Object> rc = u == null || code == null ? null
                : db.one("select id, expires from reset_codes where user_id=? and code_hash=?", u.get("id"), sha256(code.trim().toUpperCase()));
        if (rc == null || ((Timestamp) rc.get("expires")).toInstant().isBefore(Instant.now()))
            throw new ApiException(400, "Invalid or expired reset code.");
        String salt = newSalt();
        db.update("update users set pw_hash=?, salt=? where id=?", hash(newPassword, salt), salt, u.get("id"));
        db.update("delete from reset_codes where user_id=?", u.get("id"));
        applog.info("auth", Db.num(u.get("id")), "Password reset with a reset code");
    }
}
