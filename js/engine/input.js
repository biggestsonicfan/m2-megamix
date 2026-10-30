/*
 * A player's pad: the stick turned to the fighter's frame, the press
 * buffer, the matcher run on it (think), and committing to a move.
 * Part of js/engine.js.
 */
import { MOTION_ID, P, K, G, DOWN, UP, FWD, BACK, HIGH, MID, LOW, matchPress } from '../fighters.js';
import { ST, DASH_WINDOW, PRESS_BUFFER, CHORD, motionFor, sub, flat, FREE } from './state.js';
import { setMotion, setAct, bodyPoint } from './player.js';
import { takeoff, smallJump, jumpContext, holdBack } from './jumps.js';
import { canThrow, throwStart } from './throws.js';
import { getUp } from './playback.js';
import { enOf } from './strikes.js';

/* The pad as the matcher reads it: buttons, and the stick turned to the
 * fighter's forward and back. */
export function readPad(fight, p, o, pad, screenRight) {
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

/* What the fighter does with its input this frame. */
export function think(fight, p, o) {
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
    if (getUp(p)) return;
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
            const how = { ctx, en: enOf(p, o) };
            const e = matchPress(p.fighter.moves.tables.get(table), p.press.btn, hist.length ? hist : [0], dist, how);
            if (e) { if (!holdBack(p, e, p.press)) startMove(fight, p, o, e, p.press); p.press = null; return; }
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

/* Commit to a move (the matcher's commit op): the motion, its timing and
 * attack from the setup record, and the follow table it parks. */
export function startMove(fight, p, o, e, press) {
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
