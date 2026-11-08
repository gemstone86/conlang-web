package com.conlangs.web;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Applies dated, ordered sound-change rules to a word as it passes down a language family tree.
 * Pure Java (no Spring) so it can be unit tested on its own.
 *
 * Semantics: a rule belongs to one language and applies to words in that language and, after the
 * split year, only in the child languages that inherit from it. A child language inherits the word
 * form as it stood at its split year (rules with year &lt; splitYear in the parent); the child's own
 * rules apply from its split year onward. Overrides replace the computed form at a given year and
 * evolution continues from the override.
 */
public final class Evolver {

    public record Rule(long id, long langId, int year, int ord, String name, String pattern, String replacement) {}
    public record Override(long langId, int year, String form) {}
    public record Lang(long id, String name, Long parentId, Integer splitYear, String classes) {}
    /** source is one of ENTRY, RULE, OVERRIDE, SPLIT, ERROR. */
    public record Row(long langId, String langName, int year, String form, String source, String rule) {}

    private final Map<Long, Lang> langs;
    private final Map<Long, List<Rule>> rulesByLang;
    private final Map<Long, Map<String, String>> classCache = new HashMap<>();
    /** Compiled patterns per language and rule (a pattern's classes depend on the language): compiled once, used for every word. */
    private final Map<Long, Map<Long, Object>> patternCache = new HashMap<>();
    /** The children of each language, by split year: worked out once. */
    private final Map<Long, List<Lang>> childrenCache = new HashMap<>();

    public Evolver(List<Lang> langs, List<Rule> rules) {
        this.langs = new HashMap<>();
        for (Lang l : langs) this.langs.put(l.id(), l);
        this.rulesByLang = new HashMap<>();
        for (Rule r : rules) {
            this.rulesByLang.computeIfAbsent(r.langId(), k -> new ArrayList<>()).add(r);
        }
    }

    private Map<String, String> classesFor(long langId) {
        // Not computeIfAbsent: the computation recurses into the parent language, and a HashMap
        // must not be modified from inside its own computeIfAbsent.
        Map<String, String> cached = classCache.get(langId);
        if (cached != null) return cached;
        Lang l = langs.get(langId);
        Map<String, String> m = new java.util.LinkedHashMap<>();
        if (l != null) {
            if (l.parentId() != null) m.putAll(classesFor(l.parentId()));
            m.putAll(Patterns.parseClasses(l.classes()));
        }
        classCache.put(langId, m);
        return m;
    }

    /** Computes every dated form of a word entered in rootLang at startYear, for rootLang and all descendants. */
    public List<Row> evolve(long rootLang, String startForm, int startYear, List<Override> overrides) {
        return evolve(rootLang, startForm, startYear, overrides, null);
    }

    /**
     * As {@link #evolve(long, String, int, List)}, but only into the languages in {@code only} (null = all): branches
     * outside it are skipped, which saves time when only some languages are shown.
     */
    public List<Row> evolve(long rootLang, String startForm, int startYear, List<Override> overrides, java.util.Set<Long> only) {
        Map<Long, List<Override>> byLang = new HashMap<>();
        for (Override o : overrides) byLang.computeIfAbsent(o.langId(), k -> new ArrayList<>()).add(o);
        List<Row> rows = new ArrayList<>();
        Lang root = langs.get(rootLang);
        if (root == null) return rows;
        rows.add(new Row(rootLang, root.name(), startYear, startForm, "ENTRY", null));
        walk(root, startForm, startYear, rows, byLang, only);
        return rows;
    }

    /** Text that is a note rather than a word (see "...", see #12, or starting with "=") is never sound-changed. */
    public static boolean isLiteral(String f) {
        if (f == null) return false;
        String t = f.trim();
        return t.startsWith("=") || Refs.parse(t) != null;
    }

    private List<Lang> childrenOf(long langId) {
        List<Lang> kids = childrenCache.get(langId);
        if (kids != null) return kids;
        kids = new ArrayList<>();
        for (Lang c : langs.values()) if (c.parentId() != null && c.parentId() == langId && c.splitYear() != null) kids.add(c);
        kids.sort(Comparator.comparingInt(Lang::splitYear).thenComparingLong(Lang::id));
        childrenCache.put(langId, kids);
        return kids;
    }

    private void walk(Lang lang, String form, int from, List<Row> rows, Map<Long, List<Override>> ovr, java.util.Set<Long> only) {
        int first = rows.size();
        run(lang, form, from, null, rows, ovr);
        int last = rows.size();
        for (Lang c : childrenOf(lang.id())) {
            if (c.splitYear() < from || (only != null && !only.contains(c.id()))) continue;
            // the form when the branch splits off: after this language's changes before the split year. The run above
            // recorded every change, so it is the last one before that year (rather than running the changes again).
            String atSplit = form;
            for (int i = first; i < last; i++) {
                Row r = rows.get(i);
                if (r.year() < c.splitYear() && !r.source().equals("ERROR")) atSplit = r.form();
            }
            rows.add(new Row(c.id(), c.name(), c.splitYear(), atSplit, "SPLIT", null));
            walk(c, atSplit, c.splitYear(), rows, ovr, only);
        }
    }

    private Pattern pattern(long langId, Rule r, Map<String, String> classes) {
        Map<Long, Object> m = patternCache.computeIfAbsent(langId, k -> new HashMap<>());
        Object p = m.get(r.id());
        if (p == null) {
            try {
                p = Patterns.compile(r.pattern(), classes);
            } catch (IllegalArgumentException e) {
                p = e;
            }
            m.put(r.id(), p);
        }
        if (p instanceof IllegalArgumentException e) throw e;
        return (Pattern) p;
    }

    private record Event(int year, int kind, int ord, long id, Rule rule, Override override) {}

    /** Runs events with from &lt;= year &lt; to (to == null means no end). Returns the final form. */
    private String run(Lang lang, String form, int from, Integer to, List<Row> out, Map<Long, List<Override>> ovr) {
        if (isLiteral(form)) return form;
        List<Event> events = new ArrayList<>();
        for (Rule r : rulesByLang.getOrDefault(lang.id(), List.of())) {
            if (r.year() >= from && (to == null || r.year() < to)) {
                events.add(new Event(r.year(), 0, r.ord(), r.id(), r, null));
            }
        }
        for (Override o : ovr.getOrDefault(lang.id(), List.of())) {
            if (o.year() >= from && (to == null || o.year() < to)) {
                events.add(new Event(o.year(), 1, 0, 0, null, o));
            }
        }
        events.sort(Comparator.comparingInt(Event::year).thenComparingInt(Event::kind)
                .thenComparingInt(Event::ord).thenComparingLong(Event::id));
        Map<String, String> classes = classesFor(lang.id());
        String cur = form;
        for (Event e : events) {
            if (e.override() != null) {
                cur = e.override().form();
                out.add(new Row(lang.id(), lang.name(), e.year(), cur, "OVERRIDE", null));
                continue;
            }
            Rule r = e.rule();
            String label = r.name() == null || r.name().isBlank() ? r.pattern() + " > " + r.replacement() : r.name();
            try {
                Pattern p = pattern(lang.id(), r, classes);
                String next = Patterns.apply(p, r.replacement(), cur);
                if (!next.equals(cur)) {
                    cur = next;
                    out.add(new Row(lang.id(), lang.name(), e.year(), cur, "RULE", label));
                }
            } catch (IllegalArgumentException ex) {
                out.add(new Row(lang.id(), lang.name(), e.year(), cur, "ERROR", label + ": " + ex.getMessage()));
            }
        }
        return cur;
    }
}
