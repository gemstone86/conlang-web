package com.dawnofmankind.core;

import com.dawnofmankind.core.Content.BuildingDef;
import com.dawnofmankind.core.Content.CardDef;
import com.dawnofmankind.core.Content.CardType;
import com.dawnofmankind.core.Content.EraDef;
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

    public enum Phase { TURNS, EVENTS, OVER }

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
    public int round = 1;
    public int eraIndex = 0;
    public int firstPlayer = 0;
    public int currentPlayer = 0;
    public int actionsLeft;
    public int stability, health;

    public final List<CardInst> eraDeck = new ArrayList<>();
    public final List<Slot> queue = new ArrayList<>();
    public final List<CardInst> currentEvents = new ArrayList<>();
    public final List<CardInst> futureEvents = new ArrayList<>();
    public final List<CardInst> pastEvents = new ArrayList<>();
    public final List<CardInst> persistentEvents = new ArrayList<>();
    public final List<CardInst> crisisPile = new ArrayList<>();
    public final List<WonderProgress> greatWonders = new ArrayList<>();
    public final List<WonderDef> builtWonders = new ArrayList<>();
    public final EnumMap<Res, Integer> pool = Res.empty();

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
        for (int i = 0; i < names.size(); i++) {
            Player p = new Player(i, names.get(i));
            r.startResources.forEach((k, v) -> p.res.put(k, v));
            r.startWorkers.forEach((bid, workers) -> {
                Building b = new Building(nextId++, content.buildings.get(bid));
                b.workers = workers;
                p.buildings.add(b);
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
        log("The tribes gather. " + n + " events wait in the event deck.");
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
            for (int i = 0; i < copies; i++) (d.eraTrigger ? triggers : pool).add(inst(d));
        });
        int size = content.rules.deckBase + content.rules.deckPerPlayer * players.size() - triggers.size();
        List<CardInst> bag = new ArrayList<>();
        while (eraDeck.size() < size && !pool.isEmpty()) {
            if (bag.isEmpty()) {
                for (CardInst c : pool) bag.add(inst(c.def));
                Collections.shuffle(bag, rng);
            }
            eraDeck.add(bag.remove(bag.size() - 1));
        }
        // era-trigger events go into the bottom part of the deck: they can end the era early, but not at once
        for (CardInst t : triggers) {
            int from = eraDeck.size() * (100 - content.rules.eraTriggerBottomShare) / 100;
            eraDeck.add(from + rng.nextInt(eraDeck.size() - from + 1), t);
        }
        greatWonders.clear();
        for (String id : e.greatWonders) greatWonders.add(new WonderProgress(content.greatWonders.get(id)));
        queue.clear();
        refillQueue();
        log("The " + e.name + " era begins. Era deck: " + eraDeck.size() + " cards.");
    }

    private void advanceEra() {
        eraEnding = false;
        for (WonderProgress w : greatWonders) {
            if (w.done) continue;
            w.bySeat.forEach((seat, paid) -> paid.forEach((r, v) -> players.get(seat).res.merge(r, v / 2, Integer::sum)));
            if (!Res.isZero(w.paid)) log(w.def.name + " was not finished; half of what was paid is returned.");
        }
        if (eraIndex + 1 >= content.eras.size()) {
            end("victory", "The civilization endured to the end of the " + era().name + " era.");
            return;
        }
        log("The " + era().name + " era ends.");
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
        production();
        if (checkDefeat()) return;
        phase = Phase.TURNS;
        currentPlayer = firstPlayer;
        beginTurn();
    }

    private void production() {
        Mods anyone = civMods();
        for (Player p : players) {
            Mods m = mods(p);
            EnumMap<Res, Integer> gain = Res.empty();
            for (Building b : p.buildings) {
                b.def.perWorker.forEach((r, v) -> gain.merge(r, v * b.workers, Integer::sum));
                EnumMap<Res, Integer> bonus = m.perWorker.get(b.def.id);
                if (bonus != null) bonus.forEach((r, v) -> gain.merge(r, v * b.workers, Integer::sum));
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
                losePopulation(p, starve);
            }
            log(msg);
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

    private void beginTurn() {
        Player p = players.get(currentPlayer);
        actionsLeft = content.rules.actionsPerTurn + mods(p).actionsPerTurn;
        CardInst c = drawFromEraDeck(p);
        log(p.name + "'s turn." + (c == null ? " (The era deck is empty.)" : ""));
        if (p.away) endTurnInternal();
    }

    /** Draws for a player: events go to the future deck and the player draws again. Returns the card kept, or null. */
    private CardInst drawFromEraDeck(Player p) {
        while (!eraDeck.isEmpty()) {
            CardInst c = eraDeck.remove(0);
            if (c.def.isEvent()) {
                futureEvents.add(c);
                log(p.name + " drew the event " + c.def.name + "; it goes to the future deck.");
                continue;
            }
            p.hand.add(c);
            return c;
        }
        return null;
    }

    private void endTurnInternal() {
        int next = (currentPlayer + 1) % players.size();
        if (next == firstPlayer) {
            startEvents();
        } else {
            currentPlayer = next;
            beginTurn();
        }
    }

    private void startEvents() {
        phase = Phase.EVENTS;
        int n = Math.min(futureEvents.size(), currentEvents.size());
        drawn = new ArrayList<>(currentEvents.subList(0, n));
        currentEvents.subList(0, n).clear();
        eventsDrawnThisRound = n;
        drawnIndex = 0;
        log(plural(futureEvents.size(), "event") + " in the future deck: " + plural(n, "event") + " drawn from the event deck.");
        openNextEvent();
    }

    private void openNextEvent() {
        while (result == null) {
            if (drawnIndex >= drawn.size()) {
                finishEvents();
                return;
            }
            CardInst e = drawn.get(drawnIndex);
            CardDef d = e.def;
            int target = -1;
            if ("one".equals(d.target) || "raid".equals(d.kind) || "opportunity".equals(d.kind)) target = rng.nextInt(players.size());
            pending = new Pending(e, target, d.strength(players.size()));
            for (Player p : players) pending.ready.put(p.seat, p.away);
            log("Event: " + d.name + (target >= 0 ? " (" + players.get(target).name + ")" : "") + " — " + d.text);
            if (!needsResponses()) {
                resolvePending();
                continue;
            }
            return;
        }
    }

    /** True if anyone can do something about the pending event; otherwise it resolves at once. */
    private boolean needsResponses() {
        CardDef d = pending.event.def;
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

    private void endRound() {
        int k = Math.min(queue.size(), content.rules.removedPerRound(players.size()));
        for (int i = 0; i < k; i++) {
            Slot s = queue.remove(queue.size() - 1);
            if (s.card.def.isEvent()) {
                futureEvents.add(s.card);
                log(s.card.def.name + " leaves the bottom of the queue and goes to the future deck.");
            } else {
                log(s.card.def.name + " leaves the bottom of the queue.");
            }
        }
        refillQueue();
        for (Player p : players) p.committed = 0;
        if (eraEnding || eraDeck.isEmpty()) {
            if (!eraEnding) log("The era deck is exhausted.");
            advanceEra();
            if (result != null) return;
        }
        firstPlayer = (firstPlayer + 1) % players.size();
        round++;
        startRound();
    }

    private void refillQueue() {
        while (queue.size() < queueSize() && !eraDeck.isEmpty()) {
            CardInst c = eraDeck.remove(0);
            CardInst under = c.def.isEvent() && !eraDeck.isEmpty() ? eraDeck.remove(0) : null;
            queue.add(0, new Slot(c, under));
        }
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
            case "give" -> give(p, a);
            case "giveCard" -> giveCard(p, a);
            case "deposit" -> deposit(p, a);
            case "withdraw" -> withdraw(p, a);
            case "discard" -> discard(p, a);
            // event responses
            case "respond" -> respond(p, a);
            case "troops" -> troops(p, a);
            case "decide" -> decide(p, a);
            case "ready" -> ready(p);
            // turn
            case "endTurn" -> {
                myTurn(p);
                int limit = handLimit(p);
                if (p.hand.size() > limit) throw new GameException("Discard down to " + limit + " cards before ending your turn.");
                endTurnInternal();
            }
            default -> {
                myTurn(p);
                if (actionsLeft <= 0) throw new GameException("No actions left. End your turn.");
                switch (type) {
                    case "move" -> move(p, a);
                    case "build" -> build(p, a);
                    case "pick" -> pick(p, a);
                    case "play" -> play(p, a);
                    case "grow" -> grow(p);
                    case "recruit" -> recruit(p);
                    case "contribute" -> contribute(p, a);
                    case "cleanse" -> cleanse(p, a);
                    default -> throw new GameException("Unknown action: " + type);
                }
                actionsLeft--;
            }
        }
        version++;
    }

    private void myTurn(Player p) {
        if (phase != Phase.TURNS) throw new GameException("Wait for the events to be resolved.");
        if (p.seat != currentPlayer) throw new GameException("It is " + players.get(currentPlayer).name + "'s turn.");
    }

    private void move(Player p, Map<String, Object> a) {
        Object from = a.get("from"), to = a.get("to");
        boolean fromIdle = "idle".equals(String.valueOf(from)), toIdle = "idle".equals(String.valueOf(to));
        if (String.valueOf(from).equals(String.valueOf(to))) throw new GameException("Pick a different place to move the worker to.");
        Building fb = fromIdle ? null : p.building(Y.toInt(from));
        Building tb = toIdle ? null : p.building(Y.toInt(to));
        if (fromIdle ? p.idle == 0 : fb.workers == 0) throw new GameException("There is no worker there.");
        if (tb != null && tb.workers >= tb.def.slots) throw new GameException(tb.def.name + " has no free worker slot.");
        if (fromIdle) p.idle--; else fb.workers--;
        if (toIdle) p.idle++; else tb.workers++;
        log(p.name + " moves a worker " + (fromIdle ? "" : "from the " + fb.def.name + " ") + "to "
                + (toIdle ? "rest (idle)" : "the " + tb.def.name) + ".");
    }

    public EnumMap<Res, Integer> buildCost(Player p, BuildingDef b) {
        Mods m = mods(p);
        EnumMap<Res, Integer> cost = Res.empty();
        b.cost.forEach((r, v) -> cost.put(r, Math.max(0, v - (v > 0 ? m.buildDiscount.get(r) : 0))));
        return cost;
    }

    private void build(Player p, Map<String, Object> a) {
        String id = Y.s(a, "building", "");
        BuildingDef b = content.buildings.get(id);
        if (b == null || !b.buildable) throw new GameException("You can't build that.");
        pay(p, buildCost(p, b));
        p.buildings.add(new Building(nextId++, b));
        log(p.name + " builds a " + b.name + ".");
    }

    private void pick(Player p, Map<String, Object> a) {
        int i = Y.i(a, "slot", -1);
        if (i < 0 || i >= queue.size()) throw new GameException("No card in that queue slot.");
        Slot s = queue.remove(i);
        if (!s.card.def.isEvent()) {
            p.hand.add(s.card);
            log(p.name + " takes " + s.card.def.name + " from the queue.");
            return;
        }
        futureEvents.add(s.card);
        log(p.name + " takes on the event " + s.card.def.name + " (to the future deck) and gets the face-down card.");
        CardInst under = s.under;
        while (under != null && under.def.isEvent()) {
            futureEvents.add(under);
            log("The face-down card was the event " + under.def.name + "; it goes to the future deck.");
            under = eraDeck.isEmpty() ? null : eraDeck.remove(0);
        }
        if (under != null) p.hand.add(under);
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
        if (p.owns(d)) throw new GameException("You already have " + d.name + ".");
        pay(p, d.cost);
        p.hand.remove(c);
        if (d.type == CardType.TECH) p.techs.add(d);
        if (d.type == CardType.MINOR_WONDER) p.minorWonders.add(d);
        log(p.name + " plays " + d.name + ".");
        applyImmediate(d.effects, List.of(p), p, 1.0, false);
    }

    private void grow(Player p) {
        pay(p, content.rules.growthCost);
        addPopulation(p, 1);
        log(p.name + " grows by 1 Population.");
    }

    private void recruit(Player p) {
        pay(p, content.rules.recruitCost);
        p.army++;
        log(p.name + " trains 1 troop (army " + p.army + ").");
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
        if (w.paid.equals(cost)) {
            w.done = true;
            builtWonders.add(w.def);
            log("The great wonder " + w.def.name + " is complete! " + w.def.text);
            applyImmediate(w.def.effects, players, p, 1.0, false);
        }
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

    private void give(Player p, Map<String, Object> a) {
        Player to = other(p, a);
        EnumMap<Res, Integer> amt = Res.parse(a.get("resources"));
        pay(p, amt);
        amt.forEach((r, v) -> to.res.merge(r, v, Integer::sum));
        log(p.name + " gives " + Res.describe(amt) + " to " + to.name + ".");
    }

    private void giveCard(Player p, Map<String, Object> a) {
        Player to = other(p, a);
        CardInst c = handCard(p, a);
        p.hand.remove(c);
        to.hand.add(c);
        log(p.name + " gives a card to " + to.name + ".");
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
            if (phase == Phase.TURNS && currentPlayer == seat) {
                while (p.hand.size() > handLimit(p)) p.hand.remove(p.hand.size() - 1);
                endTurnInternal();
            } else if (phase == Phase.EVENTS && pending != null) {
                pending.ready.put(seat, true);
                maybeResolve();
            }
        }
        version++;
    }

    // ------------------------------------------------------------------------------------------------ resolving events

    private void resolvePending() {
        Pending pe = pending;
        CardInst ev = pe.event;
        CardDef d = ev.def;
        drawnIndex++;
        if (pe.cancel) {
            log(d.name + " is averted.");
            pastEvents.add(ev);
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
            default -> applyImmediate(d.effects, targets, null, factor, "civ".equals(d.target));
        }
        if (d.eraTrigger && era().cards.containsKey(d.id)) {
            eraEnding = true;
            log(d.name + ": this era will end at the end of the round.");
        }
        if (d.persistent) {
            persistentEvents.add(ev);
            log(d.name + " lingers until lifted (" + Res.describe(d.cleanseCost) + ").");
        } else {
            pastEvents.add(ev);
        }
        checkDefeat();
    }

    private void raid(Pending pe, Player t, double factor) {
        CardDef d = pe.event.def;
        int defense = Math.max(0, t.army - t.committed) + mods(t).raidDefense + pe.defenseBonus;
        int s = pe.strength;
        if (defense >= s) {
            int lost = Math.min(t.army - t.committed, s / Math.max(1, content.rules.raidCasualtyDivisor));
            t.army -= lost;
            log(t.name + " drives off " + d.name + " (defense " + defense + " vs " + s + ")" + (lost > 0 ? ", losing " + lost + " troops." : "."));
            return;
        }
        int shortfall = s - defense;
        int times = (int) Math.floor(shortfall * factor);
        int lost = (int) Math.ceil((t.army - t.committed) / 2.0);
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
        int sent = pe.troops.values().stream().mapToInt(Integer::intValue).sum();
        int total = sent + pe.defenseBonus;
        int s = pe.strength;
        pe.troops.forEach((seat, n) -> players.get(seat).committed += n);
        if (total >= s) {
            int casualties = Math.min(sent, (int) Math.ceil(s / (double) Math.max(1, content.rules.invasionCasualtyDivisor)));
            distributeCasualties(pe.troops, casualties, sent);
            log("The united army (" + total + ") repels " + d.name + " (" + s + "), losing " + casualties + " troops.");
            return;
        }
        pe.troops.forEach((seat, n) -> players.get(seat).army -= n);
        int shortfall = s - total;
        int times = (int) Math.floor(shortfall * factor);
        log(d.name + " (" + s + ") breaks through the defenders (" + total + "): every sent troop is lost, " + times + " times its losses.");
        for (int i = 0; i < times; i++) applyImmediate(d.perShortfall, players, null, 1.0, true);
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
                    if (actor != null && phase == Phase.TURNS && actor.seat == currentPlayer) actionsLeft += Y.toInt(v);
                }
                case "addCrisis" -> addCrisis(String.valueOf(v));
                case "destroyBuilding" -> {
                    int n = (int) Math.floor(Y.toInt(v) * factor);
                    for (Player p : targets) {
                        for (int i = 0; i < n && !p.buildings.isEmpty(); i++) {
                            Building b = p.buildings.stream().min((x, y) -> x.workers - y.workers).orElseThrow();
                            p.buildings.remove(b);
                            p.idle += b.workers;
                            log(p.name + "'s " + b.def.name + " is destroyed" + (b.workers > 0 ? "; its workers are idle." : "."));
                        }
                    }
                }
                case "freeBuilding" -> {
                    BuildingDef b = content.buildings.get(String.valueOf(v));
                    for (Player p : targets) p.buildings.add(new Building(nextId++, b));
                    log(names(targets) + " get a free " + b.name + ".");
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

    /** New Population fills free worker slots (first building first), the rest is idle. */
    private void addPopulation(Player p, int n) {
        for (int i = 0; i < n; i++) {
            Building free = p.buildings.stream().filter(b -> b.workers < b.def.slots).findFirst().orElse(null);
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

    public Mods mods(Player p) {
        Mods m = new Mods();
        for (CardDef t : p.techs) m.add(t.effects);
        for (CardDef w : p.minorWonders) m.add(w.effects);
        for (WonderDef w : builtWonders) m.add(w.effects);
        for (CardInst e : persistentEvents) m.add(e.def.ongoing);
        return m;
    }

    /** Lasting effects that any player has, for team-wide things (shared pool, mitigations). */
    public Mods civMods() {
        Mods m = new Mods();
        for (Player p : players) {
            for (CardDef t : p.techs) m.add(t.effects);
            for (CardDef w : p.minorWonders) m.add(w.effects);
        }
        for (WonderDef w : builtWonders) m.add(w.effects);
        return m;
    }

    public int handLimit(Player p) {
        return content.rules.handLimit + mods(p).handLimit;
    }

    /** The final score: victory points from the great wonders the team built. */
    public int score() {
        int vp = 0;
        for (WonderDef w : builtWonders) vp += w.victoryPoints;
        return vp;
    }

    private boolean checkDefeat() {
        if (result != null) return true;
        if (stability <= 0) {
            end("defeat", "Stability collapsed.");
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

    void log(String s) {
        log.add(s);
        if (log.size() > 400) log.remove(0);
    }
}
