package com.conlangs.web;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Accounts moved over from the separate weather generator keep their old passwords (its "pbkdf2$…" format). */
class AuthLegacyTest {
    /** Made by the weather generator 2.18's own com.eonweather.core.Passwords.hash("hemligt-lösen-1"). */
    private static final String OLD = "pbkdf2$210000$LlHPkKq6eQ1akAsrQ2xRYA==$YyMDWV8VtpipbBENg1AR5V0A2GE+lp4xGiyDSdDVQwk=";

    private static Map<String, Object> user(String hash, String salt) {
        Map<String, Object> u = new HashMap<>();
        u.put("pw_hash", hash);
        u.put("salt", salt);
        return u;
    }

    @Test
    void oldWeatherPasswordsStillWork() {
        Map<String, Object> u = user(OLD, "pbkdf2");
        assertTrue(Auth.matches("hemligt-lösen-1", u));
        assertFalse(Auth.matches("hemligt-lösen-2", u));
        assertFalse(Auth.matches("", u));
    }

    @Test
    void brokenOrSystemAccountsNeverMatch() {
        assertFalse(Auth.matches("x", user("pbkdf2$210000$not base64$", "pbkdf2")));
        assertFalse(Auth.matches("x", user("pbkdf2$abc$AA==$AA==", "pbkdf2")));
        assertFalse(Auth.matches("!", user("!", "!")));               // the standard map's owner, '@eon'
    }
}
