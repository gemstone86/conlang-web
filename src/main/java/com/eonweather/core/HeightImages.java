package com.eonweather.core;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.awt.image.ColorModel;
import java.awt.image.IndexColorModel;
import java.awt.image.Raster;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;

/**
 * Height maps and height suggestions as pixels: decoding to one byte per pixel and back to PNG.
 *
 * A height map is read the way the page reads it: the grey value, or the red channel of a colour
 * image. A suggestion's patch is a grey + alpha PNG: grey = the suggested height, alpha = which
 * pixels the suggestion changes (opaque = changed).
 */
public final class HeightImages {
    private HeightImages() {}

    /** One byte per pixel (0–255), row by row. */
    public record Grey(int w, int h, byte[] data) {
        public int at(int x, int y) { return data[y * w + x] & 255; }
    }

    /** A suggestion's patch: the new heights and which of them are changed. */
    public record Patch(int w, int h, byte[] values, boolean[] mask) {}

    static {
        System.setProperty("java.awt.headless", "true");
        ImageIO.setUseCache(false);
    }

    private static BufferedImage read(byte[] bytes) {
        try {
            BufferedImage img = ImageIO.read(new ByteArrayInputStream(bytes));
            if (img == null) throw new ApiException(400, "Not an image the server can read");
            return img;
        } catch (IOException e) {
            throw new ApiException(400, "Not an image the server can read: " + e.getMessage());
        }
    }

    /** True for plain grey images (with or without alpha), whose raster holds the grey values directly. */
    private static boolean plainGrey(BufferedImage img) {
        ColorModel cm = img.getColorModel();
        return !(cm instanceof IndexColorModel) && img.getRaster().getNumBands() <= 2
                && cm.getColorSpace().getNumComponents() == 1;
    }

    public static Grey decodeGrey(byte[] bytes) {
        BufferedImage img = read(bytes);
        int w = img.getWidth(), h = img.getHeight();
        byte[] out = new byte[w * h];
        if (plainGrey(img)) {
            // the raster's own numbers (getRGB would put a gamma curve on them)
            Raster r = img.getRaster();
            int[] row = new int[w];
            for (int y = 0; y < h; y++) {
                r.getSamples(0, y, w, 1, 0, row);
                int bits = r.getSampleModel().getSampleSize(0);
                for (int x = 0; x < w; x++) out[y * w + x] = (byte) (bits == 16 ? row[x] >> 8 : row[x]);
            }
        } else {
            int[] row = new int[w];
            for (int y = 0; y < h; y++) {
                img.getRGB(0, y, w, 1, row, 0, w);
                for (int x = 0; x < w; x++) out[y * w + x] = (byte) (row[x] >> 16);
            }
        }
        return new Grey(w, h, out);
    }

    public static Patch decodePatch(byte[] bytes) {
        BufferedImage img = read(bytes);
        int w = img.getWidth(), h = img.getHeight();
        byte[] vals = new byte[w * h];
        boolean[] mask = new boolean[w * h];
        Raster r = img.getRaster();
        if (plainGrey(img)) {
            int bands = r.getNumBands();
            int[] v = new int[w], a = new int[w];
            for (int y = 0; y < h; y++) {
                r.getSamples(0, y, w, 1, 0, v);
                if (bands > 1) r.getSamples(0, y, w, 1, 1, a);
                for (int x = 0; x < w; x++) {
                    vals[y * w + x] = (byte) v[x];
                    mask[y * w + x] = bands < 2 || a[x] >= 128;
                }
            }
        } else {
            int[] row = new int[w];
            boolean alpha = img.getColorModel().hasAlpha();
            for (int y = 0; y < h; y++) {
                img.getRGB(0, y, w, 1, row, 0, w);
                for (int x = 0; x < w; x++) {
                    vals[y * w + x] = (byte) (row[x] >> 16);
                    mask[y * w + x] = !alpha || (row[x] >>> 24) >= 128;
                }
            }
        }
        return new Patch(w, h, vals, mask);
    }

    /** An 8-bit grey PNG. */
    public static byte[] encodeGrey(int w, int h, byte[] data) {
        BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_BYTE_GRAY);
        img.getRaster().setDataElements(0, 0, w, h, data);
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(1024, w * h / 4));
        try {
            if (!ImageIO.write(img, "png", out)) throw new IllegalStateException("No PNG writer");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        return out.toByteArray();
    }

    /** The pixels of a rectangle of a grey image. */
    public static byte[] crop(Grey g, int x0, int y0, int w, int h) {
        byte[] out = new byte[w * h];
        for (int y = 0; y < h; y++) System.arraycopy(g.data(), (y0 + y) * g.w() + x0, out, y * w, w);
        return out;
    }
}
