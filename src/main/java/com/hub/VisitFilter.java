package com.hub;

import com.conlangs.web.Db;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Date;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Counts the visitors of the site's pages, per day, for the admin dashboard, without cookies and without keeping
 * anyone's address. A visitor is a code made from the address and the browser's name mixed with a random salt that
 * lives only in memory and is thrown away at midnight (UTC); the codes are kept in memory for the day, only to tell
 * whether this visitor has been counted already, and are never written down. What is stored is how many different
 * visitors and how many page views each day had, per start page, Root and Rune and the weather generator, and for the
 * site as a whole (area "all"). So a visitor can be counted again on another day, and again if the server restarts
 * in the middle of a day. Robots, browsers that send Do Not Track or Global Privacy Control, and everything that is
 * not a page (the API, scripts, images) are left out.
 */
@Component
public class VisitFilter extends OncePerRequestFilter {
    private static final Pattern BOT = Pattern.compile("bot|crawl|spider|slurp|curl/|wget|python-requests|monitor|uptime|preview|facebookexternalhit", Pattern.CASE_INSENSITIVE);
    private static final long KEEP_DAYS = 800;

    private final Db db;
    private final SecureRandom random = new SecureRandom();
    private byte[] salt;
    private LocalDate saltDay;
    private final Set<String> seenAll = new HashSet<>();
    private final Set<String> seenArea = new HashSet<>();

    public VisitFilter(Db db) { this.db = db; }

    /** "home", "rune" or "weather" for a page of the site, else null. */
    static String area(String path) {
        return switch (path) {
            case "/", "/index.html" -> "home";
            case "/rune/", "/rune/index.html" -> "rune";
            case "/weather/", "/weather/index.html" -> "weather";
            default -> null;
        };
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        chain.doFilter(req, res);
        try {
            if (!"GET".equals(req.getMethod()) || res.getStatus() != 200) return;
            String area = area(req.getRequestURI());
            if (area == null) return;
            String ua = req.getHeader("User-Agent");
            if (ua == null || ua.isBlank() || BOT.matcher(ua).find()) return;
            if ("1".equals(req.getHeader("DNT")) || "1".equals(req.getHeader("Sec-GPC"))) return;
            count(area, req.getRemoteAddr() + "|" + ua);
        } catch (RuntimeException e) {
            logger.debug("Visit not counted: " + e.getMessage());    // counting must never get in the way of a page
        }
    }

    private synchronized void count(String area, String who) {
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        if (!today.equals(saltDay)) {
            salt = new byte[16];
            random.nextBytes(salt);
            saltDay = today;
            seenAll.clear();
            seenArea.clear();
            db.update("delete from visit_stats where visit_day < ?", Date.valueOf(today.minusDays(KEEP_DAYS)));
        }
        String code = hash(who);
        boolean newToSite = seenAll.add(code), newToArea = seenArea.add(area + ":" + code);
        bump(today, area, newToArea ? 1 : 0);
        bump(today, "all", newToSite ? 1 : 0);
    }

    private void bump(LocalDate day, String area, int unique) {
        Date d = Date.valueOf(day);
        if (db.update("update visit_stats set views = views + 1, uniques = uniques + ? where visit_day = ? and area = ?", unique, d, area) == 0)
            db.update("insert into visit_stats (visit_day, area, uniques, views) values (?, ?, ?, 1)", d, area, unique);
    }

    private String hash(String who) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(salt);
            byte[] h = md.digest(who.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 12; i++) sb.append(String.format("%02x", h[i]));
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
