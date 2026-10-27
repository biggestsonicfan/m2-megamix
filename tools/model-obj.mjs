/*
 * A fighter's models as Wavefront OBJ and MTL, and back: what a guest
 * importer (tools/mahler-guest.mjs) takes in place of the ROM's polygons.
 *
 *   node tools/model-obj.mjs export <who> <dir> [--layout pose|parts]
 *   node tools/model-obj.mjs check <dir>
 *
 * <who> is a roster name (AKIRA, MAHLER, SONIC...; HONEY is FV's, StF's is
 * stf:15) or game:index (vf2:0, fv:8, stf:0: readFighters' records, StF's
 * character numbers). `export` writes, in <dir>:
 *
 *   <name>.obj      one object a model: slotNN (a body part), slotNN_extraK
 *                   (FV's shoulder pads and the like, drawn on slot NN's
 *                   matrix) and handH_M (FV's hand shapes, model M); the
 *                   fighter standing in its stance (frame 1), y up, metres
 *                   (`--layout parts`: each model in its own frame, at 0)
 *   <name>.mtl      a material a face kind, named for what the board reads
 *                   (below), with its colour (Kd) and its tile (map_Kd)
 *   tex/*.png       each tile a material draws, in that material's colours
 *                   (lit full on); a transparent face's holes clear
 *   <name>.m2.json  what OBJ has no word for: the game, each object's slot
 *                   or hand shapes and the matrix it was laid out with
 *
 * `check` reads the folder back (readObjDir) and compares it with the ROM,
 * face for face, and the meshes encodeObject makes of both, by length.
 *
 * Edit it in any 3D program (Blender: File > Import > Wavefront, Y up,
 * -Z forward, the defaults; export it back the same way, with UVs, normals
 * and materials, as triangles or quads). The rules:
 *
 *   - Keep the object names. An object is a model; one that is missing
 *     keeps the ROM's model.
 *   - Keep the material names. A material is the face's four texture
 *     header words and its attribute bits, `m2_<th0>_<th1>_<th2>_<th3>_<attr>`
 *     in hex: tile, size, colour, luma band, holes, lighting material. A new
 *     face takes one of the materials there are; changing what a material
 *     *looks* like in the 3D program changes nothing on the board.
 *   - Faces are triangles or quads (Model 2 draws no others), and a quad
 *     should be flat and convex.
 *   - The UVs are the tile's: 0..1 across it, past 1 to repeat it.
 *
 * A face's points are its corners in order (Model 2's P0, P1, P2 and, for a
 * quad, P3; the outline is P0 P1 P3 P2, counterclockwise round its normal in
 * Model 2's axes, and the OBJ reverses it, its z being Model 2's -z). Its
 * texture points are the stream's (v, u) halfwords, eighths of a texel, as
 * 1/8 texel / tile size. Its normal is the OBJ's when the corners agree on
 * one that faces the way the face winds (as it is, not made unit length:
 * the ROM's are a hair off one), else the face's own. Which edge
 * hands on to the next face (attribute bits 8-9) is worked out again: the
 * one that hands the next face its first two points, as the ROM's meshes
 * do (encodeObject puts in a culled carrier where none does).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readFighters } from '../vendor/noclip/js/vf2fighters.js';
import { readCharacter } from '../vendor/noclip/js/characters.js';
import { turnedBy, turnedInOrder } from '../vendor/noclip/js/pose.js';
import { resolveData } from '../vendor/noclip/js/motion.js';
import { facePalette } from '../vendor/noclip/js/romset.js';
import { buildTexram } from '../vendor/noclip/js/texture.js';
import { buildLumaram, buildColorxlat } from '../vendor/noclip/js/colors.js';
import { buildAtlas, ATLAS_W, SHEET_H } from '../vendor/noclip/js/atlas.js';
import { readObject, encodeObject } from './daytona-hornet.mjs';

const TEXTURED = 0x4000, HOLES = 0x2000;
/* the attribute bits a face's material keeps: not its shape (0-1), its
 * link (8-9) nor its header step (12-16), which the mesh decides */
