package com.eonweather.core;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * The admin's export for updating the standard map in a new release: one zip with what differs
 * between a map in the app and the standard map shipped in this release (src/main/resources/default-map/),
 * plus the regions made or changed in the app.
 * <pre>
 * export.json            what is in the zip, with the versions it was compared against (see below)
 * height.png             the height map, if it differs (whole image, greyscale)
 * rivers.json            the rivers, if they differ
 * nations.json           the nations, if they differ
 * ranges.json            the mountain ranges, if they differ
 * forest.png             the forest map (0 = no trees … 100 = trees everywhere), if it differs
 * ice.png                the ice map (0 = no ice … 100 = all ice), if it differs
 * roads.json             the roads and paths, if they differ
 * map.jpg / map.png …    the map picture, if it differs
 * regions/&lt;name&gt;.yaml   each region made or changed in the app
 * </pre>
 * Region positions, leylines and high-magic areas that differ are inside export.json, in the same
 * form as in default-map/map.json, and so are changed settings.
 * <p>
 * export.json "base" says what the comparison was made against: the app version, the release's
 * default-map fingerprint ("bundle") and the height map revision ("heightRev"). A release made from
 * the export puts "heightRev" from export.json into default-map/map.json's settings, so height map
 * changes accepted in the app after the export are put back on top of it (see {@link DefaultMap}).
 */
final class MapExport {
    private static final String DIR = "default-map/";

    private MapExport() {}

    /** A painted layer ("forest", "ice": greyscale 0–100) as &lt;name&gt;.png, if it differs from the release's. */
    private static void paintedPart(Map<String, byte[]> files, Map<String, Object> changes, List<String> same, List<String> empty,
                                    boolean all, boolean summaryOnly, boolean isDefault, String name, Store.Forest fo, Map<String, Object> bundle) {
        byte[] bundled = bundle.get(name) instanceof String ff ? read(ff) : null;
        if (fo == null) {
            if (bundled != null) changes.put(name, Map.of("removed", true));
            return;
        }
        boolean differs = bundled == null || !Arrays.equals(bundled, fo.image());
        if (differs && bundled != null) {
            HeightImages.Grey a = HeightImages.decodeGrey(fo.image()), b = HeightImages.decodeGrey(bundled);
            differs = a.w() != b.w() || a.h() != b.h() || !Arrays.equals(a.data(), b.data());
        }
        if (!differs && !all) { same.add(name); return; }
        if (!isDefault && !all && allZero(fo.image())) { empty.add(name); return; }
        HeightImages.Grey g = HeightImages.decodeGrey(fo.image());
        files.put(name + ".png", summaryOnly ? new byte[0] : HeightImages.encodeGrey(g.w(), g.h(), g.data()));
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("file", name + ".png");
        o.put("width", g.w());
        o.put("height", g.h());
        long n = 0;
        for (byte v : g.data()) if (v != 0) n++;
        o.put(name.equals("forest") ? "forestedPixels" : "coveredPixels", n);
        changes.put(name, o);
    }

    record Result(String fileName, byte[] zip, Map<String, Object> manifest) {}

