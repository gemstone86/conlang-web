package com.dawnofmankind.web;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Optional;

/**
 * Who is asking, if the host app has a login. Players who are logged in get their account name; guests type one.
 * Without a bean of this type everyone is a guest. conlang-web provides one that reads its shared login (see MERGING.md).
 */
public interface DawnIdentity {
    Optional<String> displayName(HttpServletRequest request);
}
