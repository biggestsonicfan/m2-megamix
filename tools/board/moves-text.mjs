#!/usr/bin/env node
/*
 * A board fighter's moves as plain text, and back: his command program (the
 * input matcher StF's `_uk_execute_move` runs, noclip js/moves.js) and the
 * setup record of every motion it plays (`animation_related`, StF's
 * set_mot_dat: a 13-byte head, setup ops to 0 or 8, then after an 8 the play
 * ops to 0). The text is an assembly listing, one line a unit, so it says
 * everything the bytes do: assembled where it came from it gives the same
 * bytes, and assembled anywhere else the same program (its addresses are
 * labels).
 *
 *   node tools/board/moves-text.mjs [romdir] [--out dir] [--chr N]
 *
 * reads the board's data ROMs (romdir, default board/roms: run
 * tools/board/import-assets.mjs first) and StF's program (sfight.zip in $ROMS_DIR;
 * the board copies StF's 0x80000.. as it is, where StF's own programs and
 * setups are), and writes one file a fighter of the board's roster
 * (board/src/gen/poses.h), `<chr>-<name>.moves`, to dir (default board/moves-out).
 *
 * tools/board/import-assets.mjs takes each file of board/moves/ in place of what the
 * fighter had (installMoves): a program that is not what is there any more
 * goes in the guest heap and the fighter's MOVESET_ARRAY slot points at it; a
 * setup that is not goes in the heap and the motion's slot points at it. A
 * setup is the motion's, for every fighter who plays it.
 *
 * The listing, by example:
 *
 *   fighter 0 SONIC
 *   root T_820D8
 *   org 0x820D8                   a run of units at that address
 *   T_820D8:
 *       key P ground S_8212D      0x0E: buttons, context, the script
 *       endpc T_820D8             0x36 after a table: its end
 *   S_8212D:
 *       exact down+fwd            0x01: the input sample, these held
 *       alt S_82140               0x0F: if a test fails, go on there
 *       commit 380 type=0x1c      0x05: the command word (motion, type)
 *       native S_8215D g0=516 near      0x13: inline code, `lda 516, g0`
 *                                 and on to StF's tail (or far=ADDR)
 *       .bytes 40 00              bytes nothing reaches (not a unit)
 *   setup 380
 *       head 01 00 00 00 ...      the 13-byte head
 *       timing 10 14 30           op 2: hit, cancel, end frames
 *       op 0x0B 1d 00             any other op, its bytes
 *       play                      op 8: the play ops follow
 *       play 0x04 @12 15 80 0 0   after op 8: a play op, its frame, its bytes
 *   setup 849 same 380            the same record as 380's
 *
 * Numbers are decimal or 0x hex; `#` starts a comment.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { loadRomSet } from '../../vendor/noclip/js/romset.js';
import { readMoves } from '../../vendor/noclip/js/moves.js';

const MAIN_DATA = 0x02000000, XTRA = 0x06000000;
const MOTION_ID = 0x1fff;
/* StF's command ops: lengths (the handlers' `addo N, g4, g4`, COMMANDS_BEGIN
 * at 0x1F00C, 64 of them), names (noclip js/moves.js; stfdisasm's
 * load_mot_basic_step for 4) and fields after the op byte:
 *   D  an input sample's held bits (two bytes)   B  a bit of the input
 *   K  a table key (u16)    C  a command word    L  an address (a label)
 *   l  an address or 0      w  a u32             f  a float
 *   b  a byte               s  a signed byte */
export const OP_LENGTH = [
    3, 3, 2, 4, 2, 9, 5, 2, 2, 2, 2, 2, 2, 5, 7, 5,
    1, 5, 4, 5, 5, 9, 3, 1, 1, 1, 5, 5, 2, 4, 2, 4,
    2, 5, 2, 2, 3, 2, 1, 5, 13, 2, 2, 3, 2, 1, 1, 2,
    2, 2, 3, 2, 2, 2, 5, 2, 2, 2, 5, 2, 2, 2, 2, 2,
];
const OPS = {
    0x00: ['exact_new', 'D'], 0x01: ['exact', 'D'], 0x02: ['bit', 'B'], 0x03: ['subset', 'Db'],
    0x04: ['basic_step', 'b'], 0x05: ['commit', 'Cw'], 0x06: ['commit_short', 'C'],
    0x07: ['en_set', 'b'], 0x08: ['state_set', 'b'], 0x09: ['kind_set', 'b'],
    0x0a: ['en_clear', 'b'], 0x0b: ['state_clear', 'b'], 0x0c: ['kind_clear', 'b'],
    0x0d: ['setpc', 'L'], 0x0e: ['key', 'KL'], 0x0f: ['alt', 'L'], 0x10: ['end', ''], 0x11: ['jump', 'L'],
    0x12: ['wait', 'bbs'], 0x13: ['native', 'L'], 0x15: ['throw', 'wl'], 0x18: ['clrpc', ''],
    0x1a: ['nearer', 'f'], 0x1b: ['further', 'f'], 0x1e: ['bit_new', 'B'], 0x1f: ['wait2', 'bbs'],
    0x21: ['vs', 'w'], 0x27: ['alt2', 'L'], 0x28: ['branch', 'LLL'], 0x2a: ['vs_kind', 'b'],
    0x36: ['endpc', 'L'],
};
const FIELD_LEN = { D: 2, B: 1, K: 2, C: 4, L: 4, l: 4, w: 4, f: 4, b: 1, s: 1 };
for (let op = 0; op < OP_LENGTH.length; op++) {
    OPS[op] ??= [`op_${op.toString(16).padStart(2, '0')}`, 'b'.repeat(OP_LENGTH[op] - 1)];
    const n = [...OPS[op][1]].reduce((s, f) => s + FIELD_LEN[f], 1);
    if (n !== OP_LENGTH[op]) throw new Error(`op ${op}: fields ${n}, length ${OP_LENGTH[op]}`);
}
const BY_NAME = new Map(Object.entries(OPS).map(([op, [name]]) => [name, +op]));
const KEY = 0x0e, NATIVE = 0x13;
/* where a script ends (it goes on elsewhere, or stops) */
const STOPS = new Set([0x05, 0x06, 0x10, 0x11, 0x13, 0x28, 0x36]);
/* where a field is a table, not a script */
const TABLE_AT = { 0x0d: [0], 0x36: [0] };

