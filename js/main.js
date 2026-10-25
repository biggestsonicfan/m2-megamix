/*
 * The page: a debug menu in text, the fight at 60 frames a second, a text
 * HUD, and a struct dump. Nothing is drawn here that is not in the ROMs; the
 * menu and HUD are plain text over the picture.
 */
import { loadGames, GAMES, ROSTER } from './games.js';
import { makeFighter, ENERGY } from './fighters.js';
import { createFight, stepFight, cpuPad, ST_NAME, FPS } from './engine.js';
import { Renderer } from './render.js';

const $text = document.getElementById('text');
const $files = document.getElementById('files');
const params = new URLSearchParams(location.search);

let games = null;
let renderer = null;
const menu = {
    row: 0,
    p1: 0, p2: 6,
    p1cpu: false, p2cpu: true,
    stage: 0,
    rounds: 2,
};
let mode = 'loading';           /* loading | menu | fight */
let fight = null;
let paused = false;
let dump = false;
let screenRight = [1, 0];
let stages = [];                /* [{game, stage}] across the three games */

/* ---- loading --------------------------------------------------------- */

const dropped = new Map();
async function fetchZip(zip) {
    if (dropped.has(zip)) return dropped.get(zip);
    const r = await fetch(`roms/${zip}.zip`);
    if (!r.ok) throw new Error(`${zip}.zip`);
    return r.arrayBuffer();
}

/* Ryo's files off the Shenmue disc, if the server has it (tools/serve.py);
 * without them the cast is the three games'. */
async function fetchShenmue(path) {
    const r = await fetch(`shenmue/${path}`);
    return r.ok ? r.arrayBuffer() : null;
}

async function load() {
    mode = 'loading';
    try {
        games = await loadGames(fetchZip, (s) => { $text.textContent = s; }, fetchShenmue);
    } catch (e) {
        const need = GAMES.map((g) => `${g.zip}.zip`).join(' ');
        $text.textContent = `COULD NOT LOAD ${e.message}\n\nDROP ${need} ON THE PAGE\nOR PRESS O TO PICK THEM`;
        mode = 'need';
        return;
    }
    stages = GAMES.flatMap((g) => games[g.key].stages.map((stage) => ({ game: games[g.key], stage })));
    try {
        renderer = new Renderer(document.getElementById('view'));
    } catch (e) {
        $text.textContent = `COULD NOT START THE RENDERER\n\n${e.message}`;
        mode = 'need';
        return;
    }
    for (const [k, v] of params) if (k in menu) menu[k] = typeof menu[k] === 'boolean' ? v === '1' : Number(v);
    mode = 'menu';
    if (params.has('start')) start();
    else showMenu();
}

async function takeFiles(files) {
    for (const f of files) {
        const name = f.name.toLowerCase().replace(/\.zip$/, '');
        if (GAMES.some((g) => g.zip === name)) dropped.set(name, await f.arrayBuffer());
    }
    load();
}
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); takeFiles(e.dataTransfer.files); });
$files.addEventListener('change', () => takeFiles($files.files));

/* ---- the menu -------------------------------------------------------- */

const gameTag = (key) => ({ vf2: 'VF2', fv: 'FV ', stf: 'STF', shenmue: 'SHM' })[key];
const fighterName = (i) => `${gameTag(ROSTER[i].game)} ${ROSTER[i].name}`;
const stageName = (i) => `${gameTag(stages[i].game.key)} ${stages[i].stage.name.toUpperCase()}`;
const wrap = (v, n) => (v + n) % n;

const ROWS = [
    { label: 'PLAYER 1', show: () => fighterName(menu.p1), step: (d) => { menu.p1 = wrap(menu.p1 + d, ROSTER.length); } },
    { label: '  CONTROL', show: () => (menu.p1cpu ? 'CPU' : 'HUMAN'), step: () => { menu.p1cpu = !menu.p1cpu; } },
    { label: 'PLAYER 2', show: () => fighterName(menu.p2), step: (d) => { menu.p2 = wrap(menu.p2 + d, ROSTER.length); } },
    { label: '  CONTROL', show: () => (menu.p2cpu ? 'CPU' : 'HUMAN'), step: () => { menu.p2cpu = !menu.p2cpu; } },
    { label: 'STAGE', show: () => stageName(menu.stage), step: (d) => { menu.stage = wrap(menu.stage + d, stages.length); } },
    { label: 'ROUNDS', show: () => `${menu.rounds}`, step: (d) => { menu.rounds = 1 + wrap(menu.rounds - 1 + d, 3); } },
    { label: 'START', show: () => '', step: () => {} },
];

