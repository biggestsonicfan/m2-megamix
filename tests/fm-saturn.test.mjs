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
 * and the table, kinds and inputs too, is what the script says */
const hornet = game.fighters[14];
const own = new Set(FM.readBank(game.archive(hornet.motions)).map(r => r.id));
const common = new Set(FM.readBank(game.archive(FM.COMMON_MOTIONS)).map(r => r.id));
assert.equal(own.size, 103);
const doc = readFileSync(new URL('../docs/FM-SATURN.md', import.meta.url), 'utf8');
const listed = [...doc.split('### Hornet\'s')[1].matchAll(
    /^\| (0x[\da-f, x]+) \| (0x[\da-f]{8}) \| (\S+) \| (\S+) \| (\S+) \| (0x[\da-f]{2}) \| (0x[\da-f]{2}) \|(?: ([\d, ]+))? \| (.+) \|$/gm)]
    .map(([, at, move, motion, frames, bank, kind, parameter, slots, input]) => ({ at, move, motion, frames, bank, kind, parameter, input }));
const listedSlots = new Map([...doc.split('### Hornet\'s')[1].matchAll(
    /^\| 0x[\da-f, x]+ \| (0x[\da-f]{8}) \|(?: \S+ \|){5}(?: ([\d, ]+))? \| .+ \|$/gm)].map(([, move, s]) => [move, s ?? '']));
assert.equal(listedSlots.size, 81);
assert.equal(listed.length, 81);
for (const m of listed) {
    if (m.bank === '135') assert.ok(own.has(parseInt(m.motion, 16)), `${m.move}: ${m.motion} isn't in file 135`);
    else if (m.bank === '352') assert.ok(common.has(parseInt(m.motion, 16)) && !own.has(parseInt(m.motion, 16)), m.move);
    else assert.equal(m.motion, '-', m.move);
}
const h = (v, n) => `0x${v.toString(16).padStart(n, '0')}`, read = new Map(), inputs = new Map();
const hornetMoves = FM.readMoves(game, hornet);
for (const m of hornetMoves) {
    const k = h(m.move, 8), r = read.get(k);
    if (!inputs.has(k)) inputs.set(k, []);
    inputs.get(k).push(`${h(m.at, 4)}: ${m.input || '(unreached)'}`);
    if (r) r.at += `, ${h(m.at, 4)}`;
    else read.set(k, { at: h(m.at, 4), move: k, motion: m.motion === null ? '-' : h(m.motion, 0),
        frames: String(m.frames ?? '-'), bank: String(m.bank ?? '-'), kind: h(m.kind, 2), parameter: h(m.parameter, 2) });
}
for (const [k, r] of read) { const i = inputs.get(k); r.input = i.length === 1 ? i[0].slice(8) : i.join('; '); }
assert.deepEqual(listed, [...read.values()]);
/* a few read by hand off the script: the dashes, a follow-up, a throw-like
 * P+G, an air attack, and the dead block at 0x0A28 */
const inputAt = at => hornetMoves.find(m => m.at === at).input;
assert.equal(inputAt(0x0bd4), 'f,n,f');
assert.equal(inputAt(0x0bf4), 'b,n,b');
assert.equal(inputAt(0x0250), 'after 0x4da: P');
assert.equal(inputAt(0x08e0), 'b+P+G [+0&10000000 +578&1]');
assert.equal(inputAt(0x0d60), 'air 3 b+K [+0&10000000]');
assert.equal(inputAt(0x0a84), '');

/* the Kinds table: each kind Hornet's moves use, its handlers' addresses, and
 * what those handlers play, test and compare */
