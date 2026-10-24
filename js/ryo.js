/*
 * Ryo Hazuki, from the Shenmue beta's disc (0.400 disc 3; docs/RYO.md).
 *
 * Everything is read off the disc's own files, as served at shenmue/<path>
 * (tools/serve.py): his model and textures (MISC/MODELS.PKS, YKB_M; PKF),
 * his motions (MISC/MOTION.BIN, Shenmue's VF3-style blocks turned into VF2's,
 * js/shenmue.js), and his moves (SCENE/03/MFBT/EN_RYOU.BIN, the free
 * battle's move script, with
 * each motion's record in MOTION.BIN for its timing and damage;
 * docs/SHENMUE-FIGHT.md).
 *
 * A Shenmue motion is VF3's, and VF3's is VF2's with two objects more, so
 * Ryo is posed by the VF2 pose routine (noclip js/pose.js buildPose) on a rig
 * of his own model's bone lengths, and his model is skinned onto its slots.
 * He is sized against Akira: 5 ft 9 in to Akira's 5 ft 11 in.
 */
import { gunzip, readPaks, readPakf, readMt5, restMatrices, mul4, invRigid, readMotionBin, shenmueMotion } from './shenmue.js';
import { sampleMotion } from '../vendor/noclip/js/motion.js';
import { buildPose, poseMatrices } from '../vendor/noclip/js/pose.js';
import { makeFighter, S, P, K, G, FWD, BACK, HIGH, MID, LOW, MOTION_ID } from './fighters.js';

/* The files, by their paths on the disc. */
export const SHENMUE_FILES = { pks: 'MISC/MODELS.PKS', pkf: 'MISC/MODELS.PKF', motion: 'MISC/MOTION.BIN', script: 'SCENE/03/MFBT/EN_RYOU.BIN' };
const MODEL = 'YKB_M.CHRM';

/* Heights, in inches. */
const RYO_HEIGHT = 69, AKIRA_HEIGHT = 71;
export const SIZE = RYO_HEIGHT / AKIRA_HEIGHT;

/** The disc's files, or null when they cannot be had. `fetchFile(path)`
 * returns an ArrayBuffer or null. */
export async function loadShenmue(fetchFile) {
    const got = {};
    for (const [k, path] of Object.entries(SHENMUE_FILES)) {
        const b = await fetchFile(path);
        if (!b) return null;
        got[k] = new Uint8Array(b);
    }
    const model = readMt5(readPaks(await gunzip(got.pks)).get(MODEL));
    const textures = readPakf(await gunzip(got.pkf));
    return {
        key: 'shenmue', kind: 'shenmue', title: 'Shenmue',
        model, textures,
        motions: readMotionBin(got.motion),
        script: got.script,
    };
}

/* ---- motions ------------------------------------------------------------- */

/* Ryo's actions, by MOTION.BIN record (a play's id less one). The down and
 * the rise are Akira's: a Shenmue fight has no lying down to get up from. */
const ACTS = {
    stance: 786, walkF: 839, walkB: 838, dashF: 1060, dashB: 1058,
    guard: 1002, guardEnd: 307, crouchGuard: 1003, crouchGuardEnd: 303,
    crouch: 187, toCrouch: 201, toStand: 189, jump: 521,
};
/* His hit reactions (DAMEGE_TOP1, _MID1, _BOT1) by level, and a guard
 * pushed back (GU_TA_PU_00). */
const HIT = { [HIGH]: 845, [MID]: 844, [LOW]: 843 };
const GUARD_PUSH = 310;

/* ---- the move script (docs/SHENMUE-FIGHT.md, "The move-script VM") -------- */

const LONG = new Set([5, 6, 7, 8, 9, 10, 11, 12, 14, 19, 21, 26, 27, 28, 34, 35, 36, 40, 41, 42, 50, 54,
    57, 58, 59, 62, 64, 69, 72, 73, 77, 80, 81, 82, 83, 89, 90]);
