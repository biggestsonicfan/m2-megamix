/*
 * A Fighting Vipers fighter's own moves on the Sonic the Fighters board: his
 * motions, their setups, his command program, his action slots and his
 * reactions, from FV's ROMs, put in after the guests before him the way
 * Akira's are (tools/vf2-guest.mjs). FV's fight code is StF's a generation
 * back, so most of it is StF's byte for byte (docs/FV-MAHLER.md, "His
 * moves"); what is not is left out and counted in `lost`.
 *
 *   - motions: FV's blocks (VF2's format) at his scale (scaleMotion), under
 *     new ids after the last guest's (ctx.reserveIds). What his throws give
 *     their victim gets a copy StF's fighters play (THROWN), as Akira's.
 *   - setups (FV's set_mot_dat, 0x1B900): the head is StF's less its
 *     +4..+7 (0x860) and +12 (0x84C); the ops are StF's, number for number
 *     (their handlers match instruction for instruction, FV 0x1B9A4 against
 *     StF 0x1B568), but for op 4, a strike: FV's ends in five bytes for its
 *     own effects (+0x874..+0x877, +0x86B), StF's in a float (VF2's 2.0, as
 *     Akira's). Its kind (+7) goes through FV_KIND. Op 3's float (+7: the
 *     height a jump lands at) is a length, at his scale.
 *   - play ops: StF's for 0x01..0x0F; 0x10..0x17 as VF2's (FV's are VF2's
 *     there: PLAY_TO); the rest (FV's own effects and armour) are left out.
 *     Sounds (op 4) are FV's codes, which StF's sound board doesn't have.
 *   - his command program: FV's matcher is StF's (noclip js/moves.js), so
 *     op for op, its addresses relocated and its commits' motions under his
 *     new ids; the commit types StF has none of play the FV action that
 *     does the same (COMMIT_ACTION).
 *   - action slots: StF's 52, each from the FV action that plays what
 *     Akira's VF2 one does (FV_ACTION, by VF2 action number; the falls and
 *     getting up by slot).
 *   - reactions (FV's 22 kinds of 40 at 0x0641F834, VF2's layout) under
 *     StF's kind (FV_KIND); a kind FV has none of stays Akira's.
 */
import { resolveData } from '../vendor/noclip/js/motion.js';
import { MOTION_ID, STF_ACTIONS, DAMAGE, scaleMotion, strikeTrail, trailOp, reachAt } from './vf2-guest.mjs';

const MAIN_DATA = 0x02000000;
/* His moves go in main_data's room from 0x9913a0 (nothing StF's the board
 * keeps, nor another guest's: tools/import-assets.mjs's assets.txt) up to
 * set 1's page list (pack-akira.mjs LIST). */
export const FV_MOVES_AT = 0x9913a0, FV_MOVES_END = 0xb00000;

/* FV (noclip games.js fvipers; tools/fv-guest-survey.mjs) */
const COMMANDS = 0x1ebe0;
const SETUPS = 0x06411e94, SETUP_LENGTHS = 0x1ce86, SETUP_OPS = 25;
const MOTIONS = 0x06c00004, MOTION_COUNT = 1055;
const REACTIONS = 0x0641f834, REACTION_KINDS = 22, PER_KIND = 40;
/* FV's play lengths (0x1D028), 31 ops */
const PLAY = [0, 3, 3, 13, 7, 4, 4, 4, 4, 4, 9, 7, 4, 4, 7, 3, 4, 4, 7, 5, 4, 4, 5, 6, 12, 4, 4, 4, 6, 3, 4];
/* FV's play ops past 0x0F, as VF2's (vf2-guest.mjs PLAY_TO); FV's own
 * (0x18 on) have nothing on StF */
