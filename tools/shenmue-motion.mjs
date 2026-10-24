/*
 * Shenmue's motions (the Dreamcast disc's /MISC/MOTION.BIN) as Virtua
 * Fighter 2 motion blocks, the format Megamix's board plays
 * (docs/VF3-SHENMUE.md). Shenmue's fighting motions are VF3's, carried over
 * (263 of its names are VF3's own), and VF3's are VF2's with two objects
 * more, so a Shenmue motion maps channel for channel onto VF2's 20 objects:
 * the shoulders VF3 added are dropped, VF2's pelvis look (object 17) gets
 * its usual latched (0, 0, 16384).
 *
 *   node tools/shenmue-motion.mjs MOTION.BIN --list
 *   node tools/shenmue-motion.mjs MOTION.BIN <index|name> [--json] [--out block.bin]
 *
 * What changes on the way (docs/VF3-SHENMUE.md, "Shenmue to VF2"):
 *   - time: Shenmue runs at 30 fps, VF2 at 60, so frames ×2. VF2's keys
 *     start at frame 1 and end at the motion's last frame; Shenmue's key t
 *     is VF2's 2t or 2t + 2 (VF3's own rounding), so it goes to 2t + 1;
 *   - angles: Shenmue's are turns, VF2's binary radians (65535 a turn);
 *   - axes: Shenmue's z is VF2's -z, positions and angles alike;
 *   - tangents: Shenmue stores twice VF2's (both per key: in, out; VF3's
 *     are Shenmue's / 60).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* VF2's channel types (noclip motion.js) */
const LATCHED = 1, ZERO = 3, CONST = 4, LINEAR = 5, HERMITE = 6;
const TURN = 65535, TANGENT = 2;

/* Shenmue's bone (the motion's bone list: bone << 9 | mask; 0x1C0 the
 * position, 0x38 the angles) → VF2's object. Bones 25 and 31 are VF3's
 * objects 13 and 10, the shoulders VF2 has no object for. */
const POSITION = { 0: 12, 20: 13, 23: 14, 35: 15, 29: 16, 8: 18, 15: 19 };
const ANGLES = { 36: 0, 30: 1, 9: 2, 16: 3, 0: 4, 18: 5, 21: 6, 32: 7, 26: 8, 1: 9, 5: 10, 12: 11 };
const SHOULDERS = new Set([25, 31]);

/** The file's motions: its header is the table, the names, the data, the count. */
export function readMotionBin(buf) {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const table = v.getUint32(0, true), names = v.getUint32(4, true);
    const data = v.getUint32(8, true), count = v.getUint32(12, true);
    const name = i => {
        const p = v.getUint32(names + 4 * i, true);
        if (p < names || p >= data) return null;
        let e = p;
        while (e < buf.length && buf[e]) e++;
        return e < buf.length ? buf.toString('latin1', p, e) : null;
    };
    /* The table's 8-byte entries: the motion's offset from `data`, then one
     * more offset (not decoded). The name table has one entry fewer. */
    const motions = [];
    for (let i = 0; i < count; i++) {
        motions.push({ index: i, name: name(i), offset: data + v.getUint32(table + 8 * i, true) });
    }
    return { buf, v, motions };
}

/**
 * One motion's channels, Shenmue's own way: per channel its key times and
 * its points (start, the keys, end), each { value, in, out }.
 *
 * The block: u16 frames, u16 0, four u16 section offsets from the block's
 * start; the bone list (u16s, ending in 0); then
 *   1: a key count per channel (u8);
 *   2: the key times, in channel order (u8, u16 past 255 frames);
 *   3: per channel, two bits per point, the channel padded to a byte: how
 *      many halves the point has (0: none, value 0; 1: value; 2: tangent
 *      for both sides, value; 3: in, out, value);
 *   4: the halves (IEEE half floats).
 */
export function decodeShenmue(file, index) {
    const { buf, v } = file, at = file.motions[index].offset;
    const u16 = p => v.getUint16(at + p, true);
    const frames = u16(0);
    const sec = [u16(4), u16(6), u16(8), u16(10)];
    const bones = [];
    for (let p = 12; ; p += 2) {
        const w = u16(p);
        if (w === 0) break;
        bones.push({ bone: w >> 9, mask: w & 0x1ff });
    }
    const keys = [];
    for (const b of bones) {
        if (b.mask & 0x1c0) for (const a of 'xyz') keys.push({ bone: b.bone, kind: 'p', axis: a });
        if (b.mask & 0x38) for (const a of 'xyz') keys.push({ bone: b.bone, kind: 'r', axis: a });
    }
    if (sec[1] - sec[0] !== keys.length) throw new Error(`motion ${index}: ${keys.length} channels, ${sec[1] - sec[0]} counts`);

    const wide = frames > 255;
    let tp = at + sec[1], bp = 0, hp = at + sec[3];
    const bits = at + sec[2];
    const half = () => { const x = v.getFloat16 ? v.getFloat16(hp, true) : f16(v.getUint16(hp, true)); hp += 2; return x; };
    const channels = keys.map((k, c) => {
        const n = buf[at + sec[0] + c];
        const times = [];
        for (let j = 0; j < n; j++) { times.push(wide ? v.getUint16(tp, true) : buf[tp]); tp += wide ? 2 : 1; }
        const points = [];
        for (let j = 0; j < n + 2; j++) {
            const code = (buf[bits + (bp >> 3)] >> (6 - (bp & 7))) & 3;
            bp += 2;
            const p = { value: 0, in: 0, out: 0 };
            if (code === 3) { p.in = half(); p.out = half(); }
            else if (code === 2) p.in = p.out = half();
            if (code) p.value = half();
            points.push(p);
        }
        bp = (bp + 7) & ~7;
        return { ...k, times, points };
    });
    return { index, name: file.motions[index].name, frames, bones, channels };
}

