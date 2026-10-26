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
import { decodeMotion, sampleMotion, resolveData, readMotionTiming } from '../vendor/noclip/js/motion.js';
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
 * are the slots the shared engine plays.
 */
const ACTION_SLOTS = {
    vf2: { stance: 0, crouch: 1, toStand: 2, toCrouch: 5, guard: 8, guardEnd: 9, crouchGuard: 10, crouchGuardEnd: 11,
        dashF: 14, dashB: 15, walkF: 20, walkB: 22, jump: 28, down: 31, rise: 32 },
    fv: { stance: 0, crouch: 1, toStand: 2, toCrouch: 5, guard: 8, guardEnd: 11, crouchGuard: 12, crouchGuardEnd: 15,
        dashF: 18, dashB: 20, walkF: 28, walkB: 30, jump: 39, down: 42, rise: 43 },
    stf: { stance: 0, crouch: 1, toStand: 2, toCrouch: 3, guard: 5, guardEnd: 6, crouchGuard: 1, crouchGuardEnd: 2,
        dashF: 7, dashB: 9, walkF: 13, walkB: 15, jump: 33, down: 40, rise: 41 },
};

/*
 * Sonic the Fighters' common reactions: motions every character plays, which
 * no character's action table names (the fight code picks them). Hit stun
 * is 30 frames, timing 1/4/30; the knock-down drops the waist from 1.07 to
 * 0.34 and travels 2.38 back.
 */
const STF_REACT = { light: 177, heavy: 182, crouch: 221, down: 225 };

/* Hit levels, as VF2's and FV's strike op keeps them (op 4, byte 2). */
export const HIGH = 0, MID = 1, LOW = 2;

/* The energy every fighter has here. VF2's and FV's strike damage is on
 * this scale; StF's (out of 140, 0x5000A0) is scaled up to it. */
export const ENERGY = 200;
const STF_ENERGY = 140;
const THROW_DAMAGE = 50;

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
    const dv = r.view, ops = [];
    let at = r.off + R.head;
    while (at < dv.byteLength) {
        const op = dv.getUint8(at);
        if (op === 0 || op === 8 || op >= R.ops) break;
        ops.push({ op, at });
        const len = op === 0x10 ? 2 + 2 * dv.getUint8(at + 1) : rom.mainCpuView.getUint8(R.lengths + op);
        if (!len) break;
        at += len;
    }
    return { dv, ops };
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
    return { dv, ops };
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
 * distance, `vs` passes, the flag tests read clear (nothing sets them here). */
function guardsPass(e, dist) {
    return e.guards.every(([g, v]) => {
        if (g.endsWith('_clear')) return true;
        if (g === 'nearer_than') return dist < v;
        if (g === 'further_than') return dist > v;
        return g === 'vs';
    });
}

/** The entry a press lands on: the first, in the engine's order, whose tests
 * pass. `hist` is the stick since the last press, collapsed, oldest first. */
export function matchPress(entries, btn, hist, dist) {
    return entries?.find((e) => (e.key & 0xff) === btn && (e.key >> 8) === 0
        && guardsPass(e, dist) && satisfies(e, hist)) ?? null;
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
        attack(id) { return vfAttack(rom, id, game.key === 'fv'); },
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

/* A VF2/FV strike: op 4's kind word (js/reactions.js), its byte 2 the level
 * (0 high, 1 mid, 2 low; FV's 4 and 5 are its low sweeps), byte 3 the
 * damage and, in FV, byte 0xE the finish kind (+0x874; 3 breaks the cage,
 * docs/FV-STAGES.md). A throw: op 5's victim motion. */
const FINISH_AT = 0xe;
function vfAttack(rom, id, fv) {
    const a = attackOf(rom, id);
    if (!a) return null;
    if (a.victim != null) return { victim: a.victim, damage: THROW_DAMAGE };
    const s = vfSetupOps(rom, id);
    const op = s?.ops.find((o) => o.op === 4);
    const lv = op ? s.dv.getUint8(op.at + 2) : MID;
    return { kind: a.kind, side: a.side, level: lv > LOW ? LOW : lv, damage: op ? s.dv.getUint8(op.at + 3) : 10,
        finish: fv && op ? s.dv.getUint8(op.at + FINISH_AT) : 0 };
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

/* An StF strike: op 4, byte 3 after the opcode its damage (punch 10, spin
 * 30), out of 140; the level is not known for certain, so it comes from the
 * input (see the engine). A throw: op 5's first u16, the victim motion
 * (280 throws into 281), and byte 3 its damage. */
function stfAttack(rom, id, cpuDamage) {
    const s = stfSetupOps(rom, id);
    if (!s) return null;
    const scale = (d) => Math.round((d * ENERGY) / STF_ENERGY);
    const thr = s.ops.find((o) => o.op === 5);
    if (thr) return { victim: s.dv.getUint16(thr.at + 1, true) & MOTION_ID, damage: scale(s.dv.getUint8(thr.at + 3) || 30) };
    const st = s.ops.find((o) => o.op === 4);
    if (!st) return null;
    const d = s.dv.getUint8(st.at + 3) || cpuDamage.get(id) || 10;
    return { level: null, damage: scale(d) };
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
            const a = vfAttack(rom, id);
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
