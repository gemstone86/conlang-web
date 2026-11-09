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
class ExtrasTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/extras-" + System.nanoTime()
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

    private long id(HttpResponse<String> r) throws Exception {
        return json(r).path("id").asLong();
    }

    /** Check tab, etymology, texts and notifications on one small family. */
    @Test
    void checkEtymologyTextsNotifications() throws Exception {
        HttpClient owner = client();
        post(owner, "/api/auth/register", "{\"username\":\"maker\",\"password\":\"secret-pass\"}", false);
        HttpClient helper = client();
        post(helper, "/api/auth/register", "{\"username\":\"helper\",\"password\":\"secret-pass\"}", false);
        HttpClient fan = client();
        post(fan, "/api/auth/register", "{\"username\":\"fan\",\"password\":\"secret-pass\"}", false);
        HttpClient guest = client();

        long world = id(post(owner, "/rune/api/worlds", "{\"name\":\"Ygg\"}", false));
        long proto = lang(owner, world, "Proto", null, null);
        long branch = lang(owner, world, "Branch", proto, 500);
        long other = lang(owner, world, "Other", null, null);
        long water = id(edit(owner, proto, "word", "CREATE", null, "{\"gloss\":\"water\",\"form\":\"ata\",\"year\":0}"));
        edit(owner, proto, "word", "CREATE", null, "{\"gloss\":\"stone\",\"form\":\"ada\",\"year\":0}");
        edit(owner, proto, "word", "CREATE", null, "{\"gloss\":\"fire\",\"form\":\"pira\",\"year\":0}");
        edit(owner, proto, "rule", "CREATE", null, "{\"year\":100,\"pattern\":\"t\",\"replacement\":\"d\"}");
        edit(owner, proto, "rule", "CREATE", null, "{\"year\":200,\"pattern\":\"q\",\"replacement\":\"k\"}");
        assertEquals(200, edit(owner, other, "word", "CREATE", null, "{\"gloss\":\"water\",\"form\":\"x\",\"year\":600,\"loan_word_id\":" + water + "}").statusCode());

        // ---- Check: the merged water/stone and the rule that changes nothing
        JsonNode check = json(get(owner, "/rune/api/languages/" + proto + "/check"));
        JsonNode homo = null, unused = null;
        for (JsonNode c : check.path("checks")) {
            if (c.path("key").asText().equals("homophones")) homo = c;
            if (c.path("key").asText().equals("unused")) unused = c;
        }
        assertEquals(1, homo.path("count").asInt(), check.toString());
        assertTrue(homo.path("items").get(0).path("text").asText().contains("stone"), homo.toString());
        assertEquals(1, unused.path("count").asInt(), unused.toString());
        assertTrue(unused.path("items").get(0).path("text").asText().contains("q"), unused.toString());
        assertTrue(check.path("total").asInt() >= 2);
        assertEquals(404, get(fan, "/rune/api/languages/" + proto + "/check").statusCode(), "private language");

        // ---- Etymology: own in Proto, inherited in Branch, borrowed in Other
        JsonNode et = json(get(owner, "/rune/api/languages/" + branch + "/etymology?meaning=Water"));
        assertEquals(3, et.path("languages").size(), et.toString());
        java.util.Map<String, JsonNode> by = new java.util.HashMap<>();
        for (JsonNode l : et.path("languages")) by.put(l.path("name").asText(), l);
        assertEquals("has", by.get("Proto").path("status").asText());
        assertEquals("own", by.get("Proto").path("words").get(0).path("origin").asText());
        assertEquals("ada", by.get("Proto").path("words").get(0).path("form").asText(), "the form today");
        assertEquals("inherited", by.get("Branch").path("words").get(0).path("origin").asText(), et.toString());
        assertEquals("borrowed", by.get("Other").path("words").get(0).path("origin").asText(), et.toString());
        assertTrue(et.path("found").asInt() >= 3);
        JsonNode none = json(get(owner, "/rune/api/languages/" + proto + "/etymology?meaning=moon"));
        assertEquals(0, none.path("found").asInt());
        assertEquals(400, get(owner, "/rune/api/languages/" + proto + "/etymology?meaning=").statusCode());
        assertTrue(get(owner, "/rune/api/languages/" + proto + "/etymology/meanings").body().contains("fire"));

        // ---- Texts: built at two years, with a gap for the unknown word
        String body = "(water) | Water.\\n(fire) | Fire.\\n(ghost) | Ghost.";
        assertEquals(401, post(guest, "/rune/api/languages/" + proto + "/texts", "{\"title\":\"T\",\"years\":\"50\",\"body\":\"" + body + "\"}", false).statusCode());
        long text = id(post(owner, "/rune/api/languages/" + proto + "/texts", "{\"title\":\"The flood\",\"years\":\"150, 50\",\"body\":\"" + body + "\"}", false));
        JsonNode list = json(get(owner, "/rune/api/languages/" + proto + "/texts"));
        assertEquals(1, list.size());
        assertEquals(3, list.get(0).path("lines").asInt());
        JsonNode t = json(get(owner, "/rune/api/texts/" + text));
        assertEquals("[50,150]", t.path("years").toString());
        JsonNode first = t.path("lines").get(0);
        assertEquals("Water.", first.path("translation").asText());
        assertTrue(first.path("at").path("50").path("surface").asText().contains("ata"), first.toString());
        assertTrue(first.path("at").path("150").path("surface").asText().contains("ada"), first.toString());
        assertTrue(t.path("lines").get(2).path("at").path("50").path("gaps").asInt() > 0, t.toString());
        assertEquals(1, t.path("gaps").path("150").asInt(), t.toString());
        JsonNode at900 = json(get(owner, "/rune/api/texts/" + text + "?years=900"));
        assertEquals("[900]", at900.path("years").toString());
        assertEquals(404, get(fan, "/rune/api/texts/" + text).statusCode());
        // change and delete
        assertEquals(text, id(post(owner, "/rune/api/languages/" + proto + "/texts", "{\"id\":" + text + ",\"title\":\"The flood\",\"years\":\"50\",\"body\":\"(fire)\"}", false)));
        assertEquals(1, json(get(owner, "/rune/api/texts/" + text)).path("lines").size());

        // ---- Notifications
        assertEquals(0, json(get(owner, "/api/notifications")).path("unread").asInt());
        assertEquals(401, get(guest, "/api/notifications").statusCode());
        // sharing tells the person it is shared with
        post(owner, "/rune/api/shares", "{\"scope\":\"LANGUAGE\",\"targetId\":" + proto + ",\"username\":\"helper\",\"level\":\"EDITOR\"}", false);
        JsonNode hn = json(get(helper, "/api/notifications"));
        assertEquals(1, hn.path("unread").asInt(), hn.toString());
        assertTrue(hn.path("items").get(0).path("text").asText().contains("Proto"));
        assertEquals("/rune/?lang=" + proto, hn.path("items").get(0).path("link").asText());
        // an editor's change tells the owner; two in a row become one notification
        edit(helper, proto, "word", "CREATE", null, "{\"gloss\":\"sun\",\"form\":\"sol\",\"year\":0}");
        edit(helper, proto, "word", "CREATE", null, "{\"gloss\":\"moon\",\"form\":\"mena\",\"year\":0}");
        JsonNode on = json(get(owner, "/api/notifications"));
        assertEquals(1, on.path("unread").asInt(), on.toString());
        assertEquals(2, on.path("items").get(0).path("times").asInt(), on.toString());
        assertTrue(on.path("items").get(0).path("text").asText().contains("helper"));
        // the owner's own changes notify nobody
        edit(owner, proto, "word", "CREATE", null, "{\"gloss\":\"star\",\"form\":\"tela\",\"year\":0}");
        assertEquals(1, json(get(owner, "/api/notifications")).path("unread").asInt());
        assertEquals(1, json(get(helper, "/api/notifications")).path("unread").asInt());
        // marking read
        long nid = on.path("items").get(0).path("id").asLong();
        assertEquals(200, post(helper, "/api/notifications/seen", "{\"id\":" + nid + "}", false).statusCode());
        assertEquals(1, json(get(owner, "/api/notifications")).path("unread").asInt(), "someone else's can't be marked");
        post(owner, "/api/notifications/seen", "{\"id\":" + nid + "}", false);
        assertEquals(0, json(get(owner, "/api/notifications")).path("unread").asInt());
        // a suggestion on a public language tells the owner, the decision tells the suggester (maker is the first account, so admin)
        assertEquals(200, post(owner, "/rune/api/languages/" + proto + "/publish", "{\"public\":true}", false).statusCode());
        assertEquals(200, post(owner, "/rune/api/languages/" + proto + "/publish", "{\"suggestions\":true}", false).statusCode());
        assertEquals(200, get(guest, "/rune/api/languages/" + proto + "/check").statusCode(), "public: visitors see the Check tab");
        assertEquals(200, get(guest, "/rune/api/texts/" + text).statusCode());
        assertEquals(200, edit(fan, proto, "word", "CREATE", null, "{\"gloss\":\"tree\",\"form\":\"arba\",\"year\":0}").statusCode());
        JsonNode sn = json(get(owner, "/api/notifications"));
        assertEquals(1, sn.path("unread").asInt(), sn.toString());
        assertTrue(sn.path("items").get(0).path("text").asText().contains("fan"));
        assertTrue(sn.path("items").get(0).path("link").asText().endsWith("tab=changes"));
        long change = om.readTree(get(owner, "/rune/api/languages/" + proto + "/changes").body()).get(0).path("id").asLong();
        assertEquals(200, post(owner, "/rune/api/changes/" + change + "/approve", "", false).statusCode());
        JsonNode fn = json(get(fan, "/api/notifications"));
        assertEquals(1, fn.path("unread").asInt(), fn.toString());
        assertTrue(fn.path("items").get(0).path("text").asText().contains("approved"), fn.toString());
        post(fan, "/api/notifications/seen", "{}", false);
        assertEquals(0, json(get(fan, "/api/notifications")).path("unread").asInt());

        assertEquals(200, delete(owner, "/rune/api/texts/" + text).statusCode());
        assertEquals(0, json(get(owner, "/rune/api/languages/" + proto + "/texts")).size());
    }

    private HttpResponse<String> delete(HttpClient c, String path) throws Exception {
        return c.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).DELETE().build(), HttpResponse.BodyHandlers.ofString());
    }
}
