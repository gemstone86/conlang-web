package com.hub;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.CookieManager;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Tags on words: bulk entry gives every new word the tag asked for (and any on its own line). */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class BulkTagsTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/bulktags-" + System.nanoTime()
                + ";MODE=PostgreSQL;NON_KEYWORDS=YEAR;DB_CLOSE_ON_EXIT=FALSE");
    }

    @LocalServerPort
    int port;

    private final ObjectMapper om = new ObjectMapper();

    private HttpResponse<String> send(HttpClient c, String method, String path, String json) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).header("Content-Type", "application/json");
        return c.send((json == null ? b.method(method, HttpRequest.BodyPublishers.noBody()) : b.method(method, HttpRequest.BodyPublishers.ofString(json))).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private Map<String, String> tagsOf(HttpClient c, long lang) throws Exception {
        Map<String, String> out = new HashMap<>();
        for (JsonNode w : om.readTree(send(c, "GET", "/rune/api/languages/" + lang + "/words", null).body()))
            out.put(w.path("gloss").asText(), w.path("tags").isNull() ? "" : w.path("tags").asText());
        return out;
    }

    @Test
    void bulkEntryTagsEveryWord() throws Exception {
        HttpClient c = HttpClient.newBuilder().cookieHandler(new CookieManager()).build();
        assertEquals(200, send(c, "POST", "/api/auth/register", "{\"username\":\"boss\",\"password\":\"secret-pass\"}").statusCode());
        long world = om.readTree(send(c, "POST", "/rune/api/worlds", "{\"name\":\"Ygg\"}").body()).path("id").asLong();
        long lang = om.readTree(send(c, "POST", "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Elven\"}").body()).path("id").asLong();
        String url = "/rune/api/languages/" + lang + "/bulk";
        String text = "tree;noun;im;10\nriver;noun;aka;10;;water, Old\nrun;verb;ru;10";

        // a check only adds nothing, and says what it would tag
        JsonNode dry = om.readTree(send(c, "POST", url, "{\"text\":" + om.writeValueAsString(text) + ",\"dryRun\":true,\"tags\":\" batch 1 ,batch 1\"}").body());
        assertEquals(3, dry.path("count").asInt());
        assertEquals("batch 1", dry.path("tags").asText(), "tidied: trimmed, no repeats");
        assertEquals(0, tagsOf(c, lang).size());

        assertEquals(200, send(c, "POST", url, "{\"text\":" + om.writeValueAsString(text) + ",\"tags\":\"batch 1\"}").statusCode());
        Map<String, String> got = tagsOf(c, lang);
        assertEquals("batch 1", got.get("tree"));
        assertEquals("batch 1, water, Old", got.get("river"), "the tag for all, then the line's own");
        assertEquals("batch 1", got.get("run"));

        // no tag asked for: the words get none (a line's own still counts)
        assertEquals(200, send(c, "POST", url, "{\"text\":\"stone;noun;ta;10\\nsky;noun;ve;10;;air\"}").statusCode());
        got = tagsOf(c, lang);
        assertEquals("", got.get("stone"));
        assertEquals("air", got.get("sky"));

        // a tag that is too long is refused, and nothing is added
        String longTag = "x".repeat(41);
        HttpResponse<String> bad = send(c, "POST", url, "{\"text\":\"moon;noun;lu;10\",\"tags\":\"" + longTag + "\"}");
        assertEquals(400, bad.statusCode());
        assertTrue(!tagsOf(c, lang).containsKey("moon"));
    }
}
