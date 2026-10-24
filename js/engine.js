/*
 * The fight: one engine for fighters from all three games.
 *
 * The player record is the AM2 one (docs/STRUCTURES.md): the fields keep the
 * names the games' fight code gives them, and the comment beside each is its
 * offset in Sonic the Fighters' player block (P1 0x510D00, P2 0x514100; VF2's
 * and FV's blocks hold the same fields). What drives it is the games' own
 * data: motions, action tables, the input matcher's tables, the setup
 * records' timing, strike and throw ops, and the reaction tables. Where the
 * three games' rules differ or are not read here, the engine says what it
 * does instead (the comments marked "here").
 *
 * No three.js: the Node test runs a bout through it.
 */
import { MOTION_ID, S, P, K, G, DOWN, UP, FWD, BACK, HIGH, MID, LOW, ENERGY, matchPress, rootAt, motionOf } from './fighters.js';
import { ARENA } from './games.js';

/* The action states, as Sonic the Fighters' fight code numbers them
 * (+0x19F, stf-fly actions.py). */
export const ST = {
    MOTION: 0, KAMAE: 1, SYAGAMI: 2, WALK: 3, BWALK: 4, FUMIKOMI: 5, JUMP: 6, TA_GUARD: 7, DOWN: 8, RISE: 9,
    GUARD: 10, YARARE: 11, NAGE: 12, NAGERARE: 13,
};
export const ST_NAME = Object.fromEntries(Object.entries(ST).map(([k, v]) => [v, k]));

export const FPS = 60;
const ROUND_TIME = 40 * FPS;
const READY_FRAMES = 90, KO_FRAMES = 150;
const START_X = 1;                  /* a round starts the fighters at x = -1 and +1 */
const DASH_WINDOW = 12;             /* frames between the taps of a dash */
const PRESS_BUFFER = 10;            /* a press held over until a move can take it */
const CHORD = 2;                    /* frames a press waits for its other buttons */
const DOWN_FRAMES = 50;             /* lying before the rise */
const BODY_RADIUS = 0.35;
const HIT_RADIUS = 0.2;
const PUSH_APART = 0.6;
/* A fighter's size against the VF2 cast's (Ryo's 69/71): the radii go with it. */
const sizeOf = (p) => p.fighter.size ?? 1;
/* A fighter's motion: its own if it has its own (Ryo's), else its ROM's. */
const motionFor = (f, id) => f.motion?.(id) ?? motionOf(f.rom, id);
const COUNTER = 1.25;

/* ---- vectors in the world (the viewer's frame: y up) --------------------- */

/* World from a fighter's own frame: W = T(pos) . RotY(yang). */
export function toWorld(p, [x, y, z]) {
    const c = Math.cos(p.yang), s = Math.sin(p.yang);
    return [p.pos[0] + c * x + s * z, p.pos[1] + y, p.pos[2] - s * x + c * z];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function segDist(p, a, b) {
    const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
    return Math.hypot(...sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]));
}

/* ---- the player record --------------------------------------------------- */

export function makePlayer(side, fighter) {
    const p = {
        side,
        fighter,                    /* +0x1B0 char */
        body: fighter.createBody(),
        state: ST.KAMAE,            /* +0x000 state / +0x19F action number */
        pos: [side ? START_X : -START_X, 0, 0],   /* +0x018 position (the motion's origin) */
        yang: side ? Math.PI : 0,   /* +0x026 facing */
        act: 'stance',              /* the action-table slot playing (+0x19C action word) */
        ref: null,                  /* +0x1A8 motion: {rom, motion}; another game's for a throw */
        frame: 1,                   /* +0x1AA frame */
        loop: true, hold: false,
        energy: ENERGY,             /* +0x1AC energy */
        timing: null,               /* +0x808 hit / +0x80A cancel / +0x80C end */
        attack: null,               /* the setup record's strike or throw (+0x804 setup word) */
        hitDone: false,
        follow: 0,                  /* the follow table a string parks (+0x1218 pc_command) */
        pad: 0, padOld: 0,          /* +0x1200 pad, this frame and the last */
        hist: [],                   /* the stick, a sample a frame, for the matcher */
        press: null,                /* a press waiting for its chord or for a move to end */
        tapAt: -99, tapDir: 0,
        combo: 0,                   /* +0x6F4 hit_combo */
        downFor: 0,
        wins: 0,                    /* 0x50004F / 0x500051 */
        posed: null,
        lastMove: '',
    };
    setAct(p, 'stance');
    return p;
}

