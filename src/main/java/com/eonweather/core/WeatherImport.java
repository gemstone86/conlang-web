package com.eonweather.core;

import javax.sql.DataSource;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.sql.*;
import java.util.*;

/**
 * Moves the separate weather generator's database into the combined app's, once.
 *
 * The old app kept its own H2 file (e.g. /home/data/eonweather.mv.db) with its own accounts. This reads a
 * copy of that file (the original is never opened or changed) and puts everything into this database:
 *
 *  - accounts, matched by username (any letter case): one that exists here is used as it is; the others are
 *    created with their old password (stored in the old format, "pbkdf2$…", which the login accepts and
 *    upgrades on the first login). The built-in owner of the standard map ('@eon') is matched to this one's.
 *  - every weather table: maps with everything on them (heights, rivers, ranges, roads, forest, ice, nations,
 *    leylines, areas, region positions), suggestions and votes, journeys, campaigns, notes, page state,
 *    symbols, regions changed in the app, and the travel and event rules. Rows keep their ids; the account
 *    columns (owner_id, author_id, reviewer_id, updated_by, user_id) are changed to the accounts here.
 *    Tables and columns the old file doesn't have (an older version) are left as they are.
 *
 * It replaces the weather data here, so it only runs when there is none of the users' own yet (only the
 * standard map, which the old file has too, and which is brought up to date by {@link DefaultMap} right
 * after), unless forced. Once it has run, a note in app_settings ('weatherImport') stops it running again.
 * Everything happens in one transaction: if anything fails, nothing is changed.
 */
public final class WeatherImport {
    private WeatherImport() {}

    /** The weather tables, parents before the tables that refer to them. */
    static final List<String> TABLES = List.of(
            "user_state", "campaigns", "notes", "custom_regions", "symbols", "app_settings",
            "maps", "map_anchors", "map_leylines", "map_zones", "map_heights", "map_rivers", "map_nations",
            "map_ranges", "map_forests", "map_ice", "map_marsh", "map_roads", "map_cities", "map_trips",
            "height_suggestions", "height_votes", "layer_suggestions", "layer_votes");
    /** Columns that hold an account id. */
    static final Set<String> USER_COLUMNS = Set.of("OWNER_ID", "AUTHOR_ID", "REVIEWER_ID", "UPDATED_BY", "USER_ID");
    /** Tables whose rows are the users' own (so that there is something here an import would replace). */
    private static final List<String> OWN_DATA = List.of("campaigns", "notes", "custom_regions", "map_trips",
            "height_suggestions", "layer_suggestions");
    static final String MARKER = "weatherImport";

    /** What an import did (or why it didn't). */
    public record Result(boolean imported, String message, Map<String, Integer> rows, int accountsCreated, int accountsMatched) {}

    /**
     * Imports oldDb (the path of the old H2 file, with or without ".mv.db") into target, if it hasn't been
     * done and there is no weather data of the users' own here (or force). admins: the weather admins'
     * usernames; when this database has no accounts yet, the imported ones with those names (or else the
     * oldest one) are made site admins, as the first account would be.
     */
    public static Result run(DataSource target, Path oldDb, boolean force, Collection<String> admins) throws IOException, SQLException {
        Path file = oldDb.toString().endsWith(".mv.db") ? oldDb : Path.of(oldDb + ".mv.db");
        if (!Files.isRegularFile(file)) return new Result(false, "no old weather database at " + file, Map.of(), 0, 0);
        try (Connection c = target.getConnection()) {
            if (one(c, "SELECT COUNT(*) FROM app_settings WHERE name = ?", MARKER) > 0)
                return new Result(false, "already imported (app_settings '" + MARKER + "')", Map.of(), 0, 0);
            if (!force) {
                long own = 0;
                for (String t : OWN_DATA) own += one(c, "SELECT COUNT(*) FROM " + t);
                own += one(c, "SELECT COUNT(*) FROM maps m JOIN users u ON u.id = m.owner_id WHERE u.username <> ?", Store.SYSTEM_USER);
                if (own > 0) return new Result(false, "this database already has weather data of its own (" + own
                        + " rows): not replaced (set EON_IMPORT=force to replace it)", Map.of(), 0, 0);
            }
        }
        // a copy, so the original is never touched (and an old app still holding it doesn't matter)
        Path dir = Files.createTempDirectory("eon-import");
        Path copy = dir.resolve("old.mv.db");
        Files.copy(file, copy, StandardCopyOption.REPLACE_EXISTING);
        String url = "jdbc:h2:file:" + dir.resolve("old").toAbsolutePath() + ";MODE=PostgreSQL;ACCESS_MODE_DATA=r;IFEXISTS=TRUE";
        try (Connection old = DriverManager.getConnection(url, "sa", "");
             Connection c = target.getConnection()) {
            boolean auto = c.getAutoCommit();
            c.setAutoCommit(false);
            try {
                Result r = copy(old, c, force, admins, file);
                c.commit();
                return r;
            } catch (SQLException | RuntimeException e) {
                c.rollback();
                throw e;
            } finally {
                c.setAutoCommit(auto);
            }
        } finally {
            try (var s = Files.list(dir)) { s.forEach(p -> p.toFile().delete()); }
            dir.toFile().delete();
        }
    }

