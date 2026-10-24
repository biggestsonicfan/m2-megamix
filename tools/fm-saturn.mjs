/*
 * Fighters Megamix (Saturn, the prototype of Apr 08, 1997) fighters' data
 * off the disc's data track, and their motions as Virtua Fighter 2 motion
 * blocks, the format Megamix's board plays (docs/FM-SATURN.md). FM's
 * motions are VF2's keyframes, key for key, in the Saturn's own fixed point:
 * 19 objects (VF3's layout without the shoulders) onto VF2's 20, VF2's
 * pelvis look (object 17) the usual latched (0, 0, 16384).
 *
 *   node tools/fm-saturn.mjs [--disc Track01.bin] --fighters
 *   node tools/fm-saturn.mjs [--disc ...] <fighter> --list | --bones | --actions
 *   node tools/fm-saturn.mjs [--disc ...] <fighter> --pose <motion id> [frame]
 *   node tools/fm-saturn.mjs [--disc ...] <fighter> <motion id> [--json] [--out block.bin]
 *   node tools/fm-saturn.mjs [--disc ...] --file <n> --out file.bin
 *
 * <fighter> is a row of the character table (0..31) or its name (hornet);
 * the motion id is the bank's (hex, 0x11c). What changes on the way
 * (docs/FM-SATURN.md, "FM to VF2"):
 *   - positions: FM's are 1/1024 m, z negated;
 *   - angles: 1024 a turn (VF2 65536: ×64), axes (x, y, z) to VF2's
 *     (-z, y, x);
 *   - tangents: FM's are per frame, VF2's per 1/30 s: ×30;
 *   - time: the same 60 fps, keys at the same frames.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeVF2 } from './shenmue-motion.mjs';
import { sampleMotion } from '../vendor/noclip/js/motion.js';
import { buildPose, SLOT_COUNT, SLOT_NAMES, SLOT_PARENT } from '../vendor/noclip/js/pose.js';

export { SLOT_NAMES, SLOT_PARENT };

export const DEFAULT_DISC = `${process.env.HOME}/source/repos/ai/Fighters Megamix (Prototype - Apr 08, 1997)/Track01.bin`;

/* VF2's channel types (noclip motion.js) */
const LATCHED = 1, ZERO = 3, CONST = 4, LINEAR = 5, HERMITE = 6;
const TANGENT_RATE = 30;

/* 1ST_READ.DAT loads at 0x06004000; its tables */
const LOAD = 0x06004000;
const FILE_TABLE = 0x060816c0, FILE_COUNT = 396;     /* {u16 sectors, u16 sector} in FMM_DATA.DAT */
const CHAR_TABLE = 0x06081cf0, CHAR_ROW = 0x1c;      /* 14 s16 per fighter */
const FIGHTER_TABLE = 0x0608ddb0, FIGHTER_ROW = 0x28; /* bones, actions, ... per fighter */
const ACTIONS = 66, BONES = 15;

export const NAMES = ['grace', 'bahn', 'raxel', 'tokio', 'sanman', 'jane', 'honey', 'picky',
    'mahler', 'deku', 'kuma', 'bean', 'bark', 'uraban', 'hornet', 'bm', 'akira', 'pai', 'lau',
    'wolf', 'jeffry', 'kage', 'sarah', 'jacky', 'shun', 'lion', 'dural', 'kids-akira',
    'kids-sarah', 'siva', 'rentahero', 'janet'];

/* FM's channels: 7 points (x, y, z), then 12 angles (x, y, z); a point is
 * VF2 object POINTS[i], angle j VF2 object ANGLES[j]. */
const POINTS = [12, 13, 14, 15, 16, 18, 19];
const ANGLES = [4, 5, 6, 7, 0, 8, 1, 9, 10, 2, 11, 3];
const FM_CHANNELS = 57;

/** VF2's channel for FM's channel ch, and the scale on the way. */
export function vf2Channel(ch) {
    const [o, a] = [Math.floor(ch / 3), ch % 3];
    if (o < POINTS.length) return { channel: POINTS[o] * 3 + a, scale: (a === 2 ? -1 : 1) / 1024 };
    return { channel: ANGLES[o - POINTS.length] * 3 + (2 - a), scale: a === 0 ? -64 : 64 };
}

/** The data track's ISO 9660 files: Mode 1, 2048 bytes at 16 in each 2352. */
export function readDisc(path = DEFAULT_DISC) {
    const raw = readFileSync(path);
    const sector = n => raw.subarray(n * 2352 + 16, n * 2352 + 16 + 2048);
    const read = (lba, size) => {
        const b = Buffer.alloc(size);
        for (let p = 0; p < size; p += 2048) sector(lba + p / 2048).copy(b, p, 0, Math.min(2048, size - p));
        return b;
    };
    const pvd = sector(16);
    if (pvd.toString('latin1', 1, 6) !== 'CD001') throw new Error(`${path}: no ISO 9660 volume`);
    const root = read(pvd.readUInt32LE(156 + 2), pvd.readUInt32LE(156 + 10));
    const files = {};
    for (let p = 0; p < root.length;) {
        const len = root[p];
        if (!len) { p = (Math.floor(p / 2048) + 1) * 2048; continue; }
        const name = root.toString('latin1', p + 33, p + 33 + root[p + 32]).replace(/;1$/, '');
        files[name] = { lba: root.readUInt32LE(p + 2), size: root.readUInt32LE(p + 10) };
        p += len;
    }
    const file = name => {
        if (!files[name]) throw new Error(`no ${name} on the disc`);
        return read(files[name].lba, files[name].size);
    };
    return { files, file };
}

