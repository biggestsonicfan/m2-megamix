/*
 * guest-shadows.mjs — the board's guests' own floor shadows (docs/SHADOWS.md,
 * "Putting a fighter's shadows on the board"): a shadow table each in
 * off_64988's room (import-assets' shadowTable), its models new ones after
 * the guests' others, all with StF's shadow cards' material.
 *
 *   - Akira (6), Hornet (17) and Mahler (18): a low solid a part, as StF's
 *     own tables have: the convex hull of each of his parts (Akira's VF2
 *     meshes ×SCALE; Hornet's pieces of Daytona's car, the wheels too;
 *     Mahler's, the chest with its pads, the hands), on its slot. VF2's and
 *     FV's own cards (two crossed quads a part) draw as broken strips on
 *     StF's op 0x74, and Daytona's card under the car, stood up into a
 *     prism a half, left most of the car without a shadow.
 *   - Ryo (1) and Chai (12): Shenmue's 13 SYD_MUNE hulls (MISC/COLD.BIN's
 *     MVSD, at 0x21B880 on disc 3), each on its bone's slot (js/shenmue/ryo.js
 *     SLOT_BONES), its open ends capped, Z mirrored to the board's, at each
 *     one's own size (importShenmue's `scale`).
 *
 * StF's shadow models are solids whose faces turned to the light draw (op
 * 0x74 flattens them). A convex hull covers its outline once with the faces
 * turned to the light and once with those turned away, so it goes in as it
 * is; every face of a SYD_MUNE hull (near convex, capped) goes in twice, once
 * each way round, so it covers its outline whichever way the board culls it.
 */
import { readFighters } from '../../vendor/noclip/js/vf2fighters.js';
import { readObject } from '../sources/daytona-hornet.mjs';
import { SCALE } from './vf2-guest.mjs';
import { SLOT_BONES } from '../../js/shenmue/ryo.js';

const ENTRIES = 16, ENTRY = 24, TAIL = 8;
const POLY_RUN_END = 0xec2578 + 0x13da88;
const TEX_RUN_END = 0x78bdb8 + 0x74248;
/* StF's shadow models' attribute bits above the header offset (models 26,
 * 405: lighting material 0x29, bit 23), and their card's material: the first
 * of model 26's (all of StF's shadow models have the same one) */
const ATTR_HI = 0x00a60000, Z_NEAR = 1 << 10;
const TRI = 2, QUAD = 1, LINK_NEW = 2 << 8;
const STF_CARD = 26;
/* a corner of the shadow tile each: B, A, C, then four of nothing */
const CARD_UV = [0, 0, 0, 0x1ff, 0x1ff, 0x1ff, 0, 0, 0, 0, 0, 0, 0, 0];
/* SYD_MUNE in MISC/COLD.BIN */
const MVSD_AT = 0x21b880, MVSD_MAGIC = 0x4d565344;   /* 'MVSD' */
/* the board's guests (import-assets: vf2-guest, ryo-guest, hornet-guest) */
const PLAYER2 = 26;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
const hex = (v) => '0x' + v.toString(16).toUpperCase();

/* A mesh of triangles, each a link of its own and a culled link after it
 * (ryo-guest.mjs encodeMesh), each triangle's normal the board's way: its
 * corners A, B, C wind about it (cross(B - A, C - A)). */
function encodeMesh(tris) {
    const T = tris.length;
    const b = new Uint8Array((2 * T + 1) * 40), v = new DataView(b.buffer);
    const pt = (o, p) => { for (let a = 0; a < 3; a++) v.setFloat32(o + a * 4, p[a], true); };
    tris.forEach((t, i) => {
        const o = i * 80;
        pt(o, t[0]); pt(o + 12, t[1]);
        v.setUint32(o + 24, (ATTR_HI | Z_NEAR | LINK_NEW | TRI) >>> 0, true);
        const n = unit(cross(sub(t[1], t[0]), sub(t[2], t[0])));
        pt(o + 28, n);
        pt(o + 40, t[2]); pt(o + 52, t[2]);
        v.setUint32(o + 64, (ATTR_HI | Z_NEAR | (1 << 12) | QUAD) >>> 0, true);
        pt(o + 68, n);
    });
    pt(T * 80, tris[T - 1][2]); pt(T * 80 + 12, tris[T - 1][2]);
    return b;
}

