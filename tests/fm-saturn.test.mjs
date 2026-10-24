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
const fixed = (k, d) => assert.equal(+(k / 65536).toFixed(d.split('.')[1]?.length ?? 0), +d, `${h(k, 8)} is ${d}`);
function checkStops(text, flags, bits) {
    const stops = new Map();
    for (const [, a, f] of flags.matchAll(/stops at (0x[\da-f]{8}) \((\+0x[\da-f]+ & 0x[\da-f]{8})\)/g)) stops.set(a, f);
    const behind = new Set([...bits.matchAll(/(\+0x[\da-f]+ & 0x[\da-f]{8}) (?:set|clear)/g)].map(m => m[1]));
    const rows = [...text.matchAll(/^\| (0x[\da-f]{8}) \| (\+0x[\da-f]+ & 0x[\da-f]{8}) \| (.*?) \| (.*?) \|$/gm)];
    assert.deepEqual(rows.map(([, a, f]) => [a, f]), [...stops].sort(([a], [b]) => parseInt(a, 16) - parseInt(b, 16)));
    assert.match(text, new RegExp(`^The ${['', '', '', '', '', 'five'][rows.length]} flag tests`));
    const rowFlag = new Map(rows.map(([, a, f]) => [a, f]));
    for (const [, atText, flag, ...cells] of rows) {
        const at = parseInt(atText, 16), sides = FM.flagSides(game, run9, at);
        assert.equal(flagText(sides.flag.field, sides.flag.mask), flag, atText);
        cells.forEach((cell, s) => {
            const events = sides[['set', 'clear'][s]], where = `${atText} ${['set', 'clear'][s]}`, claimed = new Set();
            const event = (kind, a) => {
                const e = events.find(e => e.kind === kind && e.at === parseInt(a, 16));
                assert.ok(e, `${where}: no ${kind} at ${a}`);
                claimed.add(e);
                return e;
            };
            for (const [all, a, f] of cell.matchAll(/stops at (0x[\da-f]{8}) \((\+0x[\da-f]+ & 0x[\da-f]{8})\)/g)) {
                const e = event('stop', a);
                assert.equal(flagText(e.field, e.mask), f, `${where}: ${all}`);
                assert.ok(!behind.has(f), `${where}: ${f} is in the Behind column`);
                const k = cell.slice(cell.indexOf(all) + all.length).match(/^, the flag (0x[\da-f]{8}) tests/);
                if (k) assert.equal(rowFlag.get(k[1]), f, `${where}: the flag ${k[1]} tests`);
            }
            for (const m of cell.matchAll(/\((0x0600[\da-f]{4})\)/g)) {
                const a = m[1], x = parseInt(a, 16), before = cell.slice(0, m.index), after = cell.slice(m.index + m[0].length).split(/[,;:]/)[0];
                let k;
                if (/ends this frame's run $/.test(before)) event('end', a);
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
                    const put = before.split(/[;:]/).pop().match(/puts (0x[\da-f]+|.+?) in \+0x[\da-f]+ $/);
                    let c;
                    if (verb === 'clears') assert.deepEqual(e.values, [0], `${where}: ${a} clears`);
                    else if (verb === 'puts') assert.deepEqual(e.values, [/^0x/.test(put[1]) ? parseInt(put[1], 16) : null], `${where}: ${a} puts ${put[1]}`);
                    else if (verb === 'limits' && (c = after.match(/to ±(0x[\da-f]+) \(([\d.]+)\)/) ?? cell.slice(m.index).match(/to ±(0x[\da-f]+) \(([\d.]+)\)/))) {
                        assert.deepEqual([...e.values].sort((p, q) => p - q), [-parseInt(c[1], 16), parseInt(c[1], 16)], `${where}: ${a} limits`);
                        fixed(parseInt(c[1], 16), c[2]);
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
            if (/changes nothing in the jump before it stops at|and nothing else/.test(cell))
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
                assert.ok(row[2 + s].includes(`changes nothing in the jump before it stops at ${a}`), `${f} ${['', 'set', 'clear'][s]}: ${a}`);
            for (const [, v] of sides[s].matchAll(/\+0x68a gets (0x[\da-f]+)/g)) assert.match(row[2 + s], new RegExp(`puts ${v} in \\+0x68a`), `${f}: ${v}`);
            for (const [, x, y] of sides[s].matchAll(/within ±([\d.]+)|scaled by ([\d.]+)/g)) for (const d of [x ?? y]) assert.ok(row[2 + s].includes(`(${d})`), `${f}: ${d}`);
        });
    }
    /* the closing list: the stops the cells name, each once */
    const listed = text.match(/The flags tested at ([^]+?) are left undescribed/)[1].match(/0x[\da-f]{8}/g);
    assert.deepEqual(listed, [...new Set(rows.flatMap(r => [...(r[3] + r[4]).matchAll(/stops at (0x[\da-f]{8})/g)].map(m => m[1])))]
        .sort((a, b) => parseInt(a, 16) - parseInt(b, 16)), 'the undescribed stops');
}
const stopsDoc = kindsDoc.split('#### The flags they stop at\n\n')[1].split('\n### ')[0];
checkStops(stopsDoc, flagsDoc, bitsDoc);
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
    assert.throws(() => checkStops(stopsDoc.replace(from, to), flagsDoc, bitsDoc), `${from} -> ${to}`);
}
/* the set and clear cells of 0x0600f27a swapped, a row dropped, or "The flags behind them" naming another stop */
const f27a = stopsDoc.match(/^\| 0x0600f27a \| (.+?) \| (.+?) \| (.+?) \|$/m);
assert.throws(() => checkStops(stopsDoc.replace(f27a[0], `| 0x0600f27a | ${f27a[1]} | ${f27a[3]} | ${f27a[2]} |`), flagsDoc, bitsDoc));
assert.throws(() => checkStops(stopsDoc.replace(/^\| 0x0600ee84 .*\n/m, ''), flagsDoc, bitsDoc));
assert.throws(() => checkStops(stopsDoc, flagsDoc.replace('stops at 0x0600ee84 (+0x6c0 & 0x80000000)', 'stops at 0x0600ee8a (+0x6c0 & 0x00000001)'), bitsDoc));

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
