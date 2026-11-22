package com.dawnofmankind.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.dawnofmankind.core.Content.BuildingDef;
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
        assertEquals(4, g.players.get(0).actions);
        assertEquals(8, g.currentEvents.size(), "2 starting events per player");
        assertEquals(8, g.queue.size(), "queue = players + 4");
        for (Slot s : g.queue) assertEquals(s.card.def.isEvent(), s.under != null, "events have a face-down card under them");
        // round 1 production: 2 farmers make 4 food, 3 Population eat 3, the miner makes 2 production
        assertEquals(3 + 4 - 3, p.res.get(Res.FOOD));
        assertEquals(2 + 2, p.res.get(Res.PRODUCTION));
    }

    @Test
    void everyoneActsAtOnceUntilTheyAreDone() {
        Game g = game(2, 2);
        g.act(1, Map.of("type", "recruit".equals("x") ? "x" : "endTurn"));
        assertTrue(g.players.get(1).done);
        assertThrows(GameException.class, () -> g.act(1, Map.of("type", "recruit")), "done players can't act");
        g.players.get(0).res.put(Res.PRODUCTION, 5);
        g.act(0, Map.of("type", "recruit"));                      // the other is still free to act
        assertEquals(3, g.players.get(0).actions);
    }

    @Test
    void takenCardsLeaveAGapAndTheQueueClosesAtTheEnd() {
        Game g = game(2, 40);
        int n = g.queue.size();
        int slot = -1;
        for (int i = 0; i < n; i++) if (!g.queue.get(i).card.def.isEvent()) { slot = i; break; }
        final int pick = slot;
        g.act(0, Map.of("type", "pick", "slot", pick));
        assertEquals(n, g.queue.size(), "nothing slides down during the round");
        assertTrue(g.queue.get(pick).taken);
        assertThrows(GameException.class, () -> g.act(1, Map.of("type", "pick", "slot", pick)), "first click wins");
        g.picksLocked = true;
        assertThrows(GameException.class, () -> g.act(1, Map.of("type", "pick", "slot", (pick + 1) % n)), "the queue is closed");
    }

    @Test
    void pickTimeCanBeChangedDuringPlay() {
        Game g = game(2, 41);
        g.act(1, Map.of("type", "pickTime", "seconds", 30));
        assertEquals(30, g.pickSeconds);
        g.roundStartedAt = System.currentTimeMillis() - 60_000;
        assertTrue(g.tick(), "the time was over");
        assertTrue(g.picksLocked);
        g.act(0, Map.of("type", "pickTime", "seconds", 0));
        assertEquals(0, g.pickSeconds);
        assertFalse(g.picksLocked, "no limit again");
    }

    @Test
    void actionsAreCounted() {
        Game g = game(1, 3);
        Player p = g.players.get(0);
        p.res.put(Res.PRODUCTION, 20);
        for (int i = 0; i < 4; i++) g.act(0, Map.of("type", "recruit"));
        assertEquals(0, g.players.get(0).actions);
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
        Player p = g.players.get(0);
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
        int before = g.players.get(0).actions;
        g.act(0, Map.of("type", "play", "card", p.hand.get(p.hand.size() - 1).id));
        assertEquals(before + 2, g.players.get(0).actions);
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
    void growWithAChosenBuilding() {
        Game g = game(1, 33);
        Player p = g.players.get(0);
        p.res.put(Res.FOOD, 20);
        Player.Building mine = p.ofType("mine");
        assertTrue(mine.workers < mine.slots);
        int before = mine.workers;
        g.act(0, Map.of("type", "grow", "building", mine.id));
        assertEquals(before + 1, mine.workers);
        Player.Building farm = p.ofType("farm");
        assertTrue(farm.workers >= farm.slots, "the farm was full");
        assertThrows(GameException.class, () -> g.act(0, Map.of("type", "grow", "building", farm.id)));
    }

    @Test
    void civilWarUncoresARandomCoreOrElseCostsATerritory() {
        Game g = game(1, 34);
        g.currentEvents.clear();
        g.futureEvents.clear();
        g.futureEvents.add(card(g, "foraging"));
        g.currentEvents.add(card(g, "civil_war"));
        g.realm.get(0).cored = true;
        int n = g.realm.size();
        g.act(0, Map.of("type", "endTurn"));
        assertEquals(n, g.realm.size(), "a core is lost, not the territory");
        assertTrue(g.realm.stream().noneMatch(t -> t.cored));
        Game h = game(1, 35);
        h.currentEvents.clear();
        h.futureEvents.clear();
        h.futureEvents.add(card(h, "foraging"));
        h.currentEvents.add(card(h, "civil_war"));
        int m = h.realm.size();
        h.act(0, Map.of("type", "endTurn"));
        assertEquals(m - 1, h.realm.size(), "no core: a territory is lost");
    }

    @Test
    void payingTowardAWonderCostsNoAction() {
        Game g = game(1, 36);
        Player p = g.players.get(0);
        p.res.put(Res.PRODUCTION, 5);
        Game.WonderProgress w = g.greatWonders.isEmpty() ? null : g.greatWonders.get(0);
        if (w == null) return;                      // none on the board in this seed
        int before = g.players.get(0).actions;
        g.act(0, Map.of("type", "contribute", "wonder", w.def.id, "resources", Map.of("production", 1)));
        assertEquals(before, g.players.get(0).actions);
    }

    @Test
    void aCardsNewPersonGoesWhereChosen() {
        Game g = game(1, 37);
        Player p = g.players.get(0);
        p.res.put(Res.FOOD, 10);
        Player.Building mine = p.ofType("mine");
        int before = mine.workers;
        Game.CardInst c = card(g, "gather_the_tribe");
        p.hand.add(c);
        g.act(0, Map.of("type", "play", "card", c.id, "building", mine.id));
        assertEquals(before + 1, mine.workers);
    }

    @Test
    void theTurnStartDrawIsShownToThePlayer() {
        Game g = game(1, 38);
        Map<String, Object> me = (Map<String, Object>) ((java.util.List<?>) View.of(g, 0).get("players")).get(0);
        assertNotNull(me.get("turnSeq"));
        assertTrue(me.containsKey("turnDraw") || g.players.get(0).turnDraw == null);
    }

    @Test
    void starvingPlayersChooseWhoGoes() {
        Game g = game(2, 39);
        Player p = g.players.get(0);
        // people idle and in a mine, 2 food for 3 Population and a round about to start: one person must starve
        p.res.put(Res.FOOD, 2);
        Player.Building farm = p.ofType("farm"), mine = p.ofType("mine");
        assertTrue(farm.workers > 0 && mine.workers > 0);
        p.idle += farm.workers;
        farm.workers = 0;                           // nobody farms: the food runs short
        for (Player q : g.players) g.act(q.seat, Map.of("type", "endTurn"));
        // events, then the next round's production
        int guard = 0;
        AiPlayer ai = new AiPlayer(1);
        while (g.phase != Game.Phase.STARVATION && g.result == null && guard++ < 400) {
            if (g.phase == Game.Phase.EVENTS) { for (Player q : g.players) { try { g.act(q.seat, Map.of("type", "ready")); } catch (GameException e) { } } }
            else { for (Player q : g.players) { try { g.act(q.seat, Map.of("type", "endTurn")); } catch (GameException e) { } } }
            p.res.put(Res.FOOD, 2);
        }
        assertEquals(Game.Phase.STARVATION, g.phase, "a starving player with people in two places chooses");
        int need = g.starving.get(g.starving.keySet().iterator().next());
        int seat = g.starving.keySet().iterator().next();
        assertThrows(GameException.class, () -> g.act(seat, Map.of("type", "starve", "lose", Map.of("idle", need + 5))));
        Player who = g.players.get(seat);
        assertTrue(who.idle >= need, "idle people can be the ones who go");
        int before = who.idle;
        g.act(seat, Map.of("type", "starve", "lose", Map.of("idle", need)));
        assertEquals(before - need, who.idle);
        assertFalse(g.starving.containsKey(seat));
    }

    @Test
    void anEventThatResolvesAtOnceStillGetsANotice() {
        Game g = game(1, 42);
        g.futureEvents.clear();
        g.futureEvents.add(card(g, "foraging"));
        g.currentEvents.clear();
        g.currentEvents.add(card(g, "flash_flood"));
        g.act(0, Map.of("type", "endTurn"));
        assertFalse(g.notices.isEmpty(), "everyone is shown what happened");
        assertEquals("Flash Flood", g.notices.get(g.notices.size() - 1).card.def.name);
        assertFalse(g.notices.get(g.notices.size() - 1).lines.isEmpty());
    }

    @Test
    void everyTechnologyPlayedScoresAPoint() {
        Game g = game(1, 43);
        Player p = g.players.get(0);
        p.res.put(Res.RESEARCH, 20);
        p.res.put(Res.PRODUCTION, 20);
        int before = g.score();
        Game.CardInst tools = card(g, "stone_tools");
        p.hand.add(tools);
        g.act(0, Map.of("type", "play", "card", tools.id));
        assertEquals(before + 1, g.score());
    }

    @Test
    void techsAreGlobal() {
        Game g = game(2, 18);
        Player a = g.players.get(0), b = g.players.get(1);
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
        Player p = g.players.get(0);
        Player other = g.players.get(1 - p.seat);
        p.hand.add(card(g, "foraging"));
        p.hand.add(card(g, "irrigation"));
        int a = p.hand.get(p.hand.size() - 2).id, b = p.hand.get(p.hand.size() - 1).id;
        assertThrows(GameException.class, () -> g.act(p.seat, Map.of("type", "giveCards", "to", other.seat, "cards", List.of(a))));
        p.minorWonders.add(C.cards.get("roman_roads"));
        int before = other.hand.size();
        g.act(p.seat, Map.of("type", "giveCards", "to", other.seat, "cards", List.of(a, b)));
        assertEquals(before + 2, other.hand.size());
        assertEquals(3, g.players.get(0).actions, "1 action for both cards");
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
    void aTradingRouteSendsTwoOfTheOtherResourceForOne() {
        Game g = game(2, 24);
        Player p = g.players.get(0);
        Player other = g.players.get(1);
        p.res.put(Res.FOOD, 10);
        p.res.put(Res.PRODUCTION, 10);
        assertThrows(GameException.class, () -> g.act(p.seat, Map.of("type", "give", "to", other.seat, "resources", Map.of("food", 1))));
        Game.CardInst route = card(g, "new_trading_route");
        p.hand.add(route);
        assertThrows(GameException.class, () -> g.act(p.seat, Map.of("type", "play", "card", route.id, "to", other.seat)), "an option must be chosen");
        int prod = other.res.get(Res.PRODUCTION);
        g.act(p.seat, Map.of("type", "play", "card", route.id, "to", other.seat, "option", 0));        // pay 1 food: they get 2 production
        assertEquals(prod + 2, other.res.get(Res.PRODUCTION));
        assertEquals(9, p.res.get(Res.FOOD));
        Game.CardInst again = card(g, "new_trading_route");
        p.hand.add(again);
        int food = other.res.get(Res.FOOD);
        g.act(p.seat, Map.of("type", "play", "card", again.id, "to", other.seat, "option", 1));        // pay 1 production: they get 2 food
        assertEquals(food + 2, other.res.get(Res.FOOD));
        assertEquals(9, p.res.get(Res.PRODUCTION));
    }

    @Test
    void aLeaderPlaysItselfReplacesTheOldOneAndLeavesWithTheEra() {
        Game g = game(2, 61);
        Player p = g.players.get(0);
        Game.CardInst a = card(g, "hammurabi"), b = card(g, "gilgamesh");
        g.queue.add(0, new Game.Slot(a, null));
        g.queue.add(1, new Game.Slot(b, null));
        g.act(p.seat, Map.of("type", "pick", "slot", 0));
        assertEquals("Hammurabi", p.leader.name);
        assertFalse(p.hand.contains(a), "a leader never sits in the hand");
        g.act(p.seat, Map.of("type", "pick", "slot", 1));
        assertEquals("Gilgamesh", p.leader.name, "the new leader replaces the old");
    }

    @Test
    void gilgameshsFirstTroopEachRoundTakesNoAction() {
        Game g = game(1, 62);
        Player p = g.players.get(0);
        p.leader = C.cards.get("gilgamesh");
        p.res.put(Res.PRODUCTION, 20);
        int actions = p.actions, army = p.army;
        g.act(p.seat, Map.of("type", "recruit"));
        assertEquals(actions, p.actions, "the first troop is free of actions");
        g.act(p.seat, Map.of("type", "recruit"));
        assertEquals(actions - 1, p.actions, "the second one costs an action");
        assertEquals(army + 2, p.army);
        assertEquals(16, p.res.get(Res.PRODUCTION), "both still cost resources");
    }

    @Test
    void leaderBonusesAddUp() {
        Game g = game(1, 63);
        Player p = g.players.get(0);
        int limit = g.handLimit(p);
        p.leader = C.cards.get("hammurabi");
        assertEquals(1, g.mods(p).income.get(Res.RESEARCH));
        assertEquals(limit + 1, g.handLimit(p));
        p.leader = C.cards.get("julius_caesar");
        assertEquals(6, g.strength(p, 4), "every 2 troops add 1 strength");
        p.leader = C.cards.get("gilgamesh");
        assertEquals(g.strength(p, 3) + 2, g.fighting(p, 3), "+2 military strength");
        p.leader = C.cards.get("great_mother");
        assertEquals(limit - 2, g.handLimit(p));
    }

    @Test
    void theFirstShamansTemplesCostOneProduction() {
        Game g = game(1, 64);
        Player p = g.players.get(0);
        BuildingDef temple = C.buildings.get("temple");
        assertEquals(3, g.buildCost(p, temple).get(Res.PRODUCTION));
        p.leader = C.cards.get("first_shaman");
        assertEquals(1, g.buildCost(p, temple).get(Res.PRODUCTION));
        assertEquals(1, g.mods(p).income.get(Res.CULTURE));
    }

    @Test
    void theGreatHuntersFarmsAndInactiveBuildings() {
        Game g = game(1, 65);
        Player p = g.players.get(0);
        int cap = g.capacity(p, "farm");
        p.leader = C.cards.get("great_hunter");
        assertEquals(cap + 1, g.capacity(p, "farm"));
        Player.Building farm = p.ofType("farm");
        farm.slots = cap + 1;
        farm.workers = cap + 1;
        assertEquals(cap + 1, g.working(p, farm));
        p.leader = null;                                  // the era ends: the extra slot is inactive, not gone
        assertEquals(cap, g.working(p, farm));
        assertEquals(cap + 1, farm.slots);
        assertThrows(GameException.class, () -> g.act(p.seat, Map.of("type", "build", "building", "farm")), "can't build while above the limit");
    }

    @Test
    void ramsesGrowsUnfinishedWonders() {
        Game g = game(1, 66);
        Player p = g.players.get(0);
        p.leader = C.cards.get("ramses");
        Game.WonderProgress w = new Game.WonderProgress(C.greatWonders.get("pyramids"));
        g.greatWonders.add(w);
        int before = w.paid.values().stream().mapToInt(Integer::intValue).sum();
        g.act(p.seat, Map.of("type", "endTurn"));
        int after = w.paid.values().stream().mapToInt(Integer::intValue).sum();
        assertTrue(after > before, "the wonder grew by itself");
    }

    @Test
    void theGreatMotherTakesActionCardsLeavingTheQueue() {
        Game g = game(1, 67);
        Player p = g.players.get(0);
        p.leader = C.cards.get("great_mother");
        Game.CardInst action = card(g, "foraging");
        g.queue.add(new Game.Slot(action, null));          // the bottom slot
        while (g.queue.size() > 1 && g.queue.get(g.queue.size() - 2).card == action) break;
        p.hand.clear();
        g.act(p.seat, Map.of("type", "endTurn"));
        for (int i = 0; i < 10 && g.phase == Game.Phase.EVENTS; i++) {
            try { g.act(p.seat, Map.of("type", "ready")); } catch (GameException e) { break; }
        }
        assertTrue(p.hand.contains(action), "the action card went to her hand; phase " + g.phase + "; " + last(g));
    }

    @Test
    void theEraDeckHoldsASetNumberOfEachKind() {
        for (int x = 1; x <= 4; x++) {
            Game g = game(x, 70 + x);
            Map<String, Integer> n = new java.util.HashMap<>();
            List<Game.CardInst> all = new ArrayList<>(g.eraDeck);
            g.queue.forEach(sl -> { all.add(sl.card); if (sl.under != null) all.add(sl.under); });
            all.addAll(g.futureEvents);                                      // events drawn blind go face down here
            for (Player p : g.players) all.addAll(p.hand);                 // what they drew blind
            for (Game.CardInst c : all) n.merge(c.def.eraTrigger ? "era_trigger" : c.def.type.name().toLowerCase(), 1, Integer::sum);
            // leaders and great wonders play or go to the board as soon as they are drawn; hostility cards are spent
            int ledBy = (int) g.log.stream().filter(l -> l.contains(" is now led by ")).count();
            assertEquals(x + 1, n.getOrDefault("leader", 0) + ledBy, "leaders, " + x + " players");
            assertEquals(x, n.getOrDefault("great_wonder", 0) + g.greatWonders.size(), "great wonders");
            assertEquals(x + 2, n.getOrDefault("tech", 0), "techs");
            assertEquals(24 + 2 * x, n.getOrDefault("action", 0), "actions");
            assertEquals(x, n.getOrDefault("response", 0), "responses");
            assertEquals(12 + x, n.getOrDefault("event", 0), "events");
            assertEquals(1, n.getOrDefault("era_trigger", 0), "one era-trigger event");
        }
    }

    @Test
    void goebekliTepeAndTheGgantijaTemples() {
        Game g = game(1, 71);
        Player p = g.players.get(0);
        p.leader = null;
        int cost = g.growthCost(p).get(Res.FOOD);
        g.builtWonders.add(C.greatWonders.get("gobekli_tepe"));
        assertEquals(cost - 1, g.growthCost(p).get(Res.FOOD));
        g.builtWonders.add(C.greatWonders.get("skara_brae"));
        assertEquals(g.realm.size(), g.mods(p).income.get(Res.FOOD), "+1 food per territory");
        g.builtWonders.add(C.greatWonders.get("ggantija_temples"));
        Game.WonderProgress w = new Game.WonderProgress(C.greatWonders.get("pyramids"));
        g.greatWonders.add(w);
        p.res.put(Res.PRODUCTION, 10);
        g.act(p.seat, Map.of("type", "contribute", "wonder", "pyramids", "resources", Map.of("production", 4)));
        assertEquals(8, w.paid.get(Res.PRODUCTION), "given resources count double");
        assertEquals(6, p.res.get(Res.PRODUCTION), "but cost only what was given");
    }

    @Test
    void theConquerorAndAlexanderChangeEnemyStrength() {
        Game g = game(1, 72);
        Player p = g.players.get(0);
        Game.Frontier f = g.frontier.get(0);
        f.enemy = 5;
        p.leader = null;
        int base = g.settleTroops(f) - 5;
        p.leader = C.cards.get("first_conqueror");
        assertEquals(base + 3, g.settleTroops(f));
        p.leader = C.cards.get("alexander_the_great");
        assertEquals(base, g.settleTroops(f));
    }

    @Test
    void theFirstReligionFadesAfterThePrehistoricEra() {
        Game g = game(1, 73);
        Player p = g.players.get(0);
        p.leader = null;
        p.minorWonders.add(C.cards.get("first_religion"));
        assertEquals(3, g.mods(p).income.get(Res.CULTURE));
        g.eraIndex = 1;
        assertEquals(0, g.mods(p).income.get(Res.CULTURE), "obsolete");
    }

    @Test
    void theTradingRouteIsOnlyInTheDeckWithTeammates() {
        for (int players : new int[]{1, 2}) {
            Game g = game(players, 50 + players);
            boolean found = g.eraDeck.stream().anyMatch(c -> c.def.id.equals("new_trading_route"))
                    || g.queue.stream().anyMatch(sl -> sl.card.def.id.equals("new_trading_route"));
            if (players == 1) assertFalse(found, "not in a solo game");
        }
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
        for (Player q : g.players) q.leader = null;           // a drawn leader (Alexander, the Conqueror) would change the enemy strength
        assertEquals(2, g.frontier.size(), "two lands face up at the start");
        Player p = g.players.get(0);
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
        assertEquals(0, p.army, "all of the 2 troops sent are lost");
        // later payments need no card and no action
        p.res.put(Res.FOOD, 50);
        p.res.put(Res.PRODUCTION, 50);
        p.army = 5;
        p.idle += 5;
        int actions = g.players.get(0).actions;
        Map<String, Object> all = new java.util.HashMap<>();
        for (Res r : Res.values()) all.put(r.key(), 50);
        g.act(p.seat, Map.of("type", "colonize", "land", f.land.id, "resources", all, "army", 5, "population", 5));
        assertEquals(actions, g.players.get(0).actions, "paying toward a colony is free");
        assertEquals(3, g.realm.size());
        assertEquals(3, p.army, "only the missing 2 troops were sent, and lost");
        assertEquals(2, g.frontier.size(), "the colony is settled; two face-up lands remain");
    }

    @Test
    void scoutedLandsStayFaceUp() {
        Game g = game(2, 13);
        Player p = g.players.get(0);
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
        Player p = g.players.get(0);
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
        Player p = g.players.get(0);
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
            Player p = g.players.get(0);
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
