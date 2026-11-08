package com.conlangs.web;

import java.util.List;

/**
 * Pure: when a word stops being used in a language. A word marked lost in a language at a year is gone there
 * from that year on, and so it is in every branch that splits off from that language after that year (they never
 * got it). Branches that split off at or before that year keep the word.
 */
public final class Losses {
    private Losses() {}

    /** The word is lost in langId from year. */
    public record Loss(long langId, int year) {}

    /**
     * path lists the languages from the word's own language down to the one being viewed (root first);
     * childSplit.get(i) is the year path[i+1] split off from path[i]. Returns the loss that takes the word away from
     * the viewed language (the earliest one), or null if it still has it.
     */
    public static Loss lostAt(List<Loss> losses, List<Long> path, List<Integer> childSplit) {
        if (losses == null || losses.isEmpty()) return null;
        Loss best = null;
        for (Loss l : losses) {
            int i = path.indexOf(l.langId());
            if (i < 0) continue;
            boolean last = i == path.size() - 1;
            Integer split = i < childSplit.size() ? childSplit.get(i) : null;
            // in an ancestor: only if the next language on the way split off after the loss (it never got the word)
            if (!last && split != null && split <= l.year()) continue;
            if (best == null || l.year() < best.year()) best = l;
        }
        return best;
    }
}
