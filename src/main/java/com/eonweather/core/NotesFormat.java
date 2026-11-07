package com.eonweather.core;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads and writes the desktop app's comments / campaign files
 * (src/comments/comments.yaml and src/comments/campaigns/*.yaml), so old notes can be
 * imported and notes can be exported back in the same format.
 *
 * Same rules as the desktop CampaignLoader: keys like "2977-7-1", single-line values
 * written raw, multi-line values as an indented "|" block. Duplicate keys are merged.
 */
public final class NotesFormat {
    private static final Pattern LINE = Pattern.compile("^\"?([\\w\\-]+)\"?:\\s*(.*)$");
    private static final Pattern DATE_KEY = Pattern.compile("^-?\\d{1,6}-\\d{1,2}-\\d{1,2}$");

    private NotesFormat() {}

    public static LinkedHashMap<String, String> parse(String text) {
        LinkedHashMap<String, String> notes = new LinkedHashMap<>();
        String currentKey = null;
        StringBuilder currentVal = new StringBuilder();
        for (String line : text.replace("\r\n", "\n").replace('\r', '\n').split("\n", -1)) {
            if (line.startsWith("﻿")) line = line.substring(1);
            if (line.startsWith("  ") || line.startsWith("\t")) {
                if (currentKey != null) {
                    if (currentVal.length() > 0) currentVal.append("\n");
                    currentVal.append(line.stripLeading());
                }
                continue;
            }
            if (currentKey != null) {
                put(notes, currentKey, currentVal.toString().trim());
                currentKey = null;
                currentVal.setLength(0);
            }
            line = line.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            Matcher m = LINE.matcher(line);
            if (m.matches()) {
                currentKey = m.group(1).trim();
                String val = m.group(2).trim();
                if (!val.equals("|")) currentVal.append(val);
            }
        }
        if (currentKey != null) put(notes, currentKey, currentVal.toString().trim());
        return notes;
    }

    private static void put(Map<String, String> notes, String key, String val) {
        if (val.isEmpty() || !DATE_KEY.matcher(key).matches()) return;
        String existing = notes.get(key);
        if (existing == null || existing.equals(val)) notes.put(key, val);
        else if (!existing.contains(val)) notes.put(key, existing + "\n" + val);
    }

    public static String write(Map<String, String> notes) {
        List<String> keys = new ArrayList<>(notes.keySet());
        keys.sort(NotesFormat::compareDateKeys);
        StringBuilder sb = new StringBuilder();
        for (String k : keys) {
            String val = notes.get(k) == null ? "" : notes.get(k).trim();
            if (val.isEmpty()) continue;
            if (val.contains("\n")) {
                sb.append('"').append(k).append("\": |\n");
                for (String ln : val.split("\n", -1)) sb.append("  ").append(ln).append('\n');
            } else {
                sb.append('"').append(k).append("\": ").append(val).append('\n');
            }
        }
        return sb.toString();
    }

    public static boolean isDateKey(String key) { return key != null && DATE_KEY.matcher(key).matches(); }

    /** Orders "2977-7-1" style keys by date rather than alphabetically. */
    public static int compareDateKeys(String a, String b) {
        try {
            int[] x = split(a), y = split(b);
            for (int i = 0; i < 3; i++) if (x[i] != y[i]) return Integer.compare(x[i], y[i]);
            return 0;
        } catch (RuntimeException e) {
            return a.compareTo(b);
        }
    }

    private static int[] split(String k) {
        boolean neg = k.startsWith("-");
        String[] p = (neg ? k.substring(1) : k).split("-");
        return new int[]{(neg ? -1 : 1) * Integer.parseInt(p[0]), Integer.parseInt(p[1]), Integer.parseInt(p[2])};
    }
}
