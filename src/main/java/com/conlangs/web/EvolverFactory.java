package com.conlangs.web;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** Builds an Evolver for a whole world (all its languages and sound-change rules). */
@Service
public class EvolverFactory {
    private final Db db;

    public EvolverFactory(Db db) {
        this.db = db;
    }

    public Evolver build(long worldId, Evolver.Rule extra) {
        List<Evolver.Lang> langs = new ArrayList<>();
        for (Map<String, Object> l : db.rows("select id, name, parent_id, split_year, classes from languages where world_id=?", worldId)) {
            langs.add(new Evolver.Lang(Db.num(l.get("id")), (String) l.get("name"),
                    l.get("parent_id") == null ? null : Db.num(l.get("parent_id")),
                    l.get("split_year") == null ? null : ((Number) l.get("split_year")).intValue(),
                    (String) l.get("classes")));
        }
        List<Evolver.Rule> rules = new ArrayList<>();
        // sound changes with a tag switched off (in their language or an ancestor) are left out
        Map<Long, Map<String, String>> off = RuleTags.effectiveOff(db, worldId);
        for (Map<String, Object> r : db.rows("select r.* from rules r join languages l on l.id=r.language_id where l.world_id=?", worldId)) {
            if (RuleTags.offTag((String) r.get("tags"), off.getOrDefault(Db.num(r.get("language_id")), Map.of())) != null) continue;
            rules.add(new Evolver.Rule(Db.num(r.get("id")), Db.num(r.get("language_id")), ((Number) r.get("year")).intValue(),
                    ((Number) r.get("ord")).intValue(), (String) r.get("name"), (String) r.get("pattern"), (String) r.get("replacement")));
        }
        if (extra != null) rules.add(extra);
        return new Evolver(langs, rules);
    }
}