const ATTR_KEEP = ~(3 | 0x300 | 0x1f000) >>> 0;
/* FV's hand list: four s16 models a hand, by record (js/fighterhands.js) */
const FV_HANDS = 0x0640ebf4, SHAPES = 4;

const hex4 = (v) => (v >>> 0).toString(16).toUpperCase().padStart(4, '0');
const num = (x) => (Object.is(x, -0) ? 0 : +x.toPrecision(15)).toString();

/* ---- the fighter ---- */

/** The fighter `who` names: { name, game, rom, kind, index }. */
export async function whoIs(games, who) {
    const { ROSTER } = await import('../js/games.js');
    const m = /^(vf2|fv|stf):(\d+)$/i.exec(who);
    const e = m ? { game: m[1].toLowerCase(), index: +m[2] } : ROSTER.find((r) => r.name === who.toUpperCase());
    if (!e || !games[e.game]) throw new Error(`no fighter ${who} (a roster name, or vf2:N, fv:N, stf:N)`);
    const rom = games[e.game].rom;
    const name = e.name ?? (e.game === 'stf' ? readCharacter(rom, e.index).name : readFighters(rom)[e.index]?.name) ?? `${e.game}${e.index}`;
    return { ...e, name: String(name).replace(/[^A-Za-z0-9]+/g, '_').toUpperCase(), rom, kind: games[e.game].kind };
}

/** A fighter's models as raw polygons (walkObject's, Model 2's axes): [{
 *  name, model, slot (the matrix it is drawn on), extra (its place in the
 *  slot, FV's placeExtra), hands ([[hand, shape]...]), polys }]. */
export function fighterPieces(f) {
    const { rom } = f, pieces = [];
    if (f.game === 'stf') {
        const ch = readCharacter(rom, f.index);
        ch.slots.forEach((s, i) => { if (s.model > 0) pieces.push({ name: `slot${String(i).padStart(2, '0')}`, slot: i, model: s.model, polys: readObject(rom, s.model) }); });
        return pieces;
    }
    const A = readFighters(rom)[f.index];
    A.parts.forEach((p, s) => { if (s && p.model > 0) pieces.push({ name: `slot${String(s).padStart(2, '0')}`, slot: s, model: p.model, polys: readObject(rom, p.model) }); });
    A.extras.forEach((e, i) => {
        const place = placeExtra(e);
        pieces.push({ name: `slot${String(e.slot).padStart(2, '0')}_extra${i}`, slot: e.slot, model: e.model, extra: place,
            polys: readObject(rom, e.model).map((q) => movedBy(q, place)) });
    });
    if (f.game === 'fv') {
        const r = resolveData(rom, FV_HANDS + A.index * 4), list = r.view.getUint32(r.off, true);
        const byModel = new Map();
        for (let h = 0; h < 2; h++) for (let i = 0; i < SHAPES; i++) {
            const x = resolveData(rom, list + (h * SHAPES + i) * 2), m = x.view.getInt16(x.off, true);
            if (m <= 0) continue;
            (byModel.get(m) ?? byModel.set(m, []).get(m)).push([h, i]);
        }
        for (const [m, hands] of byModel) pieces.push({ name: `hand${hands[0][0]}_${m}`, slot: hands[0][0] ? 8 : 5, model: m, hands, polys: readObject(rom, m) });
    }
    return pieces;
}

/* An extra's place in its slot, Model 2's axes (noclip's placeExtra, from
 * the slot's own frame; mahler-guest's `placed`). */
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const at = (r, t, o) => [0, 1, 2].map((a) => t[a] + r[a] * o[0] + r[3 + a] * o[1] + r[6 + a] * o[2]);
function placeExtra(e) {
    const t = at(I3, [0, 0, 0], e.offset);
    const r = e.turns ? turnedInOrder(I3, e.turns) : turnedBy(I3, e.turn[0], e.turn[1], e.turn[2]);
    return { r, t: e.then ? at(r, t, e.then) : t };
}
const movedBy = (q, { r, t }) => ({ ...q, p: q.p.map((v) => at(r, t, v)), normal: at(r, [0, 0, 0], q.normal) });

