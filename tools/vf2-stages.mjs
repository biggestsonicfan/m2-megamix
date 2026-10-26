/*
 * VF2's Tou-rin and Colosseum on the board (docs/BOARD.md, "VF2's stages").
 *
 * `vf2StagePlan` is what tools/bake-board.mjs and tools/import-assets.mjs
 * agree on: the stages, their draws (noclip vf2.js, the record at 0x6EE38 +
 * stage * 256 as the draw routine 0x20708 reads it), every VF2 model they
 * draw and the board's model id for each. `importVf2Stages` puts those models,
 * their texture pages and their colours into the data ROMs.
 *
 * Size: everything is drawn at Akira's VF2 scale on StF (vf2-guest.mjs SCALE,
 * 2.03): the meshes' points are scaled as his are, so the stage matrices carry
 * only StF's 1/1.6 and lighting sees unit matrices, as on StF's own stages.
 * VF2's ring (half 8.0 at the default setting, 0x11530) is then 16.2 wide
 * either side of the centre in StF's units.
 *
 * Textures: both stages upload one set (34, 30), twenty pages to the origins
 * of VF2's destination list 4 (StF's list 7, the same words). An even origin
 * is a page on the sheet th2 bit 12 names (texture.js pageSheet), the one
 * StF's set 1 fills with the fighters (Akira and Ryo among them): slots 16-23
 * there (x 1024-2047, y 0-511), which is most of what the stage models read.
 * An odd origin is a page on the stages' sheet: slots 12-23, of which the
 * models read only 22 and 23 (Tou-rin's wind). So the eight even pages go to
 * the stages' sheet at x 0-1023, y 0-511 (slots 0, 1, 4, 5, 8, 9, 12, 13:
 * the same two rows of four), each tile's th2 moved by the same step, the odd
 * pages 22 and 23 stay, and VF2's other ten pages are not loaded. The pages are
 * VF2's compressed ones as they are (the codec table at 0x2300010 is the same
 * word for word).
 */
import { SCALE } from './vf2-guest.mjs';
import { resolveData } from '../vendor/noclip/js/motion.js';
import { decodeModel } from '../vendor/noclip/js/model.js';
import { buildTexram } from '../vendor/noclip/js/texture.js';
import { levelOrigin, texelByte, SHEET_BYTES, SHEET_H } from '../vendor/noclip/js/atlas.js';
import { loadScrollCG, scrollAt } from '../vendor/noclip/js/scroll.js';
import { buildColorxlat } from '../vendor/noclip/js/colors.js';

/* VF2's stage slots the board has: Tou-rin, then the Colosseum. */
export const VF2_STAGE_SLOTS = [0, 1];
/* The board's model ids for them, from here down (import-assets checks that
 * neither StF's models the board keeps nor the guests' are among them). */
export const VF2_STAGE_TOP = 4835;
/* The board's texture sets for them: after StF's 18, in the copy of the set
 * table pack-akira makes; and the destination list they share. */
export const VF2_SET0 = 18;
const DATA_INDEX = 9;
/* VF2's ring half-size at the factory setting, in its own units: stage
 * setup (0xCF64) puts 0x50A704 in stage_x (0x50A00C), 7.5 from 0x11540[0]
 * (8.0, 0x11530's, only when the stages cycle). The ring-out test (0x17BA8),
 * the floor's scale (stage_x / 6.0, 0x20264) and the ring ground's pick
 * (0x20878) all read it; noclip's decoder draws the stages at 8.0. */
export const VF2_RING = 7.5;
const RING_UNIT = 6.0, RINGS = 0x84, ALT_RINGS = 0x6fe9c, EMPTY = 0xffff;
const ringIndex = (size) => { const n = Math.trunc(size * 2 + 0.5); return n <= 11 ? 5 : Math.min(n - 12, 4); };
export { SCALE };

/* A slot on a sheet (m2_tex_codec.h g_tex_lutx/luty: slot i's page starts at
 * (luty[i], lutx[i]) in a sheet's 2048 x 1024): 0-15 columns of four from
 * x 0, 16-23 two rows from x 1024. */
