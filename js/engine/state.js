/*
 * What every part of the fight shares: the action states, the fight's
 * timings and sizes, vectors in the world. It imports nothing of the
 * engine's own, so the others' top-level constants can use it.
 * Part of js/engine.js (the fight), which re-exports its API.
 */
import { DOWN, motionOf } from '../fighters.js';

/* The action states, as Sonic the Fighters' fight code numbers them
 * (+0x19F, stf-fly actions.py). */
export const ST = {
    MOTION: 0, KAMAE: 1, SYAGAMI: 2, WALK: 3, BWALK: 4, FUMIKOMI: 5, JUMP: 6, TA_GUARD: 7, DOWN: 8, RISE: 9,
    GUARD: 10, YARARE: 11, NAGE: 12, NAGERARE: 13,
};
export const ST_NAME = Object.fromEntries(Object.entries(ST).map(([k, v]) => [v, k]));

export const FPS = 60;
export const ROUND_TIME = 40 * FPS;
export const READY_FRAMES = 90, KO_FRAMES = 150;
export const START_X = 1;                  /* a round starts the fighters at x = -1 and +1 */
export const DASH_WINDOW = 12;             /* frames between the taps of a dash */
export const PRESS_BUFFER = 10;            /* a press held over until a move can take it */
export const CHORD = 2;                    /* frames a press waits for its other buttons */
export const DOWN_STUN = 10;               /* the engine's own stun lying, where no knock-down set one */
export const BODY_RADIUS = 0.35;
export const HIT_RADIUS = 0.2;
export const PUSH_APART = 0.6;
/* A fighter's size against the VF2 cast's (Ryo's 69/71): the radii go with it. */
export const sizeOf = (p) => p.fighter.size ?? 1;
/* A fighter's motion: its own if it has its own (Ryo's), else its ROM's. */
export const motionFor = (f, id) => f.motion?.(id) ?? motionOf(f.rom, id);

/* ---- vectors in the world (the viewer's frame: y up) --------------------- */

/* World from a fighter's own frame: W = T(pos) . RotY(yang). */
export function toWorld(p, [x, y, z]) {
    const c = Math.cos(p.yang), s = Math.sin(p.yang);
    return [p.pos[0] + c * x + s * z, p.pos[1] + y, p.pos[2] - s * x + c * z];
}
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function segDist(p, a, b) {
    const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
    return Math.hypot(...sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]));
}

export const FREE = new Set([ST.KAMAE, ST.SYAGAMI, ST.WALK, ST.BWALK, ST.GUARD]);
