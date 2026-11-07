package com.conlangs.web;

import jakarta.servlet.http.HttpSession;
import java.time.LocalDate;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** Admin only: all of Root and Rune as one file ({@link FullExport}), and reading such a file back ({@link FullImport}). */
@RestController
@RequestMapping("/rune/api/admin")
public class BackupController {
    private final Auth auth;
    private final FullExport exporter;
    private final FullImport importer;
    private final AppLog applog;

    public BackupController(Auth auth, FullExport exporter, FullImport importer, AppLog applog) {
        this.auth = auth;
        this.exporter = exporter;
        this.importer = importer;
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

    @PostMapping("/import-all")
    public Map<String, Object> importAll(@RequestParam("file") MultipartFile file,
                                         @RequestParam(value = "replace", defaultValue = "false") boolean replace,
                                         HttpSession s) throws Exception {
        long uid = auth.requireAdmin(s);
        Map<String, Object> res = importer.importAll(file.getInputStream(), replace);
        @SuppressWarnings("unchecked") Map<String, ?> counts = (Map<String, ?>) res.get("counts");
        applog.info("import", uid, "Imported everything from Root and Rune " + res.get("from") + " (exported " + res.get("exported") + "): "
                + FullExport.summary(counts), "accounts created: " + res.get("usersCreated") + "\naccounts matched: " + res.get("usersMatched")
                + "\nwarnings: " + res.get("warnings"));
        return res;
    }
}
