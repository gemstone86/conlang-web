package com.conlangs.web;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Automatic casual-speech erosion of a compound: applies an ordered list of light simplification steps
 * (one pass each) until the word reaches the target length, or until the next step would collide with
 * an existing word, in which case it stops one step short.
 *
 * Steps are written one per line as {@code pattern => replacement}; // starts a comment line.
 */
public final class Erosion {
    private Erosion() {}

    public record Step(String form, String rule) {}

    public static List<Step> erode(String start, String stepsText, String classesText, int targetLen, Set<String> avoid) {
        List<Step> out = new ArrayList<>();
        out.add(new Step(start, "start"));
        Map<String, String> classes = Patterns.parseClasses(classesText);
        String cur = start;
        if (stepsText == null) return out;
        for (String line : stepsText.split("\\R")) {
            String t = line.trim();
            if (t.isEmpty() || t.startsWith("//")) continue;
            if (targetLen > 0 && Patterns.length(cur) <= targetLen) break;
            int arrow = t.indexOf("=>");
            if (arrow < 1) continue;
            String pat = t.substring(0, arrow).trim();
            String rep = t.substring(arrow + 2).trim();
            if (rep.equals("\"\"") || rep.equals("-")) rep = "";
            try {
                Pattern p = Patterns.compile(pat, classes);
                String next = Patterns.apply(p, rep, cur);
                if (next.equals(cur)) continue;
                if (next.isEmpty()) continue;
                if (avoid != null && avoid.contains(next)) {
                    out.add(new Step(cur, "stopped: next step (" + t + ") would collide with an existing word"));
                    return out;
                }
                cur = next;
                out.add(new Step(cur, t));
            } catch (IllegalArgumentException ex) {
                out.add(new Step(cur, "skipped bad step '" + t + "': " + ex.getMessage()));
            }
        }
        return out;
    }
}
