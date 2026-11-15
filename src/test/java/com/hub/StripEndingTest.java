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

/**
 * A form rule can first take the word's old ending off (strip_re): the ending that a sound change removes from a word on its
 * own (atgangana > atgang) can't once the affix stands behind it, so forms built on the whole word kept it.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class StripEndingTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/strip-" + System.nanoTime()
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

    private HttpResponse<String> edit(HttpClient c, long lang, String entity, String payload) throws Exception {
        return send(c, "POST", "/rune/api/languages/" + lang + "/edit", "{\"entity\":\"" + entity + "\",\"action\":\"CREATE\",\"payload\":" + payload + "}");
    }

    private JsonNode built(HttpClient c, long lang, String source, int year) throws Exception {
        HttpResponse<String> r = send(c, "POST", "/rune/api/languages/" + lang + "/sentences/build", "{\"source\":\"" + source + "\",\"year\":" + year + "}");
        assertEquals(200, r.statusCode(), r.body());
        return om.readTree(r.body()).path("words").get(0);
    }

    @Test
    void aFormRuleCanTakeTheOldEndingOffFirst() throws Exception {
        HttpClient c = HttpClient.newBuilder().cookieHandler(new CookieManager()).build();
        assertEquals(200, send(c, "POST", "/api/auth/register", "{\"username\":\"boss\",\"password\":\"secret-pass\"}").statusCode());
        long world = om.readTree(send(c, "POST", "/rune/api/worlds", "{\"name\":\"Ygg\"}").body()).path("id").asLong();
        long lang = om.readTree(send(c, "POST", "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Proto\"}").body()).path("id").asLong();
        long wid = om.readTree(edit(c, lang, "word", "{\"gloss\":\"leave\",\"pos\":\"verb\",\"form\":\"atgangana\",\"year\":0}").body()).path("id").asLong();
        // the ending goes from words in year 100
        assertEquals(200, edit(c, lang, "rule", "{\"year\":100,\"pattern\":\"ana$\",\"replacement\":\"\",\"name\":\"lose -ana\"}").statusCode());
        // "past" takes the old ending off first; "again" does not
        assertEquals(200, edit(c, lang, "formrule", "{\"label\":\"past\",\"pos\":\"verb\",\"placement\":\"suffix\",\"affix\":\"ida\",\"strip_re\":\"(ana|a)$\"}").statusCode());
        assertEquals(200, edit(c, lang, "formrule", "{\"label\":\"again\",\"pos\":\"verb\",\"placement\":\"suffix\",\"affix\":\"u\"}").statusCode());

        // the dictionary form goes through the sound change; the forms are built on the stripped word (or the whole one)
        JsonNode words = om.readTree(send(c, "GET", "/rune/api/languages/" + lang + "/words", null).body());
        JsonNode forms = words.get(0).path("forms");
        String past = null, again = null;
        for (JsonNode f : forms) { if (f.path("label").asText().equals("past")) past = f.path("form").asText(); if (f.path("label").asText().equals("again")) again = f.path("form").asText(); }
        assertEquals("atgangida", past, forms.toString());
        assertEquals("atganganau", again, "without the pattern the old ending stays inside, as before");

        // and in sentences (the stacked-endings path), after the sound change
        assertEquals("atgangida", built(c, lang, "(leave-past)", 200).path("surface").asText());
        assertEquals("atganganau", built(c, lang, "(leave-again)", 200).path("surface").asText());

        // a bad pattern is refused
        HttpResponse<String> bad = edit(c, lang, "formrule", "{\"label\":\"bad\",\"pos\":\"verb\",\"placement\":\"suffix\",\"affix\":\"x\",\"strip_re\":\"(\"}");
        assertEquals(400, bad.statusCode());
        assertTrue(bad.body().contains("Remove from the end first"), bad.body());
        assertTrue(wid > 0);
    }
}
