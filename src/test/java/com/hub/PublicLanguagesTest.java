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

/** Public languages, public suggestions and the Community list, on a fresh database of its own. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PublicLanguagesTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/public-" + System.nanoTime()
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

    private HttpResponse<String> edit(HttpClient c, long lang, String payload) throws Exception {
        return post(c, "/rune/api/languages/" + lang + "/edit", "{\"entity\":\"word\",\"action\":\"CREATE\",\"payload\":" + payload + "}", false);
    }

    private JsonNode worlds(HttpClient c) throws Exception {
        HttpResponse<String> r = get(c, "/rune/api/worlds");
        assertEquals(200, r.statusCode(), r.body());
        return om.readTree(r.body());
    }

    /** The language in someone's list, with whether it was listed under Community. */
    private JsonNode find(JsonNode worlds, long lang) {
        for (JsonNode w : worlds) for (JsonNode l : w.path("languages")) if (l.path("id").asLong() == lang) {
            ((com.fasterxml.jackson.databind.node.ObjectNode) l).put("_community", w.path("community").asBoolean());
            return l;
        }
        return null;
    }

    @Test
    void publicLanguages() throws Exception {
        HttpClient admin = client();
        post(admin, "/api/auth/register", "{\"username\":\"boss\",\"password\":\"secret-pass\"}", false);
        HttpClient owner = client();
        post(owner, "/api/auth/register", "{\"username\":\"maker\",\"password\":\"secret-pass\"}", false);
        HttpClient other = client();
        post(other, "/api/auth/register", "{\"username\":\"fan\",\"password\":\"secret-pass\"}", false);
        HttpClient guest = client();
        long world = om.readTree(post(owner, "/rune/api/worlds", "{\"name\":\"Ygg\"}", false).body()).path("id").asLong();
        long lang = om.readTree(post(owner, "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Elven\"}", false).body()).path("id").asLong();
        long hidden = om.readTree(post(owner, "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Secret\"}", false).body()).path("id").asLong();
        assertEquals(200, edit(owner, lang, "{\"gloss\":\"water\",\"form\":\"ata\",\"year\":1}").statusCode());
        String L = "/rune/api/languages/" + lang;

        // private: visitors and others see nothing
        assertEquals(0, worlds(guest).size());
        assertEquals(404, get(guest, L + "/words").statusCode());
        assertEquals(null, find(worlds(other), lang));

        // only admins make it public (not even the owner); suggestions need it public first
        assertEquals(403, post(owner, L + "/publish", "{\"public\":true}", false).statusCode());
        assertEquals(401, post(guest, L + "/publish", "{\"public\":true}", false).statusCode());
        assertEquals(400, post(admin, "/rune/api/languages/" + hidden + "/publish", "{\"suggestions\":true}", false).statusCode());
        HttpResponse<String> pub = post(admin, L + "/publish", "{\"public\":true}", false);
        assertEquals(200, pub.statusCode(), pub.body());

        // anyone can read it now, also without logging in; it's under Community for them, not for the owner
        JsonNode gl = find(worlds(guest), lang);
        assertTrue(gl != null && gl.path("_community").asBoolean(), worlds(guest).toString());
        assertEquals(1, gl.path("level").asInt());
        assertEquals(null, find(worlds(guest), hidden), "the private language beside it stays hidden");
        assertFalse(find(worlds(owner), lang).path("_community").asBoolean());
        assertTrue(find(worlds(other), lang).path("_community").asBoolean());
        assertTrue(get(guest, L + "/words").body().contains("ata"));
        long word = om.readTree(get(guest, L + "/words").body()).get(0).path("id").asLong();
        for (String path : new String[]{"", "/rules", "/grammar", "/phonemes", "/formrules", "/sentences", "/missing", "/rule-versions", "/tree-check", "/export.xlsx"})
            assertEquals(200, get(guest, L + path).statusCode(), path);
        assertEquals(200, get(guest, "/rune/api/words/" + word + "/history").statusCode());
        assertEquals(200, post(guest, L + "/sentences/build", "{\"source\":\"(water)\",\"year\":5}", false).statusCode());
        // but not change it, nor see the collaboration pages
        assertEquals(401, edit(guest, lang, "{\"gloss\":\"fire\",\"form\":\"pira\",\"year\":1}").statusCode());
        assertEquals(401, get(guest, L + "/changes").statusCode());
        assertEquals(401, get(guest, L + "/log").statusCode());
        // someone logged in may read it but not suggest yet
        assertEquals(403, edit(other, lang, "{\"gloss\":\"fire\",\"form\":\"pira\",\"year\":1}").statusCode());
        assertFalse(find(worlds(other), lang).path("can_suggest").asBoolean());

        // public suggestions: the owner (or an admin) switches them on
        assertEquals(403, post(other, L + "/publish", "{\"suggestions\":true}", false).statusCode());
        assertEquals(200, post(owner, L + "/publish", "{\"suggestions\":true}", false).statusCode());
        assertTrue(find(worlds(other), lang).path("can_suggest").asBoolean());
        assertFalse(find(worlds(guest), lang).path("can_suggest").asBoolean(), "visitors must log in to suggest");
        HttpResponse<String> sug = edit(other, lang, "{\"gloss\":\"fire\",\"form\":\"pira\",\"year\":1}");
        assertEquals(200, sug.statusCode(), sug.body());
        assertEquals("pending", om.readTree(sug.body()).path("status").asText(), "suggestions wait for approval");
        assertFalse(get(owner, L + "/words").body().contains("pira"));
        // the suggester sees their own suggestion; things editors do directly stay closed
        assertTrue(get(other, L + "/changes").body().contains("pira"));
        assertEquals(403, post(other, L + "/missing", "{\"gloss\":\"stone\"}", false).statusCode());
        assertEquals(403, post(other, L + "/rule-versions", "{\"name\":\"mine\"}", false).statusCode());
        assertEquals(403, post(other, L + "/undo", "{}", false).statusCode());
        assertEquals(403, post(other, L + "/sentences", "{\"source\":\"(water)\",\"year\":5}", false).statusCode());
        // the owner approves it
        long change = om.readTree(get(owner, L + "/changes").body()).get(0).path("id").asLong();
        assertEquals(200, post(owner, "/rune/api/changes/" + change + "/approve", "", false).statusCode());
        assertTrue(get(guest, L + "/words").body().contains("pira"), "seen by everyone, also visitors");

        // private again: gone for everyone else, and suggestions are off
        assertEquals(200, post(admin, L + "/publish", "{\"public\":false}", false).statusCode());
        assertEquals(0, worlds(guest).size());
        assertEquals(404, get(guest, L + "/words").statusCode());
        assertEquals(404, edit(other, lang, "{\"gloss\":\"sky\",\"form\":\"sema\",\"year\":1}").statusCode());
        assertFalse(find(worlds(owner), lang).path("public_suggestions").asBoolean());
    }
}
