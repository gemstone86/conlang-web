package com.eonweather.core;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The few HTTP concepts the API needs, independent of any web framework.
 * Spring Boot (and the dev server used for testing) adapt their requests to these.
 */
public final class Http {
    private Http() {}

    public interface Session {
        /** The logged-in user's id, or null. */
        Long userId();
        /** Log in: must also give the browser a new session id. */
        void login(long userId);
        void logout();
    }

    public interface Request {
        String method();
        /** Path under /api, e.g. "/day". */
        String path();
        String query(String name);
        String header(String name);
        byte[] body();
        Session session();
        /** Client address, used for login throttling. */
        String remoteAddress();
    }

    public static final class Response {
        public final int status;
        public final String contentType;
        public final byte[] body;
        public final Map<String, String> headers = new LinkedHashMap<>();

        public Response(int status, String contentType, byte[] body) {
            this.status = status;
            this.contentType = contentType;
            this.body = body;
        }

        public static Response json(int status, Object o) {
            return new Response(status, "application/json; charset=utf-8", Json.write(o).getBytes(StandardCharsets.UTF_8));
        }

        public static Response json(Object o) { return json(200, o); }

        public Response header(String k, String v) { headers.put(k, v); return this; }
    }
}
