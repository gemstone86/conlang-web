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
    private final FormGroups formGroups;
    private final SentenceService sentences;
    private final Store store;

    public ExtrasController(Auth auth, ProofreadService proofread, EtymologyService etymology, TextService texts, FormGroups formGroups,
                            SentenceService sentences, Store store) {
        this.store = store;
        this.formGroups = formGroups;
        this.sentences = sentences;
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
        Boolean inherit = b.get("inherit") == null ? null : Boolean.valueOf(b.get("inherit").toString());
        return Map.of("id", texts.save(auth.requireUid(s), id, tid, str(b, "title"), str(b, "years"), str(b, "body"), str(b, "notes"), inherit));
    }

    @GetMapping("/texts/{tid}")
    public Map<String, Object> text(@PathVariable long tid, @RequestParam(value = "years", required = false) String years,
                                    @RequestParam(value = "lang", required = false) Long lang, HttpSession s) {
        return texts.render(auth.viewerUid(s), tid, years, lang);
    }

    /** {language_id}: move the text to another language of the world. */
    @PostMapping("/texts/{tid}/move")
    public Map<String, Object> moveText(@PathVariable long tid, @RequestBody Map<String, Object> b, HttpSession s) {
        Object l = b == null ? null : b.get("language_id");
        if (l == null || l.toString().isBlank()) throw new ApiException(400, "Choose the language to move it to.");
        texts.move(auth.requireUid(s), tid, Long.parseLong(l.toString()));
        return Map.of("ok", true);
    }

    @DeleteMapping("/texts/{tid}")
    public Map<String, Object> deleteText(@PathVariable long tid, HttpSession s) {
        texts.delete(auth.requireUid(s), tid);
        return Map.of("ok", true);
    }

    /** The order the groups' endings go on in when stacked (plural-definite). */
    @GetMapping("/languages/{id}/form-groups")
    public Map<String, Object> formGroups(@PathVariable long id, HttpSession s) {
        return formGroups.list(auth.viewerUid(s), id);
    }

    /** {order: [group names, first = closest to the word]}; empty = use the parent language's order. */
    @SuppressWarnings("unchecked")
    @org.springframework.web.bind.annotation.PutMapping("/languages/{id}/form-groups")
    public Map<String, Object> saveFormGroups(@PathVariable long id, @RequestBody Map<String, Object> b, HttpSession s) {
        Object o = b == null ? null : b.get("order");
        List<String> order = new java.util.ArrayList<>();
        if (o instanceof List<?> l) for (Object x : l) if (x != null) order.add(x.toString());
        formGroups.save(auth.requireUid(s), id, order);
        return formGroups.list(auth.requireUid(s), id);
    }

    /** Every combination of endings of a word, built at a year (default: as late as the language goes). */
    @GetMapping("/languages/{id}/words/{wid}/paradigm")
    public Map<String, Object> paradigm(@PathVariable long id, @PathVariable long wid, @RequestParam(value = "year", required = false) Integer year, HttpSession s) {
        return sentences.paradigm(auth.viewerUid(s), id, wid, year);
    }

    /** What saving a derivation (seal + verb) as a word of its own would give: {gloss, pos, year, form, ...}. */
    @GetMapping("/languages/{id}/words/{wid}/derive")
    public Map<String, Object> derivePreview(@PathVariable long id, @PathVariable long wid, @RequestParam("label") String label, HttpSession s) {
        return sentences.derivedPreview(auth.viewerUid(s), id, wid, label);
    }

    /**
     * {label}: saves the derivation as a dictionary word of this language (through approval like any new word), linked to
     * the word it comes from. Sentences then use it, with its own forms. {gloss} may give it another meaning.
     */
    @PostMapping("/languages/{id}/words/{wid}/derive")
    public Map<String, Object> derive(@PathVariable long id, @PathVariable long wid, @RequestBody Map<String, Object> b, HttpSession s) {
        long uid = auth.requireUid(s);
        Map<String, Object> d = sentences.derivedPreview(uid, id, wid, str(b, "label"));
        String gloss = str(b, "gloss") == null || str(b, "gloss").isBlank() ? (String) d.get("gloss") : str(b, "gloss").trim();
        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("gloss", gloss);
        payload.put("pos", d.get("pos"));
        payload.put("form", d.get("form"));
        payload.put("year", d.get("year"));
        payload.put("notes", "Derived from '" + d.get("from_gloss") + "' (#" + wid + ") with '" + d.get("label") + "'");
        payload.put("derived_from", wid);
        payload.put("derived_label", d.get("label"));
        Map<String, Object> r = new java.util.LinkedHashMap<>(store.submit(uid, id, "word", "CREATE", null, payload));
        r.put("gloss", gloss);
        return r;
    }
}
