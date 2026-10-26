/*
 * A Fighters Megamix (Saturn) fighter's own moves on the Sonic the Fighters
 * board: his motions, their setups, his command script, his action slots
 * and his reactions, from FM's files (tools/fm-saturn.mjs,
 * docs/FM-SATURN.md), put in after Akira's (tools/vf2-guest.mjs) the way
 * Akira's are. FM's engine is VF2's, a generation on, so most of it maps
 * one to one; what does not is left out and counted in `lost`
 * (docs/BOARD.md, "The guest: Daytona's Hornet", "His moves").
 *
 *   - motions: FM's blocks as VF2's (toVF2, encodeVF2), at Akira's scale
 *     (scaleMotion), under new ids after Akira's. An id in both his bank and
 *     the common one (352) is the common one's, as FM's directory has it.
 *   - setups (FM's set_mot_dat, 0x0601352C): the head's kind word and two
 *     bytes; op 1 (the next motion), op 2 (the attack's frames), op 3 and
 *     op 4 (a strike) in StF's layout. The rest, and every play op (sounds,
 *     effects, flags), are left out. Each strike gets StF's afterimage, as
 *     Akira's do.
 *   - his command script (file 9) into StF's command program, op for op:
 *     FM's runs a stream the way StF's does (0x0E: a goto on the key,
 *     0x0F/0x27 an alternative, 0x10 the end), its offsets relocated.
 *     Throws (kind 0x10) and the throw escapes fail: StF's throw code wants
 *     the victim's motions in his setups (op 5), which this does not make.
 *   - action slots: StF's 52, each from the FM slot that plays what Akira's
 *     VF2 slot does (VF2_SLOT); the ones FM has no match for stay Akira's.
 *   - reactions (FM's 28 kinds of 44 at 0x06062A84, VF2's layout: category
 *     × 8 + side/crouch) under VF2's kind (FM_KIND); a kind FM has none of
 *     stays Akira's.
 */
import * as FM from './fm-saturn.mjs';
import { encodeVF2 } from './shenmue-motion.mjs';
import { SCALE, MOTION_ID, COMMIT_TYPE, STF_ACTIONS, DAMAGE, scaleMotion, strikeTrail, trailOp } from './vf2-guest.mjs';

const PLAYER2 = 26;
const MAIN_DATA = 0x02000000;
/* The guests' heap is full up to VF2's skies (vf2-stages.mjs VF2_SKY_AT), so
 * his moves (motions, setups, program, tables) go in main_data's room from
 * 0x780000, above FV's skies (fv-stages.mjs FV_SKY_AT..FV_SKY_END): StF data
 * the board does not keep, so nothing reads it. */
export const FM_MOTIONS_AT = 0x780000, FM_MOTIONS_END = 0x800000;
/* FM's reaction pick (0x06023BBC): byte 0x661 & 0x7F, the strike's kind,
 * names one of 28 lists of 44 motion ids (0x06062A84; 0x06062AF4 while
 * 0x0609FB5C is set, which nothing here plays), index category × 8 + side
 * and crouch, category 5 at 40. */
export const FM_REACTIONS = 0x06062a84, FM_REACTION_KINDS = 28, FM_REACTION_LEN = 44;
/* Each FM kind's VF2 kind, by its lists: VF2's 30 at 0x0201CCFC have the
 * same layout, and an FM kind is the VF2 one whose guard and hit motions
 * are FM's same ones (FM 0x224/0x225 VF2 0xED/0xEE, 0x220/0x221 0xEB/0xEC,
 * 0x214..0x217 0xE0..0xE3, 0x26B..0x27B 0xFB..0x10A, 0x69C 0x2CE). FM 10 is
 * VF2 11 by a strike both games have (FM Akira 0x6DA, VF2's 139). */
export const FM_KIND = [5, 1, 2, 3, 4, 4, 4, 0, 6, 7, 11, 25, 13, 16, 1, 14, 21, 28, 12, 12, 11, 6, 13, 13, 13, 15, 27, 8];
/* VF2's action slots (STF_ACTIONS' numbers) and FM's slot that plays the
 * same (FM Akira's slot motion matched to VF2 Akira's, key for key). */
