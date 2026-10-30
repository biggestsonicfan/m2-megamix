/*
 * What every game's fighters share, and the ROMs they are read from: motion
 * ids, slots, the action tables' slots, attack levels, energy; a motion by id
 * and its root. It imports none of js/fighters/'s own, so the others'
 * top-level constants can use it.
 * Part of js/fighters.js (one fighter interface over three games' data),
 * which re-exports its API.
 */
import { readFighterMotions } from '../../vendor/noclip/js/vf2fighters.js';
import { decodeMotion, sampleMotion } from '../../vendor/noclip/js/motion.js';

export const MOTION_ID = 0x1fff;

/* Slots (js/pose.js SLOT_NAMES). */
export const S = { BODY: 0, CHEST: 1, HEAD: 2, LHAND: 5, RHAND: 8, PELVIS: 9, LFOOT: 12, RFOOT: 15 };

/*
 * The action tables, slot by slot, as measured from the motions' roots and
 * (FV) the motions' own names. Each game orders its table its own way; these
 * are the slots the shared engine plays. The jumps are the ones the jump's
 * commit plays: StF +0x38(g6) and +0x3C(g6) with bit 18 (sub_1305C 0x132F0),
 * FV +0x4E(g6) and +0x50(g6) (0x134C0).
 */
export const ACTION_SLOTS = {
    vf2: { stance: 0, crouch: 1, toStand: 2, toCrouch: 5, guard: 8, guardEnd: 9, crouchGuard: 10, crouchGuardEnd: 11,
        dashF: 14, dashB: 15, walkF: 20, walkB: 22, jump: 28, jumpSmall: 29, down: 31, rise: 32,
        riseKick: 57, riseLow: 61, riseLowFwd: 65, riseLowBack: 69 },
    fv: { stance: 0, crouch: 1, toStand: 2, toCrouch: 5, guard: 8, guardEnd: 11, crouchGuard: 12, crouchGuardEnd: 15,
        dashF: 18, dashB: 20, walkF: 28, walkB: 30, jump: 39, jumpSmall: 40, down: 42, rise: 43 },
    stf: { stance: 0, crouch: 1, toStand: 2, toCrouch: 3, guard: 5, guardEnd: 6, crouchGuard: 1, crouchGuardEnd: 2,
        dashF: 7, dashB: 9, walkF: 13, walkB: 15, jump: 28, jumpSmall: 30, down: 40, rise: 41 },
};

/*
 * Sonic the Fighters' common reactions: motions every character plays, which
 * no character's action table names (the fight code picks them). Hit stun
 * is 30 frames, timing 1/4/30; the knock-down drops the waist from 1.07 to
 * 0.34 and travels 2.38 back.
 */
export const STF_REACT = { light: 177, heavy: 182, crouch: 221, down: 225 };

/* Hit levels, as the strike op keeps them (op 4, byte 2, motd_ap +0x821):
 * 0 high, 1 mid, 2 low. The rest, read from FV's motion names and the
 * matcher's contexts: 3 the jump attacks (JU_, JUS_), 4 the down attacks
 * (DAT_ pounces and stomps; StF's attack_hit wants 4, or its own 8, against
 * a fighter lying down), 5 FV's slide (a low), 6 one VF2 move, 7 and 8 StF's
 * own (7 passes for high where StF's air check excludes 0 and 7). The guard
 * itself is judged on the coprocessor (StF hands it both levels at
 * 0x1D003A3A), which this engine does not run: here 3 and 6 to 8 guard as a
 * mid, 4 as a mid on a fighter standing, 5 as a low. */
export const HIGH = 0, MID = 1, LOW = 2;
const AP_JUMP = 3, AP_DOWN = 4, AP_SLIDE = 5, AP_STF_DOWN = 8;
export function strikeLevel(ap) {
    return ap === HIGH || ap === LOW ? ap : ap === AP_SLIDE ? LOW : MID;
}
export const hitsDown = (ap, stf) => ap === AP_DOWN || (stf && ap === AP_STF_DOWN);

/* The energy every fighter has here. VF2's and FV's strike damage is on
 * this scale; StF's (out of 140, 0x5000A0) is scaled up to it. */
export const ENERGY = 200;
const STF_ENERGY = 140;
export const stfScale = (d) => Math.round((d * ENERGY) / STF_ENERGY);

/* ---- the ROMs ------------------------------------------------------------ */

const romCache = new WeakMap();
export function per(rom) {
    let c = romCache.get(rom);
    if (!c) romCache.set(rom, c = { motions: new Map(), models: new Map() });
    return c;
}

/* A motion of `rom` by id, decoded once. VF2/FV's come from the fighter
 * motion table so they carry their index and name. */
export function motionOf(rom, id) {
    const c = per(rom);
    if (id == null) return null;
    if (!c.motions.has(id)) {
        let m = null;
        if (rom.game.rig?.kind === 'vf2') {
            c.list ??= readFighterMotions(rom);
            m = c.list[id] ?? null;
        } else {
            const d = decodeMotion(rom, id);
            m = d ? { ...d, index: id } : null;
        }
        c.motions.set(id, m);
    }
    return c.motions.get(id);
}

/* A motion's root (floats 0-2) at frame `f`, in the viewer's frame: the
 * fighter faces +x there, so the motion's forward (+z) is +x. */
export function rootAt(rom, motion, f) {
    const t = sampleMotion(rom, motion, Math.max(1, Math.min(f, motion.frames))).targets;
    return [t[2], t[1], t[0]];
}
