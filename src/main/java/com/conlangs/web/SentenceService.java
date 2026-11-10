package com.conlangs.web;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/** Builds interlinear sentences from parenthesis input, using each word's form in the language at a given year. */
@Service
public class SentenceService {
    private static final Pattern ID = Pattern.compile("#(\\d+)\\s*$");

    private final Db db;
    private final Access access;
    private final EvolverFactory evolvers;

    public SentenceService(Db db, Access access, EvolverFactory evolvers) {
        this.db = db;
        this.access = access;
        this.evolvers = evolvers;
    }

    public List<Map<String, Object>> list(long uid, long langId) {
        access.need(uid, langId, Access.VIEWER);
        List<Map<String, Object>> out = new ArrayList<>();
        Ctx ctx = null;
        for (Map<String, Object> s : db.rows("select * from sentences where language_id=? order by coalesce(group_no, 2147483647), coalesce(sub_no, 0), id", langId)) {
            if (ctx == null) ctx = new Ctx(langId);
            Map<String, Object> m = new LinkedHashMap<>(s);
            m.put("built", build(ctx, (String) s.get("source"), ((Number) s.get("year")).intValue()));
            out.add(m);
        }
        return out;
    }

    public Map<String, Object> preview(long uid, long langId, String source, int year) {
        access.need(uid, langId, Access.VIEWER);
        return build(new Ctx(langId), source, year);
    }

    public long save(long uid, long langId, String source, int year, String translation, String notes, Integer group, Integer sub, String kind) {
        access.need(uid, langId, Access.EDITOR);
        if (source == null || source.isBlank()) throw new ApiException(400, "Write a sentence first.");
        if (group == null) group = (int) db.count("select coalesce(max(group_no), 0) from sentences where language_id=?", langId) + 1;
        if (sub == null) sub = (int) db.count("select coalesce(max(sub_no), 0) from sentences where language_id=? and group_no=?", langId, group) + 1;
        return db.insert("insert into sentences (language_id, year, source, translation, notes, group_no, sub_no, kind) values (?,?,?,?,?,?,?,?)",
                langId, year, source.trim(), translation, notes, group, sub, kind);
    }

    public void update(long uid, long id, String source, int year, String translation, String notes, Integer group, Integer sub, String kind) {
        Map<String, Object> s = db.one("select * from sentences where id=?", id);
        if (s == null) throw new ApiException(404, "No such sentence.");
        access.need(uid, Db.num(s.get("language_id")), Access.EDITOR);
        if (source == null || source.isBlank()) throw new ApiException(400, "Write a sentence first.");
        db.update("update sentences set source=?, year=?, translation=?, notes=?, group_no=?, sub_no=?, kind=? where id=?",
                source.trim(), year, translation, notes, group, sub, kind, id);
    }

    /** The sentence as it is at its own year and in its latest possible form, in its language and in every branch. */
    public Map<String, Object> versions(long uid, long id) {
        Map<String, Object> s = db.one("select * from sentences where id=?", id);
        if (s == null) throw new ApiException(404, "No such sentence.");
        long langId = Db.num(s.get("language_id"));
        access.need(uid, langId, Access.VIEWER);
        String source = (String) s.get("source");
        int year = ((Number) s.get("year")).intValue();
        List<Map<String, Object>> latest = new ArrayList<>();
        List<Long> langs = new ArrayList<>();
        langs.add(langId);
        for (long d : access.descendants(langId)) if (access.level(uid, d) >= Access.VIEWER) langs.add(d);
        for (long l : langs) {
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("lang_id", l);
            v.put("lang", access.language(l).get("name"));
            v.put("built", build(new Ctx(l), source, LATEST));
            latest.add(v);
        }
        Map<String, Object> out = new LinkedHashMap<>(s);
        out.put("built", build(new Ctx(langId), source, year));
        out.put("latest", latest);
        return out;
    }

    private static final int LATEST = 1_000_000;

    public void delete(long uid, long id) {
        Map<String, Object> s = db.one("select * from sentences where id=?", id);
        if (s == null) throw new ApiException(404, "No such sentence.");
        access.need(uid, Db.num(s.get("language_id")), Access.EDITOR);
        db.update("delete from sentences where id=?", id);
    }

    /** Everything needed to resolve words of one language, loaded once. */
    private final class Ctx {
        final long langId;
        final Evolver ev;
        final List<Long> pathNearestFirst = new ArrayList<>();
        final List<Long> pathRootFirst = new ArrayList<>();
        final List<Integer> splits = new ArrayList<>();
        final Map<Long, Map<String, Object>> words = new LinkedHashMap<>();
        final Map<Long, List<Meanings.Ev>> meanings = new HashMap<>();
        final Map<Long, List<Losses.Loss>> losses = new HashMap<>();
        final Map<Long, String> langNames = new HashMap<>();
        final Map<Long, List<Map<String, Object>>> forms = new HashMap<>();
        final Map<Long, List<Evolver.Override>> overrides = new HashMap<>();
        final String vowels;