const slotOf = (x, y) => (x < 1024 ? (x >> 8) * 4 + (y >> 8) : y < 512 ? 16 + ((x - 1024) >> 8) * 2 + (y >> 8) : -1);
/* the pages the stages read on the stages' sheet, kept where they are */
const KEEP_ODD = new Set([22, 23]);
/* an even page's slot 16-23 -> the stages' sheet slot at x - 1024 */
const vf2Base = (rom, slot) => rom.game.stageTable.vf2.at + slot * 256;
const evenTo = (s) => ((s - 16) >> 1) * 4 + ((s - 16) & 1);

/*
 * The plan: for each stage, its draws as { model, ops, lit, frames, shift }:
 *   model   the model drawn (0: none in this look)
 *   lit     the Colosseum's storm: the lit twin drawn while channel 3 is on
 *   frames  Tou-rin's wind (kind 12, 0x30E74): 256 models, (frame >> shift) & 255
 * and the sorted VF2 models with their board ids.
 */
export function vf2StagePlan(games) {
    const vf2 = games.vf2;
    const stages = VF2_STAGE_SLOTS.map((slot) => {
        const st = vf2.stages.find((s) => s.slot === slot);
        const draws = st.draws.filter((d) => !d.extra && !d.points).map((d) => {
            const out = { model: d.model, ops: d.ops, layer: d.layer };
            if (d.anim?.index) { out.model = d.anim.frames[0]; out.lit = d.anim.frames[1]; }
            else if (d.anim) { out.frames = d.anim.frames; out.shift = d.anim.shift; out.model = d.anim.frames[0]; }
            /* the floor and the ring ground at VF2_RING, not the decoder's 8.0 */
            if (d.layer === 'floor') { const k = VF2_RING / RING_UNIT; out.ops = [['s', [k, 1, k]], ['t', [0, 0, 0]]]; }
            if (d.layer === 'ground') {
                const u16 = (a) => vf2.rom.mainCpuView.getUint16(a, true), base = vf2Base(vf2.rom, slot), i = ringIndex(VF2_RING);
                const own = u16(base + RINGS + i * 2), alt = u16(ALT_RINGS + i * 2);
                out.model = own === EMPTY ? 0 : own;
                /* an empty lit ground takes the stage's entry 0 (0x208EC) */
                if (out.lit !== undefined) out.lit = alt === EMPTY ? u16(base + RINGS) : alt;
            }
            return out;
        });
        return { st, draws };
    });
    const set = new Set();
    for (const { draws } of stages) for (const d of draws) for (const m of [d.model, d.lit, ...(d.frames ?? [])]) if (m) set.add(m);
    const models = [...set].sort((a, b) => a - b);
    const idOf = new Map(models.map((m, i) => [m, VF2_STAGE_TOP - i]));
    return { stages, models, idOf };
}

/*
 * The skies (noclip scroll.js buildVf2Sky): what 0x24314 loads at stage start
 * from the record at 0x2502C + stage * 32, as the board loads it.
 *
 * The characters: VF2 keeps a palette group's tiles in the 128-character
 * block of the same number (a tile's group is its char >> 7), Tou-rin's in
 * blocks 56-71 and the Colosseum's in 59-95 and 100-117. The board's own
 * tiles fill blocks 0-39 and StF's fight CG 84-106, so a block goes where it
 * is if that is free, else to the next free one (the Colosseum's 84-95 and
 * 100-106 to 40-58), its group with it, and every tile in the panorama is
 * renumbered to match.
 *
 * The colours: palette_w (MAME model2.cpp) shows each 5-bit component through
 * colorxlat row c at luma 0x40 and the gamma table. VF2's column there runs
 * 0, 68, 72 .. 202, StF's (the board's) 0, 28, 35 .. 224, so each component
 * becomes the one whose colour on the board is nearest VF2's (never 0: the
 * board's row 0 at luma 0x40 is not StF's 0).
 *
 * The panorama: patterns 0-15 of the list side by side, `rows` rows of 512
 * tiles, which the board streams into the tilemap a column pair at a time as
 * VF2's 0x24534 does from its copy at 0x579000.
 *
 * The Colosseum's storm (its record's frame routine, 0x2468C): channels 0
 * and 1 write fixed colours over the sky's groups as they turn on and off,
 * channel 2 the bolt over the tilemap (js/scroll.js has the picture). In the
 * attract fight channel 0 is the sky's flash: every cloud colour at once,
 * (22,10,29) to (46,22,58) in MAME, while channel 3 (the arena's light)
 * leaves the sky as it is. `storm.pal[ch]` is (board entry, on, off) for
 * each entry channel ch writes in a group the sky uses, snapped as the
 * palette is; `storm.bolt` the bolt's 8 column pairs of `BOLT.rows` rows
 * (tiles renumbered, their blocks loaded with the sky's), which go over map
 * rows 8 up in the slots of columns 24-31 while those columns are in.
 */
