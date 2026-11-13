package com.eonweather.core;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/**
 * The default map shipped inside the app (src/main/resources/default-map/). On startup it is
 * copied into the database as a public map that everyone sees first, logged in or not, together
 * with its region positions, optional height map and aspect symbols.
 *
 * default-map/map.json lists everything:
 * <pre>
 * { "name": "Mundana", "image": "map.jpg", "height": "height.png" (optional),
 *   "settings": { "reach": 0.27 },
 *   "symbols": { "Kryotropi": "symbols/Kryotropi.png", ... },
 *   "anchors": [ { "region": "Tarkas", "x": 0.507, "y": 0.284 }, ... ] }
 * </pre>
 * A fingerprint of all the files is kept with the map, so a new release with changed files
 * refreshes the stored copy, and an unchanged one is left alone.
 * <p>
 * Height map suggestions accepted in the app change the stored height map. A release's height map
 * says which of those it already contains with settings.heightRev (the revision it was exported at);
 * the later ones are put back on top of it, so a release never undoes work done in the app.
 * <p>
 * Rivers, nations, forests, ice and roads edited in the app are kept over the release's, unless the release
 * says it carries newer ones: settings.riversRelease / nationsRelease / forestRelease / iceRelease / roadsRelease with a value
 * the installed copy hasn't had (tools/apply-export.py sets them to the export's time).
 */
public final class DefaultMap {
    private static final String DIR = "default-map/";

    private DefaultMap() {}

    public static void install(Store store, World world) {
        install(store, world, DefaultMap.class.getClassLoader());
    }

