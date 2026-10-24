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
const bitsDoc = kindsDoc.split('#### Bits 0x40 and 0x80\n\n')[1].split('\n#### ')[0];
checkBits(bitsDoc);
for (const [from, to] of [['| 0x0600dce0 |', '| 0x0600dce2 |'], ['| plays motion 0x8b3 |', '| plays motion 0x8b4 |'],
    ['0x0600dc80 +0x6c0 & 0x02000000 clear', '0x0600dc80 +0x6c0 & 0x02000000 set'], ['0x0600ed36 +0x6c0 & 0x00001000', '0x0600ed36 +0x6c0 & 0x00002000'],
    ['| run | 0x40 |', '| run | 0x80 |'], ['| clears the bit; plays the request\'s motion | plays no motion |\n| run | 0x40', '| plays no motion | clears the bit; plays the request\'s motion |\n| run | 0x40'],
    ['goes on to the 0x08 test', 'goes on to the 0x04 test'], ['three\ntimes in the run', 'twice\ntimes in the run'],
    ['only at 0x0600eeca', 'only at 0x0600eecc'], ['39 frames', '40 frames'], ['none of his 95', 'none of his 94'], ['0x0C and 0x14', '0x0C and 0x10']]) {
    assert.ok(bitsDoc.includes(from), from);
    assert.throws(() => checkBits(bitsDoc.replace(from, to)), `${from} -> ${to}`);
}

/* The flags behind them: the Behind column's distinct flag tests, each side
 * of each followed on a fresh read; every address in a cell must do what
 * the words before it say and be reachable from that side; a changed claim
 * fails */
