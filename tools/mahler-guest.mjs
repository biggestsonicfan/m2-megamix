/*
 * Fighting Vipers' Mahler as a guest on the Sonic the Fighters board, built
 * on what tools/vf2-guest.mjs puts in for Akira, as tools/hornet-guest.mjs
 * builds Hornet. He plays as StF character 18 (44 his player 2) and runs
 * StF's own fight code. What is his own (docs/FV-MAHLER.md):
 *   - his parts: FV's models (readFighters(fv)[8]), polygon for polygon
 *     (readObject, encodeObject), at his size (SCALE: StF's Knuckles over
 *     FV's fighters); slot 0 (FV's 705, nothing drawn) none;
 *   - his shoulder pads (FV's kata_pat_disp, 0x32A90): the four models
 *     placed on the chest as FV places them at rest (their translate and
 *     turns, noclip vf2fighters.js placeExtra) and made one with it, so they
 *     go where his chest goes; FV swings them with the upper arms, which
 *     the board doesn't;
 *   - his midriff (record +0x24, VF2's struct; the board's guest table
 *     `midriff`), his hands (FV's hand list, 0x640EBF4: four shapes a hand)
 *     and his head;
 *   - his textures: FV's tiles (sets 17 and 18, all on sheet 1), those that
 *     overlap as one, with the mip levels FV's sheet holds, packed with
 *     Akira's (tools/pack-akira.mjs `extra`, only the cells they cover);
 *   - his colours: FV's colorbases' words as they are (StF's lumaram and
 *     ramps are FV's; the rows FV fills per fighter, 0..6 and 28/29, the
 *     board fills with FV's: tools/bake-board.mjs GUESTS). Player 2 is
 *     player 1's record in FV (record 21 is record 8), so FV draws both the
 *     same; on the board player 2 has models of his own, the same meshes
 *     under headers whose colorbases name the player 2 rows (7..13, 30/31),
 *     which the board fills with FV's player 2 colours, the same as player
 *     1's: both players look alike, as in FV;
 *   - his skeleton and pose bones (record +4, VF2's layout, at his size);
 *   - his collision balls, Akira's fitted to his parts;
 *   - his moves: FV's own (tools/fv-moves.mjs).
 */
import { readFighters } from '../vendor/noclip/js/vf2fighters.js';
import { turnedBy } from '../vendor/noclip/js/pose.js';
import { decodeModel } from '../vendor/noclip/js/model.js';
import { readModelEntry } from '../vendor/noclip/js/romset.js';
import { resolveData } from '../vendor/noclip/js/motion.js';
import { buildTexram } from '../vendor/noclip/js/texture.js';
import { SHEET_H, SHEET_BYTES, texelByte, levelOrigin } from '../vendor/noclip/js/atlas.js';
import { readObject, encodeObject } from './daytona-hornet.mjs';
import { SCALE, THROWN } from './vf2-guest.mjs';
import { pointBox, fitBalls, seatGuest } from './ryo-guest.mjs';
import { importFvMoves } from './fv-moves.mjs';

/* StF's character 18: not one the code checks by number, nor a bit of the
 * opponent mask (as Hornet's 17). */
export const CHR = 18;
const PLAYER2 = 26;
/* FV's character 8 and his texture sets */
const FIGHTER = 8, SETS = [17, 18];
/* His size: StF's Knuckles over FV's fighters (docs/FV-GUESTS.md, scale). */
export const K = 2.676 / 1.309;
/* FV's record: +4 the skeleton, +0x24 the midriff; the hand list */
const SKELETON = 4, SKELETON_BYTES = 15 * 12, MIDRIFF_AT = 0x24, JUMP = 0x34;
const HANDS = 0x0640ebf4, SHAPES = 4;
const MIDRIFF = { model: 8, ring: 0x70, ringPoints: 8, count: 0xd0, links: 0xd4, link: 10, first: 8 };
const POLY_RUN_END = 0xec2578 + 0x13da88;
const TEX_RUN_END = 0x78bdb8 + 0x74248;
const LEVELS = 5;
const TEXTURED = 0x4000;
/* th0's bits kept: textured, holes, wrap and mirror, size; not the
 * microtexture (bits 10-12) */
const TH0_KEEP = 0xc000 | 0x2000 | 0x3ff;
/* The colour rows FV fills per fighter, and player 2's (StF's the same) */
const P2_ROW = (r) => (r < 7 ? r + 7 : r === 28 ? 30 : r === 29 ? 31 : r);

