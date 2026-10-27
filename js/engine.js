/*
 * The fight: one engine for fighters from all three games.
 *
 * The player record is the AM2 one, the rob: its fields keep the names AM2's
 * debug mode prints beside them (docs/DEBUG-MODE.md, ROBn_INFO), and the
 * comment beside each is its offset in Sonic the Fighters' rob (VF2's and
 * FV's hold the same fields). What drives it is the games' own
 * data: motions, action tables, the input matcher's tables, the setup
 * records' timing, strike and throw ops, and the reaction tables. Where the
 * three games' rules differ or are not read here, the engine says what it
 * does instead (the comments marked "here").
 *
 * No three.js: the Node test runs a bout through it.
 */
import { MOTION_ID, S, P, K, G, DOWN, UP, FWD, BACK, HIGH, MID, LOW, ENERGY, matchPress, rootAt, motionOf } from './fighters.js';
import { SLOT_PARENT } from '../vendor/noclip/js/pose.js';
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
        /* the rob's fields, by the debug mode's names and StF's offsets */
        fighter,                    /* +0x1B0 char (1P CHAR / 2P CHAR) */
        state: ST.KAMAE,            /* +0x19F, action's top byte */
        action: 'stance',           /* +0x19C: here the action-table slot playing */
        pos: [side ? START_X : -START_X, 0, 0],   /* +0x018 xpos, ypos, zpos: the motion's origin */
        yang: side ? Math.PI : 0,   /* +0x026 facing */
        mot: null,                  /* +0x1A8 mot_num: {rom, motion}; another game's for a throw */
        mot_coma: 1,                /* +0x1AA its frame */
        energy: ENERGY,             /* +0x1AC */
        attack: null,               /* +0x804 motd_kind and on: the setup record's strike or throw */
        timing: null,               /* +0x808 motd_main, follow1, follow2: hit, cancel, end */
        hit_combo: 0,               /* +0x6F4 hits taken in a row */
        pad: 0, padOld: 0,          /* +0x1200 pad, this frame and the last */
        pc_command: 0,              /* +0x1218 the follow table a string parks */
        /* the engine's own */
        side,
        body: fighter.createBody(),
        loop: true, hold: false,
        hitDone: false,
        hist: [],                   /* the stick, a sample a frame, for the matcher */
        press: null,                /* a press waiting for its chord or for a move to end */
        tapAt: -99, tapDir: 0,
        downFor: 0,
        wins: 0,                    /* 0x50004F p1_wins / 0x500051 p2_wins */
        posed: null,
        lastMove: '',
    };
    setAct(p, 'stance');
    return p;
}

/* Play `ref` from frame 1. The body is kept where it is drawn: the origin
 * moves by the old motion's root where it stopped less the new one's at 1. */
