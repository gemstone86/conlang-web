package com.conlangs.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.sql.Timestamp;
import java.sql.Types;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import javax.sql.DataSource;
import org.springframework.stereotype.Service;

/**
 * Reads a {@link FullExport} file (e.g. from the separate Root and Rune app) into this app.
 *
 * <ul>
 *   <li>Accounts are matched by username (any letter case). An account that exists here already is used as
 *       it is (its password here stays); a new one is created with its old password hash, so the old
 *       password works.</li>
 *   <li>Everything else keeps its id, so all references between rows stay valid. Only the columns that
 *       point to accounts are translated to the accounts here.</li>
 *   <li>Root and Rune's data here is replaced: if it has worlds, the import is refused unless
 *       {@code replace} is set. Accounts are never deleted (the weather generator uses them too).</li>
 *   <li>All in one transaction: if anything fails, nothing is changed.</li>
 * </ul>
 */
@Service
public class FullImport {
    /** Columns that hold an account id, per table. */
    static final Map<String, List<String>> USER_COLS = Map.of(
            "worlds", List.of("owner_id"),
            "languages", List.of("owner_id"),
            "shares", List.of("user_id"),
            "changes", List.of("author_id", "decided_by"),
            "edit_log", List.of("user_id"),
            "missing_words", List.of("created_by"),
            "rule_versions", List.of("created_by"));

    private final DataSource ds;
    private final ObjectMapper json;

    public FullImport(DataSource ds, ObjectMapper json) {
        this.ds = ds;
        this.json = json;
    }

    public Map<String, Object> importAll(InputStream in, boolean replace) throws Exception {
        JsonNode root = json.readTree(in);
        if (root == null || !FullExport.FORMAT.equals(root.path("format").asText()))
            throw new ApiException(400, "That isn't a Root and Rune export file (use Export everything in Root and Rune).");
        if (root.path("formatVersion").asInt() > FullExport.FORMAT_VERSION)
            throw new ApiException(400, "That export is from a newer version of Root and Rune than this app understands.");
        JsonNode tables = root.path("tables");

        Map<String, Object> result = new LinkedHashMap<>();
        Map<String, Integer> counts = new LinkedHashMap<>();
        List<String> warnings = new ArrayList<>();
        List<String> usersMatched = new ArrayList<>(), usersCreated = new ArrayList<>();
        List<String> imported = new ArrayList<>();

        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            try {
                long worlds = count(c, "select count(*) from worlds");
                if (worlds > 0 && !replace)
                    throw new ApiException(409, "Root and Rune here already has " + worlds + " world" + (worlds == 1 ? "" : "s")
                            + ". Importing replaces all of it; confirm to go ahead.");
                // also clears rows left behind without a world, so the imported ids are free
                wipe(c);

                // accounts: match by username, or create with the old password hash
                Map<Long, Long> userMap = new HashMap<>();
                JsonNode users = tables.path("users");
                List<String> ucols = columns(users);
                for (JsonNode row : users.path("rows")) {
                    Map<String, JsonNode> u = asMap(ucols, row);
                    String name = u.get("username").asText();
                    if ("!".equals(text(u.get("salt")))) continue;
                    long oldId = u.get("id").asLong();
                    Long here = null;
                    try (PreparedStatement ps = c.prepareStatement("select id from users where lower(username)=lower(?)")) {
                        ps.setString(1, name);
                        try (ResultSet rs = ps.executeQuery()) { if (rs.next()) here = rs.getLong(1); }
                    }
                    if (here != null) {
                        usersMatched.add(name);
                    } else {
                        try (PreparedStatement ps = c.prepareStatement(
                                "insert into users(username, pw_hash, salt, is_admin, created) values (?,?,?,?,?)", Statement.RETURN_GENERATED_KEYS)) {
                            ps.setString(1, name);
                            ps.setString(2, text(u.get("pw_hash")));
                            ps.setString(3, text(u.get("salt")));
                            ps.setBoolean(4, u.get("is_admin") != null && u.get("is_admin").asBoolean());
                            String created = text(u.get("created"));
                            ps.setTimestamp(5, created == null ? new Timestamp(System.currentTimeMillis()) : timestamp(created));
                            ps.executeUpdate();
                            try (ResultSet rs = ps.getGeneratedKeys()) { rs.next(); here = rs.getLong(1); }
                        }
                        usersCreated.add(name);
                    }
                    userMap.put(oldId, here);
                }

                // the rest, parents before children, with their ids
                Map<Long, Long> parents = new LinkedHashMap<>();
                for (String t : FullExport.TABLES) {
                    if (t.equals("users")) continue;
                    JsonNode tbl = tables.get(t);
                    if (tbl == null) continue;
                    if (!FullExport.exists(c, t)) { warnings.add("Table " + t + " doesn't exist in this version: skipped."); continue; }
                    Map<String, Integer> types = targetTypes(c, t);
                    List<String> cols = columns(tbl);
                    List<Integer> keep = new ArrayList<>();
                    List<String> dropped = new ArrayList<>();
                    for (int i = 0; i < cols.size(); i++) {
                        if (types.containsKey(cols.get(i))) keep.add(i); else dropped.add(cols.get(i));
                    }
                    if (!dropped.isEmpty()) warnings.add("Not in this version, left out: " + t + "." + String.join(", " + t + ".", dropped));
                    List<String> userCols = USER_COLS.getOrDefault(t, List.of());
                    StringBuilder sql = new StringBuilder("insert into ").append(t).append('(');
                    for (int k = 0; k < keep.size(); k++) sql.append(k == 0 ? "" : ", ").append(cols.get(keep.get(k)));
                    sql.append(") values (").append("?, ".repeat(keep.size() - 1)).append("?)");
                    int n = 0;
                    try (PreparedStatement ps = c.prepareStatement(sql.toString())) {
                        for (JsonNode row : tbl.path("rows")) {
                            for (int k = 0; k < keep.size(); k++) {
                                int i = keep.get(k);
                                String col = cols.get(i);
                                Object v = value(row.get(i), types.get(col));
                                if (v != null && userCols.contains(col)) {
                                    Long mapped = userMap.get(((Number) v).longValue());
                                    if (mapped == null) throw new ApiException(400, "In " + t + ", " + col + " refers to account #" + v + ", which isn't in the file.");
                                    v = mapped;
                                }
                                // parent languages are set afterwards, when every language exists
                                if (t.equals("languages") && col.equals("parent_id") && v != null) {
                                    parents.put(row.get(cols.indexOf("id")).asLong(), ((Number) v).longValue());
                                    v = null;
                                }
                                ps.setObject(k + 1, v);
                            }
                            ps.addBatch();
                            if (++n % 500 == 0) ps.executeBatch();
                        }
                        ps.executeBatch();
                    }
                    if (t.equals("languages")) {
                        try (PreparedStatement ps = c.prepareStatement("update languages set parent_id=? where id=?")) {
                            for (Map.Entry<Long, Long> e : parents.entrySet()) {
                                ps.setLong(1, e.getValue());
                                ps.setLong(2, e.getKey());
                                ps.addBatch();
                            }
                            ps.executeBatch();
                        }
                    }
                    counts.put(t, n);
                    imported.add(t);
                }
                c.commit();
            } catch (Exception e) {
                c.rollback();
                throw e;
            }

            // New rows must get ids after the imported ones. (Outside the transaction: a schema change commits.)
            c.setAutoCommit(true);
            for (String t : imported) {
                long next = count(c, "select coalesce(max(id), 0) + 1 from " + t);
                try (Statement st = c.createStatement()) {
                    st.execute("alter table " + t + " alter column id restart with " + next);
                }
            }
        }

