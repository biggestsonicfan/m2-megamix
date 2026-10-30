/*
 * The player record (the rob): making one, setting its motion and action,
 * the points of its body in the world. Part of js/engine.js.
 */
import { S, ENERGY, downStun, rootAt } from '../fighters.js';
import { ST, START_X, toWorld } from './state.js';
import { fly } from './jumps.js';
import { riseKick } from './playback.js';

/* ---- the player record --------------------------------------------------- */

export function makePlayer(side, fighter) {
    const p = {
        /* the rob's fields, by the debug mode's names and StF's offsets */
        fighter,                    /* +0x1B0 char (1P CHAR / 2P CHAR) */
        state: ST.KAMAE,            /* +0x19F, action's top byte */
        action: 'stance',           /* +0x19C: here the action-table slot playing */
        pos: [side ? START_X : -START_X, 0, 0],   /* +0x018 xpos, ypos, zpos: the motion's origin */
        yang: side ? Math.PI : 0,   /* +0x026 facing */
        mot: null,                  /* +0x1A8 mot_num: {rom, motion}; another game's for a throw */
        mot_coma: 1,                /* +0x1AA its frame */
        energy: ENERGY,             /* +0x1AC */
        attack: null,               /* +0x804 motd_kind and on: the setup record's strike or throw */
        timing: null,               /* +0x808 motd_main, follow1, follow2: hit, cancel, end */
        hit_combo: 0,               /* +0x6F4 hits taken in a row */
        pad: 0, padOld: 0,          /* +0x1200 pad, this frame and the last */
        pc_command: 0,              /* +0x1218 the follow table a string parks */
        /* the engine's own */
        side,
        body: fighter.createBody(),
        loop: true, hold: false,
        hitDone: false,
        hist: [],                   /* the stick, a sample a frame, for the matcher */
        press: null,                /* a press waiting for its chord or for a move to end */
        tapAt: -99, tapDir: 0,
        downFor: 0,
        downStun: null,             /* the knock-down's stun (+0x5DE), fighters.js downStun */
        riseKick: null,             /* VF2: the get-up the rise's sub-kind (+0x19E) has picked */
        fly: null,                  /* StF: the jump's flight, {vy} (+0x30), till it lands */
        air: null,                  /* a jump's frames left in the air from take-off (+0x5BC) */
        held: null,                 /* an air attack held back, {e, press, at} (+0x19C bit 19) */
        hara: null,                 /* the jump's motion from take-off: mk_air (+0x1A4 bit 4) */
        en_behind: false,           /* +0x5B8 bit 0 en_from_behind: the other is behind (enBehind) */
        wins: 0,                    /* 0x50004F p1_wins / 0x500051 p2_wins */
        posed: null,
        lastMove: '',
    };
    setAct(p, 'stance');
    return p;
}

/* Play `ref` from frame 1. The body is kept where it is drawn: the origin
 * moves by the old motion's root where it stopped less the new one's at 1. */
export function setMotion(p, ref, { loop = false, hold = false, state = null } = {}) {
    if (p.mot?.motion && ref?.motion) {
        const a = rootAt(p.mot.rom, p.mot.motion, p.mot_coma), b = rootAt(ref.rom, ref.motion, 1);
        carry(p, a[0] - b[0], a[2] - b[2]);
    }
    p.mot = ref;
    p.mot_coma = 1;
    p.loop = loop; p.hold = hold;
    if (state != null) p.state = state;
}

export function carry(p, dx, dz) {
    const c = Math.cos(p.yang), s = Math.sin(p.yang);
    p.pos[0] += c * dx + s * dz;
    p.pos[2] += -s * dx + c * dz;
}

const LOOPS = new Set(['stance', 'crouch', 'walkF', 'walkB', 'down']);
const HOLDS = new Set(['guard', 'crouchGuard']);
const ACT_STATE = {
    stance: ST.KAMAE, crouch: ST.SYAGAMI, toCrouch: ST.SYAGAMI, toStand: ST.KAMAE, walkF: ST.WALK, walkB: ST.BWALK,
    dashF: ST.FUMIKOMI, dashB: ST.FUMIKOMI, jump: ST.JUMP, guard: ST.GUARD, guardEnd: ST.KAMAE,
    crouchGuard: ST.GUARD, crouchGuardEnd: ST.SYAGAMI, down: ST.DOWN, rise: ST.RISE,
};
export function setAct(p, act) {
    const ref = p.fighter.act(act);
    if (!ref.motion) return;
    p.action = act;
    p.crouching = act === 'crouch' || act === 'toCrouch' || act === 'crouchGuard';
    setMotion(p, ref, { loop: LOOPS.has(act), hold: HOLDS.has(act), state: ACT_STATE[act] });
    p.attack = null; p.timing = null;
    p.small = false;
}

/* The body's point on the floor, in the world: the origin carried by the
 * root (slot 0's matrix). */
export function bodyPoint(p) {
    const m = p.posed?.mats[S.BODY];
    return m ? toWorld(p, [m[12], 0, m[14]]) : p.pos.slice();
}
export const slotWorld = (p, s) => { const m = p.posed.mats[s]; return toWorld(p, [m[12], m[13], m[14]]); };
