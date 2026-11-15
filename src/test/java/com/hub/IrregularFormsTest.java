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

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class IrregularFormsTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/irregular-" + System.nanoTime()
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

    /** imtou becomes imbou by "t > b between m and a vowel": an irregular form, stored; akatou stays what the rule gives and is not stored. */
    @Test
    void soundChangesMakeIrregularFormsAndTheyCanBeLevelled() throws Exception {
        HttpClient owner = client();
        post(owner, "/api/auth/register", "{\"username\":\"irregular\",\"password\":\"secret-pass\"}", false);
        long world = om.readTree(post(owner, "/rune/api/worlds", "{\"name\":\"Ygg2\"}", false).body()).path("id").asLong();
        long elven = lang(owner, world, "Elven", null, null);
        rule(owner, elven, "definiteness", "definite", "tou", null);
        long tree = newId(edit(owner, elven, "word", "CREATE", null, "{\"gloss\":\"tree\",\"pos\":\"noun\",\"form\":\"im\",\"year\":10}"));
        long river = newId(edit(owner, elven, "word", "CREATE", null, "{\"gloss\":\"river\",\"pos\":\"noun\",\"form\":\"aka\",\"year\":10}"));

        // nothing is stored for a form the rules give, but the word has it
        JsonNode f0 = form(owner, tree, "definite");
        assertEquals("imtou", f0.path("form").asText(), f0.toString());
        assertTrue(f0.path("virtual").asBoolean() && f0.path("id").isNull(), f0.toString());
        assertTrue(f0.path("irregular_year").isNull(), f0.toString());
        assertEquals("imtou", built(owner, elven, "(tree-definite)", 50).path("surface").asText());

        // the sound change: t > b between m and a vowel, in 100; and one that changes every ou, in 200
        assertEquals(200, edit(owner, elven, "rule", "CREATE", null, "{\"year\":100,\"pattern\":\"(?<=m)t(?=[aeiou])\",\"replacement\":\"b\",\"name\":\"mt > mb\"}").statusCode());
        assertEquals(200, edit(owner, elven, "rule", "CREATE", null, "{\"year\":200,\"pattern\":\"ou\",\"replacement\":\"oe\",\"name\":\"ou > oe\"}").statusCode());
        JsonNode f1 = form(owner, tree, "definite");
        assertEquals(100, f1.path("irregular_year").asInt(), f1.toString());
        assertTrue(form(owner, river, "definite").path("irregular_year").isNull(), "akatou > akatoe is still aka + the ending");
        assertEquals("imboe", built(owner, elven, "(tree-definite)", 300).path("surface").asText());
        assertEquals("akatoe", built(owner, elven, "(river-definite)", 300).path("surface").asText());

        // storing: only the irregular one
        JsonNode gen = json(post(owner, "/rune/api/languages/" + elven + "/forms/generate", "{}", false));
        assertEquals(1, gen.path("created").asInt(), gen.toString());
        JsonNode f2 = form(owner, tree, "definite");
        assertFalse(f2.path("id").isNull(), f2.toString());
        assertEquals(100, f2.path("irregular_year").asInt(), f2.toString());
        assertEquals("imtou", f2.path("form").asText(), "stored from its beginning, so its history shows imtou > imbou");
        assertTrue(form(owner, river, "definite").path("id").isNull(), "the regular one is still not stored");
        // the dictionary shows both, as they are now
        String dictNow = get(owner, "/rune/api/languages/" + elven + "/words").body();
        assertTrue(dictNow.contains("imboe") && dictNow.contains("akatoe"), dictNow);
        // again: nothing more to do
        JsonNode again = json(post(owner, "/rune/api/languages/" + elven + "/forms/generate", "{}", false));
        assertEquals(0, again.path("created").asInt() + again.path("compacted").asInt() + again.path("updated").asInt(), again.toString());

        // levelled out from 250: the word plus the ending as they are then
        JsonNode lv = json(post(owner, "/rune/api/languages/" + elven + "/forms/level", "{\"word_id\":" + tree + ",\"label\":\"definite\",\"year\":250}", false));
        assertEquals("imtoe", lv.path("level_form").asText(), lv.toString());
        assertEquals("imboe", built(owner, elven, "(tree-definite)", 240).path("surface").asText());
        assertEquals("imtoe", built(owner, elven, "(tree-definite)", 300).path("surface").asText());
        assertTrue(get(owner, "/rune/api/languages/" + elven + "/words").body().contains("imtoe"));
        // a rebuild keeps the levelled form
        json(post(owner, "/rune/api/languages/" + elven + "/forms/generate", "{\"overwrite\":true}", false));
        assertEquals(250, form(owner, tree, "definite").path("level_year").asInt());
        // and the levelling can be taken away
        json(post(owner, "/rune/api/languages/" + elven + "/forms/level", "{\"word_id\":" + tree + ",\"label\":\"definite\"}", false));
        assertEquals("imboe", built(owner, elven, "(tree-definite)", 300).path("surface").asText());

        // a stored form that is just what the rule gives is taken away by a rebuild (it is worked out instead)
        long made = newId(edit(owner, elven, "form", "CREATE", null, "{\"word_id\":" + river + ",\"label\":\"definite\",\"form\":\"akatou\"}"));
        assertTrue(made > 0);
        JsonNode comp = json(post(owner, "/rune/api/languages/" + elven + "/forms/generate", "{}", false));
        assertEquals(1, comp.path("compacted").asInt(), comp.toString());
        assertTrue(form(owner, river, "definite").path("id").isNull());
        // one made by hand stays
        edit(owner, elven, "form", "CREATE", null, "{\"word_id\":" + river + ",\"label\":\"definite\",\"form\":\"akadu\"}");
        json(post(owner, "/rune/api/languages/" + elven + "/forms/generate", "{}", false));
        JsonNode hand = form(owner, river, "definite");
        assertEquals("akadu", hand.path("form").asText(), hand.toString());
        assertTrue(hand.path("manual").asBoolean(), hand.toString());
    }

    /** The spelling lags behind the pronunciation until the next reform; and a sound change's preview names the words it would merge. */
    @Test
    void spellingReformsAndThePreviewOfMergers() throws Exception {
        HttpClient owner = client();
        post(owner, "/api/auth/register", "{\"username\":\"speller\",\"password\":\"secret-pass\"}", false);
        long world = om.readTree(post(owner, "/rune/api/worlds", "{\"name\":\"Ygg3\"}", false).body()).path("id").asLong();
        long elven = lang(owner, world, "Elven", null, null);
        long path = newId(edit(owner, elven, "word", "CREATE", null, "{\"gloss\":\"path\",\"pos\":\"noun\",\"form\":\"sou\",\"year\":10}"));
        newId(edit(owner, elven, "word", "CREATE", null, "{\"gloss\":\"cat\",\"pos\":\"noun\",\"form\":\"pat\",\"year\":10}"));
        newId(edit(owner, elven, "word", "CREATE", null, "{\"gloss\":\"dog\",\"pos\":\"noun\",\"form\":\"pad\",\"year\":10}"));
        assertEquals(200, edit(owner, elven, "rule", "CREATE", null, "{\"year\":200,\"pattern\":\"ou\",\"replacement\":\"oe\",\"name\":\"ou > oe\"}").statusCode());

        assertEquals(200, put(owner, "/rune/api/languages/" + elven, "{\"spellingYears\":\"150\"}").statusCode());
        JsonNode row = null;
        for (JsonNode x : om.readTree(get(owner, "/rune/api/languages/" + elven + "/words").body())) if (x.path("id").asLong() == path) row = x;
        assertEquals("soe", row.path("latest").path("Elven").asText(), row.toString());
        assertEquals("sou", row.path("spelling").asText(), "still spelled as at the reform of 150");
        assertEquals(400, put(owner, "/rune/api/languages/" + elven, "{\"spellingYears\":\"soon\"}").statusCode());
        assertEquals(200, put(owner, "/rune/api/languages/" + elven, "{\"spellingYears\":\"250, 150\"}").statusCode());
        for (JsonNode x : om.readTree(get(owner, "/rune/api/languages/" + elven + "/words").body())) if (x.path("id").asLong() == path) row = x;
        assertTrue(row.path("spelling").isMissingNode(), "the reform of 250 caught up: " + row);
        JsonNode sp = om.readTree(get(owner, "/rune/api/words/" + path + "/history").body()).path("spelling");
        assertEquals(2, sp.size(), sp.toString());
        assertEquals("soe", sp.get(1).path("form").asText());
        assertEquals(250, sp.get(1).path("year").asInt());

        JsonNode pv = json(post(owner, "/rune/api/languages/" + elven + "/rules/preview", "{\"year\":300,\"ord\":0,\"pattern\":\"d$\",\"replacement\":\"t\"}", false));
        assertEquals(1, pv.path("wordsAffected").asInt(), pv.toString());
        assertEquals(1, pv.path("collisions").size(), pv.toString());
        assertEquals("pat", pv.path("collisions").get(0).path("form").asText());
        JsonNode none = json(post(owner, "/rune/api/languages/" + elven + "/rules/preview", "{\"year\":300,\"ord\":0,\"pattern\":\"s\",\"replacement\":\"z\"}", false));
        assertEquals(0, none.path("collisions").size(), none.toString());
    }

    private HttpResponse<String> put(HttpClient c, String path, String json) throws Exception {
        return c.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).header("Content-Type", "application/json")
                .PUT(HttpRequest.BodyPublishers.ofString(json)).build(), HttpResponse.BodyHandlers.ofString());
    }

    private JsonNode form(HttpClient c, long word, String label) throws Exception {
        for (JsonNode f : om.readTree(get(c, "/rune/api/words/" + word + "/history").body()).path("forms"))
            if (f.path("label").asText().equals(label)) return f;
        return om.missingNode();
    }
}