/** The game: its program, its archive and the tables that index them. */
export function readGame(path) {
    const disc = readDisc(path);
    const prg = disc.file('1ST_READ.DAT'), fmm = disc.file('FMM_DATA.DAT');
    const at = a => a - LOAD;
    const archive = n => {
        if (n < 0 || n >= FILE_COUNT) throw new Error(`no file ${n}`);
        const sectors = prg.readUInt16BE(at(FILE_TABLE) + 4 * n), start = prg.readUInt16BE(at(FILE_TABLE) + 4 * n + 2);
        return fmm.subarray(start * 2048, (start + sectors) * 2048);
    };
    const fighters = NAMES.map((name, row) => {
        const c = at(CHAR_TABLE) + row * CHAR_ROW, s = i => prg.readInt16BE(c + 2 * i);
        const f = at(FIGHTER_TABLE) + row * FIGHTER_ROW;
        return {
            row, name,
            costumes: [0, 1, 2, 3, 4, 5, 6, 7].map(s),   /* model / texture files, two costumes */
            motions: s(8), file9: s(9), file10: s(10), file11: s(11), id: s(12), count: s(13),
            bones: prg.readUInt32BE(f), actions: prg.readUInt32BE(f + 4),
        };
    });
    return { disc, prg, fmm, archive, fighters, at };
}

/** A fighter's 15 bone offsets (16.16 m), VF2's joints 1..15. */
export function readBones(game, fighter) {
    const p = game.at(fighter.bones);
    return Array.from({ length: BONES }, (_, i) =>
        [0, 1, 2].map(a => game.prg.readInt32BE(p + 12 * i + 4 * a) / 65536));
}

/** A fighter's action table: 66 motion ids, one per thing the game asks of
 *  every fighter (stand, walk, ...; not decoded yet). */
export function readActions(game, fighter) {
    const p = game.at(fighter.actions);
    return Array.from({ length: ACTIONS }, (_, i) => game.prg.readUInt16BE(p + 2 * i));
}

/* The motion directory: 0x060131d0 plays id & 0xfff through the words at
 * 0x06091cb0 + (id - 1) * 4, which 0x0601fc70 fills from player 1's bank
 * (0x2a0000), player 2's (0x2d0000) and then the common one (0x278000, file
 * 352, loaded by 0x0602e8ac). So an id in both a fighter's bank and the
 * common one plays the common copy (Hornet's 0x11e and 0x6d0, the same keys). */
/** Action-table slots [{slot, motion, frames, bank}], the bank being the one
 *  the directory ends up pointing at (null if neither has it). */
export function readSlots(game, fighter, slots = Array.from({ length: ACTIONS }, (_, i) => i)) {
    const own = new Map(readBank(game.archive(fighter.motions)).map(r => [r.id, r]));
    const common = new Map(readBank(game.archive(COMMON_MOTIONS)).map(r => [r.id, r]));
    const ids = readActions(game, fighter);
    return slots.map(slot => {
        const motion = ids[slot] & 0xfff, row = common.get(motion) ?? own.get(motion);
        return { slot, motion, frames: row?.frames ?? null,
            bank: common.has(motion) ? COMMON_MOTIONS : own.has(motion) ? fighter.motions : null };
    });
}

/* The command script (a fighter's file9; Hornet's 134). 0x06017366 runs it a
 * byte opcode at a time through the 82 handlers at 0x06072394; offsets in it
 * are from the file's start. A move is a request: a u32 the script puts in
 * the fighter's +0x3c and stops: {u8 kind, u8 parameter, u16 motion id}
 * (0x060131d0 plays motion id & 0xfff; kind picks one of the 104 handlers at
 * 0x06012aec). The size of each opcode, from its handler's add to r10: */
const OP_SIZE = (() => {
    const size = new Map();
    for (const op of [0x00, 0x01, 0x02, 0x03, 0x04, 0x10, 0x12, 0x17, 0x18, 0x19, 0x1d, 0x1e, 0x1f, 0x20,
        0x24, 0x25, 0x26, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x33, 0x34, 0x35, 0x3d, 0x3e, 0x42,
        0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4f]) size.set(op, 4);
    for (const op of [0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0f, 0x11, 0x13, 0x14, 0x15,
        0x16, 0x1a, 0x1b, 0x1c, 0x21, 0x22, 0x23, 0x27, 0x29, 0x2a, 0x32, 0x36, 0x37, 0x38, 0x39, 0x3a,
        0x3b, 0x3c, 0x3f, 0x40, 0x41, 0x43, 0x50, 0x51]) size.set(op, 8);
    size.set(0x0e, 12);   /* if r5 == u32 goto u32 */
    size.set(0x4e, 12);
    size.set(0x28, 16);   /* three-way on the stick: u32 offsets */
    return size;
})();
/* the opcodes that request a move: 0x05 always, 0x06 unless a flag is set,
 * 0x32 if the u16 at +2 passes 0x06017c5e */
const REQUESTS = new Set([0x05, 0x06, 0x32]);
/* the motions every fighter shares (damage, thrown, ...): FMM_DATA file 352 */
export const COMMON_MOTIONS = 352;

