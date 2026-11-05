package com.conlangs.web;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Checks that the language tree above a language can actually pass words down to it. A word flows from a language to a
 * branch only if the word existed at the branch's split year, and through every language in between, so each split year
 * must be the same as or later than the split year of the language it splits from. Pure Java, no Spring.
 */
public final class TreeCheck {
    private TreeCheck() {}

    public record Node(long id, String name, Long parentId, Integer splitYear) {}

    /** lineage: the language first, then its parent, grandparent and so on up to the root. */
    public record Result(List<String> lineage, List<String> problems) {}

    public static Result check(long langId, List<Node> nodes) {
        Map<Long, Node> by = new HashMap<>();
        for (Node n : nodes) by.put(n.id(), n);
        List<String> lineage = new ArrayList<>();
        List<String> problems = new ArrayList<>();
        Set<Long> seen = new HashSet<>();
        Node cur = by.get(langId);
        while (cur != null) {
            if (!seen.add(cur.id())) {
                problems.add("The language tree loops back on " + cur.name() + ".");
                break;
            }
            lineage.add(cur.name());
            if (cur.parentId() == null) break;
            Node parent = by.get(cur.parentId());
            if (parent == null) {
                problems.add(cur.name() + " has a parent language that no longer exists.");
                break;
            }
            if (cur.splitYear() == null) {
                problems.add(cur.name() + " has no split year, so it receives no words from " + parent.name()
                        + " or from any language above it. Set a split year in Settings.");
            } else if (parent.parentId() != null && parent.splitYear() != null && cur.splitYear() < parent.splitYear()) {
                Node gp = by.get(parent.parentId());
                String gpName = gp == null ? "its parent" : gp.name();
                problems.add(cur.name() + " splits from " + parent.name() + " at " + cur.splitYear() + ", but " + parent.name()
                        + " itself only splits from " + gpName + " at " + parent.splitYear() + ", so words from " + gpName
                        + " and earlier cannot reach " + cur.name() + ". Make the split year of " + cur.name() + " " + parent.splitYear()
                        + " or later, or the split year of " + parent.name() + " " + cur.splitYear() + " or earlier.");
            }
            cur = parent;
        }
        return new Result(lineage, problems);
    }
}
