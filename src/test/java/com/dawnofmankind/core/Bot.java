package com.dawnofmankind.core;

import com.dawnofmankind.core.Content.CardType;
import com.dawnofmankind.core.Game.CardInst;
import com.dawnofmankind.core.Game.WonderProgress;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/** A simple player for tests: tries sensible actions in order and ignores the ones the rules refuse. */
final class Bot {
    private final Random rng;

    Bot(long seed) {
        rng = new Random(seed);
    }

    /** Makes one move for whoever needs to move. Returns false if nothing could be done. */
    boolean step(Game g) {
        if (g.result != null) return false;
        if (g.phase == Game.Phase.EVENTS) return respond(g);
        Player p = g.players.get(g.currentPlayer);
        if (g.actionsLeft > 0 && takeAction(g, p)) return true;
        while (p.hand.size() > g.handLimit(p)) g.act(p.seat, Map.of("type", "discard", "card", p.hand.get(0).id));
        g.act(p.seat, Map.of("type", "endTurn"));
        return true;
    }

    private boolean respond(Game g) {
        Game.Pending pe = g.pending;
        for (Player p : g.players) {
            if (Boolean.TRUE.equals(pe.ready.get(p.seat))) continue;
            for (CardInst c : List.copyOf(p.hand)) {
                if (c.def.type == CardType.RESPONSE && tryAct(g, p, Map.of("type", "respond", "card", c.id))) break;
            }
            if ("invasion".equals(pe.event.def.kind)) tryAct(g, p, Map.of("type", "troops", "troops", p.army - p.committed));
            if ("opportunity".equals(pe.event.def.kind) && pe.target == p.seat) tryAct(g, p, Map.of("type", "decide", "accept", true));
            g.act(p.seat, Map.of("type", "ready"));
            return true;
        }
        return false;
    }

    private boolean takeAction(Game g, Player p) {
        // play techs, wonders and actions
        for (CardInst c : List.copyOf(p.hand)) {
            if (c.def.type != CardType.RESPONSE && tryAct(g, p, Map.of("type", "play", "card", c.id))) return true;
        }
        if (!g.persistentEvents.isEmpty() && tryAct(g, p, Map.of("type", "cleanse", "event", g.persistentEvents.get(0).id))) return true;
        // put idle people to work
        if (p.idle > 0) {
            for (Player.Building b : p.buildings) {
                if (b.workers < b.def.slots && tryAct(g, p, Map.of("type", "move", "from", "idle", "to", b.id))) return true;
            }
        }
        int food = p.res.get(Res.FOOD), pop = p.population();
        if (food >= 3 + pop && p.freeSlots() > 0 && tryAct(g, p, Map.of("type", "grow"))) return true;
        if (p.freeSlots() == 0) {
            String b = countFarms(p) * 2 * 2 < pop + 3 ? "farm" : pick("village", "temple", "mine", "farm");
            if (tryAct(g, p, Map.of("type", "build", "building", b))) return true;
        }
        if (p.army < 2 && tryAct(g, p, Map.of("type", "recruit"))) return true;
        for (WonderProgress w : g.greatWonders) {
            if (w.done) continue;
            EnumMap<Res, Integer> give = Res.empty();
            for (Res r : Res.values()) give.put(r, Math.max(0, Math.min(p.res.get(r) - (r == Res.FOOD ? pop : 0), 3)));
            Map<String, Object> m = new HashMap<>();
            for (Res r : Res.values()) m.put(r.key(), give.get(r));
            if (tryAct(g, p, Map.of("type", "contribute", "wonder", w.def.id, "resources", m))) return true;
        }
        if (!g.queue.isEmpty() && p.hand.size() < g.handLimit(p)) {
            return tryAct(g, p, Map.of("type", "pick", "slot", rng.nextInt(g.queue.size())));
        }
        return false;
    }

    private String pick(String... options) {
        return options[rng.nextInt(options.length)];
    }

    private static int countFarms(Player p) {
        return (int) p.buildings.stream().filter(b -> b.def.id.equals("farm")).count();
    }

    private static boolean tryAct(Game g, Player p, Map<String, Object> a) {
        try {
            g.act(p.seat, a);
            return true;
        } catch (GameException e) {
            return false;
        }
    }
}
