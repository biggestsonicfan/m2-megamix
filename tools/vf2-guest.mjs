/*
 * Virtua Fighter 2's Akira as a guest on the Sonic the Fighters board
 * (docs/STF-BOARD-AKIRA.md, "Akira on StF's own code"). He plays as StF
 * character 6 (Knuckles, whom Megamix does not use; 32 is his player 2) and
 * runs StF's own fight code: everything of his that StF's code reads is
 * converted into StF's formats and put into the guest tables
 * (tools/lift-stf.py GUESTS) and the guest heap after them.
 *
 * What goes in, all from VF2's ROMs:
 *   - his motions (the ones his actions, his command program and their
 *     setups reach), as new StF motion ids from 519 on: the blocks scaled
 *     to his size on StF (SCALE), the setups converted (op lengths and
 *     numbers differ);
 *   - his command program, converted op by op;
 *   - his records (StF's, Knuckles', with his parts, player 2's and his
 *     actions), his skeleton, his hands and his head;
 *   - his midriff, the band between his hips and his chest (the board's
 *     guest table `midriff`; megamix.c builds and draws it);
 *   - his models under free StF model ids: the meshes in the polygon ROM's
 *     empty run, the material and UV streams and the textures as
 *     tools/pack-akira.mjs packs them.
 */
import { readFighters } from '../vendor/noclip/js/vf2fighters.js';
import { resolveData } from '../vendor/noclip/js/motion.js';
import { readModelEntry, meshOffsetOf } from '../vendor/noclip/js/romset.js';
import { packAkira } from './pack-akira.mjs';

const MAIN_DATA = 0x02000000;
export const CHR = 6;                    /* StF's Knuckles */
const PLAYER2 = 26;
const FIRST_MOTION = 519;                /* StF's own are 0..518 */
const MOTION_ID = 0x1fff;

/* VF2 (program 0x1D1FC: the command programs by character; main_data the
 * setups and the motion list; noclip games.js vf2) */
const VF2_COMMANDS = 0x1d1fc;
const VF2_SETUPS = 0x0200d34c, VF2_SETUP_LENGTHS = 0x1b7f6, VF2_SETUP_OPS = 0x12;
const VF2_MOTIONS = 0x02120004, VF2_MOTION_COUNT = 1360;
const VF2_NATIVE_TAIL = 0x1d194;
/* 30 kinds of hit, each a list of 40 reactions: category (guard, guard,
 * hit, counter hit, knock-down) * 8, +4 crouching, +2 from behind, +side. */
const VF2_REACTIONS = 0x0201ccfc;
const VF2_RANGES = 0x18;                /* record +0x18..+0x24: near, far, low, behind (init_fix) */
const VF2_WEIGHT = 0x2c;                 /* record +0x2C: the weight, a float (init_fix) */
const VF2_JUMP_TIME = 0x4c;              /* record +0x4C: the jump's frames (V 0x1482C) */
const VF2_HANDS = 0x3c;                  /* record +0x3C: 32 shapes a hand, slot 5 then 8 at +0x180 */
const SKELETON = 4, SKELETON_BYTES = 15 * 12;
/* Record +0x38: the midriff (noclip TECHNICAL.md, "The midriff"): +8 its
 * model, +0x70 the chest's ring (8 points in the chest's frame), +0xD0 the
 * link count, +0xD4 the links (0x28 bytes: an attribute, a normal, two
 * points in the hips' frame), a closing word, then two index bytes a link
 * (8 on: a chest point, index - 8; below 8: the link's own point). */
const VF2_MIDRIFF = 0x38;
const MIDRIFF = { model: 8, ring: 0x70, ringPoints: 8, count: 0xd0, links: 0xd4, link: 10, first: 8 };
/* The collision balls, one set for the cast (0x176A0): their points (x, y,
 * z, r), a list pointer by part (bytes, ball * 4) and a count by part. */
const VF2_BALLS = { points: 0x020078a8, count: 30, lists: 0x02007bee, counts: 0x02007c68 };
/* The bones the pose is solved on, one table for the cast (program ROM). */
const VF2_RIG = 0x296a0;

/* The polygon ROM's empty run (docs/STF-BOARD-AKIRA.md, "What fits where"). */
const POLY_RUN = 0xec2578, POLY_RUN_END = 0xec2578 + 0x13da88;

/* ---- formats --------------------------------------------------------------- */

/* The move scripts after a setup (play_motion's ops). VF2's lengths, and
 * what each becomes on StF: the same op, another (`to`, StF length the same
 * unless `stf`), or nothing. `motion`: where a motion id is. */
const PLAY = [0, 3, 3, 13, 7, 4, 4, 4, 4, 4, 9, 7, 4, 4, 7, 3, 4, 4, 7, 5, 7, 4, 5, 6];
const PLAY_TO = {
    0x04: null, 0x09: null, 0x10: null, 0x11: null, 0x14: null,
    0x12: 'hand', 0x13: 0x12, 0x15: 0x14, 0x16: 0x15, 0x17: 0x16,
};
const PLAY_MOTION = { 0x0a: 5, 0x0b: 5, 0x17: 4 };

/* Command program op lengths (VF2's; noclip moves.js OP_LENGTH with VF2's
 * own 5, 0x32 and 0x33). */
const OP_LENGTH = [
    3, 3, 2, 4, 2, 5, 5, 2, 2, 2, 2, 2, 2, 5, 7, 5,
    1, 5, 4, 5, 5, 9, 3, 1, 1, 1, 5, 5, 2, 4, 2, 4,
    2, 5, 2, 2, 3, 2, 1, 5, 13, 2, 2, 3, 2, 1, 1, 2,
    2, 2, 5, 5,
];

/* Commit types (the word's top byte): VF2's -> StF's. The types StF does not
 * have play an action of his instead (type 0, the action's motion). */
const COMMIT_TYPE = {
    0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 9: 6, 0xa: 7, 0xc: 8, 0xd: 9, 0xe: 0xa, 0xf: 0xb, 0x10: 0xc, 0x11: 0xd,
    0x15: 0x11, 0x16: 0x12, 0x17: 0x13, 0x18: 0x14, 0x19: 0x15, 0x1a: 0x16, 0x1b: 0x17, 0x1c: 0x18,
    0x1f: 0x19, 0x20: 0x1a,
};
const COMMIT_ACTION = { 7: 18, 8: 19, 0x12: 14, 0x13: 15, 0x1d: 16, 0x1e: 17 };