const hex = (v) => '0x' + (v >>> 0).toString(16).toUpperCase();
const tileOf = (th) => ({ x: 32 * (th[2] & 0x3f), y: 32 * ((th[2] >> 6) & 0x1f), w: 32 << (th[0] & 7), h: 32 << ((th[0] >> 3) & 7) });
const tileKey = (th) => { const t = tileOf(th); return `${t.x},${t.y},${t.w},${t.h}`; };

/* His FV models: the parts (slot -> model), the pads, the midriff and the
 * hands' shapes, and the hand list (left, right: SHAPES models each). */
function mahlerModels(fv) {
    const A = readFighters(fv)[FIGHTER];
    const res = (a) => resolveData(fv, a);
    const d32 = (a) => { const r = res(a); return r.view.getUint32(r.off, true); };
    const d16 = (a) => { const r = res(a); return r.view.getInt16(r.off, true); };
    const d8 = (a) => { const r = res(a); return r.view.getUint8(r.off); };
    const f32 = (a) => { const r = res(a); return r.view.getFloat32(r.off, true); };
    const midriffAt = d32(A.root + MIDRIFF_AT);
    const handList = d32(HANDS + A.index * 4);
    const hands = [0, 1].map((h) => Array.from({ length: SHAPES }, (_, i) => d16(handList + (h * SHAPES + i) * 2)));
    return { A, d32, d8, f32, res, midriffAt, midriff: d32(midriffAt + MIDRIFF.model), hands };
}

/** His tiles, for pack-akira's `extra`: FV's tiles that overlap made one,
 *  each the rectangle round them with the cells they cover (`cells`), at
 *  levels 0-4 as FV's sheet holds them. { tiles, byKey: FV tile -> { tile,
 *  dx, dy } } (its place in the one it went into). */
export function mahlerTiles(fv) {
    const M = mahlerModels(fv);
    const models = [...M.A.parts.slice(1).map((p) => p.model), ...M.A.extras.map((e) => e.model), M.midriff, ...M.hands.flat()];
    const rects = new Map();
    for (const m of new Set(models)) for (const q of readObject(fv, m)) {
        if (!(q.th[0] & TEXTURED)) continue;
        if (!((q.th[2] >> 12) & 1) || q.th[2] >> 13) throw new Error(`Mahler: model ${m}: a tile not on sheet 1 (${q.th.map(hex)})`);
        rects.set(tileKey(q.th), tileOf(q.th));
    }
    /* the midriff's links draw with its streams as they are (below): their tiles too */
    for (const b of midriffRecs(fv, M.midriff)) {
        const th = [0, 1, 2, 3].map((i) => fv.textures[b + i * 2] | (fv.textures[b + i * 2 + 1] << 8));
        if (th[0] & TEXTURED) rects.set(tileKey(th), tileOf(th));
    }
    /* overlapping tiles as one */
    const groups = [...rects.values()].map((r) => ({ ...r, members: [r] }));
    for (let merged = true; merged;) {
        merged = false;
        for (let i = 0; i < groups.length && !merged; i++) for (let j = i + 1; j < groups.length && !merged; j++) {
            const a = groups[i], b = groups[j];
            if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
                const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
                groups[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y, members: [...a.members, ...b.members] };
                groups.splice(j, 1);
                merged = true;
            }
        }
    }
    const tr = buildTexram(fv, SETS);
    const tex = new Uint8Array(tr.sheet0.buffer, tr.sheet0.byteOffset, SHEET_BYTES * 2);
    const nib = (x, y) => {
        const o = texelByte(x, y) & ~1;
        return ((tex[o] | (tex[o + 1] << 8)) >> (((y & 1) ? 0 : 8) + ((x & 1) ? 0 : 4))) & 0xf;
    };
    const tiles = [], byKey = new Map();
    for (const g of groups) {
        if (g.w > 256 || g.h > 256) throw new Error(`Mahler: tiles at ${g.x},${g.y} make one ${g.w}x${g.h}`);
        const cells = new Set();
        for (const m of g.members) for (let y = m.y; y < m.y + m.h; y += 32) for (let x = m.x; x < m.x + m.w; x += 32) cells.add(`${(x - g.x) / 32},${(y - g.y) / 32}`);
        const levels = [];
        for (let L = 0; L < LEVELS; L++) {
            const at = levelOrigin(g.x, g.y + SHEET_H, L), lw = g.w >> L, lh = g.h >> L, l = new Uint8Array(lw * lh);
            for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) l[j * lw + i] = nib(at.x + i, at.y + j);
            levels.push(l);
        }
        const tile = { name: `MAHLER ${g.x},${g.y}`, x: g.x, y: g.y, w: g.w, h: g.h, levels, cells: [...cells].map((c) => c.split(',').map(Number)), order: 1 };
        tiles.push(tile);
        for (const m of g.members) byKey.set(`${m.x},${m.y},${m.w},${m.h}`, { tile, dx: m.x - g.x, dy: m.y - g.y });
    }
    return { tiles, byKey };
}

