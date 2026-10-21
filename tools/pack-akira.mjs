/*
 * Repack Akira's VF2 texture tiles into the seven Sonic the Fighters set 1
 * pages a fight never draws (3, 12, 15, 16, 18, 19, 21; docs/STF-BOARD-AKIRA.md),
 * and check the result in memory. Nothing is written to any ROM file.
 *
 *   node tools/pack-akira.mjs            plan, offsets and checks
 *   node tools/pack-akira.mjs --out DIR  also write the patch bytes to DIR
 *
 * What it builds, all in StF's address space:
 *   - seven uncompressed (type 1) 256x256 pages, levels 0-4, in the empty run of
 *     main_data from 0xD6F1AE;
 *   - after them, a copy of set 1's page list whose seven entries point at those
 *     pages (the live list at 0xB00010 is left alone);
 *   - after that, a copy of the texture-set table (TEX_HEADER+0x0C, 0x300DB0)
 *     whose set 1 entry names the list copy, and TEX_HEADER+0x0C itself
 *     (main_data 0x30000C) repointed at it. That word is the only one changed
 *     outside the runs: unp_send_tex_req reads it at prog 0x4AFD0
 *     (`ld 0x230000C,r4`, the only reference to it) and then the set's
 *     list at 0x4AFD8 (`ld (r4)[r3*4],r10`); set 1 goes through there once,
 *     at boot (send_tex_default, `send_tex_rob(1, 0, 0)` at 0x4A994);
 *   - copies of Akira's material records, with only th2's tile position
 *     changed, and of his UV streams, unchanged, in the empty run of the
 *     textures region from 0x78BDB8 (material and UV pointers index that
 *     region, so they cannot live in main_data).
 * Each tile keeps its size and its place on the 32-pixel grid; tiles that
 * overlap in VF2 move together, so a face that samples across them still does.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadNodeGames } from '../tests/node-roms.mjs';
import { decodeModel } from '../vendor/noclip/js/model.js';
import { readModelEntry, meshOffsetOf, MAIN_DATA_BASE } from '../vendor/noclip/js/romset.js';
import { buildTexram } from '../vendor/noclip/js/texture.js';
import { levelOrigin, texelByte, SHEET_BYTES, SHEET_H } from '../vendor/noclip/js/atlas.js';

const outDir = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;

/* Akira's models in VF2 (readFighters(vf2)[0].parts) and his texture sets. */
const MODELS = [407, 408, 409, 410, 411, 412, 413, 414, 416, 417, 419, 420, 421, 422, 2452, 2454, 2442];
const VF2_SETS = [40, 1, 2];
/* StF set 1: its page-list pointer, its list (listIdx word + 24 page pointers)
 * and the seven pages: index -> slot on sheet 1. */
const STF_SET = 1;
const LIST = 0xB00010;
const PAGES = [3, 12, 15, 16, 18, 19, 21];
const slotOf = (i) => (i < 16 ? { x: (i >> 2) * 256, y: (i & 3) * 256 }
    : { x: 1024 + ((i - 16) >> 1) * 256, y: ((i - 16) & 1) * 256 });
const PAGE_RUN = 0xD6F1AE, PAGE_RUN_LEN = 0x290E52;      /* main_data, 0xFF */
const TEX_RUN = 0x78BDB8, TEX_RUN_LEN = 0x74248;         /* textures, 0xFF */
const LEVELS = 5;                                        /* a raw page writes 0-4 */
const PAGE_BYTES = 16 + [...Array(LEVELS)].reduce((n, _, L) => n + (256 >> L) ** 2 / 2, 0);

const hex = (v) => '0x' + v.toString(16).toUpperCase();
const G = await loadNodeGames();
const vf2 = G.vf2.rom, stf = G.stf.rom;

/* ---- 1. Akira's streams and tiles ---------------------------------------- */

