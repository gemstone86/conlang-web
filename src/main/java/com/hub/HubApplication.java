package com.hub;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * One app, three parts that share a database, a login and a session:
 * <ul>
 *   <li>{@code /}          the start page (log in, then pick an app) — {@link AuthController} at /api/auth</li>
 *   <li>{@code /rune/}     Root and Rune, the conlang editor — com.conlangs.web, API at /rune/api</li>
 *   <li>{@code /weather/}  the Eon weather generator — com.eonweather, API at /weather/api</li>
 * </ul>
 */
@SpringBootApplication(scanBasePackages = {"com.hub", "com.conlangs.web", "com.eonweather.web"})
public class HubApplication {
    public static void main(String[] args) {
        SpringApplication.run(HubApplication.class, args);
    }
}
