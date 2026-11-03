package com.conlangs.web;

/** Pure: edit distance between two forms, as a fraction of the longer one (0 = identical, 1 = nothing in common). */
public final class Distance {
    private Distance() {}

    public static double normalized(String a, String b) {
        int[] x = a.codePoints().toArray(), y = b.codePoints().toArray();
        int n = Math.max(x.length, y.length);
        if (n == 0) return 0;
        int[] prev = new int[y.length + 1], cur = new int[y.length + 1];
        for (int j = 0; j <= y.length; j++) prev[j] = j;
        for (int i = 1; i <= x.length; i++) {
            cur[0] = i;
            for (int j = 1; j <= y.length; j++) {
                cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + (x[i - 1] == y[j - 1] ? 0 : 1));
            }
            int[] t = prev; prev = cur; cur = t;
        }
        return prev[y.length] / (double) n;
    }
}
