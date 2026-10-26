/*
 * Grade the board build's guest fighters: how much of what StF's code reads
 * for a character is the guest's own, how much is still the StF fighter
 * whose slot he took (docs/BOARD.md, "Where a guest is still treated as
 * StF's"), and what of his own game's data was lost on the way in.
 *
 *   node tools/grade-guest.mjs [romdir] [--json]
 *
 * romdir defaults to board/roms (tools/import-assets.mjs's output: the data
 * ROMs and guests.json). It reads StF's own set (sfight.zip in $ROMS_DIR) to
 * compare with, and board/src/stf_motion.h for where the guest tables are.
 *
 * It grades four things:
 *   - the guest tables, slot by slot: a guest's slot is his own when it
 *     differs from StF's, a stand-in when it is StF's; every StF fighter's
 *     slot must be StF's (anything else is a fault, and the exit status is 1);
 *   - his character record, field by field, the same way;
 *   - the per-character data StF's code reads from its program ROM, which no
 *     guest table replaces (the audit's list, with its verdicts: what has no
 *     value of the same meaning in the guest's game, what is still open);
 *   - what the import dropped or changed of his game's data (guests.json).
 */
import { readFileSync, existsSync } from 'node:fs';
import { loadRomSet } from '../vendor/noclip/js/romset.js';

const ROOT = new URL('..', import.meta.url).pathname;
const ROMS = process.env.ROMS_DIR || `${process.env.HOME}/build/mameroms`;
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const DIR = args.find((a) => !a.startsWith('--')) ?? `${ROOT}board/roms`;

const MAIN_DATA = 0x02000000, XTRA = 0x06000000;
const PLAYER2 = 26, CHARS = 52, STF_MOTIONS = 519;
const GAMES = ['StF', 'VF2', 'FV'];
const hex = (v) => '0x' + (v >>> 0).toString(16).toUpperCase();

/* ---- the two sets ---------------------------------------------------------- */

/* The board's main data (two ROM_LOAD32_WORD pairs, then the XTRA window),
 * from its files, as import-assets writes them. */
function boardMainData() {
    const md = new Uint8Array(0x1100000);
    const pairs = [[0x000000, 'mpr-19007.11', 'mpr-19008.12'], [0x800000, 'mpr-19005.9', 'mpr-19006.10'],
        [0x1000000, 'epr-19003.7', 'epr-19004.8']];
    for (const [at, a, b] of pairs) {
        const A = readFileSync(`${DIR}/sfight/${a}`), B = readFileSync(`${DIR}/sfight/${b}`);
        for (let i = 0; i < A.length; i += 2) {
            md[at + i * 2] = A[i]; md[at + i * 2 + 1] = A[i + 1];
            md[at + i * 2 + 2] = B[i]; md[at + i * 2 + 3] = B[i + 1];
        }
    }
    return md;
}

/* A reader of 32-bit words by i960 address: the program ROM (StF's) below
 * 0x100000, main data and its XTRA window above. */
function reader(program, md) {
    const pv = new DataView(program.buffer, program.byteOffset, program.byteLength);
    const mv = new DataView(md.buffer, md.byteOffset, md.byteLength);
    const off = (a) => {
        if (a >= MAIN_DATA && a < MAIN_DATA + 0x1000000) return a - MAIN_DATA;
        if (a >= XTRA && a < XTRA + 0x1000000) return 0x1000000 + (a & 0xfffff);
        throw new Error(`${hex(a)} is not in the data ROMs`);
    };
    return {
        u32: (a) => (a < 0x100000 ? pv.getUint32(a, true) : mv.getUint32(off(a), true)),
        u16: (a) => (a < 0x100000 ? pv.getUint16(a, true) : mv.getUint16(off(a), true)),
        u8: (a) => (a < 0x100000 ? program[a] : md[off(a)]),
        f32: (a) => (a < 0x100000 ? pv.getFloat32(a, true) : mv.getFloat32(off(a), true)),
    };
}

