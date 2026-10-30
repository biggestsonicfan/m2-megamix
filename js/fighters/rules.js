/*
 * The games' attack_hit rules: en_flag, from behind, the throw flags, the
 * counter, the damages, the stun, the knock-down. Part of js/fighters.js.
 */
import { readMotionTiming } from '../../vendor/noclip/js/motion.js';
import { stfScale } from './rom.js';
import { stfSetupOps, MK_RISE } from './setup.js';

/* en_down_attack, which the down attacks' entries want set: bit 5 of
 * en_flag in StF and FV, bit 11 in VF2 (the matcher's op 7). get_en_info
 * sets it from the other's mot_kind (+0x1A4; StF 0x193DC, FV 0x19810, VF2
 * 0x188AC): never while it rises (bit 15) or attacks (bit 8); on its down
 * pose (bit 16), or its ukemi (mot_kind2 bit 2, StF +0x70C, FV +0x720; no
 * ukemi here); else on mk_down (bit 14) unless it is in the air (bit 4)
 * while this fighter's frames left in the air (+0x5BC) are not 0. So a
 * knock-down's fall (mk_air and mk_down in all three) already counts.
 * mot_kind is the motion's motd_kind as the setup reader loads it (StF
 * 0x1B4D8, FV 0x1B964, VF2 0x1A318: mk_attack with mk_rise reads as the
 * down pose). VF2 also sets it on any fighter under a debug setting
 * (0x50016C+0x3351 bit 6 with the other's +0 bit 29), which is not here.
 * `kind` is the other's motd_kind, null when its game has none (Shenmue):
 * then `lying` stands in. */
export const MK_AIR = 1 << 4, MK_ATTACK = 1 << 8, MK_DOWN = 1 << 14, MK_DOWN_POSE = 1 << 16;
export function enFlag(game, { kind, lying, inAir }) {
    const down = kind == null ? lying
        : !(kind & (MK_RISE | MK_ATTACK)) && (!!(kind & MK_DOWN_POSE) || (!!(kind & MK_DOWN) && !(kind & MK_AIR && inAir)));
    return down ? 1 << (game === 'vf2' ? 11 : 5) : 0;
}

/* en_flag's en_from_behind (+0x5B8 bit 0), as get_en_info sets it each frame
 * (StF 0x18E34, FV 0x19298, VF2 0x18738): the other is more than a quarter
 * turn off the fighter's facing, +0x5B4 (+0x26 with the motion's turn,
 * +0x812, on mot_kind bit 6) against en_dir_yang, the way to the other. In
 * StF and FV the flag does not come on while the two are within 0.4 (+0x5F4)
 * and either's mot_kind has mk_air (bit 4), or the coprocessor's collision
 * (mod_fa_coli +0x164) holds them together; once on it stays on while the
 * other is behind. attack_hit (StF 0x2A9F0, FV 0x25DD0, VF2 0x226F4) guards
 * only a fighter with mk_guard and this flag clear. `off` is the angle from
 * the facing to the other, `was` the flag's last frame. */
export function fromBehind(game, { off, dist, was = false, air = false }) {
    if (!(Math.cos(off) < 0)) return false;
    if (was || (game !== 'stf' && game !== 'fv')) return true;
    return !(dist <= 0.4 && air);
}

/* VF2's throw bits in en_flag, as its get_en_info sets them each frame
 * (0x18768..0x1888C); its throw entries want them (the matcher's op 7: bit 8
 * the front throws, 10 and 13 the back ones). None while the throw timer
 * (0x50A0B6) runs or this fighter's mot_kind has mk_air (bit 4), nor on an
 * other whose mot_kind has mk_air, mk_down, mk_rise, mk_down_pose or bit 26
 * (0x401C010). This fighter faces the other to within 30° (0x1554: +0x5B4
 * against en_dir_yang); the other faces it the same (a front throw) or faces
 * away (a back one), and its mot_kind has mk_follow, mk_kamae, mk_walk,
 * mk_guard or bit 28 (0x10002604). The distance (+0x5F4, root to root) is
 * against the character record's +0x18..+0x24 (init_fix, 0x14218: rob
 * +0x62C, +0x668, +0x630, +0x634): in front, bit 8 to +0x18 and bit 12 to
 * +0x1C, or bit 9 to +0x20 on one crouching (+0 bit 8, or mot_kind bit 25);
 * behind, to +0x24, bit 10, or 13 on one crouching. `off` is the angle from
 * this fighter's facing to the other, `turn` from the other's facing to the
 * way from this fighter to it, `ranges` the record's four. StF and FV work
 * out the same in their own word (StF +0x720, FV +0x734; 0x18F8C, 0x193E4),
 * which their entries test with ops 0x34 and 0x35. */
