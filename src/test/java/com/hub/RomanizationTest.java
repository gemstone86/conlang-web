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
class RomanizationTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/roman-" + System.nanoTime()
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
    void aWordHasARomanization() throws Exception {
        HttpClient c = HttpClient.newBuilder().cookieHandler(new CookieManager()).build();
        assertEquals(200, send(c, "POST", "/api/auth/register", "{\"username\":\"boss\",\"password\":\"secret-pass\"}").statusCode());
        long world = om.readTree(send(c, "POST", "/rune/api/worlds", "{\"name\":\"Ygg\"}").body()).path("id").asLong();
        long lang = om.readTree(send(c, "POST", "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Elven\"}").body()).path("id").asLong();
        String edit = "/rune/api/languages/" + lang + "/edit";

        long id = om.readTree(send(c, "POST", edit, "{\"entity\":\"word\",\"action\":\"CREATE\",\"payload\":{\"gloss\":\"tree\",\"pos\":\"noun\",\"form\":\"ɪm\",\"year\":0,\"romanization\":\"  im \"}}").body()).path("id").asLong();
        JsonNode w = word(c, lang, "tree");
        assertEquals("im", w.path("romanization").asText(), "tidied");
        assertEquals("ɪm", w.path("form").asText(), "the form is its own column");

        // changed, then cleared
        assertEquals(200, send(c, "POST", edit, "{\"entity\":\"word\",\"action\":\"UPDATE\",\"entityId\":" + id + ",\"payload\":{\"romanization\":\"imm\"}}").statusCode());
        assertEquals("imm", word(c, lang, "tree").path("romanization").asText());
        assertEquals(200, send(c, "POST", edit, "{\"entity\":\"word\",\"action\":\"UPDATE\",\"entityId\":" + id + ",\"payload\":{\"romanization\":\"\"}}").statusCode());
        assertTrue(word(c, lang, "tree").path("romanization").isNull());

        // bulk entry: the seventh column
        String text = "river;noun;aka;0;;;áka\nrun;verb;ru;0";
        assertEquals(200, send(c, "POST", "/rune/api/languages/" + lang + "/bulk", "{\"text\":" + om.writeValueAsString(text) + "}").statusCode());
        assertEquals("áka", word(c, lang, "river").path("romanization").asText());
        assertTrue(word(c, lang, "run").path("romanization").isNull());

        // too long is refused
        HttpResponse<String> bad = send(c, "POST", edit, "{\"entity\":\"word\",\"action\":\"CREATE\",\"payload\":{\"gloss\":\"x\",\"form\":\"x\",\"year\":0,\"romanization\":\"" + "r".repeat(401) + "\"}}");
        assertEquals(400, bad.statusCode());
    }
}
