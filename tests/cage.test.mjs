/* FV's cage break: a finishing KO into a wall breaks that side, it stays
 * broken for the match, and anyone past it is out. Mahler breaks it, and
 * others break it on him (js/engine.js, the cage break). */
import assert from 'node:assert/strict';
import { loadNodeGames } from './node-roms.mjs';
import { ROSTER } from '../js/games.js';
import { makeFighter, FWD, BACK, DOWN, UP, P, K, G } from '../js/fighters.js';
import { createFight, stepFight, wallSide, bodyPoint } from '../js/engine.js';

const OP_BRANCH = 0x28;
const games = await loadNodeGames();
const fighter = (name, game) => makeFighter(games, ROSTER.find((e) => e.name === name && (!game || e.game === game)));

/* A one-press move's input, a pad a frame: its stick states oldest first,
 * then the buttons on the last (js/moves.js entryDirections). */
function padsFor(e, facingRight) {
    const seq = [];
    for (let i = e.dirs.length - 1; i >= 0; i--) {
        if (e.dirs[i].op === OP_BRANCH && !e.dirs[i].mask) continue;
        const d = e.dirs[i].mask & 0xf0;
        if (seq[seq.length - 1] !== d) seq.push(d);
    }
    if (!seq.length) seq.push(0);
    const pad = (d) => ({
        right: Boolean(d & (facingRight ? FWD : BACK)), left: Boolean(d & (facingRight ? BACK : FWD)),
        down: Boolean(d & DOWN), up: Boolean(d & UP),
    });
    const out = [];
    for (const d of seq) out.push(pad(d), pad(d));
    const btn = e.key & 7;
    out.push({ ...pad(seq[seq.length - 1]), P: Boolean(btn & P), K: Boolean(btn & K), G: Boolean(btn & G) }, {});
    return out;
}

/* The first standing one-press move of `f` that `pick(attack)` takes. */
function moveOf(f, pick) {
    const mv = f.moves.moves.find((m) => m.reachable && m.steps.length === 1 && !(m.entry.key >> 8)
        && pick(f.attack(m.motion & 0x1fff)));
    assert.ok(mv, `${f.name}: a move`);
    return mv.entry;
}

/* Attacker (P1) at x 3.6 facing +x, the other at 5.0 with 1 energy: type the
 * move and run out the KO. */
function finishAtWall(f1, f2, entry) {
    const fight = createFight(f1, f2, 'fv');
    fight.phase = 'fight';
    const [a, b] = fight.players;
    a.pos = [3.6, 0, 0]; a.yang = 0;
    b.pos = [5.0, 0, 0]; b.yang = Math.PI;
    b.energy = 1;
    const script = padsFor(entry, true);
    const seen = [];
    let far = -Infinity;
    for (let t = 0; t < 240 && fight.phase !== 'ready'; t++) {
        stepFight(fight, [script[t] ?? {}, {}]);
        seen.push(...fight.events);
        if (fight.phase === 'ko') far = Math.max(far, bodyPoint(b)[0]);
    }
    return { fight, seen, far };
}

/* Mahler's cage breakers: his own and those he shares with the cast. */
const mahler = fighter('MAHLER', 'fv'), honey = fighter('HONEY', 'fv'), sonic = fighter('SONIC', 'stf');
const breakers = mahler.moves.moves.filter((m) => mahler.attack(m.motion & 0x1fff)?.finish === 3).map((m) => m.motion & 0x1fff);
console.log('Mahler, finish kind 3:', breakers.join(' '));
for (const id of [676, 866, 867, 868, 570]) assert.ok(breakers.includes(id), `Mahler ${id} breaks the cage`);

/* A KO without a finish (his jab: kind 0) leaves the wall. */
{
    const jab = moveOf(mahler, (a) => a && a.victim == null && !a.finish);
    const { fight, seen } = finishAtWall(mahler, honey, jab);
    assert.ok(seen.some((e) => e.kind === 'hit'), 'the jab lands');
    assert.equal(fight.broken.size, 0, 'no break without a finish');
}

/* Mahler's finish breaks +x, and it stays broken: next round Honey backs
 * out through it. */
{
    const fin = moveOf(mahler, (a) => a?.finish === 3);
    const { fight, seen, far } = finishAtWall(mahler, honey, fin);
    console.log('Mahler', fin.motion & 0x1fff, seen.filter((e) => e.kind !== 'move').map((e) => e.kind).join(' '));
    const brk = seen.find((e) => e.kind === 'cagebreak');
    assert.ok(brk, 'Mahler breaks the cage');
    assert.equal(brk.wall, wallSide(1, 0), 'the +x side');
    const [a, b] = fight.players;
    assert.ok(far > 6, `Honey goes on through it (x ${far.toFixed(2)})`);
    for (let t = 0; t < 400 && fight.phase !== 'fight'; t++) stepFight(fight, [{}, {}]);
    assert.equal(fight.round, 2);
    assert.ok(fight.broken.has(3), 'still broken in round 2');
    let out = null;
    for (let t = 0; t < 1200 && !out; t++) {
        stepFight(fight, [{}, { right: true }]);
        out = fight.events.find((e) => e.kind === 'ringout');
    }
    assert.ok(out && out.side === 1, 'Honey is out past the broken side');
    for (let t = 0; t < 5 && fight.message !== 'RING OUT'; t++) stepFight(fight, [{}, {}]);
    assert.equal(fight.message, 'RING OUT');
    assert.equal(a.wins, 2, 'Mahler takes the match');

    /* the sides still standing are walls: -x holds */
    const f2 = createFight(mahler, honey, 'fv');
    f2.phase = 'fight';
    f2.broken.add(3);
    f2.players[0].pos = [-5.9, 0, 0];
    for (let t = 0; t < 60; t++) stepFight(f2, [{ left: true }, {}]);
    assert.ok(f2.players[0].pos[0] > -6, 'the -x wall holds');
    assert.ok(!f2.players[0].ringOut);
}

/* The others break it on Mahler: an FV fighter by her kind 3, Sonic (no
 * finish kinds) by a heavy blow. */
for (const [f, pick] of [[honey, (a) => a?.finish === 3], [sonic, (a) => a && a.victim == null && a.damage >= 30]]) {
    const mv = moveOf(f, pick);
    const { fight, seen } = finishAtWall(f, mahler, mv);
    console.log(f.name, mv.motion & 0x1fff, seen.filter((e) => e.kind !== 'move').map((e) => e.kind).join(' '));
    assert.ok(seen.some((e) => e.kind === 'cagebreak'), `${f.name} breaks the cage on Mahler`);
    assert.ok(fight.broken.has(3));
}
console.log('ok');
