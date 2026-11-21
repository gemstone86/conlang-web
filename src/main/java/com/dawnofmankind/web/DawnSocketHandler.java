package com.dawnofmankind.web;

import com.dawnofmankind.core.GameException;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * The live connection for one player in one room: {@code /dawn/ws?code=K7QWX&token=…}. The server sends the whole
 * state (as that player may see it) after every change; the browser sends actions as JSON, e.g.
 * {@code {"type":"pick","slot":2}}.
 */
public class DawnSocketHandler extends TextWebSocketHandler {
    private static final String ROOM = "dawn.room", SEAT = "dawn.seat", WRAPPED = "dawn.wrapped";
    private final RoomService rooms;

    public DawnSocketHandler(RoomService rooms) {
        this.rooms = rooms;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession raw) throws Exception {
        WebSocketSession ws = new ConcurrentWebSocketSessionDecorator(raw, 10_000, 1024 * 1024);
        URI uri = raw.getUri();
        Map<String, String> q = new LinkedHashMap<>();
        if (uri != null) UriComponentsBuilder.fromUri(uri).build().getQueryParams().forEach((k, v) -> q.put(k, v.isEmpty() ? "" : v.get(0)));
        Room room = rooms.find(q.get("code"));
        int seat = room == null ? -1 : room.seatOf(q.getOrDefault("token", ""));
        if (seat < 0) {
            ws.sendMessage(new TextMessage(rooms.json().writeValueAsString(Map.of("kind", "gone",
                    "message", room == null ? "That room no longer exists." : "You are not a player in this room."))));
            raw.close(CloseStatus.NORMAL);
            return;
        }
        raw.getAttributes().put(ROOM, room);
        raw.getAttributes().put(SEAT, q.get("token"));
        raw.getAttributes().put(WRAPPED, ws);
        room.connect(seat, ws);
    }

    @Override
    protected void handleTextMessage(WebSocketSession raw, TextMessage message) throws Exception {
        Room room = (Room) raw.getAttributes().get(ROOM);
        WebSocketSession ws = (WebSocketSession) raw.getAttributes().get(WRAPPED);
        if (room == null || ws == null) return;
        int seat = room.seatOf((String) raw.getAttributes().get(SEAT));
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> msg = rooms.json().readValue(message.getPayload(), Map.class);
            room.handle(seat, msg);
        } catch (GameException e) {
            room.send(ws, Map.of("kind", "error", "message", e.getMessage()));
            room.sendState(seat, ws);
        } catch (RuntimeException e) {
            room.send(ws, Map.of("kind", "error", "message", "That didn't work: " + e.getClass().getSimpleName()));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession raw, CloseStatus status) {
        Room room = (Room) raw.getAttributes().get(ROOM);
        WebSocketSession ws = (WebSocketSession) raw.getAttributes().get(WRAPPED);
        if (room != null && ws != null) room.disconnect(ws);
    }
}