/** The script's opcodes [{at, op, bytes}], up to the move list after it
 *  (16-byte rows padded with 0xff, which no opcode has in its low bytes). */
export function readScript(buf) {
    const ops = [];
    for (let at = 0; at + 4 <= buf.length;) {
        const op = buf[at], size = OP_SIZE.get(op);
        if (!size || (buf.readUInt32BE(at) & 0xffffff) === 0xffffff) break;
        ops.push({ at, op, bytes: buf.subarray(at, at + size) });
        at += size;
    }
    return ops;
}

/** A fighter's moves: every request in its script, with the motion it plays
 *  (from its own bank, or the common one), that motion's length, and the
 *  inputs that reach it (readInputs, written out by inputText; '' if none). */
export function readMoves(game, fighter) {
    const own = new Map(readBank(game.archive(fighter.motions)).map(r => [r.id, r]));
    const common = new Map(readBank(game.archive(COMMON_MOTIONS)).map(r => [r.id, r]));
    const script = game.archive(fighter.file9), inputs = readInputs(script);
    const moves = readScript(script).filter(o => REQUESTS.has(o.op)).map(({ at, op, bytes }) => {
        const move = bytes.readUInt32BE(4), motion = move & 0xfff;
        const row = motion ? own.get(motion) ?? common.get(motion) : undefined;
        return { at, op, move, kind: move >>> 24, parameter: (move >> 16) & 0xff, motion: motion || null,
            bank: row ? (own.has(motion) ? fighter.motions : COMMON_MOTIONS) : null, frames: row?.frames ?? null };
    });
    const byAt = new Map(moves.map(m => [m.at, m]));
    const motionAt = at => byAt.get(at)?.motion ? `0x${byAt.get(at).motion.toString(16)}` : `@0x${at.toString(16)}`;
    for (const m of moves) m.input = (inputs.get(m.at) ?? []).map(q => inputText(q, motionAt)).join('; ');
    return moves;
}

/* What a move's kind does. FUN_0600d7f6 runs once the script has stored a
 * request in +0x3C: it jumps to the first word of the kind's pair at
 * 0x06012AEC + kind * 8 (accept: start it, or refuse; most refuse while
 * the current kind is 0x21 or, for some, the same kind). Starting a move
 * copies it to +0x70, the current action. Then FUN_0600dda0 runs the second
 * word every frame on +0x70's kind (run), returning through 0x0600ddf2; it
 * ends the action by clearing +0x70. */
export const KIND_HANDLERS = 0x06012aec;
const PLAY_MOTION = 0x060131d0;
/** The instructions a handler can reach: it follows bra/bt/bf (and their
 *  delay slots) and stops at rts or jmp, without going into calls. */
function handlerCode(game, start) {
    const prg = game.prg, seen = new Map(), todo = [start];
    const word = a => prg.readUInt16BE(game.at(a));
    while (todo.length) {
        for (let a = todo.pop(); !seen.has(a);) {
            const w = word(a);
            seen.set(a, w);
            const d8 = ((w & 0xff) << 24 >> 24) * 2 + a + 4, d12 = ((w & 0xfff) << 20 >> 20) * 2 + a + 4;
            if ((w & 0xf000) === 0xa000) { seen.set(a + 2, word(a + 2)); todo.push(d12); break; }   /* bra */
            if (w === 0x000b || (w & 0xf0ff) === 0x402b) { seen.set(a + 2, word(a + 2)); break; }    /* rts, jmp */
            if ((w & 0xfd00) === 0x8900) todo.push(d8);                                         /* bt, bf */
            else if ((w & 0xfd00) === 0x8d00) { seen.set(a + 2, word(a + 2)); todo.push(d8); a += 2; }   /* bt/s, bf/s */
            a += 2;
        }
    }
    return [...seen].sort((x, y) => x[0] - y[0]);
}
/** A kind's handlers and what they read, off the code: the action-table
 *  slots they play (+0x34 is the fighter row's action table, 0x0600cec8),
 *  whether they play the move's own motion (+0x3E/+0x72), the parameter
 *  bits they test (+0x3C/+0x70 bits 16-23, or the byte +0x71), and the
 *  distances (+0x4D8) they compare with. */
