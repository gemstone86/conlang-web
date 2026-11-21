package com.dawnofmankind.core;

import com.dawnofmankind.core.Content.BuildingDef;
import com.dawnofmankind.core.Content.CardDef;
import com.dawnofmankind.core.Content.CardType;
import com.dawnofmankind.core.Content.EraDef;
import com.dawnofmankind.core.Content.TerritoryDef;
import com.dawnofmankind.core.Content.WonderDef;
import com.dawnofmankind.core.Effects.Mods;
import com.dawnofmankind.core.Player.Building;
import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * One game of Dawn of Mankind: the whole state and every rule. Not thread-safe; the caller (a room) serialises calls.
 *
 * <p>A round: <b>production</b> (automatic), then each player's <b>turn</b> in seat order from the First Player (a
 * free blind draw, then up to 4 actions), then the <b>events</b> phase (draw as many events from the current event
 * deck as the future deck holds, resolve each with a response window, shuffle the future deck in), then the <b>end of
 * round</b> (remove cards from the bottom of the queue, refill it, check the era, pass First Player on).
 */
public final class Game {

    public enum Phase { TURNS, EVENTS, STARVATION, OVER }

    /** One physical card. */
    public static final class CardInst {
        public final int id;
        public final CardDef def;

        CardInst(int id, CardDef def) {
            this.id = id;
            this.def = def;
        }
    }

    /** A queue slot: a face-up card, and for events the face-down card placed under it. */
    public static final class Slot {
        public final CardInst card;
        public CardInst under;
        /** Taken during the round: the slot stays empty (nothing slides down) until the end of the round. */
        public boolean taken;

        Slot(CardInst card, CardInst under) {
            this.card = card;
            this.under = under;
        }
    }

    /** A great wonder the team is building: what has been paid and by whom. */
    public static final class WonderProgress {
        public final WonderDef def;
        public final EnumMap<Res, Integer> paid = Res.empty();
        public final Map<Integer, EnumMap<Res, Integer>> bySeat = new LinkedHashMap<>();
        public boolean done;

        WonderProgress(WonderDef def) {
            this.def = def;
        }
    }

    /** A territory of the shared realm (or one waiting on the frontier). Great wonders stand in a territory. */
    public static final class Territory {
        public final int id;
        public final TerritoryDef def;
        public final List<WonderDef> wonders = new ArrayList<>();
        /** A cored territory is not lost to a broken invasion: it loses its core status instead. */
        public boolean cored;

        Territory(int id, TerritoryDef def) {
            this.id = id;
            this.def = def;
        }
    }

    /**
     * A land that can be settled. Face-up lands (2 from the start, plus any turned up by Send Scouts) stay until
     * settled or removed by an event, and are paid toward with Settle cards; payments stay on the land. A land found by
     * an event must be settled at once, in that event's response window (anyone, free), or it is discarded with
     * everything sent.
     */
    public static final class Frontier {
        public final Territory land;
        public final boolean fromEvent;
        /** For lands found by an event: that event card (the land is discarded when it resolves). */
        public final int eventCard;
        public int enemy;
        public final EnumMap<Res, Integer> paid = Res.empty();
        public int troopsPaid, settlersPaid;
        /** A colony: a face-up land opened by a Settle card; anyone can pay toward it (1 action each). Its face-up spot is refilled. */
        public boolean opened;
        public final Map<Integer, EnumMap<Res, Integer>> bySeat = new LinkedHashMap<>();

        Frontier(Territory land, boolean fromEvent, int eventCard) {
            this.land = land;
            this.fromEvent = fromEvent;
            this.eventCard = eventCard;
        }
    }

    /** A crisis in effect: it acts again every round until it runs out or its condition is met. */
    public static final class ActiveCrisis {
        public final CardInst card;
        public int roundsDone;

        ActiveCrisis(CardInst card) {
            this.card = card;
        }
    }

    /** A raid or invasion a crisis sends, waiting to be resolved like an event. */
    private record Attack(CardInst card, int target, int strength) {}

    /** The event being resolved and the players' responses to it. */
    public static final class Pending {
        public final CardInst event;
        /** Target seat for one-player events, else -1. */
        public final int target;
        public final int strength;
        public final Map<Integer, Boolean> ready = new LinkedHashMap<>();
        public final Map<Integer, Integer> troops = new LinkedHashMap<>();
        public final List<String> responses = new ArrayList<>();
        public int defenseBonus, healthBonus;
        public boolean halve, cancel;
        public Boolean accept;
        /** Sent by a crisis, not drawn from the event deck. */
        boolean fromCrisis;

        Pending(CardInst event, int target, int strength) {
            this.event = event;
            this.target = target;
            this.strength = strength;
        }
    }

    public final Content content;
    public final List<Player> players = new ArrayList<>();
    private final Random rng;
    private int nextId = 1;

    public Phase phase = Phase.TURNS;
    /** Players who must choose which of their people starve: seat → how many (the round waits for them). */
    public final Map<Integer, Integer> starving = new LinkedHashMap<>();
    public int round = 1;
    public int eraIndex = 0;
    public int firstPlayer = 0;
    /** Seconds the queue can be picked from after a round starts (0 = no limit); changeable during play. */
    public int pickSeconds = 90;
    public long roundStartedAt;
    public boolean picksLocked;
    public int stability, health;
    /** Enemies massing from hostility cards; the next invasion adds them to its strength. */
    public int threat;

    public final List<CardInst> eraDeck = new ArrayList<>();
    public final List<Slot> queue = new ArrayList<>();
    public final List<CardInst> currentEvents = new ArrayList<>();
    public final List<CardInst> futureEvents = new ArrayList<>();
    public final List<CardInst> pastEvents = new ArrayList<>();
    public final List<CardInst> persistentEvents = new ArrayList<>();
    public final List<CardInst> crisisPile = new ArrayList<>();
    public final List<ActiveCrisis> crises = new ArrayList<>();
    private final List<Attack> attacks = new ArrayList<>();
    public final List<WonderProgress> greatWonders = new ArrayList<>();
    public final List<WonderDef> builtWonders = new ArrayList<>();
    public final EnumMap<Res, Integer> pool = Res.empty();
    public final List<Territory> worldDeck = new ArrayList<>();
    public final List<Territory> realm = new ArrayList<>();
    public final List<Frontier> frontier = new ArrayList<>();

    private List<CardInst> drawn = new ArrayList<>();
    private int drawnIndex;
    public Pending pending;
    public int eventsDrawnThisRound;
    private boolean eraEnding;

    public String result; // null, "victory" or "defeat"
    public String endReason;
    public final List<String> log = new ArrayList<>();
    public long version;

    public Game(Content content, List<String> names, long seed) {
        if (names.isEmpty() || names.size() > 6) throw new GameException("A game needs 1 to 6 players.");
        this.content = content;
        this.rng = new Random(seed);
        Content.Rules r = content.rules;
        for (TerritoryDef t : content.territories.values()) {
            if (!t.special) for (int i = 0; i < t.copies; i++) worldDeck.add(new Territory(nextId++, t));
        }
        Collections.shuffle(worldDeck, rng);
        for (int i = 0; i < r.startTerritories && !worldDeck.isEmpty(); i++) realm.add(worldDeck.remove(0));
        refillLands();
        for (int i = 0; i < names.size(); i++) {
            Player p = new Player(i, names.get(i));
            r.startResources.forEach((k, v) -> p.res.put(k, v));
            r.startWorkers.forEach((bid, workers) -> {
                Building b = addBuilding(p, content.buildings.get(bid));
                b.workers = Math.min(b.slots, workers);
                p.idle += workers - b.workers;
            });
            players.add(p);
        }
        stability = r.startStability;
        health = r.startHealth;
        for (String id : content.crisisCards) crisisPile.add(inst(content.cards.get(id)));
        Collections.shuffle(crisisPile, rng);
        List<CardInst> start = new ArrayList<>();
        content.startingEvents.forEach((id, copies) -> {
            for (int i = 0; i < copies; i++) start.add(inst(content.cards.get(id)));
        });
        Collections.shuffle(start, rng);
        int n = Math.min(start.size(), r.startingEventsPerPlayer * players.size());
        currentEvents.addAll(start.subList(0, n));
        log("The tribes gather in a land of " + String.join(" and ", realm.stream().map(t -> t.def.name).toList())
                + ". " + plural(n, "event") + " wait in the event deck.");
        startEra();
        startRound();
    }

    // ------------------------------------------------------------------------------------------------ setup & eras

    public EraDef era() {
        return content.eras.get(eraIndex);
    }

    private CardInst inst(CardDef d) {
        return new CardInst(nextId++, d);
    }

    public int queueSize() {
        return players.size() + content.rules.queueExtra;
    }

    private void startEra() {
        EraDef e = era();
        eraDeck.clear();
        List<CardInst> pool = new ArrayList<>(), triggers = new ArrayList<>();
        e.cards.forEach((id, copies) -> {
            CardDef d = content.cards.get(id);
            if (d.minPlayers > players.size()) return;                 // e.g. trading needs a teammate
            for (int i = 0; i < copies; i++) (d.eraTrigger ? triggers : pool).add(inst(d));
        });
        int size = content.rules.deckBase + content.rules.deckPerPlayer * players.size() - triggers.size();
        // the deck is filled from the era's cards, going round again if needed; great wonders appear only once
        List<CardInst> bag = new ArrayList<>();
        boolean firstPass = true;
        while (eraDeck.size() < size && !pool.isEmpty()) {
            if (bag.isEmpty()) {
                // great wonders and hostility cards come in the numbers listed, once per deck
                for (CardInst c : pool) {
                    if (firstPass || (c.def.type != CardType.GREAT_WONDER && c.def.type != CardType.HOSTILITY)) bag.add(inst(c.def));
                }
                Collections.shuffle(bag, rng);
                firstPass = false;
                if (bag.isEmpty()) break;
            }
            eraDeck.add(bag.remove(bag.size() - 1));
        }
        // era-trigger events go into the bottom part of the deck: they can end the era early, but not at once
        for (CardInst t : triggers) {
            int from = eraDeck.size() * (100 - content.rules.eraTriggerBottomShare) / 100;
            eraDeck.add(from + rng.nextInt(eraDeck.size() - from + 1), t);
        }
        queue.clear();
        refillQueue();
        log("The " + e.name + " era begins. Era deck: " + eraDeck.size() + " cards.");
    }