/* Which bytes of FV's textures region a model's decode reads: its header
 * stream (`mat`), its texture point stream (`uv`) and the headers it lands
 * on (`recs`), as pack-akira's streams. */
function streamsOf(fv, m) {
    const e = readModelEntry(fv, m), seen = new Set();
    const proxy = new Proxy(fv.textures, {
        get(o, k) {
            if (typeof k === 'string' && /^\d+$/.test(k)) seen.add(+k);
            const v = Reflect.get(o, k, o);
            return typeof v === 'function' ? v.bind(o) : v;
        },
    });
    const fake = Object.create(fv);
    Object.defineProperty(fake, 'textures', { value: proxy });
    decodeModel(fake, m);
    const mat = [], uv = [];
    for (const b of seen) (Math.abs(b - e.matPtr * 2) < Math.abs(b - e.uvPtr * 2) ? mat : uv).push(b);
    const range = (a, at) => (a.length ? { from: Math.min(at, ...a), to: Math.max(...a) + 1 } : null);
    return { e, mat: range(mat, e.matPtr * 2), uv: range(uv, e.uvPtr * 2), recs: mat.filter((b) => (b - e.matPtr * 2) % 8 === 0).sort((a, b) => a - b) };
}
const midriffRecs = (fv, m) => streamsOf(fv, m).recs;

/* R: import-assets' regions; ctx: importAkira's (after the guests before
 * him); games: loadNodeGames(); tex: mahlerTiles(fv), after importAkira
 * packed them (each tile's `at`). */
