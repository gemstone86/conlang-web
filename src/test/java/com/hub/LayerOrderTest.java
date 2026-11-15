package com.hub;

import static org.junit.jupiter.api.Assertions.assertEquals;
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

/** The order of the map layers: only the admins set it, on the standard map; it is saved and is part of the export. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class LayerOrderTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/layers-" + System.nanoTime()
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

    @Test
    void onlyAdminsSetTheOrderAndItIsExported() throws Exception {
        HttpClient admin = client(), member = client(), anon = client();
        assertEquals(200, send(admin, "POST", "/api/auth/register", "{\"username\":\"boss\",\"password\":\"secret-pass\"}", false).statusCode());
        assertEquals(200, send(member, "POST", "/api/auth/register", "{\"username\":\"someone\",\"password\":\"secret-pass\"}", false).statusCode());

        long mapId = -1;
        for (JsonNode m : json.readTree(get(admin, "/weather/api/maps").body())) if (m.path("isDefault").asBoolean()) mapId = m.path("id").asLong();
        assertTrue(mapId > 0, "the standard map exists");
        String url = "/weather/api/maps/" + mapId + "/layer-order";
        String order = "{\"order\":[\"jargien\",\"forsta\",\"damarien\"]}";

        assertEquals(401, send(anon, "PUT", url, order, true).statusCode(), "not logged in");
        assertEquals(403, send(member, "PUT", url, order, true).statusCode(), "not an admin");

        assertEquals(400, send(admin, "PUT", url, "{\"order\":[\"a\",\"a\"]}", true).statusCode(), "a layer twice");
        assertEquals(400, send(admin, "PUT", url, "{\"order\":[\"../x\"]}", true).statusCode(), "not an id");
        assertEquals(400, send(admin, "PUT", url, "{\"order\":\"jargien\"}", true).statusCode(), "not a list");

        HttpResponse<String> ok = send(admin, "PUT", url, order, true);
        assertEquals(200, ok.statusCode(), ok.body());
        JsonNode got = json.readTree(ok.body()).path("settings").path("layerOrder");
        assertEquals(3, got.size());
        assertEquals("jargien", got.get(0).asText());
        assertEquals("damarien", got.get(2).asText());
        // the other settings of the standard map are still there
        assertTrue(json.readTree(ok.body()).path("settings").has("tiles"), ok.body());

        // everyone sees it
        JsonNode seen = json.readTree(get(anon, "/weather/api/maps/" + mapId).body()).path("settings").path("layerOrder");
        assertEquals("forsta", seen.get(1).asText());

        // and it is in the admin export, so the release can be made from it
        JsonNode export = json.readTree(get(admin, "/weather/api/maps/" + mapId + "/export?summary=1").body());
        assertEquals("jargien", export.path("changes").path("settings").path("layerOrder").get(0).asText(), export.toString());
        assertEquals(403, get(member, "/weather/api/maps/" + mapId + "/export?summary=1").statusCode());
    }
}
