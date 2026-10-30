/*
 * Throws: who can be thrown, the throw's start and its damage.
 * Part of js/engine.js.
 */
import { ST, sizeOf, motionFor, flat, FREE } from './state.js';
import { setMotion, bodyPoint } from './player.js';

/* ---- throws ---------------------------------------------------------------
 *
 * The thrower's setup op 5 names the motion the one thrown plays with it. The
 * one thrown takes the thrower's place and facing (VF2/FV copy +0x18..+0x20
 * and +0x26), and the two motions are made to be played together from there:
 * across games too, as a motion poses on any of the sixteen-slot bodies.
 */
/* Here: StF's and FV's throw entries test their throw word (+0x720, +0x734)
 * with the matcher's ops 0x34 and 0x35, which the move reader does not keep,
 * so their throws reach 1.5 bodies; VF2's want their en_flag bits (enThrow),
 * and the entry has had its test. */
const THROW_RANGE = 1.5;
export function canThrow(p, o) {
    if (p.fighter.throwRanges) return true;
    return flat(bodyPoint(p), bodyPoint(o)) < THROW_RANGE * sizeOf(p) && FREE.has(o.state) && o.state !== ST.SYAGAMI && !o.crouching;
}

export function throwStart(fight, p, o, id, atk) {
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

export function throwDamage(fight, o, damage) {
    o.energy = Math.max(0, o.energy - damage);
    fight.events.push({ kind: 'thrown', side: o.side, damage });
}
