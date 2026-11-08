package com.hub.connector;

import com.conlangs.web.ApiController;
import com.conlangs.web.ApiException;
import com.conlangs.web.MissingService;
import com.conlangs.web.RuleVersions;
import com.eonweather.core.Api;
import com.eonweather.core.Http;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.BiFunction;
import org.springframework.stereotype.Service;

/**
 * The connector's tools: read-only looks into Root and Rune and the weather generator, as the key's account.
 * Root and Rune's tools call its controller methods (same access checks as the page); the weather tools send
 * GET requests to the weather generator's API in-process.
 */
@Service
public class ConnectorTools {
    /** One tool: its description for Claude and what it does. */
    record Tool(String name, String title, String description, Map<String, Object> inputSchema,
                BiFunction<Ctx, JsonNode, Object> run) {}

    /** Who is calling: the account and a session logged in as it. */
    record Ctx(long uid, String username, ConnectorSession session) {}

    private static final int MAX_WORDS = 500;

    private final ApiController rune;
    private final MissingService missing;
    private final RuleVersions versions;
    private final Api weather;
    private final ObjectMapper json;
    private final Map<String, Tool> tools = new LinkedHashMap<>();

    public ConnectorTools(ApiController rune, MissingService missing, RuleVersions versions, Api weather, ObjectMapper json) {
        this.rune = rune;
        this.missing = missing;
        this.versions = versions;
        this.weather = weather;
        this.json = json;
        define();
    }

    public Collection<Tool> all() {
        return tools.values();
    }

    public Tool get(String name) {
        return tools.get(name);
    }

    // ---------------- definitions ----------------

