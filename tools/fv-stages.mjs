/*
 * Fighting Vipers' stages, made ready for the board (docs/FV-STAGES.md).
 *
 * `fvStagePlan` is what an import of FV's stages works from, in the shape
 * tools/vf2-stages.mjs gives VF2's: each arena with its draws (noclip
 * display.js buildFlatDisplayList, the lists as FV's change_scene and
 * object_control draw them), every FV model they can draw (the stage lists,
 * the object routines' models and flipbooks, all three of the cage's damage
 * groups and the cage break's pieces), and per model what the import has to
 * carry over: its mesh in the polygon ROM, its faces, its colour bases and the
 * texture tiles it reads.
 * Beside them, what a stage does that StF's stage code has no field for
 * (js/fvstages.js fvStageHooks: the turning towns, the moving light, the
 * Observation Deck's corners, the elevator ride), and the cage break's tables
 * (docs/FV-STAGES.md, "Cage break").
 *
 * Size: FV draws its world at about half StF's. FV's own Sonic stands 1.309
 * (FV) and StF's 2.676 (StF) at the top of their stances (js/fighters.js
 * poses, frame 1), so FV_SCALE is 2.676 / 1.309 = 2.04, within 1% of
 * vf2-guest.mjs SCALE (Akira, sized against FV's Bahn and Sonic). An FV stage
 * scaled by it puts StF's fighters in it at FV's fighters' size; FV's ring
 * (half 5.0, 0x50A00C) becomes 10.2 in StF's units, so the board's stage_x
 * for an FV stage is 10.2, not StF's 8.0.
 *
 *   node tools/fv-stages.mjs [--json out.json]   (reads $ROMS_DIR's zips)
 */
import { writeFileSync } from 'node:fs';
import { buildFlatDisplayList } from '../vendor/noclip/js/display.js';
import { fvStageHooks } from '../vendor/noclip/js/fvstages.js';
import { readModelEntry, meshOffsetOf, xtraResolve } from '../vendor/noclip/js/romset.js';
import { decodeModel } from '../vendor/noclip/js/model.js';
import { buildTexram } from '../vendor/noclip/js/texture.js';
import { levelOrigin, texelByte, SHEET_BYTES } from '../vendor/noclip/js/atlas.js';
import { loadScrollCG, scrollAt } from '../vendor/noclip/js/scroll.js';
import { buildColorxlat } from '../vendor/noclip/js/colors.js';
import { packSky } from './vf2-stages.mjs';

/* The arenas, by slot (js/games.js STAGE_SLOTS.fv): 4 is a copy, 9.. are
 * Western 2, name entry and unnamed records. */
export const FV_STAGE_SLOTS = [0, 1, 2, 3, 5, 6, 7, 8];
/* FV's Sonic onto StF's Sonic (above). */
export const FV_SCALE = 2.676 / 1.309;
/* FV's ring (0x50A00C), in its own units: 5.0 from boot on (MAME). The cage,
 * the poles and the rail are modelled at 6.0, and cage_display (0x221E4),
 * pole_disp (0x22ED8) and sub_24294 scale them by stage_x / 6 across. */
export const FV_RING = 5.0;
const RING_K = FV_RING / 6.0;

/* The record's cage list: 24 models from +0x84, three groups of eight. The
 * group is the wall's damage state (cage_clip_m indexes it by the wall's hit
 * timer); js/stages.js keeps only the first. */
const CAGE_AT = 0x84, CAGE_GROUPS = 3, CAGE_PANELS = 8;
/* The cage break's pieces by slot (docs/FV-STAGES.md, Cage break: the
 * set-ups through 0x798A8, the rope fence's 0x797D8/0x79718). They are not in
 * the stage lists, so the import adds them. */
export const CAGE_PIECES = { 0: [0xa90], 1: [0xa85, 0x14f4, 0x1523], 2: [0xaaa, 0x14f6], 3: [0x14f5], 5: [0xa96, 0xa95], 6: [0xa97], 7: [0xa92, 0xa93], 8: [0xa92, 0xa93] };

/* Flag bits cage_clip_m and pole_disp test (display.js buildFlatDisplayList). */
const FLAG = { noUpper: 0xb, noGround: 0xd, extra: 0xe, turning: 0x10, rail: 0x11, poles: 0x12, cage4: 0x13, cageTop: 0x14, cage2: 0x15, cage1: 0x16, wallShadows: 0x1f };

/* A mesh's extent: the geometrizer's walk (vf2-guest.mjs meshLength). */
function meshLength(d, base) {
    let p = base + 24;
    for (;;) {
        const attr = d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24);
        p += 16;
        if ((attr & 3) === 0) return p - base;
        p += 24;
    }
}

