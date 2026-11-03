package com.conlangs.web;

import java.util.List;

/** Pure helpers for building word forms; no Spring, so they can be tested on their own. */
public final class FormMath {
    private FormMath() {}

    /** Joins an affix onto a base form. With hiatus, the first of two meeting vowels is dropped. */
    public static String attach(String base, String placement, String affix, boolean hiatus, String vowels) {
        boolean prefix = "prefix".equals(placement);
        if (!hiatus || base.isEmpty() || affix.isEmpty()) return prefix ? affix + base : base + affix;
        if (prefix) {
            boolean meet = vowels.indexOf(affix.charAt(affix.length() - 1)) >= 0 && vowels.indexOf(base.charAt(0)) >= 0;
            return (meet ? affix.substring(0, affix.length() - 1) : affix) + base;
        }
        boolean meet = vowels.indexOf(base.charAt(base.length() - 1)) >= 0 && vowels.indexOf(affix.charAt(0)) >= 0;
        return (meet ? base.substring(0, base.length() - 1) : base) + affix;
    }

    /**
     * The form a word had in a language at a given year, taken from Evolver rows. langPath lists the language itself first,
     * then its ancestors: a branch that had not split off yet at that year shares its parent's form. If the word did not
     * exist yet, its first (entry) form is returned.
     */
    public static String formAt(List<Evolver.Row> rows, List<Long> langPath, int year) {
        for (long lang : langPath) {
            for (int i = rows.size() - 1; i >= 0; i--) {
                Evolver.Row r = rows.get(i);
                if (r.langId() == lang && r.year() <= year && !r.source().equals("ERROR")) return r.form();
            }
        }
        return rows.isEmpty() ? null : rows.get(0).form();
    }
}
