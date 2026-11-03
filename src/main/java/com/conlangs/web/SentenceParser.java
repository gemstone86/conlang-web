package com.conlangs.web;

import java.util.ArrayList;
import java.util.List;

/**
 * Pure parser for sentence input such as {@code (to see)(you-obj) (poss)(darkness)(pos-in) (me).}
 * Words are separated by spaces outside parentheses; each word is a list of parts. A part is the text inside one pair of
 * parentheses, or "=text" for plain characters written outside parentheses (kept as they are).
 */
public final class SentenceParser {
    private SentenceParser() {}

    public static List<List<String>> parse(String src) {
        List<List<String>> words = new ArrayList<>();
        if (src == null) return words;
        List<String> cur = new ArrayList<>();
        StringBuilder lit = new StringBuilder(), in = new StringBuilder();
        boolean open = false;
        for (int i = 0; i < src.length(); i++) {
            char c = src.charAt(i);
            if (open) {
                if (c == ')') {
                    String t = in.toString().trim();
                    if (!t.isEmpty()) cur.add(t);
                    in.setLength(0);
                    open = false;
                } else in.append(c);
            } else if (c == '(') {
                if (lit.length() > 0) { cur.add("=" + lit); lit.setLength(0); }
                open = true;
            } else if (Character.isWhitespace(c)) {
                if (lit.length() > 0) { cur.add("=" + lit); lit.setLength(0); }
                if (!cur.isEmpty()) { words.add(cur); cur = new ArrayList<>(); }
            } else lit.append(c);
        }
        if (open) {
            String t = in.toString().trim();
            if (!t.isEmpty()) cur.add(t);
        }
        if (lit.length() > 0) cur.add("=" + lit);
        if (!cur.isEmpty()) words.add(cur);
        return words;
    }
}
