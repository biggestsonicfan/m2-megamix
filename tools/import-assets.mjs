/*
 * Import the board build's data ROMs (board/roms/sfight/) from the arcade sets.
 *
 * The board runs as MAME's `sfight` (Model 2B), so its data ROMs keep StF's
 * file names and layout, and every asset sits at StF's own address: StF's
 * pointers, its tables in the program ROM and the code lifted from it
 * (tools/lift-stf.py) find them where they always were. What changes is what
 * is in them. Each ROM starts zero-filled and gets only what the board reads:
 *
 *   main data   the luma ramp, the polygon palette, the model-table entries of
 *               the models the board draws (with every hand, head and part
 *               StF's code can swap into its fighters), the codec's table,
 *               the texture sets it uploads (the
 *               fighters' and its stages'), StF's colour tables, StF's
 *               motions, and the HUD's tiles and patterns
 *   copro       the coprocessor firmware's sine and cosine tables
 *   polygons    those models' meshes
 *   textures    their texture points and headers
 *
 * and the rest is free for other games' data (VF2's, Fighting Vipers'), which
 * later steps of this script will import into it. StF's sound program gets
 * FV's songs added to its data, and the sample ROMs only what that data plays
 * (tools/guest-sound.mjs; the board sends StF's sound codes); the
 * billboard's program, which the board never reads, is written as zeros.
 *
 * Zero is what a word the board never reads holds, and also what most of StF's
 * own words are; a run of StF's zeros needs no keeping either. What the board
 * draws comes from its own tables (board/src/poses.h, tools/bake-board.mjs),
 * so run this after a bake:
 *
 *   node tools/import-assets.mjs [outdir]   (reads sfight.zip from $ROMS_DIR;
 *                                            outdir defaults to board/roms)
 *
 * and then run MAME with `-rompath board/roms` alone. It writes
 * outdir/assets.txt, the list of what it kept, by region and address, and
 * outdir/guests.json, what each guest lost on the way in (tools/grade-guest.mjs).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { readZipDirectory, extractZipEntry } from '../vendor/noclip/js/zip.js';
import { loadNodeGames, shenmueFile } from '../tests/node-roms.mjs';
import { importAkira, CHR as AKIRA_CHR } from './vf2-guest.mjs';
import { CHR as RYO_CHR, CHAI_CHR, shenmueTiles, importShenmue } from './ryo-guest.mjs';
import { CHR as HORNET_CHR, loadHornet, hornetTiles, importHornet } from './hornet-guest.mjs';
import { CHR as MAHLER_CHR, mahlerTiles, importMahler } from './mahler-guest.mjs';
import { importVf2Stages, VF2_SET0 } from './vf2-stages.mjs';
import { importFvStages } from './fv-stages.mjs';
import { importGuestShadows } from './guest-shadows.mjs';
import { guestSound, STF_FILES, SHENMUE_PACK } from './guest-sound.mjs';
import { installMoves } from './moves-text.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const ROMS = process.env.ROMS_DIR || `${process.env.HOME}/build/mameroms`;
const OUT = process.argv[2] ?? `${ROOT}board/roms`;

/* ---- the ROM set ---------------------------------------------------------- */

/* MAME's ROM_START(sfight), less the program pair (the board's own, built by
 * board/CMakeLists.txt). A pair is ROM_LOAD32_WORD: the first file holds
 * bytes 0-1 of each 32-bit word, the second bytes 2-3. A single is loaded as
 * it is (the sound program and samples, from tools/guest-sound.mjs). */
const SFIGHT = {
    main:     { size: 0x1000000, pairs: [[0x000000, 'mpr-19007.11', 'mpr-19008.12'], [0x800000, 'mpr-19005.9', 'mpr-19006.10']] },
    /* main_data + 0x1000000: the XTRA_DATA window (0x06000000), which StF
     * mirrors every megabyte up to the end of the region */
    xtra:     { size: 0x100000,  pairs: [[0x000000, 'epr-19003.7', 'epr-19004.8']] },
    copro:    { size: 0x400000,  pairs: [[0x000000, 'mpr-19015.29', 'mpr-19016.30']] },
    polygons: { size: 0x1000000, pairs: [[0x000000, 'mpr-19009.17', 'mpr-19012.21'], [0x800000, 'mpr-19010.18', 'mpr-19013.22']] },
    textures: { size: 0x1000000, pairs: [[0x000000, 'mpr-19019.27', 'mpr-19017.25'], [0x800000, 'mpr-19020.28', 'mpr-19018.26']] },
    audio:    { singles: ['epr-19021.31'] },
    samples:  { singles: ['mpr-19022.32', 'mpr-19023.33', 'mpr-19024.34', 'mpr-19025.35'] },
    /* the billboard's Z80 program (segabill, a device of its own; MAME looks
     * for it in the set's folder too), written as zeros of its size */
    billboard: { zeros: { 'epr-18022.ic2': 0x10000 } },
    /* StF's program, read for its tables (the board's replaces it) */
    program:  { size: 0x100000,  pairs: [[0x000000, 'epr-19001.15', 'epr-19002.16']] },
};

async function openZip(name) {
    const b = readFileSync(`${ROMS}/${name}.zip`);
    const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    const dir = readZipDirectory(buf);
    return async (member) => {
        const d = await extractZipEntry(buf, dir, member);
        if (!d) throw new Error(`${name}.zip: no ${member}`);
        return d;
    };
}

/* A region: the arcade's bytes (`src`) and the board's (`out`, zeros until
 * something is kept). */