    private void advanceEra() {
        eraEnding = false;
        for (WonderProgress w : greatWonders) {
            if (w.done) continue;
            w.bySeat.forEach((seat, paid) -> paid.forEach((r, v) -> players.get(seat).res.merge(r, v / 2, Integer::sum)));
            log(w.def.name + " was not finished" + (Res.isZero(w.paid) ? "." : "; half of what was paid is returned."));
        }
        greatWonders.removeIf(w -> !w.done);
        if (eraIndex + 1 >= content.eras.size()) {
            end("victory", "The civilization endured to the end of the " + era().name + " era.");
            return;
        }
        log("The " + era().name + " era ends.");
        for (Player p : players) {
            if (p.leader != null) log(p.leader.name + " leaves with the era.");
            p.leader = null;
        }
        // an era's trigger event only ends its own era: leftovers are retired
        for (List<CardInst> deck : List.of(currentEvents, futureEvents)) {
            for (CardInst c : List.copyOf(deck)) {
                if (c.def.eraTrigger) {
                    deck.remove(c);
                    pastEvents.add(c);
                }
            }
        }
        eraIndex++;
        startEra();
    }

    // ------------------------------------------------------------------------------------------------ round flow

    private void startRound() {
        log("— Round " + round + " (" + era().name + ") —");
        starving.clear();
        production();
        if (checkDefeat()) return;
        if (!starving.isEmpty()) {
            phase = Phase.STARVATION;
            log("Some people must starve: " + starving.keySet().stream().map(i -> players.get(i).name).toList() + " choose who.");
            return;
        }
        beginTurns();
    }

    /** Whether a player has a real choice of who starves: people in more than one place (idle, or in different buildings). */
    private boolean canChooseWhoStarves(Player p, int n) {
        long places = (p.idle > 0 ? 1 : 0) + p.buildings.stream().filter(b -> b.workers > 0).count();
        return places > 1 && p.population() > n;
    }

    /** {"type":"starve","lose":{"idle":1,"<building id>":2}}: who of your people starves (the numbers must add up). */
    private void starve(Player p, Map<String, Object> a) {
        Integer need = starving.get(p.seat);
        if (phase != Phase.STARVATION || need == null) throw new GameException("No one of yours has to starve now.");
        Map<String, Object> lose = Y.map(a.get("lose"));
        int total = 0;
        for (Map.Entry<String, Object> e : lose.entrySet()) {
            int n = Y.toInt(e.getValue());
            if (n < 0) throw new GameException("Amounts can't be negative.");
            total += n;
            int have = "idle".equals(e.getKey()) ? p.idle : p.buildings.stream().filter(b -> String.valueOf(b.id).equals(e.getKey())).mapToInt(b -> b.workers).findFirst().orElse(-1);
            if (have < 0) throw new GameException("You have no such building.");
            if (n > have) throw new GameException("You don't have that many there.");
        }
        if (total != need) throw new GameException("Choose exactly " + need + " " + (need == 1 ? "person" : "people") + ".");
        boolean had = p.population() > 0;
        for (Map.Entry<String, Object> e : lose.entrySet()) {
            int n = Y.toInt(e.getValue());
            if ("idle".equals(e.getKey())) p.idle -= n;
            else p.buildings.stream().filter(b -> String.valueOf(b.id).equals(e.getKey())).findFirst().ifPresent(b -> b.workers -= n);
        }
        log(p.name + " loses " + need + " Population to starvation.");
        starving.remove(p.seat);
        if (had && p.population() == 0) {
            stability--;
            log(p.name + "'s people are gone. Stability -1 (now " + stability + ").");
            addCrisis("random");
        }
        starvationDone();
    }

    private void starvationDone() {
        if (!starving.isEmpty() || phase != Phase.STARVATION) return;
        if (checkDefeat()) return;
        beginTurns();
    }

    private void production() {
        Mods anyone = civMods();
        for (Player p : players) {
            Mods m = mods(p);
            EnumMap<Res, Integer> gain = Res.empty();
            for (Building b : p.buildings) {
                int w = working(p, b);
                b.def.perWorker.forEach((r, v) -> gain.merge(r, v * w, Integer::sum));
                EnumMap<Res, Integer> bonus = m.perWorker.get(b.def.id);
                if (bonus != null) bonus.forEach((r, v) -> gain.merge(r, v * w, Integer::sum));
            }
            m.income.forEach((r, v) -> gain.merge(r, v, Integer::sum));
            gain.forEach((r, v) -> p.res.put(r, Math.max(0, p.res.get(r) + v)));
            int upkeep = p.population() * content.rules.foodUpkeepPerPop;
            int food = p.res.get(Res.FOOD);
            String msg = p.name + " produces " + Res.describe(gain) + "; feeds " + p.population() + " Population.";
            if (food >= upkeep) {
                p.res.put(Res.FOOD, food - upkeep);
            } else {
                p.res.put(Res.FOOD, 0);
                int starve = (int) Math.ceil((upkeep - food) / (double) Math.max(1, content.rules.foodUpkeepPerPop));
                msg += " Not enough food: " + starve + " Population starve. Stability -1.";
                stability--;
                if (p.away || !canChooseWhoStarves(p, starve)) losePopulation(p, starve);
                else starving.put(p.seat, starve);
            }
            log(msg);
        }
        // a leader like Ramses makes every unfinished great wonder grow by itself
        for (Player p : players) {
            if (p.leader == null) continue;
            int n = p.leader.effects.stream().filter(e -> e.containsKey("wonderGrowth")).mapToInt(e -> Y.toInt(e.get("wonderGrowth"))).sum();
            if (n <= 0) continue;
            for (WonderProgress w : List.copyOf(greatWonders)) {
                if (w.done) continue;
                EnumMap<Res, Integer> need = w.def.cost(players.size()), add = Res.empty();
                for (Res r : Res.values()) if (need.get(r) > 0) add.put(r, Math.min(n, need.get(r) - w.paid.get(r)));
                if (Res.isZero(add)) continue;
                add.forEach((r, v) -> w.paid.merge(r, v, Integer::sum));
                log(p.leader.name + ": " + w.def.name + " grows by " + Res.describe(add) + ".");
                if (w.paid.equals(need)) completeWonder(w, p, -1);
            }
        }
        for (CardInst e : persistentEvents) {
            for (Map<String, Object> eff : e.def.ongoing) {
                if ("stability".equals(Effects.key(eff))) {
                    stability += Y.toInt(eff.get("stability"));
                    log(e.def.name + ": Stability " + Y.toInt(eff.get("stability")) + " (now " + stability + ").");
                }
            }
        }
        if (anyone.sharedPool && !Res.isZero(anyone.poolIncome)) {
            anyone.poolIncome.forEach((r, v) -> pool.merge(r, v, Integer::sum));
            log("The shared pool gains " + Res.describe(anyone.poolIncome) + ".");
        }
    }

    /** Every player starts the round at once: their actions, and one blind card each from the era deck. */
    private void beginTurns() {
        phase = Phase.TURNS;
        picksLocked = false;
        roundStartedAt = System.currentTimeMillis();
        for (Player p : players) {
            p.actions = content.rules.actionsPerTurn + mods(p).actionsPerTurn;
            p.done = false;
            p.freeRecruitUsed = false;
            p.turnEvents = 0;
            CardInst c = drawFromEraDeck(p);
            p.turnDraw = c;
            p.turnSeq++;
            log(p.name + " draws" + (c == null ? " nothing (the era deck is empty)." : " a card."));
        }
        for (Player p : players) if (p.away) endRoundFor(p);
    }

    /** Milliseconds left to pick cards (-1: no limit, 0: closed). */
    public long pickLeftMillis() {
        if (picksLocked) return 0;
        if (pickSeconds <= 0) return -1;
        return Math.max(0, roundStartedAt + pickSeconds * 1000L - System.currentTimeMillis());
    }

    /** Called every few seconds: closes the queue when the pick time is over. Returns true if something changed. */
    public boolean tick() {
        if (result != null || phase != Phase.TURNS || picksLocked || pickSeconds <= 0) return false;
        if (pickLeftMillis() > 0) return false;
        picksLocked = true;
        log("The time to pick cards is over: the queue is closed until the next round.");
        version++;
        return true;
    }

    /** {"type":"pickTime","seconds":n}: the time to pick cards each round (0 = no limit). */
    private void pickTime(Map<String, Object> a) {
        int sec = Y.i(a, "seconds", pickSeconds);
        if (sec < 0 || sec > 3600) throw new GameException("Pick time is 0 (no limit) to 3600 seconds.");
        pickSeconds = sec;
        picksLocked = sec > 0 && pickLeftMillis() <= 0;
        log("Time to pick cards: " + (sec == 0 ? "no limit" : sec + " seconds") + " each round" + (picksLocked ? " (already over this round)." : "."));
    }

    /** Draws for a player: events go to the future deck and the player draws again. Returns the card kept, or null. */
    private CardInst drawFromEraDeck(Player p) {
        CardInst c;
        while ((c = nextFromEraDeck()) != null) {
            if (c.def.isEvent()) {
                futureEvents.add(c);
                p.turnEvents++;
                log(p.name + " drew an event; it goes face down into the future deck.");
                continue;
            }
            take(p, c);
            return c;
        }
        return null;
    }

    /** A player is done with the round (the hand is kept to its limit); when everyone is, the events come. */
    private void endRoundFor(Player p) {
        if (p.away) while (p.hand.size() > handLimit(p)) p.hand.remove(p.hand.size() - 1);
        p.done = true;
        log(p.name + " is done for the round.");
        if (phase == Phase.TURNS && players.stream().allMatch(x -> x.done)) startEvents();
    }

    private void startEvents() {
        phase = Phase.EVENTS;
        int n = Math.min(futureEvents.size(), currentEvents.size());
        drawn = new ArrayList<>(currentEvents.subList(0, n));
        currentEvents.subList(0, n).clear();
        eventsDrawnThisRound = n;
        drawnIndex = 0;
        log(plural(futureEvents.size(), "event") + " in the future deck: " + plural(n, "event") + " drawn from the event deck.");
        for (ActiveCrisis c : List.copyOf(crises)) tickCrisis(c);
        if (checkDefeat()) return;
        openNextEvent();
    }

