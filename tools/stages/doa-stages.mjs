/*
 * Dead or Alive's stage 10 on the board (docs/BOARD.md, "DOA's stage").
 *
 * `loadDoa` reads the Model 2B set (doab, with doa's ROMs) and the stage as
 * noclip's doa.js runs its draw routine; `doaStagePlan` is what
 * tools/board/bake-board.mjs and tools/board/import-assets.mjs agree on: the scenery's
 * draws, every model and texture point block they draw with and the board's
 * model id for each, and the two draws that sway. `importDoaStages` puts the
 * models, their texture pages, colours, lumaram bands and the sky into the
 * data ROMs.
 *
 * Size: VF2's scale (vf2-guest.mjs SCALE): DOA's fighters stand 1.24-1.57 of
 * its units, VF2's Akira 1.64 of VF2's. The ring's top is at y 1.0 in DOA's
 * frame (the platform models' top, the fighters' feet 0.96), so the draws
 * move down by it and StF's floor is there.
 *
 * Textures: DOA's stage sheet is raw, rows 512-1023 of x 0-1023 on both sheets
 * (texture.js buildDoaTexram), with no mip chain, and the scenery reads only
 * slots 2, 3, 6, 7, 10, 11, 14 and 15 of it. Those eight go to the same slots
 * of the board's stages' sheet as raw pages (texture.c tex_send_beta) with
 * mips made here, 2x2 boxes with texel 15 (clear) kept where two of the four
 * are; each face's th2 loses bit 12, so every face reads the stages' sheet.
 *
 * Colours: a DOA face's colour is three components, each a row of DOA's
 * colorxlat; the board keeps StF's rows 0..27 at luma 0..47 (the fighters'
 * faces read them), so each component becomes the StF row that shows nearest
 * to it across the luma range. DOA's four lumaram bands come along at 3/4,
 * so a textured face stays at luma 0..47. The four untextured faces, whose
 * luma is the light's alone and reaches 63, take rows 14..27, whose luma
 * 48..63 are the stage's own band, with DOA's row there.
 */
import { readFileSync } from 'node:fs';
import { SCALE } from '../guests/vf2-guest.mjs';
import { loadRomSet, readModelEntry, meshOffsetOf, facePalette } from '../../vendor/noclip/js/romset.js';
import { readDoaStages, doaPoints } from '../../vendor/noclip/js/doa.js';
import { decodeModel } from '../../vendor/noclip/js/model.js';
import { buildTexram } from '../../vendor/noclip/js/texture.js';
import { levelOrigin, texelByte, SHEET_BYTES } from '../../vendor/noclip/js/atlas.js';
import { scrollAt } from '../../vendor/noclip/js/scroll.js';
import { buildColorxlat, buildLumaram } from '../../vendor/noclip/js/colors.js';
import { packSky } from './vf2-stages.mjs';

const ROMS = process.env.ROMS_DIR || `${process.env.HOME}/build/mameroms`;
export const DOA_STAGE = 10;
export const DOA_SCALE = SCALE;
/* the ring's top, in DOA's units */
export const DOA_FLOOR = 1.0;
/* the ring's half side (models 18416-18421, x and z +-12.1) */
export const DOA_RING = 12.1;
/* model ids from here down (VF2's Test has 4090..4139) */
export const DOA_STAGE_TOP = 4089;
export const DOA_SET = 22;
const DATA_INDEX = 12;
const SLOTS = [2, 3, 6, 7, 10, 11, 14, 15];
/* its pages, then its sky, in main_data's free MB above the guests' heap */
const ROOM = [0x02a00000, 0x02a80000];
export const DOA_SKY_AT = 0x02a80000;
const SKY_END = 0x02b00000;
/* the sway's period, in frames */
export const SWAY = 512;
/* DOA's bands, in the board's lumaram after StF's 71 */
const STF_BANDS = 71;
const LUMA = 0x0d0008;
const MATERIALS = 0x6b0;
const MAIN_DATA = 0x02000000;
const hex = (v) => '0x' + v.toString(16).toUpperCase();

