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
 * gain, lose, population, army, stability, health, draw, extraActions, addCrisis, destroyBuilding, freeBuilding,
 * civilWar (a random core territory loses its core status; with none, a random territory is lost), colony (n lands from the world deck become colonies at once, open to settling), discover (put lands from the world deck, or a named special land, face up), enemy ({each: n} or {one: n}: raise
 * face-up lands' enemy strength), removeLand (n random face-up lands are discarded with what was paid), settle (the card settles a chosen face-up land), core (the card cores a territory).
 *
 * <p><b>Lasting</b> (active while the owner holds the tech or wonder, or while a persistent event is in play):
 * income, perWorker, handLimit, actionsPerTurn, raidDefense, invasionDefense, mitigate, buildDiscount, sharedPool,
 * victoryPoints, faceUpLands (more lands face up), settleDiscount (off every land's settling cost), freeSettlers
 * (fewer settlers needed per land), strengthPerTwoTroops (military strength +n for every 2 troops), giveCards (the
 * owner may give up to n cards to teammates for 1 action), freeRecruit (leader: the first troop trained each round takes no action),
 * freeTech (leader: the next technology played is free), healthMod (a land: Health counts n more or less while it is held), troopStrength (every troop is worth n more strength), recruitExtra (troops cost this much more to train),
 * troopUpkeep (food per troop each round, may be 0.5), buildingDiscount ({building: temple, production: 1}: that building costs less),
 * retireBuilding (no more of that building can be built or expanded), unlockBuilding (a tech makes a locked building such as the market available to everyone), halveWonderUpkeep (the upkeep of wonders from earlier eras is halved),
 * growthDiscount (growing costs n less food), wonderDouble (resources given to great wonders count double), incomePerTerritory ({food: 1}: per territory in the realm),
 * noEnemy and halveEnemy (leaders: enemy strength on lands to settle is 0 / halved),
 * strengthBonus (leader: +n military strength), ownStrengthPerTwoTroops (leader: the owner's military strength +n per 2 troops), maxSlots ({farm: 1}: more worker slots a
 * building type may have), buildCost ({building: temple, production: 1}: that building costs only this), wonderGrowth (leader: every unfinished great wonder gains n of each
 * resource it needs every round), eventUnder (leader: an event leaving the queue gives its face-down card), actionsToHand (leader: action cards leaving the queue go to the hand). trade ([resources]: the card sends any amount of those
 * resources to a chosen teammate; giving is otherwise not possible).
 * <p><b>Crisis</b> (in a lasting crisis's stages / everyRound): threat (+n enemies massing), invadeIfStronger (an
 * invasion card strikes if the massing enemies outnumber the players' military strength), raidAll ({card, strength}:
 * a raid on every player), invasion (an invasion card strikes), healthTest ({threshold, populationLoss}).
 * coreTerritory (great wonders, when finished): cores the territory the wonder stands in, else another one.
 *
 * <p><b>Response</b> (only on response cards, for the event being resolved): defense, halve, cancel, healthBonus.
 */
public final class Effects {
    private Effects() {}

    static final Set<String> IMMEDIATE = Set.of("gain", "lose", "population", "army", "stability", "health", "draw",
            "extraActions", "addCrisis", "destroyBuilding", "freeBuilding", "discover", "colony", "civilWar", "enemy", "settle", "core", "removeLand", "coreTerritory", "hostility",
            "threat", "enemyCard", "invadeIfStronger", "raidAll", "invasion", "healthTest", "trade");
    static final Set<String> LASTING = Set.of("income", "perWorker", "handLimit", "actionsPerTurn", "raidDefense",
            "mitigate", "buildDiscount", "sharedPool", "victoryPoints", "invasionDefense", "faceUpLands", "settleDiscount", "freeSettlers", "strengthPerTwoTroops", "giveCards", "freeRecruit", "strengthBonus", "ownStrengthPerTwoTroops", "maxSlots", "buildCost", "wonderGrowth", "eventUnder", "actionsToHand",
            "growthDiscount", "wonderDouble", "incomePerTerritory", "noEnemy", "halveEnemy", "healthMod", "troopStrength", "recruitExtra", "troopUpkeep", "freeTech", "buildingDiscount", "halveWonderUpkeep", "unlockBuilding", "retireBuilding", "invasionStrength", "settlerCost");
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
    /** Effects that change what buildings produce need an upgrade slot; rule changes (hand size, actions, ...) always work. */
    public static boolean needsSlot(Map<String, Object> e) {
        String k = key(e);
        return k.equals("income") || k.equals("perWorker");
    }

    public static final class Mods {
        public final EnumMap<Res, Integer> income = Res.empty();
        public final Map<String, EnumMap<Res, Integer>> perWorker = new HashMap<>();
        public final EnumMap<Res, Integer> buildDiscount = Res.empty();
        public final EnumMap<Res, Integer> poolIncome = Res.empty();
        public final Set<String> mitigate = new HashSet<>();
        public int handLimit, actionsPerTurn, raidDefense, victoryPoints, invasionDefense, faceUpLands, freeSettlers, strengthPerTwoTroops, giveCards, freeRecruit, strengthBonus, ownStrengthPerTwoTroops, growthDiscount, wonderDouble, healthMod, troopStrength, invasionStrength, settlerCost;
        /** Spear Men: troops cost more to train and eat food. */
        public final EnumMap<Res, Integer> recruitExtra = Res.empty();
        public double troopUpkeep;
        /** Income for every territory in the realm (Skara Brae). */
        public final EnumMap<Res, Integer> perTerritory = Res.empty();
        /** Extra worker slots a player may have per building type (a leader like the Great Hunter). */
        public final Map<String, Integer> maxSlots = new HashMap<>();
        /** Buildings that cost a fixed amount instead (the First Shaman's temples). */
        public final Map<String, EnumMap<Res, Integer>> fixedCost = new HashMap<>();
        public final EnumMap<Res, Integer> settleDiscount = Res.empty();
        public boolean sharedPool;
        /** A cheaper building type (The First Religion's temples: -1 production). */
        public final Map<String, EnumMap<Res, Integer>> buildingDiscount = new HashMap<>();
        /** Ancients Customs: the upkeep of wonders from earlier eras is halved. */
        public boolean halveWonderUpkeep;
        /** Buildings a tech makes available (Markets). */
        public final Set<String> unlocked = new HashSet<>();
        /** Buildings nobody may build or expand any more (the gatherers once Agriculture is known). */
        public final Set<String> retired = new HashSet<>();

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
                case "invasionDefense" -> invasionDefense += Y.toInt(v);
                case "invasionStrength" -> invasionStrength += Y.toInt(v);
                case "settlerCost" -> settlerCost += Y.toInt(v);
                case "faceUpLands" -> faceUpLands += Y.toInt(v);
                case "freeSettlers" -> freeSettlers += Y.toInt(v);
                case "strengthPerTwoTroops" -> strengthPerTwoTroops += Y.toInt(v);
                case "giveCards" -> giveCards += Y.toInt(v);
                case "freeRecruit" -> freeRecruit += Y.toInt(v);
                case "strengthBonus" -> strengthBonus += Y.toInt(v);
                case "growthDiscount" -> growthDiscount += Y.toInt(v);
                case "healthMod" -> healthMod += Y.toInt(v);
                case "troopStrength" -> troopStrength += Y.toInt(v);
                case "recruitExtra" -> Res.parse(v).forEach((r, n) -> recruitExtra.merge(r, n, Integer::sum));
                case "troopUpkeep" -> troopUpkeep += ((Number) v).doubleValue();
                case "wonderDouble" -> wonderDouble += Y.toInt(v);
                case "incomePerTerritory" -> Res.parse(v).forEach((r, n) -> perTerritory.merge(r, n, Integer::sum));
                case "ownStrengthPerTwoTroops" -> ownStrengthPerTwoTroops += Y.toInt(v);
                case "maxSlots" -> Y.map(v).forEach((b, n) -> maxSlots.merge(b, Y.toInt(n), Integer::sum));
                case "buildCost" -> {
                    Map<String, Object> m = new HashMap<>(Y.map(v));
                    String building = String.valueOf(m.remove("building"));
                    fixedCost.put(building, Res.parse(m));
                }
                case "buildingDiscount" -> {
                    Map<String, Object> m = new HashMap<>(Y.map(v));
                    String building = String.valueOf(m.remove("building"));
                    EnumMap<Res, Integer> cur = buildingDiscount.computeIfAbsent(building, x -> Res.empty());
                    Res.parse(m).forEach((r, n) -> cur.merge(r, n, Integer::sum));
                }
                case "halveWonderUpkeep" -> halveWonderUpkeep = true;
                case "unlockBuilding" -> unlocked.add(String.valueOf(v));
                case "retireBuilding" -> retired.add(String.valueOf(v));
                case "settleDiscount" -> Res.parse(v).forEach((r, n) -> settleDiscount.merge(r, n, Integer::sum));
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
