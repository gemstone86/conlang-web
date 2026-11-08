package com.conlangs.web;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Tags on sound changes ("vowel shift, experimental") and switching them off. A tag switched off in a
 * language is off for that language's sound changes and those of all its branches; such changes are left
 * out wherever words are evolved.
 */
public final class RuleTags {
    private RuleTags() {}

    public static final int MAX_TAG = 40;

    /** The tags in a comma-separated text: trimmed, without empties or repeats (any letter case), as first written. */
    public static List<String> parse(String text) {
        List<String> out = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        if (text == null) return out;
        for (String t : text.split(",")) {
            String tag = t.trim().replaceAll("\\s+", " ");
            if (tag.isEmpty()) continue;
            if (tag.length() > MAX_TAG) throw new ApiException(400, "A tag can be at most " + MAX_TAG + " characters: " + tag);
            if (seen.add(tag.toLowerCase(Locale.ROOT))) out.add(tag);
        }
        return out;
    }

    /** The stored form of a tag text ("a, b"), or null for none. */
    public static String normalize(Object text) {
        List<String> tags = parse(text == null ? null : text.toString());
        String joined = String.join(", ", tags);
        if (joined.length() > 400) throw new ApiException(400, "Too many tags (at most 400 characters).");
        return tags.isEmpty() ? null : joined;
    }

    public static Set<String> lower(String text) {
        Set<String> out = new LinkedHashSet<>();
        for (String t : parse(text)) out.add(t.toLowerCase(Locale.ROOT));
        return out;
    }

    /** The first of a rule's tags that is switched off (offByTag: tag → where it was switched off), or null. */
    public static String offTag(String ruleTags, Map<String, String> offByTag) {
        if (ruleTags == null || offByTag.isEmpty()) return null;
        for (String t : parse(ruleTags)) if (offByTag.containsKey(t.toLowerCase(Locale.ROOT))) return t;
        return null;
    }

    /**
     * For every language in a world: the tags switched off for its sound changes (lowercase), each with the
     * name of the language where it was switched off (itself or an ancestor; the nearest wins).
     */
    public static Map<Long, Map<String, String>> effectiveOff(Db db, long worldId) {
        Map<Long, Map<String, Object>> langs = new HashMap<>();
        for (Map<String, Object> l : db.rows("select id, name, parent_id, off_tags from languages where world_id=?", worldId))
            langs.put(Db.num(l.get("id")), l);
        Map<Long, Map<String, String>> out = new HashMap<>();
        for (long id : langs.keySet()) {
            Map<String, String> off = new LinkedHashMap<>();
            Long cur = id;
            for (int depth = 0; cur != null && depth < 100; depth++) {
                Map<String, Object> l = langs.get(cur);
                if (l == null) break;
                for (String t : lower((String) l.get("off_tags"))) off.putIfAbsent(t, (String) l.get("name"));
                cur = l.get("parent_id") == null ? null : Db.num(l.get("parent_id"));
            }
            out.put(id, off);
        }
        return out;
    }
}
