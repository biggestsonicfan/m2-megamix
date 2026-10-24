/*
 * Fighters Megamix (Saturn, the prototype of Apr 08, 1997) fighters' data
 * off the disc's data track, and their motions as Virtua Fighter 2 motion
 * blocks, the format Megamix's board plays (docs/FM-SATURN.md). FM's
 * motions are VF2's keyframes, key for key, in the Saturn's own fixed point:
 * 19 objects (VF3's layout without the shoulders) onto VF2's 20, VF2's
 * pelvis look (object 17) the usual latched (0, 0, 16384).
 *
 *   node tools/fm-saturn.mjs [--disc Track01.bin] --fighters
 *   node tools/fm-saturn.mjs [--disc ...] <fighter> --list | --bones | --actions
 *   node tools/fm-saturn.mjs [--disc ...] <fighter> --pose <motion id> [frame]
 *   node tools/fm-saturn.mjs [--disc ...] <fighter> <motion id> [--json] [--out block.bin]
 *   node tools/fm-saturn.mjs [--disc ...] --file <n> --out file.bin
 *
 * <fighter> is a row of the character table (0..31) or its name (hornet);
 * the motion id is the bank's (hex, 0x11c). What changes on the way
 * (docs/FM-SATURN.md, "FM to VF2"):
 *   - positions: FM's are 1/1024 m, z negated;
 *   - angles: 1024 a turn (VF2 65536: ×64), axes (x, y, z) to VF2's
 *     (-z, y, x);
 *   - tangents: FM's are per frame, VF2's per 1/30 s: ×30;
 *   - time: the same 60 fps, keys at the same frames.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeVF2 } from './shenmue-motion.mjs';
import { sampleMotion } from '../vendor/noclip/js/motion.js';
import { buildPose, SLOT_COUNT, SLOT_NAMES, SLOT_PARENT } from '../vendor/noclip/js/pose.js';

export { SLOT_NAMES, SLOT_PARENT };

export const DEFAULT_DISC = `${process.env.HOME}/source/repos/ai/Fighters Megamix (Prototype - Apr 08, 1997)/Track01.bin`;

/* VF2's channel types (noclip motion.js) */
const LATCHED = 1, ZERO = 3, CONST = 4, LINEAR = 5, HERMITE = 6;
const TANGENT_RATE = 30;

/* 1ST_READ.DAT loads at 0x06004000; its tables */
const LOAD = 0x06004000;
const FILE_TABLE = 0x060816c0, FILE_COUNT = 396;     /* {u16 sectors, u16 sector} in FMM_DATA.DAT */
const CHAR_TABLE = 0x06081cf0, CHAR_ROW = 0x1c;      /* 14 s16 per fighter */
const FIGHTER_TABLE = 0x0608ddb0, FIGHTER_ROW = 0x28; /* bones, actions, ... per fighter */
const ACTIONS = 66, BONES = 15;

export const NAMES = ['grace', 'bahn', 'raxel', 'tokio', 'sanman', 'jane', 'honey', 'picky',
    'mahler', 'deku', 'kuma', 'bean', 'bark', 'uraban', 'hornet', 'bm', 'akira', 'pai', 'lau',
    'wolf', 'jeffry', 'kage', 'sarah', 'jacky', 'shun', 'lion', 'dural', 'kids-akira',
    'kids-sarah', 'siva', 'rentahero', 'janet'];

/* FM's channels: 7 points (x, y, z), then 12 angles (x, y, z); a point is
 * VF2 object POINTS[i], angle j VF2 object ANGLES[j]. */
const POINTS = [12, 13, 14, 15, 16, 18, 19];
const ANGLES = [4, 5, 6, 7, 0, 8, 1, 9, 10, 2, 11, 3];
const FM_CHANNELS = 57;

/** VF2's channel for FM's channel ch, and the scale on the way. */
export function vf2Channel(ch) {
    const [o, a] = [Math.floor(ch / 3), ch % 3];
    if (o < POINTS.length) return { channel: POINTS[o] * 3 + a, scale: (a === 2 ? -1 : 1) / 1024 };
    return { channel: ANGLES[o - POINTS.length] * 3 + (2 - a), scale: a === 0 ? -64 : 64 };
}

