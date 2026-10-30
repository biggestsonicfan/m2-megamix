/*
 * Strikes: the limbs a strike tests, the hit's flags (en), the hit, a
 * counter, the reaction it gives. Part of js/engine.js.
 */
import { S, HIGH, LOW, enFlag, fromBehind, throwFlags, isCounter, strikeActive, counterDamage, airDamage, downDamage, knocksDown, blowUnits, downStun, MK_AIR } from '../fighters.js';
import { SLOT_PARENT } from '../../vendor/noclip/js/pose.js';
import { ST, BODY_RADIUS, HIT_RADIUS, sizeOf, sub, dot, segDist, FREE } from './state.js';
import { setMotion, carry, bodyPoint, slotWorld } from './player.js';
import { finishes } from './arena.js';

/* ---- strikes --------------------------------------------------------------
 *
 * The board tests a strike by the attack part its setup names (op 4 byte 1,
 * +0x820): a mask of the rig's slots (fighters.js partMask). Each slot in it
 * is tested as the limb it moves: from its origin to its one child's, or,
 * for an end (hand, foot, head) or a branch (the chest), from its parent's
 * origin to its own, through its active frames (fighters.js strikeActive).
 * Here: the limbs are tested against a capsule from the floor to the head (the board's own hit volumes are the coprocessor's), and a
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
/* en_flag's en_down_attack for p (fighters.js enFlag): from the other's
 * motion's mot_kind, so a knock-down's fall counts as well as the lying; and
 * in VF2 its throw bits (enThrow). */
export function enOf(p, o) {
    const id = o.mot?.motion?.index;
    const kind = o.fighter.motKind && id != null ? o.fighter.motKind(id) : null;
    return enFlag(p.fighter.game, { kind, lying: o.state === ST.DOWN, inAir: !!p.air }) | enThrow(p, o);
}

/* VF2's throw bits for p (fighters.js throwFlags), from the bodies, the two
 * facings and the other's mot_kind. Here: the throw timer (0x50A0B6) and the
 * other's +0x844 bit 27 with mot_kind bit 1 (a throw at any distance) are not
 * followed; a fighter with no mot_kind (Shenmue's) counts as standing to be
 * thrown while it is free. */
const MK_KAMAE = 1 << 9;
function enThrow(p, o) {
    const ranges = p.fighter.throwRanges;
    if (!ranges) return 0;
    const d = sub(bodyPoint(o), bodyPoint(p));
    const way = Math.atan2(-d[2], d[0]);
    const kind = o.fighter.motKind ? airKind(o) : FREE.has(o.state) ? MK_KAMAE : 0;
    return throwFlags({
        off: way - p.yang, turn: way - o.yang, dist: Math.hypot(d[0], d[2]), kind, ownKind: airKind(p),
        crouch: o.crouching || o.state === ST.SYAGAMI || o.action === 'crouchGuard', ranges,
    });
}

/* en_flag's en_from_behind for p (fighters.js fromBehind), from the bodies
 * and p's facing. Here: the engine's motions do not turn the facing (+0x812),
 * get_en_info's way to the other when the two are within 0.4 and one is in
 * the air (it takes the mover's speed), and StF's and FV's hold while the
 * coprocessor's collision has them together, are not followed. */
export function enBehind(p, o) {
    const d = sub(bodyPoint(o), bodyPoint(p));
    return fromBehind(p.fighter.game, {
        off: Math.atan2(-d[2], d[0]) - p.yang, dist: Math.hypot(d[0], d[2]),
        was: p.en_behind, air: !!((airKind(p) | airKind(o)) & MK_AIR),
    });
}

/* A down attack (fighters.js hitsDown) lands on a fighter lying down, the
 * rest pass over it; StF's level 8 does half (its attack_hit's tetsu path). */
