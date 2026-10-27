#!/usr/bin/env node
/*
 * Every fighter record and every stage record of the three games, side by
 * side, with the fields whose meaning is not known set out by value.
 *
 *   node tools/record-survey.mjs [--json out.json]   (reads $ROMS_DIR's zips)
 *
 * A field's name comes from the code that reads it (docs/SHARED-CODE.md,
 * docs/DEBUG-MODE.md, docs/FV-STAGES.md, noclip's readers); a field nobody has
 * named is printed for every record, so a value that only one fighter or
 * one stage has can be matched with what that fighter or stage does. The
 * readings are docs/RECORDS.md.
 */
import { writeFileSync } from 'node:fs';
import { loadNodeGames } from '../tests/node-roms.mjs';
import { CHARACTERS } from '../vendor/noclip/js/characters.js';
import { progAddr } from '../vendor/noclip/js/romset.js';
import { resolveData } from '../vendor/noclip/js/motion.js';
import { xtraResolve } from '../vendor/noclip/js/romset.js';

const games = await loadNodeGames();
const out = { fighters: {}, stages: {} };
const hex = (v, n = 0) => `0x${v.toString(16).toUpperCase().padStart(n, '0')}`;

/* A word as what it most likely is: a pointer into the program or data
 * ROM, a float of sane size, or a number. */
function word(dv, at) {
    const u = dv.getUint32(at, true), f = dv.getFloat32(at, true);
    if (u === 0) return '0';
    if (Math.abs(f) >= 1e-4 && Math.abs(f) < 1e6 && (u & 0xff) === 0) return Number.isInteger(f) ? f.toFixed(1) : String(+f.toFixed(4));
    if ((u >= 0x1000 && u < 0x100000 && !(u & 1)) || (u >= 0x2000000 && u < 0x2800000) || (u >= 0x6400000 && u < 0x7000000)) return hex(u);
    if (u < 0x10000) return String(u);
    return hex(u, 8);
}

