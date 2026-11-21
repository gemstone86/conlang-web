package com.dawnofmankind.web;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Wires Dawn of Mankind into a Spring Boot app: the WebSocket at /dawn/ws and the page at /dawn/. */
@Configuration
@EnableWebSocket
public class DawnConfig implements WebSocketConfigurer, WebMvcConfigurer {
    private final RoomService rooms;

    public DawnConfig(RoomService rooms) {
        this.rooms = rooms;
    }

    @Bean
    public DawnSocketHandler dawnSocketHandler() {
        return new DawnSocketHandler(rooms);
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        // no allowed origins set: Spring then accepts only pages from this same site
        registry.addHandler(dawnSocketHandler(), "/dawn/ws");
    }

    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addRedirectViewController("/dawn", "/dawn/");
        registry.addViewController("/dawn/").setViewName("forward:/dawn/index.html");
    }
}
