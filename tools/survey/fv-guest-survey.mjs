/*
 * Fighting Vipers' Honey, Tokio and Bahn, and Mahler (and B.M.), measured
 * for the board: what of theirs StF's code would read, as tools/guests/vf2-guest.mjs
 * puts Akira's in, and what of it fits beside Akira and Ryo
 * (docs/FV-GUESTS.md, docs/FV-MAHLER.md).
 *
 *   node tools/survey/fv-guest-survey.mjs [--char 8 | --char 2,3,4,8,9] [--json]
 *
 * It reads fvipers.zip and sfight.zip from $ROMS_DIR and changes nothing. For
 * each fighter it walks what vf2-guest walks for Akira, on FV's tables
 * (noclip games.js `fvipers`):
 *   - the command program, by character (0x1EBE0), with StF's op lengths
 *     (FV's matcher is StF's, js/moves.js);
 *   - the motions: his action table, his reactions (0x641F834, 22 kinds of
 *     40), every commit and native of his program, and what their setups
 *     (mot_list, 0x6411E94) hand over to, switch to and give a thrown victim;
 *     their blocks (offset_list_motions, 0x6C00004) and setup bytes;
 *   - the setup and play ops they use, against StF's lengths;
 *   - his models, with their mesh bytes: what StF's code would draw (both
 *     records' parts, the midriff, the hands (0x640EBF4, four shapes a
 *     hand) and the heads his face op picks (0x640D31C)), and apart, what
 *     only FV's armour code would (broken parts, bounces, hips, flying
 *     pieces and the debris flipbook), and the shoulder pads and skirt
 *     apart (kata_pat_disp, kosi_mino_disp: FV's code too);
 *   - his sway chains and shadow table (by record), and his carried item;
 *   - his textures: his tiles (each record's set and the next, as the board
 *     loads them) on the 32-pixel grid, in cells, as tools/guests/pack-akira.mjs
 *     counts them.
 */
import { readFileSync } from 'node:fs';
import { loadRomSet, readModelEntry, meshOffsetOf } from '../../vendor/noclip/js/romset.js';
import { readFighters } from '../../vendor/noclip/js/vf2fighters.js';
import { resolveData } from '../../vendor/noclip/js/motion.js';
import { decodeModel } from '../../vendor/noclip/js/model.js';
import { readOsage } from '../../vendor/noclip/js/osage.js';
import { readShadows } from '../../vendor/noclip/js/fightershadow.js';

const ROMS = process.env.ROMS_DIR || `${process.env.HOME}/build/mameroms`;
const JSON_OUT = process.argv.includes('--json');
const load = async (zip) => { const b = readFileSync(`${ROMS}/${zip}.zip`); return loadRomSet([b.buffer.slice(b.byteOffset, b.byteOffset + b.length)], () => {}); };
const fv = await load('fvipers'), stf = await load('sfight');

export const FIGHTERS = [{ char: 2, name: 'Honey' }, { char: 3, name: 'Tokio' }, { char: 4, name: 'Bahn' }, { char: 8, name: 'Mahler' }, { char: 9, name: 'B.M.' }];
/* --char 8 (or 2,3,4): only those; by default the three of #1579. */
const CHAR_ARG = process.argv[process.argv.indexOf('--char') + 1];
const CHOSEN = process.argv.includes('--char') ? CHAR_ARG.split(',').map(Number) : [2, 3, 4];
const MOTION_ID = 0x1fff;
/* FV (noclip games.js fvipers rig) */
const COMMANDS = 0x1ebe0;
const SETUPS = 0x06411e94, SETUP_LENGTHS = 0x1ce86, SETUP_OPS = 25;
const MOTIONS = 0x06c00004, MOTION_COUNT = 1055;
const REACTIONS = 0x0641f834, REACTION_KINDS = 22, PER_KIND = 40;
const PLAY = fv.game.rig.script;                       /* 31 ops, 0x1D028's */
const PLAY_MOTION = { 0x0a: 5, 0x0b: 5, 0x17: 4 };    /* vf2fighters.js PLAY_SWITCH */
const FACE_OP = 0x10, FACE = 0x0640d31c, HANDS = 0x0640ebf4, HAND_SHAPES = 4;
const MIDRIFF_MODEL = 8, MIDRIFF_AT = 0x24;
/* StF: its setup lengths are FV's but for op 4 (js/fighters.js STF_LENGTHS);
 * its play lengths are the program ROM's 0x1D01F, 0x2C ops (noclip motion.js). */
