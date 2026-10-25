/*
 * shadow-data.mjs — the fighters' floor shadows of all three games, in Sonic
 * the Fighters' form (docs/SHADOWS.md).
 *
 * StF is the parent: its i960 code (rob_kage_disp_test, 0x63C40) walks one
 * table a character, off_64988[rob +0x1B0], of sixteen 24-byte entries
 * (slot, model, flags, offset x y z) and an 8-byte tail, and sends each entry
 * to the coprocessor's Fn_kage_poly (op 0x74). VF2's and FV's tables have
 * the same entries, fifteen of them; FV's flags mean what StF's do (bit 0
 * lays the x flat, bit 1 the z, bit 2 adds the offset), VF2's bit 0 lays the
 * x flat and anything else the z. This reads every roster fighter's table
 * and writes it as StF's, models still in their own game's numbering (a
 * guest's import renumbers them), and each roster stage's light as StF's
 * VECTER_X/Y.
 *
 *   node tools/shadow-data.mjs           a summary, one line a fighter and a stage
 *   node tools/shadow-data.mjs --json    all of it
 */
import { loadNodeGames } from '../tests/node-roms.mjs';
import { ROSTER } from '../js/games.js';
import { readShadows, shadowSetting } from '../vendor/noclip/js/fightershadow.js';

/* StF's program ROM. */
export const STF = {
    tables: 0x64988,       /* off_64988: a table a character, player 2's at +26 */
    entries: 16, entry: 24, tail: 8,
    balls: 0x4c84,         /* the ball each slot's test takes (send_kage_ball_pntr) */
    stages: 0x8f3d0,       /* stage_data, 256 bytes a stage: +0 flags, +8 VECTER_X,
                              +0xA VECTER_Y, +0xC8 stage_soko */
    stageFloats: 0x64948,  /* stage_floats: the ring's scale by stage */
    roundStages: 0x64938,  /* byte_64938: stages whose test is round (Fn_kage_flag arg 1) */
};
export const FLAG_X = 1, FLAG_Z = 2, FLAG_OFFSET = 4;

/* One table as StF holds it. */
export function stfTable(rom, chr) {
    const v = rom.mainCpuView, at = v.getUint32(STF.tables + 4 * chr, true);
    const entries = Array.from({ length: STF.entries }, (_, i) => {
        const e = at + i * STF.entry;
        return {
            slot: v.getUint32(e, true), model: v.getUint32(e + 4, true), flags: v.getUint32(e + 8, true),
            offset: [12, 16, 20].map((o) => v.getFloat32(e + o, true)),
        };
    });
    const tail = [0, 2, 4, 6].map((o) => v.getUint16(at + STF.entries * STF.entry + o, true));
    return { at, entries, tail };
}

/* A VF2 or FV entry's flags in StF's sense. */
const flagsOf = (game, f) => (game === 'vf2' ? (f & FLAG_OFFSET) | (f & 1 ? FLAG_X : FLAG_Z) : f);

/* A VF2 or FV table as StF's: their fifteen entries, the slot they lack (in
 * StF's tables, slot 0 with model 0) as the sixteenth, and an empty tail. */
export function guestTable(game, entries) {
    const slots = new Set(entries.map((e) => e.slot));
    const missing = [...Array(STF.entries).keys()].filter((s) => !slots.has(s));
    return {
        entries: [
            ...entries.map((e) => ({ ...e, flags: flagsOf(game, e.flags) })),
            ...missing.map((slot) => ({ slot, model: 0, flags: 0, offset: [0, 0, 0] })),
        ],
        tail: [0, 0, 0, 0],
    };
}

/* Each roster fighter's table, player 1's (and StF's player 2's where it
 * differs: VF2's and FV's player 2 only changes colours). */
export function fighterShadows(NG) {
    const out = [];
    const cache = {};
    for (const f of ROSTER) {
        const rom = NG[f.game].rom;
        if (!rom) continue;      /* Shenmue's: no table (docs/SHADOWS.md) */
        if (f.game === 'stf') {
            const t = stfTable(rom, f.index), t2 = stfTable(rom, f.index + 26);
            out.push({ ...f, own: t.at, ...t, p2: t2.at === t.at ? null : t2.at });
            continue;
        }
        const S = (cache[f.game] ??= readShadows(rom));
        /* VF2 by +0x1B1 mod 13 (the record), FV by +0x1B0 (the record, 13 on
         * for player 2's look) */
        const own = rom.mainCpuView.getUint32(S.spec.tables + 4 * (f.index % S.spec.count), true);
        out.push({ ...f, own, ...guestTable(f.game, S.tables[f.index % S.spec.count]), p2: null });
    }
    return out;
}