/* Native code (op 0x13): at the next word, `lda N, g0`, then StF's
 * `b cmd_native_tail` (near, 0x1EF48) or the board's `bx` to its far copy
 * (STF_NATIVE_TAIL_FAR), as the guests' programs have it. */
const STF_NATIVE_TAIL = 0x1ef48, LDA_G0 = 0x8c800000, BX = 0x84003000;

/* StF setups: the head, each setup op's length (byte_1D006, op 0 at 0: the
 * head's) and each play op's (byte_1D01F) */
export const SETUP_HEAD = 13;
const SETUP_LENGTHS = 0x1d006, SETUP_OPS = 25, PLAY_LENGTHS = 0x1d01f, PLAY_OPS = 48;
/* setup ops that name a motion (the u16 at that offset): the next motion
 * (1), a throw's victim (5), op 0xA's; and play ops that do (0x0A, 0x0B,
 * 0x16, as tools/guests/vf2-guest.mjs PLAY_MOTION) */
const SETUP_MOTION = { 1: 1, 5: 1, 0xa: 4 };
const PLAY_MOTION = { 0x0a: 5, 0x0b: 5, 0x16: 4 };

const hex = (v, n = 0) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
const hb = (v) => v.toString(16).padStart(2, '0');

/* ---- input bits ------------------------------------------------------------ */

const LOW = [[0x01, 'P'], [0x02, 'K'], [0x04, 'G'], [0x10, 'down'], [0x20, 'up']];
const HIGH = [[0x01, 'fwd'], [0x02, 'back']];
const BITS = { 0: 'P', 1: 'K', 2: 'G', 4: 'down', 5: 'up', 8: 'fwd', 9: 'back' };
const CONTEXT = ['ground', 'air', 'air-hyper', 'air2', 'air2-hyper', 'rising', 'rising2'];

function spellHeld(lo, hi) {
    if ((lo & ~0x37) || (hi & ~0x03)) return `${hex(lo, 2)}:${hex(hi, 2)}`;
    const p = [...LOW.filter(([m]) => lo & m), ...HIGH.filter(([m]) => hi & m)].map(([, n]) => n);
    return p.length ? p.join('+') : 'neutral';
}
function readHeld(t) {
    if (t.includes(':')) { const [a, b] = t.split(':'); return [num(a), num(b)]; }
    let lo = 0, hi = 0;
    if (t !== 'neutral') for (const n of t.split('+')) {
        const l = LOW.find(([, x]) => x === n), h = HIGH.find(([, x]) => x === n);
        if (l) lo |= l[0]; else if (h) hi |= h[0]; else throw new Error(`${t}: no such input`);
    }
    return [lo, hi];
}
function spellKey(k) {
    const b = k & 0xff, c = k >> 8;
    if ((b & ~7) || c >= CONTEXT.length) return [hex(k, 4)];
    const p = LOW.filter(([m]) => b & m).map(([, n]) => n);
    return [p.length ? p.join('+') : 'none', CONTEXT[c]];
}

function num(t) {
    if (!/^-?(0x[0-9a-f]+|\d+)$/i.test(t)) throw new Error(`${t}: not a number`);
    const v = t.startsWith('-') ? -Number(t.slice(1)) : Number(t);
    return v;
}
/* the shortest decimal that is this float again, or its word */
function spellFloat(bits) {
    const f = new Float32Array(new Uint32Array([bits]).buffer)[0];
    if (!Number.isFinite(f) || (f === 0 && bits)) return `f:${hex(bits, 8)}`;
    for (let p = 1; p <= 9; p++) {
        const s = String(Number(f.toPrecision(p)));
        if (Math.fround(Number(s)) === f) return s.includes('.') || s.includes('e') ? s : `${s}.0`;
    }
    return `f:${hex(bits, 8)}`;
}
function readFloat(t) {
    if (t.startsWith('f:')) return num(t.slice(2)) >>> 0;
    const v = Number(t);
    if (!Number.isFinite(v)) throw new Error(`${t}: not a float`);
    return new Uint32Array(new Float32Array([v]).buffer)[0];
}

