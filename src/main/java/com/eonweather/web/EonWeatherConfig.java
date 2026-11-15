package com.eonweather.web;

import com.eonweather.core.Api;
import com.eonweather.core.DefaultMap;
import com.eonweather.core.Store;
import com.eonweather.core.WeatherImport;
import com.eonweather.core.World;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.sql.init.dependency.DependsOnDatabaseInitialization;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;
import java.io.File;

/**
 * The weather generator's part of the combined app. Spring only hosts it: the page is in
 * resources/static/weather, and every /weather/api request goes to {@link Api}, where all the logic lives.
 * The database (and its guard) and the login are shared with Root and Rune; see com.hub.
 */
@Configuration
public class EonWeatherConfig {

    @Bean
    public World eonWorld(@Value("${eon.world-dir}") String dir) throws java.io.IOException {
        File folder = new File(dir).getAbsoluteFile();
        // No world folder here (e.g. only the jar was deployed): use the copy packed in the jar.
        if (!new File(folder, "regions").isDirectory()) folder = BundledWorld.extract();
        return new World(folder);
    }

    /** Waits for schema.sql, which creates the shared users table that the weather tables refer to. */
    @Bean
    @DependsOnDatabaseInitialization
    public Store eonStore(DataSource dataSource) {
        return new Store(dataSource);
    }

    @Bean
    public Api eonApi(World eonWorld, Store eonStore, DataSource dataSource,
                      @Value("${app.registration:true}") boolean registration,
                      @Value("${spring.datasource.url:}") String dbUrl,
                      @Value("${eon.import:auto}") String importMode,
                      @Value("${eon.import-from:}") String importFrom,
                      @Value("${app.version:dev}") String appVersion) {
        Api.VERSION = appVersion;
        Api api = new Api(eonWorld, eonStore, registration);
        importOldDatabase(dataSource, dbUrl, importMode, importFrom);
        DefaultMap.install(eonStore, eonWorld); // the map shipped in src/main/resources/default-map
        return api;
    }

    /**
     * Moving from the separate weather generator: its database (eonweather.mv.db, or EON_IMPORT_FROM) is read
     * once into this one, accounts included (see {@link WeatherImport}). It runs before the standard map is
     * installed, so that is then brought up to date on top of the imported one, as after any release.
     * EON_IMPORT: auto (default: when there is an old file and no weather data of the users' own here),
     * off, or force (replace the weather data here).
     */
    static void importOldDatabase(DataSource ds, String dbUrl, String mode, String from) {
        mode = mode == null ? "auto" : mode.trim().toLowerCase(java.util.Locale.ROOT);
        if (mode.equals("off")) return;
        java.nio.file.Path old = null;
        if (from != null && !from.isBlank()) old = java.nio.file.Path.of(from.trim());
        else {
            // next to this database's own file (on Azure: /home/data/hub.mv.db and /home/data/eonweather.mv.db)
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("^jdbc:h2:(?:file:)?([^;]+)").matcher(dbUrl == null ? "" : dbUrl);
            if (m.find() && !m.group(1).startsWith("mem:")) {
                java.nio.file.Path dir = java.nio.file.Path.of(m.group(1)).toAbsolutePath().getParent();
                if (dir != null) old = dir.resolve("eonweather");
            }
        }
        if (old == null) return;
        try {
            java.util.List<String> admins = java.util.Arrays.stream((System.getenv("EON_ADMINS") == null || System.getenv("EON_ADMINS").isBlank()
                    ? Api.DEFAULT_ADMINS : System.getenv("EON_ADMINS")).split(",")).map(String::trim).filter(a -> !a.isEmpty()).toList();
            WeatherImport.Result r = WeatherImport.run(ds, old, mode.equals("force"), admins);
            if (r.imported()) System.out.println("Weather import: " + r.message() + ": " + r.rows() + "; accounts created "
                    + r.accountsCreated() + ", matched " + r.accountsMatched());
            else System.out.println("Weather import: skipped, " + r.message());
        } catch (Exception e) {
            // the app still starts (with the weather data it has); nothing was changed
            System.err.println("Weather import FAILED (nothing changed): " + e);
        }
    }
}
