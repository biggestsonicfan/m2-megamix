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
 * (half 6.0 at the default, 0x50A00C) becomes 12.3 in StF's units, so the
 * board's stage_x for an FV stage is 12.3, not StF's 8.0.
 *
 *   node tools/fv-stages.mjs [--json out.json]   (reads $ROMS_DIR's zips)
 */
import { writeFileSync } from 'node:fs';
import { buildFlatDisplayList } from '../vendor/noclip/js/display.js';
import { fvStageHooks } from '../vendor/noclip/js/fvstages.js';
import { readModelEntry, meshOffsetOf, xtraResolve } from '../vendor/noclip/js/romset.js';

/* The arenas, by slot (js/games.js STAGE_SLOTS.fv): 4 is a copy, 9.. are
 * Western 2, name entry and unnamed records. */
export const FV_STAGE_SLOTS = [0, 1, 2, 3, 5, 6, 7, 8];
/* FV's Sonic onto StF's Sonic (above). */
export const FV_SCALE = 2.676 / 1.309;
/* FV's ring at the default setting (0x50A00C), in its own units. */
export const FV_RING = 6.0;

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
        if ((attr & 3) === 0) break;
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
