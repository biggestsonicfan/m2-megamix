/*
 * One fighter interface over three games' data.
 *
 * Virtua Fighter 2, Fighting Vipers and Sonic the Fighters run the same AM2
 * fighter engine: the same sixteen-slot rig (js/pose.js SLOT_PARENT), the same
 * keyframe motion format (twelve angle objects and eight float objects, the
 * root in floats 0-2), the same input matcher bytecode (js/moves.js) and the
 * same per-motion setup records (timing op 2, strike op 4, throw op 5). What
 * differs is where each game keeps them and how a body is dressed:
 *
 *   VF2 / FV   a fighter record (readFighters): parts, an action table of 84 /
 *              55 motion ids, a command program; drawn by poseFighter.
 *   StF        a character record (readCharacter): slot models, a 52-slot
 *              action table, a skeleton; posed by buildPose directly.
 *
 * Everything here reads the ROMs through the vendored noclip modules; nothing
 * is drawn or invented. A motion is self-contained (its channels carry their
 * own DataView), so one game's motion can be played on another game's body:
 * that is how a cross-game throw is shown.
 */
import { vfFighter } from './fighters/vf.js';
import { stfFighter } from './fighters/stf.js';
export { MOTION_ID, S, HIGH, MID, LOW, ENERGY, motionOf, rootAt } from './fighters/rom.js';
export { P, K, G, DOWN, UP, FWD, BACK, matchPress } from './fighters/matcher.js';
export { MK_AIR, MK_ATTACK, MK_DOWN, MK_DOWN_POSE, enFlag, fromBehind, throwFlags, isCounter, strikeActive, counterDamage, airDamage, downDamage, blowUnits, downStun, riseWait, knocksDown } from './fighters/rules.js';
export { prepareGame } from './fighters/vf.js';

/* ---- the fighters -------------------------------------------------------- */

/*
 * A fighter, the same shape whichever game it comes from:
 *   name, game ('vf2' | 'fv' | 'stf'), rom
 *   act(name)          the motion the named action plays, as {rom, motion}
 *   moves              {root, tables} for matchPress
 *   timing(id)         {hit, cancel, end} of the fighter's own motion id
 *   attack(id)         {level, damage, kind, side, finish} strike, {victim,
 *                      damage} throw, or null (finish: FV's finish kind)
 *   reaction(a, how)   the motion this fighter plays under attack `a`
 *   takeoff(id)        a jump motion's take-off frame (0 if none)
 *   riseWindow(id)     a get-up's {cancel, window} (FV, StF), else null
 *   motKind(id)        its motion's motd_kind (+0x804), the mot_kind bits
 *   kindAt(id, f, n)   StF: its mot_kind (+0x1A4) at frame f of n (stfKindAt)
 *   flight(small)      the frames a jump flies (+0x5BE)
 *   flies              StF: the jump flies by gravity, not by its motion
 *   airHold(id)        an air attack's hold, frames left in the air (+0x5C0)
 *   throwRanges        VF2: its four throw ranges (throwFlags), else null
 *   createBody()       a drawable body: pose(ref, frame) -> {mats, parts, pose}
 *   look               what its material needs (js/render.js)
 * and, where they are not the VF2/StF ones:
 *   motion(id)         its own motion by id (else motionOf(rom, id))
 *   size               its height to Akira's, for its reach and its body (1)
 * A game that brings its own fighters (Shenmue's Ryo, js/shenmue/ryo.js) names its
 * maker as game.makeFighter.
 */
export function makeFighter(games, entry) {
    const game = games[entry.game];
    if (game.makeFighter) return game.makeFighter(games, entry);
    return game.kind === 'stf' ? stfFighter(game, entry) : vfFighter(game, entry);
}