/* Each slot's matrix in the stance's first frame (noclip's axes: Model 2's
 * with z negated, y up), column-major, as js/fighters.js poses it. */
async function stanceMatrices(games, f) {
    const { makeFighter } = await import('../js/fighters.js');
    const fighter = makeFighter(games, { game: f.game, index: f.index, name: f.name });
    const { mats } = fighter.createBody().pose(fighter.act('stance'), 1);
    return mats.map((m) => Array.from(m?.elements ?? m ?? IDENTITY));
}

/* ---- 4x4 matrices, column-major (three.js's elements) ---- */

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/* Model 2's axes to noclip's: z negated */
const FLIP = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
const mul4 = (A, B) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = [0, 1, 2, 3].reduce((s, k) => s + A[k * 4 + r] * B[c * 4 + k], 0); return o; };
const point = (M, p) => [0, 1, 2].map((r) => M[r] * p[0] + M[4 + r] * p[1] + M[8 + r] * p[2] + M[12 + r]);
const vec = (M, p) => [0, 1, 2].map((r) => M[r] * p[0] + M[4 + r] * p[1] + M[8 + r] * p[2]);
function invert4(m) {
    /* general inverse (the stance's matrices may carry StF's part scales) */
    const a = m, o = new Array(16);
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) throw new Error('a layout matrix that does not invert');
    const d = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
    return o;
}
const transpose3 = (M) => [M[0], M[4], M[8], 0, M[1], M[5], M[9], 0, M[2], M[6], M[10], 0, 0, 0, 0, 1];
const unit = (v) => { const l = Math.hypot(...v); return l ? v.map((x) => x / l) : v; };
const sub = (a, b) => a.map((x, i) => x - b[i]);
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/* ---- materials ---- */

const tileSize = (th0) => [32 << (th0 & 7), 32 << ((th0 >> 3) & 7)];
export const materialName = (q) => `m2_${q.th.map(hex4).join('_')}_${((q.attr & ATTR_KEEP) >>> 0).toString(16).toUpperCase()}`;
export function parseMaterial(name) {
    const m = /^m2_([0-9A-F]{4})_([0-9A-F]{4})_([0-9A-F]{4})_([0-9A-F]{4})_([0-9A-F]+)(?:\.\d+)?$/i.exec(name ?? '');
    if (!m) return null;
    return { th: m.slice(1, 5).map((x) => parseInt(x, 16)), attr: parseInt(m[5], 16) & ATTR_KEEP };
}

/* The colour tables the fighter is drawn with (js/render.js fighterMaterial)
 * and what a material looks like through them, lit full on. */
async function lookOf(games, f) {
    const { rom } = f, game = games[f.game];
    let sets, colorSet;
    if (f.kind === 'stf') {
        const scene = game.stages[0];
        sets = scene.texSets; colorSet = scene.texSet[1];
    } else {
        const { makeFighter } = await import('../js/fighters.js');
        const look = makeFighter(games, { game: f.game, index: f.index, name: f.name }).look;
        sets = look.sets; colorSet = look.set;
        rom.paletteSet = look.set;
    }
    const resident = rom.game.texture.residentSet;
    const tr = buildTexram(rom, resident == null ? sets : [resident, ...sets]);
    return {
        atlas: buildAtlas(tr.sheet0, tr.sheet1),
        luma: buildLumaram(rom),
        cxlat: buildColorxlat(rom, { colorSet, tint: [1, 1, 1], fighters: [f.index] }),
        palette: facePalette(rom),
    };
}
function shade(look, c555, li) {
    return [0, 1, 2].map((ch) => {
        const v = look.cxlat[ch * 0x4000 + ((((c555 >> (5 * ch)) & 31) << 8) + li) * 2];
        return Math.round(Math.max(v - 64, 0) * 255 / 191);
    });
}
function materialLook(look, th) {
    const c555 = Math.max(look.palette[(th[3] >> 6) & 0x3ff], 0);
    if (!(th[0] & TEXTURED)) return { kd: shade(look, c555, 63) };
    const [w, h] = tileSize(th[0]);
    const x0 = 32 * (th[2] & 0x3f), y0 = 32 * ((th[2] >> 6) & 0x1f) + ((th[2] >> 12) & 1) * SHEET_H;
    const lumaBase = (th[1] & 0xff) << 7, holes = !!(th[0] & HOLES);
    const ramp = Array.from({ length: 16 }, (_, t) => shade(look, c555, Math.min(Math.floor(look.luma[2 * (lumaBase + t * 8)] * 255 / 256), 63)));
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const t = look.atlas[(y0 + y) * ATLAS_W + x0 + x] / 17, o = (y * w + x) * 4;
        rgba.set(ramp[t], o);
        rgba[o + 3] = holes && t === 15 ? 0 : 255;
    }
    return { kd: [255, 255, 255], w, h, holes, rgba, png: `${x0}_${y0}_${w}x${h}_${hex4(c555)}_${hex4(lumaBase)}${holes ? '_holes' : ''}.png` };
}