    private void openNextEvent() {
        while (result == null) {
            Attack attack = attacks.isEmpty() ? null : attacks.remove(0);
            if (attack == null && drawnIndex >= drawn.size()) {
                finishEvents();
                return;
            }
            CardInst e = attack != null ? attack.card() : drawn.get(drawnIndex);
            CardDef d = e.def;
            int target = -1;
            if ("one".equals(d.target) || "raid".equals(d.kind) || "opportunity".equals(d.kind)) target = rng.nextInt(players.size());
            int strength = d.strength(players.size(), realm.size()) + ("invasion".equals(d.kind) ? threat : 0);
            if (attack != null) {
                if (attack.target() >= 0) target = attack.target();
                if (attack.strength() > 0) strength = attack.strength();
            }
            pending = new Pending(e, target, strength);
            pending.fromCrisis = attack != null;
            for (Player p : players) pending.ready.put(p.seat, p.away);
            log("Event: " + d.name + (target >= 0 ? " (" + players.get(target).name + ")" : "") + " — " + d.text);
            // a land found by this event is shown now, so the team can pay for it before the event resolves
            applyImmediate(d.effects.stream().filter(x -> x.containsKey("discover")).toList(), players, null, 1.0, false);
            if (!needsResponses()) {
                // nobody can respond: it resolves at once, but every player is shown what happened
                CardInst shown = pending.event;
                int tg = pending.target;
                collect = new ArrayList<>();
                resolvePending();
                Notice n = new Notice(++noticeSeq, shown, tg, collect);
                collect = null;
                notices.add(n);
                while (notices.size() > 30) notices.remove(0);
                continue;
            }
            return;
        }
    }

    /** True if anyone can do something about the pending event; otherwise it resolves at once. */
    private boolean needsResponses() {
        CardDef d = pending.event.def;
        if (frontier.stream().anyMatch(f -> f.eventCard == pending.event.id)) return true;
        if ("invasion".equals(d.kind)) return players.stream().anyMatch(p -> !p.away && p.army - p.committed > 0)
                || anyResponseCard(d);
        if ("opportunity".equals(d.kind)) return !players.get(pending.target).away;
        return anyResponseCard(d);
    }

    private boolean anyResponseCard(CardDef event) {
        for (Player p : players) {
            if (p.away) continue;
            for (CardInst c : p.hand) if (responds(c.def, event)) return true;
        }
        return false;
    }

    private static boolean responds(CardDef card, CardDef event) {
        return card.type == CardType.RESPONSE
                && (card.respondsTo.contains("any") || card.respondsTo.contains(event.category) || card.respondsTo.contains(event.id));
    }

    private void finishEvents() {
        pending = null;
        if (!futureEvents.isEmpty()) {
            currentEvents.addAll(futureEvents);
            log(plural(futureEvents.size(), "event") + " from the future deck shuffled into the event deck.");
            futureEvents.clear();
            Collections.shuffle(currentEvents, rng);
        }
        endRound();
    }

    /** The player whose leader has this lasting effect (the first, if several do). */
    private Player leaderWith(String effect) {
        for (Player p : players) {
            if (p.leader != null && p.leader.effects.stream().anyMatch(e -> e.containsKey(effect))) return p;
        }
        return null;
    }

    private void endRound() {
        // the last k slots leave (an empty one costs nothing); then the gaps close up and the queue is refilled
        int k = Math.min(queue.size(), content.rules.removedPerRound(players.size()));
        for (int i = 0; i < k; i++) {
            Slot s = queue.remove(queue.size() - 1);
            if (s.taken) continue;
            if (s.card.def.isEvent()) {
                futureEvents.add(s.card);
                log(s.card.def.name + " leaves the bottom of the queue and goes to the future deck.");
                Player teller = leaderWith("eventUnder");
                CardInst under = s.under;
                if (teller != null && under != null) {
                    while (under != null && under.def.isEvent()) {
                        futureEvents.add(under);
                        log("The face-down card was another event; it goes face down into the future deck.");
                        under = nextFromEraDeck();
                    }
                    if (under != null) {
                        log(teller.leader.name + ": " + teller.name + " gets the face-down card.");
                        take(teller, under);
                    }
                }
            } else if (s.card.def.type == CardType.ACTION && leaderWith("actionsToHand") != null) {
                Player mother = leaderWith("actionsToHand");
                mother.hand.add(s.card);
                log(s.card.def.name + " leaves the bottom of the queue; " + mother.name + " takes it (" + mother.leader.name + ").");
            } else {
                log(s.card.def.name + " leaves the bottom of the queue.");
            }
        }
        queue.removeIf(sl -> sl.taken);
        refillQueue();
        for (Player p : players) p.committed = 0;
        // in the last era the game goes on after the era deck runs out, until the queue is empty at the end of a round
        boolean lastEra = eraIndex + 1 >= content.eras.size();
        if (eraEnding || (eraDeck.isEmpty() && (!lastEra || queue.isEmpty()))) {
            if (!eraEnding) log(lastEra ? "The queue is empty and the era deck is exhausted." : "The era deck is exhausted.");
            advanceEra();
            if (result != null) return;
        }
        round++;
        startRound();
    }

    private void refillQueue() {
        while (queue.size() < queueSize()) {
            CardInst c = nextFromEraDeck();
            if (c == null) break;
            CardInst under = c.def.isEvent() ? nextFromEraDeck() : null;
            queue.add(0, new Slot(c, under));
        }
    }

    /**
     * Takes the top card of the era deck. Hostility cards never stay anywhere: as soon as one is revealed it adds
     * its enemies to the threat massing against the realm, and the next card is taken.
     */
    private CardInst nextFromEraDeck() {
        while (!eraDeck.isEmpty()) {
            CardInst c = eraDeck.remove(0);
            if (c.def.type != CardType.HOSTILITY) return c;
            int n = c.def.effects.stream().filter(e -> e.containsKey("hostility")).mapToInt(e -> Y.toInt(e.get("hostility"))).sum();
            threat += n;
            pastEvents.add(c);
            log("HOSTILITY: " + c.def.name + " — +" + n + " enemies massing (now " + threat + "). The next invasion brings them.");
        }
        return null;
    }

    // ------------------------------------------------------------------------------------------------ actions

    /** Runs one player action. Throws {@link GameException} if it isn't allowed; then nothing has changed. */
    public void act(int seat, Map<String, Object> a) {
        if (result != null) throw new GameException("The game is over.");
        if (seat < 0 || seat >= players.size()) throw new GameException("Not a player in this game.");
        String type = Y.s(a, "type", "");
        Player p = players.get(seat);
        switch (type) {
            // free, at any time
            case "deposit" -> deposit(p, a);
            case "withdraw" -> withdraw(p, a);
            case "discard" -> discard(p, a);
            // event responses
            case "respond" -> respond(p, a);
            case "troops" -> troops(p, a);
            case "decide" -> decide(p, a);
            case "ready" -> ready(p);
            case "colonize" -> colonize(p, a);
            case "starve" -> starve(p, a);
            case "contribute" -> { myTurn(p); contribute(p, a); }          // paying toward a great wonder is free
            // turn
            case "endTurn" -> {
                myTurn(p);
                int limit = handLimit(p);
                if (p.hand.size() > limit) throw new GameException("Discard down to " + limit + " cards before you are done.");
                endRoundFor(p);
            }
            case "pickTime" -> pickTime(a);
            default -> {
                myTurn(p);
                boolean free = type.equals("recruit") && !p.freeRecruitUsed && mods(p).freeRecruit > 0;   // a leader's free troop
                if (!free && p.actions <= 0) throw new GameException("No actions left. You can be done for the round.");
                switch (type) {
                    case "move" -> move(p, a);
                    case "build" -> build(p, a);
                    case "pick" -> pick(p, a);
                    case "play" -> play(p, a);
                    case "grow" -> grow(p, a);
                    case "recruit" -> recruit(p);
                    case "giveCards" -> giveCards(p, a);
                    case "cleanse" -> cleanse(p, a);
                    default -> throw new GameException("Unknown action: " + type);
                }
                if (!free) p.actions--;
            }
        }
        version++;
    }

    /** Paying toward a land found by an event (free during its event) or toward a colony (free during a turn). */
    private void colonize(Player p, Map<String, Object> a) {
        LandPayment lp = landPayment(p, a, Res.empty());
        Frontier f = lp.land();
        if (!f.fromEvent) {
            // an opened face-up land (a colony): anyone, on their turn, free
            if (!f.opened) throw new GameException("Play a Settle card on the " + f.land.def.name + " first to open it for settling.");
            myTurn(p);
            payLand(p, lp);
            version++;
            return;
        }
        if (phase != Phase.EVENTS || pending == null || pending.event.id != f.eventCard) throw new GameException("Too late for that land.");
        if (Boolean.TRUE.equals(pending.ready.get(p.seat))) throw new GameException("You have already passed on this event.");
        payLand(p, lp);
    }

    private void myTurn(Player p) {
        if (phase != Phase.TURNS) throw new GameException("Wait for the events to be resolved.");
        if (p.done) throw new GameException("You are done for this round.");
    }

    private void move(Player p, Map<String, Object> a) {
        Object from = a.get("from"), to = a.get("to");
        boolean fromIdle = "idle".equals(String.valueOf(from)), toIdle = "idle".equals(String.valueOf(to));
        if (String.valueOf(from).equals(String.valueOf(to))) throw new GameException("Pick a different place to move the worker to.");
        Building fb = fromIdle ? null : p.building(Y.toInt(from));
        Building tb = toIdle ? null : p.building(Y.toInt(to));
        if (fromIdle ? p.idle == 0 : fb.workers == 0) throw new GameException("There is no worker there.");
        if (tb != null && tb.workers >= activeSlots(p, tb)) throw new GameException(tb.def.name + " has no free worker slot.");
        if (fromIdle) p.idle--; else fb.workers--;
        if (toIdle) p.idle++; else tb.workers++;
        log(p.name + " moves a worker " + (fromIdle ? "" : "from the " + fb.def.name + " ") + "to "
                + (toIdle ? "rest (idle)" : "the " + tb.def.name) + ".");
    }