const VF2_SKY_RECORDS = 0x2502c;
const VF2_SKY_PATTERNS = 16;
const STORM_SKY = 0x2468c;
/* 0x2468C's palette writes, channel by channel: [first entry, groups, count,
 * on colours, off colours] (0x24744 on, 0x249BC off). */
const STORM_PAL = [
    [[0x3b0, 37, 16, 0x24c6c, 0x24c8c], [0x641, 12, 4, 0x24c76, 0x24c96], [0x701, 6, 4, 0x24c78, 0x24c98]],
    [[0x645, 12, 11, 0x24cb6, 0x24cd6], [0x706, 6, 11, 0x24cf8, 0x24d18]],
];
/* Channel 2's blocks for 0x8F1C (s16 added, s16 0 for byte entries, u32
 * rows, u32 width), one a column pair from map row 8, on and off. */
export const BOLT = { on: 0x2aa8346, off: 0x2aa85e6, step: 0x54, pairs: 8, col: 24, row: 8, rows: 18 };
/* blocks 126 and 127: FV's armour figures on the HUD (tools/bake-board.mjs) */
export const ARMOUR_BLOCKS = [126, 127];
const SKY_FREE_BLOCKS = [...Array.from({ length: 44 }, (_, i) => 40 + i), ...Array.from({ length: 19 }, (_, i) => 107 + i)];
/* The skies' place in main_data: free room above the guests' heap (366 KB
 * of skies in 384; the heap below runs up to it, its end checked on import). */
export const VF2_SKY_AT = 0x02fa0000;
const SKY_END = 0x03000000;
const gamma = (i) => Math.trunc(Math.max(((i - 64) * 255) / 191, 0));
const lumaCol = (cx, p) => Array.from({ length: 32 }, (_, r) => cx[p * 0x4000 + r * 0x200 + 0x80]);

export function vf2SkyPlan(games) {
    const vf2 = games.vf2.rom, stf = games.stf.rom, cpu = vf2.mainCpuView;
    const stfCx = buildColorxlat(stf, { colorSet: games.stf.stages[0].texSet[1], tint: games.stf.stages[0].tint, fighters: [] });
    const parts = [];
    let at = VF2_SKY_AT;
    const place = (bytes) => { const a = at; parts.push(bytes); at += (bytes.length + 15) & ~15; if (bytes.length & 15) parts.push(new Uint8Array(16 - (bytes.length & 15))); return a; };
    const skies = VF2_STAGE_SLOTS.map((slot) => {
        const st = games.vf2.stages.find((s) => s.slot === slot);
        const rec = VF2_SKY_RECORDS + st.num * 32;
        const list = cpu.getUint32(rec + 0x10, true);
        const rows = cpu.getUint16(list, true), voff = cpu.getUint8(list + 2);
        const { chars, pal } = loadScrollCG(vf2, cpu.getUint32(rec + 0x08, true), cpu.getUint32(rec + 0x0c, true), 0x80000);
        const cells = new Uint16Array(rows * 512);
        for (let i = 0; i < VF2_SKY_PATTERNS; i++) {
            const p = cpu.getUint32(list + 4 + i * 4, true);
            for (let r = 0; r < rows; r++) for (let x = 0; x < 32; x++) {
                const A = scrollAt(vf2, p + r * 64 + x * 2);
                cells[r * 512 + i * 32 + x] = A.view.getUint16(A.off, true);
            }
        }
        const storm = cpu.getUint32(rec + 4, true) === STORM_SKY;
        const bolt = storm ? boltCells(vf2, BOLT.on, rows) : new Uint16Array(0);
        if (storm) {
            /* the off blocks put back the panorama's own tiles */
            const off = boltCells(vf2, BOLT.off, rows);
            off.forEach((v, i) => {
                const k = i / (BOLT.rows * 2) | 0, r = (i >> 1) % BOLT.rows, x = i & 1;
                const own = cells[(BOLT.row + r) * 512 + (BOLT.col + k) * 2 + x];
                if (v !== own) throw new Error(`VF2 sky ${st.name}: the bolt's off block is not the panorama at pair ${BOLT.col + k} row ${r}`);
            });
        }
        const vCx = buildColorxlat(vf2, { colorSet: st.texSet[1], tint: st.tint, fighters: [] });
        const { dest, to, snap, cb, pb } = packSky(`VF2 sky ${st.name}`, cells, bolt, chars, pal, vCx, stfCx);
        const stormPal = !storm ? null : STORM_PAL.map((writes) => writes.flatMap(([first, groups, count, on, off]) => {
            const out = [];
            for (let g = 0; g < groups; g++) {
                const grp = (first >> 4) + g;
                if (!to.has(grp)) continue;
                for (let e = 0; e < count; e++) {
                    out.push([to.get(grp) * 16 + (first & 15) + e,
                        snap(cpu.getUint16(on + e * 2, true)), snap(cpu.getUint16(off + e * 2, true))]);
                }
            }
            return out;
        }));
        return { name: st.name, rows, voff, dest, chars: place(cb), pal: place(pb), pano: place(new Uint8Array(cells.buffer)),
            storm: storm ? { pal: stormPal, bolt } : null };
    });
    if (at > SKY_END) throw new Error(`VF2 skies: 0x${(at - VF2_SKY_AT).toString(16)} bytes, past main_data's end`);
    const blob = new Uint8Array(at - VF2_SKY_AT);
    let o = 0;
    for (const b of parts) { blob.set(b, o); o += b.length; }
    return { skies, blob };
}