const PLAY_TO = {
    0x10: null, 0x11: null, 0x14: null,
    0x12: 'hand', 0x13: 0x12, 0x15: 0x14, 0x16: 0x15, 0x17: 0x16,
    0x18: null, 0x19: null, 0x1a: null, 0x1b: null, 0x1c: null, 0x1d: null, 0x1e: null,
};
const PLAY_MOTION = { 0x0a: 5, 0x0b: 5, 0x17: 4 };
/* The bits of a rob's flags StF's own play op 5 sets (vf2-guest.mjs). */
const STF_FLAG_BITS = new Set([0, 1, 3, 4, 7, 8, 9, 10, 11, 13, 15, 23, 25, 29, 30]);
/* StF's and FV's command matcher (noclip js/moves.js OP_LENGTH). */
const OP_LENGTH = [
    3, 3, 2, 4, 2, 9, 5, 2, 2, 2, 2, 2, 2, 5, 7, 5,
    1, 5, 4, 5, 5, 9, 3, 1, 1, 1, 5, 5, 2, 4, 2, 4,
    2, 5, 2, 2, 3, 2, 1, 5, 13, 2, 2, 3, 2, 1, 1, 2,
    2, 2, 3, 2, 2, 2, 5, 2, 2, 2, 5, 2, 2, 2, 2, 2,
];
/* Commit types (the word's top byte): FV's -> StF's, by their handlers
 * (FV 0x1CEA0 against StF 0x1D04C). */
export const COMMIT_TYPE = {
    0: 0, 1: 1, 9: 6, 0xc: 8, 0xd: 9, 0xe: 0xa, 0xf: 0xb, 0x10: 0xc, 0x11: 0xd, 0x15: 0x11, 0x16: 0x12, 0x17: 0x13,
    0x18: 0x14, 0x19: 0x15, 0x1a: 0x16, 0x1f: 0x19, 0x20: 0x1a, 0x23: 0x1c, 0x25: 0x1e, 0x26: 0x1f, 0x27: 0x20,
    0x28: 0x21, 0x29: 0x22, 0x2a: 0x23, 0x2b: 0x24, 0x2c: 0x25, 0x2d: 0x26, 0x2e: 0x27, 0x2f: 0x28, 0x30: 0x29,
};
/* The ones StF has none of: the FV action whose motion they play (the
 * dashes, the back turn, the run) */
const COMMIT_ACTION = { 7: 25, 8: 26, 0x13: 20, 0x1d: 22, 0x1e: 23, 0x21: 38 };
/* VF2's action numbers (STF_ACTIONS') and the FV action that plays the same */
const FV_ACTION = {
    0: 0, 1: 1, 2: 2, 5: 5, 8: 8, 9: 11, 14: 18, 15: 20, 16: 27, 17: 29, 20: 28, 21: 19, 22: 30, 23: 21, 24: 21,
    28: 39, 29: 40, 30: 40, 31: 42, 81: 35, 82: 36, 83: 37,
};
/* The board's slots 53..58, VF2's crouch walks' (actions 0x60/0x61,
 * tools/lift-stf.py): FV's actions 5 and 6 (F 0x139C4, 0x13A60) are the same
 * walks, with these actions' motions */
const CRAWL_ACTIONS = [6, 7, 31, 32, 33, 34];
/* The board's slots 61..70, FV's walks' (F 0x13878, 0x13934; tools/lift-stf.py):
 * its actions 3, 4, 27..30, then the motions it plays on rob+0 bit 10 */
const WALK_ACTIONS = [3, 4, 27, 28, 29, 30], WALK_MOTIONS = [0x9e, 0x9d, 0x289, 0x288];
/* StF's getting-up slots 41..51 are FV's actions 43..53 */
const RISE_SLOT = 41, RISE_ACTION = 43, RISE_SLOTS = 11;
/* FV's reaction kind -> StF's (VF2's numbers), by what its lists play */
export const FV_KIND = [0, 1, 2, 3, 4, 11, 6, 5, 6, 7, 11, 13, 29, 16, 18, 29, 21, 28, 12, 12, 23, 6];
/* FV's down (kind 0's list, place 32): VF2's 0x2CE, the falls */
const FALL_PLACE = 32;
/* A test that always fails (fm-moves.mjs) */
const FAIL = [0x16, 0xff, 0xff];

const hex = (v) => '0x' + (v >>> 0).toString(16).toUpperCase();
const le32 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24];
const f32 = (x) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x, true); return [...b]; };

/* R: import-assets' regions; ctx: importAkira's; fv: noclip's FV ROM set; A:
 * readFighters(fv)[n]; k: his scale; thrown: StF's fighters' scale for what
 * his throws give them; hands: the shape his op 0x12 picks -> the board's
 * index. Returns his program, actions, reaction kinds and remap for seatGuest. */