    /** Base cost, +{@code buildingEscalation} production per level the building already has, minus discounts. */
    public EnumMap<Res, Integer> buildCost(Player p, BuildingDef b) {
        Mods m = mods(p);
        Building existing = p.ofType(b.id);
        int levels = existing == null ? 0 : existing.level();
        EnumMap<Res, Integer> cost = Res.empty();
        EnumMap<Res, Integer> fixed = m.fixedCost.get(b.id);
        if (fixed != null) {
            fixed.forEach((r, v) -> cost.put(r, v));       // a leader makes it cost only this
            return cost;
        }
        b.cost.forEach((r, v) -> {
            int c = v + (r == Res.PRODUCTION ? levels * content.rules.buildingEscalation : 0);
            cost.put(r, Math.max(0, c - (c > 0 ? m.buildDiscount.get(r) : 0)));
        });
        return cost;
    }

    /** Worker slots a player may have in a building type: home slots plus what the realm's territories add. */
    public int capacity(Player p, String type) {
        Integer home = content.rules.homeSlots.get(type);
        if (home == null) return Integer.MAX_VALUE;
        int cap = home + mods(p).maxSlots.getOrDefault(type, 0);
        for (Territory t : realm) cap += t.def.slots.getOrDefault(type, 0);
        return cap;
    }

    /** Slots that work: a building above what the land allows is inactive until there is room for it again. */
    public int activeSlots(Player p, Building b) {
        return Math.min(b.slots, capacity(p, b.def.id));
    }

    /** Workers that produce (those in inactive slots don't). */
    public int working(Player p, Building b) {
        return Math.min(b.workers, activeSlots(p, b));
    }

    public int freeSlots(Player p) {
        int n = 0;
        for (Building b : p.buildings) n += Math.max(0, activeSlots(p, b) - b.workers);
        return n;
    }

    /** Food for 3 (base) more for every {@code growthStep} people beyond the first. */
    public EnumMap<Res, Integer> growthCost(Player p) {
        EnumMap<Res, Integer> c = new EnumMap<>(content.rules.growthCost);
        int extra = Math.max(0, p.population() - 1) / Math.max(1, content.rules.growthStep);
        c.merge(Res.FOOD, extra, Integer::sum);
        return c;
    }

    public int colonizationValue() {
        int v = 0;
        for (Territory t : realm) v += t.def.colonization;
        return v;
    }

    private void build(Player p, Map<String, Object> a) {
        String id = Y.s(a, "building", "");
        BuildingDef b = content.buildings.get(id);
        if (b == null || !b.buildable) throw new GameException("You can't build that.");
        Building existing = p.ofType(b.id);
        int cap = capacity(p, b.id);
        if ((existing == null ? 0 : existing.slots) >= cap) {
            throw new GameException("Your land has room for only " + cap + " " + b.name.toLowerCase() + " worker slots. Settle more territory.");
        }
        pay(p, buildCost(p, b));
        Building built = addBuilding(p, b);
        // idle people move into the new slots at once (no action)
        int moved = Math.min(p.idle, built.slots - built.workers);
        built.workers += moved;
        p.idle -= moved;
        log(built.level() == 1 ? p.name + " builds a " + b.name + "."
                : p.name + " expands the " + b.name + " to level " + built.level() + " (" + built.slots + " worker slots).");
        if (moved > 0) log(moved + " idle " + (moved == 1 ? "person starts" : "people start") + " working there.");
    }

    private void pick(Player p, Map<String, Object> a) {
        int i = Y.i(a, "slot", -1);
        if (i < 0 || i >= queue.size()) throw new GameException("No card in that queue slot.");
        Slot s = queue.get(i);
        if (!picksLocked && pickSeconds > 0 && pickLeftMillis() <= 0) {
            picksLocked = true;
            log("The time to pick cards is over: the queue is closed until the next round.");
        }
        if (picksLocked) throw new GameException("The time to pick cards is over for this round.");
        if (s.taken) throw new GameException("That card was just taken.");
        s.taken = true;
        if (!s.card.def.isEvent()) {
            log(p.name + " takes " + s.card.def.name + " from the queue.");
            take(p, s.card);
            return;
        }
        futureEvents.add(s.card);
        log(p.name + " takes on the event " + s.card.def.name + " (to the future deck) and gets the face-down card.");
        CardInst under = s.under;
        while (under != null && under.def.isEvent()) {
            futureEvents.add(under);
            log("The face-down card was another event; it goes face down into the future deck.");
            under = nextFromEraDeck();
        }
        if (under != null) take(p, under);
    }

    /** A card a player gets: into their hand, except great wonders, which go on the board for the whole team to build. */
    private void take(Player p, CardInst c) {
        if (c.def.type == CardType.LEADER) {
            // a leader plays at once and replaces the one before
            if (p.leader != null) log(p.leader.name + " steps down.");
            p.leader = c.def;
            log(p.name + " is now led by " + c.def.name + ": " + c.def.text);
            return;
        }
        if (c.def.type != CardType.GREAT_WONDER) {
            p.hand.add(c);
            return;
        }
        WonderDef w = content.greatWonders.get(c.def.wonder);
        boolean known = builtWonders.contains(w) || greatWonders.stream().anyMatch(x -> x.def == w);
        if (known) return;
        greatWonders.add(new WonderProgress(w));
        log(p.name + " brings the great wonder " + w.name + " to the tribe: everyone can now help build it.");
    }

    private CardInst handCard(Player p, Map<String, Object> a) {
        int id = Y.i(a, "card", -1);
        for (CardInst c : p.hand) if (c.id == id) return c;
        throw new GameException("That card isn't in your hand.");
    }

    private void play(Player p, Map<String, Object> a) {
        CardInst c = handCard(p, a);
        CardDef d = c.def;
        if (d.type == CardType.RESPONSE) throw new GameException(d.name + " can only be played when an event resolves.");
        if (d.type == CardType.GREAT_WONDER) throw new GameException("Great wonders are built on the board.");
        if (p.owns(d)) throw new GameException("You already have " + d.name + ".");
        if (d.type == CardType.TECH) {
            for (Player o : players) if (o.techs.contains(d)) throw new GameException(o.name + " has already researched " + d.name + ": it helps everyone.");
        }
        boolean settles = d.effects.stream().anyMatch(e -> e.containsKey("settle"));
        boolean cores = d.effects.stream().anyMatch(e -> e.containsKey("core"));
        Map<String, Object> tradeEffect = d.effects.stream().filter(e -> e.containsKey("trade")).findFirst().orElse(null);
        Frontier land = null;
        Territory core = null;
        Player tradeTo = null;
        EnumMap<Res, Integer> tradeAmounts = null, tradeGets = null;
        if (tradeEffect != null) {
            // a trade offers choices: what you pay (to the bank) and what your teammate gets
            tradeTo = other(p, a);
            List<?> options = (List<?>) tradeEffect.get("trade");
            int opt = Y.i(a, "option", -1);
            if (opt < 0 || opt >= options.size()) throw new GameException("Choose which trade you want.");
            Map<String, Object> o = Y.map(options.get(opt));
            tradeAmounts = Res.parse(o.get("give"));
            tradeGets = Res.parse(o.get("get"));
            for (Res r : Res.values()) {
                if (p.res.get(r) < tradeAmounts.get(r) + d.cost.get(r)) throw new GameException("Not enough " + r.key() + ".");
            }
        }
        final EnumMap<Res, Integer> tradeGet = tradeGets;
        LandPayment opening = null;
        if (settles) {
            opening = landPayment(p, a, d.cost, true);
            land = opening.land();
            if (land.fromEvent) throw new GameException("Lands found by events are settled during their event, without a card.");
            if (land.opened) throw new GameException("The " + land.land.def.name + " is already open for settling.");
        }
        if (cores) core = ownTerritory(a);
        pay(p, d.cost);
        p.hand.remove(c);
        if (d.type == CardType.TECH) {
            p.techs.add(d);
            sciencePoints++;
            log("Science: +1 point for " + d.name + ".");
        }
        if (d.type == CardType.MINOR_WONDER) p.minorWonders.add(d);
        log(p.name + " plays " + d.name + ".");
        if (a.get("building") != null) {
            int bid = Y.toInt(a.get("building"));
            popInto = p.buildings.stream().filter(b -> b.id == bid).findFirst().orElse(null);
            popFor = p;
        }
        try {
            applyImmediate(d.effects, List.of(p), p, 1.0, false);
        } finally {
            popInto = null;
            popFor = null;
        }
        if (land != null) {
            land.opened = true;
            log("The " + land.land.def.name + " becomes a colony: anyone can now send resources, troops and settlers to it (free on their turn).");
            refillLands();
            LandPayment now = landPayment(p, a, Res.empty(), true);
            if (!Res.isZero(now.res()) || now.troops() > 0 || now.settlers() > 0) payLand(p, now);
        }
        if (tradeTo != null) {
            pay(p, tradeAmounts);
            Player to = tradeTo;
            tradeGet.forEach((r, v) -> to.res.merge(r, v, Integer::sum));
            log(p.name + " pays " + Res.describe(tradeAmounts) + " and " + to.name + " gets " + Res.describe(tradeGet) + " along a new trading route.");
        }
        if (core != null) {
            core.cored = true;
            log("The " + core.def.name + " becomes a core territory.");
        }
    }

    private void grow(Player p, Map<String, Object> a) {
        // the new person may be put in a chosen building with a free slot (else the first free one, or idle)
        Building into = null;
        if (a.get("building") != null) {
            int id = Y.toInt(a.get("building"));
            into = p.buildings.stream().filter(b -> b.id == id).findFirst().orElseThrow(() -> new GameException("You have no such building."));
            if (into.workers >= activeSlots(p, into)) throw new GameException("The " + into.def.name + " has no free slot.");
        }
        pay(p, growthCost(p));
        if (into != null) into.workers++; else addPopulation(p, 1);
        log(p.name + " grows by 1 Population" + (into != null ? ", who goes to the " + into.def.name : "") + ".");
    }

    private void recruit(Player p) {
        pay(p, content.rules.recruitCost);
        p.army++;
        boolean free = !p.freeRecruitUsed && mods(p).freeRecruit > 0;
        if (free) p.freeRecruitUsed = true;
        log(p.name + " trains 1 troop (army " + p.army + ")" + (free ? ", which takes no action (" + p.leader.name + ")." : "."));
    }

