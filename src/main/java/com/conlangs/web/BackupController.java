package com.conlangs.web;

import jakarta.servlet.http.HttpSession;
import java.time.LocalDate;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Admin only: all of Root and Rune as one file ({@link FullExport}), for moving to the combined app
 * (Root and Rune + Weather generator), where Import everything reads it.
 */
@RestController
@RequestMapping("/api/admin")
public class BackupController {
    private final Auth auth;
    private final FullExport exporter;
    private final AppLog applog;

    public BackupController(Auth auth, FullExport exporter, AppLog applog) {
        this.auth = auth;
        this.exporter = exporter;
        this.applog = applog;
    }

    @GetMapping("/export-all")
    public ResponseEntity<byte[]> exportAll(HttpSession s) throws Exception {
        long uid = auth.requireAdmin(s);
        byte[] body = exporter.export();
        applog.info("export", uid, "Exported everything (" + (body.length / 1024) + " KB)");
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"root-and-rune-export-" + LocalDate.now() + ".json\"")
                .contentType(MediaType.APPLICATION_JSON)
                .body(body);
    }
}
