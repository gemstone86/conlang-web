package com.eonweather.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** "Last edited" on the items of a list: only the items that changed (or are new) are stamped. */
class ListStampsTest {

    @SuppressWarnings("unchecked")
    private static Map<String, Object> byId(String json, long id) {
        for (Object o : (List<Object>) Json.parse(json)) if (((Number) ((Map<String, Object>) o).get("id")).longValue() == id) return (Map<String, Object>) o;
        throw new AssertionError("no item " + id);
    }

    @Test
    void onlyChangedAndNewItemsGetStamped() {
        String first = "[{\"id\":1,\"name\":\"Old road\",\"points\":[{\"x\":0.1,\"y\":0.2},{\"x\":0.3,\"y\":0.4}]},{\"id\":2,\"name\":\"Other\",\"points\":[{\"x\":0.5,\"y\":0.5},{\"x\":0.6,\"y\":0.6}]}]";
        // the first save from the app: items that were not stored before are new, so both are stamped
        String a = ListStamps.stamp("[]", first, "2026-11-17T08:00:00Z", "anna");
        assertEquals("2026-11-17T08:00:00Z", byId(a, 1).get("edited"));
        assertEquals("anna", byId(a, 2).get("editedBy"));

        // a later save: item 1 renamed, item 2 untouched (also when the page sends it back without the stamps), item 3 new
        String sent = "[{\"id\":1,\"name\":\"Renamed\",\"points\":[{\"x\":0.1,\"y\":0.2},{\"x\":0.3,\"y\":0.4}]},{\"id\":2,\"name\":\"Other\",\"points\":[{\"x\":0.5,\"y\":0.5},{\"x\":0.6,\"y\":0.6}]},{\"id\":3,\"name\":\"New\",\"points\":[{\"x\":0.7,\"y\":0.7},{\"x\":0.8,\"y\":0.8}]}]";
        String b = ListStamps.stamp(a, sent, "2026-11-18T09:30:00Z", "ben");
        assertEquals("2026-11-18T09:30:00Z", byId(b, 1).get("edited"));
        assertEquals("ben", byId(b, 1).get("editedBy"));
        assertEquals("2026-11-17T08:00:00Z", byId(b, 2).get("edited"), "unchanged: keeps its time");
        assertEquals("anna", byId(b, 2).get("editedBy"));
        assertEquals("2026-11-18T09:30:00Z", byId(b, 3).get("edited"));

        // an item that was never stamped and is saved unchanged stays without a stamp
        String bundled = "[{\"id\":9,\"name\":\"Bundled\",\"points\":[{\"x\":0.1,\"y\":0.1},{\"x\":0.2,\"y\":0.2}]}]";
        String c = ListStamps.stamp(bundled, bundled, "2026-11-19T10:00:00Z", "cy");
        assertFalse(byId(c, 9).containsKey("edited"));
        assertNull(byId(c, 9).get("editedBy"));
        // moving one of its points counts as an edit
        String moved = "[{\"id\":9,\"name\":\"Bundled\",\"points\":[{\"x\":0.1,\"y\":0.1},{\"x\":0.25,\"y\":0.2}]}]";
        assertEquals("2026-11-19T10:00:00Z", byId(ListStamps.stamp(bundled, moved, "2026-11-19T10:00:00Z", "cy"), 9).get("edited"));
    }
}
