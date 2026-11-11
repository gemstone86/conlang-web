package com.conlangs.web;

import tools.jackson.databind.ObjectMapper;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Everything in Root and Rune as one JSON file: accounts (with their password hashes, so passwords keep
 * working), worlds, languages, words, word forms, overrides, meanings, sound-change rules, form rules,
 * grammar, sounds, sentences, missing words, sharing, pending changes and the undo history. Not included: the admin log
 * and password reset codes.
 *
 * <pre>
 * { "format": "root-and-rune-export", "formatVersion": 1, "appVersion": "...", "exported": "...",
 *   "tables": { "users": { "columns": ["id", "username", ...], "rows": [[1, "Gemstone", ...], ...] }, ... } }
 * </pre>
 * Every row keeps its id, so references between rows (parent languages, linked words, shares, undo
 * history) stay valid. Timestamps are written as "yyyy-mm-dd hh:mm:ss[.f...]".
 */
@Service
public class FullExport {
    public static final String FORMAT = "root-and-rune-export";
    public static final int FORMAT_VERSION = 1;

    /** Root and Rune's tables, parents before children: the order an import must insert them in. */
    public static final List<String> TABLES = List.of(
            "users", "worlds", "languages", "shares", "words", "word_overrides", "rules", "changes", "edit_log",
            "word_forms", "grammar_sections", "grammar_entries", "phonemes", "form_rules", "word_meanings", "word_losses", "sentences", "missing_words", "rule_versions", "texts", "form_groups");

    private final DataSource ds;
    private final ObjectMapper json;
    private final String appVersion;

    public FullExport(DataSource ds, ObjectMapper json, @Value("${app.version:dev}") String appVersion) {
        this.ds = ds;
        this.json = json;
        this.appVersion = appVersion;
    }

    public byte[] export() throws Exception {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("format", FORMAT);
        out.put("formatVersion", FORMAT_VERSION);
        out.put("appVersion", appVersion);
        out.put("exported", Instant.now().toString());
        Map<String, Object> tables = new LinkedHashMap<>();
        try (Connection c = ds.getConnection()) {
            for (String t : TABLES) {
                if (!exists(c, t)) continue;
                // salt '!' marks a built-in account nobody can log in as (the weather generator's '@eon')
                String sql = "select * from " + t + ("users".equals(t) ? " where salt <> '!'" : "") + " order by id";
                try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
                    ResultSetMetaData md = rs.getMetaData();
                    List<String> cols = new ArrayList<>();
                    for (int i = 1; i <= md.getColumnCount(); i++) cols.add(md.getColumnLabel(i).toLowerCase(Locale.ROOT));
                    List<List<Object>> rows = new ArrayList<>();
                    while (rs.next()) {
                        List<Object> row = new ArrayList<>(cols.size());
                        for (int i = 1; i <= cols.size(); i++) row.add(value(rs, i));
                        rows.add(row);
                    }
                    Map<String, Object> tbl = new LinkedHashMap<>();
                    tbl.put("columns", cols);
                    tbl.put("rows", rows);
                    tables.put(t, tbl);
                }
            }
        }
        out.put("tables", tables);
        return json.writeValueAsBytes(out);
    }

    /** Counts per table in an export, for the log. */
    public static String summary(Map<String, ?> counts) {
        StringBuilder sb = new StringBuilder();
        counts.forEach((k, v) -> sb.append(sb.length() == 0 ? "" : ", ").append(k).append(' ').append(v));
        return sb.toString();
    }

    static boolean exists(Connection c, String table) {
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery("select * from " + table + " where 1=0")) {
            return true;
        } catch (SQLException e) {
            return false;
        }
    }

    private static Object value(ResultSet rs, int i) throws SQLException {
        Object v = rs.getObject(i);
        if (v == null) return null;
        if (v instanceof Timestamp ts) return ts.toString();
        if (v instanceof LocalDateTime ldt) return Timestamp.valueOf(ldt).toString();
        if (v instanceof java.sql.Date d) return d.toString();
        if (v instanceof java.sql.Clob clob) return clob.getSubString(1, (int) clob.length());
        return v; // String, Boolean, Integer, Long, Double, BigDecimal
    }
}
