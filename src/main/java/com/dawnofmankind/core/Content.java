package com.dawnofmankind.core;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;

/**
 * All game data, loaded from {@code dawn/content.yaml}: the rules' numbers, buildings, cards, wonders, eras, starting
 * events and crisis cards. Change the YAML to change the game; no code needed for new cards that use existing effects.
 */
public final class Content {

    public enum CardType { TECH, ACTION, RESPONSE, MINOR_WONDER, GREAT_WONDER, EVENT, HOSTILITY, LEADER, CITY_STATE, ERA_END }

    /** Rule numbers from the {@code rules:} block. */
    public static final class Rules {
        public int actionsPerTurn, handLimit, foodUpkeepPerPop, startStability, startHealth, queueExtra,
                startingEventsPerPlayer, eraTriggerBottomShare;
        /** The enemy deck at the start: strength to number of cards. Raids and invasions draw from it. */
        public final Map<Integer, Integer> enemyDeck = new java.util.TreeMap<>();
        public EnumMap<Res, Integer> startResources, growthCost, recruitCost;
        public Map<String, Integer> startWorkers = new LinkedHashMap<>();
        public Map<Integer, Integer> removedPerRound = new LinkedHashMap<>();
        /** Cards of each type in an era deck: {base, perPlayer}; types: leader, great_wonder, minor_wonder, hostility, tech, action, response, event, era_trigger. */
        public Map<String, int[]> eraDeck = new LinkedHashMap<>();
        /** Worker slots every player has for land-bound buildings (farm, mine) before any territory. */
        public Map<String, Integer> homeSlots = new LinkedHashMap<>();
        /** Upgrade slots of the people themselves: "warriors" (the army) and "population" (idle people). */
        public Map<String, Integer> unitSlots = new LinkedHashMap<>();
        public int startTerritories, growthStep;
        /** Extra production for each level a building already has. */
        public int buildingEscalation;
        public EnumMap<Res, Integer> colonizeCostPerPlayer, colonizeEscalationPerPlayer;
        public int colonizeFreeTerritories, faceUpLands, colonizeSettlersPerPlayer;

        public int removedPerRound(int players) {
            return removedPerRound.getOrDefault(players, 1);
        }
    }

    public static final class BuildingDef {
        public String id, name, text;
        public int slots;
        public boolean buildable;
        /** Cannot be built until a tech with {@code unlockBuilding} for it has been researched. */
        public boolean locked;
        /** The land slots this building uses (territories and maxSlots name it): gatherers use the farm slots, hunters the mine slots. */
        public String slotKey;
        /** Cards that change what this building produces (techs, minor wonders) each need one of these; they never grow with the building. */
        public int upgradeSlots;
        public EnumMap<Res, Integer> cost, perWorker, upkeep;
    }

    /** One card in a deck: a technology, action, response, minor wonder or event (crisis cards are events). */
    public static final class CardDef {
        public String id, name, text, flavor, era;
        public CardType type;
        /** For great wonder cards: the wonder it starts. */
        public String wonder;
        /** For city state cards: the special land (territories:) that goes to the lands to settle. */
        public String land;
        public EnumMap<Res, Integer> cost;
        /** What playing the card does (tech, action, wonder) or, for events, what happens on resolution. */
        public List<Map<String, Object>> effects = new ArrayList<>();
        // responses
        public List<String> respondsTo = List.of();
        // events
        public String category, kind, target;
        public int strengthBase, strengthPerPlayer, threshold;
        /** A raid draws this many enemy cards: base + perEra × the era's number. -1 when the card has a fixed strength. */
        public int drawsBase = -1, drawsPerEra;
        /** Invasions grow with the realm: strength += this × players × territories. */
        public double strengthPerPlayerPerTerritory;
        public String stat;
        public List<Map<String, Object>> perShortfall = new ArrayList<>();
        public EnumMap<Res, Integer> offerCost;
        public List<Map<String, Object>> ongoing = new ArrayList<>();
        public EnumMap<Res, Integer> cleanseCost;
        public boolean eraTrigger, crisis, persistent;
        /** Techs and minor wonders: lasting effects that are always on, effects that work only while the card sits in an upgrade slot, and the building types whose slots it fits (empty: any). */
        public List<Map<String, Object>> global = new ArrayList<>(), bonus = new ArrayList<>();
        public List<String> slotIn = new ArrayList<>();
        /** An era-end event: the era whose end it can be (listed under that era's endEvents). */
        public String eraEnd;
        /** Always in the era deck of the era that lists it (it takes one of the places of its kind). */
        public boolean required;
        /** How many copies a required card puts in the era deck. */
        public int requiredCopies = 1;
        /** Minor wonders: the era after which the bonuses stop. */
        public String obsoleteAfter;
        /** The card is only put in the era deck when at least this many play. */
        public int minPlayers = 1;
        /** Only used inside a crisis (its raids and invasions); never in a deck or the past events. */
        public boolean helper;
        /**
         * A crisis that lasts: it acts when it resolves and again in every following events phase, for up to
         * {@code lastsRounds} rounds or until {@code endWhen} is met. Round i uses {@code stages[i]} (if any) plus
         * {@code everyRound}.
         */
        public int lastsRounds;
        public List<List<Map<String, Object>>> stages = new ArrayList<>();
        public List<Map<String, Object>> everyRound = new ArrayList<>();
        public Map<String, Object> endWhen = Map.of();