/* ---- PNG ---- */

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, rgba) {
    const chunk = (type, data) => {
        const b = Buffer.alloc(12 + data.length);
        b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); Buffer.from(data).copy(b, 8);
        b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
        return b;
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    const raw = Buffer.alloc(h * (w * 4 + 1));
    for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/* ---- export ---- */

/* A face's corners as the OBJ lists them: the outline P0 P1 P3 P2 (P0 P1 P2
 * for a triangle), reversed; and which texture point pair is each corner's
 * (the stream's corners are P1, P0, P2, P3). */
const OUTLINE = { 3: [2, 1, 0], 4: [2, 3, 1, 0] };
const UV_OF = [1, 0, 2, 3];

/** Write `f`'s models to `dir` (see the head). */
export async function exportFighter(games, f, dir, { layout = 'pose' } = {}) {
    const pieces = fighterPieces(f);
    const mats = layout === 'pose' ? await stanceMatrices(games, f) : null;
    const look = await lookOf(games, f);
    mkdirSync(join(dir, 'tex'), { recursive: true });
    const name = f.name.toLowerCase();
    const obj = [`# ${f.name} (${f.game}:${f.index}), Model 2 polygons; tools/model-obj.mjs`, `mtllib ${name}.mtl`];
    const materials = new Map(), side = { game: f.game, index: f.index, name: f.name, layout, objects: {} };
    let nv = 0, nt = 0, nn = 0;
    for (const pc of pieces) {
        const M = mul4(mats?.[pc.slot] ?? IDENTITY, FLIP), N = transpose3(invert4(M));
        side.objects[pc.name] = { model: pc.model, slot: pc.slot, ...(pc.hands ? { hands: pc.hands } : {}), ...(pc.extra ? { extra: pc.extra } : {}), matrix: M.map(num).map(Number) };
        obj.push(`o ${pc.name}`);
        let cur = null;
        for (const q of pc.polys) {
            const mn = materialName(q);
            if (!materials.has(mn)) materials.set(mn, q.th);
            if (mn !== cur) { obj.push(`usemtl ${mn}`); cur = mn; }
            const n = q.quad ? 4 : 3, [w, h] = tileSize(q.th[0]);
            const corners = OUTLINE[n];
            for (const c of corners) obj.push(`v ${point(M, q.p[c]).map(num).join(' ')}`);
            for (const c of corners) {
                const k = UV_OF.indexOf(c), pv = q.uv[2 * k], pu = q.uv[2 * k + 1];
                obj.push(`vt ${num(pu / 8 / w)} ${num(1 - pv / 8 / h)}`);
            }
            obj.push(`vn ${vec(N, q.normal).map(num).join(' ')}`);
            nn++;
            obj.push(`f ${corners.map((_, i) => `${nv + i + 1}/${nt + i + 1}/${nn}`).join(' ')}`);
            nv += n; nt += n;
        }
    }
    const mtl = [`# ${f.name}'s materials: m2_<th0>_<th1>_<th2>_<th3>_<attribute bits> (tools/model-obj.mjs)`];
    const pngs = new Set();
    for (const [mn, th] of materials) {
        const m = materialLook(look, th);
        mtl.push('', `newmtl ${mn}`, `Kd ${m.kd.map((x) => (x / 255).toFixed(4)).join(' ')}`, 'Ka 0 0 0', 'Ks 0 0 0', 'illum 1');
        if (m.png) {
            mtl.push(`map_Kd tex/${m.png}`);
            if (m.holes) mtl.push(`map_d -imfchan m tex/${m.png}`);
            if (!pngs.has(m.png)) { writeFileSync(join(dir, 'tex', m.png), png(m.w, m.h, m.rgba)); pngs.add(m.png); }
        }
    }
    writeFileSync(join(dir, `${name}.obj`), obj.join('\n') + '\n');
    writeFileSync(join(dir, `${name}.mtl`), mtl.join('\n') + '\n');
    writeFileSync(join(dir, `${name}.m2.json`), JSON.stringify(side, null, 1) + '\n');
    return { pieces, objects: pieces.length, faces: nn, materials: materials.size, textures: pngs.size };
}

/* ---- import ---- */

/** Parse an OBJ: { objects: Map(name -> [{ material, corners: [{v, vt, vn}] }]) }. */
export function parseObj(text) {
    const v = [], vt = [], vn = [], objects = new Map();
    let cur = null, material = null;
    const take = (name) => { cur = objects.get(name) ?? objects.set(name, []).get(name); };
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line[0] === '#') continue;
        const [k, ...a] = line.split(/\s+/);
        if (k === 'v') v.push(a.slice(0, 3).map(Number));
        else if (k === 'vt') vt.push(a.slice(0, 2).map(Number));
        else if (k === 'vn') vn.push(a.slice(0, 3).map(Number));
        else if (k === 'o' || k === 'g') take(a.join(' '));
        else if (k === 'usemtl') material = a.join(' ');
        else if (k === 'f') {
            if (!cur) take('');
            const idx = (s, list) => { if (s === undefined || s === '') return null; const i = +s; return list[i < 0 ? list.length + i : i - 1]; };
            cur.push({ material, corners: a.map((c) => { const [i, t, n] = c.split('/'); return { v: idx(i, v), vt: idx(t, vt), vn: idx(n, vn) }; }) });
        }
    }
    return { objects };
}