function f16(h) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
    if (e === 0) return s * m * 2 ** -24;
    if (e === 31) return m ? NaN : s * Infinity;
    return s * (1 + m / 1024) * 2 ** (e - 15);
}

/** A Shenmue motion as VF2's 60 channels: { type, times, values } each,
 *  Hermite values as (value, in, out) per key. */
export function toVF2(m) {
    const ch = Array.from({ length: 60 }, () => ({ type: ZERO, times: [], values: [] }));
    for (let a = 0; a < 3; a++) ch[51 + a] = { type: LATCHED, times: [], values: [[0, 0, 16384][a]] };
    const dropped = new Set();
    for (const c of m.channels) {
        const obj = c.kind === 'p' ? POSITION[c.bone] : ANGLES[c.bone];
        if (obj === undefined) { dropped.add(c.bone); continue; }
        const a = 'xyz'.indexOf(c.axis);
        const k = (c.axis === 'z' ? -1 : 1) * (c.kind === 'r' ? TURN : 1);
        const t = [1, ...c.times.map(x => 2 * x + 1), 2 * m.frames];
        const pts = c.points.map(p => [p.value * k, p.in * k / TANGENT, p.out * k / TANGENT]);
        const flat = pts.every(p => p[0] === pts[0][0] && !p[1] && !p[2]);
        ch[obj * 3 + a] = flat ? (pts[0][0] ? { type: CONST, times: [], values: [pts[0][0]] } : { type: ZERO, times: [], values: [] })
            : { type: HERMITE, times: t, values: pts.flat() };
    }
    const shoulders = [...dropped].filter(b => SHOULDERS.has(b));
    const unknown = [...dropped].filter(b => !SHOULDERS.has(b));
    return { frames: 2 * m.frames, channels: ch, shoulders, unknown };
}

/** VF2's motion block (noclip motion.js decodeMotion): u16 frames; a control
 *  byte per object (top two bits 0: three 2-bit types, 3..6, less 3; else
 *  the whole object a latched constant, type top - 1); a key count per keyed
 *  channel; four-aligned, the key times (f32), then the values. */
export function encodeVF2(vf2) {
    const ch = vf2.channels;
    const counts = ch.filter(c => c.type === LINEAR || c.type === HERMITE).map(c => c.times.length);
    let n = (22 + counts.length + 3) & ~3;
    for (const c of ch) n += 4 * (c.times.length + c.values.length);
    const b = Buffer.alloc(n), v = new DataView(b.buffer);
    v.setUint16(0, vf2.frames, true);
    for (let j = 0; j < 20; j++) {
        const t = ch.slice(j * 3, j * 3 + 3).map(c => c.type);
        if (t[0] < ZERO) {
            if (!t.every(x => x === t[0])) throw new Error(`object ${j}: latched axes differ`);
            b[2 + j] = (t[0] + 1) << 6;
        } else b[2 + j] = t.reduce((s, x, a) => s | ((x - ZERO) << (2 * a)), 0);
    }
    counts.forEach((c, i) => { b[22 + i] = c; });
    let p = (22 + counts.length + 3) & ~3;
    for (const c of ch) for (const t of c.times) { v.setFloat32(p, t, true); p += 4; }
    for (const c of ch) for (const x of c.values) { v.setFloat32(p, x, true); p += 4; }
    return b;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [path, which, ...rest] = process.argv.slice(2);
    if (!path || !which) {
        console.error('usage: shenmue-motion.mjs MOTION.BIN --list | <index|name> [--json] [--out block.bin]');
        process.exit(2);
    }
    const file = readMotionBin(readFileSync(path));
    if (which === '--list') {
        for (const m of file.motions) {
            const f = file.buf.readUInt16LE(m.offset);
            console.log(`${m.index}\t${f}\t${m.name ?? ''}`);
        }
        process.exit(0);
    }
    const i = /^\d+$/.test(which) ? +which : file.motions.findIndex(m => m.name === which);
    if (i < 0 || i >= file.motions.length) { console.error(`no motion ${which}`); process.exit(1); }
    const m = decodeShenmue(file, i), vf2 = toVF2(m);
    if (rest.includes('--json')) console.log(JSON.stringify({ shenmue: m, vf2 }, null, 1));
    else console.log(`${i} ${m.name}: ${m.frames} frames (VF2 ${vf2.frames}), ${m.channels.length} channels` +
        (vf2.shoulders.length ? `; shoulders dropped (bones ${vf2.shoulders})` : '') +
        (vf2.unknown.length ? `; bones with no VF2 object: ${vf2.unknown}` : ''));
    const out = rest.indexOf('--out');
    if (out >= 0) writeFileSync(rest[out + 1], encodeVF2(vf2));
}