        public boolean lasts() {
            return lastsRounds > 0;
        }

        public boolean isEvent() {
            return type == CardType.EVENT;
        }

        public int strength(int players, int territories) {
            return strengthBase + strengthPerPlayer * players + (int) Math.round(strengthPerPlayerPerTerritory * players * territories);
        }
    }

    public static final class WonderDef {
        public String id, name, text, era;
        /** Cost per player; great wonders are paid for by the whole team. */
        public EnumMap<Res, Integer> costPerPlayer;
        public List<Map<String, Object>> effects = new ArrayList<>();
        public int victoryPoints;
        /** The era after which the wonder's bonuses stop (e.g. Nomadic Living after the Prehistoric era). */
        public String obsoleteAfter;

        public EnumMap<Res, Integer> cost(int players) {
            EnumMap<Res, Integer> m = Res.empty();
            costPerPlayer.forEach((r, v) -> m.put(r, v * players));
            return m;
        }
    }

    /** A territory in the world deck: room for land-bound buildings and lasting bonuses for every player. */
    public static final class TerritoryDef {
        public String id, name, text;
        public int copies, colonization;
        /** Extra worker slots per player, by building type, e.g. plains: {farm: 2}. */
        public Map<String, Integer> slots = new LinkedHashMap<>();
        public List<Map<String, Object>> effects = new ArrayList<>();
        /** Special lands found by events have their own cost (per player); population and army are paid in people and troops. */
        public boolean special;
        public EnumMap<Res, Integer> costPerPlayer;
        public int populationPerPlayer, armyPerPlayer;
        /** Enemy strength a found land starts with (the Wondrous Land). */
        public int enemy;
        /** A great wonder of the era that is not in the game stands on this land. */
        public boolean hasWonder;
    }

    public static final class EraDef {
        public String id, name;
        public int order;
        public Map<String, Integer> cards = new LinkedHashMap<>();
        /** The special events one of which strikes when the era's third end card is placed; their effects last through the next era. */
        public List<String> endEvents = new ArrayList<>();
    }

    public final Rules rules = new Rules();
    public final Map<String, BuildingDef> buildings = new LinkedHashMap<>();
    public final Map<String, CardDef> cards = new LinkedHashMap<>();
    public final Map<String, WonderDef> greatWonders = new LinkedHashMap<>();
    public final List<EraDef> eras = new ArrayList<>();
    /** Words that show a rules box when hovered: id to {name, match, text}. */
    public final Map<String, Map<String, Object>> keywords = new LinkedHashMap<>();
    public final Map<String, TerritoryDef> territories = new LinkedHashMap<>();
    public final Map<String, Integer> startingEvents = new LinkedHashMap<>();
    public final List<String> crisisCards = new ArrayList<>();

