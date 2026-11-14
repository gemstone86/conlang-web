package com.eonweather.core;

import java.io.File;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Every /api endpoint, in one place and independent of the web framework.
 *
 * Anyone can generate weather and view public maps. Logging in adds saving:
 * comments, campaigns with notes, your own maps, and where you left off.
 *
 * Changing requests must carry the header "X-Eon-Request: 1". Browsers won't let
 * another site add that header, so together with the SameSite session cookie it
 * blocks cross-site request forgery.
 */
public final class Api {
    /** The app's version (pom.xml, set at start-up): shown in the page's corner, which compares it with the page's own. */
    public static volatile String VERSION = "dev";
    public static final int MAX_IMAGE_BYTES = 30 * 1024 * 1024;

    // The world is rebuilt when regions are made or changed in the app; these three are swapped together.
    private volatile World world;
    private volatile WeatherService weather;
    private volatile FieldService fields;
    private final WorldBuilder builder;
    private final Set<String> builtInNames;
    private final Set<String> admins;
    private final Store store;
    private final boolean registrationOpen;

    /** The admins when EON_ADMINS is not set (usernames, any letter case). */
    public static final String DEFAULT_ADMINS = "Gemstone,Gemstone86";

    public Api(World world, Store store, boolean registrationOpen) {
        this(world, store, registrationOpen, System.getenv("EON_ADMINS") == null || System.getenv("EON_ADMINS").isBlank()
                ? DEFAULT_ADMINS : System.getenv("EON_ADMINS"));
    }

    /** adminsCsv: usernames that may change the world's regions, comma separated (empty = the oldest account). */
    public Api(World world, Store store, boolean registrationOpen, String adminsCsv) {
        this.store = store;
        this.registrationOpen = registrationOpen;
        this.builder = new WorldBuilder(world.dir);
        this.builtInNames = Collections.unmodifiableSet(new LinkedHashSet<>(builder.builtInRegions().keySet()));
        Set<String> a = new LinkedHashSet<>();
        if (adminsCsv != null) for (String s : adminsCsv.split(",")) if (!s.isBlank()) a.add(s.trim());
        this.admins = Collections.unmodifiableSet(a);
        install(world);
        startPurging();
        Map<String, String> custom = store.customRegions();
        if (!custom.isEmpty()) {
            try {
                install(builder.build(custom));
                System.out.println("Regions made in the app: " + custom.size());
            } catch (RuntimeException e) {
                System.err.println("Could not load the regions made in the app: " + e.getMessage());
            }
        }
    }