function showMenu() {
    const lines = ['FIGHTERS MEGAMIX  (M2 DEBUG MENU)', ''];
    ROWS.forEach((r, i) => lines.push(`${i === menu.row ? '>' : ' '} ${r.label.padEnd(10)} ${r.show()}`));
    lines.push('', 'UP/DOWN SELECT  LEFT/RIGHT CHANGE  ENTER START',
        '', 'P1  WASD MOVE   J PUNCH  K KICK  L GUARD',
        'P2  ARROWS      1 PUNCH  2 KICK  3 GUARD  (OR , . /)',
        'IN FIGHT  ESC MENU  F1 STRUCT DUMP  F2 PAUSE  F3 STEP');
    $text.textContent = lines.join('\n');
}

function menuKey(code) {
    const r = ROWS[menu.row];
    if (code === 'ArrowUp' || code === 'KeyW') menu.row = wrap(menu.row - 1, ROWS.length);
    else if (code === 'ArrowDown' || code === 'KeyS') menu.row = wrap(menu.row + 1, ROWS.length);
    else if (code === 'ArrowLeft' || code === 'KeyA') r.step(-1);
    else if (code === 'ArrowRight' || code === 'KeyD') r.step(1);
    else if (code === 'Enter' || code === 'KeyJ') { start(); return; }
    else return;
    showMenu();
}

/* ---- the fight ------------------------------------------------------- */

function start() {
    const { game, stage } = stages[menu.stage];
    const f1 = makeFighter(games, ROSTER[menu.p1]);
    const f2 = makeFighter(games, ROSTER[menu.p2]);
    fight = createFight(f1, f2, game.key, { rounds: menu.rounds });
    renderer.setStage(game, stage);
    /* A fighter is lit by the stage when it is from the stage's game, and
     * by its game's first stage when not (South Island for StF). */
    renderer.setFighters(fight.players, (key) => (key === game.key ? stage : games[key].stages?.[0]));
    renderer.side = null;
    screenRight = renderer.follow(fight.players, { snap: true });
    renderer.placeFighters();
    mode = 'fight';
    paused = false;
}