        result.put("from", root.path("appVersion").asText(""));
        result.put("exported", root.path("exported").asText(""));
        result.put("counts", counts);
        result.put("usersCreated", usersCreated);
        result.put("usersMatched", usersMatched);
        result.put("warnings", warnings);
        return result;
    }

    /** Deletes all of Root and Rune's data here (not the accounts), children first. */
    private static void wipe(Connection c) throws Exception {
        try (Statement st = c.createStatement()) {
            st.executeUpdate("update languages set parent_id = null");
            List<String> rev = new ArrayList<>(FullExport.TABLES);
            java.util.Collections.reverse(rev);
            for (String t : rev) if (!t.equals("users") && FullExport.exists(c, t)) st.executeUpdate("delete from " + t);
        }
    }

    private static long count(Connection c, String sql) throws Exception {
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            rs.next();
            return rs.getLong(1);
        }
    }

    private static Map<String, Integer> targetTypes(Connection c, String t) throws Exception {
        Map<String, Integer> out = new LinkedHashMap<>();
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery("select * from " + t + " where 1=0")) {
            ResultSetMetaData md = rs.getMetaData();
            for (int i = 1; i <= md.getColumnCount(); i++) out.put(md.getColumnLabel(i).toLowerCase(Locale.ROOT), md.getColumnType(i));
        }
        return out;
    }

    private static List<String> columns(JsonNode tbl) {
        List<String> out = new ArrayList<>();
        for (JsonNode c : tbl.path("columns")) out.add(c.asText().toLowerCase(Locale.ROOT));
        Set<String> seen = new LinkedHashSet<>(out);
        if (seen.size() != out.size() || !seen.contains("id")) throw new ApiException(400, "The export file is damaged (bad column list).");
        return out;
    }

    private static Map<String, JsonNode> asMap(List<String> cols, JsonNode row) {
        Map<String, JsonNode> m = new HashMap<>();
        for (int i = 0; i < cols.size(); i++) m.put(cols.get(i), row.get(i));
        return m;
    }

    private static String text(JsonNode n) {
        return n == null || n.isNull() ? null : n.asText();
    }

    private static Timestamp timestamp(String s) {
        return Timestamp.valueOf(s.replace('T', ' ').replace("Z", ""));
    }

    private static Object value(JsonNode n, int sqlType) {
        if (n == null || n.isNull()) return null;
        if (sqlType == Types.TIMESTAMP || sqlType == Types.TIMESTAMP_WITH_TIMEZONE) return timestamp(n.asText());
        if (n.isBoolean()) return n.asBoolean();
        if (n.isIntegralNumber()) return n.asLong();
        if (n.isNumber()) return n.asDouble();
        return n.asText();
    }
}
