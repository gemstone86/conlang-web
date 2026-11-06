package com.conlangs.web;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;

/**
 * Suggests new root forms that sound like the words a language already has. It learns which letters follow which
 * (letter by letter, looking at the two letters before) from the existing forms, then writes new forms the same way,
 * and keeps only those that are not already taken and are not too close to an existing word. Pure Java, no Spring.
 */
public final class RootSuggester {
    private RootSuggester() {}

    private static final String VOWELS = "aeiouyäöüåæøáéíóúýâêîôûāēīōūǫą";
    private static final char START = '\u0002', END = '\u0003';

    public static boolean isVowel(char c) {
        return VOWELS.indexOf(Character.toLowerCase(c)) >= 0;
    }

    public static int syllables(String s) {
        int n = 0;
        boolean prev = false;
        for (char c : s.toCharArray()) {
            boolean v = isVowel(c);
            if (v && !prev) n++;
            prev = v;
        }
        return n;
    }

    /** True for forms worth learning from: one plain word, no cross-references or notes. */
    static boolean usable(String f) {
        if (f == null) return false;
        String t = f.strip();
        if (t.length() < 2 || t.length() > 20) return false;
        if (t.contains(" ") || t.contains("\"")) return false;
        for (char c : t.toCharArray()) if (Character.isDigit(c) || c == '#' || c == '(' || c == ')') return false;
        return true;
    }

    private static void count(Map<String, Map<Character, Integer>> m, String ctx, char next) {
        m.computeIfAbsent(ctx, k -> new HashMap<>()).merge(next, 1, Integer::sum);
    }

    private static char pick(Map<Character, Integer> options, Random rnd) {
        int total = 0;
        for (int v : options.values()) total += v;
        int r = rnd.nextInt(total);
        for (Map.Entry<Character, Integer> e : options.entrySet()) {
            r -= e.getValue();
            if (r < 0) return e.getKey();
        }
        return END;
    }

    /**
     * @param corpus  forms the language already has (the sound of the language is learned from these)
     * @param taken   forms that must not be suggested, nor anything too close to them
     * @param count   how many suggestions
     * @param minSyl  fewest syllables (vowel groups)
     * @param maxSyl  most syllables
     * @param seed    makes the result repeatable
     */
    public static List<String> suggest(Collection<String> corpus, Collection<String> taken, int count, int minSyl, int maxSyl, long seed) {
        return suggest(corpus, taken, count, minSyl, maxSyl, seed, null);
    }

    /** As above; with a syllable shape only forms that fit it are suggested, and the language is learned from the words that fit it (if at least 5 do). */
    public static List<String> suggest(Collection<String> corpus, Collection<String> taken, int count, int minSyl, int maxSyl, long seed, SyllableShape shape) {
        if (shape != null) {
            List<String> fitting = new ArrayList<>();
            for (String f : corpus) if (usable(f) && shape.fits(f.strip())) fitting.add(f);
            if (fitting.size() >= 5) corpus = fitting;
        }
        Map<String, Map<Character, Integer>> tri = new HashMap<>(), bi = new HashMap<>();
        int learned = 0;
        for (String f : corpus) {
            if (!usable(f)) continue;
            String w = f.strip();
            learned++;
            String s = "" + START + START + w + END;
            for (int i = 2; i < s.length(); i++) {
                count(tri, s.substring(i - 2, i), s.charAt(i));
                count(bi, s.substring(i - 1, i), s.charAt(i));
            }
        }
        List<String> out = new ArrayList<>();
        if (learned < 5 || count <= 0) return out;
        Set<String> takenSet = new HashSet<>();
        List<String> takenList = new ArrayList<>();
        for (String t : taken) if (t != null && !t.isBlank()) { takenSet.add(t.strip()); takenList.add(t.strip()); }
        Random rnd = new Random(seed);
        Set<String> seen = new HashSet<>();
        List<String> pool = new ArrayList<>();
        List<Double> scores = new ArrayList<>();
        for (int attempt = 0; attempt < count * 400 + 2000 && pool.size() < count * 12; attempt++) {
            StringBuilder sb = new StringBuilder();
            char a = START, b = START;
            while (sb.length() < 16) {
                Map<Character, Integer> opts = tri.get("" + a + b);
                if (opts == null || rnd.nextInt(10) == 0) opts = bi.get("" + b);
                if (opts == null) break;
                char c = pick(opts, rnd);
                if (c == END) break;
                sb.append(c);
                a = b;
                b = c;
            }
            String w = sb.toString();
            if (w.length() < 2 || !seen.add(w) || takenSet.contains(w)) continue;
            int syl = syllables(w);
            if (syl < minSyl || syl > maxSyl) continue;
            if (w.matches(".*(.)\\1\\1.*")) continue;
            if (shape != null && !shape.fits(w)) continue;
            boolean close = false;
            for (String t : takenList) {
                if (Math.abs(t.length() - w.length()) <= 2 && Distance.normalized(w, t) < 0.3) { close = true; break; }
            }
            if (close) continue;
            double lp = 0;
            String s = "" + START + w + END;
            for (int i = 1; i < s.length(); i++) {
                Map<Character, Integer> o = bi.get(s.substring(i - 1, i));
                int tot = 0;
                if (o != null) for (int v : o.values()) tot += v;
                int hit = o == null ? 0 : o.getOrDefault(s.charAt(i), 0);
                lp += Math.log((hit + 0.5) / (tot + 5.0));
            }
            pool.add(w);
            scores.add(lp / (w.length() + 1));
        }
        Integer[] order = new Integer[pool.size()];
        for (int i = 0; i < order.length; i++) order[i] = i;
        java.util.Arrays.sort(order, (x, y) -> Double.compare(scores.get(y), scores.get(x)));
        for (int idx : order) {
            String w = pool.get(idx);
            boolean near = false;
            for (String o : out) if (Distance.normalized(w, o) < 0.3) { near = true; break; }
            if (near) continue;
            out.add(w);
            if (out.size() >= count) break;
        }
        return out;
    }
}
