package com.dawnofmankind.core;

import com.dawnofmankind.core.Content.CardType;
import com.dawnofmankind.core.Game.CardInst;
import com.dawnofmankind.core.Game.WonderProgress;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * A simple computer player: tries sensible moves in a fixed order and skips the ones the rules refuse. Used for AI
 * seats in a room and for the tests (bots playing whole games).
 */
public final class AiPlayer {
    private final Random rng;

    public AiPlayer(long seed) {
        rng = new Random(seed);
    }

    /** Makes one move for whoever needs to move. Returns false if nothing could be done. */
    public boolean step(Game g) {
        if (g.result != null) return false;
        if (g.phase == Game.Phase.STARVATION) { for (int seat : List.copyOf(g.starving.keySet())) { starveFor(g, seat); return true; } return false; }
        if (g.phase == Game.Phase.EVENTS) {
            for (Player p : g.players) if (respond(g, p)) return true;
            return false;
        }
        return stepFor(g, g.currentPlayer);
    }

    /** True if this seat has something to do now (its turn, or an event waiting for its response). */
    public static boolean needsToAct(Game g, int seat) {
        if (g.result != null) return false;
        if (g.phase == Game.Phase.STARVATION) return g.starving.containsKey(seat);
        if (g.phase == Game.Phase.EVENTS) return g.pending != null && !Boolean.TRUE.equals(g.pending.ready.get(seat));
        return g.phase == Game.Phase.TURNS && g.currentPlayer == seat;
    }

    /** Makes one move for this seat, if it needs to act. Returns false if it had nothing to do. */
    public boolean stepFor(Game g, int seat) {
        if (!needsToAct(g, seat)) return false;
        Player p = g.players.get(seat);
        if (g.phase == Game.Phase.STARVATION) { starveFor(g, seat); return true; }
        if (g.phase == Game.Phase.EVENTS) return respond(g, p);
        if (g.actionsLeft > 0 && takeAction(g, p)) return true;
        while (p.hand.size() > g.handLimit(p)) g.act(p.seat, Map.of("type", "discard", "card", p.hand.get(0).id));
        g.act(p.seat, Map.of("type", "endTurn"));
        return true;
    }

    /** The AI lets idle people starve first, then the building with the most workers. */
    private void starveFor(Game g, int seat) {
        Player p = g.players.get(seat);
        int need = g.starving.get(seat);
        Map<String, Object> lose = new HashMap<>();
        int idle = Math.min(need, p.idle);
        if (idle > 0) lose.put("idle", idle);
        int left = need - idle;
        java.util.Map<Integer, Integer> w = new java.util.HashMap<>();
        for (Player.Building b : p.buildings) w.put(b.id, b.workers);
        while (left > 0) {
            int best = -1;
            for (var e : w.entrySet()) if (e.getValue() > 0 && (best < 0 || e.getValue() > w.get(best))) best = e.getKey();
            if (best < 0) break;
            w.put(best, w.get(best) - 1);
            lose.merge(String.valueOf(best), 1, (x, y) -> (Integer) x + (Integer) y);
            left--;
        }
        if (!tryAct(g, p, Map.of("type", "starve", "lose", lose))) g.setAway(seat, true);
    }

    private boolean respond(Game g, Player p) {
        Game.Pending pe = g.pending;
        {
            if (pe == null || Boolean.TRUE.equals(pe.ready.get(p.seat))) return false;
            for (Game.Frontier f : List.copyOf(g.frontier)) {
                if (f.fromEvent && f.eventCard == pe.event.id) tryAct(g, p, landPay(g, p, f, Map.of("type", "colonize")));
            }
            for (CardInst c : List.copyOf(p.hand)) {
                if (c.def.type == CardType.RESPONSE && tryAct(g, p, Map.of("type", "respond", "card", c.id))) break;
            }
            if ("invasion".equals(pe.event.def.kind)) tryAct(g, p, Map.of("type", "troops", "troops", p.army - p.committed));
            if ("opportunity".equals(pe.event.def.kind) && pe.target == p.seat) tryAct(g, p, Map.of("type", "decide", "accept", true));
            g.act(p.seat, Map.of("type", "ready"));
            return true;
        }
    }

    private boolean takeAction(Game g, Player p) {
        // play techs, wonders and actions
        for (CardInst c : List.copyOf(p.hand)) {
            if (c.def.type == CardType.RESPONSE) continue;
            if (tryAct(g, p, Map.of("type", "play", "card", c.id))) return true;
            for (Game.Frontier f : g.frontier) {
                if (tryAct(g, p, landPay(g, p, f, Map.of("type", "play", "card", c.id)))) return true;
            }
            for (Game.Territory t : g.realm) {
                if (!t.cored && tryAct(g, p, Map.of("type", "play", "card", c.id, "territory", t.id))) return true;
            }
        }
        if (!g.persistentEvents.isEmpty() && tryAct(g, p, Map.of("type", "cleanse", "event", g.persistentEvents.get(0).id))) return true;
        // put idle people to work
        if (p.idle > 0) {
            for (Player.Building b : p.buildings) {
                if (b.workers < b.slots && tryAct(g, p, Map.of("type", "move", "from", "idle", "to", b.id))) return true;
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
            // paying toward a wonder is free: once per wonder per round, or the AI would pour everything in at once
            if (freeOnce(g, p, "w" + w.def.id) && tryAct(g, p, Map.of("type", "contribute", "wonder", w.def.id, "resources", m))) return true;
        }
        for (Game.Frontier f : g.frontier) {
            if (f.opened && freeOnce(g, p, "l" + f.land.id) && tryAct(g, p, landPay(g, p, f, Map.of("type", "colonize")))) return true;
        }
        if (!g.queue.isEmpty() && p.hand.size() < g.handLimit(p)) {
            return tryAct(g, p, Map.of("type", "pick", "slot", rng.nextInt(g.queue.size())));
        }
        return false;
    }

    /** Sends what the bot can spare toward a land. */
    private static Map<String, Object> landPay(Game g, Player p, Game.Frontier f, Map<String, Object> base) {
        Map<String, Object> m = new HashMap<>(base);
        Map<String, Object> res = new HashMap<>();
        EnumMap<Res, Integer> left = g.settleLeft(f);
        int pop = p.population();
        for (Res r : Res.values()) res.put(r.key(), Math.max(0, Math.min(left.get(r), p.res.get(r) - (r == Res.FOOD ? pop : 0))));
        m.put("resources", res);
        m.put("land", f.land.id);
        m.put("army", Math.max(0, Math.min(g.settleTroops(f) - f.troopsPaid, p.army - p.committed - 1)));
        m.put("population", pop > 4 ? Math.min(g.settleSettlers(f) - f.settlersPaid, pop - 4) : 0);
        return m;
    }

    private String pick(String... options) {
        return options[rng.nextInt(options.length)];
    }

    private static int countFarms(Player p) {
        return (int) p.buildings.stream().filter(b -> b.def.id.equals("farm")).count();
    }

    private final java.util.Set<String> freeDone = new java.util.HashSet<>();

    /** True the first time for this seat, round and thing (a free payment that takes no action). */
    private boolean freeOnce(Game g, Player p, String what) {
        return freeDone.add(System.identityHashCode(g) + ":" + g.round + ":" + p.seat + ":" + what);
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
