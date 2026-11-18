package com.hub;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.net.CookieManager;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Visitors are counted per day without cookies: pages only, no robots, no one who asks not to be tracked; only admins read the numbers. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class VisitorsTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/visits-" + System.nanoTime()
                + ";MODE=PostgreSQL;NON_KEYWORDS=YEAR;DB_CLOSE_ON_EXIT=FALSE");
    }

    @LocalServerPort
    int port;

    private final JsonMapper json = JsonMapper.builder().build();

    private int page(String path, String agent, String... more) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET();
        if (agent != null) b.header("User-Agent", agent);
        for (int i = 0; i < more.length; i += 2) b.header(more[i], more[i + 1]);
        return HttpClient.newHttpClient().send(b.build(), HttpResponse.BodyHandlers.ofString()).statusCode();
    }

    @Test
    void countsDifferentVisitorsOncePerDay() throws Exception {
        HttpClient admin = HttpClient.newBuilder().cookieHandler(new CookieManager()).build();
        HttpRequest reg = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/auth/register"))
                .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString("{\"username\":\"boss\",\"password\":\"secret-pass\"}")).build();
        assertEquals(200, admin.send(reg, HttpResponse.BodyHandlers.ofString()).statusCode());

        assertEquals(200, page("/", "Mozilla/5.0 Alpha"));
        assertEquals(200, page("/", "Mozilla/5.0 Alpha"));              // same visitor again: a view, not a new visitor
        assertEquals(200, page("/rune/", "Mozilla/5.0 Alpha"));
        assertEquals(200, page("/", "Mozilla/5.0 Beta"));               // another browser: a second visitor
        assertEquals(200, page("/", "Googlebot/2.1"));                  // robot
        assertEquals(200, page("/", "Mozilla/5.0 Gamma", "DNT", "1"));  // asks not to be tracked
        page("/api/auth/me", "Mozilla/5.0 Delta");                      // not a page
        page("/rune/js/tabs.js", "Mozilla/5.0 Delta");                  // not a page

        HttpResponse<String> r = admin.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/admin/visits")).GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, r.statusCode());
        JsonNode d = json.readTree(r.body());
        assertEquals(1, d.get("days").size());
        JsonNode today = d.get("days").get(0);
        assertEquals(2, today.get("all").get("uniques").asInt());
        assertEquals(4, today.get("all").get("views").asInt());
        assertEquals(2, today.get("home").get("uniques").asInt());
        assertEquals(3, today.get("home").get("views").asInt());
        assertEquals(1, today.get("rune").get("uniques").asInt());
        assertEquals(2, d.get("total").get("uniques").asInt());

        int anon = HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/admin/visits")).GET().build(),
                HttpResponse.BodyHandlers.ofString()).statusCode();
        assertEquals(true, anon == 401 || anon == 403);
    }
}
