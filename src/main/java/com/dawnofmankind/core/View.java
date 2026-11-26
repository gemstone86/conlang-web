package com.dawnofmankind.core;

import com.dawnofmankind.core.Content.BuildingDef;
import com.dawnofmankind.core.Content.CardDef;
import com.dawnofmankind.core.Content.CardType;
import com.dawnofmankind.core.Content.WonderDef;
import com.dawnofmankind.core.Effects.Mods;
import com.dawnofmankind.core.Game.CardInst;
import com.dawnofmankind.core.Game.Slot;
import com.dawnofmankind.core.Game.WonderProgress;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import java.util.TreeMap;

/**
 * What one player may see, as plain maps and lists (ready for JSON). Other players' hands, the order of the decks and
 * the face-down cards in the queue are never included.
 */
public final class View {
    private View() {}

    public static Map<String, Object> of(Game g, int seat) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("version", g.version);
        v.put("phase", g.phase.name().toLowerCase());
        v.put("starving", g.starving);
        List<Object> notices = new ArrayList<>();
        for (Game.Notice n : g.notices) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("seq", n.seq);
            m.put("card", card(n.card));
            if (n.target >= 0) m.put("target", g.players.get(n.target).name);
            m.put("lines", n.lines);
            notices.add(m);
        }
        v.put("notices", notices);
        if (g.phase == Game.Phase.SETUP) {
            List<Object> offer = new ArrayList<>();
            for (Game.Territory t : g.setupOffers.getOrDefault(seat, List.of())) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", t.id);
                m.put("name", t.def.name);
                if (hasArt(t.def.id)) m.put("art", "cards/" + t.def.id + ".jpg");
                m.put("text", t.def.text);
                offer.add(m);
            }
            v.put("setupOffer", offer);
            v.put("setupWaiting", g.setupOffers.keySet().stream().filter(s -> s != seat).map(s -> g.players.get(s).name).toList());
        }
        v.put("round", g.round);
        v.put("era", g.era().name);
        v.put("eraIndex", g.eraIndex);
        v.put("eraCount", g.content.eras.size());
        v.put("eraBoons", g.eraBoons.stream().map(b -> def(b.def())).toList());
        v.put("firstPlayer", g.firstPlayer);
        v.put("actionsLeft", g.players.get(seat).actions);
        v.put("pickSeconds", g.pickSeconds);
        v.put("pickLeftMs", g.pickLeftMillis());
        v.put("stability", g.stability);
        v.put("health", g.effectiveHealth());
        v.put("threat", g.threat);
        v.put("leaderCost", g.leaderCost());
        Map<Integer, Integer> enemies = new java.util.TreeMap<>();
        for (int s : g.enemyDeck) enemies.merge(s, 1, Integer::sum);
        List<Object> enemyList = new ArrayList<>();
        enemies.forEach((s, n) -> enemyList.add(Map.of("strength", s, "n", n)));
        v.put("enemyDeck", enemyList);
        v.put("territoryPoints", g.realm.size());
        v.put("you", seat);
        v.put("result", g.result);
        v.put("endReason", g.endReason);
        v.put("score", g.score());
        v.put("eraDeck", g.eraDeck.size());
        v.put("queueRemoved", g.content.rules.removedPerRound(g.players.size()));

        List<Object> queue = new ArrayList<>();
        for (int i = 0; i < g.queue.size(); i++) {
            Slot s = g.queue.get(i);
            Map<String, Object> m = card(s.card);
            if (s.card.def.type == Content.CardType.GREAT_WONDER) {
                WonderDef w = g.content.greatWonders.get(s.card.def.wonder);
                m.put("cost", res(w.cost(g.players.size())));
                m.put("victoryPoints", w.victoryPoints);
            }
            m.put("slot", i);
            m.put("taken", s.taken);
            m.put("faceDown", s.under != null);
            queue.add(m);
        }
        v.put("queue", queue);

        v.put("eventDeck", g.currentEvents.size());
        v.put("eventDeckContents", countByName(g.currentEvents));
        v.put("futureEvents", g.futureEvents.size()); // face down: only how many
        v.put("pastEvents", g.pastEvents.stream().map(View::card).toList().reversed());
        v.put("persistentEvents", g.persistentEvents.stream().map(View::card).toList());
        List<Object> crises = new ArrayList<>();
        for (Game.ActiveCrisis c : g.crises) {
            Map<String, Object> m = card(c.card);
            m.put("round", c.roundsDone);
            m.put("rounds", c.card.def.lastsRounds);
            crises.add(m);
        }
        v.put("crises", crises);
        v.put("crisisPile", g.crisisPile.size());

        List<Object> wonders = new ArrayList<>();
        for (WonderProgress w : g.greatWonders) {
            Map<String, Object> m = wonder(w.def);
            if (hasArt(w.def.id)) m.put("art", "cards/" + w.def.id + ".jpg");
            m.put("cost", res(w.def.cost(g.players.size())));
            m.put("paid", res(w.paid));
            m.put("done", w.done);
            Map<String, Object> by = new LinkedHashMap<>();
            w.bySeat.forEach((s, r) -> by.put(g.players.get(s).name, res(r)));
            m.put("bySeat", by);
            wonders.add(m);
        }
        v.put("greatWonders", wonders);
        List<Object> built = new ArrayList<>();
        for (WonderDef w : g.builtWonders) {
            Map<String, Object> m = wonder(w);
            m.put("obsolete", g.obsolete(w));
            built.add(m);
        }
        v.put("builtWonders", built);
        v.put("strengthPerTwoTroops", g.civMods().strengthPerTwoTroops);
        v.put("tribeStrength", g.players.stream().mapToInt(x -> g.fighting(x, x.army)).sum() + g.civMods().invasionDefense);
        v.put("freeSettlers", g.civMods().freeSettlers);

        List<Object> realm = new ArrayList<>();
        for (Game.Territory t : g.realm) {
            Map<String, Object> m = territory(t);
            m.put("wonders", t.wonders.stream().map(w -> {
                Map<String, Object> wm = wonder(w);
                wm.put("obsolete", g.obsolete(w));
                return wm;
            }).toList());
            m.put("cored", t.cored);
            realm.add(m);
        }
        v.put("realm", realm);
        List<Object> frontier = new ArrayList<>();
        for (Game.Frontier f : g.frontier) {
            Map<String, Object> m = territory(f.land);
            if (f.land.pendingWonder != null) {
                m.put("text", f.land.def.text + " The wonder here: " + f.land.pendingWonder.name + " (" + f.land.pendingWonder.text + ")");
            }
            m.put("enemy", f.enemy);
            m.put("cost", res(g.settleCost(f)));
            m.put("paid", res(f.paid));
            m.put("left", res(g.settleLeft(f)));
            m.put("troops", g.settleTroops(f));
            m.put("troopsPaid", f.troopsPaid);
            m.put("settlers", g.settleSettlers(f));
            m.put("settlersPaid", f.settlersPaid);
            m.put("fromEvent", f.fromEvent);
            m.put("duringEvent", f.fromEvent);
            m.put("opened", f.opened);
            Map<String, Object> by = new LinkedHashMap<>();
            f.bySeat.forEach((s2, r) -> by.put(g.players.get(s2).name, res(r)));
            m.put("bySeat", by);
            frontier.add(m);
        }
        v.put("frontier", frontier);
        v.put("worldDeck", g.worldDeck.size());
        v.put("colonizationValue", g.colonizationValue());

        Mods civ = g.civMods();
        v.put("sharedPool", civ.sharedPool ? res(g.pool) : null);

        List<Object> players = new ArrayList<>();
        for (Player p : g.players) {
            Mods m = g.mods(p);
            Map<String, Object> pm = new LinkedHashMap<>();
            pm.put("seat", p.seat);
            pm.put("name", p.name);
            pm.put("resources", res(p.res));
            pm.put("population", p.population());
            pm.put("idle", p.idle);
            pm.put("army", p.army);
            pm.put("committed", p.committed);
            pm.put("raidDefense", m.raidDefense);
            pm.put("strength", g.fighting(p, p.army));
            pm.put("handSize", p.hand.size());
            pm.put("handLimit", g.handLimit(p));
            pm.put("giveCards", m.giveCards);
            pm.put("actionsPerTurn", g.content.rules.actionsPerTurn + m.actionsPerTurn);
            pm.put("away", p.away);
            Map<String, Integer> inc = income(g, p, m);
            pm.put("income", inc);
            Map<String, Integer> net = new LinkedHashMap<>(inc);          // after what the round takes: upkeep for wonders of earlier eras
            net.merge(Res.PRODUCTION.key(), -g.wonderUpkeep(p), Integer::sum);
            g.buildingUpkeep(p).forEach((r, amount) -> net.merge(r.key(), -amount, Integer::sum));
            for (Game.Route rt : g.routes) {
                if (rt.from() == p.seat) rt.give().forEach((r, n) -> net.merge(r.key(), -n, Integer::sum));
                if (rt.to() == p.seat) rt.get().forEach((r, n) -> net.merge(r.key(), n, Integer::sum));
            }
            pm.put("net", net);
            pm.put("incomeSources", incomeSources(g, p));
            pm.put("actionSources", actionSources(g, p));
            List<Object> bs = new ArrayList<>();
            for (Player.Building b : p.buildings) {
                Map<String, Object> bm = new LinkedHashMap<>();
                bm.put("id", b.id);
                bm.put("type", b.def.id);
                bm.put("name", b.def.name);
                bm.put("workers", b.workers);
                bm.put("slots", g.activeSlots(p, b));          // slots above what the land allows are inactive
                bm.put("inactive", b.slots - g.activeSlots(p, b));
                bm.put("level", b.level());
                // what the building makes each round as things stand (its workers, technologies and wonders included)
                Map<String, Integer> makes = new LinkedHashMap<>(), each = new LinkedHashMap<>();
                b.def.perWorker.forEach((r, n) -> each.merge(r.key(), n, Integer::sum));
                var bonus = m.perWorker.get(b.def.id);
                if (bonus != null) bonus.forEach((r, n) -> each.merge(r.key(), n, Integer::sum));
                each.forEach((r, n) -> { if (n * g.working(p, b) != 0) makes.put(r, n * g.working(p, b)); });
                bm.put("makes", makes);
                bm.put("each", each);
                bm.put("upgradeSlots", b.def.upgradeSlots);
                bm.put("upgrades", b.upgrades.stream().map(View::def).toList());
                bs.add(bm);
            }
            pm.put("buildings", bs);
            // researched techs and your minor wonders that make a building better, and are not in a slot yet
            List<Object> slotCards = new ArrayList<>();
            for (Content.CardDef c : g.slottable(p)) slotCards.add(def(c));
            pm.put("slotCards", slotCards);
            Map<String, Object> units = new LinkedHashMap<>();
            for (String k : List.of("warriors", "population")) {
                Map<String, Object> um = new LinkedHashMap<>();
                um.put("slots", g.content.rules.unitSlots.getOrDefault(k, 0));
                um.put("upgrades", (k.equals("warriors") ? p.warriorUpgrades : p.populationUpgrades).stream().map(View::def).toList());
                units.put(k, um);
            }
            pm.put("units", units);
            pm.put("techs", p.techs.stream().map(View::def).toList());
            if (p.leader != null) pm.put("leader", def(p.leader));
            if (p.pendingLeader != null) pm.put("pendingLeader", def(p.pendingLeader));
            pm.put("freeTech", g.freeTechAvailable(p));
            pm.put("wonderUpkeep", g.wonderUpkeep(p));
            pm.put("minorWonders", p.minorWonders.stream().map(View::def).toList());
            pm.put("hand", p.hand.stream().map(View::card).toList());          // a team game: everyone may look at the others' hands
            pm.put("done", p.done);
            pm.put("actions", p.actions);
            if (p.cheat) pm.put("cheat", true);
            if (p.seat == seat && g.phase == Game.Phase.TURNS) {
                pm.put("turnSeq", p.turnSeq);
                pm.put("turnEvents", p.turnEvents);
                if (p.turnDraw != null) pm.put("turnDraw", card(p.turnDraw));
                pm.put("faceDownSeq", p.faceDownSeq);
                if (p.faceDown != null) pm.put("faceDown", card(p.faceDown));
            }
            players.add(pm);
        }
        v.put("players", players);
        List<Object> lost = new ArrayList<>();
        for (Game.LostCard l : g.lostCards.subList(Math.max(0, g.lostCards.size() - 4), g.lostCards.size())) {
            Map<String, Object> lm = new LinkedHashMap<>();
            lm.put("seq", l.seq());
            lm.put("event", l.event());
            lm.put("card", def(l.card()));
            lost.add(lm);
        }
        v.put("lostCards", lost);

        if (seat >= 0 && seat < g.players.size()) {
            Player me = g.players.get(seat);
            List<Object> build = new ArrayList<>();
            for (BuildingDef b : g.content.buildings.values()) {
                if (!g.canBuild(b)) continue;
                Map<String, Object> bm = new LinkedHashMap<>();
                bm.put("id", b.id);
                bm.put("name", b.name);
                bm.put("cost", res(g.buildCost(me, b)));
                bm.put("owned", me.ofType(b.id) != null);
                int cap = g.capacity(me, b.id);
                bm.put("capacity", cap == Integer.MAX_VALUE ? null : cap);
                bm.put("slots", me.ofType(b.id) == null ? 0 : me.ofType(b.id).slots);
                bm.put("slotsAdded", b.slots);
                bm.put("perWorker", res(b.perWorker));
                bm.put("text", b.text);
                build.add(bm);
            }
            v.put("buildable", build);
        }
        Map<String, Object> rules = new LinkedHashMap<>();
        rules.put("growthCost", res(seat >= 0 && seat < g.players.size() ? g.growthCost(g.players.get(seat)) : g.content.rules.growthCost));
        rules.put("recruitCost", res(seat >= 0 && seat < g.players.size() ? g.recruitCost(g.players.get(seat)) : g.content.rules.recruitCost));
        v.put("rules", rules);

        if (g.pending != null) {
            Game.Pending pe = g.pending;
            Map<String, Object> pm = card(pe.event);
            pm.put("target", pe.target);
            pm.put("strength", pe.strength);
            pm.put("enemyCards", pe.enemyCards);
            pm.put("enemyFixed", pe.strength - pe.enemyCards.stream().mapToInt(Integer::intValue).sum());
            pm.put("ready", pe.ready);
            pm.put("troops", pe.troops);
            pm.put("responses", pe.responses);
            pm.put("defenseBonus", pe.defenseBonus);
            pm.put("healthBonus", pe.healthBonus);
            pm.put("halve", pe.halve);
            pm.put("cancel", pe.cancel);
            pm.put("accept", pe.accept);
            if (pe.event.def.effects.stream().anyMatch(e -> e.containsKey("wonderGift"))) {
                List<String> opts = new ArrayList<>();
                for (Res r : Res.values()) if (g.greatWonders.stream().anyMatch(w -> !w.done && w.def.cost(g.players.size()).get(r) > w.paid.get(r))) opts.add(r.key());
                pm.put("giftOptions", opts);
                pm.put("giftChoice", pe.giftChoice == null ? null : pe.giftChoice.key());
            }
            if (pe.event.def.offerCost != null && !Res.isZero(pe.event.def.offerCost)) pm.put("offerCost", res(pe.event.def.offerCost));
            pm.put("preview", preview(g, pe));
            v.put("pending", pm);
        }
        v.put("log", g.log.subList(Math.max(0, g.log.size() - 120), g.log.size()));
        return v;
    }

    /** A plain-language guess at what the pending event will do with the responses so far. */
    static String preview(Game g, Game.Pending pe) {
        CardDef d = pe.event.def;
        if (pe.cancel) return "It will be averted.";
        String half = pe.halve ? " (halved)" : "";
        return switch (d.kind) {
            case "raid" -> {
                Player t = g.players.get(pe.target);
                int def = g.fighting(t, Math.max(0, t.army - t.committed)) + g.mods(t).raidDefense + pe.defenseBonus;
                yield def >= pe.strength ? t.name + " will drive it off (defense " + def + " vs " + pe.strength + ")."
                        : t.name + " is " + (pe.strength - def) + " short (defense " + def + " vs " + pe.strength + ")" + half + ".";
            }
            case "invasion" -> {
                int sent = pe.troops.entrySet().stream().mapToInt(en -> g.fighting(g.players.get(en.getKey()), en.getValue())).sum() + pe.defenseBonus + g.civMods().invasionDefense;
                yield sent >= pe.strength ? "The defenders (" + sent + ") will hold against " + pe.strength + "."
                        : "Defenders " + sent + " vs strength " + pe.strength + ": " + (pe.strength - sent) + " short" + half + ".";
            }
            case "test" -> {
                int val = ("stability".equals(d.stat) ? g.stability : g.effectiveHealth()) + pe.healthBonus;
                yield val >= d.threshold ? "The civilization withstands it (" + d.stat + " " + val + " vs " + d.threshold + ")."
                        : d.stat + " " + val + " vs " + d.threshold + ": " + (d.threshold - val) + " short" + half + ".";
            }
            case "opportunity" -> g.players.get(pe.target).name + " decides: pay " + Res.describe(d.offerCost) + "?";
            default -> d.text + half;
        };
    }

    /** Where each resource per round comes from (and goes to): buildings, techs, wonders, great people, upkeep. */
    static Map<String, List<Object>> incomeSources(Game g, Player p) {
        Map<String, List<Object>> out = new LinkedHashMap<>();
        for (Res r : Res.values()) out.put(r.key(), new ArrayList<>());
        java.util.function.BiConsumer<String, Map<Res, Integer>> add = (from, amounts) -> amounts.forEach((r, n) -> {
            if (n == 0) return;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("from", from);
            m.put("n", n);
            out.get(r.key()).add(m);
        });
        for (Player.Building b : p.buildings) {
            int w = g.working(p, b);
            EnumMap<Res, Integer> made = Res.empty();
            b.def.perWorker.forEach((r, n) -> made.put(r, n * w));
            add.accept(b.def.name + " (" + w + " working)", made);
        }
        for (var src : g.effectSources(p)) {
            for (Map<String, Object> e : src.getValue()) {
                String k = e.keySet().iterator().next();
                Object v = e.get(k);
                if (k.equals("income")) add.accept(src.getKey(), Res.parse(v));
                else if (k.equals("incomePerTerritory")) {
                    EnumMap<Res, Integer> x = Res.parse(v);
                    x.replaceAll((r, n) -> n * g.realm.size());
                    add.accept(src.getKey() + " (" + g.realm.size() + " territories)", x);
                } else if (k.equals("perWorker")) {
                    Map<String, Object> mm = new LinkedHashMap<>(Y.map(v));
                    String building = String.valueOf(mm.remove("building"));
                    Player.Building b = p.ofType(building);
                    int w = b == null ? 0 : g.working(p, b);
                    EnumMap<Res, Integer> x = Res.parse(mm);
                    x.replaceAll((r, n) -> n * w);
                    add.accept(src.getKey() + " (" + w + " workers)", x);
                }
            }
        }
        EnumMap<Res, Integer> feed = Res.empty();
        feed.put(Res.FOOD, -(p.population() * g.content.rules.foodUpkeepPerPop));
        add.accept("Feeding " + p.population() + " people", feed);
        EnumMap<Res, Integer> troops = Res.empty();
        troops.put(Res.FOOD, -g.troopUpkeep(p));
        add.accept("Upkeep for troops", troops);
        EnumMap<Res, Integer> wonders = Res.empty();
        wonders.put(Res.PRODUCTION, -g.wonderUpkeep(p));
        add.accept("Upkeep for wonders of earlier eras", wonders);
        for (Player.Building b : p.buildings) {
            EnumMap<Res, Integer> up = Res.empty();
            b.def.upkeep.forEach((r, n) -> up.put(r, -n));
            add.accept("Upkeep: " + b.def.name, up);
        }
        for (Game.Route rt : g.routes) {
            if (rt.from() == p.seat) {
                EnumMap<Res, Integer> pay = Res.empty();
                rt.give().forEach((r, n) -> pay.put(r, -n));
                add.accept("Trading route to " + g.players.get(rt.to()).name, pay);
            }
            if (rt.to() == p.seat) add.accept("Trading route from " + g.players.get(rt.from()).name, rt.get());
        }
        return out;
    }

    /** Where a player's actions each round come from. */
    static List<Object> actionSources(Game g, Player p) {
        List<Object> out = new ArrayList<>();
        Map<String, Object> base = new LinkedHashMap<>();
        base.put("from", "Base");
        base.put("n", g.content.rules.actionsPerTurn);
        out.add(base);
        for (var src : g.effectSources(p)) {
            int n = 0;
            for (Map<String, Object> e : src.getValue()) if (e.containsKey("actionsPerTurn")) n += Y.toInt(e.get("actionsPerTurn"));
            if (n == 0) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("from", src.getKey());
            m.put("n", n);
            out.add(m);
        }
        return out;
    }

    static Map<String, Integer> income(Game g, Player p, Mods m) {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Res r : Res.values()) out.put(r.key(), m.income.get(r));
        for (Player.Building b : p.buildings) {
            int w = g.working(p, b);
            b.def.perWorker.forEach((r, n) -> out.merge(r.key(), n * w, Integer::sum));
            var bonus = m.perWorker.get(b.def.id);
            if (bonus != null) bonus.forEach((r, n) -> out.merge(r.key(), n * w, Integer::sum));
        }
        out.merge(Res.FOOD.key(), -(p.population() * g.content.rules.foodUpkeepPerPop + g.troopUpkeep(p)), Integer::sum);
        return out;
    }

    private static Map<String, Object> countByName(List<CardInst> cards) {
        Map<String, Object> m = new TreeMap<>();
        for (CardInst c : cards) m.merge(c.def.name, 1, (a, b) -> (Integer) a + (Integer) b);
        return m;
    }

    static Map<String, Object> territory(Game.Territory t) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", t.id);
        m.put("key", t.def.id);
        if (hasArt(t.def.id)) m.put("art", "cards/" + t.def.id + ".jpg");
        m.put("name", t.def.name);
        m.put("text", t.def.text);
        m.put("slots", t.def.slots);
        m.put("colonization", t.def.colonization);
        return m;
    }

    /** Every card, land and wonder in the game, for the "all cards" list (no state, just what they do). */
    public static Map<String, Object> catalogue(Content content) {
        Map<String, Object> out = new LinkedHashMap<>();
        List<Object> cards = new ArrayList<>();
        for (CardDef d : content.cards.values()) {
            if (d.helper) continue;
            Map<String, Object> m = def(d);
            m.put("era", d.era);
            int copies = 0;
            for (Content.EraDef e : content.eras) copies += e.cards.getOrDefault(d.id, 0);
            m.put("copies", copies);
            if (d.minPlayers > 1) m.put("minPlayers", d.minPlayers);
            cards.add(m);
        }
        out.put("cards", cards);
        // how many cards there are of each kind: different cards, copies in each era's list, and what a deck takes
        List<Object> counts = new ArrayList<>();
        Map<String, Integer> distinct = new LinkedHashMap<>();
        for (CardDef d : content.cards.values()) {
            if (d.helper) continue;
            distinct.merge(d.eraTrigger ? "era_trigger" : d.type.name().toLowerCase(), 1, Integer::sum);
        }
        for (Map.Entry<String, Integer> en : distinct.entrySet()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("kind", en.getKey());
            m.put("different", en.getValue());
            List<Object> perEra = new ArrayList<>();
            for (Content.EraDef e : content.eras) {
                int n = 0;
                for (Map.Entry<String, Integer> c : e.cards.entrySet()) {
                    CardDef d = content.cards.get(c.getKey());
                    if (d != null && en.getKey().equals(d.eraTrigger ? "era_trigger" : d.type.name().toLowerCase())) n += c.getValue();
                }
                Map<String, Object> pe = new LinkedHashMap<>();
                pe.put("era", e.name);
                pe.put("copies", n);
                perEra.add(pe);
            }
            m.put("eras", perEra);
            int[] rule = content.rules.eraDeck.get(en.getKey());
            if (rule != null) m.put("deck", Map.of("base", rule[0], "perPlayer", rule[1]));
            counts.add(m);
        }
        out.put("counts", counts);
        List<Object> lands = new ArrayList<>();
        for (Content.TerritoryDef t : content.territories.values()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", t.name);
            m.put("text", t.text);
            m.put("special", t.special);
            lands.add(m);
        }
        out.put("lands", lands);
        List<Object> wonders = new ArrayList<>();
        for (Content.WonderDef w : content.greatWonders.values()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", w.name);
            m.put("text", w.text);
            m.put("era", w.era);
            if (hasArt(w.id)) m.put("art", "cards/" + w.id + ".jpg");
            wonders.add(m);
        }
        out.put("wonders", wonders);
        List<Object> kws = new ArrayList<>();
        content.keywords.forEach((id, k) -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", id);
            m.put("name", Y.s(k, "name", id));
            m.put("match", Y.strings(k.get("match")));
            m.put("text", Y.s(k, "text", ""));
            kws.add(m);
        });
        out.put("keywords", kws);
        return out;
    }

    static Map<String, Object> card(CardInst c) {
        Map<String, Object> m = def(c.def);
        m.put("id", c.id);
        return m;
    }

    private static final Map<String, Boolean> ART = new java.util.concurrent.ConcurrentHashMap<>();

    /** True if there is a picture for this card in /dawn/cards/ (id.jpg). */
    static boolean hasArt(String id) {
        return ART.computeIfAbsent(id, k -> View.class.getResource("/META-INF/resources/dawn/cards/" + k + ".jpg") != null);
    }

    static Map<String, Object> def(CardDef d) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key", d.id);
        if (hasArt(d.id)) m.put("art", "cards/" + d.id + ".jpg");
        m.put("name", d.name);
        m.put("type", d.type.name().toLowerCase());
        m.put("text", d.text);
        if ((d.type == CardType.TECH || d.type == CardType.MINOR_WONDER) && (!d.bonus.isEmpty() || d.effects.stream().anyMatch(Effects::needsSlot))) m.put("slottable", true);
        if (!d.slotIn.isEmpty()) m.put("slotIn", d.slotIn);
        if (Stream.concat(d.effects.stream(), d.bonus.stream()).anyMatch(e -> Effects.UNIT_KEYS.contains(Effects.key(e)))) m.put("slotsInto", "warriors");
        if (!Res.isZero(d.cost)) m.put("cost", res(d.cost));
        if (d.isEvent()) {
            m.put("category", d.category);
            m.put("kind", d.kind);
            m.put("crisis", d.crisis);
            if (d.persistent) m.put("cleanse", res(d.cleanseCost));
        }
        if (!d.respondsTo.isEmpty()) m.put("respondsTo", d.respondsTo);
        for (Map<String, Object> e : d.effects) {
            if (e.get("population") instanceof Number n && n.intValue() > 0) m.put("population", true);
            if (e.containsKey("settle")) m.put("target", "land");
            if (e.containsKey("core")) m.put("target", "territory");
            if (e.containsKey("trade")) {
                m.put("target", "player");
                List<Object> opts = new ArrayList<>();
                for (Object o : (List<?>) e.get("trade")) {
                    Map<String, Object> om = Y.map(o), t = new LinkedHashMap<>();
                    t.put("give", res(Res.parse(om.get("give"))));
                    t.put("get", res(Res.parse(om.get("get"))));
                    opts.add(t);
                }
                m.put("trade", opts);
            }
        }
        return m;
    }

    static Map<String, Object> wonder(WonderDef w) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key", w.id);
        m.put("name", w.name);
        m.put("text", w.text);
        m.put("victoryPoints", w.victoryPoints);
        if (hasArt(w.id)) m.put("art", "cards/" + w.id + ".jpg");
        return m;
    }

    static Map<String, Integer> res(Map<Res, Integer> r) {
        Map<String, Integer> m = new LinkedHashMap<>();
        for (Res x : Res.values()) m.put(x.key(), r.getOrDefault(x, 0));
        return m;
    }
}
