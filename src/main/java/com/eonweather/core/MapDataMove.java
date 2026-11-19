package com.eonweather.core;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Moves what is drawn on a map (rivers, roads, ranges, cities, and the height, forest and marsh pictures) without changing its
 * shape, for when the regional map under it has been moved (see layer-shift). Either everything inside a box, or only some rivers.
 * Distances are in map pixels (the map image's own pixels, may be fractions); the lists use 0–1 positions and the pictures are
 * moved by looking at the old picture a little to one side (smoothly, so a half pixel is a half pixel).
 */
final class MapDataMove {
    private MapDataMove() {}

    /** A box in 0–1 positions. */
    record Box(double x0, double y0, double x1, double y1) {
        boolean has(double x, double y) { return x >= x0 && x <= x1 && y >= y0 && y <= y1; }
    }

    /** A move: scaled by s about (cx, cy) (0–1 positions), then moved by (dx, dy) (0–1 units). */
    record Tf(double dx, double dy, double s, double cx, double cy) {
        double x(double x) { return cx + (x - cx) * s + dx; }
        double y(double y) { return cy + (y - cy) * s + dy; }
    }

    /** What a move changed: points moved per kind of list. */
    static final class Counts { int points; int items; }

    /**
     * The list's JSON with its points moved by (dx, dy) in 0–1 units. With a box: every point in the box (a river's meeting
     * point with another river and a lake's place count as points). With rivers: only the points of the rivers (and lakes)
     * with those ids, and the meeting points where another river joins one of them.
     */
    static String moveList(String json, Box box, Set<Long> rivers, Tf t, Counts n) {
        Object parsed = Json.parse(json);
        if (!(parsed instanceof List<?> list)) return json;
        List<Object> out = new ArrayList<>();
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> item)) { out.add(o); continue; }
            Map<String, Object> m = new LinkedHashMap<>();
            item.forEach((k, v) -> m.put(String.valueOf(k), v));
            long id = m.get("id") instanceof Number x ? x.longValue() : -1;
            int before = n.points;
            if (box != null) {
                shift(m, box, t, n, true);
            } else {
                boolean own = rivers.contains(id);
                if (own) {
                    shift(m, null, t, n, false);                    // its points, and a lake's place
                    if (m.get("joins") instanceof Map<?, ?> j && targetMoves(j, rivers)) m.put("joins", moved(j, t, n));
                } else if (m.get("joins") instanceof Map<?, ?> j && targetMoves(j, rivers)) {
                    m.put("joins", moved(j, t, n));                 // another river that runs into a moved one keeps its meeting point on it
                }
            }
            if (n.points != before) n.items++;
            out.add(m);
        }
        return Json.write(out);
    }

    private static boolean targetMoves(Map<?, ?> join, Set<Long> ids) {
        Object t = join.get("river") != null ? join.get("river") : join.get("lake");
        return t instanceof Number x && ids.contains(x.longValue());
    }

    private static Map<String, Object> moved(Map<?, ?> p, Tf t, Counts n) {
        Map<String, Object> m = new LinkedHashMap<>();
        p.forEach((k, v) -> m.put(String.valueOf(k), v));
        move(m, t, n);
        return m;
    }

    private static void move(Map<String, Object> p, Tf t, Counts n) {
        if (p.get("x") instanceof Number x && p.get("y") instanceof Number y) {
            p.put("x", clamp(t.x(x.doubleValue())));
            p.put("y", clamp(t.y(y.doubleValue())));
            n.points++;
        }
    }

    private static double clamp(double v) { return Math.round(Math.max(0, Math.min(1, v)) * 1e10) / 1e10; }

    /** Moves the points found in this item (in "points" lists, and a lake's or city's own x and y); the join of a river only inside a box. */
    @SuppressWarnings("unchecked")
    private static void shift(Map<String, Object> m, Box box, Tf t, Counts n, boolean includeJoins) {
        if (m.get("x") instanceof Number && m.get("y") instanceof Number && (box == null || box.has(((Number) m.get("x")).doubleValue(), ((Number) m.get("y")).doubleValue())))
            move(m, t, n);
        if (m.get("points") instanceof List<?> pts) {
            List<Object> np = new ArrayList<>();
            for (Object o : pts) {
                if (o instanceof Map<?, ?> pm && pm.get("x") instanceof Number x && pm.get("y") instanceof Number y && (box == null || box.has(x.doubleValue(), y.doubleValue())))
                    np.add(moved(pm, t, n));
                else np.add(o);
            }
            m.put("points", np);
        }
        if (includeJoins && m.get("joins") instanceof Map<?, ?> j && j.get("x") instanceof Number x && j.get("y") instanceof Number y && box.has(x.doubleValue(), y.doubleValue()))
            m.put("joins", moved(j, t, n));
    }

    /**
     * The picture with the part inside the box moved by (dx, dy) map pixels: each pixel of the box takes the value the old picture had
     * (dx, dy) before it, blended between the four nearest pixels; the old picture outside the box is used as it is, so nothing is left blank.
     */
    static byte[] movePicture(byte[] png, Box box, double dxMapPx, double dyMapPx, int mapW) {
        HeightImages.Grey g = HeightImages.decodeGrey(png);
        double k = g.w() / (double) mapW;                                // picture pixels per map pixel (1 unless the picture has another size)
        double dx = dxMapPx * k, dy = dyMapPx * k;
        int x0 = Math.max(0, (int) Math.floor(box.x0() * g.w())), x1 = Math.min(g.w() - 1, (int) Math.ceil(box.x1() * g.w()) - 1);
        int y0 = Math.max(0, (int) Math.floor(box.y0() * g.h())), y1 = Math.min(g.h() - 1, (int) Math.ceil(box.y1() * g.h()) - 1);
        byte[] out = g.data().clone();
        for (int y = y0; y <= y1; y++) {
            double sy = Math.max(0, Math.min(g.h() - 1, y - dy));
            int ya = (int) Math.floor(sy), yb = Math.min(g.h() - 1, ya + 1);
            double fy = sy - ya;
            for (int x = x0; x <= x1; x++) {
                double sx = Math.max(0, Math.min(g.w() - 1, x - dx));
                int xa = (int) Math.floor(sx), xb = Math.min(g.w() - 1, xa + 1);
                double fx = sx - xa;
                double top = g.at(xa, ya) * (1 - fx) + g.at(xb, ya) * fx, bottom = g.at(xa, yb) * (1 - fx) + g.at(xb, yb) * fx;
                out[y * g.w() + x] = (byte) Math.round(top * (1 - fy) + bottom * fy);
            }
        }
        return HeightImages.encodeGrey(g.w(), g.h(), out);
    }

    /** The ids of the items that differ between two lists (JSON): what a move changed. */
    static Set<Long> changedIds(String oldJson, String newJson) {
        Map<Long, Object> before = new java.util.HashMap<>();
        if (Json.parse(oldJson) instanceof List<?> ol) for (Object o : ol) if (o instanceof Map<?, ?> m && m.get("id") instanceof Number n) before.put(n.longValue(), o);
        Set<Long> out = new java.util.HashSet<>();
        if (Json.parse(newJson) instanceof List<?> nl) for (Object o : nl) if (o instanceof Map<?, ?> m && m.get("id") instanceof Number n && !java.util.Objects.equals(before.get(n.longValue()), o)) out.add(n.longValue());
        return out;
    }

    /** The list with the items of the given ids put back as they were in the old list (items that are gone now stay gone; other items are left as they are now). */
    static String restoreItems(String currentJson, String oldJson, Set<Long> ids) {
        Map<Long, Object> before = new java.util.HashMap<>();
        if (Json.parse(oldJson) instanceof List<?> ol) for (Object o : ol) if (o instanceof Map<?, ?> m && m.get("id") instanceof Number n) before.put(n.longValue(), o);
        List<Object> out = new ArrayList<>();
        if (Json.parse(currentJson) instanceof List<?> cl) for (Object o : cl) {
            Object old = o instanceof Map<?, ?> m && m.get("id") instanceof Number n && ids.contains(n.longValue()) ? before.get(n.longValue()) : null;
            out.add(old != null ? old : o);
        }
        return Json.write(out);
    }

    /** The current picture with the part inside the box taken back from the old one (the rest as it is now). Null if the pictures differ in size. */
    static byte[] restorePicture(byte[] currentPng, byte[] oldPng, Box box) {
        HeightImages.Grey c = HeightImages.decodeGrey(currentPng), o = HeightImages.decodeGrey(oldPng);
        if (c.w() != o.w() || c.h() != o.h()) return null;
        int x0 = Math.max(0, (int) Math.floor(box.x0() * c.w())), x1 = Math.min(c.w() - 1, (int) Math.ceil(box.x1() * c.w()) - 1);
        int y0 = Math.max(0, (int) Math.floor(box.y0() * c.h())), y1 = Math.min(c.h() - 1, (int) Math.ceil(box.y1() * c.h()) - 1);
        byte[] out = c.data().clone();
        for (int y = y0; y <= y1; y++) System.arraycopy(o.data(), y * c.w() + x0, out, y * c.w() + x0, x1 - x0 + 1);
        return HeightImages.encodeGrey(c.w(), c.h(), out);
    }
}