/*
 * What a model brings: its mesh (bytes in the polygon ROM), its faces, and from
 * its texture headers (model.js's walk: one 8-byte record, moved on by the
 * attribute's bits 12-16) the colour bases (th3 >> 6) and the 32-texel tiles
 * it reads, as sheet:x:y of the tile's top left at full size.
 */
function modelNeeds(rom, m) {
    const e = readModelEntry(rom, m);
    if (!e.meshPtr) return null;
    const off = meshOffsetOf(rom, e);
    const poly = rom.polygons;
    const bytes = meshLength(poly, off);
    const tex = rom.textures, tv = rom.texturesView;
    /* A header pointer with bit 23 is texture RAM, which FV's boot fills
     * (model.js textureAt): the import keeps such a model's word as it is. */
    const ramMat = (e.matPtr & 0x800000) !== 0;
    let hdr = e.matPtr && !ramMat ? e.matPtr * 2 : -1;
    const bases = new Set(), tiles = new Set();
    let faces = 0, textured = 0;
    for (let p = off + 24; ; p += 40) {
        const attr = poly[p] | (poly[p + 1] << 8) | (poly[p + 2] << 16) | (poly[p + 3] << 24);
        /* the record with no face ends the mesh: no header of its own */
        if ((attr & 3) === 0) break;
        if (hdr >= 0 && hdr + 8 <= tex.length) {
            const th0 = tv.getUint16(hdr, true), th2 = tv.getUint16(hdr + 4, true), th3 = tv.getUint16(hdr + 6, true);
            bases.add((th3 >> 6) & 0x3ff);
            if (th0 & 0x4000) {
                textured++;
                const w = 32 << (th0 & 7), h = 32 << ((th0 >> 3) & 7);
                const x0 = 32 * (th2 & 0x3f), y0 = 32 * ((th2 >> 6) & 0x1f), sheet = (th2 >> 12) & 1;
                for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) tiles.add(`${sheet}:${(x0 + x) & 2047}:${(y0 + y) & 1023}`);
            }
            let step = (attr >>> 12) & 0x1f;
            if (step & 0x10) step -= 0x20;
            hdr += step * 8;
        }
        faces++;
    }
    return { bytes, faces, textured, ramMat, bases: [...bases].sort((a, b) => a - b), tiles };
}

/* The record's 24 cage words, wherever FV keeps the record (the XTRA window). */
function cageGroups(rom, slot) {
    const T = rom.game.stageTable;
    const r = xtraResolve(rom, T.at + slot * T.stride);
    return Array.from({ length: CAGE_GROUPS }, (_, g) =>
        Array.from({ length: CAGE_PANELS }, (_, i) => r.view.getUint16(r.off + CAGE_AT + (g * CAGE_PANELS + i) * 2, true)));
}

/* A 256-texel page's slot on its sheet (m2_tex_codec.h g_tex_lutx/luty, as
 * tools/vf2-stages.mjs slotOf): 0-15 the left half, 16-23 x 1024+, y < 512. */
const slotOf = (x, y) => (x < 1024 ? (x >> 8) * 4 + (y >> 8) : y < 512 ? 16 + ((x - 1024) >> 8) * 2 + (y >> 8) : -1);