/* board/src/stf_motion.h: each guest table's address and StF's own (_SRC). */
function guestTables() {
    const h = readFileSync(`${ROOT}board/src/stf_motion.h`, 'utf8');
    const T = {};
    for (const m of h.matchAll(/#define STF_GUEST_(\w+?)(_SRC|_LEN)? 0x([0-9A-F]+)u/g)) {
        if (m[1] === 'HEAP') continue;
        (T[m[1]] ??= {})[m[2] ? m[2].slice(1).toLowerCase() : 'at'] = parseInt(m[3], 16);
    }
    return T;
}

const zip = readFileSync(`${ROMS}/sfight.zip`);
const stf = await loadRomSet([zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length)]);
/* The board's program is its own; StF's tables are read from StF's. */
const S = reader(stf.maincpu, stf.mainData), B = reader(stf.maincpu, boardMainData());
const T = guestTables();
if (!existsSync(`${DIR}/guests.json`)) throw new Error(`${DIR}/guests.json: run tools/import-assets.mjs first`);
const coverage = JSON.parse(readFileSync(`${DIR}/guests.json`, 'utf8'));

/* ---- the guest tables, slot by slot ---------------------------------------- */

const charGame = (c) => B.u8(T.char_game.at + c);
const guests = [...Array(CHARS).keys()].filter((c) => charGame(c));

/* Each table's slots: [what, character, board's word(s), StF's word(s)].
 * A table of lists (by kind, then character) has a slot a kind. */
function slots() {
    const out = [];
    const flat = (name, n, stride = 4, read = 'u32') => {
        const t = T[name];
        for (let c = 0; c < n; c++)
            out.push([name, c, B[read](t.at + c * stride), t.src ? S[read](t.src + c * stride) : 0]);
    };
    flat('CHAR_PARTS', CHARS);
    flat('MOVESET_ARRAY', 24);
    flat('player_hand_animations', CHARS);
    flat('player_foot_animation', CHARS);
    flat('player_body_animation', CHARS);
    flat('ptr_DA0B4', PLAYER2);
    flat('motion_remap', PLAYER2);
    const lists = (name, kinds, lists = (k) => [[k, B.u32(T[name].at + k * 4), S.u32(T[name].src + k * 4)]]) => {
        for (let k = 0; k < kinds; k++)
            for (const [label, b, s] of lists(k))
                for (let c = 0; c < CHARS; c++) out.push([`${name}[${label}]`, c, B.u32(b + c * 4), S.u32(s + c * 4)]);
    };
    lists('SKELETON_TYPE_DATA', 4);
    lists('PLAYER_HEAD_LIST', 21);
    lists('off_C2058', 4);
    /* types 0, 1 and 3 by character, 3 from its second half too; type 2 is
     * one record for everyone */
    lists('rob_coli_ball_types', 4, (k) => {
        const b = B.u32(T.rob_coli_ball_types.at + k * 4), s = S.u32(T.rob_coli_ball_types.src + k * 4);
        return k === 2 ? [] : k === 3 ? [[3, b, s], ['3+', b + CHARS * 4, s + CHARS * 4]] : [[k, b, s]];
    });
    return out;
}

/* A guest's slot of a table his donor's (StF's) slot is 0 in, and his too,
 * is nothing either has: it is not graded. */
const grade = { tables: [], faults: [] };
for (const [what, c, b, s] of slots()) {
    if (!guests.includes(c % PLAYER2) && !guests.includes(c)) {
        /* motion_remap is the board's own: StF's fighters' slots name the
         * copies of what a guest's throw gives its victim */
        if (b !== s && what !== 'motion_remap') grade.faults.push(`${what}[${c}] is ${hex(b)}, StF's ${hex(s)}`);
        continue;
    }
    if (!guests.includes(c)) continue;
    grade.tables.push({ what, c, status: b === s ? (s ? 'stand-in' : 'neither') : b ? 'own' : 'none', board: hex(b), stf: hex(s) });
}

/* What StF's fighters have that he has none of: a slot of his that is 0
 * where some of StF's (player 1's) are not. */
grade.lacks = [];
{
    const byWhat = new Map();
    for (const [what, c, b] of slots()) (byWhat.get(what) ?? byWhat.set(what, []).get(what)).push([c, b]);
    for (const [what, list] of byWhat) {
        const stfHave = list.filter(([c, b]) => c < PLAYER2 && !guests.includes(c) && b).length;
        for (const [c, b] of list) if (guests.includes(c) && !b && stfHave) grade.lacks.push({ what, c, stfHave });
    }
}