/*
 * A sky's character blocks and palette groups onto the board (vf2SkyPlan's
 * notes): `cells` (and `extra`, more tiles to load with them) renumbered in
 * place to the blocks `dest` names, `cb` those blocks' characters and `pb`
 * their groups' colours, snapped from the game's colorxlat `srcCx` to the
 * board's `stfCx`. `snap` snaps one more colour.
 */
export function packSky(name, cells, extra, chars, pal, srcCx, stfCx) {
    const used = [...new Set(Array.from([...cells, ...extra], (v) => (v & 0x3fff) >> 7))].sort((a, b) => a - b);
    if (cells.some((v) => v & 0xc000)) throw new Error(`${name}: a tile in front or in groups 128 up`);
    const taken = new Set(used.filter((b) => SKY_FREE_BLOCKS.includes(b)));
    const spare = SKY_FREE_BLOCKS.filter((b) => !taken.has(b));
    const dest = used.map((b) => (taken.has(b) ? b : spare.shift()));
    if (dest.some((b) => b === undefined)) throw new Error(`${name}: ${used.length} blocks, not enough free`);
    const to = new Map(used.map((b, i) => [b, dest[i]]));
    for (let i = 0; i < cells.length; i++) cells[i] = (to.get(cells[i] >> 7) << 7) | (cells[i] & 0x7f);
    for (let i = 0; i < extra.length; i++) extra[i] = (to.get(extra[i] >> 7) << 7) | (extra[i] & 0x7f);
    const snap = colourSnap(srcCx, stfCx);
    const pb = new Uint8Array(used.length * 32), pv = new DataView(pb.buffer);
    used.forEach((b, k) => {
        for (let i = 0; i < 16; i++) pv.setUint16((k * 16 + i) * 2, snap(pal[b * 16 + i]), true);
    });
    const cb = new Uint8Array(used.length * 4096);
    used.forEach((b, k) => cb.set(chars.subarray(b * 4096, (b + 1) * 4096), k * 4096));
    return { dest, to, snap, cb, pb };
}

/* A tile colour as the game's colorxlat `srcCx` shows it, to the nearest
 * the board's `stfCx` shows, channel by channel. */
export function colourSnap(srcCx, stfCx) {
    const near = [0, 1, 2].map((p) => {
        const v = lumaCol(srcCx, p), b = lumaCol(stfCx, p);
        return v.map((x) => {
            let best = 1;
            for (let w = 2; w < 32; w++) if (Math.abs(gamma(b[w]) - gamma(x)) < Math.abs(gamma(b[best]) - gamma(x))) best = w;
            return best;
        });
    });
    return (c) => near[0][c & 31] | near[1][(c >> 5) & 31] << 5 | near[2][(c >> 10) & 31] << 10;
}

/* Channel 2's bolt as 0x8F1C writes it: BOLT.pairs blocks of BOLT.rows rows
 * of a column pair, pair by pair. */
