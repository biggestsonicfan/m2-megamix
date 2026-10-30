/* Daytona USA's Hornet (tools/sources/daytona-hornet.mjs): the player's car where the
 * program draws it from, cut where FM's Hornet is cut. Skipped without
 * daytona.zip; FM's half skipped without the FM disc. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as D from '../tools/sources/daytona-hornet.mjs';
import * as FM from '../tools/sources/fm-saturn.mjs';
import { decodeModel } from '../vendor/noclip/js/model.js';
import { loadRomSet } from '../vendor/noclip/js/romset.js';
import { readFighters } from '../vendor/noclip/js/vf2fighters.js';

if (!existsSync(D.DEFAULT_ROM)) { console.log(`daytona-hornet: skipped, no ${D.DEFAULT_ROM}`); process.exit(0); }

const rom = await D.loadDaytona();
const car = D.readCar(rom);
assert.deepEqual(car.body, [1460, 1461, 1835]);
assert.deepEqual(car.glass, [1462, 1463, 1793]);
assert.equal(car.windows, 2139);
assert.deepEqual(car.cockpit, [1236, 1237, 1802]);
assert.deepEqual(car.tires.map(t => t.model), [805, 806, 805, 806]);
assert.deepEqual(car.tires.map(t => t.hub), [[-0.525, 0.32, 1.4125], [0.525, 0.32, 1.4125], [-0.525, 0.32, -1.4], [0.525, 0.32, -1.4]]);

/* Every triangle in one piece or the other; the nose wholly in front of the
 * door line, the cabin the windscreen and everything behind it */
const s = D.splitBody(rom, 1460);
assert.equal(s.nose.length + s.cabin.length, 604);
assert.equal(s.nose.length, 246);
for (const t of s.nose) for (let k = 2; k < 9; k += 3) assert.ok(t[k] <= D.CUT_Z + 0.005);
const zs = s.cabin.flatMap(t => [t[2], t[5], t[8]]);
assert.ok(Math.min(...zs) > -0.92 && Math.max(...zs) > 2.4);

/* FM's two pieces share an origin: slot 1's face at x = 7 is slot 9's at
 * x = −7, turned half a turn about z */
const disc = process.env.FM_DISC ?? FM.DEFAULT_DISC;
if (existsSync(disc)) {
    const game = FM.readGame(disc), hornet = game.fighters[14];
    assert.equal(FM.slotTable(game, 14), FM.HORNET_SLOTS);
    const slots = FM.readModel(game.archive(130), FM.HORNET_SLOTS);
    assert.equal(slots.length, 41);
    assert.deepEqual(slots.map((x, i) => x && x.points.length > 1 ? i : -1).filter(i => i >= 0), [0, 1, 5, 8, 9, 12, 15, 16, 20, 23, 24, 27, 30]);
    const face = (pts, x, sx) => pts.filter(p => Math.round(p[0]) === x).map(p => `${Math.round(sx * p[1])},${Math.round(p[2])}`).sort();
    assert.deepEqual(face(slots[1].points, 7, -1), face(slots[9].points, -7, 1));
    for (const q of slots[1].polygons) for (const i of q) assert.ok(i < slots[1].points.length);

    /* The second nose and cabin are the armour-broken ones, on the same
     * joints */
    assert.deepEqual(FM.readBreaks(game, hornet), [[16, 1], [24, 9]]);
    assert.deepEqual(FM.readBreaks(game, game.fighters[16]), []);

    /* The car pose: the nose (chest) on the cabin (pelvis), turned half a
     * turn about z, both at the body's place; the wheels on the hands and
     * feet, where Daytona's tires are along the car and up it. FM's hubs
     * sit wider apart (0.63 and 0.69 m against 0.525). */
    const pose = FM.poseFighter(game, hornet, D.CAR_POSE, 1);
    const nose = FM.inFrameOf(pose, 1, 9);
    assert.ok(Math.hypot(...nose.t) < 1e-6);
    [-1, 0, 0, 0, -1, 0, 0, 0, 1].forEach((v, i) => assert.ok(Math.abs(nose.r[i] - v) < 0.03, `nose axis ${i}`));
    const at = Object.fromEntries(Object.keys(D.WHEEL_SLOTS).map(s => [s, D.fmToDaytona(FM.inFrameOf(pose, +s, 9).t)]));
    for (const [l, r] of [[5, 8], [12, 15]]) {
        const hub = car.tires[D.WHEEL_SLOTS[r]].hub;
        assert.equal(car.tires[D.WHEEL_SLOTS[l]].hub[2], hub[2]);
        assert.ok(Math.abs((at[l][2] + at[r][2]) / 2 - hub[2]) < 0.05, `axle ${l}, ${r} along`);
        assert.ok(Math.abs((at[l][1] + at[r][1]) / 2 - hub[1]) < 0.05, `axle ${l}, ${r} up`);
        assert.ok(at[l][0] < 0 && at[r][0] > 0);
        const half = (at[r][0] - at[l][0]) / 2;
        assert.ok(half > hub[0] && half < hub[0] + 0.2, `axle ${l}, ${r} track ${half}`);
    }
}
/* The objects: every polygon the geometrizer draws, as it walks them */
for (const m of [1460, 1462, 805, 806]) assert.equal(D.readObject(rom, m).length, decodeModel(rom, m).faceCount, `model ${m}`);
/* The windows (in RAM): nine panes, each on the body's or the glass's corners */
const panes = D.readRamObject(rom, car.windows), corners = new Set([1460, 1462].flatMap(m => D.readObject(rom, m)).flatMap(q => q.p.map(String)));
assert.equal(panes.length, 9);
for (const q of panes) for (const p of q.p) assert.ok(corners.has(String(p)), `pane corner ${p}`);