export function readKind(game, kind) {
    const accept = game.prg.readUInt32BE(game.at(KIND_HANDLERS + 8 * kind));
    const run = game.prg.readUInt32BE(game.at(KIND_HANDLERS + 8 * kind + 4));
    const code = [...handlerCode(game, accept), ...handlerCode(game, run)];
    const lit = (a, w) => (w & 0xf000) === 0xd000 ? game.prg.readUInt32BE(game.at(((a + 4) & ~3) + (w & 0xff) * 4))
        : (w & 0xf000) === 0x9000 ? game.prg.readUInt16BE(game.at(a + 4 + (w & 0xff) * 2)) : null;
    const imm = w => w & 0xff;
    const slots = new Set(), bits = new Set(), dists = new Set();
    let motion = false;
    const table = code.some(([, w]) => w === 0x55cd || w === 0x56cd || w === 0x50cd);   /* mov.l @(52,r12) */
    const lits = new Map(), far = new Map();
    for (let i = 0; i < code.length; i++) {
        const [a, w] = code[i], [, n1] = code[i + 1] ?? [], [, n2] = code[i + 2] ?? [];
        if (table && (w & 0xff00) === 0xe400 && code.some(([, x]) => x === 0x044d)) slots.add(imm(w) / 2);
        if (table && ((w & 0xff00) === 0xe000 || (w & 0xff00) === 0x9000 && lit(a, w) < 0x100)
            && (n1 === 0x045d || n1 === 0x046d)) slots.add(((w & 0xff00) === 0xe000 ? imm(w) : lit(a, w)) / 2);
        if ((w & 0xff00) === 0xe000 && (imm(w) === 0x72 || imm(w) === 0x3e) && n1 === 0x04cd) motion = true;
        if ((w & 0xff00) === 0xe000 && n1 === 0x4028 && (n2 === 0x2b08 || n2 === 0x2308)) bits.add(imm(w));   /* mov #m; shll16; tst */
        if ((w & 0xf0ff) === 0xd000 && (n1 === 0x2b08 || n1 === 0x2308) && (lit(a, w) & 0xff00ffff) === 0) bits.add(lit(a, w) >>> 16);
        if (w === 0x7171 && (n1 & 0xf0ff) === 0x6010 && (code[i + 2]?.[1] & 0xff00) === 0xc800) bits.add(imm(code[i + 2][1]));   /* +0x71 byte */
        /* a cmp/gt or cmp/ge, within a few words, of +0x4D8 against a literal */
        if ((w & 0xf00f) === 0x000e || (w & 0xf000) === 0x6000 || (w & 0xb000) === 0x9000 || (w & 0xf000) === 0xe000)
            far.delete((w >> 8) & 15);   /* rN overwritten */
        if ((w & 0xf000) === 0xd000) lits.set((w >> 8) & 15, [a, lit(a, w)]);
        const [pa, pw] = code[i - 1] ?? [];
        if ((pw & 0xff00) === 0x9000 && lit(pa, pw) === 0x04d8 && (w & 0xf0ff) === 0x00ce) far.set((w >> 8) & 15, a);
        if ((w & 0xf00b) === 0x3003) {
            const near = (r, at) => at !== undefined && at < a && a - at <= 16;
            for (const [x, y] of [[(w >> 8) & 15, (w >> 4) & 15], [(w >> 4) & 15, (w >> 8) & 15]])
                if (near(x, far.get(x)) && near(y, lits.get(y)?.[0])) dists.add(lits.get(y)[1] / 65536);
        }
    }
    motion = motion && code.some(([a, w]) => (w & 0xf000) === 0xd000 && lit(a, w) === PLAY_MOTION);
    const sorted = s => [...s].sort((x, y) => x - y);
    return { kind, accept, run, motion, slots: sorted(slots), bits: sorted(bits), dists: sorted(dists).map(d => +d.toFixed(2)) };
}

/* What a request needs. The script runs when a button is pressed (or, with
 * none, every frame), with r5 = state << 8 | buttons: P 1, K 2, G 4, and 8,
 * which no pad key gives by default (0x06072304 maps the pad: B P, C K,
 * A G, X P+G, Y K+G, Z P+K+G). The state is 0 on the ground, 1-4 in the air
 * (0x06016e28, where up asks for kind 9, the jump), 5-10 other states
 * (0x06016d4a). Then it matches the stick history newest first, from the
 * frame of the press back (+0x1274, 64 entries of {held, held', pressed,
 * released}): the stick bits are down 0x10, up 0x20, and +0x123C/+0x1240,
 * the pad's left or right as the fighter faces (0x06016546), so forward and
 * back. A match holds while the stick stays as it was. */
const STATES = ['', 'air 1 ', 'air 2 ', 'air 3 ', 'air 4 ', 'state 5 ', 'state 6 ', 'state 7 ',
    'state 8 ', 'state 9 ', 'state 10 '];
const BUTTONS = ['', 'P', 'K', 'P+K', 'G', 'P+G', 'K+G', 'P+K+G'];
function stick(dirs, f, b) {
    const v = (dirs & 0x10 ? 'd' : '') + (dirs & 0x20 ? 'u' : '');
    const h = (f ? 'f' : '') + (b ? 'b' : '');
    return v && h ? `${v}/${h}` : v || h || 'n';
}
/* stick operands: ops 0x00/0x01/0x03 {u8 flags (1 forward, 2 back), u8 dirs};
 * ops 0x02/0x2B a u16: 0x100 forward, 0x200 back, else the dirs */
const byteStick = bytes => stick(bytes[3], bytes[2] & 1, bytes[2] & 2);
const wordStick = bytes => { const w = bytes.readUInt16BE(2); return w & 0x100 ? 'f' : w & 0x200 ? 'b' : stick(w & 0xff); };
/* ops that test a flag word of the fighter: pass if set (or clear) */
const FLAG_TESTS = { 0x07: '+4a4', 0x0a: '!+4a4', 0x08: '+0', 0x0b: '!+0', 0x09: '+2c', 0x0c: '!+2c',
    0x1c: '+70', 0x36: '+578', 0x37: '!+578', 0x3a: '+6c0', 0x3b: '!+6c0', 0x43: '+6b4' };

/** Every way the script reaches each request: { at → [{ entry, after, r5, stick, tests }] }.
 *  entry is 0 or a follow-up point (set by 0x0D/0x38 while a move plays); after
 *  is the requests that set it; r5 the switch case; stick the history ops,
 *  oldest first; tests the flag checks on the way. */
