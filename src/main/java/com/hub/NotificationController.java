package com.hub;

import com.conlangs.web.Auth;
import com.conlangs.web.Notifications;
import jakarta.servlet.http.HttpSession;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The bell: the logged-in account's notifications. */
@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
    private final Auth auth;
    private final Notifications notifications;

    public NotificationController(Auth auth, Notifications notifications) {
        this.auth = auth;
        this.notifications = notifications;
    }

    @GetMapping
    public Map<String, Object> list(HttpSession s) {
        return notifications.list(auth.requireUid(s));
    }

    /** {id}: that one is seen; without an id, all are. */
    @PostMapping("/seen")
    public Map<String, Object> seen(@RequestBody(required = false) Map<String, Object> b, HttpSession s) {
        long uid = auth.requireUid(s);
        Object id = b == null ? null : b.get("id");
        notifications.seen(uid, id == null ? null : Long.valueOf(id.toString()));
        return notifications.list(uid);
    }
}