function table(head, rows) {
    return [`| ${head.join(' | ')} |`, `|${head.map(() => '--').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

/* Fields: [offset, name or null]. A null name is a field whose meaning is
 * not known; it is printed by value. */
const STF_CHAR = [
    [0x00, 'parts (16 normal, 16 squished) → rob+0x40'], [0x04, 'skeleton → rob+0x8C'],
    [0x08, 'second parts list → rob+0x1B4 (calc_rob_angle_int, skeleton type > 2)'],
    [0x0C, 'action table → rob+0x1A0'], [0x10, 'reach table (get_en_info)'], [0x14, 'weight → rob+0x5D8'],
    [0x18, 'option data (copy_option_data) → rob+0x784..0x7F8'], [0x1C, null],
    [0x20, 'jump frames (2 bytes) → rob+0x5BE, speed scales → rob+0x724..0x730'],
    [0x24, 'step radius → rob+0x6C8 (clamps the move step at 0x13FF4)'],
    [0x28, 'guard-break damage high, low (× rounds to win), ukemi frame → rob+0xAF0..0xAF8'], [0x2C, null],
];
const VF2_CHAR = [
    [0x00, 'parts'], [0x04, 'skeleton'], [0x08, null], [0x0C, 'elbow pattern (disp_hiji_ptn)'],
    [0x10, 'feet pattern (set_ashi_ptn)'], [0x14, 'action table'], [0x18, 'reach: near'], [0x1C, 'reach: far'],
    [0x20, 'reach: down'], [0x24, 'reach: close'], [0x28, '→ rob+0x698, copro 0x2D805B5B'], [0x2C, 'weight'],
    [0x30, 'texture set'], [0x34, 'mirror-floor reflection models (stage bit 5)'], [0x38, 'midriff → rob+0x64, rob+0x44'], [0x3C, 'hand shapes (set_te_ptn)'], [0x40, 'hat (hat_off_disp)'],
    [0x44, 'ending afterimage models (ENDSUB_INT)'], [0x48, null], [0x4C, 'jump frames (byte)'],
];
const FV_CHAR = [
    [0x00, 'parts'], [0x04, 'skeleton'], [0x08, null], [0x0C, null], [0x10, null], [0x14, 'action table'],
    [0x18, null], [0x1C, 'weight'], [0x20, 'texture set'], [0x24, 'midriff'], [0x28, null], [0x2C, null],
    [0x30, null], [0x34, null], [0x38, null], [0x3C, null],
];

function fighterRecords(key, fields) {
    const g = games[key], rom = g.rom;
    const rows = [];
    if (key === 'stf') {
        const dv = rom.mainCpuView;
        const at = progAddr(rom, 0xC5268);
        for (const c of CHARACTERS) {
            if (c.index >= 26) continue;
            const rec = dv.getUint32(at + c.index * 4, true);
            rows.push({ index: c.index, name: c.name, at: rec, vals: fields.map(([o]) => word(dv, rec + o)) });
        }
    } else {
        const F = rom.game.rig.fighters;
        for (let i = 0; i < F.count; i++) {
            const p = resolveData(rom, F.records + i * 4);
            const rec = p.view.getUint32(p.off, true);
            const r = resolveData(rom, rec);
            rows.push({ index: i, name: F.names[i] ?? `record ${i}`, at: rec, vals: fields.map(([o]) => word(r.view, r.off + o)) });
        }
    }
    return rows;
}

const md = [];
for (const [key, fields, title] of [['stf', STF_CHAR, "StF's character records (CHAR_PARTS 0xC5268, 0x30 bytes)"],
    ['vf2', VF2_CHAR, "VF2's fighter records (0x200620C)"], ['fv', FV_CHAR, "FV's fighter records (0x640D2B0)"]]) {
    const rows = fighterRecords(key, fields);
    out.fighters[key] = { fields: fields.map(([o, n]) => ({ offset: o, name: n })), rows };
    md.push(`### ${title}`, '');
    const unk = fields.map((f, i) => [f, i]).filter(([[, n]]) => !n);
    md.push('Known: ' + fields.filter(([, n]) => n).map(([o, n]) => `+${hex(o, 2)} ${n}`).join('; ') + '.', '');
    md.push(table(['#', 'record', 'at', ...unk.map(([[o]]) => `+${hex(o, 2)}`)],
        rows.map((r) => [r.index, r.name, hex(r.at), ...unk.map(([, i]) => r.vals[i])])), '');
}

/* ---- part lists: model ids with bit 15 ---- */
{
    const rom = games.stf.rom, dv = rom.mainCpuView, at = progAddr(rom, 0xC5268);
    const flagged = [];
    for (const c of CHARACTERS) {
        if (c.index >= 26) continue;
        const parts = dv.getUint32(dv.getUint32(at + c.index * 4, true), true);
        for (let s = 0; s < 32; s++) {
            const m = dv.getUint32(parts + s * 4, true);
            if (m & 0x8000) flagged.push([c.index, c.name, s < 16 ? 'normal' : 'squished', s & 15, hex(m, 4)]);
        }
    }
    out.flaggedParts = flagged;
    md.push("### StF part-list entries with bit 15", '', table(['#', 'character', 'list', 'slot', 'entry'], flagged), '');
}

/* ---- stages ---- */
const STF_FLAGS = {
    2: 'no floor model (+0x18)', 13: 'no floor tiles', 14: 'cage_sub_disp (+0x1C, +0x1E)', 18: 'poles',
    19: 'four-sided wall', 20: 'cage top (+0x20) at z ±6', 21: 'two-sided wall', 22: 'one-sided wall',
    23: 'cage_sub_disp early', 24: 'stage_dsp early', 25: 'no rob_low_disp', 26: 'stage_dsp after the cage',
    27: 'second sky pair', 28: 'no fighter shadows', 29: 'three-sided wall',
};
const FV_FLAGS = {
    3: 'rising (elevator)', 23: 'wall pieces early', 24: 'platform early', 25: 'fighters early',
    11: 'no upper list', 13: 'no ground list', 14: 'extra list', 16: 'turning', 17: 'rail', 18: 'poles',
    19: 'four panels a wall', 20: 'cage top (+0x20)', 21: 'two panels', 22: 'one panel',
};
const VF2_FLAGS = { 1: 'scenery list (+0x00)', 7: 'extra scenery culled by position', 9: 'extra scenery culled by angle',
    11: 'snow ground', 13: 'no backdrop (+0x40)', 2: 'ring', 3: 'raft', 4: 'rock', 5: 'mirror floor', 6: 'second look', 8: 'extra piece', 12: 'one model' };

/* The byte ranges no reader names, by game. */
const UNNAMED = {
    stf: [[0x22, 0x64], [0xBC, 0xC0], [0xD4, 0x100]], /* no reader of any (rom_code1.asm) */
    fv: [[0x22, 0x24], [0xBC, 0xC0], [0xD4, 0x100]],
    vf2: [[0x66, 0x68], [0x75, 0x76], [0x77, 0x78], [0x83, 0x84], [0xE4, 0x100]],
};

function stageRecords(key) {
    const rom = games[key].rom;
    const T = rom.game.stageTable;
    const vf2 = T.vf2;
    const base = vf2 ? vf2.at : T.at, count = vf2 ? vf2.count : T.count;
    const rows = [];
    for (let s = 0; s < count; s++) {
        const addr = base + s * 256;
        let dv, b;
        if (T.source === 'xtra') { const r = xtraResolve(rom, addr); dv = r.view; b = r.off; } else { dv = rom.mainCpuView; b = progAddr(rom, addr); }
        const flags = dv.getUint32(b + (vf2 ? 0x68 : 0), true);
        const num = vf2 ? s : dv.getUint8(b + 0x13);
        const extra = [];
        for (const [lo, hi] of UNNAMED[key]) {
            for (let o = lo; o < hi; o += (hi - o >= 4 && !(o & 3) ? 4 : 1)) {
                const w = hi - o >= 4 && !(o & 3);
                const v = w ? dv.getUint32(b + o, true) : dv.getUint8(b + o);
                if (v) extra.push([o, w ? word(dv, b + o) : String(v)]);
            }
        }
        rows.push({ slot: s, num, flags, extra });
    }
    return rows;
}

/* VF2 names a record by its colour block (+0x7C): the debug menu's list,
 * through the pointers at 0x46108 (noclip vf2.js stageName). */
function vf2Name(slot) {
    const dv = games.vf2.rom.mainCpuView;
    const colors = dv.getUint32(0x6EE38 + slot * 256 + 0x7C, true);
    const at = dv.getUint32(0x46108 + (colors + 1) * 4, true);
    let t = '';
    for (let i = 0; i < 13 && dv.getUint8(at + i); i++) t += String.fromCharCode(dv.getUint8(at + i));
    return t.split(':')[1]?.trim() ?? '';
}

const named = (key) => {
    const list = games[key].stages.concat(games[key].extraStages ?? []);
    return (slot) => list.find((st) => st.slot === slot && !/second look/.test(st.name))?.name ?? '';
};

for (const [key, names, title] of [['stf', STF_FLAGS, "StF's stage records (stage_data 0x8F3D0)"],
    ['fv', FV_FLAGS, "FV's stage records (0x06CE1048)"], ['vf2', VF2_FLAGS, "VF2's stage records (0x6EE38)"]]) {
    const rows = stageRecords(key);
    out.stages[key] = rows;
    const nameOf = key === 'vf2' ? vf2Name : named(key);
    md.push(`### ${title}`, '');
    const bits = [...new Set(rows.flatMap((r) => [...Array(32).keys()].filter((i) => r.flags >>> i & 1)))].sort((a, b) => a - b);
    md.push(table(['slot', 'stage', 'flags', ...bits.map((i) => `${i}${names[i] ? '' : '?'}`)],
        rows.map((r) => [r.slot, nameOf(r.slot), hex(r.flags, 8), ...bits.map((i) => (r.flags >>> i & 1 ? 'x' : ''))])), '');
    md.push('Flag bits named: ' + (Object.entries(names).map(([i, n]) => `${i} ${n}`).join('; ') || 'none') + '; `?` marks a bit set somewhere and not named.', '');
    const offs = [...new Set(rows.flatMap((r) => r.extra.map(([o]) => o)))].sort((a, b) => a - b);
    if (offs.length) {
        md.push(`Unnamed bytes that are not zero (${UNNAMED[key].map(([a, z]) => `+${hex(a, 2)}..+${hex(z - 1, 2)}`).join(', ')}):`, '');
        md.push(table(['slot', ...offs.map((o) => `+${hex(o, 2)}`)],
            rows.map((r) => [r.slot, ...offs.map((o) => r.extra.find(([x]) => x === o)?.[1] ?? '')])), '');
    }
}

const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0) writeFileSync(process.argv[jsonAt + 1], JSON.stringify(out, null, 1));
console.log(md.join('\n'));
