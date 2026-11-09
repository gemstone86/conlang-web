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

/** The Claude connector (MCP server at /mcp/<key>), on a fresh database of its own. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ConnectorTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/connector-" + System.nanoTime()
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
    private int rpcId = 0;

    private HttpResponse<String> mcpRaw(String key, String body) throws Exception {
        return HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/mcp/" + key))
                .header("Content-Type", "application/json").header("Accept", "application/json, text/event-stream")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }

    private JsonNode rpc(String key, String method, String params) throws Exception {
        HttpResponse<String> r = mcpRaw(key, "{\"jsonrpc\":\"2.0\",\"id\":" + (++rpcId) + ",\"method\":\"" + method + "\",\"params\":" + params + "}");
        assertEquals(200, r.statusCode(), r.body());
        assertTrue(r.headers().firstValue("Content-Type").orElse("").startsWith("application/json"));
        JsonNode n = om.readTree(r.body());
        assertEquals(rpcId, n.path("id").asInt());
        return n;
    }

    /** tools/call: the result, with its text parsed as JSON when it is JSON. */
    private JsonNode tool(String key, String name, String args) throws Exception {
        return rpc(key, "tools/call", "{\"name\":\"" + name + "\",\"arguments\":" + args + "}").path("result");
    }

    private JsonNode data(JsonNode toolResult) throws Exception {
        assertFalse(toolResult.path("isError").asBoolean(), toolResult.toString());
        return om.readTree(toolResult.path("content").get(0).path("text").asText());
    }

    @Test
    void connector() throws Exception {
        HttpClient boss = client();
        post(boss, "/api/auth/register", "{\"username\":\"boss\",\"password\":\"secret-pass\"}", false);
        HttpClient helper = client();
        post(helper, "/api/auth/register", "{\"username\":\"Claude\",\"password\":\"secret-pass\"}", false);

        long world = om.readTree(post(boss, "/rune/api/worlds", "{\"name\":\"Ygg\"}", false).body()).path("id").asLong();
        long lang = om.readTree(post(boss, "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Elven\"}", false).body()).path("id").asLong();
        post(boss, "/rune/api/worlds", "{\"name\":\"Secret\"}", false);
        post(boss, "/rune/api/languages/" + lang + "/edit", "{\"entity\":\"word\",\"action\":\"CREATE\",\"payload\":{\"gloss\":\"water\",\"form\":\"ata\",\"year\":0}}", false);
        post(boss, "/rune/api/languages/" + lang + "/edit", "{\"entity\":\"word\",\"action\":\"CREATE\",\"payload\":{\"gloss\":\"fire\",\"form\":\"pira\",\"year\":0}}", false);
        post(boss, "/rune/api/languages/" + lang + "/edit", "{\"entity\":\"rule\",\"action\":\"CREATE\",\"payload\":{\"pattern\":\"t\",\"replacement\":\"d\",\"year\":100}}", false);
        post(boss, "/rune/api/languages/" + lang + "/missing", "{\"gloss\":\"stone\"}", false);
        // the Claude account may read the Ygg world, not the Secret one
        post(boss, "/rune/api/shares", "{\"scope\":\"WORLD\",\"targetId\":" + world + ",\"username\":\"Claude\",\"level\":\"VIEWER\"}", false);

        // only admins make keys; the address is shown once
        assertEquals(403, post(helper, "/rune/api/admin/connector-keys", "{\"username\":\"Claude\"}", false).statusCode());
        HttpResponse<String> made = post(boss, "/rune/api/admin/connector-keys", "{\"username\":\"claude\",\"label\":\"claude.ai\"}", false);
        assertEquals(200, made.statusCode(), made.body());
        String url = om.readTree(made.body()).path("url").asText();
        assertTrue(url.startsWith("http://localhost:" + port + "/mcp/rr"), url);
        assertFalse(made.body().contains("\"key\""));
        String key = url.substring(url.lastIndexOf('/') + 1);

        // handshake
        JsonNode init = rpc(key, "initialize", "{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"1\"}}");
        assertEquals("2025-06-18", init.path("result").path("protocolVersion").asText());
        assertTrue(init.path("result").path("capabilities").has("tools"));
        assertTrue(init.path("result").path("instructions").asText().contains("'Claude'"));
        assertEquals("2024-11-05", rpc(key, "initialize", "{\"protocolVersion\":\"2024-11-05\"}").path("result").path("protocolVersion").asText());
        assertEquals(202, mcpRaw(key, "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}").statusCode());
        assertEquals(0, rpc(key, "ping", "{}").path("result").size());

        // the tools
        JsonNode list = rpc(key, "tools/list", "{}").path("result").path("tools");
        java.util.Set<String> names = new java.util.HashSet<>();
        for (JsonNode t : list) {
            names.add(t.path("name").asText());
            assertTrue(t.path("annotations").path("readOnlyHint").asBoolean(), t.toString());
            assertEquals("object", t.path("inputSchema").path("type").asText());
        }
        for (String n : java.util.List.of("rune_list_languages", "rune_words", "rune_search_words", "rune_word_history", "rune_sound_changes",
                "rune_missing_words", "rune_build_sentence", "rune_check", "rune_etymology", "rune_texts", "rune_text", "weather_world", "weather_day", "weather_month", "weather_maps", "weather_get"))
            assertTrue(names.contains(n), n + " in " + names);

        // Root and Rune, as the Claude account
        JsonNode worlds = data(tool(key, "rune_list_languages", "{}"));
        assertTrue(worlds.toString().contains("Elven"), worlds.toString());
        assertFalse(worlds.toString().contains("Secret"), "only what the account may see");
        JsonNode words = data(tool(key, "rune_words", "{\"language_id\":" + lang + ",\"query\":\"WAT\"}"));
        assertEquals(1, words.path("total").asInt(), words.toString());
        assertEquals("ata", words.path("words").get(0).path("form").asText());
        assertEquals("ada", words.path("words").get(0).path("latest").path("Elven").asText(), "after the sound change t > d: " + words);
        long wordId = words.path("words").get(0).path("id").asLong();
        assertTrue(data(tool(key, "rune_word_history", "{\"word_id\":" + wordId + "}")).toString().contains("ada"));
        JsonNode found = data(tool(key, "rune_search_words", "{\"query\":\"pira\"}"));
        assertEquals("Elven", found.path("words").get(0).path("language").asText(), found.toString());
        assertTrue(data(tool(key, "rune_sound_changes", "{\"language_id\":" + lang + "}")).toString().contains("\"replacement\":\"d\""));
        assertTrue(data(tool(key, "rune_missing_words", "{\"language_id\":" + lang + "}")).toString().contains("stone"));
        assertTrue(data(tool(key, "rune_build_sentence", "{\"language_id\":" + lang + ",\"source\":\"(water) (fire)\",\"year\":200}")).path("surface").asText().contains("ada"));
        // a viewer can't preview changes (needs editor); errors come back as tool errors, not protocol errors
        JsonNode denied = tool(key, "rune_preview_sound_change", "{\"language_id\":" + lang + ",\"pattern\":\"a\",\"replacement\":\"e\",\"year\":300}");
        assertTrue(denied.path("isError").asBoolean(), denied.toString());
        assertTrue(tool(key, "rune_words", "{}").path("isError").asBoolean(), "language_id is required");

        // the weather generator
        JsonNode wworld = data(tool(key, "weather_world", "{}"));
        String region = wworld.path("regions").get(0).path("name").asText();
        JsonNode day = data(tool(key, "weather_day", "{\"region\":\"" + region + "\",\"year\":1000,\"month\":3,\"day\":5,\"english\":true}"));
        assertEquals(region, day.path("region").asText(), day.toString());
        assertTrue(day.has("temperature"));
        JsonNode month = data(tool(key, "weather_month", "{\"region\":\"" + region + "\",\"year\":1000,\"month\":3}"));
        assertEquals(28, month.size(), "days in the month");
        JsonNode maps = data(tool(key, "weather_maps", "{}"));
        assertTrue(maps.toString().contains("@eon") && !maps.get(0).has("settings"), maps.toString());
        long mapId = maps.get(0).path("id").asLong();
        assertTrue(data(tool(key, "weather_get", "{\"path\":\"/maps/" + mapId + "/anchors\"}")).isArray());
        assertTrue(tool(key, "weather_get", "{\"path\":\"/maps/" + mapId + "/image\"}").path("isError").asBoolean(), "images aren't data");
        assertTrue(tool(key, "weather_day", "{\"region\":\"" + region + "\",\"year\":1000,\"month\":13,\"day\":1}").path("isError").asBoolean());
        assertTrue(data(tool(key, "weather_campaigns", "{}")).isArray());

        // protocol errors
        assertEquals(-32602, rpc(key, "tools/call", "{\"name\":\"nope\"}").path("error").path("code").asInt());
        assertEquals(-32601, rpc(key, "resources/list", "{}").path("error").path("code").asInt());
        assertEquals(405, HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/mcp/" + key)).GET().build(),
                HttpResponse.BodyHandlers.ofString()).statusCode());
        assertEquals(404, mcpRaw(key + "x", "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}").statusCode());

        // the admin sees the use, and revoking ends it
        JsonNode keys = om.readTree(get(boss, "/rune/api/admin/connector-keys").body());
        assertEquals("Claude", keys.get(0).path("username").asText());
        assertTrue(keys.get(0).path("calls").asInt() > 10, keys.toString());
        assertTrue(get(boss, "/rune/api/admin/log?category=connector").body().contains("rune_words"));
        assertEquals(401, HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/rune/api/admin/connector-keys/"
                + keys.get(0).path("id").asLong())).DELETE().build(), HttpResponse.BodyHandlers.ofString()).statusCode(), "revoking needs an admin's login");
        HttpResponse<String> rv = boss.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/rune/api/admin/connector-keys/" + keys.get(0).path("id").asLong()))
                .DELETE().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, rv.statusCode(), rv.body());
        assertEquals(404, mcpRaw(key, "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}").statusCode());
    }
}
