/*
 * The fight itself: createFight, a round's reset, stepFight (one frame of
 * both players, in the board's order), and the referee that ends a round.
 * Part of js/engine.js.
 */
import { ENERGY } from '../fighters.js';
import { ARENA } from '../games.js';
import { ROUND_TIME, READY_FRAMES, KO_FRAMES, START_X } from './state.js';
import { makePlayer, setAct } from './player.js';
import { readPad, think } from './input.js';
import { advance, comboEnd } from './playback.js';
import { enBehind, strike } from './strikes.js';
import { separate, bound } from './arena.js';

/* ---- the fight ----------------------------------------------------------- */

export function createFight(f1, f2, stageGame, { rounds = 2 } = {}) {
    const fight = {
        players: [makePlayer(0, f1), makePlayer(1, f2)],
        arena: ARENA[stageGame],
        tick: 0,
        phase: 'ready', phaseAt: 0,
        round: 1, rounds,           /* 0x500055 curr_round; rounds to win */
        timer: ROUND_TIME,          /* 0x500028 game_timer */
        message: 'ROUND 1',
        winner: null,
        events: [],
        broken: new Set(),          /* the cage's broken sides, for the match (wallSide) */
    };
    for (const p of fight.players) poseNow(fight, p);
    return fight;
}

function resetRound(fight) {
    fight.players.forEach((p, i) => {
        p.pos = [i ? START_X : -START_X, 0, 0];
        p.yang = i ? Math.PI : 0;
        p.energy = ENERGY;
        p.mot = null;
        p.pc_command = 0; p.press = null; p.hist = []; p.hit_combo = 0; p.riseKick = null; p.downStun = null; p.fly = null; p.air = null; p.held = null; p.hara = null; p.en_behind = false;
        p.finished = false;
        setAct(p, 'stance');
    });
    fight.timer = ROUND_TIME;
    fight.phase = 'ready'; fight.phaseAt = fight.tick;
    fight.message = `ROUND ${fight.round}`;
}

/**
 * One frame. `pads` are the two players' raw inputs: {left, right, up, down,
 * P, K, G}, screen directions; `screenRight` is the camera's right in the
 * world (x, z), which turns them into forward and back.
 */
export function stepFight(fight, pads, screenRight = [1, 0]) {
    fight.tick++;
    fight.events = [];
    const [a, b] = fight.players;
    const live = fight.phase === 'fight';
    for (const [p, o, pad] of [[a, b, pads[0]], [b, a, pads[1]]]) readPad(fight, p, o, live ? pad : {}, screenRight);
    for (const [p, o] of [[a, b], [b, a]]) think(fight, p, o);
    for (const p of fight.players) { advance(fight, p); comboEnd(p); }
    for (const p of fight.players) poseNow(fight, p);
    for (const [p, o] of [[a, b], [b, a]]) p.en_behind = enBehind(p, o);
    if (live) {
        for (const [p, o] of [[a, b], [b, a]]) strike(fight, p, o);
        separate(fight, a, b);
        fight.timer--;
    }
    /* the walls hold after a KO too: that is when a finish breaks one */
    if (live || fight.phase === 'ko') for (const p of fight.players) bound(fight, p, live);
    referee(fight);
}

function poseNow(fight, p) {
    p.posed = p.body.pose(p.mot, p.mot_coma);
}

/* ---- rounds -------------------------------------------------------------- */

function referee(fight) {
    const [a, b] = fight.players;
    const since = fight.tick - fight.phaseAt;
    if (fight.phase === 'ready') {
        fight.message = since < READY_FRAMES / 2 ? `ROUND ${fight.round}` : 'FIGHT';
        if (since >= READY_FRAMES) { fight.phase = 'fight'; fight.phaseAt = fight.tick; fight.message = ''; }
        return;
    }
    if (fight.phase === 'fight') {
        const out = a.energy <= 0 || b.energy <= 0 || fight.timer <= 0;
        if (!out) return;
        let w;
        if (a.energy <= 0 && b.energy <= 0) w = null;
        else if (a.energy <= 0) w = b;
        else if (b.energy <= 0) w = a;
        else w = a.energy === b.energy ? null : a.energy > b.energy ? a : b;
        if (w) w.wins++;
        fight.roundWinner = w;
        fight.message = (a.ringOut || b.ringOut) ? 'RING OUT' : fight.timer <= 0 ? 'TIME OVER' : 'K.O.';
        fight.phase = 'ko'; fight.phaseAt = fight.tick;
        return;
    }
    if (fight.phase === 'ko') {
        if (since === 60) fight.message = fight.roundWinner ? `${fight.roundWinner.fighter.name} WINS` : 'DRAW';
        if (since < KO_FRAMES) return;
        const champ = fight.players.find((p) => p.wins >= fight.rounds);
        if (champ) { fight.phase = 'over'; fight.winner = champ; fight.message = `${champ.fighter.name} WINS THE MATCH`; return; }
        fight.round++;
        for (const p of fight.players) p.ringOut = false;
        resetRound(fight);
    }
}