        // ---- for stacking endings (loaded on first use)
        static final Pattern BAD = Pattern.compile("(?!)");
        List<Map<String, Object>> stackRules;
        final Map<String, Integer> groupPos = new HashMap<>();
        Map<String, String> stackClasses;
        String stackVowels;
        private final Map<Long, Pattern> conds = new HashMap<>();
        private final Map<Long, List<Evolver.Row>> affixRows = new HashMap<>();

        void loadStack() {
            if (stackRules != null) return;
            stackRules = new ArrayList<>();
            for (long l : pathNearestFirst) {   // a branch's own rules come before its ancestors'
                stackRules.addAll(db.rows("select * from form_rules where language_id=? order by ord, id", l));
                for (Map<String, Object> g : db.rows("select name, position from form_groups where language_id=?", l))
                    groupPos.putIfAbsent(((String) g.get("name")).trim().toLowerCase(), ((Number) g.get("position")).intValue());
            }
            int next = 100_000;   // groups without a position: in the order they first appear
            for (Map<String, Object> r : stackRules) { String g = grp(r); if (!g.isEmpty() && !groupPos.containsKey(g)) groupPos.put(g, next++); }
            stackClasses = new LinkedHashMap<>();
            for (long l : pathRootFirst) stackClasses.putAll(Patterns.parseClasses((String) access.language(l).get("classes")));
            String v = stackClasses.get("V");
            stackVowels = v == null || v.isEmpty() ? "aeiouy" : v;
        }

        /** The rules for one ending name that fit the word's type: that exact name, else the first name starting with it. */
        List<Map<String, Object>> stackRulesFor(Map<String, Object> w, String part) {
            loadStack();
            String want = part.trim().toLowerCase();
            if (want.isEmpty()) return null;
            List<Map<String, Object>> exact = new ArrayList<>();
            String prefixLabel = null;
            for (Map<String, Object> r : stackRules) {
                if (!posMatches((String) r.get("pos"), (String) w.get("pos"))) continue;
                String l = ((String) r.get("label")).toLowerCase();
                if (l.equals(want)) exact.add(r);
                else if (prefixLabel == null && l.startsWith(want)) prefixLabel = l;
            }
            if (!exact.isEmpty()) return exact;
            if (prefixLabel == null) return null;
            List<Map<String, Object>> pre = new ArrayList<>();
            for (Map<String, Object> r : stackRules)
                if (posMatches((String) r.get("pos"), (String) w.get("pos")) && ((String) r.get("label")).equalsIgnoreCase(prefixLabel)) pre.add(r);
            return pre;
        }

        boolean hasExactRule(Map<String, Object> w, String label) {
            loadStack();
            for (Map<String, Object> r : stackRules)
                if (posMatches((String) r.get("pos"), (String) w.get("pos")) && ((String) r.get("label")).equalsIgnoreCase(label.trim())) return true;
            return false;
        }

        Pattern cond(Map<String, Object> r) {
            String c = (String) r.get("cond_re");
            if (c == null || c.isBlank()) return null;
            return conds.computeIfAbsent(Db.num(r.get("id")), k -> {
                try { return Patterns.compile(c, stackClasses); } catch (IllegalArgumentException e) { return BAD; }
            });
        }

        /** The ending of a rule at a year: its linked dictionary word as it sounded then, or the fixed affix. */
        String affixAt(Map<String, Object> r, int y) {
            String affix = r.get("affix") == null ? "" : (String) r.get("affix");
            if (r.get("affix_word_id") == null) return affix;
            long aw = Db.num(r.get("affix_word_id"));
            Map<String, Object> aword = words.containsKey(aw) ? words.get(aw) : db.one("select * from words where id=?", aw);
            if (aword == null) return affix;
            List<Evolver.Row> rows = affixRows.computeIfAbsent(aw, k -> ev.evolve(Db.num(aword.get("language_id")), (String) aword.get("form"),
                    ((Number) aword.get("year")).intValue(), overrides.getOrDefault(k, List.of())));
            String at = FormMath.formAt(rows, pathNearestFirst, y);
            return at == null || at.isEmpty() ? affix : at;
        }