/* The motion tables, by id: StF's 519 must be StF's. */
for (const name of ['offset_list_motions', 'animation_related'])
    for (let id = 0; id < STF_MOTIONS; id++) {
        const b = B.u32(T[name].at + id * 4), s = S.u32(T[name].src + id * 4);
        if (b !== s) grade.faults.push(`${name}[${id}] is ${hex(b)}, StF's ${hex(s)}`);
    }
const char_games = [...Array(CHARS).keys()].filter((c) => !guests.includes(c) && charGame(c));
for (const c of char_games) grade.faults.push(`char_game[${c}] is ${charGame(c)}`);

/* ---- his record, field by field ------------------------------------------- */

/* What each field is, and why one that is still StF's stays so
 * (docs/BOARD.md). status: 'unknown' (what it means is not known, nor a
 * field of the guest's game that means the same). */
const RECORD = {
    0x00: 'parts (P1)', 0x04: 'skeleton', 0x08: 'parts (P2)', 0x0c: 'actions',
    0x10: ['ranges for get_en_info (15 floats)', 'VF2\'s reader of its +0x18..+0x24 not found'],
    0x14: ['a float (60 Knuckles, 40 Amy, 160 Eggman)', 'no lifted code reads it'],
    0x18: ['option data (copy_option_data)', 'VF2 has none; what zero does is not known'],
    0x1c: ['a pointer (0xC5260)', 'not in the audit; its reader is not known'],
    0x20: ['rob+0x5BE bytes', 'neither rob+0x5BE nor VF2\'s equivalent known'],
    0x24: ['a float (8.0)', 'no lifted code reads it'],
    0x28: ['a pointer (0xC513C)', 'no lifted code reads it'],
    0x2c: ['a float (9.0)', 'no lifted code reads it; VF2\'s +0x2C (79.0) not known to match'],
};
/* A field every StF character has the same value in is the cast's, not the
 * donor's own. */
const castWide = (f) => new Set([...Array(PLAYER2).keys()].map((c) => S.u32(S.u32(T.CHAR_PARTS.src + c * 4) + f))).size === 1;
grade.record = [];
for (const c of guests) {
    const b = B.u32(T.CHAR_PARTS.at + c * 4), s = S.u32(T.CHAR_PARTS.src + c * 4);
    for (let f = 0; f < 0x30; f += 4) {
        const bv = B.u32(b + f), sv = S.u32(s + f), r = RECORD[f];
        const [what, why] = Array.isArray(r) ? r : [r];
        const cast = castWide(f) ? '; the same for all StF\'s cast' : '';
        grade.record.push({ what: `+${hex(f)} ${what}`, c, status: bv !== sv ? 'own' : !sv ? 'neither' : why ? 'unknown' : 'stand-in', why: why && why + cast, board: hex(bv), stf: hex(sv) });
    }
}

/* ---- StF's program-ROM tables, by character -------------------------------- */

/* What StF's code reads by character from its own ROM (no guest table), as
 * the audit lists it. status: 'closed' (the guest's game has no value of the
 * same meaning: left as StF's), 'open' (to do), 'inert' (not run on the
 * board yet), 'unsettled' (to check in MAME first). */
const throwCameras = () => {
    /* word_6BE90 (cam_mode_10): 16-byte records, the motion id first, to a 0 */
    const ids = [];
    for (let a = 0x6be90; S.u16(a); a += 16) ids.push(S.u16(a));
    return ids;
};
const pendulumRow = (c) => [...Array(6).keys()].map((i) => +S.f32(0x7f198 + (c % PLAYER2) * 0x18 + i * 4).toFixed(3));
function audit(c, cov) {
    const cams = throwCameras(), his = cams.filter((id) => id >= STF_MOTIONS);
    return [
        { what: 'flt_7F198 body pendulum', status: 'closed', note: `StF's row ${pendulumRow(c).join(' ')}; ${cov.game} has no dents or pendulum constants` },
        { what: 'word_6BE90 throw camera', status: 'closed', note: `${cams.length} StF motions have one, ${his.length} of his; no camera script by motion is known in ${cov.game}'s data` },
        { what: 'loc_1EA88 opponent mask', status: 'open', note: `bit ${c % PLAYER2}, the donor's` },
        { what: 'selected_player_check, loc_1E0A0 ids', status: 'open', note: 'hard-coded StF ids' },
        { what: 'sub_2EF9C, Super Sonic, egg_robo, intro ids', status: c % PLAYER2 === 6 ? 'inert' : 'open', note: 'none touch character 6' },
        { what: 'character_spin_mot_objects', status: 'inert', note: 'the donor\'s spin balls' },
        { what: 'blank_per_character_audio_array', status: 'inert', note: 'sound is stubbed' },
        { what: 'sub_2C7E4 projectile reactions', status: 'inert', note: 'StF\'s uk_hit_motions, not ptr_DA0B4' },
        { what: 'ptr_CE1CC damage_unit rows', status: 'inert', note: 'every row the same empty one' },
    ];
}

