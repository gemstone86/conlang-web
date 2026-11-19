package com.hub;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.net.CookieManager;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Moving what is drawn on the standard map without changing its shape: a box of it, or some rivers; admins only. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MoveDataTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/movedata-" + System.nanoTime()
                + ";MODE=PostgreSQL;NON_KEYWORDS=YEAR;DB_CLOSE_ON_EXIT=FALSE");
    }

    @LocalServerPort
    int port;

    private final JsonMapper json = JsonMapper.builder().build();

    private HttpClient client() { return HttpClient.newBuilder().cookieHandler(new CookieManager()).build(); }

    private HttpResponse<String> get(HttpClient c, String path) throws Exception {
        return c.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    private byte[] bytes(HttpClient c, String path) throws Exception {
        return c.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET().build(), HttpResponse.BodyHandlers.ofByteArray()).body();
    }

    private HttpResponse<String> post(HttpClient c, String path, String body) throws Exception {
        return c.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).header("Content-Type", "application/json").header("X-Eon-Request", "1")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }

    private void account(HttpClient c, String name) throws Exception {
        String body = "{\"username\":\"" + name + "\",\"password\":\"secret-pass\"}";
        HttpResponse<String> r = c.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/auth/register")).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
        if (r.statusCode() == 409) assertEquals(200, c.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/auth/login")).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString()).statusCode());
    }

    @Test
    void movesABoxAndPickedRivers() throws Exception {
        HttpClient admin = client(), member = client(), anon = client();
        account(admin, "boss");
        account(member, "someone");
        long mapId = -1;
        for (JsonNode m : json.readTree(get(admin, "/weather/api/maps").body())) if (m.path("isDefault").asBoolean()) mapId = m.path("id").asLong();
        String base = "/weather/api/maps/" + mapId, url = base + "/move-data";
        double w = json.readTree(get(admin, base).body()).path("width").asDouble();
        String all = "[\"rivers\",\"roads\",\"ranges\",\"cities\",\"height\",\"forest\",\"marsh\"]";
        String box = "{\"x0\":0.60,\"y0\":0.20,\"x1\":0.70,\"y1\":0.30}";

        assertEquals(401, post(anon, url, "{\"dx\":2,\"dy\":-1,\"what\":" + all + ",\"box\":" + box + "}").statusCode());
        assertEquals(403, post(member, url, "{\"dx\":2,\"dy\":-1,\"what\":" + all + ",\"box\":" + box + "}").statusCode());
        assertEquals(400, post(admin, url, "{\"dx\":2,\"dy\":-1,\"what\":" + all + "}").statusCode(), "no box and no rivers");
        assertEquals(400, post(admin, url, "{\"dx\":0,\"dy\":0,\"what\":" + all + ",\"box\":" + box + "}").statusCode());
        assertEquals(400, post(admin, url, "{\"dx\":999,\"dy\":0,\"what\":" + all + ",\"box\":" + box + "}").statusCode());
        assertEquals(400, post(admin, url, "{\"dx\":1,\"dy\":0,\"what\":[\"cats\"],\"box\":" + box + "}").statusCode());
        assertEquals(400, post(admin, url, "{\"dx\":1,\"dy\":0,\"what\":[\"roads\"],\"rivers\":[1]}").statusCode(), "picked rivers move only rivers");

        JsonNode before = json.readTree(get(admin, base + "/rivers").body()).path("rivers");
        BufferedImage h0 = ImageIO.read(new ByteArrayInputStream(bytes(admin, base + "/height")));
        JsonNode inside = null;
        for (JsonNode r : before) if (r.has("points") && r.path("points").get(0).path("x").asDouble() > 0.61 && r.path("points").get(0).path("x").asDouble() < 0.69
                && r.path("points").get(0).path("y").asDouble() > 0.21 && r.path("points").get(0).path("y").asDouble() < 0.29) { inside = r; break; }
        assertTrue(inside != null, "the shipped map has a river in that box");
        long rid = inside.path("id").asLong();
        double x0 = inside.path("points").get(0).path("x").asDouble(), y0 = inside.path("points").get(0).path("y").asDouble();

        HttpResponse<String> ok = post(admin, url, "{\"dx\":2,\"dy\":-1,\"what\":" + all + ",\"box\":" + box + "}");
        assertEquals(200, ok.statusCode(), ok.body());
        JsonNode after = json.readTree(get(admin, base + "/rivers").body()).path("rivers");
        JsonNode moved = null;
        for (JsonNode r : after) if (r.path("id").asLong() == rid) moved = r;
        assertEquals(x0 + 2 / w, moved.path("points").get(0).path("x").asDouble(), 1e-6);
        assertEquals(y0 - 1 / json.readTree(get(admin, base).body()).path("height").asDouble(), moved.path("points").get(0).path("y").asDouble(), 1e-6);
        assertEquals(before.size(), after.size());

        BufferedImage h1 = ImageIO.read(new ByteArrayInputStream(bytes(admin, base + "/height")));
        int px = (int) (0.65 * h0.getWidth()), py = (int) (0.25 * h0.getHeight());
        assertEquals(h0.getRaster().getSample(px - 2, py + 1, 0), h1.getRaster().getSample(px, py, 0), "the height moved 2 right and 1 up");
        int out = (int) (0.80 * h0.getWidth());
        assertEquals(h0.getRaster().getSample(out, py, 0), h1.getRaster().getSample(out, py, 0), "outside the box is untouched");

        // picked rivers only: that river moves, the others stay
        assertEquals(200, post(admin, url, "{\"dx\":1,\"dy\":0,\"what\":[\"rivers\"],\"rivers\":[" + rid + "]}").statusCode());
        JsonNode again = json.readTree(get(admin, base + "/rivers").body()).path("rivers");
        for (int i = 0; i < again.size(); i++) {
            JsonNode a = again.get(i), b = after.get(i);
            if (a.path("id").asLong() == rid) assertNotEquals(b.path("points").get(0).path("x").asDouble(), a.path("points").get(0).path("x").asDouble());
            else if (a.has("points")) assertEquals(b.path("points").get(0).path("x").asDouble(), a.path("points").get(0).path("x").asDouble(), 1e-9, "river " + a.path("id"));
        }
    
        // scaling picked rivers about a centre (as a layer is scaled), alone or with a move; not the pictures
        double cx = 0.5, cy = 0.5;
        JsonNode one = null;
        for (JsonNode r : again) if (r.path("id").asLong() == rid) one = r;
        double bx = one.path("points").get(0).path("x").asDouble(), by = one.path("points").get(0).path("y").asDouble();
        assertEquals(400, post(admin, url, "{\"dx\":0,\"dy\":0,\"scale\":3,\"what\":[\"rivers\"],\"rivers\":[" + rid + "]}").statusCode());
        assertEquals(400, post(admin, url, "{\"dx\":0,\"dy\":0,\"scale\":1.01,\"what\":[\"height\"],\"box\":" + box + "}").statusCode());
        assertEquals(200, post(admin, url, "{\"dx\":0,\"dy\":0,\"scale\":1.01,\"center\":{\"x\":0.5,\"y\":0.5},\"what\":[\"rivers\"],\"rivers\":[" + rid + "]}").statusCode());
        JsonNode scaled = null;
        for (JsonNode r : json.readTree(get(admin, base + "/rivers").body()).path("rivers")) if (r.path("id").asLong() == rid) scaled = r;
        assertEquals(cx + (bx - cx) * 1.01, scaled.path("points").get(0).path("x").asDouble(), 2e-6);
        assertEquals(cy + (by - cy) * 1.01, scaled.path("points").get(0).path("y").asDouble(), 2e-6);
    }
}