const OP = { WINDOW: 4, PLAY: 5, IF: 13, SWITCH: 14, TRY: 15, END: 16, GOTO: 17, WHEN: 39, STICK: 76, ACTION: 71, IN: 72, IN_HELD: 73, IN_DIR: 77, SKILL: 86 };
/* What a candidate may hold and still be one a press can reach here: the
 * input window and checks, the skill checks (Ryo knows every skill, at its
 * highest level), the action, the checks of a string's timing (29, 18, 52)
 * and 54, and the throws' 53 and 58 (the other in reach and standing: the
 * fight checks that itself), all passed. Anything else (9 and 83 before
 * Mistral Flash, a run; 7) is a state this fight does not have. */
const PASSED = new Set([OP.WINDOW, OP.IN, OP.IN_HELD, OP.IN_DIR, OP.SKILL, OP.ACTION, OP.IF, 18, 29, 52, 53, 54, 58]);
/* The buttons (A 1 the hand, X 2 the leg, 0x10 the throws; P+K 3), as this
 * fight's. Ryo's other branches (B, and the states 0x05xx) are not had. */
const KEYS = { 0x01: P, 0x02: K, 0x03: P | K, 0x10: P | G };
/* The stick: 0x20 (dir180) forward, 0x10 (dir0) back, 0x400 / 0x800 the
 * facing's own. 0x40 and 0x80 are sideways, which this fight has not. */
function stick(mask) {
    if (mask & 0xc0) return null;
    return (mask & 0x420 ? FWD : 0) | (mask & 0x810 ? BACK : 0);
}
const OP_EXACT = 0x01;

function readScript(b) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const start = v.getUint32(4, false), end = v.getUint32(8, false);
    const at = (pc) => {
        const op = b[pc];
        return { op, b1: b[pc + 1], b2: b[pc + 2], u16: v.getUint16(pc + 2, false), u16b: v.getUint16(pc + 4, false), u16c: v.getUint16(pc + 6, false),
            w: op === OP.PLAY ? v.getUint32(pc + 4, false) : 0, len: op === 76 ? 12 : LONG.has(op) ? 8 : 4 };
    };
    return { start, end, at };
}

/**
 * The script as the input matcher's tables (js/fighters.js matchPress):
 * {root, tables}, a table a run of switches on the buttons, its entries
 * {key, dirs, guards, motion, follow, name}. A candidate (try … play) is an
 * entry; the code after the last is the button's plain move. `if` names
 * where the script goes on once the motion plays (its string's switches),
 * `when` (39) skips a section the fight's state has to call for.
 */
