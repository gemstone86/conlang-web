package com.conlangs.web;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Works out which sounds a set of written forms uses: splits each form into letters (digraphs such as sh, ch, th, ng and
 * diphthongs such as ai, ou count as one), and puts every letter in the consonant or vowel table. A language's own sound
 * list takes priority, so a symbol the user has already placed keeps its row and column.
 * Pure Java, no Spring, so it can be tested on its own.
 */
public final class InventoryBuilder {
    private InventoryBuilder() {}

    public record Sound(String symbol, String kind, String row, String col, String ipa, boolean known) {}

    public static final String DIPHTHONGS = "Diphthongs";

    private static final Map<String, Sound> BUILTIN = new HashMap<>();
    private static final Set<String> MULTI = new HashSet<>();

    private static void c(String sym, String ipa, String row, String col) { BUILTIN.put(sym, new Sound(sym, "consonant", row, col, ipa, true)); if (sym.length() > 1) MULTI.add(sym); }
    private static void v(String sym, String ipa, String row, String col) { BUILTIN.put(sym, new Sound(sym, "vowel", row, col, ipa, true)); if (sym.length() > 1) MULTI.add(sym); }

    static {
        c("p", "p", "Stop", "Bilabial"); c("b", "b", "Stop", "Bilabial");
        c("t", "t", "Stop", "Alveolar"); c("d", "d", "Stop", "Alveolar");
        c("k", "k", "Stop", "Velar"); c("g", "g", "Stop", "Velar"); c("c", "k", "Stop", "Velar"); c("q", "q", "Stop", "Uvular");
        c("m", "m", "Nasal", "Bilabial"); c("n", "n", "Nasal", "Alveolar"); c("ng", "ŋ", "Nasal", "Velar");
        c("f", "f", "Fricative", "Labiodental"); c("v", "v", "Fricative", "Labiodental");
        c("þ", "θ", "Fricative", "Dental"); c("ð", "ð", "Fricative", "Dental"); c("th", "θ", "Fricative", "Dental");
        c("s", "s", "Fricative", "Alveolar"); c("z", "z", "Fricative", "Alveolar");
        c("sh", "ʃ", "Fricative", "Postalveolar"); c("zh", "ʒ", "Fricative", "Postalveolar");
        c("x", "x", "Fricative", "Velar"); c("gh", "ɣ", "Fricative", "Velar"); c("h", "h", "Fricative", "Glottal");
        c("hw", "ʍ", "Fricative", "Labial-velar"); c("hv", "ʍ", "Fricative", "Labial-velar");
        c("ch", "tʃ", "Affricate", "Postalveolar"); c("ts", "ts", "Affricate", "Alveolar");
        c("r", "r", "Trill", "Alveolar"); c("l", "l", "Lateral", "Alveolar");
        c("j", "j", "Approximant", "Palatal"); c("w", "w", "Approximant", "Labial-velar");
        v("i", "i", "Close", "Front"); v("y", "y", "Close", "Front"); v("u", "u", "Close", "Back");
        v("e", "e", "Close-mid", "Front"); v("ø", "ø", "Close-mid", "Front"); v("o", "o", "Close-mid", "Back");
        v("æ", "æ", "Near-open", "Front"); v("ǫ", "ɔ", "Open-mid", "Back"); v("a", "a", "Open", "Central");
        v("ą", "ã", "Open", "Central");
        for (String d : new String[]{"ai", "ei", "au", "ou", "oi", "eu", "ui", "iu", "ia", "ie", "io", "ua", "ue", "uo"}) v(d, d, DIPHTHONGS, "Diphthong");
    }

    /** True if the string is a letter of the built-in table or one of the language's own multi-letter symbols. */
    public static boolean isMulti(String s, Set<String> ownMulti) { return MULTI.contains(s) || ownMulti.contains(s); }

    /** Splits a written form into sounds (lower case). Spaces, hyphens, apostrophes and similar are skipped. */
    public static List<String> segment(String form, Set<String> ownMulti) {
        List<String> out = new ArrayList<>();
        if (form == null) return out;
        String s = Normalizer.normalize(form.toLowerCase(), Normalizer.Form.NFC);
        int i = 0;
        while (i < s.length()) {
            int cp = s.codePointAt(i);
            if (!Character.isLetter(cp)) { i += Character.charCount(cp); continue; }
            int n = 0;
            for (int len = 3; len >= 2 && n == 0; len--) {
                if (i + len <= s.length() && isMulti(s.substring(i, i + len), ownMulti)) n = len;
            }
            if (n == 0) n = Character.charCount(cp);
            int j = i + n;
            while (j < s.length() && Character.getType(s.charAt(j)) == Character.NON_SPACING_MARK) j++;   // marks that did not compose into one letter
            if (j < s.length() && s.charAt(j) == ':') j++;                                                // Dwarven length mark
            out.add(s.substring(i, j));
            i = j;
        }
        return out;
    }

    /**
     * Classifies one sound. Own symbols win; then the built-in table; then the same letter with its length or nasal mark removed
     * (ā, á, â, a:), then umlauts (ö, ä, ü). Anything else is returned with known = false and kind "consonant".
     */
    public static Sound classify(String g, Map<String, Sound> own) {
        Sound o = own.get(g);
        if (o != null) return o;
        Sound b = BUILTIN.get(g);
        if (b != null) return b;
        String d = Normalizer.normalize(g, Normalizer.Form.NFD);
        boolean longV = d.endsWith(":");
        if (longV) d = d.substring(0, d.length() - 1);
        StringBuilder base = new StringBuilder();
        boolean umlaut = false;
        for (int i = 0; i < d.length(); i++) {
            char ch = d.charAt(i);
            if (ch == '̄' || ch == '́' || ch == '̂' || ch == '̀') longV = true;
            else if (ch == '̈') umlaut = true;
            else if (ch == '̨') base.append("̨");
            else base.append(ch);
        }
        String bs = Normalizer.normalize(base.toString(), Normalizer.Form.NFC);
        if (umlaut) bs = switch (bs) { case "o" -> "ø"; case "a" -> "æ"; case "u" -> "y"; default -> bs; };
        Sound root = (bs.equals(g) ? null : own.get(bs));
        if (root == null) root = BUILTIN.get(bs);
        if (root != null && root.kind().equals("vowel") && !root.row().equals(DIPHTHONGS)) {
            if (!longV && bs.equals(g)) return root;
            return new Sound(g, "vowel", root.row(), root.col(), root.ipa() + (longV ? "ː" : ""), true);
        }
        if (root != null && !bs.equals(g)) return new Sound(g, root.kind(), root.row(), root.col(), root.ipa(), true);
        return new Sound(g, "consonant", "", "", g, false);
    }

    /** Sounds used by the given forms, with how many forms use each one and a few examples. */
    public static Map<String, Object[]> inventory(Iterable<String> forms, Map<String, Sound> own) {
        Set<String> ownMulti = new HashSet<>();
        for (String k : own.keySet()) if (k.codePointCount(0, k.length()) > 1) ownMulti.add(k);
        Map<String, Object[]> out = new LinkedHashMap<>();   // symbol -> {count, first example, second example}
        for (String f : forms) {
            Set<String> seen = new HashSet<>();
            for (String g : segment(f, ownMulti)) {
                if (!seen.add(g)) continue;
                Object[] e = out.computeIfAbsent(g, k -> new Object[]{0, null, null});
                e[0] = (Integer) e[0] + 1;
                if (e[1] == null) e[1] = f; else if (e[2] == null && !f.equals(e[1])) e[2] = f;
            }
        }
        return out;
    }
}
