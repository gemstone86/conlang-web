package com.conlangs.web;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * A syllable shape written with C (consonant), V (vowel) and brackets for optional parts, e.g. C(C)V(C) or (V)C(C)V(C).
 * A leading (V) is an optional vowel at the start of the word only. Digraphs (sh, ch, gh, ng) and diphthongs (ai, ou)
 * count as one sound. Pure Java, no Spring.
 */
public final class SyllableShape {
    private final Pattern word;
    private final String text;
    private final boolean leadV;
    private final String types;       // one C or V per element of a syllable (a leading (V) is not included)
    private final boolean[] optional;

    private SyllableShape(String text, Pattern word, boolean leadV, String types, boolean[] optional) {
        this.text = text; this.word = word; this.leadV = leadV; this.types = types; this.optional = optional;
    }

    public String text() { return text; }

    /** Null when the shape is fine, otherwise what is wrong with it. */
    public static String check(String shape) {
        if (shape == null || shape.isBlank()) return null;
        String s = shape.replaceAll("\\s+", "").toUpperCase();
        int depth = 0;
        boolean required = false;
        for (char ch : s.toCharArray()) {
            if (ch == '(') { if (depth > 0) return "Brackets cannot be nested."; depth++; }
            else if (ch == ')') { if (depth == 0) return "A closing bracket has no opening one."; depth--; }
            else if (ch == 'C' || ch == 'V') { if (ch == 'V' && depth == 0) required = true; }
            else return "Only C, V and brackets can be used (found '" + ch + "').";
        }
        if (depth != 0) return "A bracket is not closed.";
        if (!required) return "A syllable needs at least one required V, like C(C)V(C).";
        return null;
    }

    /** Null for a blank shape; throws IllegalArgumentException for a bad one. */
    public static SyllableShape parse(String shape) {
        if (shape == null || shape.isBlank()) return null;
        String err = check(shape);
        if (err != null) throw new IllegalArgumentException(err);
        String s = shape.replaceAll("\\s+", "").toUpperCase();
        boolean leadV = s.startsWith("(V)");
        String body = leadV ? s.substring(3) : s;
        StringBuilder re = new StringBuilder();
        for (char ch : body.toCharArray()) {
            if (ch == '(') re.append("(?:");
            else if (ch == ')') re.append(")?");
            else re.append(ch);
        }
        String syl = re.toString();
        StringBuilder ty = new StringBuilder();
        List<Boolean> opt = new ArrayList<>();
        boolean in = false;
        for (char ch : body.toCharArray()) {
            if (ch == '(') in = true;
            else if (ch == ')') in = false;
            else { ty.append(ch); opt.add(in); }
        }
        boolean[] o = new boolean[opt.size()];
        for (int i = 0; i < o.length; i++) o[i] = opt.get(i);
        return new SyllableShape(s, Pattern.compile("^" + (leadV ? "V?" : "") + "(?:" + syl + ")+$"), leadV, ty.toString(), o);
    }

    /** The word as a string of C and V, one letter per sound. */
    public static String skeleton(String form) {
        StringBuilder sb = new StringBuilder();
        for (String g : InventoryBuilder.segment(form, Set.of())) {
            InventoryBuilder.Sound c = InventoryBuilder.classify(g, java.util.Map.of());
            boolean v = c.known() ? c.kind().equals("vowel") : RootSuggester.isVowel(g.charAt(0));
            sb.append(v ? 'V' : 'C');
        }
        return sb.toString();
    }

    public boolean fits(String form) {
        if (form == null) return false;
        String sk = skeleton(form);
        return !sk.isEmpty() && word.matcher(sk).matches();
    }

    public List<String> misfits(Iterable<String> forms) {
        List<String> out = new ArrayList<>();
        for (String f : forms) if (!fits(f)) out.add(f);
        return out;
    }

    /**
     * Writes a word of the given number of syllables straight from the shape, picking sounds at random from the lists.
     * onset2 is used for the second consonant of a cluster, coda for consonants after the vowel.
     */
    public String generate(java.util.Random rnd, int syllables, List<String> onset, List<String> onset2, List<String> coda, List<String> vowels) {
        StringBuilder sb = new StringBuilder();
        if (leadV && rnd.nextInt(5) == 0) sb.append(vowels.get(rnd.nextInt(vowels.size())));
        for (int n = 0; n < syllables; n++) {
            boolean seenV = false;
            int cBefore = 0;
            for (int i = 0; i < types.length(); i++) {
                if (optional[i] && rnd.nextInt(100) >= 35) continue;
                if (types.charAt(i) == 'V') { sb.append(vowels.get(rnd.nextInt(vowels.size()))); seenV = true; }
                else if (seenV) sb.append(coda.get(rnd.nextInt(coda.size())));
                else { List<String> l = cBefore == 0 ? onset : onset2; sb.append(l.get(rnd.nextInt(l.size()))); cBefore++; }
            }
        }
        return sb.toString();
    }
}