export function readRyoMoves(b, names) {
    const s = readScript(b);
    const tables = new Map();
    const table = (pc) => {
        if (tables.has(pc)) return pc;
        const entries = [];
        tables.set(pc, entries);
        for (let i = s.at(pc); i.op === OP.SWITCH || i.op === 89; pc += i.len, i = s.at(pc)) {
            if (i.op !== OP.SWITCH || !(i.u16 in KEYS)) continue;
            for (const e of block(s.start + i.u16b)) entries.push({ ...e, key: KEYS[i.u16] });
        }
        return pc;
    };
    /* A button's code: its candidates in order (a try's else the next), a
     * goto followed, and the stick's three-way branch (76: forward, back,
     * neither) each way; the plain move at the end stops it. */
    const block = (pc, seen = new Set()) => {
        const out = [];
        while (pc < s.end && !seen.has(pc)) {
            seen.add(pc);
            const i = s.at(pc);
            if (i.op === OP.TRY) {
                out.push(...candidate(pc + i.len));
                pc = s.start + i.u16;
            } else if (i.op === OP.WHEN || i.op === OP.GOTO) pc = s.start + i.u16;
            else if (i.op === OP.STICK) {
                for (const t of [i.u16, i.u16b, i.u16c]) out.push(...block(s.start + t, seen));
                break;
            } else if (PASSED.has(i.op) || i.op === OP.PLAY) {
                out.push(...candidate(pc));
                break;
            } else break;
        }
        return out;
    };
    /* A candidate's checks to its play. A try inside one is taken (a
     * skill's next level) unless a check fails in it, when its else is. */
    const candidate = (pc, tests = [], then = null, fails = []) => {
        const fail = () => {
            if (!fails.length) return [];
            const f = fails.at(-1);
            return candidate(f.pc, f.tests, f.then, fails.slice(0, -1));
        };
        for (let n = 0; pc < s.end && n < 256; n++) {
            const i = s.at(pc);
            if (i.op === OP.IN || i.op === OP.IN_HELD || i.op === OP.IN_DIR) {
                const d = stick(i.u16);
                if (d == null) return fail();
                tests = [...tests, { d, held: i.op === OP.IN_HELD }];
            } else if (i.op === OP.IF) then = s.start + i.u16;
            else if (i.op === OP.TRY) fails = [...fails, { pc: s.start + i.u16, tests, then }];
            else if (i.op === OP.GOTO) { pc = s.start + i.u16; continue; }
            else if (i.op === OP.STICK) return [i.u16, i.u16b, i.u16c].flatMap((t) => candidate(s.start + t, tests, then, fails));
            else if (i.op === OP.PLAY) {
                const id = (i.w & 0x7fff) - 1;
                const next = then ?? pc + i.len;
                const follow = s.at(next).op === OP.SWITCH ? next : 0;
                return [{ dirs: dirsOf(tests), guards: [], motion: id, follow, paired: !!(i.w & 0x10000000), name: names(id) }];
            } else if (!PASSED.has(i.op)) return fail();
            pc += i.len;
        }
        return [];
    };
    const root = s.start + 4;
    table(root);
    /* the strings' tables, as their entries name them */
    for (let grew = true; grew;) {
        grew = false;
        for (const es of [...tables.values()]) for (const e of es) {
            if (e.follow && !tables.has(e.follow)) { table(e.follow); grew = true; }
        }
    }
    return { root, tables };
}

/* The checks, newest first, as the matcher's: a held one at the stick under
 * the cursor, the rest anywhere before it. Repeats are one (the matcher's
 * history is collapsed), and the neutral the script starts from is dropped. */
function dirsOf(tests) {
    const out = [];
    for (const t of tests) {
        if (out.length && out[out.length - 1].mask === t.d) continue;
        out.push({ op: OP_EXACT, mask: t.d, here: t.held });
    }
    while (out.length && out[out.length - 1].mask === 0) out.pop();
    return out;
}

/* ---- motion records (docs/SHENMUE-FIGHT.md, "The motion record") -------- */

/* A record: 12 bytes of header, then blocks, each a u16 tag: 2 is three
 * u16 (hit, cancel and end, in Shenmue's 30 fps frames), 3 is 14 bytes not
 * read here. After them come kind (4 a strike, 5 a throw), damage, and a
 * u16: on a throw the one-based record the thrown fighter plays, on a
 * strike a byte read here as the level (VF2's 0 high, 1 mid, 2 low: 2 on the
 * low kick; 3, Ryo's sweep, as low), then one more. */
function readRecord(file, index) {
    const m = file.motions[index];
    if (!m?.setup) return null;
    const v = file.v;
    let at = m.setup + 12, timing = null;
    const vf = (w) => 2 * w + 1;
    for (;;) {
        if (at + 8 > v.byteLength) return null;
        const tag = v.getUint16(at, true);
        if (tag === 2) {
            timing ??= { hit: vf(v.getUint16(at + 2, true)), cancel: vf(v.getUint16(at + 4, true)), end: vf(v.getUint16(at + 6, true)) };
            at += 8;
        } else if (tag === 3) at += 16;
        else break;
    }
    if (!timing) return null;
    const out = { timing };
    const kind = v.getUint8(at);
    if (kind === 4 || kind === 5) {
        out.kind = kind;
        out.damage = v.getUint8(at + 1);
        out.extra = [v.getUint8(at + 2), v.getUint8(at + 3)];
        if (kind === 5) out.victim = v.getUint16(at + 2, true) - 1;
    }
    return out;
}

/* Shenmue's damage is on a scale not measured (docs/SHENMUE-FIGHT.md,
 * "Damage"): the jab 3, the kicks 14-15. Here it is doubled, which puts
 * Ryo's jab and kicks beside Akira's. A throw does what VF2's do. */