/* ---- what the import lost --------------------------------------------------- */

/* a guest with his own game's moves (fm-moves.mjs) */
function fmLost(m) {
    const L = m.lost, out = [];
    const list = (o) => Object.entries(o).map(([k, n]) => `${k} x${n}`).join(', ');
    if (Object.keys(L.setupOps).length) out.push(`setup ops with no StF op, dropped: ${list(L.setupOps)}`);
    if (L.playOps) out.push(`play ops (sounds, effects, flags), dropped: ${L.playOps}`);
    if (L.freedAt) out.push(`moves with no frames (setup op 2), given op 2 at FM's free frame (op 0x12) or their last: ${L.freedAt}`);
    if (L.endsClamped) out.push(`motions whose end frame (setup op 2) is past their last, ended at the last: ${L.endsClamped}`);
    if (Object.keys(L.scriptOps).length) out.push(`command ops and flag tests with no StF one: ${list(L.scriptOps)}`);
    if (L.strikeBytes) out.push(`strikes (setup op 4) with bytes StF has no field for: ${L.strikeBytes}`);
    if (L.motionFlags) out.push(`motion ids whose flag bits (0xF000) are dropped: ${L.motionFlags}`);
    if (L.throws) out.push(`throws, made to fail: ${L.throws}`);
    if (L.escapes) out.push(`throw escape tests, made to fail: ${L.escapes}`);
    if (L.followSwitch) out.push(`follow-up motion switches, made to fail: ${L.followSwitch}`);
    if (L.button8) out.push(`kind 0x31 moves, made to fail: ${L.button8}`);
    if (L.airChecks) out.push(`command op 0x32 as 0x05: ${L.airChecks}`);
    out.push(`action slots his own: ${m.actionSlots} of 52; reaction kinds his own: ${m.reactionKinds} of 30 (the rest Akira's)`);
    return out;
}

function lost(cov) {
    if (!cov.lost) return typeof cov.moves === 'object' ? fmLost(cov.moves) : [`moves: ${cov.moves}`];
    const L = cov.lost, out = [];
    if (!L) return out;           /* a guest built on Akira's: he lost it */
    const ops = Object.entries(L.playOps);
    if (ops.length) out.push(`play ops with no StF op, dropped: ${ops.map(([o, n]) => `${o} x${n}`).join(', ')}`);
    const bits = Object.entries(L.flagBits);
    if (bits.length) out.push(`play op 5 flag bits StF never sets, dropped: ${bits.map(([b, n]) => `bit ${b} x${n}`).join(', ')}`);
    if (L.strikeBytes) out.push(`strikes (setup op 4) whose bytes 4..7 are dropped: ${L.strikeBytes}`);
    if (L.op6Bytes) out.push(`setup op 6 whose bytes 1..2 are dropped: ${L.op6Bytes}`);
    if (L.op2bBytes) out.push(`command op 0x2B byte 2 zeroed: ${L.op2bBytes}`);
    if (cov.op32Dropped) out.push(`command op 0x32 dropped: ${cov.op32Dropped}`);
    if (cov.commitsAsAction) out.push(`commits of a type StF lacks, played as an action: ${cov.commitsAsAction} of ${cov.commits}`);
    if (cov.reactionsFromKind0) out.push(`reactions ${cov.game} has none for, given kind 0's: ${cov.reactionsFromKind0} of ${cov.reactions}`);
    const h = cov.handShapes;
    if (h.kept < h.used) out.push(`hand shapes: ${h.kept} of ${h.used} kept (every ${h.every})`);
    return out;
}