    /** Removed maps are deleted for good once their day is up: checked at start and every 15 minutes. */
    private void startPurging() {
        var ex = java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "eon-map-purge");
            t.setDaemon(true);
            return t;
        });
        ex.scheduleWithFixedDelay(() -> {
            try {
                int n = store.purgeRemovedMaps();
                if (n > 0) System.out.println("Deleted " + n + " removed map(s) for good");
            } catch (RuntimeException e) {
                System.err.println("Could not delete removed maps: " + e.getMessage());
            }
        }, 5, Long.getLong("eon.mapPurgeCheckSeconds", 900), java.util.concurrent.TimeUnit.SECONDS);
    }

    private void install(World w) {
        WeatherService ws = new WeatherService(w);
        FieldService fs = new FieldService(w, ws);
        this.weather = ws;
        this.fields = fs;
        this.world = w;
    }

    public Http.Response handle(Http.Request req) {
        try {
            String m = req.method().toUpperCase(Locale.ROOT);
            // this copy of the app handed the database over to a newer one and is stopping
            if (DbGuard.handedOver()) throw new ApiException(503, "The app is restarting; try again in a moment");
            if (!m.equals("GET") && !m.equals("HEAD") && !"1".equals(req.header("X-Eon-Request")))
                throw new ApiException(403, "Missing X-Eon-Request header");
            return route(m, req.path(), req);
        } catch (ApiException e) {
            return Http.Response.json(e.status, Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return Http.Response.json(400, Map.of("error", e.getMessage() == null ? "Bad request" : e.getMessage()));
        } catch (RuntimeException e) {
            e.printStackTrace();
            return Http.Response.json(500, Map.of("error", "Server error"));
        }
    }

    private Http.Response route(String m, String path, Http.Request req) {
        String[] p = Arrays.stream(path.split("/")).filter(s -> !s.isEmpty()).toArray(String[]::new);
        if (p.length == 0) throw new ApiException(404, "Not found");
        String head = p[0];
        switch (head) {
            case "world": if (m.equals("GET")) return worldInfo(); break;
            case "travel": return travelRules(m, req);
            case "events": return eventRules(m, req);
            case "day": if (m.equals("GET")) return Http.Response.json(weather.day(req.query("region"),
                    intQ(req, "year"), intQ(req, "month"), intQ(req, "day"), lang(req))); break;
            case "month": if (m.equals("GET")) return Http.Response.json(weather.month(req.query("region"),
                    intQ(req, "year"), intQ(req, "month"), lang(req))); break;
            case "field": if (m.equals("GET")) return Http.Response.json(fields.field(
                    intQ(req, "year"), intQ(req, "month"), intQ(req, "day"), lang(req))); break;
            case "me": if (m.equals("GET")) return me(req); break;
            // accounts are shared with Root and Rune: log in, register, log out and change password at /api/auth
            case "register": case "login": case "password": case "account":
                throw new ApiException(410, "Accounts are handled on the start page (/)");
            case "logout": if (m.equals("POST")) { req.session().logout(); return ok(); } break;
            case "state": if (m.equals("PUT")) return saveState(req); break;
            case "campaigns": return campaigns(m, p, req);
            case "notes": return notes(m, req);
            case "import": if (m.equals("POST")) return importNotes(req); break;
            case "export": if (m.equals("GET")) return exportNotes(req); break;
            case "maps": return maps(m, p, req);
            case "symbols": return symbols(m, p, req);
            case "regions": return regions(m, p, req);
            case "tiles": if (m.equals("GET") && p.length == 2 && p[1].equals("check")) return tilesCheck(); break;
            default: break;
        }
        throw new ApiException(404, "Not found");
    }

    // ── Weather ──────────────────────────────────────────────────────────
    private Http.Response worldInfo() {
        List<Map<String, Object>> regions = new ArrayList<>();
        Set<String> custom = store.customRegions().keySet();
        for (String name : world.regionNames()) {
            var n = world.region(name);
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("name", name);
            r.put("temperature", n.getTemperature());
            r.put("rain", n.getRainfall());
            r.put("wind", n.getWindStrength());
            int bh = world.extras(name).baseHeatHeight();
            if (bh != 0) r.put("baseHeight", bh);
            if (!builtInNames.contains(name)) r.put("custom", "new");
            else if (custom.contains(name)) r.put("custom", "changed");
            regions.add(r);
        }
        List<String> calendars = new ArrayList<>();
        for (var c : world.calendars()) calendars.add(c.getName());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("regions", regions);
        out.put("calendars", calendars);
        out.put("religions", world.religions());
        out.put("registrationOpen", registrationOpen);
        Map<String, Object> forces = new LinkedHashMap<>();
        for (String f : FieldService.FORCE_ORDER) forces.put(f, FieldService.aspectsOf(f));
        out.put("forces", forces);
        out.put("travel", travelRulesFor());
        out.put("events", eventRulesFor());
        out.put("version", VERSION);
        return Http.Response.json(out);
    }

    // ── Travel rules (the travel calculator) ───────────────────────────
    // The values everyone starts from: world/travel.yaml, overridden by the admins' values saved in the app.
    // (Each user can still change them for themselves; that is kept in their own page state.)
    private Map<String, Object> travelRulesFor() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("file", world.travelRules());
        String admin = store.appSetting("travel");
        out.put("admin", admin == null ? null : Json.parse(admin));
        return out;
    }

    private Http.Response travelRules(String m, Http.Request req) {
        if (m.equals("GET")) return Http.Response.json(travelRulesFor());
        long uid = requireUser(req);
        if (!store.isAdmin(uid, admins)) throw new ApiException(403, "Only the server's admins may change the travel rules for everyone");
        if (m.equals("PUT")) {
            if (req.body().length > 20_000) throw new ApiException(413, "Too much");
            Object o = Json.parse(new String(req.body(), StandardCharsets.UTF_8));
            if (!(o instanceof Map<?, ?> mp)) throw new ApiException(400, "Expected the travel rules");
            store.setAppSetting("travel", Json.write(checkTravelRules(mp)), uid);
            return Http.Response.json(travelRulesFor());
        }
        if (m.equals("DELETE")) {
            store.setAppSetting("travel", null, uid);
            return Http.Response.json(travelRulesFor());
        }
        throw new ApiException(404, "Not found");
    }

    // ── Event rules (events on journeys) ────────────────────────────────
    // world/events.yaml, or the admins' own version saved in the app (as YAML text, which replaces the file).
    private Map<String, Object> eventRulesFor() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("file", world.eventRules());
        String admin = store.appSetting("events");
        if (admin != null) {
            String yaml = String.valueOf(Json.parseObject(admin).get("yaml"));
            Map<String, Object> a = new LinkedHashMap<>();
            a.put("yaml", yaml);
            try { a.put("rules", parseEventRules(yaml)); } catch (ApiException e) { a.put("error", e.getMessage()); }
            out.put("admin", a);
        } else out.put("admin", null);
        return out;
    }

    private Http.Response eventRules(String m, Http.Request req) {
        if (m.equals("GET")) return Http.Response.json(eventRulesFor());
        long uid = requireUser(req);
        if (!store.isAdmin(uid, admins)) throw new ApiException(403, "Only the server's admins may change the event rules for everyone");
        if (m.equals("PUT")) {
            String yaml = new String(req.body(), StandardCharsets.UTF_8);
            if (yaml.length() > 12_000) throw new ApiException(413, "The rules are too long (at most 12 000 characters)");
            parseEventRules(yaml);                                  // refused if it can't be read
            store.setAppSetting("events", Json.write(Map.of("yaml", yaml)), uid);
            return Http.Response.json(eventRulesFor());
        }
        if (m.equals("DELETE")) {
            store.setAppSetting("events", null, uid);
            return Http.Response.json(eventRulesFor());
        }
        throw new ApiException(404, "Not found");
    }

    /** Event rules from YAML text: a map of plain values (names, numbers, yes/no, lists, maps), checked for size. */
    @SuppressWarnings("unchecked")
    static Map<String, Object> parseEventRules(String yaml) {
        Object o;
        try {
            org.yaml.snakeyaml.LoaderOptions lo = new org.yaml.snakeyaml.LoaderOptions();
            lo.setMaxAliasesForCollections(10);
            o = new org.yaml.snakeyaml.Yaml(new org.yaml.snakeyaml.constructor.SafeConstructor(lo)).load(yaml);
        } catch (Exception e) {
            throw new ApiException(400, "The event rules can't be read: " + e.getMessage().replaceAll("\\s+", " "));
        }
        if (o == null) return new LinkedHashMap<>();
        if (!(o instanceof Map<?, ?>)) throw new ApiException(400, "The event rules must be a list of settings (name: value)");
        return (Map<String, Object>) plain(o, 0);
    }

    private static Object plain(Object o, int depth) {
        if (depth > 6) throw new ApiException(400, "The event rules are nested too deep");
        if (o instanceof Map<?, ?> m) {
            if (m.size() > 60) throw new ApiException(400, "Too many settings in one place in the event rules");
            Map<String, Object> out = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : m.entrySet()) {
                Object v = plain(e.getValue(), depth + 1);
                if (v != null) out.put(limit(String.valueOf(e.getKey()), 60), v);
            }
            return out;
        }
        if (o instanceof List<?> l) {
            if (l.size() > 300) throw new ApiException(400, "A list in the event rules is too long");
            List<Object> out = new ArrayList<>();
            for (Object e : l) { Object v = plain(e, depth + 1); if (v != null) out.add(v); }
            return out;
        }
        if (o instanceof Number n) return Double.isFinite(n.doubleValue()) ? n.doubleValue() : null;
        if (o instanceof Boolean b) return b;
        if (o instanceof String str) return limit(str, 200);
        return o == null ? null : limit(String.valueOf(o), 200);
    }

    /** Travel rules: names to numbers, or to groups of names to numbers (pace, road, steep). Anything else is left out. */
    static Map<String, Object> checkTravelRules(Map<?, ?> in) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<?, ?> e : in.entrySet()) {
            if (out.size() >= 60) break;
            String k = String.valueOf(e.getKey());
            if (!k.matches("[A-Za-z][A-Za-z0-9]{0,30}")) continue;
            if (e.getValue() instanceof Number n && Double.isFinite(n.doubleValue())) out.put(k, n.doubleValue());
            else if (e.getValue() instanceof Map<?, ?> sub) {
                Map<String, Object> g = new LinkedHashMap<>();
                for (Map.Entry<?, ?> f : sub.entrySet()) {
                    String j = String.valueOf(f.getKey());
                    if (j.matches("[A-Za-z][A-Za-z0-9]{0,30}") && f.getValue() instanceof Number n && Double.isFinite(n.doubleValue()) && g.size() < 20) g.put(j, n.doubleValue());
                }
                if (!g.isEmpty()) out.put(k, g);
            }
        }
        return out;
    }

    // ── Aspect symbols ───────────────────────────────────────────────────
    private Http.Response symbols(String m, String[] p, Http.Request req) {
        long uid = requireUser(req);
        if (p.length == 1 && m.equals("GET")) return Http.Response.json(store.symbols(uid));
        if (p.length == 2) {
            String aspect = aspectParam(p[1]);
            switch (m) {
                case "GET": return symbolImage(store.symbol(uid, aspect));
                case "PUT": {
                    byte[] body = req.body();
                    if (body.length > 2_000_000) throw new ApiException(413, "Symbol images can be at most 2 MB");
                    ImageInfo info = ImageInfo.detect(body);
                    if (info == null) throw new ApiException(400, "Upload a PNG, JPEG, GIF, WebP or SVG image");
                    store.setSymbol(uid, aspect, info.type(), body);
                    return Http.Response.json(store.symbols(uid));
                }
                case "DELETE":
                    store.deleteSymbol(uid, aspect);
                    return Http.Response.json(store.symbols(uid));
                default: break;
            }
        }
        throw new ApiException(404, "Not found");
    }

    private static String aspectParam(String raw) {
        String a = java.net.URLDecoder.decode(raw, StandardCharsets.UTF_8);
        if (FieldService.ASPECT_ORDER.contains(a) || FieldService.FORCE_ORDER.contains(a)) return a;
        throw new ApiException(400, "Unknown aspect or force: " + a);
    }

    private static Http.Response symbolImage(Store.MapImage img) {
        return new Http.Response(200, img.type(), img.bytes())
                .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
                .header("X-Content-Type-Options", "nosniff")
                .header("Cache-Control", "private, max-age=86400");
    }

    // ── Accounts ─────────────────────────────────────────────────────────
    private Http.Response me(Http.Request req) {
        Long uid = req.session().userId();
        Map<String, Object> out = new LinkedHashMap<>();
        Optional<Store.User> u = uid == null ? Optional.empty() : store.userById(uid);
        if (uid != null && u.isEmpty()) req.session().logout();
        out.put("user", u.map(x -> Map.<String, Object>of("id", x.id(), "username", x.username())).orElse(null));
        String state = u.isPresent() ? store.state(uid) : null;
        out.put("state", state == null ? null : Json.parse(state));
        out.put("registrationOpen", registrationOpen);
        out.put("admin", u.isPresent() && store.isAdmin(uid, admins));
        // what happened to the database file (repaired at start, a failed backup): for the admins
        if (u.isPresent() && store.isAdmin(uid, admins) && DbGuard.notice() != null) out.put("dbNotice", DbGuard.notice());
        return Http.Response.json(out);
    }

    // ── Regions made in the app ─────────────────────────────────────────
    private long requireAdmin(Http.Request req) {
        long uid = requireUser(req);
        if (!store.isAdmin(uid, admins)) throw new ApiException(403, "Only the server's admins may change regions");
        return uid;
    }

    private Http.Response regions(String m, String[] p, Http.Request req) {
        String sub = p.length > 1 ? p[1] : "";
        switch (sub) {
            case "source" -> {
                if (!m.equals("GET")) break;
                String name = req.query("name");
                Map<String, String> custom = store.customRegions();
                String yaml = regionYaml(name, custom);
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("name", name);
                out.put("custom", custom.containsKey(name));
                out.put("builtIn", builtInNames.contains(name));
                out.put("data", RegionYaml.toData(yaml));
                out.put("yaml", yaml);
                return Http.Response.json(out);
            }
            case "yaml" -> {
                if (!m.equals("GET")) break;
                String name = req.query("name");
                String yaml = regionYaml(name, store.customRegions());
                String file = WorldBuilder.slug(name) + ".yaml";
                return new Http.Response(200, "application/x-yaml; charset=utf-8", yaml.getBytes(StandardCharsets.UTF_8))
                        .header("Content-Disposition", "attachment; filename=\"" + file + "\"");
            }
            case "" -> {
                if (m.equals("PUT")) {
                    long uid = requireAdmin(req);
                    Map<String, Object> b = body(req);
                    if (!(b.get("data") instanceof Map<?, ?> d)) throw new ApiException(400, "Missing region data");
                    @SuppressWarnings("unchecked") Map<String, Object> data = (Map<String, Object>) d;
                    String name = RegionYaml.checkName(data.get("name"));
                    data.put("name", name);
                    String original = b.get("originalName") instanceof String s && !s.isBlank() ? s : null;
                    Map<String, String> custom = store.customRegions();
                    // a new name must not clash with another region made in the app
                    if (custom.containsKey(name) && !name.equals(original))
                        throw new ApiException(409, "There is already a region called " + name);
                    if (original == null && builtInNames.contains(name) && !Boolean.TRUE.equals(b.get("replaceBuiltIn")))
                        throw new ApiException(409, "There is already a region called " + name);
                    String yaml = RegionYaml.toYaml(data);
                    RegionYaml.verify(yaml);
                    // renaming a region made in the app takes its map points along
                    String oldName = original != null && custom.containsKey(original) ? original : null;
                    store.saveCustomRegion(name, oldName, yaml, uid);
                    install(builder.build(store.customRegions()));
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("name", name);
                    return Http.Response.json(out);
                }
                if (m.equals("DELETE")) {
                    requireAdmin(req);
                    String name = req.query("name");
                    if (!store.deleteCustomRegion(name)) throw new ApiException(404, "No region made in the app called " + name);
                    install(builder.build(store.customRegions()));
                    return ok();
                }
            }
            default -> { }
        }
        throw new ApiException(404, "Not found");
    }

    /** The YAML of a region: the one made in the app if there is one, otherwise the world folder's. */
    private String regionYaml(String name, Map<String, String> custom) {
        if (name == null) throw new ApiException(400, "Missing region name");
        if (custom.containsKey(name)) return custom.get(name);
        File f = builder.builtInRegions().get(name);
        if (f == null) throw new ApiException(404, "Unknown region: " + name);
        return RegionYaml.read(f);
    }

    private Http.Response saveState(Http.Request req) {
        long uid = requireUser(req);
        String json = new String(req.body(), StandardCharsets.UTF_8);
        Json.parseObject(json); // validate
        if (json.length() > 4000) throw new ApiException(400, "State too large");
        store.saveState(uid, json);
        return ok();
    }

    // ── Campaigns & notes ────────────────────────────────────────────────
    private Http.Response campaigns(String m, String[] p, Http.Request req) {
        long uid = requireUser(req);
        if (p.length == 1 && m.equals("GET")) return Http.Response.json(store.campaigns(uid));
        if (p.length == 1 && m.equals("POST")) {
            String name = campaignName(str(body(req), "name"));
            long id = store.createCampaign(uid, name);
            return Http.Response.json(Map.of("id", id));
        }
        if (p.length == 2) {
            long id = parseId(p[1]);
            if (m.equals("PUT")) {
                Map<String, Object> b = body(req);
                String name = b.containsKey("name") ? campaignName(str(b, "name")) : null;
                String region = b.containsKey("region") ? str(b, "region") : null;
                Integer y = intOrNull(b, "year"), mo = intOrNull(b, "month"), d = intOrNull(b, "day");
                if (y != null && mo != null && d != null) WeatherService.checkDate(y, mo, d);
                store.updateCampaign(uid, id, name, region, y, mo, d);
                return ok();
            }
            if (m.equals("DELETE")) {
                store.deleteCampaign(uid, id, "true".equals(req.query("merge")));
                return ok();
            }
        }
        throw new ApiException(404, "Not found");
    }

    private static String campaignName(String name) {
        name = name.trim();
        if (name.isEmpty() || name.length() > 100) throw new ApiException(400, "Campaign name must be 1–100 characters");
        return name;
    }

    private Http.Response notes(String m, Http.Request req) {
        long uid = requireUser(req);
        if (m.equals("GET")) {
            long campaign = req.query("campaign") == null ? 0 : parseId(req.query("campaign"));
            return Http.Response.json(store.notes(uid, campaign));
        }
        if (m.equals("PUT")) {
            Map<String, Object> b = body(req);
            long campaign = b.get("campaign") == null ? 0 : ((Number) b.get("campaign")).longValue();
            String date = str(b, "date");
            if (!NotesFormat.isDateKey(date)) throw new ApiException(400, "Date must look like 2977-7-1");
            String text = b.get("text") == null ? "" : str(b, "text");
            if (text.length() > 50_000) throw new ApiException(400, "Note is too long");
            store.setNote(uid, campaign, date, text);
            return ok();
        }
        throw new ApiException(404, "Not found");
    }

    private Http.Response importNotes(Http.Request req) {
        long uid = requireUser(req);
        long campaign = req.query("campaign") == null ? 0 : parseId(req.query("campaign"));
        if (req.body().length > 5_000_000) throw new ApiException(400, "File too large");
        Map<String, String> notes = NotesFormat.parse(new String(req.body(), StandardCharsets.UTF_8));
        int n = store.importNotes(uid, campaign, notes);
        return Http.Response.json(Map.of("found", notes.size(), "imported", n));
    }

    private Http.Response exportNotes(Http.Request req) {
        long uid = requireUser(req);
        long campaign = req.query("campaign") == null ? 0 : parseId(req.query("campaign"));
        String fileName = "comments.yaml";
        if (campaign != 0) {
            for (Map<String, Object> c : store.campaigns(uid))
                if (((Number) c.get("id")).longValue() == campaign)
                    fileName = c.get("name").toString().replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_") + ".yaml";
        }
        String yaml = NotesFormat.write(store.notes(uid, campaign));
        String encoded = java.net.URLEncoder.encode(fileName, StandardCharsets.UTF_8).replace("+", "%20");
        return new Http.Response(200, "text/yaml; charset=utf-8", yaml.getBytes(StandardCharsets.UTF_8))
                .header("Content-Disposition", "attachment; filename=\"export.yaml\"; filename*=UTF-8''" + encoded);
    }

    // ── Maps ─────────────────────────────────────────────────────────────
    private Http.Response maps(String m, String[] p, Http.Request req) {
        Long viewer = req.session().userId();
        if (p.length == 1 && m.equals("GET")) return Http.Response.json(store.maps(viewer));
        if (p.length == 1 && m.equals("POST")) {
            long uid = requireUser(req);
            ImageInfo info = image(req);
            String name = mapName(req.query("name"));
            long id = store.createMap(uid, name, "true".equals(req.query("public")), info.type(), req.body(), info.width(), info.height());
            return Http.Response.json(store.map(id, uid));
        }
        if (p.length >= 2) {
            long id = parseId(p[1]);
            String sub = p.length >= 3 ? p[2] : "";
            switch (sub) {
                case "" -> {
                    if (m.equals("GET")) return Http.Response.json(store.map(id, viewer));
                    if (m.equals("PUT")) {
                        long uid = requireUser(req);
                        Map<String, Object> b = body(req);
                        String name = b.containsKey("name") ? mapName(str(b, "name")) : null;
                        Boolean pub = b.get("isPublic") instanceof Boolean x ? x : null;
                        String settings = null;
                        if (b.get("settings") instanceof Map<?, ?> s) {
                            settings = Json.write(s);
                            if (settings.length() > 4000) throw new ApiException(400, "Settings too large");
                            // zoom tiles: only one of the app's own tile folders
                            Object tiles = s.get("tiles");
                            if (tiles != null && !(tiles instanceof String t && t.matches("tiles/[\\w.-]+/")
                                    && Api.class.getClassLoader().getResource("static/weather/" + t + "manifest.json") != null))
                                throw new ApiException(400, "Unknown tile set");
                        }
                        store.updateMap(uid, id, name, pub, settings);
                        return Http.Response.json(store.map(id, uid));
                    }
                    // removing only hides the map; it is deleted for good a day later (see purgeRemovedMaps)
                    if (m.equals("DELETE")) { long uid = requireUser(req); store.removeMap(uid, id); return Http.Response.json(store.map(id, uid)); }
                }
                case "layer-order" -> {
                    // which regional map lies over which, bottom first: set by the server's admins on the standard map
                    // (settings.layerOrder; it is part of the admin export and of the release, see DefaultMap)
                    if (m.equals("PUT")) {
                        long uid = requireUser(req);
                        if (!store.isAdmin(uid, admins)) throw new ApiException(403, "Only the server's admins may change the order of the map layers");
                        if (!(body(req).get("order") instanceof List<?> raw)) throw new ApiException(400, "Expected a list of layer ids");
                        if (raw.size() > 200) throw new ApiException(400, "Too many layers");
                        List<String> order = new ArrayList<>();
                        for (Object o : raw) {
                            if (!(o instanceof String sid) || !sid.matches("[\\w.-]{1,60}")) throw new ApiException(400, "Not a layer id: " + o);
                            if (order.contains(sid)) throw new ApiException(400, "A layer is listed twice: " + sid);
                            order.add(sid);
                        }
                        store.putDefaultMapSettings(id, Map.of("layerOrder", order));
                        return Http.Response.json(store.map(id, uid));
                    }
                }
                case "restore" -> {
                    if (m.equals("POST")) { long uid = requireUser(req); store.restoreMap(uid, id); return Http.Response.json(store.map(id, uid)); }
                }
                case "export" -> {
                    // for the admins: what differs from the standard map in this release, as one zip (see MapExport)
                    if (m.equals("GET")) {
                        long uid = requireAdmin(req);
                        String who = store.userById(uid).map(Store.User::username).orElse("?");
                        MapExport.Result r = MapExport.build(store, id, uid, who, "1".equals(req.query("all")), req.query("summary") != null,
                                store.customRegions(), builder.builtInRegions());
                        if (req.query("summary") != null) return Http.Response.json(r.manifest());
                        String enc = java.net.URLEncoder.encode(r.fileName(), StandardCharsets.UTF_8).replace("+", "%20");
                        return new Http.Response(200, "application/zip", r.zip())
                                .header("Content-Disposition", "attachment; filename=\"eon-export.zip\"; filename*=UTF-8''" + enc)
                                .header("Cache-Control", "no-store");
                    }
                }
                case "image" -> {
                    if (m.equals("GET")) {
                        Store.MapImage img = store.mapImage(id, viewer);
                        return new Http.Response(200, img.type(), img.bytes()).header("Cache-Control", "private, max-age=300");
                    }
                    if (m.equals("PUT")) {
                        long uid = requireUser(req);
                        ImageInfo info = image(req);
                        store.replaceMapImage(uid, id, info.type(), req.body(), info.width(), info.height());
                        return Http.Response.json(store.map(id, uid));
                    }
                }
                case "height" -> {
                    // a blank height map the size of the map, every pixel at one value (body {"value": 0–255})
                    if (p.length == 4 && p[3].equals("blank") && m.equals("POST")) {
                        long uid = requireUser(req);
                        Map<String, Object> b = body(req);
                        int v = b.get("value") instanceof Number n ? n.intValue() : 121;
                        if (v < 0 || v > 255) throw new ApiException(400, "The height must be 0–255");
                        Map<String, Object> mp = store.map(id, uid);
                        int w = ((Number) mp.get("width")).intValue(), h = ((Number) mp.get("height")).intValue();
                        if ((long) w * h > 60_000_000L) throw new ApiException(400, "The map is too large for a height map");
                        byte[] px = new byte[w * h];
                        Arrays.fill(px, (byte) v);
                        store.setHeightImage(uid, id, "image/png", HeightImages.encodeGrey(w, h, px));
                        // the standard map's scale, unless the map already has one: sea level 120, 100 m per step
                        Map<String, Object> st = new LinkedHashMap<>();
                        if (mp.get("settings") instanceof Map<?, ?> s0) s0.forEach((k, x) -> st.put(String.valueOf(k), x));
                        if (!(st.get("seaLevel") instanceof Number) || !(st.get("metersPerStep") instanceof Number)) {
                            st.put("seaLevel", 120);
                            st.put("metersPerStep", 100);
                            if (!(st.get("blockHeight") instanceof Number)) st.put("blockHeight", 30);
                            store.updateMap(uid, id, null, null, Json.write(st));
                        }
                        return Http.Response.json(store.map(id, uid));
                    }
                    if (m.equals("GET")) {
                        Store.MapImage img = store.heightImage(id, viewer);
                        int rev = store.heightRev(id);
                        Http.Response r = new Http.Response(200, img.type(), img.bytes()).header("Cache-Control", "private, max-age=300")
                                .header("X-Height-Rev", String.valueOf(rev));
                        if (req.query("download") != null) {
                            String base = String.valueOf(store.map(id, viewer).get("name")).replaceAll("[^\\p{L}\\p{N}_.-]+", "-");
                            String file = base + "-hojdkarta-rev" + rev + ".png";
                            String enc = java.net.URLEncoder.encode(file, StandardCharsets.UTF_8).replace("+", "%20");
                            r = r.header("Content-Disposition", "attachment; filename=\"heightmap-rev" + rev + ".png\"; filename*=UTF-8''" + enc);
                        }
                        return r;
                    }
                    if (m.equals("PUT")) {
                        long uid = requireUser(req);
                        ImageInfo info = image(req);
                        store.setHeightImage(uid, id, info.type(), req.body());
                        return Http.Response.json(store.map(id, uid));
                    }
                    if (m.equals("DELETE")) {
                        long uid = requireUser(req);
                        store.deleteHeightImage(uid, id);
                        return Http.Response.json(store.map(id, uid));
                    }
                }
                case "suggestions" -> { return suggestions(m, p, req, id); }
                case "layer-suggestions" -> { return layerSuggestions(m, p, req, id); }
                case "rivers" -> { return listLayer(m, req, id, ListLayer.RIVERS); }
                case "forest" -> { return paintedLayer(m, req, id, viewer, false); }
                case "ice" -> { return paintedLayer(m, req, id, viewer, true); }
                case "marsh" -> { return paintedLayer(m, req, id, viewer, "marsh"); }
                case "roads" -> { return listLayer(m, req, id, ListLayer.ROADS); }
                case "cities" -> { return listLayer(m, req, id, ListLayer.CITIES); }
                case "trips" -> { return trips(m, p, req, id); }
                case "nations" -> { return listLayer(m, req, id, ListLayer.NATIONS); }
                case "ranges" -> { return listLayer(m, req, id, ListLayer.RANGES); }
                case "symbols" -> {
                    if (m.equals("GET")) {
                        long owner = store.mapOwner(id, viewer);
                        if (p.length == 3) return Http.Response.json(store.symbols(owner));
                        return symbolImage(store.symbol(owner, aspectParam(p[3])));
                    }
                }
                case "anchors" -> {
                    if (m.equals("GET")) return Http.Response.json(store.anchors(id, viewer));
                    if (m.equals("PUT")) {
                        long uid = requireUser(req);
                        Object parsed = Json.parse(new String(req.body(), StandardCharsets.UTF_8));
                        if (!(parsed instanceof List<?> list)) throw new ApiException(400, "Expected a list of anchors");
                        if (list.size() > 2000) throw new ApiException(400, "Too many anchors");
                        Set<String> known = new HashSet<>(world.regionNames());
                        List<Store.Anchor> anchors = new ArrayList<>();
                        for (Object o : list) {
                            if (!(o instanceof Map<?, ?> a)) throw new ApiException(400, "Bad anchor");
                            String region = String.valueOf(a.get("region"));
                            if (!known.contains(region)) throw new ApiException(400, "Unknown region: " + region);
                            double x = ((Number) a.get("x")).doubleValue(), y = ((Number) a.get("y")).doubleValue();
                            if (x < 0 || x > 1 || y < 0 || y > 1) throw new ApiException(400, "Anchor outside the map");
                            anchors.add(new Store.Anchor(region, x, y));
                        }
                        store.replaceAnchors(uid, id, anchors);
                        return ok();
                    }
                }
                case "zones" -> {
                    if (m.equals("GET")) return Http.Response.json(store.zones(id, viewer));
                    if (m.equals("PUT")) {
                        long uid = requireUser(req);
                        Object parsed = Json.parse(new String(req.body(), StandardCharsets.UTF_8));
                        if (!(parsed instanceof List<?> list)) throw new ApiException(400, "Expected a list of areas");
                        if (list.size() > 300) throw new ApiException(400, "Too many areas");
                        List<Store.Zone> zones = new ArrayList<>();
                        for (Object o : list) {
                            try {
                                zones.add(parseZone(o));
                            } catch (ApiException e) {
                                throw e;
                            } catch (RuntimeException e) {
                                throw new ApiException(400, "Bad area");
                            }
                        }
                        store.replaceZones(uid, id, zones);
                        return ok();
                    }
                }
                case "leylines" -> {
                    if (m.equals("GET")) return Http.Response.json(store.leylines(id, viewer));
                    if (m.equals("PUT")) {
                        long uid = requireUser(req);
                        Object parsed = Json.parse(new String(req.body(), StandardCharsets.UTF_8));
                        if (!(parsed instanceof List<?> list)) throw new ApiException(400, "Expected a list of leylines");
                        if (list.size() > 500) throw new ApiException(400, "Too many leylines");
                        List<Store.Leyline> lines = new ArrayList<>();
                        for (Object o : list) {
                            try {
                                lines.add(parseLeyline(o));
                            } catch (ApiException e) {
                                throw e;
                            } catch (RuntimeException e) {
                                throw new ApiException(400, "Bad leyline");
                            }
                        }
                        store.replaceLeylines(uid, id, lines);
                        return ok();
                    }
                }
                default -> { }
            }
        }
        throw new ApiException(404, "Not found");
    }

    // ── Zoom images: are all the pieces the manifest lists really there? ──
    /**
     * GET /api/tiles/check: for every zoom image set the maps use, how many pieces each level lists
     * and which of them the server can't find (e.g. a zoom-image zip that wasn't unpacked before building).
     */
    private Http.Response tilesCheck() {
        Set<String> sets = new TreeSet<>();
        for (Map<String, Object> mp : store.maps(null))
            if (mp.get("settings") instanceof Map<?, ?> st && st.get("tiles") instanceof String t && t.matches("tiles/[\\w.-]+/")) sets.add(t);
        ClassLoader cl = Api.class.getClassLoader();
        List<Map<String, Object>> out = new ArrayList<>();
        int totalMissing = 0;
        for (String set : sets) {
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("set", set);
            try (var in = cl.getResourceAsStream("static/weather/" + set + "manifest.json")) {
                if (in == null) { o.put("error", "manifest.json is missing"); out.add(o); totalMissing++; continue; }
                Map<String, Object> man = Json.parseObject(new String(in.readAllBytes(), StandardCharsets.UTF_8));
                List<Map<String, Object>> levels = new ArrayList<>();
                if (man.get("levels") instanceof List<?> ls) for (Object lo : ls) {
                    if (!(lo instanceof Map<?, ?> L) || !(L.get("tiles") instanceof List<?> tl)) continue;
                    String lvl = String.valueOf(L.get("level") instanceof Number n ? n.intValue() : L.get("level"));
                    List<String> missing = new ArrayList<>();
                    for (Object k : tl) if (cl.getResource("static/weather/" + set + lvl + "/" + k + ".jpg") == null) missing.add(String.valueOf(k));
                    Map<String, Object> lv = new LinkedHashMap<>();
                    lv.put("level", lvl);
                    lv.put("listed", tl.size());
                    lv.put("missing", missing.size());
                    lv.put("missingPieces", missing.size() > 200 ? missing.subList(0, 200) : missing);
                    levels.add(lv);
                    totalMissing += missing.size();
                }
                o.put("levels", levels);
                // the map layers: the base map's own zoom images (base/...) and each see-through layer (layers/<id>/...)
                List<Map<String, Object>> parts = new ArrayList<>();
                List<Object[]> todo = new ArrayList<>();
                if (man.get("base") instanceof Map<?, ?> bm) todo.add(new Object[] { "base", "static/weather/" + set + "base/", ".jpg", bm });
                if (man.get("layers") instanceof List<?> ls2) for (Object lo : ls2)
                    if (lo instanceof Map<?, ?> V && V.get("id") instanceof String vid && vid.matches("[\\w.-]+"))
                        todo.add(new Object[] { vid, "static/weather/" + set + "layers/" + vid + "/", ".webp", V });
                for (Object[] t : todo) {
                    String vb = (String) t[1], ext = (String) t[2];
                    Map<?, ?> V = (Map<?, ?>) t[3];
                    List<String> missing = new ArrayList<>();
                    int listed = 0;
                    if (V.get("tiles") instanceof Map<?, ?> vt) for (Map.Entry<?, ?> e : vt.entrySet())
                        if (e.getValue() instanceof List<?> tl) for (Object k : tl) {
                            listed++;
                            if (cl.getResource(vb + e.getKey() + "/" + k + ext) == null) missing.add(e.getKey() + "/" + k);
                        }
                    if (V.get("map") instanceof Map<?, ?> && cl.getResource(vb + "map" + ext) == null) missing.add("map" + ext);
                    Map<String, Object> vv = new LinkedHashMap<>();
                    vv.put("layer", t[0]);
                    vv.put("listed", listed);
                    vv.put("missing", missing.size());
                    vv.put("missingPieces", missing.size() > 200 ? missing.subList(0, 200) : missing);
                    parts.add(vv);
                    totalMissing += missing.size();
                }
                if (!parts.isEmpty()) o.put("layers", parts);
            } catch (java.io.IOException e) {
                o.put("error", e.getMessage());
            }
            out.add(o);
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ok", totalMissing == 0);
        res.put("missing", totalMissing);
        res.put("sets", out);
        return Http.Response.json(res);
    }

    // ── Rivers ──────────────────────────────────────────────────────────
    // Everyone who can see the map sees its rivers; its owner (for the default map: the admins) edits them.
    private static final int MAX_RIVERS = 3000, MAX_RIVER_POINTS = 3000;

    /** A short fingerprint of the stored rivers, so a page can tell whether they changed since it loaded them. */
    static String riversRev(String json) {
        try {
            byte[] h = java.security.MessageDigest.getInstance("SHA-256").digest(json.getBytes(StandardCharsets.UTF_8));
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < 8; i++) b.append(String.format("%02x", h[i]));
            return b.toString();
        } catch (java.security.NoSuchAlgorithmException e) { return Integer.toHexString(json.hashCode()); }
    }


    // ── The list layers: rivers, roads, cities, mountain ranges, nations ─
    // Each is one JSON list per map. Everyone who can see the map reads it; its owner (for the default map: the
    // admins) saves it whole. ?rev= on a save is the version the page started from: if the list was saved from
    // elsewhere since (another tab, another admin), the save is refused rather than overwriting it with an older one.
    enum ListLayer {
        RIVERS("rivers", "river", "floder", Api::checkRivers), ROADS("roads", "road", "vagar", Api::checkRoads),
        CITIES("cities", "city", "stader", Api::checkCities), RANGES("ranges", "mountain range", "bergskedjor", Api::checkRanges),
        NATIONS("nations", "nation", "nationer", Api::checkNations);

        final String name, one, svFile;
        final java.util.function.Function<Object, List<Map<String, Object>>> check;
        final Object lock = new Object();

        ListLayer(String name, String one, String svFile, java.util.function.Function<Object, List<Map<String, Object>>> check) {
            this.name = name; this.one = one; this.svFile = svFile; this.check = check;
        }

        static ListLayer of(String name) {
            for (ListLayer l : values()) if (l.name.equals(name)) return l;
            throw new ApiException(404, "Not found");
        }
    }

    private Http.Response listLayer(String m, Http.Request req, long mapId, ListLayer layer) {
        Long viewer = req.session().userId();
        if (m.equals("GET")) {
            Map<String, Object> map = store.map(mapId, viewer); // access check
            String json = store.list(layer.name, mapId).json();
            if (req.query("download") != null) {
                String base = String.valueOf(map.get("name")).replaceAll("[^\\p{L}\\p{N}_.-]+", "-");
                String enc = java.net.URLEncoder.encode(base + "-" + layer.svFile + ".json", StandardCharsets.UTF_8).replace("+", "%20");
                return new Http.Response(200, "application/json; charset=utf-8", json.getBytes(StandardCharsets.UTF_8))
                        .header("Content-Disposition", "attachment; filename=\"" + layer.name + ".json\"; filename*=UTF-8''" + enc);
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put(layer.name, Json.parse(json));
            out.put("rev", riversRev(json));
            out.put("canEdit", canReview(mapId, viewer));
            return Http.Response.json(out);
        }
        if (m.equals("PUT")) {
            long uid = requireUser(req);
            if (!canReview(mapId, uid)) throw new ApiException(403, "Only the map's owner (for the default map: the admins) can change its " + layer.name);
            if (req.body().length > 20_000_000) throw new ApiException(413, "Too much " + layer.one + " data");
            String json = Json.write(layer.check.apply(Json.parse(new String(req.body(), StandardCharsets.UTF_8))));
            synchronized (layer.lock) {
                String base = req.query("rev");
                if (base != null && !base.isEmpty() && !base.equals(riversRev(store.list(layer.name, mapId).json())))
                    throw new ApiException(409, "The " + layer.name + " were changed elsewhere since this page loaded them");
                store.setList(layer.name, mapId, json, "app", uid);
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("rev", riversRev(json));
            return Http.Response.json(out);
        }
        throw new ApiException(404, "Not found");
    }

    /**
     * A list of rivers: [{ id, name, size 1–10, speed (km/h, optional), points [{x, y}] (0–1, at least 2), joins: null,
     * { river: id, x, y } or { lake: id, x, y }, from: { lake: id } (optional) }], and lakes among
     * them: { id, lake: true, name, x, y } – points in the network that rivers run into and out of.
     * Ids are unique (rivers and lakes together), joins and from name a river or lake that is there,
     * and no water runs (through rivers and lakes) back to where it came from. Returns a cleaned copy.
     */
    static List<Map<String, Object>> checkRivers(Object parsed) {
        if (!(parsed instanceof List<?> list)) throw new ApiException(400, "Expected a list of rivers");
        if (list.size() > MAX_RIVERS) throw new ApiException(400, "Too many rivers");
        List<Map<String, Object>> out = new ArrayList<>();
        // the network: "r<id>" / "l<id>" → where its water goes
        Map<String, List<String>> next = new HashMap<>();
        Set<Long> ids = new HashSet<>(), lakes = new HashSet<>(), rivers = new HashSet<>();
        List<String[]> refs = new ArrayList<>();                     // { from node, to node } to check
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> r)) throw new ApiException(400, "Bad river");
            long id = r.get("id") instanceof Number n ? n.longValue() : -1;
            if (id <= 0 || !ids.add(id)) throw new ApiException(400, "Each river and lake needs its own id");
            String name = r.get("name") instanceof String s ? limit(s.trim(), 100) : "";
            if (Boolean.TRUE.equals(r.get("lake"))) {
                Map<String, Object> p = point(r);
                Map<String, Object> c = new LinkedHashMap<>();
                c.put("id", id); c.put("lake", true); c.put("name", name); c.put("x", p.get("x")); c.put("y", p.get("y"));
                out.add(c);
                lakes.add(id);
                continue;
            }
            rivers.add(id);
            int size = r.get("size") instanceof Number n ? n.intValue() : 0;
            if (size < 1 || size > 10) throw new ApiException(400, "A river's size is 1–10");
            if (!(r.get("points") instanceof List<?> pts) || pts.size() < 2 || pts.size() > MAX_RIVER_POINTS)
                throw new ApiException(400, "A river needs 2–" + MAX_RIVER_POINTS + " points");
            List<Map<String, Object>> cp = new ArrayList<>();
            for (Object po : pts) cp.add(point(po));
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("id", id); c.put("name", name); c.put("size", size); c.put("points", cp);
            // the current (km/h), when set by hand (left out: worked out from the height map in the page)
            if (r.get("speed") instanceof Number sp && Double.isFinite(sp.doubleValue()))
                c.put("speed", Math.round(Math.max(0, Math.min(30, sp.doubleValue())) * 100) / 100.0);
            if (r.get("joins") instanceof Map<?, ?> j) {
                Map<String, Object> jp = point(j);
                Map<String, Object> jc = new LinkedHashMap<>();
                String to;
                if (j.get("lake") instanceof Number n) { jc.put("lake", n.longValue()); to = "l" + n.longValue(); }
                else { long into = j.get("river") instanceof Number n ? n.longValue() : -1; jc.put("river", into); to = "r" + into; }
                jc.putAll(jp);
                c.put("joins", jc);
                next.computeIfAbsent("r" + id, k -> new ArrayList<>()).add(to);
                refs.add(new String[] { "r" + id, to });
            } else c.put("joins", null);
            if (r.get("from") instanceof Map<?, ?> f) {
                long lake = f.get("lake") instanceof Number n ? n.longValue() : -1;
                c.put("from", Map.of("lake", lake));
                next.computeIfAbsent("l" + lake, k -> new ArrayList<>()).add("r" + id);
                refs.add(new String[] { "l" + lake, "r" + id });
            }
            out.add(c);
        }
        for (String[] e : refs) {
            for (String node : e) {
                long nid = Long.parseLong(node.substring(1));
                if (node.startsWith("r") ? !rivers.contains(nid) : !lakes.contains(nid))
                    throw new ApiException(400, "A river joins a river or lake that isn't there");
            }
            if (e[0].equals(e[1])) throw new ApiException(400, "A river joins a river that isn't there");
        }
        // no circles: depth-first, 0 = not seen, 1 = on the way, 2 = done
        Map<String, Integer> state = new HashMap<>();
        for (String start : next.keySet()) {
            if (state.getOrDefault(start, 0) != 0) continue;
            Deque<Object[]> stack = new ArrayDeque<>();
            stack.push(new Object[] { start, 0 });
            state.put(start, 1);
            while (!stack.isEmpty()) {
                Object[] top = stack.peek();
                List<String> nx = next.getOrDefault((String) top[0], List.of());
                int k = (Integer) top[1];
                if (k >= nx.size()) { state.put((String) top[0], 2); stack.pop(); continue; }
                top[1] = k + 1;
                String n = nx.get(k);
                int st = state.getOrDefault(n, 0);
                if (st == 1) throw new ApiException(400, "Rivers can't flow in a circle");
                if (st == 0) { state.put(n, 1); stack.push(new Object[] { n, 0 }); }
            }
        }
        return out;
    }

    private static Map<String, Object> point(Object o) {
        if (!(o instanceof Map<?, ?> p) || !(p.get("x") instanceof Number xn) || !(p.get("y") instanceof Number yn))
            throw new ApiException(400, "Bad river point");
        double x = xn.doubleValue(), y = yn.doubleValue();
        if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) throw new ApiException(400, "River point outside the map");
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("x", x); m.put("y", y);
        return m;
    }

    // ── Painted layers: forests and ice ─────────────────────────────────
    // A greyscale image over the map (0–100). Everyone who can see the map sees it; its owner (for the
    // default map: the admins) changes it.
    private Http.Response paintedLayer(String m, Http.Request req, long id, Long viewer, boolean ice) {
        return paintedLayer(m, req, id, viewer, ice ? "ice" : "forest");
    }

    private Http.Response paintedLayer(String m, Http.Request req, long id, Long viewer, String kind) {
        boolean ice = kind.equals("ice"), marsh = kind.equals("marsh");
        String what = ice ? "ice" : marsh ? "marshland" : "forests";
        if (m.equals("GET")) {
            Map<String, Object> mp = store.map(id, viewer);
            Store.Forest f = store.painted(kind, id);
            if (f == null) throw new ApiException(404, "This map has no " + kind + " map");
            Http.Response r = new Http.Response(200, f.type(), f.image()).header("Cache-Control", "private, max-age=60");
            if (req.query("download") != null) {
                String base = String.valueOf(mp.get("name")).replaceAll("[^\\p{L}\\p{N}_.-]+", "-");
                String enc = java.net.URLEncoder.encode(base + (ice ? "-is.png" : marsh ? "-sumpmark.png" : "-skog.png"), StandardCharsets.UTF_8).replace("+", "%20");
                r = r.header("Content-Disposition", "attachment; filename=\"" + kind + ".png\"; filename*=UTF-8''" + enc);
            }
            return r;
        }
        if (m.equals("PUT") || m.equals("DELETE")) {
            long uid = requireUser(req);
            if (!canReview(id, uid)) throw new ApiException(403, "Only the map's owner (for the default map: the admins) can change its " + what);
            if (store.map(id, uid).containsKey("removedAt")) throw new ApiException(409, "The map is removed. Restore it to change it.");
            if (m.equals("PUT")) {
                ImageInfo info = image(req);
                store.setPainted(kind, id, info.type(), req.body(), "app", uid);
            } else store.deletePainted(kind, id);
            return Http.Response.json(store.map(id, uid));
        }
        throw new ApiException(404, "Not found");
    }

    // ── Roads and paths ─────────────────────────────────────────────────
    // Lines drawn like rivers: { id, name, kind: "path" | "road" | "highway", points: [{x, y}] }. Everyone who
    // can see the map sees them; its owner (for the default map: the admins) edits them. Same version check
    // as the rivers.
    private static final int MAX_ROADS = 5000, MAX_ROAD_POINTS = 5000;
    private static final Set<String> ROAD_KINDS = Set.of("path", "road", "highway");


    /** [{ id, name, kind, points [{x, y}] (0–1, at least 2) }]; ids unique. Returns a cleaned copy. */
    static List<Map<String, Object>> checkRoads(Object parsed) {
        if (!(parsed instanceof List<?> list)) throw new ApiException(400, "Expected a list of roads");
        if (list.size() > MAX_ROADS) throw new ApiException(400, "Too many roads");
        List<Map<String, Object>> out = new ArrayList<>();
        Set<Long> ids = new HashSet<>();
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> r)) throw new ApiException(400, "Bad road");
            long id = r.get("id") instanceof Number n ? n.longValue() : -1;
            if (id <= 0 || !ids.add(id)) throw new ApiException(400, "Each road needs its own id");
            String kind = r.get("kind") instanceof String k && ROAD_KINDS.contains(k) ? k : "road";
            String name = r.get("name") instanceof String s ? limit(s.trim(), 100) : "";
            if (!(r.get("points") instanceof List<?> pts) || pts.size() < 2 || pts.size() > MAX_ROAD_POINTS)
                throw new ApiException(400, "A road needs 2–" + MAX_ROAD_POINTS + " points");
            List<Map<String, Object>> cp = new ArrayList<>();
            for (Object po : pts) cp.add(point(po));
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("id", id); c.put("name", name); c.put("kind", kind); c.put("points", cp);
            out.add(c);
        }
        return out;
    }

    // ── Cities ──────────────────────────────────────────────────────────
    // { id, kind: "city" | "bridge" | "ford", name, population, harbour, floodFrom, floodTo (a ford's flood months), x, y }. Everyone who can see the map sees them; its owner (for the
    // default map: the admins) edits them. Same version check as the rivers and roads. A city joins the roads
    // that pass through it (the travel calculator), and only a city with a harbour lets a sea voyage start.
    private static final int MAX_CITIES = 20000;
    private static final Set<String> CITY_KINDS = Set.of("city", "bridge", "ford");


    /** [{ id, name, population (0 or more), harbour, x, y (0–1) }]; ids unique. Returns a cleaned copy. */
    static List<Map<String, Object>> checkCities(Object parsed) {
        if (!(parsed instanceof List<?> list)) throw new ApiException(400, "Expected a list of cities");
        if (list.size() > MAX_CITIES) throw new ApiException(400, "Too many cities");
        List<Map<String, Object>> out = new ArrayList<>();
        Set<Long> ids = new HashSet<>();
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> r)) throw new ApiException(400, "Bad city");
            long id = r.get("id") instanceof Number n ? n.longValue() : -1;
            if (id <= 0 || !ids.add(id)) throw new ApiException(400, "Each city needs its own id");
            String name = r.get("name") instanceof String s ? limit(s.trim(), 100) : "";
            long pop = r.get("population") instanceof Number n ? Math.max(0, Math.min(1_000_000_000L, n.longValue())) : 0;
            boolean harbour = Boolean.TRUE.equals(r.get("harbour"));
            Map<String, Object> pt = point(r);
            Map<String, Object> c = new LinkedHashMap<>();
            String ckind = r.get("kind") instanceof String k && CITY_KINDS.contains(k) ? k : "city";
            int ff = r.get("floodFrom") instanceof Number n ? Math.max(0, Math.min(12, n.intValue())) : 0;
            int ft = r.get("floodTo") instanceof Number n ? Math.max(0, Math.min(12, n.intValue())) : 0;
            c.put("id", id); c.put("kind", ckind); c.put("name", name); c.put("population", pop); c.put("harbour", harbour);
            if (ckind.equals("ford")) { c.put("floodFrom", ff); c.put("floodTo", ft); }
            c.put("x", pt.get("x")); c.put("y", pt.get("y"));
            out.add(c);
        }
        return out;
    }

    // ── Journeys (the travel calculator) ────────────────────────────────
    // Anyone with an account keeps their own journeys on a map; one marked "shared" is seen by everyone who
    // can see the map. The journey is the page's own JSON (route, start time, speeds, delays…), checked only
    // for size and shape here: the page works out where the token is.
    private Http.Response trips(String m, String[] p, Http.Request req, long mapId) {
        Long viewer = req.session().userId();
        if (p.length == 3 && m.equals("GET")) {
            store.map(mapId, viewer); // access check
            List<Map<String, Object>> out = new ArrayList<>();
            for (Store.Trip t : store.trips(mapId, viewer)) {
                Map<String, Object> o = new LinkedHashMap<>(Json.parseObject(t.json()));
                o.put("id", t.id());
                o.put("owner", t.owner());
                o.put("mine", viewer != null && viewer == t.ownerId());
                out.add(o);
            }
            return Http.Response.json(Map.of("trips", out));
        }
        long uid = requireUser(req);
        store.map(mapId, uid); // access check
        if (p.length == 3 && m.equals("POST")) {
            String json = checkTrip(req);
            long id = store.addTrip(mapId, uid, json);
            return Http.Response.json(Map.of("id", id));
        }
        if (p.length == 4) {
            long tid;
            try { tid = Long.parseLong(p[3]); } catch (NumberFormatException e) { throw new ApiException(404, "Not found"); }
            Store.Trip t = store.trip(tid);
            if (t == null || t.ownerId() != uid) throw new ApiException(404, "No such journey");
            if (m.equals("PUT")) { store.setTrip(tid, checkTrip(req)); return Http.Response.json(Map.of("ok", true)); }
            if (m.equals("DELETE")) { store.deleteTrip(tid); return Http.Response.json(Map.of("ok", true)); }
        }
        throw new ApiException(404, "Not found");
    }

    private static String checkTrip(Http.Request req) {
        if (req.body().length > 2_000_000) throw new ApiException(413, "The journey is too big");
        Object o = Json.parse(new String(req.body(), StandardCharsets.UTF_8));
        if (!(o instanceof Map<?, ?> mp) || !(mp.get("route") instanceof List<?> route) || route.size() < 2)
            throw new ApiException(400, "A journey needs a route");
        Map<String, Object> c = new LinkedHashMap<>();
        for (Map.Entry<?, ?> e : mp.entrySet()) {
            String k = String.valueOf(e.getKey());
            if (k.equals("id") || k.equals("owner") || k.equals("mine")) continue;
            c.put(k, e.getValue());
        }
        return Json.write(c);
    }

    // ── Mountain ranges ─────────────────────────────────────────────────
    // A crest line (points like a river's) with, at any of its points, a width line out to each side:
    // where the range ends. Everyone who can see the map sees them; its owner (for the default map: the
    // admins) edits them. Same version check as the rivers.
    private static final int MAX_RANGES = 2000, MAX_RANGE_POINTS = 3000;


    /**
     * [{ id, name, height (crest, m above the sea; optional), points: [{x, y, l?, r?}] }]: x, y from 0 to 1,
     * at least 2 points; l and r the width line to the left and right of the crest there (map pixels,
     * 0–5000; left/right as seen walking from the first point to the last); from: { range, x, y } for a
     * branch, whose first point lies on that range's crest (no circles). Returns a cleaned copy.
     */
    static List<Map<String, Object>> checkRanges(Object parsed) {
        if (!(parsed instanceof List<?> list)) throw new ApiException(400, "Expected a list of mountain ranges");
        if (list.size() > MAX_RANGES) throw new ApiException(400, "Too many mountain ranges");
        List<Map<String, Object>> out = new ArrayList<>();
        Set<Long> ids = new HashSet<>();
        Map<Long, Long> branchOf = new HashMap<>();
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> r)) throw new ApiException(400, "Bad mountain range");
            long id = r.get("id") instanceof Number n ? n.longValue() : -1;
            if (id < 0 || !ids.add(id)) throw new ApiException(400, "Mountain ranges need distinct ids");
            String name = r.get("name") == null ? "" : r.get("name").toString().trim();
            if (name.length() > 100) throw new ApiException(400, "Mountain range name too long");
            if (!(r.get("points") instanceof List<?> pts) || pts.size() < 2) throw new ApiException(400, "A mountain range needs at least 2 points");
            if (pts.size() > MAX_RANGE_POINTS) throw new ApiException(400, "Too many points in a mountain range");
            List<Map<String, Object>> po = new ArrayList<>();
            for (Object p : pts) {
                if (!(p instanceof Map<?, ?> pm) || !(pm.get("x") instanceof Number x) || !(pm.get("y") instanceof Number y))
                    throw new ApiException(400, "Bad mountain range point");
                double px = x.doubleValue(), py = y.doubleValue();
                if (!(px >= 0 && px <= 1 && py >= 0 && py <= 1)) throw new ApiException(400, "Mountain range point outside the map");
                Map<String, Object> q = new LinkedHashMap<>();
                q.put("x", px);
                q.put("y", py);
                for (String side : new String[]{"l", "r"}) {
                    if (pm.get(side) == null) continue;
                    if (!(pm.get(side) instanceof Number w) || !(w.doubleValue() >= 0 && w.doubleValue() <= 5000))
                        throw new ApiException(400, "Bad mountain range width");
                    q.put(side, Math.round(w.doubleValue() * 100) / 100.0);
                }
                po.add(q);
            }
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("id", id);
            c.put("name", name);
            if (r.get("height") instanceof Number h) {
                double hv = h.doubleValue();
                if (!(hv >= -1000 && hv <= 12000)) throw new ApiException(400, "Mountain range height must be -1000 to 12000 m");
                c.put("height", (int) Math.round(hv));
            }
            c.put("points", po);
            // a branch: its first point lies on another range's crest, where the range splits
            if (r.get("from") instanceof Map<?, ?> f) {
                if (!(f.get("range") instanceof Number pr) || !(f.get("x") instanceof Number fx) || !(f.get("y") instanceof Number fy))
                    throw new ApiException(400, "Bad mountain range branch");
                Map<String, Object> fm = new LinkedHashMap<>();
                fm.put("range", pr.longValue());
                fm.put("x", Math.min(1, Math.max(0, fx.doubleValue())));
                fm.put("y", Math.min(1, Math.max(0, fy.doubleValue())));
                c.put("from", fm);
                branchOf.put(id, pr.longValue());
            }
            out.add(c);
        }
        for (Map.Entry<Long, Long> e : branchOf.entrySet()) {
            if (!ids.contains(e.getValue()) || e.getValue().equals(e.getKey())) throw new ApiException(400, "A mountain range branches off a range that isn't there");
            Set<Long> seen = new HashSet<>();
            Long cur = e.getKey();
            while (cur != null && branchOf.containsKey(cur)) {
                if (!seen.add(cur)) throw new ApiException(400, "Mountain ranges can't branch off each other in a circle");
                cur = branchOf.get(cur);
            }
        }
        return out;
    }

    // ── Nations ─────────────────────────────────────────────────────────
    // Areas drawn as polygons (one or more parts each). Everyone who can see the map sees them; its
    // owner (for the default map: the admins) edits them. Same version check as the rivers.
    private static final int MAX_NATIONS = 2000, MAX_NATION_PARTS = 200, MAX_NATION_POINTS = 20000;


    /**
     * [{ id, name, color "#rrggbb", parts: [[{x, y}, …], …], subs: [{ id, name, parts }] }] with x, y from 0
     * to 1 (subs: the nation's subdivisions); returns a cleaned copy.
     */
    static List<Map<String, Object>> checkNations(Object parsed) {
        if (!(parsed instanceof List<?> list)) throw new ApiException(400, "Expected a list of nations");
        if (list.size() > MAX_NATIONS) throw new ApiException(400, "Too many nations");
        List<Map<String, Object>> out = new ArrayList<>();
        Set<Long> ids = new HashSet<>();
        int total = 0;
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> n)) throw new ApiException(400, "Bad nation");
            long id = n.get("id") instanceof Number x ? x.longValue() : -1;
            if (id <= 0 || !ids.add(id)) throw new ApiException(400, "Each nation needs its own id");
            String name = n.get("name") instanceof String s ? limit(s.trim(), 100) : "";
            String color = n.get("color") instanceof String s && s.matches("#[0-9a-fA-F]{6}") ? s.toLowerCase() : "#c0504d";
            if (!(n.get("parts") instanceof List<?> parts) || parts.size() > MAX_NATION_PARTS) throw new ApiException(400, "Bad nation parts");
            int[] count = { total };
            List<List<Map<String, Object>>> cp = nationParts(parts, count);
            List<Map<String, Object>> subs = new ArrayList<>();
            if (n.get("subs") instanceof List<?> sl) {
                if (sl.size() > 500) throw new ApiException(400, "Too many subdivisions");
                Set<Long> sids = new HashSet<>();
                for (Object so : sl) {
                    if (!(so instanceof Map<?, ?> s)) throw new ApiException(400, "Bad subdivision");
                    long sid = s.get("id") instanceof Number x ? x.longValue() : -1;
                    if (sid <= 0 || !sids.add(sid)) throw new ApiException(400, "Each subdivision needs its own id");
                    if (!(s.get("parts") instanceof List<?> sp) || sp.size() > MAX_NATION_PARTS) throw new ApiException(400, "Bad subdivision parts");
                    Map<String, Object> sc = new LinkedHashMap<>();
                    sc.put("id", sid); sc.put("name", s.get("name") instanceof String sn ? limit(sn.trim(), 100) : "");
                    sc.put("parts", nationParts(sp, count));
                    subs.add(sc);
                }
            }
            total = count[0];
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("id", id); c.put("name", name); c.put("color", color); c.put("parts", cp); c.put("subs", subs);
            out.add(c);
        }
        return out;
    }

    private static List<List<Map<String, Object>>> nationParts(List<?> parts, int[] count) {
        List<List<Map<String, Object>>> cp = new ArrayList<>();
        for (Object po : parts) {
            if (!(po instanceof List<?> pts)) throw new ApiException(400, "Bad nation part");
            if (pts.isEmpty()) continue;
            count[0] += pts.size();
            if (count[0] > MAX_NATION_POINTS) throw new ApiException(400, "Too many nation points");
            List<Map<String, Object>> c = new ArrayList<>();
            for (Object p : pts) c.add(point(p));
            cp.add(c);
        }
        return cp;
    }

    // ── Height map suggestions ──────────────────────────────────────────
    // Anyone with an account may suggest a change to a map's height map; everyone sees the suggestions.
    // The map's owner decides (for the built-in default map: the server's admins).
    private static final int MAX_OPEN_SUGGESTIONS = 30;
    private static final long MAX_PATCH_PIXELS = 4_000_000L;
    private final Object heightLock = new Object();

    private boolean canReview(long mapId, Long uid) {
        if (uid == null) return false;
        Store.MapAccess a = store.mapAccess(mapId, uid);
        return a.ownerId() == uid || (a.isDefault() && store.isAdmin(uid, admins));
    }

    private Http.Response suggestions(String m, String[] p, Http.Request req, long mapId) {
        Long viewer = req.session().userId();
        if (p.length == 3) {
            if (m.equals("GET")) {
                Map<String, Object> map = store.map(mapId, viewer); // access check
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("rev", store.heightRev(mapId));
                out.put("canReview", canReview(mapId, viewer));
                out.put("canSuggest", viewer != null && Boolean.TRUE.equals(map.get("hasHeight")));
                out.put("items", store.suggestions(mapId, viewer));
                return Http.Response.json(out);
            }
            if (m.equals("POST")) return createSuggestion(req, mapId);
        }
        if (p.length >= 4) {
            long sid = parseId(p[3]);
            String action = p.length >= 5 ? p[4] : "";
            if (action.equals("patch") && m.equals("GET")) {
                store.map(mapId, viewer); // access check
                return new Http.Response(200, "image/png", store.suggestionPatch(mapId, sid)).header("Cache-Control", "private, max-age=86400");
            }
            if (action.equals("old") && m.equals("GET")) {
                // the heights an accepted suggestion replaced (for showing "before")
                store.map(mapId, viewer); // access check
                byte[] old = store.suggestion(mapId, sid).oldVals();
                if (old == null) throw new ApiException(404, "Not accepted");
                return new Http.Response(200, "image/png", old).header("Cache-Control", "private, max-age=86400");
            }
            if (m.equals("POST")) {
                long uid = requireUser(req);
                store.map(mapId, uid); // access check
                Map<String, Object> b = req.body().length > 0 ? body(req) : Map.of();
                String reply = b.get("reply") instanceof String r && !r.isBlank() ? limit(r.trim(), 2000) : null;
                switch (action) {
                    case "vote" -> {
                        Store.Suggestion s = store.suggestion(mapId, sid);
                        int n = store.vote(s.id(), uid, !Boolean.FALSE.equals(b.get("on")));
                        return Http.Response.json(Map.of("votes", n));
                    }
                    case "withdraw" -> {
                        Store.Suggestion s = store.suggestion(mapId, sid);
                        if (s.authorId() == null || s.authorId() != uid) throw new ApiException(403, "Only the one who made the suggestion can withdraw it");
                        store.closeSuggestion(mapId, sid, "withdrawn", null, null, null);
                        return ok();
                    }
                    case "reject" -> {
                        requireReviewer(mapId, uid);
                        store.closeSuggestion(mapId, sid, "rejected", uid, reply, null);
                        return ok();
                    }
                    case "accept" -> {
                        requireReviewer(mapId, uid);
                        acceptSuggestion(mapId, sid, uid, reply);
                        return Http.Response.json(Map.of("rev", store.heightRev(mapId)));
                    }
                    case "undo" -> {
                        requireReviewer(mapId, uid);
                        undoSuggestion(mapId, sid, uid);
                        return Http.Response.json(Map.of("rev", store.heightRev(mapId)));
                    }
                    default -> { }
                }
            }
        }
        throw new ApiException(404, "Not found");
    }

    private void requireReviewer(long mapId, long uid) {
        if (!canReview(mapId, uid)) throw new ApiException(403, "Only the map's owner (for the default map: the admins) can decide on suggestions");
    }

    private static String limit(String s, int n) { return s.length() > n ? s.substring(0, n) : s; }

    /** POST /maps/{id}/suggestions?x=&y=&baseRev=&comment=[&replaces=] with a grey + alpha PNG patch as the body. */
    private Http.Response createSuggestion(Http.Request req, long mapId) {
        long uid = requireUser(req);
        store.map(mapId, uid); // access check
        byte[] body = req.body();
        if (body.length > 8_000_000) throw new ApiException(413, "The suggestion is too large (at most 8 MB)");
        ImageInfo info = ImageInfo.detect(body);
        if (info == null || !"image/png".equals(info.type())) throw new ApiException(400, "The suggestion must be a PNG image");
        if ((long) info.width() * info.height() > MAX_PATCH_PIXELS)
            throw new ApiException(400, "The suggestion covers too large an area — split it into smaller ones");
        if (store.openSuggestionsBy(mapId, uid) >= MAX_OPEN_SUGGESTIONS)
            throw new ApiException(429, "You have " + MAX_OPEN_SUGGESTIONS + " open suggestions on this map — wait until some are decided");
        String comment = req.query("comment");
        comment = comment == null ? "" : limit(comment.trim(), 2000);
        int x = intQ(req, "x"), y = intQ(req, "y"), baseRev = intQ(req, "baseRev");
        Long replaces = req.query("replaces") == null ? null : parseId(req.query("replaces"));
        if (replaces != null) requireReviewer(mapId, uid);
        Store.HeightState hs = store.heightState(mapId);
        if (hs == null) throw new ApiException(400, "This map has no height map");
        HeightImages.Grey g = HeightImages.decodeGrey(hs.image());
        HeightImages.Patch patch = HeightImages.decodePatch(body);
        if (x < 0 || y < 0 || x + patch.w() > g.w() || y + patch.h() > g.h())
            throw new ApiException(400, "The suggestion lies outside the height map");
        Object sl = store.map(mapId, uid).get("settings") instanceof Map<?, ?> st ? st.get("seaLevel") : null;
        Integer sea = sl instanceof Number n ? n.intValue() : null;
        Store.SuggestionStats stats = HeightPatches.stats(g, patch, x, y, sea);
        if (stats.changed() == 0) throw new ApiException(400, "The suggestion doesn't change anything");
        long id = store.createSuggestion(mapId, uid, comment, x, y, patch.w(), patch.h(), Math.min(baseRev, hs.rev()), stats, body);
        if (replaces != null) store.closeSuggestion(mapId, replaces, "replaced", uid, null, id);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", id);
        out.put("changed", stats.changed());
        return Http.Response.json(out);
    }

    private void acceptSuggestion(long mapId, long sid, long uid, String reply) {
        synchronized (heightLock) {
            Store.Suggestion s = store.suggestion(mapId, sid);
            if (!"open".equals(s.status())) throw new ApiException(409, "That suggestion is no longer open");
            Store.HeightState hs = store.heightState(mapId);
            if (hs == null) throw new ApiException(400, "This map has no height map");
            HeightImages.Grey g = HeightImages.decodeGrey(hs.image());
            HeightImages.Patch patch = HeightImages.decodePatch(s.patch());
            byte[] old = HeightPatches.apply(g, patch, s.x(), s.y());
            store.acceptSuggestion(mapId, sid, uid, reply, HeightImages.encodeGrey(g.w(), g.h(), g.data()), hs.rev(),
                    HeightImages.encodeGrey(patch.w(), patch.h(), old));
        }
    }

    private void undoSuggestion(long mapId, long sid, long uid) {
        synchronized (heightLock) {
            Store.Suggestion s = store.suggestion(mapId, sid);
            if (!"accepted".equals(s.status()) || s.oldVals() == null) throw new ApiException(409, "Only an accepted suggestion can be undone");
            Store.HeightState hs = store.heightState(mapId);
            HeightImages.Grey g = HeightImages.decodeGrey(hs.image());
            HeightImages.Patch patch = HeightImages.decodePatch(s.patch());
            HeightPatches.undo(g, patch, HeightImages.decodeGrey(s.oldVals()).data(), s.x(), s.y());
            store.undoSuggestion(mapId, sid, uid, HeightImages.encodeGrey(g.w(), g.h(), g.data()), hs.rev());
        }
    }

    // ── Suggestions for the other layers ────────────────────────────────
    // Like the height map's: anyone with an account suggests a change to the rivers, roads, mountain ranges,
    // nations, forest or ice; the map's owner (for the default map: the admins) accepts or rejects it.
    // A list layer's suggestion is a change by id: { added: [items], removed: [items], changed: [{ before, after }] },
    // put onto the layer as it is when accepted. A painted layer's is a grey + alpha patch, as for heights.
    private static final Set<String> LIST_LAYERS = Set.of("rivers", "roads", "ranges", "nations");
    private static final Set<String> IMAGE_LAYERS = Set.of("forest", "ice");
    private static final int MAX_DIFF_ITEMS = 3000;

    private Http.Response layerSuggestions(String m, String[] p, Http.Request req, long mapId) {
        Long viewer = req.session().userId();
        if (p.length == 3) {
            if (m.equals("GET")) {
                store.map(mapId, viewer); // access check
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("canReview", canReview(mapId, viewer));
                out.put("canSuggest", viewer != null);
                out.put("items", store.layerSuggestions(mapId, viewer));
                return Http.Response.json(out);
            }
            if (m.equals("POST")) return createLayerSuggestion(req, mapId);
        }
        if (p.length >= 4) {
            long sid = parseId(p[3]);
            String action = p.length >= 5 ? p[4] : "";
            if ((action.equals("data") || action.equals("old")) && m.equals("GET")) {
                store.map(mapId, viewer); // access check
                Store.LayerSuggestion s = store.layerSuggestion(mapId, sid);
                byte[] d = action.equals("data") ? s.data() : s.oldData();
                if (d == null) throw new ApiException(404, "Not accepted");
                String type = IMAGE_LAYERS.contains(s.layer()) ? "image/png" : "application/json; charset=utf-8";
                return new Http.Response(200, type, d).header("Cache-Control", "private, max-age=3600");
            }
            if (m.equals("POST")) {
                long uid = requireUser(req);
                store.map(mapId, uid); // access check
                Map<String, Object> b = req.body().length > 0 ? body(req) : Map.of();
                String reply = b.get("reply") instanceof String r && !r.isBlank() ? limit(r.trim(), 2000) : null;
                Store.LayerSuggestion s = store.layerSuggestion(mapId, sid);
                switch (action) {
                    case "vote" -> { return Http.Response.json(Map.of("votes", store.layerVote(s.id(), uid, !Boolean.FALSE.equals(b.get("on"))))); }
                    case "withdraw" -> {
                        if (s.authorId() == null || s.authorId() != uid) throw new ApiException(403, "Only the one who made the suggestion can withdraw it");
                        store.closeLayerSuggestion(mapId, sid, "withdrawn", null, null, null);
                        return ok();
                    }
                    case "reject" -> {
                        requireReviewer(mapId, uid);
                        store.closeLayerSuggestion(mapId, sid, "rejected", uid, reply, null);
                        return ok();
                    }
                    case "accept" -> {
                        requireReviewer(mapId, uid);
                        if (store.map(mapId, uid).containsKey("removedAt")) throw new ApiException(409, "The map is removed. Restore it to change it.");
                        if (!"open".equals(s.status())) throw new ApiException(409, "That suggestion is no longer open");
                        byte[] old = IMAGE_LAYERS.contains(s.layer()) ? acceptImageSuggestion(mapId, s, uid, false) : acceptListSuggestion(mapId, s, uid, false);
                        store.closeLayerSuggestion(mapId, sid, "accepted", uid, reply, old);
                        return ok();
                    }
                    case "undo" -> {
                        requireReviewer(mapId, uid);
                        if (!"accepted".equals(s.status()) || s.oldData() == null) throw new ApiException(409, "Only an accepted suggestion can be undone");
                        if (IMAGE_LAYERS.contains(s.layer())) acceptImageSuggestion(mapId, s, uid, true); else acceptListSuggestion(mapId, s, uid, true);
                        store.undoLayerSuggestion(mapId, sid, uid);
                        return ok();
                    }
                    default -> { }
                }
            }
        }
        throw new ApiException(404, "Not found");
    }

    /**
     * POST /maps/{id}/layer-suggestions: for rivers, roads, ranges or nations a JSON body
     * { layer, comment, diff: { added, removed, changed } }; for forest or ice a grey + alpha PNG patch with
     * ?layer=&x=&y=&iw=&ih=&comment= (iw × ih: the size of the layer image it was painted on).
     */
    @SuppressWarnings("unchecked")
    private Http.Response createLayerSuggestion(Http.Request req, long mapId) {
        long uid = requireUser(req);
        store.map(mapId, uid); // access check
        if (store.openLayerSuggestionsBy(mapId, uid) >= MAX_OPEN_SUGGESTIONS)
            throw new ApiException(429, "You have " + MAX_OPEN_SUGGESTIONS + " open suggestions on this map — wait until some are decided");
        String q = req.query("layer");
        long id;
        if (q != null && IMAGE_LAYERS.contains(q)) {
            byte[] body = req.body();
            if (body.length > 8_000_000) throw new ApiException(413, "The suggestion is too large (at most 8 MB)");
            ImageInfo info = ImageInfo.detect(body);
            if (info == null || !"image/png".equals(info.type())) throw new ApiException(400, "The suggestion must be a PNG image");
            if ((long) info.width() * info.height() > MAX_PATCH_PIXELS)
                throw new ApiException(400, "The suggestion covers too large an area — split it into smaller ones");
            int x = intQ(req, "x"), y = intQ(req, "y"), iw = intQ(req, "iw"), ih = intQ(req, "ih");
            if (iw < 1 || ih < 1 || iw > 16384 || ih > 16384) throw new ApiException(400, "Bad layer size");
            HeightImages.Patch patch = HeightImages.decodePatch(body);
            if (x < 0 || y < 0 || x + patch.w() > iw || y + patch.h() > ih) throw new ApiException(400, "The suggestion lies outside the layer");
            HeightImages.Grey cur = layerGrey(mapId, q.equals("ice"), iw, ih);
            int changed = 0, more = 0, less = 0;
            for (int py = 0; py < patch.h(); py++) for (int px = 0; px < patch.w(); px++) {
                int i = py * patch.w() + px;
                if (!patch.mask()[i]) continue;
                int now = Math.min(100, patch.values()[i] & 255), was = cur.at(x + px, y + py);
                if (now == was) continue;
                changed++;
                if (now > was) more++; else less++;
            }
            if (changed == 0) throw new ApiException(400, "The suggestion doesn't change anything");
            String comment = req.query("comment");
            comment = comment == null ? "" : limit(comment.trim(), 2000);
            Map<String, Object> inf = new LinkedHashMap<>();
            inf.put("changed", changed); inf.put("more", more); inf.put("less", less);
            id = store.addLayerSuggestion(mapId, uid, q, comment, x, y, patch.w(), patch.h(), iw, ih, Json.write(inf), body);
        } else {
            if (req.body().length > 10_000_000) throw new ApiException(413, "The suggestion is too large");
            Map<String, Object> b = body(req);
            String layer = b.get("layer") instanceof String l ? l : "";
            if (!LIST_LAYERS.contains(layer)) throw new ApiException(400, "Unknown layer");
            if (!(b.get("diff") instanceof Map<?, ?> diff)) throw new ApiException(400, "Missing the change");
            Map<String, Object> clean = cleanDiff((Map<String, Object>) diff);
            int n = ((List<?>) clean.get("added")).size() + ((List<?>) clean.get("removed")).size() + ((List<?>) clean.get("changed")).size();
            if (n == 0) throw new ApiException(400, "The suggestion doesn't change anything");
            // does it fit the layer as it is now?
            try { applyDiff(layer, listOf(mapId, layer), clean); }
            catch (ApiException e) { throw new ApiException(400, "The change doesn't fit the map's current " + layer + ": " + e.getMessage()); }
            String comment = b.get("comment") instanceof String c ? limit(c.trim(), 2000) : "";
            id = store.addLayerSuggestion(mapId, uid, layer, comment, null, null, null, null, null, null, Json.write(diffInfo(clean)),
                    Json.write(clean).getBytes(StandardCharsets.UTF_8));
        }
        return Http.Response.json(Map.of("id", id));
    }

    /** { added, removed, changed } with only items that have an id (maps), at most MAX_DIFF_ITEMS in all. */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> cleanDiff(Map<String, Object> d) {
        Map<String, Object> out = new LinkedHashMap<>();
        int[] total = { 0 };
        for (String k : List.of("added", "removed")) {
            List<Object> l = new ArrayList<>();
            if (d.get(k) instanceof List<?> src) for (Object o : src) l.add(item(o, total));
            out.put(k, l);
        }
        List<Object> ch = new ArrayList<>();
        if (d.get("changed") instanceof List<?> src) for (Object o : src) {
            if (!(o instanceof Map<?, ?> c)) throw new ApiException(400, "Bad change");
            Map<String, Object> bf = item(c.get("before"), total), af = item(c.get("after"), total);
            if (!idOf(bf).equals(idOf(af))) throw new ApiException(400, "A change must keep its id");
            ch.add(Map.of("before", bf, "after", af));
        }
        out.put("changed", ch);
        return out;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> item(Object o, int[] total) {
        if (!(o instanceof Map<?, ?> m) || !(m.get("id") instanceof Number)) throw new ApiException(400, "Each item needs an id");
        if (++total[0] > MAX_DIFF_ITEMS) throw new ApiException(400, "Too many changes in one suggestion");
        return (Map<String, Object>) m;
    }

    private static Long idOf(Map<String, Object> m) { return ((Number) m.get("id")).longValue(); }

    /** A short summary for the list: how many added, removed, changed, some names and the area (0–1) it covers. */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> diffInfo(Map<String, Object> d) {
        Map<String, Object> inf = new LinkedHashMap<>();
        inf.put("added", ((List<?>) d.get("added")).size());
        inf.put("removed", ((List<?>) d.get("removed")).size());
        inf.put("changed", ((List<?>) d.get("changed")).size());
        List<String> names = new ArrayList<>();
        double[] box = { 2, 2, -1, -1 };
        List<Object> all = new ArrayList<>((List<Object>) d.get("added"));
        all.addAll((List<Object>) d.get("removed"));
        for (Object c : (List<Object>) d.get("changed")) { all.add(((Map<?, ?>) c).get("before")); all.add(((Map<?, ?>) c).get("after")); }
        for (Object o : all) {
            Map<?, ?> it = (Map<?, ?>) o;
            if (it.get("name") instanceof String nm && !nm.isBlank() && !names.contains(nm.trim()) && names.size() < 8) names.add(limit(nm.trim(), 60));
            growBox(it, box);
        }
        inf.put("names", names);
        if (box[2] >= box[0]) inf.put("box", List.of(box[0], box[1], box[2], box[3]));
        return inf;
    }

    /** Every {x, y} in an item (points, parts, subs, a lake's own point) into the box. */
    private static void growBox(Object o, double[] box) {
        if (o instanceof Map<?, ?> m) {
            if (m.get("x") instanceof Number x && m.get("y") instanceof Number y) {
                double px = x.doubleValue(), py = y.doubleValue();
                if (px >= 0 && px <= 1 && py >= 0 && py <= 1) {
                    box[0] = Math.min(box[0], px); box[1] = Math.min(box[1], py); box[2] = Math.max(box[2], px); box[3] = Math.max(box[3], py);
                }
            }
            for (String k : List.of("points", "parts", "subs")) if (m.get(k) != null) growBox(m.get(k), box);
        } else if (o instanceof List<?> l) for (Object e : l) growBox(e, box);
    }

    private List<Object> listOf(long mapId, String layer) {
        String json = store.list(layer, mapId).json();
        Object o = Json.parse(json);
        return o instanceof List<?> l ? new ArrayList<>(l) : new ArrayList<>();
    }

    private Object lockOf(String layer) {
        return ListLayer.of(layer).lock;
    }

    /** Puts a list suggestion onto the layer (or, undo, takes it off again); returns how to undo it. */
    @SuppressWarnings("unchecked")
    private byte[] acceptListSuggestion(long mapId, Store.LayerSuggestion s, long uid, boolean undo) {
        String layer = s.layer();
        Map<String, Object> d = (Map<String, Object>) Json.parse(new String(undo ? s.oldData() : s.data(), StandardCharsets.UTF_8));
        if (undo) {
            // the inverse: what was added goes, what was removed comes back, changes go back
            Map<String, Object> inv = new LinkedHashMap<>();
            inv.put("added", d.get("removed"));
            inv.put("removed", d.get("added"));
            List<Object> ch = new ArrayList<>();
            for (Object o : (List<Object>) d.get("changed")) { Map<?, ?> c = (Map<?, ?>) o; ch.add(Map.of("before", c.get("after"), "after", c.get("before"))); }
            inv.put("changed", ch);
            d = inv;
        }
        synchronized (lockOf(layer)) {
            Applied a;
            try { a = applyDiff(layer, listOf(mapId, layer), d); }
            catch (ApiException e) { throw new ApiException(409, "The change no longer fits the map's " + layer + ": " + e.getMessage()); }
            String json = Json.write(a.list());
            store.setList(layer, mapId, json, "app", uid);
            return Json.write(a.done()).getBytes(StandardCharsets.UTF_8);
        }
    }

    /** The layer after the change, checked, and the change as it was really made (ids as given), for undoing. */
    record Applied(List<Map<String, Object>> list, Map<String, Object> done) {}

    @SuppressWarnings("unchecked")
    static Applied applyDiff(String layer, List<Object> current, Map<String, Object> d) {
        List<Map<String, Object>> cur = new ArrayList<>();
        for (Object o : current) cur.add(new LinkedHashMap<>((Map<String, Object>) o));
        List<Object> doneAdded = new ArrayList<>(), doneRemoved = new ArrayList<>(), doneChanged = new ArrayList<>();
        // removed: gone if still there
        for (Object o : (List<Object>) d.getOrDefault("removed", List.of())) {
            long id = idOf((Map<String, Object>) o);
            for (int i = 0; i < cur.size(); i++) if (idOf(cur.get(i)) == id) { doneRemoved.add(cur.remove(i)); break; }
        }
        List<Map<String, Object>> afters = new ArrayList<>();
        for (Object o : (List<Object>) d.getOrDefault("changed", List.of()))
            afters.add(deepCopy((Map<String, Object>) ((Map<?, ?>) o).get("after")));
        List<Map<String, Object>> added = new ArrayList<>();
        for (Object o : (List<Object>) d.getOrDefault("added", List.of())) added.add(deepCopy((Map<String, Object>) o));
        // new items get new ids where theirs are taken meanwhile (and what refers to them follows)
        Set<Long> used = new HashSet<>();
        for (Map<String, Object> c : cur) used.add(idOf(c));
        for (Map<String, Object> a : afters) used.add(idOf(a));
        long next = 1;
        for (long u : used) next = Math.max(next, u + 1);
        Map<Long, Long> remap = new HashMap<>();
        for (Map<String, Object> a : added) {
            long id = idOf(a);
            if (used.contains(id)) { remap.put(id, next); a.put("id", next); id = next++; }
            used.add(id);
            next = Math.max(next, id + 1);
        }
        if (!remap.isEmpty()) {
            for (Map<String, Object> a : added) remapRefs(layer, a, remap);
            for (Map<String, Object> a : afters) remapRefs(layer, a, remap);
        }
        // changed: replace (or put back, if it was removed meanwhile)
        for (Map<String, Object> af : afters) {
            long id = idOf(af);
            int at = -1;
            for (int i = 0; i < cur.size(); i++) if (idOf(cur.get(i)) == id) { at = i; break; }
            if (at >= 0) { doneChanged.add(Map.of("before", cur.get(at), "after", af)); cur.set(at, af); }
            else { cur.add(af); doneAdded.add(af); }
        }
        cur.addAll(added);
        doneAdded.addAll(added);
        List<Map<String, Object>> checked = ListLayer.of(layer).check.apply(cur);
        Map<String, Object> done = new LinkedHashMap<>();
        done.put("added", doneAdded); done.put("removed", doneRemoved); done.put("changed", doneChanged);
        return new Applied(checked, done);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> deepCopy(Map<String, Object> m) {
        return (Map<String, Object>) Json.parse(Json.write(m));
    }

    /** Ids an item refers to: rivers → joins.river, joins.lake, from.lake; ranges → from.range. */
    @SuppressWarnings("unchecked")
    private static void remapRefs(String layer, Map<String, Object> it, Map<Long, Long> remap) {
        List<String[]> refs = layer.equals("rivers") ? List.of(new String[] { "joins", "river" }, new String[] { "joins", "lake" }, new String[] { "from", "lake" })
                : layer.equals("ranges") ? List.<String[]>of(new String[] { "from", "range" }) : List.of();
        for (String[] r : refs) {
            if (it.get(r[0]) instanceof Map<?, ?> m && m.get(r[1]) instanceof Number n && remap.containsKey(n.longValue())) {
                Map<String, Object> c = new LinkedHashMap<>((Map<String, Object>) m);
                c.put(r[1], remap.get(n.longValue()));
                it.put(r[0], c);
            }
        }
    }

    /** The forest or ice layer as grey values at iw × ih (resampled if stored at another size; none: all 0). */
    private HeightImages.Grey layerGrey(long mapId, boolean ice, int iw, int ih) {
        Store.Forest f = ice ? store.ice(mapId) : store.forest(mapId);
        if (f == null) return new HeightImages.Grey(iw, ih, new byte[iw * ih]);
        HeightImages.Grey g = HeightImages.decodeGrey(f.image());
        if (g.w() == iw && g.h() == ih) return g;
        byte[] out = new byte[iw * ih];
        for (int y = 0; y < ih; y++) {
            int sy = Math.min(g.h() - 1, (int) ((y + 0.5) * g.h() / ih));
            for (int x = 0; x < iw; x++) out[y * iw + x] = g.data()[sy * g.w() + Math.min(g.w() - 1, (int) ((x + 0.5) * g.w() / iw))];
        }
        return new HeightImages.Grey(iw, ih, out);
    }

    private final Object paintedLock = new Object();

    /** Paints a forest / ice suggestion onto its layer (or, undo, puts back what it replaced); returns what it replaced. */
    private byte[] acceptImageSuggestion(long mapId, Store.LayerSuggestion s, long uid, boolean undo) {
        boolean ice = s.layer().equals("ice");
        synchronized (paintedLock) {
            HeightImages.Grey g = layerGrey(mapId, ice, s.iw(), s.ih());
            HeightImages.Patch raw = HeightImages.decodePatch(s.data());
            byte[] v = raw.values().clone();
            for (int i = 0; i < v.length; i++) if ((v[i] & 255) > 100) v[i] = 100;   // 0–100 on these layers
            HeightImages.Patch patch = new HeightImages.Patch(raw.w(), raw.h(), v, raw.mask());
            byte[] old = null;
            if (undo) HeightPatches.undo(g, patch, HeightImages.decodeGrey(s.oldData()).data(), s.x(), s.y());
            else old = HeightPatches.apply(g, patch, s.x(), s.y());
            byte[] png = HeightImages.encodeGrey(g.w(), g.h(), g.data());
            store.setPainted(ice ? "ice" : "forest", mapId, "image/png", png, "app", uid);
            return old == null ? null : HeightImages.encodeGrey(patch.w(), patch.h(), old);
        }
    }

    private static ImageInfo image(Http.Request req) {
        byte[] body = req.body();
        if (body.length > MAX_IMAGE_BYTES) throw new ApiException(413, "Image is larger than 30 MB");
        ImageInfo info = ImageInfo.detect(body);
        if (info == null || info.width() <= 0 || info.height() <= 0)
            throw new ApiException(400, "Upload a PNG, JPEG, GIF or WebP image");
        if ((long) info.width() * info.height() > 120_000_000L) throw new ApiException(400, "Image has too many pixels");
        return info;
    }

    private static String mapName(String name) {
        name = name == null ? "" : name.trim();
        if (name.isEmpty() || name.length() > 100) throw new ApiException(400, "Map name must be 1–100 characters");
        return name;
    }

    // ── Helpers ──────────────────────────────────────────────────────────
    private static long requireUser(Http.Request req) {
        Long uid = req.session().userId();
        if (uid == null) throw new ApiException(401, "Log in to save");
        return uid;
    }

    private static Http.Response ok() { return Http.Response.json(Map.of("ok", true)); }

    private static Map<String, Object> body(Http.Request req) {
        return Json.parseObject(new String(req.body(), StandardCharsets.UTF_8));
    }

    private static String str(Map<String, Object> b, String key) {
        Object v = b.get(key);
        if (!(v instanceof String s)) throw new ApiException(400, "Missing field: " + key);
        return s;
    }

    private static Integer intOrNull(Map<String, Object> b, String key) {
        return b.get(key) instanceof Number n ? n.intValue() : null;
    }

    private static int intQ(Http.Request req, String name) {
        String v = req.query(name);
        if (v == null) throw new ApiException(400, "Missing parameter: " + name);
        try { return Integer.parseInt(v.trim()); }
        catch (NumberFormatException e) { throw new ApiException(400, "Not a number: " + name); }
    }

    private static long parseId(String s) {
        try { return Long.parseLong(s); }
        catch (NumberFormatException e) { throw new ApiException(404, "Not found"); }
    }

    private static String lang(Http.Request req) {
        return "EN".equalsIgnoreCase(req.query("lang")) ? "EN" : "SV";
    }

    /** {"aspect": "Pyrotropi", "points": [{"x": 0.1, "y": 0.4}, ...]} → Zone (1–300 points). */
    static Store.Zone parseZone(Object o) {
        if (!(o instanceof Map<?, ?> z)) throw new ApiException(400, "Bad area");
        String aspect = String.valueOf(z.get("aspect"));
        if (!FieldService.ASPECT_ORDER.contains(aspect)) throw new ApiException(400, "Unknown aspect: " + aspect);
        if (!(z.get("points") instanceof List<?> pts) || pts.isEmpty()) throw new ApiException(400, "An area needs points");
        if (pts.size() > 300) throw new ApiException(400, "Too many points in an area");
        List<double[]> out = new ArrayList<>();
        for (Object p : pts) {
            if (!(p instanceof Map<?, ?> pm)) throw new ApiException(400, "Bad area point");
            double x = ((Number) pm.get("x")).doubleValue(), y = ((Number) pm.get("y")).doubleValue();
            if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) throw new ApiException(400, "Area point outside the map");
            out.add(new double[]{x, y});
        }
        return new Store.Zone(aspect, out);
    }

    /** {"aspect": "Pyrotropi", "a": {"x": 0.1, "y": 0.4}, "b": {"x": 0.2, "y": 0.45}} → Leyline. */
    static Store.Leyline parseLeyline(Object o) {
        if (!(o instanceof Map<?, ?> l)) throw new ApiException(400, "Bad leyline");
        String aspect = String.valueOf(l.get("aspect"));
        if (!FieldService.ASPECT_ORDER.contains(aspect)) throw new ApiException(400, "Unknown aspect: " + aspect);
        if (!(l.get("a") instanceof Map<?, ?> a) || !(l.get("b") instanceof Map<?, ?> b)) throw new ApiException(400, "Bad leyline");
        double ax = ((Number) a.get("x")).doubleValue(), ay = ((Number) a.get("y")).doubleValue();
        double bx = ((Number) b.get("x")).doubleValue(), by = ((Number) b.get("y")).doubleValue();
        for (double v : new double[]{ax, ay, bx, by})
            if (!(v >= 0 && v <= 1)) throw new ApiException(400, "Leyline point outside the map");
        return new Store.Leyline(aspect, ax, ay, bx, by);
    }
}