const DAMAGE_SCALE = 2;
/* …and no blow does more than the VF2 cast's most (Akira's 70). */
const MAX_DAMAGE = 70;
const THROW_DAMAGE = 50;

/* ---- the fighter --------------------------------------------------------- */

export function ryoFighter(games, entry) {
    const game = games.shenmue;
    const file = game.motions;
    /* A stand-in ROM: Ryo's motions carry their own views; this marks them
     * as nobody's own but his (a VF2 body poses another's motion apart). */
    const rom = game.rom ??= { game: { key: 'shenmue' }, shenmue: true };
    const cache = game.cache ??= new Map();
    const motion = (id) => {
        if (id == null || id < 0 || id >= file.motions.length) return null;
        if (!cache.has(id)) {
            let m = null;
            try { m = shenmueMotion(file, id); } catch { m = null; }
            cache.set(id, m);
        }
        return cache.get(id);
    };
    const records = new Map();
    const record = (id) => {
        if (!records.has(id)) records.set(id, readRecord(file, id));
        return records.get(id);
    };
    const name = (id) => file.motions[id]?.name ?? `motion ${id}`;
    const moves = game.moves ??= readRyoMoves(game.script, name);
    /* A parry (Swallow Flip, a throw of no damage) wants a blow to take. */
    for (const [k, es] of moves.tables) moves.tables.set(k, es.filter((e) => !(record(e.motion)?.kind === 5 && !record(e.motion).damage)));

    const akira = makeFighter(games, { game: 'vf2', index: 0, name: 'AKIRA' });
    const ref = (id) => ({ rom, motion: motion(id) });

    const fighter = {
        name: entry.name, game: 'shenmue', rom, kind: 'shenmue', entry, size: SIZE,
        moves,
        motion,
        act: (a) => (a in ACTS ? ref(ACTS[a]) : akira.act(a)),
        timing(id) { return record(id & MOTION_ID)?.timing ?? null; },
        attack(id) {
            const r = record(id & MOTION_ID);
            if (!r?.kind) return null;
            if (r.kind === 5) return r.damage ? { victim: r.victim, damage: THROW_DAMAGE } : null;
            const lv = r.extra[0];
            return { level: lv === 3 ? LOW : lv <= LOW ? lv : MID, damage: Math.min(r.damage * DAMAGE_SCALE, MAX_DAMAGE) };
        },
        reaction(a, how) {
            if (how === 'down') return akira.reaction(a, how);
            if (how === 'guard') return ref(GUARD_PUSH);
            return ref(HIT[a.crouch ? LOW : a.level ?? MID] ?? HIT[MID]);
        },
        look: { kind: 'shenmue' },
        createBody() { return ryoBody(games, game); },
    };
    return fighter;
}

/* ---- the body ------------------------------------------------------------ */

/*
 * YKB_M's nodes, by bone id, on the sixteen slots. A node's own frame is the
 * slot's, Z mirrored as the Megamix models are read (the MT5 is Shenmue's
 * board, where z is VF2's -z): a slot's viewer matrix places the node's
 * vertices as they are. The rest ride on the nearest of these above them:
 * the fingers on the hands, the toes on the feet, the face and hair on the
 * head, the clavicles and the four shoulder pieces on the chest.
 */
const SLOT_BONES = { 0x01: S.CHEST, 0xffbd: S.HEAD, 0x05: 3, 0x06: 4, 0xffbf: 5, 0x0a: 6, 0x0b: 7, 0xffbe: 8,
    0x0e: S.PELVIS, 0x10: 10, 0x11: 11, 0x12: 12, 0x15: 13, 0x16: 14, 0x17: 15 };

/* A model, ready to skin: each node's slot and its place on it, the rig of
 * its bone lengths, and the strips as triangles over points (a point a
 * vertex of some node, with its own UV). */
