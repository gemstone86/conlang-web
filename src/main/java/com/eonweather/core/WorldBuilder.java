package com.eonweather.core;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/**
 * The world the app runs on: the world folder (world/regions/*.yaml and the other files) plus the
 * regions made in the app, which are stored in the database. A region made in the app with the
 * same name as one in world/regions replaces it.
 *
 * Without regions made in the app, the world folder is used as it is. Otherwise a copy is put
 * together in a temporary folder, because the engine reads regions from files.
 */
public final class WorldBuilder {
    private final File baseDir;
    private Path current;          // the temporary folder in use (null = baseDir itself)

    public WorldBuilder(File baseDir) { this.baseDir = baseDir; }

    public File baseDir() { return baseDir; }

    /** name → file of the regions in the world folder. */
    public Map<String, File> builtInRegions() {
        Map<String, File> out = new LinkedHashMap<>();
        File[] files = new File(baseDir, "regions").listFiles((d, n) -> n.endsWith(".yaml"));
        if (files == null) return out;
        Arrays.sort(files);
        for (File f : files) {
            try {
                String name = RegionYaml.nameOf(RegionYaml.read(f));
                if (name != null) out.put(name, f);
            } catch (RuntimeException e) {
                System.err.println("Could not read " + f.getName() + ": " + e.getMessage());
            }
        }
        return out;
    }

    /** Builds the world from the folder plus these regions (name → YAML). */
    public synchronized World build(Map<String, String> custom) {
        if (custom.isEmpty()) {
            cleanup(current);
            current = null;
            return new World(baseDir);
        }
        try {
            Path dir = Files.createTempDirectory("eon-world-");
            // the other world files (calendars, events, holy days, influx, magic storms…)
            File[] top = baseDir.listFiles(File::isFile);
            if (top != null) for (File f : top) Files.copy(f.toPath(), dir.resolve(f.getName()));
            Path regions = Files.createDirectory(dir.resolve("regions"));
            Set<String> replaced = custom.keySet();
            for (Map.Entry<String, File> e : builtInRegions().entrySet())
                if (!replaced.contains(e.getKey())) Files.copy(e.getValue().toPath(), regions.resolve(e.getValue().getName()));
            int i = 0;
            for (Map.Entry<String, String> e : custom.entrySet())
                Files.writeString(regions.resolve(String.format("app-%03d-%s.yaml", i++, slug(e.getKey()))), e.getValue(), StandardCharsets.UTF_8);
            World w = new World(dir.toFile());
            cleanup(current);
            current = dir;
            return w;
        } catch (IOException e) {
            throw new IllegalStateException("Could not put the world together: " + e.getMessage(), e);
        }
    }

    /** A file name for a region name: Drakbergen → Drakbergen, Östra kusten → Ostra-kusten. */
    public static String slug(String name) {
        String s = java.text.Normalizer.normalize(name, java.text.Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        s = s.replaceAll("[^A-Za-z0-9]+", "-").replaceAll("(^-|-$)", "");
        return s.isEmpty() ? "region" : s;
    }

    private static void cleanup(Path dir) {
        if (dir == null) return;
        try (var walk = Files.walk(dir)) {
            walk.sorted(Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
        } catch (IOException ignored) { }
    }
}
