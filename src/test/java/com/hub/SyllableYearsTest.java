package com.hub;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.conlangs.web.SyllableShapes;
import java.net.CookieManager;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Syllable shapes by year: which shape is in force, words that do not fit it, roots for a year, and the JSON wordlist. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SyllableYearsTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/sylyears-" + System.nanoTime()
                + ";MODE=PostgreSQL;NON_KEYWORDS=YEAR;DB_CLOSE_ON_EXIT=FALSE");
    }

    @LocalServerPort
    int port;

    private final ObjectMapper om = new ObjectMapper();

    private HttpResponse<String> send(HttpClient c, String method, String path, String json) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).header("Content-Type", "application/json");
        return c.send((json == null ? b.method(method, HttpRequest.BodyPublishers.noBody()) : b.method(method, HttpRequest.BodyPublishers.ofString(json))).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void theShapeInForceInAYear() {
        var dated = SyllableShapes.parse("500: CV(C)\n1200: (C)V(C)(C)");
        assertEquals("C(C)V(C)", SyllableShapes.at("C(C)V(C)", dated, 100).shape(), "before the first: the plain shape");
        assertEquals("CV(C)", SyllableShapes.at("C(C)V(C)", dated, 500).shape());
        assertEquals(500, SyllableShapes.at("C(C)V(C)", dated, 900).fromYear());
        assertEquals("(C)V(C)(C)", SyllableShapes.at(null, dated, 2000).shape());
        assertEquals("CV(C)", SyllableShapes.at(null, dated, 10).shape(), "no plain shape: the nearest, the earliest");
        assertEquals(null, SyllableShapes.at(null, java.util.List.of(), 10));
        assertEquals("500: CV(C)\n1200: (C)V(C)(C)", SyllableShapes.normalize("1200 = (C)V(C)(C)\n\n 500 : cv(c)"));
        for (String bad : new String[] { "abc", "x: CV", "100: CC", "100: CV\n100: CVC" })
            assertThrowsParse(bad);
    }

    private static void assertThrowsParse(String text) {
        try { SyllableShapes.parse(text); } catch (IllegalArgumentException e) { return; }
        throw new AssertionError("should be refused: " + text);
    }

    @Test
    void wordsMustFitTheShapeOfTheirYear() throws Exception {
        HttpClient c = HttpClient.newBuilder().cookieHandler(new CookieManager()).build();
        assertEquals(200, send(c, "POST", "/api/auth/register", "{\"username\":\"boss\",\"password\":\"secret-pass\"}").statusCode());
        long world = om.readTree(send(c, "POST", "/rune/api/worlds", "{\"name\":\"Ygg\"}").body()).path("id").asLong();
        long lang = om.readTree(send(c, "POST", "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Elven\"}").body()).path("id").asLong();
        String base = "/rune/api/languages/" + lang;
        assertEquals(400, send(c, "PUT", base, "{\"syllableYears\":\"500 CV\"}").statusCode(), "a bad line is refused");
        assertEquals(200, send(c, "PUT", base, "{\"syllableShape\":\"CV(C)\",\"syllableYears\":\"500: CV(C)(C)\\n1200: CVV\"}").statusCode());

        String edit = base + "/edit";
        String[][] words = { { "ban", "100", "pa" }, { "ban2", "100", "pant" }, { "late", "600", "pant" }, { "later", "600", "pantas" }, { "latest", "1300", "pant" } };
        for (String[] w : words)
            assertEquals(200, send(c, "POST", edit, "{\"entity\":\"word\",\"action\":\"CREATE\",\"payload\":{\"gloss\":\"" + w[0] + "\",\"pos\":\"noun\",\"form\":\"" + w[2] + "\",\"year\":" + w[1] + "}}").statusCode());
        java.util.Map<String, String> problem = new java.util.HashMap<>();
        for (JsonNode w : om.readTree(send(c, "GET", base + "/words", null).body())) {
            String shapeProblem = "";
            for (JsonNode p : w.path("problems")) if (p.asText().contains("syllable shape")) shapeProblem = p.asText();
            problem.put(w.path("gloss").asText(), shapeProblem);
        }
        assertEquals("", problem.get("ban"), "pa fits CV(C)");
        assertFalse(problem.get("ban2").isEmpty(), "pant has two final consonants: not in year 100's CV(C)");
        assertTrue(problem.get("ban2").contains("CV(C)") && problem.get("ban2").contains("from the start"), problem.get("ban2"));
        assertEquals("", problem.get("late"), "pant fits CV(C)(C) from year 500");
        assertEquals("", problem.get("later"), "pan-tas: two syllables of CV(C)(C)");
        assertFalse(problem.get("latest").isEmpty(), "year 1300: the shape is now CVV, pant does not fit");
        assertTrue(problem.get("latest").contains("from year 1200"), problem.get("latest"));

        // the shape in force in a year, for the suggest-roots form
        assertEquals("CV(C)", om.readTree(send(c, "GET", base + "/syllable-shape?year=100", null).body()).path("shape").asText());
        JsonNode at900 = om.readTree(send(c, "GET", base + "/syllable-shape?year=900", null).body());
        assertEquals("CV(C)(C)", at900.path("shape").asText());
        assertEquals(500, at900.path("from").asInt());
        assertEquals("CVV", om.readTree(send(c, "GET", base + "/syllable-shape", null).body()).path("shape").asText(), "no year: the latest");

        // roots for a year have that year's shape
        JsonNode roots = om.readTree(send(c, "GET", base + "/suggest-roots?year=1250&count=5&min=1&max=1&seed=7", null).body());
        assertEquals("CVV", roots.path("shape").asText());
        assertEquals(1250, roots.path("year").asInt());
        com.conlangs.web.SyllableShape shape = com.conlangs.web.SyllableShape.parse("CVV");
        for (JsonNode r : roots.path("roots")) assertTrue(shape.fits(r.asText()), r.asText());

        // the whole wordlist as JSON
        HttpResponse<String> j = send(c, "GET", base + "/export.json", null);
        assertEquals(200, j.statusCode());
        JsonNode all = om.readTree(j.body());
        assertEquals("Elven", all.path("language").asText());
        assertEquals(5, all.path("count").asInt());
        assertEquals("ban", all.path("words").get(0).path("gloss").asText());
        assertEquals("pa", all.path("words").get(0).path("form").asText());
        assertTrue(all.path("words").get(0).has("gloss") && all.path("words").get(0).has("forms"));
    }
}