export function importFvMoves(R, ctx, fv, A, { who, k, thrown, handShape = (s) => s }) {
    const { program } = R;
    const T = R.guest.tables;
    const report = [];
    const { u32s, u16s } = ctx;
    let far = FV_MOVES_AT;
    const alloc = (b, label, align = 4) => {
        far = (far + align - 1) & ~(align - 1);
        if (far + b.length > FV_MOVES_END) throw new Error(`${who}: his moves do not fit ${hex(FV_MOVES_AT)}..${hex(FV_MOVES_END)}`);
        if (R.main.kept.some(([x, y]) => x < far + b.length && far < y)) throw new Error(`${who}: ${label} at ${hex(far)} runs into something kept`);
        const at = far;
        R.main.put(at, b, `${who} ${label}`);
        far += b.length;
        return MAIN_DATA + at;
    };
    const lost = { playOps: {}, sounds: 0, flagBits: {}, strikeBytes: 0, head860: 0, nativeTails: 0 };
    const tally = (o, x) => { o[x] = (o[x] ?? 0) + 1; };

    const p8 = (a) => fv.maincpu[a], p32 = (a) => fv.mainCpuView.getUint32(a, true);
    const res = (a) => { const r = resolveData(fv, a); if (!r) throw new Error(`${who}: FV ${hex(a)} is not in its data ROMs`); return r; };
    const d8 = (a) => { const r = res(a); return r.data[r.off]; };
    const d32 = (a) => { const r = res(a); return r.view.getUint32(r.off, true); };
    const bytes = (a, n) => { const r = res(a); return r.data.subarray(r.off, r.off + n); };

    /* ---- setups ---- */
    function readSetup(id) {
        const rec = d32(SETUPS + id * 4), setup = [], play = [];
        let p = rec + p8(SETUP_LENGTHS), end;
        for (;;) {
            const op = d8(p);
            if (op === 0 || op === 8) { end = op; p++; break; }
            if (op >= SETUP_OPS) throw new Error(`${who}: motion ${id}: setup op ${hex(op)}`);
            const len = op === 0x10 ? 2 + 2 * d8(p + 1) : p8(SETUP_LENGTHS + op);
            setup.push({ op, b: bytes(p, len) });
            p += len;
        }
        if (end === 8) {
            for (;;) {
                const op = d8(p) & 0x7f;
                if (op === 0) break;
                if (op >= PLAY.length) throw new Error(`${who}: motion ${id}: play op ${hex(op)}`);
                play.push({ op, b: bytes(p, PLAY[op]) });
                p += PLAY[op];
            }
        }
        return { head: bytes(rec, p8(SETUP_LENGTHS)), setup, play, end };
    }
    const u16at = (b, o) => b[o] | (b[o + 1] << 8);
    /* the motions a setup hands over to, and its throw's victim (op 5) */
    const referenced = (s) => {
        const out = [];
        for (const { op, b } of s.setup) {
            if (op === 1 && u16at(b, 1) !== 0xffff) out.push(u16at(b, 1));
            if (op === 5) out.push(u16at(b, 1));
            if (op === 0xa) out.push(u16at(b, 4));
            if (op === 0x13) out.push(u16at(b, 1), u16at(b, 3));
        }
        for (const { op, b } of s.play) if (PLAY_MOTION[op]) out.push(u16at(b, PLAY_MOTION[op]));
        return out.filter((x) => x !== 0xffff).map((x) => x & MOTION_ID).filter((x) => x);
    };

    /* ---- the command program: walk ---- */
    const root = p32(COMMANDS + A.char * 4);
    const units = new Map(), commits = [], natives = [];
    {
        const todo = [[root, 'table']];
        while (todo.length) {
            let [a, kind] = todo.pop();
            if (kind === 'table') {
                if (units.has(a)) continue;
                let h = a;
                for (; p8(h) === 0x0e; h += 7) { units.set(h, { kind: 'header' }); todo.push([p32(h + 3), 'script']); }
                if (!units.has(h) && !units.has(h - 0.5)) units.set(p8(h) === 0 ? h : h - 0.5, { kind: 'end' });
                continue;
            }
            for (;;) {
                const u = units.get(a);
                if (u) { if (u.kind !== 'op') throw new Error(`${who}: ${hex(a)}: a script runs into a table`); break; }
                const op = p8(a);
                if (op >= OP_LENGTH.length) throw new Error(`${who}: command op ${hex(op)} at ${hex(a)}`);
                const len = OP_LENGTH[op];
                units.set(a, { kind: 'op', op, len });
                if (op === 0x0d) todo.push([p32(a + 1), 'table']);
                /* a header's test in a script: the u16 at +1 matched, its script at +3 */
                if (op === 0x0e) todo.push([p32(a + 3), 'script']);
                if (op === 0x0f || op === 0x27) todo.push([p32(a + 1), 'script']);
                if (op === 0x15 && p32(a + 5)) todo.push([p32(a + 5), 'script']);
                if (op === 0x28) { for (const o of [1, 5, 9]) todo.push([p32(a + o), 'script']); break; }
                if (op === 0x11) { todo.push([p32(a + 1), 'script']); break; }
                if (op === 0x13) {
                    todo.push([p32(a + 1), 'script']);
                    natives.push(a);
                    units.get(a).g0 = native(a);
                    break;
                }
                if (op === 0x05 || op === 0x06) { commits.push(a); break; }
                if (op === 0x10 || op === 0x36) break;
                a += len;
            }
        }
    }
    /* The one instruction a native runs before FV's tail: g0, a motion id
     * (vf2-guest.mjs native). */
    function native(a) {
        const code = (a + 5 + 3) & ~3, w = p32(code);
        const opc = ((w >>> 24) << 4) | ((w >>> 7) & 0xf), dst = (w >>> 19) & 0x1f;
        if ((p32(code + 4) & 0xff000003) !== 0x08000000) lost.nativeTails++;
        if ((w >>> 24) === 0x8c && dst === 16 && !(w & 0x1000)) return w & 0xfff;
        if (dst === 16 && (w & 0x1800) === 0x1800) {
            const s1 = w & 0x1f, s2 = (w >>> 14) & 0x1f;
            if (opc === 0x590) return s1 + s2;
            if (opc === 0x59c) return s2 << s1;
        }
        throw new Error(`${who}: native at ${hex(code)}: ${hex(w)}`);
    }

    /* ---- motions: the closure ---- */
    const act = (n) => A.actions[n] & MOTION_ID;
    const reactions = [];
    for (let f = 0; f < REACTION_KINDS; f++) {
        const t = d32(REACTIONS + f * 4), r = [];
        for (let i = 0; i < PER_KIND; i++) { const x = d32(t + i * 4) & MOTION_ID; r.push(x || (f ? reactions[0][i] : 0)); }
        reactions.push(r);
    }
    const FALL = reactions[0][FALL_PLACE];
    const slotMotion = (x, s) => {
        if (s >= RISE_SLOT && s < RISE_SLOT + RISE_SLOTS) return act(RISE_ACTION + s - RISE_SLOT);
        if (typeof x !== 'number') return FALL;
        return FV_ACTION[x] !== undefined ? act(FV_ACTION[x]) : null;
    };
    /* StF's kinds: the first FV kind of each */
    const fvKindOf = new Map();
    FV_KIND.forEach((v, f) => { if (!fvKindOf.has(v)) fvKindOf.set(v, f); });
    const want = new Set([FALL]);
    STF_ACTIONS.forEach((x, s) => { const m = slotMotion(x, s); if (m) want.add(m); });
    for (const n of CRAWL_ACTIONS) if (act(n)) want.add(act(n));
    for (const n of WALK_ACTIONS) if (act(n)) want.add(act(n));
    for (const m of WALK_MOTIONS) want.add(m);
    for (const f of fvKindOf.values()) for (const x of reactions[f]) if (x) want.add(x);
    const commitWord = (a) => p32(a + 1);
    for (const a of commits) {
        const w = commitWord(a), type = w >>> 24;
        if (COMMIT_ACTION[type] !== undefined) { if (act(COMMIT_ACTION[type])) want.add(act(COMMIT_ACTION[type])); }
        else if (w & MOTION_ID) want.add(w & MOTION_ID);
    }
    for (const a of natives) want.add(units.get(a).g0);
    const setups = new Map();
    for (const todo = [...want]; todo.length;) {
        const id = todo.pop();
        if (setups.has(id)) continue;
        if (!(id > 0 && id < MOTION_COUNT)) throw new Error(`${who}: motion ${id}`);
        const s = readSetup(id);
        setups.set(id, s);
        for (const x of referenced(s)) if (!setups.has(x)) todo.push(x);
    }
    const ids = [...setups.keys()].sort((a, b) => a - b);
    /* what his throws give their victim, and what that hands over to */
    const victims = new Set();
    for (const s of setups.values()) for (const { op, b } of s.setup) if (op === 5 && (u16at(b, 1) & MOTION_ID)) victims.add(u16at(b, 1) & MOTION_ID);
    for (const todo = [...victims]; todo.length;) for (const x of referenced(setups.get(todo.pop()))) if (!victims.has(x)) { victims.add(x); todo.push(x); }
    const thrownIds = [...victims].sort((a, b) => a - b);
    const first = ctx.reserveIds(ids.length + thrownIds.length, who);
    const newId = new Map(ids.map((id, i) => [id, first + i]));
    const copyId = new Map(thrownIds.map((id, i) => [id, first + ids.length + i]));
    const mid = (id) => {
        if (id === 0xffff) return id;
        const m = id & MOTION_ID;
        if (!m) return id;
        if (!newId.has(m)) throw new Error(`${who}: motion ${m} has no new id`);
        return (id & ~MOTION_ID) | newId.get(m);
    };
    report.push(`${ids.length} motions as ${first}..${first + ids.length - 1}; ${thrownIds.length} his throws give, copied for StF's fighters`);

    /* ---- setups, StF's way ---- */
    const damages = new Map();
    const damage = (v) => { const d = v && Math.max(1, Math.round(v * DAMAGE)); damages.set(v, d); return d; };
    const put16 = (o, at, v) => { o[at] = v & 0xff; o[at + 1] = (v >> 8) & 0xff; };
    let trails = 0;
    function convertSetup(id) {
        const s = setups.get(id), h = s.head;
        /* of kind2 (bytes 4..7) only bit 5, the armour breaker, means the same to StF */
        const out = [h[0], h[1], h[2], h[3], h[4] & 0x20, 0, 0, 0, h[8], h[9], h[10], h[11], 0];
        if ((h[4] & ~0x20) | h[5] | h[6] | h[7]) lost.head860++;
        for (const { op, b } of s.setup) {
            const o = [...b];
            switch (op) {
            /* [4, attack, ?, damage, ...0x0D] as StF's; FV's effects (+0xE..+0x12) out, StF's float in.
             * The damage stays FV's: the board's attack_hit takes FV's knockback from it and
             * scales what comes off the bar (tools/lift-stf.py, loc_2B898_fv, fb_bar_fv).
             * FV's byte 0xE (its knock-down lift) rides in the float's low byte (FV_HIT). */
            case 4:
                o.length = 0xe;
                o[7] = FV_KIND[b[7]] ?? b[7];
                if (b[0xf] | b[0x10] | b[0x11] | b[0x12]) lost.strikeBytes++;
                o.push(...f32(2.0));
                o[0xe] = b[0xe] & 7;
                break;
            case 5: put16(o, 1, mid(u16at(b, 1))); o[3] = damage(b[3]); break;
            case 3: o.splice(7, 4, ...f32(new DataView(b.buffer, b.byteOffset + 7, 4).getFloat32(0, true) * k)); break;
            case 1: put16(o, 1, mid(u16at(b, 1))); break;
            case 0xa: put16(o, 4, mid(u16at(b, 4))); break;
            case 0x13: put16(o, 1, mid(u16at(b, 1))); put16(o, 3, mid(u16at(b, 3))); break;
            default:
            }
            out.push(...o);
        }
        const st = s.setup.find((x) => x.op === 4), win = s.setup.find((x) => x.op === 2);
        const trail = st && win ? strikeTrail(program, st.b[1], u16at(win.b, 1), u16at(win.b, 3)) : null;
        if (trail) trails++;
        out.push(trail ? 8 : s.end);
        if (s.end === 8 || trail) {
            const at = (o) => o[1] | (o[2] << 8);
            const ons = trail ? [trailOp(trail.on, trail.mask), trailOp(trail.off, 0)] : [];
            const put = (o) => { while (ons.length && at(ons[0]) <= at(o)) out.push(...ons.shift()); out.push(...o); };
            for (const { op, b } of s.end === 8 ? s.play : []) {
                const to = op in PLAY_TO ? PLAY_TO[op] : op;
                if (to === null) { tally(lost.playOps, hex(op)); continue; }
                if (op === 4) { lost.sounds++; continue; }
                if (op === 5 && !STF_FLAG_BITS.has(b[3])) { tally(lost.flagBits, b[3]); continue; }
                if (to === 'hand') {
                    put([0x10 | (b[0] & 0x80), b[1], b[2], b[3] === 1 ? 5 : 8, handShape(b[4])]);
                    continue;
                }
                const o = [...b];
                o[0] = to | (b[0] & 0x80);
                if (PLAY_MOTION[op]) put16(o, PLAY_MOTION[op], mid(u16at(b, PLAY_MOTION[op])));
                if (op === 8) o[3] = damage(b[3]);
                put(o);
            }
            for (const o of ons) out.push(...o);
            out.push(0);
        }
        return Uint8Array.from(out);
    }

    const motions = T.offset_list_motions, setupT = T.animation_related;
    let motionBytes = 0;
    const blockOf = (id) => {
        const r = res(d32(MOTIONS + id * 4)), d = r.data, off = r.off;
        const types = [];
        for (let j = 0; j < 20; j++) {
            const x = d[off + 2 + j], top2 = (x >> 6) & 3;
            for (let a = 0; a < 3; a++) types.push(top2 === 0 ? ((x >> (a * 2)) & 3) + 3 : top2 - 1);
        }
        const counts = [];
        let n = 0;
        for (const t of types) counts.push(t === 5 || t === 6 ? d[off + 22 + n++] : 0);
        let p = (22 + n + 3) & ~3;
        types.forEach((t, i) => { if (t === 5 || t === 6) p += counts[i] * 4; });
        types.forEach((t, i) => { p += t === 3 ? 0 : t === 5 ? counts[i] * 4 : t === 6 ? counts[i] * 12 : 4; });
        return d.slice(off, off + p);
    };
    for (const id of ids) {
        const block = scaleMotion(blockOf(id), [k, k, k]);
        motionBytes += block.length;
        motions.view.setUint32(newId.get(id) * 4, alloc(block, `motion ${id}`), true);
        setupT.view.setUint32(newId.get(id) * 4, alloc(convertSetup(id), `setup ${id}`, 1), true);
    }
    for (const id of thrownIds) {
        const block = scaleMotion(blockOf(id), thrown);
        motionBytes += block.length;
        motions.view.setUint32(copyId.get(id) * 4, alloc(block, `thrown motion ${id}`), true);
        setupT.view.setUint32(copyId.get(id) * 4, setupT.view.getUint32(newId.get(id) * 4, true), true);
        ctx.theirCopy(newId.get(id), copyId.get(id));
    }
    report.push(`motion blocks ${motionBytes} bytes, setups at ${hex(MAIN_DATA + FV_MOVES_AT)}..; ${trails} strikes trail`);
    report.push(`damage x140/200: ${[...damages].sort((a, b) => a[0] - b[0]).map(([v, d]) => `${v}->${d}`).join(', ')}`);

    /* ---- the command program ---- */
    const order = [...units.keys()].sort((a, b) => a - b);
    const progAt = MAIN_DATA + ((far + 3) & ~3);
    const where = new Map();
    {
        let at = progAt;
        for (const a of order) {
            const u = units.get(a);
            where.set(a, at);
            if (u.kind === 'header') at += 7;
            else if (u.kind === 'end') at += 1;
            else if (u.op === 0x13) at = ((at + 5 + 3) & ~3) + 12;
            else at += u.len;
        }
    }
    const prog = [];
    const here = () => progAt + prog.length;
    const whereOf = (t) => where.get(t) ?? where.get(t - 0.5);
    const reloc = (o, b) => {
        const t = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
        const n = whereOf(t);
        if (n === undefined) throw new Error(`${who}: command program: ${hex(t)} is not a unit`);
        b.set(le32(n), o);
    };
    let asAction = 0;
    for (const a of order) {
        const u = units.get(a);
        if (here() !== where.get(a)) throw new Error(`${who}: command program out of step at ${hex(a)}`);
        if (u.kind === 'end') { prog.push(0); continue; }
        const b = Uint8Array.from(fv.maincpu.subarray(a, a + (u.kind === 'header' ? 7 : u.len)));
        if (u.kind === 'header') { reloc(3, b); prog.push(...b); continue; }
        switch (u.op) {
        case 0x05: case 0x06: {
            const w = commitWord(a), type = w >>> 24;
            let nw;
            if (COMMIT_ACTION[type] !== undefined) { nw = mid(act(COMMIT_ACTION[type])); asAction++; }
            else if (COMMIT_TYPE[type] !== undefined) nw = ((COMMIT_TYPE[type] << 24) | mid(w & 0xffffff)) >>> 0;
            else throw new Error(`${who}: commit type ${hex(type)} at ${hex(a)}`);
            b.set(le32(nw), 1);
            prog.push(...b);
            break;
        }
        case 0x13:
            reloc(1, b);
            prog.push(...b.subarray(0, 5));
            while (here() & 3) prog.push(0);
            prog.push(...le32((0x8c800000 | mid(u.g0)) >>> 0), ...le32(0x84003000), ...le32(R.guest.nativeTail));
            break;
        default:
            reachAt(b, u.op, k);
            if ([0x0d, 0x0f, 0x27, 0x11].includes(u.op)) reloc(1, b);
            if (u.op === 0x0e) reloc(3, b);
            if (u.op === 0x28) for (const o of [1, 5, 9]) reloc(o, b);
            if (u.op === 0x15 && p32(a + 5)) reloc(5, b);
            prog.push(...b);
        }
    }
    if (alloc(Uint8Array.from(prog), 'command program') !== progAt) throw new Error(`${who}: command program moved`);
    const moves = whereOf(root);
    report.push(`command program ${hex(progAt)}, ${prog.length} bytes (${units.size} units, ${commits.length} commits, ${asAction} as an action's motion, ${natives.length} natives)`);

    /* ---- action slots ---- */
    const actions = [...ctx.actions];
    const changed = new Map();
    STF_ACTIONS.forEach((x, s) => {
        const m = slotMotion(x, s);
        if (!m) return;
        actions[s] = (actions[s] & ~MOTION_ID) | mid(m);
        changed.set(s, mid(m));
    });
    CRAWL_ACTIONS.forEach((n, i) => {
        if (!act(n)) return;
        actions[53 + i] = (actions[53 + i] & ~MOTION_ID) | mid(act(n));
        changed.set(53 + i, mid(act(n)));
    });
    /* 61..66 with his flags; 67..70 flagless, as FV's lda plays them */
    WALK_ACTIONS.forEach((n, i) => { actions[61 + i] = mid(A.actions[n]); });
    WALK_MOTIONS.forEach((m, i) => { actions[61 + WALK_ACTIONS.length + i] = mid(m); });
    const actionsAt = alloc(u16s(actions), 'actions');
    report.push(`action slots: ${changed.size} of ${actions.length} his own`);

    /* ---- reactions: his lists for StF's kinds FV has, Akira's for the rest ---- */
    const tail = (kk) => [41, 42, 43].map((i) => program.u32(program.u32(ctx.knuxKinds + kk * 4) + i * 4));
    const own = new Map();
    const kinds = ctx.kinds.map((akira, kk) => {
        if (!fvKindOf.has(kk)) return akira;
        const r = reactions[fvKindOf.get(kk)];
        const list = [...r.map(mid), mid(r[16]), ...tail(kk)];
        own.set(kk, list);
        return alloc(u32s(list), `reactions ${kk}`);
    });
    const kindsAt = alloc(u32s(kinds), 'reaction kinds');
    report.push(`reactions: ${own.size} of ${kinds.length} kinds his own`);

    /* ---- motion_remap: his for StF's ids, then Akira's ---- */
    const top = first + ids.length + thrownIds.length;
    const remap = new Array(Math.max(top, ctx.own.length)).fill(0);
    const stfId = (x) => x & MOTION_ID;
    const put = (from, to) => { if (from && from < 519 && !remap[from]) remap[from] = stfId(to); };
    for (const x of [225, 262, 270, 334]) put(x, mid(FALL));
    for (const [s, m] of changed) put(stfId(program.u16(ctx.knuxActions + s * 2)), m);
    for (const [kk, list] of own) {
        const stfList = program.u32(ctx.knuxKinds + kk * 4);
        for (let i = 0; i < 41; i++) put(stfId(program.u32(stfList + i * 4)), list[i]);
    }
    ctx.own.forEach((x, i) => { if (x && !remap[i]) remap[i] = x; });
    const remapAt = alloc(u16s(remap), 'motion remap');
    report.push(`his moves at ${hex(MAIN_DATA + FV_MOVES_AT)}..${hex(MAIN_DATA + far)}`);

    const coverage = {
        motions: ids.length, thrownCopies: thrownIds.length, firstMotion: first, actionSlots: changed.size, reactionKinds: own.size,
        commandUnits: units.size, commits: commits.length, commitsAsAction: asAction, natives: natives.length,
        programBytes: prog.length, trails, damage: Object.fromEntries(damages), lost,
    };
    return { report, coverage, moves, actionsAt, kindsAt, remapAt, newId, copyId, range: [FV_MOVES_AT, far] };
}
