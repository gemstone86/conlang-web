package com.eonweather.core;

/** An error with an HTTP status and a message safe to show to the user. */
public class ApiException extends RuntimeException {
    public final int status;

    public ApiException(int status, String message) {
        super(message);
        this.status = status;
    }
}
