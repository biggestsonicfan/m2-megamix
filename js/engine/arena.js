/*
 * The arena: pushing the fighters apart, the walls and the ring's edge.
 * Part of js/engine.js.
 */
import { ST, BODY_RADIUS, PUSH_APART, sizeOf, flat } from './state.js';
import { bodyPoint } from './player.js';

/* ---- the arena ----------------------------------------------------------- */

export function separate(fight, a, b) {
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
export function finishes(p, a) {
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
export function bound(fight, p, live) {
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