const STF_PLAY = [...stf.maincpu.subarray(0x1d01f, 0x1d01f + 0x2c)];
const STF_SETUP = { 0x04: 18 };
/* StF's and FV's command matcher (noclip js/moves.js OP_LENGTH). */
const OP_LENGTH = [
    3, 3, 2, 4, 2, 9, 5, 2, 2, 2, 2, 2, 2, 5, 7, 5,
    1, 5, 4, 5, 5, 9, 3, 1, 1, 1, 5, 5, 2, 4, 2, 4,
    2, 5, 2, 2, 3, 2, 1, 5, 13, 2, 2, 3, 2, 1, 1, 2,
    2, 2, 3, 2, 2, 2, 5, 2, 2, 2, 5, 2, 2, 2, 2, 2,
];
/* What Akira and Ryo leave the next guest (docs/FV-GUESTS.md, "Room"):
 * `stf` in StF's own ROM files (tools/board/import-assets.mjs's run on this
 * branch); `model2b` with the ROMs as large as a Model 2B game has them
 * (tools/survey/model2-rom-limits.py) and the board's own texture loading. */
const ROOM = {
    stf: {
        motionIds: 0x2000 / 4 - 879,           /* the guest motion lists hold 2048; 519..878 are Akira's */
        heap: 0x1000000 - 0xf195ac,            /* main_data, the guest heap to the XTRA window */
        meshes: 0x1000000 - 0xf3b568,           /* the polygon ROM's empty run, after Ryo's seams */
        cells: 7 * 64 - 266 - 8,                /* the seven set-1 pages' 448 cells of 32x32, less Akira's and Ryo's */
    },
    model2b: {
        motionIds: 0x2000 - 879,                /* the motion id field (13 bits), with the guest lists grown */
        heap: 0x1000000 - 0xf195ac + 0xf00000,  /* and main_data's upper 16 MB (dyndeka2b), less StF's 1 MB there */
        meshes: 0x1000000 - 0xf3b568 + 0x1000000, /* and the polygon ROM's second 16 MB (pltkids) */
        cells: 24 * 64,                         /* a fight's sheet 1, loaded for the two in it: 24 slots of 256x256 */
    },
};

const hex = (v) => '0x' + (v >>> 0).toString(16).toUpperCase();
const p8 = (a) => fv.maincpu[a], p32 = (a) => fv.mainCpuView.getUint32(a, true);
const res = (a) => { const r = resolveData(fv, a); if (!r) throw new Error(`FV ${hex(a)} is not in its data ROMs`); return r; };
const d8 = (a) => { const r = res(a); return r.data[r.off]; };
const d16 = (a) => { const r = res(a); return r.view.getUint16(r.off, true); };
const d32 = (a) => { const r = res(a); return r.view.getUint32(r.off, true); };
const tally = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

/* ---- setups ---------------------------------------------------------------- */

function readSetup(id) {
    const rec = d32(SETUPS + id * 4), setup = [], play = [];
    const head = p8(SETUP_LENGTHS);
    let p = rec + head, end;
    for (;;) {
        const op = d8(p);
        if (op === 0 || op === 8) { end = op; p++; break; }
        if (op >= SETUP_OPS) throw new Error(`motion ${id}: setup op ${hex(op)}`);
        const len = op === 0x10 ? 2 + 2 * d8(p + 1) : p8(SETUP_LENGTHS + op);
        setup.push({ op, at: p, len });
        p += len;
    }
    if (end === 8) {
        for (;;) {
            const op = d8(p) & 0x7f;
            if (op === 0) { p++; break; }
            if (op >= PLAY.length || !PLAY[op]) throw new Error(`motion ${id}: play op ${hex(op)}`);
            play.push({ op, at: p });
            p += PLAY[op];
        }
    }
    return { rec, setup, play, bytes: p - rec };
}

