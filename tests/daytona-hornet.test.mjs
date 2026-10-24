/* Daytona USA's Hornet (tools/daytona-hornet.mjs): the player's car where the
 * program draws it from, cut where FM's Hornet is cut. Skipped without
 * daytona.zip; FM's half skipped without the FM disc. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as D from '../tools/daytona-hornet.mjs';
import * as FM from '../tools/fm-saturn.mjs';

if (!existsSync(D.DEFAULT_ROM)) { console.log(`daytona-hornet: skipped, no ${D.DEFAULT_ROM}`); process.exit(0); }

const rom = await D.loadDaytona();
const car = D.readCar(rom);
assert.deepEqual(car.body, [1460, 1461, 1835]);
assert.deepEqual(car.glass, [1462, 1463, 1793]);
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
if (existsSync(process.env.FM_DISC ?? FM.DEFAULT_DISC)) {
    const game = FM.readGame(process.env.FM_DISC);
    const slots = FM.readModel(game.archive(130), FM.HORNET_SLOTS);
    assert.deepEqual(slots.map((x, i) => x && x.points.length > 1 ? i : -1).filter(i => i >= 0), [0, 1, 5, 8, 9, 12, 15, 16, 35, 48, 49, 62, 75]);
    const face = (pts, x, sx) => pts.filter(p => Math.round(p[0]) === x).map(p => `${Math.round(sx * p[1])},${Math.round(p[2])}`).sort();
    assert.deepEqual(face(slots[1].points, 7, -1), face(slots[9].points, -7, 1));
    for (const q of slots[1].polygons) for (const i of q) assert.ok(i < slots[1].points.length);
}
console.log(`daytona-hornet: ok (nose ${s.nose.length}, cabin ${s.cabin.length} triangles)`);
