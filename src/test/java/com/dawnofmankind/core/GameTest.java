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
        assertEquals(8, g.queue.size(), "queue = players + 4");
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
        p.res.put(Res.FOOD, 10);
        g.act(0, Map.of("type", "build", "building", "village"));
        Player.Building village = p.buildings.get(2);
        Player.Building farm = p.buildings.get(0);
        g.act(0, Map.of("type", "move", "from", farm.id, "to", village.id));
        assertEquals(1, village.workers);
        assertEquals(1, farm.workers);
        assertEquals(7, p.res.get(Res.PRODUCTION));
    }

    @Test
    void realmStartsWithTwoTerritories() {
        Game g = game(3, 8);
        assertEquals(2, g.realm.size());
        for (Game.Territory t : g.realm) assertFalse(t.def.special);
    }

    @Test
    void invasionStrengthIsPlayersTimesTerritories() {
        assertEquals(10, C.cards.get("hill_tribes").strength(2, 5));
        assertEquals(10, C.cards.get("wandering_horde").strength(2, 5));
        assertEquals(4, C.cards.get("wandering_horde").strength(2, 2));
    }

    @Test
    void hostilityMassesEnemiesForTheNextInvasion() {
        Game g = game(2, 16);
        int before = g.threat;
        g.eraDeck.clear();
        g.eraDeck.add(card(g, "hostility_2"));
        g.eraDeck.add(card(g, "foraging"));
        g.eraDeck.add(card(g, "foraging"));
        Player p = g.players.get(g.currentPlayer);
        p.hand.add(card(g, "storytelling"));
        g.act(p.seat, Map.of("type", "play", "card", p.hand.get(p.hand.size() - 1).id)); // draws 2: reveals the hostility card
        assertEquals(before + 2, g.threat);
        for (Game.CardInst c : p.hand) assertFalse(c.def.type == Content.CardType.HOSTILITY, "hostility never stays in a hand");
    }

    @Test
    void aLongDayIsThreeMoreActionsSoTwoInAll() {
        Game g = game(1, 31);
        Player p = g.players.get(0);
        p.hand.add(card(g, "long_day"));
        int before = g.actionsLeft;
        g.act(0, Map.of("type", "play", "card", p.hand.get(p.hand.size() - 1).id));
        assertEquals(before + 2, g.actionsLeft);
    }

    @Test
    void aFreeColonyOpensALandFromTheWorldDeck() {
        Game g = game(1, 32);
        g.futureEvents.clear();
        g.futureEvents.add(card(g, "foraging"));
        g.currentEvents.clear();
        g.currentEvents.add(card(g, "free_colony"));
        int deck = g.worldDeck.size(), colonies = (int) g.frontier.stream().filter(f -> f.opened).count();
        g.act(0, Map.of("type", "endTurn"));
        assertEquals(colonies + 1, g.frontier.stream().filter(f -> f.opened).count());
        assertTrue(g.worldDeck.size() < deck);
    }

    @Test
    void techsAreGlobal() {
        Game g = game(2, 18);
        Player a = g.players.get(g.currentPlayer), b = g.players.get(1 - g.currentPlayer);
        Player.Building bMine = b.ofType("mine");
        int before = View.income(g, b, g.mods(b)).get("production");
        a.res.put(Res.RESEARCH, 10);
        a.res.put(Res.PRODUCTION, 10);
        Game.CardInst tools = card(g, "stone_tools");
        a.hand.add(tools);
        g.act(a.seat, Map.of("type", "play", "card", tools.id));
        assertEquals(before + bMine.workers, View.income(g, b, g.mods(b)).get("production"), "the other player's miners gain too");
    }

    @Test
    void bronzeWorkingAddsStrength() {
        Game g = game(2, 19);
        assertEquals(4, g.strength(4));
        g.players.get(0).techs.add(C.cards.get("bronze_working"));
        assertEquals(6, g.strength(4), "+1 per 2 troops");
        assertEquals(1, g.strength(1));
    }

    @Test
    void nomadicLivingGivesAFreeSettlerUntilTheEraEnds() {
        Game g = game(2, 20);
        Game.Frontier f = g.frontier.get(0);
        assertEquals(2, g.settleSettlers(f));
        g.builtWonders.add(C.greatWonders.get("nomadic_living"));
        assertEquals(1, g.settleSettlers(f));
        g.eraIndex = 1;
        assertEquals(2, g.settleSettlers(f), "obsolete in the Ancient era");
    }

    @Test
    void cardsCanOnlyBeGivenWithRomanRoads() {
        Game g = game(2, 21);
        Player p = g.players.get(g.currentPlayer);
        Player other = g.players.get(1 - p.seat);
        p.hand.add(card(g, "foraging"));
        p.hand.add(card(g, "irrigation"));
        int a = p.hand.get(p.hand.size() - 2).id, b = p.hand.get(p.hand.size() - 1).id;
        assertThrows(GameException.class, () -> g.act(p.seat, Map.of("type", "giveCards", "to", other.seat, "cards", List.of(a))));
        p.minorWonders.add(C.cards.get("roman_roads"));
        int before = other.hand.size();
        g.act(p.seat, Map.of("type", "giveCards", "to", other.seat, "cards", List.of(a, b)));
        assertEquals(before + 2, other.hand.size());
        assertEquals(3, g.actionsLeft, "1 action for both cards");
    }

    @Test
    void seaPeoplesRaidEveryoneThenInvade() {
        Game g = game(2, 22);
        AiPlayer bot = new AiPlayer(1);
        // put the crisis on top of the event deck and make sure one event is drawn this round
        g.currentEvents.add(0, card(g, "sea_peoples"));
        g.futureEvents.add(card(g, "good_hunt"));
        int round = g.round;
        while (g.round == round && g.result == null) bot.step(g);
        assertTrue(g.log.stream().anyMatch(l -> l.contains("Sea Peoples' Raid strike every player")), String.join("\n", g.log));
        boolean invaded = false;
        while (g.round == round + 1 && g.result == null) {
            bot.step(g);
            if (g.pending != null && g.pending.event.def.id.equals("sea_peoples_invasion")) invaded = true;
        }
        assertTrue(invaded || g.result != null, "the second round brings the invasion");
    }

    @Test
    void nomadEmpireMassesEnemies() {
        Game g = game(1, 23);
        AiPlayer bot = new AiPlayer(2);
        g.currentEvents.add(0, card(g, "nomad_empire"));
        g.futureEvents.add(card(g, "good_hunt"));
        int round = g.round;
        while (g.round == round && g.result == null) bot.step(g);
        assertEquals(1, g.crises.size());
        assertTrue(g.crises.get(0).roundsDone == 1);
    }

    @Test
    void resourcesOnlyTravelByTradingRoute() {
        Game g = game(2, 24);
        Player p = g.players.get(g.currentPlayer);
        Player other = g.players.get(1 - p.seat);
        p.res.put(Res.FOOD, 10);
        p.res.put(Res.CULTURE, 5);
        assertThrows(GameException.class, () -> g.act(p.seat, Map.of("type", "give", "to", other.seat, "resources", Map.of("food", 1))));
        Game.CardInst route = card(g, "new_trading_route");
        p.hand.add(route);
        assertThrows(GameException.class, () -> g.act(p.seat, Map.of("type", "play", "card", route.id, "to", other.seat, "resources", Map.of("culture", 1))),
                "culture can't travel the route");
        int before = other.res.get(Res.FOOD);
        g.act(p.seat, Map.of("type", "play", "card", route.id, "to", other.seat, "resources", Map.of("food", 6)));
        assertEquals(before + 6, other.res.get(Res.FOOD));
        assertEquals(4, p.res.get(Res.FOOD));
    }

    @Test
    void territoriesScore() {
        Game g = game(1, 17);
        assertEquals(g.realm.size(), g.score());
        g.builtWonders.add(C.greatWonders.get("nomadic_living"));
        assertEquals(g.realm.size() + 1, g.score());
    }

    @Test
    void growthGetsDearer() {
        Game g = game(1, 9);
        Player p = g.players.get(0);
        assertEquals(3, g.growthCost(p).get(Res.FOOD), "3 people: base cost");
        p.idle += 2; // 5 people: 4 beyond the first
        assertEquals(4, g.growthCost(p).get(Res.FOOD));
        p.idle += 4; // 9 people
        assertEquals(5, g.growthCost(p).get(Res.FOOD));
    }

    @Test
    void landLimitsFarmsAndLosingItShrinksThem() {
        Game g = game(1, 10);
        Player p = g.players.get(0);
        p.res.put(Res.PRODUCTION, 50);
        Player.Building farm = p.ofType("farm");
        int cap = g.capacity(p, "farm");
        while (farm.slots < cap) g.act(0, Map.of("type", "build", "building", "farm"));
        assertThrows(GameException.class, () -> g.act(0, Map.of("type", "build", "building", "farm")));
        // building levels get dearer
        assertTrue(g.buildCost(p, C.buildings.get("farm")).get(Res.PRODUCTION) > 2 || cap == 2);
        // lose every territory that gives farm slots: the farm shrinks back to the home slots
        for (Game.Territory t : List.copyOf(g.realm)) {
            if (t.def.slots.getOrDefault("farm", 0) > 0 && g.realm.size() > 1) {
                g.realm.remove(t);
            }
        }
        assertTrue(g.capacity(p, "farm") <= cap);
    }

    @Test
    void settleCardOpensALandThenAnyonePays() {
        Game g = game(2, 11);
        assertEquals(2, g.frontier.size(), "two lands face up at the start");
        Player p = g.players.get(g.currentPlayer);
        Game.Frontier f = g.frontier.get(0);
        f.enemy = 4;
        assertThrows(GameException.class, () -> g.act(p.seat, Map.of("type", "colonize", "land", f.land.id, "resources", Map.of("food", 1))),
                "not open yet");
        Game.CardInst s1 = card(g, "settle_land");
        p.hand.add(s1);
        p.army = 2;
        g.act(p.seat, Map.of("type", "play", "card", s1.id, "land", f.land.id, "army", 2));
        assertTrue(f.opened);
        assertEquals(2, g.frontier.stream().filter(x -> !x.fromEvent && !x.opened).count(), "a new face-up land replaces the colony");
        assertEquals(2, f.troopsPaid);
        assertEquals(1, p.army, "half of the 2 troops sent are lost");
        // later payments need no card, 1 action each
        p.res.put(Res.FOOD, 50);
        p.res.put(Res.PRODUCTION, 50);
        p.army = 5;
        p.idle += 5;
        int actions = g.actionsLeft;
        Map<String, Object> all = new java.util.HashMap<>();
        for (Res r : Res.values()) all.put(r.key(), 50);
        g.act(p.seat, Map.of("type", "colonize", "land", f.land.id, "resources", all, "army", 5, "population", 5));
        assertEquals(actions - 1, g.actionsLeft);
        assertEquals(3, g.realm.size());
        assertEquals(4, p.army, "only the missing 2 troops were sent, 1 lost");
        assertEquals(2, g.frontier.size(), "the colony is settled; two face-up lands remain");
    }

    @Test
    void scoutedLandsStayFaceUp() {
        Game g = game(2, 13);
        Player p = g.players.get(g.currentPlayer);
        p.res.put(Res.FOOD, 10);
        Game.CardInst scouts = card(g, "send_scouts");
        p.hand.add(scouts);
        g.act(p.seat, Map.of("type", "play", "card", scouts.id));
        assertEquals(3, g.frontier.size());
        assertTrue(g.frontier.stream().noneMatch(f -> f.fromEvent), "a scouted land is face up, not an event land");
        assertThrows(GameException.class, () -> g.act(p.seat, Map.of("type", "colonize", "land", g.frontier.get(2).land.id, "resources", Map.of("food", 1))),
                "face-up lands need a Settle card");
    }

    @Test
    void coredTerritoryHoldsOnce() {
        Game g = game(1, 12);
        Player p = g.players.get(0);
        p.res.put(Res.PRODUCTION, 10);
        p.res.put(Res.CULTURE, 10);
        Game.Territory t = g.realm.get(0);
        Game.CardInst core = card(g, "core_territory");
        p.hand.add(core);
        g.act(0, Map.of("type", "play", "card", core.id, "territory", t.id));
        assertTrue(t.cored);
    }

    static Game.CardInst card(Game g, String id) {
        return new Game.CardInst(100_000 + id.hashCode() % 1000, C.cards.get(id));
    }

    @Test
    void greatWondersGoOnTheBoard() {
        Game g = game(2, 7);
        Player p = g.players.get(g.currentPlayer);
        g.greatWonders.clear();
        Game.CardInst w = card(g, "stonehenge");
        g.queue.add(0, new Game.Slot(w, null));
        g.act(p.seat, Map.of("type", "pick", "slot", 0));
        assertEquals(1, g.greatWonders.size());
        assertFalse(p.hand.contains(w));
    }

    @Test
    void greatLighthouse() {
        Game g = game(2, 14);
        Player p = g.players.get(g.currentPlayer);
        g.greatWonders.clear();
        g.queue.add(0, new Game.Slot(card(g, "great_lighthouse"), null));
        g.act(p.seat, Map.of("type", "pick", "slot", 0));
        int prodBefore = g.settleCost(g.frontier.get(0)).get(Res.PRODUCTION);
        for (Res r : Res.values()) p.res.put(r, 100);
        g.act(p.seat, Map.of("type", "contribute", "wonder", "great_lighthouse", "resources", Map.of("production", 100, "food", 100)));
        assertEquals(1, g.builtWonders.size());
        assertEquals(3, g.frontier.stream().filter(f -> !f.fromEvent).count(), "one more face-up land");
        assertEquals(Math.max(0, prodBefore - 2), g.settleCost(g.frontier.get(0)).get(Res.PRODUCTION));
        assertEquals(1, g.realm.stream().filter(t -> t.cored).count(), "it cores a territory");
    }

    @Test
    void idlePeopleFillNewSlots() {
        Game g = game(1, 15);
        Player p = g.players.get(0);
        p.res.put(Res.PRODUCTION, 10);
        p.idle = 3;
        g.act(0, Map.of("type", "build", "building", "temple"));
        assertEquals(2, p.ofType("temple").workers);
        assertEquals(1, p.idle);
    }

    @Test
    void buildingAgainAddsSlots() {
        Game g = game(1, 6);
        Player p = g.players.get(0);
        p.res.put(Res.PRODUCTION, 10);
        Player.Building farm = p.ofType("farm");
        g.act(0, Map.of("type", "build", "building", "farm"));
        assertEquals(2, p.buildings.size(), "still one farm and one mine");
        assertEquals(4, farm.slots);
        assertEquals(2, farm.level());
        g.act(0, Map.of("type", "grow"));
        assertEquals(3, farm.workers, "new Population fills the new slot");
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
            int got = p.hand.size() + g.greatWonders.size();
            g.act(p.seat, Map.of("type", "pick", "slot", slot));
            assertTrue(g.futureEvents.contains(event));
            assertTrue(g.futureEvents.size() > future);
            assertEquals(got + 1, p.hand.size() + g.greatWonders.size(), "the face-down card (or its replacement) goes to hand, or a wonder to the board");
            for (CardInst c : p.hand) assertFalse(c.def.isEvent());
            return;
        }
    }

    @Test
    void eventsDrawnEqualFutureDeckSize() {
        Game g = game(2, 5);
        AiPlayer bot = new AiPlayer(5);
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
                AiPlayer bot = new AiPlayer(seed);
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
        AiPlayer bot = new AiPlayer(42);
        while (g.result == null) bot.step(g);
        System.out.println("Sample game: " + g.result + " in round " + g.round + ", era " + g.era().name + ", score " + g.score());
    }

    private static String last(Game g) {
        return String.join("\n", g.log.subList(Math.max(0, g.log.size() - 15), g.log.size()));
    }
}