    private static Result copy(Connection old, Connection c, boolean force, Collection<String> admins, Path from) throws SQLException {
        Set<String> oldTables = tables(old);
        if (!oldTables.contains("USERS") || !oldTables.contains("MAPS"))
            throw new SQLException("That file isn't a weather generator database (no users or maps table)");
        boolean noAccounts = one(c, "SELECT COUNT(*) FROM users WHERE salt <> '!'") == 0;

        // accounts: old id → id here
        Map<Long, Long> ids = new HashMap<>();
        int created = 0, matched = 0;
        List<long[]> newOnes = new ArrayList<>();                         // { old id, new id }
        Set<String> oldUserCols = columns(old, "USERS");
        String created_ = oldUserCols.contains("CREATED_AT") ? ", created_at" : "";
        try (Statement st = old.createStatement();
             ResultSet rs = st.executeQuery("SELECT id, username, password_hash" + created_ + " FROM users ORDER BY id")) {
            while (rs.next()) {
                long oid = rs.getLong(1);
                String name = rs.getString(2), hash = rs.getString(3);
                Timestamp when = created_.isEmpty() ? null : rs.getTimestamp(4);
                Long here = idOf(c, name);
                if (here != null) { ids.put(oid, here); if (!Store.SYSTEM_USER.equals(name)) matched++; continue; }
                boolean system = Store.SYSTEM_USER.equals(name);
                long nid = insert(c, "INSERT INTO users (username, pw_hash, salt, is_admin" + (when != null ? ", created" : "") + ") VALUES (?, ?, ?, ?"
                        + (when != null ? ", ?" : "") + ")", when != null
                        ? new Object[] { name, system ? "!" : hash, system ? "!" : "pbkdf2", false, when }
                        : new Object[] { name, system ? "!" : hash, system ? "!" : "pbkdf2", false });
                ids.put(oid, nid);
                if (!system) { created++; newOnes.add(new long[] { oid, nid }); }
            }
        }
        // no accounts here before: the weather admins among the imported ones (or else the oldest) become site
        // admins, as the first account registered would have
        if (noAccounts && !newOnes.isEmpty()) {
            int made = 0;
            for (long[] n : newOnes) {
                String name = String.valueOf(oneObj(c, "SELECT username FROM users WHERE id = ?", n[1]));
                if (admins.stream().anyMatch(a -> a.equalsIgnoreCase(name))) { update(c, "UPDATE users SET is_admin = TRUE WHERE id = ?", n[1]); made++; }
            }
            if (made == 0) update(c, "UPDATE users SET is_admin = TRUE WHERE id = ?", newOnes.get(0)[1]);
        }

        // the weather data here goes (children first), then the old file's comes in (parents first)
        List<String> rev = new ArrayList<>(TABLES);
        Collections.reverse(rev);
        for (String t : rev) update(c, "DELETE FROM " + t);
        Map<String, Integer> rows = new LinkedHashMap<>();
        for (String t : TABLES) {
            String T = t.toUpperCase(Locale.ROOT);
            if (!oldTables.contains(T)) continue;
            Set<String> mine = columns(c, T);
            List<String> cols = new ArrayList<>();
            for (String col : orderedColumns(old, T)) if (mine.contains(col)) cols.add(col);
            if (cols.isEmpty()) continue;
            String list = String.join(", ", cols), marks = String.join(", ", Collections.nCopies(cols.size(), "?"));
            int n = 0;
            try (Statement st = old.createStatement();
                 ResultSet rs = st.executeQuery("SELECT " + list + " FROM " + t);
                 PreparedStatement ins = c.prepareStatement("INSERT INTO " + t + " (" + list + ") VALUES (" + marks + ")")) {
                ResultSetMetaData md = rs.getMetaData();
                while (rs.next()) {
                    boolean skip = false;
                    for (int i = 1; i <= cols.size(); i++) {
                        String col = cols.get(i - 1);
                        int type = md.getColumnType(i);
                        if (USER_COLUMNS.contains(col)) {
                            long v = rs.getLong(i);
                            if (rs.wasNull()) { ins.setNull(i, Types.BIGINT); continue; }
                            Long to = ids.get(v);
                            if (to == null) {
                                // an account the old file no longer has: kept rows need one, the others lose the link
                                if (notNull(c, T, col)) { skip = true; break; }
                                ins.setNull(i, Types.BIGINT);
                            } else ins.setLong(i, to);
                        } else if (type == Types.BLOB || type == Types.BINARY || type == Types.VARBINARY || type == Types.LONGVARBINARY) {
                            byte[] b = rs.getBytes(i);
                            if (b == null) ins.setNull(i, Types.VARBINARY); else ins.setBytes(i, b);
                        } else if (type == Types.CLOB) {
                            String s = rs.getString(i);
                            if (s == null) ins.setNull(i, Types.VARCHAR); else ins.setString(i, s);
                        } else {
                            Object o = rs.getObject(i);
                            if (o == null) ins.setNull(i, type); else ins.setObject(i, o);
                        }
                    }
                    if (skip) continue;
                    ins.executeUpdate();
                    n++;
                }
            }
            rows.put(t, n);
            restartIdentity(c, T);
        }
        Map<String, Object> note = new LinkedHashMap<>();
        note.put("from", from.toString());
        note.put("at", java.time.Instant.now().toString());
        note.put("rows", rows);
        note.put("accountsCreated", created);
        note.put("accountsMatched", matched);
        update(c, "INSERT INTO app_settings (name, setting_json) VALUES (?, ?)", MARKER, Json.write(note));
        return new Result(true, "imported from " + from, rows, created, matched);
    }

