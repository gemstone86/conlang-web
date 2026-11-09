package com.conlangs.web;

import jakarta.servlet.http.HttpSession;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The Check, Etymology and Texts tabs. Reading works for anyone who may read the language (public ones too). */
@RestController
@RequestMapping("/rune/api")
public class ExtrasController {
    private final Auth auth;
    private final ProofreadService proofread;
    private final EtymologyService etymology;
    private final TextService texts;

    public ExtrasController(Auth auth, ProofreadService proofread, EtymologyService etymology, TextService texts) {
        this.auth = auth;
        this.proofread = proofread;
        this.etymology = etymology;
        this.texts = texts;
    }

    private static String str(Map<String, Object> b, String k) {
        Object v = b == null ? null : b.get(k);
        return v == null ? null : v.toString();
    }

    @GetMapping("/languages/{id}/check")
    public Map<String, Object> check(@PathVariable long id, HttpSession s) {
        return proofread.report(auth.viewerUid(s), id);
    }

    @GetMapping("/languages/{id}/etymology")
    public Map<String, Object> etymology(@PathVariable long id, @RequestParam("meaning") String meaning, HttpSession s) {
        return etymology.trace(auth.viewerUid(s), id, meaning);
    }

    @GetMapping("/languages/{id}/etymology/meanings")
    public List<String> meanings(@PathVariable long id, HttpSession s) {
        return etymology.meanings(auth.viewerUid(s), id);
    }

    @GetMapping("/languages/{id}/texts")
    public List<Map<String, Object>> texts(@PathVariable long id, HttpSession s) {
        return texts.list(auth.viewerUid(s), id);
    }

    /** {id (to change one), title, years ("500, 800"), body ("source | translation" per line), notes} */
    @PostMapping("/languages/{id}/texts")
    public Map<String, Object> saveText(@PathVariable long id, @RequestBody Map<String, Object> b, HttpSession s) {
        Long tid = b.get("id") == null || b.get("id").toString().isBlank() ? null : Long.valueOf(b.get("id").toString());
        return Map.of("id", texts.save(auth.requireUid(s), id, tid, str(b, "title"), str(b, "years"), str(b, "body"), str(b, "notes")));
    }

    @GetMapping("/texts/{tid}")
    public Map<String, Object> text(@PathVariable long tid, @RequestParam(value = "years", required = false) String years, HttpSession s) {
        return texts.render(auth.viewerUid(s), tid, years);
    }

    @DeleteMapping("/texts/{tid}")
    public Map<String, Object> deleteText(@PathVariable long tid, HttpSession s) {
        texts.delete(auth.requireUid(s), tid);
        return Map.of("ok", true);
    }
}
