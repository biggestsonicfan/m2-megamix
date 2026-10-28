/*
 * One fighter interface over three games' data.
 *
 * Virtua Fighter 2, Fighting Vipers and Sonic the Fighters run the same AM2
 * fighter engine: the same sixteen-slot rig (js/pose.js SLOT_PARENT), the same
 * keyframe motion format (twelve angle objects and eight float objects, the
 * root in floats 0-2), the same input matcher bytecode (js/moves.js) and the
 * same per-motion setup records (timing op 2, strike op 4, throw op 5). What
 * differs is where each game keeps them and how a body is dressed:
 *
 *   VF2 / FV   a fighter record (readFighters): parts, an action table of 84 /
 *              55 motion ids, a command program; drawn by poseFighter.
 *   StF        a character record (readCharacter): slot models, a 52-slot
 *              action table, a skeleton; posed by buildPose directly.
 *
 * Everything here reads the ROMs through the vendored noclip modules; nothing
 * is drawn or invented. A motion is self-contained (its channels carry their
 * own DataView), so one game's motion can be played on another game's body:
 * that is how a cross-game throw is shown.
 */
import { readFighters, readFighterMotions, poseFighter, partMaterial, standardRig } from '../vendor/noclip/js/vf2fighters.js';
import { readCharacter } from '../vendor/noclip/js/characters.js';
import { decodeMotion, sampleMotion, resolveData, readMotionTiming, readMotionScript } from '../vendor/noclip/js/motion.js';
import { buildPose, poseMatrices, viewerMatrix } from '../vendor/noclip/js/pose.js';
import { programMoves, readMoves } from '../vendor/noclip/js/moves.js';
import { attackOf, reactionMotion, REACTIONS } from '../vendor/noclip/js/reactions.js';
import { readOsage, createOsageSim, stepOsage, settleOsage } from '../vendor/noclip/js/osage.js';
import { decodeModel } from '../vendor/noclip/js/model.js';
import { readModelEntry, meshOffsetOf, progAddr } from '../vendor/noclip/js/romset.js';
import { programTextureSets } from '../vendor/noclip/js/texture.js';
import { skinMesh } from '../vendor/noclip/js/bodies.js';

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
const ACTION_SLOTS = {
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
const STF_REACT = { light: 177, heavy: 182, crouch: 221, down: 225 };

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
function strikeLevel(ap) {
    return ap === HIGH || ap === LOW ? ap : ap === AP_SLIDE ? LOW : MID;
}
const hitsDown = (ap, stf) => ap === AP_DOWN || (stf && ap === AP_STF_DOWN);

/* The energy every fighter has here. VF2's and FV's strike damage is on
 * this scale; StF's (out of 140, 0x5000A0) is scaled up to it. */
export const ENERGY = 200;
const STF_ENERGY = 140;
const stfScale = (d) => Math.round((d * ENERGY) / STF_ENERGY);

/* ---- the ROMs ------------------------------------------------------------ */

const romCache = new WeakMap();
function per(rom) {
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

/* ---- setup records ------------------------------------------------------- */

/* VF2 / FV: the setup ops through the profile's lengths (as js/reactions.js
 * walks them), each {op, at} in the record's view. */
function vfSetupOps(rom, id) {
    const R = rom.game.rig.reactions;
    const p = resolveData(rom, R.setups + (id & MOTION_ID) * 4);
    if (!p) return null;
    const r = resolveData(rom, p.view.getUint32(p.off, true));
    if (!r) return null;
    const dv = r.view, ops = [], play = [], kind = dv.getUint32(r.off, true);
    let at = r.off + R.head;
    while (at < dv.byteLength) {
        const op = dv.getUint8(at);
        if (op === 0 || op >= R.ops) return { dv, kind, ops, play };
        if (op === 8) { at++; break; }
        ops.push({ op, at });
        const len = op === 0x10 ? 2 + 2 * dv.getUint8(at + 1) : rom.mainCpuView.getUint8(R.lengths + op);
        if (!len) return { dv, kind, ops, play };
        at += len;
    }
    /* the play script after op 8: each op its frame (u16 at +1), its length
     * from the profile's script list (js/fighterhands.js walks it too) */
    const L = rom.game.rig.script ?? [];
    while (at + 4 <= dv.byteLength) {
        const op = dv.getUint8(at);
        if (op === 0 || op >= L.length || !L[op]) break;
        play.push({ op, frame: dv.getUint16(at + 1, true), at });
        at += L[op];
    }
    return { dv, kind, ops, play };
}

/* StF: the same record, from the program's motion list (0xCE380), head 13
 * bytes, with the op lengths of its own handler table. */
const STF_MOT_LIST = 0xce380, STF_HEAD = 13;
const STF_LENGTHS = { 0x01: 3, 0x02: 7, 0x03: 14, 0x04: 18, 0x05: 14, 0x06: 6, 0x07: 3, 0x09: 15, 0x0a: 6, 0x0b: 11,
    0x0c: 4, 0x0d: 3, 0x0e: 15, 0x0f: 3, 0x11: 7, 0x12: 7, 0x13: 7, 0x14: 3, 0x15: 6, 0x16: 5, 0x17: 3, 0x18: 13 };
function stfSetupOps(rom, id) {
    const m = rom.maincpu, dv = rom.mainCpuView;
    const rec = dv.getUint32(progAddr(rom, STF_MOT_LIST) + id * 4, true);
    if (!rec || rec >= m.length) return null;
    const ops = [];
    for (let p = rec + STF_HEAD; p < m.length;) {
        const op = m[p];
        if (op === 0 || op === 8) break;
        const len = op === 0x10 ? 2 + m[p + 1] * 2 : STF_LENGTHS[op];
        if (!len) break;
        ops.push({ op, at: p });
        p += len;
    }
    return { dv, kind: dv.getUint32(rec, true), ops, play: readMotionScript(rom, id) };
}

/* The attack part's slots: op 4 byte 1 (+0x820) indexes a table of
 * sixteen-bit slot masks the hit test walks (42 entries, the last 0xFFFF, the
 * whole body). The three games' tables match but for part 20, StF 0x206 where
 * VF2 and FV have 0x202. */
const PART_MASKS = { stf: { prog: 0xce020 }, vf2: { data: 0x02007aca }, fv: { data: 0x0640e72e } };
const PARTS = 42;
function partMask(rom, key, part) {
    const c = per(rom);
    if (!c.parts) {
        const T = PART_MASKS[key];
        const at = T?.prog != null ? { view: rom.mainCpuView, off: progAddr(rom, T.prog) }
            : T ? resolveData(rom, T.data) : null;
        c.parts = at ? [...Array(PARTS)].map((_, i) => at.view.getUint32(at.off + i * 4, true)) : [];
    }
    return c.parts[part] ?? 0;
}

/* A throw's damage: op 5 byte 3 at the throw, then the hits the victim's
 * motion deals itself, play op 8 (its frame, byte 3 the damage): Akira's
 * 15 throws 16 for 20, then 10 at frames 47 and 62. */
const PLAY_DAMAGE = 8;

/* A jump's take-off frame: setup op 3's first u16, motd_jump_coma (+0x80E;
 * FV's set_mot_dat stores it from op 3). Akira's jump leaves the floor at 14,
 * his small jump at 10; StF's take-off motions have 0. */
const OP_JUMP = 3;
function takeoffOf(s) {
    const o = s?.ops.find((x) => x.op === OP_JUMP);
    return o ? s.dv.getUint16(o.at + 1, true) : 0;
}
/* An air attack held back (the command's bit 19): op 3's u16 at +5,
 * jp_next_lacoma (+0x5C0), the frames left in the air (+0x5BC) at which the
 * jump handler plays it (StF 0x133C8, FV 0x13600, VF2 0x14914). */
function airHoldOf(s) {
    const o = s?.ops.find((x) => x.op === OP_JUMP);
    return o ? s.dv.getUint16(o.at + 5, true) : null;
}
/* A get-up's attack window (FV and StF): a motion of motd_kind's mk_rise
 * (bit 15) whose setup op 23 sets +0x87A (byte 1). P or K held while
 * follow1 (op 2's cancel, +0x80A) less the frame is at most that ends the
 * rise (StF 0x1D864, FV 0x1D634: w0 bit 15, the rise handler's last phase). */
const MK_RISE = 1 << 15, OP_TIMING = 2, OP_RISE = 23;
function riseWindowOf(s) {
    const w = s && s.kind & MK_RISE ? s.ops.find((o) => o.op === OP_RISE) : null;
    const t = w && s.ops.find((o) => o.op === OP_TIMING);
    return t ? { cancel: s.dv.getUint16(t.at + 3, true), window: s.dv.getUint8(w.at + 1) } : null;
}

function throwHits(s, scale) {
    return s ? s.play.filter((o) => o.op === PLAY_DAMAGE)
        .map((o) => ({ frame: o.frame, damage: scale(s.dv.getUint8(o.at + 3)) })).filter((h) => h.damage > 0) : [];
}

/* ---- the input matcher (js/moves.js's, run live) ------------------------- */

const OP_EXACT_NEW = 0x00, OP_EXACT = 0x01, OP_SUBSET = 0x03, OP_BRANCH = 0x28;
export const P = 0x01, K = 0x02, G = 0x04, DOWN = 0x10, UP = 0x20, FWD = 0x40, BACK = 0x80;

/* Would the entry's direction tests pass on this history, oldest first? Each
 * test, most recent first, is tried on the sample under the cursor and then
 * one further back until it passes (js/moves.js satisfies, `loc_1EE74`). */
function satisfies(e, hist) {
    let i = hist.length - 1;
    for (const { op, mask, here } of e.dirs) {
        const ok = (s) => (op === OP_EXACT_NEW || op === OP_EXACT) ? s === (mask & 0xf0)
            : op === OP_SUBSET ? (s & ~mask & 0xf0) === 0
                : op === OP_BRANCH && !mask ? (s & (FWD | BACK)) === 0
                    : (s & mask) !== 0;
        if (here) {
            if (i < 0 || !ok(hist[i])) return false;
            continue;
        }
        while (i >= 0 && !ok(hist[i])) i--;
        if (i < 0) return false;
        i--;
    }
    return true;
}

/* The guards a live fight can answer: the distance tests against the real
 * distance, `vs` passes, and the en_flag (+0x5B8) tests read `en`, the bits
 * of it the engine works out (enFlag); the other flags read clear. */
function guardsPass(e, dist, en) {
    return e.guards.every(([g, v]) => {
        if (g === 'en_set') return (en >>> v & 1) === 1;
        if (g === 'en_clear') return (en >>> v & 1) === 0;
        if (g.endsWith('_clear')) return true;
        if (g === 'nearer_than') return dist < v;
        if (g === 'further_than') return dist > v;
        return g === 'vs';
    });
}

/* en_down_attack, which the down attacks' entries want set: bit 5 of
 * en_flag in StF and FV, bit 11 in VF2 (the matcher's op 7). get_en_info
 * sets it from the other's mot_kind (+0x1A4; StF 0x193DC, FV 0x19810, VF2
 * 0x188AC): never while it rises (bit 15) or attacks (bit 8); on its down
 * pose (bit 16), or its ukemi (mot_kind2 bit 2, StF +0x70C, FV +0x720; no
 * ukemi here); else on mk_down (bit 14) unless it is in the air (bit 4)
 * while this fighter's frames left in the air (+0x5BC) are not 0. So a
 * knock-down's fall (mk_air and mk_down in all three) already counts.
 * mot_kind is the motion's motd_kind as the setup reader loads it (StF
 * 0x1B4D8, FV 0x1B964, VF2 0x1A318: mk_attack with mk_rise reads as the
 * down pose). VF2 also sets it on any fighter under a debug setting
 * (0x50016C+0x3351 bit 6 with the other's +0 bit 29), which is not here.
 * `kind` is the other's motd_kind, null when its game has none (Shenmue):
 * then `lying` stands in. */
const MK_AIR = 1 << 4, MK_ATTACK = 1 << 8, MK_DOWN = 1 << 14, MK_DOWN_POSE = 1 << 16;
export function enFlag(game, { kind, lying, inAir }) {
    const down = kind == null ? lying
        : !(kind & (MK_RISE | MK_ATTACK)) && (!!(kind & MK_DOWN_POSE) || (!!(kind & MK_DOWN) && !(kind & MK_AIR && inAir)));
    return down ? 1 << (game === 'vf2' ? 11 : 5) : 0;
}

/* A counter: attack_hit (StF 0x2B1A4, FV 0x2633C, VF2 0x22A28) counts one
 * when the fighter hit has mk_attack in its mot_kind, which every strike's
 * motd_kind carries and play_motion clears at follow1 (+0x80A; StF 0x1BEA0,
 * FV 0x1C1D8, VF2 0x1AC50): from the strike's first frame to its cancel.
 * VF2 and FV deal half again, d * 3 >> 1. StF first adds a quarter of the
 * one hit's own motd_damage (+0x822), on its own scale; there a hit on a
 * limb (its struck parts, +0x6F0, in 0xD9B0) is the smaller "smlcntr",
 * (d + (own >> 3)) * 5 / 4, which needs the part the coprocessor says was
 * struck, so here every StF counter is the full one. The attacker's game
 * decides; `own` is null when the one hit is not StF's (0 here). `kind` is
 * null for a fighter whose game has no mot_kind (Shenmue): its moves count
 * to their cancel, and its counters deal VF2's. */
export { MK_ATTACK, MK_AIR, MK_DOWN, MK_DOWN_POSE };
export function isCounter(kind, coma, timing) {
    return !!timing && coma < timing.cancel && (kind == null || !!(kind & MK_ATTACK));
}
export function counterDamage(game, a, own) {
    if (game !== 'stf') return (a.damage * 3) >> 1;
    const raw = ((a.raw + ((own ?? 0) >> 2)) * 3) >> 1;
    return stfScale(raw);
}

/* A blow in the air: attack_hit (StF 0x2B298 "air", FV 0x26380) deals half
 * again, d * 3 >> 1, when the fighter hit has mk_air and not mk_down in its
 * mot_kind, after a counter and ukemi (which take it instead). mot_kind is
 * the motion's motd_kind (set_mot_dat, StF 0x1B4FC), and the jump handler
 * adds mk_air at take-off (fix_hara: StF ACT_RC_JUMP 0x140CC, FV 0x14508);
 * engine.js airKind. VF2's (0x22B6C) gives way on a combo's first hit to a
 * d * 5 / 4 that needs the struck part (+0x6D4 not in 0xD9B0), so VF2 is
 * left as it was. null: no change. */
export function airDamage(game, a, kind) {
    if ((game !== 'stf' && game !== 'fv') || (kind & (MK_AIR | MK_DOWN)) !== MK_AIR) return null;
    return game === 'stf' ? stfScale((a.raw * 3) >> 1) : (a.damage * 3) >> 1;
}

/* StF's mot_kind at frame `coma` of a motion `frames` long. set_mot_dat
 * (0x1B4EC) loads motd_kind, mk_rise on a strike made mk_down_pose;
 * play_motion clears that mk_down_pose at the hit frame (+0x808, 0x1BE78)
 * and, from follow1 (+0x80A, 0x1BEA0; the motion's length without op 2),
 * mk_attack, mk_down_pose and bit 26 (0x4010100), and mk_rise on a strike;
 * play ops 5, 6 and 7 (0x1C29C) set, clear and flip byte 3's bit at their
 * frame. A fall (motion 225) is mk_down until its op 5 makes it mk_down_pose
 * at 64, as it comes to lie. */
const PLAY_SET = 5, PLAY_CLR = 6, PLAY_FLIP = 7;
function stfKindAt(rom, id, coma, frames) {
    const s = stfSetupOps(rom, id);
    if (!s) return 0;
    let k = s.kind;
    const strike = !!(k & MK_ATTACK), rising = strike && !!(k & MK_RISE);
    if (rising) k = (k & ~MK_RISE) | MK_DOWN_POSE;
    const t = readMotionTiming(rom, id);
    const ev = [];
    if (rising && t) ev.push({ frame: t.hit, f: (x) => x & ~MK_DOWN_POSE });
    ev.push({ frame: t?.cancel ?? frames, f: (x) => (strike ? x & ~MK_RISE : x) & ~0x4010100 });
    for (const o of s.play) {
        const bit = 1 << rom.maincpu[o.at + 3];
        if (o.op === PLAY_SET) ev.push({ frame: o.frame, f: (x) => x | bit });
        else if (o.op === PLAY_CLR) ev.push({ frame: o.frame, f: (x) => x & ~bit });
        else if (o.op === PLAY_FLIP) ev.push({ frame: o.frame, f: (x) => x ^ bit });
    }
    ev.sort((a, b) => a.frame - b.frame);
    for (const e of ev) if (e.frame <= coma) k = e.f(k);
    return k;
}

/* A blow on a fighter going down: StF's attack_hit "down" (0x2B238) takes a
 * quarter off when the fighter hit's mot_kind has mk_down and not
 * mk_down_pose (a fall before it lies), after a counter and ukemi. FV's
 * and VF2's have no such step: their only quarter off is "tender" (FV
 * 0x263D8, VF2 0x22B30), which needs the struck part. null: no change. */
export function downDamage(game, a, kind) {
    if (game !== 'stf' || (kind & (MK_DOWN | MK_DOWN_POSE)) !== MK_DOWN) return null;
    return stfScale(a.raw - (a.raw >> 2));
}

/* A knock-down: after the damage, attack_hit (StF 0x2B41C, FV 0x26508, VF2
 * 0x22C84) plays the knock-down (the picker's category 4) and not the hit
 * when the fighter hit is going down or lying (mk_down, mk_down_pose) or in
 * the air (mk_air), in VF2 also on its hands (mk_sakadachi, bit 26); when
 * the strike's word (+0x828) has bit 14; unless that word has bit 10, when
 * the damage is 50 or more (VF2 30), when the strike has ap 1 and the one
 * hit mk_gacha (bit 24), and in VF2 when the word has bit 8 and the one hit
 * is not crouching (mk_syagami); and when the blow takes the last of its
 * energy (the caller's). The attacker's game decides, on its own damage
 * scale (StF's out of 140, which stfScale keeps in order); `damage` is the
 * blow's after counter, down and air. Here: ukemi (StF and FV) is not
 * followed, nor StF's ketchup in its last-energy test, nor the attacker's
 * mk_ride_on, which turns the knock-down into a down hit (category 5); a
 * game with no strike word (Shenmue) knocks down at 40. */
const MK_GACHA = 1 << 24, MK_SAKADACHI = 1 << 26;
const KD_ALWAYS = 1 << 14, KD_NO_DAMAGE = 1 << 10, KD_STANDING = 1 << 8;
export function knocksDown(game, a, damage, kind, crouch) {
    if (game !== 'stf' && game !== 'fv' && game !== 'vf2') return damage >= 40;
    if (kind & (MK_DOWN | MK_DOWN_POSE | MK_AIR)) return true;
    if (game === 'vf2' && kind & MK_SAKADACHI) return true;
    const w = a.word ?? 0;
    if (w & KD_ALWAYS) return true;
    if (w & KD_NO_DAMAGE) return false;
    if (damage >= (game === 'stf' ? stfScale(50) : game === 'vf2' ? 30 : 50)) return true;
    if (game === 'vf2' && w & KD_STANDING && !crouch) return true;
    return a.ap === 1 && !!(kind & MK_GACHA);
}

/** The entry a press lands on: the first, in the engine's order, whose tests
 * pass. `hist` is the stick since the last press, collapsed, oldest first.
 * `ctx` is the key's high byte the caller is in (0 on the ground; the jump's
 * contexts, see the engine); `en` the fighter's en_flag (enFlag). */
export function matchPress(entries, btn, hist, dist, { ctx = 0, en = 0 } = {}) {
    return entries?.find((e) => (e.key & 0xff) === btn && (e.key >> 8) === ctx
        && guardsPass(e, dist, en) && satisfies(e, hist)) ?? null;
}

/* ---- the fighters -------------------------------------------------------- */

/*
 * A fighter, the same shape whichever game it comes from:
 *   name, game ('vf2' | 'fv' | 'stf'), rom
 *   act(name)          the motion the named action plays, as {rom, motion}
 *   moves              {root, tables} for matchPress
 *   timing(id)         {hit, cancel, end} of the fighter's own motion id
 *   attack(id)         {level, damage, kind, side, finish} strike, {victim,
 *                      damage} throw, or null (finish: FV's finish kind)
 *   reaction(a, how)   the motion this fighter plays under attack `a`
 *   takeoff(id)        a jump motion's take-off frame (0 if none)
 *   riseWindow(id)     a get-up's {cancel, window} (FV, StF), else null
 *   motKind(id)        its motion's motd_kind (+0x804), the mot_kind bits
 *   kindAt(id, f, n)   StF: its mot_kind (+0x1A4) at frame f of n (stfKindAt)
 *   flight(small)      the frames a jump flies (+0x5BE)
 *   flies              StF: the jump flies by gravity, not by its motion
 *   airHold(id)        an air attack's hold, frames left in the air (+0x5C0)
 *   createBody()       a drawable body: pose(ref, frame) -> {mats, parts, pose}
 *   look               what its material needs (js/render.js)
 * and, where they are not the VF2/StF ones:
 *   motion(id)         its own motion by id (else motionOf(rom, id))
 *   size               its height to Akira's, for its reach and its body (1)
 * A game that brings its own fighters (Shenmue's Ryo, js/ryo.js) names its
 * maker as game.makeFighter.
 */
export function makeFighter(games, entry) {
    const game = games[entry.game];
    if (game.makeFighter) return game.makeFighter(games, entry);
    return game.kind === 'stf' ? stfFighter(game, entry) : vfFighter(game, entry);
}

function vfFighter(game, entry) {
    const { rom } = game;
    const c = per(rom);
    c.bodies ??= readFighters(rom);
    const body = c.bodies[entry.index];
    const slots = ACTION_SLOTS[game.key];
    const C = rom.game.rig.fighters.commands;
    const root = rom.mainCpuView.getUint32(C.table + body.char * 4, true);
    const moves = programMoves(rom, root, C.isa);

    /* The fighter's own texture pair: the program names it by its first
     * textured part (js/texture.js programTextureSets); the second is the
     * one its faces' palette is baked under. */
    const first = body.parts.map((p) => p.model).filter(Boolean)
        .find((id) => programTextureSets(rom, id, decodeModel(rom, id))?.how === 'fighter')
        ?? body.parts.find((p) => p.model)?.model;
    const sets = programTextureSets(rom, first, decodeModel(rom, first))?.sets ?? [];
    const set = sets[1] ?? sets[0] ?? 0;

    const decode = (key) => {
        const k = `${key}@${set}`;
        if (!c.models.has(k)) {
            rom.paletteSet = set;
            c.models.set(k, decodeKey(rom, key));
        }
        return c.models.get(k);
    };

    const act = (name) => ({ rom, motion: motionOf(rom, body.actions[slots[name]]) });

    return {
        name: entry.name, game: game.key, rom, kind: 'vf2', entry,
        act, moves,
        timing(id) {
            const a = attackOf(rom, id);
            return a?.times ? { hit: a.times[0], cancel: a.times[1], end: a.times[2] } : null;
        },
        attack(id) { return vfAttack(rom, id, game.key); },
        takeoff(id) { return takeoffOf(vfSetupOps(rom, id)); },
        airHold(id) { return airHoldOf(vfSetupOps(rom, id)); },
        flight(small) { return vfFlight(rom, game.key, body.index, small); },
        riseWindow(id) { return game.key === 'fv' ? riseWindowOf(vfSetupOps(rom, id)) : null; },
        motKind(id) { return vfSetupOps(rom, id)?.kind ?? 0; },
        reaction(a, how) {
            const kind = a.game === game.key && a.kind != null ? a.kind : game.kindFor(a);
            const cat = REACTIONS.find((r) => r.key === how);
            const id = reactionMotion(rom, { kind, side: a.side ?? 0 }, cat, { crouch: a.crouch, behind: a.behind });
            return id == null ? null : { rom, motion: motionOf(rom, id) };
        },
        look: { kind: 'vf2', sets, set, fighter: body.index },
        createBody() {
            const own = { ...body };
            const osage = rom.game.osage ? readOsage(rom, body.index, { char: body.char ?? body.index, upperBroken: false }) : null;
            const segs = (osage?.chains ?? []).flatMap((ch) => ch.segments).filter((s) => s.model);
            let sim = null;
            return {
                decode,
                pose(ref, frame) {
                    const foreign = ref.rom !== rom;
                    const p = foreign ? foreignVfPose(rom, own, ref, frame) : poseFighter(rom, own, ref.motion, frame);
                    const mats = p.matrices;
                    const draws = body.parts.map((pt) => (pt.model ? [pt.model] : []));
                    if (p.chest != null) draws[1] = p.chest > 0 ? [p.chest] : [];
                    if (p.hips != null) draws[9] = p.hips > 0 ? [p.hips] : [];
                    for (const [slot, model] of p.hands ?? []) draws[slot] = [model];
                    const parts = [];
                    draws.forEach((list, s) => list.forEach((model) => {
                        const mat = typeof model === 'number' ? partMaterial(rom, model) : null;
                        parts.push({ key: mat == null ? model : `${model}#${mat.toString(16)}`, matrix: mats[s] });
                    }));
                    (body.extras ?? []).forEach((e, i) => {
                        if (p.shown?.[i] !== false && p.extras?.[i]) parts.push({ key: e.model, matrix: p.extras[i] });
                    });
                    if (body.midriff) {
                        rom.paletteSet = set;
                        const d = decodeModel(rom, null, null, skinMesh(body.midriff, mats));
                        if (d) parts.push({ dynamic: d, matrix: mats[body.midriff.hips] });
                    }
                    if (osage && p.pose) {
                        if (!sim) { sim = createOsageSim(osage); settleOsage(sim, p.pose, {}); }
                        const placed = stepOsage(sim, p.pose, {});
                        segs.forEach((s, i) => { if (placed[i]) parts.push({ key: s.model, matrix: viewerMatrix(placed[i]) }); });
                    }
                    return { mats, parts };
                },
            };
        },
    };
}

/* Another game's motion on a VF2/FV body: sampled from its own ROM, solved on
 * this fighter's rig, without the playback state poseFighter keeps by motion
 * index (blends, hands, the chest), which would read the wrong records. */
function foreignVfPose(rom, body, ref, frame) {
    const sample = sampleMotion(ref.rom, ref.motion, Math.max(1, Math.min(frame, ref.motion.frames)));
    rom.vf2Rig ??= standardRig(rom);
    const pose = buildPose(rom.vf2Rig, sample, { levelFeet: true });
    /* poseFighter puts the rig on the fighter's own bone lengths; the shared
     * rig (standardRig) is close enough for a motion that is not its own. */
    return { matrices: poseMatrices(pose), pose, extras: [], shown: [] };
}

/* A model key: a number, or `model#material` for one drawn in another
 * material (js/vf2fighters.js partMaterial). */
function decodeKey(rom, key) {
    if (typeof key === 'number') return decodeModel(rom, key);
    const [model, matPtr] = key.split('#');
    const entry = readModelEntry(rom, +model);
    const at = meshOffsetOf(rom, entry);
    return entry.meshPtr === 0 || at < 0 ? null
        : decodeModel(rom, +model, null, { bytes: rom.polygons.subarray(at), uvPtr: entry.uvPtr, matPtr: parseInt(matPtr, 16) });
}

/* A VF2/FV strike: op 4's kind word (js/reactions.js), its byte 1 the
 * attack part, byte 2 the level (ap), byte 3 the damage and, in FV, byte 0xE
 * the finish kind (+0x874; 3 breaks the cage, docs/FV-STAGES.md). A throw:
 * op 5's victim motion and damage, and the victim motion's own hits. */
const FINISH_AT = 0xe;
const same = (d) => d;
function vfAttack(rom, id, key) {
    const a = attackOf(rom, id);
    if (!a) return null;
    const s = vfSetupOps(rom, id);
    if (a.victim != null) {
        const op = s?.ops.find((o) => o.op === 5);
        return { victim: a.victim, damage: op ? s.dv.getUint8(op.at + 3) : 0, hits: throwHits(vfSetupOps(rom, a.victim), same) };
    }
    const op = s?.ops.find((o) => o.op === 4);
    const ap = op ? s.dv.getUint8(op.at + 2) : MID;
    const part = op ? s.dv.getUint8(op.at + 1) : 0;
    return { kind: a.kind, side: a.side, ap, level: strikeLevel(ap), down: hitsDown(ap, false),
        part, mask: partMask(rom, key, part), damage: op ? s.dv.getUint8(op.at + 3) : 10,
        word: op ? s.dv.getUint16(op.at + rom.game.rig.reactions.strike, true) : 0,
        finish: key === 'fv' && op ? s.dv.getUint8(op.at + FINISH_AT) : 0 };
}

/* The frames a jump flies (+0x5BE), as the jump's commit takes them from the
 * character record (+0x190): StF's (sub_1305C 0x1328C) at +0x20, byte 0 for
 * the jump, byte 1 for the small one (the action's bit 18); FV's (0x134F0)
 * the same at +0x34; VF2's (0x14828) byte +0x4C, the small jump 32. StF's
 * jump flies by gravity, not by its motion. */
const STF_CHAR_PARTS = 0x000c5268;
function stfFlight(rom, index, small) {
    const dv = rom.mainCpuView;
    const record = dv.getUint32(progAddr(rom, STF_CHAR_PARTS) + index * 4, true);
    return dv.getUint8(dv.getUint32(record + 0x20, true) + (small ? 1 : 0));
}
function vfFlight(rom, key, index, small) {
    const u32 = (addr) => { const r = resolveData(rom, addr); return r.view.getUint32(r.off, true); };
    const u8 = (addr) => { const r = resolveData(rom, addr); return r.view.getUint8(r.off); };
    const record = u32(rom.game.rig.fighters.records + index * 4);
    if (key === 'vf2') return small ? 32 : u8(record + 0x4c);
    return u8(u32(record + 0x34) + (small ? 1 : 0));
}

function stfFighter(game, entry) {
    const { rom } = game;
    const c = per(rom);
    const ch = readCharacter(rom, entry.index);
    const slots = ACTION_SLOTS.stf;
    const moves = readMoves(rom, entry.index);
    const damage = new Map();
    for (const es of moves?.tables.values() ?? []) for (const e of es) if (e.damage) damage.set(e.motion & MOTION_ID, e.damage);

    const decode = (key) => {
        if (!c.models.has(key)) {
            const [id, eye] = String(key).split(':');
            const points = eye != null ? ch.face.eyePoints[+eye] : null;
            c.models.set(key, decodeModel(rom, +id, points ?? null));
        }
        return c.models.get(key);
    };
    const keyOf = (id, eye) => (eye != null && ch.face.eyePoints[eye] ? `${id}:${eye}` : id);

    const act = (name) => ({ rom, motion: motionOf(rom, ch.motions[slots[name]]) });

    return {
        name: entry.name, game: 'stf', rom, kind: 'stf', entry,
        act, moves,
        timing(id) { return readMotionTiming(rom, id); },
        attack(id) { return stfAttack(rom, id, damage); },
        takeoff(id) { return takeoffOf(stfSetupOps(rom, id)); },
        airHold(id) { return airHoldOf(stfSetupOps(rom, id)); },
        riseWindow(id) { return riseWindowOf(stfSetupOps(rom, id)); },
        motKind(id) { return stfSetupOps(rom, id)?.kind ?? 0; },
        kindAt(id, coma, frames) { return stfKindAt(rom, id, coma, frames); },
        flight(small) { return stfFlight(rom, entry.index, small); },
        flies: true,
        reaction(a, how) {
            const id = how === 'down' ? STF_REACT.down
                : how === 'guard' ? ch.motions[slots[a.crouch ? 'crouchGuard' : 'guard']]
                    : a.crouch ? STF_REACT.crouch
                        : (a.damage ?? 0) >= 25 || how === 'counter' ? STF_REACT.heavy : STF_REACT.light;
            return { rom, motion: motionOf(rom, id) };
        },
        look: { kind: 'stf', fighter: entry.index },
        createBody() {
            const osage = readOsage(rom, entry.index);
            const segs = (osage?.chains ?? []).flatMap((x) => x.segments).filter((s) => s.model);
            let sim = null;
            return {
                decode,
                pose(ref, frame) {
                    const sample = sampleMotion(ref.rom, ref.motion, Math.max(1, Math.min(frame, ref.motion.frames)));
                    const pose = buildPose(ch.skeleton, sample);
                    const mats = poseMatrices(pose);
                    const parts = [];
                    ch.slots.forEach((s, i) => { if (s.model) parts.push({ key: s.model, matrix: mats[i] }); });
                    ch.face.eyes.forEach((id, i) => { if (id) parts.push({ key: keyOf(id, i), matrix: mats[S.HEAD] }); });
                    if (segs.length) {
                        if (!sim) { sim = createOsageSim(osage); settleOsage(sim, pose, {}); }
                        const placed = stepOsage(sim, pose, {});
                        segs.forEach((s, i) => { if (placed[i]) parts.push({ key: s.model, matrix: viewerMatrix(placed[i]) }); });
                    }
                    return { mats, parts };
                },
            };
        },
    };
}

/* An StF strike: op 4 as VF2's (byte 1 the part, 2 the level, 3 the
 * damage: punch 10, spin 30), out of 140. A throw: op 5's first u16, the
 * victim motion (280 throws into 281), byte 3 its damage, and the victim
 * motion's own hits; most of StF's throws deal none. */
function stfAttack(rom, id, cpuDamage) {
    const s = stfSetupOps(rom, id);
    if (!s) return null;
    const scale = stfScale;
    const thr = s.ops.find((o) => o.op === 5);
    if (thr) {
        const victim = s.dv.getUint16(thr.at + 1, true) & MOTION_ID;
        return { victim, damage: scale(s.dv.getUint8(thr.at + 3)), hits: throwHits(stfSetupOps(rom, victim), scale) };
    }
    const st = s.ops.find((o) => o.op === 4);
    if (!st) return null;
    const ap = s.dv.getUint8(st.at + 2), part = s.dv.getUint8(st.at + 1);
    const d = s.dv.getUint8(st.at + 3) || cpuDamage.get(id) || 10;
    return { ap, level: strikeLevel(ap), down: hitsDown(ap, true), part, mask: partMask(rom, 'stf', part), damage: scale(d), raw: d,
        word: s.dv.getUint16(st.at + 7, true) };
}

/* ---- one game's tables --------------------------------------------------- */

/*
 * A VF2/FV victim of another game's strike plays its own game's reaction to
 * the nearest blow its own game has: of the strikes the game's roster can
 * throw, the kind of the one at the same level whose damage is nearest.
 */
export function prepareGame(game) {
    if (game.kind === 'stf') { game.kindFor = () => 0; return game; }
    const { rom } = game;
    const c = per(rom);
    c.bodies ??= readFighters(rom);
    const C = rom.game.rig.fighters.commands;
    const R = rom.game.rig.reactions;
    const seen = new Map();
    for (const b of c.bodies) {
        const root = rom.mainCpuView.getUint32(C.table + b.char * 4, true);
        const pm = programMoves(rom, root, C.isa);
        for (const mv of pm?.moves ?? []) {
            const id = mv.motion & MOTION_ID;
            if (seen.has(id)) continue;
            const a = vfAttack(rom, id, game.key);
            if (a && a.kind != null && a.kind < R.kinds) seen.set(id, a);
        }
    }
    const strikes = [...seen.values()];
    game.kindFor = (a) => {
        const lv = a.level ?? MID;
        const pool = strikes.filter((s) => s.level === lv);
        const list = pool.length ? pool : strikes;
        let best = list[0];
        for (const s of list) if (Math.abs(s.damage - a.damage) < Math.abs(best.damage - a.damage)) best = s;
        return best?.kind ?? 0;
    };
    return game;
}