    static void install(Store store, World world, ClassLoader cl) {
        try {
            byte[] manifestBytes = read(cl, "map.json");
            if (manifestBytes == null) return; // no default map shipped
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            sha.update(manifestBytes);
            Map<String, Object> m = Json.parseObject(new String(manifestBytes, StandardCharsets.UTF_8));

            String name = String.valueOf(m.getOrDefault("name", "Standardkarta"));
            byte[] image = required(cl, String.valueOf(m.get("image")), sha);
            ImageInfo info = ImageInfo.detect(image);
            if (info == null) throw new IllegalStateException("default-map image is not a PNG, JPEG, GIF or WebP");

            String heightType = null;
            byte[] height = null;
            if (m.get("height") instanceof String h && !h.isBlank()) {
                height = required(cl, h, sha);
                ImageInfo hi = ImageInfo.detect(height);
                heightType = hi != null ? hi.type() : "image/png";
            }

            Map<String, Store.MapImage> symbols = new LinkedHashMap<>();
            if (m.get("symbols") instanceof Map<?, ?> syms) {
                for (Map.Entry<?, ?> e : new TreeMap<>(syms).entrySet()) {
                    String aspect = String.valueOf(e.getKey());
                    if (!FieldService.ASPECT_ORDER.contains(aspect) && !FieldService.FORCE_ORDER.contains(aspect)) {
                        System.err.println("Default map: skipping symbol for unknown aspect " + aspect);
                        continue;
                    }
                    byte[] b = required(cl, String.valueOf(e.getValue()), sha);
                    ImageInfo si = ImageInfo.detect(b);
                    symbols.put(aspect, new Store.MapImage(si != null ? si.type() : "image/png", b));
                }
            }

            Set<String> known = new HashSet<>(world.regionNames());
            List<Store.Anchor> anchors = new ArrayList<>();
            if (m.get("anchors") instanceof List<?> list) {
                for (Object o : list) {
                    if (!(o instanceof Map<?, ?> a)) continue;
                    String region = String.valueOf(a.get("region"));
                    if (!known.contains(region)) {
                        System.err.println("Default map: skipping point for unknown region " + region);
                        continue;
                    }
                    anchors.add(new Store.Anchor(region, ((Number) a.get("x")).doubleValue(), ((Number) a.get("y")).doubleValue()));
                }
            }

            List<Store.Leyline> leylines = new ArrayList<>();
            if (m.get("leylines") instanceof List<?> list) {
                for (Object o : list) {
                    try {
                        leylines.add(Api.parseLeyline(o));
                    } catch (RuntimeException e) {
                        System.err.println("Default map: skipping leyline " + o + ": " + e.getMessage());
                    }
                }
            }

            List<Store.Zone> zones = new ArrayList<>();
            if (m.get("zones") instanceof List<?> list) {
                for (Object o : list) {
                    try {
                        zones.add(Api.parseZone(o));
                    } catch (RuntimeException e) {
                        System.err.println("Default map: skipping high-magic area " + o + ": " + e.getMessage());
                    }
                }
            }

            String version = HexFormat.of().formatHex(sha.digest()).substring(0, 16);
            Map<String, Object> settings = new LinkedHashMap<>();
            if (m.get("settings") instanceof Map<?, ?> s) s.forEach((k, v) -> settings.put(String.valueOf(k), v));
            settings.put("bundle", version);

            // a release can say its rivers (nations, forests) are newer than what was edited in the app:
            // settings.riversRelease (nationsRelease, forestRelease) set to a new value installs them once
            Map<String, Object> before = new LinkedHashMap<>();
            Long id0 = store.defaultMapId();
            if (id0 != null && store.map(id0, null).get("settings") instanceof Map<?, ?> os) os.forEach((k, v) -> before.put(String.valueOf(k), v));
            java.util.function.Predicate<String> newRelease = (key) -> settings.get(key) != null && !Objects.equals(String.valueOf(settings.get(key)), String.valueOf(before.get(key)));
            // the order of the map layers is edited in the app by the admins (settings.layerOrder): the app's stays over a new
            // release's unless the release says its order is newer (settings.layerOrderRelease, set by tools/apply-export.py)
            if (before.get("layerOrder") != null && !newRelease.test("layerOrderRelease")) settings.put("layerOrder", before.get("layerOrder"));
            boolean changed = store.installDefaultMap(new Store.DefaultMapData(name, Json.write(settings), version,
                    info.type(), image, info.width(), info.height(), heightType, height, anchors, symbols, leylines, zones));
            System.out.println(changed
                    ? "Default map \"" + name + "\" installed (" + anchors.size() + " regions, " + symbols.size() + " symbols, " + leylines.size() + " leylines, " + zones.size() + " high-magic areas)"
                    : "Default map \"" + name + "\" is up to date");
            // rivers shipped with the release (default-map/rivers.json): installed unless rivers have been
            // edited in the app since (then the app's stay; a release made from their export has the same ones)
            if (m.get("rivers") instanceof String rf && !rf.isBlank()) {
                Long id = store.defaultMapId();
                byte[] rb = read(cl, rf);
                if (id != null && rb != null) {
                    try {
                        Store.Rivers cur = store.rivers(id);
                        if (!"app".equals(cur.source()) || newRelease.test("riversRelease")) {
                            String json = Json.write(Api.checkRivers(Json.parse(new String(rb, StandardCharsets.UTF_8))));
                            if (!json.equals(cur.json())) { store.setRivers(id, json, "bundle", null); System.out.println("Default map: rivers installed from the release"); }
                        }
                    } catch (RuntimeException e) {
                        System.err.println("Default map: could not install rivers: " + e.getMessage());
                    }
                }
            }
            // nations shipped with the release (default-map/nations.json, "nations" in map.json): the same rule
            if (m.get("nations") instanceof String nf && !nf.isBlank()) {
                Long id = store.defaultMapId();
                byte[] nb = read(cl, nf);
                if (id != null && nb != null) {
                    try {
                        Store.Rivers cur = store.nations(id);
                        if (!"app".equals(cur.source()) || newRelease.test("nationsRelease")) {
                            String json = Json.write(Api.checkNations(Json.parse(new String(nb, StandardCharsets.UTF_8))));
                            if (!json.equals(cur.json())) { store.setNations(id, json, "bundle", null); System.out.println("Default map: nations installed from the release"); }
                        }
                    } catch (RuntimeException e) {
                        System.err.println("Default map: could not install nations: " + e.getMessage());
                    }
                }
            }
            // mountain ranges shipped with the release (default-map/ranges.json, "ranges" in map.json): as the nations
            if (m.get("ranges") instanceof String gf && !gf.isBlank()) {
                Long id = store.defaultMapId();
                byte[] gb = read(cl, gf);
                if (id != null && gb != null) {
                    try {
                        Store.Rivers cur = store.ranges(id);
                        if (!"app".equals(cur.source()) || newRelease.test("rangesRelease")) {
                            String json = Json.write(Api.checkRanges(Json.parse(new String(gb, StandardCharsets.UTF_8))));
                            if (!json.equals(cur.json())) { store.setRanges(id, json, "bundle", null); System.out.println("Default map: mountain ranges installed from the release"); }
                        }
                    } catch (RuntimeException e) {
                        System.err.println("Default map: could not install mountain ranges: " + e.getMessage());
                    }
                }
            }
            // forests shipped with the release (default-map/forest.png, "forest" in map.json): the same rule as the rivers
            if (m.get("forest") instanceof String ff && !ff.isBlank()) {
                Long id = store.defaultMapId();
                byte[] fb = read(cl, ff);
                if (id != null && fb != null) {
                    Store.Forest cur = store.forest(id);
                    if (cur == null || !"app".equals(cur.source()) || newRelease.test("forestRelease")) {
                        if (cur == null || !Arrays.equals(cur.image(), fb)) {
                            ImageInfo fi = ImageInfo.detect(fb);
                            store.setForest(id, fi != null ? fi.type() : "image/png", fb, "bundle", null);
                            System.out.println("Default map: forests installed from the release");
                        }
                    }
                }
            }
            // ice shipped with the release (default-map/ice.png, "ice" in map.json): as the forests (iceRelease)
            if (m.get("ice") instanceof String icf && !icf.isBlank()) {
                Long id = store.defaultMapId();
                byte[] ib = read(cl, icf);
                if (id != null && ib != null) {
                    Store.Forest cur = store.ice(id);
                    if ((cur == null || !"app".equals(cur.source()) || newRelease.test("iceRelease")) && (cur == null || !Arrays.equals(cur.image(), ib))) {
                        ImageInfo fi = ImageInfo.detect(ib);
                        store.setIce(id, fi != null ? fi.type() : "image/png", ib, "bundle", null);
                        System.out.println("Default map: ice installed from the release");
                    }
                }
            }
            // roads shipped with the release (default-map/roads.json, "roads" in map.json): as the rivers (roadsRelease)
            if (m.get("roads") instanceof String wf && !wf.isBlank()) {
                Long id = store.defaultMapId();
                byte[] wb = read(cl, wf);
                if (id != null && wb != null) {
                    try {
                        Store.Rivers cur = store.roads(id);
                        if (!"app".equals(cur.source()) || newRelease.test("roadsRelease")) {
                            String json = Json.write(Api.checkRoads(Json.parse(new String(wb, StandardCharsets.UTF_8))));
                            if (!json.equals(cur.json())) { store.setRoads(id, json, "bundle", null); System.out.println("Default map: roads installed from the release"); }
                        }
                    } catch (RuntimeException e) {
                        System.err.println("Default map: could not install roads: " + e.getMessage());
                    }
                }
            }
            // height map changes accepted in the app after this release's height map was made go back on top of it
            if (changed && height != null) {
                int since = settings.get("heightRev") instanceof Number n ? n.intValue() : 0;
                Long id = store.defaultMapId();
                if (id != null) {
                    try {
                        HeightPatches.replay(store, id, since);
                    } catch (RuntimeException e) {
                        System.err.println("Could not put the app's height map changes back: " + e.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            // Never stop the app over this: it still works, just without the default map.
            System.err.println("Could not install the default map: " + e.getMessage());
        }
    }

    private static byte[] required(ClassLoader cl, String file, MessageDigest sha) throws IOException {
        if (file.contains("..")) throw new IllegalStateException("Bad file name in default-map/map.json: " + file);
        byte[] b = read(cl, file);
        if (b == null) throw new IllegalStateException("default-map/" + file + " is missing");
        sha.update(file.getBytes(StandardCharsets.UTF_8));
        sha.update(b);
        return b;
    }

    private static byte[] read(ClassLoader cl, String file) throws IOException {
        try (InputStream in = cl.getResourceAsStream(DIR + file)) {
            return in == null ? null : in.readAllBytes();
        }
    }
}
