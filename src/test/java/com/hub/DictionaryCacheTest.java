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

/** Kept dictionaries are never out of date: every kind of change shows at once. On a fresh database of its own. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class DictionaryCacheTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/dictcache-" + System.nanoTime()
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

    private HttpResponse<String> edit(HttpClient c, long lang, String entity, String action, Long id, String payload) throws Exception {
        HttpResponse<String> r = post(c, "/rune/api/languages/" + lang + "/edit", "{\"entity\":\"" + entity + "\",\"action\":\"" + action + "\""
                + (id == null ? "" : ",\"entityId\":" + id) + ",\"payload\":" + payload + "}", false);
        assertEquals(200, r.statusCode(), r.body());
        return r;
    }

    /** The word's form in the language after all sound changes ("" if it isn't in the dictionary). */
    private String latest(HttpClient c, long lang, String langName, String gloss) throws Exception {
        for (JsonNode w : om.readTree(get(c, "/rune/api/languages/" + lang + "/words").body()))
            if (w.path("gloss").asText().equals(gloss)) return w.path("latest").path(langName).asText() + (w.has("lost_year") ? " lost" : "");
        return "";
    }

    @Test
    void everyChangeShowsAtOnce() throws Exception {
        HttpClient owner = client();
        post(owner, "/api/auth/register", "{\"username\":\"owner1\",\"password\":\"secret-pass\"}", false);
        HttpClient viewer = client();
        post(viewer, "/api/auth/register", "{\"username\":\"viewer1\",\"password\":\"secret-pass\"}", false);
        long world = om.readTree(post(owner, "/rune/api/worlds", "{\"name\":\"W\"}", false).body()).path("id").asLong();
        long proto = om.readTree(post(owner, "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Proto\"}", false).body()).path("id").asLong();
        long branch = om.readTree(post(owner, "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Branch\",\"parentId\":" + proto + ",\"splitYear\":500}", false).body()).path("id").asLong();
        edit(owner, proto, "word", "CREATE", null, "{\"gloss\":\"water\",\"form\":\"ata\",\"year\":1}");
        long water = om.readTree(get(owner, "/rune/api/languages/" + proto + "/words").body()).get(0).path("id").asLong();
        assertEquals("ata", latest(owner, branch, "Branch", "water"));
        assertEquals("ata", latest(owner, branch, "Branch", "water"), "kept: same answer");

        // a sound change, an edited word, a changed setting
        edit(owner, proto, "rule", "CREATE", null, "{\"year\":100,\"pattern\":\"t\",\"replacement\":\"d\",\"tags\":\"exp\"}");
        assertEquals("ada", latest(owner, branch, "Branch", "water"));
        edit(owner, proto, "word", "UPDATE", water, "{\"form\":\"ati\"}");
        assertEquals("adi", latest(owner, branch, "Branch", "water"));
        // a tag switched off and on
        post(owner, "/rune/api/languages/" + proto + "/tag-switch", "{\"tag\":\"exp\",\"off\":true}", false);
        assertEquals("ati", latest(owner, branch, "Branch", "water"));
        post(owner, "/rune/api/languages/" + proto + "/tag-switch", "{\"tag\":\"exp\",\"off\":false}", false);
        assertEquals("adi", latest(owner, branch, "Branch", "water"));
        // a version restored (in one transaction)
        long v = om.readTree(post(owner, "/rune/api/languages/" + proto + "/rule-versions", "{\"name\":\"v\"}", false).body()).path("id").asLong();
        long rule = om.readTree(get(owner, "/rune/api/languages/" + proto + "/rules").body()).get(0).path("id").asLong();
        edit(owner, proto, "rule", "UPDATE", rule, "{\"replacement\":\"z\"}");
        assertEquals("azi", latest(owner, branch, "Branch", "water"));
        post(owner, "/rune/api/rule-versions/" + v + "/restore", "", false);
        assertEquals("adi", latest(owner, branch, "Branch", "water"));
        // undo, and a word lost
        post(owner, "/rune/api/languages/" + proto + "/undo", "{}", false);
        assertEquals("ada", latest(owner, branch, "Branch", "water"), "undo put the word back to ata");
        edit(owner, proto, "loss", "CREATE", null, "{\"word_id\":" + water + ",\"lang_id\":" + branch + ",\"year\":900}");
        assertTrue(latest(owner, branch, "Branch", "water").endsWith(" lost"));

        // what someone sees depends on their access: not the owner's kept dictionary
        assertEquals(404, get(viewer, "/rune/api/languages/" + branch + "/words").statusCode());
        post(owner, "/rune/api/shares", "{\"scope\":\"LANGUAGE\",\"targetId\":" + branch + ",\"username\":\"viewer1\",\"level\":\"VIEWER\"}", false);
        assertEquals("", latest(viewer, branch, "Branch", "water"), "the viewer may not see Proto, so not its words");
        post(owner, "/rune/api/shares", "{\"scope\":\"WORLD\",\"targetId\":" + world + ",\"username\":\"viewer1\",\"level\":\"VIEWER\"}", false);
        assertTrue(latest(viewer, branch, "Branch", "water").startsWith("ada"));

        // Import everything writes past the usual way: still seen at once
        HttpResponse<byte[]> ex = owner.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/rune/api/admin/export-all")).GET().build(), HttpResponse.BodyHandlers.ofByteArray());
        edit(owner, proto, "word", "UPDATE", water, "{\"form\":\"oto\"}");
        assertTrue(latest(owner, branch, "Branch", "water").startsWith("odo"));
        String b = "----x" + System.nanoTime();
        java.io.ByteArrayOutputStream body = new java.io.ByteArrayOutputStream();
        body.write(("--" + b + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"e.json\"\r\nContent-Type: application/json\r\n\r\n").getBytes());
        body.write(ex.body());
        body.write(("\r\n--" + b + "\r\nContent-Disposition: form-data; name=\"replace\"\r\n\r\ntrue\r\n--" + b + "--\r\n").getBytes());
        HttpResponse<String> imp = owner.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/rune/api/admin/import-all"))
                .header("Content-Type", "multipart/form-data; boundary=" + b).POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, imp.statusCode(), imp.body());
        assertTrue(latest(owner, branch, "Branch", "water").startsWith("ada"), "back to what was exported");
    }
}