    public static Content loadDefault() {
        try (InputStream in = Content.class.getResourceAsStream("/dawn/content.yaml")) {
            if (in == null) throw new IllegalStateException("dawn/content.yaml is missing from the classpath");
            return load(in);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    public static Content load(InputStream in) {
        LoaderOptions opts = new LoaderOptions();
        Map<String, Object> root = Y.map(new Yaml(opts).load(in));
        Content c = new Content();
        c.readRules(Y.map(root.get("rules")));
        Y.map(root.get("buildings")).forEach((id, v) -> c.buildings.put(id, building(id, Y.map(v))));
        Y.map(root.get("cards")).forEach((id, v) -> c.cards.put(id, card(id, Y.map(v))));
        Y.map(root.get("greatWonders")).forEach((id, v) -> c.greatWonders.put(id, wonder(id, Y.map(v))));
        // every great wonder is also a card that can turn up in the queue
        for (WonderDef w : c.greatWonders.values()) {
            if (c.cards.containsKey(w.id)) throw new IllegalStateException("A card and a great wonder share the id " + w.id);
            CardDef d = new CardDef();
            d.id = w.id;
            d.name = w.name;
            d.text = w.text;
            d.flavor = "";
            d.type = CardType.GREAT_WONDER;
            d.cost = Res.empty();
            d.offerCost = Res.empty();
            d.cleanseCost = Res.empty();
            d.wonder = w.id;
            c.cards.put(w.id, d);
        }
        Y.map(root.get("keywords")).forEach((id, v) -> c.keywords.put(id, Y.map(v)));
        Y.map(root.get("territories")).forEach((id, v) -> c.territories.put(id, territory(id, Y.map(v))));
        int order = 0;
        for (Object o : Y.list(root.get("eras"))) {
            Map<String, Object> m = Y.map(o);
            EraDef e = new EraDef();
            e.id = Y.s(m, "id", null);
            e.name = Y.s(m, "name", e.id);
            e.order = order++;
            Y.map(m.get("cards")).forEach((k, v) -> e.cards.put(k, Y.toInt(v)));
            e.endEvents.addAll(Y.strings(m.get("endEvents")));
            c.eras.add(e);
        }
        Y.map(root.get("startingEvents")).forEach((k, v) -> c.startingEvents.put(k, Y.toInt(v)));
        c.crisisCards.addAll(Y.strings(root.get("crisisCards")));
        c.validate();
        return c;
    }

    private void readRules(Map<String, Object> m) {
        rules.actionsPerTurn = Y.i(m, "actionsPerTurn", 4);
        rules.handLimit = Y.i(m, "handLimit", 7);
        rules.foodUpkeepPerPop = Y.i(m, "foodUpkeepPerPop", 1);
        rules.startStability = Y.i(m, "startStability", 10);
        rules.startHealth = Y.i(m, "startHealth", 0);
        rules.queueExtra = Y.i(m, "queueExtra", 2);
        rules.startingEventsPerPlayer = Y.i(m, "startingEventsPerPlayer", 2);
        rules.eraTriggerBottomShare = Y.i(m, "eraTriggerBottomPercent", 40);
        Y.map(m.get("enemyDeck")).forEach((k, v) -> rules.enemyDeck.put(Integer.parseInt(String.valueOf(k)), Y.toInt(v)));
        rules.startResources = Res.parse(m.get("startResources"));
        rules.growthCost = Res.parse(m.get("growthCost"));
        rules.recruitCost = Res.parse(m.get("recruitCost"));
        Y.map(m.get("startWorkers")).forEach((k, v) -> rules.startWorkers.put(k, Y.toInt(v)));
        if (m.get("removedPerRound") instanceof Map<?, ?> rp) {
            rp.forEach((k, v) -> rules.removedPerRound.put(Y.toInt(k), Y.toInt(v)));
        }
        Y.map(m.get("homeSlots")).forEach((k, v) -> rules.homeSlots.put(k, Y.toInt(v)));
        Y.map(m.get("unitSlots")).forEach((k, v) -> rules.unitSlots.put(k, Y.toInt(v)));
        rules.startTerritories = Y.i(m, "startTerritories", 2);
        rules.faceUpLands = Y.i(m, "faceUpLands", 2);
        rules.growthStep = Y.i(m, "growthStep", 4);
        rules.buildingEscalation = Y.i(m, "buildingEscalation", 1);
        Map<String, Object> col = Y.map(m.get("colonize"));
        rules.colonizeCostPerPlayer = Res.parse(col.get("costPerPlayer"));
        rules.colonizeEscalationPerPlayer = Res.parse(col.get("extraPerTerritoryPerPlayer"));
        rules.colonizeFreeTerritories = Y.i(col, "territoriesBeforeExtra", 2);
        rules.colonizeSettlersPerPlayer = Y.i(col, "settlersPerPlayer", 0);
        Y.map(m.get("eraDeck")).forEach((type, v) -> {
            Map<String, Object> d = Y.map(v);
            rules.eraDeck.put(type, new int[]{Y.i(d, "base", 0), Y.i(d, "perPlayer", 0)});
        });
    }

    private static BuildingDef building(String id, Map<String, Object> m) {
        BuildingDef b = new BuildingDef();
        b.id = id;
        b.name = Y.s(m, "name", id);
        b.text = Y.s(m, "text", "");
        b.slots = Y.i(m, "slots", 2);
        b.buildable = !m.containsKey("buildable") || Y.b(m, "buildable");
        b.locked = Y.b(m, "locked");
        b.slotKey = Y.s(m, "slotKey", id);
        b.upgradeSlots = Y.i(m, "upgradeSlots", 1);
        b.cost = Res.parse(m.get("cost"));
        b.perWorker = Res.parse(m.get("perWorker"));
        b.upkeep = Res.parse(m.get("upkeep"));
        return b;
    }

    private static List<Map<String, Object>> effects(Object o) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object e : Y.list(o)) {
            Map<String, Object> m = Y.map(e);
            if (m.size() != 1) throw new IllegalArgumentException("Each effect must have exactly one key: " + m);
            out.add(m);
        }
        return out;
    }