export function readInputs(buf) {
    const ops = readScript(buf), byAt = new Map(ops.map((o, i) => [o.at, i]));
    const paths = new Map(), follows = new Map();   /* follow-up point → requests before it */
    const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(v)) m.get(k).push(v); };
    function walk(entry, i, p, seen) {
        for (; i !== undefined && i < ops.length; i++) {
            const { at, op, bytes } = ops[i];
            if (seen.has(at)) return;
            seen = new Set(seen).add(at);
            /* a follow-up that goes back to the top is a fresh press: walked already */
            const jump = off => entry && off === 0 ? undefined : walk(entry, byAt.get(off), p, seen);
            if (op === 0x0e) {   /* if r5 == v goto */
                const v = bytes.readUInt32BE(4);
                if (p.r5 === undefined ? !p.not.includes(v) : p.r5 === v)
                    walk(entry, byAt.get(bytes.readUInt32BE(8)), { ...p, r5: v, not: [] }, seen);
                if (p.r5 === v) return;
                p = { ...p, not: [...p.not, v] };
            } else if (op === 0x16) {   /* pass if r5 == v */
                const v = bytes.readUInt32BE(4);
                if (p.r5 !== undefined && p.r5 !== v) return;
                p = { ...p, r5: v };
            } else if (op === 0x4a) {   /* r5 = a halfword of the fighter (0x50: its motion) */
                p = { ...p, r5: undefined, not: [], r5of: bytes.readUInt16BE(2), outer: p.outer ?? p.r5 };
            } else if (op === 0x0f || op === 0x27 || op === 0x3f || op === 0x40) {   /* try; on failure go to */
                jump(bytes.readUInt32BE(4));
            } else if (op === 0x10) return;
            else if (op === 0x11) return jump(bytes.readUInt32BE(4));
            else if (op === 0x28) {   /* the stick at this frame: forward, back, neither */
                const s = ['f*', 'b*', 'not f/b'];
                [4, 8, 12].forEach((k, j) => walk(entry, byAt.get(bytes.readUInt32BE(k)),
                    { ...p, stick: [...p.stick, s[j]] }, seen));
                return;
            } else if (op === 0x00 || op === 0x01) p = { ...p, stick: [...p.stick, byteStick(bytes)] };
            else if (op === 0x02) p = { ...p, stick: [...p.stick, wordStick(bytes) + '*'] };
            else if (op === 0x2b) p = { ...p, stick: [...p.stick, `not ${wordStick(bytes)}`] };
            else if (op === 0x0d || op === 0x38) {   /* the next press runs from here, while this move plays */
                p = { ...p, follow: bytes.readUInt32BE(4) };
                if (op === 0x38) return;
            } else if (FLAG_TESTS[op]) {
                const t = `${FLAG_TESTS[op]}&${bytes.readUInt32BE(4).toString(16)}`;
                if (p.tests.includes(t[0] === '!' ? t.slice(1) : `!${t}`)) return;   /* can't both pass */
                if (!p.tests.includes(t)) p = { ...p, tests: [...p.tests, t] };
            } else if (op === 0x1a || op === 0x1b) {   /* +0x4D8, the distance to the opponent (16.16, 0x06011d3e): at least, or under */
                const t = `dist${op === 0x1a ? '>=' : '<'}${+(bytes.readInt32BE(4) / 65536).toFixed(2)}`;
                if (!p.tests.includes(t)) p = { ...p, tests: [...p.tests, t] };
            } else if (REQUESTS.has(op)) {
                add(paths, at, { entry, r5: p.r5 ?? null, r5of: p.r5of ?? null, outer: p.outer ?? null,
                    stick: [...p.stick].reverse(), tests: p.tests });
                if (p.follow !== undefined) add(follows, p.follow, at);
                return;   /* 0x06 and 0x32 stop too, requesting or not (0x06017466, 0x06017738) */
            }
        }
    }
    const start = { r5: undefined, not: [], stick: [], tests: [] };
    walk(0, 0, start, new Set());
    for (let done = new Set(), more = true; more;) {
        more = false;
        for (const x of follows.keys()) if (!done.has(x)) { done.add(x); more = true; walk(x, byAt.get(x), start, new Set()); }
    }
    const SIDES = ['f*', 'b*', 'not f/b'];
    for (const [at, list] of paths) {
        /* op 0x28's three ways that all reach the request: the side didn't matter */
        const seen = new Set(list.map(q => JSON.stringify(q)));
        for (const q of list) for (let k = q.stick.length - 1; k >= 0; k--) {
            if (!SIDES.includes(q.stick[k])) continue;
            const all = SIDES.every(x => seen.has(JSON.stringify({ ...q, stick: q.stick.map((y, j) => j === k ? x : y) })));
            if (all) q.stick = q.stick.filter((_, j) => j !== k);
        }
        for (const q of list) q.after = q.entry ? follows.get(q.entry) ?? [] : [];
        /* P+K falls through to P's checks, and a later alternative can carry the
         * stick an earlier one matched: keep only the paths that ask least */
        const key = q => JSON.stringify([q.entry, (q.outer ?? q.r5) >> 8, q.r5of, q.r5of === null ? 0 : q.r5]);
        const bits = q => (q.outer ?? q.r5) & 0xff;
        const within = (a, b) => { let i = 0; for (const x of b) if (x === a[i]) i++; return i === a.length; };
        const covers = (o, q) => key(o) === key(q) && (bits(o) & bits(q)) === bits(o)
            && within(o.stick, q.stick) && o.tests.every(t => q.tests.includes(t));
        paths.set(at, list.filter((q, i) => !list.some((o, j) => j !== i && covers(o, q) && (!covers(q, o) || j < i))));
    }
    return paths;
}

