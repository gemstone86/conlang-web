package com.hub;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Changing requests to the apps' APIs must come from the site's own pages: a request a browser sends from another
 * site (it says so in Sec-Fetch-Site, and names the other site in Origin) is refused, for Root and Rune, the weather
 * generator and the login alike. Programs that aren't browsers (the tests, scripts, the Claude connector) send
 * neither header and are not affected; they have no session cookie to misuse anyway.
 */
@Component
public class SameOriginFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        String m = req.getMethod(), path = req.getRequestURI();
        boolean changing = !(m.equals("GET") || m.equals("HEAD") || m.equals("OPTIONS"));
        boolean api = path.startsWith("/api/") || path.startsWith("/rune/api/") || path.startsWith("/weather/api/");
        if (changing && api && fromAnotherSite(req)) {
            res.setStatus(403);
            res.setContentType("application/json;charset=UTF-8");
            res.getWriter().write("{\"error\":\"This request came from another site.\"}");
            return;
        }
        chain.doFilter(req, res);
    }

    static boolean fromAnotherSite(HttpServletRequest req) {
        if ("cross-site".equalsIgnoreCase(req.getHeader("Sec-Fetch-Site"))) return true;
        String origin = req.getHeader("Origin");
        if (origin == null || origin.isBlank()) return false;
        try {
            String host = URI.create(origin).getHost();
            return host == null || !host.equalsIgnoreCase(req.getServerName());
        } catch (IllegalArgumentException e) {
            return true;                      // "null" (a sandboxed page, a file) or nonsense
        }
    }
}
