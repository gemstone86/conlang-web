package com.conlangs.web;

import java.sql.Clob;
import java.sql.PreparedStatement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Component;

/** Thin JDBC helper: rows come back as maps with lower-case keys and CLOBs converted to strings. */
@Component
public class Db {
    private final JdbcTemplate jdbc;

    public Db(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Map<String, Object>> rows(String sql, Object... args) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> raw : jdbc.queryForList(sql, args)) {
            Map<String, Object> m = new LinkedHashMap<>();
            for (Map.Entry<String, Object> e : raw.entrySet()) {
                Object v = e.getValue();
                if (v instanceof Clob c) {
                    try {
                        v = c.getSubString(1, (int) c.length());
                    } catch (Exception ex) {
                        v = null;
                    }
                }
                m.put(e.getKey().toLowerCase(), v);
            }
            out.add(m);
        }
        return out;
    }

    public Map<String, Object> one(String sql, Object... args) {
        List<Map<String, Object>> r = rows(sql, args);
        return r.isEmpty() ? null : r.get(0);
    }

    public int update(String sql, Object... args) {
        int n = jdbc.update(sql, args);
        changed(sql);
        return n;
    }

    /**
     * Goes up with every change to the data (not with the admin log or connector usage, which no page shows), so
     * results worked out from the data (like the dictionaries in DictService) can be kept until it moves.
     */
    private final AtomicLong version = new AtomicLong();

    public long version() {
        return version.get();
    }

    /** Something changed the data without going through this class (e.g. Import everything). */
    public void changed() {
        version.incrementAndGet();
    }

    private void changed(String sql) {
        String q = sql.toLowerCase(Locale.ROOT);
        if (q.contains("app_log") || q.contains("connector_keys") || q.contains("reset_codes")) return;
        version.incrementAndGet();
        // in a transaction, others only see the change once it's committed: move the version again then, so nothing
        // worked out in between (from the data as it was) is kept
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCompletion(int status) { version.incrementAndGet(); }
            });
        }
    }

    public long insert(String sql, Object... args) {
        KeyHolder kh = new GeneratedKeyHolder();
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement(sql, new String[] {"ID"});
            for (int i = 0; i < args.length; i++) ps.setObject(i + 1, args[i]);
            return ps;
        }, kh);
        changed(sql);
        Number k = kh.getKey();
        return k == null ? -1 : k.longValue();
    }

    public long count(String sql, Object... args) {
        Long n = jdbc.queryForObject(sql, Long.class, args);
        return n == null ? 0 : n;
    }

    public static long num(Object o) {
        return ((Number) o).longValue();
    }
}