export async function loadDoa() {
    const zip = (z) => { const b = readFileSync(`${ROMS}/${z}.zip`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
    const rom = await loadRomSet(['doab', 'doa'].map(zip), () => {});
    const st = readDoaStages(rom).find((s) => s.num === DOA_STAGE);
    if (!st) throw new Error(`DOA: no stage ${DOA_STAGE}`);
    return { rom, st };
}

/* The scenery's draws as { model, uv, ops, sway } (sway: SWAY frames of ops
 * from the stage's start), each (model, uv) pair a board model. */
export function doaStagePlan(doa) {
    const { st } = doa;
    const key = (ops) => JSON.stringify(ops);
    const draws = st.draws.filter((d) => d.layer === 'scenery').map((d) => {
        /* a draw with no points of its own has its model's */
        const uv = d.points ? parseInt(d.points.key.slice(2), 16) : readModelEntry(doa.rom, d.model).uvPtr;
        let sway = null;
        if (d.live) {
            const at = Array.from({ length: SWAY }, (_, f) => d.live(f).ops);
            if (at.some((o) => key(o) !== key(at[0]))) {
                for (const f of [0, 1, 100, 300]) if (key(d.live(f + SWAY).ops) !== key(at[f])) throw new Error(`DOA model ${d.model}: its sway is not ${SWAY} frames`);
                sway = at;
            }
        }
        return { model: d.model, uv, ops: d.ops, sway };
    });
    const pairs = [...new Set(draws.map((d) => `${d.model}:${d.uv}`))];
    const idOf = new Map(pairs.map((p, i) => [p, DOA_STAGE_TOP - i]));
    for (const d of draws) d.id = idOf.get(`${d.model}:${d.uv}`);
    return { st, draws, pairs, idOf };
}

/* the stage's 32 materials (program 0x6B0, two words a slot) */
export const doaMaterials = (doa) => Array.from({ length: 32 }, (_, i) => doa.rom.mainCpuView.getUint32(MATERIALS + i * 8, true));

const gamma = (i) => Math.max(((i - 64) * 255) / 191, 0);
const cxAt = (cx, ch, r, l) => cx[ch * 0x4000 + r * 0x200 + l * 2] | (cx[ch * 0x4000 + r * 0x200 + l * 2 + 1] << 8);

/* StF's stage colorxlat, rows 0..27 at luma 0..63, with DOA's luma 48..63 of
 * the untextured faces' rows put in (doaColours). */
export function stfStageCx(games) {
    const s0 = games.stf.stages[0];
    return buildColorxlat(games.stf.rom, { colorSet: s0.texSet[1], tint: s0.tint, fighters: [] });
}

/*
 * Each DOA colorbase the scenery reads, as the board's colour: a textured
 * face's component c of channel ch becomes the board row whose curve at
 * 3/4 the luma is nearest DOA's row c (gamma'd, over luma 0..63); an
 * untextured face's the row of 14..27 nearest at luma 32..47, whose luma
 * 48..63 then take DOA's (tails, [ch, row, 16 values]).
 */
export function doaColours(doa, games, used) {
    const cxD = buildColorxlat(doa.rom, { colorSet: doa.st.texSet[1], tint: doa.st.tint, fighters: [] });
    const cxS = stfStageCx(games);
    const pal = facePalette(doa.rom);
    const fit = (ch, c, rows, l0, l1, scale) => {
        let best = -1, bestE = Infinity;
        for (const r of rows) {
            let e = 0;
            for (let l = l0; l <= l1; l++) e += Math.abs(gamma(cxAt(cxS, ch, r, Math.floor(l * scale))) - gamma(cxAt(cxD, ch, c, l)));
            if (e < bestE) { bestE = e; best = r; }
        }
        return best;
    };
    const ALL = Array.from({ length: 28 }, (_, r) => r), OWN = ALL.slice(14);
    const tails = new Map();       /* "ch:row" -> DOA row c whose 48..63 it shows */
    const colour = new Map();      /* "cb t|u" -> 555 */
    for (const k of used) {
        const cb = parseInt(k), textured = k.endsWith('t'), c555 = pal[cb];
        if (c555 < 0) throw new Error(`DOA colorbase ${cb}: no colour`);
        let out = c555 & 0x8000;
        for (let ch = 0; ch < 3; ch++) {
            const c = (c555 >> (5 * ch)) & 31;
            let r;
            if (textured) r = fit(ch, c, ALL, 0, 63, 3 / 4);
            else {
                const free = OWN.filter((x) => !tails.has(`${ch}:${x}`) || tails.get(`${ch}:${x}`) === c);
                r = fit(ch, c, free, 32, 47, 1);
                tails.set(`${ch}:${r}`, c);
            }
            out |= r << (5 * ch);
        }
        colour.set(k, out);
    }
    const tailList = [...tails].map(([k, c]) => {
        const [ch, r] = k.split(':').map(Number);
        return [ch, r, Array.from({ length: 16 }, (_, i) => cxAt(cxD, ch, c, 48 + i))];
    });
    return { colour, tails: tailList };
}

/* The board's stage colorxlat: StF's, with doaColours' tails. */
export function doaStageCx(doa, games, plan) {
    const cx = stfStageCx(games), { tails } = doaColours(doa, games, doaModels(doa, plan).used);
    for (const [ch, r, v] of tails) v.forEach((x, i) => { const o = ch * 0x4000 + r * 0x200 + (48 + i) * 2; cx[o] = x & 0xff; cx[o + 1] = x >> 8; });
    return cx;
}

/* The scenery's faces: per (model, uv) its mesh, headers and the colorbases
 * ("cb" + t or u) they name. */
function doaModels(doa, plan) {
    const { rom } = doa;
    const vp = new DataView(rom.polygons.buffer, rom.polygons.byteOffset, rom.polygons.byteLength);
    const tx = rom.textures, u16 = (a) => tx[a] | (tx[a + 1] << 8);
    const vt = rom.game.modelTable.offset;
    const used = new Set();
    const models = plan.pairs.map((p) => {
        const [m, uv] = p.split(':').map(Number);
        const e = readModelEntry(rom, m), obc = rom.mainDataView.getUint32(vt + m * 16 + 12, true);
        const base = meshOffsetOf(rom, e);
        if (base < 0 || (e.matPtr & 0x800000) || (uv & 0x800000)) throw new Error(`DOA model ${m}: not all in ROM`);
        let p0 = base + 24, tp = uv, th = e.matPtr, thLo = th, thHi = th;
        const recs = [];
        /* to the record whose attribute is 0, as decodeModel reads it: a
         * mesh's count (obc) stops short of it */
        for (;;) {
            const attr = vp.getUint32(p0, true);
            p0 += 16;
            if (attr === 0) break;
            p0 += 24;
            tp += ((attr & 1) ? 4 : 3) * 2;
            thLo = Math.min(thLo, th); thHi = Math.max(thHi, th + 4);
            recs.push(th);
            const textured = (u16(th * 2) & 0x4000) !== 0;
            used.add(((u16(th * 2 + 6) >> 6) & 0x3ff) + (textured ? 't' : 'u'));
            let tho = (attr >> 12) & 0x1f;
            if (tho & 0x10) tho -= 0x20;
            th += tho * 4;
        }
        return { m, uv, id: plan.idOf.get(p), obc, mesh: [base, p0], points: [uv, tp], heads: [thLo, thHi], recs: [...new Set(recs)], tha: e.matPtr };
    });
    return { models, used };
}

/* ---- texture pages ---- */

const nib = (tex, x, y) => {
    const o = texelByte(x, y) & ~1;
    return ((tex[o] | (tex[o + 1] << 8)) >> (((y & 1) ? 0 : 8) + ((x & 1) ? 0 : 4))) & 0xf;
};
/* a level from the one above: each 2x2 box's mean, clear where two are */
function halve(t, n) {
    const o = new Uint8Array((n >> 1) * (n >> 1));
    for (let y = 0; y < n; y += 2) for (let x = 0; x < n; x += 2) {
        const v = [t[y * n + x], t[y * n + x + 1], t[(y + 1) * n + x], t[(y + 1) * n + x + 1]], solid = v.filter((q) => q !== 15);
        o[(y >> 1) * (n >> 1) + (x >> 1)] = solid.length <= 2 ? 15 : Math.min(14, Math.round(solid.reduce((a, b) => a + b, 0) / solid.length));
    }
    return o;
}
/* slot s's levels 0..4 (256x256 down to 16x16), texel by texel */
export function doaPageLevels(src, s) {
    const x0 = (s >> 2) * 256, y0 = (s & 3) * 256, L0 = new Uint8Array(256 * 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) L0[y * 256 + x] = nib(src, x0 + x, y0 + y);
    const levels = [L0];
    for (let n = 256; n > 16; n >>= 1) levels.push(halve(levels.at(-1), n));
    return levels;
}
/* a raw page block (tex_send_beta), 16-aligned: the nonzero word, the body's
 * size bytes and skip, then each level's row pairs of 16-byte groups */
function rawPage(levels) {
    const out = new Uint8Array(16 + 43648), v = new DataView(out.buffer);
    v.setUint32(0, 1, true);
    out[4] = 255; out[5] = 255; out[6] = 10;
    let p = 16;
    levels.forEach((t, L) => {
        const n = 256 >> L;
        for (let y = 0; y < n; y += 2) for (let g = 0; g < n; g += 16) {
            const hw = Array.from({ length: 8 }, (_, k) => {
                const x = g + k * 2;
                return (t[y * n + x] << 12) | (t[y * n + x + 1] << 8) | (t[(y + 1) * n + x] << 4) | t[(y + 1) * n + x + 1];
            });
            for (let k = 0; k < 4; k++) v.setUint32(p + k * 4, hw[k] | (hw[k + 4] << 16), true);
            p += 16;
        }
    });
    if (p !== out.length) throw new Error('DOA page: wrong size');
    return out;
}

/* ---- sky ---- */

/* One scroll picture (scroll.js doaPicture): its map's tiles and its tiles
 * and colours, block by block as the chunks take them. */
function doaPicture(rom, n) {
    const S = rom.game.doa.sky;
    const word = (a) => { const t = scrollAt(rom, a); return t.view.getUint32(t.off, true); };
    const rec = S.pictures + n * 12;
    let t = scrollAt(rom, word(rec)), p = scrollAt(rom, word(rec + 4));
    const tiles = [], colours = [];
    for (;;) {
        const count = t.view.getUint32(t.off, true);
        if (!count) break;
        const blocks = Math.ceil(count / 128);
        for (let k = 0; k < count; k++) tiles.push(t.u8.subarray(t.off + 4 + k * 32, t.off + 36 + k * 32));
        while (tiles.length < (colours.length + blocks) * 128) tiles.push(null);
        const pal = Array.from({ length: 16 }, (_, c) => p.view.getUint16(p.off + c * 2, true) & 0x7fff);
        for (let b = 0; b < blocks; b++) colours.push(pal);
        t = { ...t, off: t.off + 4 + count * 32 };
        p = { ...p, off: p.off + 32 };
    }
    const M = scrollAt(rom, word(rec + 8));
    const w = M.view.getUint16(M.off, true), h = M.view.getUint16(M.off + 2, true);
    const map = Array.from({ length: w * h }, (_, i) => M.view.getUint16(M.off + 4 + i * 2, true) & 0x1fff);
    return { w, h, map, tiles, colours };
}

/*
 * The sky: the stage's four pictures side by side (DOA's 256-tile ring, a
 * turn to its 2048 pixels), twice across the board's 512-tile rows, the
 * pictures' blocks one after another and packed onto the board's free ones
 * (vf2-stages.mjs packSky). Its colours are raw, so they snap through a
 * colorxlat that shows each component as itself. DOA puts row 192 + 80 on
 * the eye line.
 */
export function doaSkyPlan(doa, games) {
    const { rom } = doa, S = rom.game.doa.sky;
    const pics = Array.from({ length: 4 }, (_, k) => doaPicture(rom, rom.mainCpuView.getInt16(S.stages + DOA_STAGE * 8 + k * 2, true)));
    const rows = pics[0].h;
    if (pics.some((p) => p.w !== 64 || p.h !== rows)) throw new Error('DOA sky: pictures not 64 tiles across, all one height');
    /* the tiles the maps show, each once a palette, a palette's in blocks of its own */
    const byPal = new Map();       /* palette -> Map(tile bytes -> index) */
    const where = pics.map((p) => p.map.map((t) => {
        const c = p.colours[t >> 7], tile = p.tiles[t];
        if (!c || !tile) throw new Error(`DOA sky: tile ${t} of a picture is not loaded`);
        const pk = c.join(), tk = Buffer.from(tile).toString('hex');
        if (!byPal.has(pk)) byPal.set(pk, { c, tiles: new Map() });
        const P = byPal.get(pk);
        if (!P.tiles.has(tk)) P.tiles.set(tk, { i: P.tiles.size, tile });
        return [pk, P.tiles.get(tk).i];
    }));
    let nb = 0;
    for (const P of byPal.values()) { P.b0 = nb; nb += Math.ceil(P.tiles.size / 128); }
    const chars = new Uint8Array(nb * 4096), pal = new Uint16Array(nb * 16), cells = new Uint16Array(rows * 512);
    for (const P of byPal.values()) {
        for (const { i, tile } of P.tiles.values()) chars.set(tile, (P.b0 * 128 + i) * 32);
        for (let b = P.b0; b < P.b0 + Math.ceil(P.tiles.size / 128); b++) pal.set(P.c, b * 16);
    }
    where.forEach((w, k) => w.forEach(([pk, i], n) => {
        const r = Math.floor(n / 64), x = n % 64, v = (byPal.get(pk).b0 * 128 + i);
        cells[r * 512 + k * 64 + x] = cells[r * 512 + 256 + k * 64 + x] = v;
    }));
    const srcCx = new Uint8Array(0xc000);
    for (let ch = 0; ch < 3; ch++) for (let r = 0; r < 32; r++) srcCx[ch * 0x4000 + r * 0x200 + 0x80] = 64 + Math.round((r * 191) / 31);
    /* the backdrop: the commonest colour of the top row's top lines */
    const seen = new Map();
    for (let x = 0; x < 256; x++) for (let i = 0; i < 4; i++) {
        const v = cells[x], c = pal[(v >> 7) * 16 + (chars[v * 32 + i] >> 4)];
        seen.set(c, (seen.get(c) || 0) + 1);
    }
    const top = [...seen].sort((a, b) => b[1] - a[1])[0][0];
    const { dest, snap, cb, pb } = packSky('DOA sky', cells, [], chars, pal, srcCx, stfStageCx(games));
    const parts = [];
    let at = DOA_SKY_AT;
    const place = (bytes) => { const a = at; parts.push(bytes, new Uint8Array(((bytes.length + 15) & ~15) - bytes.length)); at += (bytes.length + 15) & ~15; return a; };
    const sky = { rows, eye: 192 + 80, head: 0, dest, chars: place(cb), pal: place(pb), pano: place(new Uint8Array(cells.buffer)) };
    if (at > SKY_END) throw new Error(`DOA sky: past ${hex(SKY_END)}`);
    const blob = new Uint8Array(at - DOA_SKY_AT);
    let o = 0;
    for (const b of parts) { blob.set(b, o); o += b.length; }
    return { sky, blob, bg: snap(top) };
}

/* ---- the import ---- */

export async function importDoaStages(R, games, ctx) {
    const doa = await loadDoa();
    const plan = doaStagePlan(doa);
    const { main } = R;
    const report = [];
    const later = Object.values(R.guest.tables).map((t) => [t.at - MAIN_DATA, t.at - MAIN_DATA + t.bytes.length]);
    const free = (r, len, align = 16, from = 0x100) => {
        const iv = [...r.kept, ...(r === main ? later : [])].map(([a, b]) => [a, b]).sort((a, b) => a[0] - b[0]);
        let at = (from + align - 1) & ~(align - 1);
        for (const [a, b] of iv) {
            if (b <= at) continue;
            if (a >= at + len) break;
            at = (b + align - 1) & ~(align - 1);
        }
        if (at + len > r.out.length) throw new Error(`DOA stage: no room for ${len} bytes in ${r.name}`);
        return at;
    };
    const isFree = (r, a, len) => ![...r.kept, ...(r === main ? later : [])].some(([x, y]) => x < a + len && a < y);
    const inRoom = (len, label) => {
        const at = free(main, len, 16, ROOM[0] - MAIN_DATA);
        if (MAIN_DATA + at + len > ROOM[1]) throw new Error(`DOA stage: ${label} past ${hex(ROOM[1])}`);
        return at;
    };
    for (const id of plan.idOf.values()) if (!isFree(main, R.modelTable + id * 16, 16)) throw new Error(`DOA stage: model id ${id} is taken`);

    const { models, used } = doaModels(doa, plan);
    const { colour, tails } = doaColours(doa, games, used);
    const cbOf = importDoaColours(R, ctx, colour, report);
    importDoaModels(R, doa, models, cbOf, free, report);
    importDoaLuma(R, doa, models, isFree, report);
    importDoaSet(R, ctx, doa, inRoom, isFree, report);
    const sky = doaSkyPlan(doa, games);
    if (!isFree(main, DOA_SKY_AT - MAIN_DATA, sky.blob.length)) throw new Error('DOA sky: its room in main_data is taken');
    main.put(DOA_SKY_AT - MAIN_DATA, sky.blob, 'DOA stage sky');
    report.push(`sky ${sky.sky.rows} rows, ${sky.sky.dest.length} blocks, ${(sky.blob.length / 1024).toFixed(0)} KB at ${hex(DOA_SKY_AT)}`);
    const problems = checkDoaStage(R, games, doa, models);
    if (problems.length) throw new Error(`DOA stage: ${problems.slice(0, 8).join('; ')}`);
    report.push(`every model decodes through the board's ROMs as through DOA's: points at its scale, UVs, tile sizes, texels at levels 0-3; ${tails.length} rows' luma 48-63 DOA's`);
    return { report };
}

/* Each colour (doaColours) as a colorbase: StF's own where one is that
 * colour, else a free one set to it. */
function importDoaColours(R, ctx, colour, report) {
    const { freeTaken } = ctx, { main } = R;
    const now = (n) => main.out[0x100000 + n * 2] | (main.out[0x100000 + n * 2 + 1] << 8);
    const cbOf = new Map();
    let fresh = 0;
    for (const [k, c] of colour) {
        let n = 1;
        while (n < 0x400 && !(now(n) === c && (R.colorbases.has(n) || freeTaken.has(n)))) n++;
        if (n === 0x400) {
            for (n = 0x3ff; n >= 32 && (R.colorbases.has(n) || freeTaken.has(n)); n--);
            if (n < 32) throw new Error('DOA stage: no free colorbase');
            freeTaken.add(n); fresh++;
            main.put(0x100000 + n * 2, Uint8Array.of(c & 0xff, c >> 8), `DOA stage colorbase ${k}`);
        }
        cbOf.set(k, n);
    }
    report.push(`${colour.size} colours as colorbases (${fresh} new)`);
    return cbOf;
}

const u32s = (list) => { const b = new Uint8Array(list.length * 4); const v = new DataView(b.buffer); list.forEach((x, i) => v.setUint32(i * 4, x >>> 0, true)); return b; };
const bandOf = (b) => { const i = BANDS.indexOf(b); if (i < 0) throw new Error(`DOA stage: lumaram band ${b} not one of ${BANDS}`); return STF_BANDS + i; };
/* the bands the scenery's textured faces read */
const BANDS = [98, 100, 89, 85];

/* The models: DOA's meshes scaled, their points and headers (bands, sheet
 * and colorbases the board's) in textures, as ids plan.idOf. */
function importDoaModels(R, doa, models, cbOf, free, report) {
    const { main, polygons, textures } = R, { rom } = doa;
    let polyBytes = 0, texBytes = 0;
    const put = (r, b, label, align) => { const at = free(r, b.length, align); r.put(at, b, label); return at; };
    const points = new Map();
    for (const md of models) {
        const mesh = rom.polygons.slice(md.mesh[0], md.mesh[1]), mv = new DataView(mesh.buffer);
        for (let q = 0; q + 24 <= mesh.length; q += 40) for (let k = 0; k < 6; k++) mv.setFloat32(q + k * 4, mv.getFloat32(q + k * 4, true) * DOA_SCALE, true);
        const polyAt = put(polygons, mesh, `DOA stage model ${md.m} mesh`, 4);
        polyBytes += mesh.length;
        let uv = 0, mat = 0;
        if (md.recs.length) {
            const pk = md.points.join();
            if (!points.has(pk)) { points.set(pk, put(textures, rom.textures.slice(md.points[0] * 2, md.points[1] * 2), `DOA stage points ${hex(md.uv)}`, 16)); texBytes += (md.points[1] - md.points[0]) * 2; }
            uv = points.get(pk) / 2;
            const lo = md.heads[0] * 2, b = rom.textures.slice(lo, md.heads[1] * 2), v = new DataView(b.buffer);
            for (const r of md.recs) {
                const o = r * 2 - lo, th0 = v.getUint16(o, true), th3 = v.getUint16(o + 6, true), textured = (th0 & 0x4000) !== 0;
                if (textured) {
                    v.setUint16(o + 2, (v.getUint16(o + 2, true) & ~0xff) | bandOf(v.getUint16(o + 2, true) & 0xff), true);
                    v.setUint16(o + 4, v.getUint16(o + 4, true) & ~0x1000, true);
                }
                v.setUint16(o + 6, (th3 & ~(0x3ff << 6)) | (cbOf.get(((th3 >> 6) & 0x3ff) + (textured ? 't' : 'u')) << 6), true);
            }
            mat = (put(textures, b, `DOA stage model ${md.m} headers`, 16) + md.tha * 2 - lo) / 2;
            texBytes += b.length;
        }
        main.put(R.modelTable + md.id * 16, u32s([uv, mat, 0x800000 | (polyAt >> 2), md.obc]), `DOA stage model ${md.m} as ${md.id}`);
    }
    report.push(`${models.length} models (model and points) as ${DOA_STAGE_TOP - models.length + 1}..${DOA_STAGE_TOP}; meshes ${(polyBytes / 1024).toFixed(0)} KB, headers and points ${(texBytes / 1024).toFixed(0)} KB`);
}

/* DOA's bands after StF's, at 3/4 */
function importDoaLuma(R, doa, models, isFree, report) {
    const { main } = R, lD = buildLumaram(doa.rom);
    if (main.u32(LUMA) !== STF_BANDS) throw new Error(`DOA stage: StF's lumaram has ${main.u32(LUMA)} bands, not ${STF_BANDS}`);
    const at = LUMA + 4 + STF_BANDS * 128;
    if (!isFree(main, at, BANDS.length * 128)) throw new Error('DOA stage: no room after StF\'s lumaram bands');
    const b = new Uint8Array(BANDS.length * 128);
    BANDS.forEach((band, k) => { for (let i = 0; i < 128; i++) b[k * 128 + i] = (lD[(band * 128 + i) * 2] * 3) >> 2; });
    main.put(at, b, 'DOA lumaram bands');
    main.put(LUMA, u32s([STF_BANDS + BANDS.length]), 'luma ramp count');
    report.push(`lumaram bands ${BANDS.join(', ')} as ${BANDS.map(bandOf).join(', ')}`);
}

/* The eight pages as set DOA_SET, destination list DATA_INDEX. */
function importDoaSet(R, ctx, doa, inRoom, isFree, report) {
    const { pack } = ctx, { main } = R;
    const tdv = new DataView(pack.md.buffer);
    const tableAt = tdv.getUint32(pack.HDR_SETS, true) - MAIN_DATA;
    const dataTable = main.u32(0x300008) - MAIN_DATA;
    if (!isFree(main, tableAt + DOA_SET * 4, 4)) throw new Error('DOA stage: its set table entry is taken');
    if (!isFree(main, dataTable + DATA_INDEX * 4, 4)) throw new Error(`DOA stage: destination list ${DATA_INDEX} is taken`);
    const src = buildTexram(doa.rom, [DOA_STAGE]).sheet0;
    const pages = SLOTS.map((s) => {
        const b = rawPage(doaPageLevels(src, s)), at = inRoom(b.length, `page ${s}`);
        main.put(at, b, `DOA stage page ${s}`);
        return MAIN_DATA + at;
    });
    const put = (b, label) => { const at = inRoom(b.length, label); main.put(at, b, label); return MAIN_DATA + at; };
    const dAt = put(u32s([SLOTS.length, ...SLOTS.map((s) => (s << 1) | 1)]), 'DOA destination list');
    main.put(dataTable + DATA_INDEX * 4, u32s([dAt]), `destination list ${DATA_INDEX}`);
    const pAt = put(u32s([DATA_INDEX, ...pages]), 'DOA page list');
    main.put(tableAt + DOA_SET * 4, u32s([pAt]), `DOA set as ${DOA_SET}`);
    report.push(`set ${DOA_SET}: ${pages.length} raw pages with mips, ${(pages.length * 43664 / 1024).toFixed(0)} KB at ${hex(pages[0])}, destination list ${DATA_INDEX}`);
}

/* StF's ROM set with the board's main_data, textures and polygons */
function boardRom(R, stf) {
    const board = Object.create(stf);
    const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (const [k, v] of Object.entries({ mainData: R.main.out, mainDataView: view(R.main.out), textures: R.textures.out,
        polygons: R.polygons.out, polygonsView: view(R.polygons.out) })) Object.defineProperty(board, k, { value: v });
    return board;
}

const near = (a, b) => Math.abs(a - b) <= 1e-4 * Math.max(1, Math.abs(b));

/* One model: what differs, or null */
function modelDiffers(doa, board, tex, md) {
    const a = decodeModel(doa.rom, md.m, doaPoints(doa.rom, md.uv).words);
    const b = decodeModel(board, md.id);
    if (!a && !b) return null;
    if (!a || !b) return 'decodes in one only';
    if (a.positions.length !== b.positions.length || a.positions.some((v, i) => !near(b.positions[i], v * DOA_SCALE))) return 'points differ';
    if (a.uvs.length !== b.uvs.length || a.uvs.some((v, i) => v !== b.uvs[i])) return 'UVs differ';
    for (let t = 0; t < a.tiles.length; t += 12) {
        const [ox, oy, w, h] = a.tiles.subarray(t, t + 4), [nx, ny, nw, nh] = b.tiles.subarray(t, t + 4);
        if (w !== nw || h !== nh) return 'a tile changed size';
        if (!w || (ox === 0 && oy === 0 && w === 32 && h === 32 && nx === 0 && ny === 0)) continue;
        const bad = tileDiffers(tex.src, tex.dst, tex.levels, ox, oy, nx, ny, w, h);
        if (bad) return bad;
    }
    return null;
}

/* Each model through the board's ROMs against DOA's: points times
 * DOA_SCALE, UVs, tile sizes, level 0's texels against DOA's sheet and
 * levels 1-3 against doaPageLevels'. */
function checkDoaStage(R, games, doa, models) {
    const board = boardRom(R, games.stf.rom);
    const src = buildTexram(doa.rom, [DOA_STAGE]).sheet0;
    const d0 = buildTexram(board, [1, DOA_SET]).sheet0, dst = new Uint8Array(d0.buffer, d0.byteOffset, SHEET_BYTES * 2);
    const tex = { src, dst, levels: new Map(SLOTS.map((s) => [s, doaPageLevels(src, s)])) };
    const problems = [];
    for (const md of models) {
        const bad = modelDiffers(doa, board, tex, md);
        if (bad) problems.push(`model ${md.m}: ${bad}`);
    }
    return problems;
}

function tileDiffers(src, dst, levels, ox, oy, nx, ny, w, h) {
    const sx = ox & 1023, sy = oy & 1023;
    if (nx !== sx || ny !== sy) return `tile ${ox},${oy} moved to ${nx},${ny}`;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (nib(src, ox + i, oy + j) !== nib(dst, nx + i, ny + j)) return `texels differ at ${ox},${oy} level 0`;
    /* a tile can run over a page's edge: each texel from its own page's level */
    const want = (L, x, y) => {
        const lv = levels.get(((x << L) >> 8) * 4 + ((y << L) >> 8));
        return lv && lv[L][(y & ((256 >> L) - 1)) * (256 >> L) + (x & ((256 >> L) - 1))];
    };
    for (let L = 1; L < 4; L++) {
        const no = levelOrigin(nx, ny, L);
        for (let j = 0; j < h >> L; j++) for (let i = 0; i < w >> L; i++) {
            const v = want(L, (sx >> L) + i, (sy >> L) + j);
            if (v === undefined) return `tile ${ox},${oy} reads a page not loaded`;
            if (v !== nib(dst, no.x + i, no.y + j)) return `texels differ at ${ox},${oy} level ${L}`;
        }
    }
    return null;
}
