/*
 * daytona-hornet.mjs — Daytona USA's Hornet, the player's car, out of the
 * Model 2 set, cut into the pieces Fighters Megamix's Hornet moves.
 *
 * Where the car is. The program (Revision A, `daytona`) sets the player's car
 * up at 0xD12C: car +0x14 (the body), +0x84 (the body the in-car view draws)
 * and +0x258 (a number plate) come out of a table in the data ROM at
 * 0x0281E390, by the car type at 0x501488. dsp_player_car (0x7D38) draws +0x14,
 * then model 2139 (no mesh) and the glass (the table's second column), and 0x7DA4 the
 * four tires: models out of the program ROM at 0x230496 (unaligned words), at
 * hubs out of 0x230D54, each turned by the steering and the wheel spin. The
 * names are Sega Racing Classic's (docs: rokuYAMP d1a-daytona-symbols.md); the
 * addresses are this build's, and readCar checks the instructions that hold
 * them.
 *
 * How FM cuts it. FM's Hornet (file 130, docs/FM-SATURN.md) is two body pieces
 * and four wheels. Slot 9 is the cabin and the tail, with the windscreen, the
 * cowl and the floor; slot 1 is the nose: the bonnet, the front wings and the
 * bumper. They meet at the front edge of the doors, and both hang from the
 * same point, slot 1 turned half a turn about the car's width (FM x → −x,
 * y → −y). Daytona's body (model 1460) has an edge there too, at z = −0.46 m
 * (the front is −z), so the cut is along whole faces: a face wholly in front
 * of it is the nose, and the rest — the windscreen, the belt line that runs
 * past it, and the strip of wing tops up to the cowl, as FM's — stay with the
 * cabin.
 *
 *   node tools/daytona-hornet.mjs [--rom daytona.zip]          what is where
 *   node tools/daytona-hornet.mjs --obj hornet.obj [--type 0]  the pieces, placed
 *   node tools/daytona-hornet.mjs --objects DIR [--type 0]     FM's slots as Model 2 objects
 *
 * Tires 0 and 1 are the rear pair (+z), 2 and 3 the front.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadRomSet } from '../vendor/noclip/js/romset.js';
import { decodeModel } from '../vendor/noclip/js/model.js';
import { readModelEntry, meshOffsetOf } from '../vendor/noclip/js/romset.js';

export const DEFAULT_ROM = `${process.env.ROMS_DIR || `${process.env.HOME}/build/mameroms`}/daytona.zip`;

/* The door line; and the strip between it and the cowl, above the wings'
 * height, which FM's slot 9 carries (to x = −46, its cowl). */
export const CUT_Z = -0.46;
const CUT_EPS = 0.005;
const COWL_Z = -0.92, COWL_Y = 0.70;

/* FM's model units in Daytona's metres, and where FM's body pivot (slots 1 and
 * 9's origin) lands on Daytona's car. Matched by the extents: FM's body is
 * 566 × 132 × 203 units, Daytona's 4.93 × 1.16 × 1.74 m (0.0087, 0.0088,
 * 0.0086 m a unit); the pivot is 233 units behind the nose and 42 above the
 * floor. */
export const FM_UNIT = 0.0087;
export const FM_PIVOT = [0, 0.475, -0.44];

/** A point in FM's cabin frame (slot 9, model units: x rearward, y down, z
 *  across) on Daytona's car (metres, noclip's decode: front -z). */
export function fmToDaytona([x, y, z]) {
    return [z * FM_UNIT, FM_PIVOT[1] - y * FM_UNIT, FM_PIVOT[2] + x * FM_UNIT];
}

/* FM's wheel slots and the Daytona tire (readCar's tires) each one stands
 * for: the hands are the front wheels, the feet the rear, FM's -z Daytona's
 * -x. FM's pose (fm-saturn.mjs poseFighter) puts them there in the car pose,
 * motion 0x10A. */
export const WHEEL_SLOTS = { 5: 2, 8: 3, 12: 0, 15: 1 };
export const CAR_POSE = 0x10a;