/* ---- memory ---------------------------------------------------------------- */

/* Bytes by i960 address: the program ROM below 0x100000, main data from
 * 0x02000000, its XTRA window from 0x06000000. */
export function memory(program, main, xtra) {
    const at = (a) => {
        if (a < 0x100000) return [program, a];
        if (a >= MAIN_DATA && a < MAIN_DATA + main.length) return [main, a - MAIN_DATA];
        if (a >= XTRA && a < XTRA + 0x1000000) return [xtra, a & 0xfffff];
        return [null, 0];
    };
    const u8 = (a) => { const [m, o] = at(a); if (!m || o >= m.length) throw new Error(`${hex(a)}: no memory there`); return m[o]; };
    const has = (a) => { const [m, o] = at(a); return !!m && o < m.length; };
    const u16 = (a) => u8(a) | (u8(a + 1) << 8);
    const u32 = (a) => (u16(a) | (u16(a + 2) << 16)) >>> 0;
    const bytes = (a, n) => Uint8Array.from({ length: n }, (_, i) => u8(a + i));
    return { u8, u16, u32, bytes, has };
}

/* ---- decode ---------------------------------------------------------------- */

/* The units of the program at `root`: every op its scripts reach (a table is a
 * run of key ops, ended by an `end` or `endpc` op or by whatever follows). */
function walk(mem, root) {
    const units = new Map();          /* address -> { op, len, native? } */
    const tables = new Set([root]), scripts = new Set();
    const todo = [[root, true]];
    const claim = (a, u) => {
        for (let i = 1; i < u.len; i++) if (units.has(a + i)) throw new Error(`${hex(a)}: op runs into ${hex(a + i)}`);
        units.set(a, u);
    };
    while (todo.length) {
        let [a, table] = todo.pop();
        if (!a) continue;
        (table ? tables : scripts).add(a);
        if (table) {
            for (; mem.u8(a) === KEY && !units.has(a); a += OP_LENGTH[KEY]) {
                claim(a, { op: KEY, len: OP_LENGTH[KEY] });
                todo.push([mem.u32(a + 3), false]);
            }
            /* StF ends a table with an op; a VF2 guest's with a 0 byte (not
             * an op: kept as it is, a label can name it) */
            if (units.has(a)) continue;
            if (![0x10, 0x36].includes(mem.u8(a))) { if (!mem.u8(a)) claim(a, { op: null, len: 1 }); continue; }
        }
        for (; !units.has(a); a += units.get(a).len) {
            const op = mem.u8(a);
            if (op >= OP_LENGTH.length) break;          /* nothing runs past here */
            const u = { op, len: OP_LENGTH[op] };
            const [, fields] = OPS[op];
            let o = 1;
            for (const [i, f] of [...fields].entries()) {
                if (f === 'L' || (f === 'l' && mem.u32(a + o))) todo.push([mem.u32(a + o), (TABLE_AT[op] ?? []).includes(i)]);
                o += FIELD_LEN[f];
            }
            if (op === NATIVE) {
                const code = (a + 5 + 3) & ~3;
                u.native = { pad: code - (a + 5), words: mem.u32(code + 4) === BX ? 3 : 2 };
                u.len = code - a + u.native.words * 4;
            }
            claim(a, u);
            if (STOPS.has(op)) break;
        }
    }
    return { units, tables, scripts };
}

function decodeNative(mem, a, u, label) {
    const code = a + 5 + u.native.pad, w = [0, 1, 2].slice(0, u.native.words).map((i) => mem.u32(code + i * 4));
    const pad = mem.bytes(a + 5, u.native.pad);
    /* the first word: `lda N, g0` (the motion it tests), or any one */
    const first = ((w[0] & 0xfffff000) >>> 0) === LDA_G0 ? `g0=${w[0] & 0xfff}` : `first=${hex(w[0], 8)}`;
    if (pad.every((x) => !x)) {
        if (u.native.words === 3 && w[1] === BX) return `${label} ${first} far=${hex(w[2])}`;
        const disp = (w[1] << 8) >> 8;
        if (u.native.words === 2 && (w[1] & 0xff000003) === 0x08000000 && code + 4 + disp === STF_NATIVE_TAIL) return `${label} ${first} near`;
    }
    return `${label} words ${w.map((x) => hex(x, 8)).join(' ')}${u.native.pad && pad.some((x) => x) ? ` pad ${[...pad].map(hb).join(' ')}` : ''}`;
}

/* The motions the program's commits and natives play */
function playedBy(mem, units) {
    const out = new Set();
    for (const [a, u] of units) {
        if (u.op === null) continue;
        if (u.op === 0x05 || u.op === 0x06) { const id = mem.u32(a + 1) & MOTION_ID; if (id) out.add(id); }
        if (u.op === NATIVE && u.native.words) {
            const w = mem.u32(a + 5 + u.native.pad);
            if (((w & 0xfffff000) >>> 0) === LDA_G0 && (w & 0xfff)) out.add(w & 0xfff);
        }
    }
    return out;
}