/* Each roster stage's light in StF's words: VECTER_X the elevation a0,
 * VECTER_Y the azimuth a1, and what the game's own test takes. */
export function stageLights(NG) {
    const out = [];
    for (const [game, G] of Object.entries(NG)) {
        const rom = G.rom;
        if (!rom) continue;
        for (const s of G.stages) {
            if (game === 'stf') {
                const v = rom.mainCpuView, at = STF.stages + 256 * s.slot;
                /* camera_init skips the inside pass on stage 2; flag bit 28
                 * stops the outside one (rob_kage_disp_outside) */
                out.push({
                    game, stage: s.slot, name: s.name,
                    light: { a0: v.getUint16(at + 8, true), a1: v.getUint16(at + 10, true) },
                    ground: v.getFloat32(at + 0xc8, true),
                    ringScale: v.getFloat32(STF.stageFloats + 4 * s.slot, true),
                    round: rom.maincpu[STF.roundStages + s.slot] !== 0,
                    inside: s.slot !== 2, outside: !(v.getUint32(at, true) & (1 << 28)),
                });
                continue;
            }
            const S = readShadows(rom);
            const set = shadowSetting(rom, S, s.slot, [0, 0, 0]);
            out.push({ game, stage: s.slot, name: s.name, ...(set ? { light: set.light, ground: set.ground, round: set.round, lamps: Boolean(S.spec.lamps && rom.maincpu[S.spec.lamps.stages + s.slot]) } : { none: true }) });
        }
    }
    return out;
}

/* The board's guests, by the StF character each one takes (docs/BOARD.md).
 * Each has its own table now (tools/guest-shadows.mjs); this prints the StF
 * table its slot held, which StF's own off_64988 would give it. */
export const BOARD_GUESTS = [
    { name: 'AKIRA', from: 'vf2', chr: 6 },
    { name: 'RYO', from: 'shenmue', chr: 1 },
    { name: 'CHAI', from: 'shenmue', chr: 12 },
    { name: 'HORNET', from: 'daytona', chr: 17 },
];

export function guestInherits(rom) {
    return BOARD_GUESTS.map((g) => {
        const t = stfTable(rom, g.chr), t2 = stfTable(rom, g.chr + 26);
        return { ...g, at: t.at, p2: t2.at, models: t.entries.filter((e) => e.model).map((e) => e.model) };
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const NG = await loadNodeGames();
    const fighters = fighterShadows(NG), stages = stageLights(NG);
    const stf = NG.stf.rom;
    const balls = [...stf.maincpu.subarray(STF.balls, STF.balls + 16)];
    if (process.argv.includes('--json')) {
        console.log(JSON.stringify({ balls, fighters, stages, guests: guestInherits(stf) }, null, 1));
    } else {
        const hex = (n) => `0x${n.toString(16)}`;
        console.log(`StF's ball a slot (0x4C84): ${balls.join(' ')}`);
        for (const f of fighters) {
            const drawn = f.entries.filter((e) => e.model);
            const flags = [...new Set(drawn.map((e) => e.flags))].join('/');
            console.log(`${f.game.padEnd(3)} ${f.name.padEnd(6)} table ${hex(f.own).padEnd(9)} ${drawn.length} parts, flags ${flags}, models ${drawn.map((e) => e.model).join(' ')}${f.p2 ? `; player 2 ${hex(f.p2)}` : ''}`);
        }
        for (const g of guestInherits(stf)) {
            console.log(`board ${g.name.padEnd(6)} (${g.from}) StF ${String(g.chr).padStart(2)}: slot held ${hex(g.at)}${g.p2 !== g.at ? ` (player 2 ${hex(g.p2)})` : ''}, models ${g.models.join(' ')}`);
        }
        for (const s of stages) {
            const l = s.light ? `a0 ${hex(s.light.a0)} a1 ${hex(s.light.a1)}` : 'no shadows';
            const extra = [s.ground != null && `ground ${s.ground.toFixed(2)}`, s.ringScale && `ring x${s.ringScale}`, s.round && 'round', s.lamps && 'lamps', s.inside === false && 'no inside pass', s.outside === false && 'no outside pass'].filter(Boolean).join(', ');
            console.log(`${s.game.padEnd(3)} stage ${String(s.stage).padStart(2)} ${(s.name ?? '').padEnd(18)} ${l}${extra ? `, ${extra}` : ''}`);
        }
    }
}
