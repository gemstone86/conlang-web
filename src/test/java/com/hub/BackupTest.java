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

/** Root and Rune's Export everything / Import everything, on a fresh database of its own. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class BackupTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/backup-" + System.nanoTime()
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

    private HttpResponse<String> upload(HttpClient c, String path, byte[] file, boolean replace) throws Exception {
        String bnd = "----hubtest" + System.nanoTime();
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        body.write(("--" + bnd + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"export.json\"\r\n"
                + "Content-Type: application/json\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        body.write(file);
        body.write(("\r\n--" + bnd + "\r\nContent-Disposition: form-data; name=\"replace\"\r\n\r\n" + replace
                + "\r\n--" + bnd + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return c.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "multipart/form-data; boundary=" + bnd)
                .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())).build(), HttpResponse.BodyHandlers.ofString());
    }

    /** Export everything, rename an account in the file, import it again (replacing): ids, links and passwords survive. */
    @Test
    void exportAndImportEverything() throws Exception {
        ObjectMapper om = new ObjectMapper();
        HttpClient admin = client();
        String a = "boss" + (System.nanoTime() % 100000);
        post(admin, "/api/auth/register", "{\"username\":\"" + a + "\",\"password\":\"secret-pass\"}", false);
        HttpClient other = client();
        String o = "maker" + (System.nanoTime() % 100000);
        assertEquals(200, post(other, "/api/auth/register", "{\"username\":\"" + o + "\",\"password\":\"makers-pass\"}", false).statusCode());

        // the other account builds a world: a proto language, a branch, a word and a sound change
        long world = om.readTree(post(other, "/rune/api/worlds", "{\"name\":\"Ygg\"}", false).body()).path("id").asLong();
        long proto = om.readTree(post(other, "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Proto\"}", false).body()).path("id").asLong();
        HttpResponse<String> br = post(other, "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Branch\",\"parentId\":" + proto + ",\"splitYear\":500}", false);
        assertEquals(200, br.statusCode(), br.body());
        long branch = om.readTree(br.body()).path("id").asLong();
        HttpResponse<String> w = post(other, "/rune/api/languages/" + proto + "/edit",
                "{\"entity\":\"word\",\"action\":\"CREATE\",\"payload\":{\"gloss\":\"water\",\"form\":\"ata\",\"year\":0}}", false);
        assertEquals(200, w.statusCode(), w.body());
        HttpResponse<String> r = post(other, "/rune/api/languages/" + proto + "/edit",
                "{\"entity\":\"rule\",\"action\":\"CREATE\",\"payload\":{\"pattern\":\"t\",\"replacement\":\"d\",\"year\":100}}", false);
        assertEquals(200, r.statusCode(), r.body());
        String branchWordsBefore = get(other, "/rune/api/languages/" + branch + "/words").body();

        // only admins may export or import
        assertEquals(403, get(other, "/rune/api/admin/export-all").statusCode());
        HttpResponse<byte[]> ex = admin.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/rune/api/admin/export-all")).GET().build(),
                HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(200, ex.statusCode());
        JsonNode file = om.readTree(ex.body());
        assertEquals("root-and-rune-export", file.path("format").asText());
        assertFalse(new String(ex.body(), StandardCharsets.UTF_8).contains("@eon"), "the built-in weather account isn't exported");

        // in the file, the other account gets a new name (as if it came from another app)
        JsonNode users = file.path("tables").path("users");
        int nameCol = -1;
        for (int i = 0; i < users.path("columns").size(); i++) if (users.path("columns").get(i).asText().equals("username")) nameCol = i;
        for (JsonNode row : users.path("rows")) if (row.get(nameCol).asText().equals(o)) ((ArrayNode) row).set(nameCol, om.getNodeFactory().textNode(o + "x"));
        byte[] changed = om.writeValueAsBytes(file);

        HttpResponse<String> refused = upload(admin, "/rune/api/admin/import-all", changed, false);
        assertEquals(409, refused.statusCode(), "there is data already: " + refused.body());
        HttpResponse<String> imp = upload(admin, "/rune/api/admin/import-all", changed, true);
        assertEquals(200, imp.statusCode(), imp.body());
        JsonNode res = om.readTree(imp.body());
        assertTrue(res.path("usersCreated").toString().contains(o + "x"), imp.body());
        assertTrue(res.path("usersMatched").toString().contains(a), imp.body());
        assertTrue(res.path("warnings").isEmpty(), imp.body());

        // the renamed account was created with its old password, and owns the world with the same ids
        HttpClient moved = client();
        assertEquals(200, post(moved, "/api/auth/login", "{\"username\":\"" + o + "x\",\"password\":\"makers-pass\"}", false).statusCode());
        String worlds = get(moved, "/rune/api/worlds").body();
        assertTrue(worlds.contains("Ygg") && worlds.contains("\"id\":" + branch), worlds);
        assertEquals(branchWordsBefore, get(moved, "/rune/api/languages/" + branch + "/words").body(), "branch inherits and evolves the same");
        assertTrue(get(moved, "/rune/api/languages/" + proto + "/rules").body().contains("\"replacement\":\"d\""));
        // the old account name no longer owns anything
        assertFalse(get(other, "/rune/api/worlds").body().contains("Ygg"));

        // new rows get ids after the imported ones
        JsonNode nw = om.readTree(post(moved, "/rune/api/worlds", "{\"name\":\"After\"}", false).body());
        assertTrue(nw.path("id").asLong() > branch, nw.toString());
        HttpResponse<String> w2 = post(moved, "/rune/api/languages/" + proto + "/edit",
                "{\"entity\":\"word\",\"action\":\"CREATE\",\"payload\":{\"gloss\":\"fire\",\"form\":\"pira\",\"year\":0}}", false);
        assertEquals(200, w2.statusCode(), w2.body());
    }
}