/** One way to a request, written out: "d,d/f+P", "air 1 K", "after 0x4da: P". */
export function inputText(q, motionAt = at => `0x${at.toString(16)}`) {
    const r5 = q.outer ?? q.r5, buttons = r5 === null ? '' : (BUTTONS[r5 & 7] ?? '') + (r5 & 8 ? (r5 & 7 ? '+8' : '8') : '');
    const state = r5 === null ? '' : STATES[r5 >> 8] ?? `state ${r5 >> 8} `;
    /* the stick at the press (op 0x28) only matters when nothing else is checked */
    let s = q.stick.filter(x => x !== 'not f/b');
    s = s.length > 1 ? s.filter(x => x !== 'f*' && x !== 'b*') : s.map(x => x.replace(/^([fb])\*$/, '$1'));
    let text = s.join(',').replace(/not b,not f|not f,not b/g, 'not f/b');
    if (buttons) text = text ? `${text}+${buttons}` : buttons;
    text = state + (text || (r5 === 0 ? 'no button' : 'any'));
    if (q.r5of === 0x50 && q.r5 !== null) text += ` during 0x${q.r5.toString(16)}`;
    if (q.after.length) text = `after ${q.after.map(motionAt).join('/')}: ${text}`;
    return q.tests.length ? `${text} [${q.tests.join(' ')}]` : text;
}

/* Where a fighter's model file keeps its slot table: four tables of 32
 * offsets (one per fighter row), picked by FUN_0601fcb0's r7. Hornet's are
 * all 0x714C, into files 130 and 132. */
const SLOT_TABLES = 0x06079d00;
export const HORNET_SLOTS = 0x714c;
export function slotTable(game, row, set = 0) {
    return game.prg.readUInt32BE(game.at(game.prg.readUInt32BE(game.at(SLOT_TABLES) + 4 * set)) + 4 * row);
}

/** A model file's slots: 41 SGL XPDATA {points, count, polygons, count,
 *  attributes, normals}, 24 bytes each, to 0xFFFFFFFF; a slot whose first
 *  word is 0x1 is empty (null), and an unused part is a one-point model.
 *  FUN_0601fcb0 relocates slots 1-40 into the player's part array, slot s at
 *  entry s - 1. Points are 16.16 (x, y, z); a polygon's four corners are
 *  point indices x 16. */
export function readModel(buf, at) {
    const slots = [], fx = (o) => buf.readInt32BE(o) / 65536;
    for (let o = at; buf.readUInt32BE(o) !== 0xffffffff; o += 24) {
        if (buf.readUInt32BE(o) === 1) { slots.push(null); continue; }
        const [pp, pc, qp, qc] = [0, 1, 2, 3].map(i => buf.readUInt32BE(o + 4 * i));
        slots.push({
            points: Array.from({ length: pc }, (_, i) => [0, 1, 2].map(a => fx(pp + 12 * i + 4 * a))),
            polygons: Array.from({ length: qc }, (_, i) => [0, 1, 2, 3].map(k => buf.readUInt16BE(qp + 20 * i + 12 + 2 * k) / 16)),
        });
    }
    return slots;
}

/* The armour break. FUN_0600bb20 draws slot 15 + s in place of slot s for
 * s = 1..9, a bit each of the row's word at 0x0606C6FC, once player +0x65
 * has bit 2 (the upper armour, set at 0x06023E1C); FUN_0600bb78 does s =
 * 9..15 by bits 8-14 of 0x0606C77C's, once +0x65 has bit 3 (the lower,
 * 0x06023E66). */
const BREAK_UPPER = 0x0606c6fc, BREAK_LOWER = 0x0606c77c;

/** A fighter's broken parts: [alternate slot, the slot it replaces], upper
 *  armour first. */
export function readBreaks(game, fighter) {
    const word = a => game.prg.readUInt32BE(game.at(a) + 4 * fighter.row), out = [];
    for (let k = 0; k < 9; k++) if (word(BREAK_UPPER) >> k & 1) out.push([16 + k, 1 + k]);
    for (let k = 0; k < 7; k++) if (word(BREAK_LOWER) >> (8 + k) & 1) out.push([24 + k, 9 + k]);
    return out;
}

/* The pose slots (noclip js/pose.js): slot s's bone is entry s of the
 * fighter's bone table, its place in SLOT_PARENT[s]'s frame. The limbs
 * are IK chains: shoulder or hip (3, 6, 10, 13), then two bones. */
const CHAINS = [[3, 4, 5], [6, 7, 8], [10, 11, 12], [13, 14, 15]];

/* The pose's metres in model units, for Hornet: his wheels' radius (40
 * units) is the hubs' height over the floor in the car pose (0.13 m), and
 * the wheelbase comes out Daytona's (323 units). Fitted, not read off the
 * draw. */
export const MODEL_UNITS = 300;

/** A motion's VF2 block's channels the way noclip's decodeMotion lays
 *  them out, for its evalChannel and sampleMotion. */