const THROW_AIM = 0x1554 / 0x10000 * 2 * Math.PI;
const THROWN_NOT = 0x401C010, THROWN = 0x10002604;
export function throwFlags({ off, turn, dist, kind, ownKind = 0, crouch = false, ranges }) {
    if (!ranges || ownKind & MK_AIR || kind & THROWN_NOT || !(kind & THROWN)) return 0;
    const within = (a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) <= THROW_AIM;
    if (!within(off)) return 0;
    const low = crouch || !!(kind & 1 << 25);
    const [near, far, sy, back] = ranges;
    if (within(turn)) return dist <= back ? 1 << (low ? 13 : 10) : 0;
    if (!within(turn + Math.PI)) return 0;
    if (low) return dist <= sy ? 1 << 9 : 0;
    return (dist <= near ? 1 << 8 : 0) | (dist <= far ? 1 << 12 : 0);
}

/* A counter: attack_hit (StF 0x2B1A4, FV 0x2633C, VF2 0x22A28) counts one
 * when the fighter hit has mk_attack in its mot_kind, which every strike's
 * motd_kind carries and play_motion clears at follow1 (+0x80A; StF 0x1BEA0,
 * FV 0x1C1D8, VF2 0x1AC50): from the strike's first frame to its cancel.
 * VF2 and FV deal half again, d * 3 >> 1. StF first adds a quarter of the
 * one hit's own motd_damage (+0x822), on its own scale; there a hit on a
 * limb (its struck parts, +0x6F0, in 0xD9B0) is the smaller "smlcntr",
 * (d + (own >> 3)) * 5 / 4, which needs the part the coprocessor says was
 * struck, so here every StF counter is the full one. The attacker's game
 * decides; `own` is null when the one hit is not StF's (0 here). `kind` is
 * null for a fighter whose game has no mot_kind (Shenmue): its moves count
 * to their cancel, and its counters deal VF2's. */
export function isCounter(kind, coma, timing) {
    return !!timing && coma < timing.cancel && (kind == null || !!(kind & MK_ATTACK));
}

/* A strike's active frames: coli_attack_chk (StF 0x2A678, FV 0x25AA4, VF2
 * 0x22404) tests the attacker's struck parts only while its mot_kind has
 * mk_attack (cleared at the cancel, as for isCounter) and its frame (+0x1AA)
 * is at or past the hit frame (+0x808): hit to the frame before the cancel,
 * once a motion (g13+0x90). Here: StF's strikes without +0x860 bit 22 may
 * strike again 8 frames after a hit (g13+0x2AC), which this engine's one hit
 * a move does not follow; FV's and VF2's cac_attack_cancel (0x25A84,
 * 0x223BC), which drops a few moves (FV 0x164; VF2 0x139, 0x93, 0x2A, 0x27E,
 * 0x330, 0x127) with en_from_behind set, is not followed. A fighter with no
 * mot_kind (Shenmue's, kind null) keeps the engine's own: hit to the later
 * of cancel and hit + 2. */