const STF_DOWN_HALF = 8;
export function strike(fight, p, o) {
    if (p.state !== ST.MOTION || !p.attack || p.hitDone || !p.timing) return;
    /* fighters.js strikeActive: hit to the frame before the cancel */
    if (!strikeActive(p.fighter.motKind ? kindAt(p) : null, p.mot_coma, p.timing)) return;
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
    /* attack_hit guards only with en_from_behind clear (enBehind) */
    if (o.state === ST.GUARD && !o.en_behind && (o.crouching ? a.level !== HIGH : a.level !== LOW)) {
        react(fight, o, how, 'guard');
        fight.events.push({ kind: 'guard', side: p.side });
        return;
    }
    const counter = counterOn(o), kind = kindAt(o), aKind = airKind(o);
    const down = counter ? null : downDamage(p.fighter.game, a, kind);
    const air = counter || down != null ? null : airDamage(p.fighter.game, a, aKind);
    const damage = counter ? counterDamage(p.fighter.game, a, counter.own) : down ?? air ?? a.damage;
    o.energy = Math.max(0, o.energy - damage);
    /* counted on the fighter hit, as the games count it (hit_combo,
     * attack_hit StF 0x2B018, FV 0x26254, VF2 0x22918); comboEnd ends it */
    o.hit_combo++;
    /* Here: attack_hit's other changes to the damage (tender, multi, ukemi)
     * are not read. */
    o.knocked = o.energy <= 0 || knocksDown(p.fighter.game, a, damage, kind | (aKind & MK_AIR), o.crouching);
    if (o.knocked) o.downStun = downStun(p.fighter.game, blowUnits(p.fighter.game, a, damage, { counter, down: down != null, air: air != null }));
    if (o.energy <= 0 && finishes(p, a)) o.finished = true;
    react(fight, o, how, o.knocked ? 'down' : counter ? 'counter' : 'hit');
    fight.events.push({ kind: 'hit', side: p.side, damage, counter: !!counter, air: air != null, fall: down != null, level: a.level });
}

/* A counter (fighters.js isCounter): o is playing its own move, before its
 * cancel; `own` its motd_damage, for StF's. Here: a throw (whose timing the
 * engine makes up) is never countered. */
function counterOn(o) {
    if (o.action !== 'move' || o.moveId == null) return null;
    const kind = o.fighter.motKind ? o.fighter.motKind(o.moveId) : null;
    if (!isCounter(kind, o.mot_coma, o.timing)) return null;
    return { own: o.fighter.attack(o.moveId)?.raw ?? null };
}

/* o's mot_kind for attack_hit (fighters.js airDamage): its motion's
 * motd_kind, with mk_air from the jump's take-off on (p.hara, airTime) till
 * its next motion. Here: play ops that change mot_kind mid-motion, and
 * StF's mk_air at the stage's edge (rob_check_stage), are not followed. */
function airKind(o) {
    const id = o.mot?.motion?.index;
    const kind = o.fighter.motKind && id != null && o.mot.rom === o.fighter.rom ? o.fighter.motKind(id) : 0;
    return o.hara && o.hara === o.mot ? kind | MK_AIR : kind;
}

/* o's mot_kind at its frame, for StF's down (fighters.js downDamage): StF's
 * own motions followed frame by frame (stfKindAt). Here: another game's
 * fighter hit by StF's has its motion's motd_kind. */
export function kindAt(o) {
    const id = o.mot?.motion?.index;
    if (id == null || o.mot.rom !== o.fighter.rom || !o.fighter.motKind) return 0;
    return o.fighter.kindAt ? o.fighter.kindAt(id, o.mot_coma, o.mot.motion.frames) : o.fighter.motKind(id);
}

/* A blow on a fighter lying down: the damage, and the lie starts over. */
function downHit(fight, p, o) {
    const a = p.attack;
    p.hitDone = true;
    const tetsu = p.fighter.game === 'stf' && a.ap === STF_DOWN_HALF;
    const damage = tetsu ? Math.round(a.damage / 2) : a.damage;
    o.energy = Math.max(0, o.energy - damage);
    o.downStun = downStun(p.fighter.game, blowUnits(p.fighter.game, a, damage, { tetsu }));
    o.hit_combo++;
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