if (existsSync(disc)) {
    const game = FM.readGame(disc);
    const fm = FM.readModel(game.archive(130), FM.HORNET_SLOTS);
    const objs = D.hornetObjects(rom, fm, { modelUnits: FM.MODEL_UNITS });
    assert.deepEqual(objs.map(o => `${o.slot}:${o.name}`), ['1:nose', '9:cabin', '9:windows', '9:glass', '16:nose', '24:cabin', '24:windows', '24:glass',
        '5:wheel', '8:wheel', '12:wheel', '15:wheel', '20:wheel', '23:wheel', '27:wheel', '30:wheel']);
    const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (const o of objs) {
        /* Walked back, the drawn polygons are the placed ones: points (as
         * float32), corners, texture points and headers; the rest culled */
        const all = D.walkObject({ mesh: dv(o.mesh), at: 0, uv: dv(o.uv), uvAt: 0, th: dv(o.th), thAt: 0 });
        assert.equal(all.length, o.count);
        const drawn = all.filter(q => (q.attr >> 8) & 3);
        assert.equal(drawn.length, o.polys.length);
        drawn.forEach((q, i) => {
            const r = o.polys[i];
            assert.equal(q.quad, r.quad);
            assert.deepEqual(q.p, r.p.map(p => p.map(Math.fround)));
            assert.deepEqual([q.uv, q.th, q.attr & 0x3ff], [r.uv, r.th, r.attr & 0x3ff]);
        });
        assert.equal(o.uv.length, all.reduce((n, q) => n + (q.quad ? 8 : 6), 0));
        assert.equal(o.th.length, 4 * o.count);
        assert.equal(o.mesh.length, D.POINT_BYTES + D.RECORD_BYTES * o.count + 16);
    }

    /* noclip's decode of the nose and cabin is splitBody's triangles, moved
     * into slots 1 and 9 */
    const N = (p) => [p[0], p[1], -p[2]];
    const key = (P) => { const t = []; for (let i = 0; i < P.length; i += 9) t.push(Array.from(P.slice(i, i + 9), v => v.toFixed(4)).join()); return t.sort(); };
    for (const [slot, tris] of [[1, s.nose], [9, s.cabin]]) {
        const o = objs.find(x => x.slot === slot), m = D.bodyMap(slot, FM.MODEL_UNITS);
        const got = decodeModel(rom, -1, o.uv, { bytes: o.mesh, uvPtr: 0, matPtr: 0 }).positions;
        const want = tris.flatMap(t => [0, 3, 6].flatMap(k => N(D.applyMap(m, N(t.slice(k, k + 3))))));
        assert.deepEqual(key(got), key(Float32Array.from(want)), `slot ${slot}`);
    }

    /* In FM's units on FM's axes, each lies where FM's own piece does: the
     * nose and cabin within a few units (FM's floor reaches 16 further
     * forward), each wheel's tyre on FM's, its outside on FM's dished side */
    const box = (P) => [0, 1, 2].map(a => [Math.min(...P.map(p => p[a])), Math.max(...P.map(p => p[a]))]);
    const near = (a, b, d, what) => a.forEach((r, i) => r.forEach((v, j) => assert.ok(Math.abs(v - b[i][j]) <= d[i], `${what} axis ${i}: ${v} against ${b[i][j]}`)));
    const fmBox = (o) => box(o.polys.flatMap(q => q.p).map(p => N(p).map(v => v * FM.MODEL_UNITS)));
    near(fmBox(objs[0]), box(fm[1].points), [6, 3, 3], 'nose');
    const cabin = fmBox(objs[1]);
    near(cabin.slice(1), box(fm[9].points).slice(1), [3, 5], 'cabin');
    assert.ok(Math.abs(cabin[0][1] - box(fm[9].points)[0][1]) < 1 && cabin[0][0] - box(fm[9].points)[0][0] < 17);
    for (const slot of [5, 8, 12, 15]) {
        const o = objs.find(x => x.slot === slot), m = D.wheelMap(D.readObject(rom, o.model).flatMap(q => q.p), fm[slot].points, FM.MODEL_UNITS);
        assert.equal(m.axle, slot < 10 ? 2 : 0);
        assert.equal(m.sigma, slot === 5 || slot === 12 ? 1 : -1);
        near(fmBox(o), box(fm[slot].points), [4, 4, 4].map((d, a) => (a === m.axle ? 2 : d)), `wheel ${slot}`);
        /* Daytona's rim and hub (805's x -0.33..-0.40, 806's +) on FM's dished side */
        const rim = D.readObject(rom, o.model).flatMap(q => q.p).filter(p => Math.abs(p[0]) > 0.33);
        const c = (box(fm[slot].points)[m.axle][0] + box(fm[slot].points)[m.axle][1]) / 2;
        assert.ok(rim.length > 0);
        for (const p of rim) assert.ok((N(D.applyMap(m, p))[m.axle] * FM.MODEL_UNITS - c) * m.sigma > 15, `wheel ${slot} rim`);
    }

    /* FM's model units: FM Akira's meshes (file 147) against VF2 Akira's in
     * noclip's decode, part by part. The same axes the same way round (his
     * head up +z, his toes down -z), about 300 units to the metre (the
     * meshes are not the same, so the parts' spans scatter around it). */
    const vf2Zip = `${process.env.ROMS_DIR || `${process.env.HOME}/build/mameroms`}/vf2.zip`;
    if (existsSync(vf2Zip)) {
        const b = (await import('node:fs')).readFileSync(vf2Zip);
        const vf2 = await loadRomSet([b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)], () => {}, { game: 'vf2' });
        const A = readFighters(vf2)[0], akira = FM.readModel(game.archive(147), FM.slotTable(game, 16));
        const ratios = [];
        for (let slot = 1; slot < 16; slot++) {
            const P = decodeModel(vf2, A.parts[slot].model).positions, v = [];
            for (let i = 0; i < P.length; i += 3) v.push([P[i], P[i + 1], P[i + 2]]);
            const f = box(akira[slot].points), g = box(v);
            for (let a = 0; a < 3; a++) ratios.push((f[a][1] - f[a][0]) / (g[a][1] - g[a][0]));
            if ([2, 12, 15].includes(slot)) assert.equal(Math.sign(f[2][0] + f[2][1]), Math.sign(g[2][0] + g[2][1]), `slot ${slot} z`);
        }
        ratios.sort((x, y) => x - y);
        const median = ratios[ratios.length >> 1];
        assert.ok(median > 280 && median < 300, `FM units a VF2 metre ${median}`);
    }
}
console.log(`daytona-hornet: ok (nose ${s.nose.length}, cabin ${s.cabin.length} triangles)`);
