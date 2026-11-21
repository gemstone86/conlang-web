package com.dawnofmankind.core;

/** A move the rules don't allow. The message is shown to the player. */
public class GameException extends RuntimeException {
    public GameException(String message) {
        super(message);
    }
}
