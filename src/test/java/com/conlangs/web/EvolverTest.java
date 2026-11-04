package com.conlangs.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class EvolverTest {

    private Evolver family() {
        // Proto (id 1) -> High (id 2, splits -2000) ; Proto -> Low (id 3, splits -2750)
        List<Evolver.Lang> langs = List.of(
                new Evolver.Lang(1, "Proto", null, null, "V=aeiou\nC=ptkmnsl"),
                new Evolver.Lang(2, "High", 1L, -2000, null),
                new Evolver.Lang(3, "Low", 1L, -2750, null));
        List<Evolver.Rule> rules = List.of(
                new Evolver.Rule(10, 1, -5000, 0, "t>T", "t", "T"),
                new Evolver.Rule(11, 1, -3000, 0, "final a drops", "a#", ""),
                new Evolver.Rule(12, 2, -1000, 0, "hiatus", "({V})\\1", "$1"));
        return new Evolver(langs, rules);
    }

    @Test
    void childInheritsParentFormAtSplitAndDivergesAfter() {
        List<Evolver.Row> rows = family().evolve(1, "tata", -8000, List.of());
        // Proto: t>T at -5000 => TaTa ; final-a-drop at -3000 => TaT
        assertTrue(rows.stream().anyMatch(r -> r.langId() == 1 && r.year() == -5000 && r.form().equals("TaTa")));
        assertTrue(rows.stream().anyMatch(r -> r.langId() == 1 && r.year() == -3000 && r.form().equals("TaT")));
        // Low splits at -2750, i.e. after -3000 so inherits TaT
        Evolver.Row low = rows.stream().filter(r -> r.langId() == 3 && r.source().equals("SPLIT")).findFirst().orElseThrow();
        assertEquals("TaT", low.form());
    }

    @Test
    void splitBeforeRuleMeansChildMissesParentRule() {
        List<Evolver.Lang> langs = List.of(
                new Evolver.Lang(1, "Proto", null, null, null),
                new Evolver.Lang(2, "Early", 1L, -4000, null));
        List<Evolver.Rule> rules = List.of(new Evolver.Rule(1, 1, -3000, 0, null, "a", "o"));
        Evolver ev = new Evolver(langs, rules);
        List<Evolver.Row> rows = ev.evolve(1, "kata", -8000, List.of());
        Evolver.Row split = rows.stream().filter(r -> r.langId() == 2 && r.source().equals("SPLIT")).findFirst().orElseThrow();
        assertEquals("kata", split.form());
        assertTrue(rows.stream().noneMatch(r -> r.langId() == 2 && r.source().equals("RULE")));
    }

    @Test
    void overrideReplacesComputedFormAndEvolutionContinues() {
        List<Evolver.Lang> langs = List.of(new Evolver.Lang(1, "Proto", null, null, null));
        List<Evolver.Rule> rules = List.of(
                new Evolver.Rule(1, 1, -3000, 0, null, "a", "o"),
                new Evolver.Rule(2, 1, -1000, 0, null, "k", "g"));
        Evolver ev = new Evolver(langs, rules);
        List<Evolver.Row> rows = ev.evolve(1, "kata", -8000, List.of(new Evolver.Override(1, -2000, "kiri")));
        assertEquals("giri", rows.get(rows.size() - 1).form());
        assertTrue(rows.stream().anyMatch(r -> r.source().equals("OVERRIDE") && r.form().equals("kiri")));
    }

    @Test
    void badRegexBecomesErrorRowNotCrash() {
        List<Evolver.Lang> langs = List.of(new Evolver.Lang(1, "Proto", null, null, null));
        List<Evolver.Rule> rules = List.of(new Evolver.Rule(1, 1, -3000, 0, "broken", "(", "x"));
        Evolver ev = new Evolver(langs, rules);
        List<Evolver.Row> rows = ev.evolve(1, "kata", -8000, List.of());
        assertTrue(rows.stream().anyMatch(r -> r.source().equals("ERROR")));
        assertEquals("kata", rows.get(rows.size() - 1).form());
    }

    @Test
    void erosionStopsAtTargetLengthAndBeforeCollision() {
        String steps = "ea => a\nnt => n\nuu => u";
        List<Erosion.Step> out = Erosion.erode("tuneatuu", steps, "", 0, Set.of());
        assertEquals("tunatu", out.get(out.size() - 1).form());
        out = Erosion.erode("tuneatuu", steps, "", 7, Set.of());
        assertEquals("tunatuu", out.get(out.size() - 1).form());
        out = Erosion.erode("tuneatuu", steps, "", 0, Set.of("tunatuu"));
        assertEquals("tuneatuu", out.get(out.size() - 1).form());
        assertTrue(out.get(out.size() - 1).rule().startsWith("stopped"));
    }

    @Test
    void definiteFormEvolvesSeparatelyFromBaseWord() {
        List<Evolver.Lang> langs = List.of(new Evolver.Lang(1, "Elven", null, null, null));
        List<Evolver.Rule> rules = List.of(new Evolver.Rule(1, 1, -3000, 0, "at>et", "at", "et"));
        Evolver ev = new Evolver(langs, rules);
        List<Evolver.Row> base = ev.evolve(1, "ala", -8000, List.of());
        List<Evolver.Row> def = ev.evolve(1, "alatou", -8000, List.of());
        assertEquals("ala", base.get(base.size() - 1).form());
        assertEquals("aletou", def.get(def.size() - 1).form());
    }

    @Test
    void linkedAffixFollowsTheAffixWordThroughTime() {
        // rule ou>oe at 300. The affix word "tou" (coined -8000) becomes "toe" from 300.
        List<Evolver.Lang> langs = List.of(new Evolver.Lang(1, "Elven", null, null, null));
        Evolver ev = new Evolver(langs, List.of(new Evolver.Rule(1, 1, 300, 0, "ou>oe", "ou", "oe")));
        List<Evolver.Row> affix = ev.evolve(1, "tou", -8000, List.of());
        assertEquals("tou", FormMath.formAt(affix, List.of(1L), -100));
        assertEquals("toe", FormMath.formAt(affix, List.of(1L), 500));
        // a word coined at -100 gets alatou, which the rule then turns into alatoe
        String early = FormMath.attach("ala", "suffix", FormMath.formAt(affix, List.of(1L), -100), true, "aeiouy");
        assertEquals("alatou", early);
        assertEquals("alatoe", ev.evolve(1, early, -100, List.of()).get(1).form());
        // a word coined at 500 gets the already-changed affix directly
        assertEquals("alatoe", FormMath.attach("ala", "suffix", FormMath.formAt(affix, List.of(1L), 500), true, "aeiouy"));
    }

    @Test
    void branchBeforeItsSplitSharesTheParentAffix() {
        List<Evolver.Lang> langs = List.of(new Evolver.Lang(1, "Elven", null, null, null), new Evolver.Lang(2, "High", 1L, -2000, null));
        Evolver ev = new Evolver(langs, List.of(new Evolver.Rule(1, 1, -1000, 0, "ou>oe", "ou", "oe")));
        List<Evolver.Row> affix = ev.evolve(1, "tou", -8000, List.of());
        // High splits at -2000, before the change: at -3000 High is still Elven
        assertEquals("tou", FormMath.formAt(affix, List.of(2L, 1L), -3000));
        // by -500 High is its own branch and the rule (in Elven only, year -1000 >= split) no longer reaches it
        assertEquals("tou", FormMath.formAt(affix, List.of(2L, 1L), -500));
    }

    @Test
    void wordEnteredInADeepBranchEvolvesWithoutCrashing() {
        // Elven -> High -> Drow; the word is entered in Drow, whose parent chain has not been looked at yet
        List<Evolver.Lang> langs = List.of(
                new Evolver.Lang(1, "Elven", null, null, "V=aeiou"),
                new Evolver.Lang(2, "High", 1L, -2000, "C=ptk"),
                new Evolver.Lang(3, "Drow", 2L, -1500, null));
        Evolver ev = new Evolver(langs, List.of(new Evolver.Rule(1, 3, -1000, 0, "a>o", "{V}", "o")));
        List<Evolver.Row> rows = ev.evolve(3, "kata", -1200, List.of());
        assertEquals("koto", rows.get(rows.size() - 1).form());
    }

    @Test
    void branchGetsItsOwnVersionAndLiteralsAreNotChanged() {
        List<Evolver.Lang> langs = List.of(
                new Evolver.Lang(1, "Parent", null, null, null),
                new Evolver.Lang(2, "Branch", 1L, -1000, null));
        List<Evolver.Rule> rules = List.of(
                new Evolver.Rule(1, 1, -500, 0, "eo>ia", "eo", "ia"),
                new Evolver.Rule(2, 2, -500, 0, "eo>uo", "eo", "uo"));
        Evolver ev = new Evolver(langs, rules);
        List<Evolver.Row> rows = ev.evolve(1, "teot", -2000, List.of());
        assertEquals("tiat", rows.stream().filter(r -> r.langId() == 1).reduce((a, b) -> b).orElseThrow().form());
        assertEquals("tuot", rows.stream().filter(r -> r.langId() == 2).reduce((a, b) -> b).orElseThrow().form());
        // a word coined after the split never reaches the branch
        assertTrue(ev.evolve(1, "teot", 0, List.of()).stream().noneMatch(r -> r.langId() == 2));
        // cross-references stay untouched
        for (Evolver.Row r : ev.evolve(1, "see \"teot\"", -2000, List.of())) assertEquals("see \"teot\"", r.form());
    }

    @Test
    void sentenceParserGroupsPartsIntoWords() {
        List<List<String>> w = SentenceParser.parse("(to see)(you-obj) (poss)(darkness)(pos-in) (me).");
        assertEquals(3, w.size());
        assertEquals(List.of("to see", "you-obj"), w.get(0));
        assertEquals(List.of("poss", "darkness", "pos-in"), w.get(1));
        assertEquals(List.of("me", "=."), w.get(2));
    }

    @Test
    void meaningsAddChangeAndSplitCutoff() {
        List<Meanings.Ev> evs = List.of(
                new Meanings.Ev(1, -3000, "ADD", "sky"),
                new Meanings.Ev(1, -500, "CHANGE", "heaven"),
                new Meanings.Ev(2, -200, "CHANGE", "roof"));
        // Parent (1) splits to branch (2) at -1000: the -500 change in the parent does not reach the branch.
        assertEquals(List.of("heaven"), Meanings.senses("cloud", evs, List.of(1L), List.of(), null).subList(0, 1));
        assertEquals(List.of("cloud", "sky"), Meanings.senses("cloud", evs, List.of(1L), List.of(), -1000));
        assertEquals(List.of("roof"), Meanings.senses("cloud", evs, List.of(1L, 2L), List.of(-1000), null));
        assertEquals(List.of("cloud", "sky"), Meanings.senses("cloud", evs, List.of(1L, 2L), List.of(-1000), -300));
    }

    @Test
    void crossReferencesAndDistance() {
        assertEquals("wind", Refs.parse("see \"wind\"").gloss());
        assertEquals(12L, Refs.parse("see #12").id());
        assertEquals("wind", Refs.parse("See (wind)").gloss());
        assertTrue(Refs.parse("seeker") == null);
        assertEquals("you-obj", Refs.norm("(You-obj)"));
        assertEquals(0.0, Distance.normalized("tiat", "tiat"));
        assertTrue(Math.abs(Distance.normalized("tiat", "tuat") - 0.25) < 1e-9);
        assertEquals(1.0, Distance.normalized("ab", ""));
    }

    @Test
    void ruleDiffFindsOnlyRealChanges() {
        Map<String, Object> stored = new java.util.HashMap<>(Map.of("year", -500, "ord", 1, "name", "", "pattern", "air", "replacement", "ar"));
        Map<String, Object> same = new java.util.HashMap<>(Map.of("year", -500L, "order", 1, "pattern", "air", "replacement", "ar", "name", ""));
        assertTrue(RuleDiff.changed(stored, same).isEmpty());
        Map<String, Object> edit = new java.util.HashMap<>(Map.of("year", -750, "replacement", "a"));
        Map<String, Object> ch = RuleDiff.changed(stored, edit);
        assertEquals(2, ch.size());
        assertEquals(-750L, ch.get("year"));
        assertEquals("a", ch.get("replacement"));
    }

    @Test
    void mergerSimulationCountsCollapsedForms() {
        List<String> start = List.of("tata", "kata", "tapa", "mama");
        List<Map<String, String>> steps = List.of(
                Map.of("1|t>k", "kaka", "2|a>o", "koko"),
                Map.of("1|t>k", "kaka", "2|a>o", "koko"),
                Map.of("1|t>k", "kapa", "2|a>o", "kopo"),
                Map.of("2|a>o", "momo"));
        List<int[]> r = Mergers.simulate(start, steps, List.of("1|t>k", "2|a>o"));
        // t>k: tata and kata (as kaka) are no longer different: one form lost; tapa -> kapa changes but stays distinct
        assertEquals(3, r.get(0)[0]);
        assertEquals(1, r.get(0)[1]);
        // a>o changes everything and loses nothing
        assertEquals(4, r.get(1)[0]);
        assertEquals(0, r.get(1)[1]);
    }
}
