package com.hub;

import com.eonweather.core.DbGuard;
import com.zaxxer.hikari.HikariDataSource;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import javax.sql.DataSource;
import tools.jackson.core.JsonGenerator;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.ValueSerializer;
import tools.jackson.databind.module.SimpleModule;
import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.jdbc.autoconfigure.DataSourceProperties;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class HubConfig implements WebMvcConfigurer {
    private DbGuard dbGuard;

    /**
     * The one database both apps use. A built-in H2 file is first checked by {@link DbGuard}: it waits for
     * an older copy of the app to hand the file over, and repairs a corrupted file — before anything
     * (including Root and Rune's schema.sql) opens it.
     */
    @Bean
    public DataSource dataSource(DataSourceProperties props) {
        dbGuard = DbGuard.prepare(props.getUrl(), props.getUsername(), props.getPassword());
        return props.initializeDataSourceBuilder().type(HikariDataSource.class).build();
    }

    /**
     * Keeps the JSON the app reads and writes exactly as it was under Jackson 2 (Spring Boot 3): java.util.Date and
     * java.sql.Timestamp as "2023-11-14T22:13:20.123+00:00" (Jackson 3 writes "...123Z"), property order as declared,
     * no failure on trailing text after a JSON value or on null for a primitive.
     */
    @Bean
    public JsonMapperBuilderCustomizer jackson2CompatibleJson() {
        DateTimeFormatter iso = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSxxx").withZone(ZoneOffset.UTC);
        SimpleModule dates = new SimpleModule("legacy-dates");
        dates.addSerializer(java.util.Date.class, new ValueSerializer<java.util.Date>() {
            @Override
            public void serialize(java.util.Date d, JsonGenerator g, SerializationContext ctxt) {
                g.writeString(iso.format(Instant.ofEpochMilli(d.getTime())));
            }
        });
        return b -> b.addModule(dates)
                .disable(MapperFeature.SORT_PROPERTIES_ALPHABETICALLY)
                .disable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                .disable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES);
    }

    /** Once the app runs: the database file's heartbeat (hand-over to a newer copy) and backups. */
    @EventListener(ApplicationReadyEvent.class)
    public void started(ApplicationReadyEvent e) {
        if (dbGuard == null) return;
        ConfigurableApplicationContext ctx = e.getApplicationContext();
        dbGuard.started(() -> System.exit(SpringApplication.exit(ctx, () -> 0)));
    }

    /** /rune and /weather open each app's page (its files use relative paths, so the trailing slash matters). */
    @Override
    public void addViewControllers(ViewControllerRegistry r) {
        for (String app : new String[]{"rune", "weather", "admin"}) {
            r.addRedirectViewController("/" + app, "/" + app + "/");
            r.addViewController("/" + app + "/").setViewName("forward:/" + app + "/index.html");
        }
    }
}
