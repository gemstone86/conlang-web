package com.dawnofmankind.core;

import com.dawnofmankind.core.Content.BuildingDef;
import com.dawnofmankind.core.Content.CardDef;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;

/** One seat: own resources, Population (workers), army, buildings, hand, techs and minor wonders. */
public final class Player {

    public static final class Building {
        public final int id;
        public final BuildingDef def;
        public int workers;

        Building(int id, BuildingDef def) {
            this.id = id;
            this.def = def;
        }
    }

    public final int seat;
    public String name;
    public final EnumMap<Res, Integer> res = Res.empty();
    public final List<Building> buildings = new ArrayList<>();
    public final List<Game.CardInst> hand = new ArrayList<>();
    public final List<CardDef> techs = new ArrayList<>();
    public final List<CardDef> minorWonders = new ArrayList<>();
    /** Population with no building to work in. */
    public int idle;
    public int army;
    /** Troops sent to an invasion this round; they can't also defend against raids. */
    public int committed;
    /** Disconnected: their turn and responses are passed automatically. */
    public boolean away;

    Player(int seat, String name) {
        this.seat = seat;
        this.name = name;
    }

    public int population() {
        int n = idle;
        for (Building b : buildings) n += b.workers;
        return n;
    }

    public int freeSlots() {
        int n = 0;
        for (Building b : buildings) n += b.def.slots - b.workers;
        return n;
    }

    public boolean owns(CardDef c) {
        return techs.contains(c) || minorWonders.contains(c);
    }

    Building building(int id) {
        for (Building b : buildings) if (b.id == id) return b;
        throw new GameException("No such building.");
    }
}
