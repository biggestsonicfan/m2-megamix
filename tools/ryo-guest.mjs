/*
 * Ryo Hazuki (the Shenmue beta's, js/ryo.js) as a guest on the Sonic the
 * Fighters board, built on what tools/vf2-guest.mjs puts in for Akira. He
 * plays as StF character 1 (Tails, whom Megamix does not use; 27 is his
 * player 2) and runs StF's own fight code with Akira's moves, motions,
 * actions and reactions: his own are VF3-style Shenmue motions that the
 * board cannot play yet. What is his own:
 *   - his model (YKB_M), cut into StF parts: each node rides the slot its
 *     nearest anchored bone drives (js/ryo.js SLOT_BONES), its triangles as
 *     a Model 2 mesh of its own, one per slot, in the polygon ROM's empty run
 *     after Akira's;
 *   - his textures, as 4-bit tiles packed into the pages with Akira's
 *     (tools/pack-akira.mjs `extra`), with material and UV streams after his
 *     in the textures region;
 *   - his skeleton and the bones his pose is solved on, from his model's own
 *     bone lengths (js/ryo.js prepareModel);
 *   - his collision balls: Akira's set, each ball moved and sized from
 *     Akira's part to Ryo's (the hurt and hit spheres StF's code tests);
 *   - his hands (his own, the one shape) and his head.
 *
 * Colour. A textured face on this board takes one colour (its colorbase's
 * palette entry, whose three 5-bit fields pick each channel's colorxlat
 * row) and the texel gives only its brightness (MAME model2rd.ipp; m2-sdk
 * m2_obj.h). His textures are full colour, so each texel becomes its
 * brightness, and each face takes the colour of the texels it covers: the
 * ramp row, per channel, whose values at those texels' brightness come
 * nearest to the texels' colour as the screen shows it (the board's output
 * curve puts everything under 64 at black). Faces go through StF's luma ramp
 * (rows 0..27, lumabase 0) and are lit as Akira's are.
 */
import { decodeModel } from '../vendor/noclip/js/model.js';
import { readFighters } from '../vendor/noclip/js/vf2fighters.js';
import { buildColorxlat, buildLumaram } from '../vendor/noclip/js/colors.js';
import { restMatrices, mul4, invRigid } from '../js/shenmue.js';
import { SLOT_BONES, prepareModel, ryoFit } from '../js/ryo.js';
import { SCALE } from './vf2-guest.mjs';

export const CHR = 1;                    /* StF's Tails */
const PLAYER2 = 26;
const MAIN_DATA = 0x02000000;
/* The empty runs (tools/vf2-guest.mjs, tools/pack-akira.mjs): his after Akira's. */
const POLY_RUN_END = 0xec2578 + 0x13da88;
const TEX_RUN_END = 0x78bdb8 + 0x74248;
const LEVELS = 5;                        /* a raw page's levels, 0-4 */
/* A face's attribute word above its link bits: Akira's commonest (lighting
 * material 10, bit 24), z from the nearest corner (mode 1). */
const ATTR_HI = (10 << 18) | (2 << 23), Z_NEAR = 1 << 10;
const TRI = 2, QUAD = 1, LINK_NEW = 2 << 8;       /* link type 0: the face is culled */
const ROWS = 28;                         /* the luma ramp's rows, 0..27 */
/* The shin faces (bones 0x11, 0x16; index in the slot's faces) the board hid
 * while the face itself turned to the eye, in the poses where a bent rear leg
 * spiked, on either leg (cutParts, #1546; measured in docs/BOARD.md). */
const FLAT = new Map([[SLOT_BONES[0x11], new Set([0, 1, 2, 4, 6, 7, 9, 11, 13, 14, 15, 16, 20, 21, 30, 34, 35, 36, 40, 41, 42])],
    [SLOT_BONES[0x16], new Set([0, 6, 14, 17, 18, 20, 24, 25, 26, 27])]]);

const hex = (v) => '0x' + v.toString(16).toUpperCase();

/* ---- textures ------------------------------------------------------------- */

/* His textures as 4-bit tiles, levels 0-4: each texel's brightness, scaled
 * so the texture's brightest (99th percentile) is 15. A texture with holes
 * (alpha under half) keeps 15 for them (the transparent renderer's hole) and
 * scales the rest to 14. */