function boltCells(rom, base, rows) {
    if (BOLT.row + BOLT.rows > rows) throw new Error(`VF2 sky: the bolt runs past the panorama's ${rows} rows`);
    const out = new Uint16Array(BOLT.pairs * BOLT.rows * 2);
    for (let k = 0; k < BOLT.pairs; k++) {
        const R = resolveData(rom, base + k * BOLT.step);
        const add = R.view.getInt16(R.off, true), bytes = R.view.getInt16(R.off + 2, true) === 0;
        const n = R.view.getUint32(R.off + 4, true), w = R.view.getUint32(R.off + 8, true);
        if (n !== BOLT.rows || w !== 2) throw new Error(`VF2 sky: bolt block ${k} is ${n} by ${w}`);
        for (let i = 0; i < n * w; i++) {
            const v = bytes ? R.view.getInt8(R.off + 12 + i) : R.view.getInt16(R.off + 12 + i * 2, true);
            out[k * BOLT.rows * 2 + i] = (v + add) & 0xffff;
        }
    }
    return out;
}

const hex = (v) => '0x' + v.toString(16).toUpperCase();

/* R: import-assets' regions and tables; games: noclip's ROM sets; ctx: what
 * importAkira built (its heap in main_data, pack-akira's set table copy, the
 * colorbases the guests took). */