    private void contribute(Player p, Map<String, Object> a) {
        String id = Y.s(a, "wonder", "");
        WonderProgress w = greatWonders.stream().filter(x -> x.def.id.equals(id) && !x.done).findFirst()
                .orElseThrow(() -> new GameException("That great wonder can't be built now."));
        EnumMap<Res, Integer> give = Res.parse(a.get("resources"));
        EnumMap<Res, Integer> cost = w.def.cost(players.size());
        boolean fromPool = Y.b(a, "fromPool");
        for (Res r : Res.values()) {
            int left = cost.get(r) - w.paid.get(r);
            if (give.get(r) < 0) throw new GameException("Amounts can't be negative.");
            if (give.get(r) > left) give.put(r, left);
        }
        if (Res.isZero(give)) throw new GameException("Give at least one resource the wonder still needs.");
        if (fromPool) payFromPool(give); else pay(p, give);
        give.forEach((r, v) -> w.paid.merge(r, v, Integer::sum));
        EnumMap<Res, Integer> mine = w.bySeat.computeIfAbsent(p.seat, x -> Res.empty());
        give.forEach((r, v) -> mine.merge(r, v, Integer::sum));
        log(p.name + " gives " + Res.describe(give) + (fromPool ? " from the shared pool" : "") + " to " + w.def.name + ".");
        if (w.paid.equals(cost)) completeWonder(w, p, Y.i(a, "territory", -1));
    }

    private void completeWonder(WonderProgress w, Player p, int tid) {
        w.done = true;
        builtWonders.add(w.def);
        Territory where = null;
        for (Territory t : realm) if (t.id == tid) where = t;
        if (where == null) where = realm.stream().min((x, y) -> x.wonders.size() - y.wonders.size()).orElseThrow();
        where.wonders.add(w.def);
        log("The great wonder " + w.def.name + " is complete, in the " + where.def.name + "! " + w.def.text);
        applyImmediate(w.def.effects, players, p, 1.0, false);
        for (Map<String, Object> e : w.def.effects) {
            if (!e.containsKey("coreTerritory")) continue;
            for (int i = 0; i < Y.toInt(e.get("coreTerritory")); i++) {
                Territory t = !where.cored ? where : realm.stream().filter(x -> !x.cored).findFirst().orElse(null);
                if (t == null) break;
                t.cored = true;
                log("The " + t.def.name + " becomes a core territory.");
            }
        }
        refillLands();
    }

    private void cleanse(Player p, Map<String, Object> a) {
        int id = Y.i(a, "event", -1);
        CardInst e = persistentEvents.stream().filter(x -> x.id == id).findFirst()
                .orElseThrow(() -> new GameException("No such lasting event."));
        pay(p, e.def.cleanseCost);
        persistentEvents.remove(e);
        pastEvents.add(e);
        log(p.name + " lifts " + e.def.name + ".");
    }

    /** Keeps {@code faceUpLands} face-up lands (the ones not from events). */
    private void refillLands() {
        int want = content.rules.faceUpLands + civMods().faceUpLands;
        // colonies (lands opened with a Settle card) no longer count as face-up lands
        while (frontier.stream().filter(f -> !f.fromEvent && !f.opened).count() < want && !worldDeck.isEmpty()) {
            frontier.add(new Frontier(worldDeck.remove(0), false, -1));
        }
    }

    /** The full resource cost of a land now: per player, rising with the realm, lowered by colonization value. */
    public EnumMap<Res, Integer> settleCost(Frontier f) {
        int n = players.size();
        TerritoryDef def = f.land.def;
        EnumMap<Res, Integer> cost = Res.empty();
        if (def.special) {
            def.costPerPlayer.forEach((r, v) -> cost.put(r, v * n));
            return discounted(cost);
        }
        Content.Rules r = content.rules;
        int extra = Math.max(0, realm.size() - r.colonizeFreeTerritories);
        int discount = colonizationValue();
        for (Res x : Res.values()) cost.put(x, r.colonizeCostPerPlayer.get(x) + extra * r.colonizeEscalationPerPlayer.get(x));
        for (Res x : List.of(Res.PRODUCTION, Res.FOOD)) {
            int c = Math.min(discount, cost.get(x));
            cost.put(x, cost.get(x) - c);
            discount -= c;
        }
        cost.replaceAll((x, v) -> v * n);
        return discounted(cost);
    }

    /** Lasting discounts on settling (e.g. the Great Lighthouse), off the land's whole cost. */
    private EnumMap<Res, Integer> discounted(EnumMap<Res, Integer> cost) {
        civMods().settleDiscount.forEach((r, v) -> cost.put(r, Math.max(0, cost.get(r) - v)));
        return cost;
    }

    /** Troops needed: the land's enemy strength plus a special land's own troop cost. Troops sent are spent. */
    public int settleTroops(Frontier f) {
        return f.enemy + f.land.def.armyPerPlayer * players.size();
    }

    /** Settlers needed: per player (special lands their own number, other lands the rule's), minus free settlers. */
    public int settleSettlers(Frontier f) {
        int per = f.land.def.special ? f.land.def.populationPerPlayer : content.rules.colonizeSettlersPerPlayer;
        return Math.max(0, per * players.size() - civMods().freeSettlers);
    }

    /** Military strength of a number of troops: Bronze Working adds 1 for every 2. */
    public int strength(int troops) {
        return troops + (troops / 2) * civMods().strengthPerTwoTroops;
    }

    /** A player's strength for settling lands: Bronze Working's bonus plus a leader like Julius Caesar's. */
    public int strength(Player p, int troops) {
        return troops + (troops / 2) * (civMods().strengthPerTwoTroops + mods(p).ownStrengthPerTwoTroops);
    }

    /** A player's strength in a raid or invasion: the above plus a leader's flat bonus (Gilgamesh). */
    public int fighting(Player p, int troops) {
        return strength(p, troops) + mods(p).strengthBonus;
    }

    /** The fewest troops whose strength reaches {@code needed}. */
    private int troopsFor(Player p, int needed) {
        int t = 0;
        while (strength(p, t) < needed) t++;
        return t;
    }

    /** What is still missing. */
    public EnumMap<Res, Integer> settleLeft(Frontier f) {
        EnumMap<Res, Integer> left = settleCost(f);
        left.replaceAll((r, v) -> Math.max(0, v - f.paid.get(r)));
        return left;
    }

    private record LandPayment(Frontier land, EnumMap<Res, Integer> res, int troops, int settlers) {}

    /**
     * Checks a payment toward a land (amounts capped at what is missing) without changing anything. {@code reserved}
     * is what the player also has to pay for the card itself.
     */
    private LandPayment landPayment(Player p, Map<String, Object> a, Map<Res, Integer> reserved) {
        return landPayment(p, a, reserved, false);
    }

    private LandPayment landPayment(Player p, Map<String, Object> a, Map<Res, Integer> reserved, boolean allowEmpty) {
        int id = Y.i(a, "land", -1);
        Frontier f = frontier.stream().filter(x -> x.land.id == id).findFirst()
                .orElseThrow(() -> new GameException("Choose a land to settle."));
        EnumMap<Res, Integer> give = Res.parse(a.get("resources"));
        int troops = Y.i(a, "army", 0), settlers = Y.i(a, "population", 0);
        if (troops < 0 || settlers < 0 || give.values().stream().anyMatch(v -> v < 0)) throw new GameException("Amounts can't be negative.");
        EnumMap<Res, Integer> left = settleLeft(f);
        give.replaceAll((r, v) -> Math.min(v, left.get(r)));
        troops = Math.min(troops, troopsFor(p, Math.max(0, settleTroops(f) - f.troopsPaid)));
        settlers = Math.min(settlers, Math.max(0, settleSettlers(f) - f.settlersPaid));
        for (Res r : Res.values()) {
            if (p.res.get(r) < give.get(r) + reserved.getOrDefault(r, 0)) throw new GameException("Not enough " + r.key() + ".");
        }
        if (troops > p.army - p.committed) throw new GameException("You have " + (p.army - p.committed) + " free troops.");
        if (settlers > p.population()) throw new GameException("You don't have that many people.");
        boolean done = Res.isZero(settleLeft(f)) && f.troopsPaid >= settleTroops(f) && f.settlersPaid >= settleSettlers(f);
        if (!allowEmpty && !done && Res.isZero(give) && troops == 0 && settlers == 0) throw new GameException("Send something the " + f.land.def.name + " still needs.");
        return new LandPayment(f, give, troops, settlers);
    }

    private void payLand(Player p, LandPayment lp) {
        Frontier f = lp.land();
        pay(p, lp.res());
        lp.res().forEach((r, v) -> f.paid.merge(r, v, Integer::sum));
        EnumMap<Res, Integer> mine = f.bySeat.computeIfAbsent(p.seat, x -> Res.empty());
        lp.res().forEach((r, v) -> mine.merge(r, v, Integer::sum));
        // troops sent count fully against the land's enemy strength, and all of them are lost in the fighting
        int troopsLost = lp.troops();
        p.army -= troopsLost;
        f.troopsPaid += strength(p, lp.troops());
        f.settlersPaid += lp.settlers();
        String what = Res.describe(lp.res()) + (lp.troops() > 0 ? ", " + lp.troops() + " troops (" + troopsLost + " lost)" : "") + (lp.settlers() > 0 ? ", " + lp.settlers() + " settlers" : "");
        log(p.name + " sends " + what + " toward the " + f.land.def.name + ".");
        if (lp.settlers() > 0) losePopulation(p, lp.settlers());
        if (Res.isZero(settleLeft(f)) && f.troopsPaid >= settleTroops(f) && f.settlersPaid >= settleSettlers(f)) {
            frontier.remove(f);
            realm.add(f.land);
            log("The " + f.land.def.name + " is settled and joins the realm! " + f.land.def.text);
            refillLands();
        }
    }

    /** Found lands that weren't settled in time are gone; nothing paid comes back. */
    private void loseFoundLands(int eventCard) {
        for (Frontier f : List.copyOf(frontier)) {
            if (!f.fromEvent || f.eventCard != eventCard) continue;
            frontier.remove(f);
            log("The " + f.land.def.name + " was not settled in time and is lost to the realm" + (Res.isZero(f.paid) && f.troopsPaid == 0 ? "." : "; what was sent is gone."));
        }
    }

    private Territory ownTerritory(Map<String, Object> a) {
        int id = Y.i(a, "territory", -1);
        Territory t = realm.stream().filter(x -> x.id == id).findFirst()
                .orElseThrow(() -> new GameException("Choose a territory of the realm."));
        if (t.cored) throw new GameException("The " + t.def.name + " is already a core territory.");
        return t;
    }