export const VF2_SLOT = {
    0: 0, 3: 2, 4: 5, 7: 7, 8: 12, 9: 15, 10: 16, 11: 19, 12: 20, 13: 21, 14: 22, 15: 24, 16: 26, 17: 27,
    20: 31, 21: 33, 22: 36, 23: 34, 24: 37, 25: 38, 26: 39, 27: 40, 31: 49, 81: 41, 82: 42, 83: 43,
};
/* VF2's falls (0x2CE: STF_ACTIONS 38, 39 and the knock-downs) are FM's 0x69C. */
const FALL = 0x69c;
/* The kinds StF has no type for that play one of his action slots (FM
 * Slots: 0x1A the dashes 22/23, 0x13 24/25, 0x1D 26, 0x1E 27/28). */
const COMMIT_SLOT = { 0x12: 22, 0x13: 24, 0x1a: 22, 0x1d: 26, 0x1e: 27 };
const THROW = 0x10, BUTTON8 = 0x31, PLAY_ONLY = 0x2d;
/* A test that always fails: 0x16, the key is 0xFFFF (none is). */
const FAIL = [0x16, 0xff, 0xff];
/* FM's fighter flags in StF's bits, where the counts and the moves that
 * test them match (FM Akira's script against VF2 Akira's). */
const EN_BITS = { 0x1: 0, 0x2: 8, 0x20: 0xb };          /* +0x4A4 -> 0x5B8 */
const ROB_BITS = { 0x10: 8 };                            /* +0 -> +0 */
/* FM's motion frame fields (op 2's, +0x644..+0x648) as StF's (0x808..0x80C). */
const FRAMES = { 0x644: 0x808, 0x646: 0x80a, 0x648: 0x80c };

const hex = (v) => '0x' + v.toString(16).toUpperCase();
const bit = (m) => (m && !(m & (m - 1)) ? 31 - Math.clz32(m) : -1);
const le16 = (v) => [v & 0xff, (v >> 8) & 0xff];
const le32 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24];
const f32 = (x) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x, true); return [...b]; };

/** FM's 28 reaction lists of 44 motion ids. */
export function readReactions(game) {
    const p = game.at(FM_REACTIONS);
    return Array.from({ length: FM_REACTION_KINDS }, (_, k) => {
        const t = game.at(game.prg.readUInt32BE(p + k * 4));
        return Array.from({ length: FM_REACTION_LEN }, (_, i) => game.prg.readUInt16BE(t + i * 2));
    });
}

/* R: import-assets' regions; ctx: importAkira's (its heap and tables,
 * Akira's actions, reactions and remap); game, fighter: fm-saturn.mjs
 * readGame and the row. Returns his command program, actions, reaction
 * kinds and remap for seatGuest. */