/* StF's 52 action slots, each played with one of VF2's (its number) or a VF2
 * motion ({ motion }), matched by what the motion does: stance, crouch,
 * turns, steps, dashes, jumps, falls and getting up. StF's own flag bits stay. */
const STF_ACTIONS = [
    0, 1, 2, 5, 1, 8, 9, 14, 14, 15,                       /*  0 stance, crouch, steps */
    15, 21, 24, 20, 16, 22, 17, 20, 16, 21,                /* 10 walks, crouch dashes */
    16, 22, 17, 23, 17, 81, 82, 83, 28, 28,                /* 20 run, jumps */
    29, 29, 1, 28, 28, 29, 0, 29, { motion: 0x2ce }, { motion: 0x2ce },  /* 30 landing, falls */
    31, 36, 40, 50, 60, 51, 54, 34, 38, 35,                /* 40 down, getting up */
    39, 54,
];

/* ---- helpers --------------------------------------------------------------- */

const hex = (v) => '0x' + v.toString(16).toUpperCase();

function bytes(rom, addr, n) {
    const r = resolveData(rom, addr);
    if (!r) throw new Error(`VF2 ${hex(addr)} is not in its data ROMs`);
    return r.data.subarray(r.off, r.off + n);
}

/* A motion block's channels (noclip motion.js decodeMotion): each one's
 * type, and where its values start, from the block's start; and the block's
 * length. */
const ZERO = 3, LINEAR = 5, HERMITE = 6;
function motionChannels(d, off) {
    const types = [];
    for (let j = 0; j < 20; j++) {
        const b = d[off + 2 + j], top2 = (b >> 6) & 3;
        for (let a = 0; a < 3; a++) types.push(top2 === 0 ? ((b >> (a * 2)) & 3) + 3 : top2 - 1);
    }
    const counts = [];
    let n = 0;
    for (const t of types) counts.push(t === LINEAR || t === HERMITE ? d[off + 22 + n++] : 0);
    let p = (22 + n + 3) & ~3;
    types.forEach((t, i) => { if (t === LINEAR || t === HERMITE) p += counts[i] * 4; });
    const values = [];
    types.forEach((t, i) => {
        values.push(p);
        p += t === ZERO ? 0 : t === LINEAR ? counts[i] * 4 : t === HERMITE ? counts[i] * 12 : 4;
    });
    return { types, counts, values, length: p };
}

/* ---- his size ---------------------------------------------------------------- */

/* StF draws its world about twice as big as VF2 and Fighting Vipers do, so
 * Akira as VF2 has him stands well short of Sonic. Fighting Vipers has a
 * Sonic of its own, beside whom he is sized by height: Bahn is 6'1", Akira
 * 5'11". The tops of their stances, model to model (js/fighters.js poses,
 * frame 1): Bahn 1.670 and Sonic 1.309 on FV, Akira 1.638 on VF2, Sonic
 * 2.676 on StF. So Akira is 71/73 of Bahn on Sonic's scale:
 *   (71 / 73) * (1.670 / 1.309) * (2.676 / 1.638) = 2.03
 * Everything of his that is a length is scaled about his feet: the mesh
 * points, the skeleton, and the motions' eight float objects (the body's
 * place and the aim and IK targets), so StF's own code poses, steps and hits
 * with him at that size. */
export const SCALE = (71 / 73) * (1.670 / 1.309) * (2.676 / 1.638);

function scaleFloats(b, at, n, k = SCALE) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < n; i++) v.setFloat32(at + i * 4, v.getFloat32(at + i * 4, true) * k, true);
}

/* A mesh's points (the two in each 40-byte record; noclip model.js). */
function scaleMesh(b) {
    for (let p = 0; ; p += 40) {
        scaleFloats(b, p, 6);
        if (((b[p + 24] | (b[p + 25] << 8)) & 3) === 0) return b;
    }
}

/* A motion's float objects (12..19, channels 36 on): their values, and a
 * Hermite key's two tangents with them. Not a latched constant (types 0..2):
 * those are angles the pose code holds, not points (object 17, the pelvis's
 * roll, is (0, 0, 16384.0), a quarter turn, in all but two of VF2's motions;
 * scaled, it rolled his pelvis half a turn and his stance came apart). */
function scaleMotion(b, k = [SCALE, SCALE, SCALE]) {
    const c = motionChannels(b, 0);
    for (let i = 36; i < 60; i++) {
        const t = c.types[i];
        if (t <= ZERO) continue;
        scaleFloats(b, c.values[i], t === LINEAR ? c.counts[i] : t === HERMITE ? c.counts[i] * 3 : 1, k[(i - 36) % 3]);
    }
    return b;
}

/* The copies of the motions his throws give their victim that StF's fighters
 * play: his reach (x, z), their height (y: StF's stance stands 1.07 high,
 * VF2's 1.0). */
/* The bits of a rob's flags StF's own play op 5 sets. */
const STF_FLAG_BITS = new Set([0, 1, 3, 4, 7, 8, 9, 10, 11, 13, 15, 23, 25, 29, 30]);
const THROWN = [SCALE, 1.07, SCALE];
/* Damage (setup op 4, a strike, and op 5, a throw: byte +3) is out of VF2's
 * 200 energy; StF's fighters have 140. */
const DAMAGE = 140 / 200;

/* A mesh's extent: the geometrizer's walk (import-assets keepModel). */
function meshLength(d, base) {
    let p = base + 24;
    for (;;) {
        const attr = d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24);
        p += 16;
        if ((attr & 3) === 0) return p - base;
        p += 24;
    }
}

/* ---- the guest ------------------------------------------------------------- */

/* R: import-assets' regions, R.guest (its tables) and R.models (the StF model
 * ids it kept). vf2, stf: noclip's ROM sets. */
