package com.eonweather.core;

/** Detects image type and pixel size from the file header (PNG, JPEG, GIF, WebP). */
public record ImageInfo(String type, int width, int height) {

    public static ImageInfo detect(byte[] b) {
        if (b == null || b.length < 30) return null;
        // SVG (only accepted for symbols; served with a sandboxing CSP)
        String head = new String(b, 0, Math.min(b.length, 1024), java.nio.charset.StandardCharsets.UTF_8).stripLeading();
        if (head.startsWith("\uFEFF")) head = head.substring(1);
        if ((head.startsWith("<svg") || head.startsWith("<?xml")) && head.contains("<svg"))
            return new ImageInfo("image/svg+xml", 0, 0);
        // PNG
        if ((b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G')
            return new ImageInfo("image/png", be32(b, 16), be32(b, 20));
        // GIF
        if (b[0] == 'G' && b[1] == 'I' && b[2] == 'F')
            return new ImageInfo("image/gif", le16(b, 6), le16(b, 8));
        // WebP
        if (b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') {
            String chunk = new String(b, 12, 4, java.nio.charset.StandardCharsets.US_ASCII);
            switch (chunk) {
                case "VP8 " -> { return new ImageInfo("image/webp", le16(b, 26) & 0x3FFF, le16(b, 28) & 0x3FFF); }
                case "VP8L" -> {
                    int bits = (b[21] & 0xFF) | (b[22] & 0xFF) << 8 | (b[23] & 0xFF) << 16 | (b[24] & 0xFF) << 24;
                    return new ImageInfo("image/webp", (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1);
                }
                case "VP8X" -> { return new ImageInfo("image/webp", le24(b, 24) + 1, le24(b, 27) + 1); }
                default -> { return null; }
            }
        }
        // JPEG: walk the segments to the first SOFn marker
        if ((b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8) {
            int i = 2;
            while (i + 9 < b.length) {
                if ((b[i] & 0xFF) != 0xFF) { i++; continue; }
                int marker = b[i + 1] & 0xFF;
                if (marker == 0xFF) { i++; continue; }
                if (marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
                int len = ((b[i + 2] & 0xFF) << 8) | (b[i + 3] & 0xFF);
                boolean sof = marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC;
                if (sof) {
                    int h = ((b[i + 5] & 0xFF) << 8) | (b[i + 6] & 0xFF);
                    int w = ((b[i + 7] & 0xFF) << 8) | (b[i + 8] & 0xFF);
                    return new ImageInfo("image/jpeg", w, h);
                }
                i += 2 + len;
            }
        }
        return null;
    }

    private static int be32(byte[] b, int o) {
        return (b[o] & 0xFF) << 24 | (b[o + 1] & 0xFF) << 16 | (b[o + 2] & 0xFF) << 8 | (b[o + 3] & 0xFF);
    }

    private static int le16(byte[] b, int o) { return (b[o] & 0xFF) | (b[o + 1] & 0xFF) << 8; }

    private static int le24(byte[] b, int o) { return (b[o] & 0xFF) | (b[o + 1] & 0xFF) << 8 | (b[o + 2] & 0xFF) << 16; }
}