export function setMotion(p, ref, { loop = false, hold = false, state = null } = {}) {
    if (p.mot?.motion && ref?.motion) {
        const a = rootAt(p.mot.rom, p.mot.motion, p.mot_coma), b = rootAt(ref.rom, ref.motion, 1);
        carry(p, a[0] - b[0], a[2] - b[2]);
    }
    p.mot = ref;
    p.mot_coma = 1;
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
    p.action = act;
    p.crouching = act === 'crouch' || act === 'toCrouch' || act === 'crouchGuard';
    setMotion(p, ref, { loop: LOOPS.has(act), hold: HOLDS.has(act), state: ACT_STATE[act] });
    p.attack = null; p.timing = null;
    p.small = false;
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
        p.pc_command = 0; p.press = null; p.hist = []; p.hit_combo = 0;
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
    for (const p of fight.players) advance(fight, p);
    for (const p of fight.players) poseNow(fight, p);
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
    if (p.state === ST.JUMP && !p.small && !(v & UP) && p.mot_coma < takeoff(p, p.mot.motion)) smallJump(p);

    /* A press: the root table when free or in the air, the parked follow
     * table from the cancel frame of the move that parked it (the engine's
     * string window). */
    if (p.press && fight.tick - p.press.at > CHORD) {
        const age = fight.tick - p.press.at;
        const inString = p.state === ST.MOTION && p.pc_command && p.timing && p.mot_coma >= p.timing.cancel;
        const air = !inString && p.state === ST.JUMP;
        const ctx = air ? jumpContext(p) : 0;
        const table = inString ? p.pc_command : FREE.has(p.state) || air ? p.fighter.moves.root : null;
        if (table && ctx != null) {
            const hist = p.press.hist;
            const how = { ctx, foeDown: o.state === ST.DOWN };
            const e = matchPress(p.fighter.moves.tables.get(table), p.press.btn, hist.length ? hist : [0], dist, how);
            if (e) { startMove(fight, p, o, e, p.press); p.press = null; return; }
            if (!inString) p.press = null;
        }
        /* before take-off the press is latched (+0x120C's low bits) */
        if (p.press && age > PRESS_BUFFER && ctx != null) p.press = null;
    }
    if (!FREE.has(p.state)) return;

    /* The stick and guard (the action code's, by state). */
    const crouch = v & DOWN, guard = v & G;
    if (v & UP && !crouch && p.state !== ST.GUARD) return setAct(p, 'jump');
    if (p.dash && !crouch) return setAct(p, p.dash === FWD ? 'dashF' : 'dashB');
    if (guard) {
        const want = crouch ? 'crouchGuard' : 'guard';
        if (p.action !== want) setAct(p, want);
        return;
    }
    if (p.state === ST.GUARD) return setAct(p, p.action === 'crouchGuard' ? 'crouchGuardEnd' : 'guardEnd');
    if (crouch) {
        if (!p.crouching) setAct(p, 'toCrouch');
        return;
    }
    if (p.crouching) return setAct(p, 'toStand');
    const want = v & FWD ? 'walkF' : v & BACK ? 'walkB' : 'stance';
    if (p.action !== want) setAct(p, want);
}

/*
 * The jump (VF2 0x1C3CC, StF 0x1DF4C, after the matcher's call): up let go
 * before take-off (motd_jump_coma, +0x80E) commits the jump again with the
 * action's bit 18, the small jump, and the jump's handler (VF2 0x147BC)
 * plays the action table's next slot from the same frame, held to its own
 * take-off. StF's jump act is its 7 frames of take-off (motd_jump_coma 0),
 * up let go in any of them; its small jump keeps the motion.
 */
function takeoff(p, m) {
    if (p.fighter.game === 'stf') return m.frames + 1;
    return p.fighter.takeoff?.(m.index) ?? 0;
}
function smallJump(p) {
    p.small = true;
    const ref = p.fighter.act('jumpSmall');
    if (!ref.motion) return;
    const f = Math.min(p.mot_coma, takeoff(p, ref.motion));
    setMotion(p, ref, { state: ST.JUMP });
    const a = rootAt(ref.rom, ref.motion, 1), b = rootAt(ref.rom, ref.motion, f);
    carry(p, a[0] - b[0], a[2] - b[2]);
    p.mot_coma = f;
}

/*
 * The matcher's context in a jump, the key's high byte (VF2 0x1C3E8): before
 * take-off a press is latched until the frame before it (+0x120C bit 7, set
 * at once by the small jump's commit), then matched as 1, or 2 in a small
 * jump; in the air (the handler's step 2, VF2 0x1564C) as 3, or 4 in a small
 * jump. FV's motion names: JU_ the big jump's, JUS_ the small one's. StF's
 * jump here is its take-off, so 1 or 2; its 3 and 4 are the air step this
 * engine's jump does not take. null: latched, not matched yet.
 */
const CTX_TAKEOFF = 1, CTX_AIR = 3;
function jumpContext(p) {
    const up = p.small ? 1 : 0;
    if (p.fighter.game === 'stf') return CTX_TAKEOFF + up;
    const t = takeoff(p, p.mot.motion);
    if (p.mot_coma >= t) return CTX_AIR + up;
    return p.mot_coma + 1 >= t || p.small ? CTX_TAKEOFF + up : null;
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
    p.action = 'move';
    p.crouching = false;
    p.moveId = id;
    p.pc_command = e.follow || 0;
    p.attack = atk ? { ...atk, level: atk.level ?? levelOf(press), game: p.fighter.game } : null;
    p.timing = p.fighter.timing(id) ?? { hit: 1, cancel: motion.frames, end: motion.frames };
    if (p.timing.end <= 0 || p.timing.end > motion.frames) p.timing.end = motion.frames;
    p.hitDone = false;
    p.lastMove = `${e.name ?? `motion ${id}`}`;
    fight.events.push({ kind: 'move', side: p.side, id, name: p.lastMove });
}