const held = new Set();
const PADS = [
    { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'], P: ['KeyJ'], K: ['KeyK'], G: ['KeyL'] },
    { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'],
        P: ['Digit1', 'Numpad1', 'Comma'], K: ['Digit2', 'Numpad2', 'Period'], G: ['Digit3', 'Numpad3', 'Slash'] },
];
const padOf = (i) => Object.fromEntries(Object.entries(PADS[i]).map(([k, codes]) => [k, codes.some((c) => held.has(c))]));

let rng = 1;
const random = () => ((rng = (rng * 1103515245 + 12345) >>> 0) / 2 ** 32);

function frame() {
    const cpu = [menu.p1cpu, menu.p2cpu];
    const pads = fight.players.map((p, i) => (cpu[i] ? cpuPad(fight, p, random, screenRight) : padOf(i)));
    stepFight(fight, pads, screenRight);
    screenRight = renderer.follow(fight.players);
}

const bar = (e) => {
    const n = Math.max(0, Math.round((e / ENERGY) * 20));
    return `[${'#'.repeat(n)}${'.'.repeat(20 - n)}]`;
};

function hud() {
    const [a, b] = fight.players;
    const t = Math.max(0, Math.ceil(fight.timer / FPS));
    const wins = (p) => '*'.repeat(p.wins).padEnd(fight.rounds);
    const lines = [
        `${a.fighter.name.padEnd(7)}${wins(a)} ${bar(a.energy)}  ${String(t).padStart(2)}  ${bar(b.energy)} ${wins(b)}${b.fighter.name.padStart(7)}`,
        `${gameTag(a.fighter.game)}${' '.repeat(65)}${gameTag(b.fighter.game)}`,
        '',
        `${' '.repeat(Math.max(0, 37 - fight.message.length / 2))}${fight.message}`,
    ];
    if (paused) lines.push('', '  PAUSED  (F2 RESUME, F3 STEP)');
    if (fight.phase === 'over') lines.push('', '  ENTER: AGAIN   ESC: MENU');
    if (dump) lines.push('', ...structDump());
    $text.textContent = lines.join('\n');
}

/* The player work areas, field by field, with the offsets the fields have in
 * StF's player struct (docs/STRUCTURES.md has all three games). */
function structDump() {
    const f = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(3)) : v);
    const row = (off, name, get) => `+${off.padEnd(6)}${name.padEnd(12)}${fight.players.map((p) => String(f(get(p))).padEnd(28)).join('')}`;
    return [
        `        ${'FIELD'.padEnd(12)}${fight.players.map((p) => `P${p.side + 1} ${gameTag(p.fighter.game)} ${p.fighter.name}`.padEnd(28)).join('')}`,
        row('0x19F', 'state', (p) => `${p.state} ${ST_NAME[p.state]}`),
        row('0x018', 'pos x', (p) => p.pos[0]),
        row('0x020', 'pos z', (p) => p.pos[2]),
        row('0x026', 'yang', (p) => `${f(p.yang)} (${((p.yang * 0x8000) / Math.PI) & 0xffff})`),
        row('0x19C', 'action', (p) => p.act ?? '-'),
        row('0x1A8', 'motion', (p) => `${p.ref?.rom === p.fighter.rom ? '' : 'foreign '}${p.ref?.motion?.index ?? p.ref?.motion?.id ?? '?'}`),
        row('0x1AA', 'frame', (p) => `${p.frame}/${p.ref?.motion?.frames ?? '?'}`),
        row('0x1AC', 'energy', (p) => p.energy),
        row('0x6F4', 'combo', (p) => p.combo),
        row('0x804', 'attack', (p) => (p.attack ? (p.attack.victim != null ? `throw v${p.attack.victim}` : `lv${p.attack.level} dmg${p.attack.damage}`) : '-')),
        row('0x808', 'hit/can/end', (p) => (p.timing ? `${p.timing.hit}/${p.timing.cancel}/${p.timing.end}` : '-')),
        row('0x1200', 'pad', (p) => `0x${p.pad.toString(16).padStart(2, '0')}`),
        row('0x1218', 'follow tbl', (p) => p.follow),
        row('', 'last move', (p) => p.lastMove),
        `        tick ${fight.tick}  phase ${fight.phase}  round ${fight.round}  timer ${fight.timer}`,
    ];
}

let last = 0, acc = 0;
function loop(t) {
    requestAnimationFrame(loop);
    if (mode !== 'fight') { last = t; return; }
    acc += Math.min(t - last, 100);
    last = t;
    const step = 1000 / FPS;
    let ran = false;
    while (acc >= step) {
        acc -= step;
        if (!paused && fight.phase !== 'over') { frame(); ran = true; }
    }
    if (ran || paused) {
        renderer.placeFighters();
        renderer.draw();
        hud();
    }
}

addEventListener('keydown', (e) => {
    if (['F1', 'F2', 'F3', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash'].includes(e.code) || e.key === 'F1') e.preventDefault();
    if (mode === 'need' && e.code === 'KeyO') { $files.click(); return; }
    if (mode === 'menu') { if (!e.repeat) menuKey(e.code); return; }
    if (mode !== 'fight') return;
    held.add(e.code);
    if (e.repeat) return;
    if (e.code === 'Escape') { mode = 'menu'; showMenu(); }
    else if (e.code === 'F1') dump = !dump;
    else if (e.code === 'F2') paused = !paused;
    else if (e.code === 'F3' && paused) { frame(); renderer.placeFighters(); renderer.draw(); hud(); }
    else if (e.code === 'Enter' && fight.phase === 'over') start();
});
addEventListener('keyup', (e) => held.delete(e.code));
addEventListener('blur', () => held.clear());

/* For a test or a link: ?p1=0&p2=6&stage=3&p1cpu=1&start, and
 * window.megamix to look at the fight from the console. */
window.megamix = {
    get fight() { return fight; },
    get renderer() { return renderer; },
    run(n) { for (let i = 0; i < n; i++) frame(); renderer.placeFighters(); renderer.draw(); hud(); },
    stages: () => stages.map((s, i) => `${i} ${stageName(i)}`),
};
if (params.has('dump')) dump = true;

requestAnimationFrame(loop);
load();