export function importVf2Stages(R, games, ctx) {
    const { pack, freeTaken } = ctx;
    const { main, polygons, textures } = R;
    const vf2 = games.vf2.rom, stf = games.stf.rom;
    const plan = vf2StagePlan(games);
    const report = [];
    const MAIN_DATA = 0x02000000;

    /* free room in a region: the first gap of len bytes the board keeps nothing in */
    /* from 0x100: a pointer of 0 is none (a model with no UVs, no mesh) */
    const free = (r, len, align = 16, from = 0x100) => {
        const iv = r.kept.map(([a, b]) => [a, b]).sort((a, b) => a[0] - b[0]);
        let at = (from + align - 1) & ~(align - 1);
        for (const [a, b] of iv) {
            if (b <= at) continue;
            if (a >= at + len) break;
            at = (b + align - 1) & ~(align - 1);
        }
        if (at + len > r.out.length) throw new Error(`VF2 stages: no room for ${len} bytes in ${r.name}`);
        return at;
    };
    const isFree = (r, a, len) => !r.kept.some(([x, y]) => x < a + len && a < y);
    const u32s = (list) => { const b = new Uint8Array(list.length * 4); const v = new DataView(b.buffer); list.forEach((x, i) => v.setUint32(i * 4, x >>> 0, true)); return b; };

    for (const m of plan.models) {
        const id = plan.idOf.get(m);
        if (id <= 0 || !isFree(main, R.modelTable + id * 16, 16)) throw new Error(`VF2 stages: model id ${id} is taken (lower VF2_STAGE_TOP)`);
    }

    /* ---- colours: a colorbase whose palette entry differs from StF's names
     * an StF entry with VF2's value, or a free one set to it (as Akira's) ---- */
    const pal = (rom, cb) => rom.mainDataView.getUint16(0x100000 + cb * 2, true);
    const cbMap = new Map();
    let fresh = 0;
    const mapCb = (cb) => {
        if (!cb || pal(vf2, cb) === pal(stf, cb)) return cb;
        if (cbMap.has(cb)) return cbMap.get(cb);
        let n = 1;
        while (n < 0x400 && pal(stf, n) !== pal(vf2, cb)) n++;
        if (n === 0x400) {
            for (n = 0x3ff; n >= 32 && (R.colorbases.has(n) || freeTaken.has(n)); n--);
            if (n < 32) throw new Error('VF2 stages: no free colorbase');
            freeTaken.add(n); fresh++;
            main.put(0x100000 + n * 2, Uint8Array.of(pal(vf2, cb) & 0xff, pal(vf2, cb) >> 8), `VF2 stage colorbase ${cb}`);
        }
        cbMap.set(cb, n);
        return n;
    };
    /* a tile on the fighters' sheet (slots 16-23) moves to the stages' at x - 1024 */
    let moved = 0;
    const mapTh2 = (th0, th2) => {
        if (!(th0 & 0x4000)) return th2;
        const x = 32 * (th2 & 0x3f), y = 32 * ((th2 >> 6) & 0x1f), s = slotOf(x, y);
        if (!((th2 >> 12) & 1)) {
            if (!KEEP_ODD.has(s)) throw new Error(`VF2 stages: a tile on the stages' sheet, slot ${s}`);
            return th2;
        }
        if (s < 16) throw new Error(`VF2 stages: a tile on the fighters' sheet, slot ${s}`);
        moved++;
        return (th2 & ~0x103f) | ((x - 1024) / 32);
    };

    /* ---- models: the mesh (points scaled), its headers and points ---- */
    const vt = vf2.game.modelTable.offset;
    const raw = (m, o) => vf2.mainDataView.getUint32(vt + m * 16 + o, true);
    const vp = new DataView(vf2.polygons.buffer, vf2.polygons.byteOffset, vf2.polygons.byteLength);
    const vtx = vf2.textures;
    let polyBytes = 0, texBytes = 0;
    const copied = new Map();      /* textures range "from,to" -> its copy */
    const copyTex = (from, to, fix) => {
        const k = `${from},${to}`;
        if (copied.has(k)) return copied.get(k);
        const b = vtx.slice(from, to);
        if (fix) fix(b);
        const at = free(textures, b.length, 16);
        textures.put(at, b, `VF2 stage textures ${hex(from)}`);
        texBytes += b.length;
        copied.set(k, at);
        return at;
    };
    for (const m of plan.models) {
        const tpa = raw(m, 0), tha = raw(m, 4), oba = raw(m, 8);
        let obc = raw(m, 12);
        if (!(oba & 0x800000) || (oba & 0x1000000) || (tpa & 0x800000) || (tha & 0x800000)) throw new Error(`VF2 model ${m}: not all in ROM`);
        if (obc === 0) obc = 0xfffff;
        const base = (oba & 0x3fffff) * 4;
        let p = base + 24;
        const polys = [];
        for (let i = 0; i < obc; i++) {
            const attr = vp.getUint32(p, true);
            p += 16;
            if ((attr & 3) === 0) break;
            polys.push(attr);
            p += 24;
        }
        /* the mesh: VF2's, every record's two points scaled */
        const mesh = vf2.polygons.slice(base, p);
        const mv = new DataView(mesh.buffer);
        for (let q = 0; q + 24 <= mesh.length; q += 40) for (let k = 0; k < 6; k++) mv.setFloat32(q + k * 4, mv.getFloat32(q + k * 4, true) * SCALE, true);
        const polyAt = free(polygons, mesh.length, 4);
        polygons.put(polyAt, mesh, `VF2 stage model ${m} mesh`);
        polyBytes += mesh.length;
        /* the rasterizer's reads (import-assets keepModel) */
        let tp = tpa, th = tha, thLo = tha, thHi = tha;
        const recs = [];
        for (const attr of polys) {
            tp += ((attr & 1) ? 4 : 3) * 2;
            thLo = Math.min(thLo, th); thHi = Math.max(thHi, th + 4);
            recs.push(th);
            let tho = (attr >> 12) & 0x1f;
            if (tho & 0x10) tho -= 0x20;
            th += tho * 4;
        }
        let uv = 0, mat = 0;
        if (polys.length) {
            const uvAt = copyTex(tpa * 2, tp * 2);
            uv = uvAt / 2;
            const lo = thLo * 2;
            const matAt = copyTex(lo, thHi * 2, (b) => {
                const v = new DataView(b.buffer);
                for (const r of new Set(recs)) {
                    const o = r * 2 - lo;
                    const th0 = v.getUint16(o, true), th2 = v.getUint16(o + 4, true), th3 = v.getUint16(o + 6, true);
                    v.setUint16(o + 4, mapTh2(th0, th2), true);
                    v.setUint16(o + 6, (th3 & ~(0x3ff << 6)) | (mapCb((th3 >> 6) & 0x3ff) << 6), true);
                }
            });
            mat = (matAt + tha * 2 - lo) / 2;
        }
        main.put(R.modelTable + plan.idOf.get(m) * 16, u32s([uv, mat, (oba & ~0x3fffff) | (polyAt >> 2), raw(m, 12)]), `VF2 stage model ${m} as ${plan.idOf.get(m)}`);
    }
    report.push(`${plan.models.length} models as ${VF2_STAGE_TOP - plan.models.length + 1}..${VF2_STAGE_TOP}; meshes ${(polyBytes / 1024).toFixed(0)} KB, headers and points ${(texBytes / 1024).toFixed(0)} KB`);
    report.push(`${cbMap.size} colorbases moved (${fresh} new); ${moved} faces' tiles from the fighters' sheet to the stages'`);

    /* ---- texture sets ---- */
    const v32 = (a) => { const r = resolveData(vf2, a); return r.view.getUint32(r.off, true); };
    const VH = v32(0x0230000c), VD = v32(0x02300008);
    /* every VF2 page block, so a block runs to the next one */
    const blocks = new Set();
    for (let s = 0; s < vf2.game.texture.sets; s++) {
        const P = v32(VH + s * 4);
        if (!resolveData(vf2, P)) continue;
        const n = Math.min(v32(v32(VD + v32(P) * 4)), 24);
        for (let i = 0; i < n; i++) { const b = v32(P + 4 + i * 4); if (b) blocks.add(b); }
    }
    const sorted = [...blocks].sort((a, b) => a - b);
    const blockBytes = (b) => {
        const next = sorted.find((x) => x > b);
        const r = resolveData(vf2, b);
        const end = next !== undefined && next - b < 0x100000 ? next - b : (() => {
            for (let q = r.off; q < r.data.length; q += 4) if (r.data.subarray(q, q + 64).every((x) => x === 0xff)) return q - r.off;
            throw new Error(`VF2 page ${hex(b)} runs off the ROM`);
        })();
        return r.data.subarray(r.off, r.off + end);
    };
    /* the destination list, with the two moved pages and without the others on sheet 0 */
    const tdv = new DataView(pack.md.buffer);
    const tableAt = tdv.getUint32(pack.HDR_SETS, true) - MAIN_DATA;
    const dataTable = stf.mainDataView.getUint32(0x300008, true) - MAIN_DATA;
    const sets = plan.stages.map(({ st }) => st.texSets[0]);
    /* the set table copy's entries 18 on, which run past what pack-akira wrote */
    const entries = sets.map((_, k) => tableAt + (VF2_SET0 + k) * 4);
    for (const e of entries) {
        if (!isFree(main, e, 4)) throw new Error('VF2 stages: the set table copy runs into something');
        main.put(e, new Uint8Array(4), 'VF2 set entry');
    }
    let list = null;
    let pageBytes = 0;
    sets.forEach((s, k) => {
        const P = v32(VH + s * 4), D = v32(VD + v32(P) * 4), n = v32(D);
        const g2s = [], pages = [];
        for (let i = 0; i < n; i++) {
            let g2 = v32(D + 4 + i * 4);
            const b = v32(P + 4 + i * 4);
            const slot = (g2 >> 1) & 0x7fff;
            if (g2 & 1) { if (!KEEP_ODD.has(slot)) continue; }
            else g2 = (g2 & ~0xffff) | (evenTo(slot) << 1) | 1;
            g2s.push(g2);
            if (!b) { pages.push(0); continue; }
            /* at VF2's phase of 16: a raw page's texels start 16-aligned (send_beta_data) */
            const bytes = blockBytes(b), pad = b & 15, padded = new Uint8Array(pad + bytes.length);
            padded.set(bytes, pad);
            pageBytes += bytes.length;
            pages.push(ctx.alloc(padded, `set ${s} page ${i}`, 16, 'VF2 stage') + pad);
        }
        const l = u32s([g2s.length, ...g2s]);
        if (list && list.join() !== [...l].join()) throw new Error('VF2 stages: the sets\' destination lists differ');
        list = [...l];
        const pAt = ctx.alloc(u32s([DATA_INDEX, ...pages]), `set ${s} page list`, 16, 'VF2 stage');
        main.put(entries[k], u32s([pAt]), `VF2 set ${s} as ${VF2_SET0 + k}`);
    });
    const dAt = ctx.alloc(Uint8Array.from(list), 'destination list', 16, 'VF2 stage');
    if (!isFree(main, dataTable + DATA_INDEX * 4, 4)) throw new Error(`VF2 stages: destination list ${DATA_INDEX} is StF's`);
    main.put(dataTable + DATA_INDEX * 4, u32s([dAt]), `destination list ${DATA_INDEX}`);
    report.push(`sets ${sets.join(', ')} as ${sets.map((_, k) => VF2_SET0 + k).join(', ')}: ${list[0]} pages each, ${(pageBytes / 1024).toFixed(0)} KB`);
    /* the skies, at the fixed place bake-board.mjs gives the board */
    const sky = vf2SkyPlan(games);
    if (!isFree(main, VF2_SKY_AT - MAIN_DATA, sky.blob.length)) throw new Error('VF2 skies: their room in main_data is taken');
    main.put(VF2_SKY_AT - MAIN_DATA, sky.blob, 'VF2 stage skies');
    report.push(`skies ${sky.skies.map((k) => `${k.name} ${k.dest.length} blocks`).join(', ')}: ${(sky.blob.length / 1024).toFixed(0)} KB`);
    const problems = checkVf2Stages(R, games, plan, sets);
    if (problems.length) throw new Error(`VF2 stages: ${problems.slice(0, 8).join('; ')}`);
    report.push(`every model decodes through the board's ROMs as through VF2's: points at its scale, UVs, tile sizes, texels at levels 0-3`);
    return { report };
}

