/*
 * Shenmue's files, read as the Dreamcast disc keeps them (docs/RYO.md):
 * the packs (PKS/PKF), the models (MT5), the textures (PVR) and the motions
 * (MISC/MOTION.BIN). Plain DataViews, so the same code runs in the browser
 * and in Node; nothing here knows about Megamix's fighters.
 */

/* ---- packs ----------------------------------------------------------------- */

/** A gzip stream, inflated (PKS and PKF are gzip). */
export async function gunzip(bytes) {
    const ds = new DecompressionStream('gzip');
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
}

const tag = (b, p) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
const cstr = (b, p, n) => {
    let s = '';
    for (let i = 0; i < n && b[p + i]; i++) s += String.fromCharCode(b[p + i]);
    return s;
};
const viewOf = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/**
 * A PKS (inflated): "PAKS", then an IPAC at 0x10. The IPAC's header is the
 * dictionary's offset, its count and the size; each 20-byte entry a name
 * (8), an extension (4), the file's offset from the IPAC and its size.
 * @returns {Map<string, Uint8Array>} by "NAME.EXT"
 */
export function readPaks(b) {
    const v = viewOf(b), base = 0x10;
    if (tag(b, 0) !== 'PAKS' || tag(b, base) !== 'IPAC') throw new Error('not a PAKS');
    const dict = v.getUint32(base + 4, true), n = v.getUint32(base + 8, true);
    const out = new Map();
    for (let i = 0; i < n; i++) {
        const e = base + dict + 20 * i;
        const off = base + v.getUint32(e + 12, true), size = v.getUint32(e + 16, true);
        out.set(`${cstr(b, e, 8)}.${cstr(b, e + 8, 4)}`, b.subarray(off, off + size));
    }
    return out;
}

/**
 * A PKF (inflated): "PAKF", then chunks from 0x10, each a tag and its size
 * with the header: a DUMY, then one TEXN per texture (its 8-byte name, a
 * GBIX, the PVRT).
 * @returns {Map<string, {width, height, rgba: Uint8Array}>} by name
 */
export function readPakf(b) {
    const v = viewOf(b);
    if (tag(b, 0) !== 'PAKF') throw new Error('not a PAKF');
    const out = new Map();
    for (let p = 0x10; p + 8 <= b.length;) {
        const t = tag(b, p), size = v.getUint32(p + 4, true);
        if (size < 8) break;
        if (t === 'TEXN') {
            const name = String.fromCharCode(...b.subarray(p + 8, p + 16));
            let q = p + 16;
            while (q < p + size && tag(b, q) !== 'PVRT') q += 4;
            if (q < p + size) out.set(name, decodePvr(b.subarray(q, p + size)));
        }
        p += size;
    }
    return out;
}

/* ---- PVR textures --------------------------------------------------------- */

/* "PVRT", size, pixel format, data format, 0, width, height; then the data. */
const ARGB1555 = 0, RGB565 = 1, ARGB4444 = 2;
/* The data formats Ryo's textures use; the mipmapped ones are not read. */
const TWIDDLED = 1, VQ = 3, RECTANGLE = 9, RECT_TWIDDLED = 13;

function texel(fmt, c) {
    if (fmt === RGB565) return [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31, 255];
    if (fmt === ARGB4444) return [((c >> 8) & 15) * 17, ((c >> 4) & 15) * 17, (c & 15) * 17, (c >> 12) * 17];
    return [((c >> 10) & 31) * 255 / 31, ((c >> 5) & 31) * 255 / 31, (c & 31) * 255 / 31, c & 0x8000 ? 255 : 0];
}

/* The twiddled (Morton) order: x's bits on the odd places, y's on the even. */
function twiddle(x, y) {
    let r = 0;
    for (let i = 0; i < 16; i++) r |= (((y >> i) & 1) << (2 * i)) | (((x >> i) & 1) << (2 * i + 1));
    return r;
}

