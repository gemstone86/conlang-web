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
    /**
     * The years of a language's spelling reforms, from "0, 500, 1200" (sorted; anything else is an error). The
     * spelling of a word is how it sounded at the latest reform (or when it was coined, if that was later): it lags
     * behind the pronunciation until the next reform. Empty: the language is spelled as it sounds.
     */
    public static List<Integer> years(String text) {
        List<Integer> out = new java.util.ArrayList<>();
        if (text == null || text.isBlank()) return out;
        for (String p : text.split("[,;\\s]+")) {
            if (p.isBlank()) continue;
            try { out.add(Integer.parseInt(p.trim())); } catch (NumberFormatException e) { throw new ApiException(400, "Spelling reforms: '" + p + "' is not a year."); }
        }
        java.util.Collections.sort(out);
        return out;
    }

    public static String yearsText(String text) {
        List<Integer> ys = years(text);
        if (ys.size() > 60) throw new ApiException(400, "Too many spelling reforms.");
        StringBuilder sb = new StringBuilder();
        for (int y : ys) sb.append(sb.length() == 0 ? "" : ", ").append(y);
        return sb.length() == 0 ? null : sb.toString();
    }

    /** A stored form's levelling as an override: from level_year the form is level_form (what its rule gave then). */
    public static List<Evolver.Override> level(java.util.Map<String, Object> f, long langId) {
        if (f == null || f.get("level_year") == null || f.get("level_form") == null) return List.of();
        return List.of(new Evolver.Override(langId, ((Number) f.get("level_year")).intValue(), (String) f.get("level_form")));
    }

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