/* Each triangle both ways round; a degenerate one dropped. */
const bothWays = (tris) => tris.filter((t) => Math.hypot(...cross(sub(t[1], t[0]), sub(t[2], t[0]))) > 1e-9)
    .flatMap((t) => [t, [t[0], t[2], t[1]]]);

/* A polygon (its points in order) as a fan of triangles. */
const fan = (p) => p.slice(2).map((_, i) => [p[0], p[i + 1], p[i + 2]]);

/* The convex hull of points, as triangles wound outward (incremental: a
 * tetrahedron, then each point outside takes the faces it sees and closes
 * the hole from their horizon). */
export function convexHull(pts) {
    const P = [...new Map(pts.map((p) => [p.map((x) => x.toFixed(5)).join(), p])).values()];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const eps = 1e-7;
    /* a first tetrahedron: far apart along x, then off that line, then off that plane */
    let [i0, i1] = [0, 0];
    P.forEach((p, i) => { if (p[0] < P[i0][0]) i0 = i; if (p[0] > P[i1][0]) i1 = i; });
    const d01 = sub(P[i1], P[i0]);
    let i2 = -1, best = eps;
    P.forEach((p, i) => { const a = Math.hypot(...cross(d01, sub(p, P[i0]))); if (a > best) { best = a; i2 = i; } });
    if (i2 < 0) return [];
    const n012 = cross(d01, sub(P[i2], P[i0]));
    let i3 = -1; best = eps;
    P.forEach((p, i) => { const a = Math.abs(dot(n012, sub(p, P[i0]))); if (a > best) { best = a; i3 = i; } });
    if (i3 < 0) return [];
    const face = (a, b, c) => { const n = cross(sub(P[b], P[a]), sub(P[c], P[a])); return { v: [a, b, c], n, d: dot(n, P[a]) }; };
    let faces = dot(n012, sub(P[i3], P[i0])) > 0
        ? [face(i0, i2, i1), face(i0, i1, i3), face(i1, i2, i3), face(i2, i0, i3)]
        : [face(i0, i1, i2), face(i0, i3, i1), face(i1, i3, i2), face(i2, i3, i0)];
    P.forEach((p, i) => {
        if (i === i0 || i === i1 || i === i2 || i === i3) return;
        const seen = faces.filter((f) => dot(f.n, p) - f.d > eps * Math.hypot(...f.n));
        if (!seen.length) return;
        const edges = new Map();
        for (const f of seen) for (let c = 0; c < 3; c++) {
            const a = f.v[c], b = f.v[(c + 1) % 3];
            if (edges.has(`${b},${a}`)) edges.delete(`${b},${a}`); else edges.set(`${a},${b}`, [a, b]);
        }
        faces = faces.filter((f) => !seen.includes(f));
        for (const [a, b] of edges.values()) faces.push(face(a, b, i));
    });
    return faces.map((f) => f.v.map((j) => P[j]));
}

/* ---- Shenmue's SYD_MUNE --------------------------------------------------- */

/* The hulls: { bone, points, tris } each, in its bone's frame at Shenmue's
 * size, each open end (an edge on one face) closed by a fan. */
export function readHulls(cold) {
    const v = new DataView(cold.buffer, cold.byteOffset + MVSD_AT);
    if (v.getUint32(0, false) !== MVSD_MAGIC) throw new Error('COLD.BIN: no MVSD at 0x21B880');
    const hulls = [];
    const walk = (at) => {
        for (; at; at = v.getUint32(at + 8, true)) {
            const bone = v.getUint16(at, true), pa = v.getUint32(at + 12, true), fa = v.getUint32(at + 28, true);
            const np = v.getUint16(at + 32, true), nf = v.getUint16(at + 36, true);
            const points = Array.from({ length: np }, (_, i) => [0, 1, 2].map((a) => v.getFloat32(pa + i * 12 + a * 4, true)));
            const faces = Array.from({ length: nf }, (_, i) => [0, 1, 2].map((c) => v.getUint16(fa + i * 24 + 12 + c * 2, true)));
            /* the open ends: edges one face has, each kept its face's way */
            const count = new Map();
            for (const f of faces) for (let c = 0; c < 3; c++) {
                const key = [f[c], f[(c + 1) % 3]].sort((a, b) => a - b).join();
                count.set(key, (count.get(key) ?? 0) + 1);
            }
            const next = new Map();
            for (const f of faces) for (let c = 0; c < 3; c++) {
                const a = f[c], b = f[(c + 1) % 3];
                if (count.get([a, b].sort((x, y) => x - y).join()) === 1) next.set(b, a);   /* the hole runs the other way */
            }
            const caps = [];
            while (next.size) {
                const [start] = next.keys(), loop = [start];
                for (let p = next.get(start); p !== start; p = next.get(p)) {
                    if (p === undefined || loop.length > np) throw new Error(`SYD_MUNE bone ${hex(bone)}: an open end that does not close`);
                    loop.push(p);
                }
                for (const p of loop) next.delete(p);
                caps.push(loop);
            }
            const tris = [...faces, ...caps.flatMap(fan)].map((f) => f.map((i) => points[i]));
            hulls.push({ bone, points, tris, ends: caps.length });
            const child = v.getUint32(at + 4, true);
            if (child) walk(child);
        }
    };
    walk(12);
    return hulls;
}

