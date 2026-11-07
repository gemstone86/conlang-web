package com.eonweather.web;

import com.eonweather.core.Api;
import com.eonweather.core.Http;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

/**
 * Adapts every /weather/api/** request to the framework-free {@link Api}. The logged-in user is the
 * site-wide one (session attribute "uid", set by com.hub.AuthController).
 */
@RestController("weatherApiController")
public class ApiController {
    private static final String USER_ATTR = "uid";
    private final Api api;

    public ApiController(Api api) {
        this.api = api;
    }

    @RequestMapping("/weather/api/**")
    public void handle(HttpServletRequest req, HttpServletResponse res) throws IOException {
        byte[] body = req.getInputStream().readAllBytes();
        String path = req.getRequestURI().substring(req.getContextPath().length() + "/weather/api".length());

        Http.Session session = new Http.Session() {
            @Override public Long userId() {
                HttpSession s = req.getSession(false);
                Object v = s == null ? null : s.getAttribute(USER_ATTR);
                return v instanceof Number n ? n.longValue() : null;
            }
            @Override public void login(long userId) {
                req.getSession(true);
                req.changeSessionId(); // new id on login: stops session fixation
                req.getSession().setAttribute(USER_ATTR, userId);
            }
            @Override public void logout() {
                HttpSession s = req.getSession(false);
                if (s != null) s.invalidate();
            }
        };

        Http.Request request = new Http.Request() {
            @Override public String method() { return req.getMethod(); }
            @Override public String path() { return path; }
            @Override public String query(String name) { return req.getParameter(name); }
            @Override public String header(String name) { return req.getHeader(name); }
            @Override public byte[] body() { return body; }
            @Override public Http.Session session() { return session; }
            @Override public String remoteAddress() { return req.getRemoteAddr(); }
        };

        Http.Response out = api.handle(request);
        res.setStatus(out.status);
        res.setContentType(out.contentType);
        res.setHeader("Cache-Control", "no-store");
        out.headers.forEach(res::setHeader);
        res.setContentLength(out.body.length);
        res.getOutputStream().write(out.body);
    }
}