/** The data track's ISO 9660 files: Mode 1, 2048 bytes at 16 in each 2352. */
export function readDisc(path = DEFAULT_DISC) {
    const raw = readFileSync(path);
    const sector = n => raw.subarray(n * 2352 + 16, n * 2352 + 16 + 2048);
    const read = (lba, size) => {
        const b = Buffer.alloc(size);
        for (let p = 0; p < size; p += 2048) sector(lba + p / 2048).copy(b, p, 0, Math.min(2048, size - p));
        return b;
    };
    const pvd = sector(16);
    if (pvd.toString('latin1', 1, 6) !== 'CD001') throw new Error(`${path}: no ISO 9660 volume`);
    const root = read(pvd.readUInt32LE(156 + 2), pvd.readUInt32LE(156 + 10));
    const files = {};
    for (let p = 0; p < root.length;) {
        const len = root[p];
        if (!len) { p = (Math.floor(p / 2048) + 1) * 2048; continue; }
        const name = root.toString('latin1', p + 33, p + 33 + root[p + 32]).replace(/;1$/, '');
        files[name] = { lba: root.readUInt32LE(p + 2), size: root.readUInt32LE(p + 10) };
        p += len;
    }
    const file = name => {
        if (!files[name]) throw new Error(`no ${name} on the disc`);
        return read(files[name].lba, files[name].size);
    };
    return { files, file };
}

/** The game: its program, its archive and the tables that index them. */
export function readGame(path) {
    const disc = readDisc(path);
    const prg = disc.file('1ST_READ.DAT'), fmm = disc.file('FMM_DATA.DAT');
    const at = a => a - LOAD;
    const archive = n => {
        if (n < 0 || n >= FILE_COUNT) throw new Error(`no file ${n}`);
        const sectors = prg.readUInt16BE(at(FILE_TABLE) + 4 * n), start = prg.readUInt16BE(at(FILE_TABLE) + 4 * n + 2);
        return fmm.subarray(start * 2048, (start + sectors) * 2048);
    };
    const fighters = NAMES.map((name, row) => {
        const c = at(CHAR_TABLE) + row * CHAR_ROW, s = i => prg.readInt16BE(c + 2 * i);
        const f = at(FIGHTER_TABLE) + row * FIGHTER_ROW;
        return {
            row, name,
            costumes: [0, 1, 2, 3, 4, 5, 6, 7].map(s),   /* model / texture files, two costumes */
            motions: s(8), file9: s(9), file10: s(10), file11: s(11), id: s(12), count: s(13),
            bones: prg.readUInt32BE(f), actions: prg.readUInt32BE(f + 4),
        };
    });
    return { disc, prg, fmm, archive, fighters, at };
}

/** A fighter's 15 bone offsets (16.16 m), VF2's joints 1..15. */
export function readBones(game, fighter) {
    const p = game.at(fighter.bones);
    return Array.from({ length: BONES }, (_, i) =>
        [0, 1, 2].map(a => game.prg.readInt32BE(p + 12 * i + 4 * a) / 65536));
}

/** A fighter's action table: 66 motion ids, one per thing the game asks of
 *  every fighter (stand, walk, ...; not decoded yet). */
export function readActions(game, fighter) {
    const p = game.at(fighter.actions);
    return Array.from({ length: ACTIONS }, (_, i) => game.prg.readUInt16BE(p + 2 * i));
}

/* Where a fighter's model file keeps its slot table: four tables of 32
 * offsets (one per fighter row), picked by FUN_0601fcb0's r7. Hornet's are
 * all 0x714C, into files 130 and 132. */
const SLOT_TABLES = 0x06079d00;
export const HORNET_SLOTS = 0x714c;
export function slotTable(game, row, set = 0) {
    return game.prg.readUInt32BE(game.at(game.prg.readUInt32BE(game.at(SLOT_TABLES) + 4 * set)) + 4 * row);
}

/** A model file's slots: 41 SGL XPDATA {points, count, polygons, count,
 *  attributes, normals}, 24 bytes each, to 0xFFFFFFFF; a slot whose first
 *  word is 0x1 is empty (null), and an unused part is a one-point model.
 *  FUN_0601fcb0 relocates slots 1-40 into the player's part array, slot s at
 *  entry s - 1. Points are 16.16 (x, y, z); a polygon's four corners are
 *  point indices x 16. */