    private void define() {
        Map<String, Object> lang = prop("integer", "The language's id (from rune_list_languages).");

        add("rune_list_languages", "List worlds and languages",
                "Root and Rune: every world and language this account can see, with ids, parent language, split year and the "
                        + "account's access (1 viewer, 2 editor, 3 owner). Start here to find language ids.",
                schema(Map.of()), (c, a) -> worlds(c));
        add("rune_language", "Language settings",
                "Root and Rune: one language's settings: sound classes (e.g. V=aeiou), erosion steps, IPA map, syllable shape, parent and split year.",
                schema(Map.of("language_id", lang), "language_id"), (c, a) -> rune.language(id(a, "language_id"), c.session()));
        add("rune_words", "Dictionary of a language",
                "Root and Rune: the dictionary of a language as shown on its Dictionary tab, including words inherited from its parent "
                        + "languages (inherited=true). Each word has gloss (meaning), pos (type), form (as coined; for inherited words "
                        + "as it reached this language), latest ({language name: form after all its sound changes} for this "
                        + "language and each branch), year coined, lost_year (if it is no longer used in this language from that year), notes and its forms. Optional query filters by meaning, form, type or note "
                        + "(case-insensitive substring). At most " + MAX_WORDS + " words per call; use offset for more.",
                schema(Map.of("language_id", lang, "query", prop("string", "Text to look for (optional)."),
                        "offset", prop("integer", "Skip this many matches (default 0)."), "limit", prop("integer", "At most this many (default 200, max " + MAX_WORDS + ").")),
                        "language_id"), (c, a) -> words(c, a));
        add("rune_search_words", "Search all languages",
                "Root and Rune: look for a meaning or form in every language this account can see (or in one world). Returns the "
                        + "matching words with their language. Good for 'which languages have a word for X' or 'where does this form occur'.",
                schema(Map.of("query", prop("string", "Meaning or form to look for (case-insensitive substring)."),
                        "world_id", prop("integer", "Only this world (optional).")), "query"), (c, a) -> search(c, a));
        add("rune_word_history", "A word's history",
                "Root and Rune: how one word changed over time in its language and every branch: each sound change that touched "
                        + "it with the year, locked overrides, its forms (plural, definite...) and meaning changes.",
                schema(Map.of("word_id", prop("integer", "The word's id.")), "word_id"), (c, a) -> rune.history(id(a, "word_id"), c.session()));
        add("rune_sound_changes", "Sound changes",
                "Root and Rune: a language's dated sound-change rules (pattern → replacement, year, order, note, tags). Patterns are Java "
                        + "regexes with {V}-style classes from the language settings and # for word edges. off=true means one of the "
                        + "rule's tags is switched off (off_in says where): it is left out when words evolve. scope 'self' (default) "
                        + "is the language's own rules; 'path' adds the rules of its ancestors that apply to it.",
                schema(Map.of("language_id", lang, "scope", Map.of("type", "string", "enum", List.of("self", "path"),
                        "description", "self (default) or path.")), "language_id"),
                (c, a) -> rune.rules(id(a, "language_id"), text(a, "scope", "self"), c.session()));
        add("rune_preview_sound_change", "Preview a sound change",
                "Root and Rune: which words would change, and how, if a sound change were added to a language. Nothing is saved. "
                        + "Needs editor access to the language.",
                schema(Map.of("language_id", lang, "pattern", prop("string", "What to replace (regex, may use {V} classes and #)."),
                        "replacement", prop("string", "What to put instead ($1 for groups; empty to delete)."),
                        "year", prop("integer", "The year the change happens."), "order", prop("integer", "Order among changes in the same year (default 0).")),
                        "language_id", "pattern", "year"), (c, a) -> {
                    Map<String, Object> b = new LinkedHashMap<>();
                    b.put("pattern", text(a, "pattern", ""));
                    b.put("replacement", text(a, "replacement", ""));
                    b.put("year", a.path("year").asLong());
                    b.put("ord", a.path("order").asLong(0));
                    return rune.previewRule(id(a, "language_id"), b, c.session());
                });
        add("rune_sound_change_versions", "Sound-change versions",
                "Root and Rune: the saved versions of a language's sound changes (name, note, when, how many rules), newest first.",
                schema(Map.of("language_id", lang), "language_id"), (c, a) -> versions.list(c.uid(), id(a, "language_id")));
        add("rune_compare_sound_change_version", "Compare with a version",
                "Root and Rune: what changed in a language's sound changes since a saved version: rules added, removed and "
                        + "changed (with the fields that differ, then and now), and the switched-off tags then and now.",
                schema(Map.of("version_id", prop("integer", "The version's id (from rune_sound_change_versions).")), "version_id"),
                (c, a) -> versions.compare(c.uid(), id(a, "version_id")));
        add("rune_word_form_rules", "Word form rules",
                "Root and Rune: a language's word form rules (e.g. nouns get the suffix -n for plural), with conditions and years.",
                schema(Map.of("language_id", lang), "language_id"), (c, a) -> rune.formRules(id(a, "language_id"), c.session()));
        add("rune_grammar", "Grammar tables",
                "Root and Rune: a language's grammar tab: sections with column headings and their rows (word order, tenses, affixes...).",
                schema(Map.of("language_id", lang), "language_id"), (c, a) -> rune.grammar(id(a, "language_id"), c.session()));
        add("rune_sounds", "Sound inventory",
                "Root and Rune: a language's consonants and vowels as entered on its Sounds tab, with the years they are in use.",
                schema(Map.of("language_id", lang), "language_id"), (c, a) -> rune.phonemes(id(a, "language_id"), c.session()));
        add("rune_sentences", "Saved sentences",
                "Root and Rune: a language's saved example sentences, each built into the language for its year (surface form, "
                        + "gloss, and any gaps where a word is missing).",
                schema(Map.of("language_id", lang), "language_id"), (c, a) -> rune.sentenceList(id(a, "language_id"), c.session()));
        add("rune_build_sentence", "Build a sentence",
                "Root and Rune: build a sentence in a language without saving it. Write each word as parts in parentheses, e.g. "
                        + "'(to see)(you-obj) (water)'; a part is a dictionary meaning, 'meaning-label' picks a word form, '(=text)' stays as written. "
                        + "Built as spoken in the given year: each word's form and meaning then; words coined later or lost by then are gaps, with the reason.",
                schema(Map.of("language_id", lang, "source", prop("string", "The sentence in the builder's notation."),
                        "year", prop("integer", "The year to build it for (default 0).")), "language_id", "source"), (c, a) -> {
                    Map<String, Object> b = new LinkedHashMap<>();
                    b.put("source", text(a, "source", ""));
                    b.put("year", a.path("year").asLong(0));
                    return rune.sentenceBuild(id(a, "language_id"), b, c.session());
                });
        add("rune_missing_words", "Missing words",
                "Root and Rune: a language's Missing words tab: meanings marked as needing a word (with whether a word has been "
                        + "coined since) and the meanings its saved sentences use but can't find.",
                schema(Map.of("language_id", lang), "language_id"), (c, a) -> missing.list(c.uid(), id(a, "language_id")));
        add("rune_pending_changes", "Pending changes",
                "Root and Rune: changes waiting for the owner's approval in a language (owners see all, others their own).",
                schema(Map.of("language_id", lang), "language_id"), (c, a) -> rune.changes(id(a, "language_id"), c.session()));
        add("rune_edit_log", "Edit log",
                "Root and Rune: the latest edits in a language (who changed what, before and after).",
                schema(Map.of("language_id", lang), "language_id"), (c, a) -> rune.log(id(a, "language_id"), c.session()));
        add("rune_suggest_roots", "Suggest new roots",
                "Root and Rune: new root words that sound like the language (built from its syllable shape and existing words), "
                        + "for coining words.",
                schema(Map.of("language_id", lang, "count", prop("integer", "How many (default 10).")), "language_id"),
                (c, a) -> rune.suggestRoots(id(a, "language_id"), (int) a.path("count").asLong(10), 2, 3, null, c.session()));

        add("weather_world", "Weather: regions and calendars",
                "Weather generator (Eon): every region with its base climate (temperature, rain, wind), the calendars, religions, "
                        + "the forces and aspects, and the travel and event rules. Use the region names in the other weather tools.",
                schema(Map.of()), (c, a) -> weatherGet(c, "/world", Map.of()));
        add("weather_day", "Weather: one day",
                "Weather generator (Eon): the weather for one day in a region: temperature, wind, precipitation, hourly values, "
                        + "events, holy days and influx. Months are 1-12, days 1-28.",
                schema(Map.of("region", prop("string", "Region name (from weather_world)."), "year", prop("integer", "Year."),
                        "month", prop("integer", "Month, 1-12."), "day", prop("integer", "Day, 1-28."),
                        "english", prop("boolean", "Names in English instead of Swedish (default false).")),
                        "region", "year", "month", "day"),
                (c, a) -> weatherGet(c, "/day", q("region", text(a, "region", ""), "year", a.path("year").asText(), "month",
                        a.path("month").asText(), "day", a.path("day").asText(), "lang", a.path("english").asBoolean() ? "EN" : "SV")));
        add("weather_month", "Weather: one month",
                "Weather generator (Eon): the 28 days of a month in a region, in short: temperature, wind, precipitation and events per day.",
                schema(Map.of("region", prop("string", "Region name."), "year", prop("integer", "Year."), "month", prop("integer", "Month, 1-12."),
                        "english", prop("boolean", "Names in English (default false).")), "region", "year", "month"),
                (c, a) -> weatherGet(c, "/month", q("region", text(a, "region", ""), "year", a.path("year").asText(), "month",
                        a.path("month").asText(), "lang", a.path("english").asBoolean() ? "EN" : "SV")));
        add("weather_maps", "Weather: maps",
                "Weather generator (Eon): the maps this account can see (the standard map, public maps and its own), with ids and "
                        + "which layers they have.",
                schema(Map.of()), (c, a) -> weatherMaps(c));
        add("weather_campaigns", "Weather: campaigns",
                "Weather generator (Eon): the account's campaigns, each with its region and current date.",
                schema(Map.of()), (c, a) -> weatherGet(c, "/campaigns", Map.of()));
        add("weather_notes", "Weather: notes",
                "Weather generator (Eon): the account's notes per date; campaign_id 0 (default) is the general comments.",
                schema(Map.of("campaign_id", prop("integer", "Campaign id (default 0)."))),
                (c, a) -> weatherGet(c, "/notes", q("campaign", a.path("campaign_id").asText("0"))));
        add("weather_get", "Weather: other data",
                "Weather generator (Eon): any other read-only data from its API, by path, e.g. '/maps/3/rivers', '/maps/3/nations', "
                        + "'/maps/3/ranges', '/maps/3/roads', '/maps/3/trips', '/maps/3/anchors', '/travel', '/events', '/regions/source?name=X'. "
                        + "Only JSON answers (no images).",
                schema(Map.of("path", prop("string", "Path under the weather API, starting with '/', optionally with ?query.")), "path"),
                (c, a) -> weatherPath(c, text(a, "path", "")));
    }

