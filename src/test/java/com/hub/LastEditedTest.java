package com.hub;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

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

/** Roads (and the other list layers) carry "last edited": the time and the account, for the items a save changed. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class LastEditedTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/lastedit-" + System.nanoTime()
                + ";MODE=PostgreSQL;NON_KEYWORDS=YEAR;DB_CLOSE_ON_EXIT=FALSE");
    }

    @LocalServerPort
    int port;

    private final JsonMapper json = JsonMapper.builder().build();

    private HttpResponse<String> send(HttpClient c, String method, String path, String body) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).header("Content-Type", "application/json").header("X-Eon-Request", "1");
        return c.send((body == null ? b.method(method, HttpRequest.BodyPublishers.noBody()) : b.method(method, HttpRequest.BodyPublishers.ofString(body))).build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void savedItemsGetLastEdited() throws Exception {
        HttpClient admin = HttpClient.newBuilder().cookieHandler(new CookieManager()).build();
        assertEquals(200, send(admin, "POST", "/api/auth/register", "{\"username\":\"boss\",\"password\":\"secret-pass\"}").statusCode());
        long mapId = 0;
        for (JsonNode m : json.readTree(send(admin, "GET", "/weather/api/maps", null).body())) if (m.path("isDefault").asBoolean()) mapId = m.path("id").asLong();
        String url = "/weather/api/maps/" + mapId + "/roads";
        String a = "{\"id\":9001,\"name\":\"North road\",\"kind\":\"road\",\"points\":[{\"x\":0.1,\"y\":0.1},{\"x\":0.2,\"y\":0.2}]}";
        String b = "{\"id\":9002,\"name\":\"South road\",\"kind\":\"road\",\"points\":[{\"x\":0.3,\"y\":0.3},{\"x\":0.4,\"y\":0.4}]}";

        HttpResponse<String> first = send(admin, "PUT", url, "[" + a + "," + b + "]");
        assertEquals(200, first.statusCode(), first.body());
        JsonNode st = json.readTree(first.body()).path("stamps");
        assertTrue(st.has("9001") && st.has("9002"), first.body());
        assertEquals("boss", st.path("9001").get(1).asText());
        String t1 = st.path("9002").get(0).asText();
        assertTrue(t1.endsWith("Z"), t1);

        // the page's next save, with its version from the answer: only the renamed road is stamped again
        String rev = json.readTree(first.body()).path("rev").asText();
        Thread.sleep(1100);
        String a2 = a.replace("North road", "Old north road");
        HttpResponse<String> second = send(admin, "PUT", url + "?rev=" + rev, "[" + a2 + "," + b + "]");
        assertEquals(200, second.statusCode(), "the version from the first answer still fits: " + second.body());
        JsonNode st2 = json.readTree(second.body()).path("stamps");
        assertEquals(t1, st2.path("9002").get(0).asText(), "untouched: keeps its time");
        assertFalse(t1.equals(st2.path("9001").get(0).asText()), "renamed: new time");

        // read back, the items carry it too and the check did not strip it
        JsonNode got = json.readTree(send(admin, "GET", url, null).body());
        assertEquals(st2, got.path("stamps"));
        boolean found = false;
        for (JsonNode r : got.path("roads")) if (r.path("id").asLong() == 9001) { found = true; assertEquals("boss", r.path("editedBy").asText()); }
        assertTrue(found);
    }
}
