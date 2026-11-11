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

/** Tags on sound changes, switching them off, and sound-change versions, on a fresh database of its own. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RuleTagsVersionsTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/ruletags-" + System.nanoTime()
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

    private HttpResponse<String> delete(HttpClient c, String path) throws Exception {
        return c.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).DELETE().build(), HttpResponse.BodyHandlers.ofString());
    }

    private JsonNode edit(HttpClient c, long lang, String action, Long id, String payload) throws Exception {
        HttpResponse<String> r = post(c, "/rune/api/languages/" + lang + "/edit", "{\"entity\":\"rule\",\"action\":\"" + action + "\""
                + (id == null ? "" : ",\"entityId\":" + id) + ",\"payload\":" + payload + "}", false);
        assertEquals(200, r.statusCode(), r.body());
        return om.readTree(r.body());
    }

    private JsonNode rules(HttpClient c, long lang, String scope) throws Exception {
        return om.readTree(get(c, "/rune/api/languages/" + lang + "/rules?scope=" + scope).body());
    }

    private long ruleId(JsonNode rules, String pattern) {
        for (JsonNode r : rules) if (r.path("pattern").asText().equals(pattern)) return r.path("id").asLong();
        throw new AssertionError("no rule " + pattern + " in " + rules);
    }

    /** The word's form after all sound changes, in a language. */
    private String latest(HttpClient c, long lang, String gloss, String langName) throws Exception {
        for (JsonNode w : om.readTree(get(c, "/rune/api/languages/" + lang + "/words").body()))
            if (w.path("gloss").asText().equals(gloss)) return w.path("latest").path(langName).asText();
        throw new AssertionError("no word " + gloss);
    }

    private HttpResponse<String> sw(HttpClient c, long lang, String tag, boolean off) throws Exception {
        return post(c, "/rune/api/languages/" + lang + "/tag-switch", "{\"tag\":\"" + tag + "\",\"off\":" + off + "}", false);
    }

    @Test
    void tagsAndVersions() throws Exception {
        HttpClient owner = client();
        post(owner, "/api/auth/register", "{\"username\":\"owner1\",\"password\":\"secret-pass\"}", false);
        HttpClient editor = client();
        post(editor, "/api/auth/register", "{\"username\":\"editor1\",\"password\":\"secret-pass\"}", false);
        long world = om.readTree(post(owner, "/rune/api/worlds", "{\"name\":\"W\"}", false).body()).path("id").asLong();
        long proto = om.readTree(post(owner, "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Proto\"}", false).body()).path("id").asLong();
        long branch = om.readTree(post(owner, "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Branch\",\"parentId\":" + proto + ",\"splitYear\":500}", false).body()).path("id").asLong();
        post(owner, "/rune/api/languages/" + proto + "/edit", "{\"entity\":\"word\",\"action\":\"CREATE\",\"payload\":{\"gloss\":\"father\",\"form\":\"tata\",\"year\":0}}", false);
        post(owner, "/rune/api/shares", "{\"scope\":\"WORLD\",\"targetId\":" + world + ",\"username\":\"editor1\",\"level\":\"EDITOR\",\"autoApprove\":true}", false);

        // tags are cleaned up: trimmed, no repeats in any letter case
        edit(owner, proto, "CREATE", null, "{\"year\":100,\"pattern\":\"t\",\"replacement\":\"d\",\"name\":\"lenition\",\"tags\":\" Lenition ,experimental, lenition ,\"}");
        edit(owner, branch, "CREATE", null, "{\"year\":600,\"pattern\":\"a\",\"replacement\":\"e\",\"tags\":\"Experimental\"}");
        edit(owner, proto, "CREATE", null, "{\"year\":50,\"pattern\":\"x\",\"replacement\":\"h\"}");
        JsonNode all = rules(owner, proto, "branches");
        assertEquals(3, all.size());
        long lenition = ruleId(all, "t"), aToE = ruleId(all, "a"), xToH = ruleId(all, "x");
        for (JsonNode r : all) if (r.path("id").asLong() == lenition) assertEquals("Lenition, experimental", r.path("tags").asText());
        for (JsonNode r : all) assertFalse(r.path("off").asBoolean());
        assertEquals("dada", latest(owner, proto, "father", "Proto"));
        assertEquals("dede", latest(owner, branch, "father", "Branch"));

        // switching a tag off in the branch: only the branch's sound changes with it are left out
        assertEquals(403, sw(editor, branch, "experimental", true).statusCode(), "only the owner switches tags");
        assertEquals(200, sw(owner, branch, "experimental", true).statusCode());
        assertEquals("dada", latest(owner, branch, "father", "Branch"));
        assertEquals("dada", latest(owner, proto, "father", "Proto"));
        // switching it off in the parent reaches the branch too
        HttpResponse<String> off = sw(owner, proto, "EXPERIMENTAL", true);
        assertEquals(200, off.statusCode(), off.body());
        assertEquals("tata", latest(owner, proto, "father", "Proto"));
        assertEquals("tata", latest(owner, branch, "father", "Branch"));
        for (JsonNode r : rules(owner, proto, "branches")) {
            if (r.path("id").asLong() == xToH) assertFalse(r.path("off").asBoolean());
            else assertTrue(r.path("off").asBoolean(), r.toString());
            if (r.path("id").asLong() == lenition) assertTrue(r.path("off_in").asText().startsWith("Proto"), r.toString());
        }
        assertTrue(get(owner, "/rune/api/languages/" + proto + "/rules/export.json?scope=self").body().contains("\"tags\":\"Lenition, experimental\""));
        sw(owner, proto, "experimental", false);
        sw(owner, branch, "experimental", false);
        assertEquals("dede", latest(owner, branch, "father", "Branch"));

        // versions: save, change things, compare
        assertEquals(400, post(owner, "/rune/api/languages/" + proto + "/rule-versions", "{\"name\":\" \"}", false).statusCode());
        long v1 = om.readTree(post(owner, "/rune/api/languages/" + proto + "/rule-versions", "{\"name\":\"v1\",\"note\":\"before changes\"}", false).body()).path("id").asLong();
        edit(owner, proto, "UPDATE", lenition, "{\"replacement\":\"z\",\"tags\":\"lenition\"}");
        edit(owner, proto, "CREATE", null, "{\"year\":300,\"pattern\":\"k\",\"replacement\":\"g\"}");
        edit(owner, proto, "DELETE", xToH, "{}");
        sw(owner, proto, "lenition", true);
        JsonNode cmp = om.readTree(get(owner, "/rune/api/rule-versions/" + v1 + "/compare").body());
        assertFalse(cmp.path("same").asBoolean());
        assertEquals(1, cmp.path("added").size(), cmp.toString());
        assertEquals("k", cmp.path("added").get(0).path("pattern").asText());
        assertEquals(1, cmp.path("removed").size());
        assertEquals("x", cmp.path("removed").get(0).path("pattern").asText());
        assertEquals(1, cmp.path("changed").size());
        assertEquals("[\"replacement\",\"tags\"]", cmp.path("changed").get(0).path("fields").toString());
        assertEquals("lenition", cmp.path("offTags").path("now").asText());
        // a branch's sound changes aren't in the parent's version
        assertFalse(cmp.toString().contains("\"pattern\":\"a\""));

        // an editor can save versions, but only the owner restores; an editor deletes only their own
        long ev = om.readTree(post(editor, "/rune/api/languages/" + proto + "/rule-versions", "{\"name\":\"editor's\"}", false).body()).path("id").asLong();
        assertEquals(403, post(editor, "/rune/api/rule-versions/" + v1 + "/restore", "", false).statusCode());
        assertEquals(403, delete(editor, "/rune/api/rule-versions/" + v1).statusCode());
        assertEquals(200, delete(editor, "/rune/api/rule-versions/" + ev).statusCode());

        // restore: back to v1, with the same rule ids; what was there is saved first
        JsonNode res = om.readTree(post(owner, "/rune/api/rule-versions/" + v1 + "/restore", "", false).body());
        assertEquals(2, res.path("restored").asInt(), res.toString());
        JsonNode now = rules(owner, proto, "self");
        assertEquals(2, now.size());
        assertEquals(lenition, ruleId(now, "t"));
        assertEquals(xToH, ruleId(now, "x"));
        assertTrue(om.readTree(get(owner, "/rune/api/rule-versions/" + v1 + "/compare").body()).path("same").asBoolean());
        assertEquals("dada", latest(owner, proto, "father", "Proto"));
        long before = res.path("savedFirst").asLong();
        JsonNode back = om.readTree(get(owner, "/rune/api/rule-versions/" + before + "/compare").body());
        assertEquals(1, back.path("removed").size(), "the version saved first still has the k > g change: " + back);
        JsonNode list = om.readTree(get(owner, "/rune/api/languages/" + proto + "/rule-versions").body());
        assertEquals(2, list.size());
        assertTrue(list.get(0).path("name").asText().startsWith("Before restoring"));
        // and new sound changes still get new ids after the restored ones
        edit(owner, proto, "CREATE", null, "{\"year\":400,\"pattern\":\"p\",\"replacement\":\"f\"}");
        assertEquals(3, rules(owner, proto, "self").size());

        // versions are part of Export everything
        assertTrue(get(owner, "/rune/api/admin/export-all").body().contains("\"rule_versions\""));
    }

    /** Importing sound changes with "tag all imported": new, changed and already-present ones all get the tag. */
    @Test
    void importWithTag() throws Exception {
        HttpClient owner = client();
        post(owner, "/api/auth/register", "{\"username\":\"importer1\",\"password\":\"secret-pass\"}", false);
        long world = om.readTree(post(owner, "/rune/api/worlds", "{\"name\":\"Imp\"}", false).body()).path("id").asLong();
        long lang = om.readTree(post(owner, "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Imperial\"}", false).body()).path("id").asLong();
        edit(owner, lang, "CREATE", null, "{\"year\":100,\"pattern\":\"t\",\"replacement\":\"d\",\"tags\":\"lenition\"}");
        edit(owner, lang, "CREATE", null, "{\"year\":200,\"pattern\":\"k\",\"replacement\":\"g\"}");
        long tToD = ruleId(rules(owner, lang, "self"), "t");
        // the file: rule t (by id, changed replacement), rule k (same as in the app, no id), two new ones (one with its own tag)
        String file = "[{\"id\":" + tToD + ",\"year\":100,\"pattern\":\"t\",\"replacement\":\"th\"},"
                + "{\"year\":200,\"pattern\":\"k\",\"replacement\":\"g\"},"
                + "{\"year\":300,\"pattern\":\"p\",\"replacement\":\"f\"},"
                + "{\"year\":400,\"pattern\":\"s\",\"replacement\":\"h\",\"tags\":\"debuccalisation\"}]";
        String url = "/rune/api/languages/" + lang + "/rules/import";
        JsonNode check = om.readTree(post(owner, url, "{\"rules\":" + file + ",\"tag\":\" Import 2026 \",\"dryRun\":true}", false).body());
        assertEquals(2, check.path("added").asInt(), check.toString());
        assertEquals(2, check.path("changed").asInt(), "t is changed, k only gets the tag: " + check);
        assertEquals(0, check.path("unchanged").asInt());
        assertEquals("Import 2026", check.path("tagAll").asText());
        assertEquals(2, rules(owner, lang, "self").size(), "a check changes nothing");
        assertTrue(rules(owner, lang, "self").toString().contains("\"tags\":\"lenition\""));

        JsonNode done = om.readTree(post(owner, url, "{\"rules\":" + file + ",\"tag\":\"Import 2026\",\"dryRun\":false}", false).body());
        assertTrue(done.path("applied").asBoolean(), done.toString());
        java.util.Map<String, String> tags = new java.util.HashMap<>();
        for (JsonNode r : rules(owner, lang, "self")) tags.put(r.path("pattern").asText(), r.path("tags").asText());
        assertEquals("lenition, Import 2026", tags.get("t"), "own tags are kept");
        assertEquals("Import 2026", tags.get("k"));
        assertEquals("Import 2026", tags.get("p"));
        assertEquals("debuccalisation, Import 2026", tags.get("s"));
        assertEquals(4, tags.size(), "the identical rule wasn't added twice");

        // the same import again, with the same tag (any letter case): nothing to do
        JsonNode again = om.readTree(post(owner, url, "{\"rules\":" + file.replace("\"replacement\":\"th\"", "\"replacement\":\"th\"")
                + ",\"tag\":\"import 2026\",\"dryRun\":true}", false).body());
        assertEquals(0, again.path("added").asInt() + again.path("changed").asInt(), again.toString());
        // and without a tag, the import works as before
        JsonNode plain = om.readTree(post(owner, url, "{\"rules\":[{\"year\":500,\"pattern\":\"m\",\"replacement\":\"n\"}],\"dryRun\":true}", false).body());
        assertEquals(1, plain.path("added").asInt());
        assertEquals("", plain.path("tagAll").asText());
    }
}
