package com.dawnofmankind.web;

import com.dawnofmankind.core.AiPlayer;
import com.dawnofmankind.core.Content;
import com.dawnofmankind.core.Game;
import com.dawnofmankind.core.GameException;
import com.dawnofmankind.core.View;
import java.io.IOException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

/** A room: up to 6 seats, a lobby, then one game. All methods are synchronized on the room. */
public final class Room {
    public static final int MAX_PLAYERS = 6;
    private static final SecureRandom RANDOM = new SecureRandom();

    /** One seat; the token is the seat's secret, kept in the player's browser so they can reconnect. */
    static final class Seat {
        final String token = newToken();
        String name;
        final Set<WebSocketSession> sessions = new CopyOnWriteArraySet<>();
        long disconnectedAt;
        /** A computer player: always "connected", moves on its own. */
        boolean ai;
        /** A site admin: may use the cheat button on great wonders. */
        boolean admin;

        Seat(String name) {
            this.name = name;
            disconnectedAt = System.currentTimeMillis();
        }

        private static String newToken() {
            byte[] b = new byte[16];
            RANDOM.nextBytes(b);
            return HexFormat.of().formatHex(b);
        }

        boolean connected() {
            return ai || !sessions.isEmpty();
        }
    }

    final String code;
    private final Content content;
    private final Function<Object, String> json;
    private final List<Seat> seats = new ArrayList<>();
    private final List<Map<String, Object>> chat = new ArrayList<>();
    private int host;
    private Game game;
    private long lastActivity = System.currentTimeMillis();
    private final ScheduledExecutorService timer;
    private final long aiDelayMillis;
    private final AiPlayer ai = new AiPlayer(RANDOM.nextLong());
    private boolean aiScheduled;

    Room(String code, Content content, Function<Object, String> json, ScheduledExecutorService timer, long aiDelayMillis) {
        this.code = code;
        this.content = content;
        this.json = json;
        this.timer = timer;
        this.aiDelayMillis = aiDelayMillis;
    }

    synchronized Seat join(String requestedName) {
        return join(requestedName, false);
    }

    synchronized Seat join(String requestedName, boolean admin) {
        if (game != null) throw new GameException("This game has already started.");
        if (seats.size() >= MAX_PLAYERS) throw new GameException("This room is full (" + MAX_PLAYERS + " players).");
        String name = cleanName(requestedName);
        String unique = name;
        for (int i = 2; nameTaken(unique); i++) unique = name + " " + i;
        Seat s = new Seat(unique);
        s.admin = admin;
        seats.add(s);
        touch();
        broadcast();
        return s;
    }

    private boolean nameTaken(String n) {
        return seats.stream().anyMatch(s -> s.name.equalsIgnoreCase(n));
    }

    static String cleanName(String n) {
        String s = n == null ? "" : n.replaceAll("[\\p{Cntrl}<>]", "").trim();
        if (s.length() > 24) s = s.substring(0, 24).trim();
        return s.isEmpty() ? "Player" : s;
    }

    synchronized int seatOf(String token) {
        for (int i = 0; i < seats.size(); i++) if (seats.get(i).token.equals(token)) return i;
        return -1;
    }

    synchronized void connect(int seat, WebSocketSession session) {
        Seat s = seats.get(seat);
        s.sessions.add(session);
        if (game != null) game.setAway(seat, false);
        touch();
        broadcast();
    }

    synchronized void disconnect(WebSocketSession session) {
        for (Seat s : seats) {
            if (s.sessions.remove(session) && !s.connected()) s.disconnectedAt = System.currentTimeMillis();
        }
        broadcast();
    }

