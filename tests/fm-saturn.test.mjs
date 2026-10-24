/* Fighters Megamix's motions (tools/fm-saturn.mjs): every fighter's decode
 * and come out of VF2's block the same at their keys; FM's Akira plays as
 * VF2's own Akira past the first key. Skipped without the FM disc. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as FM from '../tools/fm-saturn.mjs';
import { encodeVF2 } from '../tools/shenmue-motion.mjs';
import * as M from '../vendor/noclip/js/motion.js';
import { loadNodeGames } from './node-roms.mjs';

const disc = process.env.FM_DISC ?? FM.DEFAULT_DISC;
if (!existsSync(disc)) { console.log(`fm-saturn: skipped, no ${disc}`); process.exit(0); }

/* A block's channels the way noclip's decodeMotion lays them out, all of it */
function channels(b) {
    const { channels: ch, end } = FM.vf2Channels(b);
    assert.equal(end, b.length);
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
/* Hornet's moves, as docs/FM-SATURN.md lists them: every motion from his
 * bank is one of the 103 in file 135, the others are in the common bank,
 * and the table is what the script says */
const hornet = game.fighters[14];
const own = new Set(FM.readBank(game.archive(hornet.motions)).map(r => r.id));
const common = new Set(FM.readBank(game.archive(FM.COMMON_MOTIONS)).map(r => r.id));
assert.equal(own.size, 103);
const doc = readFileSync(new URL('../docs/FM-SATURN.md', import.meta.url), 'utf8');
const listed = [...doc.split('### Hornet\'s')[1].matchAll(/^\| (0x[\da-f, x]+) \| (0x[\da-f]{8}) \| (\S+) \| (\S+) \| (\S+) \|$/gm)]
    .map(([, at, move, motion, frames, bank]) => ({ at, move, motion, frames, bank }));
assert.equal(listed.length, 81);
for (const m of listed) {
    if (m.bank === '135') assert.ok(own.has(parseInt(m.motion, 16)), `${m.move}: ${m.motion} isn't in file 135`);
    else if (m.bank === '352') assert.ok(common.has(parseInt(m.motion, 16)) && !own.has(parseInt(m.motion, 16)), m.move);
    else assert.equal(m.motion, '-', m.move);
}
const h = (v, n) => `0x${v.toString(16).padStart(n, '0')}`, read = new Map();
for (const m of FM.readMoves(game, hornet)) {
    const k = h(m.move, 8), r = read.get(k);
    if (r) r.at += `, ${h(m.at, 4)}`;
    else read.set(k, { at: h(m.at, 4), move: k, motion: m.motion === null ? '-' : h(m.motion, 0),
        frames: String(m.frames ?? '-'), bank: String(m.bank ?? '-') });
}
assert.deepEqual(listed, [...read.values()]);

/* every fighter's script decodes to its move list, its jumps land on opcodes,
 * and its motions are in its bank or the common one */
const JUMPS = { 0x0d: [4], 0x0e: [8], 0x0f: [4], 0x11: [4], 0x27: [4], 0x28: [4, 8, 12], 0x38: [4] };
for (const f of game.fighters) {
    const buf = game.archive(f.file9), ops = FM.readScript(buf), at = new Set(ops.map(o => o.at)), last = ops.at(-1);
    assert.equal(buf.readUInt32BE(last.at + last.bytes.length) & 0xffffff, 0xffffff, f.name);
    for (const o of ops) for (const k of JUMPS[o.op] ?? []) assert.ok(at.has(o.bytes.readUInt32BE(k)), `${f.name} ${h(o.at, 4)}`);
    for (const m of FM.readMoves(game, f)) assert.ok(m.motion === null || m.bank !== null, `${f.name} ${h(m.move, 8)}`);
}

console.log(`fm-saturn: ${motions} motions, Hornet's ${listed.length} moves ok`);
