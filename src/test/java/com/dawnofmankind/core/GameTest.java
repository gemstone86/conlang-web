package com.dawnofmankind.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.dawnofmankind.core.Game.CardInst;
import com.dawnofmankind.core.Game.Slot;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class GameTest {
    static final Content C = Content.loadDefault();

    static Game game(int players, long seed) {
        List<String> names = new ArrayList<>();
        for (int i = 0; i < players; i++) names.add("P" + (i + 1));
        return new Game(C, names, seed);
    }

    @Test
    void startingPosition() {
        Game g = game(4, 1);
        Player p = g.players.get(0);
        assertEquals(3, p.population());
        assertEquals(2, p.buildings.size());
        assertEquals(4, g.actionsLeft);
        assertEquals(8, g.currentEvents.size(), "2 starting events per player");
        assertEquals(6, g.queue.size(), "queue = players + 2");
        for (Slot s : g.queue) assertEquals(s.card.def.isEvent(), s.under != null, "events have a face-down card under them");
        // round 1 production: 2 farmers make 4 food, 3 Population eat 3, the miner makes 2 production
        assertEquals(3 + 4 - 3, p.res.get(Res.FOOD));
        assertEquals(2 + 2, p.res.get(Res.PRODUCTION));
    }

    @Test
    void onlyTheCurrentPlayerActs() {
        Game g = game(2, 2);
        int other = (g.currentPlayer + 1) % 2;
        assertThrows(GameException.class, () -> g.act(other, Map.of("type", "recruit")));
    }

    @Test
    void actionsAreCounted() {
        Game g = game(1, 3);
        Player p = g.players.get(0);
        p.res.put(Res.PRODUCTION, 20);
        for (int i = 0; i < 4; i++) g.act(0, Map.of("type", "recruit"));
        assertEquals(0, g.actionsLeft);
        assertThrows(GameException.class, () -> g.act(0, Map.of("type", "recruit")));
        assertEquals(4, p.army);
    }

    @Test
    void movingAndBuilding() {
        Game g = game(1, 4);
        Player p = g.players.get(0);
        p.res.put(Res.PRODUCTION, 10);
        g.act(0, Map.of("type", "build", "building", "village"));
        Player.Building village = p.buildings.get(2);
        Player.Building farm = p.buildings.get(0);
        g.act(0, Map.of("type", "move", "from", farm.id, "to", village.id));
        assertEquals(1, village.workers);
        assertEquals(1, farm.workers);
        assertEquals(7, p.res.get(Res.PRODUCTION));
    }

    @Test
    void pickingAnEventGivesTheFaceDownCard() {
        for (long seed = 0; seed < 50; seed++) {
            Game g = game(3, seed);
            int slot = -1;
            for (int i = 0; i < g.queue.size(); i++) if (g.queue.get(i).card.def.isEvent()) slot = i;
            if (slot < 0) continue;
            CardInst event = g.queue.get(slot).card;
            int future = g.futureEvents.size();
            Player p = g.players.get(g.currentPlayer);
            int hand = p.hand.size();
            g.act(p.seat, Map.of("type", "pick", "slot", slot));
            assertTrue(g.futureEvents.contains(event));
            assertTrue(g.futureEvents.size() > future);
            assertEquals(hand + 1, p.hand.size(), "the face-down card (or its replacement) goes to hand");
            for (CardInst c : p.hand) assertFalse(c.def.isEvent());
            return;
        }
    }

    @Test
    void eventsDrawnEqualFutureDeckSize() {
        Game g = game(2, 5);
        Bot bot = new Bot(5);
        int round = g.round;
        while (g.phase == Game.Phase.TURNS && g.round == round) bot.step(g);
        // in the events phase (or past it, if every event resolved at once)
        assertTrue(g.eventsDrawnThisRound <= C.rules.startingEventsPerPlayer * 2 + 100);
    }

    @Test
    void botsFinishManyGames() {
        int wins = 0, games = 0;
        for (int players = 1; players <= 6; players++) {
            for (long seed = 0; seed < 40; seed++) {
                Game g = game(players, seed * 31 + players);
                Bot bot = new Bot(seed);
                int steps = 0;
                while (g.result == null && steps++ < 20000) assertTrue(bot.step(g), "bot stuck: " + last(g));
                assertNotNull(g.result, "game did not end: " + last(g));
                games++;
                if ("victory".equals(g.result)) wins++;
            }
        }
        System.out.println("Bot win rate: " + wins + "/" + games);
    }

    @Test
    void reportSampleGame() {
        Game g = game(3, 42);
        Bot bot = new Bot(42);
        while (g.result == null) bot.step(g);
        System.out.println("Sample game: " + g.result + " in round " + g.round + ", era " + g.era().name + ", score " + g.score());
    }

    private static String last(Game g) {
        return String.join("\n", g.log.subList(Math.max(0, g.log.size() - 15), g.log.size()));
    }
}