/* Which bytes of the textures region a decode reads, split by which stream. */
function streams(rom, m) {
    const e = readModelEntry(rom, m);
    const seen = new Set();
    const t = rom.textures;
    const proxy = new Proxy(t, {
        get(o, k) {
            if (typeof k === 'string' && /^\d+$/.test(k)) seen.add(+k);
            const v = Reflect.get(o, k, o);
            return typeof v === 'function' ? v.bind(o) : v;
        },
    });
    const fake = Object.create(rom);
    Object.defineProperty(fake, 'textures', { value: proxy });
    decodeModel(fake, m);
    const mat = [], uv = [];
    for (const b of seen) (Math.abs(b - e.matPtr * 2) < Math.abs(b - e.uvPtr * 2) ? mat : uv).push(b);
    const range = (a, at) => (a.length ? { from: Math.min(at, ...a), to: Math.max(...a) + 1 } : null);
    /* The material records the walk landed on: reads at the record's start. */
    const recs = mat.filter((b) => (b - e.matPtr * 2) % 8 === 0).sort((a, b) => a - b);
    return { e, mat: range(mat, e.matPtr * 2), uv: range(uv, e.uvPtr * 2), recs };
}

const rec = (rom, b) => ({
    th0: rom.textures[b] | (rom.textures[b + 1] << 8),
    th2: rom.textures[b + 4] | (rom.textures[b + 5] << 8),
});
const tileOf = ({ th0, th2 }) => ((th0 & 0x4000) === 0 ? null : {
    x: 32 * (th2 & 0x3f), y: 32 * ((th2 >> 6) & 0x1f), sheet: (th2 >> 12) & 1,
    w: 32 << (th0 & 7), h: 32 << ((th0 >> 3) & 7),
});
const key = (t) => `${t.x},${t.y},${t.w},${t.h}`;

const models = MODELS.map((m) => ({ m, ...streams(vf2, m) }));
const tiles = new Map();
for (const md of models) {
    for (const b of md.recs) {
        const t = tileOf(rec(vf2, b));
        if (!t) continue;
        if (t.sheet !== 1) throw new Error(`model ${md.m}: a tile on sheet 0`);
        tiles.set(key(t), t);
    }
}

/* ---- 2. Clusters of overlapping tiles, packed onto the 32-pixel grid ------ */

const tl = [...tiles.values()];
const parent = tl.map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
for (let i = 0; i < tl.length; i++) for (let j = 0; j < i; j++) if (overlap(tl[i], tl[j])) parent[find(i)] = find(j);
const groups = new Map();
tl.forEach((t, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(t); });
const clusters = [...groups.values()].map((members) => {
    const x = Math.min(...members.map((t) => t.x)), y = Math.min(...members.map((t) => t.y));
    const cells = new Set();
    for (const t of members) for (let cy = t.y; cy < t.y + t.h; cy += 32) for (let cx = t.x; cx < t.x + t.w; cx += 32) cells.add(`${(cx - x) / 32},${(cy - y) / 32}`);
    const cl = [...cells].map((c) => c.split(',').map(Number));
    return { members, x, y, cells: cl, cw: Math.max(...cl.map((c) => c[0])) + 1, ch: Math.max(...cl.map((c) => c[1])) + 1 };
});
const tileCount = clusters.reduce((n, c) => n + c.cells.length, 0);
clusters.sort((a, b) => b.cells.length - a.cells.length || b.ch * b.cw - a.ch * a.cw || a.y - b.y || a.x - b.x);

const used = PAGES.map(() => new Uint8Array(64));
for (const c of clusters) {
    place: for (let p = 0; p < PAGES.length; p++) {
        for (let oy = 0; oy + c.ch <= 8; oy++) {
            for (let ox = 0; ox + c.cw <= 8; ox++) {
                if (c.cells.some(([cx, cy]) => used[p][(oy + cy) * 8 + ox + cx])) continue;
                for (const [cx, cy] of c.cells) used[p][(oy + cy) * 8 + ox + cx] = 1;
                const s = slotOf(PAGES[p]);
                Object.assign(c, { page: PAGES[p], ox: ox * 32, oy: oy * 32, nx: s.x + ox * 32, ny: s.y + oy * 32 });
                break place;
            }
        }
    }
    if (c.page === undefined) throw new Error('out of room');
}
/* Old tile origin (sheet-1 coordinates) -> new one. */
const moved = new Map();
for (const c of clusters) for (const t of c.members) moved.set(key(t), { x: c.nx + t.x - c.x, y: c.ny + t.y - c.y, page: c.page });

/* ---- 3. The seven pages -------------------------------------------------- */