        Ctx(long langId) {
            this.langId = langId;
            Map<String, Object> lang = access.language(langId);
            long worldId = Db.num(lang.get("world_id"));
            this.ev = evolvers.build(worldId, null);
            pathNearestFirst.add(langId);
            pathNearestFirst.addAll(access.ancestors(langId));
            for (int i = pathNearestFirst.size() - 1; i >= 0; i--) pathRootFirst.add(pathNearestFirst.get(i));
            for (int i = 1; i < pathRootFirst.size(); i++) {
                Map<String, Object> l = access.language(pathRootFirst.get(i));
                splits.add(l.get("split_year") == null ? null : ((Number) l.get("split_year")).intValue());
            }
            String v = "aeiouy";
            Map<String, String> classes = Patterns.parseClasses((String) lang.get("classes"));
            if (classes.get("V") != null && !classes.get("V").isEmpty()) v = classes.get("V");
            vowels = v;
            for (long l : pathNearestFirst) {
                for (Map<String, Object> w : db.rows("select * from words where language_id=? order by year, id", l)) words.put(Db.num(w.get("id")), w);
                for (Map<String, Object> m : db.rows("select m.* from word_meanings m join words w on w.id=m.word_id where w.language_id=?", l)) {
                    meanings.computeIfAbsent(Db.num(m.get("word_id")), k -> new ArrayList<>())
                            .add(new Meanings.Ev(Db.num(m.get("lang_id")), ((Number) m.get("year")).intValue(), (String) m.get("mode"), (String) m.get("meaning")));
                }
                for (Map<String, Object> x : db.rows("select x.* from word_losses x join words w on w.id=x.word_id where w.language_id=?", l)) {
                    losses.computeIfAbsent(Db.num(x.get("word_id")), k -> new ArrayList<>())
                            .add(new Losses.Loss(Db.num(x.get("lang_id")), ((Number) x.get("year")).intValue()));
                }
                langNames.put(l, (String) access.language(l).get("name"));
                for (Map<String, Object> f : db.rows("select f.* from word_forms f join words w on w.id=f.word_id where w.language_id=? order by f.id", l)) {
                    forms.computeIfAbsent(Db.num(f.get("word_id")), k -> new ArrayList<>()).add(f);
                }
                for (Map<String, Object> o : db.rows("select o.* from word_overrides o join words w on w.id=o.word_id where w.language_id=?", l)) {
                    overrides.computeIfAbsent(Db.num(o.get("word_id")), k -> new ArrayList<>())
                            .add(new Evolver.Override(Db.num(o.get("lang_id")), ((Number) o.get("year")).intValue(), (String) o.get("form")));
                }
            }
        }

        /** A word whose form is a cross-reference (see "wind") is replaced by the word it points to. */
        Map<String, Object> deref(Map<String, Object> w) {
            Map<String, Object> cur = w;
            for (int hop = 0; hop < 5; hop++) {
                Refs.Ref ref = Refs.parse((String) cur.get("form"));
                if (ref == null) return cur;
                Map<String, Object> next = null;
                if (ref.id() != null) next = words.get(ref.id());
                else {
                    for (Map<String, Object> c : words.values()) {
                        if (c != cur && Refs.norm((String) c.get("gloss")).equals(Refs.norm(ref.gloss())) && Refs.parse((String) c.get("form")) == null) {
                            if (next == null || Db.num(c.get("language_id")) == Db.num(cur.get("language_id"))) next = c;
                        }
                    }
                }
                if (next == null) return null;
                cur = next;
            }
            return null;
        }

        /** Words that can carry this text as a meaning in this language at this year. */
        List<Map<String, Object>> candidates(String text, int year) {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> w : words.values()) {
                if (((Number) w.get("year")).intValue() > year) continue;
                Losses.Loss lost = lostIn(w);
                if (lost != null && lost.year() <= year) continue;
                if (means(w, text, year)) out.add(w);
            }
            return out;
        }

        private boolean means(Map<String, Object> w, String text, int year) {
            long src = Db.num(w.get("language_id"));
            int from = pathRootFirst.indexOf(src);
            List<Long> sub = pathRootFirst.subList(from, pathRootFirst.size());
            List<Integer> cuts = splits.subList(Math.min(from, splits.size()), splits.size());
            for (String sense : Meanings.senses((String) w.get("gloss"), meanings.getOrDefault(Db.num(w.get("id")), List.of()), sub, cuts, year)) {
                if (norm(sense).equals(norm(text))) return true;
            }
            return false;
        }

        /** When the word stops being used in this language (its own loss or one that keeps it from reaching here), or null. */
        Losses.Loss lostIn(Map<String, Object> w) {
            List<Losses.Loss> ls = losses.get(Db.num(w.get("id")));
            if (ls == null) return null;
            int from = pathRootFirst.indexOf(Db.num(w.get("language_id")));
            return Losses.lostAt(ls, pathRootFirst.subList(from, pathRootFirst.size()), splits.subList(Math.min(from, splits.size()), splits.size()));
        }