export function ryoTiles(games) {
    const S = games.shenmue, model = S.model;
    const used = new Set();
    for (const n of model.nodes) if (n.mesh) for (const s of n.mesh.strips) used.add(s.texture);
    const tiles = [], byTex = new Map();
    for (const t of [...used].sort((a, b) => a - b)) {
        const name = model.textures[t], tex = S.textures.get(name);
        if (!tex) throw new Error(`Ryo: no texture ${name}`);
        const { width: w, height: h, rgba } = tex;
        if (w < 32 || h < 32 || (w & (w - 1)) || (h & (h - 1))) throw new Error(`Ryo: texture ${name} is ${w}x${h}`);
        const n = w * h, lum = new Float32Array(n), hole = new Uint8Array(n);
        let holes = 0;
        for (let i = 0; i < n; i++) {
            lum[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
            if (rgba[i * 4 + 3] < 128) { hole[i] = 1; holes++; }
        }
        const sorted = [...lum].filter((_, i) => !hole[i]).sort((a, b) => a - b);
        const top = Math.max(1, sorted[Math.floor((sorted.length - 1) * 0.99)] ?? 1);
        const tmax = holes ? 14 : 15;
        const l0 = new Uint8Array(n);
        for (let i = 0; i < n; i++) l0[i] = hole[i] ? 15 : Math.min(tmax, Math.round((tmax * lum[i]) / top));
        const levels = [l0];
        for (let L = 1; L < LEVELS; L++) {
            const pw = w >> (L - 1), lw = w >> L, lh = h >> L, prev = levels[L - 1], o = new Uint8Array(lw * lh);
            for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
                const q = [prev[2 * y * pw + 2 * x], prev[2 * y * pw + 2 * x + 1], prev[(2 * y + 1) * pw + 2 * x], prev[(2 * y + 1) * pw + 2 * x + 1]];
                const solid = holes ? q.filter((v) => v !== 15) : q;
                o[y * lw + x] = solid.length * 2 < q.length || !solid.length ? 15 : Math.round(solid.reduce((a, b) => a + b, 0) / solid.length);
            }
            levels.push(o);
        }
        const tile = { name, w, h, levels, holes: holes > 0, rgba };
        tiles.push(tile);
        byTex.set(t, tile);
    }
    return { tiles, byTex };
}

/* ---- his parts -------------------------------------------------------------- */

const apply = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
const turn = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/* His triangles, by slot, in each slot's frame as a mesh stores it (z the
 * other way from the model's), `k` his size: each a corner's point, the
 * face's outward normal, the corners' UVs and its texture. A strip's point
 * on its parent node (a negative index) is placed by the two nodes' rest
 * matrices. Where the parent rides another slot, the strip spans a joint
 * (a shoulder, an elbow, a wrist, the neck, a hip, a knee): its triangles
 * go to that joint's seam (`seams`, by `S,O`, S the node's slot and O the
 * parent's) and not to the rigid part, and each corner on the parent keeps
 * its point in O's frame too (`o`), which the board carries into S's frame
 * every frame (megamix.c seams_build). */
