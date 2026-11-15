package com.conlangs.web;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/** Taking the old ending off a word before an affix is added (a form rule's "remove from the end first"). */
class FormMathStripTest {

    private static final Pattern ENDINGS = Pattern.compile("(aną|ōną|ą|az)$");

    @Test
    void takesTheOldEndingOffBeforeTheAffix() {
        assertEquals("ēþmijida", FormMath.attach(FormMath.strip("ēþmijaną", ENDINGS, false), "suffix", "ida", false, "aeiou"));
        assertEquals("atgangida", FormMath.attach(FormMath.strip("atganganą", ENDINGS, false), "suffix", "ida", false, "aeiou"));
        assertEquals("þeudaz", FormMath.attach(FormMath.strip("þeudą", ENDINGS, false), "suffix", "az", false, "aeiou"));
    }

    @Test
    void onlyAMatchAtTheEdgeCounts() {
        assertEquals("ganga", FormMath.strip("ganga", ENDINGS, false), "nothing matches: unchanged");
        assertEquals("azga", FormMath.strip("azga", Pattern.compile("az"), false), "a match in the middle is left alone");
        assertEquals("gaaz", FormMath.strip("gaazaz", Pattern.compile("az"), false), "the one at the end goes");
        assertEquals("ga", FormMath.strip("gaaz", Pattern.compile("az"), false));
        assertEquals("az", FormMath.strip("az", Pattern.compile("az"), false), "never the whole word");
    }

    @Test
    void aPrefixLosesItsStart() {
        assertEquals("gang", FormMath.strip("atgang", Pattern.compile("^at"), true));
        assertEquals("atgang", FormMath.strip("atgang", Pattern.compile("gang$"), true), "a prefix only loses a match at the start");
        assertEquals("atgang", FormMath.strip("atgang", null, false), "no pattern: unchanged");
    }
}
