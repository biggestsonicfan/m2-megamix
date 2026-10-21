/* CPU against CPU, every pairing, on each game's arena: the fight runs,
 * blows land, rounds end. */
import assert from 'node:assert/strict';
import { loadNodeGames } from './node-roms.mjs';
import { ROSTER } from '../js/games.js';
import { makeFighter } from '../js/fighters.js';
import { createFight, stepFight, cpuPad } from '../js/engine.js';

const games = await loadNodeGames();
let seed = 12345;
const rng = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const FRAMES = Number(process.env.FRAMES ?? 3600);
const total = { hit: 0, guard: 0, throw: 0, move: 0, ringout: 0, rounds: 0 };
const arenas = ['vf2', 'fv', 'stf'];
let n = 0;
for (let i = 0; i < ROSTER.length; i++) {
    for (let j = 0; j < ROSTER.length; j++) {
        const fight = createFight(makeFighter(games, ROSTER[i]), makeFighter(games, ROSTER[j]), arenas[n++ % 3]);
        const seen = { hit: 0, guard: 0, throw: 0, move: 0, ringout: 0 };
        let rounds = 0;
        for (let t = 0; t < FRAMES && fight.phase !== 'over'; t++) {
            const before = fight.round;
            stepFight(fight, fight.players.map((p) => cpuPad(fight, p, rng)));
            if (fight.round !== before) rounds++;
            for (const e of fight.events) if (e.kind in seen) seen[e.kind]++;
            for (const p of fight.players) {
                assert.ok(p.pos.every(Number.isFinite), `${p.fighter.name} position`);
                assert.ok(p.posed.mats.every((m) => m.every(Number.isFinite)), `${p.fighter.name} pose`);
            }
        }
        if (fight.phase === 'over') rounds++;
        for (const k in seen) total[k] += seen[k];
        total.rounds += rounds;
        const [a, b] = fight.players;
        console.log(`${a.fighter.name.padEnd(6)} vs ${b.fighter.name.padEnd(6)} ${fight.arena === undefined ? '' : ''}`,
            JSON.stringify(seen), 'rounds', rounds, 'wins', a.wins, b.wins, fight.phase);
    }
}
console.log('total', JSON.stringify(total));
assert.ok(total.hit > 100, 'blows land');
assert.ok(total.guard > 10, 'blows are guarded');
assert.ok(total.throw > 5, 'throws happen');
assert.ok(total.rounds > 40, 'rounds end');
console.log('ok');
