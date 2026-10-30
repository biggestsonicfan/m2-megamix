/*
 * Fighters Megamix's Hornet as a guest on the Sonic the Fighters board: the
 * car Daytona USA draws (tools/sources/daytona-hornet.mjs, the pieces cut as FM cuts
 * its own) on FM's Hornet's bones, built on what tools/guests/vf2-guest.mjs puts in
 * for Akira, as tools/guests/ryo-guest.mjs builds Ryo and Chai. He plays as StF
 * character 17 (43 his player 2) and runs StF's own fight code. What is his
 * own:
 *   - his parts: Daytona's objects as they are, polygon for polygon, quads
 *     and all (encodeObject), in the slots FM's Hornet moves: the nose on
 *     the chest (1), the cabin and the glass on the pelvis (9), the front
 *     wheels on the hands (5, 8) and the rear on the feet (12, 15). FM's
 *     other slots (16, 24: the broken body; 20, 23, 27, 30: the hand list's
 *     aliases) are FM's own and StF has none;
 *   - his textures: Daytona's tiles (all on its boot bank's sheet), each
 *     with the mip levels Daytona's sheet holds, packed with Akira's
 *     (tools/guests/pack-akira.mjs `extra`);
 *   - his colours: each of Daytona's colorbases with each tile (or none) it
 *     is used with, fitted to StF's ramp rows (below);
 *   - his skeleton and pose bones: FM's Hornet's (fm-saturn.mjs readBones),
 *     at Akira's scale (SCALE);
 *   - his collision balls, Akira's fitted to his parts; his hands are the
 *     front wheels, as FM's hand list has them.
 *
 * Colour. A face's colorbase picks a ramp row per channel and its texel a
 * place along it: lumaram[lumabase + texel * 8] times the face's light / 256
 * (draw_scanline_tex; an untextured face takes its light / 4 alone,
 * draw_scanline_solid), and the rows and lumaram are each game's own.
 * So each colour Daytona shows — a colorbase, a lumabase and the texels of
 * the tile it is used with — is fitted to StF's rows over those texels at
 * three lights (255, 192, 128): the three rows together whose values, as the
 * screen shows them, come nearest Daytona's, with a penalty (HUE) on the
 * channels' differences straying from Daytona's, so a light tint keeps its
 * hue rather than going grey. Daytona's rows are its
 * DELUXE cabinet's (the test menu's first; TWIN, MAME's backup RAM's, lifts
 * every channel by 100 of 255 and turns the car's red pink; FM's own
 * textures for him are a deep red and blue). Daytona's lumabase 1 runs the
 * other way (63 down to 3), and StF's band 0 only up (0 to 42, under the
 * fighters' palette band at 48), so a tile Daytona reads through lumabase 1
 * is packed apart for that use with its texels turned over (15 - n, or
 * 14 - n where 15 is a hole). An untextured face lit past 192 would reach
 * luma 48 and the fighter's palette band, so his are textured, with one tile
 * of texel 15 (luma 42). Faces go through StF's lumabase 0 and are lit as
 * Akira's are (the attribute's lighting bits his commonest). StF's ramps
 * are steeper than Daytona's, so his darkest texels (the tyres' grey) come
 * out a little darker.
 */
import { decodeModel } from '../../vendor/noclip/js/model.js';
import { facePalette } from '../../vendor/noclip/js/romset.js';
import { buildTexram } from '../../vendor/noclip/js/texture.js';
import { SHEET_H, SHEET_BYTES, texelByte, levelOrigin } from '../../vendor/noclip/js/atlas.js';
import { buildColorxlat, buildLumaram } from '../../vendor/noclip/js/colors.js';
import * as FM from '../sources/fm-saturn.mjs';
import { loadDaytona, hornetObjects, encodeObject } from '../sources/daytona-hornet.mjs';
import { SCALE } from './vf2-guest.mjs';
import { pointBox, fitBalls, seatGuest } from './ryo-guest.mjs';
import { importFmMoves } from './fm-moves.mjs';