    /** Handles one message from a seat: lobby commands, chat, or a game action. */
    synchronized void handle(int seat, Map<String, Object> msg) {
        if (seat < 0 || seat >= seats.size()) throw new GameException("You are not in this room.");
        touch();
        String type = String.valueOf(msg.getOrDefault("type", ""));
        switch (type) {
            case "chat" -> {
                String text = String.valueOf(msg.getOrDefault("text", "")).replaceAll("\\p{Cntrl}", " ").trim();
                if (text.isEmpty()) return;
                if (text.length() > 300) text = text.substring(0, 300);
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("from", seats.get(seat).name);
                m.put("text", text);
                m.put("at", System.currentTimeMillis());
                chat.add(m);
                if (chat.size() > 100) chat.remove(0);
            }
            case "start" -> {
                if (seat != host) throw new GameException("Only the host can start the game.");
                if (game != null) throw new GameException("The game has already started.");
                game = new Game(content, seats.stream().map(s -> s.name).toList(), RANDOM.nextLong(), true);
                game.journalOn = true;
                for (int i = 0; i < seats.size(); i++) if (!seats.get(i).connected()) game.setAway(i, true);
            }
            case "addAi" -> {
                if (seat != host) throw new GameException("Only the host can add AI players.");
                if (game != null) throw new GameException("AI players can only be added in the lobby.");
                if (seats.size() >= MAX_PLAYERS) throw new GameException("The room is full.");
                int n = 1;
                while (nameTaken("AI " + n)) n++;
                Seat s = new Seat("AI " + n);
                s.ai = true;
                seats.add(s);
            }
            case "kick" -> {
                if (seat != host) throw new GameException("Only the host can remove players.");
                if (game != null) throw new GameException("Players can only be removed in the lobby.");
                int who = ((Number) msg.getOrDefault("seat", -1)).intValue();
                if (who < 0 || who >= seats.size() || who == host) throw new GameException("Pick another player.");
                if (seats.get(who).ai) {
                    seats.remove(who);
                    if (who < host) host--;
                    break;
                }
                Seat gone = seats.remove(who);
                if (who < host) host--;
                for (WebSocketSession ws : gone.sessions) send(ws, Map.of("kind", "kicked"));
                gone.sessions.forEach(ws -> closeQuietly(ws));
            }
            case "leave" -> {
                if (game != null) throw new GameException("The game has started; just close the page to step away.");
                Seat gone = seats.remove(seat);
                if (seat == host) host = 0;
                else if (seat < host) host--;
                gone.sessions.forEach(ws -> closeQuietly(ws));
            }
            case "cheatMode" -> {
                if (!seats.get(seat).admin) throw new GameException("Only admins can do that.");
                if (game == null) throw new GameException("The game hasn't started yet.");
                game.setCheat(seat, Boolean.TRUE.equals(msg.get("on")));
            }
            case "cheatWonder" -> {
                if (!seats.get(seat).admin) throw new GameException("Only admins can do that.");
                if (game == null) throw new GameException("The game hasn't started yet.");
                game.cheatCompleteWonder(seat, String.valueOf(msg.getOrDefault("wonder", "")), msg.get("territory") instanceof Number n ? n.intValue() : -1);
            }
            default -> {
                if (game == null) throw new GameException("The game hasn't started yet.");
                game.act(seat, msg);
            }
        }
        broadcast();
        scheduleAi();
    }

    /** If an AI seat has something to do, it moves after a short pause, one move at a time, so people can follow. */
    private void scheduleAi() {
        if (aiScheduled || game == null || game.result != null) return;
        boolean anyone = false;
        for (int i = 0; i < seats.size(); i++) if (seats.get(i).ai && AiPlayer.needsToAct(game, i)) anyone = true;
        if (!anyone) return;
        aiScheduled = true;
        timer.schedule(this::aiStep, aiDelayMillis, TimeUnit.MILLISECONDS);
    }

    private synchronized void aiStep() {
        aiScheduled = false;
        if (game == null || game.result != null) return;
        for (int i = 0; i < seats.size(); i++) {
            if (!seats.get(i).ai || !AiPlayer.needsToAct(game, i)) continue;
            try {
                if (!ai.stepFor(game, i)) game.setAway(i, true);
            } catch (RuntimeException e) {
                game.setAway(i, true); // never let a stuck AI block the game
            }
            break;
        }
        broadcast();
        scheduleAi();
    }