const kindsDoc = doc.split('### Kinds')[1].split('\n## ')[0];
const kinds = kindsDoc.split('\n').filter(l => /^\| 0x[\da-f]{2} \| 0x/.test(l)).map(l => ['', ...l.split('|').slice(1, -1).map(c => c.trim())]);
assert.deepEqual(kinds.map(([, k]) => k), [...new Set(hornetMoves.map(m => h(m.kind, 2)))].sort());
const list = c => c.trim() ? c.trim().split(', ') : [];
for (const [, k, accept, run, plays, bits, dists, does] of kinds) {
    const kind = parseInt(k, 16), r = FM.readKind(game, kind);
    assert.equal(h(game.prg.readUInt32BE(game.at(FM.KIND_HANDLERS + 8 * kind)), 8), accept, `kind ${k} accept`);
    assert.equal(h(game.prg.readUInt32BE(game.at(FM.KIND_HANDLERS + 8 * kind + 4)), 8), run, `kind ${k} run`);
    const [motion, slots] = plays.trim().startsWith('motion') ? [true, plays.trim().slice(8)] : [false, plays];
    assert.equal(r.motion, motion, `kind ${k} plays the motion`);
    assert.deepEqual(r.slots, list(slots).map(Number), `kind ${k} slots`);
    assert.deepEqual(r.bits, list(bits).map(Number), `kind ${k} bits`);
    assert.deepEqual(r.dists, list(dists).map(Number), `kind ${k} distances`);
    /* and the sentence quotes only those slots and distances */
    for (const [, n] of does.matchAll(/slot (\d+)/g)) assert.ok(r.slots.includes(+n), `kind ${k}: slot ${n}`);
    for (const [, n] of does.matchAll(/(\d+\.\d) away/g)) assert.ok(r.dists.includes(+n), `kind ${k}: ${n} away`);
}
const jumpBits = [...kindsDoc.split('Kind 9\'s parameter bits')[1].matchAll(/^\| (0x[\da-f]{2}) \| (.+) \|$/gm)];
assert.deepEqual(jumpBits.map(([, b]) => Number(b)), FM.readKind(game, 9).bits);
assert.deepEqual([...new Set(hornetMoves.filter(m => m.kind === 9).map(m => m.parameter))].sort((a, b) => a - b), [0, 4, 8, 12, 20]);

/* Bits 0x40 and 0x80: every test of them in kind 9's handlers, the flag
 * tests in front of each, what each branch does, and that Hornet never sets
 * them, against a fresh read; a changed claim fails */
const [accept9, run9] = [0, 4].map(o => game.prg.readUInt32BE(game.at(FM.KIND_HANDLERS + 72 + o)));
const armText = r => [...r.clears ? ['clears the bit'] : [],
    ...r.plays.map(p => p === 'request' ? 'plays the request\'s motion' : `plays motion ${h(p, 0)}`),
    ...r.stores ? ['stores the request in +0x70'] : [],
    ...r.next ? [`goes on to the ${h(r.next.bit, 2)} test at ${h(r.next.at, 8)}`] : []].join('; ') || 'plays no motion';