/* ---- the models and tables ------------------------------------------------ */

/**
 * Every guest's shadow table and models. R: import-assets' regions (R.guest's
 * off_64988 has shadowTable); ctx: Akira's import's (its model ids, the end of
 * the polygons and textures it and the guests after him used); vf2, stf: the
 * ROM sets; cold: Shenmue's MISC/COLD.BIN, or null; guests: { akira: { chr },
 * shenmue: [{ name, chr, scale }], hornet: { chr, pieces }, mahler: { chr,
 * pieces } } (pieces: importHornet's and importMahler's, slot and polygons at
 * his size).
 */
export function importGuestShadows(R, ctx, { vf2, stf, cold }, guests) {
    const { main, polygons, textures } = R;
    const T = R.guest.tables.off_64988;
    const { u32s, u16s } = ctx;
    const report = [];
    /* StF's card material, from its model 26 */
    const tex = stf.texturesView, mt = stf.game.modelTable.offset;
    const card = [0, 1, 2, 3].map((i) => tex.getUint16(stf.mainDataView.getUint32(mt + STF_CARD * 16 + 4, true) * 2 + i * 2, true));
    let poly = ctx.polyEnd, texAt = ctx.texEnd;
    /* closed: a convex hull, whose faces turned to the light and those
     * turned away each cover its outline once, so it goes in one way round */
    const newModel = (tris, what, closed = false) => {
        const both = closed ? tris : bothWays(tris);
        let id = R.modelCount - 1;
        while (id > 0 && (R.models.has(id) || ctx.modelIds.has(id))) id--;
        if (id <= 0) throw new Error(`${what}: no free model ids`);
        ctx.modelIds.add(id);
        const mesh = encodeMesh(both);
        poly = (poly + 3) & ~3;
        if (poly + mesh.length > POLY_RUN_END) throw new Error(`${what}: polygon run too small`);
        polygons.put(poly, mesh, `${what} mesh`);
        const mat = u16s(both.flatMap(() => card)), uv = u16s(both.flatMap(() => CARD_UV));
        const matAt = texAt, uvAt = (matAt + mat.length + 15) & ~15;
        texAt = (uvAt + uv.length + 15) & ~15;
        if (texAt > TEX_RUN_END) throw new Error(`${what}: textures run too small`);
        textures.put(matAt, mat, `${what} materials`);
        textures.put(uvAt, uv, `${what} UVs`);
        main.put(R.modelTable + id * 16, u32s([uvAt / 2, matAt / 2, 0x800000 | (poly >> 2), (both.length << 16) | (2 * both.length + 1)]), `${what} as model ${id}`);
        poly += mesh.length;
        return id;
    };
    /* A table: { slot, model, flags, offset } entries (to sixteen with model
     * 0 on the slots left), an empty tail. */
    const table = (entries) => {
        const b = new Uint8Array(ENTRIES * ENTRY + TAIL), v = new DataView(b.buffer);
        const slots = new Set(entries.map((e) => e.slot));
        if (entries.length > ENTRIES) throw new Error(`a shadow table of ${entries.length} entries`);
        /* VF2's has two cards on some slots: the slots left, from 0, as far
         * as there is room */
        const left = [...Array(ENTRIES).keys()].filter((s) => !slots.has(s)).slice(0, ENTRIES - entries.length);
        const all = [...entries, ...left.map((slot) => ({ slot, model: 0, flags: 0, offset: [0, 0, 0] }))];
        all.forEach((e, i) => {
            const o = i * ENTRY;
            v.setUint32(o, e.slot, true); v.setUint32(o + 4, e.model, true); v.setUint32(o + 8, e.flags, true);
            e.offset.forEach((x, a) => v.setFloat32(o + 12 + a * 4, x, true));
        });
        return b;
    };
    const seat = (who, chr, entries) => {
        const at = T.shadowTable([chr, chr + PLAYER2], table(entries));
        const drawn = entries.filter((e) => e.model);
        report.push(`${who}: table ${hex(at)} for ${chr} and ${chr + PLAYER2}, ${drawn.length} parts, models ${drawn.map((e) => e.model).join(' ')}`);
    };

    /* A low solid a part, as StF's own tables have: the convex hull of each
     * part's farthest points along 26 directions (the cube's faces, edges and
     * corners), on its slot. pieces: { slot, polys } at the guest's size. */
    const dirs = [];
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) if (a || b || c) dirs.push([a, b, c]);
    const extremes = (pts) => dirs.map((d) => pts.reduce((m, p) => (p[0] * d[0] + p[1] * d[1] + p[2] * d[2] > m[0] * d[0] + m[1] * d[1] + m[2] * d[2] ? p : m)));
    const hullTable = (who, chr, pieces) => {
        const entries = pieces.filter((q) => q.slot).map((q) => {
            const tris = convexHull(extremes(q.polys.flatMap((x) => x.p)));
            return { slot: q.slot, model: newModel(tris, `${who} shadow ${q.slot}`, true), flags: 0, offset: [0, 0, 0], tris: tris.length };
        });
        seat(who, chr, entries);
        report.push(`${who}: hulls of ${entries.map((e) => `${e.slot}:${e.tris}`).join(' ')} triangles`);
    };
    /* Akira: his VF2 parts (×SCALE, as his meshes); VF2's own cards (0x61D64,
     * two crossed quads on some parts) draw as broken strips on op 0x74 */
    if (guests.akira) hullTable('Akira', guests.akira.chr, readFighters(vf2)[0].parts.map(({ model }, slot) => ({
        slot, polys: model > 0 ? readObject(vf2, model).map((q) => ({ p: q.p.map((v) => v.map((x) => x * SCALE)) })) : [],
    })).filter((q) => q.polys.length));
    /* Mahler: his parts (the chest with its pads, the hands) */
    if (guests.mahler) hullTable('Mahler', guests.mahler.chr, guests.mahler.pieces.filter((q) => q.slot !== undefined));

    /* Ryo and Chai: a hull a bone, Z mirrored, at the guest's size; the
     * models are each guest's (their sizes differ) */
    if (cold && guests.shenmue?.length) {
        const hulls = readHulls(cold);
        const tris = hulls.reduce((n, h) => n + h.tris.length, 0);
        report.push(`SYD_MUNE: ${hulls.length} hulls, ${tris} triangles with ${hulls.reduce((n, h) => n + h.ends, 0)} ends capped`);
        for (const g of guests.shenmue) {
            const entries = hulls.map((h) => {
                const slot = SLOT_BONES[h.bone];
                if (slot == null) throw new Error(`SYD_MUNE bone ${hex(h.bone)}: no slot`);
                const t = h.tris.map((f) => f.map((p) => [p[0] * g.scale, p[1] * g.scale, -p[2] * g.scale]));
                return { slot, model: newModel(t, `${g.name} shadow ${slot}`), flags: 0, offset: [0, 0, 0] };
            });
            seat(g.name, g.chr, entries);
        }
    } else if (guests.shenmue?.length) report.push('Shenmue: no COLD.BIN, Ryo and Chai keep their StF slots\' tables');

    /* Hornet: his pieces, Daytona's car as FM cuts it (the nose, the cabin,
     * the wheels); a hull's outline along the light is the piece's in any pose */
    if (guests.hornet) hullTable('Hornet', guests.hornet.chr, guests.hornet.pieces);

    report.push(`meshes ${hex(ctx.polyEnd)}..${hex(poly)}; materials and UVs ${hex(ctx.texEnd)}..${hex(texAt)}`);
    ctx.polyEnd = poly; ctx.texEnd = texAt;
    return { report };
}