/* Play `ref` from frame 1. The body is kept where it is drawn: the origin
 * moves by the old motion's root where it stopped less the new one's at 1. */
export function setMotion(p, ref, { loop = false, hold = false, state = null } = {}) {
    if (p.ref?.motion && ref?.motion) {
        const a = rootAt(p.ref.rom, p.ref.motion, p.frame), b = rootAt(ref.rom, ref.motion, 1);
        carry(p, a[0] - b[0], a[2] - b[2]);
    }
    p.ref = ref;
    p.frame = 1;
    p.loop = loop; p.hold = hold;
    if (state != null) p.state = state;
}

function carry(p, dx, dz) {
    const c = Math.cos(p.yang), s = Math.sin(p.yang);
    p.pos[0] += c * dx + s * dz;
    p.pos[2] += -s * dx + c * dz;
}

const LOOPS = new Set(['stance', 'crouch', 'walkF', 'walkB', 'down']);
const HOLDS = new Set(['guard', 'crouchGuard']);
const ACT_STATE = {
    stance: ST.KAMAE, crouch: ST.SYAGAMI, toCrouch: ST.SYAGAMI, toStand: ST.KAMAE, walkF: ST.WALK, walkB: ST.BWALK,
    dashF: ST.FUMIKOMI, dashB: ST.FUMIKOMI, jump: ST.JUMP, guard: ST.GUARD, guardEnd: ST.KAMAE,
    crouchGuard: ST.GUARD, crouchGuardEnd: ST.SYAGAMI, down: ST.DOWN, rise: ST.RISE,
};
function setAct(p, act) {
    const ref = p.fighter.act(act);
    if (!ref.motion) return;
    p.act = act;
    p.crouching = act === 'crouch' || act === 'toCrouch' || act === 'crouchGuard';
    setMotion(p, ref, { loop: LOOPS.has(act), hold: HOLDS.has(act), state: ACT_STATE[act] });
    p.attack = null; p.timing = null;
}

/* The body's point on the floor, in the world: the origin carried by the
 * root (slot 0's matrix). */
export function bodyPoint(p) {
    const m = p.posed?.mats[S.BODY];
    return m ? toWorld(p, [m[12], 0, m[14]]) : p.pos.slice();
}
const slotWorld = (p, s) => { const m = p.posed.mats[s]; return toWorld(p, [m[12], m[13], m[14]]); };

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
    };
    for (const p of fight.players) poseNow(fight, p);
    return fight;
}

