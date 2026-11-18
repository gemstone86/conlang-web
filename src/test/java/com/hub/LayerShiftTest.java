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

/** Moving a map layer: only the admins, on the standard map; it is saved, shown to everyone and part of the export. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class LayerShiftTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/shift-" + System.nanoTime()
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

    /** The first account of the database is the admin; the second test of the class finds them already registered. */
    private void account(HttpClient c, String name) throws Exception {
        String body = "{\"username\":\"" + name + "\",\"password\":\"secret-pass\"}";
        if (send(c, "POST", "/api/auth/register", body, false).statusCode() == 409)
            assertEquals(200, send(c, "POST", "/api/auth/login", body, false).statusCode());
    }

    @Test
    void onlyAdminsMoveALayer() throws Exception {
        HttpClient admin = client(), member = client(), anon = client();
        account(admin, "boss");
        account(member, "someone");
        long mapId = -1;
        for (JsonNode m : json.readTree(get(admin, "/weather/api/maps").body())) if (m.path("isDefault").asBoolean()) mapId = m.path("id").asLong();
        String url = "/weather/api/maps/" + mapId + "/layer-shift";
        String body = "{\"layer\":\"forion\",\"dx\":16,\"dy\":-8}";

        assertEquals(401, send(anon, "PUT", url, body, true).statusCode());
        assertEquals(403, send(member, "PUT", url, body, true).statusCode());
        assertEquals(400, send(admin, "PUT", url, "{\"layer\":\"../x\",\"dx\":1,\"dy\":1}", true).statusCode());
        assertEquals(400, send(admin, "PUT", url, "{\"layer\":\"forion\",\"dx\":99999,\"dy\":1}", true).statusCode());
        assertEquals(400, send(admin, "PUT", url, "{\"layer\":\"forion\"}", true).statusCode());

        HttpResponse<String> ok = send(admin, "PUT", url, body, true);
        assertEquals(200, ok.statusCode(), ok.body());
        JsonNode s = json.readTree(ok.body()).path("settings").path("layerShift");
        assertEquals(16, s.path("forion").get(0).asInt());
        assertEquals(-8, s.path("forion").get(1).asInt());
        assertTrue(json.readTree(ok.body()).path("settings").has("tiles"));

        // a second layer keeps the first
        assertEquals(200, send(admin, "PUT", url, "{\"layer\":\"cermira\",\"dx\":0,\"dy\":8}", true).statusCode());
        JsonNode seen = json.readTree(get(anon, "/weather/api/maps/" + mapId).body()).path("settings").path("layerShift");
        assertEquals(5, seen.size());

        // in the admin export
        JsonNode export = json.readTree(get(admin, "/weather/api/maps/" + mapId + "/export?summary=1").body());
        assertEquals(16, export.path("changes").path("settings").path("layerShift").path("forion").get(0).asInt(), export.toString());

        // scale: kept with the move, limited, and 1 means none
        HttpResponse<String> sc = send(admin, "PUT", url, "{\"layer\":\"forion\",\"dx\":16,\"dy\":-8,\"scale\":1.005}", true);
        assertEquals(200, sc.statusCode(), sc.body());
        assertEquals(1.005, json.readTree(sc.body()).path("settings").path("layerShift").path("forion").get(2).asDouble(), 1e-9);
        assertEquals(400, send(admin, "PUT", url, "{\"layer\":\"forion\",\"dx\":0,\"dy\":0,\"scale\":2}", true).statusCode());
        assertEquals(400, send(admin, "PUT", url, "{\"layer\":\"forion\",\"dx\":0,\"dy\":0,\"scale\":\"big\"}", true).statusCode());
        assertEquals(200, send(admin, "PUT", url, "{\"layer\":\"forion\",\"dx\":0,\"dy\":0,\"scale\":1.01}", true).statusCode(), "scaled only is still a change");
        assertEquals(5, json.readTree(get(anon, "/weather/api/maps/" + mapId).body()).path("settings").path("layerShift").size(), "the release ships three");

        // 0, 0 puts a layer back; the last one removes the setting
        assertEquals(200, send(admin, "PUT", url, "{\"layer\":\"forion\",\"dx\":0,\"dy\":0,\"scale\":1}", true).statusCode());
        assertEquals(200, send(admin, "PUT", url, "{\"layer\":\"cermira\",\"dx\":0,\"dy\":0}", true).statusCode());
        JsonNode left = json.readTree(get(anon, "/weather/api/maps/" + mapId).body()).path("settings").path("layerShift");
        assertEquals(3, left.size(), "only the release's own moves are left");
        assertEquals(24, left.path("egor").get(0).asInt());
        assertEquals(-20, left.path("egor").get(1).asInt());
        assertEquals(16, left.path("consaber").get(0).asInt());
        assertEquals(-12, left.path("jargien").get(1).asInt());
        assertEquals(-2, left.path("consaber").get(1).asInt());
    }

    @Test
    void onlyAdminsSetTransparency() throws Exception {
        HttpClient admin = client(), member = client(), anon = client();
        account(admin, "boss");
        account(member, "someone");
        long mapId = -1;
        for (JsonNode m : json.readTree(get(admin, "/weather/api/maps").body())) if (m.path("isDefault").asBoolean()) mapId = m.path("id").asLong();
        String url = "/weather/api/maps/" + mapId + "/layer-transparency";
        assertEquals(401, send(anon, "PUT", url, "{\"layer\":\"consaber\",\"percent\":50}", true).statusCode());
        assertEquals(403, send(member, "PUT", url, "{\"layer\":\"consaber\",\"percent\":50}", true).statusCode());
        assertEquals(400, send(admin, "PUT", url, "{\"layer\":\"consaber\",\"percent\":101}", true).statusCode());
        assertEquals(400, send(admin, "PUT", url, "{\"layer\":\"../x\",\"percent\":5}", true).statusCode());
        assertEquals(400, send(admin, "PUT", url, "{\"layer\":\"consaber\"}", true).statusCode());
        assertEquals(200, send(admin, "PUT", url, "{\"layer\":\"consaber\",\"percent\":60}", true).statusCode());
        assertEquals(200, send(admin, "PUT", url, "{\"layer\":\"asharien\",\"percent\":100}", true).statusCode());
        JsonNode seen = json.readTree(get(anon, "/weather/api/maps/" + mapId).body()).path("settings").path("layerTransparency");
        assertEquals(60, seen.path("consaber").asInt());
        assertEquals(100, seen.path("asharien").asInt());
        JsonNode export = json.readTree(get(admin, "/weather/api/maps/" + mapId + "/export?summary=1").body());
        assertEquals(60, export.path("changes").path("settings").path("layerTransparency").path("consaber").asInt(), export.toString());
        assertEquals(200, send(admin, "PUT", url, "{\"layer\":\"consaber\",\"percent\":0}", true).statusCode());
        assertEquals(200, send(admin, "PUT", url, "{\"layer\":\"asharien\",\"percent\":0}", true).statusCode());
        assertTrue(json.readTree(get(anon, "/weather/api/maps/" + mapId).body()).path("settings").path("layerTransparency").isMissingNode());
    }
}
