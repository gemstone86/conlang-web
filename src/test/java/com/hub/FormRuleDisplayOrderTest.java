package com.hub;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.net.CookieManager;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** The arrows in the Word forms tab only change how a group's rules are shown (show_ord), never which rule is used (ord). */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class FormRuleDisplayOrderTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/showord-" + System.nanoTime()
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

    private long rule(HttpClient c, long lang, String label, String grp) throws Exception {
        HttpResponse<String> r = send(c, "POST", "/rune/api/languages/" + lang + "/edit", "{\"entity\":\"formrule\",\"action\":\"CREATE\",\"payload\":{\"grp\":\"" + grp
                + "\",\"label\":\"" + label + "\",\"pos\":\"noun\",\"placement\":\"suffix\",\"affix\":\"" + label + "\"}}");
        assertEquals(200, r.statusCode(), r.body());
        return om.readTree(r.body()).path("id").asLong();
    }

    /** the labels as the server lists them (by the rules' own order) and the ords */
    private JsonNode list(HttpClient c, long lang) throws Exception {
        return om.readTree(send(c, "GET", "/rune/api/languages/" + lang + "/formrules", null).body());
    }

    @Test
    void movingARuleChangesOnlyTheDisplayOrder() throws Exception {
        HttpClient c = HttpClient.newBuilder().cookieHandler(new CookieManager()).build();
        assertEquals(200, send(c, "POST", "/api/auth/register", "{\"username\":\"boss\",\"password\":\"secret-pass\"}").statusCode());
        long world = om.readTree(send(c, "POST", "/rune/api/worlds", "{\"name\":\"Ygg\"}").body()).path("id").asLong();
        long lang = om.readTree(send(c, "POST", "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Proto\"}").body()).path("id").asLong();
        long a = rule(c, lang, "aa", "Case"), b = rule(c, lang, "bb", "Case"), d = rule(c, lang, "cc", "Case"), other = rule(c, lang, "zz", "Number");

        List<String> ordBefore = new ArrayList<>();
        for (JsonNode r : list(c, lang)) ordBefore.add(r.path("id").asLong() + ":" + r.path("ord").asText());

        // move "cc" up twice, so it is shown first in its group
        for (int i = 0; i < 2; i++)
            assertEquals(200, send(c, "POST", "/rune/api/languages/" + lang + "/formrules/move", "{\"id\":" + d + ",\"dir\":\"up\"}").statusCode());
        // moving the first one further up changes nothing
        assertEquals(200, send(c, "POST", "/rune/api/languages/" + lang + "/formrules/move", "{\"id\":" + d + ",\"dir\":\"up\"}").statusCode());

        List<String> ordAfter = new ArrayList<>();
        long[] shown = new long[3]; int[] showOrd = new int[3];
        for (JsonNode r : list(c, lang)) {
            ordAfter.add(r.path("id").asLong() + ":" + r.path("ord").asText());
            long id = r.path("id").asLong();
            for (int i = 0; i < 3; i++) if (id == new long[] { a, b, d }[i]) showOrd[i] = r.path("show_ord").asInt(-1);
            if (id == other) assertEquals(true, r.path("show_ord").isNull(), "another group is not touched");
        }
        assertEquals(ordBefore, ordAfter, "which rule is used (ord) is not changed by the arrows");
        // shown order is cc, aa, bb
        assertEquals(0, showOrd[2]);
        assertEquals(1, showOrd[0]);
        assertEquals(2, showOrd[1]);

        // a bad direction is refused
        assertEquals(400, send(c, "POST", "/rune/api/languages/" + lang + "/formrules/move", "{\"id\":" + a + ",\"dir\":\"sideways\"}").statusCode());
    }
}
