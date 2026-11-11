package com.hub.connector;

import com.conlangs.web.ApiException;
import com.conlangs.web.AppLog;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Claude connector: a Model Context Protocol server at /mcp/&lt;key&gt; (Streamable HTTP transport, answering
 * each request with plain JSON). Add the address in claude.ai under Settings → Connectors → Add custom connector.
 * Read-only tools for Root and Rune and the weather generator ({@link ConnectorTools}), acting as the key's account.
 */
@RestController
public class McpController {
    /** Protocol versions this server speaks; it answers with the client's if it knows it, else the first. */
    static final List<String> VERSIONS = List.of("2025-06-18", "2025-11-25", "2025-03-26", "2024-11-05");

    private final ConnectorKeys keys;
    private final ConnectorTools tools;
    private final ObjectMapper json;
    private final AppLog applog;
    private final String appVersion;

    public McpController(ConnectorKeys keys, ConnectorTools tools, ObjectMapper json, AppLog applog,
                         @Value("${app.version:dev}") String appVersion) {
        this.keys = keys;
        this.tools = tools;
        this.json = json;
        this.applog = applog;
        this.appVersion = appVersion;
    }

    @RequestMapping(value = "/mcp/{key}", method = RequestMethod.POST)
    public ResponseEntity<?> post(@PathVariable String key, @RequestBody(required = false) JsonNode body) {
        Map<String, Object> who = keys.resolve(key);
        if (who == null) return ResponseEntity.status(HttpStatus.NOT_FOUND).contentType(MediaType.APPLICATION_JSON).body(Map.of("error", "Not found"));
        ConnectorTools.Ctx ctx = new ConnectorTools.Ctx(((Number) who.get("user_id")).longValue(), (String) who.get("username"),
                new ConnectorSession(((Number) who.get("user_id")).longValue()));
        if (body == null) return reply(error(null, -32700, "Parse error"));
        if (body.isArray()) {
            ArrayNode out = json.createArrayNode();
            for (JsonNode msg : body) {
                JsonNode r = handle(msg, ctx);
                if (r != null) out.add(r);
            }
            return out.isEmpty() ? ResponseEntity.accepted().build() : reply(out);
        }
        JsonNode r = handle(body, ctx);
        return r == null ? ResponseEntity.accepted().build() : reply(r);
    }

    /** No server-to-client stream and no sessions to end: only POST. */
    @RequestMapping(value = "/mcp/{key}", method = {RequestMethod.GET, RequestMethod.DELETE})
    public ResponseEntity<?> other() {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).header(HttpHeaders.ALLOW, "POST").build();
    }

    private ResponseEntity<JsonNode> reply(JsonNode body) {
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(body);
    }

    /** One JSON-RPC message: the response, or null for a notification. */
    private JsonNode handle(JsonNode msg, ConnectorTools.Ctx ctx) {
        if (!msg.isObject() || !msg.hasNonNull("method")) return msg.has("id") ? error(msg.get("id"), -32600, "Invalid request") : null;
        String method = msg.get("method").asText();
        JsonNode id = msg.get("id");
        JsonNode params = msg.path("params");
        if (id == null || id.isNull()) return null; // notifications (initialized, cancelled...) need no answer
        try {
            return switch (method) {
                case "initialize" -> result(id, initialize(params, ctx));
                case "ping" -> result(id, Map.of());
                case "tools/list" -> result(id, Map.of("tools", toolList()));
                case "tools/call" -> result(id, call(params, ctx));
                default -> error(id, -32601, "Method not found: " + method);
            };
        } catch (BadParams e) {
            return error(id, -32602, e.getMessage());
        }
    }

    private Map<String, Object> initialize(JsonNode params, ConnectorTools.Ctx ctx) {
        String asked = params.path("protocolVersion").asText("");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("protocolVersion", VERSIONS.contains(asked) ? asked : VERSIONS.get(0));
        out.put("capabilities", Map.of("tools", Map.of("listChanged", false)));
        out.put("serverInfo", Map.of("name", "root-and-rune", "title", "Root and Rune + Weather generator", "version", appVersion));
        out.put("instructions", "Read-only access to the user's Root and Rune (constructed languages: worlds, languages, dictionaries, "
                + "sound changes, word forms, grammar, sentences, missing words) and Eon weather generator (regions, daily weather, "
                + "maps, campaigns, notes), as the account '" + ctx.username() + "'. It sees only what that account may see. "
                + "For languages, start with rune_list_languages to get ids. Nothing can be changed through these tools.");
        return out;
    }

    private List<Map<String, Object>> toolList() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (ConnectorTools.Tool t : tools.all()) {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("name", t.name());
            d.put("title", t.title());
            d.put("description", t.description());
            d.put("inputSchema", t.inputSchema());
            d.put("annotations", Map.of("title", t.title(), "readOnlyHint", true, "destructiveHint", false, "openWorldHint", false));
            out.add(d);
        }
        return out;
    }

    private Map<String, Object> call(JsonNode params, ConnectorTools.Ctx ctx) {
        String name = params.path("name").asText("");
        ConnectorTools.Tool t = tools.get(name);
        if (t == null) throw new BadParams("Unknown tool: " + name);
        JsonNode args = params.path("arguments");
        if (!args.isObject()) args = json.createObjectNode();
        Map<String, Object> out = new LinkedHashMap<>();
        try {
            Object result = t.run().apply(ctx, args);
            out.put("content", List.of(Map.of("type", "text", "text", json.writeValueAsString(result))));
            out.put("isError", false);
            applog.info("connector", ctx.uid(), "Claude connector: " + name + " " + brief(args));
        } catch (ApiException e) {
            out.put("content", List.of(Map.of("type", "text", "text", e.getMessage())));
            out.put("isError", true);
            applog.info("connector", ctx.uid(), "Claude connector: " + name + " " + brief(args) + " → " + e.getMessage());
        } catch (Exception e) {
            out.put("content", List.of(Map.of("type", "text", "text", "Error: " + e)));
            out.put("isError", true);
            applog.warn("connector", ctx.uid(), "MCP tools/call " + name, 500, "Claude connector: " + name + " failed: " + e);
        }
        return out;
    }

    private static String brief(JsonNode args) {
        String s = args.toString();
        return s.length() > 300 ? s.substring(0, 300) + "…" : s;
    }

    private ObjectNode result(JsonNode id, Object result) {
        ObjectNode r = json.createObjectNode();
        r.put("jsonrpc", "2.0");
        r.set("id", id);
        r.set("result", json.valueToTree(result));
        return r;
    }

    private ObjectNode error(JsonNode id, int code, String message) {
        ObjectNode r = json.createObjectNode();
        r.put("jsonrpc", "2.0");
        r.set("id", id == null ? json.nullNode() : id);
        ObjectNode e = r.putObject("error");
        e.put("code", code);
        e.put("message", message);
        return r;
    }

    private static final class BadParams extends RuntimeException {
        BadParams(String m) { super(m); }
    }
}
