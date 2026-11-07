package com.hub;

import com.conlangs.web.ApiException;
import com.conlangs.web.Auth;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The one login for the whole site. Logging in stores the user's id in the session ("uid"), which
 * both Root and Rune and the weather generator read.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final Auth auth;

    public AuthController(Auth auth) {
        this.auth = auth;
    }

    private static String str(Map<String, Object> b, String k) {
        Object v = b == null ? null : b.get(k);
        return v == null ? null : v.toString();
    }

    @GetMapping("/me")
    public Map<String, Object> me(HttpSession s) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("user", auth.current(s));
        out.put("registrationOpen", auth.registrationOpen());
        return out;
    }

    @PostMapping("/register")
    public Map<String, Object> register(@RequestBody Map<String, Object> b, HttpServletRequest req) {
        auth.register(str(b, "username"), str(b, "password"));
        auth.login(str(b, "username"), str(b, "password"), req);
        return me(req.getSession());
    }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody Map<String, Object> b, HttpServletRequest req) {
        auth.login(str(b, "username"), str(b, "password"), req);
        return me(req.getSession());
    }

    @PostMapping("/logout")
    public Map<String, Object> logout(HttpSession s) {
        auth.logout(s);
        return Map.of("ok", true);
    }

    /** With a one-time code from an admin (Root and Rune → Issue reset code). */
    @PostMapping("/reset")
    public Map<String, Object> reset(@RequestBody Map<String, Object> b) {
        auth.resetPassword(str(b, "username"), str(b, "code"), str(b, "password"));
        return Map.of("ok", true);
    }

    @PostMapping("/password")
    public Map<String, Object> password(@RequestBody Map<String, Object> b, HttpSession s) {
        long uid = auth.requireUid(s);
        if (str(b, "password") == null) throw new ApiException(400, "New password missing.");
        auth.changePassword(uid, str(b, "current"), str(b, "password"));
        return Map.of("ok", true);
    }
}
