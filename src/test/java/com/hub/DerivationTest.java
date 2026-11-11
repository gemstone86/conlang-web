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

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class DerivationTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/derivation-" + System.nanoTime()
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

    private JsonNode json(HttpResponse<String> r) throws Exception {
        assertEquals(200, r.statusCode(), r.body());
        return om.readTree(r.body());
    }

    /** The built word: {surface, gloss, parts}. */
    private JsonNode built(HttpClient c, long lang, String source, int year) throws Exception {
        return json(post(c, "/rune/api/languages/" + lang + "/sentences/build", "{\"source\":\"" + source + "\",\"year\":" + year + "}", false)).path("words").get(0);
    }

    private void rule(HttpClient c, long lang, String grp, String label, String affix, Integer year) throws Exception {
        HttpResponse<String> r = edit(c, lang, "formrule", "CREATE", null, "{\"grp\":\"" + grp + "\",\"label\":\"" + label + "\",\"pos\":\"noun\",\"placement\":\"suffix\",\"affix\":\""
                + affix + "\"" + (year == null ? "" : ",\"year\":" + year) + "}");
        assertEquals(200, r.statusCode(), r.body());
    }

    private long newId(HttpResponse<String> r) throws Exception {
        assertEquals(200, r.statusCode(), r.body());
        return om.readTree(r.body()).path("id").asLong();
    }

    /** A noun + the verb maker is a verb: it takes verb endings, and can be saved as a word of its own. */
    @Test
    void derivationsMakeNewWords() throws Exception {
        HttpClient owner = client();
        post(owner, "/api/auth/register", "{\"username\":\"deriver\",\"password\":\"secret-pass\"}", false);
        long world = om.readTree(post(owner, "/rune/api/worlds", "{\"name\":\"Ygg\"}", false).body()).path("id").asLong();
        long elven = lang(owner, world, "Elven", null, null);
        long maker = newId(edit(owner, elven, "word", "CREATE", null, "{\"gloss\":\"verbmaker\",\"pos\":\"affix\",\"form\":\"ma\",\"year\":10}"));
        assertEquals(200, edit(owner, elven, "formrule", "CREATE", null, "{\"grp\":\"number\",\"label\":\"plural\",\"pos\":\"noun\",\"placement\":\"suffix\",\"affix\":\"i\"}").statusCode());
        assertEquals(200, edit(owner, elven, "formrule", "CREATE", null, "{\"grp\":\"tense\",\"label\":\"past\",\"pos\":\"verb\",\"placement\":\"suffix\",\"affix\":\"ta\"}").statusCode());
        assertEquals(200, edit(owner, elven, "formrule", "CREATE", null, "{\"grp\":\"derivation\",\"label\":\"verb\",\"pos\":\"noun\",\"placement\":\"prefix\",\"affix\":\"\",\"affix_word_id\":"
                + maker + ",\"new_pos\":\"verb\",\"new_gloss\":\"to {gloss}\"}").statusCode());
        long seal = newId(edit(owner, elven, "word", "CREATE", null, "{\"gloss\":\"seal\",\"pos\":\"noun\",\"form\":\"hal\",\"year\":10}"));
        // derivations make words, not stored forms
        for (JsonNode f : om.readTree(get(owner, "/rune/api/words/" + seal + "/history").body()).path("forms"))
            assertFalse(f.path("label").asText().equals("verb"), "no stored 'verb' form");

        JsonNode v = built(owner, elven, "(seal-verb)", 600);
        assertEquals("mahal", v.path("surface").asText(), v.toString());
        assertEquals("to seal", v.path("parts").get(0).path("derive").path("gloss").asText(), "offered for saving");
        JsonNode past = built(owner, elven, "(seal-verb-past)", 600);
        assertEquals("mahalta", past.path("surface").asText(), past.toString());
        assertEquals("seal-verb-past", past.path("gloss").asText());
        assertEquals("mahalta", built(owner, elven, "(seal-past-verb)", 600).path("surface").asText(), "the derivation goes first whatever the order");
        JsonNode way2 = built(owner, elven, "(verbmaker)(seal-past)", 600);
        assertEquals("mahalta", way2.path("surface").asText(), way2.toString());
        assertEquals("mahal", built(owner, elven, "(verbmaker)(seal)", 600).path("surface").asText());
        JsonNode noun = built(owner, elven, "(seal-past)", 600);
        assertTrue(noun.path("parts").get(0).path("reason").asText().contains("noun) has no 'past' form"), noun.toString());
        JsonNode mixed = built(owner, elven, "(seal-verb-plural)", 600);
        assertTrue(mixed.path("parts").get(0).path("reason").asText().contains("made a verb by 'verb'"), mixed.toString());

        // All forms lists it; the preview says what saving gives
        JsonNode para = om.readTree(get(owner, "/rune/api/languages/" + elven + "/words/" + seal + "/paradigm?year=600").body());
        assertEquals(1, para.path("derived").size(), para.toString());
        assertEquals("mahal", para.path("derived").get(0).path("form").asText());
        assertEquals(1, para.path("groups").size(), "the derivation is not one of the noun's ending groups");
        JsonNode pre = om.readTree(get(owner, "/rune/api/languages/" + elven + "/words/" + seal + "/derive?label=verb").body());
        assertEquals("to seal", pre.path("gloss").asText(), pre.toString());
        assertEquals("verb", pre.path("pos").asText());
        assertEquals("mahal", pre.path("form").asText());

        // saved as a word: sentences use it, with its own (irregular) forms
        HttpResponse<String> saved = post(owner, "/rune/api/languages/" + elven + "/words/" + seal + "/derive", "{\"label\":\"verb\"}", false);
        long toSeal = newId(saved);
        assertEquals(409, post(owner, "/rune/api/languages/" + elven + "/words/" + seal + "/derive", "{\"label\":\"verb\"}", false).statusCode());
        JsonNode w = null;
        for (JsonNode x : om.readTree(get(owner, "/rune/api/languages/" + elven + "/words").body())) if (x.path("id").asLong() == toSeal) w = x;
        assertEquals("to seal", w.path("gloss").asText());
        assertEquals("verb", w.path("pos").asText());
        assertEquals(seal, w.path("derived_from").asLong());
        Long pastForm = null;
        for (JsonNode f : om.readTree(get(owner, "/rune/api/words/" + toSeal + "/history").body()).path("forms"))
            if (f.path("label").asText().equals("past")) pastForm = f.path("id").asLong();
        HttpResponse<String> irr = pastForm == null
                ? edit(owner, elven, "form", "CREATE", null, "{\"word_id\":" + toSeal + ",\"label\":\"past\",\"form\":\"mahalvo\"}")
                : edit(owner, elven, "form", "UPDATE", pastForm, "{\"form\":\"mahalvo\"}");
        assertEquals(200, irr.statusCode(), irr.body());
        JsonNode usesSaved = built(owner, elven, "(seal-verb-past)", 600);
        assertEquals("mahalvo", usesSaved.path("surface").asText(), usesSaved.toString());
        assertTrue(usesSaved.path("parts").get(0).path("note").asText().contains("saved word 'to seal'"), usesSaved.toString());
        assertTrue(usesSaved.path("parts").get(0).path("derive").isMissingNode(), "nothing more to save");
        assertEquals("mahalvo", built(owner, elven, "(to seal-past)", 600).path("surface").asText());
        assertEquals(toSeal, om.readTree(get(owner, "/rune/api/languages/" + elven + "/words/" + seal + "/paradigm?year=600").body()).path("derived").get(0).path("saved_id").asLong());
    }
}
