package com.dawnofmankind.core;

import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The effect vocabulary used in content.yaml. Each effect is a one-key map, e.g. {@code - gain: {food: 2}}.
 *
 * <p><b>Immediate</b> (applied once, when a card is played, a wonder is finished or an event resolves):
 * gain, lose, population, army, stability, health, draw, extraActions, addCrisis, destroyBuilding, freeBuilding.
 *
 * <p><b>Lasting</b> (active while the owner holds the tech or wonder, or while a persistent event is in play):
 * income, perWorker, handLimit, actionsPerTurn, raidDefense, mitigate, buildDiscount, sharedPool, victoryPoints.
 *
 * <p><b>Response</b> (only on response cards, for the event being resolved): defense, halve, cancel, healthBonus.
 */
public final class Effects {
    private Effects() {}

    static final Set<String> IMMEDIATE = Set.of("gain", "lose", "population", "army", "stability", "health", "draw",
            "extraActions", "addCrisis", "destroyBuilding", "freeBuilding");
    static final Set<String> LASTING = Set.of("income", "perWorker", "handLimit", "actionsPerTurn", "raidDefense",
            "mitigate", "buildDiscount", "sharedPool", "victoryPoints");
    static final Set<String> RESPONSE = Set.of("defense", "halve", "cancel", "healthBonus");

    static String key(Map<String, Object> e) {
        return e.keySet().iterator().next();
    }

    static void check(Map<String, Object> e, String owner) {
        String k = key(e);
        if (!IMMEDIATE.contains(k) && !LASTING.contains(k) && !RESPONSE.contains(k)) {
            throw new IllegalStateException(owner + ": unknown effect '" + k + "'");
        }
    }

    /** Lasting bonuses for one player, summed from their techs and minor wonders, the team's great wonders and active curses. */
    public static final class Mods {
        public final EnumMap<Res, Integer> income = Res.empty();
        public final Map<String, EnumMap<Res, Integer>> perWorker = new HashMap<>();
        public final EnumMap<Res, Integer> buildDiscount = Res.empty();
        public final EnumMap<Res, Integer> poolIncome = Res.empty();
        public final Set<String> mitigate = new HashSet<>();
        public int handLimit, actionsPerTurn, raidDefense, victoryPoints;
        public boolean sharedPool;

        void add(List<Map<String, Object>> effects) {
            for (Map<String, Object> e : effects) add(e);
        }

        void add(Map<String, Object> e) {
            String k = key(e);
            Object v = e.get(k);
            switch (k) {
                case "income" -> Res.parse(v).forEach((r, n) -> income.merge(r, n, Integer::sum));
                case "perWorker" -> {
                    Map<String, Object> m = new HashMap<>(Y.map(v));
                    String building = String.valueOf(m.remove("building"));
                    EnumMap<Res, Integer> add = Res.parse(m);
                    EnumMap<Res, Integer> cur = perWorker.computeIfAbsent(building, x -> Res.empty());
                    add.forEach((r, n) -> cur.merge(r, n, Integer::sum));
                }
                case "buildDiscount" -> Res.parse(v).forEach((r, n) -> buildDiscount.merge(r, n, Integer::sum));
                case "handLimit" -> handLimit += Y.toInt(v);
                case "actionsPerTurn" -> actionsPerTurn += Y.toInt(v);
                case "raidDefense" -> raidDefense += Y.toInt(v);
                case "victoryPoints" -> victoryPoints += Y.toInt(v);
                case "mitigate" -> mitigate.addAll(Y.strings(v));
                case "sharedPool" -> {
                    sharedPool = true;
                    Res.parse(Y.map(v).get("income")).forEach((r, n) -> poolIncome.merge(r, n, Integer::sum));
                }
                default -> { /* immediate and response effects are not lasting */ }
            }
        }
    }
}
