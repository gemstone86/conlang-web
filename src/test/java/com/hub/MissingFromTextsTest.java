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
import tools.jackson.databind.ObjectMapper;

/** A word has a romanization column of its own: set when adding, in bulk entry and when editing; the form is not touched. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MissingFromTextsTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/mtexts-" + System.nanoTime()
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

    private JsonNode word(HttpClient c, long lang, String gloss) throws Exception {
        for (JsonNode w : om.readTree(send(c, "GET", "/rune/api/languages/" + lang + "/words", null).body()))
            if (w.path("gloss").asText().equals(gloss)) return w;
        throw new AssertionError("no word " + gloss);
    }

    @Test
    void textsAddMissingWords() throws Exception {
        HttpClient c = HttpClient.newBuilder().cookieHandler(new CookieManager()).build();
        assertEquals(200, send(c, "POST", "/api/auth/register", "{\"username\":\"boss\",\"password\":\"secret-pass\"}").statusCode());
        long world = om.readTree(send(c, "POST", "/rune/api/worlds", "{\"name\":\"Ygg\"}").body()).path("id").asLong();
        long lang = om.readTree(send(c, "POST", "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Elven\"}").body()).path("id").asLong();
        assertEquals(200, send(c, "POST", "/rune/api/languages/" + lang + "/edit", "{\"entity\":\"word\",\"action\":\"CREATE\",\"payload\":{\"gloss\":\"tree\",\"pos\":\"noun\",\"form\":\"im\",\"year\":0}}").statusCode());
        String body = "(tree) (moonlight)\n(tree) (thunder) | a tree and thunder";
        assertEquals(200, send(c, "POST", "/rune/api/languages/" + lang + "/texts", "{\"title\":\"Song\",\"years\":\"0\",\"body\":" + om.writeValueAsString(body) + "}").statusCode());
        JsonNode r = om.readTree(send(c, "GET", "/rune/api/languages/" + lang + "/missing", null).body());
        assertEquals(0, r.path("fromSentences").size());
        JsonNode t = r.path("fromTexts");
        assertEquals(2, t.size(), t.toString());
        StringBuilder names = new StringBuilder();
        for (JsonNode g : t) names.append(g.path("meaning").asText()).append(',');
        assertTrue(names.toString().contains("moonlight") && names.toString().contains("thunder") && !names.toString().contains("tree"), names.toString());
        assertEquals("Song", t.get(0).path("texts").get(0).path("title").asText());

        // marking one by hand moves it off the texts list
        assertEquals(200, send(c, "POST", "/rune/api/languages/" + lang + "/missing", "{\"gloss\":\"thunder\"}").statusCode());
        assertEquals(1, om.readTree(send(c, "GET", "/rune/api/languages/" + lang + "/missing", null).body()).path("fromTexts").size());
    }
}