export function decodePvr(b) {
    const v = viewOf(b);
    const pix = b[8], fmt = b[9], w = v.getUint16(12, true), h = v.getUint16(14, true);
    const rgba = new Uint8Array(w * h * 4);
    const put = (x, y, c) => rgba.set(texel(pix, c), (y * w + x) * 4);
    let p = 16;
    if (fmt === VQ) {
        const book = p;
        p += 2048;
        for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
            const code = b[p + twiddle(x >> 1, y >> 1)];
            const e = book + code * 8;
            /* A code's four texels, twiddled: (0,0) (0,1) (1,0) (1,1). */
            put(x, y, v.getUint16(e, true)); put(x, y + 1, v.getUint16(e + 2, true));
            put(x + 1, y, v.getUint16(e + 4, true)); put(x + 1, y + 1, v.getUint16(e + 6, true));
        }
    } else if (fmt === RECTANGLE) {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, v.getUint16(p + 2 * (y * w + x), true));
    } else if (fmt === TWIDDLED || fmt === RECT_TWIDDLED) {
        /* A rectangle is twiddled square by square along its long side. */
        const s = Math.min(w, h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const block = w > h ? Math.floor(x / s) : Math.floor(y / s);
            const at = block * s * s + twiddle(x % s, y % s);
            put(x, y, v.getUint16(p + 2 * at, true));
        }
    } else throw new Error(`PVR data format ${fmt}`);
    /* A 4444 texture none of which is half opaque is a translucent one (the
     * fight afterimage's: Chai's low model, CHA_B, alpha 4 of 15 all over);
     * a fighter drawn with it is drawn solid. */
    let solid = pix === ARGB4444;
    for (let i = 3; solid && i < rgba.length; i += 4) solid = rgba[i] < 128;
    if (solid) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
    return { width: w, height: h, rgba, format: { pixel: pix, data: fmt } };
}

/* ---- MT5 models ------------------------------------------------------------ */

/*
 * "HRCM", the TEXD's offset, the first node's. A node (0x40 bytes): its id
 * (the low 16 bits the bone), its mesh, its rotation (three i32, 0x10000 a
 * turn), scale (3 f32), position (3 f32), then its child, next sibling and
 * parent (offsets, 0 none), and a name on the top node.
 *
 * A mesh: polygon type, the vertices' offset, their count, the faces'
 * offset, a bounding sphere (centre, radius). A vertex is a position and a
 * normal (6 f32). The faces are u16 instructions: 0x02/0x03 and 0x0E carry a
 * size and that many bytes (render state, colours), 0x08 one u16, 0x09 the
 * texture (an index into TEXD's names), 0x0B the UV scale (UVs are that
 * many to 1.0), 0x10/0x11 strips (a size, a count, then per strip a
 * signed length, its sign the winding, and per point the vertex and with
 * 0x11 a u and v as i16), 0x0000 padding, 0x8000 the end.
 *
 * A vertex index below zero is the parent node's vertex, counted back from
 * the end of the parent's (that is how the joints are welded).
 */
export function readMt5(b) {
    const v = viewOf(b);
    if (tag(b, 0) !== 'HRCM') throw new Error('not an MT5');
    const texd = v.getUint32(4, true);
    const textures = [];
    if (tag(b, texd) === 'TEXD') {
        const n = v.getUint32(texd + 8, true);
        const names = texd + 12;
        if (tag(b, names) === 'NAME') for (let i = 0; i < n; i++) textures.push(String.fromCharCode(...b.subarray(names + 8 + 8 * i, names + 16 + 8 * i)));
    }
    const nodes = [], at = new Map();
    const walk = (o, parent) => {
        for (; o; o = v.getUint32(o + 0x30, true)) {
            const f = (k) => v.getFloat32(o + k, true);
            const node = {
                index: nodes.length, at: o, parent,
                id: v.getUint32(o, true), bone: v.getUint32(o, true) & 0xffff,
                rot: [v.getInt32(o + 8, true), v.getInt32(o + 12, true), v.getInt32(o + 16, true)],
                scale: [f(0x14), f(0x18), f(0x1c)], pos: [f(0x20), f(0x24), f(0x28)],
                name: cstr(b, o + 0x38, 4),
                mesh: null,
            };
            nodes.push(node);
            at.set(o, node);
            const mesh = v.getUint32(o + 4, true);
            if (mesh) node.mesh = readMesh(b, v, mesh);
            const child = v.getUint32(o + 0x2c, true);
            if (child) walk(child, node.index);
        }
    };
    walk(v.getUint32(8, true), -1);
    return { nodes, textures };
}

