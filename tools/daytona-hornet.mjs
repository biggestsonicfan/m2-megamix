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
 *
 * Tires 0 and 1 are the rear pair (+z), 2 and 3 the front.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadRomSet } from '../vendor/noclip/js/romset.js';
import { decodeModel } from '../vendor/noclip/js/model.js';

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
}
