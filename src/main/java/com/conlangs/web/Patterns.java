package com.conlangs.web;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/** Shared helpers for turning user-written sound-change patterns into Java regexes. */
public final class Patterns {
    private Patterns() {}

    /** Parses lines like {@code V=aeiouy} into an ordered map (name to members). Lines starting with // are comments. */
    public static Map<String, String> parseClasses(String text) {
        Map<String, String> out = new LinkedHashMap<>();
        if (text == null) return out;
        for (String line : text.split("\\R")) {
            String t = line.trim();
            if (t.isEmpty() || t.startsWith("//")) continue;
            int eq = t.indexOf('=');
            if (eq < 1) continue;
            out.put(t.substring(0, eq).trim(), t.substring(eq + 1).trim());
        }
        return out;
    }

    private static String escapeInClass(String members) {
        StringBuilder sb = new StringBuilder();
        for (char c : members.toCharArray()) {
            if (c == '\\' || c == ']' || c == '[' || c == '^' || c == '-' || c == '&') sb.append('\\');
            sb.append(c);
        }
        return sb.toString();
    }

    /** Expands {X} class references and # word boundaries. */
    public static String expand(String pattern, Map<String, String> classes) {
        String p = pattern;
        for (Map.Entry<String, String> e : classes.entrySet()) {
            p = p.replace("{" + e.getKey() + "}", "[" + escapeInClass(e.getValue()) + "]");
        }
        if (p.startsWith("#")) p = "^" + p.substring(1);
        if (p.endsWith("#") && !p.endsWith("\\#")) p = p.substring(0, p.length() - 1) + "$";
        return p;
    }

    /** Compiles an expanded pattern; throws IllegalArgumentException with a readable message on failure. */
    public static Pattern compile(String pattern, Map<String, String> classes) {
        try {
            return Pattern.compile(expand(pattern, classes));
        } catch (PatternSyntaxException e) {
            throw new IllegalArgumentException("Bad pattern '" + pattern + "': " + e.getDescription());
        }
    }

    public static String apply(Pattern p, String replacement, String form) {
        Matcher m = p.matcher(form);
        try {
            return m.replaceAll(replacement == null ? "" : replacement);
        } catch (IndexOutOfBoundsException | IllegalArgumentException e) {
            throw new IllegalArgumentException("Bad replacement '" + replacement + "': " + e.getMessage());
        }
    }

    /** Letter length ignoring apostrophes and hyphens. */
    public static int length(String form) {
        int n = 0;
        for (int i = 0; i < form.length(); i++) {
            char c = form.charAt(i);
            if (c != '\'' && c != '-' && c != ' ') n++;
        }
        return n;
    }
}