function prepareModel(model) {
    const rest = restMatrices(model);
    const nodes = model.nodes;
    const byBone = new Map(nodes.map((n) => [n.bone, n]));
    const anchor = [];
    for (const n of nodes) {
        if (n.bone in SLOT_BONES) anchor[n.index] = n.index;
        else if (n.parent >= 0 && anchor[n.parent] != null) anchor[n.index] = anchor[n.parent];
    }
    const bind = nodes.map((n) => (anchor[n.index] == null ? null
        : { slot: SLOT_BONES[nodes[anchor[n.index]].bone], m: mul4(invRigid(rest[anchor[n.index]]), rest[n.index]) }));

    /* The rig: a joint's place in the chest's or the pelvis's frame, Z
     * mirrored to the board's; the bone lengths from joint to joint. */
    const local = (from, to) => {
        const m = mul4(invRigid(rest[byBone.get(from).index]), rest[byBone.get(to).index]);
        return [m[12], m[13], -m[14]];
    };
    const len = (bone) => Math.hypot(...byBone.get(bone).pos);
    const rig = {
        spine: local(0x01, 0xffbd),
        pivot: [local(0x01, 0x05), local(0x01, 0x0a), local(0x0e, 0x10), local(0x0e, 0x15)],
        upper: [len(0x06), len(0x0b), len(0x11), len(0x16)],
        lower: [len(0xffbf), len(0xffbe), len(0x12), len(0x17)],
    };

    /* Vertices: every node's, one after another. */
    const base = [];
    let count = 0;
    for (const n of nodes) { base[n.index] = count; count += n.mesh ? n.mesh.count : 0; }
    const src = [], uv = [], groups = new Map();
    for (const n of nodes) {
        if (!n.mesh || !bind[n.index]) continue;
        const parent = nodes[n.parent];
        for (const strip of n.mesh.strips) {
            const first = src.length;
            for (const p of strip.points) {
                src.push(p.vertex >= 0 ? base[n.index] + p.vertex : base[parent.index] + parent.mesh.count + p.vertex);
                uv.push(p.u, p.v);
            }
            const tri = groups.get(strip.texture) ?? [];
            groups.set(strip.texture, tri);
            for (let k = 2; k < strip.points.length; k++) {
                const a = first + k - 2, b = first + k - 1, c = first + k;
                if ((k & 1) ^ strip.flip) tri.push(b, a, c); else tri.push(a, b, c);
            }
        }
    }
    const index = [], parts = [];
    for (const [texture, tri] of [...groups].sort((x, y) => x[0] - y[0])) {
        parts.push({ texture: model.textures[texture], start: index.length, count: tri.length });
        index.push(...tri);
    }
    return { rig, bind, count, src: Uint32Array.from(src), uv: Float32Array.from(uv), index: Uint32Array.from(index), parts };
}

/* The model's vertices posed: each node's by its slot's matrix and its own
 * place on it. Positions and normals, `count` each. */