    static Result build(Store store, long mapId, long viewerId, String exportedBy, boolean all, boolean summaryOnly,
                        Map<String, String> customRegions, Map<String, File> builtInRegions) {
        Map<String, Object> map = store.map(mapId, viewerId);
        Map<String, Object> bundle = bundleManifest();
        Map<String, Object> bundleSettings = bundle.get("settings") instanceof Map<?, ?> s ? strMap(s) : new LinkedHashMap<>();
        Map<String, byte[]> files = new LinkedHashMap<>();
        Map<String, Object> changes = new LinkedHashMap<>();
        List<String> same = new ArrayList<>();

        // on a map other than the standard one, an empty part (no rivers drawn, say) means "not used here",
        // not "remove them all from the standard map": listed under "empty" instead of as a change
        List<String> empty = new ArrayList<>();
        boolean isDefault = Boolean.TRUE.equals(map.get("isDefault"));

        // ── settings (zoom images, scale, sea level …): only the ones that differ ──
        Map<String, Object> settings = map.get("settings") instanceof Map<?, ?> s ? strMap(s) : new LinkedHashMap<>();
        Map<String, Object> setDiff = new LinkedHashMap<>();
        Set<String> keys = new TreeSet<>(settings.keySet());
        keys.addAll(bundleSettings.keySet());
        keys.remove("bundle");
        keys.remove("heightRev");
        keys.removeIf(k -> k.endsWith("Release"));
        for (String k : keys) {
            Object a = settings.get(k), b = bundleSettings.get(k);
            if (a == null && (all || !isDefault)) continue;   // not set on another map: says nothing about the standard map
            if (all || !Objects.equals(norm(a), norm(b))) setDiff.put(k, a);
        }
        if (!setDiff.isEmpty()) changes.put("settings", setDiff); else same.add("settings");

        // ── the map picture ──
        Store.MapImage img = store.mapImage(mapId, viewerId);
        byte[] bundleImg = read(String.valueOf(bundle.get("image")));
        if (all || bundleImg == null || !Arrays.equals(bundleImg, img.bytes())) {
            String ext = switch (img.type()) { case "image/png" -> "png"; case "image/webp" -> "webp"; case "image/gif" -> "gif"; default -> "jpg"; };
            files.put("map." + ext, img.bytes());
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("file", "map." + ext);
            o.put("width", map.get("width"));
            o.put("height", map.get("height"));
            changes.put("image", o);
        } else same.add("image");

        // ── the height map: the whole image if any pixel differs ──
        Store.HeightState hs = store.heightState(mapId);
        byte[] bundleHeight = bundle.get("height") instanceof String h ? read(h) : null;
        if (hs != null) {
            Map<String, Object> o = new LinkedHashMap<>();
            // the very same file as the release's (nothing changed since it was installed): no need to look at the pixels
            boolean sameFile = bundleHeight != null && Arrays.equals(bundleHeight, hs.image());
            if (sameFile && !all) same.add("height");
            else {
            HeightImages.Grey cur = HeightImages.decodeGrey(hs.image());
            HeightImages.Grey old = bundleHeight == null ? null : HeightImages.decodeGrey(bundleHeight);
            long changed = -1;
            int x0 = Integer.MAX_VALUE, y0 = Integer.MAX_VALUE, x1 = -1, y1 = -1;
            if (old != null && old.w() == cur.w() && old.h() == cur.h()) {
                changed = 0;
                byte[] a = cur.data(), b = old.data();
                int w = cur.w();
                for (int i = 0; i < a.length; i++)
                    if (a[i] != b[i]) {
                        changed++;
                        int x = i % w, y = i / w;
                        if (x < x0) x0 = x; if (x > x1) x1 = x;
                        if (y < y0) y0 = y; if (y > y1) y1 = y;
                    }
            }
            if (all || changed != 0) {
                files.put("height.png", summaryOnly ? new byte[0] : HeightImages.encodeGrey(cur.w(), cur.h(), cur.data()));
                o.put("file", "height.png");
                o.put("width", cur.w());
                o.put("height", cur.h());
                o.put("rev", hs.rev());
                if (changed >= 0) {
                    o.put("changedPixels", changed);
                    if (changed > 0) o.put("changedBox", Map.of("x", x0, "y", y0, "w", x1 - x0 + 1, "h", y1 - y0 + 1));
                } else o.put("note", old == null ? "the release has no height map" : "a different size from the release's");
                changes.put("height", o);
            } else same.add("height");
            }
        } else if (bundleHeight != null) changes.put("height", Map.of("removed", true));

        // ── forests and ice (greyscale 0–100), the whole image if any pixel differs ──
        paintedPart(files, changes, same, empty, all, summaryOnly, isDefault, "forest", store.forest(mapId), bundle);
        paintedPart(files, changes, same, empty, all, summaryOnly, isDefault, "ice", store.ice(mapId), bundle);

        // ── rivers and nations ──
        String rj = store.rivers(mapId).json(), nj = store.nations(mapId).json();
        if (!isDefault && !all && Json.parse(rj) instanceof List<?> l && l.isEmpty()) empty.add("rivers");
        else listPart(files, changes, same, all, "rivers", rj, bundle, Api::checkRivers);
        if (!isDefault && !all && Json.parse(nj) instanceof List<?> l && l.isEmpty()) empty.add("nations");
        else listPart(files, changes, same, all, "nations", nj, bundle, Api::checkNations);
        String gj = store.ranges(mapId).json();
        if (!isDefault && !all && Json.parse(gj) instanceof List<?> l && l.isEmpty()) empty.add("ranges");
        else listPart(files, changes, same, all, "ranges", gj, bundle, Api::checkRanges);
        String wj = store.roads(mapId).json();
        if (!isDefault && !all && Json.parse(wj) instanceof List<?> l && l.isEmpty()) empty.add("roads");
        else listPart(files, changes, same, all, "roads", wj, bundle, Api::checkRoads);

        // ── region positions, leylines, high-magic areas: in export.json, as in map.json ──
        List<Map<String, Object>> anchors = new ArrayList<>();
        for (Map<String, Object> a : store.anchors(mapId, viewerId)) anchors.add(anchor(a));
        List<Map<String, Object>> bAnchors = new ArrayList<>();
        if (bundle.get("anchors") instanceof List<?> l) for (Object o : l) if (o instanceof Map<?, ?> a) bAnchors.add(anchor(strMap(a)));
        if (!isDefault && !all && anchors.isEmpty()) empty.add("anchors");
        else jsonPart(changes, same, all, "anchors", anchors, bAnchors);

        List<Map<String, Object>> ley = new ArrayList<>();
        for (Map<String, Object> o : store.leylines(mapId, viewerId)) ley.add(leyline(Api.parseLeyline(o)));
        List<Map<String, Object>> bLey = new ArrayList<>();
        if (bundle.get("leylines") instanceof List<?> l) for (Object o : l) try { bLey.add(leyline(Api.parseLeyline(o))); } catch (RuntimeException e) { /* skipped at install too */ }
        if (!isDefault && !all && ley.isEmpty()) empty.add("leylines");
        else jsonPart(changes, same, all, "leylines", ley, bLey);

        List<Map<String, Object>> zones = new ArrayList<>();
        for (Map<String, Object> o : store.zones(mapId, viewerId)) zones.add(zone(Api.parseZone(o)));
        List<Map<String, Object>> bZones = new ArrayList<>();
        if (bundle.get("zones") instanceof List<?> l) for (Object o : l) try { bZones.add(zone(Api.parseZone(o))); } catch (RuntimeException e) { /* skipped at install too */ }
        if (!isDefault && !all && zones.isEmpty()) empty.add("zones");
        else jsonPart(changes, same, all, "zones", zones, bZones);

        // ── regions made or changed in the app (these belong to the whole world, not one map) ──
        List<Map<String, Object>> regions = new ArrayList<>();
        Set<String> usedFiles = new HashSet<>();
        for (Map.Entry<String, String> e : new TreeMap<>(customRegions).entrySet()) {
            File f = builtInRegions.get(e.getKey());
            String builtIn = f == null ? null : RegionYaml.read(f);
            if (builtIn != null && builtIn.strip().equals(e.getValue().strip())) continue; // same as the release's
            String file = WorldBuilder.slug(e.getKey());
            for (int i = 2; !usedFiles.add(file); i++) file = WorldBuilder.slug(e.getKey()) + "-" + i;
            files.put("regions/" + file + ".yaml", e.getValue().getBytes(StandardCharsets.UTF_8));
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("name", e.getKey());
            o.put("status", f == null ? "new" : "changed");
            o.put("file", "regions/" + file + ".yaml");
            if (f != null) o.put("replaces", f.getName());
            regions.add(o);
        }
        if (!regions.isEmpty()) changes.put("regions", regions); else same.add("regions");

        // ── export.json ──
        Map<String, Object> man = new LinkedHashMap<>();
        man.put("format", "eon-weather-export");
        man.put("formatVersion", 1);
        man.put("exportedAt", Instant.now().toString());
        man.put("exportedBy", exportedBy);
        man.put("everything", all);
        Map<String, Object> mp = new LinkedHashMap<>();
        mp.put("id", mapId);
        mp.put("name", map.get("name"));
        mp.put("isDefault", map.get("isDefault"));
        mp.put("owner", map.get("owner"));
        mp.put("width", map.get("width"));
        mp.put("height", map.get("height"));
        man.put("map", mp);
        Map<String, Object> base = new LinkedHashMap<>();
        base.put("appVersion", Api.VERSION);
        base.put("bundle", installedBundle(store));
        base.put("bundleHeightRev", bundleSettings.getOrDefault("heightRev", 0));
        Long def = store.defaultMapId();
        base.put("defaultMapHeightRev", def == null ? 0 : store.heightRev(def));
        base.put("heightRev", hs == null ? 0 : hs.rev());
        base.put("riversRev", Api.riversRev(store.rivers(mapId).json()));
        base.put("nationsRev", Api.riversRev(store.nations(mapId).json()));
        man.put("base", base);
        man.put("changes", changes);
        man.put("unchanged", same);
        if (!empty.isEmpty()) man.put("emptyOnThisMap", empty);
        files.put("export.json", pretty(man).getBytes(StandardCharsets.UTF_8));

        String slug = String.valueOf(map.get("name")).replaceAll("[^\\p{L}\\p{N}_.-]+", "-");
        String stamp = Instant.now().toString().substring(0, 16).replace(":", "").replace("T", "-");
        String name = "eon-export-" + slug + "-" + stamp + ".zip";
        return new Result(name, summaryOnly ? null : zip(files), man);
    }

