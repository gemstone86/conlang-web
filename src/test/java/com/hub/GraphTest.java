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

/** The divergence graph only starts when the languages exist. On a fresh database of its own. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class GraphTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/graph-" + System.nanoTime()
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

    private long lang(HttpClient c, long world, String name, Long parent, Integer split) throws Exception {
        String body = "{\"worldId\":" + world + ",\"name\":\"" + name + "\"" + (parent == null ? "" : ",\"parentId\":" + parent + ",\"splitYear\":" + split) + "}";
        return om.readTree(post(c, "/rune/api/languages", body, false).body()).path("id").asLong();
    }

    private void edit(HttpClient c, long lang, String entity, String payload) throws Exception {
        HttpResponse<String> r = post(c, "/rune/api/languages/" + lang + "/edit", "{\"entity\":\"" + entity + "\",\"action\":\"CREATE\",\"payload\":" + payload + "}", false);
        assertEquals(200, r.statusCode(), r.body());
    }

    /** Every value of the series before its "from" year is empty, and some value from then on isn't. */
    private void startsAtFrom(JsonNode g, JsonNode series) {
        int from = series.path("from").asInt();
        boolean any = false;
        for (int i = 0; i < g.path("years").size(); i++) {
            int y = g.path("years").get(i).asInt();
            JsonNode v = series.path("avg_distance").get(i);
            if (y < from) assertTrue(v.isNull(), series.path("a").asText() + "-" + series.path("b").asText() + " has a value in " + y + ", before " + from);
            else if (!v.isNull()) any = true;
        }
        assertTrue(any, "values from " + from + " on: " + series);
    }

    @Test
    void divergenceStartsWhenTheLanguagesExist() throws Exception {
        HttpClient owner = client();
        post(owner, "/api/auth/register", "{\"username\":\"owner1\",\"password\":\"secret-pass\"}", false);
        long world = om.readTree(post(owner, "/rune/api/worlds", "{\"name\":\"W\"}", false).body()).path("id").asLong();
        long proto = lang(owner, world, "Proto", null, null);
        long a = lang(owner, world, "Early", proto, 500);
        lang(owner, world, "Late", proto, 800);
        for (String[] w : new String[][]{{"water", "atapa", "100"}, {"fire", "pitaka", "150"}, {"stone", "katupa", "120"}})
            edit(owner, proto, "word", "{\"gloss\":\"" + w[0] + "\",\"form\":\"" + w[1] + "\",\"year\":" + w[2] + "}");
        edit(owner, a, "rule", "{\"year\":600,\"pattern\":\"t\",\"replacement\":\"d\"}");
        edit(owner, proto, "rule", "{\"year\":700,\"pattern\":\"p\",\"replacement\":\"f\"}");

        // all pairs, no years given: the graph starts when the first pair exists (Early splits off in 500), not before
        JsonNode g = om.readTree(get(owner, "/rune/api/languages/" + proto + "/divergence").body());
        assertEquals(500, g.path("years").get(0).asInt(), g.path("years").toString());
        java.util.Map<String, Integer> from = new java.util.HashMap<>();
        for (JsonNode s : g.path("series")) {
            from.put(s.path("a").asText() + "-" + s.path("b").asText(), s.path("from").asInt());
            startsAtFrom(g, s);
        }
        assertEquals(500, from.get("Proto-Early"));
        assertEquals(800, from.get("Proto-Late"));
        assertEquals(800, from.get("Early-Late"));

        // asked to start earlier: still nothing drawn before the languages exist
        JsonNode early = om.readTree(get(owner, "/rune/api/languages/" + proto + "/divergence?a=" + proto + "&b=" + a + "&from=0&to=1000").body());
        assertEquals(0, early.path("years").get(0).asInt());
        startsAtFrom(early, early.path("series").get(0));

        // a root language with a branch: the pair starts at the split, the root at its earliest word (100)
        JsonNode one = om.readTree(get(owner, "/rune/api/languages/" + a + "/divergence?a=" + proto + "&b=" + a).body());
        assertEquals(500, one.path("series").get(0).path("from").asInt());
    }
}
