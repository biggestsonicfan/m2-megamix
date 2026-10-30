/*
 * A Sonic the Fighters fighter (a character record), its RAM models, its
 * attacks and flight. Part of js/fighters.js.
 */
import { readCharacter } from '../../vendor/noclip/js/characters.js';
import { sampleMotion, readMotionTiming } from '../../vendor/noclip/js/motion.js';
import { buildPose, poseMatrices, viewerMatrix } from '../../vendor/noclip/js/pose.js';
import { readMoves } from '../../vendor/noclip/js/moves.js';
import { readOsage, createOsageSim, stepOsage, settleOsage } from '../../vendor/noclip/js/osage.js';
import { decodeModel } from '../../vendor/noclip/js/model.js';
import { progAddr } from '../../vendor/noclip/js/romset.js';
import { MOTION_ID, S, ACTION_SLOTS, STF_REACT, strikeLevel, hitsDown, stfScale, per, motionOf } from './rom.js';
import { stfSetupOps, partMask, takeoffOf, airHoldOf, riseWindowOf, throwHits } from './setup.js';
import { stfKindAt } from './rules.js';

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

/*
 * StF's second model directory: a part-list entry with bit 15 set is
 * `id & 0x7FFF` in the table at 0x647F000 (count, then 16-byte entries:
 * uv, material, mesh) rather than the main one (`set_obj`, 0x4E98). Its
 * pointers are all into the board's RAMs, which the boot fills once from the
 * EPROM pair IC7/IC8 (XTRA_DATA 0x6400000 = data ROM 0x1000000 on):
 * `sub_12090` texture RAM 0x8000 on from 0x6460000 and `sub_12138` 0xC000 on
 * from 0x6464000, a halfword a word, and `sub_11EF8` (geo command 5) all of
 * polygon RAM from 0x6468000, a word a word. Nothing writes those ranges
 * again. Super Sonic's head is 0x8000, Egg Minion's right arm 0x8003, 0x8004
 * (docs/RECORDS.md, The part lists).
 */
const STF_RAM_MODELS = 0x107f000;
const STF_POLYGON_RAM = 0x1068000;
const STF_TEXTURE_RAM = [{ from: 0x8000, at: 0x1060000 }, { from: 0xc000, at: 0x1064000 }];

function stfRamModel(rom, id) {
    const dv = rom.mainDataView;
    const n = id & 0x7fff;
    if (n > dv.getUint32(STF_RAM_MODELS, true)) return null;
    const e = STF_RAM_MODELS + 4 + n * 16;
    const [uvPtr, matPtr, meshPtr] = [0, 4, 8].map((o) => dv.getUint32(e + o, true));
    if (!meshPtr) return null;
    /* The same ROM with texture RAM's runs in its model table, so the
     * decoder reads the uv and material pointers (bit 23) out of them. */
    rom.stfRamRom ??= Object.assign(Object.create(rom), {
        game: { ...rom.game, modelTable: { ...rom.game.modelTable, textureRam: STF_TEXTURE_RAM } },
    });
    return decodeModel(rom.stfRamRom, null, null, { bytes: rom.mainData.subarray(STF_POLYGON_RAM + meshPtr * 4), uvPtr, matPtr });
}

export function stfFighter(game, entry) {
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
            c.models.set(key, +id & 0x8000 ? stfRamModel(rom, +id) : decodeModel(rom, +id, points ?? null));
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