/* StF's character 17: not one the code checks by number (docs/BOARD.md, The
 * guest: Shenmue's Chai), nor a bit of the opponent mask. */
export const CHR = 17;
/* The slots that get a piece, and the pieces each one takes. */
const SLOTS = [1, 9, 5, 8, 12, 15];
const POLY_RUN_END = 0xec2578 + 0x13da88;
const TEX_RUN_END = 0x78bdb8 + 0x74248;
const LEVELS = 5;
const ROWS = 28;
/* Daytona's DELUXE cabinet (js/games.js DAYTONA_CABINETS) and the lights the
 * colours are fitted at (Colour, above). */
const DELUXE = 0;
const LIGHTS = [255, 192, 128];
/* How much a miss between channels counts beside the misses themselves: a
 * colour StF's rows can't reach keeps its tint rather than going grey. */
const HUE = 2;
/* The attribute's bits above the header offset: Akira's commonest, as Ryo's
 * (lighting material 10, bit 24). Daytona's are its own lighting's. */
const ATTR_LOW = 0x1ffff, ATTR_HI = (10 << 18) | (2 << 23);
const TEXTURED = 0x4000, HOLES = 0x2000;
/* His untextured faces' tile: 32 by 32 of texel 15, StF's luma 42 (Colour,
 * above). */
const FLAT = 'flat', FLAT_TEXEL = 15;
/* th0's bits the board's tile keeps: textured, holes, the wrap and mirror
 * bits and the size; not the microtexture (bits 10-12, Daytona's sheet). */
const TH0_KEEP = 0xc000 | HOLES | 0x3ff;

const hex = (v) => '0x' + v.toString(16).toUpperCase();

/** Daytona's ROM set and FM's Hornet: { rom, game, fighter, objects } (the
 *  pieces in SLOTS, in their slots' frames at VF2's metres). */
export async function loadHornet({ rom: romPath, disc } = {}) {
    const rom = await loadDaytona(romPath);
    const game = FM.readGame(disc ?? FM.DEFAULT_DISC);
    const fighter = game.fighters.find((f) => f.name === 'hornet');
    const all = hornetObjects(rom, FM.readModel(game.archive(130), FM.HORNET_SLOTS), { modelUnits: FM.MODEL_UNITS });
    const objects = SLOTS.map((slot) => {
        const of = all.filter((o) => o.slot === slot);
        return { slot, names: of.map((o) => o.name), models: of.map((o) => o.model), polys: of.flatMap((o) => o.polys) };
    });
    return { rom, game, fighter, objects };
}

const tileKey = (th) => `${32 * (th[2] & 0x3f)},${32 * ((th[2] >> 6) & 0x1f)},${32 << (th[0] & 7)},${32 << ((th[0] >> 3) & 7)}`;
/* A tile as one lumabase reads it: Daytona's lumabase 1 turns it over
 * (Colour, above), so it is packed apart from the same tile read through 0. */
const useKey = (th) => `${tileKey(th)}${(th[1] & 0xff) === 1 ? ':1' : ''}`;
/* One of Daytona's colours: colorbase, lumabase and tile (or none). */
const groupOf = (th) => `${th[3] >> 6},${th[1] & 0xff},${th[0] & TEXTURED ? useKey(th) : '-'}`;
/* Turned over: texel n packed as 15 - n, or 14 - n where 15 is a hole (15
 * stays one). `daytona[m]` is the texel Daytona had where m is packed. */
const turn = (holes) => Array.from({ length: 16 }, (_, n) => (holes ? (n === 15 ? 15 : 14 - n) : 15 - n));

/** His tiles, for pack-akira's `extra`: { tiles, byKey } (useKey), each
 *  tile Daytona's nibbles at levels 0-4, turned over where Daytona reads
 *  it through lumabase 1. Every one is on sheet 1. */
