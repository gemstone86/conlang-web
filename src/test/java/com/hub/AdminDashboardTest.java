package com.hub;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import java.io.ByteArrayOutputStream;
import java.net.CookieManager;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** The admin dashboard (/admin/ and /api/admin/users), on a fresh database of its own. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AdminDashboardTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/admin-" + System.nanoTime()
                + ";MODE=PostgreSQL;NON_KEYWORDS=YEAR;DB_CLOSE_ON_EXIT=FALSE");
    }

    @LocalServerPort
    int port;

    private HttpClient client() {
        return HttpClient.newBuilder().cookieHandler(new CookieManager()).build();
    }

    private HttpResponse<String> get(HttpClient c, String path) throws Exception {
        return c.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET().build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> post(HttpClient c, String path, String json, boolean eonHeader) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(json));
        if (eonHeader) b.header("X-Eon-Request", "1");
        return c.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    private final ObjectMapper om = new ObjectMapper();

    private JsonNode user(JsonNode list, String name) {
        for (JsonNode u : list.path("users")) if (u.path("username").asText().equals(name)) return u;
        return null;
    }

    @Test
    void dashboard() throws Exception {
        HttpClient admin = client();
        post(admin, "/api/auth/register", "{\"username\":\"boss\",\"password\":\"secret-pass\"}", false);
        HttpClient member = client();
        post(member, "/api/auth/register", "{\"username\":\"member1\",\"password\":\"secret-pass\"}", false);
        HttpClient weatherAdmin = client();
        post(weatherAdmin, "/api/auth/register", "{\"username\":\"Gemstone86\",\"password\":\"secret-pass\"}", false);

        // the member owns some things in both apps
        long world = om.readTree(post(member, "/rune/api/worlds", "{\"name\":\"Mine\"}", false).body()).path("id").asLong();
        long lang = om.readTree(post(member, "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"L\"}", false).body()).path("id").asLong();
        for (String w : new String[]{"water", "fire"})
            post(member, "/rune/api/languages/" + lang + "/edit", "{\"entity\":\"word\",\"action\":\"CREATE\",\"payload\":{\"gloss\":\"" + w + "\",\"form\":\"a\",\"year\":0}}", false);
        post(member, "/weather/api/campaigns", "{\"name\":\"Campaign\"}", true);
        post(admin, "/rune/api/worlds", "{\"name\":\"Boss world\"}", false);
        long bossWorld = om.readTree(get(admin, "/rune/api/worlds").body()).get(0).path("id").asLong();
        post(admin, "/rune/api/shares", "{\"scope\":\"WORLD\",\"targetId\":" + bossWorld + ",\"username\":\"member1\",\"level\":\"VIEWER\"}", false);
        // a login is recorded
        HttpClient again = client();
        assertEquals(200, post(again, "/api/auth/login", "{\"username\":\"member1\",\"password\":\"secret-pass\"}", false).statusCode());

        // admins only
        assertEquals(403, get(member, "/api/admin/users").statusCode());
        assertEquals(401, get(client(), "/api/admin/users").statusCode());
        HttpResponse<String> r = get(admin, "/api/admin/users");
        assertEquals(200, r.statusCode(), r.body());
        JsonNode d = om.readTree(r.body());
        assertEquals(3, d.path("users").size(), "every account, not the built-in weather one: " + r.body());
        assertFalse(r.body().contains("@eon"));
        assertFalse(r.body().contains("pw_hash") || r.body().contains("salt"), "no password data");
        JsonNode m = user(d, "member1");
        assertEquals(1, m.path("worlds").asInt());
        assertEquals(1, m.path("languages").asInt());
        assertEquals(2, m.path("words").asInt());
        assertEquals(1, m.path("campaigns").asInt());
        assertEquals(1, m.path("shared_with").asInt());
        assertFalse(m.path("is_admin").asBoolean());
        assertFalse(m.path("last_login").isNull(), "logged in: " + m);
        JsonNode b = user(d, "boss");
        assertTrue(b.path("is_admin").asBoolean() && b.path("weather_admin").asBoolean());
        JsonNode g = user(d, "Gemstone86");
        assertFalse(g.path("is_admin").asBoolean());
        assertTrue(g.path("weather_admin").asBoolean(), "named in EON_ADMINS (default list)");
        assertEquals(3, d.path("totals").path("users").asInt());
        assertEquals(1, d.path("totals").path("admins").asInt());
        assertEquals(2, d.path("totals").path("worlds").asInt());

        // the page, and the links to it
        HttpResponse<String> page = get(admin, "/admin/");
        assertEquals(200, page.statusCode());
        assertTrue(page.body().contains("/api/admin/users"));
        assertEquals(302, get(admin, "/admin").statusCode());
        assertTrue(get(admin, "/").body().contains("href=\"/admin/\""), "start page links the dashboard");
        assertTrue(get(admin, "/rune/js/core.js").body().contains("href=\"/admin/\""), "Root and Rune's admin badge links it");
    }
}