const PLAYS = 0x060131d0, word = a => game.prg.readUInt16BE(game.at(a));
const flagText = (field, mask) => `+${h(field, 2)} & ${h(mask, 8)}`;
function checkFlags(text, bits) {
    const behind = new Map();
    for (const [, handler, , , via] of bits.matchAll(/^\| (accept|run) \| (0x[\da-f]{2}) \| (0x[\da-f]{8}) \| (.+?) \|/gm))
        for (const g of via.split('; ')) {
            const [, at, flag] = g.match(/^(0x[\da-f]{8}) (\+0x[\da-f]+ & 0x[\da-f]{8}) (set|clear)$/);
            behind.set(at, `${handler} ${flag}`);
        }
    const rows = [...text.matchAll(/^\| (0x[\da-f]{8}) \| (accept|run) \| (\+0x[\da-f]+ & 0x[\da-f]{8}) \| (.*?) \| (.*?) \|$/gm)];
    /* both sides, on every row */
    for (const [, at, , , set, clear] of rows) assert.ok(set.trim() && clear.trim(), `${at}: a row needs its set side and its clear side`);
    assert.deepEqual(rows.map(([, at, handler, flag]) => [at, `${handler} ${flag}`]), [...behind].sort(([a], [b]) => parseInt(a, 16) - parseInt(b, 16)));
    const named = new Set(rows.map(r => r[3]));
    assert.match(text, new RegExp(`^The ${['', '', '', '', '', '', 'six'][rows.length]} distinct flag tests`));
    for (const [, atText, handler, flag, ...cells] of rows) {
        const at = parseInt(atText, 16), start = handler === 'accept' ? accept9 : run9, t = FM.handlerTest(game, start, at);
        assert.equal(flagText(t.field, t.mask), flag, atText);
        const b = word(at + 2), target = ((b & 0xff) << 24 >> 24) * 2 + at + 6;
        assert.equal(b & 0xfd00, 0x8900, `${atText}: bt/bf`);
        const sides = b & 0x0200 ? [target, at + 4] : [at + 4, target];   /* set, clear */
        cells.forEach((cell, s) => {
            const from = sides[s], where = `${atText} ${['set', 'clear'][s]}`;
            const reach = a => assert.ok(FM.handlerReaches(game, start, from, a, [at]), `${where}: ${h(a, 8)} out of reach`);
            const reg = (a, r) => FM.handlerReg(game, start, a, r), regs = a => Array.from({ length: 16 }, (_, r) => reg(a, r));
            const isField = (v, f, size) => v?.field === f && (!size || v.size === size);
            const claimed = new Set();
            /* stops: a flag test not in the Behind column */
            for (const [all, a, f] of cell.matchAll(/stops at (0x[\da-f]{8}) \((\+0x[\da-f]+ & 0x[\da-f]{8})\)/g)) {
                const y = parseInt(a, 16), st = FM.handlerTest(game, start, y);
                assert.equal(st && flagText(st.field, st.mask), f, `${where}: ${all}`);
                assert.ok(!named.has(f) && st.field !== 0x3c && st.field !== 0x70, `${where}: ${f} is named or a parameter bit`);
                reach(y);
                claimed.add(a);
                /* "whichever way it goes": what follows is reachable from both of its sides */
                const rest = cell.slice(cell.indexOf(all) + all.length);
                if (/^; whichever way it goes/.test(rest)) {
                    const yb = word(y + 2), yt = ((yb & 0xff) << 24 >> 24) * 2 + y + 6;
                    for (const [, x] of rest.matchAll(/\((0x0600[\da-f]{4})\)/g))
                        for (const yf of [y + 4, yt]) assert.ok(FM.handlerReaches(game, start, yf, parseInt(x, 16), [at, y]), `${where}: ${x} after ${a}`);
                }
            }
            for (const m of cell.matchAll(/\((0x0600[\da-f]{4})\)/g)) {
                const x = parseInt(m[1], 16), before = cell.slice(0, m.index), w = word(x);
                let k, verb;
                if ((k = before.match(/calls (0x[\da-f]{8}) $/))) assert.ok(w === 0x400b && reg(x, 0) === parseInt(k[1], 16), `${where}: call ${m[1]}`);
                else if (/plays the request's motion $/.test(before)) assert.ok(w === 0x400b && reg(x, 0) === PLAYS && (isField(reg(x, 4), 0x3e) || isField(reg(x, 4), 0x72)), `${where}: ${m[1]}`);
                else if ((k = before.match(/the (0x[\da-f]{2}) test $/))) {
                    const st = FM.handlerTest(game, start, x);
                    assert.ok((st?.field === 0x3c || st?.field === 0x70) && st.mask === parseInt(k[1], 16) << 16, `${where}: ${m[1]}`);
                }
                else if ((k = before.match(/the (\+0x[\da-f]+ & 0x[\da-f]{8}) test $/))) {
                    const st = FM.handlerTest(game, start, x);
                    assert.ok(st && flagText(st.field, st.mask) === k[1] && named.has(k[1]), `${where}: ${m[1]}`);
                } else if (/the motion-id test $/.test(before)) assert.ok((w & 0xf00f) === 0x2008 && ((w >> 8) & 15) === ((w >> 4) & 15) && isField(reg(x, (w >> 8) & 15), 0x3e), `${where}: ${m[1]}`);
                else if (/the \+0x6c6 counter $/.test(before)) assert.ok((w & 0xf00f) === 0x2008 && ((w >> 8) & 15) === ((w >> 4) & 15) && isField(reg(x, (w >> 8) & 15), 0x6c6, 2), `${where}: ${m[1]}`);
                else if (/the stage test $/.test(before)) assert.ok((w & 0xf00f) === 0x3007 && regs(x).some(v => isField(v, 0x60, 1)), `${where}: ${m[1]}`);
                else if (/adds \+0x70's bits to the request $/.test(before)) assert.ok((w & 0xff0f) === 0x2b0b && isField(reg(x, (w >> 4) & 15), 0x70, 4), `${where}: ${m[1]}`);
                else if (/ends this frame's run $/.test(before)) assert.equal(w, 0x4e2b, `${where}: ${m[1]}`);
                else if (/stores the request in \+0x70 $/.test(before)) {
                    const st = FM.handlerStore(game, start, x);
                    assert.ok(st?.field === 0x70 && st.size === 4 && isField(st.value, 0x3c, 4), `${where}: ${m[1]}`);
                } else if ((k = before.match(/(\+0x[\da-f]+)(?:, [^,()]+,)? $/)) && (verb = before.split(/[;:]/).pop().match(/.*\b(clears?|sets?|in) /)?.[1])) {
                    /* a store: the field just before, the verb the clause's last clear(s), set(s) or in */
                    const st = FM.handlerStore(game, start, x);
                    assert.equal(st?.field, parseInt(k[1], 16), `${where}: store ${m[1]}`);
                    if (verb.startsWith('clear')) assert.equal(st.value, 0, `${where}: ${m[1]} clears`);
                } else assert.fail(`${where}: nothing says what ${m[1]} is`);
                reach(x);
                claimed.add(m[1]);
            }
            for (const [a] of cell.matchAll(/0x0600[\da-f]{4}/g)) assert.ok(claimed.has(a), `${where}: ${a} unchecked`);
            /* "changes nothing in the jump before it stops at": a straight run (bra followed) with no
             * store, call or other branch from the side's start to that test */
            for (const [, a] of cell.matchAll(/changes nothing in the jump before it stops at (0x[\da-f]{8})/g)) {
                let x = from;
                for (let n = 0; x !== parseInt(a, 16); n++) {
                    const w = word(x);
                    assert.ok(n < 32 && FM.handlerStore(game, start, x) === null && w !== 0x400b && (w & 0xf9ff) !== 0x8900 && (w & 0xff00) !== 0x8d00
                        && (w & 0xff00) !== 0x8f00 && w !== 0x000b && (w & 0xf0ff) !== 0x402b && !((w & 0xf00f) === 0x2008 || (w & 0xff00) === 0xc800), `${where}: ${h(x, 8)} before ${a}`);
                    x = (w & 0xf000) === 0xa000 ? ((w & 0xfff) << 20 >> 20) * 2 + x + 4 : x + 2;
                }
            }
            if (/plays no motion/.test(cell))
                for (let a = start; a < start + 0x1000; a += 2)
                    if (word(a) === 0x400b && reg(a, 0) === PLAYS) assert.ok(!FM.handlerReaches(game, start, from, a, [at]), `${where}: plays at ${h(a, 8)}`);
        });
    }
    /* the bullets: one per row (a flag in both handlers names its handler), each with its set side and
     * its clear side; "nothing changes before X" is that side's "changes nothing" stop; a test named
     * in one is a parameter test the row reaches */
    const bullets = [...text.matchAll(/^- \*\*(.+?)\*\*(?:, in the (accept|run) handler)?:([^]*?)(?=\n- |\n\n)/gm)];
    assert.equal(bullets.length, rows.length, 'a bullet for each row');
    for (const [, f, handler, body] of bullets) {
        const matches = rows.filter(r => r[3] === f && (!handler || r[2] === handler));
        assert.equal(matches.length, 1, `${f} ${handler ?? ''}`);
        const row = matches[0], sides = body.replace(/\s+/g, ' ').match(/^ set, (.+); clear, (.+)$/);
        assert.ok(sides && sides[1].trim() && sides[2].trim(), `${f}: a bullet needs its set side and its clear side`);
        [1, 2].forEach(s => {
            for (const [, a] of sides[s].matchAll(/nothing changes before (0x[\da-f]{8})/g))
                assert.ok(row[3 + s].includes(`changes nothing in the jump before it stops at ${a}`), `${f} ${['', 'set', 'clear'][s]}: ${a}`);
        });
        for (const [, bit, a] of body.matchAll(/the (0x[\da-f]{2}) test at\s+(0x[\da-f]{8})/g)) {
            const start = row[2] === 'accept' ? accept9 : run9, x = parseInt(a, 16), at = parseInt(row[1], 16);
            assert.equal(FM.handlerTest(game, start, x)?.mask, parseInt(bit, 16) << 16, a);
            assert.ok(FM.handlerReaches(game, start, at + 4, x, [at]) || FM.handlerReaches(game, start, ((word(at + 2) & 0xff) << 24 >> 24) * 2 + at + 6, x, [at]), a);
        }
    }
}
const flagsDoc = kindsDoc.split('#### The flags behind them\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
checkFlags(flagsDoc, bitsDoc);
for (const [from, to] of [['| 0x0600ed36 | run |', '| 0x0600ed38 | run |'], ['| +0x6c0 & 0x00030000 |', '| +0x6c0 & 0x00010000 |'],
    ['stops at 0x0600ee84 (+0x6c0 & 0x80000000)', 'stops at 0x0600ee84 (+0x6c0 & 0x40000000)'], ['stops at 0x0600ed4c (+0x00 & 0x04000000)', 'stops at 0x0600ed4c (+0x00 & 0x00000020)'],
    ['| changes nothing in the jump before it stops at 0x0600ee84 (+0x6c0 & 0x80000000) | ends this frame\'s run (0x0600f3f6) |', '| ends this frame\'s run (0x0600f3f6) | changes nothing in the jump before it stops at 0x0600ee84 (+0x6c0 & 0x80000000) |'],
    ['clears +0x50 (0x0600db42)', 'clears +0x52 (0x0600db42)'], ['+0x60, the stage, (0x0600db46)', '+0x60, the stage, (0x0600db42)'],
    ['calls 0x06012efc (0x0600f182)', 'calls 0x06014ca4 (0x0600f182)'], ['the 0x40 test (0x0600dce0)', 'the 0x80 test (0x0600dce0)'],
    ['it plays the request\'s motion (0x0600dc9c)', 'it plays the request\'s motion (0x0600dc9a)'], ['plays no motion;', 'plays no motion; plays the request\'s motion (0x0600dc9c);'],
    ['sets +0x4ac, the hold, (0x0600dcc4); plays no motion', 'sets +0x4ac, the hold, (0x0600dcc4); plays no motion; ends this frame\'s run (0x0600f3f6)'],
    ['| changes nothing in the jump before it stops at 0x0600ed4c (+0x00 & 0x04000000) |', '| plays no motion |'], ['clears +0x70 (0x0600f3de)', 'clears +0x70 (0x0600f3d6)'],
    ['the +0x6c6 counter (0x0600f0d0)', 'the +0x6c6 counter (0x0600f0ce)'], ['stores the request in +0x70 (0x0600da7c) |\n| 0x0600dc80', 'stores the request in +0x70 (0x0600da7a) |\n| 0x0600dc80'],
    ['The six distinct', 'The five distinct'], ['- **+0x6c0 & 0x00030000**', '- **+0x6c0 & 0x00070000**'], ['test at 0x0600eeca', 'test at 0x0600eecc'],
    /* each of the three sides that only reach an unnamed flag, dropped from its row or its bullet, or said of a side that does change the jump */
    ['| changes nothing in the jump before it stops at 0x0600ed20 (+0x6c0 & 0x04000000), the first of a chain of +0x6c0 tests |', '|  |'],
    ['| changes nothing in the jump before it stops at 0x0600ed4c (+0x00 & 0x04000000) |', '|  |'],
    ['| changes nothing in the jump before it stops at 0x0600ee84 (+0x6c0 & 0x80000000) |', '|  |'],
    ['set, nothing changes before 0x0600ed20; clear,\n  the jump ends.', 'clear, the jump ends.'],
    ['; clear, nothing\n  changes before 0x0600ed4c.', '.'],
    ['set, nothing changes before 0x0600ee84; clear,\n  the frame', 'clear, the frame'],
    ['set, nothing changes before 0x0600ed20', 'set, nothing changes before 0x0600ed4c'],
    ['stops at 0x0600f27a (+0x6c0 & 0x00040000)', 'changes nothing in the jump before it stops at 0x0600f27a (+0x6c0 & 0x00040000)']]) {
    assert.ok(flagsDoc.includes(from), from);
    assert.throws(() => checkFlags(flagsDoc.replace(from, to), bitsDoc), `${from} -> ${to}`);
}
/* a row dropped from the table, or the Behind column gaining a flag, fails too */
assert.throws(() => checkFlags(flagsDoc.replace(/^\| 0x0600ee78 .*\n/m, ''), bitsDoc));
assert.throws(() => checkFlags(flagsDoc, bitsDoc.replace('0x0600ed16 +0x00 & 0x00000020 set;', '0x0600ed16 +0x00 & 0x00000020 set; 0x0600ed20 +0x6c0 & 0x04000000 clear;')));

/* The flags they stop at: its rows are the flag tests "The flags behind them"
 * stops at; each cell against the tool's flagSides on a fresh read: what each
 * address does, that no store, call or stop is left out, and the bullets */
const asLongFlag = ({ field, size }, mask) => ({ field: field & ~3, mask: (mask << (size === 4 ? 0 : (4 - size - (field & 3)) * 8)) >>> 0 });
const fixed = (k, d) => assert.equal(+(k / 65536).toFixed(d.split('.')[1]?.length ?? 0), +d, `${h(k, 8)} is ${d}`);
const FLAG = String.raw`(?:the opponent's )?\+0x[\da-f]+ & 0x[\da-f]{8}`;
const eventFlag = e => `${e.of === 13 ? 'the opponent\'s ' : ''}${flagText(e.field, e.mask)}`;
/* "with C, or C, ..., ends this frame's run (X); else stops at Y": walks the
 * side from its start, with no store or call on the way, keeping what each
 * register holds (a number, a fighter field, a table entry picked by a
 * field, a field with bits cleared, two fields or'd); at each bt/bf it reads
 * the compare before it ("+A and +B both 0": or of the two, then tst; "X at
 * K or less", "X over K", "X under K": cmp/ge or cmp/gt against K) and the
 * way the compare holds must be a bra to X; the other way goes on, until Y.
 * Returns the conditions in the order the code tests them. */
function endConditions(from, end, until) {
    const out = [], d8 = a => ((word(a) & 0xff) << 24 >> 24) * 2 + a + 4, d12 = a => ((word(a) & 0xfff) << 20 >> 20) * 2 + a + 4;
    const ends = a => a === end || ((word(a) & 0xf000) === 0xa000 && d12(a) === end && word(a + 2) === 0x0009);
    const num = v => typeof v === 'number';
    const say = v => v?.field !== undefined ? `${['', 'the byte ', 'the halfword ', '', ''][v.size]}+0x${v.field.toString(16)}`
        : v?.table !== undefined && say(v.by) ? `the table at ${h(v.table, 8)}'s halfword for ${say(v.by)}`
        : v?.and !== undefined && say(v.x) ? `${say(v.x)} less bit ${h(~v.and & 0xffff, 2)}` : null;
    const k = v => !num(v) ? null : Math.abs(v) < 0x100 ? String(v) : `${h(v >>> 0, 8)} (${+(v / 65536).toFixed(2)})`;
    const r = Array.from({ length: 16 }, (_, n) => FM.handlerReg(game, run9, from, n));
    let cmp = null;
    for (let pc = from, n = 0; pc !== until; n++) {
        assert.ok(n < 64, `${h(from, 8)}: no way to ${h(until, 8)}`);
        const w = word(pc), rn = (w >> 8) & 15, rm = (w >> 4) & 15, f = w & 0xf00f;
        if ((w & 0xf000) === 0xa000) { assert.equal(word(pc + 2), 0x0009, h(pc, 8)); pc = d12(pc); continue; }
        if ((w & 0xfd00) === 0x8900) {
            const cond = cmp?.(), [whenT, otherwise] = w & 0x0200 ? [pc + 2, d8(pc)] : [d8(pc), pc + 2];
            assert.ok(cond, `${h(pc - 2, 8)}: no compare read`);
            assert.ok(ends(whenT) && !ends(otherwise), `${h(pc, 8)}: ${cond} does not end the run at ${h(end, 8)}`);
            out.push(cond);
            pc = otherwise;
            cmp = null;
            continue;
        }
        assert.ok(FM.handlerStore(game, run9, pc) === null && w !== 0x400b && (w & 0xf0ff) !== 0x402b && w !== 0x000b && w !== 0x4e2b && (w & 0xff00) !== 0x8d00, `${h(pc, 8)}: not a load, a move or a compare`);
        const [x, y] = [r[rn], r[rm]];
        if (f === 0x2008 && rn === rm) cmp = () => x?.or && x.or.every(say) ? `${say(x.or[1])} and ${say(x.or[0])} both 0` : null;
        else if (f === 0x3003) cmp = () => num(x) && say(y) ? `${say(y)} at ${k(x)} or less` : null;   /* T when Rn >= Rm */
        else if (f === 0x3007) cmp = () => say(x) && num(y) ? `${say(x)} over ${k(y)}` : num(x) && say(y) ? `${say(y)} under ${k(x)}` : null;   /* T when Rn > Rm */
        else if ((w & 0xf000) === 0xe000) r[rn] = (w & 0xff) << 24 >> 24;
        else if ((w & 0xf000) === 0x9000) r[rn] = game.prg.readInt16BE(game.at(pc + 4 + (w & 0xff) * 2));
        else if ((w & 0xf000) === 0xd000) r[rn] = game.prg.readUInt32BE(game.at(((pc + 4) & ~3) + (w & 0xff) * 4));
        else if ((w & 0xf00c) === 0x000c && (w & 3) < 3) {   /* mov.x @(r0,Rm),Rn */
            const size = [1, 2, 4][w & 3];
            r[rn] = rm === 12 && num(r[0]) ? { field: r[0], size } : num(r[0]) && size === 2 && y?.idx ? { table: r[0] >>> 0, by: y.idx } : null;
        } else if ((w & 0xf0ff) === 0x4000) r[rn] = x?.field !== undefined ? { idx: x } : null;   /* shll: a halfword table's index */
        else if (f === 0x2009) r[rn] = num(y) && x && !num(x) ? { and: y, x } : null;
        else if (f === 0x200b) r[rn] = x && y && !num(x) && !num(y) ? { or: [x, y] } : null;
        else if (w !== 0x0009 && !(f === 0x2008 || (w & 0xff00) === 0xc800)) r[rn] = null;   /* anything else: what it writes is unknown */
        pc += 2;
    }
    return out;
}
/* text: the section; flags: the section whose stops are its rows; behind:
 * the flags a "stops at" may not name */
function checkStops(text, flags, behind) {
    const stops = new Map();
    for (const [, a, f] of flags.matchAll(new RegExp(String.raw`stops at (0x[\da-f]{8}) \((${FLAG})\)`, 'g'))) stops.set(a, f);
    const rows = [...text.matchAll(new RegExp(String.raw`^\| (0x[\da-f]{8}) \| (${FLAG}) \| (.*?) \| (.*?) \|$`, 'gm'))];
    assert.deepEqual(rows.map(([, a, f]) => [a, f]), [...stops].sort(([a], [b]) => parseInt(a, 16) - parseInt(b, 16)));
    assert.match(text, new RegExp(`^The ${['', '', '', '', 'four', 'five'][rows.length]} flag tests`));
    const rowFlag = new Map(rows.map(([, a, f]) => [a, f]));
    for (const [, atText, flag, ...cells] of rows) {
        const at = parseInt(atText, 16);
        /* a test an earlier section describes: both cells point at its row there, the same flag on the disc */
        const joined = cells.map(c => c.match(/^as "The flags behind them" says for (0x[\da-f]{8})$/)?.[1]);
        if (joined.some(Boolean)) {
            assert.deepEqual(joined, [atText, atText], `${atText}: both sides joined`);
            const t = FM.handlerTest(game, run9, at);
            assert.equal(t && eventFlag(t), flag, atText);
            assert.ok(flagsDoc.includes(`| ${atText} | run | ${flag} |`), `${atText}: no row in "The flags behind them"`);
            continue;
        }
        const sides = FM.flagSides(game, run9, at);
        assert.equal(eventFlag(sides.flag), flag, atText);
        cells.forEach((cell, s) => {
            const events = sides[['set', 'clear'][s]], where = `${atText} ${['set', 'clear'][s]}`, claimed = new Set();
            const event = (kind, a) => {
                const e = events.find(e => e.kind === kind && e.at === parseInt(a, 16));
                assert.ok(e, `${where}: no ${kind} at ${a}`);
                claimed.add(e);
                return e;
            };
            for (const [all, a, f] of cell.matchAll(new RegExp(String.raw`stops at (0x[\da-f]{8}) \((${FLAG})\)`, 'g'))) {
                const e = event('stop', a);
                assert.equal(eventFlag(e), f, `${where}: ${all}`);
                assert.ok(!behind.has(f), `${where}: ${f} is one it may not stop at`);
                const k = cell.slice(cell.indexOf(all) + all.length).match(/^, the flag (0x[\da-f]{8}) tests/);
                if (k) assert.equal(rowFlag.get(k[1]), f, `${where}: the flag ${k[1]} tests`);
            }
            for (const [all, conds, x, y] of cell.matchAll(/with ([^;]+?), ends this frame's run \((0x[\da-f]{8})\); else stops at (0x[\da-f]{8})/g)) {
                const b = word(at + 2), target = ((b & 0xff) << 24 >> 24) * 2 + at + 6, from = (b & 0x0200 ? [target, at + 4] : [at + 4, target])[s];
                assert.deepEqual(endConditions(from, parseInt(x, 16), parseInt(y, 16)), conds.split(', or '), `${where}: ${all}`);
            }
            /* "calls F (A); if that returns nonzero, ...; else ...": a tst r0,r0 right after the call; what each
             * clause names is reached only on its own way, short of this cell's stops and the end of the run */
            for (const [all, a, yes, no] of cell.matchAll(/calls 0x[\da-f]{8} \((0x[\da-f]{8})\); if that returns nonzero, ([^;]+)(?:; else ([^;]+))?/g)) {
                const c = parseInt(a, 16), b = word(c + 6), target = ((b & 0xff) << 24 >> 24) * 2 + c + 10;
                assert.ok(word(c) === 0x400b && word(c + 4) === 0x2008 && (b & 0xfd00) === 0x8900, `${where}: ${all}: no tst r0,r0 after the call`);
                const [zero, nonzero] = b & 0x0200 ? [c + 8, target] : [target, c + 8];
                const avoid = [at, ...[...cell.matchAll(/(?:stops at|run \()(0x[\da-f]{8})/g)].map(m => parseInt(m[1], 16))];
                for (const [clause, on, off] of [[yes, nonzero, zero], [no ?? '', zero, nonzero]])
                    for (const [, x] of clause.matchAll(/\((0x0600[\da-f]{4})\)/g)) {
                        if (avoid.includes(parseInt(x, 16))) continue;
                        assert.ok(FM.handlerReaches(game, run9, on, parseInt(x, 16), avoid) && !FM.handlerReaches(game, run9, off, parseInt(x, 16), avoid), `${where}: ${x} after ${a}`);
                    }
            }
            /* "goes on to the test at": a test of one of this table's own flags */
            for (const [all, a, f] of cell.matchAll(new RegExp(String.raw`goes on to the test at (0x[\da-f]{8}) \((${FLAG})\)`, 'g'))) {
                assert.equal(eventFlag(event('stop', a)), f, `${where}: ${all}`);
                assert.equal(rowFlag.get(a), f, `${where}: ${a} is not in this table`);
            }
            for (const m of cell.matchAll(/\((0x0600[\da-f]{4})\)/g)) {
                const a = m[1], x = parseInt(a, 16), before = cell.slice(0, m.index), after = cell.slice(m.index + m[0].length).split(/[,;:]/)[0];
                let k;
                if (/ends this frame's run $/.test(before)) event('end', a);
                else if (/skips the call $/.test(before)) event('call', a);
                else if ((k = before.match(/\b(sets|clears) (\+0x[\da-f]+) & (0x[\da-f]{8}) $/))) {
                    /* a bit of a field set (or) or cleared (and) in place, given as the long's flag */
                    const e = event('store', a), [v] = e.values, bit = k[1] === 'sets' ? v?.or : ~v?.and & 0xff;
                    assert.ok(e.values.length === 1 && v?.field === e.field && v.size === e.size && (v.or ?? v.and) !== undefined, `${where}: ${a} is no bit`);
                    assert.equal(flagText(asLongFlag(e, bit).field, asLongFlag(e, bit).mask), `${k[2]} & ${k[3]}`, `${where}: ${a}`);
                } else if ((k = before.match(/takes one from (\+0x[\da-f]+) $/))) {
                    const e = event('store', a);
                    assert.deepEqual(e.values, [{ field: parseInt(k[1], 16), size: e.size, plus: -1 }], `${where}: ${a}`);
                }
                else if (/the same test again $/.test(before)) event('same', a);
                else if ((k = before.match(/the (0x[\da-f]{2}) test $/))) assert.equal(event('param', a).bit, parseInt(k[1], 16), `${where}: ${a}`);
                else if ((k = before.match(/calls (0x[\da-f]{8}) $/))) assert.equal(event('call', a).target, parseInt(k[1], 16), `${where}: ${a}`);
                else if ((k = before.match(/scales r(\d+), [^,]*, by (0x[\da-f]{8}) $/))) {
                    const w = word(x), r = +k[1], c = parseInt(k[2], 16);
                    assert.ok((w & 0xf00f) === 0x300d && [(w >> 8) & 15, (w >> 4) & 15].includes(r)
                        && [(w >> 8) & 15, (w >> 4) & 15].some(n => FM.handlerReg(game, run9, x, n) === c), `${where}: ${a}`);
                    const b = word(at + 2), target = ((b & 0xff) << 24 >> 24) * 2 + at + 6;
                    assert.ok(FM.handlerReaches(game, run9, (b & 0x0200 ? [target, at + 4] : [at + 4, target])[s], x, [at]), `${where}: ${a} out of reach`);
                    claimed.add({ at: x });
                } else if ((k = before.match(/(\+0x[\da-f]+) $/))) {
                    const e = event('store', a), verb = before.split(/[;:]/).pop().match(/.*\b(clears|sets|puts|limits) /)?.[1];
                    assert.equal(e.field, parseInt(k[1], 16), `${where}: store ${a}`);
                    const put = before.split(/[;:]/).pop().match(/^.*(?:puts |, | and )([^,]+?) in \+0x[\da-f]+ $/);
                    let c;
                    if (verb === 'clears') assert.deepEqual(e.values, [0], `${where}: ${a} clears`);
                    else if (verb === 'puts') {
                        /* a number (with its 16.16 value), a field, a field plus a number, or something else (null) */
                        const v = put[1].match(/^(-?0x[\da-f]+)(?: \((-?[\d.]+)\))?$/), f = put[1].match(/^\+(0x[\da-f]+)(?: plus (0x[\da-f]+) \(([\d.]+)\))?$/);
                        const want = v ? parseInt(v[1], 16) : f ? { field: parseInt(f[1], 16), size: e.values[0]?.size, ...(f[2] && { plus: parseInt(f[2], 16) }) } : null;
                        assert.deepEqual(e.values, [want], `${where}: ${a} puts ${put[1]}`);
                        if (v?.[2]) fixed(parseInt(v[1], 16), v[2]);
                        if (f?.[3]) fixed(parseInt(f[2], 16), f[3]);
                    }
                    else if (verb === 'limits' && (c = after.match(/to ±(0x[\da-f]+) \(([\d.]+)\)/) ?? cell.slice(m.index).match(/to ±(0x[\da-f]+) \(([\d.]+)\)/))) {
                        assert.deepEqual([...e.values].sort((p, q) => p - q), [-parseInt(c[1], 16), parseInt(c[1], 16)], `${where}: ${a} limits`);
                        fixed(parseInt(c[1], 16), c[2]);
                    } else if (verb === 'sets' && (c = cell.slice(m.index + m[0].length).match(/^ to \+(0x[\da-f]+) less \+(0x[\da-f]+), over the halfword \+(0x[\da-f]+), with the divide unit/))) {
                        /* the divide unit's quotient: the value this side put in the first field, less the second, over the halfword */
                        const put = events.filter(p => p.kind === 'store' && p.field === parseInt(c[1], 16) && p.at < x);
                        assert.equal(put.length, 1, `${where}: ${a}: one store to +${c[1]} before it`);
                        assert.deepEqual(e.values, [{ quot: { less: [put[0].values[0], { field: parseInt(c[2], 16), size: 4 }] }, by: { field: parseInt(c[3], 16), size: 2 } }], `${where}: ${a} divides`);
                    } else if (verb === 'sets' && (c = cell.slice(m.index).split(/[;:]/)[0].match(/to themselves times (0x[\da-f]{8}) \(([\d.]+)\)/))) {
                        assert.deepEqual(e.values, [{ field: e.field, size: e.size, times: parseInt(c[1], 16) }], `${where}: ${a} times`);
                        fixed(parseInt(c[1], 16), c[2]);
                    } else assert.equal(verb, 'sets', `${where}: what ${a} stores`);
                } else assert.fail(`${where}: nothing says what ${a} is`);
            }
            for (const [a] of cell.matchAll(/0x0600[\da-f]{4}/g))
                assert.ok([...claimed].some(e => e.at === parseInt(a, 16)) || rowFlag.has(a), `${where}: ${a} unchecked`);
            /* nothing left out: every store, call, stop, end and parameter test is in the cell */
            for (const e of events) if (e.kind !== 'same') assert.ok(claimed.has(e), `${where}: ${e.kind} at ${h(e.at, 8)} left out`);
            if (/changes nothing in the jump before it (?:stops at|goes on to)|and nothing else/.test(cell))
                assert.ok(events.filter(e => e.kind !== 'same').length === 1, `${where}: something changes`);
        });
    }
    /* a bullet per row, set side and clear side; "nothing changes before X" is that side's lone stop */
    const bullets = [...text.matchAll(/^- \*\*(.+?)\*\*:([^]*?)(?=\n- |\n\n)/gm)];
    assert.deepEqual(bullets.map(b => b[1]), rows.map(r => r[2]), 'a bullet for each row');
    for (const [, f, body] of bullets) {
        const row = rows.find(r => r[2] === f), sides = body.replace(/\s+/g, ' ').match(/^ set, (.+); clear, (.+)$/);
        assert.ok(sides && sides[1].trim() && sides[2].trim(), `${f}: a bullet needs its set side and its clear side`);
        [1, 2].forEach(s => {
            for (const [, a] of sides[s].matchAll(/nothing changes before (0x[\da-f]{8})/g))
                assert.match(row[2 + s], new RegExp(`changes nothing in the jump before it (?:stops at|goes on to the test at) ${a}`), `${f} ${['', 'set', 'clear'][s]}: ${a}`);
            for (const [, v] of sides[s].matchAll(/\+0x68a gets (0x[\da-f]+)/g)) assert.match(row[2 + s], new RegExp(`puts ${v} in \\+0x68a`), `${f}: ${v}`);
            for (const [, x, y] of sides[s].matchAll(/within ±([\d.]+)|scaled by ([\d.]+)/g)) for (const d of [x ?? y]) assert.ok(row[2 + s].includes(`(${d})`), `${f}: ${d}`);
        });
    }
    /* the closing list: the stops the cells name, each once */
    const listed = text.match(/The flags tested at ([^]+?) are left undescribed/)[1].match(/0x[\da-f]{8}/g);
    assert.deepEqual(listed, [...new Set(rows.flatMap(r => [...(r[3] + r[4]).matchAll(/stops at (0x[\da-f]{8})/g)].map(m => m[1])))]
        .sort((a, b) => parseInt(a, 16) - parseInt(b, 16)), 'the undescribed stops');
}
const stopsDoc = kindsDoc.split('#### The flags they stop at\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
const behindFlags = new Set([...bitsDoc.matchAll(/(\+0x[\da-f]+ & 0x[\da-f]{8}) (?:set|clear)/g)].map(m => m[1]));
checkStops(stopsDoc, flagsDoc, behindFlags);
for (const [from, to] of [['| 0x0600ed20 | +0x6c0 & 0x04000000 |', '| 0x0600ed20 | +0x6c0 & 0x08000000 |'],
    ['stops at 0x0600ed2a (+0x6c0 & 0x00000040)', 'stops at 0x0600ed2a (+0x6c0 & 0x00000080)'], ['stops at 0x0600ee16', 'stops at 0x0600ee18'],
    ['the flag 0x0600f3a4 tests', 'the flag 0x0600f27a tests'], ['limits +0x20 (0x0600eeaa)', 'limits +0x24 (0x0600eeaa)'], ['to ±0x0a3d (0.04)', 'to ±0x0a3e (0.04)'],
    ['to ±0x0a3d (0.04)', 'to ±0x0a3d (0.05)'], ['the 0x80 test (0x0600eeca)', 'the 0x40 test (0x0600eeca)'], ['by 0x00008e35 (0x0600f27e)', 'by 0x00008e36 (0x0600f27e)'],
    ['puts 0x8b3 in +0x68a', 'puts 0x8b4 in +0x68a'], ['puts the halfword at +6 of a table entry in', 'puts 0x8b3 in'],
    ['times 0x0000cccd (0.8)', 'times 0x0000cccc (0.8)'], ['clears +0x20 (0x0600f3ae), +0x24 (0x0600f3b0) and', 'clears +0x20 (0x0600f3ae) and'],
    ['sets +0x2f (0x0600f3f4); ends this frame\'s run (0x0600f3f6) |\n', 'ends this frame\'s run (0x0600f3f6) |\n'],
    ['| ends this frame\'s run (0x0600f3f6) and nothing else |', '| changes nothing in the jump before it stops at 0x0600ed2a (+0x6c0 & 0x00000040) |'],
    ['| 0x0600f27a | +0x6c0 & 0x00040000 | scales', '| 0x0600f27a | +0x6c0 & 0x00040000 | changes nothing in the jump before it stops at 0x0600f2a0 (+0x6c0 & 0x00080000); scales'],
    ['The five flag tests', 'The six flag tests'], ['set, nothing changes before 0x0600ee16', 'set, nothing changes before 0x0600ed58'],
    ['set, +0x68a gets 0x8b3', 'set, +0x68a gets 0x8b4'], ['within ±0.04', 'within ±0.05'], ['scaled\n  by 0.8', 'scaled\n  by 0.9'],
    ['0x0600ed58, 0x0600ee16,', '0x0600ed58,'], ['; clear,\n  nothing changes before 0x0600ed58.', '.']]) {
    assert.ok(stopsDoc.includes(from), from);
    assert.throws(() => checkStops(stopsDoc.replace(from, to), flagsDoc, behindFlags), `${from} -> ${to}`);
}
/* the set and clear cells of 0x0600f27a swapped, a row dropped, or "The flags behind them" naming another stop */
const f27a = stopsDoc.match(/^\| 0x0600f27a \| (.+?) \| (.+?) \| (.+?) \|$/m);
assert.throws(() => checkStops(stopsDoc.replace(f27a[0], `| 0x0600f27a | ${f27a[1]} | ${f27a[3]} | ${f27a[2]} |`), flagsDoc, behindFlags));
assert.throws(() => checkStops(stopsDoc.replace(/^\| 0x0600ee84 .*\n/m, ''), flagsDoc, behindFlags));
assert.throws(() => checkStops(stopsDoc, flagsDoc.replace('stops at 0x0600ee84 (+0x6c0 & 0x80000000)', 'stops at 0x0600ee8a (+0x6c0 & 0x00000001)'), behindFlags));

/* The flags those stop at: the same check, one step on; its rows are the
 * stops "The flags they stop at" names, and none of its own stops may be one
 * of them; a changed claim fails */
const thoseDoc = kindsDoc.split('#### The flags those stop at\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
const theirStops = new Set([...stopsDoc.matchAll(new RegExp(String.raw`stops at 0x[\da-f]{8} \((${FLAG})\)`, 'g'))].map(m => m[1]));
checkStops(thoseDoc, stopsDoc, theirStops);
for (const [from, to] of [['| 0x0600ed2a | +0x6c0 & 0x00000040 |', '| 0x0600ed2a | +0x6c0 & 0x00000080 |'],
    ['| 0x0600f2a0 | +0x6c0 & 0x00080000 |', '| 0x0600f2a0 | +0x6c0 & 0x00040000 |'],
    ['clears +0x30 & 0x00000008 (0x0600f03e)', 'clears +0x30 & 0x00000004 (0x0600f03e)'], ['clears +0x30 & 0x00000008 (0x0600f03e)', 'sets +0x30 & 0x00000008 (0x0600f03e)'],
    ['puts +0x63c in +0x6c6', 'puts +0x63e in +0x6c6'], ['takes one from +0x6c6 (0x0600f050)', 'takes one from +0x6c4 (0x0600f050)'],
    ['sets +0x6c0 & 0x00001000 (0x0600f05c)', 'sets +0x6c0 & 0x00002000 (0x0600f05c)'], ['plus 0x0002b333 (2.7)', 'plus 0x0002b333 (2.8)'], ['plus 0x0002b333 (2.7)', 'plus 0x0002b334 (2.7)'],
    ['puts +0xc in +0x6e0 (0x0600f078), +0x10 in +0x6e4', 'puts +0xc in +0x6e0 (0x0600f078), +0x14 in +0x6e4'], ['and +0x14 in +0x6e8', 'and +0x10 in +0x6e8'],
    ['sets +0x6f8 (0x0600f09e)', 'sets +0x6f4 (0x0600f09e)'],
    ['stops at 0x0600ed36 (+0x6c0 & 0x00001000)', 'stops at 0x0600ed36 (+0x6c0 & 0x00002000)'],
    ['goes on to the test at 0x0600ee16 (+0x6c0 & 0x40000000)', 'stops at 0x0600ee16 (+0x6c0 & 0x40000000)'],
    ['goes on to the test at 0x0600ee16 (+0x6c0 & 0x40000000)', 'goes on to the test at 0x0600ee16 (+0x6c0 & 0x20000000)'],
    ['stops at 0x0600ed64 (the opponent\'s +0x19f0 & 0x00002000)', 'stops at 0x0600ed64 (+0x19f0 & 0x00002000)'],
    ['stops at 0x0600ed64 (the opponent\'s +0x19f0 & 0x00002000)', 'stops at 0x0600ed64 (the opponent\'s +0x19f0 & 0x00001000)'],
    ['else stops at 0x0600ee44 (+0x30 & 0x00000008)', 'else stops at 0x0600ee44 (+0x30 & 0x00000080)'],
    ['| ends this frame\'s run (0x0600f3f6) and nothing else |\n| 0x0600ee8a', '| changes nothing in the jump before it stops at 0x0600ee44 (+0x30 & 0x00000008) |\n| 0x0600ee8a'],
    ['limits +0x20 (0x0600eeaa) and +0x28 (0x0600eec2) to ±0x0a3d (0.04); goes on to the 0x80 test (0x0600eeca) |', 'limits +0x20 (0x0600eeaa) and +0x28 (0x0600eec2) to ±0x0a3d (0.04); goes on to the 0x40 test (0x0600eeca) |'],
    ['| ends this frame\'s run (0x0600f3f6) and nothing else |\n| 0x0600f2a0', '| ends this frame\'s run (0x0600f3f6) |\n| 0x0600f2a0'.replace(' |\n', '; goes on to the 0x80 test (0x0600eeca) |\n')],
    ['sets +0x6c0 & 0x00400000 (0x0600f304)', 'sets +0x6c0 & 0x00800000 (0x0600f304)'], ['clears +0x6c0 & 0x00400000 (0x0600f320)', 'sets +0x6c0 & 0x00400000 (0x0600f320)'],
    ['skips the call (0x0600f2cc) as that halfword is negative, and ', ''], ['puts -0x07ae (-0.03) in +0x24 (0x0600f2f2); else calls 0x06010dda (0x0600f30e)', 'puts 0x07ae (0.03) in +0x24 (0x0600f2f2); else calls 0x06010dda (0x0600f30e)'],
    ['puts -0x07ae (-0.03) in +0x24 (0x0600f2f2); else calls 0x06010dda (0x0600f2cc)', 'puts -0x07ae (-0.04) in +0x24 (0x0600f2f2); else calls 0x06010dda (0x0600f2cc)'],
    ['calls 0x06010dda (0x0600f30e)', 'calls 0x06014ca4 (0x0600f30e)'], ['stops at 0x0600f340 (+0x6c0 & 0x01000000)', 'stops at 0x0600f340 (+0x6c0 & 0x02000000)'],
    ['and puts 0x07ae (0.03) in +0x24 (0x0600f32a); ends this frame\'s run (0x0600f3f6) |\n\n', 'and puts 0x07ae (0.03) in +0x28 (0x0600f32a); ends this frame\'s run (0x0600f3f6) |\n\n'],
    ['clears +0x20 (0x0600f324) and +0x28 (0x0600f326) and puts 0x07ae (0.03) in +0x24 (0x0600f32a); ends this frame\'s run (0x0600f3f6) |\n\n', 'clears +0x20 (0x0600f324) and puts 0x07ae (0.03) in +0x24 (0x0600f32a); ends this frame\'s run (0x0600f3f6) |\n\n'],
    ['The five flag tests', 'The four flag tests'], ['clear, nothing changes before 0x0600ed36', 'clear, nothing changes before 0x0600ed64'],
    ['set, nothing changes before 0x0600ee16', 'set, nothing changes before 0x0600ed64'], ['held within ±0.04', 'held within ±0.05'],
    ['to +0x6f0 less +0x10,', 'to +0x6f0 less +0x14,'], ['to +0x6f0 less +0x10,', 'to +0x658 less +0x10,'], ['over the halfword +0x646,', 'over the halfword +0x644,'],
    ['with +0x514 and +0x51c both 0', 'with +0x514 and +0x518 both 0'], ['the halfword +0x4a8 at 1 or less', 'the halfword +0x4a8 at 2 or less'],
    ['the halfword +0x4a8 at 1 or less', 'the halfword +0x4aa at 1 or less'], ['the halfword +0x4a8 at 1 or less', '+0x4a8 at 1 or less'],
    ['with +0x514 and +0x51c both 0, or the halfword +0x4a8 at 1 or less', 'with the halfword +0x4a8 at 1 or less, or +0x514 and +0x51c both 0'],
    ['with +0x514 and +0x51c both 0, or the halfword +0x4a8 at 1 or less', 'with +0x514 and +0x51c both 0'],
    ['0x0600ed64,\n0x0600ee44', '0x0600ee44'], ['0x0600ee44 and 0x0600f340 are', '0x0600ee44, 0x0600ee16 and 0x0600f340 are']]) {
    assert.ok(thoseDoc.includes(from), from);
    assert.throws(() => checkStops(thoseDoc.replace(from, to), stopsDoc, theirStops), `${from} -> ${to}`);
}
/* a row dropped, set and clear swapped on 0x0600ee8a, or "The flags they stop at" naming another stop */
assert.throws(() => checkStops(thoseDoc.replace(/^\| 0x0600ee16 .*\n/m, ''), stopsDoc, theirStops));
const ee8a = thoseDoc.match(/^\| 0x0600ee8a \| (.+?) \| (.+?) \| (.+?) \|$/m);
assert.throws(() => checkStops(thoseDoc.replace(ee8a[0], `| 0x0600ee8a | ${ee8a[1]} | ${ee8a[3]} | ${ee8a[2]} |`), stopsDoc, theirStops));
assert.throws(() => checkStops(thoseDoc, stopsDoc.replace('stops at 0x0600ee16 (+0x6c0 & 0x40000000)', 'stops at 0x0600ee44 (+0x30 & 0x00000008)'), theirStops));

/* The flags those four stop at: the same check, one step on again */
const fourDoc = kindsDoc.split('#### The flags those four stop at\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
const thoseStops = new Set([...thoseDoc.matchAll(new RegExp(String.raw`stops at 0x[\da-f]{8} \((${FLAG})\)`, 'g'))].map(m => m[1]));
checkStops(fourDoc, thoseDoc, thoseStops);
for (const [from, to] of [['| 0x0600ed36 | +0x6c0 & 0x00001000 |', '| 0x0600ed36 | +0x6c0 & 0x00002000 |'],
    ['as "The flags behind them" says for 0x0600ed36 |\n', 'ends this frame\'s run (0x0600f3f6) and nothing else |\n'],
    ['| 0x0600ed64 | the opponent\'s +0x19f0 & 0x00002000 |', '| 0x0600ed64 | +0x19f0 & 0x00002000 |'],
    ['| 0x0600f340 | +0x6c0 & 0x01000000 |', '| 0x0600f340 | +0x6c0 & 0x02000000 |'], ['| 0x0600ee44 | +0x30 & 0x00000008 |', '| 0x0600ee44 | +0x30 & 0x00000080 |'],
    ['calls 0x06024094 (0x0600ed7c)', 'calls 0x06014ca4 (0x0600ed7c)'], ['sets +0x6c0 & 0x20000000 (0x0600ed8e)', 'sets +0x6c0 & 0x40000000 (0x0600ed8e)'],
    ['calls 0x060564cc (0x0600edb4)', 'calls 0x06024094 (0x0600edb4)'], ['sets +0x20 (0x0600ee0a)', 'sets +0x24 (0x0600ee0a)'],
    ['either way stops at 0x0600ee16 (+0x6c0 & 0x40000000)', 'either way stops at 0x0600ee16 (+0x6c0 & 0x20000000)'],
    ['stops at 0x0600ed6a (the opponent\'s +0x19f0 & 0x00024100)', 'stops at 0x0600ed6a (the opponent\'s +0x19f0 & 0x00004100)'],
    ['stops at 0x0600ed6a (the opponent\'s +0x19f0 & 0x00024100)', 'stops at 0x0600ed6a (+0x19f0 & 0x00024100)'],
    ['the table at 0x0606922c\'s', 'the table at 0x06069230\'s'], ['for the byte +0x4 less', 'for the byte +0x5 less'], ['less bit 0x08 over 3', 'less bit 0x04 over 3'],
    ['less bit 0x08 over 3', 'less bit 0x08 over 4'], ['+0xe4 under 0x00016666 (1.4)', '+0xe4 over 0x00016666 (1.4)'], ['+0xe4 under 0x00016666 (1.4)', '+0xe4 under 0x00016666 (1.5)'],
    ['+0xe4 under 0x00016666 (1.4)', '+0xe8 under 0x00016666 (1.4)'],
    ['else stops at 0x0600ee78 (+0x6c0 & 0x00030000)', 'else stops at 0x0600ee78 (+0x6c0 & 0x00010000)'],
    ['| ends this frame\'s run (0x0600f3f6) and nothing else |\n| 0x0600f340', '| changes nothing in the jump before it stops at 0x0600ee78 (+0x6c0 & 0x00030000) |\n| 0x0600f340'],
    ['if that returns nonzero, sets +0x6c0 & 0x01000000 (0x0600f35c); else calls 0x060129f4 (0x0600f36a)', 'if that returns nonzero, calls 0x060129f4 (0x0600f36a); else sets +0x6c0 & 0x01000000 (0x0600f35c)'],
    ['sets +0x20 (0x0600ee0a) and +0x28 (0x0600ee0c); either way', 'sets +0x20 (0x0600ee0a); else sets +0x28 (0x0600ee0c); either way'],
    ['calls 0x060129f4 (0x0600f36a)', 'calls 0x06024094 (0x0600f36a)'], ['sets +0x6c0 & 0x01000000 (0x0600f35c)', 'clears +0x6c0 & 0x01000000 (0x0600f35c)'],
    ['The four flag tests', 'The five flag tests'], ['nothing\n  changes before 0x0600ed6a', 'nothing\n  changes before 0x0600ee16'],
    ['0x0600ed6a, 0x0600ee16\nand 0x0600ee78', '0x0600ed6a\nand 0x0600ee78']]) {
    assert.ok(fourDoc.includes(from), from);
    assert.throws(() => checkStops(fourDoc.replace(from, to), thoseDoc, thoseStops), `${from} -> ${to}`);
}
/* a row dropped, or "The flags those stop at" naming another stop */
assert.throws(() => checkStops(fourDoc.replace(/^\| 0x0600ee44 .*\n/m, ''), thoseDoc, thoseStops));
assert.throws(() => checkStops(fourDoc, thoseDoc.replace('stops at 0x0600ee44 (+0x30 & 0x00000008)', 'stops at 0x0600ee78 (+0x6c0 & 0x00030000)'), thoseStops));

/* The flag at 0x0600ed6a: the one stop "The flags those four stop at" left
 * undescribed. Its flag is the one that section names and the disc's; the set
 * side's branch lands on 0x0600ed64's set path past the stores that row names,
 * and each side's lone stop is the one its cell names */
const ed6aDoc = kindsDoc.split('#### The flag at 0x0600ed6a\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
function checkEd6a(text, four) {
    const at = 0x0600ed6a, sides = FM.flagSides(game, run9, at);
    const named = four.match(new RegExp(String.raw`stops at 0x0600ed6a \((${FLAG})\)`))[1];
    const rows = [...text.matchAll(new RegExp(String.raw`^\| (0x[\da-f]{8}) \| (${FLAG}) \| (.*?) \| (.*?) \|$`, 'gm'))];
    assert.deepEqual(rows.map(r => [r[1], r[2]]), [['0x0600ed6a', named]]);
    assert.equal(eventFlag(sides.flag), named, '0x0600ed6a: the disc\'s flag');
    const tst = word(at), mov = word(0x0600ed68), mask = game.prg.readUInt32BE(game.at((0x0600ed68 & ~3) + 4 + (mov & 0xff) * 4));
    assert.ok((tst & 0xf00f) === 0x2008 && (mov & 0xf000) === 0xd000 && [(tst >> 8) & 15, (tst >> 4) & 15].includes((mov >> 8) & 15), '0x0600ed6a: tst with the 0x0600ed68 load');
    assert.equal(h(mask, 8), text.match(/r3 (0x[\da-f]{8}),\nloaded at 0x0600ed68/)[1], 'the mask loaded at 0x0600ed68');
    const bits = [...text.match(/three bits \(([^)]+)\)/)[1].matchAll(/0x[\da-f]{8}/g)].map(m => parseInt(m[0], 16));
    assert.equal(bits.reduce((a, b) => a | b, 0), sides.flag.mask, 'the mask\'s bits');
    assert.equal(bits.length, sides.flag.mask.toString(2).replace(/0/g, '').length, 'how many bits');
    const [, , , set, clear] = rows[0];
    for (const [cell, events, s] of [[set, sides.set, 'set'], [clear, sides.clear, 'clear']]) {
        assert.equal(events.length, 1, `${s}: one event`);
        const [stop] = events, m = cell.match(new RegExp(String.raw`stops at (0x[\da-f]{8}) \((${FLAG})\) $|stops at (0x[\da-f]{8}) \((${FLAG})\)$`));
        assert.ok(m && cell.startsWith('changes nothing in the jump before it '), `${s}: ${cell}`);
        assert.equal(stop.kind, 'stop', s);
        assert.equal(h(stop.at, 8), m[1] ?? m[3], `${s}: where it stops`);
        assert.equal(eventFlag(stop), m[2] ?? m[4], `${s}: the flag it stops at`);
        assert.notEqual(eventFlag(stop), named, `${s}: not this flag`);
    }
    /* the bf at 0x0600ed6c goes to the set side: its target, past 0x0600ed64's last store */
    const b = word(at + 2), target = ((b & 0xff) << 24 >> 24) * 2 + at + 6;
    assert.ok((b & 0xff00) === 0x8b00, '0x0600ed6c: bf');
    const [, to, s1, s2] = set.match(/branches to (0x[\da-f]{8}), on 0x0600ed64's set path past its stores at (0x[\da-f]{8}) and (0x[\da-f]{8}),/);
    assert.equal(h(target, 8), to, 'the set side\'s branch');
    const ed64 = four.match(/^\| 0x0600ed64 \| .*? \| (.*?) \| .*$/m)[1];
    for (const x of [s1, s2]) assert.ok(ed64.includes(`(${x})`) && parseInt(x, 16) < target, `${x}: a store on 0x0600ed64's set path before ${to}`);
    const ed64Stores = FM.flagSides(game, run9, 0x0600ed64).set.filter(e => e.kind === 'store');
    assert.deepEqual(ed64Stores.filter(e => e.at >= 0x0600ee00).map(e => h(e.at, 8)), [s1, s2], 'the last stores before the branch target');
    assert.ok(ed64.includes(`stops at ${h(sides.set[0].at, 8)} (${eventFlag(sides.set[0])})`), 'the set side joins 0x0600ed64\'s stop');
    /* the bullet, and the stops left undescribed */
    const bullet = text.match(/^- \*\*(.+?)\*\*:([^]*?)\n\n/m), body = bullet[2].replace(/\s+/g, ' ');
    assert.equal(bullet[1], named);
    assert.deepEqual([...body.matchAll(/nothing changes before (0x[\da-f]{8})/g)].map(m => m[1]), [sides.set, sides.clear].map(e => h(e[0].at, 8)));
    const listed = text.match(/The\nflags tested at ([^]+?) are left undescribed/)[1].match(/0x[\da-f]{8}/g);
    assert.deepEqual(listed, [sides.clear, sides.set].map(e => h(e[0].at, 8)).sort(), 'the undescribed stops');
    assert.ok(thoseDoc.includes(`| ${listed[1]} | ${eventFlag(sides.set[0])} |`), '0x0600ee16\'s row in "The flags those stop at"');
    /* 0x0600ed74: bit 0x01 of the byte +0x2e is the long +0x2c's 0x00000100 */
    const [, bit, byte] = text.match(/0x0600ed74 tests bit (0x[\da-f]{2}) of the byte (\+0x[\da-f]+)/);
    assert.equal(word(0x0600ed74), 0xc800 | parseInt(bit, 16), '0x0600ed74: tst #bit');
    assert.equal(flagText(asLongFlag({ field: parseInt(byte.slice(1), 16), size: 1 }, parseInt(bit, 16)).field, asLongFlag({ field: parseInt(byte.slice(1), 16), size: 1 }, parseInt(bit, 16)).mask), eventFlag(sides.clear[0]));
}
checkEd6a(ed6aDoc, fourDoc);
for (const [from, to] of [['| 0x0600ed6a | the opponent\'s +0x19f0 & 0x00024100 |', '| 0x0600ed6a | the opponent\'s +0x19f0 & 0x00004100 |'],
    ['| 0x0600ed6a | the opponent\'s +0x19f0 & 0x00024100 |', '| 0x0600ed6a | +0x19f0 & 0x00024100 |'],
    ['r3 0x00024100,', 'r3 0x00024000,'], ['(0x00020000, 0x00004000,\n0x00000100)', '(0x00020000, 0x00004000,\n0x00000200)'],
    ['branches to 0x0600ee0e', 'branches to 0x0600ee10'], ['past its stores at 0x0600ee0a and 0x0600ee0c', 'past its stores at 0x0600ed8e and 0x0600ee0c'],
    ['stops at 0x0600ee16 (+0x6c0 & 0x40000000) |', 'stops at 0x0600ee16 (+0x6c0 & 0x20000000) |'], ['stops at 0x0600ee16 (+0x6c0', 'stops at 0x0600ee18 (+0x6c0'],
    ['stops at 0x0600ed74 (+0x2c & 0x00000100)', 'stops at 0x0600ed74 (+0x2c & 0x00000001)'], ['stops at 0x0600ed74 (+0x2c', 'stops at 0x0600ed76 (+0x2c'],
    ['| changes nothing in the jump before it stops at 0x0600ed74', '| sets +0x20 (0x0600ed74) and stops at 0x0600ed74'],
    ['nothing changes before 0x0600ed74', 'nothing changes before 0x0600ee16'], ['tests bit 0x01 of the byte +0x2e', 'tests bit 0x02 of the byte +0x2e'],
    ['tests bit 0x01 of the byte +0x2e', 'tests bit 0x01 of the byte +0x2f'], ['flags tested at 0x0600ed74 and 0x0600ee16', 'flags tested at 0x0600ed74']]) {
    assert.ok(ed6aDoc.includes(from), from);
    assert.throws(() => checkEd6a(ed6aDoc.replace(from, to), fourDoc), `${from} -> ${to}`);
}
/* "The flags those four stop at" naming another mask for it fails too */
assert.throws(() => checkEd6a(ed6aDoc, fourDoc.replace('stops at 0x0600ed6a (the opponent\'s +0x19f0 & 0x00024100)', 'stops at 0x0600ed6a (the opponent\'s +0x19f0 & 0x00004100)')));

/* The flag at 0x0600ed74: the stop "The flag at 0x0600ed6a" left undescribed.
 * The four words that load and test it, this fighter's (r12) byte bit as the
 * long's flag; the bf's target is the one 0x0600ed6a's set side branches to,
 * and the fall-through is where 0x0600ed64's bf lands, with the same events */
const ed74Doc = kindsDoc.split('#### The flag at 0x0600ed74\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
function checkEd74(text, ed6a, four) {
    const at = 0x0600ed74, sides = FM.flagSides(game, run9, at);
    const named = ed6a.match(new RegExp(String.raw`stops at 0x0600ed74 \((${FLAG})\)`))[1];
    const rows = [...text.matchAll(new RegExp(String.raw`^\| (0x[\da-f]{8}) \| (${FLAG}) \| (.*?) \| (.*?) \|$`, 'gm'))];
    assert.deepEqual(rows.map(r => [r[1], r[2]]), [['0x0600ed74', named]]);
    assert.equal(eventFlag(sides.flag), named, '0x0600ed74: the disc\'s flag');
    /* mov rM,r1; add #imm,r1; mov.b @r1,r0; tst #bit,r0; bf */
    const [, m, imm, bit] = text.match(/0x0600ed6e is\n`mov r(\d+),r1`, 0x0600ed70 `add #(0x[\da-f]+),r1`, 0x0600ed72 `mov\.b @r1,r0` and\n0x0600ed74 `tst #(0x[\da-f]{2}),r0`, then `bf` at 0x0600ed76/);
    assert.equal(word(0x0600ed6e), 0x6103 | (+m << 4), 'mov rM,r1');
    assert.equal(word(0x0600ed70), 0x7100 | parseInt(imm, 16), 'add #imm,r1');
    assert.equal(word(0x0600ed72), 0x6010, 'mov.b @r1,r0');
    assert.equal(word(at), 0xc800 | parseInt(bit, 16), 'tst #bit,r0');
    assert.equal(+m, 12, 'this fighter is r12');
    assert.ok(sides.flag.of !== 13 && !named.startsWith('the opponent'), 'not the opponent\'s');
    const [, tbit, tbyte, who] = text.match(/That is bit (0x[\da-f]{2}) of\nthe byte (\+0x[\da-f]+) of (this fighter \(r12\)), not the opponent's/);
    assert.deepEqual([tbit, tbyte.slice(1)], [bit, imm], 'the bit and byte named');
    const long = asLongFlag({ field: parseInt(imm, 16), size: 1 }, parseInt(bit, 16));
    assert.equal(flagText(long.field, long.mask), named, 'the byte bit as the long\'s flag');
    assert.equal(text.match(/it is the long (\+0x[\da-f]+)'s (0x[\da-f]{8})/).slice(1).join(' & '), named);
    const b = word(at + 2), target = ((b & 0xff) << 24 >> 24) * 2 + at + 6;
    assert.equal(b & 0xff00, 0x8b00, '0x0600ed76: bf, so the branch is the set side');
    const [, , , set, clear] = rows[0];
    /* set: no event but the stop; the branch is 0x0600ed6a's set side's */
    const [, to, s1, s2, sa, sf] = set.match(new RegExp(String.raw`^changes nothing in the jump before it branches to (0x[\da-f]{8}), on 0x0600ed64's set path past its stores at (0x[\da-f]{8}) and (0x[\da-f]{8}), and stops at (0x[\da-f]{8}) \((${FLAG})\)$`));
    assert.equal(h(target, 8), to, 'the set side\'s branch');
    assert.equal(ed6a.match(/branches to (0x[\da-f]{8})/)[1], to, 'the branch 0x0600ed6a\'s set side takes');
    assert.deepEqual(sides.set.map(e => [e.kind, h(e.at, 8), eventFlag(e)]), [['stop', sa, sf]], 'set: one stop');
    const ed64 = FM.flagSides(game, run9, 0x0600ed64);
    assert.deepEqual(ed64.set.filter(e => e.kind === 'store' && e.at >= 0x0600ee00).map(e => h(e.at, 8)), [s1, s2], 'the stores before the target');
    assert.ok(s1 < to && s2 < to);
    /* clear: falls through to where 0x0600ed64's set side starts, and is that side */
    const [, from, ca, cf] = clear.match(new RegExp(String.raw`^goes on to (0x[\da-f]{8}), where 0x0600ed64's set path starts, and does what "The flags those four stop at" says that side does, to its stop at (0x[\da-f]{8}) \((${FLAG})\)$`));
    const b64 = word(0x0600ed66), t64 = ((b64 & 0xff) << 24 >> 24) * 2 + 0x0600ed64 + 6;
    assert.equal(b64 & 0xff00, 0x8b00, '0x0600ed66: bf');
    assert.deepEqual([h(at + 4, 8), h(t64, 8)], [from, from], 'the fall-through is 0x0600ed64\'s set side');
    assert.deepEqual(sides.clear, ed64.set, 'clear: 0x0600ed64\'s set side');
    const last = sides.clear.at(-1);
    assert.deepEqual([last.kind, h(last.at, 8), eventFlag(last)], ['stop', ca, cf], 'clear: its stop');
    assert.ok(four.match(/^\| 0x0600ed64 \| .*? \| (.*?) \| .*$/m)[1].endsWith(`stops at ${ca} (${cf})`), 'that row\'s set side names that stop');
    /* the bullet, and the stop left undescribed */
    const bullet = text.match(/^- \*\*(.+?)\*\*:([^]*?)\n\n/m), body = bullet[2].replace(/\s+/g, ' ');
    assert.equal(bullet[1], named);
    assert.deepEqual([...body.matchAll(/nothing changes before (0x[\da-f]{8})/g)].map(m => m[1]), [sa], 'set: nothing changes before its stop');
    assert.match(body, /; clear, it joins 0x0600ed64's set path where it starts,/);
    const [, left] = text.match(/Both\nsides stop at (0x[\da-f]{8}), whose flag is in "The flags those stop at"/);
    assert.deepEqual([sa, ca], [left, left], 'both sides\' stop');
    assert.ok(thoseDoc.includes(`| ${left} | ${sf} |`), `${left}'s row in "The flags those stop at"`);
}
checkEd74(ed74Doc, ed6aDoc, fourDoc);
for (const [from, to] of [['| 0x0600ed74 | +0x2c & 0x00000100 |', '| 0x0600ed74 | +0x2c & 0x00000001 |'],
    ['| 0x0600ed74 | +0x2c & 0x00000100 |', '| 0x0600ed74 | the opponent\'s +0x2c & 0x00000100 |'],
    ['`mov r12,r1`', '`mov r13,r1`'], ['`add #0x2e,r1`', '`add #0x2f,r1`'], ['`tst #0x01,r0`', '`tst #0x02,r0`'],
    ['That is bit 0x01 of', 'That is bit 0x02 of'], ['the byte +0x2e of', 'the byte +0x2f of'], ['the long +0x2c\'s 0x00000100', 'the long +0x2c\'s 0x00000001'],
    ['branches to 0x0600ee0e', 'branches to 0x0600ee10'], ['past its stores at 0x0600ee0a and 0x0600ee0c', 'past its stores at 0x0600ed8e and 0x0600ee0c'],
    ['0x0600ee0c, and stops at 0x0600ee16 (+0x6c0 & 0x40000000)', '0x0600ee0c, and stops at 0x0600ee16 (+0x6c0 & 0x20000000)'],
    ['goes on to 0x0600ed78', 'goes on to 0x0600ed7a'], ['to its stop at 0x0600ee16', 'to its stop at 0x0600ee18'],
    ['| changes nothing in the jump before it branches', '| sets +0x20 (0x0600ee0a) and branches'],
    ['nothing changes before 0x0600ee16', 'nothing changes before 0x0600ed78'], ['clear, it joins\n  0x0600ed64\'s set path where it starts', 'clear, nothing\n  changes before 0x0600ee16'],
    ['sides stop at 0x0600ee16', 'sides stop at 0x0600ed78']]) {
    assert.ok(ed74Doc.includes(from), from);
    assert.throws(() => checkEd74(ed74Doc.replace(from, to), ed6aDoc, fourDoc), `${from} -> ${to}`);
}
/* "The flag at 0x0600ed6a" naming another flag for it fails too */
assert.throws(() => checkEd74(ed74Doc, ed6aDoc.replace('stops at 0x0600ed74 (+0x2c & 0x00000100)', 'stops at 0x0600ed74 (+0x2c & 0x00000001)'), fourDoc));

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
/* Flag tests not yet described: every tst in the run handler that a bt or bf
 * branches on and flagSides reads as a fighter field and mask, less the ones
 * another Kinds subsection has in its "Tested at" column, in address order */
const RUN9_END = 0x0600f400;
const newDoc = kindsDoc.split('#### Flag tests not yet described\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
function describedAt(kinds) {
    const out = new Set();
    for (const part of kinds.split('\n#### The flag at 0x0600ea64\n')[0].split('\n#### ').slice(1).filter(p => !p.startsWith('Flag tests not yet described'))) {
        const lines = part.split('\n'), head = lines.findIndex(l => /^\| .*Tested at/.test(l));
        if (head < 0) continue;
        const col = lines[head].split('|').map(c => c.trim()).indexOf('Tested at');
        for (const l of lines.slice(head + 2)) {
            if (!l.startsWith('|')) break;
            out.add(l.split('|').map(c => c.trim())[col]);
        }
    }
    return out;
}
function runTests() {
    const tests = [], other = [];
    for (let a = run9; a <= RUN9_END; a += 2) {
        const w = word(a), b = word(a + 2), n = (w >> 8) & 15, m = (w >> 4) & 15;
        if (!((w & 0xff00) === 0xc800 || (w & 0xf00f) === 0x2008 && n !== m) || (b & 0xf900) !== 0x8900) continue;
        assert.ok(FM.handlerReaches(game, run9, run9, a), `${h(a, 8)}: in the run handler`);
        const t = FM.handlerTest(game, run9, a);
        if (!t) { other.push(h(a, 8)); continue; }
        tests.push([h(a, 8), t.of === 13 ? 'the opponent (r13)' : 'this fighter (r12)', `+${h(t.field, 2)}`, h(t.mask, 8)]);
    }
    return { tests, other };
}
function checkUndescribed(text, kinds) {
    const described = describedAt(kinds), { tests, other } = runTests();
    for (const a of ['0x0600ed16', '0x0600eeca', '0x0600f3a4']) assert.ok(described.has(a), `${a} described`);
    const rows = [...text.matchAll(/^\| (0x[\da-f]{8}) \| (.+?) \| (.+?) \| (.+?) \|$/gm)].map(r => r.slice(1));
    const want = tests.filter(([a]) => !described.has(a));
    assert.deepEqual(rows, want, 'the undescribed flag tests');
    for (const [a] of rows) {
        const sides = FM.flagSides(game, run9, parseInt(a, 16));
        assert.equal(eventFlag(sides.flag), rows.find(r => r[0] === a).slice(2).join(' & '), `${a}: flagSides' flag`);
    }
    const [, from, to] = text.match(/kind 9's run handler, (0x[\da-f]{8}) to (0x[\da-f]{8}),/);
    assert.deepEqual([from, to], [h(run9, 8), h(RUN9_END, 8)], 'the range');
    const listed = text.match(/and those at\n?([^]+?), whose value isn't a fighter field/)[1].match(/0x[\da-f]{8}/g);
    assert.deepEqual(listed, other, 'the tsts that read no fighter field');
}
checkUndescribed(newDoc, kindsDoc);
const firstRow = newDoc.match(/^\| 0x0600ea64 .*\n/m)[0];
for (const [from, to] of [[firstRow, ''], ['| 0x0600f37e | this fighter (r12) | +0x70 | 0x00040000 |\n', ''],
    [firstRow, '| 0x0600ed16 | this fighter (r12) | +0x00 | 0x00000020 |\n' + firstRow],
    ['| 0x0600f37e |', '| 0x0600f3a4 | this fighter (r12) | +0x6c0 | 0x20000000 |\n| 0x0600f37e |'],
    ['| 0x0600eb62 | this fighter (r12) | +0x4a4 |', '| 0x0600eb62 | this fighter (r12) | +0x4a7 |'],
    ['| 0x0600f008 | this fighter (r12) | +0x11d4 | 0x00100000 |', '| 0x0600f008 | this fighter (r12) | +0x11d4 | 0x00000010 |'],
    ['| 0x0600ecd0 | this fighter (r12) | +0x6c0 | 0x02000000 |', '| 0x0600ecd0 | this fighter (r12) | +0x6c0 | 0x04000000 |'],
    ['| 0x0600ea64 | this fighter (r12) |', '| 0x0600ea64 | the opponent (r13) |'],
    ['| 0x0600eb44 |', '| 0x0600eb46 |'], ['0x0600ee02 and 0x0600efa0', '0x0600efa0']]) {
    assert.ok(newDoc.includes(from), from);
    assert.throws(() => checkUndescribed(newDoc.replace(from, to), kindsDoc), `${from} -> ${to}`);
}
/* a row swapped out of address order fails, and so does a Kinds subsection losing a row */
const r1 = newDoc.match(/^\| 0x0600eaee .*\n/m)[0], r2 = newDoc.match(/^\| 0x0600eaf6 .*\n/m)[0];
assert.throws(() => checkUndescribed(newDoc.replace(r1 + r2, r2 + r1), kindsDoc));
assert.throws(() => checkUndescribed(newDoc, kindsDoc.replace(/^\| 0x0600ed74 \| \+0x2c .*\n/m, '')));

/* The flag at 0x0600ea64: the earliest row of "Flag tests not yet described".
 * The five words that load and test it, this fighter's (r12) long; a bt, so
 * the branch is the clear side. Each cell is rebuilt from flagSides' events
 * on a fresh read, with the compare, the bit cleared and the call's literal
 * read off the disc; the stop is a row of that list and of no other section */
const ea64Doc = kindsDoc.split('#### The flag at 0x0600ea64\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
function checkEa64(text, list) {
    const at = 0x0600ea64, sides = FM.flagSides(game, run9, at);
    const listed = list.match(/^\| 0x0600ea64 \| this fighter \(r12\) \| (\+0x[\da-f]+) \| (0x[\da-f]{8}) \|$/m);
    assert.ok(listed, '0x0600ea64\'s row in "Flag tests not yet described"');
    const named = `${listed[1]} & ${listed[2]}`;
    const rows = [...text.matchAll(new RegExp(String.raw`^\| (0x[\da-f]{8}) \| (${FLAG}) \| (.*?) \| (.*?) \|$`, 'gm'))];
    assert.deepEqual(rows.map(r => [r[1], r[2]]), [['0x0600ea64', named]]);
    assert.equal(eventFlag(sides.flag), named, '0x0600ea64: the disc\'s flag');
    /* mov #field,r0; mov.l @(r0,rM),r3; mov #bit,r0; shll16 r0; tst r0,r3; bt */
    const [, field, m, bit, op] = text.match(/0x0600ea5c is `mov #(0x[\da-f]+),r0`, 0x0600ea5e\n`mov\.l @\(r0,r(\d+)\),r3`, 0x0600ea60 `mov #(0x[\da-f]{2}),r0`, 0x0600ea62 `shll16 r0`\nand 0x0600ea64 `tst r0,r3`, then `(b[tf])` at 0x0600ea66/);
    assert.equal(word(0x0600ea5c), 0xe000 | parseInt(field, 16), 'mov #field,r0');
    assert.equal(word(0x0600ea5e), 0x030e | (+m << 4), 'mov.l @(r0,rM),r3');
    assert.equal(word(0x0600ea60), 0xe000 | parseInt(bit, 16), 'mov #bit,r0');
    assert.equal(word(0x0600ea62), 0x4028, 'shll16 r0');
    assert.equal(word(at), 0x2308, 'tst r0,r3');
    assert.equal(+m, 12, 'this fighter is r12');
    assert.ok(sides.flag.of !== 13 && !named.startsWith('the opponent'), 'not the opponent\'s');
    assert.equal(flagText(parseInt(field, 16), parseInt(bit, 16) << 16), named, 'the field and the bit shifted up 16');
    const [, lf, who, lm, pbit] = text.match(/That is the long\n?(\+0x[\da-f]+) of (this fighter \(r12\)), not the opponent's, masked with (0x[\da-f]{8}):\nparameter bit (0x[\da-f]{2})\./);
    assert.equal(`${lf} & ${lm}`, named, 'the long and mask named');
    assert.equal(parseInt(pbit, 16), sides.flag.mask >>> 16, 'the parameter bit');
    const b = word(at + 2), target = ((b & 0xff) << 24 >> 24) * 2 + at + 6;
    assert.equal(b & 0xff00, 0x8900, '0x0600ea66: bt, so the branch is the clear side');
    assert.equal(op, 'bt', 'the branch named');
    assert.match(text, /The `bt` branches when the bit is clear, so the\nbranch is the clear side and the fall-through the set side\./);
    /* what flagSides lists, in words */
    const say = e => e.kind === 'call' ? `calls ${h(e.target, 8)} (${h(e.at, 8)})`
        : e.kind === 'param' ? `stops at ${h(e.at, 8)} (${flagText(0x70, e.bit << 16)})`
        : e.kind === 'store' && e.values.length === 1 && e.values[0] === null ? `sets +${h(e.field, 2)} (${h(e.at, 8)})`
        : e.kind === 'store' && e.values.length === 1 && e.values[0]?.size === 1 && e.size === 2 && Object.keys(e.values[0]).length === 2
            ? `puts the byte +${h(e.values[0].field, 2)} in the halfword +${h(e.field, 2)} (${h(e.at, 8)})` : assert.fail(JSON.stringify(e));
    const [st, call, ...rest] = sides.set;
    assert.deepEqual([st.kind, st.field, st.size, call.kind], ['store', 0x70, 4, 'call'], 'set: the store to +0x70, then the call');
    assert.deepEqual(rest.map(e => e.kind), ['store', 'store', 'param'], 'set: two stores, then the stop');
    /* the store: +0x70 as loaded at 0x0600ea5e, and'd with a literal: the bit cleared */
    const lit = a => game.prg.readUInt32BE(game.at(((a + 4) & ~3) + (word(a) & 0xff) * 4));
    assert.deepEqual([word(st.at - 6) & 0xff00, word(st.at - 4), word(st.at - 2), word(st.at)], [0xd000, 0x2309, 0xe070, 0x0c36], 'mov.l lit,r0; and r0,r3; mov #0x70,r0; mov.l r3,@(r0,r12)');
    const clears = `clears ${flagText(0x70, ~lit(st.at - 6) >>> 0)} (${h(st.at, 8)})`;
    /* the compare: the halfwords +A and +B, cmp/gt, and a bt past the call's delay slot */
    const hw = a => game.prg.readInt16BE(game.at(a + 4 + (word(a) & 0xff) * 2));
    assert.deepEqual([word(0x0600ea68) & 0xff00, word(0x0600ea6a), word(0x0600ea6c) & 0xff00, word(0x0600ea6e), word(0x0600ea70), word(0x0600ea72) & 0xff00],
        [0x9000, 0x01cd, 0x9000, 0x02cd, 0x3127, 0x8900], 'r1 = the halfword +A, r2 = +B, cmp/gt r2,r1, bt');
    const skip = ((word(0x0600ea72) & 0xff) << 24 >> 24) * 2 + 0x0600ea76;
    assert.equal(skip, call.at + 4, 'the bt skips the store and the call');
    const unless = `unless the halfword +${h(hw(0x0600ea68), 2)} is over the halfword +${h(hw(0x0600ea6c), 2)} (0x0600ea70)`;
    const tail = rest.map(say).join('; ');
    assert.equal(rows[0][3], `${unless}, ${clears} and ${say(call)}; ${tail}`, 'the set cell');
    /* clear: the branch lands on the call's literal load and joins the set side */
    assert.deepEqual(sides.clear, sides.set.slice(1), 'clear: the set side from the call on');
    assert.equal(word(target) & 0xff00, 0xd000, 'the branch loads the call\'s target');
    assert.deepEqual([lit(target), target + 2], [call.target, call.at], 'the call it loads');
    assert.equal(rows[0][4], `branches to ${h(target, 8)}, where the set side's call is loaded, and ${say(call)}; ${tail}`, 'the clear cell');
    /* the stop: a row of the list, no other section's, and named with its fighter */
    const stop = rest.at(-1), stopAt = h(stop.at, 8), stopFlag = flagText(0x70, stop.bit << 16);
    assert.equal(FM.handlerTest(game, run9, stop.at).of, undefined, 'the stop tests r12');
    assert.ok(list.includes(`| ${stopAt} | this fighter (r12) | +0x70 | ${h(stop.bit << 16, 8)} |`), `${stopAt}'s row in the list`);
    assert.ok(!describedAt(kindsDoc).has(stopAt), `${stopAt} is no other section's`);
    const [, sa, sf, sp] = text.match(/Both sides stop at (0x[\da-f]{8}), which tests this fighter's \(r12\) (\+0x[\da-f]+ &\n?0x[\da-f]{8}), parameter bit (0x[\da-f]{2}); it is a row in "Flag tests not yet\ndescribed" and is left undescribed here\./);
    assert.deepEqual([sa, sf.replace('\n', ' '), parseInt(sp, 16)], [stopAt, stopFlag, stop.bit], 'the stop named');
    for (const s of ['set', 'clear']) assert.ok(!sides[s].some(e => e.field === 0 && e.mask === 0x10000000), `${s}: not +0 bit 0x10000000`);
    /* the bullet */
    const bullet = text.match(/^- \*\*(.+?)\*\*:([^]*?)\n\n/m), body = bullet[2].replace(/\s+/g, ' ');
    assert.equal(bullet[1], named);
    assert.equal(body, ` set, it clears this same bit and calls ${h(call.target, 8)}, unless the halfword +${h(hw(0x0600ea68), 2)} is over +${h(hw(0x0600ea6c), 2)}; clear, it calls ${h(call.target, 8)} with no compare. Both sides then put the byte +${h(rest[0].values[0].field, 2)} in +${h(rest[0].field, 2)} and set +${h(rest[1].field, 2)} before they stop at ${stopAt}.`);
    assert.equal(lit(st.at - 6), ~sides.flag.mask >>> 0, 'the bit cleared is this flag');
}
checkEa64(ea64Doc, newDoc);
for (const [from, to] of [['`mov #0x70,r0`', '`mov #0x71,r0`'], ['`mov.l @(r0,r12),r3`', '`mov.l @(r0,r13),r3`'], ['`mov #0x08,r0`', '`mov #0x10,r0`'],
    ['then `bt` at', 'then `bf` at'], ['| 0x0600ea64 | +0x70 & 0x00080000 |', '| 0x0600ea64 | +0x70 & 0x00100000 |'],
    ['| 0x0600ea64 | +0x70 & 0x00080000 |', '| 0x0600ea64 | the opponent\'s +0x70 & 0x00080000 |'], ['| 0x0600ea64 | +0x70 & 0x00080000 |', '| 0x0600ea64 | +0x74 & 0x00080000 |'],
    ['long\n+0x70 of', 'long\n+0x74 of'], ['masked with 0x00080000', 'masked with 0x00008000'], ['parameter bit 0x08', 'parameter bit 0x80'],
    ['branch is the clear side and the fall-through the set side', 'branch is the set side and the fall-through the clear side'],
    ['branches to 0x0600ea7c', 'branches to 0x0600ea7e'], ['(0x0600ea70), clears', '(0x0600ea72), clears'],
    ['clears +0x70 & 0x00080000 (0x0600ea7a)', 'clears +0x70 & 0x00100000 (0x0600ea7a)'],
    ['(0x0600ea7e); puts the byte +0x4aa in the halfword +0x4a8 (0x0600ea88); sets +0x24 (0x0600eac8); stops at 0x0600ead0 (+0x70 & 0x00100000) |\n', '(0x0600ea7e); puts the byte +0x4aa in the halfword +0x4a8 (0x0600ea88); sets +0x24 (0x0600eac8); stops at 0x0600ead2 (+0x70 & 0x00100000) |\n'],
    ['0x0600ead0 (+0x70 & 0x00100000) |\n', '0x0600ead0 (+0x70 & 0x00200000) |\n'],
    ['calls 0x060131d0 (0x0600ea7e); puts', 'calls 0x06024094 (0x0600ea7e); puts'],
    ['| unless the halfword', '| branches to 0x0600ea7c, where the set side\'s call is loaded, and calls 0x060131d0 (0x0600ea7e); puts the byte'],
    ['Both sides stop at 0x0600ead0', 'Both sides stop at 0x0600ed16'], ['which tests this fighter\'s (r12) +0x70 &\n0x00100000', 'which tests this fighter\'s (r12) +0x70 &\n0x00200000'],
    ['set, it clears this same bit', 'set, it sets this same bit'], ['before they stop at 0x0600ead0.', 'before they stop at 0x0600ee16.']]) {
    assert.ok(ea64Doc.includes(from), from);
    assert.throws(() => checkEa64(ea64Doc.replace(from, to), newDoc), `${from} -> ${to}`);
}
/* the list's row naming another field or mask, or losing the stop's row, fails too */
assert.throws(() => checkEa64(ea64Doc, newDoc.replace('| 0x0600ea64 | this fighter (r12) | +0x70 | 0x00080000 |', '| 0x0600ea64 | this fighter (r12) | +0x70 | 0x00100000 |')));
assert.throws(() => checkEa64(ea64Doc, newDoc.replace(/^\| 0x0600ead0 .*\n/m, '')));

/* The flag at 0x0600ead0: where both sides of 0x0600ea64 stop. A byte test
 * of this fighter (r12), read as the long holding it, big-endian; a bt, so
 * the branch is the clear side. Each side is what flagSides lists on a
 * fresh read: no store or call, then a stop that is a row of the list and
 * of no other section */
const ead0Doc = kindsDoc.split('#### The flag at 0x0600ead0\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
function checkEad0(text, list) {
    const at = 0x0600ead0, sides = FM.flagSides(game, run9, at);
    const listed = list.match(/^\| 0x0600ead0 \| this fighter \(r12\) \| (\+0x[\da-f]+) \| (0x[\da-f]{8}) \|$/m);
    assert.ok(listed, '0x0600ead0\'s row in "Flag tests not yet described"');
    const named = `${listed[1]} & ${listed[2]}`;
    const rows = [...text.matchAll(new RegExp(String.raw`^\| (0x[\da-f]{8}) \| (${FLAG}) \| (.*?) \| (.*?) \|$`, 'gm'))];
    assert.deepEqual(rows.map(r => [r[1], r[2]]), [['0x0600ead0', named]]);
    assert.equal(eventFlag(sides.flag), named, '0x0600ead0: the disc\'s flag');
    /* mov rM,r1; add #byte,r1; mov.b @r1,r0; tst #bit,r0; bt */
    const [, m, byte, bit, op] = text.match(/0x0600eaca is `mov r(\d+),r1`, 0x0600eacc `add #(0x[\da-f]{2}),r1`, 0x0600eace\n`mov\.b @r1,r0` and 0x0600ead0 `tst #(0x[\da-f]{2}),r0`, then `(b[tf])` at 0x0600ead2\./);
    assert.equal(word(0x0600eaca), 0x6103 | (+m << 4), 'mov rM,r1');
    assert.equal(word(0x0600eacc), 0x7100 | parseInt(byte, 16), 'add #byte,r1');
    assert.equal(word(0x0600eace), 0x6010, 'mov.b @r1,r0');
    assert.equal(word(at), 0xc800 | parseInt(bit, 16), 'tst #bit,r0');
    assert.equal(+m, 12, 'this fighter is r12');
    assert.ok(sides.flag.of !== 13, 'not the opponent\'s');
    const b = +byte, long = b & ~3, mask = (parseInt(bit, 16) << (8 * (3 - (b & 3)))) >>> 0;
    assert.equal(flagText(long, mask), named, 'the byte as the big-endian long holding it');
    const [, tb, tbyte, who, tlong, tmask, pbit] = text.match(/That is bit (0x[\da-f]{2}) of the byte (\+0x[\da-f]+) of (this fighter \(r12\)), not the\nopponent's; on the big-endian SH-2 it is the long (\+0x[\da-f]+)'s (0x[\da-f]{8}):\nparameter bit (0x[\da-f]{2})\./);
    assert.deepEqual([tb, tbyte, `${tlong} & ${tmask}`], [bit, `+${byte}`, named], 'the byte and the long named');
    assert.equal(who, 'this fighter (r12)');
    assert.equal(parseInt(pbit, 16), sides.flag.mask >>> 16, 'the parameter bit');
    const w = word(at + 2), target = ((w & 0xff) << 24 >> 24) * 2 + at + 6;
    assert.equal(w & 0xff00, 0x8900, '0x0600ead2: bt, so the branch is the clear side');
    assert.equal(op, 'bt', 'the branch named');
    assert.match(text, /The `bt` branches when the bit is clear, so the\nbranch is the clear side and the fall-through the set side\./);
    /* each side: no store or call, only its stop */
    assert.deepEqual(sides.set.map(e => e.kind), ['stop'], 'set: only the stop');
    assert.deepEqual(sides.clear.map(e => e.kind), ['param'], 'clear: only the stop');
    const [ss] = sides.set, [cs] = sides.clear;
    const sStop = flagText(ss.field, ss.mask), cStop = flagText(0x70, cs.bit << 16);
    assert.equal(ss.of, undefined, 'the set side\'s stop tests r12');
    /* set: falls through to a bra (delay slot nop) */
    const bra = word(at + 4), braTo = ((bra & 0xfff) << 20 >> 20) * 2 + at + 8;
    assert.deepEqual([bra & 0xf000, word(at + 6)], [0xa000, 0x0009], 'bra, nop');
    assert.equal(rows[0][3], `goes on to the \`bra\` at ${h(at + 4, 8)}, which branches to ${h(braTo, 8)}; no store or call; stops at ${h(ss.at, 8)} (${sStop})`, 'the set cell');
    assert.equal(rows[0][4], `branches to ${h(target, 8)}; no store or call; stops at ${h(cs.at, 8)} (${cStop})`, 'the clear cell');
    const bullet = text.match(/^- \*\*(.+?)\*\*:([^]*?)\n\n/m), body = bullet[2].replace(/\s+/g, ' ');
    assert.equal(bullet[1], named);
    assert.equal(body, ` set, it jumps ahead to ${h(braTo, 8)} and stops at ${h(ss.at, 8)}; clear, it goes on at ${h(target, 8)} and stops at ${h(cs.at, 8)}. Neither side stores or calls anything before its stop.`);
    /* the stops: rows of the list, no other section's */
    const described = describedAt(kindsDoc);
    for (const [a, f] of [[ss.at, sStop], [cs.at, cStop]]) {
        assert.ok(list.includes(`| ${h(a, 8)} | this fighter (r12) | ${f.replace(' & ', ' | ')} |`), `${h(a, 8)}'s row in the list`);
        assert.ok(!described.has(h(a, 8)), `${h(a, 8)} is no other section's`);
        assert.equal(FM.handlerTest(game, run9, a).of, undefined, `${h(a, 8)} tests r12`);
    }
    const [, sa, sf, ca, cf, cp] = text.match(/The set side stops at (0x[\da-f]{8}), which tests this fighter's \(r12\)\n(\+0x[\da-f]+ & 0x[\da-f]{8}); the clear side stops at (0x[\da-f]{8}), which tests this\nfighter's \(r12\) (\+0x[\da-f]+ & 0x[\da-f]{8}), parameter bit (0x[\da-f]{2})\. Both are rows in\n"Flag tests not yet described" and are left undescribed here\./);
    assert.deepEqual([sa, sf, ca, cf, parseInt(cp, 16)], [h(ss.at, 8), sStop, h(cs.at, 8), cStop, cs.bit], 'the stops named');
    for (const s of ['set', 'clear']) assert.ok(!sides[s].some(e => e.field === 0 && e.mask === 0x10000000), `${s}: not +0 bit 0x10000000`);
}
checkEad0(ead0Doc, newDoc);
for (const [from, to] of [['`mov r12,r1`', '`mov r13,r1`'], ['`add #0x71,r1`', '`add #0x70,r1`'], ['`tst #0x10,r0`', '`tst #0x20,r0`'],
    ['then `bt` at', 'then `bf` at'], ['| 0x0600ead0 | +0x70 & 0x00100000 |', '| 0x0600ead0 | +0x70 & 0x00200000 |'],
    ['| 0x0600ead0 | +0x70 & 0x00100000 |', '| 0x0600ead0 | the opponent\'s +0x70 & 0x00100000 |'], ['| 0x0600ead0 | +0x70 & 0x00100000 |', '| 0x0600ead0 | +0x74 & 0x00100000 |'],
    ['of this fighter (r12), not the', 'of the opponent (r13), not the'], ['byte +0x71', 'byte +0x70'], ['the long +0x70\'s 0x00100000', 'the long +0x70\'s 0x00000010'],
    ['parameter bit 0x10.', 'parameter bit 0x01.'],
    ['branch is the clear side and the fall-through the set side', 'branch is the set side and the fall-through the clear side'],
    ['which branches to 0x0600ec58', 'which branches to 0x0600ec5a'], ['branches to 0x0600ead8;', 'branches to 0x0600eada;'],
    ['stops at 0x0600ec64 (+0x4a4 & 0x00000001) |', 'stops at 0x0600ec66 (+0x4a4 & 0x00000001) |'], ['(+0x4a4 & 0x00000001) |', '(+0x4a4 & 0x00000002) |'],
    ['stops at 0x0600eaee (+0x70 & 0x00020000) |', 'stops at 0x0600eaf6 (+0x70 & 0x00020000) |'], ['(+0x70 & 0x00020000) |', '(+0x70 & 0x00040000) |'],
    ['0x0600ec58; no store or call;', '0x0600ec58; sets +0x24 (0x0600ec5a);'], ['0x0600ead8; no store or call;', '0x0600ead8; calls 0x060131d0 (0x0600eadc);'],
    ['The set side stops at 0x0600ec64', 'The set side stops at 0x0600ee16'], ['clear side stops at 0x0600eaee', 'clear side stops at 0x0600ea64'],
    ['and stops at\n  0x0600ec64', 'and stops at\n  0x0600eaee']]) {
    assert.ok(ead0Doc.includes(from), from);
    assert.throws(() => checkEad0(ead0Doc.replace(from, to), newDoc), `${from} -> ${to}`);
}
/* the list's row naming another field or mask, or losing a stop's row, fails too */
assert.throws(() => checkEad0(ead0Doc, newDoc.replace('| 0x0600ead0 | this fighter (r12) | +0x70 | 0x00100000 |', '| 0x0600ead0 | this fighter (r12) | +0x70 | 0x00080000 |')));
assert.throws(() => checkEad0(ead0Doc, newDoc.replace(/^\| 0x0600ec64 .*\n/m, '')));
assert.throws(() => checkEad0(ead0Doc, newDoc.replace(/^\| 0x0600eaee .*\n/m, '')));

/* The flag at 0x0600eaee: where the clear side of 0x0600ead0 stops. This
 * fighter's (r12) long; a bf, so the branch is the set side. The set side
 * lands on a tst of a register against itself, which flagSides follows
 * both ways: the fall-through's events lie before that bt's target, the
 * branch's from it on. Every stop is a row of the list and of no other
 * section */
const eaeeDoc = kindsDoc.split('#### The flag at 0x0600eaee\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
function checkEaee(text, list) {
    const at = 0x0600eaee, sides = FM.flagSides(game, run9, at);
    const listed = list.match(/^\| 0x0600eaee \| this fighter \(r12\) \| (\+0x[\da-f]+) \| (0x[\da-f]{8}) \|$/m);
    assert.ok(listed, '0x0600eaee\'s row in "Flag tests not yet described"');
    const named = `${listed[1]} & ${listed[2]}`;
    const rows = [...text.matchAll(new RegExp(String.raw`^\| (0x[\da-f]{8}) \| (${FLAG}) \| (.*?) \| (.*?) \|$`, 'gm'))];
    assert.deepEqual(rows.map(r => [r[1], r[2]]), [['0x0600eaee', named]]);
    assert.equal(eventFlag(sides.flag), named, '0x0600eaee: the disc\'s flag');
    /* mov #field,r0; mov.l @(r0,rM),r3; mov #bit,r0; shll16 r0; tst r0,r3; bf */
    const [, field, m, bit, op] = text.match(/0x0600eae6 is `mov #(0x[\da-f]+),r0`, 0x0600eae8 `mov\.l @\(r0,r(\d+)\),r3`,\n0x0600eaea `mov #(0x[\da-f]{2}),r0`, 0x0600eaec `shll16 r0` and 0x0600eaee\n`tst r0,r3`, then `(b[tf])` at 0x0600eaf0\./);
    assert.equal(word(0x0600eae6), 0xe000 | parseInt(field, 16), 'mov #field,r0');
    assert.equal(word(0x0600eae8), 0x030e | (+m << 4), 'mov.l @(r0,rM),r3');
    assert.equal(word(0x0600eaea), 0xe000 | parseInt(bit, 16), 'mov #bit,r0');
    assert.equal(word(0x0600eaec), 0x4028, 'shll16 r0');
    assert.equal(word(at), 0x2308, 'tst r0,r3');
    assert.equal(+m, 12, 'this fighter is r12');
    assert.ok(sides.flag.of !== 13, 'not the opponent\'s');
    assert.equal(flagText(parseInt(field, 16), parseInt(bit, 16) << 16), named, 'the field and the bit shifted up 16');
    const [, lf, who, lm, pbit] = text.match(/That is the long (\+0x[\da-f]+) of this\n(fighter \(r12\)), not the opponent's, masked with (0x[\da-f]{8}): parameter bit\n(0x[\da-f]{2})\./);
    assert.deepEqual([`${lf} & ${lm}`, who], [named, 'fighter (r12)'], 'the long and mask named');
    assert.equal(parseInt(pbit, 16), sides.flag.mask >>> 16, 'the parameter bit');
    const b = word(at + 2), target = ((b & 0xff) << 24 >> 24) * 2 + at + 6;
    assert.equal(b & 0xff00, 0x8b00, '0x0600eaf0: bf, so the branch is the set side');
    assert.equal(op, 'bf', 'the branch named');
    assert.match(text, /The `bf` branches when the bit is set, so the branch is the set\nside and the fall-through the clear side\./);
    /* what flagSides lists, in words */
    const hwLit = a => [a + 4 + (word(a) & 0xff) * 2, game.prg.readInt16BE(game.at(a + 4 + (word(a) & 0xff) * 2))];
    const stopText = e => e.kind === 'param' ? flagText(0x70, e.bit << 16) : (assert.equal(e.of, undefined, 'a stop of r12'), flagText(e.field, e.mask));
    let minus;
    const say = e => {
        if (e.kind === 'call') return `calls ${h(e.target, 8)} (${h(e.at, 8)})`;
        if (e.kind === 'param' || e.kind === 'stop') return `stops at ${h(e.at, 8)} (${stopText(e)})`;
        assert.equal(e.kind, 'store', JSON.stringify(e));
        const v = e.values;
        if (v.length === 1 && v[0] === null) return `sets +${h(e.field, 2)} (${h(e.at, 8)})`;
        if (v.length === 1 && v[0]?.field === e.field && v[0].size === e.size && e.size === 1 && v[0].plus === 1 && Object.keys(v[0]).length === 3)
            return `adds 1 to the byte +${h(e.field, 2)} (${h(e.at, 8)})`;
        if (v.length === 2 && e.size === 2 && JSON.stringify(v[0]) === JSON.stringify({ field: v[0].field, size: 2 })
            && JSON.stringify(v[1]) === JSON.stringify({ ...v[0], plus: v[1].plus })) {
            minus = v[1].plus;
            return `puts the halfword +${h(v[0].field, 2)}, or that minus ${h(-minus, 4)}, in the halfword +${h(e.field, 2)} (${h(e.at, 8)})`;
        }
        assert.fail(JSON.stringify(e));
    };
    /* set: the branch lands on tst rN,rN and a bt */
    const [, tr, tr2, btAt] = rows[0][3].match(/^branches to 0x[\da-f]{8}, where `tst r(\d+),r(\d+)` and the `bt` at (0x[\da-f]{8}) go both ways: /);
    assert.equal(tr, tr2, 'a register against itself');
    assert.equal(word(target), 0x2008 | (+tr << 8) | (+tr << 4), 'tst rN,rN');
    assert.equal(parseInt(btAt, 16), target + 2);
    const bt = word(target + 2), join = ((bt & 0xff) << 24 >> 24) * 2 + target + 6;
    assert.equal(bt & 0xff00, 0x8900, 'bt');
    const fall = sides.set.filter(e => e.at < join), taken = sides.set.filter(e => e.at >= join);
    assert.deepEqual(fall.map(e => e.kind), ['stop'], 'the fall-through: only its stop');
    assert.ok(fall[0].at > target, 'the fall-through stops past the bt');
    assert.equal(taken.at(-1).kind, 'param', 'the branch ends at a stop');
    assert.equal(rows[0][3], `branches to ${h(target, 8)}, where \`tst r${tr},r${tr}\` and the \`bt\` at ${h(target + 2, 8)} go both ways: it goes on with no store or call and ${say(fall[0])}; or it branches to ${h(join, 8)}, ${taken.map(say).join('; ')}`, 'the set cell');
    /* clear: falls through to its stop */
    assert.deepEqual(sides.clear.map(e => e.kind), ['param'], 'clear: only the stop');
    assert.equal(rows[0][4], `goes on to ${h(at + 4, 8)}; no store or call; ${say(sides.clear[0])}`, 'the clear cell');
    /* the 0x8000: a mov.w literal, sign-extended */
    const [, litAt] = text.match(/The 0x8000 is the halfword at (0x[\da-f]{8}), read with `mov\.w`, so it is\nadded as −0x8000\./);
    /* the store's register, the add into it, and the mov.w that loads what is added */
    const lw = taken.find(e => e.values?.length === 2), back = () => [...Array(16).keys()].map(i => lw.at - 2 * i);
    const sr = (word(lw.at) >> 4) & 15, add = back().find(a => (word(a) & 0xf00f) === 0x300c && ((word(a) >> 8) & 15) === sr);
    const load = add && back().find(a => a < add && (word(a) & 0xff00) === (0x9000 | (word(add) & 0xf0) << 4));
    assert.ok(load, 'the mov.w before the add into the stored register');
    assert.deepEqual(hwLit(load), [parseInt(litAt, 16), minus], 'the literal and what it adds');
    assert.equal(minus, -0x8000);
    /* the bullet */
    const [st4ae, st20, st28, call, inc, end] = taken, [first] = fall, [cs] = sides.clear;
    assert.deepEqual([st4ae, st20, st28, call, inc].map(e => e.kind), ['store', 'store', 'store', 'call', 'store']);
    const bullet = text.match(/^- \*\*(.+?)\*\*:([^]*?)\n\n/m), body = bullet[2].replace(/\s+/g, ' ');
    assert.equal(bullet[1], named);
    assert.equal(body, ` set, it jumps ahead to ${h(target, 8)}, and from there either stops at ${h(first.at, 8)} or goes on at ${h(join, 8)} to store +${h(st4ae.field, 2)}, +${h(st20.field, 2)} and +${h(st28.field, 2)}, call ${h(call.target, 8)} and add 1 to +${h(inc.field, 2)} before it stops at ${h(end.at, 8)}; clear, it goes on at ${h(at + 4, 8)} and stops at ${h(cs.at, 8)} with no store or call.`);
    /* the stops: rows of the list, no other section's */
    const described = describedAt(kindsDoc);
    for (const e of [first, end, cs]) {
        const a = h(e.at, 8), f = stopText(e);
        assert.ok(list.includes(`| ${a} | this fighter (r12) | ${f.replace(' & ', ' | ')} |`), `${a}'s row in the list`);
        assert.ok(!described.has(a), `${a} is no other section's`);
        assert.equal(FM.handlerTest(game, run9, e.at).of, undefined, `${a} tests r12`);
    }
    const [, s1, f1, s2, f2, p2, ca, cf, cp] = text.match(/The set side stops at (0x[\da-f]{8}), which tests this\nfighter's \(r12\) (\+0x[\da-f]+ & 0x[\da-f]{8}), or at (0x[\da-f]{8}), which tests this\nfighter's \(r12\) (\+0x[\da-f]+ & 0x[\da-f]{8}), parameter bit (0x[\da-f]{2}); the clear side\nstops at (0x[\da-f]{8}), which tests this fighter's \(r12\) (\+0x[\da-f]+ & 0x[\da-f]{8}),\nparameter bit (0x[\da-f]{2})\. All three are rows in "Flag tests not yet described"\nand are left undescribed here, and so is the `tst r7,r7`\./);
    assert.deepEqual([s1, f1, s2, f2, parseInt(p2, 16), ca, cf, parseInt(cp, 16)],
        [h(first.at, 8), stopText(first), h(end.at, 8), stopText(end), end.bit, h(cs.at, 8), stopText(cs), cs.bit], 'the stops named');
    assert.equal(+tr, 7, 'the register named');
    for (const s of ['set', 'clear']) assert.ok(!sides[s].some(e => e.field === 0 && e.mask === 0x10000000), `${s}: not +0 bit 0x10000000`);
}
checkEaee(eaeeDoc, newDoc);
for (const [from, to] of [['`mov #0x70,r0`', '`mov #0x71,r0`'], ['`mov.l @(r0,r12),r3`', '`mov.l @(r0,r13),r3`'], ['`mov #0x02,r0`', '`mov #0x04,r0`'],
    ['then `bf` at', 'then `bt` at'], ['| 0x0600eaee | +0x70 & 0x00020000 |', '| 0x0600eaee | +0x70 & 0x00040000 |'],
    ['| 0x0600eaee | +0x70 & 0x00020000 |', '| 0x0600eaee | the opponent\'s +0x70 & 0x00020000 |'], ['| 0x0600eaee | +0x70 & 0x00020000 |', '| 0x0600eaee | +0x74 & 0x00020000 |'],
    ['long +0x70 of', 'long +0x74 of'], ['masked with 0x00020000', 'masked with 0x00002000'], ['parameter bit\n0x02.', 'parameter bit\n0x20.'],
    ['branch is the set\nside and the fall-through the clear side', 'branch is the clear\nside and the fall-through the set side'],
    ['| branches to 0x0600eb52,', '| branches to 0x0600eb54,'], ['`tst r7,r7` and', '`tst r6,r6` and'], ['`bt` at 0x0600eb54', '`bt` at 0x0600eb56'],
    ['stops at 0x0600eb62 (+0x4a4 & 0x00000001);', 'stops at 0x0600ec64 (+0x4a4 & 0x00000001);'], ['(+0x4a4 & 0x00000001);', '(+0x4a4 & 0x00000002);'],
    ['branches to 0x0600ebda,', 'branches to 0x0600ebdc,'], ['halfword +0x1a,', 'halfword +0x1c,'], ['minus 0x8000, in', 'minus 0x4000, in'],
    ['halfword +0x4ae (0x0600ec08)', 'halfword +0x4ac (0x0600ec08)'], ['sets +0x20 (0x0600ec42)', 'sets +0x24 (0x0600ec42)'],
    ['sets +0x28 (0x0600ec44); calls', 'calls'], ['calls 0x06012d50 (0x0600ec7a)', 'calls 0x060131d0 (0x0600ec7a)'], ['adds 1 to the byte +0x60', 'adds 1 to the byte +0x61'],
    ['stops at 0x0600ec8e (+0x70 & 0x00040000) |', 'stops at 0x0600ec90 (+0x70 & 0x00040000) |'], ['0x0600ec8e (+0x70 & 0x00040000) |', '0x0600ec8e (+0x70 & 0x00080000) |'],
    ['goes on to 0x0600eaf2; no store or call;', 'goes on to 0x0600eaf2; sets +0x24 (0x0600eaf4);'], ['goes on to 0x0600eaf2;', 'branches to 0x0600eaf2;'],
    ['stops at 0x0600eaf6 (+0x70 & 0x00040000) |', 'stops at 0x0600eaf8 (+0x70 & 0x00040000) |'], ['0x0600eaf6 (+0x70 & 0x00040000) |', '0x0600eaf6 (+0x70 & 0x00200000) |'],
    ['halfword at 0x0600ec4a', 'halfword at 0x0600ec4c'], ['either stops at 0x0600eb62', 'either stops at 0x0600ec64'], ['call 0x06012d50 and', 'call 0x060131d0 and'],
    ['The set side stops at 0x0600eb62', 'The set side stops at 0x0600ee16'], ['or at 0x0600ec8e, which', 'or at 0x0600ead0, which'],
    ['stops at 0x0600eaf6, which', 'stops at 0x0600ea64, which'], ['parameter bit 0x04; the clear', 'parameter bit 0x08; the clear']]) {
    assert.ok(eaeeDoc.includes(from), from);
    assert.throws(() => checkEaee(eaeeDoc.replace(from, to), newDoc), `${from} -> ${to}`);
}
/* the list's row naming another field or mask, or losing a stop's row, fails too */
assert.throws(() => checkEaee(eaeeDoc, newDoc.replace('| 0x0600eaee | this fighter (r12) | +0x70 | 0x00020000 |', '| 0x0600eaee | this fighter (r12) | +0x70 | 0x00040000 |')));
for (const a of ['0x0600eb62', '0x0600ec8e', '0x0600eaf6'])
    assert.throws(() => checkEaee(eaeeDoc, newDoc.replace(new RegExp(String.raw`^\| ${a} .*\n`, 'm'), '')), a);
/* The flag at 0x0600eaf6: where the clear side of 0x0600eaee stops. It
 * tests the r3 that 0x0600eae8 loaded, which nothing between writes; a bt,
 * so the branch is the clear side. Each side is what flagSides lists on a
 * fresh read: no store or call, then a stop that is a row of the list and
 * of no other section */
const eaf6Doc = kindsDoc.split('#### The flag at 0x0600eaf6\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
function checkEaf6(text, list) {
    const at = 0x0600eaf6, sides = FM.flagSides(game, run9, at);
    const listed = list.match(/^\| 0x0600eaf6 \| this fighter \(r12\) \| (\+0x[\da-f]+) \| (0x[\da-f]{8}) \|$/m);
    assert.ok(listed, '0x0600eaf6\'s row in "Flag tests not yet described"');
    const named = `${listed[1]} & ${listed[2]}`;
    const rows = [...text.matchAll(new RegExp(String.raw`^\| (0x[\da-f]{8}) \| (${FLAG}) \| (.*?) \| (.*?) \|$`, 'gm'))];
    assert.deepEqual(rows.map(r => [r[1], r[2]]), [['0x0600eaf6', named]]);
    assert.equal(eventFlag(sides.flag), named, '0x0600eaf6: the disc\'s flag');
    /* mov #field,r0; mov.l @(r0,rM),r3; ...; mov #bit,r0; shll16 r0; tst r0,r3; bt */
    const [, field, m, bit, op] = text.match(/r3 still holds what 0x0600eae6 `mov #(0x[\da-f]+),r0` and 0x0600eae8\n`mov\.l @\(r0,r(\d+)\),r3` loaded; 0x0600eaf2 is `mov #(0x[\da-f]{2}),r0`, 0x0600eaf4\n`shll16 r0` and 0x0600eaf6 `tst r0,r3`, then `(b[tf])` at 0x0600eaf8\./);
    assert.equal(word(0x0600eae6), 0xe000 | parseInt(field, 16), 'mov #field,r0');
    assert.equal(word(0x0600eae8), 0x030e | (+m << 4), 'mov.l @(r0,rM),r3');
    assert.equal(word(0x0600eaf2), 0xe000 | parseInt(bit, 16), 'mov #bit,r0');
    assert.equal(word(0x0600eaf4), 0x4028, 'shll16 r0');
    assert.equal(word(at), 0x2308, 'tst r0,r3');
    /* between the load and this tst: only r0 is written, and the bf's fall-through comes here */
    for (let a = 0x0600eaea; a < at; a += 2) {
        const w = word(a);
        assert.ok((w & 0xff00) === 0xe000 || w === 0x4028 || w === 0x2308 || (w & 0xff00) === 0x8b00, `${h(a, 8)} leaves r3 alone`);
    }
    assert.equal(word(0x0600eaf0) & 0xff00, 0x8b00, '0x0600eaf0: bf, its fall-through is 0x0600eaf2');
    assert.equal(+m, 12, 'this fighter is r12');
    assert.ok(sides.flag.of !== 13, 'not the opponent\'s');
    assert.equal(flagText(parseInt(field, 16), parseInt(bit, 16) << 16), named, 'the field and the bit shifted up 16');
    const [, lf, who, lm, pbit] = text.match(/That is\nthe long (\+0x[\da-f]+) of (this fighter \(r12\)), not the opponent's, masked with\n(0x[\da-f]{8}): parameter bit (0x[\da-f]{2})\./);
    assert.deepEqual([`${lf} & ${lm}`, who], [named, 'this fighter (r12)'], 'the long and mask named');
    assert.equal(parseInt(pbit, 16), sides.flag.mask >>> 16, 'the parameter bit');
    const b = word(at + 2), target = ((b & 0xff) << 24 >> 24) * 2 + at + 6;
    assert.equal(b & 0xff00, 0x8900, '0x0600eaf8: bt, so the branch is the clear side');
    assert.equal(op, 'bt', 'the branch named');
    assert.match(text, /The `bt` branches when the bit is clear,\nso the branch is the clear side and the fall-through the set side\./);
    /* each side: no store or call, only its stop */
    assert.deepEqual(sides.set.map(e => e.kind), ['param'], 'set: only the stop');
    assert.deepEqual(sides.clear.map(e => e.kind), ['param'], 'clear: only the stop');
    const [ss] = sides.set, [cs] = sides.clear;
    const sStop = flagText(0x70, ss.bit << 16), cStop = flagText(0x70, cs.bit << 16);
    assert.ok(ss.at > at + 2 && ss.at < target, 'the set side stops on the fall-through, before the branch target');
    assert.ok(cs.at >= target, 'the clear side stops from the branch target on');
    assert.equal(rows[0][3], `goes on to ${h(at + 4, 8)}; no store or call; stops at ${h(ss.at, 8)} (${sStop})`, 'the set cell');
    assert.equal(rows[0][4], `branches to ${h(target, 8)}; no store or call; stops at ${h(cs.at, 8)} (${cStop})`, 'the clear cell');
    const bullet = text.match(/^- \*\*(.+?)\*\*:([^]*?)\n\n/m), body = bullet[2].replace(/\s+/g, ' ');
    assert.equal(bullet[1], named);
    assert.equal(body, ` set, it goes on at ${h(at + 4, 8)} and stops at ${h(ss.at, 8)}; clear, it jumps ahead to ${h(target, 8)} and stops at ${h(cs.at, 8)}. Neither side stores or calls anything before its stop.`);
    /* the stops: rows of the list, no other section's */
    const described = describedAt(kindsDoc);
    for (const [a, f] of [[ss.at, sStop], [cs.at, cStop]]) {
        assert.ok(list.includes(`| ${h(a, 8)} | this fighter (r12) | ${f.replace(' & ', ' | ')} |`), `${h(a, 8)}'s row in the list`);
        assert.ok(!described.has(h(a, 8)), `${h(a, 8)} is no other section's`);
        assert.ok(!kindsDoc.split('\n#### The flag at 0x0600eb08\n')[0].includes(`#### The flag at ${h(a, 8)}`), `${h(a, 8)} has no section of its own`);
        assert.equal(FM.handlerTest(game, run9, a).of, undefined, `${h(a, 8)} tests r12`);
    }
    assert.equal(sStop, cStop, 'both stops test the same flag');
    const [, sa, ca, f, p] = text.match(/The set side stops at (0x[\da-f]{8}) and the clear side at (0x[\da-f]{8}); both\ntest this fighter's \(r12\) (\+0x[\da-f]+ & 0x[\da-f]{8}), parameter bit (0x[\da-f]{2})\. Both\nare rows in "Flag tests not yet described" and are left undescribed\nhere\./);
    assert.deepEqual([sa, ca, f, parseInt(p, 16)], [h(ss.at, 8), h(cs.at, 8), sStop, ss.bit], 'the stops named');
    for (const s of ['set', 'clear']) assert.ok(!sides[s].some(e => e.field === 0 && e.mask === 0x10000000), `${s}: not +0 bit 0x10000000`);
}
checkEaf6(eaf6Doc, newDoc);
for (const [from, to] of [['`mov #0x70,r0`', '`mov #0x71,r0`'], ['`mov.l @(r0,r12),r3`', '`mov.l @(r0,r13),r3`'], ['`mov #0x04,r0`', '`mov #0x02,r0`'],
    ['then `bt` at', 'then `bf` at'], ['| 0x0600eaf6 | +0x70 & 0x00040000 |', '| 0x0600eaf6 | +0x70 & 0x00020000 |'],
    ['| 0x0600eaf6 | +0x70 & 0x00040000 |', '| 0x0600eaf6 | the opponent\'s +0x70 & 0x00040000 |'], ['| 0x0600eaf6 | +0x70 & 0x00040000 |', '| 0x0600eaf6 | +0x74 & 0x00040000 |'],
    ['the long +0x70 of', 'the long +0x74 of'], ['of this fighter (r12), not', 'of the opponent (r13), not'], ['0x00040000: parameter bit 0x04.', '0x00004000: parameter bit 0x04.'],
    ['parameter bit 0x04.', 'parameter bit 0x40.'],
    ['so the branch is the clear side and the fall-through the set side', 'so the branch is the set side and the fall-through the clear side'],
    ['goes on to 0x0600eafa;', 'goes on to 0x0600eafc;'], ['branches to 0x0600eb40;', 'branches to 0x0600eb42;'],
    ['stops at 0x0600eb08 (+0x70 & 0x00200000) |', 'stops at 0x0600eb44 (+0x70 & 0x00200000) |'], ['0x0600eb08 (+0x70 & 0x00200000) |', '0x0600eb08 (+0x70 & 0x00040000) |'],
    ['stops at 0x0600eb44 (+0x70 & 0x00200000) |', 'stops at 0x0600eb74 (+0x70 & 0x00200000) |'], ['0x0600eb44 (+0x70 & 0x00200000) |', '0x0600eb44 (+0x4a4 & 0x00000001) |'],
    ['0x0600eafa; no store or call;', '0x0600eafa; sets +0x24 (0x0600eafc);'], ['0x0600eb40; no store or call;', '0x0600eb40; calls 0x060131d0 (0x0600eb42);'],
    ['and stops at\n  0x0600eb08', 'and stops at\n  0x0600eb44'], ['and stops at\n  0x0600eb44', 'and stops at\n  0x0600eb08'], ['jumps ahead to 0x0600eb40', 'jumps ahead to 0x0600eafa'],
    ['The set side stops at 0x0600eb08', 'The set side stops at 0x0600ee16'], ['clear side at 0x0600eb44', 'clear side at 0x0600ead0'],
    ['+0x70 & 0x00200000, parameter bit 0x20', '+0x70 & 0x00200000, parameter bit 0x02']]) {
    assert.ok(eaf6Doc.includes(from), from);
    assert.throws(() => checkEaf6(eaf6Doc.replace(from, to), newDoc), `${from} -> ${to}`);
}
/* the list's row naming another field or mask, or losing a stop's row, fails too */
assert.throws(() => checkEaf6(eaf6Doc, newDoc.replace('| 0x0600eaf6 | this fighter (r12) | +0x70 | 0x00040000 |', '| 0x0600eaf6 | this fighter (r12) | +0x70 | 0x00020000 |')));
for (const a of ['0x0600eb08', '0x0600eb44'])
    assert.throws(() => checkEaf6(eaf6Doc, newDoc.replace(new RegExp(String.raw`^\| ${a} .*\n`, 'm'), '')), a);
/* The flag at 0x0600eb08: where the set side of 0x0600eaf6 stops. It tests
 * the r3 that 0x0600eae8 loaded, which nothing on the way writes; a bt, so
 * the branch is the clear side. The set side goes on to a bra; both land on
 * the tst r7,r7 at 0x0600eb52, which flagSides follows both ways, so each
 * side's list is split at that bt's target. Every stop is a row of the list */
const eb08Doc = kindsDoc.split('#### The flag at 0x0600eb08\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
function checkEb08(text, list) {
    const at = 0x0600eb08, sides = FM.flagSides(game, run9, at);
    const listed = list.match(/^\| 0x0600eb08 \| this fighter \(r12\) \| (\+0x[\da-f]+) \| (0x[\da-f]{8}) \|$/m);
    assert.ok(listed, '0x0600eb08\'s row in "Flag tests not yet described"');
    const named = `${listed[1]} & ${listed[2]}`;
    const rows = [...text.matchAll(new RegExp(String.raw`^\| (0x[\da-f]{8}) \| (${FLAG}) \| (.*?) \| (.*?) \|$`, 'gm'))];
    assert.deepEqual(rows.map(r => [r[1], r[2]]), [['0x0600eb08', named]]);
    assert.equal(eventFlag(sides.flag), named, '0x0600eb08: the disc\'s flag');
    /* mov #field,r0; mov.l @(r0,rM),r3; ...; mov #bit,r0; shll16 r0; tst r0,r3; bt */
    const [, field, m, bit, op] = text.match(/r3 still holds what 0x0600eae6 `mov #(0x[\da-f]+),r0` and 0x0600eae8\n`mov\.l @\(r0,r(\d+)\),r3` loaded; 0x0600eb04 is `mov #(0x[\da-f]{2}),r0`, 0x0600eb06\n`shll16 r0` and 0x0600eb08 `tst r0,r3`, then `(b[tf])` at 0x0600eb0a\./);
    assert.equal(word(0x0600eae6), 0xe000 | parseInt(field, 16), 'mov #field,r0');
    assert.equal(word(0x0600eae8), 0x030e | (+m << 4), 'mov.l @(r0,rM),r3');
    assert.equal(word(0x0600eb04), 0xe000 | parseInt(bit, 16), 'mov #bit,r0');
    assert.equal(word(0x0600eb06), 0x4028, 'shll16 r0');
    assert.equal(word(at), 0x2308, 'tst r0,r3');
    /* between the load and this tst, each word's destination: never r3 */
    const writes = w => (w & 0xff00) === 0xe000 || (w & 0xf000) === 0x9000 || (w & 0xf0ff) === 0x4028 || (w & 0xf0ef) === 0x000a || (w & 0xf00f) === 0x200d ? (w >> 8) & 15
        : (w & 0xf00f) === 0x300d || (w & 0xf00f) === 0x2008 || (w & 0xfd00) === 0x8900 ? -1 : assert.fail(`${h(w, 4)}: not read`);
    for (let a = 0x0600eaea; a < at; a += 2) assert.notEqual(writes(word(a)), 3, `${h(a, 8)} leaves r3 alone`);
    assert.equal(word(0x0600eaf8) & 0xff00, 0x8900, '0x0600eaf8: bt, its fall-through runs on to here');
    assert.equal(+m, 12, 'this fighter is r12');
    assert.ok(sides.flag.of !== 13, 'not the opponent\'s');
    assert.equal(flagText(parseInt(field, 16), parseInt(bit, 16) << 16), named, 'the field and the bit shifted up 16');
    const [, lf, who, lm, pbit] = text.match(/That is\nthe long (\+0x[\da-f]+) of (this fighter \(r12\)), not the opponent's, masked with\n(0x[\da-f]{8}): parameter bit (0x[\da-f]{2})\./);
    assert.deepEqual([`${lf} & ${lm}`, who], [named, 'this fighter (r12)'], 'the long and mask named');
    assert.equal(parseInt(pbit, 16), sides.flag.mask >>> 16, 'the parameter bit');
    const b = word(at + 2), target = ((b & 0xff) << 24 >> 24) * 2 + at + 6;
    assert.equal(b & 0xff00, 0x8900, '0x0600eb0a: bt, so the branch is the clear side');
    assert.equal(op, 'bt', 'the branch named');
    assert.match(text, /The `bt` branches when the bit is clear,\nso the branch is the clear side and the fall-through the set side\./);
    /* set: falls through to a bra (delay slot nop) that lands where the bt does */
    const [, braAt] = rows[0][3].match(/^goes on to 0x[\da-f]{8}; no store or call; the `bra` at (0x[\da-f]{8}) branches to /);
    const ba = parseInt(braAt, 16), bw = word(ba), braTo = ((bw & 0xfff) << 20 >> 20) * 2 + ba + 4;
    assert.equal(bw & 0xf000, 0xa000, `${braAt}: bra`);
    assert.equal(word(ba + 2), 0x0009, 'its delay slot: nop');
    assert.equal(braTo, target, 'the bra lands where the bt branches');
    for (let a = at + 4; a < ba; a += 2) assert.ok((word(a) & 0xf000) !== 0x8000 && (word(a) & 0xf000) !== 0xa000 && word(a) !== 0x000b, `${h(a, 8)}: no branch`);
    /* both land on tst rN,rN and a bt; flagSides lists both paths from there, the same for both sides */
    const tw = word(target), tr = (tw >> 8) & 15;
    assert.equal(tw, 0x2008 | (tr << 8) | (tr << 4), 'tst rN,rN');
    assert.equal(tr, 7, 'r7');
    const bt = word(target + 2), join = ((bt & 0xff) << 24 >> 24) * 2 + target + 6;
    assert.equal(bt & 0xff00, 0x8900, 'bt');
    assert.deepEqual(sides.set, sides.clear, 'both sides list the same, from 0x0600eb52 on');
    assert.ok(sides.set.every(e => e.at > target), 'nothing before 0x0600eb52');
    const fall = sides.set.filter(e => e.at < join), taken = sides.set.filter(e => e.at >= join);
    assert.deepEqual(fall.map(e => e.kind), ['stop'], 'the fall-through: only its stop');
    assert.equal(taken.at(-1).kind, 'param', 'the branch ends at a stop');
    const hwLit = a => [a + 4 + (word(a) & 0xff) * 2, game.prg.readInt16BE(game.at(a + 4 + (word(a) & 0xff) * 2))];
    const stopText = e => e.kind === 'param' ? flagText(0x70, e.bit << 16) : (assert.equal(e.of, undefined, 'a stop of r12'), flagText(e.field, e.mask));
    let minus;
    const say = e => {
        if (e.kind === 'call') return `calls ${h(e.target, 8)} (${h(e.at, 8)})`;
        if (e.kind === 'param' || e.kind === 'stop') return `stops at ${h(e.at, 8)} (${stopText(e)})`;
        assert.equal(e.kind, 'store', JSON.stringify(e));
        const v = e.values;
        if (v.length === 1 && v[0] === null) return `sets +${h(e.field, 2)} (${h(e.at, 8)})`;
        if (v.length === 1 && v[0]?.field === e.field && v[0].size === e.size && e.size === 1 && v[0].plus === 1 && Object.keys(v[0]).length === 3)
            return `adds 1 to the byte +${h(e.field, 2)} (${h(e.at, 8)})`;
        if (v.length === 2 && e.size === 2 && JSON.stringify(v[0]) === JSON.stringify({ field: v[0].field, size: 2 })
            && JSON.stringify(v[1]) === JSON.stringify({ ...v[0], plus: v[1].plus })) {
            minus = v[1].plus;
            return `puts the halfword +${h(v[0].field, 2)}, or that minus ${h(-minus, 4)}, in the halfword +${h(e.field, 2)} (${h(e.at, 8)})`;
        }
        assert.fail(JSON.stringify(e));
    };
    const tail = `${h(target, 8)}, where \`tst r${tr},r${tr}\` and the \`bt\` at ${h(target + 2, 8)} go both ways: it goes on with no store or call and ${say(fall[0])}; or it branches to ${h(join, 8)}, ${taken.map(say).join('; ')}`;
    assert.equal(rows[0][3], `goes on to ${h(at + 4, 8)}; no store or call; the \`bra\` at ${h(ba, 8)} branches to ${tail}`, 'the set cell');
    assert.equal(rows[0][4], `branches to ${h(target, 8)}; no store or call; from there on the same as the set side, to the same stops`, 'the clear cell');
    /* the 0x8000: a mov.w literal, sign-extended */
    const [, litAt] = text.match(/The 0x8000 is the halfword at (0x[\da-f]{8}), read with `mov\.w`, so it is\nadded as −0x8000\./);
    const lw = taken.find(e => e.values?.length === 2), back = () => [...Array(16).keys()].map(i => lw.at - 2 * i);
    const sr = (word(lw.at) >> 4) & 15, add = back().find(a => (word(a) & 0xf00f) === 0x300c && ((word(a) >> 8) & 15) === sr);
    const load = add && back().find(a => a < add && (word(a) & 0xff00) === (0x9000 | (word(add) & 0xf0) << 4));
    assert.ok(load, 'the mov.w before the add into the stored register');
    assert.deepEqual(hwLit(load), [parseInt(litAt, 16), minus], 'the literal and what it adds');
    assert.equal(minus, -0x8000);
    /* the bullet */
    const [st4ae, st20, st28, call, inc, end] = taken, [first] = fall;
    assert.deepEqual([st4ae, st20, st28, call, inc].map(e => e.kind), ['store', 'store', 'store', 'call', 'store']);
    const bullet = text.match(/^- \*\*(.+?)\*\*:([^]*?)\n\n/m), body = bullet[2].replace(/\s+/g, ' ');
    assert.equal(bullet[1], named);
    assert.equal(body, ` set, it goes on at ${h(at + 4, 8)} and the \`bra\` at ${h(ba, 8)} takes it to ${h(target, 8)}; clear, it jumps straight to ${h(target, 8)}. From there both either stop at ${h(first.at, 8)} or go on at ${h(join, 8)} to store +${h(st4ae.field, 2)}, +${h(st20.field, 2)} and +${h(st28.field, 2)}, call ${h(call.target, 8)} and add 1 to +${h(inc.field, 2)} before they stop at ${h(end.at, 8)}.`);
    /* the tst r7,r7 is the one eaee's set side reaches */
    assert.match(text, new RegExp(String.raw`The \`tst r${tr},r${tr}\` at ${h(target, 8)} is the one the set side\nof "The flag at 0x0600eaee" reaches, and is left undescribed here too\.`));
    assert.ok(eaeeDoc.includes(`| branches to ${h(target, 8)}, where \`tst r${tr},r${tr}\``), 'eaee\'s set side lands there');
    /* the stops: rows of the list, no section of their own when this one was written */
    const described = describedAt(kindsDoc), before = kindsDoc.split('\n#### The flag at 0x0600eb44\n')[0];
    for (const e of [first, end]) {
        const a = h(e.at, 8), f = stopText(e);
        assert.ok(list.includes(`| ${a} | this fighter (r12) | ${f.replace(' & ', ' | ')} |`), `${a}'s row in the list`);
        assert.ok(!described.has(a), `${a} is no other section's`);
        assert.ok(!before.includes(`#### The flag at ${a}`), `${a} has no section of its own`);
        assert.equal(FM.handlerTest(game, run9, e.at).of, undefined, `${a} tests r12`);
    }
    const [, s1, f1, s2, f2, p2] = text.match(/Both sides stop at (0x[\da-f]{8}), which tests this fighter's \(r12\) (\+0x[\da-f]+ &\n0x[\da-f]{8}), or at (0x[\da-f]{8}), which tests this fighter's \(r12\) (\+0x[\da-f]+ &\n0x[\da-f]{8}), parameter bit (0x[\da-f]{2})\. Both are rows in "Flag tests not yet\ndescribed" and are left undescribed here\./);
    assert.deepEqual([s1, f1.replace('\n', ' '), s2, f2.replace('\n', ' '), parseInt(p2, 16)], [h(first.at, 8), stopText(first), h(end.at, 8), stopText(end), end.bit], 'the stops named');
    for (const s of ['set', 'clear']) assert.ok(!sides[s].some(e => e.field === 0 && e.mask === 0x10000000), `${s}: not +0 bit 0x10000000`);
}
checkEb08(eb08Doc, newDoc);
for (const [from, to] of [['`mov #0x70,r0`', '`mov #0x71,r0`'], ['`mov.l @(r0,r12),r3`', '`mov.l @(r0,r13),r3`'], ['`mov #0x20,r0`', '`mov #0x04,r0`'],
    ['then `bt` at', 'then `bf` at'], ['| 0x0600eb08 | +0x70 & 0x00200000 |', '| 0x0600eb08 | +0x70 & 0x00040000 |'],
    ['| 0x0600eb08 | +0x70 & 0x00200000 |', '| 0x0600eb08 | the opponent\'s +0x70 & 0x00200000 |'], ['| 0x0600eb08 | +0x70 & 0x00200000 |', '| 0x0600eb08 | +0x74 & 0x00200000 |'],
    ['the long +0x70 of', 'the long +0x74 of'], ['of this fighter (r12), not', 'of the opponent (r13), not'], ['0x00200000: parameter bit 0x20.', '0x00002000: parameter bit 0x20.'],
    ['parameter bit 0x20.', 'parameter bit 0x02.'],
    ['so the branch is the clear side and the fall-through the set side', 'so the branch is the set side and the fall-through the clear side'],
    ['goes on to 0x0600eb0c;', 'goes on to 0x0600eb0e;'], ['the `bra` at 0x0600eb16 branches', 'the `bra` at 0x0600eb18 branches'],
    ['branches to 0x0600eb52, where', 'branches to 0x0600eb40, where'], ['| branches to 0x0600eb52;', '| branches to 0x0600eb40;'],
    ['`tst r7,r7` and', '`tst r6,r6` and'], ['`bt` at 0x0600eb54', '`bt` at 0x0600eb56'],
    ['stops at 0x0600eb62 (+0x4a4 & 0x00000001);', 'stops at 0x0600ec64 (+0x4a4 & 0x00000001);'], ['(+0x4a4 & 0x00000001);', '(+0x4a4 & 0x00000002);'],
    ['branches to 0x0600ebda,', 'branches to 0x0600ebdc,'], ['halfword +0x1a,', 'halfword +0x1c,'], ['minus 0x8000, in', 'minus 0x4000, in'],
    ['sets +0x20 (0x0600ec42)', 'sets +0x24 (0x0600ec42)'], ['sets +0x28 (0x0600ec44); calls', 'calls'], ['calls 0x06012d50 (0x0600ec7a)', 'calls 0x060131d0 (0x0600ec7a)'],
    ['adds 1 to the byte +0x60', 'adds 1 to the byte +0x61'],
    ['stops at 0x0600ec8e (+0x70 & 0x00040000) |', 'stops at 0x0600ec90 (+0x70 & 0x00040000) |'], ['0x0600ec8e (+0x70 & 0x00040000) |', '0x0600ec8e (+0x70 & 0x00080000) |'],
    ['0x0600eb0c; no store or call;', '0x0600eb0c; sets +0x24 (0x0600eb0e);'], ['0x0600eb52; no store or call;', '0x0600eb52; calls 0x060131d0 (0x0600eb42);'],
    ['the same as the set side', 'the same as the clear side'],
    ['jumps straight to\n  0x0600eb52', 'jumps straight to\n  0x0600eb40'], ['either stop at 0x0600eb62', 'either stop at 0x0600ec64'], ['call 0x06012d50 and', 'call 0x060131d0 and'],
    ['halfword at 0x0600ec4a', 'halfword at 0x0600ec4c'], ['`tst r7,r7` at 0x0600eb52', '`tst r7,r7` at 0x0600eb54'],
    ['Both sides stop at 0x0600eb62', 'Both sides stop at 0x0600ee16'], ['or at 0x0600ec8e, which', 'or at 0x0600ead0, which'],
    ['(r12) +0x4a4 &\n0x00000001', '(r12) +0x4a4 &\n0x00000002'], ['parameter bit 0x04. Both', 'parameter bit 0x08. Both']]) {
    assert.ok(eb08Doc.includes(from), from);
    assert.throws(() => checkEb08(eb08Doc.replace(from, to), newDoc), `${from} -> ${to}`);
}
/* the list's row naming another field or mask, or losing a stop's row, fails too */
assert.throws(() => checkEb08(eb08Doc, newDoc.replace('| 0x0600eb08 | this fighter (r12) | +0x70 | 0x00200000 |', '| 0x0600eb08 | this fighter (r12) | +0x70 | 0x00040000 |')));
for (const a of ['0x0600eb62', '0x0600ec8e'])
    assert.throws(() => checkEb08(eb08Doc, newDoc.replace(new RegExp(String.raw`^\| ${a} .*\n`, 'm'), '')), a);
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
