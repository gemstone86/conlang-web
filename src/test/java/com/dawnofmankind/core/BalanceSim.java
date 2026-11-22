package com.dawnofmankind.core;

import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.PrintWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/**
 * Balance simulation: bots play many whole games and we see which cards go with winning. Not part of the normal test
 * run; start it with {@code mvn -q test -Dtest=BalanceSim -Dbalance=1 [-Dbalance.players=1,2] [-Dbalance.minutes=10]}.
 * Writes /tmp/balance-Np.csv and prints ranked tables. Bots are simple, so read the numbers as hints, not proof.
 */
class BalanceSim {
    static final Content C = Content.loadDefault();

    record Result(boolean win, int score, int rounds, int era, Set<String> used, String defeat) {}

    @Test
    void run() throws Exception {
        assumeTrue(System.getProperty("balance") != null, "start with -Dbalance=1");
        long deadline = System.currentTimeMillis() + Long.parseLong(System.getProperty("balance.minutes", "10")) * 60_000L;
        Map<String, String> kindOf = new HashMap<>();       // card or wonder name -> kind
        for (Content.CardDef d : C.cards.values()) kindOf.put(d.name, d.type.name().toLowerCase());
        for (String ps : System.getProperty("balance.players", "1,2").split(",")) {
            int players = Integer.parseInt(ps.trim());
            long budget = (deadline - System.currentTimeMillis()) / (1 + System.getProperty("balance.players", "1,2").split(",").length - indexOf(ps));
            List<Result> results = simulate(players, System.currentTimeMillis() + budget, kindOf);
            report(players, results, kindOf);
        }
    }

    static int indexOf(String ps) {
        String[] all = System.getProperty("balance.players", "1,2").split(",");
        for (int i = 0; i < all.length; i++) if (all[i].trim().equals(ps.trim())) return i;
        return 0;
    }

    static List<Result> simulate(int players, long until, Map<String, String> kindOf) throws Exception {
        List<Result> out = java.util.Collections.synchronizedList(new ArrayList<>());
        ExecutorService pool = Executors.newFixedThreadPool(Math.max(1, Runtime.getRuntime().availableProcessors()));
        AtomicInteger next = new AtomicInteger();
        for (int t = 0; t < Math.max(1, Runtime.getRuntime().availableProcessors()); t++) {
            pool.submit(() -> {
                while (System.currentTimeMillis() < until) {
                    long seed = next.getAndIncrement() * 7919L + players;
                    try {
                        out.add(playOne(players, seed, kindOf));
                    } catch (RuntimeException e) {
                        // a stuck or broken game is skipped
                    }
                }
            });
        }
        pool.shutdown();
        pool.awaitTermination(15, TimeUnit.MINUTES);
        return out;
    }

    static Result playOne(int players, long seed, Map<String, String> kindOf) {
        List<String> names = new ArrayList<>();
        for (int i = 0; i < players; i++) names.add("P" + (i + 1));
        Game g = new Game(C, names, seed);
        g.audit = new ArrayList<>();
        AiPlayer bot = new AiPlayer(seed);
        int steps = 0;
        while (g.result == null && steps++ < 20000 && bot.step(g)) { /* play */ }
        if (g.result == null) throw new IllegalStateException("stuck");
        Set<String> used = new HashSet<>();
        String defeat = null;
        for (String line : g.audit) {
            int i = line.indexOf(" plays ");
            if (i > 0 && line.endsWith(".")) used.add(line.substring(i + 7, line.length() - 1));
            i = line.indexOf(" is now led by ");
            if (i > 0) used.add(line.substring(i + 15, line.indexOf(':', i)));
            if (line.startsWith("The great wonder ") && line.contains(" is complete")) used.add(line.substring(17, line.indexOf(" is complete")));
            if (line.startsWith("DEFEAT: ")) defeat = line.substring(8);
        }
        return new Result("victory".equals(g.result), g.score(), g.round, g.eraIndex, used, defeat);
    }

    static void report(int players, List<Result> rs, Map<String, String> kindOf) throws Exception {
        int n = rs.size();
        long wins = rs.stream().filter(Result::win).count();
        double avgScore = rs.stream().mapToInt(Result::score).average().orElse(0);
        System.out.printf("%n==== %d player(s): %d games, win rate %.1f%%, avg score %.1f, avg rounds %.1f ====%n", players, n, 100.0 * wins / Math.max(1, n),
                avgScore, rs.stream().mapToInt(Result::rounds).average().orElse(0));
        Map<String, Integer> defeats = new HashMap<>();
        for (Result r : rs) if (r.defeat() != null) defeats.merge(r.defeat().replaceAll("[0-9]+", "#"), 1, Integer::sum);
        System.out.println("Why games were lost (top):");
        defeats.entrySet().stream().sorted((a, b) -> b.getValue() - a.getValue()).limit(5).forEach(e -> System.out.println("  " + e.getValue() + "  " + e.getKey()));
        Set<String> cards = new HashSet<>();
        for (Result r : rs) cards.addAll(r.used());
        record Row(String name, String kind, int used, double usedRate, double winUsed, double winNot, double scoreUsed, double scoreNot) {}
        List<Row> rows = new ArrayList<>();
        double baseWin = (double) wins / Math.max(1, n);
        for (String c : cards) {
            int u = 0, uw = 0, nu = 0, nw = 0, us = 0, ns = 0;
            for (Result r : rs) {
                if (r.used().contains(c)) { u++; if (r.win()) uw++; us += r.score(); } else { nu++; if (r.win()) nw++; ns += r.score(); }
            }
            rows.add(new Row(c, kindOf.getOrDefault(c, "?"), u, (double) u / n, u == 0 ? 0 : (double) uw / u, nu == 0 ? 0 : (double) nw / nu,
                    u == 0 ? 0 : (double) us / u, nu == 0 ? 0 : (double) ns / nu));
        }
        try (PrintWriter w = new PrintWriter(Files.newBufferedWriter(Path.of("/tmp/balance-" + players + "p.csv")))) {
            w.println("card,kind,games_used,used_pct,win_used,win_not_used,delta,score_used,score_not_used");
            for (Row r : rows) w.printf("%s,%s,%d,%.3f,%.3f,%.3f,%.3f,%.1f,%.1f%n", r.name(), r.kind(), r.used(), r.usedRate(), r.winUsed(), r.winNot(), r.winUsed() - r.winNot(), r.scoreUsed(), r.scoreNot());
        }
        // the ranked tables: only cards used in enough games to mean something
        int min = Math.max(30, n / 50);
        for (String kind : List.of("leader", "tech", "minor_wonder", "great_wonder", "action")) {
            List<Row> k = rows.stream().filter(r -> r.kind().equals(kind) && r.used() >= min).sorted((a, b) -> Double.compare(b.winUsed() - b.winNot(), a.winUsed() - a.winNot())).toList();
            System.out.println("\n-- " + kind + " (win rate with the card minus without; games used; share of games; avg score with/without)");
            for (Row r : k) System.out.printf("  %-26s %+6.1f%%  n=%-5d %5.1f%%  score %5.1f / %5.1f%n", r.name(), 100 * (r.winUsed() - r.winNot()), r.used(), 100 * r.usedRate(), r.scoreUsed(), r.scoreNot());
            List<Row> rare = rows.stream().filter(r -> r.kind().equals(kind) && r.used() < min).toList();
            if (!rare.isEmpty()) System.out.println("  (too rare to judge: " + rare.stream().map(Row::name).toList() + ")");
        }
    }
}
