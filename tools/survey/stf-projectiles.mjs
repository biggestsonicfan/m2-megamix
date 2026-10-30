#!/usr/bin/env node
/*
 * Sonic the Fighters' projectiles, read from its own ROM set: every motion
 * whose play list throws one (play op 0x23, call_projectile_routine), by
 * character, with what projectile_main_routine copies out of the op and out
 * of the motion's strike (setup op 4) into the projectile object, and the
 * models the projectile's three animations draw. docs/PROJECTILES.md says
 * what each field does.
 *
 *     node tools/survey/stf-projectiles.mjs [--json]
 *
 * Reads sfight.zip from $ROMS_DIR (default ~/build/mameroms).
 */
import { readFileSync } from 'node:fs';
import { loadRomSet, progAddr } from '../../vendor/noclip/js/romset.js';
import { readMoves } from '../../vendor/noclip/js/moves.js';

const ROMS = process.env.ROMS_DIR || `${process.env.HOME}/build/mameroms`;
const json = process.argv.includes('--json');

/* StF's program addresses (stfdisasm's labels). */
const SETUP_LENGTHS = 0x1d006;           /* byte_1D006: a setup op's length */
const PLAY_LENGTHS = 0x1d01f;            /* byte_1D01F: a play op's length */
const MOTIONS = 0xce380, MOTION_COUNT = 519, HEAD = 13;   /* animation_related */
const PROJECTILES = 0xb46ac;             /* projectile_list: a record by type */
const MIRROR_PROJECTILES = 0xb472c;      /* projectile_I_list: player 2's */
const OP_PROJECTILE = 0x23, OP_STRIKE = 4;
const CHARACTERS = 26;
/* projectile_list's records, by type (stfdisasm's names) */
const TYPE = ['fang_cork_shoot', 'fang_cork_shoot', 'bean_bomb_roll', 'bean_bomb_roll_1', 'spinning_cork',
    '_uk_flying_hands', '_uk_heart_thing', 'bomb_in_place_silly_noise', 'fast_bomb_projectile',
    'very_fast_bomb_projectile', 'bean_bomb_nonlit', 'espio_tongue', 'amy_hammer', 'amy_hammer_1',
    'fang_hyper_cork', 'espio_tongue_grab', 'amy_drop_16t_anvil_1', 'amy_drop_16t_anvil_2'];

const zip = readFileSync(`${ROMS}/sfight.zip`);
const rom = await loadRomSet([zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length)]);
const m = rom.maincpu, dv = rom.mainCpuView;
const at = (a) => progAddr(rom, a);
const u8 = (a) => m[a], u16 = (a) => dv.getUint16(a, true), s16 = (a) => dv.getInt16(a, true);
const u32 = (a) => dv.getUint32(a, true), f32 = (a) => dv.getFloat32(a, true);
const hex = (v) => '0x' + (v >>> 0).toString(16).toUpperCase();
const bits = (v) => [...Array(32).keys()].filter((b) => (v >>> b) & 1);

/* A motion's setup ops (to 0 or 8) and, after an 8, its play ops. */
function motionOps(id) {
    const rec = u32(at(MOTIONS) + id * 4);
    if (rec === 0xffffffff || rec >= m.length) return null;
    const setup = [], play = [];
    let p = rec + HEAD, end = 0;
    for (;;) {
        const op = u8(p);
        if (op === 0 || op === 8) { end = op; p++; break; }
        const len = u8(at(SETUP_LENGTHS) + op);
        if (!len) return null;
        setup.push({ op, p });
        p += len;
    }
    if (end === 8) {
        for (;;) {
            const op = u8(p) & 0x7f;
            if (op === 0) break;
            const len = u8(at(PLAY_LENGTHS) + op);
            if (!len) return null;
            play.push({ op, p });
            p += len;
        }
    }
    return { setup, play };
}

/* A projectile record's animation: frames of {radius, scale, model}
 * (sub_8AE04: +0 the hit radius, +4 the scale, +8 the model). */
function animation(a) {
    if (!a) return [];
    const p = at(a), n = u32(p);
    return Array.from({ length: n }, (_, i) => ({ radius: f32(p + 4 + i * 16), scale: f32(p + 8 + i * 16), model: s16(p + 12 + i * 16) }));
}
function record(list, type) {
    const r = at(u32(at(list) + type * 4));
    return { start: u32(r), anims: [1, 2, 3].map((k) => animation(u32(r + k * 4))), word4: u32(r + 0x10) };
}

/* The motions each character's command table plays, and their names. */
const owners = new Map();
for (let c = 0; c < CHARACTERS; c++) {
    const mv = readMoves(rom, c);
    for (const es of mv?.tables.values() ?? []) for (const e of es) {
        const id = e.motion & 0x1fff;
        if (!owners.has(id)) owners.set(id, new Map());
        if (!owners.get(id).has(c) || e.name) owners.get(id).set(c, e.name ?? owners.get(id).get(c) ?? null);
    }
}

const out = [];
for (let id = 0; id < MOTION_COUNT; id++) {
    const ops = motionOps(id);
    const shots = ops?.play.filter((o) => o.op === OP_PROJECTILE) ?? [];
    if (!shots.length) continue;
    const st = ops.setup.find((o) => o.op === OP_STRIKE);
    /* projectile_main_routine's reads of the strike (calc_mht_adr(id, 4)) */
    const strike = st && {
        level: u8(st.p + 2), damage: u8(st.p + 3), stun: u8(st.p + 4), reaction: u16(st.p + 7),
        sound: u8(st.p + 9), push: u8(st.p + 10),
    };
    out.push({
        motion: id,
        characters: [...(owners.get(id) ?? new Map())].map(([c, name]) => ({ character: c, name })),
        strike,
        projectiles: shots.map(({ p }) => ({
            frame: u16(p + 1), type: u8(p + 3), name: TYPE[u8(p + 3)] ?? null, flags: u32(p + 4),
            ball: u8(p + 8), frames: u8(p + 9), b10: u8(p + 10), b11: u8(p + 11),
            radius: f32(p + 12), offset: [f32(p + 16), f32(p + 20)], f24: f32(p + 24),
        })),
    });
}
const types = [...new Set(out.flatMap((o) => o.projectiles.map((s) => s.type)))].sort((a, b) => a - b);
const records = Object.fromEntries(types.map((t) => [t, { player1: record(PROJECTILES, t), player2: record(MIRROR_PROJECTILES, t) }]));

if (json) {
    console.log(JSON.stringify({ motions: out, types: records }, null, 1));
} else {
    for (const o of out) {
        const who = o.characters.map((c) => `${c.character}${c.name ? ` ${c.name}` : ''}`).join(', ') || 'no command';
        const s = o.strike;
        console.log(`motion ${o.motion} (${who})` + (s ? `: strike level ${s.level}, damage ${s.damage}, stun ${s.stun}, reaction ${hex(s.reaction)}, record ${s.push}` : ': no strike op'));
        for (const p of o.projectiles)
            console.log(`  frame ${p.frame}: type ${p.type} ${p.name}, flags bits ${bits(p.flags).join(' ') || '-'}, ball ${p.ball}, ` +
                `${p.frames} frames, radius ${p.radius}, offset (${p.offset.join(', ')})`);
    }
    for (const [t, r] of Object.entries(records)) {
        const models = (a) => [...new Set(a.map((f) => f.model))].join(' ') || '-';
        console.log(`type ${t} ${TYPE[t]}: start ${hex(r.player1.start)}, models: flight ${models(r.player1.anims[0])}, ` +
            `burst ${models(r.player1.anims[1])}, fuse ${models(r.player1.anims[2])}`);
    }
}