export function vf2Channels(b) {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength), types = [];
    for (let j = 0; j < 20; j++) {
        const x = b[2 + j], top = x >> 6;
        for (let a = 0; a < 3; a++) types.push(top === 0 ? ((x >> (2 * a)) & 3) + 3 : top - 1);
    }
    let n = 0;
    const ch = types.map(type => ({ type, count: type === LINEAR || type === HERMITE ? b[22 + n++] : 0, view }));
    let p = (22 + n + 3) & ~3;
    for (const c of ch) if (c.count) { c.times = p; p += 4 * c.count; }
    for (const c of ch) {
        if (c.type === ZERO) continue;
        c.values = p;
        p += c.count ? c.count * (c.type === HERMITE ? 12 : 4) : 4;
    }
    return { channels: ch, end: p };
}

/**
 * A fighter posed at one frame of a motion: VF2's solve (noclip pose.js,
 * feet level with the floor) on the fighter's own bones, then each slot
 * stepped out from its parent by its bone, as VF2's draw does. Board frame,
 * metres; { r (column-major 3x3), t } per slot 0-15.
 */
export function poseFighter(game, fighter, id, frame = 1) {
    const bank = game.archive(fighter.motions), row = readBank(bank).find(r => r.id === id);
    if (!row) throw new Error(`${fighter.name} has no motion 0x${id.toString(16)}`);
    const { channels } = vf2Channels(encodeVF2(toVF2(decodeFM(bank, row.data))));
    const bones = [[0, 0, 0], ...readBones(game, fighter)];
    const rig = { spine: bones[2], pivot: CHAINS.map(c => bones[c[0]]),
        upper: CHAINS.map(c => bones[c[1]][0]), lower: CHAINS.map(c => bones[c[2]][0]) };
    const pose = buildPose(rig, sampleMotion(null, { channels }, frame), { levelFeet: true });
    for (let s = 1; s < SLOT_COUNT; s++) {
        const { r, t } = pose[SLOT_PARENT[s]], o = bones[s];
        pose[s].t = [0, 1, 2].map(k => t[k] + r[k] * o[0] + r[k + 3] * o[1] + r[k + 6] * o[2]);
    }
    return pose;
}

/** Slot s of a pose in slot ref's frame: { t (model units), r }. */
export function inFrameOf(pose, s, ref) {
    const R = pose[ref].r, d = [0, 1, 2].map(k => pose[s].t[k] - pose[ref].t[k]);
    const dot = (c, v) => R[c * 3] * v[0] + R[c * 3 + 1] * v[1] + R[c * 3 + 2] * v[2];
    return {
        t: [0, 1, 2].map(c => dot(c, d) * MODEL_UNITS),
        r: [0, 1, 2].flatMap(cc => [0, 1, 2].map(c => dot(c, pose[s].r.slice(cc * 3, cc * 3 + 3)))),
    };
}

/** The motion bank: 12-byte rows {setup offset, motion id, data offset},
 *  ending in id 0. */
export function readBank(buf) {
    const rows = [];
    for (let p = 0; ; p += 12) {
        const id = buf.readUInt32BE(p + 4);
        if (!id) break;
        const data = buf.readUInt32BE(p + 8);
        rows.push({ id, setup: buf.readUInt32BE(p), data, frames: buf.readUInt16BE(data) });
    }
    return rows;
}

/**
 * One motion, FM's own way. The block: u16 frames, s16 times and values
 * offsets (from the block), u16 size; 15 bytes of 2-bit channel types, the
 * first channel in the top bits (57 of the 60 used):
 *   0: zero; 1: a constant (one value);
 *   2: linear: times [n, n deltas], values n + 2;
 *   3: Hermite: times [n, m, n + m deltas, 0xFF after a key whose sides
 *      differ], values v0, out0, per key (in, v) or (in, v, out), in, v.
 * Keys at frame 1, 1 + the deltas, the last frame. Values s16 (the game's
 * <<6 of them aside).
 */
export function decodeFM(buf, at) {
    const frames = buf.readUInt16BE(at);
    let t = at + buf.readInt16BE(at + 2), v = at + buf.readInt16BE(at + 4);
    const val = () => { const x = buf.readInt16BE(v); v += 2; return x; };
    const channels = [];
    for (let ch = 0; ch < FM_CHANNELS; ch++) {
        const type = (buf[at + 8 + (ch >> 2)] >> (6 - 2 * (ch & 3))) & 3;
        if (type === 0) { channels.push({ type: 'zero' }); continue; }
        if (type === 1) { channels.push({ type: 'const', value: val() }); continue; }
        const n = buf[t], m = type === 3 ? buf[t + 1] : 0;
        t += type === 3 ? 2 : 1;
        const deltas = [...buf.subarray(t, t + n + m)];
        t += n + m;
        const times = [1];
        for (const d of deltas) if (d !== 0xff) times.push(times.at(-1) + d);
        times.push(frames);
        if (type === 2) { channels.push({ type: 'linear', times, values: times.map(val) }); continue; }
        /* (value, in, out) per key; the ends' outer sides are the inner ones */
        const keys = [];
        const v0 = val(), out0 = val();
        keys.push({ value: v0, in: out0, out: out0 });
        deltas.forEach((d, i) => {
            if (d === 0xff) return;
            const tin = val(), value = val();
            keys.push({ value, in: tin, out: deltas[i + 1] === 0xff ? val() : tin });
        });
        const tin = val();
        keys.push({ value: val(), in: tin, out: tin });
        channels.push({ type: 'hermite', times, keys });
    }
    return { frames, channels };
}

