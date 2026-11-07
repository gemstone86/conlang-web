package com.hub;

import com.eonweather.core.DbGuard;
import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
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
        for (String app : new String[]{"rune", "weather"}) {
            r.addRedirectViewController("/" + app, "/" + app + "/");
            r.addViewController("/" + app + "/").setViewName("forward:/" + app + "/index.html");
        }
    }
}
