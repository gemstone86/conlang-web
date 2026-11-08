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

/** Import from Excel: a dictionary sheet and a grammar sheet in one workbook, on a fresh database of its own. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ExcelImportTest {

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/excel-" + System.nanoTime()
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

    private static void row(org.apache.poi.ss.usermodel.Sheet sh, int i, String... cells) {
        org.apache.poi.ss.usermodel.Row r = sh.createRow(i);
        for (int j = 0; j < cells.length; j++) if (cells[j] != null) r.createCell(j).setCellValue(cells[j]);
    }

    private static byte[] workbook() throws Exception {
        try (org.apache.poi.xssf.usermodel.XSSFWorkbook wb = new org.apache.poi.xssf.usermodel.XSSFWorkbook()) {
            org.apache.poi.ss.usermodel.Sheet d = wb.createSheet("Ygg Elven dict");
            row(d, 0, "dictionary", "elven", "build", "year", "type", "notes", "group");
            row(d, 1, "water", "ata", "root", "0", "noun", "the first word", null);
            row(d, 2, "fire", "pira", "root", "0", "noun", null, null);
            row(d, 3, "to see", "kena", "root", "0", "verb", null, "Branch");
            row(d, 4, "water (shifted)", "ada", "shifted", "300", null, null, null);
            row(d, 5, "", "oops", "root", "0", null, null, null);
            org.apache.poi.ss.usermodel.Sheet g = wb.createSheet("Ygg Elven");
            row(g, 0, "Name", "Alviska");
            row(g, 8, "Grammar", "order", "example");
            row(g, 9, "Basic order", "SOV", "I water see");
            row(g, 10, "Questions", "particle at the end", "...ka");
            row(g, 12, "Tenses", "suffix", "use");
            row(g, 13, "Past", "-ta", "finished");
            row(g, 14, "Future", "-sa", "to come");
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            wb.write(out);
            return out.toByteArray();
        }
    }

    private HttpResponse<String> upload(HttpClient c, String path, byte[] file, long lang, String replace) throws Exception {
        String b = "----x" + System.nanoTime();
        java.io.ByteArrayOutputStream body = new java.io.ByteArrayOutputStream();
        body.write(("--" + b + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"lang.xlsx\"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n").getBytes());
        body.write(file);
        body.write(("\r\n--" + b + "\r\nContent-Disposition: form-data; name=\"languageId\"\r\n\r\n" + lang).getBytes());
        if (replace != null) body.write(("\r\n--" + b + "\r\nContent-Disposition: form-data; name=\"replace\"\r\n\r\n" + replace).getBytes());
        body.write(("\r\n--" + b + "--\r\n").getBytes());
        return c.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "multipart/form-data; boundary=" + b).POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())).build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void importLanguageFromExcel() throws Exception {
        HttpClient admin = client();
        post(admin, "/api/auth/register", "{\"username\":\"admin1\",\"password\":\"secret-pass\"}", false);
        HttpClient other = client();
        post(other, "/api/auth/register", "{\"username\":\"other1\",\"password\":\"secret-pass\"}", false);
        long world = om.readTree(post(admin, "/rune/api/worlds", "{\"name\":\"W\"}", false).body()).path("id").asLong();
        long lang = om.readTree(post(admin, "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Alviska\"}", false).body()).path("id").asLong();
        long branch = om.readTree(post(admin, "/rune/api/languages", "{\"worldId\":" + world + ",\"name\":\"Branch\",\"parentId\":" + lang + ",\"splitYear\":500}", false).body()).path("id").asLong();
        byte[] xlsx = workbook();

        // only admins who own the language
        assertEquals(403, upload(other, "/rune/api/admin/import-elven", xlsx, lang, null).statusCode());

        // the dictionary
        HttpResponse<String> d = upload(admin, "/rune/api/admin/import-elven", xlsx, lang, null);
        assertEquals(200, d.statusCode(), d.body());
        JsonNode dr = om.readTree(d.body());
        assertEquals(3, dr.path("imported").asInt(), d.body());
        assertEquals(1, dr.path("skippedCount").asInt(), "the row without a meaning");
        assertEquals(1, dr.path("perGroup").path("Branch").asInt(), "routed to the language named in its group");
        JsonNode words = om.readTree(get(admin, "/rune/api/languages/" + lang + "/words").body());
        assertEquals(2, words.size(), words.toString());
        assertTrue(words.toString().contains("the first word"));
        assertTrue(get(admin, "/rune/api/languages/" + branch + "/words").body().contains("kena"));
        // the same file again adds nothing
        JsonNode again = om.readTree(upload(admin, "/rune/api/admin/import-elven", xlsx, lang, null).body());
        assertEquals(0, again.path("imported").asInt(), again.toString());
        assertEquals(3, again.path("alreadyThere").asInt());

        // grammar and sounds
        HttpResponse<String> g = upload(admin, "/rune/api/admin/import-grammar", xlsx, lang, "false");
        assertEquals(200, g.statusCode(), g.body());
        JsonNode gr = om.readTree(g.body());
        assertTrue(gr.path("sections").asInt() >= 3, g.body());
        assertTrue(gr.path("rows").asInt() >= 4, g.body());
        assertEquals(0, gr.path("sounds").asInt());
        String grammar = get(admin, "/rune/api/languages/" + lang + "/grammar").body();
        assertTrue(grammar.contains("Basic order") && grammar.contains("SOV") && grammar.contains("Future"), grammar);
        // a second time needs replace
        assertEquals(409, upload(admin, "/rune/api/admin/import-grammar", xlsx, lang, "false").statusCode());
        assertEquals(200, upload(admin, "/rune/api/admin/import-grammar", xlsx, lang, "true").statusCode());
        assertEquals(gr.path("rows").asInt(), om.readTree(get(admin, "/rune/api/languages/" + lang + "/grammar").body()).path("entries").size(), "replaced, not doubled");
    }
}