function checkBits(text) {
    const rows = [...text.matchAll(/^\| (accept|run) \| (0x[\da-f]{2}) \| (0x[\da-f]{8}) \| (.+?) \| (.+?) \| (.+?) \|$/gm)];
    assert.deepEqual(rows.map(([, handler, bit, at, , set, clear]) => ({ handler, bit, at, set, clear })),
        FM.readBitTests(game, 9, [0x40, 0x80]).map(t => ({ handler: t.handler, bit: h(t.bit, 2), at: h(t.at, 8),
            set: armText(t.set), clear: armText(t.clear) })));
    const tested = new Set(rows.map(r => r[3]));
    for (const [, handler, , at, behind] of rows) for (const g of behind.split('; ')) {
        const [, via, field, mask, way] = g.match(/^(0x[\da-f]{8}) \+(0x[\da-f]+) & (0x[\da-f]{8}) (set|clear)$/) ?? [];
        assert.ok(via, `${at}: ${g}`);
        const start = handler === 'accept' ? accept9 : run9, t = FM.handlerTest(game, start, parseInt(via, 16));
        assert.deepEqual(t, { field: parseInt(field, 16), mask: parseInt(mask, 16) }, `${at} behind ${via}`);
        assert.ok(t.field !== 0x3c && t.field !== 0x70, `${via} is a parameter test, not a flag`);
        assert.equal(FM.guard(game, start, parseInt(via, 16), parseInt(at, 16)), way, `${at} behind ${via}`);
        tested.add(via);
    }
    const [, nAccept, nRun] = text.match(/(\w+) times in the accept handler[^]*?(\w+)\s+times in the run handler/);
    const words = ['none', 'once', 'twice', 'three', 'four'];
    assert.equal(words.indexOf(nAccept), rows.filter(r => r[1] === 'accept').length);
    assert.equal(words.indexOf(nRun), rows.filter(r => r[1] === 'run').length);
    /* only kind 9 of Hornet's kinds tests them */
    assert.match(text, /^Of the kinds Hornet uses, only kind 9's handlers test these two bits/);
    for (const k of new Set(hornetMoves.map(m => m.kind))) if (k !== 9) assert.deepEqual(FM.readBitTests(game, k, [0x40, 0x80]), [], `kind ${k}`);
    /* the bullets: addresses are the table's, or the stage branch in front of the accept rows */
    for (const [a] of text.split('\n- ').slice(1).join('\n').matchAll(/0x0600[\da-f]{4}/g)) {
        if (a === '0x0600db2e') {
            /* guard's 'clear' is T set, as a tst of a clear bit sets it: here stage > 1 */
            for (const r of rows.filter(r => r[1] === 'accept')) assert.equal(FM.guard(game, accept9, 0x0600db2c, parseInt(r[3], 16)), 'clear');
            assert.equal(game.prg.readUInt16BE(game.at(0x0600db2c)) & 0xf00f, 0x3007);   /* cmp/gt: the stage > 1 */
        } else assert.ok(tested.has(a), `bullet's ${a}`);
    }
    for (const [, id, file, frames] of text.matchAll(/motion (0x[\da-f]+) \(file (\d+), (\d+) frames\)/g))
        assert.equal(FM.readBank(game.archive(+file)).find(r => r.id === parseInt(id, 16))?.frames, +frames, id);
    const [, n, nine] = text.match(/none of his (\d+) requests' parameter bytes\s+has 0x40 or 0x80 \(his kind 9 ones are ([^)]+)\)/);
    assert.equal(+n, hornetMoves.length);
    assert.equal(hornetMoves.filter(m => m.parameter & 0xc0).length, 0);
    assert.deepEqual(nine.replace(' and', ',').split(', ').map(Number),
        [...new Set(hornetMoves.filter(m => m.kind === 9).map(m => m.parameter))].sort((a, b) => a - b));
}
const bitsDoc = kindsDoc.split('#### Bits 0x40 and 0x80\n\n')[1];
checkBits(bitsDoc);
for (const [from, to] of [['| 0x0600dce0 |', '| 0x0600dce2 |'], ['| plays motion 0x8b3 |', '| plays motion 0x8b4 |'],
    ['0x0600dc80 +0x6c0 & 0x02000000 clear', '0x0600dc80 +0x6c0 & 0x02000000 set'], ['0x0600ed36 +0x6c0 & 0x00001000', '0x0600ed36 +0x6c0 & 0x00002000'],
    ['| run | 0x40 |', '| run | 0x80 |'], ['| clears the bit; plays the request\'s motion | plays no motion |\n| run | 0x40', '| plays no motion | clears the bit; plays the request\'s motion |\n| run | 0x40'],
    ['goes on to the 0x08 test', 'goes on to the 0x04 test'], ['three\ntimes in the run', 'twice\ntimes in the run'],
    ['only at 0x0600eeca', 'only at 0x0600eecc'], ['39 frames', '40 frames'], ['none of his 95', 'none of his 94'], ['0x0C and 0x14', '0x0C and 0x10']]) {
    assert.ok(bitsDoc.includes(from), from);
    assert.throws(() => checkBits(bitsDoc.replace(from, to)), `${from} -> ${to}`);
}

/* the Slots table: each slot the kinds play, against a fresh read of Hornet's
 * action table and banks; its Kinds column is the Kinds table's Plays */
const slotsDoc = doc.split('### Slots')[1].split('\n## ')[0];
const slotRows = [...slotsDoc.matchAll(/^\| (\d+) \| (0x[\da-f]+) \| (\d+) \| (\d+) \| ([\da-fx, ]+) \|$/gm)]
    .map(([, slot, motion, frames, bank, ks]) => ({ slot: +slot, motion, frames, bank, kinds: ks.split(', ') }));
const playedBy = new Map();
for (const [, k] of kinds) for (const n of FM.readKind(game, parseInt(k, 16)).slots) playedBy.set(n, [...playedBy.get(n) ?? [], k]);
assert.deepEqual(slotRows.map(r => r.slot), [...playedBy.keys()].sort((a, b) => a - b));
assert.deepEqual(slotRows.map(({ slot, motion, frames, bank }) => ({ slot, motion, frames, bank })),
    FM.readSlots(game, hornet, slotRows.map(r => r.slot)).map(s => ({ slot: s.slot, motion: h(s.motion, 0),
        frames: String(s.frames), bank: String(s.bank) })));
for (const r of slotRows) assert.deepEqual(r.kinds, playedBy.get(r.slot), `slot ${r.slot} kinds`);
/* every number the Kinds sentences and the kind 9 bit table say, bar bits,
 * frames, kinds, stages and decimals, is a slot, and has a row */
const named = kindsDoc.split('\n').filter(l => /^\| 0x/.test(l)).map(l => l.split('|').at(-2))
    .flatMap(t => [...t.matchAll(/(?<![\w.+\u2212-]|bit |frame |kind |≤ |is )(\d+)(?![\w.]| frames?)/g)].map(m => +m[1]));
assert.deepEqual([...new Set(named)].sort((a, b) => a - b), slotRows.map(r => r.slot), 'the slots the sentences name');
/* the Moves table's Slots column: kind 9's are the slots its parameter bits
 * pick in the kind 9 bit table (0x04: 46, or 47 with 0x02; 0x20: 48), any
 * other kind's the slots its Kinds sentence names (none for kind 0, 0x10 and
 * 0x2d), in order, and each is a Slots row. Checked against a fresh read of
 * the script; a wrong slot, or a kind 0 row with one, fails. */
const bitRow = b => jumpBits.find(([, x]) => Number(x) === b)[2];
assert.match(bitRow(0x04), /slot 46 \(47 if also 0x02\)/);
assert.match(bitRow(0x20), /slot 48/);
const sentenceSlots = new Map(kinds.map(([, k, , , , , , does]) => [parseInt(k, 16), [...new Set([...does.matchAll(
    /(?<![\w.+\u2212-]|bit |frame |kind |≤ |is )(\d+)(?![\w.]| frames?)/g)].map(m => +m[1]))].sort((a, b) => a - b)]));
const ruleSlots = (kind, p) => kind !== 9 ? sentenceSlots.get(kind)
    : [...(p & 0x04 ? [p & 0x02 ? 47 : 46] : []), ...(p & 0x20 ? [48] : [])].sort((a, b) => a - b);
function checkSlots(column) {
    for (const m of hornetMoves) {
        const k = h(m.move, 8), want = ruleSlots(m.kind, m.parameter).join(', ');
        assert.equal(column.get(k), want, `${k} slots`);
        assert.equal(FM.moveSlots(game, m).join(', '), want, `${k}: moveSlots`);
        for (const n of list(want)) assert.ok(slotRows.some(r => r.slot === +n), `${k}: slot ${n} has no Slots row`);
    }
}
checkSlots(listedSlots);
for (const [k, s] of [['0x1a000000', '22, 23, 41, 42, 44'], ['0x0914013a', '47'], ['0x00000712', '22'], ['0x09080314', '45']])
    assert.throws(() => checkSlots(new Map([...listedSlots, [k, s]])), `${k} as ${s}`);
assert.equal(ruleSlots(0, 0).length + ruleSlots(0x10, 4).length + ruleSlots(0x2d, 0).length, 0);
/* the motion kind 0x1a names in its code, not a slot */
assert.equal(FM.readBank(game.archive(FM.COMMON_MOTIONS)).find(r => r.id === 0x725).frames, 40);

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