export function hornetTiles(H) {
    const tr = buildTexram(H.rom, []);
    const tex = new Uint8Array(tr.sheet0.buffer, tr.sheet0.byteOffset, SHEET_BYTES * 2);
    const nib = (x, y) => {
        const o = texelByte(x, y) & ~1;
        return ((tex[o] | (tex[o + 1] << 8)) >> (((y & 1) ? 0 : 8) + ((x & 1) ? 0 : 4))) & 0xf;
    };
    const polys = H.objects.flatMap((o) => o.polys).filter((q) => q.th[0] & TEXTURED);
    const tiles = [], byKey = new Map();
    for (const q of polys) {
        if (!((q.th[2] >> 12) & 1)) throw new Error(`Hornet: a tile on sheet 0 (${q.th.map(hex)})`);
        const lb = q.th[1] & 0xff;
        if (lb > 1) throw new Error(`Hornet: lumabase ${lb} (${q.th.map(hex)})`);
        const key = useKey(q.th);
        if (byKey.has(key)) continue;
        const [x, y, w, h] = tileKey(q.th).split(',').map(Number);
        const holes = polys.some((p) => useKey(p.th) === key && (p.th[0] & HOLES));
        const daytona = lb === 1 ? turn(holes) : Array.from({ length: 16 }, (_, n) => n);
        const levels = [];
        for (let L = 0; L < LEVELS; L++) {
            const at = levelOrigin(x, y + SHEET_H, L), lw = w >> L, lh = h >> L, l = new Uint8Array(lw * lh);
            for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) l[j * lw + i] = daytona[nib(at.x + i, at.y + j)];
            levels.push(l);
        }
        const tile = { name: key, x, y, w, h, levels, holes, daytona };
        tiles.push(tile);
        byKey.set(key, tile);
    }
    /* one tile of a single texel for his untextured faces (Colour, above) */
    if (H.objects.some((o) => o.polys.some((q) => !(q.th[0] & TEXTURED)))) {
        const tile = { name: FLAT, x: 0, y: 0, w: 32, h: 32, holes: false, daytona: null, levels: [] };
        for (let L = 0; L < LEVELS; L++) tile.levels.push(new Uint8Array((32 >> L) ** 2).fill(FLAT_TEXEL));
        tiles.push(tile);
        byKey.set(FLAT, tile);
    }
    return { tiles, byKey };
}

/** StF's rows for each of Daytona's colours (Colour, above): [{ g, th, n,
 *  rows, show }] a colour (colorbase, lumabase, tile as useKey or '-'), with
 *  one of its headers, how many faces have it and its rows (r, g, b);
 *  `show(texel as packed, light)` is the pair of colours, Daytona's and the
 *  board's, as the screen shows them. byKey: hornetTiles'. */