export async function loadDaytona(path = DEFAULT_ROM) {
    const b = readFileSync(path);
    return loadRomSet([b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)], () => {}, { game: 'daytona' });
}

/* A model record's address → its index in the model table. */
function modelIndex(rom, addr) {
    const t = rom.game.modelTable, i = (addr - 0x02000000 - t.offset) / t.stride;
    if (!Number.isInteger(i) || i < 0 || i >= t.count) throw new Error(`0x${addr.toString(16)} is not a model`);
    return i;
}

/* The word an instruction's 32-bit displacement holds, after checking the
 * instruction is the one expected (opcode word, so a different build fails
 * here rather than reading garbage). */
function operand(cv, at, op) {
    const w = cv.getUint32(at, true);
    if (w !== op) throw new Error(`0x${at.toString(16)}: 0x${w.toString(16)}, not 0x${op.toString(16)}: not Daytona rev A`);
    return cv.getUint32(at + 4, true);
}

/* The player's car: body, in-car body and glass per car type, the tires and
 * their hubs. */
export function readCar(rom) {
    const cv = rom.mainCpuView, dv = rom.mainDataView, prog = (a) => a - 0x200000;
    const table = operand(cv, 0xd134, 0x9018390f) - 0x02000000;
    const col = (k, n) => Array.from({ length: n }, (_, i) => modelIndex(rom, dv.getUint32(table + 4 * (k + i), true)));
    const tires = prog(operand(cv, 0x7dd8, 0x8c783000));
    const hubs = prog(operand(cv, 0x7da4, 0x8c483000));
    return {
        body: col(0, 3),          /* by car type: 0, 1 (same mesh, other textures), 2 */
        glass: col(3, 3),
        cockpit: col(6, 3),
        plates: col(9, 8),        /* car type 2's, by the cabinet's number */
        tires: [0, 1, 2, 3].map(i => ({
            model: modelIndex(rom, cv.getUint32(tires + 4 * i, true)),
            hub: [0, 1, 2].map(a => +cv.getFloat32(hubs + 12 * i + 4 * a, true).toFixed(4)),
        })),
    };
}

/* The body's faces, nose or cabin, as triangle lists. */
export function splitBody(rom, model) {
    const m = decodeModel(rom, model), P = m.positions, faces = new Map();
    m.faces.forEach((f, t) => (faces.get(f) ?? faces.set(f, []).get(f)).push(t));
    const nose = [], cabin = [];
    for (const tris of faces.values()) {
        const zs = tris.flatMap(t => [P[9 * t + 2], P[9 * t + 5], P[9 * t + 8]]);
        const ys = tris.flatMap(t => [P[9 * t + 1], P[9 * t + 4], P[9 * t + 7]]);
        const front = Math.max(...zs) <= CUT_Z + CUT_EPS;
        const cowl = Math.min(...zs) >= COWL_Z && Math.min(...ys) >= COWL_Y;
        (front && !cowl ? nose : cabin).push(...tris);
    }
    const take = (tris) => tris.map(t => Array.from(P.subarray(9 * t, 9 * t + 9)));
    return { faces: faces.size, nose: take(nose), cabin: take(cabin) };
}

function writeObj(path, rom, car, type) {
    const lines = [`# Daytona USA's Hornet (model ${car.body[type]}), cut as FM's Hornet`, `# FM pivot ${FM_PIVOT.join(' ')}`];
    let n = 0;
    const group = (name, tris, d = [0, 0, 0]) => {
        lines.push(`g ${name}`);
        for (const t of tris) {
            for (let k = 0; k < 9; k += 3) lines.push(`v ${t[k] + d[0]} ${t[k + 1] + d[1]} ${t[k + 2] + d[2]}`);
            lines.push(`f ${n + 1} ${n + 2} ${n + 3}`);
            n += 3;
        }
    };
    const s = splitBody(rom, car.body[type]);
    group('nose', s.nose);
    group('cabin', s.cabin);
    const tri = (i) => { const P = decodeModel(rom, i).positions, out = []; for (let k = 0; k < P.length; k += 9) out.push(Array.from(P.subarray(k, k + 9))); return out; };
    car.tires.forEach((t, i) => group(`tire${i}_${t.model}`, tri(t.model), t.hub));
    writeFileSync(path, lines.join('\n') + '\n');
}

