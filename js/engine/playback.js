/*
 * Playing the motions: a frame's advance, a combo's end, getting up and
 * the rising kick, a motion's end. Part of js/engine.js.
 */
import { P, K, DOWN, FWD, BACK, riseWait, rootAt } from '../fighters.js';
import { ST, DOWN_STUN, FREE } from './state.js';
import { carry, setAct } from './player.js';
import { startMove } from './input.js';
import { fly, airTime } from './jumps.js';
import { throwDamage } from './throws.js';
import { kindAt } from './strikes.js';

/* ---- playback ------------------------------------------------------------ */

/*
 * The lying: the knock-down's stun (fighters.js downStun, +0x5DE), then the
 * rise handler's wait (riseWait, +0x1AE) or a get-up picked, then the rise.
 * Here: the stun starts with the lying motion, where the board's rise
 * handler lays it a frame or two after the fall's length; a rise command's
 * mashing (+0x194 into +0x5DC, 4 frames off the stun each) is not read;
 * a throw's victim, and a knock-down by Shenmue's blows, lie the engine's
 * own DOWN_STUN, where the board's play ops 8 and 18 set a throw's stun.
 */
export function advance(fight, p) {
    airTime(fight, p);
    fly(p);
    const m = p.mot.motion;
    if (p.state === ST.DOWN && p.action === 'down') {
        ++p.downFor;
        const stun = p.downStun ?? DOWN_STUN;
        if (p.riseKick && p.downFor > stun && p.energy > 0) return riseKick(fight, p);
        if (p.downFor > stun + riseWait(p.fighter.game, p.fighter.entry?.index ?? 0) && p.energy > 0) { p.downFor = 0; setAct(p, 'rise'); return; }
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

/*
 * The hit combo's end: action_after (StF 0x18400, FV 0x18B58, VF2 0x18128),
 * each frame after the motion plays, clears hit_combo when the fighter's
 * mot_kind has no bit 0 (mk_change: its strikes, reactions, falls, lying and
 * rise carry it; stance, crouch, walk, guard and jump do not) and +0 bit 4
 * is clear (set while the guard, yarare, ukemi and down handlers hold their
 * stun); StF's and FV's also not in ukemi (+0x70C, +0x720 bit 2). Here: the
 * stun is the engine's reaction playing out (ST.YARARE), where yarare frees
 * the fighter when +0x5DE runs out (StF 0x13BF8 clears bit 0); a fighter
 * with no mot_kind (Shenmue), or in another game's motion, keeps it until
 * it is free.
 */
const MK_CHANGE = 1 << 0;
export function comboEnd(p) {
    if (!p.hit_combo || p.state === ST.YARARE) return;
    const id = p.mot?.motion?.index;
    const own = id != null && p.mot.rom === p.fighter.rom && p.fighter.motKind;
    if (own ? !(kindAt(p) & MK_CHANGE) : FREE.has(p.state)) p.hit_combo = 0;
}

/*
 * Attacks while getting up. VF2's decoder in the rise (0x1BD38, state 0xD)
 * turns a new kick into the rise's sub-kind: 4, or 3 with down held, 8 with
 * down and back, 9 with down and forward; the rise handler (0x157DC) waits
 * out the lying (its phase 3: +0x1AE to 40 with no pick) or plays the pick
 * at once, the action table's get-up kicks, 57 mid and 61, 69, 65 low
 * (their first variants: the lying face up, +0x5B8 bit 0 clear).
 * FV's and StF's rise has no get-up attacks of its own: P or K held in the
 * mk_rise motion's last frames (fighters.js riseWindow) ends the rise (StF
 * 0x1D864, FV 0x1D634), and the press is the ground table's.
 */
export function getUp(p) {
    const v = p.pad;
    if (p.state === ST.DOWN && p.action === 'down' && p.fighter.act('riseKick')?.motion && v & ~p.padOld & K) {
        p.riseKick = !(v & DOWN) ? 'riseKick' : v & BACK ? 'riseLowBack' : v & FWD ? 'riseLowFwd' : 'riseLow';
        return false;
    }
    if (p.state !== ST.RISE || !(v & (P | K))) return false;
    const w = p.fighter.riseWindow?.(p.mot.motion.index);
    if (!w || w.cancel - p.mot_coma > w.window) return false;
    setAct(p, 'stance');
    return true;
}
export function riseKick(fight, p) {
    const name = p.riseKick, id = p.fighter.act(name).motion.index;
    p.riseKick = null; p.downFor = 0;
    startMove(fight, p, null, { motion: id, name: `get-up ${id}` }, { btn: K, hist: [name === 'riseKick' ? 0 : DOWN] });
}

/* A motion ran out: what the action code plays next. */
function ended(fight, p) {
    switch (p.state) {
    case ST.NAGERARE:
        p.throwHits = null;
        p.downFor = 0; p.downStun = null;
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