    /** An event (or Send Scouts) finds a land: it must be settled at once. */
    private void discover(TerritoryDef def) {
        Territory land;
        if (def.special) {
            land = new Territory(nextId++, def);
        } else {
            land = worldDeck.stream().filter(t -> t.def == def).findFirst().orElse(null);
            if (land == null) return;
            worldDeck.remove(land);
        }
        if (phase == Phase.EVENTS && pending != null) {
            frontier.add(new Frontier(land, true, pending.event.id));
            log("Found: " + def.name + " (" + def.text + "). Settle it before this event is resolved, or it is lost.");
        } else {
            frontier.add(new Frontier(land, false, -1));
            log("Scouts find the " + def.name + " (" + def.text + "). It lies face up until settled.");
        }
    }

    private void loseTerritory(Territory t) {
        if (t.cored) {
            t.cored = false;
            log("The " + t.def.name + " holds, but loses its core status.");
            return;
        }
        realm.remove(t);
        for (WonderDef w : t.wonders) builtWonders.remove(w);
        log("The " + t.def.name + " is lost" + (t.wonders.isEmpty() ? "!" : ", and with it " + String.join(", ", t.wonders.stream().map(w -> w.name).toList()) + "!"));
        for (Player p : players) {
            for (Building b : p.buildings) {
                int cap = capacity(p, b.def.id);
                if (b.slots > cap) log(p.name + "'s " + b.def.name + " is above what the land allows: " + (b.slots - Math.max(0, cap)) + " slots are inactive until there is room again.");
            }
        }
    }

    private void give(Player p, Map<String, Object> a) {
        Player to = other(p, a);
        EnumMap<Res, Integer> amt = Res.parse(a.get("resources"));
        int troops = Y.i(a, "army", 0);
        if (troops < 0 || troops > p.army - p.committed) throw new GameException("You have " + (p.army - p.committed) + " free troops.");
        pay(p, amt);
        amt.forEach((r, v) -> to.res.merge(r, v, Integer::sum));
        p.army -= troops;
        to.army += troops;
        log(p.name + " gives " + Res.describe(amt) + (troops > 0 ? " and " + troops + " troops" : "") + " to " + to.name + ".");
    }

    /** Giving cards needs Roman Roads: up to that many cards to one teammate for 1 action. */
    private void giveCards(Player p, Map<String, Object> a) {
        int most = mods(p).giveCards;
        if (most <= 0) throw new GameException("Giving cards needs the Roman Roads.");
        Player to = other(p, a);
        List<CardInst> cards = new ArrayList<>();
        for (Object o : Y.list(a.get("cards"))) {
            int id = Y.toInt(o);
            CardInst c = p.hand.stream().filter(x -> x.id == id).findFirst().orElseThrow(() -> new GameException("That card isn't in your hand."));
            if (!cards.contains(c)) cards.add(c);
        }
        if (cards.isEmpty()) throw new GameException("Choose the cards to give.");
        if (cards.size() > most) throw new GameException("You can give at most " + most + " cards per action.");
        p.hand.removeAll(cards);
        to.hand.addAll(cards);
        log(p.name + " sends " + plural(cards.size(), "card") + " along the roads to " + to.name + ".");
    }

    private Player other(Player p, Map<String, Object> a) {
        int to = Y.i(a, "to", -1);
        if (to < 0 || to >= players.size() || to == p.seat) throw new GameException("Pick another player.");
        return players.get(to);
    }

    private void deposit(Player p, Map<String, Object> a) {
        if (!civMods().sharedPool) throw new GameException("There is no shared pool yet.");
        EnumMap<Res, Integer> amt = Res.parse(a.get("resources"));
        pay(p, amt);
        amt.forEach((r, v) -> pool.merge(r, v, Integer::sum));
        log(p.name + " puts " + Res.describe(amt) + " in the shared pool.");
    }

    private void withdraw(Player p, Map<String, Object> a) {
        if (!civMods().sharedPool) throw new GameException("There is no shared pool yet.");
        EnumMap<Res, Integer> amt = Res.parse(a.get("resources"));
        payFromPool(amt);
        amt.forEach((r, v) -> p.res.merge(r, v, Integer::sum));
        log(p.name + " takes " + Res.describe(amt) + " from the shared pool.");
    }

    private void discard(Player p, Map<String, Object> a) {
        CardInst c = handCard(p, a);
        p.hand.remove(c);
        log(p.name + " discards " + c.def.name + ".");
    }

    private void pay(Player p, Map<Res, Integer> cost) {
        for (Map.Entry<Res, Integer> e : cost.entrySet()) {
            if (e.getValue() < 0) throw new GameException("Amounts can't be negative.");
            if (p.res.get(e.getKey()) < e.getValue()) throw new GameException("Not enough " + e.getKey().key() + " (needs " + Res.describe(cost) + ").");
        }
        cost.forEach((r, v) -> p.res.merge(r, -v, Integer::sum));
    }

    private void payFromPool(Map<Res, Integer> cost) {
        for (Map.Entry<Res, Integer> e : cost.entrySet()) {
            if (e.getValue() < 0) throw new GameException("Amounts can't be negative.");
            if (pool.get(e.getKey()) < e.getValue()) throw new GameException("Not enough " + e.getKey().key() + " in the shared pool.");
        }
        cost.forEach((r, v) -> pool.merge(r, -v, Integer::sum));
    }

    // ------------------------------------------------------------------------------------------------ responses

    private Pending pendingFor(Player p) {
        if (phase != Phase.EVENTS || pending == null) throw new GameException("No event is waiting for responses.");
        if (Boolean.TRUE.equals(pending.ready.get(p.seat))) throw new GameException("You have already passed on this event.");
        return pending;
    }

    private void respond(Player p, Map<String, Object> a) {
        Pending pe = pendingFor(p);
        CardInst c = handCard(p, a);
        if (!responds(c.def, pe.event.def)) throw new GameException(c.def.name + " doesn't work against " + pe.event.def.name + ".");
        pay(p, c.def.cost);
        p.hand.remove(c);
        for (Map<String, Object> e : c.def.effects) {
            String k = Effects.key(e);
            Object v = e.get(k);
            switch (k) {
                case "defense" -> pe.defenseBonus += Y.toInt(v);
                case "healthBonus" -> pe.healthBonus += Y.toInt(v);
                case "halve" -> pe.halve = true;
                case "cancel" -> pe.cancel = true;
                default -> applyImmediate(List.of(e), List.of(p), p, 1.0, false);
            }
        }
        pe.responses.add(p.name + ": " + c.def.name);
        log(p.name + " responds with " + c.def.name + ".");
    }

    private void troops(Player p, Map<String, Object> a) {
        Pending pe = pendingFor(p);
        if (!"invasion".equals(pe.event.def.kind)) throw new GameException("Troops can only be sent against an invasion.");
        int n = Y.i(a, "troops", 0);
        if (n < 0 || n > p.army - p.committed) throw new GameException("You have " + (p.army - p.committed) + " troops free.");
        pe.troops.put(p.seat, n);
    }

    private void decide(Player p, Map<String, Object> a) {
        Pending pe = pendingFor(p);
        if (!"opportunity".equals(pe.event.def.kind) || pe.target != p.seat) throw new GameException("This choice isn't yours.");
        pe.accept = Y.b(a, "accept");
    }

    private void ready(Player p) {
        pendingFor(p).ready.put(p.seat, true);
        maybeResolve();
    }

    private void maybeResolve() {
        if (pending == null || pending.ready.values().contains(false)) return;
        resolvePending();
        openNextEvent();
    }

    /** Marks a player as (dis)connected. Away players' turns and responses are passed automatically. */
    public void setAway(int seat, boolean away) {
        Player p = players.get(seat);
        if (p.away == away) return;
        p.away = away;
        if (result == null && away) {
            if (phase == Phase.TURNS && !p.done) {
                endRoundFor(p);
            } else if (phase == Phase.EVENTS && pending != null) {
                pending.ready.put(seat, true);
                maybeResolve();
            } else if (phase == Phase.STARVATION && starving.containsKey(seat)) {
                losePopulation(p, starving.remove(seat));
                starvationDone();
            }
        }
        version++;
    }

    // ------------------------------------------------------------------------------------------------ resolving events

    private void resolvePending() {
        Pending pe = pending;
        CardInst ev = pe.event;
        CardDef d = ev.def;
        if (!pe.fromCrisis) drawnIndex++;
        if (pe.cancel) {
            loseFoundLands(ev.id);
            log(d.name + " is averted.");
            if (!d.helper) pastEvents.add(ev);
            return;
        }
        if (d.lasts()) {
            // a lasting crisis: it starts now and acts again every round until it ends
            log("CRISIS IN EFFECT: " + d.name + " — " + d.text);
            ActiveCrisis c = new ActiveCrisis(ev);
            crises.add(c);
            tickCrisis(c);
            checkDefeat();
            return;
        }
        double factor = 1.0;
        if (pe.halve) factor *= 0.5;
        if (civMods().mitigate.contains(d.category) || civMods().mitigate.contains(d.id)) {
            factor *= 0.5;
            log("Your knowledge softens " + d.name + ".");
        }
        List<Player> targets = pe.target >= 0 ? List.of(players.get(pe.target)) : players;
        switch (d.kind) {
            case "raid" -> raid(pe, players.get(pe.target), factor);
            case "invasion" -> invasion(pe, factor);
            case "test" -> {
                int value = ("stability".equals(d.stat) ? stability : health) + pe.healthBonus;
                int shortfall = Math.max(0, d.threshold - value);
                int times = (int) Math.floor(shortfall * factor);
                log(d.name + ": " + d.stat + " " + value + " against " + d.threshold
                        + (shortfall == 0 ? " — the civilization withstands it." : " — " + times + " times its losses."));
                for (int i = 0; i < times; i++) applyImmediate(d.perShortfall, targets, null, 1.0, "civ".equals(d.target));
                if (shortfall == 0) applyImmediate(d.effects, targets, null, 1.0, "civ".equals(d.target));
            }
            case "opportunity" -> {
                Player t = players.get(pe.target);
                boolean canPay = true;
                for (Res r : Res.values()) if (t.res.get(r) < d.offerCost.get(r)) canPay = false;
                if (Boolean.TRUE.equals(pe.accept) && canPay) {
                    pay(t, d.offerCost);
                    log(t.name + " accepts: pays " + Res.describe(d.offerCost) + ".");
                    applyImmediate(d.effects, List.of(t), t, 1.0, false);
                } else {
                    log(t.name + " lets the opportunity pass.");
                }
            }
            default -> applyImmediate(d.effects.stream().filter(x -> !x.containsKey("discover")).toList(), targets, null, factor, "civ".equals(d.target));
        }
        loseFoundLands(ev.id);
        if (d.eraTrigger && era().cards.containsKey(d.id)) {
            eraEnding = true;
            log(d.name + ": this era will end at the end of the round.");
        }
        if (d.persistent) {
            persistentEvents.add(ev);
            log(d.name + " lingers until lifted (" + Res.describe(d.cleanseCost) + ").");
        } else if (!d.helper) {
            pastEvents.add(ev);
        }
        checkDefeat();
    }