export function strikeActive(kind, coma, timing) {
    if (!timing || coma < timing.hit) return false;
    if (kind == null) return coma <= Math.max(timing.hit + 2, timing.cancel);
    return isCounter(kind, coma, timing);
}
const counterRaw = (a, own) => ((a.raw + ((own ?? 0) >> 2)) * 3) >> 1;
const airRaw = (a) => (a.raw * 3) >> 1;
const downRaw = (a) => a.raw - (a.raw >> 2);
export function counterDamage(game, a, own) {
    if (game !== 'stf') return (a.damage * 3) >> 1;
    return stfScale(counterRaw(a, own));
}

/* A blow in the air: attack_hit (StF 0x2B298 "air", FV 0x26380) deals half
 * again, d * 3 >> 1, when the fighter hit has mk_air and not mk_down in its
 * mot_kind, after a counter and ukemi (which take it instead). mot_kind is
 * the motion's motd_kind (set_mot_dat, StF 0x1B4FC), and the jump handler
 * adds mk_air at take-off (fix_hara: StF ACT_RC_JUMP 0x140CC, FV 0x14508);
 * engine.js airKind. VF2's (0x22B6C) gives way on a combo's first hit to a
 * d * 5 / 4 that needs the struck part (+0x6D4 not in 0xD9B0), so VF2 is
 * left as it was. null: no change. */
export function airDamage(game, a, kind) {
    if ((game !== 'stf' && game !== 'fv') || (kind & (MK_AIR | MK_DOWN)) !== MK_AIR) return null;
    return game === 'stf' ? stfScale(airRaw(a)) : (a.damage * 3) >> 1;
}

/* StF's mot_kind at frame `coma` of a motion `frames` long. set_mot_dat
 * (0x1B4EC) loads motd_kind, mk_rise on a strike made mk_down_pose;
 * play_motion clears that mk_down_pose at the hit frame (+0x808, 0x1BE78)
 * and, from follow1 (+0x80A, 0x1BEA0; the motion's length without op 2),
 * mk_attack, mk_down_pose and bit 26 (0x4010100), and mk_rise on a strike;
 * play ops 5, 6 and 7 (0x1C29C) set, clear and flip byte 3's bit at their
 * frame. A fall (motion 225) is mk_down until its op 5 makes it mk_down_pose
 * at 64, as it comes to lie. */
const PLAY_SET = 5, PLAY_CLR = 6, PLAY_FLIP = 7;
export function stfKindAt(rom, id, coma, frames) {
    const s = stfSetupOps(rom, id);
    if (!s) return 0;
    let k = s.kind;
    const strike = !!(k & MK_ATTACK), rising = strike && !!(k & MK_RISE);
    if (rising) k = (k & ~MK_RISE) | MK_DOWN_POSE;
    const t = readMotionTiming(rom, id);
    const ev = [];
    if (rising && t) ev.push({ frame: t.hit, f: (x) => x & ~MK_DOWN_POSE });
    ev.push({ frame: t?.cancel ?? frames, f: (x) => (strike ? x & ~MK_RISE : x) & ~0x4010100 });
    for (const o of s.play) {
        const bit = 1 << rom.maincpu[o.at + 3];
        if (o.op === PLAY_SET) ev.push({ frame: o.frame, f: (x) => x | bit });
        else if (o.op === PLAY_CLR) ev.push({ frame: o.frame, f: (x) => x & ~bit });
        else if (o.op === PLAY_FLIP) ev.push({ frame: o.frame, f: (x) => x ^ bit });
    }
    ev.sort((a, b) => a.frame - b.frame);
    for (const e of ev) if (e.frame <= coma) k = e.f(k);
    return k;
}

/* A blow on a fighter going down: StF's attack_hit "down" (0x2B238) takes a
 * quarter off when the fighter hit's mot_kind has mk_down and not
 * mk_down_pose (a fall before it lies), after a counter and ukemi. FV's
 * and VF2's have no such step: their only quarter off is "tender" (FV
 * 0x263D8, VF2 0x22B30), which needs the struck part. null: no change. */
export function downDamage(game, a, kind) {
    if (game !== 'stf' || (kind & (MK_DOWN | MK_DOWN_POSE)) !== MK_DOWN) return null;
    return stfScale(downRaw(a));
}