export function hornetColours(H, stf, { byKey }) {
    const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
    const scx = view(buildColorxlat(stf)), dcx = view(buildColorxlat(Object.assign(Object.create(H.rom), { cabinet: DELUXE })));
    const sl = buildLumaram(stf), dl = buildLumaram(H.rom);
    const ramp = (cx, ch, row, luma) => Math.min(255, cx.getUint16(ch * 0x4000 + row * 0x200 + luma * 2, true));
    const shown = (x) => Math.max(0, ((x - 64) * 255) / 191);
    const dpal = facePalette(H.rom);
    const lit = (l, p) => Math.min(63, Math.floor((l * p) / 256));
    const groups = new Map();
    for (const o of H.objects) for (const q of o.polys) {
        const g = groupOf(q.th);
        if (!groups.has(g)) groups.set(g, { th: q.th, n: 0 });
        groups.get(g).n++;
    }
    const rowsOf = (th) => {
        const cb = th[3] >> 6, lb = th[1] & 0xff, pal = dpal[cb];
        if (pal < 0) throw new Error(`Hornet: Daytona's colorbase ${cb} has no colour`);
        /* the samples: [Daytona's luma, StF's luma, how many] a texel value
         * (as packed) and light */
        const s = [];
        if (th[0] & TEXTURED) {
            const tile = byKey.get(useKey(th)), count = new Array(16).fill(0);
            for (const n of tile.levels[0]) if (!(tile.holes && n === 15)) count[n]++;
            count.forEach((c, n) => {
                if (!c) return;
                const d = dl[((lb << 7) + tile.daytona[n] * 8) * 2], t = sl[n * 8 * 2];
                for (const p of LIGHTS) s.push([lit(d, p), lit(t, p), c]);
            });
        } else for (const p of LIGHTS) s.push([p >> 2, lit(sl[FLAT_TEXEL * 8 * 2], p), 1]);
        /* each channel's miss for each row and sample; then the three rows
         * together, the misses and their differences (HUE) squared */
        const miss = [0, 1, 2].map((ch) => {
            const c5 = (pal >> (5 * ch)) & 31;
            return Array.from({ length: ROWS }, (_, r) => s.map(([d, t]) => shown(ramp(scx, ch, r, t)) - shown(ramp(dcx, ch, c5, d))));
        });
        let best = null, err = Infinity;
        for (let r = 0; r < ROWS; r++) for (let g = 0; g < ROWS; g++) for (let b = 0; b < ROWS; b++) {
            const R = miss[0][r], G = miss[1][g], B = miss[2][b];
            let e = 0;
            for (let k = 0; k < s.length && e < err; k++) {
                const x = R[k], y = G[k], z = B[k];
                e += s[k][2] * (x * x + y * y + z * z + HUE * ((x - y) ** 2 + (y - z) ** 2 + (z - x) ** 2));
            }
            if (e < err) { err = e; best = [r, g, b]; }
        }
        return best;
    };
    for (const x of groups.values()) x.rows = rowsOf(x.th);
    const show = (x, n, p) => {
        const lb = x.th[1] & 0xff, pal = dpal[x.th[3] >> 6], tile = x.th[0] & TEXTURED ? byKey.get(useKey(x.th)) : null;
        const d = tile ? lit(dl[((lb << 7) + tile.daytona[n] * 8) * 2], p) : p >> 2, t = lit(sl[n * 8 * 2], p);
        return [[0, 1, 2].map((ch) => shown(ramp(dcx, ch, (pal >> (5 * ch)) & 31, d))), [0, 1, 2].map((ch) => shown(ramp(scx, ch, x.rows[ch], t)))];
    };
    return [...groups].map(([g, x]) => ({ g, ...x, show: (n, p) => show(x, n, p) }));
}

/* R: import-assets' regions; ctx: importAkira's (after Ryo's and Chai's);
 * games: tests/node-roms.mjs loadNodeGames(); H: loadHornet(); tiles:
 * hornetTiles(H), after importAkira packed them. */