/** A setup record's parts: { len, ops: [{ op, at, len }], end, play: [...] } */
export function readSetup(mem, rec, lens) {
    const ops = [], play = [];
    let p = rec + SETUP_HEAD, end;
    for (;;) {
        const op = mem.u8(p);
        if (op === 0 || op === 8) { end = op; p++; break; }
        const len = op < SETUP_OPS ? lens.setup[op] : 0;
        if (!len) throw new Error(`setup ${hex(rec)}: op ${hex(op)} at ${hex(p)}`);
        ops.push({ op, at: p, len });
        p += len;
    }
    if (end === 8) for (;;) {
        const op = mem.u8(p);
        if (op === 0) { p++; break; }
        const len = (op & 0x7f) < PLAY_OPS ? lens.play[op & 0x7f] : 0;
        if (!len) throw new Error(`setup ${hex(rec)}: play op ${hex(op)} at ${hex(p)}`);
        play.push({ op, at: p, len });
        p += len;
    }
    return { len: p - rec, ops, end, play };
}

/** StF's setup and play op lengths, from its program ROM. */
export function setupLengths(program) {
    return { setup: [...program.subarray(SETUP_LENGTHS, SETUP_LENGTHS + SETUP_OPS)], play: [...program.subarray(PLAY_LENGTHS, PLAY_LENGTHS + PLAY_OPS)] };
}

function decodeSetup(mem, rec, lens) {
    const s = readSetup(mem, rec, lens), out = [];
    const bs = (a, n) => [...mem.bytes(a, n)].map(hb).join(' ');
    out.push(`    head ${bs(rec, SETUP_HEAD)}`);
    for (const { op, at, len } of s.ops) {
        if (op === 1) out.push(`    next ${mem.u16(at + 1)}`);
        else if (op === 2) out.push(`    timing ${mem.u16(at + 1)} ${mem.u16(at + 3)} ${mem.u16(at + 5)}`);
        else if (op === 4) out.push(`    strike id=${mem.u8(at + 1)} level=${mem.u8(at + 2)} damage=${mem.u8(at + 3)} ${bs(at + 4, len - 4)}`);
        else if (op === 5) out.push(`    throw victim=${mem.u16(at + 1)} damage=${mem.u8(at + 3)} ${bs(at + 4, len - 4)}`);
        else out.push(`    op ${hex(op, 2)} ${bs(at + 1, len - 1)}`.trimEnd());
    }
    if (s.end === 8) {
        out.push('    play');
        for (const { op, at, len } of s.play)
            out.push(len >= 3 ? `    play ${hex(op, 2)} @${mem.u16(at + 1)} ${bs(at + 3, len - 3)}`.trimEnd() : `    play ${hex(op, 2)} ${bs(at + 1, len - 1)}`.trimEnd());
    }
    return { lines: out, setup: s };
}

/* The motions a setup goes on to (its next motion, a throw's victim, ...). */
function setupMotions(mem, s) {
    const out = [];
    for (const { op, at } of s.ops) if (SETUP_MOTION[op]) out.push(mem.u16(at + SETUP_MOTION[op]) & MOTION_ID);
    for (const { op, at } of s.play) if (PLAY_MOTION[op & 0x7f]) out.push(mem.u16(at + PLAY_MOTION[op & 0x7f]) & MOTION_ID);
    return out.filter((x) => x);
}

/**
 * One fighter's moves as text.
 *   mem: memory(); root: his program (MOVESET_ARRAY's word); setupAt(id): the
 *   motion's record (animation_related's word, or 0); lens: setupLengths();
 *   names: motion id -> a name for comments
 */