const texOf = (tr) => new Uint8Array(tr.sheet0.buffer, tr.sheet0.byteOffset, SHEET_BYTES * 2);
const nib = (tex, x, y) => {
    const o = texelByte(x, y) & ~1;
    return ((tex[o] | (tex[o + 1] << 8)) >> (((y & 1) ? 0 : 8) + ((x & 1) ? 0 : 4))) & 0xf;
};
const setNib = (tex, x, y, v) => {
    const o = texelByte(x, y) & ~1;
    const s = ((y & 1) ? 0 : 8) + ((x & 1) ? 0 : 4);
    const hw = ((tex[o] | (tex[o + 1] << 8)) & ~(0xf << s)) | (v << s);
    tex[o] = hw & 0xff; tex[o + 1] = hw >> 8;
};
const src = texOf(buildTexram(vf2, VF2_SETS));
/* Scratch texture RAM holding just the seven pages, every level, as the board
 * should end up with them; each page's bytes are then read out of it in the
 * order send_beta_data writes them back. */
const want = new Uint8Array(SHEET_BYTES * 2);
for (const c of clusters) {
    for (const t of c.members) {
        const n = moved.get(key(t));
        for (let L = 0; L < LEVELS; L++) {
            const so = levelOrigin(t.x, t.y + SHEET_H, L), no = levelOrigin(n.x, n.y + SHEET_H, L);
            for (let j = 0; j < t.h >> L; j++) for (let i = 0; i < t.w >> L; i++) setNib(want, no.x + i, no.y + j, nib(src, so.x + i, so.y + j));
        }
    }
}
function pageBytes(page) {
    const s = slotOf(page);
    const out = new Uint8Array(PAGE_BYTES).fill(0);
    out.set([1, 0, 0, 0, 255, 255, 10]);                /* type 1 (raw); h-1, w-1; skip to +16 */
    let ptr = 16;
    for (let L = 0; L < LEVELS; L++) {
        const at = levelOrigin(s.x, s.y + SHEET_H, L);
        let row = texelByte(at.x, at.y);
        const n = 256 >> (L + 1);
        for (let i = 0; i < n; i++, row += 0x400) {
            let o = row;
            for (let g = 0; g < n >> 3; g++, ptr += 16) {
                for (let half = 0; half < 2; half++) {
                    for (let k = 0; k < 4; k++, o += 2) {
                        out[ptr + k * 4 + half * 2] = want[o];
                        out[ptr + k * 4 + half * 2 + 1] = want[o + 1];
                    }
                }
            }
        }
    }
    if (ptr !== PAGE_BYTES) throw new Error('page size');
    return out;
}

/* main_data: pages from the first 16-byte boundary in the run, then the list. */
const md = new Uint8Array(stf.mainData);
const mdv = new DataView(md.buffer);
const PAGE0 = (PAGE_RUN + 15) & ~15;
const pageAt = {};
PAGES.forEach((p, i) => { pageAt[p] = PAGE0 + i * PAGE_BYTES; md.set(pageBytes(p), pageAt[p]); });
const LIST_COPY = PAGE0 + PAGES.length * PAGE_BYTES;
md.set(stf.mainData.subarray(LIST, LIST + 4 + 24 * 4), LIST_COPY);
for (const p of PAGES) mdv.setUint32(LIST_COPY + 4 + p * 4, MAIN_DATA_BASE + pageAt[p], true);
const HDR_SETS = stf.game.texture.header + 0x0c;
const SET_TABLE = mdv.getUint32(HDR_SETS, true) - MAIN_DATA_BASE;
const SETS = stf.game.texture.sets;
const TABLE_COPY = (LIST_COPY + 4 + 24 * 4 + 15) & ~15;
md.set(stf.mainData.subarray(SET_TABLE, SET_TABLE + SETS * 4), TABLE_COPY);
mdv.setUint32(TABLE_COPY + STF_SET * 4, MAIN_DATA_BASE + LIST_COPY, true);
mdv.setUint32(HDR_SETS, MAIN_DATA_BASE + TABLE_COPY, true);
const MD_END = TABLE_COPY + SETS * 4;
if (MD_END > PAGE_RUN + PAGE_RUN_LEN) throw new Error('main_data run too small');

/* ---- 4. Material and UV copies in the textures region -------------------- */

