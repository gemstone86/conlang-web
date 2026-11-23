package com.dawnofmankind.web;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipInputStream;
import org.junit.jupiter.api.Test;

class GameLogArchiveTest {
    @Test
    void savedLogsAreHandedToTheAdminOnceAndThenDeleted() throws Exception {
        Path dir = Files.createTempDirectory("dawnlogs");
        RoomService rooms = new RoomService(60, 30, 10, 900, dir.toString());
        try {
            RoomService.Joined j = rooms.create("Ann", true);
            Room room = rooms.room(j.code());
            room.handle(0, Map.of("type", "start"));
            assertTrue(rooms.savedLogs().isEmpty());
            rooms.archive(room);
            assertEquals(1, rooms.savedLogs().size(), "the journal is saved to disk");
            rooms.archive(room);
            assertEquals(1, rooms.savedLogs().size(), "and only once");

            List<String> names = new ArrayList<>();
            try (ZipInputStream z = new ZipInputStream(new java.io.ByteArrayInputStream(rooms.collectLogs()))) {
                for (var e = z.getNextEntry(); e != null; e = z.getNextEntry()) names.add(e.getName());
            }
            assertEquals(1, names.size());
            assertTrue(names.get(0).contains(j.code()));
            assertTrue(rooms.savedLogs().isEmpty(), "downloaded logs are deleted");
        } finally {
            rooms.stop();
        }
    }
}
