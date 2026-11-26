package com.dawnofmankind.web;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import org.junit.jupiter.api.Test;

class RoomLanguageTest {
    @Test
    void onlyAnAdminCanGiveARoomTheMundanaLanguage() throws Exception {
        RoomService rooms = new RoomService(60, 30, 10, 900, Files.createTempDirectory("dawnlang").toString());
        try {
            assertEquals("mundana", rooms.room(rooms.create("Ann", true, "mundana").code()).language);
            assertNull(rooms.room(rooms.create("Bob", false, "mundana").code()).language, "ignored for a non-admin");
            assertNull(rooms.room(rooms.create("Ann", true, "klingon").code()).language, "unknown languages are ignored");
            assertNull(rooms.room(rooms.create("Ann", true).code()).language);
        } finally {
            rooms.stop();
        }
    }
}