/* The finish kind (the attacker's +0x874): byte +0xE of setup op 4. A KO by
 * a kind-3 blow breaks the cage (docs/FV-STAGES.md, Cage break). */
const FINISH_AT = 0xe;
const finishOf = (s) => { const o = s.setup.find((x) => x.op === 4); return o ? d8(o.at + FINISH_AT) : 0; };

/* The motions a setup hands over to (op 1, op 0x13's two, op 0xA's switch,
 * the play ops' switches) and a throw's victim (op 5). */
function referenced(s) {
    const out = [], victims = [];
    for (const { op, at } of s.setup) {
        if (op === 1) out.push(d16(at + 1));
        if (op === 0x13) out.push(d16(at + 1), d16(at + 3));
        if (op === 0xa) out.push(d16(at + 4));
        if (op === 5) victims.push(d16(at + 1));
    }
    for (const { op, at } of s.play) if (PLAY_MOTION[op]) out.push(d16(at + PLAY_MOTION[op]));
    const ok = (x) => (x & MOTION_ID) && (x & 0xffff) !== 0xffff;
    return { next: out.filter(ok).map((x) => x & MOTION_ID), victims: victims.filter(ok).map((x) => x & MOTION_ID) };
}

/* A motion block's length (tools/guests/vf2-guest.mjs motionChannels). */
function blockLength(id) {
    const r = res(d32(MOTIONS + id * 4)), d = r.data, off = r.off;
    const types = [];
    for (let j = 0; j < 20; j++) {
        const b = d[off + 2 + j], top2 = (b >> 6) & 3;
        for (let a = 0; a < 3; a++) types.push(top2 === 0 ? ((b >> (a * 2)) & 3) + 3 : top2 - 1);
    }
    const counts = [];
    let n = 0;
    for (const t of types) counts.push(t === 5 || t === 6 ? d[off + 22 + n++] : 0);
    let p = (22 + n + 3) & ~3;
    types.forEach((t, i) => { if (t === 5 || t === 6) p += counts[i] * 4; });
    types.forEach((t, i) => { p += t === 3 ? 0 : t === 5 ? counts[i] * 4 : t === 6 ? counts[i] * 12 : 4; });
    return p;
}

/* ---- the command program --------------------------------------------------- */

function walkProgram(root) {
    const units = new Map(), commits = [], natives = [], ops = {};
    const todo = [[root, 'table']];
    while (todo.length) {
        let [a, kind] = todo.pop();
        if (kind === 'table') {
            if (units.has(a)) continue;
            let h = a;
            for (; p8(h) === 0x0e; h += 7) { units.set(h, { kind: 'header', len: 7 }); todo.push([p32(h + 3), 'script']); }
            if (!units.has(h)) units.set(h, { kind: 'end', len: p8(h) === 0 ? 1 : 0 });
            continue;
        }
        for (;;) {
            if (units.has(a)) break;
            const op = p8(a);
            if (op >= OP_LENGTH.length) throw new Error(`command op ${hex(op)} at ${hex(a)}`);
            const len = OP_LENGTH[op];
            units.set(a, { kind: 'op', op, len });
            tally(ops, hex(op));
            if (op === 0x0d) todo.push([p32(a + 1), 'table']);
            /* a header's test in a script: the u16 at +1 matched, its script at +3 */
            if (op === 0x0e) todo.push([p32(a + 3), 'script']);
            if (op === 0x0f || op === 0x27) todo.push([p32(a + 1), 'script']);
            if (op === 0x15 && p32(a + 5)) todo.push([p32(a + 5), 'script']);
            if (op === 0x28) { for (const o of [1, 5, 9]) todo.push([p32(a + o), 'script']); break; }
            if (op === 0x11) { todo.push([p32(a + 1), 'script']); break; }
            if (op === 0x13) { todo.push([p32(a + 1), 'script']); natives.push(a); break; }
            if (op === 0x05 || op === 0x06) { commits.push(a); break; }
            if (op === 0x10 || op === 0x36) break;
            a += len;
        }
    }
    const bytes = [...units.values()].reduce((n, u) => n + u.len, 0);
    return { units: units.size, bytes, commits, natives, ops };
}

