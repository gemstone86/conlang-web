package com.eonweather.core;

import java.util.*;

/**
 * Tiny dependency-free JSON reader/writer. Objects become LinkedHashMap,
 * arrays become ArrayList, numbers become Long or Double.
 */
public final class Json {
    private Json() {}

    // ── Writing ──────────────────────────────────────────────────────────
    public static String write(Object o) {
        StringBuilder sb = new StringBuilder();
        write(sb, o);
        return sb.toString();
    }

    private static void write(StringBuilder sb, Object o) {
        if (o == null) sb.append("null");
        else if (o instanceof String s) str(sb, s);
        else if (o instanceof Double d) num(sb, d);
        else if (o instanceof Float f) num(sb, f.doubleValue());
        else if (o instanceof Number || o instanceof Boolean) sb.append(o);
        else if (o instanceof Map<?, ?> m) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : m.entrySet()) {
                if (!first) sb.append(',');
                first = false;
                str(sb, String.valueOf(e.getKey()));
                sb.append(':');
                write(sb, e.getValue());
            }
            sb.append('}');
        } else if (o instanceof Collection<?> c) {
            sb.append('[');
            boolean first = true;
            for (Object x : c) {
                if (!first) sb.append(',');
                first = false;
                write(sb, x);
            }
            sb.append(']');
        } else if (o instanceof double[] a) {
            sb.append('[');
            for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(','); num(sb, a[i]); }
            sb.append(']');
        } else if (o instanceof int[] a) {
            sb.append('[');
            for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(','); sb.append(a[i]); }
            sb.append(']');
        } else if (o instanceof Object[] a) {
            write(sb, Arrays.asList(a));
        } else str(sb, o.toString());
    }

    private static void num(StringBuilder sb, double d) {
        if (Double.isNaN(d) || Double.isInfinite(d)) { sb.append("null"); return; }
        if (d == Math.rint(d) && Math.abs(d) < 1e15) sb.append((long) d);
        // positions on a map are fractions (0–1) of its width and height: 3 decimals would snap them to a
        // grid of 1/1000 of the map (about 30 × 15 km on Mundana), so numbers below 1 keep 7 decimals
        else if (Math.abs(d) < 1) sb.append(Math.round(d * 1e7) / 1e7);
        else sb.append(Math.round(d * 1000.0) / 1000.0);
    }

    private static void str(StringBuilder sb, String s) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                case '<' -> sb.append("\\u003c"); // safe to embed anywhere
                default -> {
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
                }
            }
        }
        sb.append('"');
    }

    // ── Reading ──────────────────────────────────────────────────────────
    public static Object parse(String s) {
        Parser p = new Parser(s);
        p.ws();
        Object v = p.value();
        p.ws();
        if (p.i != s.length()) throw new IllegalArgumentException("Trailing characters in JSON");
        return v;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObject(String s) {
        if (s == null || s.isBlank()) return new LinkedHashMap<>();
        Object o = parse(s);
        if (!(o instanceof Map)) throw new IllegalArgumentException("Expected a JSON object");
        return (Map<String, Object>) o;
    }

    private static final class Parser {
        final String s; int i = 0; int depth = 0;
        Parser(String s) { this.s = s; }

        void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }

        Object value() {
            if (i >= s.length()) throw err();
            char c = s.charAt(i);
            if (c == '{') return obj();
            if (c == '[') return arr();
            if (c == '"') return string();
            if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
            if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
            if (s.startsWith("null", i)) { i += 4; return null; }
            return number();
        }

        Map<String, Object> obj() {
            if (++depth > 64) throw err();
            Map<String, Object> m = new LinkedHashMap<>();
            i++; ws();
            if (peek() == '}') { i++; depth--; return m; }
            while (true) {
                ws();
                if (peek() != '"') throw err();
                String k = string();
                ws();
                if (peek() != ':') throw err();
                i++; ws();
                m.put(k, value());
                ws();
                char c = peek();
                i++;
                if (c == '}') break;
                if (c != ',') throw err();
            }
            depth--;
            return m;
        }

        List<Object> arr() {
            if (++depth > 64) throw err();
            List<Object> l = new ArrayList<>();
            i++; ws();
            if (peek() == ']') { i++; depth--; return l; }
            while (true) {
                ws();
                l.add(value());
                ws();
                char c = peek();
                i++;
                if (c == ']') break;
                if (c != ',') throw err();
            }
            depth--;
            return l;
        }

        String string() {
            StringBuilder sb = new StringBuilder();
            i++;
            while (true) {
                if (i >= s.length()) throw err();
                char c = s.charAt(i++);
                if (c == '"') break;
                if (c == '\\') {
                    char e = s.charAt(i++);
                    switch (e) {
                        case 'n' -> sb.append('\n');
                        case 't' -> sb.append('\t');
                        case 'r' -> sb.append('\r');
                        case 'b' -> sb.append('\b');
                        case 'f' -> sb.append('\f');
                        case 'u' -> { sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; }
                        default -> sb.append(e);
                    }
                } else sb.append(c);
            }
            return sb.toString();
        }

        Object number() {
            int start = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
            String n = s.substring(start, i);
            if (n.isEmpty()) throw err();
            if (n.contains(".") || n.contains("e") || n.contains("E")) return Double.parseDouble(n);
            return Long.parseLong(n);
        }

        char peek() { if (i >= s.length()) throw err(); return s.charAt(i); }
        IllegalArgumentException err() { return new IllegalArgumentException("Invalid JSON at position " + i); }
    }
}
