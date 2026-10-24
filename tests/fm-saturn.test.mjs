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
/* The flag at 0x0600eb44: where the clear side of 0x0600eaf6 stops. It tests
 * the r3 that 0x0600eae8 loaded, which nothing on the way writes; a bt, so
 * the branch is the clear side. The set side runs on with no branch into the
 * bt's target, the tst r7,r7 at 0x0600eb52, which flagSides follows both
 * ways, so each side's list is split at that bt's target. Every stop is a
 * row of the list */
const eb44Doc = kindsDoc.split('#### The flag at 0x0600eb44\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
function checkEb44(text, list) {
    const at = 0x0600eb44, sides = FM.flagSides(game, run9, at);
    const listed = list.match(/^\| 0x0600eb44 \| this fighter \(r12\) \| (\+0x[\da-f]+) \| (0x[\da-f]{8}) \|$/m);
    assert.ok(listed, '0x0600eb44\'s row in "Flag tests not yet described"');
    const named = `${listed[1]} & ${listed[2]}`;
    const rows = [...text.matchAll(new RegExp(String.raw`^\| (0x[\da-f]{8}) \| (${FLAG}) \| (.*?) \| (.*?) \|$`, 'gm'))];
    assert.deepEqual(rows.map(r => [r[1], r[2]]), [['0x0600eb44', named]]);
    assert.equal(eventFlag(sides.flag), named, '0x0600eb44: the disc\'s flag');
    /* how 0x0600eaf6 names this stop */
    assert.ok(eaf6Doc.includes(`stops at 0x0600eb44 (${named}) |`), '0x0600eaf6\'s clear side names this flag');
    /* mov #field,r0; mov.l @(r0,rM),r3; ...; mov #bit,r0; shll16 r0; tst r0,r3; bt */
    const [, field, m, bit, op] = text.match(/r3 still holds what 0x0600eae6 `mov #(0x[\da-f]+),r0` and 0x0600eae8\n`mov\.l @\(r0,r(\d+)\),r3` loaded; 0x0600eb40 is `mov #(0x[\da-f]{2}),r0`, 0x0600eb42\n`shll16 r0` and 0x0600eb44 `tst r0,r3`, then `(b[tf])` at 0x0600eb46\./);
    assert.equal(word(0x0600eae6), 0xe000 | parseInt(field, 16), 'mov #field,r0');
    assert.equal(word(0x0600eae8), 0x030e | (+m << 4), 'mov.l @(r0,rM),r3');
    assert.equal(word(0x0600eb40), 0xe000 | parseInt(bit, 16), 'mov #bit,r0');
    assert.equal(word(0x0600eb42), 0x4028, 'shll16 r0');
    assert.equal(word(at), 0x2308, 'tst r0,r3');
    /* the way here: on from the load to the bt at 0x0600eaf8, which branches to 0x0600eb40; no word on it writes r3 */
    const eaf8 = word(0x0600eaf8);
    assert.equal(eaf8 & 0xff00, 0x8900, '0x0600eaf8: bt');
    assert.equal(((eaf8 & 0xff) << 24 >> 24) * 2 + 0x0600eaf8 + 4, 0x0600eb40, 'its branch lands at 0x0600eb40');
    const writes = w => (w & 0xff00) === 0xe000 || (w & 0xf000) === 0x9000 || (w & 0xf0ff) === 0x4028 || (w & 0xf0ef) === 0x000a || (w & 0xf00f) === 0x200d ? (w >> 8) & 15
        : (w & 0xf00f) === 0x300d || (w & 0xf00f) === 0x2008 || (w & 0xfd00) === 0x8900 ? -1 : assert.fail(`${h(w, 4)}: not read`);
    for (const a of [...[...Array((0x0600eafa - 0x0600eaea) / 2).keys()].map(i => 0x0600eaea + 2 * i), 0x0600eb40, 0x0600eb42])
        assert.notEqual(writes(word(a)), 3, `${h(a, 8)} leaves r3 alone`);
    assert.equal(+m, 12, 'this fighter is r12');
    assert.ok(sides.flag.of !== 13, 'not the opponent\'s');
    assert.equal(flagText(parseInt(field, 16), parseInt(bit, 16) << 16), named, 'the field and the bit shifted up 16');
    const [, lf, who, lm, pbit] = text.match(/That is\nthe long (\+0x[\da-f]+) of (this fighter \(r12\)), not the opponent's, masked with\n(0x[\da-f]{8}): parameter bit (0x[\da-f]{2})\./);
    assert.deepEqual([`${lf} & ${lm}`, who], [named, 'this fighter (r12)'], 'the long and mask named');
    assert.equal(parseInt(pbit, 16), sides.flag.mask >>> 16, 'the parameter bit');
    const b = word(at + 2), target = ((b & 0xff) << 24 >> 24) * 2 + at + 6;
    assert.equal(b & 0xff00, 0x8900, '0x0600eb46: bt, so the branch is the clear side');
    assert.equal(op, 'bt', 'the branch named');
    assert.match(text, /The `bt` branches when the bit is clear,\nso the branch is the clear side and the fall-through the set side\./);
    /* set: falls through, with no branch, into the bt's target */
    for (let a = at + 4; a < target; a += 2) assert.ok((word(a) & 0xf000) !== 0x8000 && (word(a) & 0xf000) !== 0xa000 && (word(a) & 0xf000) !== 0xb000 && (word(a) & 0xf0ff) !== 0x002b && (word(a) & 0xf0df) !== 0x0003 && (word(a) & 0xf0df) !== 0x400b && word(a) !== 0x000b, `${h(a, 8)}: no branch`);
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
    assert.equal(rows[0][3], `goes on to ${h(at + 4, 8)}; no store or call; runs on into ${tail}`, 'the set cell');
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
    assert.equal(body, ` set, it goes on at ${h(at + 4, 8)} and runs on into ${h(target, 8)}; clear, it jumps straight to ${h(target, 8)}. From there both either stop at ${h(first.at, 8)} or go on at ${h(join, 8)} to store +${h(st4ae.field, 2)}, +${h(st20.field, 2)} and +${h(st28.field, 2)}, call ${h(call.target, 8)} and add 1 to +${h(inc.field, 2)} before they stop at ${h(end.at, 8)}.`);
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
checkEb44(eb44Doc, newDoc);
for (const [from, to] of [['`mov #0x70,r0`', '`mov #0x71,r0`'], ['`mov.l @(r0,r12),r3`', '`mov.l @(r0,r13),r3`'], ['`mov #0x20,r0`', '`mov #0x04,r0`'],
    ['then `bt` at', 'then `bf` at'], ['| 0x0600eb44 | +0x70 & 0x00200000 |', '| 0x0600eb44 | +0x70 & 0x00040000 |'],
    ['| 0x0600eb44 | +0x70 & 0x00200000 |', '| 0x0600eb44 | the opponent\'s +0x70 & 0x00200000 |'], ['| 0x0600eb44 | +0x70 & 0x00200000 |', '| 0x0600eb44 | +0x74 & 0x00200000 |'],
    ['the long +0x70 of', 'the long +0x74 of'], ['of this fighter (r12), not', 'of the opponent (r13), not'], ['0x00200000: parameter bit 0x20.', '0x00002000: parameter bit 0x20.'],
    ['parameter bit 0x20.', 'parameter bit 0x02.'],
    ['so the branch is the clear side and the fall-through the set side', 'so the branch is the set side and the fall-through the clear side'],
    ['goes on to 0x0600eb48;', 'goes on to 0x0600eb4a;'], ['runs on into 0x0600eb52, where', 'runs on into 0x0600eb40, where'],
    ['| branches to 0x0600eb52;', '| branches to 0x0600eb40;'],
    ['`tst r7,r7` and', '`tst r6,r6` and'], ['`bt` at 0x0600eb54', '`bt` at 0x0600eb56'],
    ['stops at 0x0600eb62 (+0x4a4 & 0x00000001);', 'stops at 0x0600ec64 (+0x4a4 & 0x00000001);'], ['(+0x4a4 & 0x00000001);', '(+0x4a4 & 0x00000002);'],
    ['branches to 0x0600ebda,', 'branches to 0x0600ebdc,'], ['halfword +0x1a,', 'halfword +0x1c,'], ['minus 0x8000, in', 'minus 0x4000, in'],
    ['sets +0x20 (0x0600ec42)', 'sets +0x24 (0x0600ec42)'], ['sets +0x28 (0x0600ec44); calls', 'calls'], ['calls 0x06012d50 (0x0600ec7a)', 'calls 0x060131d0 (0x0600ec7a)'],
    ['adds 1 to the byte +0x60', 'adds 1 to the byte +0x61'],
    ['stops at 0x0600ec8e (+0x70 & 0x00040000) |', 'stops at 0x0600ec90 (+0x70 & 0x00040000) |'], ['0x0600ec8e (+0x70 & 0x00040000) |', '0x0600ec8e (+0x70 & 0x00080000) |'],
    ['0x0600eb48; no store or call;', '0x0600eb48; sets +0x24 (0x0600eb4a);'], ['0x0600eb52; no store or call;', '0x0600eb52; calls 0x060131d0 (0x0600eb42);'],
    ['the same as the set side', 'the same as the clear side'],
    ['goes on at 0x0600eb48 and runs on into\n  0x0600eb52', 'goes on at 0x0600eb48 and runs on into\n  0x0600eb40'],
    ['jumps straight to 0x0600eb52', 'jumps straight to 0x0600eb40'], ['either stop at 0x0600eb62', 'either stop at 0x0600ec64'], ['call 0x06012d50 and', 'call 0x060131d0 and'],
    ['halfword at 0x0600ec4a', 'halfword at 0x0600ec4c'], ['`tst r7,r7` at 0x0600eb52', '`tst r7,r7` at 0x0600eb54'],
    ['Both sides stop at 0x0600eb62', 'Both sides stop at 0x0600ee16'], ['or at 0x0600ec8e, which', 'or at 0x0600ead0, which'],
    ['(r12) +0x4a4 &\n0x00000001', '(r12) +0x4a4 &\n0x00000002'], ['parameter bit 0x04. Both', 'parameter bit 0x08. Both']]) {
    assert.ok(eb44Doc.includes(from), from);
    assert.throws(() => checkEb44(eb44Doc.replace(from, to), newDoc), `${from} -> ${to}`);
}
/* the list's row naming another field or mask, or losing a stop's row, fails too */
assert.throws(() => checkEb44(eb44Doc, newDoc.replace('| 0x0600eb44 | this fighter (r12) | +0x70 | 0x00200000 |', '| 0x0600eb44 | this fighter (r12) | +0x70 | 0x00040000 |')));
for (const a of ['0x0600eb62', '0x0600ec8e'])
    assert.throws(() => checkEb44(eb44Doc, newDoc.replace(new RegExp(String.raw`^\| ${a} .*\n`, 'm'), '')), a);
/* The flag at 0x0600eb62: where the fall-through of the tst r7,r7 at
 * 0x0600eb52 goes. A byte test of r12 plus a mov.w literal; a bt, so the
 * branch is the clear side. The set side splits at a cmp/pz bt whose two
 * ways only change r9, and both sides run on with no store or call to one
 * stop, a row of the list */
const eb62Doc = kindsDoc.split('#### The flag at 0x0600eb62\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
function checkEb62(text, list) {
    const at = 0x0600eb62, sides = FM.flagSides(game, run9, at);
    const listed = list.match(/^\| 0x0600eb62 \| this fighter \(r12\) \| (\+0x[\da-f]+) \| (0x[\da-f]{8}) \|$/m);
    assert.ok(listed, '0x0600eb62\'s row in "Flag tests not yet described"');
    const named = `${listed[1]} & ${listed[2]}`;
    const rows = [...text.matchAll(new RegExp(String.raw`^\| (0x[\da-f]{8}) \| (${FLAG}) \| (.*?) \| (.*?) \|$`, 'gm'))];
    assert.deepEqual(rows.map(r => [r[1], r[2]]), [['0x0600eb62', named]]);
    assert.equal(eventFlag(sides.flag), named, '0x0600eb62: the disc\'s flag');
    /* how 0x0600eaee, 0x0600eb08 and 0x0600eb44 name this stop */
    for (const [doc, s] of [[eaeeDoc, 'eaee'], [eb08Doc, 'eb08'], [eb44Doc, 'eb44']])
        assert.ok(doc.includes(`stops at 0x0600eb62 (${named})`), `0x0600${s} names this flag`);
    /* mov rM,r1; mov.w @(lit),r0; add r0,r1; mov.b @r1,r0; tst #bit,r0; bt */
    const [, m, litAt, lit, bit, op] = text.match(/0x0600eb5a is `mov r(\d+),r1`,\n0x0600eb5c `mov\.w @\((0x[\da-f]{8})\),r0`, which loads (0x[\da-f]{4}), 0x0600eb5e\n`add r0,r1`, 0x0600eb60 `mov\.b @r1,r0` and 0x0600eb62 `tst #(0x[\da-f]{2}),r0`,\nthen `(b[tf])` at 0x0600eb64\./);
    const pcLit = a => (assert.equal(word(a) & 0xff00, 0x9000, `${h(a, 8)}: mov.w @(disp,pc),r0`), a + 4 + (word(a) & 0xff) * 2);
    assert.equal(word(0x0600eb5a), 0x6103 | (+m << 4), 'mov rM,r1');
    assert.equal(pcLit(0x0600eb5c), parseInt(litAt, 16), 'the literal\'s address');
    assert.equal(word(parseInt(litAt, 16)), parseInt(lit, 16), 'the literal');
    assert.equal(word(0x0600eb5e), 0x310c, 'add r0,r1');
    assert.equal(word(0x0600eb60), 0x6010, 'mov.b @r1,r0');
    assert.equal(word(at), 0xc800 | parseInt(bit, 16), 'tst #bit,r0');
    assert.equal(+m, 12, 'this fighter is r12');
    assert.ok(sides.flag.of !== 13, 'not the opponent\'s');
    /* the byte, big-endian, as the long holding it */
    const byte = parseInt(lit, 16), long = byte & ~3, mask = parseInt(bit, 16) << 8 * (3 - (byte & 3));
    assert.equal(flagText(long, mask), named, 'the byte as its long');
    const [, bb, bf, lf, lm] = text.match(/That is bit (0x[\da-f]{2}) of the byte (\+0x[\da-f]+) of this\nfighter \(r12\), not the opponent's: big-endian, the long (\+0x[\da-f]+) masked\nwith (0x[\da-f]{8})\./);
    assert.deepEqual([bb, bf, `${lf} & ${lm}`], [bit, `+${h(byte, 3)}`, named], 'the byte and long named');
    const b = word(at + 2), clear = ((b & 0xff) << 24 >> 24) * 2 + at + 6;
    assert.equal(b & 0xff00, 0x8900, '0x0600eb64: bt, so the branch is the clear side');
    assert.equal(op, 'bt', 'the branch named');
    assert.match(text, /The `bt` branches when the bit is clear, so the branch\nis the clear side and the fall-through the set side\./);
    /* each side: one stop and nothing else */
    assert.deepEqual(sides.set, sides.clear, 'both sides list the same');
    assert.equal(sides.set.length, 1, 'only a stop');
    const [stop] = sides.set, stopAt = h(stop.at, 8);
    assert.equal(stop.kind, 'param');
    const stopFlag = flagText(0x70, stop.bit << 16);
    assert.equal(stopFlag, flagText(FM.handlerTest(game, run9, stop.at).field, FM.handlerTest(game, run9, stop.at).mask), 'the stop\'s flag');
    /* the set side: cmp/pz r9 and a bt into neg, neg; then on, no branch, to the stop */
    const sb = word(at + 6), split = ((sb & 0xff) << 24 >> 24) * 2 + at + 10;
    const [, sr] = text.match(/goes on to 0x0600eb66, where `cmp\/pz r(\d+)` and/);
    assert.equal(word(at + 4), 0x4011 | (+sr << 8), 'cmp/pz rN');
    assert.equal(sb & 0xff00, 0x8900, '0x0600eb68: bt');
    assert.ok(split > at + 8 && split < stop.at, 'its branch lands on the way');
    const isBranch = w => (w & 0xf000) === 0x8000 && [0x8900, 0x8b00, 0x8d00, 0x8f00].includes(w & 0xff00) || (w & 0xf000) === 0xa000 || (w & 0xf000) === 0xb000
        || (w & 0xf0ff) === 0x002b || (w & 0xf0df) === 0x0003 || (w & 0xf0df) === 0x400b || w === 0x000b;
    for (let a = at + 8; a < stop.at; a += 2) assert.ok(!isBranch(word(a)) && word(a) !== 0x000b, `${h(a, 8)}: no branch`);
    assert.ok(clear > at + 8 && clear < stop.at, 'the clear side lands on the way');
    for (const a of [0x0600eb6a, 0x0600eb6c]) assert.equal(word(a), 0x600b | (+sr << 8) | (+sr << 4), `${h(a, 8)}: neg rN,rN`);
    const [, ldr, ldf, ldLit] = text.match(/0x0600eb58 `mov\.l @\(r0,r12\),r(\d+)` loaded from the long (\+0x[\da-f]+) \(the `mov\.w`\nliteral at (0x[\da-f]{8})\)/);
    assert.equal(+ldr, +sr, 'the register loaded');
    assert.equal(word(0x0600eb58), 0x00ce | (+ldr << 8), 'mov.l @(r0,r12),rN');
    assert.equal(pcLit(0x0600eb56), parseInt(ldLit, 16), 'the load\'s literal');
    assert.equal(`+${h(word(parseInt(ldLit, 16)), 3)}`, ldf, 'the long loaded');
    assert.match(text, new RegExp(String.raw`^The set side's words are 0x0600eb66 \`cmp/pz r${sr}\`, 0x0600eb68 \`bt\`, and\n0x0600eb6a and 0x0600eb6c \`neg r${sr},r${sr}\`; they change only r${sr}, which$`, 'm'));
    const stops = `stops at ${stopAt} (${stopFlag})`;
    assert.equal(rows[0][3], `goes on to ${h(at + 4, 8)}, where \`cmp/pz r${sr}\` and the \`bt\` at ${h(at + 6, 8)} go both ways: it goes on to ${h(at + 8, 8)}, or it branches to ${h(split, 8)}; no store or call either way; both run on to ${stopAt}; ${stops}`, 'the set cell');
    assert.equal(rows[0][4], `branches to ${h(clear, 8)}; no store or call; ${stops}`, 'the clear cell');
    /* the bullet */
    const bullet = text.match(/^- \*\*(.+?)\*\*:([^]*?)\n\n/m), body = bullet[2].replace(/\s+/g, ' ');
    assert.equal(bullet[1], named);
    assert.equal(body, ` set, it goes on at ${h(at + 4, 8)} and, whichever way the \`bt\` at ${h(at + 6, 8)} goes, runs on to ${stopAt}; clear, it jumps to ${h(clear, 8)} and runs on to ${stopAt}. Neither side stores or calls anything.`);
    /* the stop: a row of the list, no section of its own when this one was written */
    const described = describedAt(kindsDoc), before = kindsDoc.split('\n#### The flag at 0x0600eb62\n')[0];
    assert.ok(list.includes(`| ${stopAt} | this fighter (r12) | ${stopFlag.replace(' & ', ' | ')} |`), `${stopAt}'s row in the list`);
    assert.ok(!described.has(stopAt), `${stopAt} is no other section's`);
    assert.ok(!before.includes(`#### The flag at ${stopAt}`), `${stopAt} has no section of its own`);
    assert.equal(FM.handlerTest(game, run9, stop.at).of, undefined, `${stopAt} tests r12`);
    const [, s1, f1, p1] = text.match(/Both sides stop at (0x[\da-f]{8}), which tests this\nfighter's \(r12\) (\+0x[\da-f]+ & 0x[\da-f]{8}), parameter bit (0x[\da-f]{2})\. It is a row in\n"Flag tests not yet described" and is left undescribed here\./);
    assert.deepEqual([s1, f1, parseInt(p1, 16)], [stopAt, stopFlag, stop.bit], 'the stop named');
    for (const s of ['set', 'clear']) assert.ok(!sides[s].some(e => e.field === 0 && e.mask === 0x10000000), `${s}: not +0 bit 0x10000000`);
}
checkEb62(eb62Doc, newDoc);
for (const [from, to] of [['`mov r12,r1`', '`mov r13,r1`'], ['`mov.w @(0x0600eb94),r0`', '`mov.w @(0x0600eb92),r0`'], ['which loads 0x04a7', 'which loads 0x04a6'],
    ['`tst #0x01,r0`', '`tst #0x02,r0`'], ['then `bt` at', 'then `bf` at'],
    ['| 0x0600eb62 | +0x4a4 & 0x00000001 |', '| 0x0600eb62 | +0x4a4 & 0x00000100 |'], ['| 0x0600eb62 | +0x4a4 & 0x00000001 |', '| 0x0600eb62 | +0x4a8 & 0x00000001 |'],
    ['| 0x0600eb62 | +0x4a4 & 0x00000001 |', '| 0x0600eb62 | the opponent\'s +0x4a4 & 0x00000001 |'],
    ['bit 0x01 of the byte +0x4a7', 'bit 0x01 of the byte +0x4a4'], ['the long +0x4a4 masked', 'the long +0x4a8 masked'], ['with 0x00000001.', 'with 0x01000000.'],
    ['fighter (r12), not the opponent\'s', 'fighter (r13), not the opponent\'s'],
    ['so the branch\nis the clear side and the fall-through the set side', 'so the branch\nis the set side and the fall-through the clear side'],
    ['goes on to 0x0600eb66, where', 'goes on to 0x0600eb64, where'], ['`cmp/pz r9` and', '`cmp/pz r8` and'], ['`bt` at 0x0600eb68 go', '`bt` at 0x0600eb6a go'],
    ['goes on to 0x0600eb6a, or', 'goes on to 0x0600eb6c, or'], ['branches to 0x0600eb6c;', 'branches to 0x0600eb6e;'],
    ['no store or call either way;', 'sets +0x20 (0x0600eb6a);'], ['| branches to 0x0600eb6e;', '| branches to 0x0600eb70;'],
    ['0x0600eb6e; no store or call;', '0x0600eb6e; calls 0x06012d50 (0x0600eb70);'],
    ['both run on to 0x0600eb74; stops at 0x0600eb74', 'both run on to 0x0600eb74; stops at 0x0600eb76'], ['(+0x70 & 0x00200000) |', '(+0x70 & 0x00040000) |'],
    ['stops at 0x0600eb74 (+0x70 & 0x00200000) |\n', 'stops at 0x0600ec8e (+0x70 & 0x00200000) |\n'],
    ['it jumps\n  to 0x0600eb6e', 'it jumps\n  to 0x0600eb70'], ['Neither side stores or calls\n  anything.', 'Neither side calls\n  anything.'],
    ['`neg r9,r9`; they', '`not r9,r9`; they'], ['`mov.l @(r0,r12),r9`', '`mov.l @(r0,r12),r8`'], ['the long +0x4d8', 'the long +0x4a7'], ['literal at 0x0600eb92', 'literal at 0x0600eb94'],
    ['Both sides stop at 0x0600eb74', 'Both sides stop at 0x0600ec64'], ['fighter\'s (r12) +0x70 & 0x00200000', 'fighter\'s (r12) +0x70 & 0x00040000'],
    ['parameter bit 0x20. It', 'parameter bit 0x04. It']]) {
    assert.ok(eb62Doc.includes(from), from);
    assert.throws(() => checkEb62(eb62Doc.replace(from, to), newDoc), `${from} -> ${to}`);
}
/* the list's row naming another field or mask, or losing the stop's row, fails too */
assert.throws(() => checkEb62(eb62Doc, newDoc.replace('| 0x0600eb62 | this fighter (r12) | +0x4a4 | 0x00000001 |', '| 0x0600eb62 | this fighter (r12) | +0x4a4 | 0x00000002 |')));
assert.throws(() => checkEb62(eb62Doc, newDoc.replace('| 0x0600eb62 | this fighter (r12) | +0x4a4 | 0x00000001 |', '| 0x0600eb62 | this fighter (r12) | +0x4a8 | 0x00000001 |')));
assert.throws(() => checkEb62(eb62Doc, newDoc.replace(/^\| 0x0600eb74 .*\n/m, '')), '0x0600eb74');
/* The flag at 0x0600eb74: where both sides of 0x0600eb62 stop. The byte
 * +0x71 of r12; a bf, so the branch is the set side. The set side jumps to
 * the store path at 0x0600ebda; the clear side either branches to the 0.8
 * distance check, where it stops, or a bra takes it to the same path */
const eb74Doc = kindsDoc.split('#### The flag at 0x0600eb74\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
function checkEb74(text, list) {
    const at = 0x0600eb74, sides = FM.flagSides(game, run9, at);
    const listed = list.match(/^\| 0x0600eb74 \| this fighter \(r12\) \| (\+0x[\da-f]+) \| (0x[\da-f]{8}) \|$/m);
    assert.ok(listed, '0x0600eb74\'s row in "Flag tests not yet described"');
    const named = `${listed[1]} & ${listed[2]}`;
    const rows = [...text.matchAll(new RegExp(String.raw`^\| (0x[\da-f]{8}) \| (${FLAG}) \| (.*?) \| (.*?) \|$`, 'gm'))];
    assert.deepEqual(rows.map(r => [r[1], r[2]]), [['0x0600eb74', named]]);
    assert.equal(eventFlag(sides.flag), named, '0x0600eb74: the disc\'s flag');
    assert.ok(eb62Doc.includes(`stops at 0x0600eb74 (${named})`), '0x0600eb62 names this flag');
    /* mov rM,r1; add #byte,r1; mov.b @r1,r0; tst #bit,r0; bf */
    const [, m, byteText, bit, op] = text.match(/0x0600eb6e is `mov r(\d+),r1`, 0x0600eb70 `add #(0x[\da-f]{2}),r1`, 0x0600eb72\n`mov\.b @r1,r0` and 0x0600eb74 `tst #(0x[\da-f]{2}),r0`, then `(b[tf])` at 0x0600eb76\./);
    assert.equal(word(0x0600eb6e), 0x6103 | (+m << 4), 'mov rM,r1');
    assert.equal(word(0x0600eb70), 0x7100 | parseInt(byteText, 16), 'add #byte,r1');
    assert.equal(word(0x0600eb72), 0x6010, 'mov.b @r1,r0');
    assert.equal(word(at), 0xc800 | parseInt(bit, 16), 'tst #bit,r0');
    assert.equal(+m, 12, 'this fighter is r12');
    assert.ok(sides.flag.of !== 13, 'not the opponent\'s');
    const byte = parseInt(byteText, 16), long = byte & ~3, mask = parseInt(bit, 16) << 8 * (3 - (byte & 3));
    assert.equal(flagText(long, mask), named, 'the byte as its long');
    const [, bb, bf, lf, lm, pb] = text.match(/That is bit (0x[\da-f]{2}) of the byte (\+0x[\da-f]+) of this fighter \(r12\), not the\nopponent's: big-endian, the long (\+0x[\da-f]+) masked with (0x[\da-f]{8}), parameter\nbit (0x[\da-f]{2})\./);
    assert.deepEqual([bb, bf, `${lf} & ${lm}`, parseInt(pb, 16)], [bit, `+${h(byte, 2)}`, named, mask >>> 16], 'the byte and long named');
    const b = word(at + 2), set = ((b & 0xff) << 24 >> 24) * 2 + at + 6;
    assert.equal(b & 0xff00, 0x8b00, '0x0600eb76: bf, so the branch is the set side');
    assert.equal(op, 'bf', 'the branch named');
    assert.match(text, /The `bf` branches when the bit is set, so the branch is the\nset side and the fall-through the clear side\./);
    /* both sides list the same events, all on the path from the set side's target */
    assert.deepEqual(sides.set, sides.clear, 'both sides list the same');
    assert.ok(sides.set.every(e => e.at >= set), 'nothing before the set side\'s target');
    const stop = sides.set.at(-1), stopAt = h(stop.at, 8);
    assert.equal(stop.kind, 'param');
    assert.equal(sides.set.filter(e => e.kind === 'param').length, 1, 'one stop');
    const stopFlag = flagText(0x70, stop.bit << 16), st = FM.handlerTest(game, run9, stop.at);
    assert.equal(stopFlag, flagText(st.field, st.mask), 'the stop\'s flag');
    assert.equal(st.of, undefined, `${stopAt} tests r12`);
    const v = e => e.values.map(x => x && `${h(x.field, 2)}${x.plus > 0 ? '+' : ''}${x.plus || ''}`).join(' ');
    const said = sides.set.map(e => e.kind === 'call' ? `call ${h(e.target, 8)} ${h(e.at, 8)}` : e.kind === 'store' ? `store ${h(e.field, 2)}/${e.size} ${h(e.at, 8)} ${v(e)}` : `stop ${h(e.at, 8)}`);
    assert.deepEqual(said, ['store 0x4ae/2 0x0600ec08 0x1a 0x1a-32768', 'store 0x20/4 0x0600ec42 ', 'store 0x28/4 0x0600ec44 ', 'call 0x06012d50 0x0600ec7a',
        'store 0x60/1 0x0600ec86 0x60+1', `stop ${stopAt}`], 'the events');
    assert.equal(word(0x0600ec4a), 0x8000, 'the 0x8000 is the mov.w halfword at 0x0600ec4a');
    const stops = `stops at ${stopAt} (${stopFlag})`;
    assert.equal(rows[0][3], `branches to ${h(set, 8)}; puts the halfword +0x1a, or that minus 0x8000, in the halfword +0x4ae (0x0600ec08); sets +0x20 (0x0600ec42); sets +0x28 (0x0600ec44); calls 0x06012d50 (0x0600ec7a); adds 1 to the byte +0x60 (0x0600ec86); ${stops}`, 'the set cell');
    /* the set side: forward branches only, never back to the 0.8 check */
    const DIST = 0x0600eb98, CMP = 0x0600eb9e;
    assert.ok(!FM.handlerReaches(game, run9, set, CMP, [stop.at]), 'the set side does not reach the 0.8 check');
    /* the clear side: two bts to the check, else a bra to the set side's target */
    const tgt = a => ((word(a) & 0xff) << 24 >> 24) * 2 + a + 4, isBt = a => (word(a) & 0xff00) === 0x8900;
    const [, b1, b2, ck, bra, to] = rows[0][4].match(/^goes on to 0x0600eb78; no store or call; the `bt` at (0x[\da-f]{8}) or the one at (0x[\da-f]{8}) branches to (0x[\da-f]{8}) and stops at the 0\.8 distance check there; if neither branches, the `bra` at (0x[\da-f]{8}) jumps to (0x[\da-f]{8}), and from there on it is the same as the set side, to the same stop$/);
    assert.equal(at + 4, 0x0600eb78, 'the clear side goes on');
    for (const a of [b1, b2].map(x => parseInt(x, 16))) {
        assert.ok(isBt(a), `${h(a, 8)}: bt`);
        assert.equal(tgt(a), parseInt(ck, 16), `${h(a, 8)}: to the check`);
    }
    const ba = parseInt(bra, 16), bw = word(ba);
    assert.equal(bw & 0xf000, 0xa000, `${bra}: bra`);
    assert.equal(((bw & 0xfff) << 20 >> 20) * 2 + ba + 4, parseInt(to, 16), 'the bra\'s target');
    assert.equal(parseInt(to, 16), set, 'the bra lands on the set side\'s target');
    assert.equal(word(ba + 2), 0x0009, 'its delay slot is a nop');
    /* nothing on the way stores, calls or branches elsewhere: register moves, adds, subtracts and compares */
    const regOnly = w => (w & 0xf000) === 0x9000 || (w & 0xf00f) === 0x6003 || (w & 0xf00f) === 0x300c || (w & 0xf00f) === 0x3008 || (w & 0xf00b) === 0x3003;
    for (let a = at + 4; a < ba + 4; a += 2)
        if (![parseInt(b1, 16), parseInt(b2, 16), ba, ba + 2].includes(a)) assert.ok(regOnly(word(a)), `${h(a, 8)}: a register word`);
    assert.ok(parseInt(b1, 16) < parseInt(b2, 16) && parseInt(b2, 16) < ba && ba + 4 <= parseInt(ck, 16), 'in that order');
    /* the 0.8 distance check: mov.l 0x0000cccd; mov.w 0x04d8; mov.l @(r0,r12); cmp/gt; the only one */
    assert.equal(parseInt(ck, 16), DIST);
    const lit32 = a => game.prg.readUInt32BE(game.at(((a + 4) & ~3) + (word(a) & 0xff) * 4)), lit16 = a => word(a + 4 + (word(a) & 0xff) * 2);
    assert.equal(word(DIST) & 0xf000, 0xd000, 'mov.l @(disp,pc)');
    assert.equal(lit32(DIST), 0x0000cccd, '0.8');
    assert.equal(word(DIST + 2) & 0xff00, 0x9000, 'mov.w @(disp,pc),r0');
    assert.equal(lit16(DIST + 2), 0x04d8, '+0x4d8');
    assert.equal(word(DIST + 4) & 0xf0ff, 0x00ce, 'mov.l @(r0,r12)');
    assert.equal(word(CMP) & 0xf00f, 0x3007, 'cmp/gt');
    assert.deepEqual([(word(CMP) >> 4) & 15, (word(CMP) >> 8) & 15], [(word(DIST) >> 8) & 15, (word(DIST + 4) >> 8) & 15], 'the literal against the distance');
    assert.deepEqual(FM.readKind(game, 9).dists, [0.8], 'kind 9\'s one distance');
    assert.ok(FM.handlerReaches(game, run9, at + 4, DIST, [stop.at, set]), 'the clear side reaches the check');
    assert.match(text, /The 0\.8\ndistance check starts at 0x0600eb98, `mov\.l` of 0x0000cccd, compared at\n0x0600eb9e with the long \+0x4d8; it is the only one in kind 9's handlers,\nand is not explained here\. It is not the 0\.8 scale at 0x0600f3a4\./);
    /* the bullet */
    const bullet = text.match(/^- \*\*(.+?)\*\*:([^]*?)\n\n/m), body = bullet[2].replace(/\s+/g, ' ');
    assert.equal(bullet[1], named);
    assert.equal(body, ` set, it jumps to ${h(set, 8)} to store +0x4ae, +0x20 and +0x28, call 0x06012d50 and add 1 to +0x60 before it stops at ${stopAt}; clear, it goes on at ${h(at + 4, 8)} with no store or call, and either stops at the 0.8 distance check at ${h(DIST, 8)} or jumps to ${h(set, 8)} and goes on the same way as the set side.`);
    /* 0x0600ebda: where the tst r7,r7's bt lands */
    const r7 = 0x0600eb52;
    assert.equal(word(r7), 0x2778, 'tst r7,r7');
    assert.equal(tgt(r7 + 2), set, 'its bt lands at 0x0600ebda');
    assert.ok(isBt(r7 + 2));
    assert.match(text, /^0x0600ebda is where the `bt` after the `tst r7,r7` at 0x0600eb52 lands,$/m);
    /* the stop: a row of the list, no section of its own */
    const described = describedAt(kindsDoc), before = kindsDoc.split('\n#### The flag at 0x0600eb74\n')[0];
    assert.ok(list.includes(`| ${stopAt} | this fighter (r12) | ${stopFlag.replace(' & ', ' | ')} |`), `${stopAt}'s row in the list`);
    assert.ok(!described.has(stopAt), `${stopAt} is no other section's`);
    assert.ok(!before.includes(`#### The flag at ${stopAt}`), `${stopAt} has no section of its own`);
    const [, s1, f1, p1] = text.match(/Both\nsides' other stop is (0x[\da-f]{8}), which tests this fighter's \(r12\) (\+0x[\da-f]+ &\n0x[\da-f]{8}), parameter bit (0x[\da-f]{2})\. It is a row in "Flag tests not yet\ndescribed" and is left undescribed here\./);
    assert.deepEqual([s1, f1.replace('\n', ' '), parseInt(p1, 16)], [stopAt, stopFlag, stop.bit], 'the stop named');
    for (const s of ['set', 'clear']) assert.ok(!sides[s].some(e => e.field === 0 && e.mask === 0x10000000), `${s}: not +0 bit 0x10000000`);
}
checkEb74(eb74Doc, newDoc);
for (const [from, to] of [['`mov r12,r1`', '`mov r13,r1`'], ['`add #0x71,r1`', '`add #0x70,r1`'], ['`tst #0x20,r0`', '`tst #0x10,r0`'], ['then `bf` at', 'then `bt` at'],
    ['| 0x0600eb74 | +0x70 & 0x00200000 |', '| 0x0600eb74 | +0x70 & 0x00020000 |'], ['| 0x0600eb74 | +0x70 & 0x00200000 |', '| 0x0600eb74 | +0x6c & 0x00200000 |'],
    ['| 0x0600eb74 | +0x70 & 0x00200000 |', '| 0x0600eb74 | the opponent\'s +0x70 & 0x00200000 |'],
    ['bit 0x20 of the byte +0x71', 'bit 0x20 of the byte +0x70'], ['the long +0x70 masked', 'the long +0x6c masked'], ['with 0x00200000, parameter', 'with 0x20000000, parameter'],
    ['fighter (r12), not the', 'fighter (r13), not the'], ['parameter\nbit 0x20.', 'parameter\nbit 0x02.'],
    ['so the branch is the\nset side and the fall-through the clear side', 'so the branch is the\nclear side and the fall-through the set side'],
    ['| branches to 0x0600ebda; puts', '| branches to 0x0600eb78; puts'], ['(0x0600ec08); sets', '(0x0600ec0a); sets'], ['sets +0x28 (0x0600ec44);', 'sets +0x2c (0x0600ec44);'],
    ['calls 0x06012d50 (0x0600ec7a)', 'calls 0x06012d54 (0x0600ec7a)'], ['adds 1 to the byte +0x60 (0x0600ec86)', 'adds 2 to the byte +0x60 (0x0600ec86)'],
    ['(0x0600ec86); stops at 0x0600ec8e (+0x70 & 0x00040000)', '(0x0600ec86); stops at 0x0600ec64 (+0x70 & 0x00040000)'],
    ['(0x0600ec86); stops at 0x0600ec8e (+0x70 & 0x00040000)', '(0x0600ec86); stops at 0x0600ec8e (+0x70 & 0x00080000)'],
    ['| goes on to 0x0600eb78; no store', '| goes on to 0x0600eb7a; no store'], ['the `bt` at 0x0600eb80 or', 'the `bt` at 0x0600eb82 or'],
    ['the one at 0x0600eb88 branches', 'the one at 0x0600eb86 branches'], ['branches to 0x0600eb98 and stops', 'branches to 0x0600eb9a and stops'],
    ['no store or call; the `bt`', 'sets +0x20 (0x0600eb7a); the `bt`'], ['the `bra` at 0x0600eb8c jumps', 'the `bra` at 0x0600eb8e jumps'],
    ['jumps to 0x0600ebda, and from', 'jumps to 0x0600ebd0, and from'],
    ['set, it jumps to 0x0600ebda', 'set, it jumps to 0x0600ebd0'], ['stops at the 0.8 distance check at 0x0600eb98', 'stops at the 0.8 distance check at 0x0600eba0'],
    ['`mov.l` of 0x0000cccd', '`mov.l` of 0x0000cccc'], ['compared at\n0x0600eb9e', 'compared at\n0x0600eba0'], ['with the long +0x4d8;', 'with the long +0x56c;'],
    ['`tst r7,r7` at 0x0600eb52', '`tst r7,r7` at 0x0600eb54'],
    ['sides\' other stop is 0x0600ec8e', 'sides\' other stop is 0x0600ec64'], ['(r12) +0x70 &\n0x00040000', '(r12) +0x70 &\n0x00080000'], ['parameter bit 0x04. It', 'parameter bit 0x08. It']]) {
    assert.ok(eb74Doc.includes(from), from);
    assert.throws(() => checkEb74(eb74Doc.replace(from, to), newDoc), `${from} -> ${to}`);
}
/* the list's row naming another field or mask, or losing the stop's row, fails too */
assert.throws(() => checkEb74(eb74Doc, newDoc.replace('| 0x0600eb74 | this fighter (r12) | +0x70 | 0x00200000 |', '| 0x0600eb74 | this fighter (r12) | +0x70 | 0x00040000 |')));
assert.throws(() => checkEb74(eb74Doc, newDoc.replace('| 0x0600eb74 | this fighter (r12) | +0x70 | 0x00200000 |', '| 0x0600eb74 | this fighter (r12) | +0x6c | 0x00200000 |')));
assert.throws(() => checkEb74(eb74Doc, newDoc.replace(/^\| 0x0600ec8e .*\n/m, '')), '0x0600ec8e');
/* The flag at 0x0600ec64: where the set side of 0x0600ead0 stops. The byte
 * +0x4a7 of r12; a bt, so the branch is the clear side. The set side only
 * adds the literal 0x8000 to r7 and sign-extends it on the way; both sides then list the same
 * calls, store and stop, all from the clear side's target on */
const ec64Doc = kindsDoc.split('#### The flag at 0x0600ec64\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
function checkEc64(text, list) {
    const at = 0x0600ec64, sides = FM.flagSides(game, run9, at);
    const listed = list.match(/^\| 0x0600ec64 \| this fighter \(r12\) \| (\+0x[\da-f]+) \| (0x[\da-f]{8}) \|$/m);
    assert.ok(listed, '0x0600ec64\'s row in "Flag tests not yet described"');
    const named = `${listed[1]} & ${listed[2]}`;
    const rows = [...text.matchAll(new RegExp(String.raw`^\| (0x[\da-f]{8}) \| (${FLAG}) \| (.*?) \| (.*?) \|$`, 'gm'))];
    assert.deepEqual(rows.map(r => [r[1], r[2]]), [['0x0600ec64', named]]);
    assert.equal(eventFlag(sides.flag), named, '0x0600ec64: the disc\'s flag');
    assert.ok(ead0Doc.includes(`stops at 0x0600ec64 (${named})`), '0x0600ead0 names this flag');
    /* mov rM,r1; mov.w @(lit),r0; add r0,r1; mov.b @r1,r0; tst #bit,r0; bt */
    const [, m, litAt, lit, bit, op] = text.match(/0x0600ec5c is `mov r(\d+),r1`, 0x0600ec5e `mov\.w @\((0x[\da-f]{8})\),r0`,\nwhich loads (0x[\da-f]{4}), 0x0600ec60 `add r0,r1`, 0x0600ec62 `mov\.b @r1,r0` and\n0x0600ec64 `tst #(0x[\da-f]{2}),r0`, then `(b[tf])` at 0x0600ec66\./);
    const pcLit = a => (assert.equal(word(a) & 0xf000, 0x9000, `${h(a, 8)}: mov.w @(disp,pc),rN`), a + 4 + (word(a) & 0xff) * 2);
    assert.equal(word(0x0600ec5c), 0x6103 | (+m << 4), 'mov rM,r1');
    assert.equal(word(0x0600ec5e) & 0x0f00, 0x0000, 'into r0');
    assert.equal(pcLit(0x0600ec5e), parseInt(litAt, 16), 'the literal\'s address');
    assert.equal(word(parseInt(litAt, 16)), parseInt(lit, 16), 'the literal');
    assert.equal(word(0x0600ec60), 0x310c, 'add r0,r1');
    assert.equal(word(0x0600ec62), 0x6010, 'mov.b @r1,r0');
    assert.equal(word(at), 0xc800 | parseInt(bit, 16), 'tst #bit,r0');
    assert.equal(+m, 12, 'this fighter is r12');
    assert.ok(sides.flag.of !== 13, 'not the opponent\'s');
    const byte = parseInt(lit, 16), long = byte & ~3, mask = parseInt(bit, 16) << 8 * (3 - (byte & 3));
    assert.equal(flagText(long, mask), named, 'the byte as its long');
    const [, bb, bf, lf, lm] = text.match(/That is bit (0x[\da-f]{2}) of\nthe byte (\+0x[\da-f]+) of this fighter \(r12\), not the opponent's: big-endian,\nthe long (\+0x[\da-f]+) masked with (0x[\da-f]{8})\./);
    assert.deepEqual([bb, bf, `${lf} & ${lm}`], [bit, `+${h(byte, 3)}`, named], 'the byte and long named');
    const b = word(at + 2), clear = ((b & 0xff) << 24 >> 24) * 2 + at + 6;
    assert.equal(b & 0xff00, 0x8900, '0x0600ec66: bt, so the branch is the clear side');
    assert.equal(op, 'bt', 'the branch named');
    assert.match(text, /The `bt` branches when the bit is\nclear, so the branch is the clear side and the fall-through the set side\./);
    /* both sides list the same events, all from the clear side's target on */
    assert.deepEqual(sides.set, sides.clear, 'both sides list the same');
    assert.ok(sides.set.every(e => e.at >= clear), 'nothing before the clear side\'s target');
    const stop = sides.set.at(-1), stopAt = h(stop.at, 8);
    assert.equal(stop.kind, 'param');
    assert.equal(sides.set.filter(e => e.kind === 'param').length, 1, 'one stop');
    const stopFlag = flagText(0x70, stop.bit << 16), st = FM.handlerTest(game, run9, stop.at);
    assert.equal(stopFlag, flagText(st.field, st.mask), 'the stop\'s flag');
    assert.equal(st.of, undefined, `${stopAt} tests r12`);
    const v = e => e.values.map(x => x && `${h(x.field, 2)}${x.plus > 0 ? '+' : ''}${x.plus || ''}`).join(' ');
    const said = sides.set.map(e => e.kind === 'call' ? `call ${h(e.target, 8)} ${h(e.at, 8)}` : e.kind === 'store' ? `store ${h(e.field, 2)}/${e.size} ${h(e.at, 8)} ${v(e)}` : `stop ${h(e.at, 8)}`);
    assert.deepEqual(said, ['call 0x06012844 0x0600ec74', 'call 0x06012d50 0x0600ec7a', 'store 0x60/1 0x0600ec86 0x60+1', `stop ${stopAt}`], 'the events');
    /* the set side's three words: mov.w @(lit),r1 (0x8000); add r1,r7; exts.w r7,r7; then on to the clear side's target */
    const [, wLit, wVal] = text.match(/0x0600ec68 `mov\.w @\((0x[\da-f]{8})\),r1`, which loads\n(0x[\da-f]{4}), added as −0x8000, 0x0600ec6a `add r1,r7` and 0x0600ec6c\n`exts\.w r7,r7`; they change only r1 and r7, and store nothing\./);
    assert.equal(at + 4, 0x0600ec68, 'the set side goes on');
    assert.equal(word(0x0600ec68) & 0x0f00, 0x0100, 'into r1');
    assert.equal(pcLit(0x0600ec68), parseInt(wLit, 16), 'its literal\'s address');
    assert.equal(word(parseInt(wLit, 16)), parseInt(wVal, 16), 'its literal');
    assert.equal(word(parseInt(wLit, 16)) << 16 >> 16, -0x8000, 'sign-extended, -0x8000');
    assert.equal(word(0x0600ec6a), 0x371c, 'add r1,r7');
    assert.equal(word(0x0600ec6c), 0x677f, 'exts.w r7,r7');
    assert.equal(clear, 0x0600ec6e, 'the set side runs on to the clear side\'s target');
    /* 0x0600ec58: where ead0's bra lands; mov #0x1a,r0; mov.w @(r0,r12),r7 */
    const ba = 0x0600ead4, bw = word(ba);
    assert.equal(bw & 0xf000, 0xa000, '0x0600ead4: bra');
    assert.equal(((bw & 0xfff) << 20 >> 20) * 2 + ba + 4, 0x0600ec58, 'the bra lands at 0x0600ec58');
    assert.equal(word(0x0600ec58), 0xe01a, 'mov #0x1a,r0');
    assert.equal(word(0x0600ec5a), 0x07cd, 'mov.w @(r0,r12),r7');
    assert.match(text, /^0x0600ec58 is where the `bra` at 0x0600ead4 lands; its `mov #0x1a,r0`\nand 0x0600ec5a `mov\.w @\(r0,r12\),r7` load the halfword \+0x1a into r7\./m);
    const stops = `stops at ${stopAt} (${stopFlag})`;
    assert.equal(rows[0][3], `goes on to ${h(at + 4, 8)} and runs on to ${h(clear, 8)}; calls 0x06012844 (0x0600ec74); calls 0x06012d50 (0x0600ec7a); adds 1 to the byte +0x60 (0x0600ec86); ${stops}`, 'the set cell');
    assert.equal(rows[0][4], `branches to ${h(clear, 8)}, and from there on it is the same as the set side, to the same stop`, 'the clear cell');
    /* the bullet */
    const bullet = text.match(/^- \*\*(.+?)\*\*:([^]*?)\n\n/m), body = bullet[2].replace(/\s+/g, ' ');
    assert.equal(bullet[1], named);
    assert.equal(body, ` set, it goes on at ${h(at + 4, 8)} and runs on to ${h(clear, 8)}; clear, it jumps to ${h(clear, 8)}. From there both call 0x06012844 and 0x06012d50 and add 1 to +0x60 before they stop at ${stopAt}.`);
    /* the stop: a row of the list, no section of its own */
    const described = describedAt(kindsDoc), before = kindsDoc.split('\n#### The flag at 0x0600ec64\n')[0];
    assert.ok(list.includes(`| ${stopAt} | this fighter (r12) | ${stopFlag.replace(' & ', ' | ')} |`), `${stopAt}'s row in the list`);
    assert.ok(!described.has(stopAt), `${stopAt} is no other section's`);
    assert.ok(!before.includes(`#### The flag at ${stopAt}`), `${stopAt} has no section of its own`);
    const [, s1, f1, p1] = text.match(/Both sides stop at (0x[\da-f]{8}), which tests this\nfighter's \(r12\) (\+0x[\da-f]+ & 0x[\da-f]{8}), parameter bit (0x[\da-f]{2})\. It is a row in\n"Flag tests not yet described" and is left undescribed here\./);
    assert.deepEqual([s1, f1, parseInt(p1, 16)], [stopAt, stopFlag, stop.bit], 'the stop named');
    /* forward only: never back to the 0.8 check, never +0 bit 0x10000000 */
    assert.ok(!FM.handlerReaches(game, run9, at + 4, 0x0600eb9e, [stop.at]), 'no 0.8 check');
    assert.ok(text.includes('Neither side\nreaches the 0.8 distance check or `+0` bit 0x10000000.'));
    for (const s of ['set', 'clear']) assert.ok(!sides[s].some(e => e.field === 0 && e.mask === 0x10000000), `${s}: not +0 bit 0x10000000`);
}
checkEc64(ec64Doc, newDoc);
for (const [from, to] of [['`mov r12,r1`', '`mov r13,r1`'], ['`mov.w @(0x0600ec9e),r0`', '`mov.w @(0x0600eca0),r0`'], ['which loads 0x04a7', 'which loads 0x04a6'],
    ['`tst #0x01,r0`', '`tst #0x02,r0`'], ['then `bt` at', 'then `bf` at'],
    ['| 0x0600ec64 | +0x4a4 & 0x00000001 |', '| 0x0600ec64 | +0x4a4 & 0x00000100 |'], ['| 0x0600ec64 | +0x4a4 & 0x00000001 |', '| 0x0600ec64 | +0x4a8 & 0x00000001 |'],
    ['| 0x0600ec64 | +0x4a4 & 0x00000001 |', '| 0x0600ec64 | the opponent\'s +0x4a4 & 0x00000001 |'],
    ['bit 0x01 of\nthe byte +0x4a7', 'bit 0x01 of\nthe byte +0x4a4'], ['the long +0x4a4 masked', 'the long +0x4a8 masked'], ['with 0x00000001. The', 'with 0x01000000. The'],
    ['fighter (r12), not the opponent\'s', 'fighter (r13), not the opponent\'s'],
    ['so the branch is the clear side and the fall-through the set side', 'so the branch is the set side and the fall-through the clear side'],
    ['| goes on to 0x0600ec68 and', '| goes on to 0x0600ec6a and'], ['runs on to 0x0600ec6e; calls', 'runs on to 0x0600ec6c; calls'],
    ['calls 0x06012844 (0x0600ec74)', 'calls 0x06012844 (0x0600ec76)'], ['calls 0x06012d50 (0x0600ec7a)', 'calls 0x060131d0 (0x0600ec7a)'],
    ['adds 1 to the byte +0x60 (0x0600ec86)', 'adds 2 to the byte +0x60 (0x0600ec86)'], ['(0x0600ec86); stops at 0x0600ec8e', '(0x0600ec86); stops at 0x0600ec90'],
    ['(+0x70 & 0x00040000) |', '(+0x70 & 0x00080000) |'], ['| branches to 0x0600ec6e, and', '| branches to 0x0600ec68, and'],
    ['set, it goes on at 0x0600ec68', 'set, it goes on at 0x0600ec6a'], ['clear, it jumps to 0x0600ec6e.', 'clear, it jumps to 0x0600ec68.'],
    ['From there both call\n  0x06012844', 'From there both call\n  0x06012840'], ['add 1 to +0x60', 'add 2 to +0x60'],
    ['the `bra` at 0x0600ead4 lands', 'the `bra` at 0x0600ead6 lands'], ['`mov #0x1a,r0`', '`mov #0x1c,r0`'], ['`mov.w @(r0,r12),r7`', '`mov.w @(r0,r12),r6`'],
    ['`mov.w @(0x0600eca0),r1`', '`mov.w @(0x0600ec9e),r1`'], ['loads\n0x8000', 'loads\n0x4000'], ['`add r1,r7`', '`add r1,r6`'], ['`exts.w r7,r7`', '`extu.w r7,r7`'], ['and store nothing.', 'and set +0x1a.'],
    ['Both sides stop at 0x0600ec8e', 'Both sides stop at 0x0600ecd0'], ['fighter\'s (r12) +0x70 & 0x00040000', 'fighter\'s (r12) +0x70 & 0x00080000'],
    ['parameter bit 0x04. It', 'parameter bit 0x08. It']]) {
    assert.ok(ec64Doc.includes(from), from);
    assert.throws(() => checkEc64(ec64Doc.replace(from, to), newDoc), `${from} -> ${to}`);
}
/* the list's row naming another field or mask, or losing the stop's row, fails too */
assert.throws(() => checkEc64(ec64Doc, newDoc.replace('| 0x0600ec64 | this fighter (r12) | +0x4a4 | 0x00000001 |', '| 0x0600ec64 | this fighter (r12) | +0x4a4 | 0x00000002 |')));
assert.throws(() => checkEc64(ec64Doc, newDoc.replace('| 0x0600ec64 | this fighter (r12) | +0x4a4 | 0x00000001 |', '| 0x0600ec64 | this fighter (r12) | +0x4a8 | 0x00000001 |')));
assert.throws(() => checkEc64(ec64Doc, newDoc.replace(/^\| 0x0600ec8e .*\n/m, '')), '0x0600ec8e');
/* The flag at 0x0600ec8e: where both sides of 0x0600eb74 and 0x0600ec64 stop.
 * The byte +0x71 of r12; a bf, so the branch is the set side. Each side loads
 * the call's address and r4 from mov.l literals, calls 0x060148ae and ends
 * this frame's run at the jmp @r14 */
const ec8eDoc = kindsDoc.split('#### The flag at 0x0600ec8e\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
function checkEc8e(text, list) {
    const at = 0x0600ec8e, sides = FM.flagSides(game, run9, at);
    const listed = list.match(/^\| 0x0600ec8e \| this fighter \(r12\) \| (\+0x[\da-f]+) \| (0x[\da-f]{8}) \|$/m);
    assert.ok(listed, '0x0600ec8e\'s row in "Flag tests not yet described"');
    const named = `${listed[1]} & ${listed[2]}`;
    const rows = [...text.matchAll(new RegExp(String.raw`^\| (0x[\da-f]{8}) \| (${FLAG}) \| (.*?) \| (.*?) \|$`, 'gm'))];
    assert.deepEqual(rows.map(r => [r[1], r[2]]), [['0x0600ec8e', named]]);
    assert.equal(eventFlag(sides.flag), named, '0x0600ec8e: the disc\'s flag');
    for (const d of [eb74Doc, ec64Doc]) assert.ok(d.includes(`stops at 0x0600ec8e (${named})`), 'eb74 and ec64 name this flag');
    assert.match(text, /^The flag test that both sides of "The flag at 0x0600eb74" and "The flag\nat 0x0600ec64" stop at,/);
    /* mov rM,r1; add #disp,r1; mov.b @r1,r0; tst #bit,r0; bf */
    const [, m, add, bit, op] = text.match(/0x0600ec88 is `mov r(\d+),r1`, 0x0600ec8a\n`add #(0x[\da-f]{2}),r1`, 0x0600ec8c `mov\.b @r1,r0` and 0x0600ec8e `tst #(0x[\da-f]{2}),r0`,\nthen `(b[tf])` at 0x0600ec90\./);
    assert.equal(word(0x0600ec88), 0x6103 | (+m << 4), 'mov rM,r1');
    assert.equal(word(0x0600ec8a), 0x7100 | parseInt(add, 16), 'add #disp,r1');
    assert.equal(word(0x0600ec8c), 0x6010, 'mov.b @r1,r0');
    assert.equal(word(at), 0xc800 | parseInt(bit, 16), 'tst #bit,r0');
    assert.equal(+m, 12, 'this fighter is r12');
    assert.ok(sides.flag.of !== 13, 'not the opponent\'s');
    const byte = parseInt(add, 16), long = byte & ~3, mask = parseInt(bit, 16) << 8 * (3 - (byte & 3));
    assert.equal(flagText(long, mask), named, 'the byte as its long');
    const [, bb, bf, lf, lm, pb] = text.match(/That is bit (0x[\da-f]{2}) of the byte (\+0x[\da-f]+) of this\nfighter \(r12\), not the opponent's: big-endian, the long (\+0x[\da-f]+) masked with\n(0x[\da-f]{8}), parameter bit (0x[\da-f]{2})\./);
    assert.deepEqual([bb, bf, `${lf} & ${lm}`], [bit, `+${h(byte, 2)}`, named], 'the byte and long named');
    assert.equal(long, 0x70, 'the request\'s field');
    assert.equal(parseInt(pb, 16) << 16, mask, 'the parameter bit');
    const b = word(at + 2), set = ((b & 0xff) << 24 >> 24) * 2 + at + 6;
    assert.equal(b & 0xff00, 0x8b00, '0x0600ec90: bf, so the branch is the set side');
    assert.equal(op, 'bf', 'the branch named');
    assert.match(text, /The `bf` branches when the bit is set, so\nthe branch is the set side and the fall-through the clear side\./);
    /* the events: one call and the end on each side, no store, no stop */
    const said = s => sides[s].map(e => e.kind === 'call' ? `call ${h(e.target, 8)} ${h(e.at, 8)}` : `${e.kind} ${h(e.at, 8)}`);
    assert.deepEqual(said('set'), ['call 0x060148ae 0x0600ecb8', 'end 0x0600ecbc'], 'the set side\'s events');
    assert.deepEqual(said('clear'), ['call 0x060148ae 0x0600ec96', 'end 0x0600ecbc'], 'the clear side\'s events');
    assert.equal(set, 0x0600ecb4, 'the set side\'s target');
    assert.equal(word(0x0600ecbc), 0x4e2b, '0x0600ecbc: jmp @r14');
    /* the clear side's bra lands on the end */
    const ba = 0x0600ec9a, bw = word(ba);
    assert.equal(bw & 0xf000, 0xa000, '0x0600ec9a: bra');
    const bTo = ((bw & 0xfff) << 20 >> 20) * 2 + ba + 4;
    assert.equal(bTo, 0x0600ecbc, 'the bra lands at the end');
    assert.equal(rows[0][3], `branches to ${h(set, 8)}; calls 0x060148ae (0x0600ecb8); ends this frame's run (0x0600ecbc)`, 'the set cell');
    assert.equal(rows[0][4], `goes on to ${h(at + 4, 8)}; calls 0x060148ae (0x0600ec96); the \`bra\` at ${h(ba, 8)} jumps to ${h(bTo, 8)}; ends this frame's run (0x0600ecbc)`, 'the clear cell');
    /* the literals: mov.l @(disp,pc),rN; jsr @r0 */
    const lit = a => (assert.equal(word(a) & 0xf000, 0xd000, `${h(a, 8)}: mov.l @(disp,pc),rN`), [(word(a) >> 8) & 15, ((a + 4) & ~3) + (word(a) & 0xff) * 4]);
    const [, s0, s0a, s0v, s4, s4a, s4v, c0, c0a, c0v, c4, c4a, c4v] = text.match(/the set side (0x[\da-f]{8}) `mov\.l @\((0x[\da-f]{8})\),r0`, which\nloads (0x[\da-f]{8}), and (0x[\da-f]{8}) `mov\.l @\((0x[\da-f]{8})\),r4`, which loads\n(0x[\da-f]{8}); the clear side (0x[\da-f]{8}) `mov\.l @\((0x[\da-f]{8})\),r0`, which\nloads (0x[\da-f]{8}), and (0x[\da-f]{8}) `mov\.l @\((0x[\da-f]{8})\),r4`, which loads\n(0x[\da-f]{8})\. So both call 0x060148ae with the same r4\./);
    const long32 = a => game.prg.readUInt32BE(game.at(a));
    for (const [ins, la, v, r] of [[s0, s0a, s0v, 0], [s4, s4a, s4v, 4], [c0, c0a, c0v, 0], [c4, c4a, c4v, 4]]) {
        assert.deepEqual(lit(parseInt(ins, 16)), [r, parseInt(la, 16)], `${ins}: into r${r} from ${la}`);
        assert.equal(h(long32(parseInt(la, 16)), 8), v, `${la}: the literal`);
    }
    assert.deepEqual([s0, s4, c0, c4], [h(set, 8), h(set + 2, 8), h(at + 4, 8), h(at + 6, 8)], 'the literals sit at each side\'s start');
    assert.ok(s0v === '0x060148ae' && c0v === '0x060148ae' && s4v === c4v, 'the same call, the same r4');
    for (const j of [set + 4, at + 8]) assert.equal(word(j), 0x400b, `${h(j, 8)}: jsr @r0`);
    assert.match(text, /0x0600ecbc is the\nrun handler's `jmp @r14`\./);
    /* the bullet */
    const bullet = text.match(/^- \*\*(.+?)\*\*:([^]*?)\n\n/m), body = bullet[2].replace(/\s+/g, ' ');
    assert.equal(bullet[1], named);
    assert.equal(body, ` set, it jumps to ${h(set, 8)} and calls 0x060148ae; clear, it goes on at ${h(at + 4, 8)}, calls 0x060148ae and jumps to ${h(bTo, 8)}. Both end this frame's run at 0x0600ecbc and store nothing.`);
    for (const s of ['set', 'clear']) {
        assert.ok(!sides[s].some(e => ['store', 'stop', 'param'].includes(e.kind)), `${s}: no store or stop`);
        assert.ok(!sides[s].some(e => e.field === 0 && e.mask === 0x10000000), `${s}: not +0 bit 0x10000000`);
    }
    /* forward only: never to the 0.8 check */
    for (const from of [set, at + 4]) assert.ok(!FM.handlerReaches(game, run9, from, 0x0600eb9e, [0x0600ecbc]), `${h(from, 8)}: no 0.8 check`);
    assert.ok(text.includes('Neither side stops at another flag test, and neither reaches the 0.8\ndistance check or `+0` bit 0x10000000.'));
}
checkEc8e(ec8eDoc, newDoc);
for (const [from, to] of [['`mov r12,r1`', '`mov r13,r1`'], ['`add #0x71,r1`', '`add #0x70,r1`'], ['`tst #0x04,r0`', '`tst #0x08,r0`'], ['then `bf` at', 'then `bt` at'],
    ['| 0x0600ec8e | +0x70 & 0x00040000 |', '| 0x0600ec8e | +0x70 & 0x00000400 |'], ['| 0x0600ec8e | +0x70 & 0x00040000 |', '| 0x0600ec8e | +0x6c & 0x00040000 |'],
    ['| 0x0600ec8e | +0x70 & 0x00040000 |', '| 0x0600ec8e | the opponent\'s +0x70 & 0x00040000 |'],
    ['bit 0x04 of the byte +0x71', 'bit 0x04 of the byte +0x70'], ['the long +0x70 masked', 'the long +0x6c masked'], ['with\n0x00040000, parameter', 'with\n0x04000000, parameter'],
    ['parameter bit 0x04. The', 'parameter bit 0x08. The'], ['fighter (r12), not the opponent\'s', 'fighter (r13), not the opponent\'s'],
    ['so\nthe branch is the set side and the fall-through the clear side', 'so\nthe branch is the clear side and the fall-through the set side'],
    ['| branches to 0x0600ecb4;', '| branches to 0x0600ecb2;'], ['calls 0x060148ae (0x0600ecb8)', 'calls 0x060148ae (0x0600ecba)'],
    ['(0x0600ecb8); ends this frame\'s run (0x0600ecbc) |', '(0x0600ecb8); stops at 0x0600ecd0 (+0x6c0 & 0x02000000) |'],
    ['| goes on to 0x0600ec92;', '| goes on to 0x0600ec94;'], ['calls 0x060148ae (0x0600ec96)', 'calls 0x06014ca4 (0x0600ec96)'],
    ['the `bra` at 0x0600ec9a jumps to 0x0600ecbc;', 'the `bra` at 0x0600ec9a jumps to 0x0600ecc8;'],
    ['set, it jumps to 0x0600ecb4', 'set, it jumps to 0x0600ec92'], ['clear, it goes on at 0x0600ec92', 'clear, it goes on at 0x0600ecb4'],
    ['and store\n  nothing.', 'and set\n  +0x60.'],
    ['0x0600ecb4 `mov.l @(0x0600ecc0),r0`', '0x0600ecb4 `mov.l @(0x0600ecc4),r0`'], ['0xa01112ff; the clear', '0xa01112fe; the clear'],
    ['0x0600ec94 `mov.l @(0x0600ecb0),r4`', '0x0600ec94 `mov.l @(0x0600ecac),r4`'], ['loads 0x060148ae, and 0x0600ec94', 'loads 0x06012844, and 0x0600ec94'],
    ['0x0600ecbc is the\nrun handler\'s `jmp @r14`', '0x0600ecba is the\nrun handler\'s `jmp @r14`'],
    ['"The flag at 0x0600eb74" and "The flag\nat 0x0600ec64"', '"The flag at 0x0600eb62" and "The flag\nat 0x0600ec64"']]) {
    assert.ok(ec8eDoc.includes(from), from);
    assert.throws(() => checkEc8e(ec8eDoc.replace(from, to), newDoc), `${from} -> ${to}`);
}
/* the list's row naming another field or mask fails too */
assert.throws(() => checkEc8e(ec8eDoc, newDoc.replace('| 0x0600ec8e | this fighter (r12) | +0x70 | 0x00040000 |', '| 0x0600ec8e | this fighter (r12) | +0x70 | 0x00080000 |')));
assert.throws(() => checkEc8e(ec8eDoc, newDoc.replace('| 0x0600ec8e | this fighter (r12) | +0x70 | 0x00040000 |', '| 0x0600ec8e | this fighter (r12) | +0x6c | 0x00040000 |')));
/* The flag at 0x0600ecd0: the next row of the list. The byte +0x6c0 of r12,
 * through a mov.w literal; a bf, so the branch is the set side. Neither side
 * stores or calls: the set side's bra goes on to 0x0600ed16, a row of "The
 * flags behind them"; the clear side stops at 0x0600ecda, a row of the list */
const ecd0Doc = kindsDoc.split('#### The flag at 0x0600ecd0\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
const behindDoc = kindsDoc.split('#### The flags behind them\n\n')[1].split('\n#### ')[0];
function checkEcd0(text, list) {
    const at = 0x0600ecd0, sides = FM.flagSides(game, run9, at);
    const listed = list.match(/^\| 0x0600ecd0 \| this fighter \(r12\) \| (\+0x[\da-f]+) \| (0x[\da-f]{8}) \|$/m);
    assert.ok(listed, '0x0600ecd0\'s row in "Flag tests not yet described"');
    const named = `${listed[1]} & ${listed[2]}`;
    const rows = [...text.matchAll(new RegExp(String.raw`^\| (0x[\da-f]{8}) \| (${FLAG}) \| (.*?) \| (.*?) \|$`, 'gm'))];
    assert.deepEqual(rows.map(r => [r[1], r[2]]), [['0x0600ecd0', named]]);
    assert.equal(eventFlag(sides.flag), named, '0x0600ecd0: the disc\'s flag');
    /* mov rM,r1; mov.w @(lit),r0; add r0,r1; mov.b @r1,r0; tst #bit,r0; bf */
    const [, m, litAt, lit, bit, op] = text.match(/0x0600ecc8 is `mov r(\d+),r1`, 0x0600ecca `mov\.w @\((0x[\da-f]{8})\),r0`,\nwhich loads (0x[\da-f]{4}), 0x0600eccc `add r0,r1`, 0x0600ecce `mov\.b @r1,r0` and\n0x0600ecd0 `tst #(0x[\da-f]{2}),r0`, then `(b[tf])` at 0x0600ecd2\./);
    const pcLit = a => (assert.equal(word(a) & 0xf000, 0x9000, `${h(a, 8)}: mov.w @(disp,pc),rN`), a + 4 + (word(a) & 0xff) * 2);
    assert.equal(word(0x0600ecc8), 0x6103 | (+m << 4), 'mov rM,r1');
    assert.equal(word(0x0600ecca) & 0x0f00, 0x0000, 'into r0');
    assert.equal(pcLit(0x0600ecca), parseInt(litAt, 16), 'the literal\'s address');
    assert.equal(word(parseInt(litAt, 16)), parseInt(lit, 16), 'the literal');
    assert.equal(word(0x0600eccc), 0x310c, 'add r0,r1');
    assert.equal(word(0x0600ecce), 0x6010, 'mov.b @r1,r0');
    assert.equal(word(at), 0xc800 | parseInt(bit, 16), 'tst #bit,r0');
    assert.equal(+m, 12, 'this fighter is r12');
    assert.ok(sides.flag.of !== 13, 'not the opponent\'s');
    const byte = parseInt(lit, 16), long = byte & ~3, mask = parseInt(bit, 16) << 8 * (3 - (byte & 3));
    assert.equal(flagText(long, mask), named, 'the byte as its long');
    const [, bb, bf, lf, lm] = text.match(/That is bit (0x[\da-f]{2}) of\nthe byte (\+0x[\da-f]+) of this fighter \(r12\), not the opponent's: big-endian,\nthe long (\+0x[\da-f]+) masked with (0x[\da-f]{8})\./);
    assert.deepEqual([bb, bf, `${lf} & ${lm}`], [bit, `+${h(byte, 3)}`, named], 'the byte and long named');
    const b = word(at + 2), set = ((b & 0xff) << 24 >> 24) * 2 + at + 6;
    assert.equal(b & 0xff00, 0x8b00, '0x0600ecd2: bf, so the branch is the set side');
    assert.equal(op, 'bf', 'the branch named');
    assert.match(text, /The `bf` branches when the bit is\nset, so the branch is the set side and the fall-through the clear side\./);
    /* the set side: mov.w @(lit),r0; mov.l @(r0,r12),r4; bra, nop; then on to 0x0600ed16 */
    const [, sLit, sVal] = text.match(/The set side's words before the `bra` are 0x0600ecfe\n`mov\.w @\((0x[\da-f]{8})\),r0`, which loads (0x[\da-f]{4}), and 0x0600ed00\n`mov\.l @\(r0,r12\),r4`, which loads the long \+0x6c0 into r4; they store\nnothing\./);
    assert.equal(set, 0x0600ecfe, 'the set side\'s target');
    assert.equal(word(set) & 0x0f00, 0x0000, 'into r0');
    assert.equal(pcLit(set), parseInt(sLit, 16), 'its literal\'s address');
    assert.equal(word(parseInt(sLit, 16)), parseInt(sVal, 16), 'its literal');
    assert.equal(h(word(parseInt(sLit, 16)), 3), listed[1].slice(1), 'the same field');
    assert.equal(word(0x0600ed00), 0x04ce, 'mov.l @(r0,r12),r4');
    const ba = 0x0600ed02, bw = word(ba);
    assert.equal(bw & 0xf000, 0xa000, '0x0600ed02: bra');
    assert.equal(word(ba + 2), 0x0009, 'its delay slot: nop');
    const bTo = ((bw & 0xfff) << 20 >> 20) * 2 + ba + 4;
    assert.equal(bTo, 0x0600ed10, 'the bra lands at 0x0600ed10');
    /* the events: no store or call, one stop each */
    for (const s of ['set', 'clear']) {
        assert.equal(sides[s].length, 1, `${s}: one event`);
        assert.ok(!sides[s].some(e => ['store', 'call', 'end', 'return'].includes(e.kind)), `${s}: no store or call`);
        assert.ok(!sides[s].some(e => e.field === 0 && e.mask === 0x10000000), `${s}: not +0 bit 0x10000000`);
    }
    const [ss] = sides.set, [cs] = sides.clear;
    assert.equal(ss.kind, 'stop');
    assert.ok(ss.at > bTo, 'the set side\'s stop is past the bra\'s target');
    const setFlag = eventFlag(ss), setAt = h(ss.at, 8);
    assert.equal(cs.kind, 'param');
    const clearAt = h(cs.at, 8), clearFlag = flagText(0x70, cs.bit << 16), ct = FM.handlerTest(game, run9, cs.at);
    assert.equal(clearFlag, flagText(ct.field, ct.mask), 'the clear stop\'s flag');
    assert.equal(ct.of, undefined, `${clearAt} tests r12`);
    assert.equal(rows[0][3], `branches to ${h(set, 8)}; no store or call; the \`bra\` at ${h(ba, 8)} jumps to ${h(bTo, 8)}; stops at ${setAt} (${setFlag})`, 'the set cell');
    assert.equal(rows[0][4], `goes on to ${h(at + 4, 8)}; no store or call; stops at ${clearAt} (${clearFlag})`, 'the clear cell');
    /* the bullet */
    const bullet = text.match(/^- \*\*(.+?)\*\*:([^]*?)\n\n/m), body = bullet[2].replace(/\s+/g, ' ');
    assert.equal(bullet[1], named);
    assert.equal(body, ` set, it jumps to ${h(set, 8)} and on to ${h(bTo, 8)} with no store or call, and stops at ${setAt}; clear, it goes on at ${h(at + 4, 8)} with no store or call, and stops at ${clearAt}.`);
    /* the set side's stop: a row of "The flags behind them" */
    const [, s1, f1] = text.match(/The set side's stop, (0x[\da-f]{8}), tests this fighter's \(r12\)\n(\+0x[\da-f]+ & 0x[\da-f]{8}); it is a row in "The flags behind them", which\ndescribes its sides\./);
    assert.deepEqual([s1, f1], [setAt, setFlag], 'the set stop named');
    assert.equal(ss.of, undefined, `${setAt} tests r12`);
    assert.ok(behindDoc.includes(`| ${setAt} | run | ${setFlag} |`), `${setAt}'s row in "The flags behind them"`);
    /* the clear side's stop: a row of the list, no section of its own */
    const described = describedAt(kindsDoc), before = kindsDoc.split('\n#### The flag at 0x0600ecd0\n')[0];
    assert.ok(list.includes(`| ${clearAt} | this fighter (r12) | ${clearFlag.replace(' & ', ' | ')} |`), `${clearAt}'s row in the list`);
    assert.ok(!described.has(clearAt), `${clearAt} is no other section's`);
    assert.ok(!before.includes(`#### The flag at ${clearAt}`), `${clearAt} has no section of its own`);
    const [, s2, f2, p2] = text.match(/The clear side's stop, (0x[\da-f]{8}), tests this\nfighter's \(r12\) (\+0x[\da-f]+ & 0x[\da-f]{8}), parameter bit (0x[\da-f]{2})\. It is a row in\n"Flag tests not yet described" and is left undescribed here\./);
    assert.deepEqual([s2, f2, parseInt(p2, 16)], [clearAt, clearFlag, cs.bit], 'the clear stop named');
    /* forward only: never to the 0.8 check */
    assert.ok(!FM.handlerReaches(game, run9, set, 0x0600eb9e, [ss.at]), 'set: no 0.8 check');
    assert.ok(!FM.handlerReaches(game, run9, at + 4, 0x0600eb9e, [cs.at]), 'clear: no 0.8 check');
    assert.ok(text.includes('Neither side\nreaches the 0.8 distance check or `+0` bit 0x10000000.'));
}
checkEcd0(ecd0Doc, newDoc);
for (const [from, to] of [['`mov r12,r1`', '`mov r13,r1`'], ['0x0600ecca `mov.w @(0x0600ed06),r0`', '0x0600ecca `mov.w @(0x0600ed08),r0`'], ['which loads 0x06c0, 0x0600eccc', 'which loads 0x06c1, 0x0600eccc'],
    ['`tst #0x02,r0`', '`tst #0x04,r0`'], ['then `bf` at', 'then `bt` at'],
    ['| 0x0600ecd0 | +0x6c0 & 0x02000000 |', '| 0x0600ecd0 | +0x6c0 & 0x00000002 |'], ['| 0x0600ecd0 | +0x6c0 & 0x02000000 |', '| 0x0600ecd0 | +0x6c4 & 0x02000000 |'],
    ['| 0x0600ecd0 | +0x6c0 & 0x02000000 |', '| 0x0600ecd0 | the opponent\'s +0x6c0 & 0x02000000 |'],
    ['bit 0x02 of\nthe byte +0x6c0', 'bit 0x02 of\nthe byte +0x6c3'], ['the long +0x6c0 masked', 'the long +0x6c4 masked'], ['with 0x02000000. The', 'with 0x00000002. The'],
    ['fighter (r12), not the opponent\'s', 'fighter (r13), not the opponent\'s'],
    ['so the branch is the set side and the fall-through the clear side', 'so the branch is the clear side and the fall-through the set side'],
    ['| branches to 0x0600ecfe;', '| branches to 0x0600ecd4;'], ['the `bra` at 0x0600ed02 jumps to 0x0600ed10;', 'the `bra` at 0x0600ed02 jumps to 0x0600ed12;'],
    ['stops at 0x0600ed16 (+0x00 & 0x00000020) |', 'stops at 0x0600ed16 (+0x00 & 0x00000040) |'], ['stops at 0x0600ed16 (+0x00 & 0x00000020) |', 'stops at 0x0600ed40 (+0x00 & 0x00000020) |'],
    ['; no store or call; the `bra`', '; sets +0x6c0; the `bra`'],
    ['| goes on to 0x0600ecd4;', '| goes on to 0x0600ecd6;'], ['stops at 0x0600ecda (+0x70 & 0x00080000) |', 'stops at 0x0600ecda (+0x70 & 0x00040000) |'],
    ['stops at 0x0600ecda (+0x70 & 0x00080000) |', 'stops at 0x0600f37e (+0x70 & 0x00080000) |'],
    ['set, it jumps to 0x0600ecfe', 'set, it jumps to 0x0600ecd4'], ['and stops at 0x0600ed16; clear', 'and stops at 0x0600ed20; clear'],
    ['goes on at 0x0600ecd4 with', 'goes on at 0x0600ecfe with'], ['and stops at 0x0600ecda.', 'and stops at 0x0600ecdc.'],
    ['0x0600ecfe\n`mov.w @(0x0600ed06),r0`', '0x0600ecfe\n`mov.w @(0x0600ed08),r0`'], ['which loads 0x06c0, and 0x0600ed00', 'which loads 0x04a8, and 0x0600ed00'],
    ['`mov.l @(r0,r12),r4`', '`mov.l @(r0,r12),r5`'],
    ['The set side\'s stop, 0x0600ed16', 'The set side\'s stop, 0x0600ed40'], ['+0x00 & 0x00000020; it is a row', '+0x00 & 0x04000000; it is a row'],
    ['The clear side\'s stop, 0x0600ecda', 'The clear side\'s stop, 0x0600f37e'], ['fighter\'s (r12) +0x70 & 0x00080000', 'fighter\'s (r12) +0x70 & 0x00040000'],
    ['parameter bit 0x08. It', 'parameter bit 0x04. It']]) {
    assert.ok(ecd0Doc.includes(from), from);
    assert.throws(() => checkEcd0(ecd0Doc.replace(from, to), newDoc), `${from} -> ${to}`);
}
/* the list's row naming another field or mask, or losing the clear stop's row, fails too */
assert.throws(() => checkEcd0(ecd0Doc, newDoc.replace('| 0x0600ecd0 | this fighter (r12) | +0x6c0 | 0x02000000 |', '| 0x0600ecd0 | this fighter (r12) | +0x6c0 | 0x04000000 |')));
assert.throws(() => checkEcd0(ecd0Doc, newDoc.replace('| 0x0600ecd0 | this fighter (r12) | +0x6c0 | 0x02000000 |', '| 0x0600ecd0 | this fighter (r12) | +0x6c4 | 0x02000000 |')));
assert.throws(() => checkEcd0(ecd0Doc, newDoc.replace(/^\| 0x0600ecda .*\n/m, '')), '0x0600ecda');
/* The flag at 0x0600ecda: the next row of the list, the stop of 0x0600ecd0's
 * clear side. The byte +0x71 of r12 through add #imm; a bt, so the branch is
 * the clear side. The set side splits at a cmp/gt whose bt lands where the
 * clear side does; flagSides lists both paths in one list, split here at that
 * target. Both stop at 0x0600ed16, a row of "The flags behind them" */
const ecdaDoc = kindsDoc.split('#### The flag at 0x0600ecda\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
function checkEcda(text, list, ecd0) {
    const at = 0x0600ecda, sides = FM.flagSides(game, run9, at);
    const listed = list.match(/^\| 0x0600ecda \| this fighter \(r12\) \| (\+0x[\da-f]+) \| (0x[\da-f]{8}) \|$/m);
    assert.ok(listed, '0x0600ecda\'s row in "Flag tests not yet described"');
    const named = `${listed[1]} & ${listed[2]}`;
    const [, inEcd0] = ecd0.match(/The clear side's stop, 0x0600ecda, tests this\nfighter's \(r12\) (\+0x[\da-f]+ & 0x[\da-f]{8}),/);
    assert.equal(inEcd0, named, '"The flag at 0x0600ecd0" names the same flag');
    const rows = [...text.matchAll(new RegExp(String.raw`^\| (0x[\da-f]{8}) \| (${FLAG}) \| (.*?) \| (.*?) \|$`, 'gm'))];
    assert.deepEqual(rows.map(r => [r[1], r[2]]), [['0x0600ecda', named]]);
    assert.equal(eventFlag(sides.flag), named, '0x0600ecda: the disc\'s flag');
    /* mov rM,r1; add #imm,r1; mov.b @r1,r0; tst #bit,r0; bt */
    const [, m, imm, bit, op] = text.match(/0x0600ecd4 is `mov r(\d+),r1`, 0x0600ecd6 `add #(0x[\da-f]{2}),r1`, 0x0600ecd8\n`mov\.b @r1,r0` and 0x0600ecda `tst #(0x[\da-f]{2}),r0`, then `(b[tf])` at 0x0600ecdc\./);
    const pcW = a => (assert.equal(word(a) & 0xf000, 0x9000, `${h(a, 8)}: mov.w @(disp,pc),rN`), a + 4 + (word(a) & 0xff) * 2);
    const pcL = a => (assert.equal(word(a) & 0xf000, 0xd000, `${h(a, 8)}: mov.l @(disp,pc),rN`), (a & ~3) + 4 + (word(a) & 0xff) * 4);
    const long = a => game.prg.readUInt32BE(game.at(a));
    const bTarget = a => ((word(a) & 0xff) << 24 >> 24) * 2 + a + 4;
    assert.equal(word(0x0600ecd4), 0x6103 | (+m << 4), 'mov rM,r1');
    assert.equal(word(0x0600ecd6), 0x7100 | parseInt(imm, 16), 'add #imm,r1');
    assert.equal(word(0x0600ecd8), 0x6010, 'mov.b @r1,r0');
    assert.equal(word(at), 0xc800 | parseInt(bit, 16), 'tst #bit,r0');
    assert.equal(+m, 12, 'this fighter is r12');
    assert.ok(sides.flag.of !== 13, 'not the opponent\'s');
    const byte = parseInt(imm, 16), mask = parseInt(bit, 16) << 8 * (3 - (byte & 3));
    assert.equal(flagText(byte & ~3, mask), named, 'the byte as its long');
    const [, bb, bf, lf, lm] = text.match(/That is bit (0x[\da-f]{2}) of the byte (\+0x[\da-f]+) of this fighter \(r12\), not the\nopponent's: big-endian, the long (\+0x[\da-f]+) masked with (0x[\da-f]{8}), as "The\nflag at 0x0600ecd0" names it\./);
    assert.deepEqual([bb, bf, `${lf} & ${lm}`], [bit, `+${h(byte, 2)}`, named], 'the byte and long named');
    assert.equal(word(at + 2) & 0xff00, 0x8900, '0x0600ecdc: bt, so the branch is the clear side');
    assert.equal(op, 'bt', 'the branch named');
    assert.match(text, /The `bt` branches when the bit is clear, so\nthe branch is the clear side and the fall-through the set side\./);
    const clear = bTarget(at + 2), set = at + 4;
    assert.equal(clear, 0x0600ecfe, 'the clear side\'s target');
    /* the set side's split: mov.w; mov.w @(r0,r12),r3; mov.w; mov.w @(r0,r12),r4; cmp/gt r4,r3; bt */
    const [, l1, v1, l2, v2, ja] = text.match(/The set side's split: 0x0600ecde `mov\.w @\((0x[\da-f]{8})\),r0`, which loads\n(0x[\da-f]{4}), 0x0600ece0 `mov\.w @\(r0,r12\),r3`, 0x0600ece2\n`mov\.w @\((0x[\da-f]{8})\),r0`, which loads (0x[\da-f]{4}), 0x0600ece4\n`mov\.w @\(r0,r12\),r4`, 0x0600ece6 `cmp\/gt r4,r3` and `bt` at 0x0600ece8,\nwhich lands at (0x[\da-f]{8})\. It branches when this fighter's halfword\n\+0x4a8 is greater \(signed\) than its halfword \+0x4ac\./);
    assert.equal(word(set) & 0x0f00, 0x0000, 'into r0');
    assert.equal(pcW(set), parseInt(l1, 16));
    assert.equal(word(parseInt(l1, 16)), parseInt(v1, 16));
    assert.equal(h(word(parseInt(l1, 16)), 4), '0x04a8');
    assert.equal(word(0x0600ece0), 0x03cd, 'mov.w @(r0,r12),r3');
    assert.equal(word(0x0600ece2) & 0x0f00, 0x0000, 'into r0');
    assert.equal(pcW(0x0600ece2), parseInt(l2, 16));
    assert.equal(word(parseInt(l2, 16)), parseInt(v2, 16));
    assert.equal(h(word(parseInt(l2, 16)), 4), '0x04ac');
    assert.equal(word(0x0600ece4), 0x04cd, 'mov.w @(r0,r12),r4');
    assert.equal(word(0x0600ece6), 0x3347, 'cmp/gt r4,r3');
    const ja2 = 0x0600ece8;
    assert.equal(word(ja2) & 0xff00, 0x8900, '0x0600ece8: bt');
    const join = bTarget(ja2);
    assert.equal(join, parseInt(ja, 16), 'the split\'s target, off the disc');
    assert.equal(join, clear, 'the split lands where the clear side does');
    /* not branching: mov #imm,r0; mov.w @(r0,r12),r4; mov.l @(lit),r0; jsr @r0; then and #imm into +0x71 */
    const [, ri, cl, cv, ai] = text.match(/Not branching, it\ngoes on at 0x0600ecea `mov #(0x[\da-f]{2}),r0`, 0x0600ecec `mov\.w @\(r0,r12\),r4`,\n0x0600ecee `mov\.l @\((0x[\da-f]{8})\),r0`, which loads (0x[\da-f]{8}), and\n0x0600ecf0 `jsr @r0`, so r4 holds this fighter's halfword \+0x72 for the\ncall\. Then 0x0600ecf4 `mov r12,r1`, `add #0x71,r1`, `mov\.b @r1,r0`,\n0x0600ecfa `and #(0x[\da-f]{2}),r0` and 0x0600ecfc `mov\.b r0,@r1`: it clears bit\n0x08 of the byte \+0x71, the bit this test reads\./);
    assert.equal(word(0x0600ecea), 0xe000 | parseInt(ri, 16), 'mov #imm,r0');
    assert.equal(h(parseInt(ri, 16), 2), '0x72');
    assert.equal(word(0x0600ecec), 0x04cd, 'mov.w @(r0,r12),r4');
    assert.equal(word(0x0600ecee) & 0x0f00, 0x0000, 'into r0');
    assert.equal(pcL(0x0600ecee), parseInt(cl, 16));
    assert.equal(long(parseInt(cl, 16)), parseInt(cv, 16));
    assert.equal(word(0x0600ecf0), 0x400b, 'jsr @r0');
    assert.equal(word(0x0600ecf4), 0x61c3, 'mov r12,r1');
    assert.equal(word(0x0600ecf6), 0x7171, 'add #0x71,r1');
    assert.equal(word(0x0600ecf8), 0x6010, 'mov.b @r1,r0');
    assert.equal(word(0x0600ecfa), 0xc900 | parseInt(ai, 16), 'and #imm,r0');
    assert.equal(word(0x0600ecfc), 0x2100, 'mov.b r0,@r1');
    assert.equal(~parseInt(ai, 16) & 0xff, parseInt(bit, 16), 'it clears the bit tested');
    /* the events, split at the join */
    const before = sides.set.filter(e => e.at < join), after = sides.set.filter(e => e.at >= join);
    const [call, store] = before;
    assert.equal(before.length, 2);
    assert.deepEqual([call.kind, call.at, call.target], ['call', 0x0600ecf0, parseInt(cv, 16)], 'the call');
    assert.deepEqual([store.kind, store.at, store.field, store.size], ['store', 0x0600ecfc, byte, 1], 'the store');
    assert.deepEqual(store.values, [{ field: byte, size: 1, and: parseInt(ai, 16) }], 'the store\'s value');
    assert.equal(after.length, 1);
    const [ss] = after, [cs] = sides.clear;
    assert.equal(sides.clear.length, 1);
    assert.deepEqual([ss.kind, cs.kind], ['stop', 'stop']);
    assert.equal(ss.at, cs.at, 'both sides stop at the same test');
    assert.equal(eventFlag(ss), eventFlag(cs));
    for (const s of ['set', 'clear'])
        assert.ok(!sides[s].some(e => e.field === 0 && e.mask === 0x10000000 || ['end', 'return'].includes(e.kind)), `${s}: not +0 bit 0x10000000`);
    const stopAt = h(ss.at, 8), stopFlag = eventFlag(ss);
    const ba = 0x0600ed02, bw = word(ba);
    assert.equal(bw & 0xf000, 0xa000, '0x0600ed02: bra');
    const bTo = ((bw & 0xfff) << 20 >> 20) * 2 + ba + 4;
    assert.ok(ss.at > bTo, 'the stop is past the bra\'s target');
    assert.equal(rows[0][3], `goes on to ${h(set, 8)}; the \`bt\` at ${h(ja2, 8)} splits it at ${h(join, 8)}; calls ${h(call.target, 8)} and stores +${h(byte, 2)} only when it does not branch; stops at ${stopAt} (${stopFlag})`, 'the set cell');
    assert.equal(rows[0][4], `branches to ${h(clear, 8)}; no store or call; the \`bra\` at ${h(ba, 8)} jumps to ${h(bTo, 8)}; stops at ${stopAt} (${stopFlag})`, 'the clear cell');
    /* the bullet */
    const bullet = text.match(/^- \*\*(.+?)\*\*:([^]*?)\n\n/m), body = bullet[2].replace(/\s+/g, ' ');
    assert.equal(bullet[1], named);
    assert.equal(body, ` set, it goes on at ${h(set, 8)}, and the \`bt\` at ${h(ja2, 8)} either jumps to ${h(join, 8)} with no store or call, or goes on at ${h(ja2 + 2, 8)}, calls ${h(call.target, 8)} at ${h(call.at, 8)} and stores the byte +${h(byte, 2)} at ${h(store.at, 8)}; both paths stop at ${stopAt}; clear, it jumps to ${h(clear, 8)} with no store or call, and stops at ${stopAt}.`);
    /* the stop: a row of "The flags behind them" */
    const [, s1, f1] = text.match(/the `bra` at 0x0600ed02 jumps to 0x0600ed10\. Both sides stop at\n(0x[\da-f]{8}), which tests this fighter's \(r12\) (\+0x[\da-f]+ & 0x[\da-f]{8}); it is a\nrow in "The flags behind them", which describes its sides\./);
    assert.deepEqual([s1, f1], [stopAt, stopFlag], 'the stop named');
    assert.equal(ss.of, undefined, `${stopAt} tests r12`);
    assert.ok(behindDoc.includes(`| ${stopAt} | run | ${stopFlag} |`), `${stopAt}'s row in "The flags behind them"`);
    /* forward only: never to the 0.8 check */
    assert.ok(!FM.handlerReaches(game, run9, set, 0x0600eb9e, [ss.at]), 'set: no 0.8 check');
    assert.ok(!FM.handlerReaches(game, run9, clear, 0x0600eb9e, [cs.at]), 'clear: no 0.8 check');
    assert.ok(text.includes('Neither side\nreaches the 0.8 distance check or `+0` bit 0x10000000.'));
}
checkEcda(ecdaDoc, newDoc, ecd0Doc);
for (const [from, to] of [['`mov r12,r1`, 0x0600ecd6', '`mov r13,r1`, 0x0600ecd6'], ['`add #0x71,r1`, 0x0600ecd8', '`add #0x72,r1`, 0x0600ecd8'],
    ['`tst #0x08,r0`', '`tst #0x04,r0`'], ['then `bt` at', 'then `bf` at'],
    ['| 0x0600ecda | +0x70 & 0x00080000 |', '| 0x0600ecda | +0x70 & 0x00000800 |'], ['| 0x0600ecda | +0x70 & 0x00080000 |', '| 0x0600ecda | +0x74 & 0x00080000 |'],
    ['| 0x0600ecda | +0x70 & 0x00080000 |', '| 0x0600ecda | the opponent\'s +0x70 & 0x00080000 |'],
    ['bit 0x08 of the byte +0x71', 'bit 0x10 of the byte +0x71'], ['of the byte +0x71 of this', 'of the byte +0x70 of this'],
    ['the long +0x70 masked', 'the long +0x74 masked'], ['with 0x00080000, as', 'with 0x00000800, as'],
    ['fighter (r12), not the', 'fighter (r13), not the'],
    ['so\nthe branch is the clear side and the fall-through the set side', 'so\nthe branch is the set side and the fall-through the clear side'],
    ['| goes on to 0x0600ecde;', '| goes on to 0x0600ecfe;'], ['the `bt` at 0x0600ece8 splits it at 0x0600ecfe;', 'the `bt` at 0x0600ece8 splits it at 0x0600ecfc;'],
    ['calls 0x060131d0 and stores +0x71 only', 'calls 0x060131d4 and stores +0x71 only'], ['and stores +0x71 only', 'and stores +0x70 only'],
    ['| branches to 0x0600ecfe;', '| branches to 0x0600ecde;'], ['jumps to 0x0600ed10; stops at 0x0600ed16 (+0x00 & 0x00000020) |\n', 'jumps to 0x0600ed12; stops at 0x0600ed16 (+0x00 & 0x00000020) |\n'],
    ['stops at 0x0600ed16 (+0x00 & 0x00000020) | branches', 'stops at 0x0600ed16 (+0x00 & 0x00000040) | branches'],
    ['(+0x00 & 0x00000020) |\n', '(+0x00 & 0x00000040) |\n'], ['; no store or call; the `bra`', '; stores +0x71; the `bra`'],
    ['set, it goes on at 0x0600ecde', 'set, it goes on at 0x0600ecfe'], ['either jumps to 0x0600ecfe with', 'either jumps to 0x0600ecde with'],
    ['or goes on\n  at 0x0600ecea', 'or goes on\n  at 0x0600ecec'], ['calls 0x060131d0 at 0x0600ecf0', 'calls 0x060131d0 at 0x0600ecf2'],
    ['stores the byte +0x71\n  at 0x0600ecfc', 'stores the byte +0x71\n  at 0x0600ecfa'], ['both paths stop at 0x0600ed16', 'both paths stop at 0x0600ed40'],
    ['clear, it jumps to\n  0x0600ecfe', 'clear, it jumps to\n  0x0600ecde'], ['and stops at 0x0600ed16.\n', 'and stops at 0x0600ed40.\n'],
    ['0x0600ecde `mov.w @(0x0600ed08),r0`', '0x0600ecde `mov.w @(0x0600ed0a),r0`'], ['which loads\n0x04a8', 'which loads\n0x04ac'],
    ['`mov.w @(r0,r12),r3`', '`mov.l @(r0,r12),r3`'], ['`mov.w @(0x0600ed0a),r0`, which loads 0x04ac', '`mov.w @(0x0600ed08),r0`, which loads 0x04ac'],
    ['which loads 0x04ac, 0x0600ece4', 'which loads 0x04a8, 0x0600ece4'], ['`cmp/gt r4,r3`', '`cmp/gt r3,r4`'],
    ['which lands at 0x0600ecfe.', 'which lands at 0x0600ecfc.'], ['halfword\n+0x4a8 is greater', 'halfword\n+0x4ac is greater'],
    ['`mov #0x72,r0`', '`mov #0x74,r0`'], ['`mov.l @(0x0600ed0c),r0`', '`mov.l @(0x0600ed08),r0`'], ['which loads 0x060131d0, and', 'which loads 0x060131d4, and'],
    ['halfword +0x72 for the', 'halfword +0x74 for the'], ['`and #0xf7,r0`', '`and #0xfb,r0`'],
    ['Both sides stop at\n0x0600ed16', 'Both sides stop at\n0x0600ed40'], ['(r12) +0x00 & 0x00000020; it is a', '(r12) +0x00 & 0x00000040; it is a']]) {
    assert.ok(ecdaDoc.includes(from), from);
    assert.throws(() => checkEcda(ecdaDoc.replace(from, to), newDoc, ecd0Doc), `${from} -> ${to}`);
}
/* the list's row, or "The flag at 0x0600ecd0", naming another field or mask fails too */
assert.throws(() => checkEcda(ecdaDoc, newDoc.replace('| 0x0600ecda | this fighter (r12) | +0x70 | 0x00080000 |', '| 0x0600ecda | this fighter (r12) | +0x70 | 0x00040000 |')));
assert.throws(() => checkEcda(ecdaDoc, newDoc.replace('| 0x0600ecda | this fighter (r12) | +0x70 | 0x00080000 |', '| 0x0600ecda | this fighter (r12) | +0x74 | 0x00080000 |')));
assert.throws(() => checkEcda(ecdaDoc, newDoc, ecd0Doc.replace('fighter\'s (r12) +0x70 & 0x00080000', 'fighter\'s (r12) +0x70 & 0x00040000')));
/* The flag at 0x0600f008: the next row of the list. The byte +0x11d5 of r12
 * through a mov.w literal; a bt, so the branch is the clear side. The set
 * side flips a bit of +0x1a and goes on where the clear side lands; from
 * there both make the same stores and end this frame's run */
const f008Doc = kindsDoc.split('#### The flag at 0x0600f008\n\n')[1].split('\n#### ')[0].split('\n### ')[0];
function checkF008(text, list) {
    const at = 0x0600f008, sides = FM.flagSides(game, run9, at);
    const listed = list.match(/^\| 0x0600f008 \| this fighter \(r12\) \| (\+0x[\da-f]+) \| (0x[\da-f]{8}) \|$/m);
    assert.ok(listed, '0x0600f008\'s row in "Flag tests not yet described"');
    const named = `${listed[1]} & ${listed[2]}`;
    const rows = [...text.matchAll(new RegExp(String.raw`^\| (0x[\da-f]{8}) \| (${FLAG}) \| (.*?) \| (.*?) \|$`, 'gm'))];
    assert.deepEqual(rows.map(r => [r[1], r[2]]), [['0x0600f008', named]]);
    assert.equal(eventFlag(sides.flag), named, '0x0600f008: the disc\'s flag');
    const pcW = a => (assert.equal(word(a) & 0xf000, 0x9000, `${h(a, 8)}: mov.w @(disp,pc),rN`), a + 4 + (word(a) & 0xff) * 2);
    const pcL = a => (assert.equal(word(a) & 0xf000, 0xd000, `${h(a, 8)}: mov.l @(disp,pc),rN`), (a & ~3) + 4 + (word(a) & 0xff) * 4);
    const long = a => game.prg.readUInt32BE(game.at(a));
    const bTarget = a => ((word(a) & 0xff) << 24 >> 24) * 2 + a + 4;
    /* mov rM,r1; mov.w @(lit),r0; add r0,r1; mov.b @r1,r0; tst #bit,r0; bt */
    const [, m, lit, off, bit, op] = text.match(/0x0600f000 is `mov r(\d+),r1`, 0x0600f002 `mov\.w @\((0x[\da-f]{8})\),r0`,\nwhich loads (0x[\da-f]{4}), 0x0600f004 `add r0,r1`, 0x0600f006 `mov\.b @r1,r0` and\n0x0600f008 `tst #(0x[\da-f]{2}),r0`, then `(b[tf])` at 0x0600f00a\./);
    assert.equal(word(0x0600f000), 0x6103 | (+m << 4), 'mov rM,r1');
    assert.equal(+m, 12, 'this fighter is r12');
    assert.equal(word(0x0600f002) & 0x0f00, 0x0000, 'into r0');
    assert.equal(pcW(0x0600f002), parseInt(lit, 16), 'the literal\'s address');
    assert.equal(word(parseInt(lit, 16)), parseInt(off, 16), 'the literal');
    assert.equal(word(0x0600f004), 0x310c, 'add r0,r1');
    assert.equal(word(0x0600f006), 0x6010, 'mov.b @r1,r0');
    assert.equal(word(at), 0xc800 | parseInt(bit, 16), 'tst #bit,r0');
    assert.ok(sides.flag.of !== 13, 'not the opponent\'s');
    const byte = parseInt(off, 16), mask = parseInt(bit, 16) << 8 * (3 - (byte & 3));
    assert.equal(flagText(byte & ~3, mask), named, 'the byte as its long');
    const [, bb, bf, lf, lm] = text.match(/That is bit (0x[\da-f]{2}) of\nthe byte (\+0x[\da-f]+) of this fighter \(r12\), not the opponent's: big-endian,\nthe long (\+0x[\da-f]+) masked with (0x[\da-f]{8})\./);
    assert.deepEqual([bb, bf, `${lf} & ${lm}`], [bit, `+${h(byte, 2)}`, named], 'the byte and long named');
    assert.equal(word(at + 2) & 0xff00, 0x8900, '0x0600f00a: bt, so the branch is the clear side');
    assert.equal(op, 'bt', 'the branch named');
    assert.match(text, /The `bt` branches when the bit\nis clear, so the branch is the clear side and the fall-through the set\nside\./);
    const clear = bTarget(at + 2), set = at + 4;
    assert.equal(clear, 0x0600f016, 'the clear side\'s target');
    /* the set side's store: mov r12,r1; add #imm,r1; mov.b @r1,r0; xor #imm,r0; mov.b r0,@r1 */
    const [, sImm, xImm] = text.match(/The set side's store: 0x0600f00c `mov r12,r1`, 0x0600f00e `add #(0x[\da-f]{2}),r1`,\n0x0600f010 `mov\.b @r1,r0`, 0x0600f012 `xor #(0x[\da-f]{2}),r0` and 0x0600f014\n`mov\.b r0,@r1`: it flips bit \2 of this fighter's byte \+\1\./);
    assert.equal(word(0x0600f00c), 0x61c3, 'mov r12,r1');
    assert.equal(word(0x0600f00e), 0x7100 | parseInt(sImm, 16), 'add #imm,r1');
    assert.equal(word(0x0600f010), 0x6010, 'mov.b @r1,r0');
    assert.equal(word(0x0600f012), 0xca00 | parseInt(xImm, 16), 'xor #imm,r0');
    assert.equal(word(0x0600f014), 0x2100, 'mov.b r0,@r1');
    const own = sides.set.filter(e => e.at < clear), shared = sides.set.filter(e => e.at >= clear);
    assert.equal(own.length, 1);
    assert.deepEqual([own[0].kind, own[0].at, own[0].field, own[0].size, own[0].of], ['store', 0x0600f014, parseInt(sImm, 16), 1, undefined], 'the set side\'s store');
    assert.deepEqual(own[0].values, [null], 'flagSides does not follow the xor');
    assert.deepEqual(shared, sides.clear, 'from 0x0600f016 the two sides match');
    /* the shared run: stores only, then the end */
    const end = sides.clear.at(-1), stores = sides.clear.slice(0, -1);
    assert.deepEqual([end.kind, end.at], ['end', 0x0600f3f6]);
    assert.equal(word(end.at), 0x4e2b, 'jmp @r14');
    assert.ok(stores.every(e => e.kind === 'store' && e.of === undefined && e.values.length === 1), 'stores of r12 only');
    const ba = 0x0600f0a0, bw = word(ba);
    assert.equal(bw & 0xf000, 0xa000, '0x0600f0a0: bra');
    assert.equal(((bw & 0xfff) << 20 >> 20) * 2 + ba + 4, end.at, 'the bra jumps to the end');
    assert.ok(stores.every(e => e.at < ba), 'the stores come before the bra');
    /* the first store's value: the long +0x6c0 ORed with a mov.l literal */
    const [, oLit, oVal] = text.match(/From 0x0600f016 both sides run the same code\. 0x0600f016\n`mov\.l @\((0x[\da-f]{8})\),r2` loads (0x[\da-f]{8}), 0x0600f01c `or r2,r3` and\n0x0600f020 `mov\.l r3,@\(r0,r12\)` store the long \+0x6c0 ORed with it\./);
    assert.equal(word(0x0600f016) & 0x0f00, 0x0200, 'into r2');
    assert.equal(pcL(0x0600f016), parseInt(oLit, 16));
    assert.equal(long(parseInt(oLit, 16)), parseInt(oVal, 16), 'the literal ORed in');
    assert.equal(word(0x0600f018) & 0x0f00, 0x0000, 'into r0');
    assert.equal(word(0x0600f01a), 0x03ce, 'mov.l @(r0,r12),r3');
    assert.equal(word(0x0600f01c), 0x232b, 'or r2,r3');
    assert.equal(word(0x0600f01e) & 0x0f00, 0x0000, 'into r0');
    assert.equal(pcW(0x0600f018), pcW(0x0600f01e), 'the same field read and stored');
    assert.equal(word(0x0600f020), 0x0c36, 'mov.l r3,@(r0,r12)');
    const [first, ...rest] = stores;
    assert.deepEqual([first.at, first.field, first.size, first.values], [0x0600f020, word(pcW(0x0600f018)), 4, [null]], 'the +0x6c0 store');
    /* the rest, one clause each from the fresh read */
    const SIZE = { 1: 'byte', 2: 'halfword', 4: 'long' }, f = v => `the ${SIZE[v.size]} +0x${v.field.toString(16)}`;
    const value = v => v.quot ? `the divide unit's quotient of ${value(v.quot.less[0])}, less ${value(v.quot.less[1])}, over ${value(v.by)},`
        : v.plus === -1 ? `${f(v)} less one` : v.plus !== undefined ? `${f(v)} plus ${h(v.plus, 8)}`
        : v.and !== undefined ? `${f(v)} ANDed with ${h(v.and, 2)}` : v.or !== undefined ? `${f(v)} ORed with ${h(v.or, 2)}`
        : (assert.deepEqual(Object.keys(v), ['field', 'size']), f(v));
    const clauses = rest.map(e => `at ${h(e.at, 8)} ${value(e.values[0])} in ${f(e)}`);
    const [, said] = text.match(/ store the long \+0x6c0 ORed with it\. Then:\n([^]*?)\. All are this fighter's\n\(r12\)\. The `bra` at 0x0600f0a0 jumps to 0x0600f3f6, the run handler's\n`jmp @r14`\. Neither side calls anything or stops at another flag test,\nand neither reaches the 0\.8 distance check or `\+0` bit 0x10000000\./);
    assert.equal(said.replace(/\s+/g, ' '), clauses.join('; '), 'the shared stores');
    for (const s of ['set', 'clear'])
        assert.ok(!sides[s].some(e => ['call', 'stop', 'same', 'param', 'return'].includes(e.kind) || e.field === 0 && e.mask === 0x10000000), `${s}: no call or stop`);
    assert.ok(!FM.handlerReaches(game, run9, set, 0x0600eb9e, [end.at]), 'set: no 0.8 check');
    assert.ok(!FM.handlerReaches(game, run9, clear, 0x0600eb9e, [end.at]), 'clear: no 0.8 check');
    /* the table cells */
    const fields = [...new Set(stores.map(e => `+${h(e.field, 2)}`))], and = a => a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a.at(-1)}` : a[0];
    const ends = `ends this frame's run (${h(end.at, 8)})`;
    assert.equal(rows[0][3], `goes on to ${h(set, 8)}; stores +${h(own[0].field, 2)} (${h(own[0].at, 8)}); goes on to ${h(clear, 8)} and from there does what the clear side does; ${ends}`, 'the set cell');
    assert.equal(rows[0][4], `branches to ${h(clear, 8)}; stores ${and(fields)}; no call; the \`bra\` at ${h(ba, 8)} jumps to ${h(end.at, 8)}; ${ends}`, 'the clear cell');
    /* the bullet */
    const bullet = text.match(/^- \*\*(.+?)\*\*:([^]*?)\n\n/m), body = bullet[2].replace(/\s+/g, ' ');
    assert.equal(bullet[1], named);
    assert.equal(body, ` set, it goes on at ${h(set, 8)}, stores the byte +${h(own[0].field, 2)} at ${h(own[0].at, 8)} and goes on at ${h(clear, 8)}; clear, it jumps to ${h(clear, 8)}. From there both sides make the same stores, call nothing, and end this frame's run at ${h(end.at, 8)}.`);
}
checkF008(f008Doc, newDoc);
for (const [from, to] of [['`mov r12,r1`, 0x0600f002', '`mov r13,r1`, 0x0600f002'], ['`mov.w @(0x0600f0a6),r0`', '`mov.w @(0x0600f0a4),r0`'],
    ['which loads 0x11d5', 'which loads 0x11d4'], ['`tst #0x10,r0`', '`tst #0x20,r0`'], ['then `bt` at', 'then `bf` at'],
    ['| 0x0600f008 | +0x11d4 & 0x00100000 |', '| 0x0600f008 | +0x11d4 & 0x00001000 |'], ['| 0x0600f008 | +0x11d4 & 0x00100000 |', '| 0x0600f008 | +0x11d0 & 0x00100000 |'],
    ['| 0x0600f008 | +0x11d4 & 0x00100000 |', '| 0x0600f008 | the opponent\'s +0x11d4 & 0x00100000 |'],
    ['That is bit 0x10 of', 'That is bit 0x20 of'], ['the byte +0x11d5 of this', 'the byte +0x11d4 of this'],
    ['the long +0x11d4 masked', 'the long +0x11d0 masked'], ['with 0x00100000. The', 'with 0x00001000. The'],
    ['fighter (r12), not the opponent\'s: big', 'fighter (r13), not the opponent\'s: big'],
    ['clear, so the branch is the clear side and the fall-through the set', 'clear, so the branch is the set side and the fall-through the clear'],
    ['| goes on to 0x0600f00c;', '| goes on to 0x0600f016;'], ['stores +0x1a (0x0600f014)', 'stores +0x1b (0x0600f014)'], ['stores +0x1a (0x0600f014)', 'stores +0x1a (0x0600f012)'],
    ['goes on to 0x0600f016 and from there', 'goes on to 0x0600f018 and from there'],
    ['does; ends this frame\'s run (0x0600f3f6) |', 'does; ends this frame\'s run (0x0600f3f8) |'],
    ['| branches to 0x0600f016;', '| branches to 0x0600f00c;'], ['stores +0x6c0, +0x6c8,', 'stores +0x6c4, +0x6c8,'], ['+0x6e8 and +0x6f8; no call', '+0x6e8; no call'],
    ['+0x6e8 and +0x6f8; no call', '+0x6e8 and +0x6f8; calls 0x060131d0'],
    ['the `bra` at 0x0600f0a0 jumps to 0x0600f3f6;', 'the `bra` at 0x0600f0a2 jumps to 0x0600f3f6;'],
    ['set, it goes on at 0x0600f00c', 'set, it goes on at 0x0600f016'], ['stores the\n  byte +0x1a at 0x0600f014', 'stores the\n  byte +0x1b at 0x0600f014'],
    ['clear, it jumps to\n  0x0600f016', 'clear, it jumps to\n  0x0600f00c'], ['call nothing,\n  and end', 'call 0x060131d0,\n  and end'],
    ['run at 0x0600f3f6.\n', 'run at 0x0600f3f8.\n'],
    ['0x0600f00e `add #0x1a,r1`', '0x0600f00e `add #0x1b,r1`'], ['`xor #0x80,r0`', '`xor #0x40,r0`'], ['flips bit 0x80', 'flips bit 0x40'],
    ['`mov.l @(0x0600f0c4),r2` loads 0x02800000', '`mov.l @(0x0600f0c8),r2` loads 0x02800000'], ['loads 0x02800000', 'loads 0x02000000'],
    ['at 0x0600f030 the long +0x20 in the long +0x6c8', 'at 0x0600f030 the long +0x24 in the long +0x6c8'],
    ['at 0x0600f034 the long +0x28 in the long +0x6d0', 'at 0x0600f034 the long +0x28 in the long +0x6d4'],
    ['the byte +0x33 ANDed with 0xf7', 'the byte +0x33 ANDed with 0xfb'], ['the halfword +0x63c in', 'the long +0x63c in'],
    ['halfword +0x6c6 less one', 'halfword +0x6c6 plus one'], ['+0x6c2 ORed with 0x10', '+0x6c2 ORed with 0x20'],
    ['at 0x0600f068 the long +0x658\nplus 0x0002b333', 'at 0x0600f068 the long +0x658\nplus 0x0002b334'], ['at\n0x0600f07c the long +0x14', 'at\n0x0600f07e the long +0x14'],
    ['quotient of the long +0x658', 'quotient of the long +0x65c'], ['less the long +0x10,\nover', 'less the long +0x14,\nover'], ['over the halfword +0x646', 'over the halfword +0x648'],
    ['in the long +0x6f8.', 'in the long +0x6fc.'], ['Neither side calls anything or stops', 'The set side calls 0x060131d0 and neither side stops']]) {
    assert.ok(f008Doc.includes(from), from);
    assert.throws(() => checkF008(f008Doc.replace(from, to), newDoc), `${from} -> ${to}`);
}
/* the list's row naming another field or mask fails too */
assert.throws(() => checkF008(f008Doc, newDoc.replace('| 0x0600f008 | this fighter (r12) | +0x11d4 | 0x00100000 |', '| 0x0600f008 | this fighter (r12) | +0x11d4 | 0x00200000 |')));
assert.throws(() => checkF008(f008Doc, newDoc.replace('| 0x0600f008 | this fighter (r12) | +0x11d4 | 0x00100000 |', '| 0x0600f008 | this fighter (r12) | +0x11d0 | 0x00100000 |')));
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
