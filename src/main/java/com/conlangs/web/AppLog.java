package com.conlangs.web;

import jakarta.servlet.http.HttpSession;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/** Application log kept in the database so the admin can read it in the Log page. Never throws. */
@Service
public class AppLog {
    private static final Logger LOG = LoggerFactory.getLogger("conlang");
    private static final int KEEP = 5000;
    private final Db db;

    public AppLog(Db db) {
        this.db = db;
    }

    public static Long uid(HttpSession s) {
        Object o = s == null ? null : s.getAttribute("uid");
        return o instanceof Number n ? n.longValue() : null;
    }

    public void info(String category, Long uid, String message) {
        write("INFO", category, uid, null, null, message, null);
    }

    public void info(String category, Long uid, String message, String detail) {
        write("INFO", category, uid, null, null, message, detail);
    }

    public void warn(String category, Long uid, String request, Integer status, String message) {
        write("WARN", category, uid, request, status, message, null);
    }

    public void warn(String category, Long uid, String request, Integer status, String message, String detail) {
        write("WARN", category, uid, request, status, message, detail);
    }

    /** Logs an unexpected error with its stack trace and returns the log id (0 if it could not be stored). */
    public long error(String category, Long uid, String request, Integer status, String message, Throwable t) {
        StringWriter sw = new StringWriter();
        if (t != null) t.printStackTrace(new PrintWriter(sw));
        return write("ERROR", category, uid, request, status, message, sw.toString());
    }

    private long write(String lvl, String category, Long uid, String request, Integer status, String message, String detail) {
        String line = "[" + category + "] " + (request == null ? "" : request + " ") + (message == null ? "" : message);
        if (lvl.equals("ERROR")) LOG.error("{}{}", line, detail == null ? "" : "\n" + detail);
        else if (lvl.equals("WARN")) LOG.warn(line);
        else LOG.info(line);
        try {
            String user = null;
            if (uid != null) {
                Map<String, Object> u = db.one("select username from users where id=?", uid);
                if (u != null) user = (String) u.get("username");
            }
            long id = db.insert("insert into app_log(lvl, category, username, request, status, message, detail) values (?,?,?,?,?,?,?)",
                    lvl, category, user, cut(request, 400), status, cut(message, 4000), cut(detail, 100000));
            if (id > 0 && id % 200 == 0) db.update("delete from app_log where id < ?", id - KEEP);
            return id;
        } catch (RuntimeException e) {
            LOG.error("Could not write to app_log: {}", e.toString());
            return 0;
        }
    }

    private static String cut(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max - 3) + "...";
    }
}