export function importHornet(R, ctx, games, H, { byKey }, { chr: CHR_ = CHR } = {}) {
    const { main, polygons, textures } = R;
    const vf2 = games.vf2.rom, stf = games.stf.rom;
    const Who = 'Hornet';
    const report = [];
    const alloc = (b, label, align = 4) => ctx.alloc(b, label, align, Who);
    const { u32s, u16s } = ctx;
    const k = SCALE;

    /* ---- colour: StF's rows for each of Daytona's colours ---- */
    const colours = hornetColours(H, stf, { byKey });
    const palSrc = (cb) => main.src[0x100000 + cb * 2] | (main.src[0x100000 + cb * 2 + 1] << 8);
    const existing = new Map();
    for (let cb = 1; cb < 0x400; cb++) if (!existing.has(palSrc(cb) & 0x7fff)) existing.set(palSrc(cb) & 0x7fff, cb);
    const free = [];
    for (let n = 0x3ff; n >= 32; n--) if (!R.colorbases.has(n) && !ctx.freeTaken.has(n)) free.push(n);
    const word = (r) => r[0] | (r[1] << 5) | (r[2] << 10);
    const cbOfWord = new Map(), cbOf = new Map();
    let fresh = 0;
    for (const { g, rows } of colours) {
        const w = word(rows);
        if (!cbOfWord.has(w)) {
            if (existing.has(w)) cbOfWord.set(w, existing.get(w));
            else {
                const n = free.shift();
                if (n === undefined) throw new Error('Hornet: no free colorbases');
                ctx.freeTaken.add(n);
                main.put(0x100000 + n * 2, Uint8Array.of(w & 0xff, (w >> 8) | 0x80), `${Who} colorbase ${n}`);
                cbOfWord.set(w, n);
                fresh++;
            }
        }
        cbOf.set(g, cbOfWord.get(w));
    }
    const onPages = new Map();
    for (const t of byKey.values()) onPages.set(t.at.page, (onPages.get(t.at.page) ?? 0) + 1);
    report.push(`${byKey.size} tiles on set 1 pages ${[...onPages].sort((a, b) => a[0] - b[0]).map(([p, n]) => `${p} (${n})`).join(', ')}`);
    report.push(`${colours.length} of Daytona's colours as ${cbOfWord.size} of StF's (${fresh} new colorbases)`);

    /* ---- his pieces: Daytona's polygons, at his size, on the board's tiles ---- */
    const thOf = (th) => {
        const cb = cbOf.get(groupOf(th));
        const tile = byKey.get(th[0] & TEXTURED ? useKey(th) : FLAT);
        const th0 = th[0] & TEXTURED ? th[0] & TH0_KEEP : (th[0] & TH0_KEEP & ~(HOLES | 0x3f)) | TEXTURED;
        return [th0, 0, (tile.at.x / 32) | ((tile.at.y / 32) << 6) | 0x1000, cb << 6];
    };
    const pieces = H.objects.map((o) => {
        const polys = o.polys.map((q) => ({ ...q, attr: ((q.attr & ATTR_LOW) | ATTR_HI) >>> 0, p: q.p.map((v) => v.map((x) => x * k)), th: thOf(q.th) }));
        return { slot: o.slot, what: o.names.join('+'), polys, ...encodeObject(polys) };
    });
    report.push(`${pieces.length} parts, ${pieces.reduce((n, q) => n + q.polys.length, 0)} polygons (${pieces.reduce((n, q) => n + q.polys.filter((p) => p.quad).length, 0)} quads) in ${pieces.reduce((n, q) => n + q.count, 0)} records`);

    /* ---- meshes, headers and texture points; the model table ---- */
    const poly0 = ctx.polyEnd, tex0 = ctx.texEnd ?? ((ctx.pack.at + 15) & ~15);
    let poly = poly0, tex = tex0;
    const ids = [];
    for (let id = R.modelCount - 1; ids.length < pieces.length; id--) {
        if (id <= 0) throw new Error(`${Who}: no free model ids`);
        if (!R.models.has(id) && !ctx.modelIds.has(id)) ids.push(id);
    }
    for (const id of ids) ctx.modelIds.add(id);
    const parts = new Array(16).fill(0);
    pieces.forEach((q, i) => {
        poly = (poly + 3) & ~3;
        if (poly + q.mesh.length > POLY_RUN_END) throw new Error(`${Who}: polygon run too small`);
        polygons.put(poly, q.mesh, `${Who} part ${q.slot} (${q.what}) mesh`);
        const mat = u16s([...q.th]), uv = u16s([...q.uv]);
        const matAt = tex, uvAt = (matAt + mat.length + 15) & ~15;
        tex = (uvAt + uv.length + 15) & ~15;
        if (tex > TEX_RUN_END) throw new Error(`${Who}: textures run too small`);
        textures.put(matAt, mat, `${Who} part ${q.slot} headers`);
        textures.put(uvAt, uv, `${Who} part ${q.slot} texture points`);
        main.put(R.modelTable + ids[i] * 16, u32s([uvAt / 2, matAt / 2, 0x800000 | (poly >> 2), (q.polys.length << 16) | (q.count + 1)]), `${Who} part ${q.slot} as model ${ids[i]}`);
        Object.assign(q, { id: ids[i], matAt, uvAt });
        parts[q.slot] = ids[i];
        poly += q.mesh.length;
    });
    report.push(`models ${ids[ids.length - 1]}..${ids[0]}; meshes ${hex(poly0)}..${hex(poly)}; headers and texture points ${hex(tex0)}..${hex(tex)}`);
    ctx.polyEnd = poly; ctx.texEnd = tex;

    /* Each mesh read back as the board's geometrizer walks it (noclip
     * decodeModel over the textures region as the board has it): his
     * polygons, as many textured, each tile where it was packed. */
    {
        const rom = Object.create(stf);
        Object.defineProperty(rom, 'textures', { value: textures.out });
        for (const q of pieces) {
            const d = decodeModel(rom, -1, null, { bytes: q.mesh, uvPtr: q.uvAt / 2, matPtr: q.matAt / 2 });
            const textured = q.polys.filter((p) => p.th[0] & TEXTURED).length;
            if (!d || d.faceCount !== q.polys.length || d.texturedFaces !== textured)
                throw new Error(`${Who} part ${q.slot}: decoded ${d?.faceCount} faces (${d?.texturedFaces} textured) of ${q.polys.length} (${textured})`);
            const want = new Set(q.polys.filter((p) => p.th[0] & TEXTURED).map((p) => `${32 * (p.th[2] & 0x3f)},${32 * ((p.th[2] >> 6) & 0x1f) + 1024}`));
            for (let i = 0; i < d.tiles.length; i += 4) if (d.tiles[i + 2] && !want.has(`${d.tiles[i]},${d.tiles[i + 1]}`))
                throw new Error(`${Who} part ${q.slot}: a face on tile ${d.tiles[i]},${d.tiles[i + 1]}`);
        }
        report.push(`${pieces.length} meshes decode as made`);
    }

    /* ---- skeleton and pose bones: FM's Hornet's ---- */
    /* readBones: joints 1..15, the skeleton's 15 entries; the pose bones'
     * (vf2-guest.mjs) are the head (entry 1) and each limb's pivot and its
     * two lengths, as ryo-guest's withRig. */
    const bones = FM.readBones(H.game, H.fighter);
    const skelBytes = Uint8Array.from(ctx.bones), sv = new DataView(skelBytes.buffer);
    bones.forEach((p, e) => p.forEach((x, a) => sv.setFloat32(e * 12 + a * 4, x * k, true)));
    const rigBytes = Uint8Array.from(ctx.rigBytes), rv = new DataView(rigBytes.buffer);
    const put = (e, p) => p.forEach((x, a) => rv.setFloat32(e * 12 + a * 4, x * k, true));
    put(1, bones[1]);
    [2, 5, 9, 12].forEach((e) => { put(e, bones[e]); put(e + 1, [bones[e + 1][0], 0, 0]); put(e + 2, [bones[e + 2][0], 0, 0]); });
    const skel = alloc(skelBytes, 'skeleton');
    const rigAt = alloc(rigBytes, 'bones');

    /* ---- collision balls, records and the guest tables ---- */
    const partBox = (s) => {
        const q = pieces.find((x) => x.slot === s);
        return q ? pointBox(q.polys.flatMap((p) => (p.quad ? p.p : p.p.slice(0, 3)))) : null;
    };
    const { ballRec, moved } = fitBalls(ctx, vf2, partBox, k, alloc);
    report.push(`${moved} collision balls fitted to his parts`);
    const seamList = alloc(u32s([0]), 'seams');
    /* ---- his moves: FM's own (fm-moves.mjs) ---- */
    const mv = importFmMoves(R, ctx, H.game, H.fighter, { who: Who });
    report.push(...mv.report);
    const chars = seatGuest(R, ctx, { chr: CHR_, parts, skel, rigAt, ballRec, seamList, game: R.guest.games.VF2,
        moves: mv.moves, kinds: mv.kindsAt, remap: mv.remapAt, actions: mv.actionsAt, edge: 0 }, alloc);
    report.push(`heap to ${hex(ctx.heapEnd())}`);

    const coverage = {
        chars, game: 'Fighters Megamix (Daytona USA\'s car)', name: Who, parts: pieces.length,
        polygons: pieces.reduce((n, q) => n + q.polys.length, 0), colours: cbOfWord.size, balls: moved,
        moves: mv.coverage,
    };
    return { report, coverage, pieces, parts };
}
