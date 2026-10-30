/*
 * A Virtua Fighter 2 or Fighting Vipers fighter (a fighter record), its
 * attacks, throws and flight, and one game's tables (prepareGame).
 * Part of js/fighters.js.
 */
import { readFighters, poseFighter, partMaterial, standardRig } from '../../vendor/noclip/js/vf2fighters.js';
import { sampleMotion, resolveData } from '../../vendor/noclip/js/motion.js';
import { buildPose, poseMatrices, viewerMatrix } from '../../vendor/noclip/js/pose.js';
import { programMoves } from '../../vendor/noclip/js/moves.js';
import { attackOf, reactionMotion, REACTIONS } from '../../vendor/noclip/js/reactions.js';
import { readOsage, createOsageSim, stepOsage, settleOsage } from '../../vendor/noclip/js/osage.js';
import { decodeModel } from '../../vendor/noclip/js/model.js';
import { readModelEntry, meshOffsetOf } from '../../vendor/noclip/js/romset.js';
import { programTextureSets } from '../../vendor/noclip/js/texture.js';
import { skinMesh } from '../../vendor/noclip/js/bodies.js';
import { MOTION_ID, ACTION_SLOTS, MID, strikeLevel, hitsDown, per, motionOf } from './rom.js';
import { vfSetupOps, partMask, takeoffOf, airHoldOf, riseWindowOf, throwHits } from './setup.js';

export function vfFighter(game, entry) {
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
        throwRanges: game.key === 'vf2' ? vfThrowRanges(rom, body.index) : null,
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

/* VF2's throw ranges (throwFlags): the character record's +0x18..+0x24. */
function vfThrowRanges(rom, index) {
    const u32 = (addr) => { const r = resolveData(rom, addr); return r.view.getUint32(r.off, true); };
    const f32 = (addr) => { const r = resolveData(rom, addr); return r.view.getFloat32(r.off, true); };
    const record = u32(rom.game.rig.fighters.records + index * 4);
    return [0x18, 0x1c, 0x20, 0x24].map((o) => f32(record + o));
}
function vfFlight(rom, key, index, small) {
    const u32 = (addr) => { const r = resolveData(rom, addr); return r.view.getUint32(r.off, true); };
    const u8 = (addr) => { const r = resolveData(rom, addr); return r.view.getUint8(r.off); };
    const record = u32(rom.game.rig.fighters.records + index * 4);
    if (key === 'vf2') return small ? 32 : u8(record + 0x4c);
    return u8(u32(record + 0x34) + (small ? 1 : 0));
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