export function readModel(buf, at) {
    const slots = [], fx = (o) => buf.readInt32BE(o) / 65536;
    for (let o = at; buf.readUInt32BE(o) !== 0xffffffff; o += 24) {
        if (buf.readUInt32BE(o) === 1) { slots.push(null); continue; }
        const [pp, pc, qp, qc] = [0, 1, 2, 3].map(i => buf.readUInt32BE(o + 4 * i));
        slots.push({
            points: Array.from({ length: pc }, (_, i) => [0, 1, 2].map(a => fx(pp + 12 * i + 4 * a))),
            polygons: Array.from({ length: qc }, (_, i) => [0, 1, 2, 3].map(k => buf.readUInt16BE(qp + 20 * i + 12 + 2 * k) / 16)),
        });
    }
    return slots;
}

/* The armour break. FUN_0600bb20 draws slot 15 + s in place of slot s for
 * s = 1..9, a bit each of the row's word at 0x0606C6FC, once player +0x65
 * has bit 2 (the upper armour, set at 0x06023E1C); FUN_0600bb78 does s =
 * 9..15 by bits 8-14 of 0x0606C77C's, once +0x65 has bit 3 (the lower,
 * 0x06023E66). */
const BREAK_UPPER = 0x0606c6fc, BREAK_LOWER = 0x0606c77c;

/** A fighter's broken parts: [alternate slot, the slot it replaces], upper
 *  armour first. */
export function readBreaks(game, fighter) {
    const word = a => game.prg.readUInt32BE(game.at(a) + 4 * fighter.row), out = [];
    for (let k = 0; k < 9; k++) if (word(BREAK_UPPER) >> k & 1) out.push([16 + k, 1 + k]);
    for (let k = 0; k < 7; k++) if (word(BREAK_LOWER) >> (8 + k) & 1) out.push([24 + k, 9 + k]);
    return out;
}

/* The pose slots (noclip js/pose.js): slot s's bone is entry s of the
 * fighter's bone table, its place in SLOT_PARENT[s]'s frame. The limbs
 * are IK chains: shoulder or hip (3, 6, 10, 13), then two bones. */
const CHAINS = [[3, 4, 5], [6, 7, 8], [10, 11, 12], [13, 14, 15]];

/* The pose's metres in model units, for Hornet: his wheels' radius (40
 * units) is the hubs' height over the floor in the car pose (0.13 m), and
 * the wheelbase comes out Daytona's (323 units). Fitted, not read off the
 * draw. */
export const MODEL_UNITS = 300;

/** A motion's VF2 block's channels the way noclip's decodeMotion lays
 *  them out, for its evalChannel and sampleMotion. */
export function vf2Channels(b) {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength), types = [];
    for (let j = 0; j < 20; j++) {
        const x = b[2 + j], top = x >> 6;
        for (let a = 0; a < 3; a++) types.push(top === 0 ? ((x >> (2 * a)) & 3) + 3 : top - 1);
    }
    let n = 0;
    const ch = types.map(type => ({ type, count: type === LINEAR || type === HERMITE ? b[22 + n++] : 0, view }));
    let p = (22 + n + 3) & ~3;
    for (const c of ch) if (c.count) { c.times = p; p += 4 * c.count; }
    for (const c of ch) {
        if (c.type === ZERO) continue;
        c.values = p;
        p += c.count ? c.count * (c.type === HERMITE ? 12 : 4) : 4;
    }
    return { channels: ch, end: p };
}

/**
 * A fighter posed at one frame of a motion: VF2's solve (noclip pose.js,
 * feet level with the floor) on the fighter's own bones, then each slot
 * stepped out from its parent by its bone, as VF2's draw does. Board frame,
 * metres; { r (column-major 3x3), t } per slot 0-15.
 */
export function poseFighter(game, fighter, id, frame = 1) {
    const bank = game.archive(fighter.motions), row = readBank(bank).find(r => r.id === id);
    if (!row) throw new Error(`${fighter.name} has no motion 0x${id.toString(16)}`);
    const { channels } = vf2Channels(encodeVF2(toVF2(decodeFM(bank, row.data))));
    const bones = [[0, 0, 0], ...readBones(game, fighter)];
    const rig = { spine: bones[2], pivot: CHAINS.map(c => bones[c[0]]),
        upper: CHAINS.map(c => bones[c[1]][0]), lower: CHAINS.map(c => bones[c[2]][0]) };
    const pose = buildPose(rig, sampleMotion(null, { channels }, frame), { levelFeet: true });
    for (let s = 1; s < SLOT_COUNT; s++) {
        const { r, t } = pose[SLOT_PARENT[s]], o = bones[s];
        pose[s].t = [0, 1, 2].map(k => t[k] + r[k] * o[0] + r[k + 3] * o[1] + r[k + 6] * o[2]);
    }
    return pose;
}

