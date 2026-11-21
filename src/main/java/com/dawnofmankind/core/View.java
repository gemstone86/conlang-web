package com.dawnofmankind.core;

import com.dawnofmankind.core.Content.BuildingDef;
import com.dawnofmankind.core.Content.CardDef;
import com.dawnofmankind.core.Content.WonderDef;
import com.dawnofmankind.core.Effects.Mods;
import com.dawnofmankind.core.Game.CardInst;
import com.dawnofmankind.core.Game.Slot;
import com.dawnofmankind.core.Game.WonderProgress;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
        v.put("round", g.round);
        v.put("era", g.era().name);
        v.put("eraIndex", g.eraIndex);
        v.put("eraCount", g.content.eras.size());
        v.put("firstPlayer", g.firstPlayer);
        v.put("currentPlayer", g.currentPlayer);
        v.put("actionsLeft", g.actionsLeft);
        v.put("stability", g.stability);
        v.put("health", g.health);
        v.put("threat", g.threat);
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
        v.put("freeSettlers", g.civMods().freeSettlers);

        List<Object> realm = new ArrayList<>();
        for (Game.Territory t : g.realm) {
            Map<String, Object> m = territory(t);
            m.put("wonders", t.wonders.stream().map(w -> w.name).toList());
            m.put("cored", t.cored);
            realm.add(m);
        }
        v.put("realm", realm);
        List<Object> frontier = new ArrayList<>();
        for (Game.Frontier f : g.frontier) {
            Map<String, Object> m = territory(f.land);
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
            pm.put("handSize", p.hand.size());
            pm.put("handLimit", g.handLimit(p));
            pm.put("giveCards", m.giveCards);
            pm.put("actionsPerTurn", g.content.rules.actionsPerTurn + m.actionsPerTurn);
            pm.put("away", p.away);
            pm.put("income", income(g, p, m));
            List<Object> bs = new ArrayList<>();
            for (Player.Building b : p.buildings) {
                Map<String, Object> bm = new LinkedHashMap<>();
                bm.put("id", b.id);
                bm.put("type", b.def.id);
                bm.put("name", b.def.name);
                bm.put("workers", b.workers);
                bm.put("slots", b.slots);
                bm.put("level", b.level());
                // what the building makes each round as things stand (its workers, technologies and wonders included)
                Map<String, Integer> makes = new LinkedHashMap<>(), each = new LinkedHashMap<>();
                b.def.perWorker.forEach((r, n) -> each.merge(r.key(), n, Integer::sum));
                var bonus = m.perWorker.get(b.def.id);
                if (bonus != null) bonus.forEach((r, n) -> each.merge(r.key(), n, Integer::sum));
                each.forEach((r, n) -> { if (n * b.workers != 0) makes.put(r, n * b.workers); });
                bm.put("makes", makes);
                bm.put("each", each);
                bs.add(bm);
            }
            pm.put("buildings", bs);
            pm.put("techs", p.techs.stream().map(View::def).toList());
            pm.put("minorWonders", p.minorWonders.stream().map(View::def).toList());
            if (p.seat == seat) pm.put("hand", p.hand.stream().map(View::card).toList());
            if (p.seat == seat && seat == g.currentPlayer && g.phase == Game.Phase.TURNS) {
                pm.put("turnSeq", g.turnSeq);
                pm.put("turnEvents", g.turnEvents);
                if (g.turnDraw != null) pm.put("turnDraw", card(g.turnDraw));
            }
            players.add(pm);
        }
        v.put("players", players);

        if (seat >= 0 && seat < g.players.size()) {
            Player me = g.players.get(seat);
            List<Object> build = new ArrayList<>();
            for (BuildingDef b : g.content.buildings.values()) {
                if (!b.buildable) continue;
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
        rules.put("recruitCost", res(g.content.rules.recruitCost));
        v.put("rules", rules);

        if (g.pending != null) {
            Game.Pending pe = g.pending;
            Map<String, Object> pm = card(pe.event);
            pm.put("target", pe.target);
            pm.put("strength", pe.strength);
            pm.put("ready", pe.ready);
            pm.put("troops", pe.troops);
            pm.put("responses", pe.responses);
            pm.put("defenseBonus", pe.defenseBonus);
            pm.put("healthBonus", pe.healthBonus);
            pm.put("halve", pe.halve);
            pm.put("cancel", pe.cancel);
            pm.put("accept", pe.accept);
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
                int def = g.strength(Math.max(0, t.army - t.committed)) + g.mods(t).raidDefense + pe.defenseBonus;
                yield def >= pe.strength ? t.name + " will drive it off (defense " + def + " vs " + pe.strength + ")."
                        : t.name + " is " + (pe.strength - def) + " short (defense " + def + " vs " + pe.strength + ")" + half + ".";
            }
            case "invasion" -> {
                int sent = pe.troops.values().stream().mapToInt(g::strength).sum() + pe.defenseBonus + g.civMods().invasionDefense;
                yield sent >= pe.strength ? "The defenders (" + sent + ") will hold against " + pe.strength + "."
                        : "Defenders " + sent + " vs strength " + pe.strength + ": " + (pe.strength - sent) + " short" + half + ".";
            }
            case "test" -> {
                int val = ("stability".equals(d.stat) ? g.stability : g.health) + pe.healthBonus;
                yield val >= d.threshold ? "The civilization withstands it (" + d.stat + " " + val + " vs " + d.threshold + ")."
                        : d.stat + " " + val + " vs " + d.threshold + ": " + (d.threshold - val) + " short" + half + ".";
            }
            case "opportunity" -> g.players.get(pe.target).name + " decides: pay " + Res.describe(d.offerCost) + "?";
            default -> d.text + half;
        };
    }

    static Map<String, Integer> income(Game g, Player p, Mods m) {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Res r : Res.values()) out.put(r.key(), m.income.get(r));
        for (Player.Building b : p.buildings) {
            b.def.perWorker.forEach((r, n) -> out.merge(r.key(), n * b.workers, Integer::sum));
            var bonus = m.perWorker.get(b.def.id);
            if (bonus != null) bonus.forEach((r, n) -> out.merge(r.key(), n * b.workers, Integer::sum));
        }
        out.merge(Res.FOOD.key(), -p.population() * g.content.rules.foodUpkeepPerPop, Integer::sum);
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
        m.put("name", t.def.name);
        m.put("text", t.def.text);
        m.put("slots", t.def.slots);
        m.put("colonization", t.def.colonization);
        return m;
    }

    static Map<String, Object> card(CardInst c) {
        Map<String, Object> m = def(c.def);
        m.put("id", c.id);
        return m;
    }

    static Map<String, Object> def(CardDef d) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key", d.id);
        m.put("name", d.name);
        m.put("type", d.type.name().toLowerCase());
        m.put("text", d.text);
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
                m.put("trade", e.get("trade"));
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
        return m;
    }

    static Map<String, Integer> res(Map<Res, Integer> r) {
        Map<String, Integer> m = new LinkedHashMap<>();
        for (Res x : Res.values()) m.put(x.key(), r.getOrDefault(x, 0));
        return m;
    }
}