class Region {
    constructor(name, layout, files) {
        this.name = name;
        this.layout = layout;
        this.src = new Uint8Array(layout.size);
        for (const [at, a, b] of layout.pairs) {
            const A = files[a], B = files[b];
            for (let i = 0; i < A.length; i += 2) {
                this.src[at + i * 2] = A[i];     this.src[at + i * 2 + 1] = A[i + 1];
                this.src[at + i * 2 + 2] = B[i]; this.src[at + i * 2 + 3] = B[i + 1];
            }
        }
        this.view = new DataView(this.src.buffer);
        this.out = new Uint8Array(layout.size);
        this.kept = [];
    }
    u16(o) { return this.view.getUint16(o, true); }
    u32(o) { return this.view.getUint32(o, true); }
    keep(off, len, label) {
        if (Number.isNaN(len)) throw new Error(`${this.name}: ${label} has no length`);
        if (!(len > 0)) return;
        if (off < 0 || off + len > this.src.length) throw new Error(`${this.name}: ${label} 0x${off.toString(16)}+0x${len.toString(16)} is outside`);
        this.out.set(this.src.subarray(off, off + len), off);
        this.kept.push([off, off + len, label]);
    }
    /* bytes of the board's own (not the arcade's) */
    put(off, bytes, label) {
        if (off < 0 || off + bytes.length > this.out.length) throw new Error(`${this.name}: ${label} 0x${off.toString(16)}+0x${bytes.length.toString(16)} is outside`);
        this.out.set(bytes, off);
        this.kept.push([off, off + bytes.length, label]);
    }
    /* back into the files, as MAME loads them */
    files() {
        const out = {};
        for (const [at, a, b] of this.layout.pairs) {
            const n = Math.min(this.layout.size - at, 0x800000) / 2;
            const A = out[a] = new Uint8Array(n), B = out[b] = new Uint8Array(n);
            for (let i = 0; i < n; i += 2) {
                A[i] = this.out[at + i * 2];     A[i + 1] = this.out[at + i * 2 + 1];
                B[i] = this.out[at + i * 2 + 2]; B[i + 1] = this.out[at + i * 2 + 3];
            }
        }
        return out;
    }
}

/* ---- what the board draws: its own tables -------------------------------- */

/* board/src/poses.h (tools/bake-board.mjs): each fighter's StF character, its
 * parts and eyes (with player 2's models), and each stage's draws, texture
 * set, colour set and moving-texture model. */