/** Slot s of a pose in slot ref's frame: { t (model units), r }. */
export function inFrameOf(pose, s, ref) {
    const R = pose[ref].r, d = [0, 1, 2].map(k => pose[s].t[k] - pose[ref].t[k]);
    const dot = (c, v) => R[c * 3] * v[0] + R[c * 3 + 1] * v[1] + R[c * 3 + 2] * v[2];
    return {
        t: [0, 1, 2].map(c => dot(c, d) * MODEL_UNITS),
        r: [0, 1, 2].flatMap(cc => [0, 1, 2].map(c => dot(c, pose[s].r.slice(cc * 3, cc * 3 + 3)))),
    };
}

/** The motion bank: 12-byte rows {setup offset, motion id, data offset},
 *  ending in id 0. */
export function readBank(buf) {
    const rows = [];
    for (let p = 0; ; p += 12) {
        const id = buf.readUInt32BE(p + 4);
        if (!id) break;
        const data = buf.readUInt32BE(p + 8);
        rows.push({ id, setup: buf.readUInt32BE(p), data, frames: buf.readUInt16BE(data) });
    }
    return rows;
}

/**
 * One motion, FM's own way. The block: u16 frames, s16 times and values
 * offsets (from the block), u16 size; 15 bytes of 2-bit channel types, the
 * first channel in the top bits (57 of the 60 used):
 *   0: zero; 1: a constant (one value);
 *   2: linear: times [n, n deltas], values n + 2;
 *   3: Hermite: times [n, m, n + m deltas, 0xFF after a key whose sides
 *      differ], values v0, out0, per key (in, v) or (in, v, out), in, v.
 * Keys at frame 1, 1 + the deltas, the last frame. Values s16 (the game's
 * <<6 of them aside).
 */
export function decodeFM(buf, at) {
    const frames = buf.readUInt16BE(at);
    let t = at + buf.readInt16BE(at + 2), v = at + buf.readInt16BE(at + 4);
    const val = () => { const x = buf.readInt16BE(v); v += 2; return x; };
    const channels = [];
    for (let ch = 0; ch < FM_CHANNELS; ch++) {
        const type = (buf[at + 8 + (ch >> 2)] >> (6 - 2 * (ch & 3))) & 3;
        if (type === 0) { channels.push({ type: 'zero' }); continue; }
        if (type === 1) { channels.push({ type: 'const', value: val() }); continue; }
        const n = buf[t], m = type === 3 ? buf[t + 1] : 0;
        t += type === 3 ? 2 : 1;
        const deltas = [...buf.subarray(t, t + n + m)];
        t += n + m;
        const times = [1];
        for (const d of deltas) if (d !== 0xff) times.push(times.at(-1) + d);
        times.push(frames);
        if (type === 2) { channels.push({ type: 'linear', times, values: times.map(val) }); continue; }
        /* (value, in, out) per key; the ends' outer sides are the inner ones */
        const keys = [];
        const v0 = val(), out0 = val();
        keys.push({ value: v0, in: out0, out: out0 });
        deltas.forEach((d, i) => {
            if (d === 0xff) return;
            const tin = val(), value = val();
            keys.push({ value, in: tin, out: deltas[i + 1] === 0xff ? val() : tin });
        });
        const tin = val();
        keys.push({ value: val(), in: tin, out: tin });
        channels.push({ type: 'hermite', times, keys });
    }
    return { frames, channels };
}

/** An FM motion as VF2's 60 channels: { type, times, values } each,
 *  Hermite values as (value, in, out) per key. */
