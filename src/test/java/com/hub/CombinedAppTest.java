package com.hub;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

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

/**
 * Starts the whole combined app (on a fresh H2 file, so the database guard and schema.sql run as in
 * production) and checks that the start page, both apps and the shared login fit together.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CombinedAppTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/hub-" + System.nanoTime()
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

    @Test
    void pagesAreServed() throws Exception {
        HttpClient c = client();
        HttpResponse<String> start = get(c, "/");
        assertEquals(200, start.statusCode());
        assertTrue(start.body().contains("Root and Rune") && start.body().contains("Weather generator"), "start page links both apps");

        HttpResponse<String> rune = get(c, "/rune/");
        assertEquals(200, rune.statusCode());
        assertTrue(rune.body().contains("<title>Root and Rune</title>"));

        HttpResponse<String> weather = get(c, "/weather/");
        assertEquals(200, weather.statusCode());
        assertTrue(weather.body().contains("app-core.js"));

        assertEquals(302, get(c, "/rune").statusCode(), "/rune redirects to /rune/");
        // every script the Root and Rune page asks for is there
        java.util.regex.Matcher scripts = java.util.regex.Pattern.compile("<script src=\"([^\"]+)\"").matcher(get(c, "/rune/").body());
        int found = 0;
        while (scripts.find()) {
            String src = scripts.group(1);
            assertEquals(200, get(c, src.startsWith("/") ? src : "/rune/" + src).statusCode(), src);
            found++;
        }
        assertTrue(found >= 9, "the page lists its scripts");
        assertEquals(200, get(c, "/weather/app-start.js").statusCode());
        assertEquals(200, get(c, "/weather/tiles/mundana-1/manifest.json").statusCode());
    }

    @Test
    void oneLoginWorksInBothApps() throws Exception {
        HttpClient c = client();

        // logged out: Root and Rune refuses, the weather generator works (read-only) and has its standard map
        assertEquals("[]", get(c, "/rune/api/worlds").body(), "logged out: only public languages, and there are none");
        assertEquals(401, post(c, "/rune/api/worlds", "{\"name\":\"X\"}", false).statusCode(), "making things needs a login");
        HttpResponse<String> world = get(c, "/weather/api/world");
        assertEquals(200, world.statusCode());
        assertTrue(world.body().contains("regions"));
        HttpResponse<String> maps = get(c, "/weather/api/maps");
        assertEquals(200, maps.statusCode());
        assertTrue(maps.body().contains("@eon"), "standard map owned by the built-in account: " + maps.body());
        assertTrue(get(c, "/weather/api/me").body().contains("\"user\":null"));

        // the built-in '@eon' account doesn't count as the first user and can't be logged in as
        assertEquals(401, post(c, "/api/auth/login", "{\"username\":\"@eon\",\"password\":\"!\"}", false).statusCode());

        // register on the start page: the first real account becomes admin
        String user = "tester" + (System.nanoTime() % 100000);
        HttpResponse<String> reg = post(c, "/api/auth/register", "{\"username\":\"" + user + "\",\"password\":\"secret-pass\"}", false);
        assertEquals(200, reg.statusCode(), reg.body());
        assertTrue(reg.body().contains("\"is_admin\":true"), reg.body());

        // ...and is logged in to both apps
        HttpResponse<String> mkWorld = post(c, "/rune/api/worlds", "{\"name\":\"Mundana\"}", false);
        assertEquals(200, mkWorld.statusCode(), mkWorld.body());
        HttpResponse<String> worlds = get(c, "/rune/api/worlds");
        assertEquals(200, worlds.statusCode());
        assertTrue(worlds.body().contains("Mundana"));
        HttpResponse<String> me = get(c, "/weather/api/me");
        assertTrue(me.body().contains("\"username\":\"" + user + "\""), me.body());
        assertTrue(me.body().contains("\"admin\":true"), me.body());
        HttpResponse<String> camp = post(c, "/weather/api/campaigns", "{\"name\":\"Test campaign\"}", true);
        assertEquals(200, camp.statusCode(), camp.body());

        // the weather generator's own account endpoints are gone
        assertEquals(410, post(c, "/weather/api/login", "{}", true).statusCode());

        // change password on the start page, log out, log in again with the new one
        assertEquals(403, post(c, "/api/auth/password", "{\"current\":\"wrong-pass\",\"password\":\"another-pass\"}", false).statusCode());
        assertEquals(200, post(c, "/api/auth/password", "{\"current\":\"secret-pass\",\"password\":\"another-pass\"}", false).statusCode());
        assertEquals(200, post(c, "/api/auth/logout", "", false).statusCode());
        assertEquals("[]", get(c, "/rune/api/worlds").body(), "logged out again: the private world isn't listed");
        assertTrue(get(c, "/weather/api/me").body().contains("\"user\":null"));
        assertEquals(401, post(c, "/api/auth/login", "{\"username\":\"" + user + "\",\"password\":\"secret-pass\"}", false).statusCode());
        assertEquals(200, post(c, "/api/auth/login", "{\"username\":\"" + user + "\",\"password\":\"another-pass\"}", false).statusCode());
        assertTrue(get(c, "/weather/api/campaigns").body().contains("Test campaign"));

        // a second account is not an admin
        HttpClient c2 = client();
        HttpResponse<String> reg2 = post(c2, "/api/auth/register", "{\"username\":\"" + user + "b\",\"password\":\"secret-pass\"}", false);
        assertEquals(200, reg2.statusCode(), reg2.body());
        assertTrue(reg2.body().contains("\"is_admin\":false"), reg2.body());
        assertFalse(get(c2, "/weather/api/me").body().contains("\"admin\":true"));
    }
}
