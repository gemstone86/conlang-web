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
        checkNotSlow(p);
        Matcher m = p.matcher(new Timed(form, p));
        try {
            return m.replaceAll(replacement == null ? "" : replacement);
        } catch (TooSlow e) {
            throw e;
        } catch (IndexOutOfBoundsException | IllegalArgumentException e) {
            throw new IllegalArgumentException("Bad replacement '" + replacement + "': " + e.getMessage());
        }
    }

    /** Does the pattern match somewhere in the text? (With the same time limit as apply.) */
    public static boolean found(Pattern p, String text) {
        checkNotSlow(p);
        return p.matcher(new Timed(text, p)).find();
    }

    // ---- a time limit, so a pattern that backtracks without end (like (.*a){12}b on a long word without b)
    // gives an error on the word instead of tying the server up

    static final long LIMIT_NANOS = 200_000_000L;   // per word; normal patterns take microseconds
    private static final long REMEMBER_MS = 60_000;
    /** Patterns that just ran out of time: they fail at once for a minute, so a whole dictionary doesn't wait for each word. */
    private static final Map<String, Long> SLOW = new java.util.concurrent.ConcurrentHashMap<>();

    /** Thrown when a pattern takes too long; an IllegalArgumentException, so it is reported like any other bad pattern. */
    public static final class TooSlow extends IllegalArgumentException {
        TooSlow(Pattern p) {
            super("The pattern '" + p.pattern() + "' takes too long (it tries too many combinations). Simplify it, e.g. avoid a repeat inside a repeat like (.*a)+.");
        }
    }

    private static void checkNotSlow(Pattern p) {
        Long until = SLOW.get(p.pattern());
        if (until == null) return;
        if (until < System.currentTimeMillis()) SLOW.remove(p.pattern());
        else throw new TooSlow(p);
    }

    /** The text as the matcher reads it; reading it checks the clock now and then. */
    private static final class Timed implements CharSequence {
        private final CharSequence s;
        private final Pattern p;
        private final long deadline;
        private int reads;

        Timed(CharSequence s, Pattern p) {
            this(s, p, System.nanoTime() + LIMIT_NANOS);
        }

        private Timed(CharSequence s, Pattern p, long deadline) {
            this.s = s;
            this.p = p;
            this.deadline = deadline;
        }

        @Override
        public char charAt(int i) {
            if ((++reads & 0x3FF) == 0 && System.nanoTime() > deadline) {
                if (SLOW.size() > 500) SLOW.clear();
                SLOW.put(p.pattern(), System.currentTimeMillis() + REMEMBER_MS);
                throw new TooSlow(p);
            }
            return s.charAt(i);
        }

        @Override
        public int length() {
            return s.length();
        }

        @Override
        public CharSequence subSequence(int a, int b) {
            return new Timed(s.subSequence(a, b), p, deadline);
        }

        @Override
        public String toString() {
            return s.toString();
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
