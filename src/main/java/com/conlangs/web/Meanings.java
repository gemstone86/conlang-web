package com.conlangs.web;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Pure: which meanings a word has in a language, given dated "also means" / "changes to" events. */
public final class Meanings {
    private Meanings() {}

    public record Ev(long langId, int year, String mode, String text) {}

    /**
     * path lists the languages from the word's own language down to the one being viewed; childSplit.get(i) is the year
     * path[i+1] split off from path[i] (null for the last). Events in a language only reach its branches if they happened
     * before the branch split off. atYear (nullable) ignores later events. Mode ADD adds a meaning, CHANGE replaces all.
     */
    public static List<String> senses(String gloss, List<Ev> events, List<Long> path, List<Integer> childSplit, Integer atYear) {
        List<String> out = new ArrayList<>();
        out.add(gloss);
        for (int i = 0; i < path.size(); i++) {
            final long lang = path.get(i);
            Integer cutoff = i < childSplit.size() ? childSplit.get(i) : null;
            List<Ev> mine = new ArrayList<>();
            for (Ev e : events) if (e.langId() == lang) mine.add(e);
            mine.sort(Comparator.comparingInt(Ev::year));
            for (Ev e : mine) {
                if (atYear != null && e.year() > atYear) continue;
                if (cutoff != null && e.year() >= cutoff) continue;
                if ("CHANGE".equalsIgnoreCase(e.mode())) out.clear();
                if (!out.contains(e.text())) out.add(e.text());
            }
        }
        return out;
    }
}