function cutParts(model, k) {
    const rest = restMatrices(model), nodes = model.nodes;
    const anchor = [];
    for (const n of nodes) {
        if (n.bone in SLOT_BONES) anchor[n.index] = n.index;
        else if (n.parent >= 0 && anchor[n.parent] != null) anchor[n.index] = anchor[n.parent];
    }
    const slotOf = (i) => (anchor[i] == null ? null : SLOT_BONES[nodes[anchor[i]].bone]);
    const slots = new Map(), seams = new Map();
    let dropped = 0;
    for (const n of nodes) {
        if (!n.mesh || anchor[n.index] == null) continue;
        const slot = slotOf(n.index);
        const into = invRigid(rest[anchor[n.index]]);
        const own = mul4(into, rest[n.index]);
        const parent = n.parent >= 0 ? nodes[n.parent] : null;
        const up = parent ? mul4(into, rest[parent.index]) : null;
        const other = parent && slotOf(parent.index) != null && slotOf(parent.index) !== slot ? slotOf(parent.index) : null;
        const upO = other != null ? mul4(invRigid(rest[anchor[parent.index]]), rest[parent.index]) : null;
        const corner = (p) => {
            const [mesh, m, i] = p.vertex >= 0 ? [n.mesh, own, p.vertex] : [parent.mesh, up, parent.mesh.count + p.vertex];
            const at = [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]];
            const v = apply(m, at);
            const o = p.vertex < 0 && upO ? apply(upO, at).map((x) => x * k) : null;
            return { p: [v[0] * k, v[1] * k, v[2] * k], n: turn(m, [mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]]), uv: [p.u, p.v], o };
        };
        for (const strip of n.mesh.strips) {
            const c = strip.points.map(corner);
            for (let j = 2; j < c.length; j++) {
                let [a, b, d] = (j & 1) ^ strip.flip ? [c[j - 1], c[j - 2], c[j]] : [c[j - 2], c[j - 1], c[j]];
                const face = cross(sub(b.p, a.p), sub(d.p, a.p));
                if (Math.hypot(...face) < 1e-9) { dropped++; continue; }
                const out = unit([a.n[0] + b.n[0] + d.n[0], a.n[1] + b.n[1] + d.n[1], a.n[2] + b.n[2] + d.n[2]]);
                /* Akira's faces wind A, B, C about their outward side */
                if (dot(face, out) < 0) [a, b] = [b, a];
                /* A face is stored with its corners' normals, averaged. The
                 * board culls a face whose stored normal turns from the eye
                 * (MAME model2_v.cpp, normal · corner C), so one that leans
                 * far from the face is culled while the face still turns to
                 * the eye. Down the shins the hem's corners share the cuff's
                 * normals and lean up to 52°: a bent rear leg seen from the
                 * front lost faces in sight. The shin faces in FLAT, the ones
                 * measured hidden there, keep their own flat normal (#1546); a
                 * seam's normals the board works out itself. */
                const flat = !(a.o || b.o || d.o) && FLAT.get(slot)?.has(slots.get(slot)?.length ?? 0);
                const stored = flat ? unit(dot(face, out) < 0 ? face.map((x) => -x) : face) : out;
                /* a seam's far corners first (A, or A and B), turning the
                 * corners round, so each is one run of words to patch */
                const fars = [a, b, d].map((q) => !!q.o);
                if (fars.some(Boolean)) {
                    const n = fars.filter(Boolean).length, c3 = [a, b, d];
                    const r = n === 1 ? fars.indexOf(true) : (fars.indexOf(false) + 1) % 3;
                    [a, b, d] = [c3[r], c3[(r + 1) % 3], c3[(r + 2) % 3]];
                }
                /* stored: z the other way; the normal inward, as the ROM's are */
                const st = (q) => [q[0], q[1], -q[2]];
                const tri = { pts: [st(a.p), st(b.p), st(d.p)], nrm: [-stored[0], -stored[1], stored[2]], uv: [a.uv, b.uv, d.uv], texture: strip.texture };
                const key = a.o || b.o || d.o ? `${slot},${other}` : null;
                if (key) tri.far = [a.o, b.o, d.o].map((q) => q && st(q));
                const into = key ? seams : slots;
                const list = into.get(key ?? slot) ?? [];
                into.set(key ?? slot, list);
                list.push(tri);
            }
        }
    }
    return { slots, seams, dropped };
}

/* A slot's triangles as a Model 2 mesh: each triangle a link of its own
 * (points A, B; attribute a triangle, link type 2) and a culled link after
 * it (points C, C; a quad, link type 0, the material step to the next
 * triangle's record), the end a zero attribute. The UV stream has a pair per
 * corner of every face the walk reads, the culled ones too: B, A, C, then
 * four of nothing (noclip model.js TRI_SLOT). */
function encodeMesh(tris) {
    const T = tris.length;
    const b = new Uint8Array((2 * T + 1) * 40), v = new DataView(b.buffer);
    const pt = (o, p) => { v.setFloat32(o, p[0], true); v.setFloat32(o + 4, p[1], true); v.setFloat32(o + 8, p[2], true); };
    tris.forEach((t, i) => {
        const o = i * 80;
        pt(o, t.pts[0]); pt(o + 12, t.pts[1]);
        v.setUint32(o + 24, (ATTR_HI | Z_NEAR | LINK_NEW | TRI) >>> 0, true);
        pt(o + 28, t.nrm);
        pt(o + 40, t.pts[2]); pt(o + 52, t.pts[2]);
        v.setUint32(o + 64, (ATTR_HI | Z_NEAR | (1 << 12) | QUAD) >>> 0, true);
        pt(o + 68, t.nrm);
    });
    pt(T * 80, T ? tris[T - 1].pts[2] : [0, 0, 0]); pt(T * 80 + 12, T ? tris[T - 1].pts[2] : [0, 0, 0]);
    return b;
}

/* ---- the guest ------------------------------------------------------------- */

/* R: import-assets' regions; ctx: what importAkira built (its heap, tables
 * and Akira's records); games: tests/node-roms.mjs loadNodeGames(); tiles:
 * ryoTiles(games), after importAkira packed them (each tile's `at`). */