/* Here: for a fighter whose strikes carry no level (none of the three
 * games'; a game brought in may), the press gives it: down and anything is
 * low, a punch high, the rest mid. */
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
    p.action = 'throw';
    p.moveId = id;
    p.pc_command = 0;
    p.attack = null;
    p.timing = { hit: 1, cancel: motion.frames, end: motion.frames };
    /* Where the board stands the two at the throw: the thrower's motion and
     * the victim's share an origin, the thrower's. */
    o.mot = null;
    o.pos = p.pos.slice();
    o.yang = p.yang;
    setMotion(o, { rom: p.fighter.rom, motion: victim }, { state: ST.NAGERARE });
    o.action = 'thrown';
    o.attack = null; o.timing = null; o.press = null;
    /* op 5's damage at the throw, the victim motion's own hits at their
     * frames (advance) */
    o.throwHits = atk.hits ?? [];
    o.thrower = p.fighter.name;
    throwDamage(fight, o, atk.damage ?? 0);
    p.lastMove = `throw ${id}`;
    fight.events.push({ kind: 'throw', side: p.side, id, victim: atk.victim });
}

function throwDamage(fight, o, damage) {
    o.energy = Math.max(0, o.energy - damage);
    fight.events.push({ kind: 'thrown', side: o.side, damage });
}

/* ---- playback ------------------------------------------------------------ */

function advance(fight, p) {
    const m = p.mot.motion;
    if (p.state === ST.DOWN && p.action === 'down') {
        if (++p.downFor > DOWN_FRAMES && p.energy > 0) { p.downFor = 0; setAct(p, 'rise'); return; }
    }
    if (p.mot_coma < m.frames) {
        p.mot_coma++;
        if (p.state === ST.NAGERARE) for (const h of p.throwHits ?? []) if (h.frame === p.mot_coma) throwDamage(fight, p, h.damage);
        return;
    }
    if (p.loop) {
        const a = rootAt(p.mot.rom, m, m.frames), b = rootAt(p.mot.rom, m, 1);
        carry(p, a[0] - b[0], a[2] - b[2]);
        p.mot_coma = 1;
        return;
    }
    if (p.hold) return;
    ended(fight, p);
}

/* A motion ran out: what the action code plays next. */
function ended(fight, p) {
    switch (p.state) {
    case ST.NAGERARE:
        p.throwHits = null;
        p.downFor = 0;
        return setAct(p, 'down');
    case ST.YARARE:
        if (p.knocked || p.energy <= 0) { p.knocked = false; p.downFor = 0; return setAct(p, 'down'); }
        return setAct(p, p.crouching ? 'crouch' : 'stance');
    case ST.DOWN:
        return setAct(p, 'down');
    default:
        p.pc_command = 0;
        if (p.action === 'toCrouch' || p.action === 'crouchGuardEnd') return setAct(p, 'crouch');
        return setAct(p, 'stance');
    }
}

/* ---- strikes --------------------------------------------------------------
 *
 * The board tests a strike by the attack part its setup names (op 4 byte 1,
 * +0x820): a mask of the rig's slots (fighters.js partMask). Each slot in it
 * is tested as the limb it moves: from its origin to its one child's, or,
 * for an end (hand, foot, head) or a branch (the chest), from its parent's
 * origin to its own. Here: the limbs are tested through the active frames,
 * hit to the later of cancel and hit + 2, against a capsule from the floor
 * to the head (the board's own hit volumes are the coprocessor's), and a
 * strike with no part (a game brought in) uses the limb end that is
 * furthest forward (hands, feet, head) from its inner joint.
 */
