package com.conlangs.web;

import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

public class ApiException extends RuntimeException {
    private final int status;

    public ApiException(int status, String message) {
        super(message);
        this.status = status;
    }

    public int status() {
        return status;
    }

    @RestControllerAdvice
    public static class Handler {
        private final AppLog applog;

        public Handler(AppLog applog) {
            this.applog = applog;
        }

        private static String where(HttpServletRequest req) {
            return req.getMethod() + " " + req.getRequestURI();
        }

        private static ResponseEntity<Map<String, Object>> body(int status, String message, Long logId) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("error", message);
            if (logId != null && logId > 0) m.put("logId", logId);
            return ResponseEntity.status(status).body(m);
        }

        @ExceptionHandler(ApiException.class)
        public ResponseEntity<Map<String, Object>> api(ApiException e, HttpServletRequest req) {
            if (e.status() != 401) applog.warn("api", AppLog.uid(req.getSession(false)), where(req), e.status(), e.getMessage());
            return body(e.status(), e.getMessage(), null);
        }

        @ExceptionHandler(DataIntegrityViolationException.class)
        public ResponseEntity<Map<String, Object>> integrity(DataIntegrityViolationException e, HttpServletRequest req) {
            Throwable root = e.getMostSpecificCause();
            applog.warn("api", AppLog.uid(req.getSession(false)), where(req), 409, "Database constraint: " + root.getMessage());
            return body(409, "That conflicts with existing data.", null);
        }

        @ExceptionHandler(Exception.class)
        public ResponseEntity<Map<String, Object>> other(Exception e, HttpServletRequest req) {
            if (e instanceof ErrorResponse er) {
                int st = er.getStatusCode().value();
                if (st != 404) applog.warn("api", AppLog.uid(req.getSession(false)), where(req), st, e.getMessage());
                return body(st, st == 404 ? "Not found." : "Bad request: " + e.getMessage(), null);
            }
            if (e instanceof HttpMessageNotReadableException || e instanceof org.springframework.beans.TypeMismatchException) {
                applog.warn("api", AppLog.uid(req.getSession(false)), where(req), 400, "Unreadable request: " + e.getMessage());
                return body(400, "That request could not be read.", null);
            }
            if (e instanceof MaxUploadSizeExceededException) {
                applog.warn("api", AppLog.uid(req.getSession(false)), where(req), 413, "Upload too large");
                return body(413, "That file is too large.", null);
            }
            long id = applog.error("system", AppLog.uid(req.getSession(false)), where(req), 500, e.getClass().getSimpleName() + ": " + e.getMessage(), e);
            return body(500, "Internal error" + (id > 0 ? " (log #" + id + ")" : "") + ": " + e.getClass().getSimpleName() + (e.getMessage() == null ? "" : " - " + e.getMessage()), id);
        }
    }
}