    private static CardDef card(String id, Map<String, Object> m) {
        CardDef c = new CardDef();
        c.id = id;
        c.name = Y.s(m, "name", id);
        c.text = Y.s(m, "text", "");
        c.flavor = Y.s(m, "flavor", "");
        c.type = CardType.valueOf(Y.s(m, "type", "action").toUpperCase().replace(' ', '_'));
        c.cost = Res.parse(m.get("cost"));
        c.effects = effects(m.get("effects"));
        c.global = effects(m.get("global"));
        c.bonus = effects(m.get("bonus"));
        c.slotIn.addAll(Y.strings(m.get("slotIn")));
        c.respondsTo = Y.strings(m.get("respondsTo"));
        c.category = Y.s(m, "category", null);
        c.kind = Y.s(m, "kind", "effects");
        c.target = Y.s(m, "target", "civ");
        Map<String, Object> dr = Y.map(m.get("draws"));
        if (!dr.isEmpty()) {
            c.drawsBase = Y.i(dr, "base", 0);
            c.drawsPerEra = Y.i(dr, "perEra", 0);
        }
        Object st = m.get("strength");
        if (st instanceof Map<?, ?>) {
            Map<String, Object> sm = Y.map(st);
            c.strengthBase = Y.i(sm, "base", 0);
            c.strengthPerPlayer = Y.i(sm, "perPlayer", 0);
            Object ppt = sm.get("perPlayerPerTerritory");
            c.strengthPerPlayerPerTerritory = ppt == null ? 0 : ((Number) ppt).doubleValue();
        } else {
            c.strengthBase = Y.toInt(st);
        }
        c.stat = Y.s(m, "stat", null);
        c.threshold = Y.i(m, "threshold", 0);
        c.perShortfall = effects(m.get("perShortfall"));
        Map<String, Object> offer = Y.map(m.get("offer"));
        c.offerCost = Res.parse(offer.get("cost"));
        if (!offer.isEmpty()) c.effects = effects(offer.get("effects"));
        Map<String, Object> pers = Y.map(m.get("persistent"));
        c.persistent = !pers.isEmpty();
        c.ongoing = effects(pers.get("ongoing"));
        c.cleanseCost = Res.parse(pers.get("cleanse"));
        c.eraTrigger = Y.b(m, "eraTrigger") || c.type == CardType.ERA_END;
        c.eraEnd = Y.s(m, "eraEnd", null);
        c.land = Y.s(m, "land", null);
        c.required = Y.b(m, "required");
        c.requiredCopies = Y.i(m, "requiredCopies", 1);
        c.minPlayers = Y.i(m, "minPlayers", 1);
        c.obsoleteAfter = Y.s(m, "obsoleteAfter", null);
        c.helper = Y.b(m, "helper");
        Map<String, Object> lasts = Y.map(m.get("lasts"));
        c.lastsRounds = Y.i(lasts, "rounds", 0);
        for (Object stage : Y.list(lasts.get("stages"))) c.stages.add(effects(stage));
        c.everyRound = effects(lasts.get("everyRound"));
        c.endWhen = Y.map(lasts.get("endWhen"));
        c.crisis = Y.b(m, "crisis");
        return c;
    }

