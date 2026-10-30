/*
 * The setup records: each motion's ops (timing, strike, throw), the
 * part masks, a jump's take-off and air hold, a get-up's window, a throw's
 * hits. Part of js/fighters.js.
 */
import { resolveData, readMotionScript } from '../../vendor/noclip/js/motion.js';
import { progAddr } from '../../vendor/noclip/js/romset.js';
import { MOTION_ID, per } from './rom.js';

/* ---- setup records ------------------------------------------------------- */

/* VF2 / FV: the setup ops through the profile's lengths (as js/reactions.js
 * walks them), each {op, at} in the record's view. */
export function vfSetupOps(rom, id) {
    const R = rom.game.rig.reactions;
    const p = resolveData(rom, R.setups + (id & MOTION_ID) * 4);
    if (!p) return null;
    const r = resolveData(rom, p.view.getUint32(p.off, true));
    if (!r) return null;
    const dv = r.view, ops = [], play = [], kind = dv.getUint32(r.off, true);
    let at = r.off + R.head;
    while (at < dv.byteLength) {
        const op = dv.getUint8(at);
        if (op === 0 || op >= R.ops) return { dv, kind, ops, play };
        if (op === 8) { at++; break; }
        ops.push({ op, at });
        const len = op === 0x10 ? 2 + 2 * dv.getUint8(at + 1) : rom.mainCpuView.getUint8(R.lengths + op);
        if (!len) return { dv, kind, ops, play };
        at += len;
    }
    /* the play script after op 8: each op its frame (u16 at +1), its length
     * from the profile's script list (js/fighterhands.js walks it too) */
    const L = rom.game.rig.script ?? [];
    while (at + 4 <= dv.byteLength) {
        const op = dv.getUint8(at);
        if (op === 0 || op >= L.length || !L[op]) break;
        play.push({ op, frame: dv.getUint16(at + 1, true), at });
        at += L[op];
    }
    return { dv, kind, ops, play };
}

/* StF: the same record, from the program's motion list (0xCE380), head 13
 * bytes, with the op lengths of its own handler table. */
const STF_MOT_LIST = 0xce380, STF_HEAD = 13;
const STF_LENGTHS = { 0x01: 3, 0x02: 7, 0x03: 14, 0x04: 18, 0x05: 14, 0x06: 6, 0x07: 3, 0x09: 15, 0x0a: 6, 0x0b: 11,
    0x0c: 4, 0x0d: 3, 0x0e: 15, 0x0f: 3, 0x11: 7, 0x12: 7, 0x13: 7, 0x14: 3, 0x15: 6, 0x16: 5, 0x17: 3, 0x18: 13 };
export function stfSetupOps(rom, id) {
    const m = rom.maincpu, dv = rom.mainCpuView;
    const rec = dv.getUint32(progAddr(rom, STF_MOT_LIST) + id * 4, true);
    if (!rec || rec >= m.length) return null;
    const ops = [];
    for (let p = rec + STF_HEAD; p < m.length;) {
        const op = m[p];
        if (op === 0 || op === 8) break;
        const len = op === 0x10 ? 2 + m[p + 1] * 2 : STF_LENGTHS[op];
        if (!len) break;
        ops.push({ op, at: p });
        p += len;
    }
    return { dv, kind: dv.getUint32(rec, true), ops, play: readMotionScript(rom, id) };
}

/* The attack part's slots: op 4 byte 1 (+0x820) indexes a table of
 * sixteen-bit slot masks the hit test walks (42 entries, the last 0xFFFF, the
 * whole body). The three games' tables match but for part 20, StF 0x206 where
 * VF2 and FV have 0x202. */
const PART_MASKS = { stf: { prog: 0xce020 }, vf2: { data: 0x02007aca }, fv: { data: 0x0640e72e } };
const PARTS = 42;
export function partMask(rom, key, part) {
    const c = per(rom);
    if (!c.parts) {
        const T = PART_MASKS[key];
        const at = T?.prog != null ? { view: rom.mainCpuView, off: progAddr(rom, T.prog) }
            : T ? resolveData(rom, T.data) : null;
        c.parts = at ? [...Array(PARTS)].map((_, i) => at.view.getUint32(at.off + i * 4, true)) : [];
    }
    return c.parts[part] ?? 0;
}

/* A throw's damage: op 5 byte 3 at the throw, then the hits the victim's
 * motion deals itself, play op 8 (its frame, byte 3 the damage): Akira's
 * 15 throws 16 for 20, then 10 at frames 47 and 62. */
const PLAY_DAMAGE = 8;

/* A jump's take-off frame: setup op 3's first u16, motd_jump_coma (+0x80E;
 * FV's set_mot_dat stores it from op 3). Akira's jump leaves the floor at 14,
 * his small jump at 10; StF's take-off motions have 0. */
const OP_JUMP = 3;
export function takeoffOf(s) {
    const o = s?.ops.find((x) => x.op === OP_JUMP);
    return o ? s.dv.getUint16(o.at + 1, true) : 0;
}
/* An air attack held back (the command's bit 19): op 3's u16 at +5,
 * jp_next_lacoma (+0x5C0), the frames left in the air (+0x5BC) at which the
 * jump handler plays it (StF 0x133C8, FV 0x13600, VF2 0x14914). */
export function airHoldOf(s) {
    const o = s?.ops.find((x) => x.op === OP_JUMP);
    return o ? s.dv.getUint16(o.at + 5, true) : null;
}
/* A get-up's attack window (FV and StF): a motion of motd_kind's mk_rise
 * (bit 15) whose setup op 23 sets +0x87A (byte 1). P or K held while
 * follow1 (op 2's cancel, +0x80A) less the frame is at most that ends the
 * rise (StF 0x1D864, FV 0x1D634: w0 bit 15, the rise handler's last phase). */
export const MK_RISE = 1 << 15, OP_TIMING = 2, OP_RISE = 23;
export function riseWindowOf(s) {
    const w = s && s.kind & MK_RISE ? s.ops.find((o) => o.op === OP_RISE) : null;
    const t = w && s.ops.find((o) => o.op === OP_TIMING);
    return t ? { cancel: s.dv.getUint16(t.at + 3, true), window: s.dv.getUint8(w.at + 1) } : null;
}

export function throwHits(s, scale) {
    return s ? s.play.filter((o) => o.op === PLAY_DAMAGE)
        .map((o) => ({ frame: o.frame, damage: scale(s.dv.getUint8(o.at + 3)) })).filter((h) => h.damage > 0) : [];
}
