/*
 * guest-shadows.mjs — the board's guests' own floor shadows (docs/SHADOWS.md,
 * "Putting a fighter's shadows on the board"): a shadow table each in
 * off_64988's room (import-assets' shadowTable), its models new ones after
 * the guests' others, all with StF's shadow cards' material.
 *
 *   - Akira (character 6): VF2's own table (0x61D64) as StF's
 *     (shadow-data.mjs guestTable), VF2's cards ×SCALE, his offsets too.
 *   - Ryo (1) and Chai (12): Shenmue's 13 SYD_MUNE hulls (MISC/COLD.BIN's
 *     MVSD, at 0x21B880 on disc 3), each on its bone's slot (js/ryo.js
 *     SLOT_BONES), its open ends capped, Z mirrored to the board's, at each
 *     one's own size (importShenmue's `scale`).
 *   - Hornet (17): Daytona's model 791, the card under the player's car, cut
 *     at the body's cut (CUT_Z) into a nose half on slot 1 and a cabin half
 *     on slot 9, each stood up into a prism, in those slots' frames as
 *     hornetObjects puts the body.
 *
 * Every face goes in twice, once each way round: StF's shadow models are
 * solids whose faces turned to the light draw (op 0x74 flattens them), and
 * a card or a hull drawn both ways covers its outline whichever way the
 * board culls it.
 */
import { readShadows } from '../vendor/noclip/js/fightershadow.js';
import { guestTable } from './shadow-data.mjs';
import { readObject, mapPolys, bodyMap, CUT_Z } from './daytona-hornet.mjs';
import { MODEL_UNITS } from './fm-saturn.mjs';
import { SCALE } from './vf2-guest.mjs';
import { SLOT_BONES } from '../js/ryo.js';

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
/* Hornet's shadow prisms' heights over card 791 (y = 0, the floor): the cowl
 * (daytona-hornet COWL_Y) and the roof (Daytona's body is 1.16 m high) */
const NOSE_H = 0.70, ROOF_H = 1.16;

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
 * the polygons and textures it and the guests after him used); vf2, stf,
 * daytona: the ROM sets; cold: Shenmue's MISC/COLD.BIN, or null; guests:
 * { akira: { chr }, shenmue: [{ name, chr, scale }], hornet: { chr } }.
 */
export function importGuestShadows(R, ctx, { vf2, stf, daytona, cold }, guests) {
    const { main, polygons, textures } = R;
    const T = R.guest.tables.off_64988;
    const { u32s, u16s } = ctx;
    const report = [];
    /* StF's card material, from its model 26 */
    const tex = stf.texturesView, mt = stf.game.modelTable.offset;
    const card = [0, 1, 2, 3].map((i) => tex.getUint16(stf.mainDataView.getUint32(mt + STF_CARD * 16 + 4, true) * 2 + i * 2, true));
    let poly = ctx.polyEnd, texAt = ctx.texEnd;
    const newModel = (tris, what) => {
        const both = bothWays(tris);
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

    /* Akira: VF2's table, each card ×SCALE as his parts are */
    if (guests.akira) {
        const own = guestTable('vf2', readShadows(vf2).tables[0]).entries.filter((e) => e.model);
        const ids = new Map();
        const entries = own.map((e) => {
            if (!ids.has(e.model)) {
                const tris = readObject(vf2, e.model).flatMap((q) => fan(q.quad ? q.p : q.p.slice(0, 3))).map((t) => t.map((p) => p.map((x) => x * SCALE)));
                ids.set(e.model, newModel(tris, `Akira shadow ${e.model}`));
            }
            return { ...e, model: ids.get(e.model), offset: e.offset.map((x) => x * SCALE) };
        });
        seat('Akira', guests.akira.chr, entries);
    }

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

    /* Hornet: Daytona's card, cut at CUT_Z (noclip's z: the stored z the
     * other way), the nose's half on slot 1 and the cabin's on 9 */
    if (guests.hornet) {
        const cardPolys = readObject(daytona, 791);
        const cut = (front) => cardPolys.flatMap((q) => {
            const p = q.quad ? q.p : q.p.slice(0, 3);
            const side = (x) => (front ? x[2] - -CUT_Z : -CUT_Z - x[2]);
            const out = [];
            p.forEach((a, i) => {
                const b = p[(i + 1) % p.length], sa = side(a), sb = side(b);
                if (sa >= 0) out.push(a);
                if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb); out.push(a.map((x, k) => x + t * (b[k] - x))); }
            });
            return out.length >= 3 ? [{ ...q, quad: false, p: out }] : [];
        });
        /* each half stood up into a prism, the nose to the cowl and the cabin
         * to the roof: a flat card on FM's stance (the car on its tail) is
         * edge-on to the floor, and op 0x74 flattens it into a strip */
        const prism = (h) => (q) => {
            const top = q.p.map(([x, , z]) => [x, h, z]);
            return [...fan(q.p), ...fan(top), ...q.p.flatMap((a, i) => {
                const j = (i + 1) % q.p.length;
                return [[a, q.p[j], top[j]], [a, top[j], top[i]]];
            })];
        };
        const entries = [[1, true, NOSE_H], [9, false, ROOF_H]].map(([slot, front, h]) => {
            const solid = cut(front).flatMap(prism(h)).map((p) => ({ quad: false, normal: [0, 1, 0], p }));
            const placed = mapPolys(solid, bodyMap(slot, MODEL_UNITS));
            const t = placed.map((q) => q.p.map((p) => p.map((x) => x * SCALE)));
            return { slot, model: newModel(t, `Hornet shadow ${slot}`), flags: 0, offset: [0, 0, 0] };
        });
        seat('Hornet', guests.hornet.chr, entries);
    }

    report.push(`meshes ${hex(ctx.polyEnd)}..${hex(poly)}; materials and UVs ${hex(ctx.texEnd)}..${hex(texAt)}`);
    ctx.polyEnd = poly; ctx.texEnd = texAt;
    return { report };
}