/* A native's g0 (vf2-guest's `native`): the one instruction before its tail. */
function nativeMotion(a) {
    const code = (a + 5 + 3) & ~3, w = p32(code);
    const opc = ((w >>> 24) << 4) | ((w >>> 7) & 0xf), dst = (w >>> 19) & 0x1f;
    if ((w >>> 24) === 0x8c && dst === 16 && !(w & 0x1000)) return w & 0xfff;
    if (dst === 16 && (w & 0x1800) === 0x1800) {
        const s1 = w & 0x1f, s2 = (w >>> 14) & 0x1f;
        if (opc === 0x590) return s1 + s2;
        if (opc === 0x59c) return s2 << s1;
    }
    return null;
}

/* ---- models and tiles ------------------------------------------------------- */

const MODEL_KEYS = new Set(['model', 'chest', 'broken', 'bounce', 'bounceList', 'flipbook', 'streakHips', 'base', 'low', 'm180', 'air', 'slots', 'second']);
function modelsIn(v, into, take = false) {
    if (typeof v === 'number') { if (take && v > 0) into.add(v); return; }
    if (!v || typeof v !== 'object' || ArrayBuffer.isView(v)) return;
    if (Array.isArray(v)) { for (const x of v) modelsIn(x, into, take); return; }
    for (const [k, x] of Object.entries(v)) modelsIn(x, into, MODEL_KEYS.has(k));
}

function meshLength(m) {
    const e = readModelEntry(fv, m);
    const d = fv.polygons, base = meshOffsetOf(fv, e);
    let p = base + 24;
    for (;;) {
        const attr = d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24);
        p += 16;
        if ((attr & 3) === 0) return p - base;
        p += 24;
    }
}

/* The material records a decode reads (tools/guests/pack-akira.mjs streams). */
function materialRecords(m) {
    const e = readModelEntry(fv, m), seen = new Set();
    const proxy = new Proxy(fv.textures, {
        get(o, k) {
            if (typeof k === 'string' && /^\d+$/.test(k)) seen.add(+k);
            const v = Reflect.get(o, k, o);
            return typeof v === 'function' ? v.bind(o) : v;
        },
    });
    const fake = Object.create(fv);
    Object.defineProperty(fake, 'textures', { value: proxy });
    decodeModel(fake, m);
    return [...seen].filter((b) => Math.abs(b - e.matPtr * 2) < Math.abs(b - e.uvPtr * 2) && (b - e.matPtr * 2) % 8 === 0);
}

/* His tiles, merged where they overlap, as 32x32 cells (pack-akira's clusters). */
function tileCells(models) {
    const tiles = new Map(), sheets = {};
    for (const m of models) {
        for (const b of materialRecords(m)) {
            const th0 = fv.textures[b] | (fv.textures[b + 1] << 8), th2 = fv.textures[b + 4] | (fv.textures[b + 5] << 8);
            if (!(th0 & 0x4000)) continue;
            const t = { x: 32 * (th2 & 0x3f), y: 32 * ((th2 >> 6) & 0x1f), sheet: (th2 >> 12) & 1, w: 32 << (th0 & 7), h: 32 << ((th0 >> 3) & 7) };
            tiles.set(`${t.sheet},${t.x},${t.y},${t.w},${t.h}`, t);
            tally(sheets, t.sheet);
        }
    }
    const tl = [...tiles.values()], parent = tl.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const overlap = (a, b) => a.sheet === b.sheet && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (let i = 0; i < tl.length; i++) for (let j = 0; j < i; j++) if (overlap(tl[i], tl[j])) parent[find(i)] = find(j);
    const cells = new Set();
    tl.forEach((t, i) => { for (let y = t.y; y < t.y + t.h; y += 32) for (let x = t.x; x < t.x + t.w; x += 32) cells.add(`${find(i)}:${x},${y}`); });
    const sizes = {};
    for (const t of tl) tally(sizes, `${t.w}x${t.h}`);
    return { tiles: tl.length, cells: cells.size, sheets, sizes };
}

