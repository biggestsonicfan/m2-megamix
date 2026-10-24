/* Fighters Megamix's motions (tools/fm-saturn.mjs): every fighter's decode
 * and come out of VF2's block the same at their keys; FM's Akira plays as
 * VF2's own Akira past the first key. Skipped without the FM disc. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as FM from '../tools/fm-saturn.mjs';
import { encodeVF2 } from '../tools/shenmue-motion.mjs';
import * as M from '../vendor/noclip/js/motion.js';
import { loadNodeGames } from './node-roms.mjs';

const disc = process.env.FM_DISC ?? FM.DEFAULT_DISC;
if (!existsSync(disc)) { console.log(`fm-saturn: skipped, no ${disc}`); process.exit(0); }

/* A block's channels the way noclip's decodeMotion lays them out */
function channels(b) {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength), types = [];
    for (let j = 0; j < 20; j++) {
        const x = b[2 + j], top = x >> 6;
        for (let a = 0; a < 3; a++) types.push(top === 0 ? ((x >> (2 * a)) & 3) + 3 : top - 1);
    }
    let n = 0;
    const ch = types.map(type => ({ type, count: type === M.LINEAR || type === M.HERMITE ? b[22 + n++] : 0, view }));
    let p = (22 + n + 3) & ~3;
    for (const c of ch) if (c.count) { c.times = p; p += 4 * c.count; }
    for (const c of ch) {
        if (c.type === M.ZERO) continue;
        c.values = p;
        p += c.count ? c.count * (c.type === M.HERMITE ? 12 : 4) : 4;
    }
    assert.equal(p, b.length);
    return ch;
}

const game = FM.readGame(disc);
let motions = 0;
for (const f of game.fighters) {
    const bank = game.archive(f.motions);
    for (const r of FM.readBank(bank)) {
        const m = FM.decodeFM(bank, r.data), ch = channels(encodeVF2(FM.toVF2(m)));
        m.channels.forEach((c, i) => {
            if (c.type === 'zero') return;
            const { channel, scale } = FM.vf2Channel(i);
            const times = c.times ?? [1];
            const values = c.type === 'const' ? [c.value] : c.type === 'linear' ? c.values : c.keys.map(k => k.value);
            times.forEach((t, j) => assert.ok(Math.abs(M.evalChannel(null, ch[channel], t) - values[j] * scale) < 1e-2,
                `${f.name} 0x${r.id.toString(16)} channel ${i} frame ${t}`));
        });
        motions++;
    }
}
assert.equal(motions, 3686);
assert.equal(FM.readBank(game.archive(game.fighters[14].motions)).length, 103);

/* FM Akira's 0x53 is VF2's motion 11: under a degree (a centimetre) apart
 * past the first segment, the one FM's first out-tangent draws differently */
const rom = (await loadNodeGames()).vf2.rom;
const bank = game.archive(game.fighters[16].motions);
const v = FM.toVF2(FM.decodeFM(bank, FM.readBank(bank).find(r => r.id === 0x53).data));
const ours = channels(encodeVF2(v)), vf2 = M.decodeMotion(rom, 11);
assert.equal(v.frames, vf2.frames);
for (let c = 0; c < 60; c++) {
    if (c >= 51 && c < 54) continue;
    for (let f = v.channels[c].times[1] ?? 1; f <= v.frames; f++) {
        let e = Math.abs(M.evalChannel(null, ours[c], f) - M.evalChannel(rom, vf2.channels[c], f));
        e = c < 36 ? Math.min(e % 65536, 65536 - e % 65536) / 65536 * 360 : e * 100;
        assert.ok(e < 1, `channel ${c} frame ${f}: ${e}`);
    }
}
console.log(`fm-saturn: ${motions} motions ok`);
