package com.hub;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.CookieManager;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Cities (name, population, harbour) and the marshland layer: who may change them, what is checked, and that they are exported. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CitiesMarshTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/cities-" + System.nanoTime()
                + ";MODE=PostgreSQL;NON_KEYWORDS=YEAR;DB_CLOSE_ON_EXIT=FALSE");
    }

    @LocalServerPort
    int port;

    private final JsonMapper json = JsonMapper.builder().build();

    private HttpClient client() {
        return HttpClient.newBuilder().cookieHandler(new CookieManager()).build();
    }

    private HttpResponse<String> get(HttpClient c, String path) throws Exception {
        return c.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> send(HttpClient c, String method, String path, String body, boolean eon) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(body));
        if (eon) b.header("X-Eon-Request", "1");
        return c.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    // a 1 x 1 grey PNG (value 100)
    private static final byte[] PNG = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==");

    @Test
    void citiesAndMarshland() throws Exception {
        HttpClient admin = client(), member = client(), anon = client();
        assertEquals(200, send(admin, "POST", "/api/auth/register", "{\"username\":\"boss\",\"password\":\"secret-pass\"}", false).statusCode());
        assertEquals(200, send(member, "POST", "/api/auth/register", "{\"username\":\"someone\",\"password\":\"secret-pass\"}", false).statusCode());
        long mapId = -1;
        for (JsonNode m : json.readTree(get(admin, "/weather/api/maps").body())) if (m.path("isDefault").asBoolean()) mapId = m.path("id").asLong();
        assertTrue(mapId > 0);
        String url = "/weather/api/maps/" + mapId + "/cities";

        assertEquals(0, json.readTree(get(anon, url).body()).path("cities").size(), "none to begin with");
        String list = "[{\"id\":1,\"name\":\"Port\",\"population\":12000,\"harbour\":true,\"x\":0.4,\"y\":0.5},"
                + "{\"id\":2,\"name\":\"Inland\",\"population\":-5,\"x\":0.5,\"y\":0.5}]";
        assertEquals(401, send(anon, "PUT", url, list, true).statusCode(), "not logged in");
        assertEquals(403, send(member, "PUT", url, list, true).statusCode(), "only the owner (the admins, for the standard map)");
        assertEquals(400, send(admin, "PUT", url, "[{\"id\":1,\"x\":2,\"y\":0.5}]", true).statusCode(), "outside the map");
        assertEquals(400, send(admin, "PUT", url, "[{\"id\":1,\"x\":0.1,\"y\":0.5},{\"id\":1,\"x\":0.2,\"y\":0.5}]", true).statusCode(), "same id twice");
        HttpResponse<String> ok = send(admin, "PUT", url, list, true);
        assertEquals(200, ok.statusCode(), ok.body());

        JsonNode got = json.readTree(get(anon, url).body()).path("cities");
        assertEquals(2, got.size());
        assertEquals("Port", got.get(0).path("name").asText());
        assertEquals(12000, got.get(0).path("population").asLong());
        assertTrue(got.get(0).path("harbour").asBoolean());
        assertEquals(0, got.get(1).path("population").asLong(), "a negative population becomes 0");
        assertEquals(false, got.get(1).path("harbour").asBoolean());

        // marshland: a painted layer like the forests; only the owner paints it
        String murl = "/weather/api/maps/" + mapId + "/marsh";
        assertEquals(404, get(anon, murl).statusCode(), "none yet");
        HttpRequest put = HttpRequest.newBuilder(URI.create("http://localhost:" + port + murl)).header("Content-Type", "image/png")
                .header("X-Eon-Request", "1").PUT(HttpRequest.BodyPublishers.ofByteArray(PNG)).build();
        assertEquals(403, member.send(put, HttpResponse.BodyHandlers.ofString()).statusCode());
        HttpResponse<String> saved = admin.send(put, HttpResponse.BodyHandlers.ofString());
        assertEquals(200, saved.statusCode(), saved.body());
        assertTrue(json.readTree(saved.body()).path("hasMarsh").asBoolean(), saved.body());
        assertEquals(200, get(anon, murl).statusCode());

        // both are part of the admin export
        JsonNode summary = json.readTree(get(admin, "/weather/api/maps/" + mapId + "/export?summary=1").body());
        assertTrue(summary.path("changes").has("cities"), summary.toString());
        assertTrue(summary.path("changes").has("marsh"), summary.toString());
    }
}