const tx = new Uint8Array(stf.textures);
let at = (TEX_RUN + 15) & ~15;
const copies = [];
for (const m of models) {
    const c = { m: m.m };
    if (m.mat) {
        c.mat = at; tx.set(vf2.textures.subarray(m.mat.from, m.mat.to), at);
        c.matPtr = (at + m.e.matPtr * 2 - m.mat.from) / 2;
        for (const b of new Set(m.recs)) {
            const t = tileOf(rec(vf2, b));
            if (!t) continue;
            const n = moved.get(key(t));
            const o = at + b - m.mat.from + 4;
            const th2 = (rec(vf2, b).th2 & ~0x7ff) | (n.x / 32) | ((n.y / 32) << 6);
            tx[o] = th2 & 0xff; tx[o + 1] = th2 >> 8;
        }
        at = (at + m.mat.to - m.mat.from + 15) & ~15;
    }
    if (m.uv) {
        c.uv = at; tx.set(vf2.textures.subarray(m.uv.from, m.uv.to), at);
        c.uvPtr = (at + m.e.uvPtr * 2 - m.uv.from) / 2;
        at = (at + m.uv.to - m.uv.from + 15) & ~15;
    } else c.uvPtr = 0;
    c.end = at;
    copies.push(c);
}
if (at > TEX_RUN + TEX_RUN_LEN) throw new Error('textures run too small');

/* ---- 5. Checks, against a StF patched in memory -------------------------- */

const patched = Object.create(stf);
Object.defineProperty(patched, 'mainData', { value: md });
Object.defineProperty(patched, 'mainDataView', { value: mdv });
Object.defineProperty(patched, 'textures', { value: tx });
const problems = [];

/* Only the runs changed, and in main_data TEX_HEADER+0x0C. */
const diffOutside = (a, b, lo, hi, skip = -1) => { for (let i = 0; i < a.length; i++) if ((i < lo || i >= hi) && (i < skip || i >= skip + 4) && a[i] !== b[i]) return i; return -1; };
let d = diffOutside(stf.mainData, md, PAGE_RUN, PAGE_RUN + PAGE_RUN_LEN, HDR_SETS);
if (d >= 0) problems.push(`main_data changed outside the run at ${hex(d)}`);
d = diffOutside(stf.textures, tx, TEX_RUN, TEX_RUN + TEX_RUN_LEN);
if (d >= 0) problems.push(`textures changed outside the run at ${hex(d)}`);

/* Every other set reads the same through the table copy. */
for (let s = 0; s < SETS; s++) if (s !== STF_SET && mdv.getUint32(TABLE_COPY + s * 4, true) !== mdv.getUint32(SET_TABLE + s * 4, true)) problems.push(`set ${s} differs in the table copy`);
if (mdv.getUint32(SET_TABLE + STF_SET * 4, true) !== MAIN_DATA_BASE + LIST) problems.push('the live set table changed');

/* Set 1 through the patched header: the same texture RAM except inside the
 * seven pages' levels 0-4. */
const live = texOf(buildTexram(stf, [STF_SET])), viaCopy = texOf(buildTexram(patched, [STF_SET]));
/* 1: levels 0-4 of a packed page; 2: its levels 5-9, which a raw page does
 * not write (the copy leaves there whatever was in texture RAM before). */
const inPages = new Uint8Array(SHEET_BYTES * 2);
for (const p of PAGES) {
    const s = slotOf(p);
    for (let L = 9; L >= 0; L--) {
        const o = levelOrigin(s.x, s.y + SHEET_H, L);
        for (let j = 0; j < Math.max(1, 256 >> L); j++) for (let i = 0; i < Math.max(1, 256 >> L); i++) inPages[texelByte(o.x + i, o.y + j) & ~1] = L < LEVELS ? 1 : 2;
    }
}
let outside = 0, inside = 0, deep = 0;
for (let o = 0; o < live.length; o += 2) {
    const same = live[o] === viaCopy[o] && live[o + 1] === viaCopy[o + 1];
    if (inPages[o] === 1) { if (viaCopy[o] !== want[o] || viaCopy[o + 1] !== want[o + 1]) inside++; } else if (!same) (inPages[o] === 2 ? deep++ : outside++);
}
if (outside) problems.push(`${outside} halfwords outside the seven pages differ`);
if (inside) problems.push(`${inside} halfwords inside the seven pages are not what was packed`);

/* Every face of Akira's: same size, same UVs, and the same texels at every
 * level 0-4 through its new record as through VF2's. */
