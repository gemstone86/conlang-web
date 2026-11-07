package com.eonweather.core;

import java.util.List;

/**
 * Putting suggested changes into a height map, taking them out again, and counting what they change.
 * A patch sits at (x, y) in the height map's own pixels; only its masked pixels count.
 */
public final class HeightPatches {
    private HeightPatches() {}

    /** What a patch would change on this height map (sea is the sea-level grey value, or null). */
    public static Store.SuggestionStats stats(HeightImages.Grey g, HeightImages.Patch p, int x0, int y0, Integer sea) {
        int changed = 0, toLand = 0, toSea = 0, raised = 0, lowered = 0, maxUp = 0, maxDown = 0;
        for (int y = 0; y < p.h(); y++) {
            int gy = y0 + y;
            if (gy < 0 || gy >= g.h()) continue;
            for (int x = 0; x < p.w(); x++) {
                int gx = x0 + x, i = y * p.w() + x;
                if (gx < 0 || gx >= g.w() || !p.mask()[i]) continue;
                int was = g.at(gx, gy), now = p.values()[i] & 255;
                if (was == now) continue;
                changed++;
                if (now > was) { raised++; maxUp = Math.max(maxUp, now - was); }
                else { lowered++; maxDown = Math.max(maxDown, was - now); }
                if (sea != null) {
                    if (was <= sea && now > sea) toLand++;
                    else if (was > sea && now <= sea) toSea++;
                }
            }
        }
        return new Store.SuggestionStats(changed, toLand, toSea, raised, lowered, maxUp, maxDown);
    }

    /** Writes the patch into the height map; returns the heights it replaced (patch-sized, for undoing). */
    public static byte[] apply(HeightImages.Grey g, HeightImages.Patch p, int x0, int y0) {
        byte[] old = new byte[p.w() * p.h()];
        for (int y = 0; y < p.h(); y++) {
            int gy = y0 + y;
            if (gy < 0 || gy >= g.h()) continue;
            for (int x = 0; x < p.w(); x++) {
                int gx = x0 + x, i = y * p.w() + x;
                if (gx < 0 || gx >= g.w()) continue;
                old[i] = g.data()[gy * g.w() + gx];
                if (p.mask()[i]) g.data()[gy * g.w() + gx] = p.values()[i];
            }
        }
        return old;
    }

    /**
     * Takes a patch out again: its pixels get their old heights back, but only where the height map still
     * has the patch's value (so later changes on top of it stay). Returns how many pixels went back.
     */
    public static int undo(HeightImages.Grey g, HeightImages.Patch p, byte[] old, int x0, int y0) {
        int n = 0;
        for (int y = 0; y < p.h(); y++) {
            int gy = y0 + y;
            if (gy < 0 || gy >= g.h()) continue;
            for (int x = 0; x < p.w(); x++) {
                int gx = x0 + x, i = y * p.w() + x;
                if (gx < 0 || gx >= g.w() || !p.mask()[i]) continue;
                int k = gy * g.w() + gx;
                if (g.data()[k] == p.values()[i] && g.data()[k] != old[i]) { g.data()[k] = old[i]; n++; }
            }
        }
        return n;
    }

    /**
     * A release brought a new height map: the changes accepted in the app after the release's own
     * revision (settings.heightRev in map.json) are put back on top of it, in the order they were made.
     */
    public static void replay(Store store, long mapId, int sinceRev) {
        List<Store.HeightOp> ops = store.heightOpsSince(mapId, sinceRev);
        if (ops.isEmpty()) return;
        Store.HeightState hs = store.heightState(mapId);
        if (hs == null) return;
        HeightImages.Grey g = HeightImages.decodeGrey(hs.image());
        for (Store.HeightOp op : ops) {
            Store.Suggestion s = op.s();
            HeightImages.Patch p = HeightImages.decodePatch(s.patch());
            if (!op.undo()) apply(g, p, s.x(), s.y());
            else if (s.oldVals() != null) undo(g, p, HeightImages.decodeGrey(s.oldVals()).data(), s.x(), s.y());
        }
        store.rewriteHeight(mapId, HeightImages.encodeGrey(g.w(), g.h(), g.data()));
        System.out.println("Height map: " + ops.size() + " change(s) made in the app were put back on the new release's height map");
    }
}
