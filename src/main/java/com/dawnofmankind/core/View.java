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
            m.put("slot", i);
            m.put("faceDown", s.under != null);
            queue.add(m);
        }
        v.put("queue", queue);

        v.put("eventDeck", g.currentEvents.size());
        v.put("eventDeckContents", countByName(g.currentEvents));
        v.put("futureEvents", g.futureEvents.stream().map(View::card).toList());
        v.put("pastEvents", g.pastEvents.stream().map(View::card).toList().reversed());
        v.put("persistentEvents", g.persistentEvents.stream().map(View::card).toList());
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
        v.put("builtWonders", g.builtWonders.stream().map(View::wonder).toList());

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
                bm.put("slots", b.def.slots);
                bs.add(bm);
            }
            pm.put("buildings", bs);
            pm.put("techs", p.techs.stream().map(View::def).toList());
            pm.put("minorWonders", p.minorWonders.stream().map(View::def).toList());
            if (p.seat == seat) pm.put("hand", p.hand.stream().map(View::card).toList());
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
                bm.put("perWorker", res(b.perWorker));
                bm.put("text", b.text);
                build.add(bm);
            }
            v.put("buildable", build);
        }
        Map<String, Object> rules = new LinkedHashMap<>();
        rules.put("growthCost", res(g.content.rules.growthCost));
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
                int def = Math.max(0, t.army - t.committed) + g.mods(t).raidDefense + pe.defenseBonus;
                yield def >= pe.strength ? t.name + " will drive it off (defense " + def + " vs " + pe.strength + ")."
                        : t.name + " is " + (pe.strength - def) + " short (defense " + def + " vs " + pe.strength + ")" + half + ".";
            }
            case "invasion" -> {
                int sent = pe.troops.values().stream().mapToInt(Integer::intValue).sum() + pe.defenseBonus;
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
