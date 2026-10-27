/* Every fighter loads, poses its actions, and reads its moves and attacks;
 * one game's throw victim motion poses on another game's body. */
import assert from 'node:assert/strict';
import { loadNodeGames } from './node-roms.mjs';
import { ROSTER } from '../js/games.js';
import { makeFighter } from '../js/fighters.js';

const games = await loadNodeGames();
const fighters = ROSTER.map((e) => makeFighter(games, e));
/* StF's Egg UFO is a craft, not a body: eight parts. */
const FEW_PARTS = { 'EGG UFO': 8 };
const ACTS = ['stance', 'crouch', 'guard', 'walkF', 'walkB', 'dashF', 'jump', 'down', 'rise'];

for (const f of fighters) {
    const body = f.createBody();
    for (const a of ACTS) {
        const ref = f.act(a);
        assert.ok(ref.motion, `${f.name} ${a}`);
        const p = body.pose(ref, 1);
        assert.equal(p.mats.length, 16);
        /* Ryo's model is one skin over the sixteen slots; the rest are parts. */
        if (p.parts[0]?.skin) assert.ok(p.parts[0].skin.positions.length === body.skin.count * 3, `${f.name} ${a} skin`);
        else assert.ok(p.parts.length >= (FEW_PARTS[f.name] ?? 10), `${f.name} ${a} parts ${p.parts.length}`);
        for (const part of p.parts) if (part.key != null) assert.ok(body.decode(part.key), `${f.name} model ${part.key}`);
    }
    const entries = f.moves.tables.get(f.moves.root);
    const strikes = [], throws = [];
    for (const e of entries) {
        const a = f.attack(e.motion & 0x1fff);
        if (a?.victim != null) throws.push(e.motion & 0x1fff); else if (a) strikes.push(a);
    }
    const head = f.act('stance').motion;
    const top = head.frames;
    const y = p0(body, f, head);
    console.log(f.game, f.name.padEnd(7), 'root entries', entries.length, 'strikes', strikes.length, 'throws', throws.length,
        'stance frames', top, 'head y', y.toFixed(2),
        'dmg', strikes.slice(0, 6).map((a) => `${a.level ?? '?'}:${a.damage}`).join(' '));
    assert.ok(strikes.length > 3, `${f.name} strikes`);
}

function p0(body, f, motion) {
    return body.pose({ rom: f.rom, motion }, 1).mats[2][13];
}

/* Cross-game: Akira's first throw on Sonic, Sonic's on Mahler. */
for (const [a, v] of [[0, 6], [6, 5], [3, 8]]) {
    const att = fighters[a], vic = fighters[v];
    const entry = [...att.moves.tables.values()].flat().find((e) => att.attack(e.motion & 0x1fff)?.victim != null);
    assert.ok(entry, `${att.name} has a throw`);
    const victim = att.attack(entry.motion & 0x1fff).victim;
    const body = vic.createBody();
    const ref = { rom: att.rom, motion: (await import('../js/fighters.js')).motionOf(att.rom, victim) };
    assert.ok(ref.motion, 'victim motion decodes');
    const p = body.pose(ref, Math.floor(ref.motion.frames / 2));
    assert.ok(p.mats.every((m) => m.every(Number.isFinite)));
    console.log('throw', att.name, '->', vic.name, 'victim motion', victim, 'frames', ref.motion.frames);
}

/* Reactions across games. */
for (const [a, v] of [[0, 3], [6, 0], [3, 6], [3, 4]]) {
    const att = fighters[a], vic = fighters[v];
    const entry = f0(att);
    const at = { ...att.attack(entry), game: att.game, level: 1 };
    for (const how of ['hit', 'guard', 'down']) {
        const r = vic.reaction(at, how);
        assert.ok(r?.motion, `${vic.name} ${how} reaction to ${att.name}`);
    }
}
function f0(f) {
    return [...f.moves.tables.get(f.moves.root)].map((e) => e.motion & 0x1fff).find((id) => f.attack(id)?.level !== undefined && f.attack(id)?.victim == null);
}
/* Ryo (with the Shenmue disc): 5'9" to Akira's 5'11", and his throw on Akira. */
const ryo = fighters.find((f) => f.name === 'RYO');
if (ryo) {
    const { ryoFit, SIZE } = await import('../js/ryo.js');
    const fit = ryoFit(games);
    assert.ok(Math.abs(fit.ryo / fit.akira - 69 / 71) < 0.002, `Ryo's height ${fit.ryo} to Akira's ${fit.akira}`);
    assert.equal(ryo.size, SIZE);
    const entry = [...ryo.moves.tables.values()].flat().find((e) => ryo.attack(e.motion)?.victim != null);
    assert.ok(entry, 'Ryo has a throw');
    const ref = { rom: ryo.rom, motion: ryo.motion(ryo.attack(entry.motion).victim) };
    const p = fighters[0].createBody().pose(ref, Math.floor(ref.motion.frames / 2));
    assert.ok(p.mats.every((m) => m.every(Number.isFinite)));
    console.log('Ryo', fit.ryo.toFixed(3), 'to Akira', fit.akira.toFixed(3), 'throw', entry.name);
} else console.log('Ryo skipped: no Shenmue disc');
/* Chai (disc 3's ending fight): his own bank and script, sized by his model
 * to Ryo's, his throws and strikes his. */
const chai = fighters.find((f) => f.name === 'CHAI');
if (chai) {
    const { shenmueFit, SIZE, restHeight } = await import('../js/ryo.js');
    const c = games.shenmue.chars.CHAI;
    const fit = shenmueFit(games, c);
    const want = SIZE * restHeight(c.fullModel) / restHeight(games.shenmue.chars.RYO.model);
    assert.ok(Math.abs(fit.ryo / fit.akira - want) < 0.002, `Chai's height ${fit.ryo} to Akira's ${fit.akira}`);
    const all = [...chai.moves.tables.values()].flat();
    const own = all.filter((e) => (e.motion & 0x1fff) >= c.bank.base);
    assert.ok(own.length > 10, `Chai's moves from his bank: ${own.length}`);
    const throws = all.filter((e) => chai.attack(e.motion)?.victim != null);
    assert.ok(throws.length, 'Chai has a throw');
    const ref = { rom: chai.rom, motion: chai.motion(chai.attack(throws[0].motion).victim) };
    assert.ok(ref.motion, 'his throw\'s victim motion');
    const p = fighters[0].createBody().pose(ref, Math.floor(ref.motion.frames / 2));
    assert.ok(p.mats.every((m) => m.every(Number.isFinite)));
    assert.equal(chai.act('stance').motion.id, 0x800);
    const b = chai.createBody().pose(chai.act('stance'), 0);
    assert.ok(b.mats.every((m) => m.every(Number.isFinite)));
    console.log('Chai', fit.ryo.toFixed(3), 'to Akira', fit.akira.toFixed(3), 'moves', all.length, 'his own', own.length,
        'throws', throws.map((e) => e.name).join(' '));
} else console.log('Chai skipped: no Shenmue disc');
console.log('ok');