    /** One round of a lasting crisis: its stage for this round plus its every-round effects, then the end check. */
    private void tickCrisis(ActiveCrisis c) {
        CardDef d = c.card.def;
        if (crisisOver(c)) {
            endCrisis(c);
            return;
        }
        List<Map<String, Object>> now = new ArrayList<>();
        if (c.roundsDone < d.stages.size()) now.addAll(d.stages.get(c.roundsDone));
        now.addAll(d.everyRound);
        c.roundsDone++;
        double factor = civMods().mitigate.contains(d.category) || civMods().mitigate.contains(d.id) ? 0.5 : 1.0;
        log(d.name + ", round " + c.roundsDone + " of " + d.lastsRounds + (factor < 1 ? " (softened by your knowledge)" : "") + ".");
        List<Player> targets = "one".equals(d.target) ? List.of(players.get(rng.nextInt(players.size()))) : players;
        applyImmediate(now, targets, null, factor, "civ".equals(d.target));
        if (crisisOver(c)) endCrisis(c);
    }

    private boolean crisisOver(ActiveCrisis c) {
        CardDef d = c.card.def;
        if (c.roundsDone >= d.lastsRounds) return true;
        Object h = d.endWhen.get("health");
        if (h != null && health >= Y.toInt(h)) return true;
        Object st = d.endWhen.get("stability");
        return st != null && stability >= Y.toInt(st);
    }

    private void endCrisis(ActiveCrisis c) {
        if (!crises.remove(c)) return;
        pastEvents.add(c.card);
        log("The crisis " + c.card.def.name + " is over.");
    }

    /** Total military strength the players could field now (free troops) plus team-wide invasion defense. */
    public int teamStrength() {
        int s = civMods().invasionDefense;
        for (Player p : players) s += fighting(p, Math.max(0, p.army - p.committed));
        return s;
    }

    private void raid(Pending pe, Player t, double factor) {
        CardDef d = pe.event.def;
        int defense = fighting(t, Math.max(0, t.army - t.committed)) + mods(t).raidDefense + pe.defenseBonus;
        int s = pe.strength;
        // the troops that fight (up to the raid's strength) are spent; half of them, rounded up, are lost
        int spent = Math.min(Math.max(0, t.army - t.committed), s);
        int lost = (spent + 1) / 2;
        if (defense >= s) {
            t.army -= lost;
            log(t.name + " drives off " + d.name + " (defense " + defense + " vs " + s + ")" + (lost > 0 ? ", losing " + lost + " troops." : "."));
            return;
        }
        int shortfall = s - defense;
        int times = (int) Math.floor(shortfall * factor);
        t.army -= lost;
        log(d.name + " overwhelms " + t.name + " (defense " + defense + " vs " + s + "): " + times + " times its losses"
                + (lost > 0 ? ", " + lost + " troops lost." : "."));
        for (int i = 0; i < times; i++) applyImmediate(d.perShortfall, List.of(t), null, 1.0, false);
        if (times > 0) {
            stability--;
            log("The raid shakes the civilization. Stability -1 (now " + stability + ").");
        }
    }

    private void invasion(Pending pe, double factor) {
        CardDef d = pe.event.def;
        if (threat > 0) {
            log("The " + threat + " massed enemies join the invasion.");
            threat = 0;
        }
        int sent = pe.troops.values().stream().mapToInt(Integer::intValue).sum();
        int total = pe.troops.entrySet().stream().mapToInt(en -> fighting(players.get(en.getKey()), en.getValue())).sum() + pe.defenseBonus + civMods().invasionDefense;
        int s = pe.strength;
        pe.troops.forEach((seat, n) -> players.get(seat).committed += n);
        // the troops spent (up to the invasion's strength) lose half, rounded up, split between the senders
        int spent = Math.min(sent, s);
        int casualties = (spent + 1) / 2;
        distributeCasualties(pe.troops, casualties, sent);
        if (total >= s) {
            log("The united army (" + total + ") repels " + d.name + " (" + s + "), losing " + casualties + " troops.");
            return;
        }
        int shortfall = s - total;
        int times = (int) Math.floor(shortfall * factor);
        log(d.name + " (" + s + ") breaks through the defenders (" + total + "): " + casualties + " troops lost, " + times + " times its losses.");
        for (int i = 0; i < times; i++) applyImmediate(d.perShortfall, players, null, 1.0, true);
        if (!realm.isEmpty()) loseTerritory(realm.get(rng.nextInt(realm.size())));
        if (times > 0) {
            stability -= 2;
            log("The invasion shakes the civilization. Stability -2 (now " + stability + ").");
        }
    }

    /** Splits casualties between senders in proportion to the troops each sent (largest remainder). */
    private void distributeCasualties(Map<Integer, Integer> troops, int casualties, int sent) {
        if (sent == 0 || casualties == 0) return;
        Map<Integer, Integer> loss = new LinkedHashMap<>();
        int given = 0;
        for (Map.Entry<Integer, Integer> e : troops.entrySet()) {
            int l = e.getValue() * casualties / sent;
            loss.put(e.getKey(), l);
            given += l;
        }
        List<Integer> order = new ArrayList<>(troops.keySet());
        order.sort((x, y) -> Double.compare(frac(troops.get(y), casualties, sent), frac(troops.get(x), casualties, sent)));
        for (int i = 0; given < casualties && i < order.size(); i++, given++) loss.merge(order.get(i), 1, Integer::sum);
        loss.forEach((seat, l) -> players.get(seat).army -= Math.min(l, players.get(seat).army));
    }

    private static double frac(int n, int casualties, int sent) {
        double x = n * (double) casualties / sent;
        return x - Math.floor(x);
    }

    // ------------------------------------------------------------------------------------------------ effects