    private static TerritoryDef territory(String id, Map<String, Object> m) {
        TerritoryDef t = new TerritoryDef();
        t.id = id;
        t.name = Y.s(m, "name", id);
        t.text = Y.s(m, "text", "");
        t.copies = Y.i(m, "copies", 1);
        t.colonization = Y.i(m, "colonization", 0);
        Y.map(m.get("slots")).forEach((k, v) -> t.slots.put(k, Y.toInt(v)));
        t.effects = effects(m.get("effects"));
        t.special = Y.b(m, "special");
        t.enemy = Y.i(m, "enemy", 0);
        t.hasWonder = Y.b(m, "hasWonder");
        Map<String, Object> cost = new LinkedHashMap<>(Y.map(m.get("costPerPlayer")));
        t.populationPerPlayer = Y.toInt(cost.remove("population"));
        t.armyPerPlayer = Y.toInt(cost.remove("army"));
        t.costPerPlayer = Res.parse(cost);
        return t;
    }

    private static WonderDef wonder(String id, Map<String, Object> m) {
        WonderDef w = new WonderDef();
        w.id = id;
        w.name = Y.s(m, "name", id);
        w.text = Y.s(m, "text", "");
        w.era = Y.s(m, "era", null);
        w.costPerPlayer = Res.parse(m.get("costPerPlayer"));
        w.effects = effects(m.get("effects"));
        w.victoryPoints = Y.i(m, "victoryPoints", 0);
        w.obsoleteAfter = Y.s(m, "obsoleteAfter", null);
        return w;
    }

    private void validate() {
        // a card belongs to the first era that lists it (the age of a wonder is counted from there)
        for (EraDef e : eras) for (String id : e.cards.keySet()) {
            CardDef d = cards.get(id);
            if (d != null && d.era == null) d.era = e.id;
        }
        for (EraDef e : eras) for (String id : e.endEvents) {
            CardDef d = cards.get(id);
            if (d == null || !d.isEvent()) throw new IllegalStateException("Era " + e.id + " lists an unknown era-end event " + id);
            if (d.era == null) d.era = e.id;
            d.eraEnd = e.id;
        }
        for (CardDef c : cards.values()) {
            if (c.type == CardType.CITY_STATE && (c.land == null || !territories.containsKey(c.land))) throw new IllegalStateException("City state card " + c.id + " needs a land: from territories");
        }
        for (EraDef e : eras) {
            for (String id : e.cards.keySet()) if (!cards.containsKey(id)) throw new IllegalStateException("Era " + e.id + " lists unknown card " + id);
        }
        for (String id : startingEvents.keySet()) if (!cards.containsKey(id) || !cards.get(id).isEvent()) throw new IllegalStateException("Starting event " + id + " is not an event card");
        for (String id : crisisCards) if (!cards.containsKey(id) || !cards.get(id).isEvent()) throw new IllegalStateException("Crisis " + id + " is not an event card");
        for (String id : rules.startWorkers.keySet()) if (!buildings.containsKey(id)) throw new IllegalStateException("Unknown start building " + id);
        for (CardDef c : cards.values()) {
            if (c.isEvent() && c.category == null) throw new IllegalStateException("Event " + c.id + " needs a category");
            for (Map<String, Object> e : c.effects) Effects.check(e, c.id);
            for (Map<String, Object> e : c.perShortfall) Effects.check(e, c.id);
            for (Map<String, Object> e : c.ongoing) Effects.check(e, c.id);
            for (Map<String, Object> e : c.everyRound) Effects.check(e, c.id);
            for (List<Map<String, Object>> st : c.stages) for (Map<String, Object> e : st) Effects.check(e, c.id);
        }
        for (WonderDef w : greatWonders.values()) for (Map<String, Object> e : w.effects) Effects.check(e, w.id);
        for (TerritoryDef t : territories.values()) {
            for (Map<String, Object> e : t.effects) Effects.check(e, t.id);
            for (String b : t.slots.keySet()) if (!buildings.containsKey(b)) throw new IllegalStateException("Territory " + t.id + " gives slots to unknown building " + b);
        }
        if (territories.values().stream().noneMatch(t -> !t.special)) throw new IllegalStateException("The world deck is empty");
        if (eras.isEmpty()) throw new IllegalStateException("No eras defined");
    }
}