/* The pages a list of models reads, as 'sheet/slot' -> tiles used (of 64). */
export function pagesOf(plan, models) {
    const tiles = new Set(models.flatMap((m) => [...plan.needs.get(m).tiles]));
    const pages = {};
    for (const t of tiles) {
        const [sheet, x, y] = t.split(':').map(Number), k = `${sheet}/${slotOf(x, y)}`;
        pages[k] = (pages[k] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(pages).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
}

/* Every model a draw can show: its own, a flipbook's frames. */
const drawModels = (d) => [d.model, ...(d.anim?.frames ?? [])].filter((m) => m > 0);

/*
 * The plan. `games` is js/games.js loadGames' (FV's and StF's sets).
 *   stages: { slot, name, st, draws, models, cage, hooks, flags, texSet, ... }
 *   models: every FV model the arenas draw, sorted, with what each needs.
 */
export function fvStagePlan(games) {
    const fv = games.fv, rom = fv.rom;
    const needs = new Map();
    const need = (m) => {
        if (!needs.has(m)) needs.set(m, modelNeeds(rom, m));
        return needs.get(m);
    };
    const stages = FV_STAGE_SLOTS.map((slot) => {
        const st = fv.stages.find((s) => s.slot === slot);
        const draws = buildFlatDisplayList(st);
        const groups = cageGroups(rom, slot);
        const set = new Set(draws.flatMap(drawModels));
        for (const m of [...groups.flat(), ...(CAGE_PIECES[slot] ?? [])]) if (m) set.add(m);
        if (st.hall) for (const m of [...st.hall.platform, ...st.hall.poles, ...st.hall.cage.flat(), ...st.hall.cageDark]) if (m) set.add(m);
        const models = [...set].sort((a, b) => a - b).filter((m) => need(m));
        const flags = Object.entries(FLAG).filter(([, b]) => st.flags & (1 << b)).map(([k]) => k);
        const byLayer = {};
        for (const d of draws) byLayer[d.layer] = (byLayer[d.layer] ?? 0) + 1;
        return {
            slot, name: st.name, st, draws, models, flags, byLayer,
            animated: draws.filter((d) => typeof d.ops === 'function' || d.live || d.anim).length,
            cage: { groups, pieces: CAGE_PIECES[slot] ?? [], top: st.flags & (1 << FLAG.cageTop) ? st.cageTop : 0, pole: st.flags & (1 << FLAG.poles) ? st.cagePole : 0 },
            hooks: Object.keys(fvStageHooks(rom, st)),
            objects: st.objects.map((o) => `0x${o.routine.toString(16)}`),
            texSet: st.texSets.at(-1), colorSet: st.texSet[1], tint: st.tint, bg: st.bgColor555,
            bright: st.bright, vecter: st.vecter, cycles: st.colorCycles,
        };
    });
    const models = [...new Set(stages.flatMap((s) => s.models))].sort((a, b) => a - b);
    return { stages, models, needs };
}

/* The totals for a list of models: mesh bytes, faces, colour bases, tiles. */
export function totals(plan, models) {
    let bytes = 0, faces = 0;
    const bases = new Set(), tiles = new Set();
    for (const m of models) {
        const n = plan.needs.get(m);
        bytes += n.bytes; faces += n.faces;
        n.bases.forEach((b) => bases.add(b));
        n.tiles.forEach((t) => tiles.add(t));
    }
    return { models: models.length, bytes, faces, bases: bases.size, tiles: tiles.size };
}

/* ---- on the board (docs/FV-STAGES.md, "On the board") ---- */

/* The arenas the board has: Western. */
export const FV_BOARD_SLOTS = [0];
/* The board's model ids for them, from here down, below VF2's stages
 * (vf2-stages.mjs VF2_STAGE_TOP, 4899 down). */
export const FV_STAGE_TOP = 4493;
/* The board's texture set for them, after VF2's 18 and 19 in pack-akira's
 * set table copy, and the destination list it uses (VF2's is 9). */
export const FV_SET0 = 20;
const FV_DATA_INDEX = 10;
/* where its pages go in main_data (importFvStages), and its skies after them
 * (up to Hornet's moves, fm-moves.mjs FM_MOTIONS_AT) */
const FV_PAGES_AT = 0x600000, FV_PAGES_END = 0x700000;
export const FV_SKY_AT = 0x02700000;
const FV_SKY_END = 0x02780000;
/* The town's turn (fvstages.js, 0x1EF94): 10 a frame on the turning flag. */
export const FV_TURN = 10;
/* The Western bear (fvobjects.js kuma_dsp): it swings about x on its stand. */
const KUMA = 0x407;

/*
 * The board's plan: each arena's draws in the order FV's display list has
 * them (the floor, then the town above it and the objects, the platform,
 * each side's cage panels and top, the poles, each side's rail), every op at
 * frame 0 with no turn, and for each draw what the board does with it each
 * frame:
 *   turn   it turns with the town (FV_TURN a frame about y, before its ops)
 *   side   cage side 1-4: drawn only while the camera is inside that side's
 *          plane, as cage_display does (byte_500288); the top goes with its
 *          side; the poles and the rail (sub_24224) are always drawn
 *   swing  the bear: kuma_int's pendulum about x, after its ops
 *   win    a new geometrizer window opens before it. FV draws in windows
 *          (GEO command 3, all full screen): the floor; the town and the
 *          objects; the platform; the cage, poles and rail; the fighters.
 *          The renderer draws the last window first and never draws over a
 *          pixel, so each window covers the ones before it whatever their
 *          depth. That is what keeps the bear stand's shadow (599's faces
 *          20..27, flat on the ground and reaching in to the ring's middle)
 *          under the platform, and the dirt under it too.
 * The cage break's pieces are not drawn (no break on the board yet).
 */
export function fvBoardPlan(games) {
    const fv = games.fv;
    const stages = FV_BOARD_SLOTS.map((slot) => {
        const st = fv.stages.find((s) => s.slot === slot);
        const list = buildFlatDisplayList(st);
        const order = ['floor', 'upper', 'objects', 'platform', 'cage', 'poles'];
        /* the rail (sub_24224) comes after the poles in the 'cage' layer */
        const poles = list.findIndex((d) => d.layer === 'poles');
        const isRail = (d) => d.layer === 'cage' && poles >= 0 && list.indexOf(d) > poles;
        const rank = (d) => (isRail(d) ? 5.5 : order.indexOf(d.layer));
        /* FV's windows: the floor | the town and objects | the platform | the cage */
        const winOf = (d) => [0, 1, 1, 2, 3, 3][order.indexOf(d.layer)];
        if (list.some((d) => rank(d) < 0 || d.anim)) throw new Error(`FV ${st.name}: a draw the board has no place for`);
        const draws = list.map((d, i) => ({ d, i })).sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i).map(({ d }) => {
            let ops = typeof d.ops === 'function' ? d.ops(0) : d.ops;
            const turn = typeof d.ops === 'function' || d.layer === 'objects';
            const r = ops.find(([k]) => k === 'r');
            const side = d.layer === 'cage' && !isRail(d) ? Math.round((r ? r[1] : 0) / 90) + 1 : 0;
            /* the ring at FV_RING: the panels, the top and the poles under
             * scale (k, 1, k); the rail pushed out stage_x, then scale (k, 1, 1)
             * (its y is cage_height / 3.1, 1 at FV's 3.1) */
            if (isRail(d)) ops = [...ops.filter(([o]) => o !== 't'), ['t', [0, 0, FV_RING]], ['s', [RING_K, 1, 1]]];
            else if (d.layer === 'cage' || d.layer === 'poles') ops = [['s', [RING_K, 1, RING_K]], ...ops];
            return { model: d.model, ops, layer: isRail(d) ? 'rail' : d.layer, turn, side, swing: d.model === KUMA, w: winOf(d) };
        });
        draws.forEach((d, i) => { d.win = i > 0 && d.w !== draws[i - 1].w; });
        return { st, draws };
    });
    const models = [...new Set(stages.flatMap(({ draws }) => draws.map((d) => d.model)))].sort((a, b) => a - b);
    const idOf = new Map(models.map((m, i) => [m, FV_STAGE_TOP - i]));
    return { stages, models, idOf };
}

/*
 * The skies (noclip scroll.js buildSkyPanorama): what sub_29728 loads at
 * stage start from the record at 0x06CE3600 + slot * 32, in the shape
 * vf2SkyPlan gives VF2's, which the board draws with the same code.
 *
 * sub_29728 hands the record's +0x0C to _Scroll_Initialize (the CG list and
 * the palette list, entries n and n + 1 of 0x06450000) and lays the
 * patterns its +0x14 list names (through 0x06450300; each a header whose
 * +0x04 is the row count, then rows of 32 tiles at 64 bytes) side by side at
 * 0x579000; the board's panorama is the 16 a turn shows. Then, as VF2's
 * 0x24314: map 2 below the strip is the last row's first eight tiles, map 3
 * the top row's (0x297EC..0x298A8).
 *
 * Every frame 0x29A40, as VF2's 0x24534 but for two things: the heading it
 * streams and scrolls by is the camera's plus 16 * list[0] (0x503040, the
 * sky's turn against the arena: `head`) plus 0x50A022 (the arena's turn),
 * and the vertical scroll is list[2] - 480 tan(pitch) (0x501084, the fight's
 * focal), which puts row 192 + list[2] (`eye`) on the eye line, screen row
 * 192. The pitch is clamped to list+0x4C and +0x4E (45 degrees), which the
 * fight's camera never reaches; the board does not clamp. Western's own
 * routines (+0x04, +0x08) are a bare return and the plain horizontal scroll.
 */
export function fvSkyPlan(games) {
    const fv = games.fv.rom, stf = games.stf.rom, S = fv.game.stageTable.scroll;
    const stfCx = buildColorxlat(stf, { colorSet: games.stf.stages[0].texSet[1], tint: games.stf.stages[0].tint, fighters: [] });
    const word = (a) => { const t = scrollAt(fv, a); return t.view.getUint32(t.off, true); };
    const parts = [];
    let at = FV_SKY_AT;
    const place = (bytes) => { const a = at; parts.push(bytes); at += (bytes.length + 15) & ~15; if (bytes.length & 15) parts.push(new Uint8Array(16 - (bytes.length & 15))); return a; };
    const skies = FV_BOARD_SLOTS.map((slot) => {
        const st = games.fv.stages.find((s) => s.slot === slot);
        const rec = S.records + slot * S.stride;
        const cg = word(rec + S.fields.cg), list = word(rec + S.fields.patterns);
        const L = scrollAt(fv, list);
        const head = L.view.getInt16(L.off, true) * 16, eye = 192 + L.view.getInt16(L.off + 2, true);
        const pats = Array.from({ length: 16 }, (_, i) => scrollAt(fv, word(S.patternTable + word(list + 4 + i * 4) * 4)));
        const rows = pats[0].view.getUint32(pats[0].off + 4, true);
        if (pats.some((P) => P.view.getUint32(P.off + 4, true) !== rows)) throw new Error(`FV sky ${st.name}: patterns of different heights`);
        const cells = new Uint16Array(rows * 512);
        pats.forEach((P, i) => {
            for (let r = 0; r < rows; r++) for (let x = 0; x < 32; x++) cells[r * 512 + i * 32 + x] = P.view.getUint16(P.off + 12 + r * 64 + x * 2, true);
        });
        const { chars, pal } = loadScrollCG(fv, word(S.cgTable + cg * 4), word(S.cgTable + (cg + 1) * 4), S.charBytes);
        const fCx = buildColorxlat(fv, { colorSet: st.texSet[1], tint: st.tint, fighters: [] });
        const { dest, cb, pb } = packSky(`FV sky ${st.name}`, cells, [], chars, pal, fCx, stfCx);
        return { name: st.name, rows, eye, head, dest, chars: place(cb), pal: place(pb), pano: place(new Uint8Array(cells.buffer)) };
    });
    if (at > FV_SKY_END) throw new Error(`FV skies: 0x${(at - FV_SKY_AT).toString(16)} bytes, past their room`);
    const blob = new Uint8Array(at - FV_SKY_AT);
    let o = 0;
    for (const b of parts) { blob.set(b, o); o += b.length; }
    return { skies, blob };
}

/* A slot on a sheet and an even page's new slot on the stages' sheet, as in
 * tools/vf2-stages.mjs: the fighters' sheet's 16-23 go to the stages' sheet
 * at x - 1024 (slots 0, 1, 4, 5, 8, 9, 12, 13). */
const evenTo = (s) => ((s - 16) >> 1) * 4 + ((s - 16) & 1);
const hex = (v) => '0x' + v.toString(16).toUpperCase();

/*
 * Western's models, pages and colours into the data ROMs, as
 * tools/vf2-stages.mjs does VF2's stages (R, ctx: import-assets' regions and
 * what importAkira built).
 *
 * Textures: Western uploads sets 36 and 20; its models read only set 20's,
 * pages 16-22 on the stages' sheet and 16-23 on the fighters'. The board
 * keeps the stages' sheet's 16-23 where they are, moves the fighters' sheet's
 * eight to the stages' sheet's 0, 1, 4, 5, 8, 9, 12, 13 (each face's th2 with
 * them) and leaves out set 20's 12-15 and set 36: sixteen pages, which leave
 * the fighters' sheet to StF's fighters and the guests.
 */
export function importFvStages(R, games, ctx) {
    const { pack, freeTaken } = ctx;
    const { main, polygons, textures } = R;
    const fv = games.fv.rom, stf = games.stf.rom;
    const plan = fvBoardPlan(games);
    const report = [];
    const MAIN_DATA = 0x02000000;

    /* the guest tables go in after every import, at their fixed places */
    const later = Object.values(R.guest.tables).map((t) => [t.at - MAIN_DATA, t.at - MAIN_DATA + t.bytes.length]);
    const free = (r, len, align = 16, from = 0x100) => {
        const iv = [...r.kept.map(([a, b]) => [a, b]), ...(r === main ? later : [])].sort((a, b) => a[0] - b[0]);
        let at = (from + align - 1) & ~(align - 1);
        for (const [a, b] of iv) {
            if (b <= at) continue;
            if (a >= at + len) break;
            at = (b + align - 1) & ~(align - 1);
        }
        if (at + len > r.out.length) throw new Error(`FV stages: no room for ${len} bytes in ${r.name}`);
        return at;
    };
    const isFree = (r, a, len) => !r.kept.some(([x, y]) => x < a + len && a < y);
    const u32s = (list) => { const b = new Uint8Array(list.length * 4); const v = new DataView(b.buffer); list.forEach((x, i) => v.setUint32(i * 4, x >>> 0, true)); return b; };

    for (const m of plan.models) {
        const id = plan.idOf.get(m);
        if (id <= 0 || !isFree(main, R.modelTable + id * 16, 16)) throw new Error(`FV stages: model id ${id} is taken (lower FV_STAGE_TOP)`);
    }

    /* ---- colours: as VF2's stages' ---- */
    const pal = (rom, cb) => rom.mainDataView.getUint16(0x100000 + cb * 2, true);
    const cbMap = new Map();
    let fresh = 0;
    const mapCb = (cb) => {
        if (!cb || pal(fv, cb) === pal(stf, cb)) return cb;
        if (cbMap.has(cb)) return cbMap.get(cb);
        let n = 1;
        while (n < 0x400 && pal(stf, n) !== pal(fv, cb)) n++;
        if (n === 0x400) {
            for (n = 0x3ff; n >= 32 && (R.colorbases.has(n) || freeTaken.has(n)); n--);
            if (n < 32) throw new Error('FV stages: no free colorbase');
            freeTaken.add(n); fresh++;
            main.put(0x100000 + n * 2, Uint8Array.of(pal(fv, cb) & 0xff, pal(fv, cb) >> 8), `FV stage colorbase ${cb}`);
        }
        cbMap.set(cb, n);
        return n;
    };
    let moved = 0;
    const mapTh2 = (th0, th2) => {
        if (!(th0 & 0x4000)) return th2;
        const x = 32 * (th2 & 0x3f), y = 32 * ((th2 >> 6) & 0x1f), s = slotOf(x, y);
        if (s < 16) throw new Error(`FV stages: a tile on sheet ${(th2 >> 12) & 1}, slot ${s}`);
        if (!((th2 >> 12) & 1)) return th2;
        moved++;
        return (th2 & ~0x103f) | ((x - 1024) / 32);
    };

    /* ---- models: the mesh (points scaled), its headers and points ---- */
    const raw = (m, o) => fv.mainDataView.getUint32(fv.game.modelTable.offset + m * 16 + o, true);
    const vp = new DataView(fv.polygons.buffer, fv.polygons.byteOffset, fv.polygons.byteLength);
    let polyBytes = 0, texBytes = 0;
    const copied = new Map();
    const copyTex = (from, to, fix) => {
        const k = `${from},${to}`;
        if (copied.has(k)) return copied.get(k);
        const b = fv.textures.slice(from, to);
        if (fix) fix(b);
        const at = free(textures, b.length, 16);
        textures.put(at, b, `FV stage textures ${hex(from)}`);
        texBytes += b.length;
        copied.set(k, at);
        return at;
    };
    for (const m of plan.models) {
        const tpa = raw(m, 0), tha = raw(m, 4), oba = raw(m, 8);
        let obc = raw(m, 12);
        if (!(oba & 0x800000) || (oba & 0x1000000) || (tpa & 0x800000) || (tha & 0x800000)) throw new Error(`FV model ${m}: not all in ROM`);
        if (obc === 0) obc = 0xfffff;
        const base = meshOffsetOf(fv, readModelEntry(fv, m));
        let p = base + 24;
        const polys = [];
        for (let i = 0; i < obc; i++) {
            const attr = vp.getUint32(p, true);
            p += 16;
            if ((attr & 3) === 0) break;
            polys.push(attr);
            p += 24;
        }
        const mesh = fv.polygons.slice(base, p);
        const mv = new DataView(mesh.buffer);
        for (let q = 0; q + 24 <= mesh.length; q += 40) for (let k = 0; k < 6; k++) mv.setFloat32(q + k * 4, mv.getFloat32(q + k * 4, true) * FV_SCALE, true);
        const polyAt = free(polygons, mesh.length, 4);
        polygons.put(polyAt, mesh, `FV stage model ${m} mesh`);
        polyBytes += mesh.length;
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
            uv = copyTex(tpa * 2, tp * 2) / 2;
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
        main.put(R.modelTable + plan.idOf.get(m) * 16, u32s([uv, mat, (oba & ~0x7fffff) | 0x800000 | (polyAt >> 2), raw(m, 12)]), `FV stage model ${m} as ${plan.idOf.get(m)}`);
    }
    report.push(`${plan.models.length} models as ${FV_STAGE_TOP - plan.models.length + 1}..${FV_STAGE_TOP}; meshes ${(polyBytes / 1024).toFixed(0)} KB, headers and points ${(texBytes / 1024).toFixed(0)} KB`);
    report.push(`${cbMap.size} colorbases moved (${fresh} new); ${moved} faces' tiles from the fighters' sheet to the stages'`);

    /* ---- the texture set: its pages from FV's main_data ---- */
    const md = fv.mainDataView, off = (a) => a - MAIN_DATA;
    const TH = fv.game.texture.header;
    const FD = md.getUint32(TH + 0x08, true), FP = md.getUint32(TH + 0x0c, true);
    const blocks = new Set();
    for (let s = 0; s < fv.game.texture.sets; s++) {
        const P = md.getUint32(off(FP) + s * 4, true);
        if (P < MAIN_DATA || off(P) >= fv.mainData.length) continue;
        const D = md.getUint32(off(FD) + md.getUint32(off(P), true) * 4, true);
        const n = Math.min(md.getUint32(off(D), true), 24);
        for (let i = 0; i < n; i++) { const b = md.getUint32(off(P) + 4 + i * 4, true); if (b) blocks.add(b); }
    }
    const sorted = [...blocks].sort((a, b) => a - b);
    const blockBytes = (b) => {
        const next = sorted.find((x) => x > b);
        const o = off(b);
        const end = next !== undefined && next - b < 0x100000 ? next - b : (() => {
            for (let q = o; q < fv.mainData.length; q += 4) if (fv.mainData.subarray(q, q + 64).every((x) => x === 0xff)) return q - o;
            throw new Error(`FV page ${hex(b)} runs off the ROM`);
        })();
        return fv.mainData.subarray(o, o + end);
    };
    const tdv = new DataView(pack.md.buffer);
    const tableAt = tdv.getUint32(pack.HDR_SETS, true) - MAIN_DATA;
    const dataTable = stf.mainDataView.getUint32(0x300008, true) - MAIN_DATA;
    const sets = plan.stages.map(({ st }) => st.texSets.at(-1));
    /* The guests' heap is full up to VF2's skies, so the set goes in main_data's
     * room from 0x600000: StF's data there (2 MB, none of it zero) is
     * nothing the board keeps, so nothing reads it. */
    let list = null, pageBytes = 0;
    const where = [], whereEnd = [];
    const alloc = (b, label) => { const at = free(main, b.length, 16, FV_PAGES_AT); where.push(at); whereEnd.push(at + b.length); main.put(at, b, `FV stage ${label}`); return MAIN_DATA + at; };
    sets.forEach((s, k) => {
        const e = tableAt + (FV_SET0 + k) * 4;
        if (!isFree(main, e, 4)) throw new Error('FV stages: the set table copy runs into something');
        const P = md.getUint32(off(FP) + s * 4, true), D = md.getUint32(off(FD) + md.getUint32(off(P), true) * 4, true);
        const n = md.getUint32(off(D), true);
        const g2s = [], pages = [];
        for (let i = 0; i < n; i++) {
            let g2 = md.getUint32(off(D) + 4 + i * 4, true);
            const b = md.getUint32(off(P) + 4 + i * 4, true);
            const slot = (g2 >> 1) & 0x7fff;
            if (slot < 16) continue;                  /* the stages' sheet's 12-15: no model reads them */
            if (!(g2 & 1)) g2 = (g2 & ~0xffff) | (evenTo(slot) << 1) | 1;
            g2s.push(g2);
            if (!b) { pages.push(0); continue; }
            const bytes = blockBytes(b), pad = b & 15, padded = new Uint8Array(pad + bytes.length);
            padded.set(bytes, pad);
            pageBytes += bytes.length;
            pages.push(alloc(padded, `set ${s} page ${i}`) + pad);
        }
        const l = u32s([g2s.length, ...g2s]);
        if (list && list.join() !== [...l].join()) throw new Error('FV stages: the sets\' destination lists differ');
        list = [...l];
        const pAt = alloc(u32s([FV_DATA_INDEX, ...pages]), `set ${s} page list`);
        main.put(e, u32s([pAt]), `FV set ${s} as ${FV_SET0 + k}`);
    });
    const dAt = alloc(Uint8Array.from(list), 'destination list');
    if (Math.max(...whereEnd) > FV_PAGES_END) throw new Error('FV stages: the pages run past their room');
    if (!isFree(main, dataTable + FV_DATA_INDEX * 4, 4)) throw new Error(`FV stages: destination list ${FV_DATA_INDEX} is taken`);
    main.put(dataTable + FV_DATA_INDEX * 4, u32s([dAt]), `destination list ${FV_DATA_INDEX}`);
    report.push(`set ${sets.join(', ')} as ${sets.map((_, k) => FV_SET0 + k).join(', ')}: ${list[0]} pages, ${(pageBytes / 1024).toFixed(0)} KB at ${hex(MAIN_DATA + Math.min(...where))}..${hex(MAIN_DATA + Math.max(...whereEnd))}`);
    const sky = fvSkyPlan(games);
    if (!isFree(main, FV_SKY_AT - MAIN_DATA, sky.blob.length)) throw new Error('FV skies: their room in main_data is taken');
    main.put(FV_SKY_AT - MAIN_DATA, sky.blob, 'FV stage skies');
    report.push(`skies: ${sky.skies.map((k) => `${k.name} ${k.rows} rows, blocks ${k.dest[0]}..${k.dest.at(-1)}`).join('; ')}, ${(sky.blob.length / 1024).toFixed(0)} KB at ${hex(FV_SKY_AT)}`);
    const problems = checkFvStages(R, games, plan);
    if (problems.length) throw new Error(`FV stages: ${problems.slice(0, 8).join('; ')}`);
    report.push('every model decodes through the board\'s ROMs as through FV\'s: points at its scale, UVs, tile sizes, texels at levels 0-3');
    return { report };
}

/* Each model through the board's data ROMs against FV's, as
 * vf2-stages.mjs checkVf2Stages: FV's texture RAM with the arena's sets
 * against the board's with StF's fighters' set and FV_SET0. */
function checkFvStages(R, games, plan) {
    const fv = games.fv.rom, stf = games.stf.rom;
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
    plan.stages.forEach(({ st, draws }, k) => {
        const src = texOf(buildTexram(fv, st.texSets)), dst = texOf(buildTexram(board, [1, FV_SET0 + k]));
        for (const m of new Set(draws.map((d) => d.model))) {
            const a = decodeModel(fv, m), b = decodeModel(board, plan.idOf.get(m));
            if (!a && !b) continue;
            if (!a || !b) { problems.push(`model ${m}: decodes in one only`); continue; }
            if (a.positions.length !== b.positions.length || a.positions.some((v, i) => !near(b.positions[i], v * FV_SCALE))) { problems.push(`model ${m}: points differ`); continue; }
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

if (import.meta.url === `file://${process.argv[1]}`) {
    const { loadNodeGames } = await import('../tests/node-roms.mjs');
    const games = await loadNodeGames();
    const plan = fvStagePlan(games);
    const hex = (v) => `0x${v.toString(16)}`;
    for (const s of plan.stages) {
        const t = totals(plan, s.models);
        console.log(`${s.slot} ${s.name}: ${s.draws.length} draws (${s.animated} moving; ${Object.entries(s.byLayer).map(([k, v]) => `${k} ${v}`).join(', ')})`);
        console.log(`  ${t.models} models, ${t.faces} faces, mesh ${(t.bytes / 1024).toFixed(0)} KB, ${t.bases} colour bases, ${t.tiles} tiles; texture set ${s.texSet}, colour set ${s.colorSet}`);
        console.log(`  flags ${hex(s.st.flags)} [${s.flags.join(' ')}]; light ${s.bright} (${s.vecter.join(', ')}); bg ${hex(s.bg)}; cycles ${s.cycles.length}`);
        console.log(`  cage ${s.cage.groups.map((g) => g.join(',')).join(' | ')}${s.cage.top ? `; top ${s.cage.top}` : ''}${s.cage.pole ? `; pole ${s.cage.pole}` : ''}; pieces ${s.cage.pieces.join(',')}`);
        console.log(`  pages ${Object.entries(pagesOf(plan, s.models)).map(([k, v]) => `${k}:${v}`).join(' ')}`);
        console.log(`  objects ${s.objects.join(' ') || '-'}; hooks ${s.hooks.join(' ') || '-'}`);
    }
    const t = totals(plan, plan.models);
    console.log(`all eight: ${t.models} models, ${t.faces} faces, mesh ${(t.bytes / 1024).toFixed(0)} KB, ${t.bases} colour bases, ${t.tiles} tiles`);
    const j = process.argv.indexOf('--json');
    if (j > 0) {
        const out = {
            scale: FV_SCALE, ring: FV_RING,
            stages: plan.stages.map(({ st, draws, ...s }) => ({ ...s, draws: draws.length, pages: pagesOf(plan, s.models) })),
            models: plan.models.map((m) => { const n = plan.needs.get(m); return { model: m, bytes: n.bytes, faces: n.faces, bases: n.bases, tiles: n.tiles.size }; }),
        };
        writeFileSync(process.argv[j + 1], JSON.stringify(out, null, 1));
    }
}