function skin(model, prep, mats, out) {
    for (const n of model.nodes) {
        const b = prep.bind[n.index];
        if (!n.mesh || !b) continue;
        const M = mul4(mats[b.slot], b.m);
        const { positions: p, normals: q } = n.mesh;
        let o = out.base[n.index] * 3;
        for (let i = 0; i < p.length; i += 3, o += 3) {
            const x = p[i], y = p[i + 1], z = p[i + 2];
            out.pos[o] = M[0] * x + M[4] * y + M[8] * z + M[12];
            out.pos[o + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
            out.pos[o + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
            const nx = q[i], ny = q[i + 1], nz = q[i + 2];
            out.nrm[o] = M[0] * nx + M[4] * ny + M[8] * nz;
            out.nrm[o + 1] = M[1] * nx + M[5] * ny + M[9] * nz;
            out.nrm[o + 2] = M[2] * nx + M[6] * ny + M[10] * nz;
        }
    }
}

const sampleOf = (ref, frame) => sampleMotion(ref.rom, ref.motion, Math.max(1, Math.min(frame, ref.motion.frames)));
const posed = (rig, ref, frame) => poseMatrices(buildPose(rig, sampleOf(ref, frame), { levelFeet: true }));

/* The lowest and highest of the model posed (y), its height. */
function extentY(model, prep, mats) {
    const out = workspace(model, prep);
    skin(model, prep, mats, out);
    let lo = Infinity, hi = -Infinity;
    for (let i = 1; i < out.pos.length; i += 3) { lo = Math.min(lo, out.pos[i]); hi = Math.max(hi, out.pos[i]); }
    return [lo, hi];
}

function workspace(model, prep) {
    const base = [];
    let c = 0;
    for (const n of model.nodes) { base[n.index] = c; c += n.mesh ? n.mesh.count : 0; }
    return { base, pos: new Float32Array(c * 3), nrm: new Float32Array(c * 3) };
}

/* Akira's height in the same motion: the tallest point of his parts. */
function akiraExtent(games, ref) {
    const a = makeFighter(games, { game: 'vf2', index: 0, name: 'AKIRA' });
    const body = a.createBody();
    const p = body.pose(ref ?? a.act('stance'), 1);
    let lo = Infinity, hi = -Infinity;
    for (const part of p.parts) {
        const d = part.dynamic ?? body.decode(part.key);
        if (!d) continue;
        const M = part.matrix, q = d.positions;
        for (let i = 0; i < q.length; i += 3) {
            const y = M[1] * q[i] + M[5] * q[i + 1] + M[9] * q[i + 2] + M[13];
            lo = Math.min(lo, y); hi = Math.max(hi, y);
        }
    }
    return [lo, hi];
}

/**
 * How Ryo is sized and stood, worked out once: the scale that makes him 69/71
 * of Akira's height with both in Akira's stance, and the lift that puts his
 * feet on the floor in his own (his stance's foot targets sit lower than his
 * model's ankles).
 */
export function ryoFit(games) {
    const game = games.shenmue;
    if (game.fit) return game.fit;
    const prep = game.prep ??= prepareModel(game.model);
    const akira = makeFighter(games, { game: 'vf2', index: 0, name: 'AKIRA' });
    const stance = akira.act('stance');
    const [alo, ahi] = akiraExtent(games, stance);
    const [rlo, rhi] = extentY(game.model, prep, posed(prep.rig, stance, 1));
    const scale = (SIZE * (ahi - alo)) / (rhi - rlo);
    const own = { rom: game.rom, motion: shenmueMotion(game.motions, ACTS.stance) };
    const [lo] = extentY(game.model, prep, posed(prep.rig, own, 1));
    game.fit = { scale, lift: -lo * scale, akira: ahi - alo, ryo: (rhi - rlo) * scale };
    return game.fit;
}

function ryoBody(games, game) {
    const prep = game.prep ??= prepareModel(game.model);
    const { scale, lift } = ryoFit(games);
    const out = workspace(game.model, prep);
    const n = prep.src.length;
    const skinPart = { positions: new Float32Array(n * 3), normals: new Float32Array(n * 3) };
    const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    return {
        /* what the renderer builds once: UVs, the triangles by texture */
        skin: { uv: prep.uv, index: prep.index, parts: prep.parts, textures: game.textures, count: n },
        pose(ref, frame) {
            const raw = posed(prep.rig, ref, frame);
            skin(game.model, prep, raw, out);
            const P = skinPart.positions, N = skinPart.normals;
            for (let i = 0; i < n; i++) {
                const s = prep.src[i] * 3;
                P[i * 3] = out.pos[s] * scale; P[i * 3 + 1] = out.pos[s + 1] * scale + lift; P[i * 3 + 2] = out.pos[s + 2] * scale;
                N[i * 3] = out.nrm[s]; N[i * 3 + 1] = out.nrm[s + 1]; N[i * 3 + 2] = out.nrm[s + 2];
            }
            /* the slots as the fight reads them: sized and stood the same */
            const mats = raw.map((m) => {
                const o = m.slice();
                for (let k = 0; k < 15; k++) if (k % 4 !== 3) o[k] *= scale;
                o[12] = m[12] * scale; o[13] = m[13] * scale + lift; o[14] = m[14] * scale;
                return o;
            });
            return { mats, parts: [{ skin: skinPart, matrix: IDENTITY }] };
        },
    };
}