let faces = 0;
for (const c of copies) {
    const e = readModelEntry(vf2, c.m);
    const bytes = vf2.polygons.subarray(meshOffsetOf(vf2, e));
    const a = decodeModel(vf2, c.m);
    const b = decodeModel(patched, -1, null, { bytes, uvPtr: c.uvPtr, matPtr: c.matPtr });
    if (a.uvs.length !== b.uvs.length || a.uvs.some((v, i) => v !== b.uvs[i])) { problems.push(`model ${c.m}: UVs differ`); continue; }
    for (let k = 0; k < a.tiles.length; k += 12) {
        const [ox, oy, w, h] = a.tiles.subarray(k, k + 4), [nx, ny, nw, nh] = b.tiles.subarray(k, k + 4);
        if (w !== nw || h !== nh) { problems.push(`model ${c.m}: a tile changed size`); break; }
        if (!w) continue;
        faces++;
        if (ny < SHEET_H || !PAGES.some((p) => { const s = slotOf(p); return nx >= s.x && nx + w <= s.x + 256 && ny - SHEET_H >= s.y && ny - SHEET_H + h <= s.y + 256; })) {
            problems.push(`model ${c.m}: a tile outside the seven pages`); break;
        }
        let bad = false;
        for (let L = 0; L < LEVELS && !bad; L++) {
            const so = levelOrigin(ox, oy, L), no = levelOrigin(nx, ny, L);
            for (let j = 0; j < h >> L && !bad; j++) for (let i = 0; i < w >> L; i++) if (nib(src, so.x + i, so.y + j) !== nib(viaCopy, no.x + i, no.y + j)) { bad = true; break; }
        }
        if (bad) { problems.push(`model ${c.m}: texels differ at ${nx},${ny}`); break; }
    }
}

/* ---- Report --------------------------------------------------------------- */

console.log(`${tiles.size} tiles (${tileCount} cells of 32x32) in ${clusters.length} groups`);
for (const p of PAGES) {
    const s = slotOf(p);
    console.log(`page ${p} slot (${s.x},${s.y}) data ${hex(pageAt[p])}..${hex(pageAt[p] + PAGE_BYTES)} list entry ${hex(LIST_COPY + 4 + p * 4)} = ${hex(MAIN_DATA_BASE + pageAt[p])}, ${used[PAGES.indexOf(p)].reduce((n, v) => n + v, 0)} cells`);
    for (const c of clusters.filter((c) => c.page === p).sort((a, b) => a.oy - b.oy || a.ox - b.ox)) {
        console.log(`  +${c.ox},${c.oy}: ${c.members.map((t) => `${t.w}x${t.h} VF2 (${t.x},${t.y}) -> (${moved.get(key(t)).x},${moved.get(key(t)).y})`).join('; ')}`);
    }
}
console.log(`list copy ${hex(LIST_COPY)}..${hex(LIST_COPY + 4 + 24 * 4)} (pointer ${hex(MAIN_DATA_BASE + LIST_COPY)})`);
console.log(`set table copy ${hex(TABLE_COPY)}..${hex(MD_END)}, entry ${STF_SET} = ${hex(MAIN_DATA_BASE + LIST_COPY)}`);
console.log(`TEX_HEADER+0x0C main_data ${hex(HDR_SETS)}: ${hex(MAIN_DATA_BASE + SET_TABLE)} -> ${hex(MAIN_DATA_BASE + TABLE_COPY)}`);
for (const c of copies) console.log(`model ${c.m}: mat ${c.mat !== undefined ? hex(c.mat) : '-'} matPtr ${hex(c.matPtr)} uvPtr ${hex(c.uvPtr)} (VF2 ${hex(readModelEntry(vf2, c.m).matPtr)} ${hex(readModelEntry(vf2, c.m).uvPtr)}) end ${hex(c.end)}`);
console.log(`textures used ${hex((TEX_RUN + 15) & ~15)}..${hex(at)}`);
console.log(`texture RAM through the copy: ${deep} halfwords of the seven pages' levels 5-9 not written (StF's own pages write them)`);
console.log(`${faces} textured faces checked; ${problems.length ? 'PROBLEMS:\n  ' + problems.join('\n  ') : 'all match'}`);

if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `main_data-${PAGE0.toString(16)}.bin`), md.subarray(PAGE0, MD_END));
    writeFileSync(join(outDir, `main_data-${HDR_SETS.toString(16)}.bin`), md.subarray(HDR_SETS, HDR_SETS + 4));
    writeFileSync(join(outDir, `textures-${((TEX_RUN + 15) & ~15).toString(16)}.bin`), tx.subarray((TEX_RUN + 15) & ~15, at));
}
process.exitCode = problems.length ? 1 : 0;
