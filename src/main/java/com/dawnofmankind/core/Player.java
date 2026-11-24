package com.dawnofmankind.core;

import com.dawnofmankind.core.Content.BuildingDef;
import com.dawnofmankind.core.Content.CardDef;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;

/** One seat: own resources, Population (workers), army, buildings, hand, techs and minor wonders. */
public final class Player {

    /**
     * One building of a type. A player has at most one of each type: building it again adds worker slots
     * (another level) instead of a second building.
     */
    public static final class Building {
        public final int id;
        public final BuildingDef def;
        public int workers;
        public int slots;
        /** The cards slotted into this building: their per-worker and income bonuses work for the owner only while they sit here. */
        public final List<CardDef> upgrades = new ArrayList<>();

        Building(int id, BuildingDef def) {
            this.id = id;
            this.def = def;
            this.slots = def.slots;
        }

        public int level() {
            return Math.max(1, (slots + def.slots - 1) / Math.max(1, def.slots));
        }
    }

    public final int seat;
    public String name;
    public final EnumMap<Res, Integer> res = Res.empty();
    public final List<Building> buildings = new ArrayList<>();
    public final List<Game.CardInst> hand = new ArrayList<>();
    public final List<CardDef> techs = new ArrayList<>();
    public final List<CardDef> minorWonders = new ArrayList<>();
    /** The leader in play (drawn leaders play themselves and replace the old one; a leader leaves when its era ends). */
    public CardDef leader;
    /** A great person just drawn while another is in play: the player chooses whether they take over. */
    public CardDef pendingLeader;
    /** The free troop a leader like Gilgamesh allows has been trained this round. */
    public boolean freeRecruitUsed;
    /** A great person like Archimedes lets the next science card be played free; this says it has been used. */
    public boolean freeTechUsed;
    /** Population with no building to work in. */
    public int idle;
    public int army;
    /** Troops sent to an invasion this round; they can't also defend against raids. */
    public int committed;
    /** Disconnected: their turn and responses are passed automatically. */
    public boolean away;
    /** Parallel rounds: this player's actions left this round, whether they have ended their round, and what they drew blind at its start. */
    public int actions;
    public boolean done;
    public Game.CardInst turnDraw;
    public int turnEvents, turnSeq;

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
        for (Building b : buildings) n += b.slots - b.workers;
        return n;
    }

    public boolean owns(CardDef c) {
        return techs.contains(c) || minorWonders.contains(c);
    }

    public Building ofType(String type) {
        for (Building b : buildings) if (b.def.id.equals(type)) return b;
        return null;
    }

    Building building(int id) {
        for (Building b : buildings) if (b.id == id) return b;
        throw new GameException("No such building.");
    }
}