    private void add(String name, String title, String description, Map<String, Object> schema, BiFunction<Ctx, JsonNode, Object> run) {
        tools.put(name, new Tool(name, title, description, schema, run));
    }

    private static Map<String, Object> prop(String type, String description) {
        return Map.of("type", type, "description", description);
    }

    private static Map<String, Object> schema(Map<String, Object> props, String... required) {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "object");
        s.put("properties", props);
        if (required.length > 0) s.put("required", List.of(required));
        return s;
    }

    private static Map<String, String> q(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return m;
    }

    private static long id(JsonNode a, String k) {
        JsonNode n = a.get(k);
        if (n == null || !(n.isNumber() || n.isTextual()) || n.asText().isBlank()) throw new ApiException(400, k + " is required.");
        try {
            return Long.parseLong(n.asText().trim());
        } catch (NumberFormatException e) {
            throw new ApiException(400, k + " must be a number.");
        }
    }

    private static String text(JsonNode a, String k, String dflt) {
        JsonNode n = a.get(k);
        return n == null || n.isNull() ? dflt : n.asText();
    }

    // ---------------- Root and Rune ----------------

    @SuppressWarnings("unchecked")
    private Object worlds(Ctx c) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> w : rune.worlds(c.session())) {
            Map<String, Object> ow = new LinkedHashMap<>();
            ow.put("id", w.get("id"));
            ow.put("name", w.get("name"));
            ow.put("mine", w.get("mine"));
            List<Map<String, Object>> langs = new ArrayList<>();
            for (Map<String, Object> l : (List<Map<String, Object>>) w.getOrDefault("languages", List.of())) {
                Map<String, Object> ol = new LinkedHashMap<>();
                for (String k : List.of("id", "name", "parent_id", "split_year", "level")) if (l.get(k) != null) ol.put(k, l.get(k));
                langs.add(ol);
            }
            ow.put("languages", langs);
            out.add(ow);
        }
        return out;
    }

    private static boolean matches(Map<String, Object> w, String q) {
        if (q == null || q.isBlank()) return true;
        String needle = q.trim().toLowerCase(Locale.ROOT);
        for (String k : List.of("gloss", "form", "latest", "pos", "notes", "build")) {
            Object v = w.get(k);
            if (v != null && v.toString().toLowerCase(Locale.ROOT).contains(needle)) return true;
        }
        return false;
    }

    /** A word without empty fields, so long lists stay readable. */
    private static Map<String, Object> compact(Map<String, Object> w) {
        Map<String, Object> o = new LinkedHashMap<>();
        w.forEach((k, v) -> {
            if (v == null || (v instanceof String s && s.isEmpty()) || (v instanceof Collection<?> col && col.isEmpty())
                    || (v instanceof Map<?, ?> m && m.isEmpty()) || Boolean.FALSE.equals(v)) return;
            o.put(k, v);
        });
        return o;
    }

    private Object words(Ctx c, JsonNode a) {
        long langId = id(a, "language_id");
        String query = text(a, "query", null);
        int offset = (int) Math.max(0, a.path("offset").asLong(0));
        int limit = (int) Math.max(1, Math.min(MAX_WORDS, a.path("limit").asLong(200)));
        List<Map<String, Object>> hits = new ArrayList<>();
        for (Map<String, Object> w : rune.words(langId, c.session())) if (matches(w, query)) hits.add(w);
        List<Map<String, Object>> page = new ArrayList<>();
        for (int i = offset; i < hits.size() && page.size() < limit; i++) page.add(compact(hits.get(i)));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("total", hits.size());
        out.put("offset", offset);
        out.put("words", page);
        if (offset + page.size() < hits.size()) out.put("more", "Call again with offset " + (offset + page.size()) + " for the rest.");
        return out;
    }

    @SuppressWarnings("unchecked")
    private Object search(Ctx c, JsonNode a) {
        String query = text(a, "query", "");
        if (query.isBlank()) throw new ApiException(400, "query is required.");
        Long world = a.hasNonNull("world_id") ? id(a, "world_id") : null;
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> w : rune.worlds(c.session())) {
            if (world != null && ((Number) w.get("id")).longValue() != world) continue;
            for (Map<String, Object> l : (List<Map<String, Object>>) w.getOrDefault("languages", List.of())) {
                long langId = ((Number) l.get("id")).longValue();
                for (Map<String, Object> word : rune.words(langId, c.session())) {
                    if (Boolean.TRUE.equals(word.get("inherited")) || !matches(word, query)) continue;
                    Map<String, Object> o = compact(word);
                    o.remove("forms");
                    o.put("language", l.get("name"));
                    o.put("language_id", langId);
                    o.put("world", w.get("name"));
                    out.add(o);
                    if (out.size() >= MAX_WORDS) return Map.of("words", out, "note", "Stopped at " + MAX_WORDS + " matches; search for something narrower.");
                }
            }
        }
        return Map.of("total", out.size(), "words", out);
    }

    // ---------------- weather generator ----------------

    private Object weatherGet(Ctx c, String path, Map<String, String> query) {
        Http.Session session = new Http.Session() {
            @Override public Long userId() { return c.uid(); }
            @Override public void login(long userId) { }
            @Override public void logout() { }
        };
        Http.Request req = new Http.Request() {
            @Override public String method() { return "GET"; }
            @Override public String path() { return path; }
            @Override public String query(String name) { return query.get(name); }
            @Override public String header(String name) { return null; }
            @Override public byte[] body() { return new byte[0]; }
            @Override public Http.Session session() { return session; }
            @Override public String remoteAddress() { return "connector"; }
        };
        Http.Response res = weather.handle(req);
        if (res.contentType == null || !res.contentType.contains("json"))
            throw new ApiException(400, "That path answers with " + (res.contentType == null ? "nothing" : res.contentType) + ", not data.");
        JsonNode body;
        try {
            body = json.readTree(res.body);
        } catch (Exception e) {
            throw new ApiException(500, "The weather generator gave an unreadable answer.");
        }
        if (res.status >= 400) throw new ApiException(res.status, body.path("error").asText("Error " + res.status));
        return body;
    }

    private Object weatherPath(Ctx c, String pathAndQuery) {
        if (!pathAndQuery.startsWith("/")) pathAndQuery = "/" + pathAndQuery;
        String path = pathAndQuery, qs = "";
        int i = pathAndQuery.indexOf('?');
        if (i >= 0) { path = pathAndQuery.substring(0, i); qs = pathAndQuery.substring(i + 1); }
        if (path.contains("..")) throw new ApiException(400, "Bad path.");
        Map<String, String> query = new LinkedHashMap<>();
        for (String part : qs.split("&")) {
            if (part.isEmpty()) continue;
            int eq = part.indexOf('=');
            String k = URLDecoder.decode(eq < 0 ? part : part.substring(0, eq), StandardCharsets.UTF_8);
            String v = eq < 0 ? "" : URLDecoder.decode(part.substring(eq + 1), StandardCharsets.UTF_8);
            query.put(k, v);
        }
        return weatherGet(c, path, query);
    }

    private Object weatherMaps(Ctx c) {
        JsonNode maps = (JsonNode) weatherGet(c, "/maps", Map.of());
        // the settings hold the map's drawing setup (zoom tiles, scales); not useful here and long
        for (JsonNode m : maps) if (m.isObject()) ((com.fasterxml.jackson.databind.node.ObjectNode) m).remove("settings");
        return maps;
    }
}
