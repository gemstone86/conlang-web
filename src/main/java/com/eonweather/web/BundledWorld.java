package com.eonweather.web;

import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/**
 * The world folder is also packed inside the jar (see pom.xml). When the app runs somewhere
 * without a world folder next to it — e.g. on Azure App Service, where only the jar is
 * deployed — the packed copy is unpacked to a temporary folder at startup. Every new jar
 * therefore brings its own up-to-date regions and events.
 */
final class BundledWorld {
    private BundledWorld() {}

    static File extract() throws IOException {
        PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
        Resource[] files = resolver.getResources("classpath*:world/**/*.yaml");
        if (files.length == 0)
            throw new IllegalStateException("No world folder found, and none packed in the jar");
        Path out = Files.createTempDirectory("eon-world");
        int n = 0;
        for (Resource res : files) {
            String rel = relativePath(res.getURL().toString());
            if (rel == null || rel.contains("..")) continue;
            Path target = out.resolve(rel).normalize();
            if (!target.startsWith(out)) continue;
            Files.createDirectories(target.getParent());
            try (InputStream in = res.getInputStream()) {
                Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
            }
            n++;
        }
        System.out.println("Unpacked " + n + " world files to " + out);
        return out.toFile();
    }

    /** "…!/world/regions/Drunok.yaml" or "…/classes/world/regions/Drunok.yaml" → "regions/Drunok.yaml" */
    static String relativePath(String url) {
        String u = java.net.URLDecoder.decode(url.replace("+", "%2B"), java.nio.charset.StandardCharsets.UTF_8);
        int i = u.indexOf("!/world/");
        if (i >= 0) return u.substring(i + "!/world/".length());
        i = u.lastIndexOf("/world/");
        return i >= 0 ? u.substring(i + "/world/".length()) : null;
    }
}