    private static boolean allZero(byte[] png) {
        for (byte v : HeightImages.decodeGrey(png).data()) if (v != 0) return false;
        return true;
    }

    private interface Checker { List<Map<String, Object>> check(Object parsed); }

    private static void listPart(Map<String, byte[]> files, Map<String, Object> changes, List<String> same, boolean all,
                                 String part, String json, Map<String, Object> bundle, Checker check) {
        String bundled = "[]";
        if (bundle.get(part) instanceof String f && !f.isBlank()) {
            byte[] b = read(f);
            if (b != null) try { bundled = Json.write(check.check(Json.parse(new String(b, StandardCharsets.UTF_8)))); } catch (RuntimeException e) { bundled = "?"; }
        }
        String cur = json == null || json.isBlank() ? "[]" : json;
        if (!all && cur.equals(bundled)) { same.add(part); return; }
        files.put(part + ".json", pretty(Json.parse(cur)).getBytes(StandardCharsets.UTF_8));
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("file", part + ".json");
        o.put("count", ((List<?>) Json.parse(cur)).size());
        o.put("rev", Api.riversRev(cur));
        changes.put(part, o);
    }

    private static void jsonPart(Map<String, Object> changes, List<String> same, boolean all, String part,
                                 List<Map<String, Object>> cur, List<Map<String, Object>> bundled) {
        Comparator<Map<String, Object>> byJson = Comparator.comparing(Json::write);
        List<Map<String, Object>> a = new ArrayList<>(cur), b = new ArrayList<>(bundled);
        a.sort(byJson);
        b.sort(byJson);
        if (!all && Json.write(a).equals(Json.write(b))) { same.add(part); return; }
        changes.put(part, cur);
    }