/** The OBJ folder `dir` (exportFighter's, edited or not) as raw polygons:
 *  { side (the .m2.json), pieces: [{ name, slot, model, extra, hands, polys
 *  (walkObject's form, ready for encodeObject) }], report }. An object
 *  without a name in the .m2.json is an error; so is a face with no m2_
 *  material or with other than 3 or 4 corners. */
export function readObjDir(dir) {
    const jsonFile = readdirOne(dir, '.m2.json');
    const side = JSON.parse(readFileSync(jsonFile, 'utf8'));
    const objFile = existsSync(jsonFile.replace(/\.m2\.json$/, '.obj')) ? jsonFile.replace(/\.m2\.json$/, '.obj') : readdirOne(dir, '.obj');
    const { objects } = parseObj(readFileSync(objFile, 'utf8'));
    const pieces = [], report = [];
    for (const [name, faces] of objects) {
        /* Blender names an object's mesh after it: "slot01_slot01.001" and the like */
        const key = side.objects[name] ? name : Object.keys(side.objects).find((k) => name === k || name.startsWith(`${k}_`) || name.startsWith(`${k}.`));
        if (!key) throw new Error(`${basename(objFile)}: object ${name} is not one of ${side.game}:${side.index}'s (${Object.keys(side.objects).join(' ')})`);
        const o = side.objects[key], Minv = invert4(o.matrix), Nb = transpose3(o.matrix);
        const polys = faces.map((fc, i) => {
            const where = `${name} face ${i + 1}`;
            const mat = parseMaterial(fc.material);
            if (!mat) throw new Error(`${where}: material ${fc.material} is not an m2_ one`);
            const n = fc.corners.length;
            if (n !== 3 && n !== 4) throw new Error(`${where}: ${n} corners (triangles and quads only)`);
            const [w, h] = tileSize(mat.th[0]);
            /* back to Model 2's axes, the outline turned back round */
            const pts = new Array(4), uv = new Array(2 * n).fill(0);
            OUTLINE[n].forEach((c, i) => {
                const cn = fc.corners[i];
                pts[c] = point(Minv, cn.v);
                if (cn.vt) {
                    const k = UV_OF.indexOf(c);
                    uv[2 * k] = clampU16(Math.round((1 - cn.vt[1]) * 8 * h));
                    uv[2 * k + 1] = clampU16(Math.round(cn.vt[0] * 8 * w));
                }
            });
            if (n === 3) pts[3] = pts[2];
            const own = unit(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
            const ns = fc.corners.filter((c) => c.vn).map((c) => vec(Nb, c.vn).map(snap));
            const agreed = ns.length === n && ns.every((x) => dot(unit(x), unit(ns[0])) > 0.9999) && dot(ns[0], own) > 0;
            return { attr: mat.attr | (n === 4 ? 1 : 2), normal: agreed ? ns[0] : own, p: pts.map((x) => x.map(snap)), quad: n === 4, uv, th: mat.th };
        });
        pieces.push({ name: key, slot: o.slot, model: o.model, extra: o.extra, hands: o.hands, polys: linked(polys) });
    }
    report.push(`${basename(objFile)}: ${pieces.length} objects, ${pieces.reduce((s, p) => s + p.polys.length, 0)} faces`);
    return { side, pieces, report };
}
const clampU16 = (x) => Math.max(0, Math.min(0xffff, x));
/* what the layout's matrix leaves of a 0 */
const snap = (x) => (Math.abs(x) < 1e-13 ? 0 : x);
function readdirOne(dir, ext) {
    if (dir.endsWith(ext)) return dir;
    const hits = readdirSync(dir).filter((x) => x.endsWith(ext));
    if (hits.length !== 1) throw new Error(`${dir}: ${hits.length} ${ext} files, not one`);
    return join(dir, hits[0]);
}

/* Each face's link (attribute bits 8-9): the edge that hands the next face
 * its P0 and P1, turning the next face's outline round if that is what
 * lines them up; where none does (encodeObject puts in a carrier), 1, as
 * the ROM's meshes have it there. */
const QUAD_LOOP = [0, 1, 3, 2];
const sameP = (a, b) => Math.fround(a[0]) === Math.fround(b[0]) && Math.fround(a[1]) === Math.fround(b[1]) && Math.fround(a[2]) === Math.fround(b[2]);
function turned(q, r) {
    if (!r) return q;
    const n = q.quad ? 4 : 3, loop = q.quad ? QUAD_LOOP : [0, 1, 2];
    const p = new Array(4), uv = new Array(2 * n);
    for (let i = 0; i < n; i++) {
        const to = loop[i], from = loop[(i + r) % n];
        p[to] = q.p[from];
        const kt = UV_OF.indexOf(to), kf = UV_OF.indexOf(from);
        uv[2 * kt] = q.uv[2 * kf]; uv[2 * kt + 1] = q.uv[2 * kf + 1];
    }
    if (!q.quad) p[3] = p[2];
    return { ...q, p, uv };
}
function linked(polys) {
    const out = [];
    for (let i = 0; i < polys.length; i++) {
        let q = i ? out[i - 1].next ?? polys[i] : polys[i];
        let attr = (q.attr & ~0x300) | 0x100, next = null;
        if (i + 1 < polys.length) {
            const c3 = q.quad ? q.p[3] : q.p[2];
            const carry = { 2: [q.p[2], c3], 1: [q.p[0], q.p[2]], 3: [c3, q.p[1]] };
            const nq = polys[i + 1], n = nq.quad ? 4 : 3;
            found: for (let r = 0; r < n; r++) {
                const t = turned(nq, r);
                for (const L of [2, 1, 3]) {
                    if (sameP(carry[L][0], t.p[0]) && sameP(carry[L][1], t.p[1])) { attr = (q.attr & ~0x300) | (L << 8); next = t; break found; }
                }
            }
        }
        out.push({ ...q, attr, next });
    }
    return out.map(({ next, ...q }) => q);
}

/* ---- check ---- */

/** Compare readObjDir's pieces with the ROM's, face for face: { faces,
 *  same, worst (largest point error, metres), meshes, chained (encoded in
 *  no more records than the ROM's polygons) }. The links of a face the ROM
 *  follows with a culled carrier are not in its polygons, so the bytes may
 *  differ there. */
export function compareWithRom(pieces, romPieces) {
    let faces = 0, same = 0, worst = 0, meshes = 0, chained = 0;
    const bad = [];
    for (const p of pieces) {
        const r = romPieces.find((x) => x.name === p.name);
        if (!r) { bad.push(`${p.name}: not in the ROM's`); continue; }
        if (r.polys.length !== p.polys.length) bad.push(`${p.name}: ${p.polys.length} faces, the ROM ${r.polys.length}`);
        r.polys.forEach((a, i) => {
            faces++;
            if (!p.polys[i]) return;
            /* the same face may start at another corner (readObjDir turns it
             * to hand on its points) */
            const turns = Array.from({ length: a.quad ? 4 : 3 }, (_, k) => turned(p.polys[i], k));
            const b = turns.find((t) => t.p.every((x, k) => x.every((v, j) => Math.abs(v - a.p[k][j]) < 1e-5))) ?? p.polys[i];
            const err = Math.max(...a.p.flatMap((x, k) => x.map((v, j) => Math.abs(v - b.p[k][j]))));
            worst = Math.max(worst, err);
            const ok = err < 1e-5 && a.quad === b.quad && (a.attr & ATTR_KEEP) === (b.attr & ATTR_KEEP) && a.th.every((x, k) => x === b.th[k])
                && a.uv.every((x, k) => x === b.uv[k]) && dot(unit(a.normal), unit(b.normal)) > 0.99999;
            if (ok) same++;
            else if (bad.length < 10) bad.push(`${p.name} face ${i + 1}: ${JSON.stringify({ rom: { p: a.p, uv: a.uv, th: a.th, attr: a.attr }, obj: { p: b.p, uv: b.uv, th: b.th, attr: b.attr } })}`);
        });
        meshes++;
        const ea = encodeObject(r.polys), eb = encodeObject(p.polys);
        if (eb.count <= ea.count) chained++;
    }
    return { faces, same, worst, meshes, chained, bad };
}

/* ---- the command line ---- */

async function main(argv) {
    const [cmd, ...rest] = argv;
    const opt = (k, d) => { const i = rest.indexOf(k); if (i < 0) return d; const v = rest[i + 1]; rest.splice(i, 2); return v; };
    const layout = opt('--layout', 'pose');
    const { loadNodeGames } = await import('../tests/node-roms.mjs');
    if (cmd === 'export' && rest.length === 2) {
        const games = await loadNodeGames();
        const f = await whoIs(games, rest[0]);
        const r = await exportFighter(games, f, rest[1], { layout });
        console.log(`${f.name}: ${r.objects} objects, ${r.faces} faces, ${r.materials} materials, ${r.textures} textures -> ${rest[1]}`);
    } else if (cmd === 'check' && rest.length === 1) {
        const games = await loadNodeGames();
        const back = readObjDir(rest[0]);
        const f = await whoIs(games, `${back.side.game}:${back.side.index}`);
        const c = compareWithRom(back.pieces, fighterPieces(f));
        for (const line of back.report) console.log(line);
        console.log(`${c.same}/${c.faces} faces as the ROM's (largest point error ${c.worst.toExponential(2)}); ${c.chained}/${c.meshes} meshes encode in no more records than the ROM's`);
        for (const b of c.bad) console.log(`  ${b}`);
        if (c.same !== c.faces) process.exitCode = 1;
    } else {
        console.error('usage: model-obj.mjs export <who> <dir> [--layout pose|parts] | check <dir>');
        process.exitCode = 2;
    }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