function readMesh(b, v, o) {
    const vo = v.getUint32(o + 4, true), count = v.getInt32(o + 8, true), fo = v.getUint32(o + 12, true);
    const n = Math.max(0, count);
    const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
        positions[i * 3 + k] = v.getFloat32(vo + 24 * i + 4 * k, true);
        normals[i * 3 + k] = v.getFloat32(vo + 24 * i + 12 + 4 * k, true);
    }
    const strips = [];
    let texture = 0, uvScale = 1024;
    for (let p = fo; p + 2 <= b.length;) {
        const op = v.getUint16(p, true);
        if (op === 0x8000 || op === 0xffff) break;
        if (op === 0) { p += 2; continue; }
        if (op === 0x02 || op === 0x03 || op === 0x0e || op === 0x0f) { p += 4 + v.getUint16(p + 2, true); continue; }
        if (op === 0x09) { texture = v.getUint16(p + 2, true); p += 4; continue; }
        if (op === 0x0b) { uvScale = v.getUint16(p + 2, true) || 1024; p += 4; continue; }
        if (op === 0x08 || op === 0x0a) { p += 4; continue; }
        if (op === 0x10 || op === 0x11) {
            const uv = op === 0x11, stride = uv ? 6 : 2;
            const nStrips = v.getUint16(p + 4, true);
            let q = p + 6;
            for (let s = 0; s < nStrips; s++) {
                const len = v.getInt16(q, true);
                q += 2;
                const pts = [];
                for (let k = 0; k < Math.abs(len); k++, q += stride) {
                    pts.push({
                        vertex: v.getInt16(q, true),
                        u: uv ? v.getInt16(q + 2, true) / uvScale : 0,
                        v: uv ? v.getInt16(q + 4, true) / uvScale : 0,
                    });
                }
                strips.push({ texture, flip: len < 0, points: pts });
            }
            p = q;
            continue;
        }
        throw new Error(`MT5 face op 0x${op.toString(16)} at 0x${p.toString(16)}`);
    }
    return { count, positions, normals, strips };
}

/** A node's place in its parent, column-major 4x4: T · Rz · Ry · Rx · S. */
export function nodeMatrix(node) {
    const [ax, ay, az] = node.rot.map((r) => (r * 2 * Math.PI) / 0x10000);
    const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
    /* Rz · Ry · Rx */
    const r = [
        cz * cy, sz * cy, -sy,
        cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx,
        cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx,
    ];
    const [kx, ky, kz] = node.scale;
    return [
        r[0] * kx, r[1] * kx, r[2] * kx, 0,
        r[3] * ky, r[4] * ky, r[5] * ky, 0,
        r[6] * kz, r[7] * kz, r[8] * kz, 0,
        node.pos[0], node.pos[1], node.pos[2], 1,
    ];
}

/** a · b, column-major 4x4s. */
export function mul4(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
}

/** The inverse of a rigid (turn and step) column-major 4x4. */
export function invRigid(m) {
    const o = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
    for (let r = 0; r < 3; r++) o[12 + r] = -(o[r] * m[12] + o[4 + r] * m[13] + o[8 + r] * m[14]);
    return o;
}

/** Every node's rest place in the model, column-major 4x4s. */
export function restMatrices(model) {
    const out = [];
    for (const n of model.nodes) out[n.index] = n.parent < 0 ? nodeMatrix(n) : mul4(out[n.parent], nodeMatrix(n));
    return out;
}