export function toVF2(m) {
    const ch = Array.from({ length: 60 }, () => ({ type: ZERO, times: [], values: [] }));
    for (let a = 0; a < 3; a++) ch[51 + a] = { type: LATCHED, times: [], values: [[0, 0, 16384][a]] };
    m.channels.forEach((c, i) => {
        const { channel, scale } = vf2Channel(i), k = scale * TANGENT_RATE;
        if (c.type === 'const') ch[channel] = c.value ? { type: CONST, times: [], values: [c.value * scale] } : ch[channel];
        else if (c.type === 'linear') ch[channel] = { type: LINEAR, times: c.times, values: c.values.map(x => x * scale) };
        else if (c.type === 'hermite') ch[channel] = { type: HERMITE, times: c.times,
            values: c.keys.flatMap(p => [p.value * scale, p.in * k, p.out * k]) };
    });
    return { frames: m.frames, channels: ch };
}

function fighterArg(game, s) {
    const f = /^\d+$/.test(s) ? game.fighters[+s] : game.fighters.find(x => x.name === s.toLowerCase());
    if (!f) { console.error(`no fighter ${s} (${NAMES.join(', ')})`); process.exit(1); }
    return f;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const opt = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
    const flag = k => { const i = args.indexOf(k); return i >= 0 && !!args.splice(i, 1); };
    const disc = opt('--disc'), out = opt('--out'), file = opt('--file');
    const json = flag('--json');
    const [who, what] = args;
    if (!who && file === undefined) {
        console.error('usage: fm-saturn.mjs [--disc Track01.bin] --fighters | --file <n> --out f.bin\n' +
            '       | <fighter> --list | --bones | --actions | --pose <motion id> [frame]\n' +
            '       | <fighter> <motion id> [--json] [--out block.bin]');
        process.exit(2);
    }
    const game = readGame(disc);
    if (file !== undefined) {
        const b = game.archive(+file);
        if (out) writeFileSync(out, b);
        console.log(`file ${file}: ${b.length} bytes`);
        process.exit(0);
    }
    if (who === '--fighters') {
        for (const f of game.fighters) {
            console.log(`${f.row}\t${f.name}\tcostumes ${f.costumes}\tmotions ${f.motions}\t` +
                `files ${f.file9} ${f.file10} ${f.file11}\tbones ${f.bones.toString(16)}`);
        }
        process.exit(0);
    }
    const f = fighterArg(game, who), bank = game.archive(f.motions), rows = readBank(bank);
    if (what === '--list') {
        for (const r of rows) console.log(`0x${r.id.toString(16)}\t${r.frames}\tdata ${r.data}\tsetup ${r.setup}`);
        process.exit(0);
    }
    if (what === '--bones') { readBones(game, f).forEach((b, i) => console.log(`${i + 1}\t${b.join('\t')}`)); process.exit(0); }
    if (what === '--pose') {
        /* each part's place and axes in the pelvis's frame (slot 9), model units */
        const pose = poseFighter(game, f, parseInt(args[2] ?? '11c', 16), +(args[3] ?? 1));
        const v = a => a.map(x => x.toFixed(2).padStart(7)).join(' ');
        for (let s = 0; s < SLOT_COUNT; s++) {
            const { t, r } = inFrameOf(pose, s, 9);
            console.log(`${String(s).padStart(2)} ${SLOT_NAMES[s].padEnd(6)} on ${SLOT_PARENT[s] < 0 ? '-' : SLOT_NAMES[SLOT_PARENT[s]]}` +
                `\tat ${v(t)}\tx ${v(r.slice(0, 3))}  y ${v(r.slice(3, 6))}`);
        }
        for (const [alt, s] of readBreaks(game, f)) console.log(`${alt} replaces ${s} (${SLOT_NAMES[s]}) once its armour breaks`);
        process.exit(0);
    }
    if (what === '--actions') {
        const ids = new Set(rows.map(r => r.id));
        readActions(game, f).forEach((id, i) => console.log(`${i}\t0x${id.toString(16)}${ids.has(id) ? '' : '\t(not in the bank)'}`));
        process.exit(0);
    }
    const id = parseInt(what, 16), row = rows.find(r => r.id === id);
    if (!row) { console.error(`${f.name} has no motion ${what}`); process.exit(1); }
    const m = decodeFM(bank, row.data), vf2 = toVF2(m);
    if (json) console.log(JSON.stringify({ fm: m, vf2 }, null, 1));
    else {
        const n = t => m.channels.filter(c => c.type === t).length;
        console.log(`${f.name} 0x${id.toString(16)}: ${m.frames} frames; ${n('hermite')} Hermite, ` +
            `${n('linear')} linear, ${n('const')} constant channels`);
    }
    if (out) writeFileSync(out, encodeVF2(vf2));
}
