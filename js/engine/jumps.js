/*
 * Jumps: take-off, the small jump, the air context, the flight under
 * gravity, an air attack's hold. Part of js/engine.js.
 */
import { MOTION_ID, rootAt } from '../fighters.js';
import { ST } from './state.js';
import { setMotion, carry } from './player.js';
import { startMove } from './input.js';

/*
 * The jump (VF2 0x1C3CC, StF 0x1DF4C, after the matcher's call): up let go
 * before take-off (motd_jump_coma, +0x80E) commits the jump again with the
 * action's bit 18, the small jump, and the jump's handler (VF2 0x147BC)
 * plays the action table's next slot from the same frame, held to its own
 * take-off (StF sub_1305C 0x1335C). FV's decoder (0x1DC24) and jump handler
 * (0x14204) are StF's code; its motions carry the arc in their root, as
 * VF2's do, and the engine plays them so.
 */
export function takeoff(p, m) {
    return p.fighter.takeoff?.(m.index) ?? 0;
}
export function smallJump(p) {
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
 * (0x1DFEC) and FV's (0x1DCB8) take 3 or 4 in the same step, by +0x1B2.
 * null: latched, not matched yet.
 */
const CTX_TAKEOFF = 1, CTX_AIR = 3;
export function jumpContext(p) {
    const up = p.small ? 1 : 0;
    const t = takeoff(p, p.mot.motion);
    if (p.mot_coma >= t) return CTX_AIR + up;
    return p.mot_coma + 1 >= t || p.small ? CTX_TAKEOFF + up : null;
}

/*
 * StF's flight. Its jump motions stand in place; the handler (ACT_RC_JUMP
 * 0x13DB8) flies the body. At take-off (step 1, +0x1AA up to +0x80E) it sets
 * vy (+0x30) to land n frames on, n the commit's +0x5BE (fighters.js flight):
 * g (n + 1) / 2, +0x5CC's lift 0 in a jump. Each frame rob_spd_control takes
 * g (0x50A000) off vy and adds vy to y (+0x1C). An air attack the jump's
 * recommit plays (0x133A0) leaves the flight going. It lands when the body
 * is down (step 2 0x1410C, w0 bit 2 clear: 0x14870), and the action goes
 * (+0x19C = 0): what plays plays on, out of the jump.
 * Here: the jump's drift (+0x5C4 by +0x724..+0x730) is not flown, and the
 * landing's mk_change (+0x1A4 bit 0) does not free the fighter early.
 */
const GRAVITY = 0.02522222138941288;    /* 0x3CCE9ED5 */
export function fly(p) {
    if (!p.fly && p.state === ST.JUMP && p.fighter.flies && p.mot_coma === takeoff(p, p.mot.motion))
        p.fly = { vy: GRAVITY * (p.fighter.flight(p.small) + 1) / 2 };
    if (!p.fly) return;
    p.fly.vy -= GRAVITY;
    p.pos[1] += p.fly.vy;
    if (p.pos[1] > 0) return;
    p.pos[1] = 0;
    p.fly = null;
    if (p.state === ST.JUMP) p.state = ST.MOTION;
}

/*
 * An air attack held back. A command with bit 19 matched in a jump stores
 * its motion's op 3 u16 at +5 in jp_next_lacoma (+0x5C0; StF 0x133C8, FV
 * 0x13600, VF2 0x14914) and keeps the jump motion; the jump handler's
 * flight step (StF 0x1410C, FV 0x14548, VF2 0x155CC) plays it once the
 * frames left in the air (land_time, +0x5BC) are down to that, and clears
 * the bit. Before take-off land_time is 0, so one there plays at once. A
 * later press commits over it, and landing (0x14870: +0x19C = 0) drops it.
 * Here: land_time counts down from +0x5BE at take-off, where the board
 * works it out from the body's height and speed each frame (calc_land_time);
 * for StF's flight the two agree, VF2's and FV's motions carry their arc.
 */
const HOLD = 1 << 19;
export function holdBack(p, e, press) {
    const at = e.cmd & HOLD && p.state === ST.JUMP && p.air != null ? p.fighter.airHold?.(e.motion & MOTION_ID) : null;
    if (at == null || p.air <= at) return false;
    p.held = { e, press, at };
    return true;
}
export function airTime(fight, p) {
    if (p.state !== ST.JUMP) { p.air = p.held = null; return; }
    if (p.air != null) p.air = Math.max(0, p.air - 1);
    else if (p.mot_coma === takeoff(p, p.mot.motion) && p.fighter.flight) p.air = p.fighter.flight(p.small);
    /* the jump handler's step 1 at take-off (+0x1AA up to +0x80E) calls
     * fix_hara: mk_air on its mot_kind (airKind) */
    if (p.mot_coma >= takeoff(p, p.mot.motion)) p.hara = p.mot;
    if (p.held && p.air <= p.held.at) {
        const { e, press } = p.held;
        p.held = null;
        startMove(fight, p, fight.players[1 - p.side], e, press);
    }
}