const EFFECTORS = [S.LHAND, S.RHAND, S.LFOOT, S.RFOOT, S.HEAD];
const INNER = { [S.LHAND]: S.LHAND - 1, [S.RHAND]: S.RHAND - 1, [S.LFOOT]: S.LFOOT - 1, [S.RFOOT]: S.RFOOT - 1, [S.HEAD]: S.CHEST };
const CHILDREN = SLOT_PARENT.map((_, s) => SLOT_PARENT.flatMap((q, c) => (q === s ? [c] : [])));
function limbOf(s) {
    const kids = CHILDREN[s];
    if (kids.length === 1) return [s, kids[0]];
    return SLOT_PARENT[s] >= 0 ? [SLOT_PARENT[s], s] : [s, kids[0]];
}
function limbs(p, a) {
    const out = [];
    for (let s = 0; s < SLOT_PARENT.length; s++) if (a.mask & (1 << s)) out.push(limbOf(s));
    if (out.length) return out;
    const fwd = [Math.cos(p.yang), 0, -Math.sin(p.yang)];
    const base = bodyPoint(p);
    let best = null, reach = -Infinity;
    for (const s of EFFECTORS) {
        const r = dot(sub(slotWorld(p, s), base), fwd);
        if (r > reach) { reach = r; best = s; }
    }
    return [[INNER[best], best]];
}
/* A down attack (fighters.js hitsDown) lands on a fighter lying down, the
 * rest pass over it; StF's level 8 does half (its attack_hit's tetsu path). */
const STF_DOWN_HALF = 8;
function strike(fight, p, o) {
    if (p.state !== ST.MOTION || !p.attack || p.hitDone || !p.timing) return;
    const { hit, cancel } = p.timing;
    if (p.mot_coma < hit || p.mot_coma > Math.max(hit + 2, cancel)) return;
    if (o.state === ST.NAGERARE || o.state === ST.RISE) return;
    const lying = o.state === ST.DOWN;
    if (lying && !p.attack.down) return;
    const fwd = [Math.cos(p.yang), 0, -Math.sin(p.yang)];
    const head = slotWorld(o, S.HEAD), pel = slotWorld(o, S.PELVIS);
    const foot = lying ? pel : [pel[0], 0.1, pel[2]];
    let d = Infinity;
    for (const [i, j] of limbs(p, p.attack)) {
        const inner = slotWorld(p, i), tip = slotWorld(p, j);
        for (let k = 0; k <= 4; k++) {
            const t = k / 4, at = [inner[0] + (tip[0] - inner[0]) * t, inner[1] + (tip[1] - inner[1]) * t, inner[2] + (tip[2] - inner[2]) * t];
            d = Math.min(d, segDist(at, foot, head));
        }
    }
    if (d > BODY_RADIUS * sizeOf(o) + HIT_RADIUS * sizeOf(p)) return;
    if (lying) return downHit(fight, p, o);
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
    const counter = o.state === ST.MOTION && o.timing && o.mot_coma < o.timing.hit;
    const damage = Math.round(a.damage * (counter ? COUNTER : 1));
    o.energy = Math.max(0, o.energy - damage);
    /* counted on the fighter hit, as the games count it (hit_combo); a
     * second without a hit ends it here */
    o.hit_combo = (fight.tick - (o.comboAt ?? -99) < 60) ? o.hit_combo + 1 : 1;
    o.comboAt = fight.tick;
    o.knocked = o.energy <= 0 || damage >= 40;
    if (o.energy <= 0 && finishes(p, a)) o.finished = true;
    react(fight, o, how, o.knocked ? 'down' : counter ? 'counter' : 'hit');
    fight.events.push({ kind: 'hit', side: p.side, damage, counter, level: a.level });
}

/* A blow on a fighter lying down: the damage, and the lie starts over. */
function downHit(fight, p, o) {
    const a = p.attack;
    p.hitDone = true;
    const damage = p.fighter.game === 'stf' && a.ap === STF_DOWN_HALF ? Math.round(a.damage / 2) : a.damage;
    o.energy = Math.max(0, o.energy - damage);
    o.downFor = 0;
    fight.events.push({ kind: 'hit', side: p.side, damage, counter: false, level: a.level, down: true });
}

