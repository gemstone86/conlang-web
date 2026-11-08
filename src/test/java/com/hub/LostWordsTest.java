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

/** Lost words and building sentences at a given time, on a fresh database of its own. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class LostWordsTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/lost-" + System.nanoTime()
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

    private HttpResponse<String> edit(HttpClient c, long lang, String entity, String action, Long id, String payload) throws Exception {
        return post(c, "/rune/api/languages/" + lang + "/edit", "{\"entity\":\"" + entity + "\",\"action\":\"" + action + "\""
                + (id == null ? "" : ",\"entityId\":" + id) + ",\"payload\":" + payload + "}", false);
    }

    private JsonNode word(HttpClient c, long lang, String gloss) throws Exception {
        for (JsonNode w : om.readTree(get(c, "/rune/api/languages/" + lang + "/words").body())) if (w.path("gloss").asText().equals(gloss)) return w;
        return null;
    }

    /** The sentence's only part: {ok, form, reason}. */
    private JsonNode build(HttpClient c, long lang, String source, int year) throws Exception {
        HttpResponse<String> r = post(c, "/rune/api/languages/" + lang + "/sentences/build", "{\"source\":\"" + source + "\",\"year\":" + year + "}", false);
        assertEquals(200, r.statusCode(), r.body());
        return om.readTree(r.body()).path("words").get(0).path("parts").get(0);
    }

    @Test
    void lostWords() throws Exception {
        HttpClient owner = client();
        post(owner, "/api/auth/register", "{\"username\":\"owner1\",\"password\":\"secret-pass\"}", false);
        long world = om.readTree(post(owner, "/rune/api/worlds", "{\"name\":\"W\"}", false).body()).path("id").asLong();
        long proto = lang(owner, world, "Proto", null, null);
        long early = lang(owner, world, "Early", proto, 300);
        long late = lang(owner, world, "Late", proto, 900);
        long other = lang(owner, world, "Other", null, null);
        edit(owner, proto, "word", "CREATE", null, "{\"gloss\":\"water\",\"form\":\"ata\",\"year\":0}");
        edit(owner, proto, "word", "CREATE", null, "{\"gloss\":\"sky\",\"form\":\"sema\",\"year\":600}");
        long water = word(owner, proto, "water").path("id").asLong();
        assertTrue(word(owner, late, "water") != null, "inherited before it is lost");

        // marking it lost: only in its own language or a branch, once per language
        assertEquals(400, edit(owner, proto, "loss", "CREATE", null, "{\"word_id\":" + water + ",\"lang_id\":" + other + ",\"year\":800}").statusCode());
        assertEquals(400, edit(owner, proto, "loss", "CREATE", null, "{\"word_id\":" + water + ",\"lang_id\":" + proto + "}").statusCode(), "needs a year");
        HttpResponse<String> lost = edit(owner, proto, "loss", "CREATE", null, "{\"word_id\":" + water + ",\"lang_id\":" + proto + ",\"year\":800,\"note\":\"replaced by sea\"}");
        assertEquals(200, lost.statusCode(), lost.body());
        assertEquals(409, edit(owner, proto, "loss", "CREATE", null, "{\"word_id\":" + water + ",\"lang_id\":" + proto + ",\"year\":900}").statusCode());

        // the dictionaries: lost in Proto; Early (split 300) keeps it; Late (split 900) never got it
        assertEquals(800, word(owner, proto, "water").path("lost_year").asInt());
        assertTrue(word(owner, early, "water") != null && word(owner, early, "water").path("lost_year").isMissingNode(), "Early split off before the loss");
        assertTrue(word(owner, late, "water") == null, "Late split off after the loss");
        JsonNode hist = om.readTree(get(owner, "/rune/api/words/" + water + "/history").body());
        assertEquals("replaced by sea", hist.path("losses").get(0).path("note").asText());
        assertEquals("Proto", hist.path("losses").get(0).path("lang_name").asText());

        // sentences at a given time
        assertTrue(build(owner, proto, "(water)", 700).path("ok").asBoolean(), "still in use in 700");
        JsonNode gone = build(owner, proto, "(water)", 850);
        assertFalse(gone.path("ok").asBoolean());
        assertEquals("'water' was lost in Proto in 800", gone.path("reason").asText());
        assertEquals("'water' was lost in Proto in 800", build(owner, proto, "(water#" + water + ")", 850).path("reason").asText(), "also when picked by id");
        assertEquals("'water' was lost in Proto in 800, before Late split off", build(owner, late, "(water)", 1000).path("reason").asText());
        assertTrue(build(owner, early, "(water)", 1000).path("ok").asBoolean(), "Early still has it");
        assertEquals("'sky' isn't coined until 600", build(owner, proto, "(sky)", 500).path("reason").asText());
        assertTrue(build(owner, proto, "(sky)", 650).path("ok").asBoolean());
        assertEquals("no word with that meaning", build(owner, proto, "(moon)", 500).path("reason").asText());

        // a saved sentence after the loss needs a word again, and water counts as missing in Proto now
        post(owner, "/rune/api/languages/" + proto + "/sentences", "{\"source\":\"(water)\",\"year\":900,\"translation\":\"Water.\"}", false);
        JsonNode miss = om.readTree(get(owner, "/rune/api/languages/" + proto + "/missing").body());
        assertEquals("water", miss.path("fromSentences").get(0).path("meaning").asText(), miss.toString());
        JsonNode bulk = om.readTree(post(owner, "/rune/api/languages/" + proto + "/missing/bulk", "{\"text\":\"water\"}", false).body());
        assertEquals("[\"water\"]", bulk.path("added").toString(), bulk.toString());

        // undoing the loss gives the word back everywhere
        long lossId = hist.path("losses").get(0).path("id").asLong();
        assertEquals(200, edit(owner, proto, "loss", "DELETE", lossId, "{}").statusCode());
        assertTrue(word(owner, late, "water") != null);
        assertTrue(word(owner, proto, "water").path("lost_year").isMissingNode());
        assertTrue(build(owner, proto, "(water)", 850).path("ok").asBoolean());

        // a branch can lose an inherited word on its own
        assertEquals(200, edit(owner, proto, "loss", "CREATE", null, "{\"word_id\":" + water + ",\"lang_id\":" + early + ",\"year\":1200}").statusCode());
        assertEquals(1200, word(owner, early, "water").path("lost_year").asInt());
        assertTrue(word(owner, proto, "water").path("lost_year").isMissingNode());
        assertTrue(get(owner, "/rune/api/admin/export-all").body().contains("\"word_losses\""));
    }
}
