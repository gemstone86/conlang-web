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
class StackedFormsTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/stacked-" + System.nanoTime()
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

    @Test
    void endingsStackByGroup() throws Exception {
        HttpClient owner = client();
        post(owner, "/api/auth/register", "{\"username\":\"elfmaker\",\"password\":\"secret-pass\"}", false);
        long world = om.readTree(post(owner, "/rune/api/worlds", "{\"name\":\"Ygg\"}", false).body()).path("id").asLong();
        long elven = lang(owner, world, "Elven", null, null);
        long tal = om.readTree(edit(owner, elven, "word", "CREATE", null, "{\"gloss\":\"stone\",\"pos\":\"noun\",\"form\":\"tal\",\"year\":10}").body()).path("id").asLong();
        long nis = om.readTree(edit(owner, elven, "word", "CREATE", null, "{\"gloss\":\"woman\",\"pos\":\"noun\",\"form\":\"nis\",\"year\":10}").body()).path("id").asLong();
        assertEquals(200, edit(owner, elven, "form", "CREATE", null, "{\"word_id\":" + nis + ",\"label\":\"plural\",\"form\":\"neri\"}").statusCode());
        rule(owner, elven, "number", "plural", "i", null);
        rule(owner, elven, "number", "dual", "t", null);
        rule(owner, elven, "case", "genitive", "o", null);
        rule(owner, elven, "definiteness", "definite", "n", 500);

        // one from each group, in group order (number, case, definiteness: the order they first appear), whatever the written order
        JsonNode a = built(owner, elven, "(stone-definite-plural)", 600);
        assertEquals("talin", a.path("surface").asText(), a.toString());
        assertEquals("stone-plural-definite", a.path("gloss").asText());
        assertEquals("talion", built(owner, elven, "(stone-definite-genitive-plural)", 600).path("surface").asText());
        assertEquals("tali", built(owner, elven, "(stone-plural)", 600).path("surface").asText(), "a single ending still works");
        assertEquals("talo", built(owner, elven, "(stone-gen)", 600).path("surface").asText(), "names can be shortened");
        // two from one group
        JsonNode both = built(owner, elven, "(stone-plural-dual)", 600);
        assertFalse(both.path("parts").get(0).path("ok").asBoolean());
        assertTrue(both.path("parts").get(0).path("reason").asText().contains("both in the group"), both.toString());
        // an ending that doesn't exist yet
        JsonNode early = built(owner, elven, "(stone-plural-definite)", 100);
        assertTrue(early.path("parts").get(0).path("reason").asText().contains("not in use until 500"), early.toString());
        // the stored (irregular) plural is the base
        assertEquals("nerin", built(owner, elven, "(woman-plural-definite)", 600).path("surface").asText());
        // unknown ending
        assertTrue(built(owner, elven, "(stone-plural-ablative)", 600).path("parts").get(0).path("reason").asText().contains("no form rule called 'ablative'"));

        // the order can be changed
        JsonNode groups = json(get(owner, "/rune/api/languages/" + elven + "/form-groups"));
        assertEquals("number", groups.path("groups").get(0).path("name").asText(), groups.toString());
        assertFalse(groups.path("own").asBoolean());
        HttpResponse<String> put = owner.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/rune/api/languages/" + elven + "/form-groups"))
                .header("Content-Type", "application/json").PUT(HttpRequest.BodyPublishers.ofString("{\"order\":[\"definiteness\",\"number\",\"case\"]}")).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, put.statusCode(), put.body());
        assertTrue(om.readTree(put.body()).path("own").asBoolean());
        assertEquals("talni", built(owner, elven, "(stone-plural-definite)", 600).path("surface").asText());

        // the stacked form goes on through later sound changes, and a branch inherits rules and order
        assertEquals(200, edit(owner, elven, "rule", "CREATE", null, "{\"year\":800,\"pattern\":\"i$\",\"replacement\":\"e\"}").statusCode());
        assertEquals("talni", built(owner, elven, "(stone-plural-definite)", 700).path("surface").asText());
        assertEquals("talne", built(owner, elven, "(stone-plural-definite)", 900).path("surface").asText());
        long branch = lang(owner, world, "Wood", elven, 650);
        assertEquals("talni", built(owner, branch, "(stone-plural-definite)", 900).path("surface").asText(), "the branch splits off in 650, before the parent's change in 800");

        // every combination in a table
        JsonNode para = json(get(owner, "/rune/api/languages/" + elven + "/words/" + tal + "/paradigm?year=600"));
        assertEquals(3, para.path("groups").size(), para.toString());
        assertEquals(12, para.path("rows").size(), "(none, plural, dual) x (none, genitive) x (none, definite)");
        boolean found = false;
        for (JsonNode r : para.path("rows")) if (r.path("labels").toString().equals("[\"definite\",\"plural\"]")) { found = true; assertEquals("talni", r.path("form").asText()); }
        assertTrue(found, para.toString());
        assertEquals(404, get(client(), "/rune/api/languages/" + elven + "/words/" + tal + "/paradigm").statusCode(), "private");
    }
}