/* ---- The pieces as Model 2 objects, one per FM slot ----------------------
 *
 * An object is what the geometrizer walks (MAME geo_parse_*): two points
 * (P0, P1), then a polygon per record: the attribute, a normal, and two
 * points (P2, and P3 for a quad, attr bit 0; a triangle's slot is a dummy and
 * the walk takes P2 for it). Attribute bits 0-1 of 0 end the object. Bits 8-9,
 * the link type, say which two points the next polygon starts from: 0 and 2
 * (P2, P3), 1 (P0, P2), 3 (P3, P1). The rasterizer culls a polygon whose own
 * link type is 0. Each polygon, culled or not, reads its texture points
 * (2 halfwords a corner) from the stream at the model's uvPtr, in order, and
 * its texture header (4 halfwords) at the model's matPtr, which then moves
 * on by bits 12-16 (signed) headers. The corners are P1, P0, P2, P3.
 */
export const POINT_BYTES = 24, RECORD_BYTES = 40;

/** An object's polygons, as the geometrizer walks them: { attr, normal, p
 *  (P0, P1, P2, P3; P3 = P2 for a triangle), uv, th }. The points are as
 *  stored (Model 2's axes, not noclip's: z is not negated). src: { mesh
 *  (DataView), at, uv (DataView), uvAt, th (DataView), thAt } — byte
 *  offsets, little-endian. */
export function walkObject(src, count = Infinity) {
    const { mesh, uv, th } = src;
    let p = src.at, u = src.uvAt, h = src.thAt;
    const pt = () => { const v = [0, 1, 2].map(k => mesh.getFloat32(p + 4 * k, true)); p += 12; return v; };
    let p0 = pt(), p1 = pt();
    const polys = [];
    while (polys.length < count) {
        const attr = mesh.getUint32(p, true);
        if ((attr & 3) === 0) break;
        p += 4;
        const normal = pt(), p2 = pt(), d = pt(), quad = (attr & 1) !== 0, p3 = quad ? d : p2;
        const n = quad ? 4 : 3;
        const poly = { attr, normal, p: [p0, p1, p2, p3], quad,
            uv: Array.from({ length: 2 * n }, (_, k) => uv.getUint16(u + 2 * k, true)),
            th: [0, 1, 2, 3].map(k => th.getUint16(h + 2 * k, true)) };
        polys.push(poly);
        u += 4 * n;
        h += 8 * (((attr >> 12) & 0x1f) << 27 >> 27);
        const link = (attr >> 8) & 3;
        if (link === 0 || link === 2) { p0 = p2; p1 = p3; }
        else if (link === 1) p1 = p2;
        else p0 = p3;
    }
    return polys;
}

/** A model's polygons out of the ROM set (walkObject), the culled ones (link
 *  type 0) left out. Its points, texture points and headers must be in ROM. */
export function readObject(rom, model) {
    const e = readModelEntry(rom, model);
    if ((e.meshPtr & 0x800000) === 0 || (e.uvPtr | e.matPtr) & 0x800000) throw new Error(`model ${model}: not all in ROM`);
    const tex = new DataView(rom.textures.buffer, rom.textures.byteOffset, rom.textures.byteLength);
    return walkObject({ mesh: rom.polygonsView, at: meshOffsetOf(rom, e), uv: tex, uvAt: e.uvPtr * 2, th: tex, thAt: e.matPtr * 2 })
        .filter(q => (q.attr >> 8) & 3);
}