function boardTables() {
    const h = readFileSync(`${ROOT}board/src/poses.h`, 'utf8');
    const models = new Set(), chars = new Set(), texsets = new Set();
    for (const m of h.matchAll(/pose_part_t \w+\[\d+\] = \{([^;]*)\};/g))
        for (const p of m[1].matchAll(/\{(\d+), \d+, (\d+)\}/g)) { models.add(+p[1]); models.add(+p[2]); }
    /* VF2's stages (vf2stageN_draws, sets VF2_SET0 on) are tools/vf2-stages.mjs's,
     * FV's (fvstageN_draws, set FV_SET0) tools/fv-stages.mjs's */
    for (const m of h.matchAll(/stage_draw_t (?!vf2|fv)\w+\[\d+\] = \{([^;]*)\};/g))
        for (const d of m[1].matchAll(/^\s*\{(\d+), \{/gm)) models.add(+d[1]);
    /* and the models StF's swaying draws swap in (stageN_animK, by frame) */
    for (const m of h.matchAll(/u16 stage\d+_anim\d+\[\d+\] = \{([^}]*)\}/g))
        for (const d of m[1].split(',')) models.add(+d);
    for (const m of h.matchAll(/\{"[^"]+ stance", (\d+), \d+, \w+_parts/g)) chars.add(+m[1]);
    const stages = h.match(/stage_t stages\[STAGES\] = \{([^;]*)\};/)[1];
    for (const m of stages.matchAll(/\{"([^"]+)", (\d+), \d+, \w+, \{[^}]*\}, \w+, \w+, [-\d.]+f, -?\d+, -?\d+, \d+, \{[^}]*\}, \{(\d+), (\d+),/g)) {
        if (+m[2] >= VF2_SET0) continue;
        texsets.add(+m[2]);
        if (+m[3]) models.add(+m[4]);
    }
    if (!chars.size || !texsets.size) throw new Error('poses.h: no fighters or stages (run tools/bake-board.mjs)');
    return { models, chars: [...chars], texsets: [...texsets] };
}

/* board/src/stf_motion.h (tools/lift-stf.py): the guest tables, where the
 * lifted routines read StF's per-character and per-motion tables from: each
 * one's address, StF's own table (_SRC, _LEN) and the heap after them; and
 * char_game's values (GAME_<game>). */
function guestTables() {
    const h = readFileSync(`${ROOT}board/src/stf_motion.h`, 'utf8');
    const G = { tables: {}, games: {} };
    for (const m of h.matchAll(/#define GAME_(\w+) (\d+)u/g)) G.games[m[1]] = +m[2];
    for (const m of h.matchAll(/#define STF_GUEST_(\w+?)(_SRC|_LEN)? 0x([0-9A-F]+)u/g)) {
        if (m[1] === 'HEAP') { G.heap = parseInt(m[3], 16); continue; }
        const t = G.tables[m[1]] ??= {};
        t[m[2] ? m[2].slice(1).toLowerCase() : 'at'] = parseInt(m[3], 16);
    }
    G.nativeTail = parseInt(h.match(/#define STF_NATIVE_TAIL_FAR 0x([0-9A-F]+)u/)[1], 16);
    return G;
}

/* ---- Sonic the Fighters --------------------------------------------------- */

const MAIN_DATA = 0x02000000, XTRA = 0x06000000;
const MODEL_TABLE = 0x0e0004, MODELS = 5103;
const CHAR_PARTS = 0x0c5268;              /* program ROM: each character's record */
const PLAYER2 = 26;                       /* character c's player 2 is c + 26 */
const HAND_MODELS = 0x0c6570, FOOT_MODELS = 0x0c6640, BODY_MODELS = 0x0c6710;   /* program ROM, by character */
const HEAD_LIST = 0x0c540c;
const TRAIL_MODELS = 0x0b540c, TRAIL_OPTION = 0x0b5408;   /* program ROM: zanzou_control's models, by skeleton */
/* program ROM: the projectiles the board runs (docs/PROJECTILES.md): their
 * records in projectile_list, by type (2: the bomb Eggman throws,
 * bean_bomb_roll), and the bomb's landing marker (tdl_bakudan's two lists of
 * 11 models, bomb_fire_location_marker_circle and bomb_fire_location_marker) */
const PROJECTILE_LIST = 0x0b46ac, PROJECTILE_TYPES = [2];
const BOMB_MARKERS = [0x08a720, 0x08a736];
const OSAGE = 0x068d64;                   /* program ROM: osage_per_character, each character's sway chains */
const OSAGE_SIZE = { 1: 0x24, 2: 0x40, 3: 0x0c, 4: 0x18, 5: 0x44 };   /* osage_dsp's records, type word in */
/* program ROM: off_64988, each character's shadow table (docs/SHADOWS.md):
 * sixteen 24-byte entries (slot, model, flags, offset), then three u16 models */
const SHADOW_TABLES = 0x064988, SHADOW_ENTRIES = 16, SHADOW_ENTRY = 24;
const VOICE_STF = 11, VOICE_PARENTS = 52; /* blank_per_character_audio_array's lists: StF's by parent 0..10, the board's 52 */
const SHADOW_ROOM = 0x2a00;             /* StF's 0x2260 bytes of tables, and four guests' */
const SHADOW_BALL = 0x195;                /* rob_kage_disp_test: slot 0's while +0x2068 is 1 */
const SHADOW_TOBI = 0x736;                /* tobi_kage_disp: a projectile's shadow */
const SPIN_MODELS = 0x081138;             /* character_spin_mot_objects: the spin attack's two models, 0x20 bytes a character */
const SPIN_SMOKE = [0x323, 0x324];        /* spin_smoke_cnt: a puff, 0x323 + its age / 25 (it goes at 32) */
/* program ROM: ring_tobitiri's models, words: the ring's 16 turns
 * (fat_ring_spin_animation), the boss robots' 5 drops in their place
 * (non_ring_item_drops_when_hit) and the reflections' 16 on Aurora Icefield
 * (thin_ring_spin_animation); down_star's star */
const RING_MODELS = [[0x0ae314, 16], [0x0ae354, 5], [0x0ae368, 16]];
const DOWN_STAR = 211;
/* program ROM: the effect task's draws (efc_disp and the rest, #1625).
 * collision_particle_effects: 11 pointers (0 unused) to patterns, each an
 * f32 scale, u16 frames, u16 divisor, then frames / divisor u16 models
 * (the model for a frame is frame / divisor); the u16 tables
 * (address, count): spark_ka_pow's, the hyper sparkle's, the barrier's
 * four and Metal Sonic's laser windup; then the models drawn by number:
 * the chaos emeralds, the face marks (efc_face_opt_disp) and ko_disp's
 * K and O (k_o_objects) */
const EFFECT_PATTERNS = 0x032a30, EFFECT_PATTERN_COUNT = 11;
const EFFECT_TABLES = [[0x0349b4, 16], [0x090dcc, 16], [0x090c30, 19], [0x090c56, 19], [0x090c7c, 16], [0x090c9c, 8], [0x090c20, 8]];
const EFFECT_MODELS = [3772, 3774, 3778, 3780, 3782, 3784, 3786, 3788, 816, 817, 2297, 3009, 3011, 3012, 3014];
const SET_FIGHTERS = 1;
const MOTION_LIST = 0x06400004, MOTIONS = 519;
const SCROLL_TABLE = 0x06480000;          /* _ScrollCG_Initialize / _ScrollColor_Initialize */
const PATTERN_TABLE = 0x06480300;        /* dsp_pattern_new, dsp_character, clr_pattern */
const SCROLL_SLOTS = [0, 70, 170];        /* megamix.c's _Scroll_Initialize calls */

async function importStf(R) {
    const { main, xtra, copro, polygons, textures, program } = R;
    const board = boardTables();

    /* A data address (as the i960 sees it) in its region. */
    const at = (a) => {
        if (a >= MAIN_DATA && a < MAIN_DATA + 0x1000000) return [main, a - MAIN_DATA];
        if ((a >= MAIN_DATA + 0x1000000 && a < MAIN_DATA + 0x2000000)) return [xtra, a & 0xfffff];
        if (a >= XTRA && a < XTRA + 0x1000000) return [xtra, a & 0xfffff];
        throw new Error(`0x${a.toString(16)} is not in the data ROMs`);
    };
    const keepAt = (a, len, label) => { const [r, o] = at(a); r.keep(o, len, label); };
    const u32At = (a) => { const [r, o] = at(a); return r.u32(o); };

    /* The colour pipeline (m2_color_init, megamix.c): the luma ramp, a count
     * of 0x80-byte blocks and the bytes; the polygon palette. */
    const LUMA = 0x0d0008;
    main.keep(LUMA, 4 + main.u32(LUMA) * 0x80, 'luma ramp');
    main.keep(0x100000, 0x800, 'polygon palette');

    /* The coprocessor's firmware (StF's cpres1, which the SDK boots) reads
     * its sine and cosine tables from the copro data ROM (the SHARC's
     * 0x1c00000, a word an address): 0x10000 words each, around 0x1c10000
     * and 0x1c30000, indexed by a signed 16-bit angle. */
    copro.keep(0x08000 * 4, 0x10000 * 4, 'cpres1 sine table');
    copro.keep(0x28000 * 4, 0x10000 * 4, 'cpres1 cosine table');

    /* Models: every one the board draws, and every part StF's own code can put
     * in a fighter's sixteen slots, player 1's and player 2's:
     * calc_rob_angle_int takes them from the character record's lists at +0
     * and +8 (normal, then squished at +0x40); the move script's ops swap in
     * hands (player_hand_animations, sixteen a hand), feet and bodies
     * (player_foot_animation, player_body_animation) and heads
     * (player_head_change_action: PLAYER_HEAD_LIST[kind][character], a
     * frame count, then 0x14-byte frames of two heads and two eyes, one
     * frame per `step` frames). */
    const models = new Set(board.models);
    const model = (m) => { if (m > 0 && m < MODELS) models.add(m); };
    const kinds = (program.u32(HEAD_LIST) - HEAD_LIST) / 4;
    for (const c of board.chars) for (const ch of [c, c + PLAYER2]) {
        const rec = program.u32(CHAR_PARTS + ch * 4);
        for (const list of [program.u32(rec), program.u32(rec + 8)])
            for (let i = 0; i < 32; i++) model(program.u32(list + i * 4));
        for (const [t, n] of [[HAND_MODELS, 32], [FOOT_MODELS, 16], [BODY_MODELS, 16]]) {
            const a = program.u32(t + ch * 4);
            if (a) for (let i = 0; i < n; i++) model(program.u16(a + i * 2));
        }
        for (let k = 0; k < kinds; k++) {
            const h = program.u32(program.u32(HEAD_LIST + k * 4) + ch * 4);
            if (!h) continue;
            const step = program.u16(h + 4 + 8), frames = step ? Math.floor(program.u16(h) / step) + 1 : 1;
            for (let f = 0; f < frames; f++) for (let w = 0; w < 4; w++) model(program.u16(h + 4 + f * 0x14 + w * 2));
        }
        /* the afterimage's streak cards (zanzou_control): each part's three,
         * u16s at entries + part * 8, entries the character's in
         * TRAIL_MODELS[skeleton] or, while he holds an option, TRAIL_OPTION */
        for (const list of [...[0, 1, 2, 3].map((k) => program.u32(TRAIL_MODELS + k * 4)), program.u32(TRAIL_OPTION)]) {
            const e = program.u32(list + ch * 4);
            if (e) for (let s = 0; s < 16; s++) for (let i = 0; i < 3; i++) model(program.u16(e + s * 8 + i * 2));
        }
        /* the sway chains osage_dsp draws (osage_per_character's stream of
         * records, to a zero type): each segment's (type 5) model, +0x1C */
        for (let a = program.u32(OSAGE + ch * 4), t; (t = program.u32(a)) !== 0; a += OSAGE_SIZE[t]) {
            if (!OSAGE_SIZE[t]) throw new Error(`osage record type ${t} at 0x${a.toString(16)}`);
            if (t === 5) model(program.u32(a + 0x1c));
        }
        /* the spin attack's ball and its blur (sub_81038), which rob_disp
         * draws in place of the body while +0x2068 is 1 */
        for (let i = 0; i < 2; i++) model(program.u16(SPIN_MODELS + ch * 0x20 + i * 2));
        /* the shadows: the table's parts, and the tail's three (the extra
         * part at +0x78A, or the two at +0x7A2 on flag bit 27) */
        const shadow = program.u32(SHADOW_TABLES + ch * 4);
        for (let i = 0; i < SHADOW_ENTRIES; i++) model(program.u32(shadow + i * SHADOW_ENTRY + 4));
        for (let i = 0; i < 3; i++) model(program.u16(shadow + SHADOW_ENTRIES * SHADOW_ENTRY + i * 2));
    }
    /* the projectiles' models: each record's three animations (+4 flying,
     * +8 the burst, +0xC the fuse: a count, then 16-byte frames whose model
     * is the halfword at +8, as sub_8AE04 and sub_8D590 read them), and the
     * bomb's landing marker */
    for (const t of PROJECTILE_TYPES) {
        const rec = program.u32(PROJECTILE_LIST + t * 4);
        for (let k = 1; k <= 3; k++) {
            const a = program.u32(rec + k * 4);
            if (a) for (let i = 0; i < program.u32(a); i++) model(program.u16(a + 4 + i * 16 + 8));
        }
    }
    for (const list of BOMB_MARKERS) for (let i = 0; i < 11; i++) model(program.u16(list + i * 2));
    model(SHADOW_BALL);
    for (const m of SPIN_SMOKE) model(m);
    for (const [t, n] of RING_MODELS) for (let i = 0; i < n; i++) model(program.u32(t + i * 4));
    model(DOWN_STAR);
    for (let i = 1; i < EFFECT_PATTERN_COUNT; i++) {
        const a = program.u32(EFFECT_PATTERNS + i * 4);
        if (a) for (let k = 0; k < Math.ceil(program.u16(a + 4) / program.u16(a + 6)); k++) model(program.u16(a + 8 + k * 2));
    }
    for (const [t, n] of EFFECT_TABLES) for (let i = 0; i < n; i++) model(program.u16(t + i * 2));
    for (const m of EFFECT_MODELS) model(m);
    /* rob_kage_disp_test draws slot 0's entry, model 0, while +0x2068 is
     * not 1, and set_obj stops at a model whose header is 0 */
    models.add(0);
    model(SHADOW_TOBI);
    const colorbases = new Set();
    for (const m of [...models].sort((a, b) => a - b)) keepModel(m);
    /* the table's count (max_poly), which set_obj_fifo checks a model by */
    main.keep(MODEL_TABLE - 4, 4, 'model count');
    Object.assign(R, { models, colorbases, modelTable: MODEL_TABLE, modelCount: MODELS });

    function keepModel(m) {
        const e = MODEL_TABLE + m * 16;
        main.keep(e, 16, `model ${m}`);
        const tpa = main.u32(e), tha = main.u32(e + 4), oba = main.u32(e + 8);
        let obc = main.u32(e + 12);
        if (!(oba & 0x800000) || (oba & 0x1000000)) return;     /* not in the polygon ROM */
        if (obc === 0) obc = 0xfffff;
        /* The geometrizer's walk (MAME geo_parse_np_ns): two points, then
         * links of attribute + normal, and a point (and a fourth, or three
         * skipped words) where the attribute says a polygon follows. */
        const base = (oba & 0x3fffff) * 4;
        let p = base + 24;
        const polys = [];
        for (let i = 0; i < obc; i++) {
            const attr = polygons.u32(p);
            p += 16;
            if ((attr & 3) === 0) break;
            polys.push(attr);
            p += 24;
        }
        polygons.keep(base, p - base, `model ${m} mesh`);
        /* The rasterizer's texture reads, one polygon at a time: its points
         * (two halfwords a vertex) and its header (four), which steps by the
         * attribute's signed offset. Bit 23 means texture RAM. */
        let tp = tpa, th = tha, tpEnd = tpa, thLo = tha, thHi = tha;
        for (const attr of polys) {
            tp += ((attr & 1) ? 4 : 3) * 2;
            thLo = Math.min(thLo, th); thHi = Math.max(thHi, th + 4);
            if (!(th & 0x800000)) colorbases.add((textures.u16((th & 0x7fffff) * 2 + 6) >> 6) & 0x3ff);
            let tho = (attr >> 12) & 0x1f;
            if (tho & 0x10) tho -= 0x20;
            th += tho * 4;
        }
        tpEnd = tp;
        if (!(tpa & 0x800000) && polys.length) textures.keep((tpa & 0x7fffff) * 2, (tpEnd - tpa) * 2, `model ${m} points`);
        if (!(tha & 0x800000) && polys.length) textures.keep((thLo & 0x7fffff) * 2, (thHi - thLo) * 2, `model ${m} headers`);
    }

    /* Texture sets (tex_load_set): the two table pointers and the codec's
     * symbol table (stf_tex_codec.h TEX_CLASSIFY_ROM, 256 words); a set's
     * entry in the header table, which is the set's data index and its page
     * blocks; the data table's entry, a count and a header word a page. A
     * page block runs to the next one in the ROM (any set's), or to the
     * erased ROM's 0xFF fill after the last. */
    keepAt(0x02300008, 8, 'texture tables');
    keepAt(0x02300010, 0x400, 'texture codec table');
    const HDR = u32At(0x0230000c), DATA = u32At(0x02300008);
    const blocks = new Set();
    for (let s = 0; s < 0x40; s++) {
        let P;
        try { P = u32At(HDR + s * 4); u32At(P); } catch { continue; }
        for (let i = 0; i < 24; i++) { const b = u32At(P + 4 + i * 4); if (b) blocks.add(b); }
    }
    const sorted = [...blocks].sort((a, b) => a - b);
    const blockEnd = (b) => {
        const next = sorted.find((x) => x > b);
        if (next !== undefined) return next;
        const [r, o] = at(b);
        for (let q = o; q < r.src.length; q += 4) if (r.src.subarray(q, q + 64).every((x) => x === 0xff)) return MAIN_DATA + q;
        throw new Error(`texture page ${b.toString(16)} runs off the ROM`);
    };
    for (const s of [SET_FIGHTERS, ...board.texsets]) {
        const P = u32At(HDR + s * 4);
        keepAt(HDR + s * 4, 4, `texture set ${s}`);
        const D = u32At(DATA + u32At(P) * 4);
        keepAt(DATA + u32At(P) * 4, 4, `texture set ${s}`);
        const count = Math.min(u32At(D), 24);
        keepAt(D, 4 + count * 4, `texture set ${s} headers`);
        keepAt(P, 4 + count * 4, `texture set ${s} pages`);
        for (let i = 0; i < count; i++) {
            const b = u32At(P + 4 + i * 4);
            if (b) keepAt(b, blockEnd(b) - b, `texture set ${s} page ${i}`);
        }
    }

    /* StF's colour tables, which its own colour routines (stf_motion.s) read:
     * seven pointers (0x2101000: the skins, player 1's and 2's; the parts,
     * player 1's and 2's; the stages' colour sets, 0x540 bytes each; the
     * fixed rows 5..6 and 12..13, two rows of 0x60 bytes each), their tables
     * one after another. */
    main.keep(0x101000, 7 * 4, 'colour tables');
    keepAt(main.u32(0x101000), main.u32(0x101018) + 2 * 0x60 - main.u32(0x101000), 'colour tables');

    /* Motions: the list and every block. The fighters run StF's own motion
     * and fight code (set_motion, rob_action, collision), which picks a hit's
     * reaction from tables of its own, so all of StF's motions stay. A block
     * runs to the next (the list is packed); the last ends where its channel
     * streams do (noclip motion.js decodeMotion). */
    keepAt(MOTION_LIST, MOTIONS * 4, 'motion list');
    const starts = new Set();
    for (let id = 1; id < MOTIONS; id++) { const a = u32At(MOTION_LIST + id * 4); if (a) starts.add(at(a)); }
    const byRegion = new Map();
    for (const [r, o] of starts) { if (!byRegion.has(r)) byRegion.set(r, new Set()); byRegion.get(r).add(o); }
    for (const [r, set] of byRegion) {
        const offs = [...set].sort((a, b) => a - b);
        for (let i = 0; i < offs.length; i++) {
            const end = i + 1 < offs.length ? offs[i + 1] : motionEnd(r, offs[i]);
            r.keep(offs[i], end - offs[i], 'motion');
        }
    }

    /* The guest tables start as StF's own (a guest's entries go in later; the
     * board's own, with no source, as zeros).
     * PLAYER_HEAD_LIST is a list a kind of head change, each of them a list
     * by character: those lists are copied too, after it in its room. */
    const G = guestTables();
    const tables = {};
    for (const [name, t] of Object.entries(G.tables)) {
        const b = new Uint8Array(t.len);
        for (let i = 0; i < t.len; i += 4) new DataView(b.buffer).setUint32(i, !t.src ? 0 : t.src < 0x100000 ? program.u32(t.src + i) : u32At(t.src + i), true);
        tables[name] = { ...t, bytes: b, view: new DataView(b.buffer) };
    }
    const heads = tables.PLAYER_HEAD_LIST;
    const kindsAt = heads.len, perKind = 52 * 4;
    const all = new Uint8Array(kindsAt + (heads.len / 4) * perKind);
    all.set(heads.bytes);
    for (let k = 0; k < heads.len / 4; k++) {
        const src = heads.view.getUint32(k * 4, true), to = kindsAt + k * perKind;
        for (let i = 0; i < perKind; i += 4) new DataView(all.buffer).setUint32(to + i, program.u32(src + i), true);
        new DataView(all.buffer).setUint32(k * 4, heads.at + to, true);
    }
    Object.assign(heads, { bytes: all, view: new DataView(all.buffer), lists: kindsAt, perKind });
    /* off_B540C (TRAIL_MODELS) is a list by skeleton type of lists by
     * character of the afterimage's part models: the lists (two: types 0
     * to 2 share one) are copied after it in its room, each skeleton's
     * pointer moved onto its copy. */
    {
        const t = tables.off_B540C, srcs = [0, 1, 2, 3].map((k) => t.view.getUint32(k * 4, true));
        const from = Math.min(...srcs), n = Math.max(...srcs) - from + 52 * 4;
        const b = new Uint8Array(0x10 + n), v = new DataView(b.buffer);
        for (let i = 0; i < n; i += 4) v.setUint32(0x10 + i, program.u32(from + i), true);
        srcs.forEach((a, k) => v.setUint32(k * 4, t.at + 0x10 + a - from, true));
        Object.assign(t, { bytes: b, view: v, lists: 0x10 });
    }
    /* free room in the extra data ROM, from 0x100 */
    const xtraRoom = (room, what) => {
        const iv = xtra.kept.map(([a, b]) => [a, b]).sort((a, b) => a[0] - b[0]);
        let off = 0x100;
        for (const [a, b] of iv) {
            if (b <= off) continue;
            if (a >= off + room) break;
            off = (b + 15) & ~15;
        }
        if (off + room > xtra.out.length) throw new Error(`${what}: no room in the extra data ROM`);
        return off;
    };
    /* off_64988 (SHADOW_TABLES) is a list by character of shadow tables:
     * StF's tables are copied into free room in the extra data ROM (main_data
     * has none to spare under the VF2 skies), each pointer moved onto its
     * copy; the guests' own go after them (shadowTable, tools/guest-shadows.mjs). */
    {
        const t = tables.off_64988, len = SHADOW_ENTRIES * SHADOW_ENTRY + 8, room = SHADOW_ROOM;
        const srcs = Array.from({ length: 52 }, (_, c) => t.view.getUint32(c * 4, true));
        const from = Math.min(...srcs), n = Math.max(...srcs) - from + len;
        if (n > room) throw new Error('off_64988: StF\'s shadow tables do not fit SHADOW_ROOM');
        const off = xtraRoom(room, 'off_64988');
        const b = new Uint8Array(room), v = new DataView(b.buffer);
        for (let i = 0; i < n; i += 4) v.setUint32(i, program.u32(from + i), true);
        srcs.forEach((a, c) => t.view.setUint32(c * 4, XTRA + off + a - from, true));
        xtra.put(off, b, 'shadow tables');
        let free = (n + 3) & ~3;
        const shadowTable = (chrs, table) => {
            if (free + table.length > room) throw new Error('off_64988: no room for a guest\'s shadow table (SHADOW_ROOM)');
            xtra.put(off + free, table, 'a guest\'s shadow table');
            for (const c of chrs) t.view.setUint32(c * 4, XTRA + off + free, true);
            free = (free + table.length + 3) & ~3;
            return XTRA + off + free - ((table.length + 3) & ~3);
        };
        Object.assign(t, { shadowTable });
    }
    /* blank_per_character_audio_array is a list by play op 9's sound of
     * lists by parent (rob+0x1B1) of sound codes, all zeros in StF: every
     * sound's pointer moved onto one list of zeros long enough for the
     * board's parents, in free room in the extra data ROM (a list of StF's
     * that is not all zeros, a copy of its own); voice(parent, n, code) gives
     * a guest one, on a list of the sound's own (tools/vf2-guest.mjs). */
    {
        const t = tables.blank_per_character_audio_array, n = t.len / 4, per = VOICE_PARENTS * 4;
        const lists = n + 1, off = xtraRoom(lists * per, 'voice lists');
        xtra.put(off, new Uint8Array(lists * per), 'voice lists');
        const v = new DataView(xtra.out.buffer, xtra.out.byteOffset + off, lists * per);
        let used = 1;
        const own = (k) => {
            const at = t.view.getUint32(k * 4, true) - XTRA - off;
            if (at !== 0) return at;
            t.view.setUint32(k * 4, XTRA + off + used * per, true);
            return used++ * per;
        };
        for (let k = 0; k < n; k++) {
            const src = t.view.getUint32(k * 4, true);
            const codes = src ? Array.from({ length: VOICE_STF }, (_, i) => program.u32(src + 4 * i)) : [];
            t.view.setUint32(k * 4, XTRA + off, true);
            if (codes.some((c) => c)) { const at = own(k); codes.forEach((c, i) => v.setUint32(at + 4 * i, c, true)); }
        }
        const voice = (parent, k, code) => {
            if (k >= n || parent >= VOICE_PARENTS) throw new Error(`voice ${k} of parent ${parent}: past the table`);
            v.setUint32(own(k) + parent * 4, code, true);
        };
        Object.assign(t, { voice });
    }
    R.guest = { ...G, tables };

    /* The HUD's tiles (_Scroll_Initialize n: _ScrollCG_Initialize n, then
     * _ScrollColor_Initialize n + 1). The scroll table's entry is a list of
     * (source, destination) pairs ended by a zero source, each source a count
     * and that many 32-byte tiles; a colour list is (destination, bytes) and
     * the words inline, ended by a zero destination. */
    for (const n of SCROLL_SLOTS) {
        keepAt(SCROLL_TABLE + n * 4, 8, `scroll ${n}`);
        let p = u32At(SCROLL_TABLE + n * 4), q = p;
        for (; u32At(q); q += 8) { const src = u32At(q); keepAt(src, 4 + u32At(src) * 32, `scroll ${n} tiles`); }
        keepAt(p, q + 4 - p, `scroll ${n} list`);
        p = q = u32At(SCROLL_TABLE + (n + 1) * 4);
        while (u32At(q)) q += 8 + (u32At(q + 4) >>> 1) * 4;
        keepAt(p, q + 4 - p, `scroll ${n + 1} colours`);
    }
    /* Patterns (dsp_pattern_new, dsp_character, clr_pattern): a table of
     * pointers, each pattern a base, rows, columns and rows x columns tile
     * words. Only the lifted HUD code draws them (stf_motion.s), by these
     * numbers: energy_disp's bars 2 and 3; win_lamp_int's lamps 10 and 18;
     * time_dsp's 14 to 16; barrier_left_disp's 118 to 120 and the barrier
     * breaking frames (seven a side, tables in the program ROM);
     * barrier_left_disp_init's box (barrier_waku_disp's ends 122 and 307,
     * its top and bottom the first words of 308 and 121, all it reads of
     * them) and its BARRIER, 117; and win_lamp_dsp's stars, sixteen frames
     * in each of four tables. */
    const ids = new Set([2, 3, 10, 18, 14, 15, 16, 117, 118, 119, 120, 122, 307]);
    for (const t of [0x0aeb88, 0x0aeba4]) for (let i = 0; i < 7; i++) ids.add(program.u32(t + i * 4));
    for (let k = 0; k < 4; k++) { const t = program.u32(0x0f1bb4 + k * 4); for (let i = 0; i < 16; i++) ids.add(program.u32(t + i * 4)); }
    for (const i of [...ids].sort((a, b) => a - b)) {
        const e = PATTERN_TABLE + i * 4, a = u32At(e);
        keepAt(e, 4, `pattern ${i}`);
        keepAt(a, 12 + u32At(a + 4) * u32At(a + 8) * 2, `pattern ${i}`);
    }
    for (const i of [121, 308]) {
        const e = PATTERN_TABLE + i * 4;
        keepAt(e, 4, `pattern ${i}`);
        keepAt(u32At(e), 14, `pattern ${i}'s first word`);
    }
}

/* noclip motion.js decodeMotion's extent: a 22-byte head (frames, then a
 * channel-type byte for each of the 20 objects), a count byte per keyed
 * channel, then (four-aligned) the key times and the values. */
function motionEnd(r, off) {
    const ZERO = 3, LINEAR = 5, HERMITE = 6;
    const types = [];
    for (let j = 0; j < 20; j++) {
        const b = r.src[off + 2 + j], top2 = (b >> 6) & 3;
        for (let a = 0; a < 3; a++) types.push(top2 === 0 ? ((b >> (a * 2)) & 3) + 3 : top2 - 1);
    }
    const counts = [];
    let n = 0;
    for (const t of types) counts.push(t === LINEAR || t === HERMITE ? r.src[off + 22 + n++] : 0);
    let p = off + ((22 + n + 3) & ~3);
    types.forEach((t, i) => { if (t === LINEAR || t === HERMITE) p += counts[i] * 4; });
    types.forEach((t, i) => { p += t === ZERO ? 0 : t === LINEAR ? counts[i] * 4 : t === HERMITE ? counts[i] * 12 : 4; });
    return p;
}

/* ---- out ------------------------------------------------------------------ */

function manifest(regions) {
    const lines = ['# What tools/import-assets.mjs kept: region, start, end, bytes, what.', ''];
    for (const r of regions) {
        const k = r.kept.sort((a, b) => a[0] - b[0]);
        /* one line a run: overlapping and touching keeps of one label merge */
        const runs = [];
        for (const [s, e, l] of k) {
            const last = runs[runs.length - 1];
            if (last && s <= last[1] && last[2] === l) last[1] = Math.max(last[1], e);
            else runs.push([s, e, l]);
        }
        let total = 0;
        for (let i = 0; i < r.out.length; i += 4096) {
            const page = r.out.subarray(i, i + 4096);
            if (page.some((x) => x)) total += page.reduce((n, x) => n + (x ? 1 : 0), 0);
        }
        lines.push(`## ${r.name}: ${runs.length} runs, ${total} nonzero bytes of ${r.out.length}`);
        for (const [s, e, l] of runs) lines.push(`${r.name} ${s.toString(16).padStart(7, '0')} ${e.toString(16).padStart(7, '0')} ${(e - s).toString().padStart(8)} ${l}`);
        lines.push('');
    }
    return lines.join('\n');
}

const zip = await openZip('sfight');
const files = {};
for (const L of Object.values(SFIGHT)) for (const f of [...(L.pairs ?? []).flatMap((p) => p.slice(1)), ...(L.singles ?? [])]) files[f] = await zip(f);
const R = {};
for (const [name, L] of Object.entries(SFIGHT)) if (L.pairs) R[name] = new Region(name, L, files);

await importStf(R);
/* the guests: VF2's Akira as StF's character 6 (tools/vf2-guest.mjs), the
 * Shenmue beta's Ryo as character 1 and Chai as 12, both on Akira's moves
 * (tools/ryo-guest.mjs), and Fighters Megamix's Hornet, Daytona USA's car, as
 * 17 (tools/hornet-guest.mjs), and Fighting Vipers' Mahler as 18
 * (tools/mahler-guest.mjs), their textures packed with Akira's */
const NG = await loadNodeGames();
const SHENMUE = [{ name: 'RYO', chr: RYO_CHR }, { name: 'CHAI', chr: CHAI_CHR }];
const shTex = SHENMUE.map((g) => shenmueTiles(NG, g.name));
const HO = await loadHornet();
const hoTex = hornetTiles(HO);
const maTex = mahlerTiles(NG.fv.rom);
const akira = importAkira(R, NG.vf2.rom, NG.stf.rom, { extraTiles: [...shTex.flatMap((t) => t.tiles), ...hoTex.tiles, ...maTex.tiles] });
for (const line of akira.report) console.log(`Akira: ${line}`);
const shenmue = SHENMUE.map((g, i) => {
    const r = importShenmue(R, akira.ctx, NG, shTex[i], g);
    for (const line of r.report) console.log(`${r.coverage.name}: ${line}`);
    return r;
});
const hornet = importHornet(R, akira.ctx, NG, HO, hoTex, { chr: HORNET_CHR });
for (const line of hornet.report) console.log(`Hornet: ${line}`);
const mahler = importMahler(R, akira.ctx, NG, maTex, { chr: MAHLER_CHR });
for (const line of mahler.report) console.log(`Mahler: ${line}`);
/* each guest's own shadows (tools/guest-shadows.mjs) */
const cold = shenmueFile('MISC/COLD.BIN');
const shadows = importGuestShadows(R, akira.ctx, { vf2: NG.vf2.rom, stf: NG.stf.rom, cold: cold && new Uint8Array(cold) }, {
    akira: { chr: AKIRA_CHR }, hornet: { chr: HORNET_CHR, pieces: hornet.pieces }, mahler: { chr: MAHLER_CHR, pieces: mahler.pieces },
    shenmue: SHENMUE.map((g, i) => ({ name: g.name[0] + g.name.slice(1).toLowerCase(), chr: g.chr, scale: shenmue[i].scale })),
});
for (const line of shadows.report) console.log(`Shadows: ${line}`);
/* VF2's Tou-rin and Colosseum (tools/vf2-stages.mjs) */
const vf2st = importVf2Stages(R, NG, akira.ctx);
for (const line of vf2st.report) console.log(`VF2 stages: ${line}`);
/* Fighting Vipers' Western (tools/fv-stages.mjs) */
const fvst = importFvStages(R, NG, akira.ctx);
for (const line of fvst.report) console.log(`FV stages: ${line}`);
/* board/moves: fighters' moves as text, edited (tools/moves-text.mjs writes
 * them), in place of what each had */
const MOVES = `${ROOT}board/moves`;
for (const f of existsSync(MOVES) ? readdirSync(MOVES).filter((n) => n.endsWith('.moves')).sort() : [])
    for (const line of installMoves(R, akira.ctx, readFileSync(`${MOVES}/${f}`, 'utf8'), f)) console.log(`Moves ${f}: ${line}`);
/* the guest tables, as they are after every guest's entries */
for (const [name, t] of Object.entries(R.guest.tables)) R.main.put(t.at - MAIN_DATA, t.bytes, `guest ${name}`);

const dir = `${OUT}/sfight`;
mkdirSync(dir, { recursive: true });
const data = [R.main, R.xtra, R.copro, R.polygons, R.textures];
for (const r of data) for (const [f, d] of Object.entries(r.files())) writeFileSync(`${dir}/${f}`, d);
/* the sound board's: StF's 68000 program with FV's songs added to its data,
 * and the samples that data plays (tools/guest-sound.mjs), with the
 * Shenmue effects Ryo's and Chai's moves send */
const shPack = shenmueFile(SHENMUE_PACK);
const shEffects = new Set(shenmue.flatMap((r) => [...r.effects]));
const snd = await guestSound(files, shPack && { pack: new Uint8Array(shPack), effects: shEffects });
for (const line of snd.report) console.log(`Sound: ${line}`);
writeFileSync(`${dir}/${STF_FILES.prog}`, snd.prog);
for (const [f, d] of Object.entries(snd.samples)) writeFileSync(`${dir}/${f}`, d);
for (const [f, n] of Object.entries(SFIGHT.billboard.zeros)) writeFileSync(`${dir}/${f}`, new Uint8Array(n));
writeFileSync(`${OUT}/assets.txt`, manifest(data));
/* what each guest lost on the way in (tools/grade-guest.mjs reads it) */
writeFileSync(`${OUT}/guests.json`, JSON.stringify({ guests: [akira.coverage, ...shenmue.map((r) => r.coverage), hornet.coverage, mahler.coverage] }, null, 1) + '\n');
for (const r of data) {
    let n = 0;
    for (const x of r.out) if (x) n++;
    console.log(`${r.name.padEnd(9)} ${(n / 1024).toFixed(0).padStart(6)} KB nonzero of ${(r.out.length / 1024 / 1024).toFixed(0)} MB`);
}