/* ---- one fighter ------------------------------------------------------------ */

const bodies = readFighters(fv);
const shadows = readShadows(fv);
const ITEM_AT = 0x2c;                                  /* record +0x2C: the carried item's records (noclip fvitem.js) */

function survey({ char, name }) {
    const A = bodies[char];
    const prog = walkProgram(p32(COMMANDS + char * 4));

    /* the motions */
    const want = new Set(A.actions.filter(Boolean));
    let kind0 = 0;
    for (let k = 0; k < REACTION_KINDS; k++) {
        const t = d32(REACTIONS + k * 4);
        for (let i = 0; i < PER_KIND; i++) { const x = d32(t + i * 4) & MOTION_ID; if (x) want.add(x); else kind0++; }
    }
    const commitTypes = {};
    for (const a of prog.commits) {
        const w = p32(a + 1);
        tally(commitTypes, hex(w >>> 24));
        if (w & MOTION_ID) want.add(w & MOTION_ID);
    }
    const nativeIds = prog.natives.map(nativeMotion);
    for (const g0 of nativeIds) if (g0) want.add(g0);
    const setups = new Map(), victims = new Set();
    for (const todo = [...want]; todo.length;) {
        const id = todo.pop();
        if (setups.has(id)) continue;
        if (!(id > 0 && id < MOTION_COUNT)) throw new Error(`${name}: motion ${id}`);
        const s = readSetup(id);
        setups.set(id, s);
        const r = referenced(s);
        for (const x of r.next) if (!setups.has(x)) todo.push(x);
        for (const x of r.victims) victims.add(x);
    }
    /* what his throws give a victim, and what those hand over to */
    const thrown = new Set(victims);
    for (const todo = [...thrown]; todo.length;) {
        const id = todo.pop();
        const s = setups.get(id) ?? readSetup(id);
        for (const x of referenced(s).next) if (!thrown.has(x)) { thrown.add(x); todo.push(x); }
    }
    const ids = [...setups.keys()].sort((a, b) => a - b);
    const setupOps = {}, playOps = {}, faceArgs = new Set();
    let setupBytes = 0, blockBytes = 0;
    const motionBytes = {}, finishes = {};
    for (const id of ids) {
        const s = setups.get(id);
        setupBytes += s.bytes;
        blockBytes += blockLength(id);
        motionBytes[id] = s.bytes + blockLength(id);
        for (const { op } of s.setup) tally(setupOps, op);
        const k = finishOf(s);
        if (k) (finishes[k] ??= []).push(id);
        for (const { op, at } of s.play) { tally(playOps, op); if (op === FACE_OP) faceArgs.add(d8(at + 3)); }
    }
    const playDiffer = Object.keys(playOps).map(Number).filter((op) => PLAY[op] !== STF_PLAY[op])
        .map((op) => ({ op: hex(op), fv: PLAY[op], stf: STF_PLAY[op] ?? null, uses: playOps[op] }));
    const setupDiffer = Object.keys(setupOps).map(Number).filter((op) => STF_SETUP[op])
        .map((op) => ({ op: hex(op), fv: p8(SETUP_LENGTHS + op), stf: STF_SETUP[op], uses: setupOps[op] }));

    /* the models: what StF's code draws for any fighter (his parts, hands,
     * heads and midriff), then what only FV's own armour code would (the
     * broken parts and flying pieces, the chest's bounce, the hips by motion
     * and in the air, the debris flipbook, the pads and skirt) */
    const core = new Set(), armour = new Set(), pads = new Set();
    for (const body of [A, A.p2]) {
        for (const p of body.parts) if (p.model > 0) core.add(p.model);
        if (body.midriff) core.add(body.midriff.model);
        const hands = d32(HANDS + body.index * 4);
        if (hands) for (let i = 0; i < 2 * HAND_SHAPES; i++) { const m = (d16(hands + i * 2) << 16) >> 16; if (m > 0) core.add(m); }
        for (const arg of faceArgs) {
            const pair = d32(d32(FACE + arg * 4) + body.index * 4);
            if (pair) { const m = (d16(pair) << 16) >> 16; if (m > 0) core.add(m); }
        }
        modelsIn(body.armour, armour);
        for (const e of body.extras ?? []) if (e.model > 0) pads.add(e.model);
        if (body.midriff?.broken) armour.add(body.midriff.broken.model);
        for (const arg of faceArgs) {
            const pair = d32(d32(FACE + arg * 4) + body.index * 4);
            if (pair) { const m = (d16(pair + 2) << 16) >> 16; if (m > 0) armour.add(m); }
        }
    }
    const valid = (s) => [...s].filter((m) => m < fv.game.modelTable.count && readModelEntry(fv, m)).sort((a, b) => a - b);
    const coreList = valid(core), padList = valid(pads).filter((m) => !core.has(m));
    const armourList = valid(armour).filter((m) => !core.has(m) && !pads.has(m));

    /* the sway chains (osage_dsp's stream, by record: player 2's own), the
     * floor shadow's table (by record) and the carried item */
    const chains = [A, A.p2].map((body) => {
        const o = readOsage(fv, body.index);
        return o ? { record: body.index, chains: o.chains.length, segments: o.chains.map((c) => c.segments.length),
            models: [...new Set(o.chains.flatMap((c) => c.segments.map((g) => g.model)))] } : { record: body.index, chains: 0 };
    });
    const shadowModels = [...new Set([A, A.p2].flatMap((b) => shadows.tables[b.index].map((e) => e.model)).filter((m) => m > 0))].sort((a, b) => a - b);
    const meshes = (list) => list.reduce((n, m) => { try { return n + meshLength(m); } catch { return n; } }, 0);

    return {
        name, char, record: hex(A.root), p2Record: hex(A.p2.root),
        texSets: [A.texSet, A.texSet + 1, A.p2.texSet, A.p2.texSet + 1],
        weight: (() => { const r = res(A.root + 0x1c); return r.view.getFloat32(r.off, true); })(),
        actions: A.actions.length,
        program: { root: hex(p32(COMMANDS + char * 4)), units: prog.units, bytes: prog.bytes, commits: prog.commits.length,
            natives: prog.natives.length, nativesUnread: nativeIds.filter((x) => x === null).length, commitTypes, ops: prog.ops },
        reactionsEmpty: kind0,
        motions: ids.length, thrownCopies: thrown.size, setupBytes, blockBytes,
        setupOps, playOps, playDiffer, setupDiffer,
        models: { core: coreList.length, pads: padList.length, armour: armourList.length },
        meshBytes: { core: meshes(coreList), pads: meshes(padList), armour: meshes(armourList) },
        textures: { core: tileCells(coreList), pads: tileCells([...coreList, ...padList]), all: tileCells([...coreList, ...padList, ...armourList]) },
        padModels: padList, osage: chains, shadowModels, item: d32(A.root + ITEM_AT) ? hex(d32(A.root + ITEM_AT)) : null,
        p2SameRecord: A.root === A.p2.root,
        finishes,
        motionIds: [...new Set([...ids, ...thrown])].sort((a, b) => a - b), motionBytes,
    };
}