export function importMahler(R, ctx, games, { byKey }, { chr: CHR_ = CHR } = {}) {
    const { main, polygons, textures } = R;
    const fv = games.fv.rom, vf2 = games.vf2.rom;
    const Who = 'Mahler';
    const report = [];
    const alloc = (b, label, align = 4) => ctx.alloc(b, label, align, Who);
    const { u32s, u16s } = ctx;
    const k = K;
    const M = mahlerModels(fv);
    const { A } = M;
    const T = R.guest.tables;

    /* ---- colour: FV's colorbases' words, for player 1 and player 2 ---- */
    const fvWord = (cb) => fv.mainDataView.getUint16(0x100000 + cb * 2, true);
    const palSrc = (cb) => main.src[0x100000 + cb * 2] | (main.src[0x100000 + cb * 2 + 1] << 8);
    const existing = new Map();
    for (let cb = 1; cb < 0x400; cb++) if (!existing.has(palSrc(cb))) existing.set(palSrc(cb), cb);
    const free = [];
    for (let n = 0x3ff; n >= 32; n--) if (!R.colorbases.has(n) && !ctx.freeTaken.has(n)) free.push(n);
    const byWord = new Map();
    let fresh = 0;
    const cbOfWord = (w) => {
        if (byWord.has(w)) return byWord.get(w);
        let n = existing.get(w);
        if (n === undefined) {
            n = free.shift();
            if (n === undefined) throw new Error(`${Who}: no free colorbases`);
            ctx.freeTaken.add(n);
            main.put(0x100000 + n * 2, Uint8Array.of(w & 0xff, w >> 8), `${Who} colorbase ${hex(w)}`);
            fresh++;
        }
        byWord.set(w, n);
        return n;
    };
    const p2Word = (w) => (w & 0x8000) | [0, 1, 2].reduce((o, ch) => o | (P2_ROW((w >> (5 * ch)) & 31) << (5 * ch)), 0);
    const cbFor = (cb, p) => cbOfWord(p ? p2Word(fvWord(cb)) : fvWord(cb));
    const thOf = (th, p) => {
        const cb = cbFor((th[3] >> 6) & 0x3ff, p);
        let th2 = 0;
        if (th[0] & TEXTURED) {
            const s = byKey.get(tileKey(th));
            if (!s?.tile.at) throw new Error(`${Who}: tile ${tileKey(th)} not packed`);
            th2 = ((s.tile.at.x + s.dx) / 32) | (((s.tile.at.y + s.dy) / 32) << 6) | 0x1000;
        }
        return [th[0] & TH0_KEEP, th[1], th2, (th[3] & 0x3f) | (cb << 6)];
    };

    /* ---- his pieces: FV's polygons, at his size ---- */
    const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const at = (r, t, o) => [0, 1, 2].map((a) => t[a] + r[a] * o[0] + r[3 + a] * o[1] + r[6 + a] * o[2]);
    const placed = (e) => {
        const t = at(I, [0, 0, 0], e.offset);
        const r = turnedBy(I, e.turn[0], e.turn[1], e.turn[2]);
        return { r, t: e.then ? at(r, t, e.then) : t };
    };
    const moved = (q, { r, t }) => ({ ...q, p: q.p.map((v) => at(r, t, v)), normal: at(r, [0, 0, 0], q.normal) });
    const scaled = (q) => ({ ...q, p: q.p.map((v) => v.map((x) => x * k)) });
    const pieces = [];
    A.parts.forEach((pt, s) => {
        if (!s || pt.model <= 0) return;
        let polys = readObject(fv, pt.model);
        const pads = A.extras.filter((e) => e.slot === s);
        for (const e of pads) polys = polys.concat(readObject(fv, e.model).map((q) => moved(q, placed(e))));
        pieces.push({ slot: s, what: [pt.model, ...pads.map((e) => e.model)].join('+'), polys: polys.map(scaled) });
    });
    M.hands.forEach((l, h) => l.forEach((m, i) => {
        if (m !== A.parts[h ? 8 : 5].model && !pieces.some((q) => q.hand === m)) pieces.push({ hand: m, what: `hand ${m}`, polys: readObject(fv, m).map(scaled) });
    }));
    report.push(`${pieces.length} models (${A.extras.length} pads on the chest), ${pieces.reduce((n, q) => n + q.polys.length, 0)} polygons`);

    /* ---- meshes (one for both players), headers (each player's), texture points ---- */
    const poly0 = ctx.polyEnd, tex0 = ctx.texEnd ?? ((ctx.pack.at + 15) & ~15);
    let poly = poly0, tex = tex0;
    const need = pieces.length * 2 + 2;
    const ids = [];
    for (let id = R.modelCount - 1; ids.length < need; id--) {
        if (id <= 0) throw new Error(`${Who}: no free model ids`);
        if (!R.models.has(id) && !ctx.modelIds.has(id)) ids.push(id);
    }
    for (const id of ids) ctx.modelIds.add(id);
    const takeId = () => ids.shift();
    const putTex = (b, label) => {
        const a = tex;
        tex = (tex + b.length + 15) & ~15;
        if (tex > TEX_RUN_END) throw new Error(`${Who}: textures run too small`);
        textures.put(a, b, `${Who} ${label}`);
        return a;
    };
    const putPoly = (b, label) => {
        poly = (poly + 3) & ~3;
        if (poly + b.length > POLY_RUN_END) throw new Error(`${Who}: polygon run too small`);
        polygons.put(poly, b, `${Who} ${label}`);
        const a = poly;
        poly += b.length;
        return a;
    };
    const entry = (id, uvAt, matAt, meshAt, w3, label) => main.put(R.modelTable + id * 16, u32s([uvAt / 2, matAt / 2, 0x800000 | (meshAt >> 2), w3]), `${Who} ${label} as model ${id}`);
    for (const q of pieces) {
        const enc = encodeObject(q.polys);
        q.mesh = enc.mesh; q.count = enc.count;
        q.meshAt = putPoly(enc.mesh, `${q.what} mesh`);
        q.uvAt = putTex(u16s([...enc.uv]), `${q.what} texture points`);
        q.ids = [0, 1].map((p) => {
            const th = [];
            for (let i = 0; i < enc.th.length; i += 4) th.push(...thOf(enc.th.subarray(i, i + 4), p));
            const matAt = putTex(u16s(th), `${q.what} headers${p ? ' P2' : ''}`);
            const id = takeId();
            entry(id, q.uvAt, matAt, q.meshAt, (q.polys.length << 16) | (enc.count + 1), `${q.what}${p ? ' P2' : ''}`);
            if (!p) q.matAt = matAt;
            return id;
        });
    }
    /* The midriff: its links draw with 1503's streams as FV has them (the
     * board writes the links in polygon RAM itself: megamix.c midriff_build),
     * so those are copied, each header's tile and colorbase moved; its mesh
     * is never drawn, a copy at his size stands in. */
    const mid = (() => {
        const st = streamsOf(fv, M.midriff), e = st.e;
        const enc = encodeObject(readObject(fv, M.midriff).map(scaled));
        const meshAt = putPoly(enc.mesh, 'midriff mesh');
        const uv = Uint8Array.from(fv.textures.subarray(st.uv.from, st.uv.to));
        const uvAt = putTex(uv, 'midriff texture points') + (e.uvPtr * 2 - st.uv.from);
        const raw = fv.mainDataView.getUint32(fv.game.modelTable.offset + M.midriff * 16 + 12, true);
        return [0, 1].map((p) => {
            const mat = Uint8Array.from(fv.textures.subarray(st.mat.from, st.mat.to)), mv = new DataView(mat.buffer);
            for (const b of st.recs) {
                const o = b - st.mat.from, th = [0, 1, 2, 3].map((i) => mv.getUint16(o + i * 2, true));
                thOf(th, p).forEach((x, i) => mv.setUint16(o + i * 2, x, true));
            }
            const matAt = putTex(mat, `midriff headers${p ? ' P2' : ''}`) + (e.matPtr * 2 - st.mat.from);
            const id = takeId();
            entry(id, uvAt, matAt, meshAt, raw, `midriff${p ? ' P2' : ''}`);
            return id;
        });
    })();
    report.push(`models ${Math.min(...ctx.modelIds)}..; meshes ${hex(poly0)}..${hex(poly)}; headers and texture points ${hex(tex0)}..${hex(tex)}`);
    report.push(`colours: ${byWord.size} words as StF colorbases (${fresh} new)`);
    ctx.polyEnd = poly; ctx.texEnd = tex;

    /* each mesh read back as the board walks it */
    {
        const rom = Object.create(games.stf.rom);
        Object.defineProperty(rom, 'textures', { value: textures.out });
        for (const q of pieces) {
            const d = decodeModel(rom, -1, null, { bytes: q.mesh, uvPtr: q.uvAt / 2, matPtr: q.matAt / 2 });
            const textured = q.polys.filter((p) => p.th[0] & TEXTURED).length;
            if (!d || d.faceCount !== q.polys.length || d.texturedFaces !== textured)
                throw new Error(`${Who} ${q.what}: decoded ${d?.faceCount} faces (${d?.texturedFaces} textured) of ${q.polys.length} (${textured})`);
        }
        report.push(`${pieces.length} meshes decode as made`);
    }
    const partsOf = (p) => {
        const out = new Array(16).fill(0);
        for (const q of pieces) if (q.slot !== undefined) out[q.slot] = q.ids[p];
        return out;
    };
    const parts = partsOf(0), p2Parts = partsOf(1);
    const modelOf = (m, p) => (pieces.find((q) => q.hand === m) ?? pieces.find((q) => q.slot !== undefined && A.parts[q.slot].model === m)).ids[p];

    /* ---- skeleton and pose bones: FV's record +4 (VF2's layout) ---- */
    const sk = M.d32(A.root + SKELETON), r = M.res(sk);
    const bones = [];
    for (let e = 0; e < 15; e++) bones.push([0, 1, 2].map((a) => r.view.getFloat32(r.off + e * 12 + a * 4, true)));
    const skelBytes = new Uint8Array(SKELETON_BYTES), sv = new DataView(skelBytes.buffer);
    bones.forEach((p, e) => p.forEach((x, a) => sv.setFloat32(e * 12 + a * 4, x * k, true)));
    const rigBytes = Uint8Array.from(ctx.rigBytes), rv = new DataView(rigBytes.buffer);
    const put = (e, p) => p.forEach((x, a) => rv.setFloat32(e * 12 + a * 4, x * k, true));
    put(1, bones[1]);
    [2, 5, 9, 12].forEach((e) => { put(e, bones[e]); put(e + 1, [bones[e + 1][0], 0, 0]); put(e + 2, [bones[e + 2][0], 0, 0]); });
    const skel = alloc(skelBytes, 'skeleton');
    const rigAt = alloc(rigBytes, 'bones');

    /* ---- balls, moves, records and the guest tables ---- */
    const partBox = (s) => {
        const q = pieces.find((x) => x.slot === s);
        return q ? pointBox(q.polys.flatMap((p) => (p.quad ? p.p : p.p.slice(0, 3)))) : null;
    };
    const { ballRec, moved: ballsMoved } = fitBalls(ctx, vf2, partBox, k, alloc);
    report.push(`${ballsMoved} collision balls fitted to his parts`);
    const seamList = alloc(u32s([0]), 'seams');
    const shapes = {};
    const mv = importFvMoves(R, ctx, fv, A, {
        who: Who, k, thrown: [k, (THROWN[1] * k) / SCALE, k],
        handShape: (s) => { shapes[s] = (shapes[s] ?? 0) + 1; return s < SHAPES ? s : 0; },
    });
    report.push(...mv.report, `hand shapes his op 0x12 picks: ${JSON.stringify(shapes)}`);
    /* His jump block (record +0x20): FV's record +0x34 is StF's +0x20, read
     * the same way (F 0x134F0): the frames, the second on action bit 18 (46,
     * 24), then the reach a frame by jump kind (0.05, 0.05, 0.09, 0.09), at
     * his size. FV's gravity, at his size too, is lift-stf.py's. */
    const jumpAt = M.d32(A.root + JUMP), jump = new Uint8Array(0x14), jv = new DataView(jump.buffer);
    jump[0] = M.d8(jumpAt); jump[1] = M.d8(jumpAt + 1);
    for (let i = 4; i < 0x14; i += 4) jv.setFloat32(i, M.f32(jumpAt + i) * k, true);
    report.push(`jump: ${jump[0]}, ${jump[1]} frames, reach ${[4, 8, 12, 16].map((i) => jv.getFloat32(i, true).toFixed(3)).join(' ')}`);
    const chars = seatGuest(R, ctx, { chr: CHR_, parts, p2Parts, skel, rigAt, ballRec, seamList, game: R.guest.games.FV,
        jump: alloc(jump, 'jump', 4), moves: mv.moves, kinds: mv.kindsAt, remap: mv.remapAt, actions: mv.actionsAt }, alloc);
    /* his hands (FV's four shapes a hand, the first again past them) and midriff, by player */
    chars.forEach((c, p) => {
        const hands = M.hands.flatMap((l) => Array.from({ length: 16 }, (_, i) => modelOf(l[i < SHAPES ? i : 0], p)));
        T.player_hand_animations.view.setUint32(c * 4, alloc(u16s(hands), `hands${p ? ' P2' : ''}`), true);
        const at = M.midriffAt, n = M.d32(at + MIDRIFF.count);
        const bytes = (a, len) => { const x = M.res(a); return Uint8Array.from(x.data.subarray(x.off, x.off + len)); };
        const scaleFloats = (b, from, count) => { const v = new DataView(b.buffer); for (let i = 0; i < count; i++) v.setFloat32(from + i * 4, v.getFloat32(from + i * 4, true) * k, true); };
        const ring = bytes(at + MIDRIFF.ring, MIDRIFF.ringPoints * 12);
        scaleFloats(ring, 0, MIDRIFF.ringPoints * 3);
        const words = bytes(at + MIDRIFF.links, (MIDRIFF.link * n + 1) * 4);
        for (let j = 0; j < n; j++) scaleFloats(words, (MIDRIFF.link * j + 4) * 4, 6);
        const index = bytes(at + MIDRIFF.links + (MIDRIFF.link * n + 1) * 4, 2 * n);
        for (const x of index) if (x >= MIDRIFF.first + MIDRIFF.ringPoints) throw new Error(`${Who}: midriff: chest point ${x - MIDRIFF.first}`);
        const b = new Uint8Array(8 + ring.length + words.length + index.length);
        b.set(u32s([mid[p], n])); b.set(ring, 8); b.set(words, 8 + ring.length); b.set(index, 8 + ring.length + words.length);
        T.midriff.view.setUint32(c * 4, alloc(b, `midriff${p ? ' P2' : ''}`), true);
    });
    report.push(`heap to ${hex(ctx.heapEnd())}`);

    const coverage = {
        chars, game: 'Fighting Vipers', name: Who, models: pieces.length + 1, pads: A.extras.length,
        polygons: pieces.reduce((n, q) => n + q.polys.length, 0), colours: byWord.size, balls: ballsMoved,
        moves: mv.coverage,
    };
    return { report, coverage, pieces, parts, p2Parts, moves: mv };
}