const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Polygons (readObject's) as a new object: { mesh, uv, th (Uint8Array,
 *  Uint16Array, Uint16Array), count }. Each polygon keeps its attribute,
 *  texture points and header; the header stream is one header a polygon
 *  (bits 12-16 become 1). Where the previous polygon's link doesn't hand on
 *  this one's P0 and P1, a culled quad (link type 0, the z sort's "old
 *  value") is put in to carry them, with this polygon's header and zero
 *  texture points. mesh's points are rounded to float32 once, here. */
export function encodeObject(polys) {
    const f32 = (v) => v.map(Math.fround);
    const out = [], uv = [], th = [];
    let carry = null, prev = null;
    const emit = (attr, normal, p2, p3, q, puv) => {
        out.push({ attr: (attr & ~0x1f000) | 0x1000, normal, p2, p3 });
        uv.push(...puv); th.push(...q.th);
    };
    for (const q of polys) {
        const [p0, p1, p2, p3] = q.p.map(f32);
        if (!carry) carry = [p0, p1], prev = carry;
        else if (!same(carry[0], p0) || !same(carry[1], p1)) {
            emit((q.attr & ~0xf02) | 1, [0, 0, 0], p0, p1, q, new Array(8).fill(0));
            carry = [p0, p1];
        }
        emit(q.attr, f32(q.normal), p2, q.quad ? p3 : p2, q, q.uv);
        const link = (q.attr >> 8) & 3, c3 = q.quad ? p3 : p2;
        carry = link === 2 ? [p2, c3] : link === 1 ? [carry[0], p2] : [c3, carry[1]];
    }
    const mesh = new Uint8Array(POINT_BYTES + out.length * RECORD_BYTES + 16), v = new DataView(mesh.buffer);
    let o = 0;
    const put = (a) => { for (const x of a) { v.setFloat32(o, x, true); o += 4; } };
    put(prev?.[0] ?? [0, 0, 0]); put(prev?.[1] ?? [0, 0, 0]);
    for (const r of out) { v.setUint32(o, r.attr >>> 0, true); o += 4; put(r.normal); put(r.p2); put(r.p3); }
    return { mesh, uv: Uint16Array.from(uv), th: Uint16Array.from(th), count: out.length };
}

/* An affine map of Model 2 points: x -> k R x + t (R a rotation, row-major);
 * a normal goes through R alone. */
export function applyMap(m, x) { return [0, 1, 2].map(i => m.k * (m.R[3 * i] * x[0] + m.R[3 * i + 1] * x[1] + m.R[3 * i + 2] * x[2]) + m.t[i]); }
export function mapPolys(polys, m) {
    const R = { k: 1, R: m.R, t: [0, 0, 0] };
    return polys.map(q => ({ ...q, normal: applyMap(R, q.normal), p: q.p.map(x => applyMap(m, x)) }));
}

/* Model 2's axes are noclip's with z negated (noclip's decodeModel negates
 * it). FM's model files are on noclip's axes: FM Akira's meshes (file 147)
 * lie along the same axes, the same way round, as VF2 Akira's in noclip's
 * decode, 300 units to VF2's metre (tests/daytona-hornet.test.mjs). So an
 * FM slot's frame in Model 2's axes and VF2's metres is (x, y, -z) / 300. */
const N = [1, 0, 0, 0, 1, 0, 0, 0, -1];
const mul = (A, B) => [0, 1, 2].flatMap(i => [0, 1, 2].map(j => A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j]));

/** The map from Daytona's Model 2 points (metres) into FM slot s's frame on
 *  Model 2's axes, in VF2's metres (the pose's: MODEL_UNITS FM units), for
 *  the nose (1, 16) and the cabin (9, 24). fmToDaytona, the other way. */
