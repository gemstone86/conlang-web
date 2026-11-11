package com.hub;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Standard protective headers on every answer: other sites can't show the app inside a frame (clickjacking),
 * browsers don't guess file types, links to other sites don't carry the page address, and plugins and
 * &lt;base&gt; tricks are off. Over HTTPS, browsers are told to keep using HTTPS.
 * (Scripts and styles aren't restricted here: the pages use inline ones, and the weather map loads fonts from Google.)
 */
@Component
public class SecurityHeadersFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "SAMEORIGIN");
        res.setHeader("Content-Security-Policy", "frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
        res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        if (req.isSecure()) res.setHeader("Strict-Transport-Security", "max-age=31536000");
        chain.doFilter(req, res);
    }
}
