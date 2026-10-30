/*
 * Grade the browser build against a folder of source battles: for every
 * tools/mame/battle.lua log under <dir> (<dir>/<name>/trace.txt), play the
 * same fight with tools/grade/js-battle.mjs and grade it with
 * tools/grade/grade-battle.mjs (docs/GRADING.md, the browser build).
 *
 *   node tools/grade/grade-roster.mjs <dir> [--json]
 *
 * Writes the build's log beside the source's (js.txt) and prints a line a
 * battle: game, fighters, stage, the scores and where the fights part.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ROSTER } from '../../js/games.js';

const TOOLS = new URL('.', import.meta.url).pathname;
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const DIR = args.find((a) => !a.startsWith('--'));
if (!DIR) { console.error('usage: node tools/grade/grade-roster.mjs <dir> [--json]'); process.exit(2); }

const nameOf = (game, index) => ROSTER.find((r) => r.game === game && r.index === index)?.name ?? `#${index}`;
const node = (script, argv) => execFileSync(process.execPath, [`${TOOLS}${script}`, ...argv], { maxBuffer: 1 << 28 }).toString();

const rows = [];
for (const name of readdirSync(DIR).sort()) {
    const src = `${DIR}/${name}/trace.txt`;
    if (!existsSync(src)) continue;
    const head = readFileSync(src, 'utf8').split('\n', 1)[0];
    const m = head.match(/^setup (\w+) stage=(\d+) c0=(\d+) c1=(\d+) .*wins_needed=(\d+) time=(\d+) .*seed=(\d+) lead=(\d+)/);
    const row = { name, src };
    if (!m) { rows.push({ ...row, error: head || 'no setup line' }); continue; }
    const [, game, stage, c0, c1, wins, time, seed, lead] = m;
    /* 2P against himself wears the second colours (13 + n in VF2 and FV) */
    const p2 = game !== 'stf' && +c1 >= 13 ? +c1 - 13 : +c1;
    Object.assign(row, { game, stage: +stage, p1: +c0, p2, fighters: `${nameOf(game, +c0)} vs ${nameOf(game, p2)}` });
    const js = `${DIR}/${name}/js.txt`;
    try {
        writeFileSync(js, node('js-battle.mjs', ['--game', game, '--p1', c0, '--p2', String(p2), '--stage', stage,
            '--seed', seed, '--time', time, '--wins', wins, '--lead', lead]));
        const rep = JSON.parse(node('grade-battle.mjs', [src, js, '--json']));
        const r1 = rep.rounds[0];
        rows.push({ ...row, scores: rep.scores, letter: rep.letter, setup: rep.setup,
            split: r1?.split ? `r1 frame ${r1.split.k}: ${r1.split.p + 1}P's ${r1.split.why}` : null });
    } catch (e) {
        rows.push({ ...row, error: String(e.stderr ?? e.message).trim().split('\n').pop() });
    }
}

if (JSON_OUT) console.log(JSON.stringify(rows, null, 1));
else for (const r of rows) {
    if (r.error) { console.log(`${r.name.padEnd(16)} error: ${r.error}`); continue; }
    const s = r.scores;
    console.log(`${r.name.padEnd(16)} ${r.fighters.padEnd(26)} stage ${String(r.stage).padStart(2)}  ${String(s.total).padStart(3)} ${r.letter}`
        + `  sync ${s.sync} motions ${s.motions} hits ${s.hits} end ${s.end}${r.setup.length ? `  setup: ${r.setup.join('; ')}` : ''}`
        + `${r.split ? `  (${r.split})` : ''}`);
}