/* A knock-down: after the damage, attack_hit (StF 0x2B41C, FV 0x26508, VF2
 * 0x22C84) plays the knock-down (the picker's category 4) and not the hit
 * when the fighter hit is going down or lying (mk_down, mk_down_pose) or in
 * the air (mk_air), in VF2 also on its hands (mk_sakadachi, bit 26); when
 * the strike's word (+0x828) has bit 14; unless that word has bit 10, when
 * the damage is 50 or more (VF2 30), when the strike has ap 1 and the one
 * hit mk_gacha (bit 24), and in VF2 when the word has bit 8 and the one hit
 * is not crouching (mk_syagami); and when the blow takes the last of its
 * energy (the caller's). The attacker's game decides, on its own damage
 * scale (StF's out of 140, which stfScale keeps in order); `damage` is the
 * blow's after counter, down and air. Here: ukemi (StF and FV) is not
 * followed, nor StF's ketchup in its last-energy test, nor the attacker's
 * mk_ride_on, which turns the knock-down into a down hit (category 5); a
 * game with no strike word (Shenmue) knocks down at 40. */
/* A blow as attack_hit has it in r11, in the attacker's own units (StF's out
 * of 140): after a counter, StF's down or its tetsu (a level 8 on one lying,
 * r11 >> 1, 0x2B26C), or the air. `how` the engine's: {counter, down, air,
 * tetsu}. Another game's is its damage, which is already on the engine's. */
export function blowUnits(game, a, damage, { counter, down, air, tetsu } = {}) {
    if (game !== 'stf') return damage;
    return counter ? counterRaw(a, counter.own) : tetsu ? a.raw >> 1 : down ? downRaw(a) : air ? airRaw(a) : a.raw;
}

/* The lying before the rise. attack_hit's knock-down (StF from 0x2B5E4, FV
 * 0x266E8, VF2 0x22E7C) sets the fighter's stun (+0x5DE) from the blow d
 * (blowUnits): StF and FV (d >> 1) * 2, VF2 ((d >> 1) - 7) * 2, none when
 * that is not above 0. The down handler (StF ACT_RC_DOWN 0x14B90, FV
 * 0x15088, VF2 0x1564C) plays the knock-down's fall to its length and hands
 * over to the rise handler (StF ACT_RC_RISE 0x14D00, FV 0x1521C, VF2
 * 0x157DC), which lays the fighter in its lying motion, counts the stun
 * down a frame at a time, then waits riseWait frames on +0x1AE unless a
 * get-up is picked (+0x19E), and rises; with no energy left it stays down.
 * null: a game with no attack_hit of the board's (Shenmue). */
export function downStun(game, d) {
    if (game === 'stf' || game === 'fv') return (d >> 1) * 2;
    if (game === 'vf2') return Math.max(0, ((d >> 1) - 7) * 2);
    return null;
}
/* The rise handler's wait after the stun: 40 frames (31 + 9), and in VF2 60
 * for fighter 8 (+0x1B1, the fighter less 13: Shun). */
export function riseWait(game, char) {
    return game === 'vf2' && char % 13 === 8 ? 60 : 40;
}

const MK_GACHA = 1 << 24, MK_SAKADACHI = 1 << 26;
const KD_ALWAYS = 1 << 14, KD_NO_DAMAGE = 1 << 10, KD_STANDING = 1 << 8;
export function knocksDown(game, a, damage, kind, crouch) {
    if (game !== 'stf' && game !== 'fv' && game !== 'vf2') return damage >= 40;
    if (kind & (MK_DOWN | MK_DOWN_POSE | MK_AIR)) return true;
    if (game === 'vf2' && kind & MK_SAKADACHI) return true;
    const w = a.word ?? 0;
    if (w & KD_ALWAYS) return true;
    if (w & KD_NO_DAMAGE) return false;
    if (damage >= (game === 'stf' ? stfScale(50) : game === 'vf2' ? 30 : 50)) return true;
    if (game === 'vf2' && w & KD_STANDING && !crouch) return true;
    return a.ap === 1 && !!(kind & MK_GACHA);
}
