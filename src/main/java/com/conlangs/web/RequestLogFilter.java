package com.conlangs.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Notes slow API requests in the admin log. */
@Component
public class RequestLogFilter extends OncePerRequestFilter {
    private static final long SLOW_MS = 1500;
    private final AppLog applog;

    public RequestLogFilter(AppLog applog) {
        this.applog = applog;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        long t0 = System.currentTimeMillis();
        try {
            chain.doFilter(req, res);
        } finally {
            long ms = System.currentTimeMillis() - t0;
            if (ms >= SLOW_MS && req.getRequestURI().startsWith("/api/") && !req.getRequestURI().startsWith("/api/admin/log")) {
                applog.warn("system", AppLog.uid(req.getSession(false)), req.getMethod() + " " + req.getRequestURI(), res.getStatus(), "Slow request: " + ms + " ms");
            }
        }
    }
}