    private static Map<String, Object> anchor(Map<String, Object> a) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("region", String.valueOf(a.get("region")));
        o.put("x", ((Number) a.get("x")).doubleValue());
        o.put("y", ((Number) a.get("y")).doubleValue());
        return o;
    }

    private static Map<String, Object> leyline(Store.Leyline l) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("aspect", l.aspect());
        o.put("a", xy(l.ax(), l.ay()));
        o.put("b", xy(l.bx(), l.by()));
        return o;
    }

    private static Map<String, Object> zone(Store.Zone z) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("aspect", z.aspect());
        List<Object> pts = new ArrayList<>();
        for (double[] p : z.points()) pts.add(xy(p[0], p[1]));
        o.put("points", pts);
        return o;
    }

    private static Map<String, Object> xy(double x, double y) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("x", x);
        o.put("y", y);
        return o;
    }

    private static Object norm(Object v) { return v == null ? null : Json.write(v); }

    private static Map<String, Object> strMap(Map<?, ?> m) {
        Map<String, Object> o = new LinkedHashMap<>();
        m.forEach((k, v) -> o.put(String.valueOf(k), v));
        return o;
    }

    /** The fingerprint of the release's default map as installed (settings.bundle of the default map). */
    private static Object installedBundle(Store store) {
        Long id = store.defaultMapId();
        if (id == null) return null;
        Object s = store.map(id, null).get("settings");
        return s instanceof Map<?, ?> m ? m.get("bundle") : null;
    }

    private static Map<String, Object> bundleManifest() {
        byte[] b = read("map.json");
        return b == null ? new LinkedHashMap<>() : Json.parseObject(new String(b, StandardCharsets.UTF_8));
    }

    private static byte[] read(String file) {
        if (file == null || file.contains("..")) return null;
        try (InputStream in = MapExport.class.getClassLoader().getResourceAsStream(DIR + file)) {
            return in == null ? null : in.readAllBytes();
        } catch (IOException e) {
            return null;
        }
    }

    private static byte[] zip(Map<String, byte[]> files) {
        try {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            try (ZipOutputStream z = new ZipOutputStream(bo, StandardCharsets.UTF_8)) {
                // export.json first, so it is the first thing seen when opening the zip
                List<String> names = new ArrayList<>(files.keySet());
                names.remove("export.json");
                names.add(0, "export.json");
                for (String n : names) {
                    z.putNextEntry(new ZipEntry(n));
                    z.write(files.get(n));
                    z.closeEntry();
                }
            }
            return bo.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /** JSON with line breaks and indentation, easier to read and compare than one long line. */
    static String pretty(Object v) {
        StringBuilder b = new StringBuilder();
        pretty(b, v, "");
        return b.append('\n').toString();
    }

    private static void pretty(StringBuilder b, Object v, String ind) {
        if (v instanceof Map<?, ?> m) {
            if (m.isEmpty()) { b.append("{}"); return; }
            b.append("{\n");
            int i = 0;
            for (Map.Entry<?, ?> e : m.entrySet()) {
                b.append(ind).append("  ").append(Json.write(String.valueOf(e.getKey()))).append(": ");
                pretty(b, e.getValue(), ind + "  ");
                if (++i < m.size()) b.append(',');
                b.append('\n');
            }
            b.append(ind).append('}');
        } else if (v instanceof List<?> l) {
            if (l.isEmpty()) { b.append("[]"); return; }
            // short lists of plain values (and points) stay on one line
            boolean flat = l.stream().allMatch(x -> !(x instanceof Map<?, ?>) && !(x instanceof List<?>))
                    || l.stream().allMatch(x -> x instanceof Map<?, ?> pm && pm.size() <= 2 && pm.values().stream().allMatch(Number.class::isInstance));
            if (flat) { b.append(Json.write(l)); return; }
            b.append("[\n");
            for (int i = 0; i < l.size(); i++) {
                b.append(ind).append("  ");
                pretty(b, l.get(i), ind + "  ");
                if (i + 1 < l.size()) b.append(',');
                b.append('\n');
            }
            b.append(ind).append(']');
        } else b.append(Json.write(v));
    }
}