        /** Why there is no word for the text in the year: lost before it, or not coined yet. Null if neither. */
        String why(String text, int year) {
            List<String> tries = new ArrayList<>();
            tries.add(text);
            for (int dash = text.lastIndexOf('-'); dash > 0; dash = text.lastIndexOf('-', dash - 1)) tries.add(text.substring(0, dash).trim());
            for (String t : tries) {
                String lostWhy = null, laterWhy = null;
                int laterYear = Integer.MAX_VALUE;
                for (Map<String, Object> w : words.values()) {
                    int coined = ((Number) w.get("year")).intValue();
                    if (!means(w, t, Math.max(year, coined))) continue;
                    Losses.Loss lost = lostIn(w);
                    if (coined <= year && lost != null && lost.year() <= year) {
                        if (lostWhy == null) lostWhy = "'" + w.get("gloss") + "' was lost in " + langNames.getOrDefault(lost.langId(), "?") + " in " + lost.year()
                                + (lost.langId() == langId ? "" : ", before " + langNames.getOrDefault(langId, "this language") + " split off");
                    } else if (coined > year && coined < laterYear) {
                        laterYear = coined;
                        laterWhy = "'" + w.get("gloss") + "' isn't coined until " + coined;
                    }
                }
                if (lostWhy != null) return lostWhy;
                if (laterWhy != null) return laterWhy;
            }
            return null;
        }
    }

    /** Glosses imported from the workbook may be written with their own parentheses, like (you-obj). */
    private static String norm(String t) {
        String x = t.trim().toLowerCase();
        if (x.startsWith("(") && x.endsWith(")") && x.length() > 2) x = x.substring(1, x.length() - 1).trim();
        return x;
    }

    private static Map<String, Object> part(String input) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("input", input);
        return p;
    }

    private static void gap(Map<String, Object> p, String why) {
        p.put("ok", false);
        p.put("reason", why);
    }

    /** Result of looking a text up: the word and an optional form label. */
    private record Hit(Map<String, Object> word, String label, String note) {}

    private Hit lookup(Ctx c, String t, int year) {
        Matcher idm = ID.matcher(t);
        String label = null;
        if (idm.find()) {
            Map<String, Object> w = c.words.get(Long.parseLong(idm.group(1)));
            if (w != null) {
                String rest = t.substring(0, idm.start()).trim();
                if (rest.startsWith("-")) label = rest.substring(1).trim();
                return new Hit(w, label, null);
            }
        }
        List<Map<String, Object>> hits = c.candidates(t, year);
        if (!hits.isEmpty()) return new Hit(hits.get(0), null, hits.size() > 1 ? hits.size() + " words match; used #" + hits.get(0).get("id") + " (write " + t + "#id to choose)" : null);
        int dash = t.lastIndexOf('-');
        while (dash > 0) {
            String g = t.substring(0, dash).trim(), lab = t.substring(dash + 1).trim();
            hits = c.candidates(g, year);
            if (!hits.isEmpty()) {
                Map<String, Object> pick = hits.get(0);
                for (Map<String, Object> cand : hits) if (findForm(c, Db.num(cand.get("id")), lab) != null) { pick = cand; break; }
                return new Hit(pick, lab, hits.size() > 1 ? hits.size() + " words match; used #" + pick.get("id") : null);
            }
            dash = t.lastIndexOf('-', dash - 1);
        }
        return null;
    }

    /** A labelled form: the form at the year (or why there is none), a note, and how it is glossed (".definite", "-plural-definite"). */
    private record Res(String form, String reason, String note, String glossLabel) {}

    /**
     * The form of a word called label at a year. A stored form with that name wins (made by a rule, by hand, or irregular).
     * Several endings joined by "-" (plural-definite) are stacked: put on one after the other in the order of their groups
     * on the Word forms tab, whatever order they are written in.
     */
    private Res labelled(Ctx c, Map<String, Object> w, String label, int year) {
        long wid = Db.num(w.get("id"));
        int wyear = ((Number) w.get("year")).intValue();
        Map<String, Object> exact = storedForm(c, wid, label);
        List<String> parts = new ArrayList<>();
        for (String x : label.split("-")) if (!x.isBlank()) parts.add(x.trim());
        if (exact == null && parts.size() > 1) return stack(c, w, parts, year);
        if (exact == null && c.hasExactRule(w, label)) return stack(c, w, parts, year);   // a rule of that very name beats a longer stored name
        Map<String, Object> fr = exact != null ? exact : findForm(c, wid, label);
        if (fr == null) {
            if (parts.size() == 1 && c.stackRulesFor(w, label) != null) return stack(c, w, parts, year);   // a rule exists but the word has no stored form yet
            List<String> have = new ArrayList<>();
            for (Map<String, Object> f : c.forms.getOrDefault(wid, List.of())) have.add((String) f.get("label"));
            return new Res(null, "'" + w.get("gloss") + "' (#" + wid + ") has no '" + label + "' form; it has: " + (have.isEmpty() ? "none" : String.join(", ", have)), null, null);
        }
        String note = exact == null && !((String) fr.get("label")).equalsIgnoreCase(label.trim())
                ? "'" + w.get("gloss") + "' has no '" + label.trim() + "' form; used '" + fr.get("label") + "'" : null;
        int fy = fr.get("year") == null ? wyear : ((Number) fr.get("year")).intValue();
        if (fy > year) return new Res(null, "the '" + fr.get("label") + "' form of '" + w.get("gloss") + "' is not in use until " + fy, note, null);
        String form = formAtYear(c, wid, (String) fr.get("form"), fy, year);
        if (form == null) return new Res(null, "'" + w.get("gloss") + "' is not in " + access.language(c.langId).get("name") + " (coined after the split)", note, null);
        return new Res(form, null, note, "." + fr.get("label"));
    }

    private Map<String, Object> storedForm(Ctx c, long wordId, String label) {
        for (Map<String, Object> f : c.forms.getOrDefault(wordId, List.of()))
            if (((String) f.get("label")).equalsIgnoreCase(label.trim())) return f;
        return null;
    }

    private static boolean posMatches(String rulePos, String wordPos) {
        if (rulePos == null || rulePos.isBlank()) return true;
        if (wordPos == null) return false;
        for (String p : rulePos.split(",")) if (p.trim().equalsIgnoreCase(wordPos.trim())) return true;
        return false;
    }

    private static String grp(Map<String, Object> r) {
        return r.get("grp") == null ? "" : ((String) r.get("grp")).trim().toLowerCase();
    }

    private static Integer ruleYear(Map<String, Object> r) {
        return r.get("year") == null ? null : ((Number) r.get("year")).intValue();
    }

    /** The language this line of descent is in at a year: the deepest language on the path that has split off by then. */
    private long langAt(Ctx c, int y) {
        for (int i = c.pathRootFirst.size() - 1; i >= 1; i--) {
            Integer sp = c.splits.get(i - 1);
            if (sp != null && sp <= y) return c.pathRootFirst.get(i);
        }
        return c.pathRootFirst.get(0);
    }

    /** Endings stacked onto a word (or onto its stored form for the first of them), at a year. */
    private Res stack(Ctx c, Map<String, Object> w, List<String> parts, int year) {
        long wid = Db.num(w.get("id"));
        int wyear = ((Number) w.get("year")).intValue();
        record Slot(String label, String group, List<Map<String, Object>> rules) {}
        List<Slot> slots = new ArrayList<>();
        for (String part : parts) {
            List<Map<String, Object>> rules = c.stackRulesFor(w, part);
            if (rules == null) {
                Map<String, Object> st = storedForm(c, wid, part);
                if (st != null && slots.isEmpty()) { slots.add(new Slot((String) st.get("label"), "", List.of())); continue; }
                return new Res(null, "no form rule called '" + part + "' for " + (w.get("pos") == null || w.get("pos").toString().isBlank() ? "this word" : "words of type " + w.get("pos")) + " (Word forms tab)", null, null);
            }
            slots.add(new Slot((String) rules.get(0).get("label"), grp(rules.get(0)), rules));
        }
        for (int i = 0; i < slots.size(); i++) for (int j = i + 1; j < slots.size(); j++)
            if (!slots.get(i).group().isEmpty() && slots.get(i).group().equals(slots.get(j).group()))
                return new Res(null, "'" + slots.get(i).label() + "' and '" + slots.get(j).label() + "' are both in the group '" + slots.get(i).group()
                        + "': a word takes only one ending from a group", null, null);
        List<Slot> ordered = new ArrayList<>(slots);
        ordered.sort(java.util.Comparator.comparingInt(sl -> sl.rules().isEmpty() ? Integer.MIN_VALUE   // a stored form with no rule (irregular) is the base
                : sl.group().isEmpty() ? Integer.MAX_VALUE : c.groupPos.getOrDefault(sl.group(), Integer.MAX_VALUE - 1)));
        List<String> names = new ArrayList<>();
        for (Slot sl : ordered) names.add(sl.label());
        String gloss = "-" + String.join("-", names);

        // start from the word, or from its stored form for the first ending (irregular or hand-made)
        String start = (String) w.get("form");
        int startYear = wyear, from = 0;
        String note = null;
        Map<String, Object> stored = storedForm(c, wid, ordered.get(0).label());
        if (stored != null) {
            start = (String) stored.get("form");
            startYear = stored.get("year") == null ? wyear : ((Number) stored.get("year")).intValue();
            from = 1;
        }
        // the combined form comes into use when the last of its endings does
        int y0 = startYear;
        for (int i = from; i < ordered.size(); i++) {
            Integer earliest = null;
            boolean open = false;
            for (Map<String, Object> r : ordered.get(i).rules()) {
                Integer ry = ruleYear(r);
                if (ry == null) { open = true; break; }
                earliest = earliest == null ? ry : Math.min(earliest, ry);
            }
            if (!open && earliest != null) y0 = Math.max(y0, earliest);
        }
        if (y0 > year) return new Res(null, "'" + w.get("gloss") + gloss + "' is not in use until " + y0, null, gloss);
        String cur = formAtYear(c, wid, start, startYear, y0);
        if (cur == null) return new Res(null, "'" + w.get("gloss") + "' is not in " + access.language(c.langId).get("name") + " (coined after the split)", null, gloss);
        for (int i = from; i < ordered.size(); i++) {
            Slot sl = ordered.get(i);
            Map<String, Object> rule = null;
            for (Map<String, Object> r : sl.rules()) {
                Integer ry = ruleYear(r);
                if (ry != null && ry > y0) continue;
                Pattern cond = c.cond(r);
                if (cond == Ctx.BAD) continue;
                if (cond != null && !cond.matcher(cur).find()) continue;
                rule = r;
                break;
            }
            if (rule == null) return new Res(null, "no '" + sl.label() + "' rule fits '" + cur + "' in " + y0, note, gloss);
            String affix = c.affixAt(rule, y0);
            if (affix == null || affix.isEmpty()) return new Res(null, "the '" + sl.label() + "' ending has no form in " + y0, note, gloss);
            cur = FormMath.attach(cur, (String) rule.get("placement"), affix, ((Number) rule.get("hiatus")).intValue() != 0, c.stackVowels);
        }
        List<Evolver.Row> rows = c.ev.evolve(langAt(c, y0), cur, y0, List.of());
        String form = FormMath.formAt(rows, c.pathNearestFirst, year);
        if (form == null) return new Res(null, "'" + w.get("gloss") + gloss + "' is not in " + access.language(c.langId).get("name"), note, gloss);
        return new Res(form, null, note, gloss);
    }

    /**
     * Every combination of endings a word can take (one or none from each group of the Word forms tab), built at a year:
     * {word, year, groups: [{name, labels}], rows: [{labels, form, reason}]}.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> paradigm(long uid, long langId, long wordId, Integer yearOrNull) {
        access.need(uid, langId, Access.VIEWER);
        Ctx c = new Ctx(langId);
        Map<String, Object> w0 = c.words.get(wordId);
        if (w0 == null) throw new ApiException(404, "That word isn't in this language or its ancestors.");
        Map<String, Object> w = c.deref(w0);
        if (w == null) throw new ApiException(400, "The word points to a word that doesn't exist.");
        c.loadStack();
        int year = yearOrNull == null ? ANY_YEAR : yearOrNull;
        Map<String, List<String>> groups = new LinkedHashMap<>();
        List<String> groupOrder = new ArrayList<>();
        for (Map<String, Object> r : c.stackRules) {
            if (!posMatches((String) r.get("pos"), (String) w.get("pos"))) continue;
            String g = grp(r), label = (String) r.get("label");
            String key = g.isEmpty() ? "\u0000" + label.toLowerCase() : g;
            List<String> ls = groups.computeIfAbsent(key, k -> { groupOrder.add(k); return new ArrayList<>(); });
            if (ls.stream().noneMatch(x -> x.equalsIgnoreCase(label))) ls.add(label);
        }
        groupOrder.sort(java.util.Comparator.comparingInt(k -> k.startsWith("\u0000") ? Integer.MAX_VALUE : c.groupPos.getOrDefault(k, Integer.MAX_VALUE - 1)));
        List<List<String>> combos = new ArrayList<>();
        combos.add(new ArrayList<>());
        for (String g : groupOrder) {
            List<List<String>> next = new ArrayList<>();
            for (List<String> base : combos) {
                next.add(base);
                for (String l : groups.get(g)) { List<String> x = new ArrayList<>(base); x.add(l); next.add(x); }
                if (next.size() > 400) break;
            }
            combos = next;
        }
        List<Map<String, Object>> rows = new ArrayList<>();
        for (List<String> combo : combos) {
            if (rows.size() >= 200) break;
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("labels", combo);
            if (combo.isEmpty()) {
                row.put("form", formAtYear(c, Db.num(w.get("id")), (String) w.get("form"), ((Number) w.get("year")).intValue(), year));
            } else {
                Res r = labelled(c, w, String.join("-", combo), year);
                row.put("form", r.form());
                if (r.reason() != null) row.put("reason", r.reason());
                if (r.note() != null) row.put("note", r.note());
                if (combo.size() > 1 && storedForm(c, Db.num(w.get("id")), combo.get(0)) != null) row.put("from_stored", combo.get(0));
            }
            rows.add(row);
        }
        List<Map<String, Object>> gl = new ArrayList<>();
        for (String g : groupOrder) gl.add(Map.of("name", g.startsWith("\u0000") ? "" : g, "labels", groups.get(g)));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("word", Map.of("id", w.get("id"), "gloss", w.get("gloss"), "pos", w.get("pos") == null ? "" : w.get("pos")));
        out.put("year", yearOrNull);
        out.put("groups", gl);
        out.put("rows", rows);
        return out;
    }

    /** Form of a word by label: exact match first, then a label that starts with the text (obj finds object). */
    private Map<String, Object> findForm(Ctx c, long wordId, String label) {
        Map<String, Object> prefix = null;
        for (Map<String, Object> f : c.forms.getOrDefault(wordId, List.of())) {
            String l = ((String) f.get("label")).toLowerCase();
            String want = label.toLowerCase().trim();
            if (l.equals(want)) return f;
            if (prefix == null && !want.isEmpty() && l.startsWith(want)) prefix = f;
        }
        return prefix;
    }

    private String formAtYear(Ctx c, long wordId, String form, int startYear, int year) {
        Map<String, Object> w = c.words.get(wordId);
        long src = Db.num(w.get("language_id"));
        List<Evolver.Row> rows = c.ev.evolve(src, form, startYear, c.overrides.getOrDefault(wordId, List.of()));
        if (src != c.langId && rows.stream().noneMatch(r -> r.langId() == c.langId)) return null;
        return FormMath.formAt(rows, c.pathNearestFirst, year);
    }

    private Map<String, Object> build(Ctx c, String source, int year) {
        List<Map<String, Object>> words = new ArrayList<>();
        List<String> surfaces = new ArrayList<>(), glosses = new ArrayList<>();
        int gaps = 0;
        for (List<String> group : SentenceParser.parse(source)) {
            String surface = null;
            List<String> gl = new ArrayList<>();
            List<Map<String, Object>> parts = new ArrayList<>();
            boolean bad = false;
            for (String t : group) {
                Map<String, Object> p = part(t);
                parts.add(p);
                if (t.startsWith("=")) {
                    p.put("ok", true);
                    p.put("form", t.substring(1));
                    p.put("gloss", "");
                    surface = surface == null ? t.substring(1) : surface + t.substring(1);
                    continue;
                }
                Hit h = lookup(c, t, year);
                if (h == null) { String why = c.why(t, year); gap(p, why == null ? "no word with that meaning" : why); p.put("missingWord", true); p.put("form", "[" + t + "?]"); bad = true; surface = (surface == null ? "" : surface) + "[" + t + "?]"; gl.add(t); continue; }
                Map<String, Object> w0 = h.word();
                Losses.Loss lostHit = c.lostIn(w0);
                if (lostHit != null && lostHit.year() <= year) {   // picked by id (meaning#12) although it's no longer used
                    gap(p, "'" + w0.get("gloss") + "' was lost in " + c.langNames.getOrDefault(lostHit.langId(), "?") + " in " + lostHit.year());
                    p.put("missingWord", true); p.put("form", "[" + t + "?]"); bad = true; surface = (surface == null ? "" : surface) + "[" + t + "?]"; gl.add(t); continue;
                }
                Map<String, Object> w = c.deref(w0);
                if (w == null) {
                    gap(p, "'" + w0.get("gloss") + "' points to a word that doesn't exist: " + w0.get("form"));
                    p.put("form", "[" + t + "?]"); bad = true; surface = (surface == null ? "" : surface) + "[" + t + "?]"; gl.add(t); continue;
                }
                long wid = Db.num(w.get("id"));
                p.put("word_id", Db.num(w0.get("id")));
                if (w != w0) p.put("note", "'" + w0.get("gloss") + "' = see '" + w.get("gloss") + "'");
                if (h.note() != null) p.put("note", h.note());
                String form, glossLabel = null;
                if (h.label() == null) {
                    form = formAtYear(c, wid, (String) w.get("form"), ((Number) w.get("year")).intValue(), year);
                } else {
                    Res r = labelled(c, w, h.label(), year);
                    if (r.note() != null) p.put("note", p.containsKey("note") ? p.get("note") + "; " + r.note() : r.note());
                    if (r.reason() != null) {
                        gap(p, r.reason());
                        p.put("form", "[" + t + "?]"); bad = true; surface = (surface == null ? "" : surface) + "[" + t + "?]"; gl.add(t); continue;
                    }
                    form = r.form();
                    glossLabel = r.glossLabel();
                }
                if (form == null) {
                    if (!p.containsKey("reason")) { gap(p, "'" + w.get("gloss") + "' is not in " + access.language(c.langId).get("name") + " (coined after the split)"); p.put("missingWord", true); }
                    p.put("form", "[" + t + "?]"); bad = true; surface = (surface == null ? "" : surface) + "[" + t + "?]"; gl.add(t); continue;
                }
                p.put("ok", true);
                p.put("form", form);
                p.put("gloss", glossLabel == null ? w0.get("gloss") : w0.get("gloss") + glossLabel);
                gl.add(p.get("gloss").toString());
                surface = surface == null ? form : FormMath.attach(surface, "suffix", form, true, c.vowels);
            }
            if (bad) gaps++;
            Map<String, Object> word = new LinkedHashMap<>();
            word.put("surface", surface == null ? "" : surface);
            word.put("gloss", String.join("-", gl.stream().filter(x -> !x.isEmpty()).toList()));
            word.put("parts", parts);
            word.put("ok", !bad);
            words.add(word);
            surfaces.add(word.get("surface").toString());
            glosses.add(word.get("gloss").toString());
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("words", words);
        out.put("surface", String.join(" ", surfaces));
        out.put("gloss", String.join(" ", glosses));
        out.put("gaps", gaps);
        return out;
    }

    // ---------------- missing words ----------------

    /** A year after anything a language will have: "does the language ever get a word for this?". */
    private static final int ANY_YEAR = 1_000_000;

    /** Is the sentence builder's gap for this part a missing word (not a missing form)? */
    private static boolean missingWord(String reason) {
        return reason != null && (reason.equals("no word with that meaning") || reason.contains("(coined after the split)")
                || reason.contains("points to a word that doesn't exist"));
    }

    /**
     * For each meaning, the word this language uses for it (its own or inherited, any year) as
     * {id, gloss, form}, or no entry if it has none. Same lookup as the sentence builder.
     */
    public Map<String, Map<String, Object>> wordsFor(long uid, long langId, Collection<String> meanings) {
        access.need(uid, langId, Access.VIEWER);
        Map<String, Map<String, Object>> out = new HashMap<>();
        if (meanings.isEmpty()) return out;
        Ctx c = new Ctx(langId);
        for (String m : meanings) {
            if (m == null || m.isBlank() || m.contains("(") || m.contains(")")) continue;
            Map<String, Object> built = build(c, "(" + m.trim() + ")", ANY_YEAR);
            if (((Number) built.get("gaps")).intValue() > 0) continue;
            @SuppressWarnings("unchecked")
            Map<String, Object> part = ((List<Map<String, Object>>) ((List<Map<String, Object>>) built.get("words")).get(0).get("parts")).get(0);
            Map<String, Object> w = new LinkedHashMap<>();
            w.put("id", part.get("word_id"));
            w.put("gloss", part.get("gloss"));
            w.put("form", built.get("surface"));
            out.put(m, w);
        }
        return out;
    }

    /**
     * Meanings the saved sentences use that this language has no word for, each with why and which
     * sentences need it: [{meaning, reason, sentences: [{id, translation, source, year}]}].
     */
    public List<Map<String, Object>> sentenceGaps(long uid, long langId) {
        Map<String, Map<String, Object>> byMeaning = new LinkedHashMap<>();
        for (Map<String, Object> s : list(uid, langId)) {
            @SuppressWarnings("unchecked") Map<String, Object> built = (Map<String, Object>) s.get("built");
            @SuppressWarnings("unchecked") List<Map<String, Object>> words = (List<Map<String, Object>>) built.get("words");
            for (Map<String, Object> word : words) {
                @SuppressWarnings("unchecked") List<Map<String, Object>> parts = (List<Map<String, Object>>) word.get("parts");
                for (Map<String, Object> p : parts) {
                    if (!Boolean.FALSE.equals(p.get("ok")) || !(Boolean.TRUE.equals(p.get("missingWord")) || missingWord((String) p.get("reason")))) continue;
                    String meaning = ID.matcher(p.get("input").toString()).replaceAll("").trim();
                    if (meaning.isEmpty()) continue;
                    Map<String, Object> g = byMeaning.computeIfAbsent(meaning.toLowerCase(), k -> {
                        Map<String, Object> m = new LinkedHashMap<>();
                        m.put("meaning", meaning);
                        m.put("reason", p.get("reason"));
                        m.put("sentences", new ArrayList<Map<String, Object>>());
                        return m;
                    });
                    @SuppressWarnings("unchecked") List<Map<String, Object>> used = (List<Map<String, Object>>) g.get("sentences");
                    if (used.stream().noneMatch(x -> x.get("id").equals(s.get("id")))) {
                        Map<String, Object> ref = new LinkedHashMap<>();
                        ref.put("id", s.get("id"));
                        ref.put("translation", s.get("translation"));
                        ref.put("source", s.get("source"));
                        ref.put("year", s.get("year"));
                        used.add(ref);
                    }
                }
            }
        }
        return new ArrayList<>(byMeaning.values());
    }
}