    /**
     * Applies immediate effects. Losses are multiplied by {@code factor} (rounded down). With {@code civWide},
     * Population losses are spread over the civilization (largest first) instead of hitting each target.
     */
    private void applyImmediate(List<Map<String, Object>> effects, List<Player> targets, Player actor, double factor, boolean civWide) {
        for (Map<String, Object> e : effects) {
            String k = Effects.key(e);
            Object v = e.get(k);
            switch (k) {
                case "gain" -> {
                    EnumMap<Res, Integer> m = Res.parse(v);
                    for (Player p : targets) m.forEach((r, n) -> p.res.merge(r, n, Integer::sum));
                    log(names(targets) + " gain " + Res.describe(m) + ".");
                }
                case "lose" -> {
                    EnumMap<Res, Integer> m = Res.parse(v);
                    m.replaceAll((r, n) -> (int) Math.floor(n * factor));
                    for (Player p : targets) m.forEach((r, n) -> p.res.put(r, Math.max(0, p.res.get(r) - n)));
                    if (!Res.isZero(m)) log(names(targets) + " lose " + Res.describe(m) + ".");
                }
                case "population" -> {
                    int n = Y.toInt(v);
                    if (n >= 0) {
                        for (Player p : targets) addPopulation(p, n);
                        log(names(targets) + " gain " + n + " Population.");
                    } else {
                        int loss = (int) Math.floor(-n * factor);
                        if (loss == 0) break;
                        if (civWide) {
                            for (int i = 0; i < loss; i++) {
                                Player most = players.stream().max((a, b) -> a.population() - b.population()).orElseThrow();
                                if (most.population() == 0) break;
                                losePopulation(most, 1);
                            }
                            log("The civilization loses " + loss + " Population.");
                        } else {
                            for (Player p : targets) losePopulation(p, loss);
                            log(names(targets) + " lose " + loss + " Population.");
                        }
                    }
                }
                case "army" -> {
                    int n = Y.toInt(v);
                    if (n < 0) n = -(int) Math.floor(-n * factor);
                    for (Player p : targets) p.army = Math.max(0, p.army + n);
                    if (n != 0) log(names(targets) + (n > 0 ? " gain " : " lose ") + Math.abs(n) + " troops.");
                }
                case "stability" -> {
                    int n = Y.toInt(v);
                    if (n < 0) n = -(int) Math.floor(-n * factor);
                    stability += n;
                    if (n != 0) log("Stability " + (n > 0 ? "+" : "") + n + " (now " + stability + ").");
                }
                case "health" -> {
                    int n = Y.toInt(v);
                    if (n < 0) n = -(int) Math.floor(-n * factor);
                    health = Math.max(0, health + n);
                    if (n != 0) log("Health " + (n > 0 ? "+" : "") + n + " (now " + health + ").");
                }
                case "draw" -> {
                    for (Player p : actor == null ? targets : List.of(actor)) for (int i = 0; i < Y.toInt(v); i++) drawFromEraDeck(p);
                }
                case "extraActions" -> {
                    if (actor != null && phase == Phase.TURNS) actor.actions += Y.toInt(v);
                }
                case "addCrisis" -> addCrisis(String.valueOf(v));
                case "threat" -> {
                    threat += Y.toInt(v);
                    log("+" + Y.toInt(v) + " enemies massing (now " + threat + ").");
                }
                case "invadeIfStronger" -> {
                    int team = teamStrength();
                    if (threat > team) {
                        log("The massing enemies (" + threat + ") outnumber the tribe's strength (" + team + "): they invade!");
                        attacks.add(new Attack(inst(content.cards.get(String.valueOf(v))), -1, 0));
                    }
                }
                case "raidAll" -> {
                    Map<String, Object> m = Y.map(v);
                    CardDef raid = content.cards.get(Y.s(m, "card", ""));
                    for (Player p : players) attacks.add(new Attack(inst(raid), p.seat, Y.i(m, "strength", raid.strengthBase)));
                    log(raid.name + " strike every player.");
                }
                case "invasion" -> attacks.add(new Attack(inst(content.cards.get(String.valueOf(v))), -1, 0));
                case "healthTest" -> {
                    Map<String, Object> m = Y.map(v);
                    int shortfall = Math.max(0, Y.i(m, "threshold", 0) - health);
                    int loss = (int) Math.floor(shortfall * Y.i(m, "populationLoss", 1) * factor);
                    log("Health " + health + " against " + Y.i(m, "threshold", 0) + (loss == 0 ? ": no one dies." : ": " + loss + " Population lost."));
                    for (int i = 0; i < loss; i++) {
                        Player most = players.stream().max((x, y) -> x.population() - y.population()).orElseThrow();
                        if (most.population() == 0) break;
                        losePopulation(most, 1);
                    }
                }
                case "enemy" -> {
                    Map<String, Object> m = Y.map(v);
                    int each = Y.i(m, "each", 0), one = Y.i(m, "one", 0);
                    if (frontier.isEmpty()) break;
                    if (each > 0) {
                        for (Frontier f : frontier) f.enemy += each;
                        log("Every face-up land gains " + each + " enemy strength.");
                    }
                    if (one > 0) {
                        Frontier f = frontier.get(rng.nextInt(frontier.size()));
                        f.enemy += one;
                        log("The " + f.land.def.name + " gains " + one + " enemy strength (now " + f.enemy + ").");
                    }
                }
                case "removeLand" -> {
                    List<Frontier> faceUp = frontier.stream().filter(f -> !f.fromEvent && !f.opened).toList();
                    for (int i = 0; i < Y.toInt(v) && !faceUp.isEmpty(); i++) {
                        Frontier f = faceUp.get(rng.nextInt(faceUp.size()));
                        frontier.remove(f);
                        log("The " + f.land.def.name + " is claimed by others" + (Res.isZero(f.paid) && f.troopsPaid == 0 ? "." : "; what was sent toward it is lost."));
                        faceUp = frontier.stream().filter(x -> !x.fromEvent && !x.opened).toList();
                    }
                    refillLands();
                }
                case "discover" -> {
                    if (v instanceof Number num) {
                        for (int i = 0; i < num.intValue() && !worldDeck.isEmpty(); i++) discover(worldDeck.get(0).def);
                    } else {
                        TerritoryDef t = content.territories.get(String.valueOf(v));
                        if (t != null) discover(t);
                    }
                }
                case "civilWar" -> {
                    List<Territory> cores = realm.stream().filter(t -> t.cored).toList();
                    List<Territory> pool = cores.isEmpty() ? realm : cores;
                    log("Civil war breaks out!");
                    if (!pool.isEmpty()) loseTerritory(pool.get(rng.nextInt(pool.size())));
                }
                case "colony" -> {
                    for (int i = 0; i < Y.toInt(v) && !worldDeck.isEmpty(); i++) {
                        Territory land = worldDeck.remove(0);
                        Frontier f = new Frontier(land, false, -1);
                        f.opened = true;
                        frontier.add(f);
                        log("A free colony: the " + land.def.name + " (" + land.def.text + ") is open for settling. Anyone can send resources, troops and settlers to it (1 action each).");
                    }
                    refillLands();
                }
                case "destroyBuilding" -> {
                    int n = (int) Math.floor(Y.toInt(v) * factor);
                    for (Player p : targets) {
                        for (int i = 0; i < n && !p.buildings.isEmpty(); i++) {
                            // the building with the fewest workers loses a level (its slots); workers without a slot go idle
                            Building b = p.buildings.stream().min((x, y) -> x.workers - y.workers).orElseThrow();
                            b.slots -= b.def.slots;
                            int out = Math.max(0, b.workers - Math.max(0, b.slots));
                            b.workers -= out;
                            p.idle += out;
                            if (b.slots <= 0) {
                                p.buildings.remove(b);
                                log(p.name + "'s " + b.def.name + " is destroyed" + (out > 0 ? "; its workers are idle." : "."));
                            } else {
                                log(p.name + "'s " + b.def.name + " is damaged: down to " + b.slots + " worker slots" + (out > 0 ? "; " + out + " workers are idle." : "."));
                            }
                        }
                    }
                }
                case "freeBuilding" -> {
                    BuildingDef b = content.buildings.get(String.valueOf(v));
                    for (Player p : targets) addBuilding(p, b); // only where the land has room
                    log(names(targets) + " get a free " + b.name + " level.");
                }
                default -> { /* lasting and response effects are handled elsewhere */ }
            }
        }
    }

    private String names(List<Player> ps) {
        if (ps.size() == players.size() && ps.size() > 1) return "All players";
        return String.join(", ", ps.stream().map(p -> p.name).toList());
    }

    private void addCrisis(String which) {
        CardInst c = null;
        if ("random".equals(which) || which.isBlank()) {
            if (!crisisPile.isEmpty()) c = crisisPile.remove(0);
        } else {
            for (CardInst x : crisisPile) if (x.def.id.equals(which)) c = x;
            if (c != null) crisisPile.remove(c);
            else if (content.cards.containsKey(which)) c = inst(content.cards.get(which));
        }
        if (c == null) return;
        futureEvents.add(c);
        log("CRISIS: " + c.def.name + " is added to the future deck!");
    }

    /** Builds a building, or adds a level (more worker slots) to the one of that type the player already has. */
    private Building addBuilding(Player p, BuildingDef def) {
        Building b = p.ofType(def.id);
        int room = capacity(p, def.id) - (b == null ? 0 : b.slots);
        if (room <= 0) return b;
        if (b != null) {
            b.slots += Math.min(def.slots, room);
            return b;
        }
        b = new Building(nextId++, def);
        b.slots = Math.min(def.slots, room);
        p.buildings.add(b);
        return b;
    }

    /** New Population fills free worker slots (first building first), the rest is idle. */
    /** The building a player chose for the person a card brings (set while that card is played). */
    private Building popInto;
    private Player popFor;

    private void addPopulation(Player p, int n) {
        for (int i = 0; i < n; i++) {
            Building free = null;
            if (popInto != null && popFor == p && popInto.workers < activeSlots(p, popInto)) free = popInto;     // the building the player chose
            if (free == null) free = p.buildings.stream().filter(b -> b.workers < activeSlots(p, b)).findFirst().orElse(null);
            if (free != null) free.workers++; else p.idle++;
        }
    }

    private void losePopulation(Player p, int n) {
        boolean had = p.population() > 0;
        for (int i = 0; i < n; i++) {
            if (p.idle > 0) {
                p.idle--;
                continue;
            }
            Building b = p.buildings.stream().max((x, y) -> x.workers - y.workers).orElse(null);
            if (b == null || b.workers == 0) break;
            b.workers--;
        }
        if (had && p.population() == 0) {
            stability--;
            log(p.name + "'s people are gone. Stability -1 (now " + stability + ").");
            addCrisis("random");
        }
    }

    // ------------------------------------------------------------------------------------------------ queries

    /** Technologies are global: every player gets the lasting effects of every tech researched by anyone. */
    public Mods mods(Player p) {
        Mods m = new Mods();
        for (Player o : players) for (CardDef t : o.techs) m.add(t.effects);
        for (CardDef w : p.minorWonders) m.add(w.effects);
        if (p.leader != null) m.add(p.leader.effects);
        for (WonderDef w : builtWonders) if (!obsolete(w)) m.add(w.effects);
        for (CardInst e : persistentEvents) m.add(e.def.ongoing);
        for (Territory t : realm) m.add(t.def.effects);
        return m;
    }

    /** Lasting effects that any player has, for team-wide things (shared pool, mitigations). */
    public Mods civMods() {
        Mods m = new Mods();
        for (Player p : players) {
            for (CardDef t : p.techs) m.add(t.effects);
            for (CardDef w : p.minorWonders) m.add(w.effects);
        }
        for (WonderDef w : builtWonders) if (!obsolete(w)) m.add(w.effects);
        for (Territory t : realm) m.add(t.def.effects);
        return m;
    }

    /** A wonder that belongs to an earlier era's way of life (e.g. Nomadic Living) stops working after that era. */
    public boolean obsolete(WonderDef w) {
        if (w.obsoleteAfter == null) return false;
        for (int i = 0; i < content.eras.size(); i++) if (content.eras.get(i).id.equals(w.obsoleteAfter)) return eraIndex > i;
        return false;
    }

    public int handLimit(Player p) {
        return Math.max(0, content.rules.handLimit + mods(p).handLimit);
    }

    /** 1 point for every science (technology) card played. */
    public int sciencePoints;

    /** The final score: victory points from the great wonders the team built, +1 per territory of the realm. */
    public int score() {
        int vp = realm.size() + sciencePoints;
        for (WonderDef w : builtWonders) vp += w.victoryPoints;
        return vp;
    }

    private boolean checkDefeat() {
        if (result != null) return true;
        if (stability <= 0) {
            end("defeat", "Stability collapsed.");
            return true;
        }
        if (realm.isEmpty()) {
            end("defeat", "The last of the realm's land was lost.");
            return true;
        }
        if (players.stream().allMatch(p -> p.population() == 0)) {
            end("defeat", "No people are left.");
            return true;
        }
        return false;
    }

    private void end(String result, String reason) {
        this.result = result;
        this.endReason = reason;
        phase = Phase.OVER;
        pending = null;
        log((result.equals("victory") ? "VICTORY: " : "DEFEAT: ") + reason + " Score: " + score() + ".");
    }

    private static String plural(int n, String word) {
        return n + " " + word + (n == 1 ? "" : "s");
    }

    /** An event that resolved at once (no one could respond): shown to everyone as a pop-up. */
    public static final class Notice {
        public final int seq, target;
        public final CardInst card;
        public final List<String> lines;

        Notice(int seq, CardInst card, int target, List<String> lines) {
            this.seq = seq;
            this.card = card;
            this.target = target;
            this.lines = lines;
        }
    }

    public final List<Notice> notices = new ArrayList<>();
    private int noticeSeq;
    private List<String> collect;

    void log(String s) {
        if (collect != null) collect.add(s);
        log.add(s);
        if (log.size() > 400) log.remove(0);
    }
}
