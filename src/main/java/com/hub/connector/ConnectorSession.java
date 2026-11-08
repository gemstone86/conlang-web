package com.hub.connector;

import jakarta.servlet.ServletContext;
import jakarta.servlet.http.HttpSession;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Map;

/**
 * A session that is logged in as the connector key's account, so the tools can call the apps' own
 * endpoints, with all their access checks, exactly as that account would. Lives for one tool call.
 */
final class ConnectorSession implements HttpSession {
    private final Map<String, Object> attrs = new HashMap<>();
    private final long created = System.currentTimeMillis();

    ConnectorSession(long uid) {
        attrs.put("uid", uid);
    }

    @Override public long getCreationTime() { return created; }
    @Override public String getId() { return "connector"; }
    @Override public long getLastAccessedTime() { return created; }
    @Override public ServletContext getServletContext() { return null; }
    @Override public void setMaxInactiveInterval(int interval) { }
    @Override public int getMaxInactiveInterval() { return 0; }
    @Override public Object getAttribute(String name) { return attrs.get(name); }
    @Override public Enumeration<String> getAttributeNames() { return Collections.enumeration(attrs.keySet()); }
    @Override public void setAttribute(String name, Object value) { attrs.put(name, value); }
    @Override public void removeAttribute(String name) { attrs.remove(name); }
    @Override public void invalidate() { attrs.clear(); }
    @Override public boolean isNew() { return false; }
}
