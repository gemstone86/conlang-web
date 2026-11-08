package com.hub;

import java.net.CookieManager;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Random;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** Temporary: times the dictionary on a realistic amount of data. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PerfProbeTest {
    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:file:./target/test-db/perf-" + System.nanoTime() + ";MODE=PostgreSQL;NON_KEYWORDS=YEAR;DB_CLOSE_ON_EXIT=FALSE");
    }

    @LocalServerPort int port;
    @Autowired DataSource ds;

    private HttpResponse<String> send(HttpClient c, HttpRequest.Builder b) throws Exception {
        return c.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void probe() throws Exception {
        HttpClient c = HttpClient.newBuilder().cookieHandler(new CookieManager()).build();
        String base = "http://localhost:" + port;
        send(c, HttpRequest.newBuilder(URI.create(base + "/api/auth/register")).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"username\":\"perf\",\"password\":\"secret-pass\"}")));
        JdbcTemplate j = new JdbcTemplate(ds);
        long uid = j.queryForObject("select id from users where username='perf'", Long.class);
        j.update("insert into worlds(id, name, owner_id) values (900, 'Perf', ?)", uid);
        String classes = "V=aeiou\nC=ptkbdgmnslr\nS=ptk";
        long[][] langs = {{901, 0, 0}, {902, 901, 200}, {903, 901, 400}, {904, 902, 600}, {905, 902, 700}, {906, 903, 800}};
        for (long[] l : langs) j.update("insert into languages(id, world_id, owner_id, name, parent_id, split_year, classes) values (?,?,?,?,?,?,?)",
                l[0], 900, uid, "L" + l[0], l[1] == 0 ? null : l[1], l[1] == 0 ? null : (int) l[2], l[1] == 0 ? classes : null);
        String[][] pats = {{"(?<={V})t(?={V})", "d"}, {"(?<={V})k(?={V})", "g"}, {"{V}#", ""}, {"#{C}{C}", "$0"}, {"ai", "e"}, {"au", "o"},
                {"(?<={V})s(?={V})", "z"}, {"p(?={V})", "f"}, {"({C})\\1", "$1"}, {"{V}{V}", "a"}, {"n(?={S})", "m"}, {"i(?={C}#)", "e"}};
        Random rnd = new Random(1);
        long rid = 10000;
        for (long[] l : langs) for (int i = 0; i < 40; i++) {
            String[] p = pats[(int) ((i + l[0]) % pats.length)];
            j.update("insert into rules(id, language_id, year, ord, name, pattern, replacement) values (?,?,?,?,?,?,?)",
                    rid++, l[0], (int) l[2] + 10 + i * 5, i, "r" + i, p[0], p[1]);
        }
        String syl = "pa ta ka ma na sa la ri ku te so mi bo du ge";
        String[] sy = syl.split(" ");
        long wid = 100000, fid = 500000;
        for (int i = 0; i < 2300; i++) {
            long lang = i < 2000 ? 901 : 902;
            StringBuilder f = new StringBuilder();
            for (int k = 0; k < 2 + rnd.nextInt(3); k++) f.append(sy[rnd.nextInt(sy.length)]);
            j.update("insert into words(id, language_id, gloss, pos, form, year) values (?,?,?,?,?,?)", wid, lang, "w" + i, "noun", f.toString(), lang == 901 ? 1 : 250);
            if (i < 2000) {
                j.update("insert into word_forms(id, word_id, label, form) values (?,?,?,?)", fid++, wid, "plural", f + "n");
                j.update("insert into word_forms(id, word_id, label, form) values (?,?,?,?)", fid++, wid, "definite", f + "ta");
            }
            wid++;
        }
        for (String what : new String[]{"/rune/api/languages/901/words", "/rune/api/languages/902/words", "/rune/api/languages/904/words",
                "/rune/api/languages/906/words", "/rune/api/languages/901/tree-check", "/rune/api/languages/901/missing"}) {
            long best = Long.MAX_VALUE; int len = 0;
            for (int k = 0; k < 3; k++) {
                long t0 = System.nanoTime();
                HttpResponse<String> r = send(c, HttpRequest.newBuilder(URI.create(base + what)).GET());
                best = Math.min(best, (System.nanoTime() - t0) / 1_000_000);
                len = r.body().length();
                if (r.statusCode() != 200) System.out.println("PERF " + what + " status " + r.statusCode() + " " + r.body());
            }
            System.out.println("PERF " + what + ": " + best + " ms, " + (len / 1024) + " KB");
        }
    }
}
