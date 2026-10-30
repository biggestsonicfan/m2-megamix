/*
 * One two-player battle on the browser build (js/engine.js), logged as
 * tools/mame/battle.lua logs a source game's: the same seeded input script
 * from each round's start, both fighters every frame. tools/grade/grade-battle.mjs
 * compares the log with the source's (docs/GRADING.md).
 *
 *   node tools/grade/js-battle.mjs --game vf2 --p1 4 --p2 4 [--stage 0] [--seed 1]
 *     [--time 30] [--wins 2] [--lead 30] [--frames 20000] > trace.txt
 *
 * --game    the fighters' game: vf2, fv or stf; the fight is on its arena.
 * --p1/p2   the game's own numbers, as battle.lua's BT_P1/BT_P2 (VF2's and
 *           FV's record numbers, StF's character numbers).
 * --stage   only logged (the engine fights on the game's arena).
 * --time    the round's clock in seconds (the source's: VF2 and FV 30 as
 *           battle.lua sets them, StF's own 30); --wins the rounds to win.
 *
 * Frame k of a round is the k-th step from the one its fight starts on
 * (fight.phase 'fight'); the script's frame k - lead is held on it. The
 * log's lines are battle.lua's; energy is the engine's (ENERGY), which
 * the grader scales to the source's.
 */
import { loadNodeGames } from '../../tests/node-roms.mjs';
import { ROSTER } from '../../js/games.js';
import { makeFighter, ENERGY } from '../../js/fighters.js';
import { createFight, stepFight } from '../../js/engine.js';

const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`);
    return i < 0 ? def : process.argv[i + 1];
};
const GAME = arg('game', 'stf');
const P1 = Number(arg('p1', GAME === 'fv' ? 8 : 0));
const P2 = Number(arg('p2', GAME === 'fv' ? 8 : 0));
const STAGE = Number(arg('stage', 0));
const SEED = Number(arg('seed', 1));
const TIME = Number(arg('time', 30));
const WINS = Number(arg('wins', 2));
const LEAD = Number(arg('lead', 30));
const FRAMES = Number(arg('frames', 20000));

/* ---- the input script: battle.lua's, step for step ----------------------- */

/* Park-Miller, as battle.lua's rnd. */
function makeScript(seed0) {
    let seed = seed0 % 2147483647;
    if (seed <= 0) seed = 1;
    const rnd = (n) => { seed = (seed * 16807) % 2147483647; return seed % n; };
    const MOVES = [
        ['f', 10], ['', 6], ['P', 10], ['K', 8], ['fP', 4], ['fK', 4],
        ['dP', 4], ['dK', 4], ['G', 5], ['PG', 3], ['PK', 3], ['KG', 2],
        ['b', 3], ['u', 2], ['d', 3], ['ff', 2], ['bP', 2], ['dfP', 2],
    ];
    const WEIGHT = MOVES.reduce((s, m) => s + m[1], 0);
    const pick = () => {
        let w = rnd(WEIGHT);
        for (const [m, n] of MOVES) { if (w < n) return m; w -= n; }
        return '';
    };
    const letters = (move, right) => move.replace(/ff/g, 'f').replace(/f/g, right ? 'L' : 'R')
        .replace(/b/g, right ? 'R' : 'L').replace(/u/g, 'U').replace(/d/g, 'D');
    const LEN = 99 * 60;
    const frames = [[], []];
    for (let p = 0; p < 2; p++) {
        let k = 0;
        while (k < LEN) {
            const m = pick();
            const strike = /[PK]/.test(m);
            const len = strike ? 8 + rnd(16) : 6 + rnd(30);
            const held = letters(m, p === 1);
            const dir = held.replace(/[PKG]/g, '');
            for (let i = 0; i < len; i++) {
                let s;
                if (m === 'ff') s = i < 2 || (i >= 4 && i < 6) ? dir : '';
                else if (strike) s = i < 3 ? held : dir;
                else s = held;
                frames[p][k + i] = s;
            }
            k += len;
        }
    }
    return (k) => (k < LEAD ? ['', ''] : [frames[0][k - LEAD] ?? '', frames[1][k - LEAD] ?? '']);
}

const padOf = (s) => ({ left: s.includes('L'), right: s.includes('R'), up: s.includes('U'), down: s.includes('D'),
    P: s.includes('P'), K: s.includes('K'), G: s.includes('G') });

/* ---- the fight ------------------------------------------------------------ */

const games = await loadNodeGames();
const entry = (index) => {
    const e = ROSTER.find((r) => r.game === GAME && r.index === index);
    if (!e) throw new Error(`no ${GAME} fighter ${index} in the roster`);
    return e;
};
const fight = createFight(makeFighter(games, entry(P1)), makeFighter(games, entry(P2)), GAME, { rounds: WINS });
const script = makeScript(SEED);
const out = [];
const yang = (a) => (Math.round((a * 65536) / (2 * Math.PI)) + 49152) & 0xffff;
const fighterLine = (p) => [p.pos[0].toFixed(3), p.pos[1].toFixed(3), p.pos[2].toFixed(3),
    p.mot?.motion?.index ?? -1, p.mot_coma, p.energy, p.state, yang(p.yang), p.pad.toString(16), p.fighter === fight.players[0].fighter ? P1 : P2].join(' ');

out.push(`setup js stage=${STAGE} c0=${P1} c1=${P2} energy=${ENERGY} wins_needed=${WINS} time=${TIME} barrier=0 seed=${SEED} lead=${LEAD} stage_yang=0 stage_x=0.000 control=0,0`);
let k = -1;
for (let n = 0; n < FRAMES && fight.phase !== 'over'; n++) {
    const was = fight.phase;
    if (was === 'fight' && k < 0) { k = 0; fight.timer = TIME * 60; }
    const [a, b] = k < 0 ? ['', ''] : script(k);
    stepFight(fight, [padOf(a), padOf(b)]);
    if (k < 0) continue;
    const [p, q] = fight.players;
    if (fight.phase === 'fight') out.push(`r${fight.round} ${k} ${fight.timer} | ${fighterLine(p)} | ${fighterLine(q)}`);
    else {
        out.push(`end r${fight.round} k=${k} wins=${p.wins},${q.wins} energy=${p.energy},${q.energy} sub=13`);
        k = -1;
        continue;
    }
    k++;
}
out.push(fight.phase === 'over' ? 'done' : 'timeout');
process.stdout.write(out.join('\n') + '\n');