/* ---- motions --------------------------------------------------------------- */

/* VF2's channel types (noclip motion.js) */
const LATCHED = 1, ZERO = 3, CONST = 4, HERMITE = 6;
const TURN = 65535, TANGENT = 2;

/* Shenmue's bone (the motion's bone list: bone << 9 | mask; 0x1C0 the
 * position, 0x38 the angles) → VF2's object. Bones 25 and 31 are VF3's
 * objects 13 and 10, the shoulders VF2 has no object for. */
const POSITION = { 0: 12, 20: 13, 23: 14, 35: 15, 29: 16, 8: 18, 15: 19 };
const ANGLES = { 36: 0, 30: 1, 9: 2, 16: 3, 0: 4, 18: 5, 21: 6, 32: 7, 26: 8, 1: 9, 5: 10, 12: 11 };
const SHOULDERS = new Set([25, 31]);

/** MOTION.BIN's motions: its header is the table, the names, the data, the count. */
export function readMotionBin(b) {
    const v = viewOf(b);
    const table = v.getUint32(0, true), names = v.getUint32(4, true);
    /* A scene's own bank (M_FGT4.BIN and the like) numbers its motions from
     * a base, +0x14, with the end at +0xC; MOTION.BIN's base is 0. */
    const data = v.getUint32(8, true), base = v.getUint32(0x14, true), count = v.getUint32(12, true) - base;
    const name = (i) => {
        const p = v.getUint32(names + 4 * i, true);
        if (p < names || p >= data) return null;
        let e = p;
        while (e < b.length && b[e]) e++;
        return e < b.length ? String.fromCharCode(...b.subarray(p, e)) : null;
    };
    /* The table's 8-byte entries: the motion's offset from `data`, then the
     * setup record's (docs/SHENMUE-FIGHT.md). The name table has one entry
     * fewer. */
    const motions = [];
    for (let i = 0; i < count; i++) {
        motions.push({ index: i, name: name(i), offset: data + v.getUint32(table + 8 * i, true), setup: v.getUint32(table + 8 * i + 4, true) });
    }
    return { buf: b, v, base, motions };
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
    const u16 = (p) => v.getUint16(at + p, true);
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
    const half = () => { const x = f16(v.getUint16(hp, true)); hp += 2; return x; };
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

/**
 * A Shenmue motion as VF2's 60 channels: { type, times, values } each,
 * Hermite values as (value, in, out) per key (docs/VF3-SHENMUE.md, "Shenmue
 * to VF2"):
 *   - time: Shenmue runs at 30 fps, VF2 at 60, so frames ×2. VF2's keys
 *     start at frame 1 and end at the motion's last frame; Shenmue's key t
 *     is VF2's 2t or 2t + 2 (VF3's own rounding), so it goes to 2t + 1;
 *   - angles: Shenmue's are turns, VF2's binary radians (65535 a turn);
 *   - axes: Shenmue's z is VF2's -z, positions and angles alike;
 *   - tangents: Shenmue stores twice VF2's.
 * The shoulders VF3 added are dropped; VF2's pelvis look (object 17) gets
 * its usual latched (0, 0, 16384).
 */
export function toVF2(m) {
    const ch = Array.from({ length: 60 }, () => ({ type: ZERO, times: [], values: [] }));
    for (let a = 0; a < 3; a++) ch[51 + a] = { type: LATCHED, times: [], values: [[0, 0, 16384][a]] };
    const dropped = new Set();
    for (const c of m.channels) {
        const obj = c.kind === 'p' ? POSITION[c.bone] : ANGLES[c.bone];
        if (obj === undefined) { dropped.add(c.bone); continue; }
        const a = 'xyz'.indexOf(c.axis);
        const k = (c.axis === 'z' ? -1 : 1) * (c.kind === 'r' ? TURN : 1);
        const t = [1, ...c.times.map((x) => 2 * x + 1), 2 * m.frames];
        const pts = c.points.map((p) => [p.value * k, (p.in * k) / TANGENT, (p.out * k) / TANGENT]);
        const flat = pts.every((p) => p[0] === pts[0][0] && !p[1] && !p[2]);
        ch[obj * 3 + a] = flat ? (pts[0][0] ? { type: CONST, times: [], values: [pts[0][0]] } : { type: ZERO, times: [], values: [] })
            : { type: HERMITE, times: t, values: pts.flat() };
    }
    const shoulders = [...dropped].filter((b) => SHOULDERS.has(b));
    const unknown = [...dropped].filter((b) => !SHOULDERS.has(b));
    return { frames: 2 * m.frames, channels: ch, shoulders, unknown };
}

/** VF2's motion block (noclip motion.js decodeMotion): u16 frames; a control
 *  byte per object (top two bits 0: three 2-bit types, 3..6, less 3; else
 *  the whole object a latched constant, type top - 1); a key count per keyed
 *  channel; four-aligned, the key times (f32), then the values. */
export function encodeVF2(vf2) {
    const ch = vf2.channels;
    const counts = ch.filter((c) => c.type === HERMITE).map((c) => c.times.length);
    let n = (22 + counts.length + 3) & ~3;
    for (const c of ch) n += 4 * (c.times.length + c.values.length);
    const b = new Uint8Array(n), v = viewOf(b);
    v.setUint16(0, vf2.frames, true);
    for (let j = 0; j < 20; j++) {
        const t = ch.slice(j * 3, j * 3 + 3).map((c) => c.type);
        if (t[0] < ZERO) {
            if (!t.every((x) => x === t[0])) throw new Error(`object ${j}: latched axes differ`);
            b[2 + j] = (t[0] + 1) << 6;
        } else b[2 + j] = t.reduce((s, x, a) => s | ((x - ZERO) << (2 * a)), 0);
    }
    counts.forEach((c, i) => { b[22 + i] = c; });
    let p = (22 + counts.length + 3) & ~3;
    for (const c of ch) for (const t of c.times) { v.setFloat32(p, t, true); p += 4; }
    for (const c of ch) for (const x of c.values) { v.setFloat32(p, x, true); p += 4; }
    return b;
}

/**
 * A VF2 block as noclip's decodeMotion returns one: per channel its type,
 * key count and the offsets of its times and values in the block's own
 * view, so sampleMotion plays it whatever ROM it is handed.
 */
export function blockMotion(b, extra = {}) {
    const v = viewOf(b);
    const frames = v.getUint16(0, true);
    const types = [];
    for (let j = 0; j < 20; j++) {
        const c = b[2 + j], top = c >> 6;
        for (let a = 0; a < 3; a++) types.push(top === 0 ? ((c >> (2 * a)) & 3) + 3 : top - 1);
    }
    const counts = new Array(60).fill(0);
    let n = 0;
    for (let i = 0; i < 60; i++) if (types[i] === HERMITE || types[i] === 5) counts[i] = b[22 + n++];
    let p = (22 + n + 3) & ~3;
    const times = new Array(60).fill(-1), values = new Array(60).fill(-1);
    for (let i = 0; i < 60; i++) if (counts[i]) { times[i] = p; p += counts[i] * 4; }
    for (let i = 0; i < 60; i++) {
        const t = types[i];
        if (t === ZERO) continue;
        values[i] = p;
        p += t === HERMITE ? counts[i] * 12 : t === 5 ? counts[i] * 4 : 4;
    }
    const channels = types.map((type, i) => ({ type, count: counts[i], times: times[i], values: values[i], view: v }));
    return { frames, offset: 0, end: p, channels, view: v, ...extra };
}

/** Shenmue motion `index` of MOTION.BIN, ready for noclip's sampleMotion. */
export function shenmueMotion(file, index) {
    const m = decodeShenmue(file, index);
    return blockMotion(encodeVF2(toVF2(m)), { id: index, index, name: m.name, shenmue: true });
}