const out = FIGHTERS.filter((f) => CHOSEN.includes(f.char)).map(survey);
/* the motion ids each shares with the others surveyed: what one copy of a
 * shared motion would save */
for (const f of out) {
    const mine = new Set(f.motionIds);
    /* the heap his motions add over those of the fighters before him, if
     * each motion's setup and block is kept once for all */
    const before = new Set(out.slice(0, out.indexOf(f)).flatMap((g) => g.motionIds));
    const added = Object.entries(f.motionBytes).filter(([id]) => !before.has(+id));
    f.addedOverBefore = { motions: added.length, bytes: added.reduce((n, [, b]) => n + b, 0) };
    f.shared = Object.fromEntries(out.filter((g) => g !== f).map((g) => [g.name, g.motionIds.filter((x) => mine.has(x)).length]));
}
const total = {
    motionIds: out.reduce((n, f) => n + f.motions + f.thrownCopies, 0),
    heap: out.reduce((n, f) => n + f.blockBytes + f.setupBytes + f.program.bytes, 0),
    meshes: out.reduce((n, f) => n + f.meshBytes.core, 0),
    cells: out.reduce((n, f) => n + f.textures.core.cells, 0),
    /* a fight's two: the two largest */
    pairCells: out.map((f) => f.textures.core.cells).sort((a, b) => b - a).slice(0, 2).reduce((n, c) => n + c, 0),
};

