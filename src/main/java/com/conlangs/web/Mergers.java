package com.conlangs.web;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Pure: replays sound changes over a list of words and counts how many distinct forms each change collapses. */
public final class Mergers {
    private Mergers() {}

    /**
     * start: the form of every word when the language began. steps.get(i) maps a rule key to the form word i has after that rule
     * (words the rule did not change have no entry). keys: the rule keys in the order they apply.
     * Returns, per key, {words changed, distinct forms lost}.
     */
    public static List<int[]> simulate(List<String> start, List<Map<String, String>> steps, List<String> keys) {
        Map<String, Integer> cnt = new HashMap<>();
        for (String f : start) cnt.merge(f, 1, Integer::sum);
        List<String> cur = new ArrayList<>(start);
        List<int[]> out = new ArrayList<>();
        for (String key : keys) {
            int before = cnt.size(), changed = 0;
            for (int i = 0; i < cur.size(); i++) {
                String nf = steps.get(i).get(key);
                if (nf == null || nf.equals(cur.get(i))) continue;
                String old = cur.get(i);
                if (cnt.merge(old, -1, Integer::sum) == 0) cnt.remove(old);
                cnt.merge(nf, 1, Integer::sum);
                cur.set(i, nf);
                changed++;
            }
            out.add(new int[]{changed, before - cnt.size()});
        }
        return out;
    }
}