export function bodyMap(slot, modelUnits) {
    const k = 1 / (FM_UNIT * modelUnits);
    /* noclip d = N r; FM cabin c = ((d.z - Pz), (Py - d.y), d.x) / FM_UNIT */
    const C = [0, 0, 1, 0, -1, 0, 1, 0, 0], tc = [-FM_PIVOT[2], FM_PIVOT[1], 0];
    const H = slot === 1 || slot === 16 ? [-1, 0, 0, 0, -1, 0, 0, 0, 1] : [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const NH = mul(N, H);
    return { k, R: mul(mul(NH, C), N), t: applyMap({ k, R: NH, t: [0, 0, 0] }, tc) };
}

/** The map from a Daytona tire (805 or 806, Model 2 points about its hub)
 *  into FM wheel slot s's frame, as bodyMap. FM's wheel (fmWheel, its points
 *  in FM units) is a ten-sided tyre whose axle is its thinnest axis; its hub
 *  is dished on one side, the outside (the rear wheels' outside is the
 *  car's, in the car pose). Daytona's tire is open on the inside and has its
 *  rim and hub on the outside (805's -x, 806's +x). So the tire's outside
 *  goes to FM's, its up to FM's -y (the models' y is down), its centre to
 *  FM's, and its metres are FM_UNIT FM units. */
export function wheelMap(tireModelPoints, fmWheel, modelUnits) {
    const box = (P) => [0, 1, 2].map(a => [Math.min(...P.map(p => p[a])), Math.max(...P.map(p => p[a]))]);
    const fb = box(fmWheel), db = box(tireModelPoints.map(p => [p[0], p[1], -p[2]]));
    const axle = [0, 1, 2].reduce((m, a) => (fb[a][1] - fb[a][0] < fb[m][1] - fb[m][0] ? a : m), 0);
    /* the dished side: the hub point nearer its face */
    const hubs = fmWheel.filter(p => Math.hypot(...p.filter((_, a) => a !== axle)) < 1).map(p => p[axle]);
    if (hubs.length !== 2) throw new Error(`${hubs.length} points on the wheel's axle, not 2`);
    const sigma = Math.max(...hubs) - fb[axle][1] > fb[axle][0] - Math.min(...hubs) ? 1 : -1;
    const outD = Math.abs(db[0][0]) > Math.abs(db[0][1]) ? -1 : 1;
    const e = (a, s = 1) => [0, 1, 2].map(i => (i === a ? s : 0));
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const Bd = [e(0, outD), e(1), cross(e(0, outD), e(1))], Bf = [e(axle, sigma), e(1, -1), cross(e(axle, sigma), e(1, -1))];
    /* Q = Bf Bd^T, noclip frame to FM frame */
    const Q = [0, 1, 2].flatMap(i => [0, 1, 2].map(j => Bf.reduce((s, f, c) => s + f[i] * Bd[c][j], 0)));
    const dc = db.map(([a, b]) => (a + b) / 2), fc = fb.map(([a, b]) => (a + b) / 2);
    const k = 1 / (FM_UNIT * modelUnits);
    /* r -> N (Q (N r - dc) / FM_UNIT + fc) / modelUnits */
    const R = mul(mul(N, Q), N), NQ = mul(N, Q);
    const t = applyMap({ k, R: NQ, t: [0, 0, 0] }, dc).map((v, i) => -v + [1, 1, -1][i] * fc[i] / modelUnits);
    return { k, R, t, axle, sigma };
}

/** Faces whose noclip points pass test, as readObject polygons. */
function splitObject(rom, model, keepNose) {
    const polys = readObject(rom, model);
    const front = [], back = [];
    for (const q of polys) {
        const pts = q.quad ? q.p : q.p.slice(0, 3);
        const zs = pts.map(p => -p[2]), ys = pts.map(p => p[1]);
        const isFront = Math.max(...zs) <= CUT_Z + CUT_EPS && !(Math.min(...zs) >= COWL_Z && Math.min(...ys) >= COWL_Y);
        (isFront ? front : back).push(q);
    }
    return keepNose ? front : back;
}

/* FM's hand-model slots (the hand list at 0x0607A3F0): the front wheels
 * again. */
export const WHEEL_ALIASES = { 20: 5, 27: 5, 23: 8, 30: 8 };

/**
 * Daytona's Hornet as Model 2 objects, one or more per FM slot, each in its
 * slot's frame (Model 2's axes, VF2's metres), so a motion that poses FM's
 * Hornet puts Daytona's pieces where FM puts its own. fmSlots: FM's file 130
 * (fm-saturn.mjs readModel), for the wheels' frames. Daytona has no broken
 * car, so 16 and 24 (FM's armour-broken nose and cabin) get the whole ones.
 * Returns [{ slot, name, model, polys, ...encodeObject }].
 */
export function hornetObjects(rom, fmSlots, { type = 0, modelUnits = 300 } = {}) {
    const car = readCar(rom), out = [];
    const add = (slot, name, model, polys, m) => {
        const placed = mapPolys(polys, m);
        out.push({ slot, name, model, polys: placed, ...encodeObject(placed) });
    };
    for (const [slot, nose] of [[1, true], [9, false], [16, true], [24, false]]) {
        const m = bodyMap(slot, modelUnits);
        add(slot, nose ? 'nose' : 'cabin', car.body[type], splitObject(rom, car.body[type], nose), m);
        if (!nose) add(slot, 'glass', car.glass[type], readObject(rom, car.glass[type]), m);
    }
    for (const [slot, tire] of Object.entries(WHEEL_SLOTS)) {
        const model = car.tires[tire].model, polys = readObject(rom, model);
        add(+slot, 'wheel', model, polys, wheelMap(polys.flatMap(q => q.p), fmSlots[+slot].points, modelUnits));
    }
    for (const [slot, of] of Object.entries(WHEEL_ALIASES)) out.push({ ...out.find(o => o.slot === of), slot: +slot });
    return out;
}

function writeObjects(dir, objs) {
    mkdirSync(dir, { recursive: true });
    const list = [];
    for (const o of objs) {
        const base = `${o.slot}-${o.name}`;
        writeFileSync(`${dir}/${base}.mesh`, o.mesh);
        writeFileSync(`${dir}/${base}.uv`, new Uint8Array(o.uv.buffer));
        writeFileSync(`${dir}/${base}.th`, new Uint8Array(o.th.buffer));
        list.push({ slot: o.slot, name: o.name, daytonaModel: o.model, polygons: o.count, files: base });
    }
    writeFileSync(`${dir}/objects.json`, JSON.stringify(list, null, 1) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const opt = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
    const rom = await loadDaytona(opt('--rom'));
    const obj = opt('--obj'), type = +(opt('--type') ?? 0);
    const car = readCar(rom);
    const polys = (i) => decodeModel(rom, i).faceCount;
    console.log(`body    ${car.body.map(i => `${i} (${polys(i)} faces)`).join(', ')}`);
    console.log(`glass   ${car.glass.join(', ')}`);
    console.log(`cockpit ${car.cockpit.join(', ')}`);
    console.log(`plates  ${car.plates.join(', ')}`);
    car.tires.forEach((t, i) => console.log(`tire ${i}  ${t.model} at (${t.hub.join(', ')})`));
    const s = splitBody(rom, car.body[type]);
    console.log(`split ${car.body[type]} at z ${CUT_Z}: nose ${s.nose.length} triangles, cabin ${s.cabin.length}`);
    console.log(`FM pivot (${FM_PIVOT.join(', ')}), ${FM_UNIT} m an FM unit`);
    if (obj) writeObj(obj, rom, car, type);
    const objects = opt('--objects');
    if (objects) {
        const FM = await import('./fm-saturn.mjs');
        const game = FM.readGame(opt('--disc') ?? FM.DEFAULT_DISC);
        const objs = hornetObjects(rom, FM.readModel(game.archive(130), FM.HORNET_SLOTS), { type, modelUnits: FM.MODEL_UNITS });
        for (const o of objs) console.log(`slot ${String(o.slot).padStart(2)}  ${o.name.padEnd(5)}  model ${o.model}  ${o.polys.length} polygons, ${o.count} records, mesh ${o.mesh.length} bytes`);
        writeObjects(objects, objs);
    }
}