/* ---- out --------------------------------------------------------------------- */

const result = { faults: grade.faults, guests: [] };
for (const cov of coverage.guests) {
    const c = cov.chars[0];
    const own = (s) => s === 'own';
    const tables = grade.tables.filter((t) => cov.chars.includes(t.c) && t.status !== 'neither');
    const record = grade.record.filter((t) => cov.chars.includes(t.c) && t.status !== 'neither');
    const rom = audit(c, cov);
    /* an item a table, a record field or an audit entry: his own when every
     * slot of it is */
    const items = new Map();
    for (const x of [...tables.map((t) => ({ ...t, what: t.what.replace(/\[.*/, '') })), ...record, ...rom])
        items.set(x.what, (items.get(x.what) ?? true) && own(x.status));
    const all = [...items.values()];
    result.guests.push({
        name: cov.name, game: cov.game, chars: cov.chars,
        own: all.filter((x) => x).length, of: all.length,
        tables, record, rom, lost: lost(cov), counts: cov,
        lacks: grade.lacks.filter((x) => cov.chars.includes(x.c)),
    });
}

if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 1));
} else {
    const pct = (a, b) => `${a} of ${b} (${Math.round((100 * a) / b)}%)`;
    for (const g of result.guests) {
        console.log(`${g.name} (${g.game}, characters ${g.chars.join(', ')}): ${pct(g.own, g.of)} of what StF's code reads by character is his own`);
        /* the tables, a line a table and status */
        const byTable = new Map();
        for (const t of g.tables) {
            const k = t.what.replace(/\[.*/, '');
            const e = byTable.get(k) ?? {};
            e[t.status] = (e[t.status] ?? 0) + 1;
            byTable.set(k, e);
        }
        console.log('\n  guest tables (slots):');
        for (const [k, e] of byTable) console.log(`    ${k.padEnd(24)} ${Object.entries(e).map(([s, n]) => `${s} ${n}`).join(', ')}`);
        console.log('\n  character record (both players):');
        const fields = new Map();
        for (const r of g.record) fields.set(r.what, [...(fields.get(r.what) ?? []), r]);
        for (const [w, rs] of fields) {
            const st = [...new Set(rs.map((r) => r.status))].join('/');
            console.log(`    ${w.padEnd(48)} ${st.padEnd(9)}${rs[0].why && st !== 'own' ? ` ${rs[0].why}` : ''}`);
        }
        console.log('\n  StF\'s fighters have, he has none:');
        for (const l of g.lacks) console.log(`    ${l.what}[${l.c}]: ${l.stfHave} of StF's ${PLAYER2} have one`);
        if (!g.lacks.length) console.log('    nothing (in the guest tables)');
        console.log('\n  StF\'s own ROM, by character (the audit):');
        for (const r of g.rom) console.log(`    ${r.what.padEnd(48)} ${r.status.padEnd(9)} ${r.note}`);
        if (typeof g.counts.moves === 'object') console.log(`\n  ${g.game}'s data, imported: ${g.counts.moves.motions} motions, ${g.counts.moves.scriptOps} command ops (${g.counts.moves.commits} moves), ${g.counts.parts} models, ${g.counts.balls} balls`);
        else if (g.counts.moves) console.log(`\n  ${g.game}'s data, imported: ${g.counts.parts} models, ${g.counts.balls} balls`);
        else console.log(`\n  ${g.game}'s data, imported: ${g.counts.motions} motions (+${g.counts.thrownCopies} victim copies), ${g.counts.models} models, ${g.counts.commandUnits} command units, ${g.counts.balls} balls`);
        console.log(`  lost on the way in:`);
        for (const l of g.lost) console.log(`    ${l}`);
        console.log();
    }
    console.log(result.faults.length ? `StF's own slots changed (${result.faults.length}):\n  ${result.faults.slice(0, 20).join('\n  ')}` : 'StF\'s own slots and motions: all StF\'s');
}
process.exit(result.faults.length ? 1 : 0);
