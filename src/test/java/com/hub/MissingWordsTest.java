package com.hub;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
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

/** Root and Rune's Missing words tab, on a fresh database of its own. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MissingWordsTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/missing-" + System.nanoTime()
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

    private HttpResponse<String> delete(HttpClient c, String path) throws Exception {
        return c.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).DELETE().build(), HttpResponse.BodyHandlers.ofString());
    }

    private void word(HttpClient c, long lang, String gloss, String form, int year) throws Exception {
        HttpResponse<String> r = post(c, "/rune/api/languages/" + lang + "/edit", "{\"entity\":\"word\",\"action\":\"CREATE\",\"payload\":{\"gloss\":\""
                + gloss + "\",\"form\":\"" + form + "\",\"year\":" + year + "}}", false);
        assertEquals(200, r.statusCode(), r.body());
    }

    @Test
    void missingWords() throws Exception {
        ObjectMapper om = new ObjectMapper();
        HttpClient owner = client();
        post(owner, "/api/auth/register", "{\"username\":\"owner1\",\"password\":\"secret-pass\"}", false);
        HttpClient viewer = client();
        post(viewer, "/api/auth/register", "{\"username\":\"viewer1\",\"password\":\"secret-pass\"}", false);
        long world = om.readTree(post(owner, "/rune/api/worlds", "{\"name\":\"W\"}", false).body()).path("id").asLong();
        long proto = om.readTree(post(owner, "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Proto\"}", false).body()).path("id").asLong();
        long branch = om.readTree(post(owner, "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Branch\",\"parentId\":" + proto + ",\"splitYear\":500}", false).body()).path("id").asLong();
        word(owner, proto, "water", "ata", 0);
        word(owner, proto, "sky", "sema", 800);   // coined after Branch split off
        String M = "/rune/api/languages/" + proto + "/missing";

        // mark by hand, one and several
        assertEquals(200, post(owner, M, "{\"gloss\":\"fire\",\"pos\":\"noun\",\"notes\":\"for the hearth\"}", false).statusCode());
        assertEquals(409, post(owner, M, "{\"gloss\":\"Fire\"}", false).statusCode(), "no duplicates");
        assertEquals(400, post(owner, M, "{\"gloss\":\" \"}", false).statusCode());
        JsonNode bulk = om.readTree(post(owner, M + "/bulk", "{\"text\":\"stone; noun\\nfire\\nwater\\n\\nto forgive; verb; later\"}", false).body());
        assertEquals("[\"stone\",\"to forgive\"]", bulk.path("added").toString(), bulk.toString());
        assertEquals("[\"fire\"]", bulk.path("onList").toString());
        assertTrue(bulk.path("haveWord").toString().contains("water"), bulk.toString());

        // sentences that use meanings the language has no word for
        post(owner, "/rune/api/languages/" + proto + "/sentences", "{\"source\":\"(water) (moon) (stone)\",\"year\":0,\"translation\":\"Water, moon, stone.\"}", false);
        post(owner, "/rune/api/languages/" + branch + "/sentences", "{\"source\":\"(sky) (water)\",\"year\":900,\"translation\":\"Sky water.\"}", false);

        JsonNode list = om.readTree(get(owner, M).body());
        assertEquals(3, list.path("entries").size(), list.toString());
        for (JsonNode e : list.path("entries")) assertTrue(e.path("word").isNull() || e.path("word").isMissingNode(), e.toString());
        assertEquals("owner1", list.path("entries").get(0).path("created_by_name").asText());
        // moon is needed by a sentence; stone is on the list already, so it isn't repeated
        assertEquals(1, list.path("fromSentences").size(), list.toString());
        assertEquals("moon", list.path("fromSentences").get(0).path("meaning").asText());
        assertTrue(list.path("fromSentences").get(0).path("sentences").toString().contains("Water, moon, stone."));

        // in the branch, sky was coined in the parent after the split: missing there; water is inherited
        JsonNode bl = om.readTree(get(owner, "/rune/api/languages/" + branch + "/missing").body());
        assertEquals(1, bl.path("fromSentences").size(), bl.toString());
        assertEquals("sky", bl.path("fromSentences").get(0).path("meaning").asText());
        assertTrue(bl.path("fromSentences").get(0).path("reason").asText().contains("after the split"), bl.toString());

        // coining a word ticks the entry off; clear-filled removes it
        word(owner, proto, "fire", "pira", 0);
        list = om.readTree(get(owner, M).body());
        JsonNode fire = null;
        for (JsonNode e : list.path("entries")) if (e.path("gloss").asText().equals("fire")) fire = e;
        assertEquals("pira", fire.path("word").path("form").asText(), list.toString());
        assertEquals(1, om.readTree(post(owner, M + "/clear-filled", "", false).body()).path("removed").asInt());
        assertEquals(2, om.readTree(get(owner, M).body()).path("entries").size());

        // a viewer sees the list but can't change it; a stranger can't see it
        HttpClient stranger = client();
        post(stranger, "/api/auth/register", "{\"username\":\"stranger1\",\"password\":\"secret-pass\"}", false);
        assertEquals(404, get(stranger, M).statusCode());
        post(owner, "/rune/api/shares", "{\"scope\":\"LANGUAGE\",\"targetId\":" + proto + ",\"username\":\"viewer1\",\"level\":\"VIEWER\"}", false);
        assertEquals(200, get(viewer, M).statusCode());
        assertEquals(403, post(viewer, M, "{\"gloss\":\"tree\"}", false).statusCode());
        long stoneId = om.readTree(get(owner, M).body()).path("entries").get(0).path("id").asLong();
        assertEquals(403, delete(viewer, "/rune/api/missing/" + stoneId).statusCode());
        assertEquals(200, delete(owner, "/rune/api/missing/" + stoneId).statusCode());
        assertEquals(1, om.readTree(get(owner, M).body()).path("entries").size());

        // the list is part of Export everything
        assertTrue(get(owner, "/rune/api/admin/export-all").body().contains("\"missing_words\""));
    }
}