export function importAkira(R, vf2, stf) {
    const { main, polygons, textures, program } = R;
    const T = R.guest.tables;
    /* each table's room runs to the next one's (the last, to the heap) */
    const ats = [...Object.values(T).map((t) => t.at), R.guest.heap].sort((a, b) => a - b);
    for (const [name, t] of Object.entries(T)) Object.assign(t, { name, room: ats.find((a) => a > t.at) - t.at });
    const p8 = (a) => vf2.maincpu[a], p32 = (a) => vf2.mainCpuView.getUint32(a, true);
    const d16 = (a) => { const r = resolveData(vf2, a); return r.view.getUint16(r.off, true); };
    const d32 = (a) => { const r = resolveData(vf2, a); return r.view.getUint32(r.off, true); };
    const A = readFighters(vf2)[0];
    const report = [];
    /* What of VF2's is dropped or changed on the way in, for
     * tools/grade-guest.mjs (import-assets writes it to guests.json). */
    const lost = { playOps: {}, flagBits: {}, strikeBytes: 0, op6Bytes: 0, op2bBytes: 0 };
    const tally = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

    /* The heap: main_data from STF_GUEST_HEAP up. */
    let heap = R.guest.heap;
    const alloc = (b, label, align = 4) => {
        heap = (heap + align - 1) & ~(align - 1);
        const at = heap;
        main.put(at - MAIN_DATA, b, `Akira ${label}`);
        heap += b.length;
        return at;
    };
    const u32s = (list) => { const b = new Uint8Array(list.length * 4); const v = new DataView(b.buffer); list.forEach((x, i) => v.setUint32(i * 4, x >>> 0, true)); return b; };
    const u16s = (list) => { const b = new Uint8Array(list.length * 2); const v = new DataView(b.buffer); list.forEach((x, i) => v.setUint16(i * 2, x & 0xffff, true)); return b; };
    const grow = (t, len) => {
        if (t.bytes.length >= len) return;
        const b = new Uint8Array(len); b.set(t.bytes);
        Object.assign(t, { bytes: b, view: new DataView(b.buffer) });
    };

    /* ---- motions: the closure, new ids ---- */
    const setupAt = (id) => d32(VF2_SETUPS + id * 4);
    const setupLen = (op, at) => (op === 0x10 ? 2 + 2 * d8(at + 1) : p8(VF2_SETUP_LENGTHS + op));
    const d8 = (a) => { const r = resolveData(vf2, a); return r.data[r.off]; };
    /* A setup's ops, then (op 8) its play ops. */
    function readSetup(id) {
        const rec = setupAt(id), setup = [], play = [];
        let p = rec + p8(VF2_SETUP_LENGTHS), end;
        for (;;) {
            const op = d8(p);
            if (op === 0 || op === 8) { end = op; p++; break; }
            if (op >= VF2_SETUP_OPS) throw new Error(`motion ${id}: setup op ${hex(op)}`);
            const len = setupLen(op, p);
            setup.push({ op, b: bytes(vf2, p, len) });
            p += len;
        }
        if (end === 8) {
            for (;;) {
                const op = d8(p) & 0x7f;
                if (op === 0) break;
                if (op >= PLAY.length) throw new Error(`motion ${id}: play op ${hex(op)}`);
                play.push({ op, b: bytes(vf2, p, PLAY[op]) });
                p += PLAY[op];
            }
        }
        return { rec, head: bytes(vf2, rec, p8(VF2_SETUP_LENGTHS)), setup, play, end };
    }
    const referenced = (s) => {
        const out = [];
        for (const { op, b } of s.setup) {
            const u = (o) => b[o] | (b[o + 1] << 8);
            if (op === 1 && u(1) !== 0xffff) out.push(u(1));
            if (op === 5) out.push(u(1));
            if (op === 0xa) out.push(u(4));
        }
        for (const { op, b } of s.play) if (PLAY_MOTION[op]) out.push(b[PLAY_MOTION[op]] | (b[PLAY_MOTION[op] + 1] << 8));
        return out.map((x) => x & MOTION_ID).filter((x) => x);
    };

    /* ---- the command program: walk ---- */
    const root = p32(VF2_COMMANDS + A.char * 4);
    const units = new Map();         /* old address -> {kind, op, len} */
    const commits = [], natives = [];
    {
        const todo = [[root, 'table']];
        while (todo.length) {
            let [a, kind] = todo.pop();
            if (kind === 'table') {
                if (units.has(a)) continue;
                let h = a;
                for (; p8(h) === 0x0e; h += 7) { units.set(h, { kind: 'header', len: 7 }); todo.push([p32(h + 3), 'script']); }
                /* its end: VF2's own 0, or one put in before what follows */
                if (!units.has(h) && !units.has(h - 0.5)) units.set(p8(h) === 0 ? h : h - 0.5, { kind: 'end' });
                continue;
            }
            for (;;) {
                const u = units.get(a);
                if (u) { if (u.kind !== 'op') throw new Error(`${hex(a)}: a script runs into a table`); break; }
                const op = p8(a);
                if (op >= OP_LENGTH.length) throw new Error(`command op ${hex(op)} at ${hex(a)}`);
                const len = OP_LENGTH[op];
                units.set(a, { kind: 'op', op, len });
                if (op === 0x0d) todo.push([p32(a + 1), 'table']);
                if (op === 0x0f || op === 0x27 || op === 0x32 || op === 0x33) todo.push([p32(a + 1), 'script']);
                /* a throw's follow-up: the script it runs once it lands (0x1228) */
                if (op === 0x15 && p32(a + 5)) todo.push([p32(a + 5), 'script']);
                if (op === 0x28) { for (const o of [1, 5, 9]) todo.push([p32(a + o), 'script']); break; }
                if (op === 0x11) { todo.push([p32(a + 1), 'script']); break; }
                if (op === 0x13) {
                    todo.push([p32(a + 1), 'script']);
                    const code = (a + 5 + 3) & ~3;
                    if ((p32(code + 4) & 0xff000003) !== 0x08000000 || code + 4 + ((p32(code + 4) << 8) >> 8) !== VF2_NATIVE_TAIL)
                        throw new Error(`native at ${hex(code)} does not end in the tail`);
                    natives.push(a);
                    units.get(a).g0 = native(p32(code), code);
                    break;
                }
                if (op === 0x05 || op === 0x06) { commits.push(a); break; }
                if (op === 0x10 || op === 0x36) break;
                a += len;
            }
        }
    }
    /* The one instruction a native runs before the tail: g0, a motion id. */
    function native(w, at) {
        const opc = ((w >>> 24) << 4) | ((w >>> 7) & 0xf), dst = (w >>> 19) & 0x1f;
        if ((w >>> 24) === 0x8c && dst === 16 && !(w & 0x1000)) return w & 0xfff;                  /* lda N,g0 */
        if (dst === 16 && (w & 0x1800) === 0x1800) {
            const s1 = w & 0x1f, s2 = (w >>> 14) & 0x1f;
            if (opc === 0x590) return s1 + s2;                                                   /* addo */
            if (opc === 0x59c) return s2 << s1;                                                  /* shlo */
        }
        throw new Error(`native at ${hex(at)}: ${hex(w)}`);
    }

    /* ---- motions: the closure ---- */
    const actionMotion = (x) => (typeof x === 'number' ? A.actions[x] : x.motion);
    /* his reactions: a kind VF2 has none for in a category (0) has kind 0's */
    const reactions = [];
    let kind0 = 0;
    for (let k = 0; k < 30; k++) {
        const t = d32(VF2_REACTIONS + k * 4), r = [];
        for (let i = 0; i < 40; i++) { const x = d32(t + i * 4); if (!x && k) kind0++; r.push(x || reactions[0][i]); }
        reactions.push(r);
    }
    const want = new Set([...A.actions, ...STF_ACTIONS.map(actionMotion), ...reactions.flat().map((x) => x & MOTION_ID)].filter((x) => x));
    const commitWord = (a) => p32(a + 1);
    for (const a of commits) {
        const w = commitWord(a), type = w >>> 24;
        if (w & MOTION_ID) want.add(w & MOTION_ID);
        if (COMMIT_ACTION[type] !== undefined && A.actions[COMMIT_ACTION[type]]) want.add(A.actions[COMMIT_ACTION[type]]);
    }
    for (const a of natives) want.add(units.get(a).g0);
    const setups = new Map();
    for (const todo = [...want]; todo.length;) {
        const id = todo.pop();
        if (setups.has(id)) continue;
        if (!(id > 0 && id < VF2_MOTION_COUNT)) throw new Error(`motion ${id}`);
        const s = readSetup(id);
        setups.set(id, s);
        for (const x of referenced(s)) if (!setups.has(x)) todo.push(x);
    }
    const ids = [...setups.keys()].sort((a, b) => a - b);
    const newId = new Map(ids.map((id, i) => [id, FIRST_MOTION + i]));
    const mid = (id) => {
        if (id === 0xffff) return id;
        const m = id & MOTION_ID;
        if (!m) return id;
        if (!newId.has(m)) throw new Error(`motion ${m} has no new id`);
        return (id & ~MOTION_ID) | newId.get(m);
    };
    report.push(`${ids.length} motions, ${FIRST_MOTION}..${FIRST_MOTION + ids.length - 1}`);

    /* The motions his throws give their victim (setup op 5's: the throw's
     * own id + 1, mostly) and what those hand over to: StF's fighters play
     * copies (THROWN), with ids after his. */
    const thrown = new Set();
    for (const s of setups.values()) for (const { op, b } of s.setup) if (op === 5 && ((b[1] | (b[2] << 8)) & MOTION_ID)) thrown.add((b[1] | (b[2] << 8)) & MOTION_ID);
    for (const todo = [...thrown]; todo.length;) for (const x of referenced(setups.get(todo.pop()))) if (!thrown.has(x)) { thrown.add(x); todo.push(x); }
    const thrownIds = [...thrown].sort((a, b) => a - b);
    const copyId = new Map(thrownIds.map((id, i) => [id, FIRST_MOTION + ids.length + i]));
    report.push(`${thrownIds.length} motions his throws give, copied for StF's fighters as ${FIRST_MOTION + ids.length}..${FIRST_MOTION + ids.length + thrownIds.length - 1}`);

    /* ---- hands: the shapes his motions use, one index for both hands ---- */
    const handTable = d32(A.root + VF2_HANDS);
    const shapesUsed = new Set([0]);
    for (const s of setups.values()) for (const { op, b } of s.play) if (op === 0x12) shapesUsed.add(b[4] & 31);
    let q = 0;
    const quant = (s) => (s >> q) << q;
    while (new Set([...shapesUsed].map(quant)).size > 16) q++;
    const shapes = [...new Set([...shapesUsed].map(quant))].sort((a, b) => a - b);
    const shapeIndex = (s) => shapes.indexOf(quant(s & 31));
    report.push(`hand shapes ${shapes.join(',')}${q ? ` (every ${1 << q})` : ''}`);

    /* ---- models ---- */
    const midriffAt = (body) => d32(body.root + VF2_MIDRIFF);
    const vf2Models = new Set([...A.parts, ...A.p2.parts].map((p) => p.model).filter((m) => m > 0));
    for (const body of [A, A.p2]) vf2Models.add(d32(midriffAt(body) + MIDRIFF.model));
    for (let i = 0; i < 32; i++) { vf2Models.add(d32(handTable + i * 4)); vf2Models.add(d32(handTable + 0x180 + i * 4)); }
    const vf2List = [...vf2Models].filter((m) => m > 0).sort((a, b) => a - b);
    const modelId = new Map();
    for (let id = R.modelCount - 1; modelId.size < vf2List.length; id--) {
        if (id <= 0) throw new Error('no free model ids');
        if (!R.models.has(id)) modelId.set(vf2List[modelId.size], id);
    }
    const pack = packAkira(vf2, stf, vf2List);
    if (pack.problems.length) throw new Error(`pack-akira: ${pack.problems.join('; ')}`);
    /* A face's colorbase (th3 >> 6) names a palette entry, whose three
     * fields pick each channel's colorxlat row. Where StF's entry differs from
     * VF2's (29, his skin: VF2's names row 28 in every channel, StF's 27, 27
     * and 12), his copy names an StF entry with VF2's value, or one no StF
     * model the board keeps names (from the top down), set to it. */
    const pal = (rom, cb) => rom.mainDataView.getUint16(0x100000 + cb * 2, true);
    const cbMap = new Map(), freeTaken = new Set();
    for (const c of pack.copies) for (const r of c.recs ?? []) {
        const th3 = pack.tx[r + 6] | (pack.tx[r + 7] << 8), cb = (th3 >> 6) & 0x3ff;
        if (!cb || pal(vf2, cb) === pal(stf, cb)) continue;
        if (!cbMap.has(cb)) {
            let n = 1;
            while (n < 0x400 && pal(stf, n) !== pal(vf2, cb)) n++;
            if (n === 0x400) {
                for (n = 0x3ff; n >= 32 && (R.colorbases.has(n) || freeTaken.has(n)); n--);
                if (n < 32) throw new Error('no free colorbase');
                freeTaken.add(n);
                main.put(0x100000 + n * 2, Uint8Array.of(pal(vf2, cb) & 0xff, pal(vf2, cb) >> 8), `Akira colorbase ${cb}`);
            }
            cbMap.set(cb, n);
        }
        const t = (th3 & ~(0x3ff << 6)) | (cbMap.get(cb) << 6);
        pack.tx[r + 6] = t & 0xff; pack.tx[r + 7] = t >> 8;
    }
    report.push(`colorbases ${[...cbMap].map(([a, b]) => `${a}->${b}`).join(', ') || 'all the same'}`);
    main.put(pack.PAGE0, pack.md.subarray(pack.PAGE0, pack.MD_END), 'Akira texture pages');
    main.put(pack.HDR_SETS, pack.md.subarray(pack.HDR_SETS, pack.HDR_SETS + 4), 'Akira texture set table');
    textures.put(pack.TEX0, pack.tx.subarray(pack.TEX0, pack.at), 'Akira materials and UVs');
    let poly = POLY_RUN;
    const copyOf = new Map(pack.copies.map((c) => [c.m, c]));
    for (const m of vf2List) {
        const e = readModelEntry(vf2, m), off = meshOffsetOf(vf2, e);
        const len = meshLength(vf2.polygons, off);
        poly = (poly + 3) & ~3;
        if (poly + len > POLY_RUN_END) throw new Error('polygon run too small');
        polygons.put(poly, scaleMesh(vf2.polygons.slice(off, off + len)), `Akira model ${m} mesh`);
        const raw = (o) => vf2.mainDataView.getUint32(vf2.game.modelTable.offset + m * 16 + o, true);
        const c = copyOf.get(m);
        const entry = u32s([c.uvPtr ?? 0, c.matPtr ?? raw(4), (raw(8) & ~0x3fffff) | (poly >> 2), raw(12)]);
        main.put(R.modelTable + modelId.get(m) * 16, entry, `Akira model ${m} as ${modelId.get(m)}`);
        poly += len;
    }
    const M = (m) => (m > 0 ? modelId.get(m) : 0);
    report.push(`${vf2List.length} models as ${Math.min(...modelId.values())}..${Math.max(...modelId.values())}; meshes ${hex(POLY_RUN)}..${hex(poly)}`);

    /* ---- the setups, converted ---- */
    const f32 = (x) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x, true); return [...b]; };
    const put16 = (a, o, v) => { a[o] = v & 0xff; a[o + 1] = (v >> 8) & 0xff; };
    const damages = new Map();
    const damage = (v) => {
        const d = v && Math.max(1, Math.round(v * DAMAGE));
        damages.set(v, d);
        return d;
    };
    function convertSetup(id) {
        const s = setups.get(id);
        const h = s.head;
        const out = [h[0], h[1], h[2], h[3], 0, 0, 0, 0, h[4], h[5], h[6], h[7], 0];
        /* VF2's set_mot_dat patches two of his setups in code (V 0x1A26C, 0x1A97C):
         * motion 40 sets bit 7 of the kind word (0x804), and 578 flips bit 15 of
         * op 0xB's word (0x844). StF's has no such patches: put them in the data. */
        if (id === 40) out[0] |= 0x80;
        for (const { op, b } of s.setup) {
            let o;
            switch (op) {
            case 4: o = [4, b[1], b[2], damage(b[3]), 0, ...b.subarray(8, 17), ...f32(2.0)]; if (b.subarray(4, 8).some((x) => x)) lost.strikeBytes++; break;
            case 5: o = [...b, 0, 0, 0, 0]; put16(o, 1, mid(b[1] | (b[2] << 8))); o[3] = damage(b[3]); break;
            case 6: o = [7, b[3], b[4]]; if (b[1] || b[2]) lost.op6Bytes++; break;
            case 0xc: o = [0xc, 0, b[1], b[2]]; break;
            case 1: o = [...b]; put16(o, 1, mid(b[1] | (b[2] << 8))); break;
            case 0xa: o = [...b]; put16(o, 4, mid(b[4] | (b[5] << 8))); break;
            case 0xb: o = [...b]; if (id === 578) o[2] ^= 0x80; break;
            default: o = [...b];
            }
            out.push(...o);
        }
        out.push(s.end);
        if (s.end === 8) {
            for (const { op, b } of s.play) {
                const to = op in PLAY_TO ? PLAY_TO[op] : op;
                if (to === null) { tally(lost.playOps, hex(op)); continue; }
                /* Op 5 sets a bit of the rob's flags (0x1A4). VF2's thrown motions set
                 * bit 24, which StF never sets and reads as "commit 0x18", past the end
                 * of its commit table: keep only the bits StF itself sets. */
                if (op === 5 && !STF_FLAG_BITS.has(b[3])) { tally(lost.flagBits, b[3]); continue; }
                if (to === 'hand') {
                    const o = [0x10 | (b[0] & 0x80), b[1], b[2], b[3] === 1 ? 5 : 8, shapeIndex(b[4])];
                    out.push(...o);
                    continue;
                }
                const o = [...b];
                o[0] = to | (b[0] & 0x80);
                if (PLAY_MOTION[op]) put16(o, PLAY_MOTION[op], mid(b[PLAY_MOTION[op]] | (b[PLAY_MOTION[op] + 1] << 8)));
                out.push(...o);
            }
            out.push(0);
        }
        return Uint8Array.from(out);
    }

    /* ---- motions and setups into the heap, the two tables by new id ---- */
    const motions = T.offset_list_motions, setupT = T.animation_related;
    const top = FIRST_MOTION + ids.length + thrownIds.length;
    for (const t of [motions, setupT]) {
        if (top * 4 > t.room) throw new Error(`${t.name ?? 'motion table'}: ${top} ids do not fit`);
        grow(t, top * 4);
    }
    let motionBytes = 0;
    for (const id of ids) {
        const r = resolveData(vf2, d32(VF2_MOTIONS + id * 4));
        const len = motionChannels(r.data, r.off).length;
        motionBytes += len;
        motions.view.setUint32(newId.get(id) * 4, alloc(scaleMotion(r.data.slice(r.off, r.off + len)), `motion ${id}`), true);
        setupT.view.setUint32(newId.get(id) * 4, alloc(convertSetup(id), `setup ${id}`, 1), true);
        if (!copyId.has(id)) continue;
        motionBytes += len;
        motions.view.setUint32(copyId.get(id) * 4, alloc(scaleMotion(r.data.slice(r.off, r.off + len), THROWN), `thrown motion ${id}`), true);
        setupT.view.setUint32(copyId.get(id) * 4, setupT.view.getUint32(newId.get(id) * 4, true), true);
    }
    report.push(`motion blocks ${motionBytes} bytes`);
    report.push(`damage x140/200: ${[...damages].sort((a, b) => a[0] - b[0]).map(([v, d]) => `${v}->${d}`).join(', ')}`);

    /* ---- the command program, converted ---- */
    const order = [...units.keys()].sort((a, b) => a - b);
    const progAt = (heap + 3) & ~3;
    const where = new Map();
    {
        let at = progAt;
        for (const a of order) {
            const u = units.get(a);
            where.set(a, at);
            if (u.kind === 'header') at += 7;
            else if (u.kind === 'end') at += 1;
            else if (u.op === 0x32) at += 0;
            else if (u.op === 0x05) at += 9;
            else if (u.op === 0x13) at = ((at + 5 + 3) & ~3) + 12;
            else at += u.len;
        }
    }
    const prog = [];
    const here = () => progAt + prog.length;
    /* an empty table is its end alone */
    const whereOf = (t) => where.get(t) ?? where.get(t - 0.5);
    const reloc = (o, b) => {
        const t = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
        const n = whereOf(t);
        if (n === undefined) throw new Error(`command program: ${hex(t)} is not a unit`);
        b[o] = n & 0xff; b[o + 1] = (n >> 8) & 0xff; b[o + 2] = (n >> 16) & 0xff; b[o + 3] = n >>> 24;
    };
    const vword = (w) => [w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, w >>> 24];
    let dropped = 0;
    for (const a of order) {
        const u = units.get(a);
        if (here() !== where.get(a)) throw new Error(`command program out of step at ${hex(a)}`);
        if (u.kind === 'end') { prog.push(0); continue; }
        const b = Uint8Array.from(vf2.maincpu.subarray(a, a + (u.kind === 'header' ? 7 : u.len)));
        if (u.kind === 'header') {
            const t = p32(a + 3);
            const n = where.get(t);
            if (n === undefined) throw new Error(`table ${hex(a)}: ${hex(t)}`);
            prog.push(...b.subarray(0, 3), ...vword(n));
            continue;
        }
        switch (u.op) {
        case 0x05: case 0x06: {
            const w = commitWord(a), type = w >>> 24;
            let nw;
            if (COMMIT_ACTION[type] !== undefined) nw = mid(A.actions[COMMIT_ACTION[type]]);
            else if (COMMIT_TYPE[type] !== undefined) nw = (COMMIT_TYPE[type] << 24) | mid(w & 0xffffff);
            else throw new Error(`commit type ${hex(type)} at ${hex(a)}`);
            prog.push(u.op, ...vword(nw >>> 0));
            if (u.op === 0x05) prog.push(0, 0, 0, 0);
            break;
        }
        case 0x13: {
            reloc(1, b);
            prog.push(...b.subarray(0, 5));
            while (here() & 3) prog.push(0);
            prog.push(...vword(0x8c800000 | mid(u.g0)), ...vword(0x84003000), ...vword(R.guest.nativeTail));
            break;
        }
        case 0x32: dropped++; break;
        case 0x33: reloc(1, b); prog.push(0x11, ...b.subarray(1, 5)); break;
        default:
            if (u.op === 0x2b && b[2]) { lost.op2bBytes++; b[2] = 0; }
            if ([0x0d, 0x0f, 0x27, 0x11].includes(u.op)) reloc(1, b);
            if (u.op === 0x28) for (const o of [1, 5, 9]) reloc(o, b);
            if (u.op === 0x15 && p32(a + 5)) reloc(5, b);
            prog.push(...b);
        }
    }
    if (alloc(Uint8Array.from(prog), 'command program') !== progAt) throw new Error('command program moved');
    const newRoot = whereOf(root);
    T.MOVESET_ARRAY.view.setUint32(CHR * 4, newRoot, true);
    report.push(`command program ${hex(progAt)}, ${prog.length} bytes (${units.size} units, ${commits.length} commits, ${natives.length} natives, ${dropped} op 0x32 dropped)`);

    /* ---- actions, records, skeleton, hands, head ---- */
    const knux = program.u32(T.CHAR_PARTS.src + CHR * 4);
    const knuxActions = program.u32(knux + 0xc);
    const actions = [];
    for (let i = 0; i < 52; i++) actions.push(program.u16(knuxActions + i * 2));
    STF_ACTIONS.forEach((x, s) => { actions[s] = (actions[s] & ~MOTION_ID) | mid(actionMotion(x)); });
    const actionsAt = alloc(u16s(actions), 'actions');

    /* ptr_DA0B4[character] (sub_2B94C): his 30 lists, each VF2's 40, then
     * StF's category 5 (an attack with 0x1A4 bit 22: his hit's) and StF's
     * last three. */
    const stfKinds = T.ptr_DA0B4.view.getUint32(CHR * 4, true);
    const kinds = reactions.map((r, k) => {
        const stfList = program.u32(stfKinds + k * 4);
        const tail = [41, 42, 43].map((i) => program.u32(stfList + i * 4));
        return alloc(u32s([...r.map(mid), mid(r[16]), ...tail]), `reactions ${k}`);
    });
    T.ptr_DA0B4.view.setUint32(CHR * 4, alloc(u32s(kinds), 'reaction kinds'), true);

    /* motion_remap (set_motion): his motion for each StF one StF's code plays
     * him by number: its action slots' and reactions' (by place), and the
     * knock-downs sub_2B94C's callers put in (225, 262, 270, 334). StF's
     * fighters play the copies of what his throws give their victim. */
    const own = new Array(top).fill(0);
    const stfId = (x) => x & MOTION_ID, put = (from, to) => { if (from && from < FIRST_MOTION && !own[from]) own[from] = stfId(to); };
    for (const x of [225, 262, 270, 334]) put(x, mid(0x2ce));
    STF_ACTIONS.forEach((x, s) => put(stfId(program.u16(knuxActions + s * 2)), mid(actionMotion(x))));
    reactions.forEach((r, k) => {
        const stfList = program.u32(stfKinds + k * 4);
        for (let i = 0; i < 41; i++) put(stfId(program.u32(stfList + i * 4)), mid(i < 40 ? r[i] : r[16]));
    });
    const theirs = new Array(top).fill(0);
    for (const [id, c] of copyId) theirs[newId.get(id)] = c;
    const ownAt = alloc(u16s(own), 'motion remap'), theirsAt = alloc(u16s(theirs), 'StF fighters\' motion remap');
    for (let c = 0; c < PLAYER2; c++) T.motion_remap.view.setUint32(c * 4, c === CHR ? ownAt : theirsAt, true);
    report.push(`motion remap: ${own.filter((x) => x).length} of StF's ids`);

    /* His skeleton (VF2's record +4, ×SCALE): SKELETON_TYPE_DATA's, below,
     * and his records' +4, which is StF's skeleton too. */
    const bones = Uint8Array.from(bytes(vf2, d32(A.root + SKELETON), SKELETON_BYTES));
    scaleFloats(bones, 0, SKELETON_BYTES / 4);
    const skel = alloc(bones, 'skeleton');

    /* His records: Knuckles', with his parts (+0, +8), actions (+0xC),
     * skeleton (+4), ranges (+0x10), weight (+0x14) and jump time (+0x20).
     * The rest stay Knuckles'
     * (docs/BOARD.md, "Where a guest is still treated as StF's"). */
    for (const [p, body] of [[0, A], [1, A.p2]]) {
        const parts = body.parts.map((x) => M(x.model));
        const list = alloc(u32s([...parts, ...parts]), `parts ${p ? 'P2' : 'P1'}`);
        const rec = new Uint8Array(0x30);
        const src = program.u32(T.CHAR_PARTS.src + (CHR + p * PLAYER2) * 4);
        for (let i = 0; i < 0x30; i += 4) new DataView(rec.buffer).setUint32(i, program.u32(src + i), true);
        const rv = new DataView(rec.buffer);
        rv.setUint32(0, list, true); rv.setUint32(4, skel, true); rv.setUint32(8, list, true); rv.setUint32(0xc, actionsAt, true);
        /* +0x20, the jump's frames (rob+0x5BE; the second byte on action
         * bit 18): VF2's exec_command (V 0x14828) takes record +0x4C, or 32
         * on bit 18 (docs/SHARED-CODE.md, D3). */
        rv.setUint32(0x20, alloc(Uint8Array.of(d8(body.root + VF2_JUMP_TIME), 32), `jump time ${p ? 'P2' : 'P1'}`, 1), true);
        /* +0x14, the weight: action_init puts it in rob+0x7DC and, with
         * sub_3261C's, rob+0x5D8 (rob_spd_control's slide, how far hits push
         * him). VF2's init_fix takes record +0x2C (docs/SHARED-CODE.md, D1). */
        rv.setUint32(0x14, d32(body.root + VF2_WEIGHT), true);
        /* +0x10, the cast's one table (15 floats, a count at +0x3C):
         * get_en_info tests rob+0x5F4 against its +0, +4, +8, +0xC. His copy
         * has VF2's record +0x18..+0x24 there, ×SCALE (docs/SHARED-CODE.md, D2). */
        const table = rv.getUint32(0x10, true), ranges = new Uint8Array(0x40);
        for (let i = 0; i < 0x40; i += 4) new DataView(ranges.buffer).setUint32(i, program.u32(table + i), true);
        ranges.set(bytes(vf2, body.root + VF2_RANGES, 16));
        scaleFloats(ranges, 0, 4);
        rv.setUint32(0x10, alloc(ranges, `ranges ${p ? 'P2' : 'P1'}`), true);
        T.CHAR_PARTS.view.setUint32((CHR + p * PLAYER2) * 4, alloc(rec, `record ${p ? 'P2' : 'P1'}`), true);
    }

    /* His midriff, for either player (the board's guest table `midriff`):
     * VF2's struct as the board reads it, his size: +0 the model (his, under
     * its StF id), +4 the link count n, +8 the chest's ring (8 points),
     * +0x68 the 10n + 1 words VF2 writes to polygon RAM (each link's
     * attribute, normal and two points, the hips' ring; the closing word),
     * then the 2n index bytes. Points ×SCALE; the normals as they are. */
    for (const [p, body] of [[0, A], [1, A.p2]]) {
        const at = midriffAt(body), n = d32(at + MIDRIFF.count);
        const ring = Uint8Array.from(bytes(vf2, at + MIDRIFF.ring, MIDRIFF.ringPoints * 12));
        scaleFloats(ring, 0, MIDRIFF.ringPoints * 3);
        const words = Uint8Array.from(bytes(vf2, at + MIDRIFF.links, (MIDRIFF.link * n + 1) * 4));
        for (let k = 0; k < n; k++) scaleFloats(words, (MIDRIFF.link * k + 4) * 4, 6);
        const index = bytes(vf2, at + MIDRIFF.links + (MIDRIFF.link * n + 1) * 4, 2 * n);
        for (const x of index) if (x >= MIDRIFF.first + MIDRIFF.ringPoints) throw new Error(`midriff: chest point ${x - MIDRIFF.first}`);
        const b = new Uint8Array(8 + ring.length + words.length + index.length);
        b.set(u32s([M(d32(at + MIDRIFF.model)), n])); b.set(ring, 8); b.set(words, 8 + ring.length); b.set(index, 8 + ring.length + words.length);
        T.midriff.view.setUint32((CHR + p * PLAYER2) * 4, alloc(b, `midriff ${p ? 'P2' : 'P1'}`), true);
    }

    /* SKELETON_TYPE_DATA[type][character]: the four lists, each copied into
     * the room after the four pointers. */
    {
        const t = T.SKELETON_TYPE_DATA, per = 52 * 4;
        if (!t.lists) {
            const b = new Uint8Array(0x10 + 4 * per), v = new DataView(b.buffer);
            for (let k = 0; k < 4; k++) {
                const from = t.view.getUint32(k * 4, true);
                for (let i = 0; i < per; i += 4) v.setUint32(0x10 + k * per + i, program.u32(from + i), true);
                v.setUint32(k * 4, t.at + 0x10 + k * per, true);
            }
            Object.assign(t, { bytes: b, view: v, lists: 0x10, perKind: per });
        }
        for (let k = 0; k < 4; k++) for (const c of [CHR, CHR + PLAYER2]) t.view.setUint32(t.lists + k * per + c * 4, skel, true);
    }

    /* The bones his pose is solved on: off_C2058[type][character], which
     * calc_rob_angle_cont reads (not his skeleton: StF's type 0 row is one
     * for all 26). VF2 solves its whole cast on one table (VF2_RIG, which
     * its 0x27CE0 loads), with StF's points at the same offsets: the chest,
     * the head (+0xC, which the head turns about), the pelvis (+0x60), and
     * from each arm's and leg's pivot (+0x18, +0x3C, +0x6C, +0x90) its two
     * bones, a length at +0xC and +0x10 where StF's are the x of a point
     * at +0xC and +0x18. ×SCALE, as his skeleton. On StF's row his head
     * turned about a point 0.43 too low and pitched to its limit. */
    {
        const t = T.off_C2058, per = 52 * 4;
        if (!t.lists) {
            const b = new Uint8Array(0x10 + 4 * per), v = new DataView(b.buffer);
            for (let k = 0; k < 4; k++) {
                const from = program.u32(t.src + k * 4);
                for (let i = 0; i < per; i += 4) v.setUint32(0x10 + k * per + i, program.u32(from + i), true);
                v.setUint32(k * 4, t.at + 0x10 + k * per, true);
            }
            Object.assign(t, { bytes: b, view: v, lists: 0x10 });
        }
        const f = (o) => vf2.mainCpuView.getFloat32(VF2_RIG + o, true);
        const pt = (o) => [f(o), f(o + 4), f(o + 8)];
        const rig = [pt(0), pt(0xc)];
        for (const at of [0x18, 0x2c]) rig.push(pt(at), [f(at + 0xc), 0, 0], [f(at + 0x10), 0, 0]);
        rig.push(pt(0x40));
        for (const at of [0x4c, 0x60]) rig.push(pt(at), [f(at + 0xc), 0, 0], [f(at + 0x10), 0, 0]);
        const b = new Uint8Array(rig.length * 12), v = new DataView(b.buffer);
        rig.flat().forEach((x, i) => v.setFloat32(i * 4, x * SCALE, true));
        const rigAt = alloc(b, 'bones');
        for (let k = 0; k < 4; k++) for (const c of [CHR, CHR + PLAYER2]) t.view.setUint32(t.lists + k * per + c * 4, rigAt, true);
    }

    /* Collision balls: rob_coli_ball_types[type][character] (rob+0x84C, the
     * skeleton type; rob_coli_ball_table_all_init) names a record of four
     * pointers: the balls (32, each x, y, z in its part's frame and r), the
     * part each ball rides (32 words), each part's balls (16 lists of 8
     * bytes, ball * 4, ended by a 0 after the first) and each part's count
     * (16 bytes). VF2 keeps the same, one set for its whole cast (0x176A0):
     * 30 balls, a count and a list pointer by part. His parts are VF2's, so
     * only the lengths change: x, y, z and r, ×SCALE. Types 0, 1 and 3 (both
     * of its halves) are his; type 2 is one set every character shares. */
    {
        const t = T.rob_coli_ball_types, from = program.u32(t.src), to = t.at + 0x10, n = 0x340;
        if (!t.lists) {
            const b = new Uint8Array(0x10 + n), v = new DataView(b.buffer);
            for (let i = 0; i < n; i += 4) v.setUint32(0x10 + i, program.u32(from + i), true);
            for (let k = 0; k < 4; k++) v.setUint32(k * 4, to + program.u32(t.src + k * 4) - from, true);
            Object.assign(t, { bytes: b, view: v, lists: 0x10 });
        }
        const balls = new Uint8Array(32 * 16), part = new Array(32).fill(0);
        const lists = new Uint8Array(16 * 8), counts = new Uint8Array(16);
        for (let s = 0; s < 16; s++) {
            counts[s] = bytes(vf2, VF2_BALLS.counts + s, 1)[0];
            if (!counts[s]) continue;
            const list = bytes(vf2, d32(VF2_BALLS.lists + s * 4), counts[s]);
            list.forEach((x, k) => { lists[s * 8 + k] = x; part[x >> 2] = s; });
        }
        balls.set(bytes(vf2, VF2_BALLS.points, VF2_BALLS.count * 16));
        scaleFloats(balls, 0, VF2_BALLS.count * 4);
        const rec = u32s([
            alloc(balls, 'balls', 16), alloc(u32s(part), 'ball parts', 16),
            alloc(lists, 'part balls', 16), alloc(counts, 'part ball counts', 16),
        ]);
        const recAt = alloc(rec, 'ball record', 16);
        const at = (k) => t.view.getUint32(k * 4, true) - t.at;
        for (const list of [at(0), at(1), at(3), at(3) + 52 * 4])
            for (const c of [CHR, CHR + PLAYER2]) t.view.setUint32(list + c * 4, recAt, true);
    }

    const hands = [];
    for (const off of [0, 0x180]) for (let i = 0; i < 16; i++) hands.push(i < shapes.length ? M(d32(handTable + off + shapes[i] * 4)) : 0);
    const handsAt = alloc(u16s(hands), 'hands');
    for (const c of [CHR, CHR + PLAYER2]) {
        T.player_hand_animations.view.setUint32(c * 4, handsAt, true);
        T.player_foot_animation.view.setUint32(c * 4, 0, true);
        T.player_body_animation.view.setUint32(c * 4, 0, true);
    }

    /* A head record of one frame: his head (slot 2) for either player, no
     * eyes. */
    const H = T.PLAYER_HEAD_LIST;
    for (const [p, body] of [[0, A], [1, A.p2]]) {
        const head = M(body.parts[2].model);
        const r = alloc(u16s([0, 0, head, head, 0, 0, 0, 0, 0, 0, 0, 0]), `head ${p ? 'P2' : 'P1'}`);
        for (let k = 0; k < H.len / 4; k++) H.view.setUint32(H.lists + k * H.perKind + (CHR + p * PLAYER2) * 4, r, true);
    }

    /* char_game: the game he comes from, for the code that branches on it. */
    for (const c of [CHR, CHR + PLAYER2]) T.char_game.bytes[c] = R.guest.games.VF2;

    report.push(`heap ${hex(R.guest.heap)}..${hex(heap)}`);
    const coverage = {
        chars: [CHR, CHR + PLAYER2], game: 'VF2', name: 'Akira',
        motions: ids.length, thrownCopies: thrownIds.length, actions: A.actions.length,
        actionSlots: STF_ACTIONS.length, remapped: own.filter((x) => x).length,
        reactions: 30 * 40, reactionsFromKind0: kind0,
        commandUnits: units.size, commits: commits.length, natives: natives.length,
        commitsAsAction: commits.filter((a) => COMMIT_ACTION[commitWord(a) >>> 24] !== undefined).length,
        op32Dropped: dropped, models: vf2List.length,
        handShapes: { used: shapesUsed.size, kept: shapes.length, every: 1 << q },
        colorbases: { moved: cbMap.size, free: freeTaken.size },
        balls: VF2_BALLS.count, damage: Object.fromEntries(damages),
        lost,
    };
    return { report, coverage, modelId, newId, parts: A.parts.map((x) => M(x.model)), p2: A.p2.parts.map((x) => M(x.model)) };
}
