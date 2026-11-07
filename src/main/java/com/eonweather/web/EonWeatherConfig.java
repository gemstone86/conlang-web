package com.eonweather.web;

import com.eonweather.core.Api;
import com.eonweather.core.DefaultMap;
import com.eonweather.core.Store;
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
    public Api eonApi(World eonWorld, Store eonStore, @Value("${app.registration:true}") boolean registration) {
        DefaultMap.install(eonStore, eonWorld); // the map shipped in src/main/resources/default-map
        return new Api(eonWorld, eonStore, registration);
    }
}