if (JSON_OUT) {
    console.log(JSON.stringify({ fighters: out, total, room: ROOM }, null, 1));
} else {
    for (const f of out) {
        console.log(`${f.name} (FV character ${f.char}, record ${f.record}, player 2 ${f.p2Record}; texture sets ${f.texSets.join(', ')})`);
        console.log(`  command program ${f.program.root}: ${f.program.bytes} bytes, ${f.program.units} units, ${f.program.commits} commits, ${f.program.natives} natives${f.program.nativesUnread ? ` (${f.program.nativesUnread} unread)` : ''}`);
        console.log(`    commit types ${Object.entries(f.program.commitTypes).map(([k, v]) => `${k}x${v}`).join(' ')}`);
        console.log(`  motions ${f.motions} (+${f.thrownCopies} his throws give), setups ${f.setupBytes} bytes, blocks ${f.blockBytes} bytes`);
        console.log(`    play ops whose length differs from StF's: ${f.playDiffer.map((d) => `${d.op} FV ${d.fv}/StF ${d.stf} x${d.uses}`).join('; ') || 'none'}`);
        console.log(`    setup ops whose length differs: ${f.setupDiffer.map((d) => `${d.op} FV ${d.fv}/StF ${d.stf} x${d.uses}`).join('; ') || 'none'}`);
        console.log(`  models ${f.models.core} (meshes ${f.meshBytes.core} bytes), ${f.models.pads} pads and skirt (${f.meshBytes.pads} bytes: ${f.padModels.join(' ') || 'none'}), and ${f.models.armour} more for FV's armour (${f.meshBytes.armour} bytes)`);
        console.log(`  player 2 ${f.p2SameRecord ? 'is player 1\'s record again' : 'has a record of its own'}; sway chains ${f.osage.map((o) => `record ${o.record}: ${o.chains ? `${o.chains} of ${o.segments.join('+')} (models ${o.models.join(' ')})` : 'none'}`).join(', ')}`);
        console.log(`  shadow models ${f.shadowModels.join(' ')}; carried item ${f.item ?? 'none'}; motions shared with ${Object.entries(f.shared).map(([k, v]) => `${k} ${v}`).join(', ') || 'none surveyed'}`);
        console.log(`  finish kinds: ${Object.entries(f.finishes).map(([k, v]) => `${k} x${v.length}${k === '3' ? ` (cage break: ${v.join(' ')})` : ''}`).join(', ') || 'none'}`);
        if (out.indexOf(f)) console.log(`    over the fighters above, kept once: ${f.addedOverBefore.motions} motions of his own, ${f.addedOverBefore.bytes} heap bytes`);
        for (const [k, t] of Object.entries(f.textures)) console.log(`  textures, ${k}: ${t.tiles} tiles, ${t.cells} cells of 32x32 (${Object.entries(t.sizes).map(([s, n]) => `${s} x${n}`).join(', ')})`);
    }
    console.log(`${out.length === 3 ? 'all three' : `the ${out.length}`}, without armour: ${total.motionIds} motion ids, ${total.heap} heap bytes, ${total.meshes} mesh bytes, ${total.cells} texture cells (the largest two in one fight ${total.pairCells})`);
    for (const [k, r] of Object.entries(ROOM)) console.log(`  room, ${k}: ${r.motionIds} motion ids, ${r.heap} heap bytes, ${r.meshes} mesh bytes, ${r.cells} cells${k === 'stf' ? ' for every guest at once' : ' a fight, for both fighters and what they share'}`);
}