/* Each model through the board's data ROMs (StF's, as import-assets leaves
 * them) against VF2's: its points times SCALE, its UVs and tile sizes, and
 * the texels of every textured face at levels 0-3, VF2's texture RAM with
 * the stage's set against the board's with its set over StF's fighters'. */
function checkVf2Stages(R, games, plan, sets) {
    const vf2 = games.vf2.rom, stf = games.stf.rom;
    const board = Object.create(stf);
    const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (const [k, v] of Object.entries({ mainData: R.main.out, mainDataView: view(R.main.out), textures: R.textures.out,
        polygons: R.polygons.out, polygonsView: view(R.polygons.out) })) Object.defineProperty(board, k, { value: v });
    const texOf = (tr) => new Uint8Array(tr.sheet0.buffer, tr.sheet0.byteOffset, SHEET_BYTES * 2);
    const nib = (tex, x, y) => {
        const o = texelByte(x, y) & ~1;
        return ((tex[o] | (tex[o + 1] << 8)) >> (((y & 1) ? 0 : 8) + ((x & 1) ? 0 : 4))) & 0xf;
    };
    const problems = [];
    const near = (a, b) => Math.abs(a - b) <= 1e-4 * Math.max(1, Math.abs(b));
    plan.stages.forEach(({ draws }, k) => {
        const src = texOf(buildTexram(vf2, [sets[k]])), dst = texOf(buildTexram(board, [1, VF2_SET0 + k]));
        const models = new Set();
        for (const d of draws) for (const m of [d.model, d.lit, ...(d.frames ?? [])]) if (m) models.add(m);
        for (const m of models) {
            const a = decodeModel(vf2, m), b = decodeModel(board, plan.idOf.get(m));
            if (!a && !b) continue;                /* nothing to draw in either */
            if (!a || !b) { problems.push(`model ${m}: decodes in one only`); continue; }
            if (a.positions.length !== b.positions.length || a.positions.some((v, i) => !near(b.positions[i], v * SCALE))) { problems.push(`model ${m}: points differ`); continue; }
            if (a.uvs.length !== b.uvs.length || a.uvs.some((v, i) => v !== b.uvs[i])) { problems.push(`model ${m}: UVs differ`); continue; }
            for (let t = 0; t < a.tiles.length; t += 12) {
                const [ox, oy, w, h] = a.tiles.subarray(t, t + 4), [nx, ny, nw, nh] = b.tiles.subarray(t, t + 4);
                if (w !== nw || h !== nh) { problems.push(`model ${m}: a tile changed size`); break; }
                if (!w || (ox === 0 && oy === 0 && w === 32 && h === 32 && nx === 0 && ny === 0)) continue;
                let bad = false, badL = -1;
                for (let L = 0; L < 4 && !bad; L++) {
                    const so = levelOrigin(ox, oy, L), no = levelOrigin(nx, ny, L);
                    for (let j = 0; j < h >> L && !bad; j++) for (let i = 0; i < w >> L; i++) if (nib(src, so.x + i, so.y + j) !== nib(dst, no.x + i, no.y + j)) { bad = true; badL = L; break; }
                }
                if (bad) { problems.push(`model ${m}: texels differ at ${ox},${oy} -> ${nx},${ny} level ${badL}`); break; }
            }
        }
    });
    return problems;
}