export function decodeMoves(mem, { chr, name, root, setupAt, lens, names = new Map() }) {
    const { units, tables } = walk(mem, root);
    const labels = new Map();
    const label = (a) => {
        if (!labels.has(a)) labels.set(a, `${tables.has(a) ? 'T' : 'S'}_${a.toString(16).toUpperCase()}`);
        return labels.get(a);
    };
    for (const a of [root, ...tables]) label(a);
    /* every address a field names gets a label first, so the lines can use them */
    for (const [a, u] of units) {
        let o = 1;
        if (u.op !== null) for (const f of OPS[u.op][1]) { if (f === 'L' || (f === 'l' && mem.u32(a + o))) label(mem.u32(a + o)); o += FIELD_LEN[f]; }
    }
    const out = [`# ${name}'s moves on the board (StF character ${chr}), by tools/board/moves-text.mjs`, `fighter ${chr} ${name}`, `root ${label(root)}`];
    const order = [...units.keys()].sort((a, b) => a - b);
    let pc = null;
    for (const a of order) {
        if (pc !== a) {
            /* a few bytes nothing reaches between two units: kept as bytes */
            if (pc !== null && a > pc && a - pc <= 16) out.push(`    .bytes ${[...mem.bytes(pc, a - pc)].map(hb).join(' ')}`);
            else out.push('', `org ${hex(a)}`);
        }
        if (labels.has(a)) out.push(`${labels.get(a)}:`);
        const u = units.get(a);
        if (u.op === null) { out.push(`    .bytes ${[...mem.bytes(a, u.len)].map(hb).join(' ')}`); pc = a + u.len; continue; }
        const [mn, fields] = OPS[u.op];
        const args = [];
        let o = 1, note = '';
        for (const f of fields) {
            switch (f) {
            case 'D': args.push(spellHeld(mem.u8(a + o), mem.u8(a + o + 1))); break;
            case 'B': { const b = mem.u8(a + o); args.push(BITS[b] ?? String(b)); break; }
            case 'K': args.push(...spellKey(mem.u16(a + o))); break;
            case 'C': {
                const w = mem.u32(a + o), id = w & MOTION_ID;
                args.push(String(id));
                if (w >>> 24) args.push(`type=${hex(w >>> 24, 2)}`);
                if (w & 0xffe000) args.push(`flags=${hex(w & 0xffe000)}`);
                if (names.has(id)) note = `  # ${names.get(id)}`;
                break;
            }
            case 'w': {
                const w = mem.u32(a + o);
                if (u.op === 0x05) { if (w) args.push(`x=${hex(w, 8)}`); } else args.push(hex(w, 8));
                break;
            }
            case 'L': args.push(label(mem.u32(a + o))); break;
            case 'l': { const t = mem.u32(a + o); args.push(t ? label(t) : '0'); break; }
            case 'f': args.push(spellFloat(mem.u32(a + o))); break;
            case 'b': args.push(hex(mem.u8(a + o), 2)); break;
            case 's': args.push(String((mem.u8(a + o) << 24) >> 24)); break;
            }
            o += FIELD_LEN[f];
        }
        if (u.op === NATIVE) out.push(`    native ${decodeNative(mem, a, u, args[0])}`);
        else out.push(`    ${[mn, ...args].join(' ')}${note}`);
        pc = a + u.len;
    }
    /* the setups: what the program plays, and what those go on to */
    out.push('', '# setups: each motion the program plays, and the motions those go on to');
    const want = [...playedBy(mem, units)], seen = new Set(), recs = new Map();
    const ids = [];
    while (want.length) {
        const id = want.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        const rec = setupAt(id);
        if (!rec || rec === 0xffffffff || !mem.has(rec)) continue;
        ids.push([id, rec]);
        want.push(...setupMotions(mem, readSetup(mem, rec, lens)));
    }
    ids.sort((a, b) => a[0] - b[0]);
    for (const [id, rec] of ids) {
        const nm = names.has(id) ? `  # ${names.get(id)}` : '';
        if (recs.has(rec)) { out.push(`setup ${id} same ${recs.get(rec)}${nm}`); continue; }
        recs.set(rec, id);
        out.push(`setup ${id}${nm}`, ...decodeSetup(mem, rec, lens).lines);
    }
    return out.join('\n') + '\n';
}

/* ---- parse and assemble ----------------------------------------------------- */

/** The text's parts: { chr, name, root, sections: [{ org, lines }], setups: Map } */
export function parseMoves(text) {
    const r = { chr: null, name: '', root: null, sections: [], setups: new Map() };
    let sec = null, setup = null;
    text.split('\n').forEach((raw, i) => {
        const line = raw.replace(/#.*/, '').trim();
        if (!line) return;
        const where = `line ${i + 1}`;
        const t = line.split(/\s+/);
        try {
            if (t[0] === 'fighter') { r.chr = num(t[1]); r.name = t.slice(2).join(' '); return; }
            if (t[0] === 'root') { r.root = t[1]; return; }
            if (t[0] === 'org') { sec = { org: num(t[1]), lines: [] }; r.sections.push(sec); setup = null; return; }
            if (t[0] === 'setup') {
                const id = num(t[1]);
                if (r.setups.has(id)) throw new Error(`setup ${id} twice`);
                setup = t[2] === 'same' ? { same: num(t[3]) } : { head: null, ops: [], play: null };
                r.setups.set(id, setup);
                if (t[2] === 'same') setup = null;
                sec = null;
                return;
            }
            if (setup) { setup.ops.push({ t, where }); return; }
            if (!sec) throw new Error('not in an org or a setup');
            sec.lines.push({ t, where });
        } catch (e) { throw new Error(`${where}: ${e.message}`); }
    });
    if (r.root === null) throw new Error('no root');
    return r;
}

const le32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24];
const le16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
const hexBytes = (ts) => ts.map((x) => { if (!/^[0-9a-f]{2}$/i.test(x)) throw new Error(`${x}: not a hex byte`); return parseInt(x, 16); });