    /** The account here with this username (any letter case), or null. */
    private static Long idOf(Connection c, String name) throws SQLException {
        Object o = oneObj(c, "SELECT id FROM users WHERE LOWER(username) = LOWER(?)", name);
        return o == null ? null : ((Number) o).longValue();
    }

    /** After rows came in with their own ids: the table's next id is above them. */
    private static void restartIdentity(Connection c, String table) throws SQLException {
        if (!columns(c, table).contains("ID")) return;
        long max = one(c, "SELECT COALESCE(MAX(id), 0) FROM " + table);
        String db = c.getMetaData().getDatabaseProductName().toLowerCase(Locale.ROOT);
        if (db.contains("postgres")) {
            try (PreparedStatement ps = c.prepareStatement("SELECT setval(pg_get_serial_sequence(?, 'id'), ?, ?)")) {
                ps.setString(1, table.toLowerCase(Locale.ROOT)); ps.setLong(2, Math.max(1, max)); ps.setBoolean(3, max > 0);
                ps.execute();
            }
        } else {
            try (Statement st = c.createStatement()) { st.execute("ALTER TABLE " + table + " ALTER COLUMN id RESTART WITH " + (max + 1)); }
        }
    }

    private static boolean notNull(Connection c, String table, String col) throws SQLException {
        for (String[] tc : new String[][] { { table, col }, { table.toLowerCase(Locale.ROOT), col.toLowerCase(Locale.ROOT) } }) {
            try (ResultSet rs = c.getMetaData().getColumns(null, null, tc[0], tc[1])) {
                while (rs.next())
                    if (rs.getString("TABLE_NAME").equalsIgnoreCase(table) && rs.getString("COLUMN_NAME").equalsIgnoreCase(col))
                        return rs.getInt("NULLABLE") == DatabaseMetaData.columnNoNulls;
            }
        }
        return false;
    }

    private static Set<String> tables(Connection c) throws SQLException {
        Set<String> out = new HashSet<>();
        try (ResultSet rs = c.getMetaData().getTables(null, null, "%", new String[] { "TABLE", "BASE TABLE" })) {
            while (rs.next()) {
                String schema = rs.getString("TABLE_SCHEM");
                if (schema == null || schema.equalsIgnoreCase("PUBLIC")) out.add(rs.getString("TABLE_NAME").toUpperCase(Locale.ROOT));
            }
        }
        return out;
    }

    private static Set<String> columns(Connection c, String table) throws SQLException {
        return new HashSet<>(orderedColumns(c, table));
    }

    private static List<String> orderedColumns(Connection c, String table) throws SQLException {
        List<String> out = new ArrayList<>();
        for (String t : new String[] { table, table.toLowerCase(Locale.ROOT) }) {
            try (ResultSet rs = c.getMetaData().getColumns(null, null, t, "%")) {
                while (rs.next()) {
                    // ("_" in a table name is a wildcard to the lookup: only this very table counts)
                    String schema = rs.getString("TABLE_SCHEM");
                    if ((schema == null || schema.equalsIgnoreCase("PUBLIC")) && rs.getString("TABLE_NAME").equalsIgnoreCase(table))
                        out.add(rs.getString("COLUMN_NAME").toUpperCase(Locale.ROOT));
                }
            }
            if (!out.isEmpty()) break;
        }
        return out;
    }

    private static long one(Connection c, String sql, Object... args) throws SQLException {
        Object o = oneObj(c, sql, args);
        return o == null ? 0 : ((Number) o).longValue();
    }

    private static Object oneObj(Connection c, String sql, Object... args) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) ps.setObject(i + 1, args[i]);
            try (ResultSet rs = ps.executeQuery()) { return rs.next() ? rs.getObject(1) : null; }
        }
    }

    private static int update(Connection c, String sql, Object... args) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) ps.setObject(i + 1, args[i]);
            return ps.executeUpdate();
        }
    }

    private static long insert(Connection c, String sql, Object... args) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            for (int i = 0; i < args.length; i++) ps.setObject(i + 1, args[i]);
            ps.executeUpdate();
            try (ResultSet rs = ps.getGeneratedKeys()) {
                if (!rs.next()) throw new SQLException("No id returned");
                return rs.getLong(1);
            }
        }
    }
}