function resetRound(fight) {
    fight.players.forEach((p, i) => {
        p.pos = [i ? START_X : -START_X, 0, 0];
        p.yang = i ? Math.PI : 0;
        p.energy = ENERGY;
        p.ref = null;
        p.follow = 0; p.press = null; p.hist = []; p.combo = 0;
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
    for (const p of fight.players) advance(fight, p);
    for (const p of fight.players) poseNow(fight, p);
    if (live) {
        for (const [p, o] of [[a, b], [b, a]]) strike(fight, p, o);
        separate(fight, a, b);
        for (const p of fight.players) bound(fight, p);
        fight.timer--;
    }
    referee(fight);
}

function poseNow(fight, p) {
    p.posed = p.body.pose(p.ref, p.frame);
}

/* The pad as the matcher reads it: buttons, and the stick turned to the
 * fighter's forward and back. */
function readPad(fight, p, o, pad, screenRight) {
    const facing = [Math.cos(p.yang), -Math.sin(p.yang)];
    const toward = facing[0] * screenRight[0] + facing[1] * screenRight[1] >= 0;
    let v = (pad.P ? P : 0) | (pad.K ? K : 0) | (pad.G ? G : 0) | (pad.down ? DOWN : 0) | (pad.up ? UP : 0);
    if (pad.right) v |= toward ? FWD : BACK;
    if (pad.left) v |= toward ? BACK : FWD;
    p.padOld = p.pad;
    p.pad = v;
    p.hist.push(v & 0xf0);
    if (p.hist.length > 24) p.hist.shift();
    const newBtn = v & ~p.padOld & 7;
    if (newBtn) {
        if (p.press && fight.tick - p.press.at <= CHORD) p.press.btn |= v & 7;
        else p.press = { at: fight.tick, btn: v & 7, hist: collapse(p.hist.slice(0, -1).concat([v & 0xf0])) };
    } else if (p.press && fight.tick - p.press.at <= CHORD) p.press.btn |= v & 7;
    const dir = v & (FWD | BACK);
    const tapped = dir & ~(p.padOld & (FWD | BACK));
    p.dash = null;
    if (tapped) {
        if (p.tapDir === tapped && fight.tick - p.tapAt <= DASH_WINDOW) p.dash = tapped;
        p.tapDir = tapped; p.tapAt = fight.tick;
    }
}

/* js/moves.js collapse: repeats dropped, leading neutrals dropped. */
function collapse(hist) {
    const seq = [];
    for (const d of hist) if (seq[seq.length - 1] !== d) seq.push(d);
    while (seq.length > 1 && seq[0] === 0) seq.shift();
    return seq.length ? seq : [0];
}

const FREE = new Set([ST.KAMAE, ST.SYAGAMI, ST.WALK, ST.BWALK, ST.GUARD]);

/* What the fighter does with its input this frame. */
function think(fight, p, o) {
    const dist = flat(bodyPoint(p), bodyPoint(o));
    /* Turn to the other while free to: the fight code's facing (+0x26). */
    if (FREE.has(p.state) || p.state === ST.FUMIKOMI) {
        const d = sub(bodyPoint(o), bodyPoint(p));
        const want = Math.atan2(-d[2], d[0]);
        const before = bodyPoint(p);
        p.yang = want;
        const after = bodyPoint(p);
        p.pos[0] += before[0] - after[0]; p.pos[2] += before[2] - after[2];
    }
    if (fight.phase !== 'fight') return;
    const v = p.pad;

    /* A press: the root table when free, the parked follow table from the
     * cancel frame of the move that parked it (the engine's string window). */
    if (p.press && fight.tick - p.press.at > CHORD) {
        const age = fight.tick - p.press.at;
        const inString = p.state === ST.MOTION && p.follow && p.timing && p.frame >= p.timing.cancel;
        const table = inString ? p.follow : FREE.has(p.state) ? p.fighter.moves.root : null;
        if (table) {
            const hist = p.press.hist;
            const e = matchPress(p.fighter.moves.tables.get(table), p.press.btn, hist.length ? hist : [0], dist);
            if (e) { startMove(fight, p, o, e, p.press); p.press = null; return; }
            if (!inString) p.press = null;
        }
        if (p.press && age > PRESS_BUFFER) p.press = null;
    }
    if (!FREE.has(p.state)) return;

    /* The stick and guard (the action code's, by state). */
    const crouch = v & DOWN, guard = v & G;
    if (v & UP && !crouch && p.state !== ST.GUARD) return setAct(p, 'jump');
    if (p.dash && !crouch) return setAct(p, p.dash === FWD ? 'dashF' : 'dashB');
    if (guard) {
        const want = crouch ? 'crouchGuard' : 'guard';
        if (p.act !== want) setAct(p, want);
        return;
    }
    if (p.state === ST.GUARD) return setAct(p, p.act === 'crouchGuard' ? 'crouchGuardEnd' : 'guardEnd');
    if (crouch) {
        if (!p.crouching) setAct(p, 'toCrouch');
        return;
    }
    if (p.crouching) return setAct(p, 'toStand');
    const want = v & FWD ? 'walkF' : v & BACK ? 'walkB' : 'stance';
    if (p.act !== want) setAct(p, want);
}

/* Commit to a move (the matcher's commit op): the motion, its timing and
 * attack from the setup record, and the follow table it parks. */
function startMove(fight, p, o, e, press) {
    const id = e.motion & MOTION_ID;
    const motion = motionFor(p.fighter, id);
    if (!motion) return;
    const atk = p.fighter.attack(id);
    if (atk?.victim != null) {
        if (!canThrow(p, o)) return;
        throwStart(fight, p, o, id, atk);
        return;
    }
    setMotion(p, { rom: p.fighter.rom, motion }, { state: ST.MOTION });
    p.act = 'move';
    p.crouching = false;
    p.moveId = id;
    p.follow = e.follow || 0;
    p.attack = atk ? { ...atk, level: atk.level ?? levelOf(press), game: p.fighter.game } : null;
    p.timing = p.fighter.timing(id) ?? { hit: 1, cancel: motion.frames, end: motion.frames };
    if (p.timing.end <= 0 || p.timing.end > motion.frames) p.timing.end = motion.frames;
    p.hitDone = false;
    p.lastMove = `${e.name ?? `motion ${id}`}`;
    fight.events.push({ kind: 'move', side: p.side, id, name: p.lastMove });
}

/* Here: Sonic the Fighters' level byte is not read, so the press gives it:
 * down and anything is low, a punch high, the rest mid. */
function levelOf(press) {
    const last = press.hist[press.hist.length - 1] ?? 0;
    if (last & DOWN) return LOW;
    return press.btn === P ? HIGH : MID;
}

/* ---- throws ---------------------------------------------------------------
 *
 * The thrower's setup op 5 names the motion the one thrown plays with it. The
 * one thrown takes the thrower's place and facing (VF2/FV copy +0x18..+0x20
 * and +0x26), and the two motions are made to be played together from there:
 * across games too, as a motion poses on any of the sixteen-slot bodies.
 */
const THROW_RANGE = 1.5;
function canThrow(p, o) {
    return flat(bodyPoint(p), bodyPoint(o)) < THROW_RANGE * sizeOf(p) && FREE.has(o.state) && o.state !== ST.SYAGAMI && !o.crouching;
}

function throwStart(fight, p, o, id, atk) {
    const motion = motionFor(p.fighter, id);
    const victim = motionFor(p.fighter, atk.victim);
    if (!victim) return;
    setMotion(p, { rom: p.fighter.rom, motion }, { state: ST.NAGE });
    p.act = 'throw';
    p.moveId = id;
    p.follow = 0;
    p.attack = null;
    p.timing = { hit: 1, cancel: motion.frames, end: motion.frames };
    /* Where the board stands the two at the throw: the thrower's motion and
     * the victim's share an origin, the thrower's. */
    o.ref = null;
    o.pos = p.pos.slice();
    o.yang = p.yang;
    setMotion(o, { rom: p.fighter.rom, motion: victim }, { state: ST.NAGERARE });
    o.act = 'thrown';
    o.attack = null; o.timing = null; o.press = null;
    o.throwDamage = atk.damage;
    o.thrower = p.fighter.name;
    p.lastMove = `throw ${id}`;
    fight.events.push({ kind: 'throw', side: p.side, id, victim: atk.victim });
}

/* ---- playback ------------------------------------------------------------ */

function advance(fight, p) {
    const m = p.ref.motion;
    if (p.state === ST.DOWN && p.act === 'down') {
        if (++p.downFor > DOWN_FRAMES && p.energy > 0) { p.downFor = 0; setAct(p, 'rise'); return; }
    }
    if (p.frame < m.frames) { p.frame++; return; }
    if (p.loop) {
        const a = rootAt(p.ref.rom, m, m.frames), b = rootAt(p.ref.rom, m, 1);
        carry(p, a[0] - b[0], a[2] - b[2]);
        p.frame = 1;
        return;
    }
    if (p.hold) return;
    ended(fight, p);
}

/* A motion ran out: what the action code plays next. */
function ended(fight, p) {
    switch (p.state) {
    case ST.NAGERARE:
        p.energy = Math.max(0, p.energy - (p.throwDamage ?? 0));
        fight.events.push({ kind: 'thrown', side: p.side, damage: p.throwDamage });
        p.downFor = 0;
        return setAct(p, 'down');
    case ST.YARARE:
        if (p.knocked || p.energy <= 0) { p.knocked = false; p.downFor = 0; return setAct(p, 'down'); }
        return setAct(p, p.crouching ? 'crouch' : 'stance');
    case ST.DOWN:
        return setAct(p, 'down');
    default:
        p.follow = 0;
        if (p.act === 'toCrouch' || p.act === 'crouchGuardEnd') return setAct(p, 'crouch');
        return setAct(p, 'stance');
    }
}

/* ---- strikes --------------------------------------------------------------
 *
 * Here: the board tests each strike against the other's body by the moving
 * part its setup names; this engine takes the end of a limb that is furthest
 * forward (hands, feet, head) through the active frames, hit to the later of
 * cancel and hit + 2, against a capsule from the floor to the head. The limb
 * from its inner joint (elbow, knee, chest) to that end is tested, not the
 * end alone, so a blow that reaches past the body still lands.
 */
const EFFECTORS = [S.LHAND, S.RHAND, S.LFOOT, S.RFOOT, S.HEAD];
const INNER = { [S.LHAND]: S.LHAND - 1, [S.RHAND]: S.RHAND - 1, [S.LFOOT]: S.LFOOT - 1, [S.RFOOT]: S.RFOOT - 1, [S.HEAD]: S.CHEST };
function strike(fight, p, o) {
    if (p.state !== ST.MOTION || !p.attack || p.hitDone || !p.timing) return;
    const { hit, cancel } = p.timing;
    if (p.frame < hit || p.frame > Math.max(hit + 2, cancel)) return;
    const fwd = [Math.cos(p.yang), 0, -Math.sin(p.yang)];
    const base = bodyPoint(p);
    let best = null, reach = -Infinity;
    for (const s of EFFECTORS) {
        const w = slotWorld(p, s);
        const r = dot(sub(w, base), fwd);
        if (r > reach) { reach = r; best = s; }
    }
    if (o.state === ST.NAGERARE || o.state === ST.DOWN || o.state === ST.RISE) return;
    const head = slotWorld(o, S.HEAD), pel = slotWorld(o, S.PELVIS);
    const foot = [pel[0], 0.1, pel[2]];
    const tip = slotWorld(p, best), inner = slotWorld(p, INNER[best]);
    let d = Infinity;
    for (let k = 0; k <= 4; k++) {
        const t = k / 4, at = [inner[0] + (tip[0] - inner[0]) * t, inner[1] + (tip[1] - inner[1]) * t, inner[2] + (tip[2] - inner[2]) * t];
        d = Math.min(d, segDist(at, foot, head));
    }
    if (d > BODY_RADIUS * sizeOf(o) + HIT_RADIUS * sizeOf(p)) return;
    const a = p.attack;
    /* A high blow goes over a crouch (the board's yarare test does the same
     * by height). */
    if (a.level === HIGH && o.crouching) return;
    p.hitDone = true;
    const facingAway = dot([Math.cos(o.yang), 0, -Math.sin(o.yang)], fwd) > 0.3;
    const how = { ...a, crouch: o.crouching, behind: facingAway };
    if (o.state === ST.GUARD && !facingAway && (o.crouching ? a.level !== HIGH : a.level !== LOW)) {
        react(fight, o, how, 'guard');
        fight.events.push({ kind: 'guard', side: p.side });
        return;
    }
    const counter = o.state === ST.MOTION && o.timing && o.frame < o.timing.hit;
    const damage = Math.round(a.damage * (counter ? COUNTER : 1));
    o.energy = Math.max(0, o.energy - damage);
    p.combo = (fight.tick - (p.comboAt ?? -99) < 60) ? p.combo + 1 : 1;
    p.comboAt = fight.tick;
    o.knocked = o.energy <= 0 || damage >= 40;
    react(fight, o, how, o.knocked ? 'down' : counter ? 'counter' : 'hit');
    fight.events.push({ kind: 'hit', side: p.side, damage, counter, level: a.level });
}

function react(fight, o, how, kind) {
    const ref = o.fighter.reaction(how, kind) ?? o.fighter.reaction(how, 'hit');
    o.follow = 0; o.press = null; o.attack = null; o.timing = null;
    if (!ref?.motion) return;
    setMotion(o, ref, { state: ST.YARARE });
    o.act = kind;
    if (kind === 'guard') { o.state = ST.YARARE; o.guardStun = true; }
    /* StF's guard is its own guard motion held: give it a step back. */
    if (kind === 'guard' && o.fighter.kind === 'stf') carry(o, -0.25, 0);
}

/* ---- the arena ----------------------------------------------------------- */

function separate(fight, a, b) {
    if (a.state === ST.NAGERARE || b.state === ST.NAGERARE) return;
    const pa = bodyPoint(a), pb = bodyPoint(b);
    const d = flat(pa, pb), apart = PUSH_APART * (sizeOf(a) + sizeOf(b)) / 2;
    if (d >= apart || d < 1e-6) return;
    const push = (apart - d) / 2, nx = (pb[0] - pa[0]) / d, nz = (pb[2] - pa[2]) / d;
    a.pos[0] -= nx * push; a.pos[2] -= nz * push;
    b.pos[0] += nx * push; b.pos[2] += nz * push;
}

/* VF2's ring: out past its edge. FV's and StF's cages: a wall. */
function bound(fight, p) {
    const A = fight.arena, at = bodyPoint(p);
    if (A.ringOut) {
        if (Math.abs(at[0]) > A.half || Math.abs(at[2]) > A.half) {
            if (p.state !== ST.NAGERARE && !p.ringOut) { p.ringOut = true; p.energy = 0; fight.events.push({ kind: 'ringout', side: p.side }); }
        }
        return;
    }
    const lim = A.half - BODY_RADIUS * sizeOf(p);
    for (const k of [0, 2]) {
        if (at[k] > lim) p.pos[k] -= at[k] - lim;
        if (at[k] < -lim) p.pos[k] += -lim - at[k];
    }
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

/* ---- a CPU player -------------------------------------------------------- */

/* Here: a plain opponent for testing and for one player. It walks in, then
 * pokes, guards what it sees coming, throws now and then. Its output is a
 * pad like a person's, so it goes through the matcher like one. */
export function cpuPad(fight, me, rng = Math.random, screenRight = [1, 0]) {
    const o = fight.players[1 - me.side];
    const d = flat(bodyPoint(me), bodyPoint(o));
    const pad = {};
    const [ox, , oz] = bodyPoint(o), [mx, , mz] = bodyPoint(me);
    const toRight = (ox - mx) * screenRight[0] + (oz - mz) * screenRight[1] > 0;
    const fwd = toRight ? 'right' : 'left', back = toRight ? 'left' : 'right';
    me.cpu ??= { plan: null, until: 0 };
    const c = me.cpu;
    if (fight.tick >= c.until) {
        const r = rng();
        if (o.state === ST.MOTION && d < 2.2 && r < 0.45) c.plan = 'guard';
        else if (d > 1.8) c.plan = r < 0.15 ? 'dash' : 'walk';
        else if (r < 0.1) c.plan = 'throw';
        else if (r < 0.2) c.plan = 'back';
        else if (r < 0.3) c.plan = 'low';
        else c.plan = r < 0.65 ? 'punch' : 'kick';
        c.until = fight.tick + 8 + Math.floor(rng() * 14);
        c.started = fight.tick;
    }
    const t = fight.tick - c.started;
    switch (c.plan) {
    case 'walk': pad[fwd] = true; break;
    case 'dash': pad[fwd] = t === 0 || t === 2; break;
    case 'back': pad[back] = true; break;
    case 'guard': pad.G = true; break;
    case 'throw': pad.G = pad.P = t < 2; break;
    case 'low': pad.down = true; pad.K = t === 2; break;
    case 'punch': pad.P = t === 0 || t === 6; break;
    case 'kick': pad.K = t === 0; break;
    }
    return pad;
}