export function importFmMoves(R, ctx, game, fighter, { who = 'Hornet' } = {}) {
    const { program } = R;
    const T = R.guest.tables;
    const report = [];
    let far = FM_MOTIONS_AT;
    const alloc = (b, label, align = 4) => {
        far = (far + align - 1) & ~(align - 1);
        if (far + b.length > FM_MOTIONS_END) throw new Error(`${who}: his moves do not fit 0x${FM_MOTIONS_AT.toString(16)}..0x${FM_MOTIONS_END.toString(16)}`);
        if (R.main.kept.some(([x, y]) => x < far + b.length && far < y)) throw new Error(`${who}: ${label} at 0x${far.toString(16)} runs into something kept`);
        const at = far;
        R.main.put(at, b, `${who} ${label}`);
        far += b.length;
        return MAIN_DATA + at;
    };
    const { u32s, u16s } = ctx;
    const lost = { endsClamped: 0, freedAt: 0, setupOps: {}, playOps: 0, scriptOps: {}, strikeBytes: 0, motionFlags: 0, throws: 0, escapes: 0, button8: 0, airChecks: 0, followSwitch: 0 };
    const tally = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

    /* ---- his motions: the directory, the closure ---- */
    const banks = [FM.COMMON_MOTIONS, fighter.motions].map((n) => {
        const buf = game.archive(n);
        return { n, buf, rows: new Map(FM.readBank(buf).map((r) => [r.id, r])) };
    });
    const rowOf = (id) => {
        for (const b of banks) if (b.rows.has(id)) return { bank: b, row: b.rows.get(id) };
        throw new Error(`${who}: motion ${hex(id)} is in neither bank`);
    };
    const slots = FM.readActions(game, fighter).map((x) => x & 0xfff);
    const reactions = readReactions(game);
    const script = game.archive(fighter.file9);
    const ops = FM.readScript(script);
    const moveOf = (o) => (o.op === 0x05 || o.op === 0x06 || o.op === 0x32 ? o.bytes.readUInt32BE(4) : null);
    const slotOfKind = (kind) => COMMIT_SLOT[kind];
    /* VF2's kinds that have an FM kind: the first FM kind of each */
    const fmKindOf = new Map();
    FM_KIND.forEach((v, f) => { if (!fmKindOf.has(v)) fmKindOf.set(v, f); });
    const reactionList = (f) => reactions[f].map((x, i) => x || reactions[FM_KIND.indexOf(0)][i]);

    const want = new Set([FALL]), committed = new Set();
    for (const x of STF_ACTIONS) if (typeof x === 'number' && VF2_SLOT[x] !== undefined) want.add(slots[VF2_SLOT[x]]);
    for (const f of fmKindOf.values()) for (const x of reactionList(f)) if (x) want.add(x & 0xfff);
    for (const o of ops) {
        const w = moveOf(o);
        if (w === null) continue;
        const kind = w >>> 24;
        if (kind === THROW || kind === BUTTON8) continue;
        if (slotOfKind(kind) !== undefined) want.add(slots[slotOfKind(kind)]);
        else if (w & 0xfff) { want.add(w & 0xfff); committed.add(w & 0xfff); }
    }
    const setups = new Map();
    for (const todo = [...want]; todo.length;) {
        const id = todo.pop();
        if (setups.has(id)) continue;
        const { bank, row } = rowOf(id);
        const s = FM.readSetup(bank.buf, row.setup);
        setups.set(id, { ...s, bank, row });
        for (const { op, b } of s.setup) if (op === 1) {
            const next = b.readUInt16BE(2);
            if (next !== 0xffff && next & 0xfff && !setups.has(next & 0xfff)) todo.push(next & 0xfff);
        }
    }
    const ids = [...setups.keys()].sort((a, b) => a - b);
    const first = ctx.reserveIds(ids.length, who), top = first + ids.length;
    const newId = new Map(ids.map((id, i) => [id, first + i]));
    const hid = (id) => {
        if (!(id & 0xfff)) return 0;
        if (id & 0xf000) lost.motionFlags++;
        const n = newId.get(id & 0xfff);
        if (n === undefined) throw new Error(`${who}: motion ${hex(id)} has no new id`);
        return n;
    };
    report.push(`${ids.length} motions (${ids.filter((id) => rowOf(id).bank.n === fighter.motions).length} his bank's, the rest the common one's), ${first}..${top - 1}`);

    /* ---- setups, StF's way ---- */
    const damages = new Map();
    const damage = (v) => { const d = v && Math.max(1, Math.round(v * DAMAGE)); damages.set(v, d); return d; };
    let trails = 0;
    function convertSetup(id) {
        const s = setups.get(id), h = s.head;
        /* the head: FM's kind word (+0) is StF's 0x804, its +8 and +9 StF's 0x810 and 0x814 */
        const out = [h[3], h[2], h[1], h[0], 0, 0, 0, 0, h[8], 0, h[9], 0, 0];
        let strike = null, win = null;
        for (const { op, b } of s.setup) {
            const u16 = (o) => b.readUInt16BE(o);
            switch (op) {
            case 1: out.push(1, ...le16(u16(2) === 0xffff ? 0xffff : hid(u16(2)))); break;
            /* FM's frame runs on past the block (its end is up to 33 frames
             * after the last); StF's holds at the last, which then never
             * reaches the end, so the three end there at the latest */
            case 2: {
                const f = s.row.frames, [hit, cancel, end] = [2, 4, 6].map((o) => Math.min(u16(o), f));
                if (u16(6) > f) lost.endsClamped++;
                out.push(2, ...le16(hit), ...le16(cancel), ...le16(end));
                win = [hit, cancel];
                break;
            }
            /* +2, +4, +6 (0x80E, 0x816, 0x818), +8 16.16 (0x81C, VF2's float, scaled as Akira's), b1 (0x83F), +0xC (0x850) */
            case 3: out.push(3, ...le16(u16(2)), ...le16(u16(4)), ...le16(u16(6)), ...f32((b.readInt32BE(8) / 65536) * SCALE), b[1], ...le16(u16(0xc))); break;
            /* [4, part, damage, level][u16 angle][u16 kind word][b8 -> 0x823][b9 -> 0x843][b10, b11] */
            case 4: {
                const kw = u16(6);
                if (b[10] || b[11] || b[3] >> 4 || kw & 0x80) lost.strikeBytes++;
                out.push(4, b[1], b[3] & 0xf, damage(b[2]), 0, ...le16(u16(4)), FM_KIND[kw & 0x7f], kw >> 8, b[8], b[9], 0, 0, 0, ...f32(2.0));
                strike = b[1];
                break;
            }
            default: tally(lost.setupOps, hex(op));
            }
        }
        /* A move with no op 2 (no frames): FM frees it with op 0x12 (+0x6A4,
         * +0x68E, +0x6A8: at frame +0x6A8 0x06011C98 sets +2 bit 6, which
         * lets the script go on), StF only at op 2's end, without which it
         * holds the last frame for good. So it ends there, or at its last. */
        if (committed.has(id) && !s.setup.some((x) => x.op === 2)) {
            const free = s.setup.find((x) => x.op === 0x12);
            const f = Math.min(free ? free.b.readUInt16BE(6) : s.row.frames, s.row.frames);
            out.push(2, ...le16(f), ...le16(f), ...le16(f));
            lost.freedAt++;
        }
        lost.playOps += s.play.length;
        const trail = strike !== null && win ? strikeTrail(program, strike, win[0], win[1]) : null;
        if (!trail) { out.push(0); return Uint8Array.from(out); }
        trails++;
        out.push(8, ...trailOp(trail.on, trail.mask), ...trailOp(trail.off, 0), 0);
        return Uint8Array.from(out);
    }

    const motions = T.offset_list_motions, setupT = T.animation_related;
    let motionBytes = 0;
    for (const id of ids) {
        const { bank, row } = setups.get(id);
        const block = scaleMotion(Uint8Array.from(encodeVF2(FM.toVF2(FM.decodeFM(bank.buf, row.data)))));
        motionBytes += block.length;
        motions.view.setUint32(newId.get(id) * 4, alloc(block, `motion ${hex(id)}`), true);
        setupT.view.setUint32(newId.get(id) * 4, alloc(convertSetup(id), `setup ${hex(id)}`, 1), true);
    }
    report.push(`motion blocks ${motionBytes} bytes and their setups at ${hex(MAIN_DATA + FM_MOTIONS_AT)}..${hex(MAIN_DATA + far)}; ${trails} strikes trail`);
    report.push(`damage x140/200: ${[...damages].sort((a, b) => a[0] - b[0]).map(([v, d]) => `${v}->${d}`).join(', ')}`);

    /* ---- the command script ---- */
    let commits = 0;
    const commit = (w) => {
        const kind = w >>> 24, param = (w >> 16) & 0xff;
        if (kind === THROW) { lost.throws++; return null; }
        if (kind === BUTTON8) { lost.button8++; return null; }
        commits++;
        if (slotOfKind(kind) !== undefined) return hid(slots[slotOfKind(kind)]);
        if (kind === PLAY_ONLY) return hid(w & 0xffff);
        if (COMMIT_TYPE[kind] === undefined) throw new Error(`${who}: move kind ${hex(kind)}`);
        return ((COMMIT_TYPE[kind] << 24) | (param << 16) | hid(w & 0xffff)) >>> 0;
    };
    /* the throw escapes' script (0x43..0x48: what a throw's victim may do) and a follow-up's motion switch (0x4A, 0x4E) */
    const units = ops.map((o) => {
        const b = o.bytes, u32 = (x) => b.readUInt32BE(x), out = [], relocs = [];
        const to = (t) => { relocs.push([out.length, t]); out.push(0, 0, 0, 0); };
        const flag = (map, set) => {
            const m = u32(4), n = map ? map[m] : bit(m);
            if (n !== undefined && n >= 0) out.push(o.op, n);
            else { tally(lost.scriptOps, `${hex(o.op)} ${hex(m)}`); if (set) out.push(...FAIL); }
        };
        switch (o.op) {
        case 0x0e: {
            const key = u32(4);
            if (key > 0xffff) throw new Error(`${who}: key ${hex(key)} at ${hex(o.at)}`);
            out.push(0x0e, ...le16(key)); to(u32(8));
            break;
        }
        case 0x00: case 0x01: out.push(o.op, b[3], b[2]); break;
        case 0x02: case 0x2b: {
            const w = b.readUInt16BE(2), n = w === 0x100 ? 8 : w === 0x200 ? 9 : bit(w);
            if (n < 0) throw new Error(`${who}: stick ${hex(w)} at ${hex(o.at)}`);
            out.push(o.op, n, ...(o.op === 0x2b ? [0] : []));
            break;
        }
        case 0x03: out.push(3, b[3], b[2], b[1]); break;
        case 0x04: out.push(4, b[1]); break;
        case 0x05: case 0x06: case 0x32: {
            const w = commit(u32(4));
            if (w === null) { out.push(...FAIL); break; }
            if (o.op === 0x32) lost.airChecks++;
            out.push(o.op === 0x06 ? 6 : 5, ...le32(w), ...(o.op === 0x06 ? [] : [0, 0, 0, 0]));
            break;
        }
        case 0x0d: out.push(0x0d); to(u32(4)); break;
        case 0x38: out.push(0x36); to(u32(4)); break;
        case 0x0f: case 0x3f: case 0x40: out.push(0x0f); to(u32(4)); break;
        case 0x27: out.push(0x27); to(u32(4)); break;
        case 0x11: out.push(0x11); to(u32(4)); break;
        case 0x28: out.push(0x28); to(u32(4)); to(u32(8)); to(u32(12)); break;
        case 0x10: case 0x17: case 0x18: out.push(o.op); break;
        case 0x12: case 0x1d: {
            const field = FRAMES[b.readUInt16BE(2)];
            if (field === undefined) throw new Error(`${who}: frame field ${hex(b.readUInt16BE(2))} at ${hex(o.at)}`);
            let n = b.readInt8(1);
            if (n >= 100) n -= 100;
            out.push(o.op, ...le16(field), n & 0xff);
            break;
        }
        case 0x1a: case 0x1b: out.push(o.op, ...f32(b.readInt32BE(4) / 65536)); break;
        case 0x20: out.push(0x20, b[1]); break;
        case 0x07: flag(EN_BITS, true); break;
        case 0x0a: flag(EN_BITS, false); break;
        case 0x08: if (u32(4) === 0x10000000) tally(lost.scriptOps, '0x8 0x10000000'); else flag(ROB_BITS, true); break;
        case 0x0b: if (u32(4) === 0x10000000) { tally(lost.scriptOps, '0xB 0x10000000'); out.push(...FAIL); } else flag(ROB_BITS, false); break;
        case 0x09: case 0x0c: case 0x2a: flag(null, o.op !== 0x0c); break;
        case 0x1c: case 0x36: case 0x3a: tally(lost.scriptOps, hex(o.op)); out.push(...FAIL); break;
        case 0x37: case 0x39: case 0x3b: case 0x4f: tally(lost.scriptOps, hex(o.op)); break;
        case 0x43: case 0x44: case 0x45: case 0x46: case 0x47: case 0x48: lost.escapes++; out.push(...FAIL); break;
        case 0x4a: case 0x4e: lost.followSwitch++; out.push(...FAIL); break;
        default: throw new Error(`${who}: script op ${hex(o.op)} at ${hex(o.at)}`);
        }
        return { at: o.at, out, relocs };
    });
    const progAt = MAIN_DATA + ((far + 3) & ~3);
    const where = new Map();
    let at = progAt;
    for (const u of units) { where.set(u.at, at); at += u.out.length; }
    const prog = [];
    for (const u of units) {
        for (const [o, t] of u.relocs) {
            const n = where.get(t);
            if (n === undefined) throw new Error(`${who}: ${hex(u.at)} jumps to ${hex(t)}, not an op`);
            u.out.splice(o, 4, ...le32(n));
        }
        prog.push(...u.out);
    }
    if (alloc(Uint8Array.from(prog), 'command program') !== progAt) throw new Error(`${who}: command program moved`);
    const moves = where.get(0);
    report.push(`command program ${hex(progAt)}, ${prog.length} bytes from ${ops.length} ops (${commits} moves; ${lost.throws} throws, ${lost.escapes} escape tests fail)`);

    /* ---- action slots ---- */
    const actions = [...ctx.actions];
    const changed = new Map();
    STF_ACTIONS.forEach((x, s) => {
        const m = typeof x === 'number' ? (VF2_SLOT[x] !== undefined ? slots[VF2_SLOT[x]] : null) : FALL;
        if (m === null) return;
        actions[s] = (actions[s] & ~MOTION_ID) | hid(m);
        changed.set(s, hid(m));
    });
    const actionsAt = alloc(u16s(actions), 'actions');
    report.push(`action slots: ${changed.size} of ${actions.length} his own, the rest Akira's`);

    /* ---- reactions: his lists for the VF2 kinds FM has, Akira's for the rest ---- */
    const tail = (k) => [41, 42, 43].map((i) => program.u32(program.u32(ctx.knuxKinds + k * 4) + i * 4));
    const own = new Map();
    const kinds = ctx.kinds.map((akira, k) => {
        if (!fmKindOf.has(k)) return akira;
        const r = reactionList(fmKindOf.get(k));
        const list = [...r.slice(0, 40).map(hid), hid(r[40]), ...tail(k)];
        own.set(k, list);
        return alloc(u32s(list), `reactions ${k}`);
    });
    const kindsAt = alloc(u32s(kinds), 'reaction kinds');
    report.push(`reactions: ${own.size} of ${kinds.length} kinds his own (FM's ${[...own.keys()].map((k) => fmKindOf.get(k)).join(',')})`);

    /* ---- motion_remap: his for StF's ids, then Akira's ---- */
    const remap = new Array(top).fill(0);
    const stfId = (x) => x & MOTION_ID;
    const put = (from, to) => { if (from && from < first && !remap[from]) remap[from] = stfId(to); };
    for (const x of [225, 262, 270, 334]) put(x, hid(FALL));
    for (const [s, m] of changed) put(stfId(program.u16(ctx.knuxActions + s * 2)), m);
    for (const [k, list] of own) {
        const stfList = program.u32(ctx.knuxKinds + k * 4);
        for (let i = 0; i < 41; i++) put(stfId(program.u32(stfList + i * 4)), list[i]);
    }
    ctx.own.forEach((x, i) => { if (x && !remap[i]) remap[i] = x; });
    const remapAt = alloc(u16s(remap), 'motion remap');

    const coverage = {
        motions: ids.length, firstMotion: first, actionSlots: changed.size, reactionKinds: own.size,
        scriptOps: ops.length, commits, programBytes: prog.length, trails, damage: Object.fromEntries(damages), lost,
    };
    return { report, coverage, moves, actionsAt, kindsAt, remapAt, newId };
}

export { PLAYER2 };
