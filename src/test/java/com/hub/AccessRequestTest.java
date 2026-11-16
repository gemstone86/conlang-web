package com.hub;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Someone with a link to a language they cannot see asks its owner for access; the owner lets them in or says no. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AccessRequestTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/access-" + System.nanoTime()
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

    private HttpClient user(String name) throws Exception {
        HttpClient c = HttpClient.newBuilder().cookieHandler(new CookieManager()).build();
        assertEquals(200, send(c, "POST", "/api/auth/register", "{\"username\":\"" + name + "\",\"password\":\"secret-pass\"}").statusCode());
        return c;
    }

    /** no access: refused, or "not found" so that a private language does not show it exists */
    private static void assertNo(int status) {
        assertTrue(status == 403 || status == 404, "status " + status);
    }

    @Test
    void askingForAccessWithALink() throws Exception {
        HttpClient owner = user("boss"), guest = user("guest"), other = user("other");
        long world = om.readTree(send(owner, "POST", "/rune/api/worlds", "{\"name\":\"Ygg\"}").body()).path("id").asLong();
        long lang = om.readTree(send(owner, "POST", "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Proto\"}").body()).path("id").asLong();
        String req = "/rune/api/languages/" + lang + "/access-request", list = "/rune/api/languages/" + lang + "/access-requests";

        assertNo(send(guest, "GET", "/rune/api/languages/" + lang + "/words", null).statusCode());
        // not logged in at all: they must log in (or make an account) first
        HttpClient anon = HttpClient.newBuilder().cookieHandler(new CookieManager()).build();
        assertEquals(401, send(anon, "POST", req, null).statusCode());
        assertEquals(404, send(guest, "POST", "/rune/api/languages/999999/access-request", null).statusCode());

        assertEquals("requested", om.readTree(send(guest, "POST", req, null).body()).path("status").asText());
        assertEquals("already", om.readTree(send(guest, "POST", req, null).body()).path("status").asText(), "one open request each");
        assertEquals("has", om.readTree(send(owner, "POST", req, null).body()).path("status").asText(), "the owner has it already");

        // only the owner sees and answers requests
        assertNo(send(other, "GET", list, null).statusCode());
        JsonNode asking = om.readTree(send(owner, "GET", list, null).body());
        assertEquals(1, asking.size());
        assertEquals("guest", asking.get(0).path("username").asText());
        long rid = asking.get(0).path("id").asLong();
        assertNo(send(guest, "POST", list + "/" + rid, "{\"answer\":\"editor\"}").statusCode());

        // the owner heard about it (the bell), and lets the guest in as a viewer
        JsonNode bell = om.readTree(send(owner, "GET", "/api/notifications", null).body());
        assertTrue(bell.toString().contains("asks for access"), bell.toString());
        assertEquals(200, send(owner, "POST", list + "/" + rid, "{\"answer\":\"viewer\"}").statusCode());
        assertEquals(200, send(guest, "GET", "/rune/api/languages/" + lang + "/words", null).statusCode(), "now they can read it");
        assertEquals(0, om.readTree(send(owner, "GET", list, null).body()).size());
        assertEquals(404, send(owner, "POST", list + "/" + rid, "{\"answer\":\"viewer\"}").statusCode(), "answered once");

        // a turned-down request gives no access
        assertEquals("requested", om.readTree(send(other, "POST", req, null).body()).path("status").asText());
        long rid2 = om.readTree(send(owner, "GET", list, null).body()).get(0).path("id").asLong();
        assertEquals(200, send(owner, "POST", list + "/" + rid2, "{\"answer\":\"deny\"}").statusCode());
        assertNo(send(other, "GET", "/rune/api/languages/" + lang + "/words", null).statusCode());
        assertEquals(404, send(owner, "POST", list + "/" + rid2, "{\"answer\":\"viewer\"}").statusCode(), "the request is gone");
    }
}