/** An FM motion as VF2's 60 channels: { type, times, values } each,
 *  Hermite values as (value, in, out) per key. */
export function toVF2(m) {
    const ch = Array.from({ length: 60 }, () => ({ type: ZERO, times: [], values: [] }));
    for (let a = 0; a < 3; a++) ch[51 + a] = { type: LATCHED, times: [], values: [[0, 0, 16384][a]] };
    m.channels.forEach((c, i) => {
        const { channel, scale } = vf2Channel(i), k = scale * TANGENT_RATE;
        if (c.type === 'const') ch[channel] = c.value ? { type: CONST, times: [], values: [c.value * scale] } : ch[channel];
        else if (c.type === 'linear') ch[channel] = { type: LINEAR, times: c.times, values: c.values.map(x => x * scale) };
        else if (c.type === 'hermite') ch[channel] = { type: HERMITE, times: c.times,
            values: c.keys.flatMap(p => [p.value * scale, p.in * k, p.out * k]) };
    });
    return { frames: m.frames, channels: ch };
}

function fighterArg(game, s) {
    const f = /^\d+$/.test(s) ? game.fighters[+s] : game.fighters.find(x => x.name === s.toLowerCase());
    if (!f) { console.error(`no fighter ${s} (${NAMES.join(', ')})`); process.exit(1); }
    return f;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const opt = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
    const flag = k => { const i = args.indexOf(k); return i >= 0 && !!args.splice(i, 1); };
    const disc = opt('--disc'), out = opt('--out'), file = opt('--file');
    const json = flag('--json');
    const [who, what] = args;
    if (!who && file === undefined) {
        console.error('usage: fm-saturn.mjs [--disc Track01.bin] --fighters | --file <n> --out f.bin\n' +
            '       | <fighter> --list | --bones | --actions | --moves | --pose <motion id> [frame]\n' +
            '       | <fighter> <motion id> [--json] [--out block.bin]');
        process.exit(2);
    }
    const game = readGame(disc);
    if (file !== undefined) {
        const b = game.archive(+file);
        if (out) writeFileSync(out, b);
        console.log(`file ${file}: ${b.length} bytes`);
        process.exit(0);
    }
    if (who === '--fighters') {
        for (const f of game.fighters) {
            console.log(`${f.row}\t${f.name}\tcostumes ${f.costumes}\tmotions ${f.motions}\t` +
                `files ${f.file9} ${f.file10} ${f.file11}\tbones ${f.bones.toString(16)}`);
        }
        process.exit(0);
    }
    const f = fighterArg(game, who), bank = game.archive(f.motions), rows = readBank(bank);
    if (what === '--list') {
        for (const r of rows) console.log(`0x${r.id.toString(16)}\t${r.frames}\tdata ${r.data}\tsetup ${r.setup}`);
        process.exit(0);
    }
    if (what === '--bones') { readBones(game, f).forEach((b, i) => console.log(`${i + 1}\t${b.join('\t')}`)); process.exit(0); }
    if (what === '--pose') {
        /* each part's place and axes in the pelvis's frame (slot 9), model units */
        const pose = poseFighter(game, f, parseInt(args[2] ?? '11c', 16), +(args[3] ?? 1));
        const v = a => a.map(x => x.toFixed(2).padStart(7)).join(' ');
        for (let s = 0; s < SLOT_COUNT; s++) {
            const { t, r } = inFrameOf(pose, s, 9);
            console.log(`${String(s).padStart(2)} ${SLOT_NAMES[s].padEnd(6)} on ${SLOT_PARENT[s] < 0 ? '-' : SLOT_NAMES[SLOT_PARENT[s]]}` +
                `\tat ${v(t)}\tx ${v(r.slice(0, 3))}  y ${v(r.slice(3, 6))}`);
        }
        for (const [alt, s] of readBreaks(game, f)) console.log(`${alt} replaces ${s} (${SLOT_NAMES[s]}) once its armour breaks`);
        process.exit(0);
    }
    if (what === '--moves') {
        const h = (v, n) => `0x${v.toString(16).padStart(n, '0')}`;
        for (const m of readMoves(game, f)) {
            console.log(`${h(m.at, 4)}\t${h(m.move, 8)}\t${m.motion === null ? '-' : h(m.motion, 0)}` +
                `\t${m.frames ?? '-'}\t${m.bank ?? '-'}\t${h(m.kind, 2)}\t${h(m.parameter, 2)}\t${m.input || '-'}`);
        }
        process.exit(0);
    }
    if (what === '--actions') {
        for (const s of readSlots(game, f)) console.log(`${s.slot}\t0x${s.motion.toString(16)}\t${s.frames ?? '-'}\t${s.bank ?? '-'}`);
        process.exit(0);
    }
    const id = parseInt(what, 16), row = rows.find(r => r.id === id);
    if (!row) { console.error(`${f.name} has no motion ${what}`); process.exit(1); }
    const m = decodeFM(bank, row.data), vf2 = toVF2(m);
    if (json) console.log(JSON.stringify({ fm: m, vf2 }, null, 1));
    else {
        const n = t => m.channels.filter(c => c.type === t).length;
        console.log(`${f.name} 0x${id.toString(16)}: ${m.frames} frames; ${n('hermite')} Hermite, ` +
            `${n('linear')} linear, ${n('const')} constant channels`);
    }
    if (out) writeFileSync(out, encodeVF2(vf2));
}