/* One line's bytes at pc; label(name) gives an address (0 on the first pass). */
function assembleLine(t, pc, label, opts) {
    if (t[0] === '.bytes') return hexBytes(t.slice(1));
    const op = BY_NAME.get(t[0]);
    if (op === undefined) throw new Error(`${t[0]}: no such op`);
    const fields = OPS[op][1], out = [op];
    let i = 1;
    const next = () => { if (i >= t.length) throw new Error(`${t[0]}: too few fields`); return t[i++]; };
    const kv = {};
    for (const f of fields) {
        switch (f) {
        case 'D': out.push(...readHeld(next())); break;
        case 'B': { const x = next(); const b = Object.entries(BITS).find(([, n]) => n === x); out.push(b ? +b[0] : num(x)); break; }
        case 'K': {
            const x = next();
            if (x.startsWith('0x')) { out.push(...le16(num(x))); break; }
            const c = CONTEXT.indexOf(next());
            if (c < 0) throw new Error(`${t[i - 1]}: no such context`);
            const [b] = x === 'none' ? [0] : readHeld(x);
            out.push(b, c);
            break;
        }
        case 'C': {
            const id = num(next());
            while (i < t.length && t[i].includes('=') && !t[i].startsWith('x=')) { const [k, v] = t[i++].split('='); kv[k] = num(v); }
            for (const k of Object.keys(kv)) if (!['type', 'flags'].includes(k)) throw new Error(`${k}=: not a commit field`);
            if (id & ~MOTION_ID) throw new Error(`${id}: not a motion id`);
            out.push(...le32((((kv.type ?? 0) << 24) | (kv.flags ?? 0) | id) >>> 0));
            break;
        }
        case 'w': {
            if (op === 0x05) { const x = i < t.length && t[i].startsWith('x=') ? num(t[i++].slice(2)) : 0; out.push(...le32(x >>> 0)); break; }
            out.push(...le32(num(next()) >>> 0));
            break;
        }
        case 'L': out.push(...le32(label(next()))); break;
        case 'l': { const x = next(); out.push(...le32(x === '0' ? 0 : label(x))); break; }
        case 'f': out.push(...le32(readFloat(next()))); break;
        case 'b': out.push(num(next()) & 0xff); break;
        case 's': out.push(num(next()) & 0xff); break;
        }
    }
    if (op === NATIVE) {
        /* native <label> g0=N near|far=ADDR | words W W [W] [pad bytes] */
        while (out.length + pc & 3) out.push(0);
        if (t[i] === 'words') {
            const w = [];
            for (i++; i < t.length && t[i] !== 'pad'; i++) w.push(num(t[i]) >>> 0);
            if (t[i] === 'pad') { const p = hexBytes(t.slice(i + 1)); out.splice(5, p.length, ...p); i = t.length; }
            for (const x of w) out.push(...le32(x));
        } else {
            let w0;
            if (t[i]?.startsWith('first=')) w0 = num(t[i++].slice(6)) >>> 0;
            else {
                const g0 = t[i]?.startsWith('g0=') ? num(t[i++].slice(3)) : NaN;
                if (!(g0 >= 0 && g0 < 0x1000)) throw new Error('native: g0=N (0..0xFFF) or first=WORD');
                w0 = (LDA_G0 | g0) >>> 0;
            }
            let how = t[i++];
            if (how === 'near' && opts.far) how = `far=${hex(opts.far)}`;
            out.push(...le32(w0));
            if (how === 'near') {
                const disp = STF_NATIVE_TAIL - (pc + out.length);
                if (disp < -0x800000 || disp >= 0x800000) throw new Error('native: near cannot reach cmd_native_tail from here');
                out.push(...le32((0x08000000 | (disp & 0xfffffc)) >>> 0));
            } else if (how?.startsWith('far=')) out.push(...le32(BX), ...le32(num(how.slice(4)) >>> 0));
            else throw new Error('native: near or far=ADDR');
        }
    }
    if (i < t.length) throw new Error(`${t[0]}: ${t.slice(i).join(' ')}: too many fields`);
    if (op !== NATIVE && out.length !== OP_LENGTH[op]) throw new Error(`${t[0]}: ${out.length} bytes, not ${OP_LENGTH[op]}`);
    return out;
}

/**
 * The program's bytes. at(sec) is where a section goes: its own org (null),
 * or `base` and on, one after the other (natives aligned as they come).
 * opts.far: the far tail's address, which `near` natives take instead.
 * Returns { runs: [{ at, bytes }], root, labels }.
 */
export function assembleProgram(parsed, { base = null, far = 0 } = {}) {
    const labels = new Map();
    let runs;
    for (let pass = 0; pass < 2; pass++) {
        runs = [];
        let pc = base;
        for (const sec of parsed.sections) {
            if (base === null) pc = sec.org;
            const start = pc, bytes = [];
            for (const { t, where } of sec.lines) {
                try {
                    if (t.length === 1 && t[0].endsWith(':')) {
                        const n = t[0].slice(0, -1);
                        if (pass === 0 && labels.has(n)) throw new Error(`${n}: label twice`);
                        labels.set(n, pc);
                        continue;
                    }
                    const b = assembleLine(t, pc, (n) => {
                        if (!labels.has(n)) { if (pass) throw new Error(`${n}: no such label`); return 0; }
                        return labels.get(n);
                    }, { far });
                    bytes.push(...b);
                    pc += b.length;
                } catch (e) { throw new Error(`${where}: ${e.message}`); }
            }
            runs.push({ at: start, bytes: Uint8Array.from(bytes) });
        }
    }
    if (!labels.has(parsed.root)) throw new Error(`root ${parsed.root}: no such label`);
    return { runs, root: labels.get(parsed.root), labels };
}

