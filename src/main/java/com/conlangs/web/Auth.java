package com.conlangs.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Base64;
import java.util.Deque;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class Auth {
    private static final SecureRandom RND = new SecureRandom();
    /**
     * SQL condition for accounts people can log in as. The weather generator's built-in owner of the
     * standard map ('@eon') shares the users table but has no password (salt '!').
     */
    public static final String REAL_USER = "salt <> '!'";
    /** Brute-force guard: at most this many failed logins per username and address in the window. */
    private static final int MAX_LOGIN_FAILURES = 10;
    private static final long FAILURE_WINDOW_MS = 15 * 60 * 1000L;
    private final Map<String, Deque<Long>> loginFailures = new ConcurrentHashMap<>();
    private final Db db;
    private final boolean registration;
    private final AppLog applog;

    /** The weather generator's admin usernames (EON_ADMINS, or com.eonweather.core.Api.DEFAULT_ADMINS). */
    private final java.util.List<String> eonAdmins;

    public Auth(Db db, AppLog applog, @Value("${app.registration:true}") boolean registration,
                @Value("${EON_ADMINS:" + com.eonweather.core.Api.DEFAULT_ADMINS + "}") String eonAdmins) {
        this.db = db;
        this.applog = applog;
        this.registration = registration;
        this.eonAdmins = java.util.Arrays.stream(eonAdmins.split(",")).map(String::trim).filter(a -> !a.isEmpty()).toList();
    }

    public boolean registrationOpen() {
        return registration || db.count("select count(*) from users where " + REAL_USER) == 0;
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

    /**
     * Does the password match the account? Accounts moved over from the separate weather generator
     * (com.eonweather.core.WeatherImport) keep their old password in its format, "pbkdf2$iterations$salt$hash"
     * (salt column "pbkdf2"); the others use this app's (base64 hash, salt in its own column).
     */
    static boolean matches(String password, Map<String, Object> u) {
        String stored = (String) u.get("pw_hash"), salt = (String) u.get("salt");
        if (stored == null || "!".equals(salt)) return false;
        if (stored.startsWith("pbkdf2$")) return legacyMatches(password, stored);
        String h = hash(password, salt);
        return MessageDigest.isEqual(h.getBytes(StandardCharsets.UTF_8), stored.getBytes(StandardCharsets.UTF_8));
    }

    private static boolean legacyMatches(String password, String stored) {
        try {
            String[] p = stored.split("\\$");
            if (p.length != 4) return false;
            Base64.Decoder b = Base64.getDecoder();
            PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), b.decode(p[2]), Integer.parseInt(p[1]), 256);
            byte[] h = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
            return MessageDigest.isEqual(h, b.decode(p[3]));
        } catch (Exception e) {
            return false;
        }
    }

    /** After a login with an old-format password: stored again in this app's format. */
    private void upgradeHash(Map<String, Object> u, String password) {
        if (!String.valueOf(u.get("pw_hash")).startsWith("pbkdf2$")) return;
        String salt = newSalt();
        db.update("update users set pw_hash=?, salt=? where id=?", hash(password, salt), salt, u.get("id"));
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
        boolean first = db.count("select count(*) from users where " + REAL_USER) == 0;
        if (db.count("select count(*) from users where lower(username)=lower(?)", username) > 0)
            throw new ApiException(409, "That username is taken.");
        // The weather admins are named by username: once one of those accounts exists, nobody can register another.
        if (eonAdmins.stream().anyMatch(a -> a.equalsIgnoreCase(username))
                && eonAdmins.stream().anyMatch(a -> db.count("select count(*) from users where lower(username)=lower(?)", a) > 0))
            throw new ApiException(409, "That username is taken.");
        String salt = newSalt();
        long id = db.insert("insert into users(username, pw_hash, salt, is_admin) values (?,?,?,?)",
                username, hash(password, salt), salt, first);
        applog.info("auth", id, "Registered account '" + username + "'" + (first ? " (first account, made admin)" : ""));
        return id;
    }

    public long login(String username, String password, HttpServletRequest req) {
        String key = String.valueOf(username).toLowerCase(Locale.ROOT) + "|" + req.getRemoteAddr();
        if (tooManyFailures(key)) throw new ApiException(429, "Too many failed logins. Wait a few minutes and try again.");
        Map<String, Object> u = username == null ? null : db.one("select * from users where lower(username)=lower(?) and " + REAL_USER, username);
        // Always hash, so timing doesn't reveal whether the user exists.
        if (u == null) hash(password == null ? "" : password, newSalt());
        if (u == null || !matches(password == null ? "" : password, u)) {
            applog.warn("auth", null, "POST /api/auth/login", 401, "Failed login for '" + username + "'" + (u == null ? " (no such user)" : " (wrong password)"));
            recordFailure(key);
            throw new ApiException(401, "Wrong username or password.");
        }
        loginFailures.remove(key);
        upgradeHash(u, password);
        req.getSession(true);
        req.changeSessionId();
        long id = Db.num(u.get("id"));
        req.getSession().setAttribute("uid", id);
        db.update("update users set last_login=? where id=?", new Timestamp(System.currentTimeMillis()), id);
        applog.info("auth", id, "Logged in");
        return id;
    }

    private boolean tooManyFailures(String key) {
        Deque<Long> d = loginFailures.get(key);
        if (d == null) return false;
        synchronized (d) {
            long cutoff = System.currentTimeMillis() - FAILURE_WINDOW_MS;
            while (!d.isEmpty() && d.peekFirst() < cutoff) d.pollFirst();
            return d.size() >= MAX_LOGIN_FAILURES;
        }
    }

    private void recordFailure(String key) {
        if (loginFailures.size() > 50_000) loginFailures.clear(); // crude memory cap
        Deque<Long> d = loginFailures.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (d) { d.addLast(System.currentTimeMillis()); }
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
        Map<String, Object> u = db.one("select id from users where lower(username)=lower(?) and " + REAL_USER, username);
        if (u == null) throw new ApiException(404, "No such user.");
        byte[] b = new byte[6];
        RND.nextBytes(b);
        String code = HexFormat.of().formatHex(b).toUpperCase();
        db.update("delete from reset_codes where user_id=?", u.get("id"));
        db.update("insert into reset_codes(user_id, code_hash, expires) values (?,?,?)",
                u.get("id"), sha256(code), Timestamp.from(Instant.now().plusSeconds(86400)));
        return code;
    }

    /** A logged-in user changes their own password. */
    public void changePassword(long uid, String current, String newPassword) {
        Map<String, Object> u = db.one("select * from users where id=?", uid);
        if (u == null) throw new ApiException(401, "Please log in.");
        if (!matches(current == null ? "" : current, u))
            throw new ApiException(403, "Current password is wrong.");
        checkPassword(newPassword);
        String salt = newSalt();
        db.update("update users set pw_hash=?, salt=? where id=?", hash(newPassword, salt), salt, uid);
        applog.info("auth", uid, "Changed password");
    }

    public void resetPassword(String username, String code, String newPassword) {
        checkPassword(newPassword);
        Map<String, Object> u = username == null ? null : db.one("select id from users where lower(username)=lower(?) and " + REAL_USER, username);
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
