package com.hub;

import com.conlangs.web.Auth;
import com.conlangs.web.Db;
import jakarta.servlet.http.HttpSession;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The admin dashboard (/admin/): every account, with what it has in Root and Rune and the weather generator. Admins only. */
@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private final Auth auth;
    private final Db db;
    private final List<String> weatherAdmins;

    public AdminController(Auth auth, Db db, @Value("${EON_ADMINS:" + com.eonweather.core.Api.DEFAULT_ADMINS + "}") String eonAdmins) {
        this.auth = auth;
        this.db = db;
        this.weatherAdmins = Arrays.stream(eonAdmins.split(",")).map(String::trim).filter(a -> !a.isEmpty()).toList();
    }

    /** {users: [...], totals: {...}, registrationOpen}: one row per account (not the built-in weather account). */
    @GetMapping("/users")
    public Map<String, Object> users(HttpSession s) {
        auth.requireAdmin(s);
        List<Map<String, Object>> users = db.rows("select u.id, u.username, u.is_admin, u.created, u.last_login, "
                + "(select count(*) from worlds w where w.owner_id=u.id) as worlds, "
                + "(select count(*) from languages l where l.owner_id=u.id) as languages, "
                + "(select count(*) from words x join languages l on l.id=x.language_id where l.owner_id=u.id) as words, "
                + "(select count(*) from shares sh where sh.user_id=u.id) as shared_with, "
                + "(select count(*) from campaigns c where c.owner_id=u.id) as campaigns, "
                + "(select count(*) from maps m where m.owner_id=u.id and m.deleted_at is null) as maps, "
                + "(select count(*) from notes n where n.owner_id=u.id) as notes, "
                + "(select count(*) from connector_keys k where k.user_id=u.id) as connector_keys "
                + "from users u where " + Auth.REAL_USER + " order by lower(u.username)");
        Map<String, Long> totals = new LinkedHashMap<>();
        for (String k : List.of("worlds", "languages", "words", "campaigns", "maps", "notes")) totals.put(k, 0L);
        long admins = 0;
        for (Map<String, Object> u : users) {
            boolean site = Boolean.TRUE.equals(u.get("is_admin"));
            boolean weather = site || weatherAdmins.stream().anyMatch(a -> a.equalsIgnoreCase((String) u.get("username")));
            u.put("weather_admin", weather);
            if (site) admins++;
            for (String k : totals.keySet()) totals.merge(k, Db.num(u.get(k)), Long::sum);
        }
        Map<String, Object> t = new LinkedHashMap<>();
        t.put("users", (long) users.size());
        t.put("admins", admins);
        t.putAll(totals);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("users", new ArrayList<>(users));
        out.put("totals", t);
        out.put("registrationOpen", auth.registrationOpen());
        return out;
    }
}