/** One setup's bytes (a `same` setup has none: setupBytes returns null). */
export function assembleSetup(s) {
    if (s.same !== undefined) return null;
    const out = [];
    let play = false, head = false;
    for (const { t, where } of s.ops) {
        try {
            const kv = (k) => { const x = t.find((y) => y.startsWith(`${k}=`)); if (!x) throw new Error(`${t[0]}: no ${k}=`); return num(x.slice(k.length + 1)); };
            const rest = (n) => hexBytes(t.slice(n));
            if (t[0] === 'head') { if (out.length) throw new Error('head first'); const b = rest(1); if (b.length !== SETUP_HEAD) throw new Error(`head: ${SETUP_HEAD} bytes`); out.push(...b); head = true; continue; }
            if (!head) throw new Error('head first');
            if (t[0] === 'play') {
                if (t.length === 1) { if (play) throw new Error('play twice'); out.push(8); play = true; continue; }
                if (!play) throw new Error('a play op before `play`');
                const op = num(t[1]);
                out.push(op, ...(t[2]?.startsWith('@') ? [...le16(num(t[2].slice(1))), ...rest(3)] : rest(2)));
                continue;
            }
            if (play) throw new Error(`${t[0]}: a setup op after \`play\``);
            if (t[0] === 'next') out.push(1, ...le16(num(t[1])));
            else if (t[0] === 'timing') out.push(2, ...le16(num(t[1])), ...le16(num(t[2])), ...le16(num(t[3])));
            else if (t[0] === 'strike') out.push(4, kv('id'), kv('level'), kv('damage'), ...rest(4));
            else if (t[0] === 'throw') out.push(5, ...le16(kv('victim')), kv('damage'), ...rest(3));
            else if (t[0] === 'op') out.push(num(t[1]), ...rest(2));
            else throw new Error(`${t[0]}: not a setup line`);
        } catch (e) { throw new Error(`${where}: ${e.message}`); }
    }
    out.push(0);
    return Uint8Array.from(out);
}

/* Check a setup's bytes parse as one (lengths by StF's tables) and run to
 * their end. */
function checkSetup(bytes, lens, id) {
    const mem = memory(bytes, new Uint8Array(0), new Uint8Array(0));
    const s = readSetup(mem, 0, lens);
    if (s.len !== bytes.length) throw new Error(`setup ${id}: ${bytes.length} bytes, but its ops run to ${s.len}`);
}

/* ---- into the board (tools/board/import-assets.mjs) -------------------------------- */

/**
 * Put one .moves file into the board being imported: R its regions, ctx the
 * guest heap's (tools/guests/vf2-guest.mjs importAkira's ctx). What is there and the
 * same stays where it is. Returns lines for the report.
 */
export function installMoves(R, ctx, text, file = 'moves') {
    const p = parseMoves(text);
    if (!(p.chr >= 0 && p.chr < 24)) throw new Error(`${file}: fighter ${p.chr} has no MOVESET_ARRAY slot`);
    const T = R.guest.tables;
    const mem = memory(R.program.src, R.main.out, R.xtra.out);
    const lens = setupLengths(R.program.src);
    const report = [];
    /* the program: where it came from, if it is still those bytes */
    const here = assembleProgram(p);
    const same = here.runs.every(({ at, bytes }) => bytes.every((b, i) => mem.has(at + i) && mem.u8(at + i) === b));
    const slot = T.MOVESET_ARRAY.view.getUint32(p.chr * 4, true);
    if (same) {
        T.MOVESET_ARRAY.view.setUint32(p.chr * 4, here.root, true);
        report.push(`program as it is (${hex(here.root)}${slot === here.root ? '' : `, was ${hex(slot)}`})`);
    } else {
        const base = (ctx.heapEnd() + 3) & ~3;
        const moved = assembleProgram(p, { base, far: R.guest.nativeTail });
        const all = Uint8Array.from(moved.runs.flatMap((r) => [...r.bytes]));
        if (ctx.alloc(all, 'command program (moves file)', 4, p.name) !== base) throw new Error(`${file}: the program moved`);
        T.MOVESET_ARRAY.view.setUint32(p.chr * 4, moved.root, true);
        report.push(`program ${hex(base)}, ${all.length} bytes, root ${hex(moved.root)}`);
    }
    /* the setups */
    const setupT = T.animation_related;
    const recAt = (id) => (id * 4 + 4 <= setupT.bytes.length ? setupT.view.getUint32(id * 4, true) : 0);
    let kept = 0, put = 0;
    const done = new Map();
    for (const [id, s] of p.setups) {
        if (s.same !== undefined) continue;
        const b = assembleSetup(s);
        checkSetup(b, lens, id);
        const rec = recAt(id);
        if (rec && mem.has(rec) && b.every((x, i) => mem.has(rec + i) && mem.u8(rec + i) === x)) { kept++; done.set(id, rec); continue; }
        if (id * 4 + 4 > setupT.bytes.length) throw new Error(`${file}: setup ${id}: no motion of that id`);
        const at = ctx.alloc(b, `setup ${id} (moves file)`, 1, p.name);
        setupT.view.setUint32(id * 4, at, true);
        done.set(id, at);
        put++;
    }
    for (const [id, s] of p.setups) {
        if (s.same === undefined) continue;
        const to = done.get(s.same);
        if (to === undefined) throw new Error(`${file}: setup ${id} same ${s.same}: no setup ${s.same} in the file`);
        if (recAt(id) !== to) { setupT.view.setUint32(id * 4, to, true); put++; } else kept++;
    }
    report.push(`setups: ${kept} as they are, ${put} put in`);
    return report;
}