function react(fight, o, how, kind) {
    const ref = o.fighter.reaction(how, kind) ?? o.fighter.reaction(how, 'hit');
    o.pc_command = 0; o.press = null; o.attack = null; o.timing = null;
    if (!ref?.motion) return;
    setMotion(o, ref, { state: ST.YARARE });
    o.action = kind;
    if (kind === 'guard') { o.state = ST.YARARE; o.guardStun = true; }
    /* StF's guard is its own guard motion held: give it a step back. */
    if (kind === 'guard' && o.fighter.kind === 'stf') carry(o, -0.25, 0);
}

/* ---- the arena ----------------------------------------------------------- */

function separate(fight, a, b) {
    /* one thrown, or lying down, is stood over (a pounce lands on it) */
    if ([a, b].some((p) => p.state === ST.NAGERARE || p.state === ST.DOWN)) return;
    const pa = bodyPoint(a), pb = bodyPoint(b);
    const d = flat(pa, pb), apart = PUSH_APART * (sizeOf(a) + sizeOf(b)) / 2;
    if (d >= apart || d < 1e-6) return;
    const push = (apart - d) / 2, nx = (pb[0] - pa[0]) / d, nz = (pb[2] - pa[2]) / d;
    a.pos[0] -= nx * push; a.pos[2] -= nz * push;
    b.pos[0] += nx * push; b.pos[2] += nz * push;
}

/*
 * The cage break (FV's, docs/FV-STAGES.md): a KO by a blow of finish kind 3
 * that drives the loser into a wall breaks that side, and the loser goes on
 * through it. FV mends the cage at the next round (SET_INT clears
 * finish_wall_flag). Here a broken side stays broken for the match, and a
 * fighter past its line is out, as at VF2's ring edge; the other sides stay
 * walls. FV also wants the loser reacting and driven in steeper than 22.5
 * degrees, which this engine (no velocities) leaves out.
 *
 * Here: VF2's, StF's and Shenmue's motions have no finish kinds, so their
 * KO blows of FINISH_DAMAGE or more count as kind 3: a third or so of each
 * of their movesets, about the share of FV's own (24 to 100 damage).
 */
const FINISH_CAGE = 3, FINISH_DAMAGE = 30;
function finishes(p, a) {
    return p.fighter.game === 'fv' ? a.finish === FINISH_CAGE : a.damage >= FINISH_DAMAGE;
}

/* The side of the square a point is past or nearest: FV's numbering
 * (finish_wall_calc_pos) 0 +z, 1 -x, 2 -z, 3 +x. */
export function wallSide(x, z) {
    return Math.abs(x) > Math.abs(z) ? (x > 0 ? 3 : 1) : (z > 0 ? 0 : 2);
}
const SIDE_AXIS = [[2, 1], [0, -1], [2, -1], [0, 1]];   /* side: [axis, sign] */

/* VF2's ring: out past its edge. FV's and StF's cages: a wall, but for
 * the sides of FV's that are broken. */
function bound(fight, p, live) {
    const A = fight.arena, at = bodyPoint(p);
    const out = () => {
        if (live && p.state !== ST.NAGERARE && !p.ringOut) { p.ringOut = true; p.energy = 0; fight.events.push({ kind: 'ringout', side: p.side }); }
    };
    if (A.ringOut) {
        if (Math.abs(at[0]) > A.half || Math.abs(at[2]) > A.half) out();
        return;
    }
    const lim = A.half - BODY_RADIUS * sizeOf(p);
    SIDE_AXIS.forEach(([k, sign], side) => {
        const over = at[k] * sign - lim;
        if (over <= 0) return;
        if (fight.broken.has(side)) {
            if (at[k] * sign > A.half) out();
            return;
        }
        if (A.cage && p.finished) {
            fight.broken.add(side);
            p.finished = false;
            fight.events.push({ kind: 'cagebreak', side: p.side, wall: side });
            return;
        }
        p.pos[k] -= over * sign;
    });
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