export function importRyo(R, ctx, games, { tiles, byTex }) {
    const { main, polygons, textures } = R;
    const T = R.guest.tables;
    const vf2 = games.vf2.rom, stf = games.stf.rom;
    const model = games.shenmue.model;
    const report = [];
    const alloc = (b, label, align = 4) => ctx.alloc(b, label, align, 'Ryo');
    const { u32s, u16s } = ctx;
    const fit = ryoFit(games);
    const k = fit.scale * SCALE;
    report.push(`size x${k.toFixed(4)} (${fit.scale.toFixed(4)} of Akira's VF2 scale, x${SCALE.toFixed(4)})`);

    /* ---- his parts ---- */
    const { slots, seams, dropped } = cutParts(model, k);
    const order = [...slots.keys()].sort((a, b) => a - b);
    /* every mesh: the parts, then the seams (each drawn on its slot S) */
    const pieces = [...order.map((slot) => ({ slot, tris: slots.get(slot) })),
        ...[...seams].map(([key, tris]) => { const [S, O] = key.split(',').map(Number); return { slot: S, other: O, tris }; })];
    const seamTris = [...seams.values()].reduce((n, t) => n + t.length, 0);
    report.push(`${order.length} parts, ${pieces.reduce((n, q) => n + q.tris.length, 0)} triangles, ${seamTris} of them in ${seams.size} seams${dropped ? ` (${dropped} degenerate dropped)` : ''}`);

    /* ---- colour: a ramp row a channel for each face ---- */
    const cx = buildColorxlat(stf);
    const cxv = new DataView(cx.buffer, cx.byteOffset, cx.byteLength);
    const ramp = (ch, row, luma) => Math.min(255, cxv.getUint16(ch * 0x4000 + row * 0x200 + luma * 2, true));
    const lram = buildLumaram(stf);
    const lumaOf = (t) => lram[t * 8 * 2];                  /* lumabase 0, texel t, full light */
    /* What the screen shows of a ramp value: the board's output curve, black
     * up to 64 (MAME model2_v.cpp m_gamma_table, the monitor's bias 64 and
     * gain 255/191). The fit is made on what is shown, so a channel the
     * texture keeps dim does not drop into the black below 64. */
    const shown = (x) => Math.max(0, ((x - 64) * 255) / 191);
    /* The texels under a face: a grid of 15 points across its UV triangle. */
    const BARY = [];
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4 - i; j++) BARY.push([i / 4, j / 4, (4 - i - j) / 4]);
    const texel = (tile, u, v) => {
        const x = Math.min(tile.w - 1, Math.max(0, Math.floor(u * tile.w))), y = Math.min(tile.h - 1, Math.max(0, Math.floor(v * tile.h)));
        return y * tile.w + x;
    };
    const rowsOf = (t) => {
        const tile = byTex.get(t.texture);
        const s = [];
        for (const [a, b, c] of BARY) {
            const u = a * t.uv[0][0] + b * t.uv[1][0] + c * t.uv[2][0], v = a * t.uv[0][1] + b * t.uv[1][1] + c * t.uv[2][1];
            const i = texel(tile, u, v), n = tile.levels[0][i];
            if (tile.holes && n === 15) continue;
            s.push({ luma: lumaOf(n), rgb: [tile.rgba[i * 4], tile.rgba[i * 4 + 1], tile.rgba[i * 4 + 2]] });
        }
        if (!s.length) return [16, 16, 16];
        /* A dark texel can want more of a channel than the top row gives.
         * The jeans' green and blue both stop at row 27 and come out equal:
         * the blue turns cyan. A face whose fitted hue is that far (8°) from
         * its texels' is fitted dimmer, step by step, until it keeps its hue
         * (#1540). The jacket's red, short alone, keeps its hue and stays. */
        const fit = (k) => [0, 1, 2].map((ch) => {
            let best = 0, err = Infinity;
            for (let r = 0; r < ROWS; r++) {
                let e = 0;
                for (const q of s) { const d = shown(ramp(ch, r, q.luma)) - k * q.rgb[ch]; e += d * d; }
                if (e < err) { err = e; best = r; }
            }
            return best;
        });
        const hue = ([r, g, b]) => {
            const M = Math.max(r, g, b), d = M - Math.min(r, g, b);
            if (d < 0.2 * M || d < 1) return null;      /* grey: no hue to keep */
            const h = M === r ? (g - b) / d : M === g ? 2 + (b - r) / d : 4 + (r - g) / d;
            return ((h * 60) + 360) % 360;
        };
        const want = hue([0, 1, 2].map((ch) => s.reduce((a, q) => a + q.rgb[ch], 0)));
        const short = (rows) => {
            const got = hue(rows.map((r, ch) => s.reduce((a, q) => a + shown(ramp(ch, r, q.luma)), 0)));
            return want !== null && got !== null && Math.abs(((got - want + 540) % 360) - 180) > 8;
        };
        let k = 1, rows = fit(k);
        while (k > 0.5 && short(rows)) rows = fit(k -= 0.05);
        return rows;
    };
    const faces = pieces.flatMap((q) => q.tris);
    for (const t of faces) t.rows = rowsOf(t);
    /* Palette entries: StF's own where one has the colour, else a free one
     * (no model the board keeps names it, nor Akira's), from the top down.
     * With too few free, the rows are put on a coarser grid until they fit. */
    const palSrc = (cb) => main.src[0x100000 + cb * 2] | (main.src[0x100000 + cb * 2 + 1] << 8);
    const existing = new Map();
    for (let cb = 1; cb < 0x400; cb++) if (!existing.has(palSrc(cb) & 0x7fff)) existing.set(palSrc(cb) & 0x7fff, cb);
    const free = [];
    for (let n = 0x3ff; n >= 32; n--) if (!R.colorbases.has(n) && !ctx.freeTaken.has(n)) free.push(n);
    const word = (r) => r[0] | (r[1] << 5) | (r[2] << 10);
    let grid = 1, need;
    for (;;) {
        const snap = (r) => r.map((x) => Math.min(ROWS - 1, Math.round(x / grid) * grid));
        const words = new Set(faces.map((t) => word(snap(t.rows))));
        need = [...words].filter((w) => !existing.has(w));
        if (need.length <= free.length) { for (const t of faces) t.rows = snap(t.rows); break; }
        grid++;
    }
    const cbOf = new Map();
    for (const w of new Set(faces.map((t) => word(t.rows)))) {
        if (existing.has(w)) { cbOf.set(w, existing.get(w)); continue; }
        const n = free.shift();
        ctx.freeTaken.add(n);
        main.put(0x100000 + n * 2, Uint8Array.of(w & 0xff, (w >> 8) | 0x80), `Ryo colorbase ${n}`);
        cbOf.set(w, n);
    }
    report.push(`${cbOf.size} colours (${need.length} new colorbases${grid > 1 ? `, rows on a grid of ${grid}` : ''})`);

    /* ---- meshes, materials and UVs; the model table ---- */
    let poly = ctx.polyEnd, tex = (ctx.pack.at + 15) & ~15;
    const ids = [];
    for (let id = R.modelCount - 1; ids.length < pieces.length; id--) {
        if (id <= 0) throw new Error('Ryo: no free model ids');
        if (!R.models.has(id) && !ctx.modelIds.has(id)) ids.push(id);
    }
    const partModel = new Map();
    const thOf = (t) => {
        const tile = byTex.get(t.texture);
        const th0 = 0x4000 | (tile.holes ? 0x2000 : 0) | Math.log2(tile.w / 32) | (Math.log2(tile.h / 32) << 3);
        const th2 = (tile.at.x / 32) | ((tile.at.y / 32) << 6) | 0x1000;
        return [th0, 0, th2, cbOf.get(word(t.rows)) << 6];
    };
    const uvWords = (t) => {
        const tile = byTex.get(t.texture);
        const pair = (q) => [Math.min(tile.h * 8 - 1, Math.max(0, Math.round(q[1] * tile.h * 8))), Math.min(tile.w * 8 - 1, Math.max(0, Math.round(q[0] * tile.w * 8)))];
        return [...pair(t.uv[1]), ...pair(t.uv[0]), ...pair(t.uv[2]), 0, 0, 0, 0, 0, 0, 0, 0];
    };
    const meshes = [];
    pieces.forEach((piece, i) => {
        const { slot, tris } = piece;
        const what = piece.other == null ? `part ${slot}` : `seam ${slot}-${piece.other}`;
        const mesh = encodeMesh(tris);
        piece.id = ids[i]; piece.mesh = mesh;
        poly = (poly + 3) & ~3;
        if (poly + mesh.length > POLY_RUN_END) throw new Error('Ryo: polygon run too small');
        polygons.put(poly, mesh, `Ryo ${what} mesh`);
        const mat = u16s(tris.flatMap(thOf)), uv = u16s(tris.flatMap(uvWords));
        const matAt = tex, uvAt = (matAt + mat.length + 15) & ~15;
        tex = (uvAt + uv.length + 15) & ~15;
        if (tex > TEX_RUN_END) throw new Error('Ryo: textures run too small');
        textures.put(matAt, mat, `Ryo ${what} materials`);
        textures.put(uvAt, uv, `Ryo ${what} UVs`);
        main.put(R.modelTable + ids[i] * 16, u32s([uvAt / 2, matAt / 2, 0x800000 | (poly >> 2), (tris.length << 16) | (2 * tris.length + 1)]), `Ryo ${what} as model ${ids[i]}`);
        if (piece.other == null) partModel.set(slot, ids[i]);
        meshes.push({ slot: what, id: ids[i], tris, mesh, matAt, uvAt });
        poly += mesh.length;
    });
    report.push(`models ${ids[ids.length - 1]}..${ids[0]}; meshes ${hex(ctx.polyEnd)}..${hex(poly)}; materials and UVs ${hex((ctx.pack.at + 15) & ~15)}..${hex(tex)}`);

    /* Each mesh read back the way the board's geometrizer walks it (noclip
     * decodeModel, over the textures region as the board has it): a face for
     * each triangle, textured, with its corners, its tile and its UVs. */
    {
        const rom = Object.create(stf);
        Object.defineProperty(rom, 'textures', { value: textures.out });
        const close = (a, b, e) => Math.abs(a - b) <= e;
        for (const m of meshes) {
            const d = decodeModel(rom, -1, null, { bytes: m.mesh, uvPtr: m.uvAt / 2, matPtr: m.matAt / 2 });
            const T = m.tris.length;
            if (!d || d.faceCount !== T || d.texturedFaces !== T || d.positions.length !== T * 9)
                throw new Error(`Ryo part ${m.slot}: decoded ${d?.faceCount} faces (${d?.texturedFaces} textured, ${d?.positions.length / 9} triangles) of ${T}`);
            m.tris.forEach((t, i) => {
                const tile = byTex.get(t.texture);
                const got = d.positions.subarray(i * 9, i * 9 + 9);
                const want = new Set(t.pts.map((p) => p.map((x) => x.toFixed(3)).join()));
                for (let c = 0; c < 3; c++) {
                    const g = [got[c * 3], got[c * 3 + 1], got[c * 3 + 2]];
                    if (!want.has(g.map((x) => x.toFixed(3)).join()) && !want.has([g[0], g[1], -g[2]].map((x) => x.toFixed(3)).join()))
                        throw new Error(`Ryo part ${m.slot} face ${i}: corner ${g} is none of ${[...want].join(' / ')}`);
                }
                /* sheet 1 is y + 1024 on noclip's texture sheet */
                const tl = d.tiles.subarray(i * 12, i * 12 + 4);
                if (tl[0] !== tile.at.x || tl[1] !== tile.at.y + 1024 || tl[2] !== tile.w || tl[3] !== tile.h)
                    throw new Error(`Ryo part ${m.slot} face ${i}: tile ${[...tl]} for ${tile.at.x},${tile.at.y} ${tile.w}x${tile.h}`);
                t.uv.forEach(([u, v], c) => {
                    const gu = d.uvs[i * 6 + c * 2], gv = d.uvs[i * 6 + c * 2 + 1];
                    if (!close(gu, Math.min(tile.w - 1 / 8, Math.max(0, u * tile.w)), 0.1) || !close(gv, Math.min(tile.h - 1 / 8, Math.max(0, v * tile.h)), 0.1))
                        throw new Error(`Ryo part ${m.slot} face ${i}: UV ${gu},${gv} for ${u},${v}`);
                });
            });
        }
        report.push(`${meshes.length} meshes decode as made`);
    }

    /* ---- skeleton and pose bones: Akira's, with his bone lengths ---- */
    const { rig } = prepareModel(model);
    const withRig = (src) => {
        const b = Uint8Array.from(src), v = new DataView(b.buffer);
        const put = (e, p) => p.forEach((x, a) => v.setFloat32(e * 12 + a * 4, x * k, true));
        put(1, rig.spine);
        [2, 5, 9, 12].forEach((e, i) => { put(e, rig.pivot[i]); put(e + 1, [rig.upper[i], 0, 0]); put(e + 2, [rig.lower[i], 0, 0]); });
        return b;
    };
    const skel = alloc(withRig(ctx.bones), 'skeleton');
    const rigAt = alloc(withRig(ctx.rigBytes), 'bones');

    /* ---- collision balls: Akira's, moved from his parts to Ryo's ---- */
    const A = readFighters(vf2)[0];
    const box = (pts) => {
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const p of pts) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
        return { lo, hi };
    };
    const akiraBox = (s) => {
        const m = A.parts[s]?.model;
        const d = m > 0 ? decodeModel(vf2, m) : null;
        if (!d) return null;
        const pts = [];
        for (let i = 0; i < d.positions.length; i += 3) pts.push([d.positions[i] * SCALE, d.positions[i + 1] * SCALE, -d.positions[i + 2] * SCALE]);
        return box(pts);
    };
    const ryoBox = (s) => (slots.has(s) ? box(pieces.filter((q) => q.slot === s).flatMap((q) => q.tris.flatMap((t) => t.pts))) : null);
    const pts = Uint8Array.from(ctx.balls.pts), pv = new DataView(pts.buffer);
    const moved = [];
    for (let i = 0; i < 32; i++) {
        const r = pv.getFloat32(i * 16 + 12, true);
        if (!r) continue;
        const s = ctx.balls.part[i], a = akiraBox(s), b = ryoBox(s);
        const c = [0, 1, 2].map((ax) => pv.getFloat32(i * 16 + ax * 4, true));
        let ratio = [k / SCALE, k / SCALE, k / SCALE], out;
        if (a && b) {
            ratio = [0, 1, 2].map((ax) => {
                const ea = a.hi[ax] - a.lo[ax], er = b.hi[ax] - b.lo[ax];
                return ea > 1e-3 && er > 1e-3 ? Math.min(2, Math.max(0.5, er / ea)) : k / SCALE;
            });
            out = c.map((x, ax) => {
                const ea = a.hi[ax] - a.lo[ax];
                return ea > 1e-3 ? b.lo[ax] + ((x - a.lo[ax]) * (b.hi[ax] - b.lo[ax])) / ea : x * ratio[ax];
            });
        } else out = c.map((x, ax) => x * ratio[ax]);
        const rr = r * Math.min(1.6, Math.max(0.6, Math.cbrt(ratio[0] * ratio[1] * ratio[2])));
        out.forEach((x, ax) => pv.setFloat32(i * 16 + ax * 4, x, true));
        pv.setFloat32(i * 16 + 12, rr, true);
        moved.push(`${i}@${s}`);
    }
    const ballRec = alloc(u32s([
        alloc(pts, 'balls', 16), alloc(u32s(ctx.balls.part), 'ball parts', 16),
        alloc(ctx.balls.lists, 'part balls', 16), alloc(ctx.balls.counts, 'part ball counts', 16),
    ]), 'ball record', 16);
    report.push(`${moved.length} collision balls fitted to his parts`);

    /* ---- seams: the board's guest table `seams` ----
     * By character, a list: +0 the count m, then m pointers, each to a seam:
     * +0 its model, +4 S | O << 8 (the slot it is drawn on, the slot its far
     * corners ride), +8 the mesh's word count W, +12 the far points' count P,
     * +16 the runs' count N, +20 the P points (3 floats, in O's frame as a
     * mesh stores it), then N runs (the first word | the count << 16: the
     * words that hold far points), then the mesh's W words (encodeMesh, its
     * far corners where they are at rest), then W bytes: 0 for a word as it
     * is, else 1 + 3 point + axis, the coordinate megamix.c's seams_build
     * puts there (carried into S's frame). The board sends a seam's mesh to
     * polygon RAM once, and after that only its runs, each frame. */
    const seamAts = [];
    let runWords = 0, meshWords = 0;
    for (const q of pieces.filter((q) => q.other != null)) {
        const pts = [], at = new Map();
        const W = q.mesh.length / 4, patch = new Uint8Array(W);
        const far = (tri, c, word) => {
            const f = tri.far[c];
            if (!f) return;
            const key = f.join();
            if (!at.has(key)) { at.set(key, pts.length); pts.push(f); }
            for (let a = 0; a < 3; a++) patch[word + a] = 1 + 3 * at.get(key) + a;
        };
        /* encodeMesh's words: per triangle A 0, B 3, C 10 and 13; the end, C twice */
        q.tris.forEach((t, i) => { far(t, 0, i * 20); far(t, 1, i * 20 + 3); far(t, 2, i * 20 + 10); far(t, 2, i * 20 + 13); });
        const T = q.tris.length;
        far(q.tris[T - 1], 2, T * 20); far(q.tris[T - 1], 2, T * 20 + 3);
        if (pts.length * 3 + 1 > 255) throw new Error(`Ryo seam ${q.slot}-${q.other}: ${pts.length} far points`);
        const runs = [];
        for (let i = 0; i < W; i++) if (patch[i]) { if (i && patch[i - 1]) runs[runs.length - 1] += 1 << 16; else runs.push(i | (1 << 16)); }
        runWords += runs.reduce((n, r) => n + 3 + (r >>> 16), 0); meshWords += W;
        const head = new Uint8Array(20 + pts.length * 12 + runs.length * 4), hv = new DataView(head.buffer);
        [q.id, q.slot | (q.other << 8), W, pts.length, runs.length].forEach((x, a) => hv.setUint32(a * 4, x, true));
        pts.forEach((p, i) => p.forEach((x, a) => hv.setFloat32(20 + i * 12 + a * 4, x, true)));
        runs.forEach((r, i) => hv.setUint32(20 + pts.length * 12 + i * 4, r, true));
        const b = new Uint8Array((head.length + q.mesh.length + W + 3) & ~3);
        b.set(head); b.set(q.mesh, head.length); b.set(patch, head.length + q.mesh.length);
        seamAts.push(alloc(b, `seam ${q.slot}-${q.other}`));
    }
    const seamList = alloc(u32s([seamAts.length, ...seamAts]), 'seams');
    report.push(`${seamAts.length} seams, at ${seams.size ? [...seams.keys()].join(' ') : 'none'}: ${meshWords} words of mesh, then ${runWords} a frame`);

    /* ---- records: Akira's, with his parts and skeleton ---- */
    const parts = new Array(16).fill(0);
    for (const [s, id] of partModel) parts[s] = id;
    const list = alloc(u32s([...parts, ...parts]), 'parts');
    ctx.recs.forEach((src, p) => {
        const rec = Uint8Array.from(src), rv = new DataView(rec.buffer);
        rv.setUint32(0, list, true); rv.setUint32(4, skel, true); rv.setUint32(8, list, true);
        T.CHAR_PARTS.view.setUint32((CHR + p * PLAYER2) * 4, alloc(rec, `record ${p ? 'P2' : 'P1'}`), true);
    });

    /* ---- the guest tables ---- */
    T.MOVESET_ARRAY.view.setUint32(CHR * 4, ctx.newRoot, true);
    T.ptr_DA0B4.view.setUint32(CHR * 4, ctx.kindsAt, true);
    T.motion_remap.view.setUint32(CHR * 4, ctx.ownAt, true);
    const chars = [CHR, CHR + PLAYER2];
    {
        const t = T.SKELETON_TYPE_DATA;
        for (let kind = 0; kind < 4; kind++) for (const c of chars) t.view.setUint32(t.lists + kind * t.perKind + c * 4, skel, true);
    }
    {
        const t = T.off_C2058;
        for (let kind = 0; kind < 4; kind++) for (const c of chars) t.view.setUint32(t.lists + kind * 52 * 4 + c * 4, rigAt, true);
    }
    {
        const t = T.rob_coli_ball_types;
        const at = (kind) => t.view.getUint32(kind * 4, true) - t.at;
        for (const l of [at(0), at(1), at(3), at(3) + 52 * 4]) for (const c of chars) t.view.setUint32(l + c * 4, ballRec, true);
    }
    const hands = [...new Array(16).fill(parts[5]), ...new Array(16).fill(parts[8])];
    const handsAt = alloc(u16s(hands), 'hands');
    const head = alloc(u16s([0, 0, parts[2], parts[2], 0, 0, 0, 0, 0, 0, 0, 0]), 'head');
    const H = T.PLAYER_HEAD_LIST;
    for (const c of chars) {
        T.player_hand_animations.view.setUint32(c * 4, handsAt, true);
        T.player_foot_animation.view.setUint32(c * 4, 0, true);
        T.player_body_animation.view.setUint32(c * 4, 0, true);
        T.midriff.view.setUint32(c * 4, 0, true);
        T.seams.view.setUint32(c * 4, seamList, true);
        for (let kind = 0; kind < H.len / 4; kind++) H.view.setUint32(H.lists + kind * H.perKind + c * 4, head, true);
        T.char_game.bytes[c] = R.guest.games.VF2;
    }
    report.push(`heap to ${hex(ctx.heapEnd())}`);

    const coverage = {
        chars, game: 'Shenmue', name: 'Ryo', parts: order.length,
        triangles: faces.length, colours: cbOf.size, balls: moved.length,
        moves: 'Akira\'s (his own motions are not on the board yet)',
    };
    return { report, coverage, meshes, partModel };
}