/* ---- the command line ----------------------------------------------------------- */

const ROOT = new URL('../..', import.meta.url).pathname;

/* board/src/gen/stf_motion.h: the guest tables' addresses */
export function guestTableAt(root = ROOT) {
    const h = readFileSync(`${root}board/src/gen/stf_motion.h`, 'utf8');
    const T = {};
    for (const m of h.matchAll(/#define STF_GUEST_(\w+?)(_SRC|_LEN)? 0x([0-9A-F]+)u/g))
        (T[m[1]] ??= {})[m[2] ? m[2].slice(1).toLowerCase() : 'at'] = parseInt(m[3], 16);
    return T;
}

/* The board's main data and its XTRA window, from import-assets' files. */
export function boardData(dir) {
    const md = new Uint8Array(0x1000000), xt = new Uint8Array(0x100000);
    const pairs = [[md, 0x000000, 'mpr-19007.11', 'mpr-19008.12'], [md, 0x800000, 'mpr-19005.9', 'mpr-19006.10'], [xt, 0, 'epr-19003.7', 'epr-19004.8']];
    for (const [to, at, a, b] of pairs) {
        const A = readFileSync(`${dir}/sfight/${a}`), B = readFileSync(`${dir}/sfight/${b}`);
        for (let i = 0; i < A.length; i += 2) {
            to[at + i * 2] = A[i]; to[at + i * 2 + 1] = A[i + 1];
            to[at + i * 2 + 2] = B[i]; to[at + i * 2 + 3] = B[i + 1];
        }
    }
    return { main: md, xtra: xt };
}

/** The board's roster (board/src/gen/poses.h): [{ chr, name }] */
export function roster(root = ROOT) {
    const h = readFileSync(`${root}board/src/gen/poses.h`, 'utf8');
    return [...h.matchAll(/{"([^"]+) stance", (\d+), \d+, \w+,/g)].map((m) => ({ name: m[1], chr: +m[2] }));
}

/** Every board fighter's moves, as decodeMoves gives them: [{ chr, name, file, text }] */
export async function decodeBoard(dir = `${ROOT}board/roms`, { chrs = null, roms = process.env.ROMS_DIR || `${process.env.HOME}/build/mameroms` } = {}) {
    const zip = readFileSync(`${roms}/sfight.zip`);
    const stf = await loadRomSet([zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length)]);
    const { main, xtra } = boardData(dir);
    const mem = memory(stf.maincpu, main, xtra);
    const T = guestTableAt();
    const lens = setupLengths(stf.maincpu);
    const out = [];
    for (const { chr, name } of roster()) {
        if (chrs && !chrs.includes(chr)) continue;
        if (chr >= 24) continue;
        /* StF's own fighters (char_game 0): the CPU table's names */
        const names = new Map();
        if (!mem.u8(T.char_game.at + chr)) {
            for (const es of readMoves(stf, chr)?.tables.values() ?? []) for (const e of es) if (e.name) names.set(e.motion & MOTION_ID, e.name);
        }
        const root = mem.u32(T.MOVESET_ARRAY.at + chr * 4);
        /* the table's room runs past StF's 519 for the guests' motions */
        /* (the board's table has room past StF's motions, for the guests') */
        const setupAt = (id) => { const a = T.animation_related.at + id * 4; return mem.has(a + 3) ? mem.u32(a) : 0; };
        const text = decodeMoves(mem, { chr, name, root, setupAt, lens, names });
        out.push({ chr, name, file: `${chr}-${name.toLowerCase()}.moves`, text, mem, root, setupAt, lens, names });
    }
    return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2);
    const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
    const out = opt('--out') ?? `${ROOT}board/moves-out`;
    const chr = opt('--chr');
    const dir = args[0] ?? `${ROOT}board/roms`;
    if (!existsSync(`${dir}/sfight`)) throw new Error(`${dir}/sfight: run tools/board/import-assets.mjs first`);
    mkdirSync(out, { recursive: true });
    for (const f of await decodeBoard(dir, { chrs: chr === null ? null : [num(chr)] })) {
        writeFileSync(`${out}/${f.file}`, f.text);
        console.log(`${out}/${f.file}: ${f.text.split('\n').length} lines`);
    }
}