    /** Called every few seconds: players gone longer than the grace period have their turns passed for them. */
    synchronized void tick(long now, long graceMillis) {
        if (game == null || game.result != null) return;
        boolean changed = game.tick();               // the pick time may have run out
        for (int i = 0; i < seats.size(); i++) {
            Seat s = seats.get(i);
            if (!s.ai && !s.connected() && now - s.disconnectedAt > graceMillis && !game.players.get(i).away) {
                game.setAway(i, true);
                changed = true;
            }
        }
        scheduleAi();
        if (!changed) return;
        // host passes to a connected player
        if (!seats.get(host).connected()) {
            for (int i = 0; i < seats.size(); i++) if (!seats.get(i).ai && seats.get(i).connected()) { host = i; break; }
        }
        broadcast();
    }

    synchronized boolean idleSince(long cutoff) {
        boolean anyone = seats.stream().anyMatch(x -> !x.ai && x.connected());
        return !anyone && lastActivity < cutoff;
    }

    /** Set once this game's journal has been saved for the admin. */
    boolean archived;

    synchronized boolean finished() {
        return game != null && game.result != null;
    }

    synchronized Map<String, Object> summary() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", code);
        m.put("players", seats.size());
        m.put("max", MAX_PLAYERS);
        m.put("started", game != null);
        return m;
    }

    private void touch() {
        lastActivity = System.currentTimeMillis();
    }

    synchronized void broadcast() {
        for (int i = 0; i < seats.size(); i++) {
            Seat s = seats.get(i);
            if (s.sessions.isEmpty()) continue;
            String text = json.apply(state(i));
            for (WebSocketSession ws : s.sessions) sendText(ws, text);
        }
    }

    /** Everything that happened, for the "Game log" download. Only players in the room may fetch it. */
    synchronized Map<String, Object> gameLog(String token) {
        if (seatOf(token) < 0) throw new GameException("You are not a player in this room.");
        if (game == null) throw new GameException("The game hasn't started yet.");
        return fullLog();
    }

    /** The journal of a started game, or null before the start. */
    synchronized Map<String, Object> fullLog() {
        if (game == null) return null;
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("format", "dawn-of-mankind game log");
        out.put("room", code);
        out.put("seed", game.seed);
        out.put("players", seats.stream().map(s -> Map.of("name", s.name, "ai", s.ai)).toList());
        out.put("result", game.result);
        out.put("endReason", game.endReason);
        out.put("roundsPlayed", game.round);
        out.put("finalScore", game.score());
        out.put("entries", List.copyOf(game.journal));
        return out;
    }

    synchronized void sendState(int seat, WebSocketSession ws) {
        sendText(ws, json.apply(state(seat)));
    }

    private Map<String, Object> state(int seat) {
        Map<String, Object> room = new LinkedHashMap<>();
        room.put("code", code);
        room.put("host", host);
        room.put("you", seat);
        room.put("admin", seat >= 0 && seat < seats.size() && seats.get(seat).admin);
        room.put("started", game != null);
        List<Object> ps = new ArrayList<>();
        for (int i = 0; i < seats.size(); i++) {
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("seat", i);
            p.put("name", seats.get(i).name);
            p.put("connected", seats.get(i).connected());
            p.put("ai", seats.get(i).ai);
            ps.add(p);
        }
        room.put("players", ps);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("kind", "state");
        out.put("room", room);
        out.put("chat", List.copyOf(chat));
        out.put("game", game == null ? null : View.of(game, seat));
        return out;
    }

    void send(WebSocketSession ws, Object msg) {
        sendText(ws, json.apply(msg));
    }

    private static void sendText(WebSocketSession ws, String text) {
        try {
            if (ws.isOpen()) ws.sendMessage(new TextMessage(text));
        } catch (IOException | IllegalStateException e) {
            closeQuietly(ws);
        }
    }

    private static void closeQuietly(WebSocketSession ws) {
        try {
            ws.close();
        } catch (IOException ignored) {
            // already gone
        }
    }
}
