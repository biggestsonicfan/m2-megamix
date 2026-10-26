/*
 * The board's sound ROMs: StF's sound program (epr-19021) with Fighting
 * Vipers' and Virtua Fighter 2's songs and VF2's Akira's sounds added to its
 * data, and a sample ROM holding only what that data plays (docs/BOARD.md,
 * Sound).
 *
 * StF's sound program and FV's (epr-18628) are one driver: their first 32 KB,
 * the code, are the same, and every byte of data hangs off the root table at
 * 0x608000 (11 longs):
 *
 *   [0] the sample directory: a word (bytes - 1), then 16-byte entries {start,
 *       bytes, loop start, loop bytes}, start and loop as 68000 addresses in
 *       the sample ROM (0x800000..). The driver copies it to RAM 0x5000, so it
 *       holds 1024 entries at most (0x9000 is the tone table's).
 *   [1] the tones (programs): a word (count - 1), then a word offset per
 *       tone from the table. A tone that starts 0xFF is by key: [FF][flag][lo]
 *       [hi], then 12 bytes a key from lo to hi, its sample's index the first
 *       word (negative: no sample). Any other is a key map, 10-byte records
 *       (the highest key, then the sample's index at +4) to one of key 0x7F;
 *       0x80 first is one record of 18 bytes. The driver copies the table to
 *       RAM 0x9000, its size taken as [7] - [1], so the requests follow it.
 *   [3] the scenes (0xA007nn): a word (count - 1), word offsets, each [volume]
 *       [DSP][mixer][bank set][?][channels - 1] (0xFF: left as it is), then 16
 *       bytes a channel, [flags][MIDI channel][tone][volume]...
 *   [4] the SE channels (0xC, 0xD, 0xE) the same way, [8] the bank sets
 *       (0xA005nn: samples copied to RAM 0x50000..0x6FFFF), [5] the mixer,
 *       [6] the DSP programs, [10] the velocity curve.
 *   [7] the requests, by the codes the main CPU sends: 0xAn GG II is entry II
 *       of group GG (0x10..). A word (groups - 1), word offsets of each
 *       group's list from the table, each a word (entries - 1) and word
 *       offsets from the table. An entry that starts 0 is a song: 3 more
 *       bytes, then a playlist of longs, 0x80xxxxxx a command (0x80A00702
 *       sets scene 2), 0xFFFFFFF1 then where to go on, 0xFFFFFFFF the end,
 *       and any other the address of a track. A negative one is a sound
 *       effect, its track inline (9C kk vv 00 FF 2F: a note on channel 0xC).
 *
 * A track is MIDI-like: status bytes with running status, a delta after each
 * event (one byte, two when its top bit is set) unless the event's last data
 * byte has its top bit set, FF 2F its end. Cn tt is tone tt on channel n. A
 * track holds no addresses, so it moves as it is, its tones renumbered.
 *
 * What is added: each FV song in FV_SONGS as a new entry of group 0x10 (code
 * 0xAE1000 + its index), its scene, tones and samples appended after StF's
 * own (new numbers), its tracks copied into the program ROM's free end. The
 * new tables go there too, and the root table points at them; StF's old ones
 * stay where they were (their songs' loops point into them).
 *
 * VF2's driver (epr-17574) is the same one, older: the same track format,
 * tick (Timer A 0xCE, 882 Hz), voice setup and pitch tables, but its data
 * hangs off fixed addresses (V_*), its directory entries carry the envelope
 * (20 bytes) and its tone records are shorter. A VF2 song is converted
 * (vf2Tone, vf2Scene, vf2Track): its preset 0 channels become a scene, each
 * tone it plays a new StF tone (a key map's 6-byte records +4 bytes of
 * envelope; a by-key kit's 6-byte records the 12 of StF's), its tracks copied
 * with their tones renumbered and CC 0x2A (StF's 0..7) scaled.
 *
 * Akira's sounds (VF2_EFFECTS, group 0x15: vf2Effect gives a VF2 code's):
 * VF2's moves send 9E kk vv (key kk of kit F2 on channel 14) and his voices
 * AD 23 0n and AD 24 0n (key n of kit FF on channel 11, of FE on 10). StF's MIDI channels are all taken
 * (a program change in an effect's track would cut StF's own sounds on that
 * channel), so his are one tone on a fourth SE channel record on channel 14,
 * beside StF's own (kit 0x52): every record of a channel plays its notes, and
 * his tone holds only keys no kept request plays there, those keys emptied in
 * kit 0x52.
 *
 * Samples: the board's ROM is 8 MB, which StF's own fill. It keeps the samples
 * of StF's sound effects the board can send (sends: every code StF's program
 * or the board's names, but for the sound test's list, AUDIO_LIST, which
 * names them all), StF's bank set 0 (loaded at the driver's start) and the
 * songs the board plays (KEEP_SONGS), then the guests'. A sample nothing kept
 * can play points at a short silence.
 *
 *   node tools/guest-sound.mjs   (a report, from $ROMS_DIR's zips)
 */
import { readFileSync } from 'node:fs';
import { readZipDirectory, extractZipEntry } from '../vendor/noclip/js/zip.js';

const ROMS = process.env.ROMS_DIR || `${process.env.HOME}/build/mameroms`;

/* StF's songs on the board: Aurora Icefield's and South Island's (megamix.c,
 * STAGE_MUSIC_IN_ORDER) */
export const KEEP_SONGS = [3, 4];
/* FV's songs to add, by FV's index in group 0x10 (its sound test's list:
 * western_song is 0xAE1005), and the code each gets, which board/src/megamix.c
 * sends (SND_FV_WESTERN) */
export const FV_SONGS = [{ name: 'western', fv: 5, code: 0xAE1019 }];
/* VF2's songs to add, by VF2's index in its group 0x10 (AD10nn: Tou-rin's
 * stage plays Lau's 0x0B, the Colosseum's Akira's 0x03), the codes after
 * FV's (megamix.c, SND_VF2_TOURIN and SND_VF2_COLOSSEUM) */
export const VF2_SONGS = [{ name: 'tourin', vf2: 0x0B, code: 0xAE101A }, { name: 'colosseum', vf2: 0x03, code: 0xAE101B }];
/* Akira's sounds, group 0x15: VF2's 9E kk vv for each of these keys and
 * velocities (kit F2's keys his moves play), then his voices, VF2's
 * requests AD gg nn (each a note of key nn on a kit's channel) */
export const VF2_EFFECTS = 0x15;
const VF2_SE_KEYS = [0x00, 0x06, 0x0D, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x18, 0x1F, 0x24];
const VF2_SE_VELS = [0x5F, 0x7F];
const VF2_SE_KIT = 0xF2;
const VF2_VOICES = [{ group: 0x23, kit: 0xFF, n: 5, vel: 0x78 }, { group: 0x24, kit: 0xFE, n: 6, vel: 0x7F }];
/* the StF code of a VF2 sound code Akira's moves send; null: none */
export function vf2Effect(code) {
    let i = -1;
    if (code >>> 16 === 0x9E) {
        const k = VF2_SE_KEYS.indexOf((code >> 8) & 0xFF), v = VF2_SE_VELS.indexOf(code & 0xFF);
        if (k >= 0 && v >= 0) i = k * VF2_SE_VELS.length + v;
    } else {
        let at = VF2_SE_KEYS.length * VF2_SE_VELS.length;
        for (const g of VF2_VOICES) {
            if (code >>> 8 === (0xAD00 | g.group) && (code & 0xFF) < g.n) i = at + (code & 0xFF);
            at += g.n;
        }
    }
    return i < 0 ? null : 0xAE0000 | (VF2_EFFECTS << 8) | i;
}

const PROG = 0x600000, SAMPLES = 0x800000, SAMPLE_BYTES = 0x800000;
const DIR_MAX = 1024, TONE_RAM = 0x7000;   /* RAM 0x9000..0xFFFF: the voices' buffers start at 0x10000 */

export const STF_FILES = { zip: 'sfight', prog: 'epr-19021.31', samples: ['mpr-19022.32', 'mpr-19023.33', 'mpr-19024.34', 'mpr-19025.35'] };
const FV_FILES = { zip: 'fvipers', prog: 'epr-18628.31', samples: ['mpr-18629.32', 'mpr-18630.33', 'mpr-18631.34', 'mpr-18632.35'] };
const VF2_FILES = { zip: 'vf2', prog: 'epr-17574.30', samples: ['mpr-17573.31', 'mpr-17572.32', 'mpr-17571.36', 'mpr-17570.37'] };
/* StF's main program (two ROMs, a word of each in turn), read for the codes it sends */
const STF_MAIN = ['epr-19001.15', 'epr-19002.16'];
const AUDIO_LIST = 0xDC2C8;                /* the sound test's list: pointers to {code, name} */
const SE_CH = 14, SE_KIT = 0x52;           /* StF's SE channel record Akira's shares, and its kit */
const CHANNELS = 20;                       /* the driver's channel records: a scene's, then the SE channels' */

/* VF2's sound data (epr-17574): the directory (a word, bytes - 1, then 20-byte
 * entries {start, bytes, loop, loop bytes, envelope}), the key maps by
 * program (6-byte records {highest key, -, fine, key offset, sample}, to one
 * of key 0x7F), the by-key kits by program - 0xF0 (128 records of 6 bytes
 * {sample, 0x00FF: none; pitch; pan, 0x80: the channel's; effect send}),
 * channel preset 0 (20 16-byte records, StF's scene layout; bit 0 of the
 * flags: an SE channel) and the requests (a long by group, each a word
 * (entries - 1) and longs) */
const V_DIR = 0x605b26, V_MAPS = 0x6053aa, V_KITS = 0x6032c6, V_PRESET = 0x6030e6, V_REQ = 0x608e12;
const V_CHANNELS = 20;

/* the ROMs are ROM_LOAD16_WORD_SWAP: swap each word's bytes for the 68000's view */
function swap16(b) {
    const o = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i += 2) { o[i] = b[i + 1]; o[i + 1] = b[i]; }
    return o;
}
const cat = (parts) => {
    const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { o.set(p, at); at += p.length; }
    return o;
};

/* one game's sound data, read through its root table */
export class SoundData {
    constructor(prog, samples) {
        this.p = prog; this.s = samples;
        this.dv = new DataView(prog.buffer, prog.byteOffset, prog.length);
        this.root = Array.from({ length: 11 }, (_, i) => this.u32(0x8000 + 4 * i));
    }
    u8(o) { return this.p[o]; }
    u16(o) { return this.dv.getUint16(o); }
    s16(o) { return this.dv.getInt16(o); }
    u32(o) { return this.dv.getUint32(o); }
    off(a) { return a - PROG; }

    dir() {
        const d = this.off(this.root[0]), n = (this.u16(d) + 1) / 16;
        return Array.from({ length: n }, (_, i) => {
            const e = d + 2 + 16 * i;
            return { start: this.u32(e), bytes: this.u32(e + 4), loop: this.u32(e + 8), loopBytes: this.u32(e + 12) };
        });
    }
    /* a table of word offsets after a word (count - 1): the entries' offsets in the ROM */
    table(ri) {
        const t = this.off(this.root[ri]), n = this.u16(t) + 1;
        return { at: t, offs: Array.from({ length: n }, (_, i) => t + this.u16(t + 2 + 2 * i)) };
    }
    /* a tone: its bytes' offset and size, and where its sample indices are, by key */
    tone(n) {
        const { offs } = this.table(1);
        if (n >= offs.length) return null;
        const o = offs[n], b = this.p;
        if (b[o] === 0xFF) {
            const lo = b[o + 2], hi = b[o + 3], keys = [];
            for (let k = lo; k <= hi; k++) keys.push({ key: k, at: o + 4 + 12 * (k - lo) });
            return { at: o, size: 4 + 12 * (hi - lo + 1), byKey: true, keys };
        }
        if (b[o] === 0x80) return { at: o, size: 18, byKey: false, keys: [{ key: -1, at: o + 4 }] };
        const keys = [];
        for (let e = o; ; e += 10) {
            keys.push({ key: b[e], at: e + 4 });
            if (b[e] >= 0x7F) return { at: o, size: e + 10 - o, byKey: false, keys };
        }
    }
    /* the samples a tone plays for these keys (a key map: all of its records,
     * as it is looked up by the transposed key) */
    toneSamples(n, keys) {
        const t = this.tone(n), out = new Set();
        if (!t) return out;
        for (const k of t.keys) {
            const s = this.s16(k.at);
            if (s >= 0 && (!t.byKey || !keys || keys.has(k.key))) out.add(s);
        }
        return out;
    }
    requests() {
        const t = this.off(this.root[7]), ng = this.u16(t) + 1, groups = {};
        for (let g = 0; g < ng; g++) {
            const gp = t + this.u16(t + 2 + 2 * g), n = this.u16(gp) + 1;
            groups[0x10 + g] = Array.from({ length: n }, (_, i) => t + this.u16(gp + 2 + 2 * i));
        }
        return { at: t, groups };
    }
    /* a song's playlist, from its entry's offset: the items and the end */
    playlist(e) {
        const items = [];
        for (let o = e + 4; ; o += 4) {
            const w = this.u32(o);
            if (w === 0xFFFFFFFF || w === 0xFFFFFFF2) { items.push({ at: o, kind: 'end', w }); return { items, end: o + 4 }; }
            if (w === 0xFFFFFFF1) { items.push({ at: o, kind: 'goto', to: this.u32(o + 4) }); return { items, end: o + 8 }; }
            if (w >>> 24 === 0x80) items.push({ at: o, kind: 'cmd', cmd: w & 0xFFFFFF });
            else items.push({ at: o, kind: 'track', to: w });
        }
    }
    /* a track's events, from its offset: { st, d: [data], at: data offset } and the end */
    track(a) {
        const b = this.p, ev = [];
        let o = a, st = 0;
        for (let n = 0; n < 0x40000; n++) {
            if (b[o] & 0x80) st = b[o++];
            const hi = st & 0xF0;
            let d, last;
            if (hi === 0x80 || hi === 0xC0 || hi === 0xD0) { d = [b[o] & 0x7F]; last = b[o]; ev.push({ st, d, at: o }); o += 1; }
            else if (hi === 0x90 || hi === 0xA0 || hi === 0xB0 || hi === 0xE0) { d = [b[o], b[o + 1] & 0x7F]; last = b[o + 1]; ev.push({ st, d, at: o }); o += 2; }
            else if (st === 0xF7) { o += b[o] + 1; last = 0; }
            else if (st === 0xF0) { while (b[o] !== 0xF7) o++; o++; last = 0; }
            else if (st === 0xFF && b[o] !== 0x2F) { o += b[o + 1] + 2; last = 0; }
            else if (st === 0xFF) return { ev, end: o + 1 };
            else throw new Error(`track 0x${(a + PROG).toString(16)}: status 0x${st.toString(16)} at 0x${(o + PROG).toString(16)}`);
            if (!(last & 0x80)) o += b[o] & 0x80 ? 2 : 1;
        }
        throw new Error(`track 0x${(a + PROG).toString(16)} has no end`);
    }
    scene(n) {
        const { offs } = this.table(3), o = offs[n], b = this.p;
        const nch = b[o + 5] + 1;
        return { at: o, size: 6 + 16 * nch, head: b.subarray(o, o + 6), chans: Array.from({ length: nch }, (_, i) => o + 6 + 16 * i) };
    }
    seChannels() {
        const o = this.off(this.root[4]), n = this.p[o];
        return Array.from({ length: n }, (_, i) => o + 1 + 16 * i);
    }
    bankSet(n) {
        const t = this.off(this.root[8]);
        if (n > this.u16(t)) return [];
        let o = t + this.u16(t + 2 + 2 * n);
        const k = this.s16(o);
        if (k < 0) return [];
        return Array.from({ length: k + 1 }, (_, i) => this.u16(o + 2 + 2 * i));
    }

    /* what a song plays: its scene, its tracks (offsets), the tones it sets
     * and the keys it plays on each, the bank sets and commands it sends */
    song(index) {
        const e = this.requests().groups[0x10][index];
        if (this.p[e] !== 0) throw new Error(`entry ${index} of group 0x10 is not a song`);
        const pl = this.playlist(e);
        const tone = new Map(), keys = new Map(), cmds = [];
        let scene = null;
        const use = (ch, t) => { tone.set(ch, t); if (!keys.has(t)) keys.set(t, new Set()); };
        for (const it of pl.items) if (it.kind === 'cmd') {
            cmds.push(it.cmd);
            if (it.cmd >>> 8 === 0xA007) {
                scene = it.cmd & 0xFF;
                for (const c of this.scene(scene).chans) use(this.p[c + 1], this.p[c + 2]);
            }
        }
        const tracks = [...new Set(pl.items.filter((it) => it.kind === 'track').map((it) => this.off(it.to)))];
        const walked = tracks.map((t) => ({ at: t, ...this.track(t) }));
        for (const w of walked) for (const ev of w.ev) {
            const hi = ev.st & 0xF0, ch = ev.st & 15;
            if (hi === 0xC0) use(ch, ev.d[0]);
            else if (hi === 0x90 && ev.d[1] && tone.has(ch)) keys.get(tone.get(ch)).add(ev.d[0]);
            else if (hi === 0xA0) cmds.push(((ev.st & 0xFF) << 16) | (ev.d[0] << 8) | ev.d[1]);
        }
        const samples = new Set();
        for (const [t, ks] of keys) for (const s of this.toneSamples(t, ks)) samples.add(s);
        return { entry: e, playlist: pl, scene, tracks: walked, keys, cmds, samples };
    }
    /* the samples a group of sound effects plays, through the SE channels'
     * tones (sends: only the entries of these codes) */
    effects(group, sends = null) {
        const se = new Map(this.seChannels().map((c) => [this.p[c + 1], this.p[c + 2]]));
        const samples = new Set();
        for (const [i, e] of this.requests().groups[group].entries()) {
            if (!(this.p[e] & 0x80)) continue;
            if (sends && !sends.has(0xAE0000 | (group << 8) | i)) continue;
            const tone = new Map(se);
            for (const ev of this.track(e + 1).ev) {
                const hi = ev.st & 0xF0, ch = ev.st & 15;
                if (hi === 0xC0) tone.set(ch, ev.d[0]);
                if (hi === 0x90 && ev.d[1] && tone.has(ch)) for (const s of this.toneSamples(tone.get(ch), new Set([ev.d[0]]))) samples.add(s);
            }
        }
        return samples;
    }
    /* the end of the used program ROM (the rest is 0xFF) */
    used() {
        let n = this.p.length;
        while (n && this.p[n - 1] === 0xFF) n--;
        return n;
    }
}

/* VF2's sound data, read through its fixed addresses (V_*) */
class Vf2Data extends SoundData {
    dir() {
        const d = this.off(V_DIR), n = (this.u16(d) + 1) / 20;
        return Array.from({ length: n }, (_, i) => {
            const e = d + 2 + 20 * i;
            return { start: this.u32(e), bytes: this.u32(e + 4), loop: this.u32(e + 8), loopBytes: this.u32(e + 12), env: this.u32(e + 16) };
        });
    }
    /* a program's tone: a by-key kit (0xF0..) or a key map, its records */
    tone(prog) {
        if (prog >= 0xF0) {
            const o = this.off(this.u32(this.off(V_KITS) + 4 * (prog - 0xF0)));
            return { byKey: true, keys: Array.from({ length: 128 }, (_, k) => ({ key: k, at: o + 6 * k })) };
        }
        const o = this.off(this.u32(this.off(V_MAPS) + 4 * (prog & 0x7F))), keys = [];
        for (let e = o; ; e += 6) {
            keys.push({ key: this.p[e], at: e });
            if (this.p[e] >= 0x7F) return { byKey: false, keys };
            if (keys.length > 64) throw new Error(`VF2 program 0x${prog.toString(16)}: its key map has no end`);
        }
    }
    sample(t, k) {
        const s = this.u16(t.byKey ? k.at : k.at + 4);
        return t.byKey && s === 0x00FF ? -1 : s;
    }
    /* a map's samples are all of its records (looked up by the transposed key) */
    toneSamples(prog, keys) {
        const t = this.tone(prog), out = new Set();
        for (const k of t.keys) {
            const s = this.sample(t, k);
            if (s >= 0 && (!t.byKey || keys.has(k.key))) out.add(s);
        }
        return out;
    }
    entry(g, n) {
        const l = this.off(this.u32(this.off(V_REQ) + 4 * g));
        if (n > this.u16(l)) throw new Error(`VF2 request 0xAD${g.toString(16)}${n.toString(16).padStart(2, '0')}: past its group`);
        return this.off(this.u32(l + 2 + 4 * n));
    }
    /* preset 0's music channels (a preset is 20 records, as the driver's
     * channels; its SE ones, bit 0, are the SE channels') */
    preset() {
        const out = [], o = this.off(V_PRESET);
        for (let i = 0; i < V_CHANNELS; i++) {
            const r = o + 16 * i;
            if ((this.p[r] & 0x81) === 0x80) out.push(r);
        }
        return out;
    }
    /* program change n: 0x70 on is a kit, 0xF0 on */
    static prog(n) { return n >= 0x70 ? n | 0x80 : n; }
    /* what a song plays: its playlist, its preset channels, its tracks, each
     * program's keys, its master volume (CC 0x10 on 14) and samples */
    song(n) {
        const e = this.entry(0x10, n);
        if (this.p[e] & 0x80) throw new Error(`VF2 0xAD10${n.toString(16).padStart(2, '0')} is not a song`);
        const playlist = this.playlist(e);
        if (playlist.items.some((it) => it.kind === 'cmd')) throw new Error(`VF2 song 0x${n.toString(16)}: a command in its playlist`);
        const chans = this.preset();
        const prog = new Map(chans.map((c) => [this.p[c + 1], this.p[c + 2]]));
        const keys = new Map(), walked = new Map();
        const order = playlist.items.filter((it) => it.kind === 'track').map((it) => this.off(it.to));
        for (const t of order) if (!walked.has(t)) walked.set(t, { at: t, ...this.track(t) });
        let master = null, stray = 0;
        /* twice: the loop starts again with the programs the end left */
        for (let pass = 0; pass < 2; pass++) for (const t of order) for (const ev of walked.get(t).ev) {
            const hi = ev.st & 0xF0, ch = ev.st & 15;
            if (hi === 0xC0) prog.set(ch, Vf2Data.prog(ev.d[0]));
            else if (hi === 0x90 && ev.d[1]) {
                if (!prog.has(ch)) { stray++; continue; }
                if (!keys.has(prog.get(ch))) keys.set(prog.get(ch), new Set());
                keys.get(prog.get(ch)).add(ev.d[0]);
            } else if (hi === 0xB0 && ch === SE_CH && ev.d[0] === 0x10 && master === null) master = ev.d[1];
            else if (hi === 0xA0) throw new Error(`VF2 song 0x${n.toString(16)}: a command in a track`);
        }
        const samples = new Set();
        for (const [p, ks] of keys) for (const s of this.toneSamples(p, ks)) samples.add(s);
        return { entry: e, playlist, chans, tracks: [...walked.values()], keys, master, stray, samples };
    }
}

/* A VF2 by-key record as StF's 12 bytes: sample, pitch, pan (DISDL 3; the
 * channel's: bit 7 of the next byte), effect send, priority, -, envelope */
function kitRecord(V, at, n, env, prio) {
    const pan = V.p[at + 4], b5 = V.p[at + 5];
    return [(n >> 8) & 0xFF, n & 0xFF, V.p[at + 2], V.p[at + 3], pan === 0x80 ? 0x60 : 0x60 | (pan & 31),
        pan === 0x80 ? b5 | 0x80 : b5, prio, 0, env >>> 24, (env >>> 16) & 0xFF, (env >>> 8) & 0xFF, env & 0xFF];
}
const NO_KEY = [0xFF, 0xFF, 0, 0, 0x60, 0, 0, 0, 0, 0, 0, 0];
/* A by-key tone from records by StF key ([key, record bytes]); flag 0xFF an
 * SE kit, 0x00 a song's */
function byKeyTone(flag, recs) {
    const ks = recs.map(([k]) => k), lo = Math.min(...ks), hi = Math.max(...ks), by = new Map(recs);
    const out = [0xFF, flag, lo, hi];
    for (let k = lo; k <= hi; k++) out.push(...(by.get(k) ?? NO_KEY));
    return out;
}
/* A VF2 song's tone as StF's: a key map's records with the envelope added,
 * a kit's the keys the song plays (sampleNo: VF2's sample to StF's) */
function vf2Tone(V, vdir, prog, keys, sampleNo) {
    const t = V.tone(prog);
    if (t.byKey) {
        const recs = t.keys.filter((k) => keys.has(k.key) && V.sample(t, k) >= 0)
            .map((k) => [k.key, kitRecord(V, k.at, sampleNo(V.sample(t, k)), vdir[V.sample(t, k)].env, 0)]);
        return byKeyTone(0x00, recs);
    }
    const out = [];
    for (const k of t.keys) {
        const s = V.sample(t, k), n = sampleNo(s), env = vdir[s].env;
        out.push(...V.p.subarray(k.at, k.at + 4), (n >> 8) & 0xFF, n & 0xFF, env >>> 24, (env >>> 16) & 0xFF, (env >>> 8) & 0xFF, env & 0xFF);
    }
    return out;
}
/* A VF2 song's preset channels as an StF scene: map channels flags 0x80,
 * kits 0x8A (StF's for a song's kit), DISDL 3 in the pan, StF's LFO scale */
function vf2Scene(V, song, toneOf) {
    const out = [song.master ?? 0x70, 0xFF, 0xFF, 0xFF, 0, song.chans.length - 1];
    for (const c of song.chans) {
        const r = [...V.p.subarray(c, c + 16)], p = r[2];
        r[0] = p >= 0xF0 ? 0x8A : 0x80;
        r[2] = toneOf(p);
        r[6] = 0x60 | (r[6] & 31);
        r[9] = 0xF7;
        out.push(...r);
    }
    return out;
}
/* A VF2 track as StF's: its tones renumbered, CC 0x2A (VF2's 0..0x7F, StF's
 * 0..7) scaled; the rest is the same (VF2's CC 0x10, 0x20 and 0x50 = 0x7E
 * do nothing on StF's) */
function vf2Track(V, t, toneOf) {
    const b = V.p.slice(t.at, t.end);
    let pans = 0;
    for (const ev of t.ev) {
        const o = ev.at - t.at, hi = ev.st & 0xF0;
        if (hi === 0xC0) b[o] = (b[o] & 0x80) | toneOf(Vf2Data.prog(ev.d[0]));
        else if (hi === 0xB0 && ev.d[0] === 0x2A) b[o + 1] = (b[o + 1] & 0x80) | ((ev.d[1] >> 4) & 7);
        else if (hi === 0xB0 && ev.d[0] === 0x0A && ev.d[1] >= 0x3C && ev.d[1] <= 0x3F) pans++;
    }
    return { b, pans };
}

/*
 * The sound codes the board can send: every 0xAEggnn (an SE group's) StF's
 * main program (prog, the i960's view) names, as an immediate or in a table,
 * but for the records of the sound test's list, and the board's own
 * (megamix.c).
 */
export function stfSends(prog, boardSrc = '') {
    const dv = new DataView(prog.buffer, prog.byteOffset, prog.length), skip = new Set();
    for (let a = AUDIO_LIST; ; a += 4) {
        const r = dv.getUint32(a, true);
        if (r < 0x80000 || r + 7 >= prog.length || String.fromCharCode(...prog.subarray(r + 4, r + 7)) !== 'sd_') break;
        skip.add(r);
    }
    if (skip.size < 100) throw new Error(`AUDIO_LIST at 0x${AUDIO_LIST.toString(16)}: ${skip.size} records`);
    const out = new Set();
    for (let i = 0; i + 4 <= prog.length; i++) {
        if (prog[i + 3] !== 0 || prog[i + 2] !== 0xAE || prog[i + 1] < 0x11 || prog[i + 1] >= 0x70 || skip.has(i)) continue;
        out.add(dv.getUint32(i, true));
    }
    for (const m of boardSrc.matchAll(/0x(AE1[1-6][0-9A-F]{2})u/gi)) out.add(parseInt(m[1], 16));
    return out;
}

async function readSet(f) {
    const b = readFileSync(`${ROMS}/${f.zip}.zip`);
    const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    const dir = readZipDirectory(buf);
    const get = async (m) => {
        const d = await extractZipEntry(buf, dir, m);
        if (!d) throw new Error(`${f.zip}.zip: no ${m}`);
        return new Uint8Array(d);
    };
    return { prog: await get(f.prog), samples: await Promise.all(f.samples.map(get)), main: f.main && await Promise.all(f.main.map(get)) };
}

/* A growing byte image at a 68000 address */
class Out {
    constructor(at) { this.at = at; this.b = []; }
    get here() { return this.at + this.b.length; }
    align(n = 2) { while (this.b.length % n) this.b.push(0); }
    bytes(x) { for (const v of x) this.b.push(v); }
    u16(v) { this.b.push((v >> 8) & 0xFF, v & 0xFF); }
    u32(v) { this.b.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF); }
    set16(a, v) { const o = a - this.at; this.b[o] = (v >> 8) & 0xFF; this.b[o + 1] = v & 0xFF; }
    set32(a, v) { const o = a - this.at; for (let i = 0; i < 4; i++) this.b[o + i] = (v >>> (24 - 8 * i)) & 0xFF; }
}

/* the keys a track plays on a channel */
function keysOn(D, at, ch, into) {
    for (const ev of D.track(at).ev) if (ev.st === (0x90 | ch) && ev.d[1]) into.add(ev.d[0]);
    return into;
}
/* whether a track changes a channel's tone */
const toneChange = (D, at, ch) => D.track(at).ev.some((ev) => ev.st === (0xC0 | ch));

/*
 * Build the board's sound program and samples from StF's (prog, the four
 * sample ROMs as they are in the zip, main: its main program, boardSrc:
 * megamix.c), FV's and VF2's. Returns the files, in the zip's byte order,
 * the codes of the added songs, and a report.
 */
export function buildGuestSound(stfFiles, fvFiles, vf2Files) {
    const S = new SoundData(swap16(stfFiles.prog), swap16(cat(stfFiles.samples)));
    const F = new SoundData(swap16(fvFiles.prog), swap16(cat(fvFiles.samples)));
    const V = new Vf2Data(swap16(vf2Files.prog), swap16(cat(vf2Files.samples)));
    const report = [];
    const sDir = S.dir(), fDir = F.dir(), vDir = V.dir();
    const sTones = S.table(1).offs.length, sScenes = S.table(3).offs.length;
    const sReq = S.requests();
    const sends = stfSends(stfFiles.main, stfFiles.boardSrc);
    const fxGroups = Object.keys(sReq.groups).map(Number).filter((g) => g !== 0x10);

    /* StF's samples to keep */
    const keep = new Set();
    for (const g of fxGroups) for (const s of S.effects(g, sends)) keep.add(s);
    const nEffects = keep.size;
    for (const s of S.bankSet(0)) keep.add(s);
    for (const i of KEEP_SONGS) {
        const song = S.song(i);
        for (const s of song.samples) keep.add(s);
        const sc = song.scene != null ? S.scene(song.scene) : null;
        if (sc && sc.head[3] !== 0xFF) for (const s of S.bankSet(sc.head[3] & 0x7F)) keep.add(s);
        for (const c of song.cmds) if (c >>> 8 === 0xA005) for (const s of S.bankSet(c & 0x7F)) keep.add(s);
    }
    const nSent = [...sends].filter((c) => fxGroups.includes((c >> 8) & 0xFF)).length;
    report.push(`StF: ${sDir.length} samples, keeps ${keep.size} (${nEffects} for the ${nSent} sound effects it or the board sends, the rest for bank set 0 and songs ${KEEP_SONGS.join(', ')})`);

    /* FV's songs: their tones, scenes and samples, renumbered after StF's */
    const toneMap = new Map(), sampleMap = new Map(), added = [];
    const newTones = [], newScenes = [], newSamples = [];
    for (const want of FV_SONGS) {
        const song = F.song(want.fv);
        for (const c of song.cmds) {
            const sub = c >>> 8;
            if (sub !== 0xA000 && sub !== 0xA007) throw new Error(`FV song ${want.fv}: command 0x${c.toString(16)} not carried over`);
        }
        const sc = F.scene(song.scene);
        if (sc.head[1] !== 0xFF || sc.head[2] !== 0xFF || sc.head[3] !== 0xFF) throw new Error(`FV scene ${song.scene}: its DSP, mixer or bank set is not carried over`);
        for (const [t, ks] of song.keys) {
            if (!toneMap.has(t)) { toneMap.set(t, sTones + newTones.length); newTones.push({ t, keys: new Set() }); }
            for (const k of ks) newTones[toneMap.get(t) - sTones].keys.add(k);
        }
        for (const s of song.samples) if (!sampleMap.has(s)) { sampleMap.set(s, sDir.length + newSamples.length); newSamples.push(s); }
        newScenes.push(song.scene);
        added.push({ ...want, song, scene: sScenes + newScenes.length - 1 });
    }

    /* VF2's songs: a tone by program (the keys of both songs), samples after FV's */
    const vToneMap = new Map(), vSampleMap = new Map(), vNewSamples = [], vSongs = [];
    const vSample = (s) => {
        if (!vSampleMap.has(s)) { vSampleMap.set(s, sDir.length + newSamples.length + vNewSamples.length); vNewSamples.push(s); }
        return vSampleMap.get(s);
    };
    for (const want of VF2_SONGS) {
        const song = V.song(want.vf2);
        for (const [p, ks] of song.keys) {
            if (!vToneMap.has(p)) { vToneMap.set(p, sTones + newTones.length); newTones.push({ vf2: p, keys: new Set() }); }
            for (const k of ks) newTones[vToneMap.get(p) - sTones].keys.add(k);
        }
        for (const s of song.samples) vSample(s);
        newScenes.push({ vf2: song });
        vSongs.push({ ...want, song, scene: sScenes + newScenes.length - 1 });
        if (song.stray) report.push(`VF2's ${want.name}: ${song.stray} notes on channels preset 0 does not set, dropped by StF's driver too`);
    }
    const vToneOf = (p) => vToneMap.get(p) ?? 0;

    /* Akira's sounds: the keys of channel 14 nothing the board keeps plays
     * (StF's sent effects, the songs it plays), those kit 0x52 has no sample
     * for first */
    const seRec = S.seChannels().find((c) => S.p[c + 1] === SE_CH);
    if (seRec === undefined || S.p[seRec + 2] !== SE_KIT) throw new Error(`StF's SE channel ${SE_CH}: not kit 0x${SE_KIT.toString(16)}`);
    const busy = new Set(), retone = [];
    for (const g of fxGroups) sReq.groups[g].forEach((e, i) => {
        if (!(S.p[e] & 0x80) || !sends.has(0xAE0000 | (g << 8) | i)) return;
        keysOn(S, e + 1, SE_CH, busy);
        if (toneChange(S, e + 1, SE_CH)) retone.push(`0xAE${g.toString(16)}${i.toString(16).padStart(2, '0')}`);
    });
    for (const i of KEEP_SONGS) for (const t of S.song(i).tracks) { keysOn(S, t.at, SE_CH, busy); if (toneChange(S, t.at, SE_CH)) retone.push(`StF song ${i}`); }
    for (const a of added) for (const t of a.song.tracks) { keysOn(F, t.at, SE_CH, busy); if (toneChange(F, t.at, SE_CH)) retone.push(`FV's ${a.name}`); }
    for (const a of vSongs) for (const t of a.song.tracks) { keysOn(V, t.at, SE_CH, busy); if (toneChange(V, t.at, SE_CH)) retone.push(`VF2's ${a.name}`); }
    if (retone.length) report.push(`channel ${SE_CH}'s tone changed by ${retone.join(', ')}: Akira's sounds go quiet after them`);
    const kit = S.tone(SE_KIT), kitSample = (k) => { const r = kit.keys.find((x) => x.key === k); return r ? S.s16(r.at) : -1; };
    const free = Array.from({ length: 128 }, (_, k) => k).filter((k) => !busy.has(k));
    free.sort((a, b) => (kitSample(a) >= 0) - (kitSample(b) >= 0) || a - b);
    const akira = [];
    for (const k of VF2_SE_KEYS) for (const vel of VF2_SE_VELS) akira.push({ kit: VF2_SE_KIT, key: k, vel });
    for (const g of VF2_VOICES) for (let k = 0; k < g.n; k++) akira.push({ kit: g.kit, key: k, vel: g.vel });
    /* one StF key by VF2 kit key (the velocities share it) */
    const akiraKey = new Map();
    for (const a of akira) {
        const id = a.kit * 256 + a.key;
        if (!akiraKey.has(id)) {
            if (akiraKey.size >= free.length) throw new Error(`Akira's sounds: ${free.length} free keys on channel ${SE_CH}`);
            akiraKey.set(id, free[akiraKey.size]);
        }
        a.stfKey = akiraKey.get(id);
    }
    const taken = [...akiraKey.values()].filter((k) => kitSample(k) >= 0);
    const akiraRecs = [];
    for (const [id, k] of akiraKey) {
        const t = V.tone(id >> 8), r = t.keys[id & 0xFF], s = V.sample(t, r);
        if (s < 0) throw new Error(`VF2 kit 0x${(id >> 8).toString(16)} key 0x${(id & 0xFF).toString(16)}: no sample`);
        akiraRecs.push([k, kitRecord(V, r.at, vSample(s), vDir[s].env, 0x10)]);
    }
    const akiraTone = sTones + newTones.length;
    newTones.push({ raw: byKeyTone(0xFF, akiraRecs) });
    report.push(`Akira's sounds: tone 0x${akiraTone.toString(16)} on channel ${SE_CH}, keys ${[...akiraKey.values()].join(' ')}${taken.length ? ` (kit 0x52's ${taken.join(' ')}: no effect the board sends plays them)` : ''}`);

    if (sTones + newTones.length > 0x80) throw new Error(`${sTones + newTones.length} tones: a tone number is 7 bits`);
    const nSamples = sDir.length + newSamples.length + vNewSamples.length;
    if (nSamples > DIR_MAX) throw new Error(`${nSamples} samples: the directory's RAM holds ${DIR_MAX}`);

    /* the sample ROM: StF's kept samples, then FV's; the rest silent */
    const smp = new Uint8Array(SAMPLE_BYTES);
    let at = 0;
    const place = (src, e) => {
        const n = (e.bytes + 1) & ~1, o = e.start - SAMPLES;
        if (at + n > SAMPLE_BYTES) throw new Error(`samples: ${((at + n) / 1048576).toFixed(2)} MB, over 8`);
        smp.set(src.subarray(o, o + n), at);
        const start = SAMPLES + at;
        at += n;
        const loop = e.loop >= e.start && e.loop <= e.start + e.bytes ? e.loop - e.start + start : e.loop;
        if (loop === e.loop && e.loop !== 0) report.push(`sample at 0x${e.start.toString(16)}: its loop 0x${e.loop.toString(16)} is outside it, kept as it is`);
        return { start, bytes: e.bytes, loop, loopBytes: e.loopBytes };
    };
    const silence = SAMPLES + at;
    at += 0x400;   /* zeros */
    const mute = { start: silence, bytes: 0x400, loop: silence, loopBytes: 0 };
    const dirOut = sDir.map((e, i) => (keep.has(i) ? place(S.s, e) : mute));
    const stfBytes = at;
    for (const s of newSamples) dirOut.push(place(F.s, fDir[s]));
    const fvBytes = at - stfBytes;
    for (const s of vNewSamples) dirOut.push(place(V.s, vDir[s]));
    const mb = (n) => (n / 1048576).toFixed(2);
    report.push(`samples: StF's ${mb(stfBytes)} MB, FV's ${mb(fvBytes)} MB (${newSamples.length}), VF2's ${mb(at - stfBytes - fvBytes)} MB (${vNewSamples.length}), ${mb(SAMPLE_BYTES - at)} MB free`);

    /* the program ROM: the new tables and tracks after StF's data */
    const prog = S.p.slice();
    const out = new Out(PROG + ((S.used() + 0xFF) & ~0xFF));

    /* the directory */
    const dirAt = out.here;
    out.u16(dirOut.length * 16 - 1);
    for (const e of dirOut) { out.u32(e.start); out.u32(e.bytes); out.u32(e.loop); out.u32(e.loopBytes); }
    out.align(4);

    /* every scene's channels and the SE channels' (Akira's one more) fit the driver's */
    const seCount = S.p[S.off(S.root[4])] + 1;
    const sceneChans = [...Array.from({ length: sScenes }, (_, i) => S.scene(i).chans.length),
        ...newScenes.map((n) => (n.vf2 ? n.vf2.chans.length : F.scene(n).chans.length))];
    sceneChans.forEach((n, i) => {
        if (n + seCount > CHANNELS) throw new Error(`scene ${i}: ${n} channels and ${seCount} SE channels, the driver has ${CHANNELS}`);
    });
    /* the scenes: StF's, then FV's and VF2's with their tones renumbered */
    const sScn = S.table(3);
    const scnAt = out.here, nScn = sScenes + newScenes.length;
    out.u16(nScn - 1);
    const scnOffs = out.here;
    for (let i = 0; i < nScn; i++) out.u16(0);
    for (let i = 0; i < sScenes; i++) {
        out.set16(scnOffs + 2 * i, out.here - scnAt);
        const sc = S.scene(i);
        out.bytes(S.p.subarray(sc.at, sc.at + sc.size));
        out.align();
    }
    newScenes.forEach((n, i) => {
        out.set16(scnOffs + 2 * (sScenes + i), out.here - scnAt);
        if (n.vf2) { out.bytes(vf2Scene(V, n.vf2, vToneOf)); return; }
        const sc = F.scene(n), b = F.p.slice(sc.at, sc.at + sc.size);
        for (const c of sc.chans) b[c - sc.at + 2] = toneMap.get(F.p[c + 2]);
        out.bytes(b);
        out.align();
    });
    out.align(4);

    /* the tracks, their tones renumbered */
    const trackAt = new Map();
    for (const a of added) for (const t of a.song.tracks) {
        if (trackAt.has(t.at)) continue;
        const b = F.p.slice(t.at, t.end);
        for (const ev of t.ev) if ((ev.st & 0xF0) === 0xC0) {
            const o = ev.at - t.at;
            b[o] = (b[o] & 0x80) | toneMap.get(ev.d[0]);
        }
        trackAt.set(t.at, out.here);
        out.bytes(b);
        out.align(4);
    }
    const vTrackAt = new Map();
    let pans = 0;
    for (const a of vSongs) for (const t of a.song.tracks) {
        if (vTrackAt.has(t.at)) continue;
        const c = vf2Track(V, t, vToneOf);
        pans += c.pans;
        vTrackAt.set(t.at, out.here);
        out.bytes(c.b);
        out.align(4);
    }
    if (pans) report.push(`VF2's songs: ${pans} pans of 0x3C..0x3F, which StF's table places a step off VF2's`);

    /* the SE channels: StF's, and Akira's tone on channel 14 beside its own */
    const seAt = out.here, nSe = S.p[S.off(S.root[4])];
    out.bytes([nSe + 1]);
    out.bytes(S.p.subarray(S.off(S.root[4]) + 1, S.off(S.root[4]) + 1 + 16 * nSe));
    const akiraSe = S.p.slice(seRec, seRec + 16);
    akiraSe[2] = akiraTone;
    out.bytes(akiraSe);
    out.align(4);

    /* the tones, then the requests right after them (the driver copies
     * root[7] - root[1] bytes of tones to RAM) */
    const sTn = S.table(1);
    const toneAt = out.here, nTone = sTones + newTones.length;
    out.u16(nTone - 1);
    const toneOffs = out.here;
    for (let i = 0; i < nTone; i++) out.u16(0);
    const bodyAt = sTn.at + 2 + 2 * sTones;
    const bodyEnd = S.off(S.root[7]);
    const shift = out.here - (PROG + bodyAt);
    for (let i = 0; i < sTones; i++) out.set16(toneOffs + 2 * i, sTn.offs[i] + PROG + shift - toneAt);
    /* StF's tones, kit 0x52 without the keys Akira's take */
    const body = S.p.slice(bodyAt, bodyEnd);
    for (const k of akiraKey.values()) {
        const r = kit.keys.find((x) => x.key === k);
        if (r) body.set(NO_KEY.slice(0, 2), r.at - bodyAt);
    }
    out.bytes(body);
    out.align();
    newTones.forEach(({ t, vf2, raw, keys }, i) => {
        out.set16(toneOffs + 2 * (sTones + i), out.here - toneAt);
        if (raw || vf2 !== undefined) {
            out.bytes(raw ?? vf2Tone(V, vDir, vf2, keys, (s) => vSampleMap.get(s)));
            out.align();
            return;
        }
        const tn = F.tone(t), b = F.p.slice(tn.at, tn.at + tn.size);
        for (const k of tn.keys) {
            const o = k.at - tn.at, s = F.s16(k.at);
            if (s < 0) continue;
            /* a key the song never plays keeps no sample */
            const n = !tn.byKey || newTones[i].keys.has(k.key) ? sampleMap.get(s) : -1;
            const v = n === undefined ? -1 : n;
            b[o] = (v >> 8) & 0xFF; b[o + 1] = v & 0xFF;
        }
        out.bytes(b);
        out.align();
    });
    out.align(4);
    if (out.here - toneAt > TONE_RAM) throw new Error(`tones: 0x${(out.here - toneAt).toString(16)} bytes, RAM 0x9000 holds 0x${TONE_RAM.toString(16)}`);

    /* the requests: StF's groups, group 0x10 longer by the added songs,
     * then Akira's group */
    const reqAt = out.here;
    const groups = Object.keys(sReq.groups).map(Number).sort((a, b) => a - b);
    if (groups[groups.length - 1] !== VF2_EFFECTS - 1) throw new Error(`StF's requests end at group 0x${groups[groups.length - 1].toString(16)}`);
    const allGroups = [...groups, VF2_EFFECTS];
    out.u16(allGroups.length - 1);
    const gOffs = out.here;
    for (const g of allGroups) out.u16(0);
    const lists = new Map();
    for (const g of allGroups) {
        out.set16(gOffs + 2 * (g - 0x10), out.here - reqAt);
        const n = g === VF2_EFFECTS ? akira.length : sReq.groups[g].length + (g === 0x10 ? added.length + vSongs.length : 0);
        out.u16(n - 1);
        lists.set(g, out.here);
        for (let i = 0; i < n; i++) out.u16(0);
    }
    /* StF's entries as they are, all in one run (their songs' loops point
     * at StF's own copies, which stay) */
    const all = groups.flatMap((g) => sReq.groups[g]);
    const eFrom = Math.min(...all), eTo = Math.max(...all.map((e) => entryEnd(S, e)));
    const eShift = out.here - (PROG + eFrom);
    out.bytes(S.p.subarray(eFrom, eTo));
    out.align(4);
    for (const g of groups) sReq.groups[g].forEach((e, i) => out.set16(lists.get(g) + 2 * i, e + PROG + eShift - reqAt));
    const codes = {};
    added.forEach((a, i) => {
        const idx = sReq.groups[0x10].length + i;
        out.set16(lists.get(0x10) + 2 * idx, out.here - reqAt);
        const e = a.song.entry, here = out.here;
        out.bytes(F.p.subarray(e, e + 4));
        for (const it of a.song.playlist.items) {
            if (it.kind === 'cmd') out.u32(0x80000000 | (it.cmd >>> 8 === 0xA007 ? 0xA00700 | a.scene : it.cmd));
            else if (it.kind === 'track') out.u32(trackAt.get(F.off(it.to)));
            else if (it.kind === 'end') out.u32(it.w);
            else {
                const to = F.off(it.to);
                if (to < e + 4 || to >= a.song.playlist.end) throw new Error(`FV song ${a.fv}: it goes on outside its playlist`);
                out.u32(0xFFFFFFF1); out.u32(here + (to - e));
            }
        }
        out.align(4);
        codes[a.name] = 0xAE1000 + idx;
        if (codes[a.name] !== a.code) throw new Error(`FV's ${a.name}: code 0x${codes[a.name].toString(16)}, megamix.c sends 0x${a.code.toString(16)}`);
        report.push(`FV's ${a.name} (FV 0xAE10${a.fv.toString(16).padStart(2, '0')}): code 0x${codes[a.name].toString(16).toUpperCase()}, scene ${a.scene}, ${a.song.tracks.length} tracks, ${[...a.song.keys.keys()].length} tones, ${a.song.samples.size} samples`);
    });
    /* VF2's: StF's start (A000 02, its scene), then VF2's tracks */
    vSongs.forEach((a, i) => {
        const idx = sReq.groups[0x10].length + added.length + i;
        out.set16(lists.get(0x10) + 2 * idx, out.here - reqAt);
        const here = out.here, e = a.song.entry;
        out.u32(0);
        out.u32(0x80A00002); out.u32(0x80A00700 | a.scene);
        for (const it of a.song.playlist.items) {
            if (it.kind === 'track') out.u32(vTrackAt.get(V.off(it.to)));
            else if (it.kind === 'end') out.u32(it.w);
            else {
                const j = (V.off(it.to) - (e + 4)) / 4;
                if (!Number.isInteger(j) || j < 0 || e + 4 + 4 * j >= a.song.playlist.end) throw new Error(`VF2 song ${a.vf2}: it goes on outside its playlist`);
                out.u32(0xFFFFFFF1); out.u32(here + 4 + 4 * (2 + j));
            }
        }
        out.align(4);
        codes[a.name] = 0xAE1000 + idx;
        if (codes[a.name] !== a.code) throw new Error(`VF2's ${a.name}: code 0x${codes[a.name].toString(16)}, megamix.c sends 0x${a.code.toString(16)}`);
        report.push(`VF2's ${a.name} (VF2 0xAD10${a.vf2.toString(16).padStart(2, '0')}): code 0x${codes[a.name].toString(16).toUpperCase()}, scene ${a.scene}, ${a.song.tracks.length} tracks, ${a.song.keys.size} tones, ${a.song.samples.size} samples`);
    });
    /* Akira's: a note each on channel 14 */
    akira.forEach((a, i) => {
        out.set16(lists.get(VF2_EFFECTS) + 2 * i, out.here - reqAt);
        out.bytes([0x80, 0x90 | SE_CH, a.stfKey, a.vel, 0x00, 0xFF, 0x2F, 0x00]);
    });
    out.align(4);
    if (out.here - reqAt > 0x10000) throw new Error('requests: over 64 KB, past a word offset');
    const end = out.here;
    if (end - PROG > prog.length) throw new Error(`program ROM: 0x${(end - PROG).toString(16)}, over 0x${prog.length.toString(16)}`);
    prog.set(out.b, out.at - PROG);

    const dv = new DataView(prog.buffer);
    dv.setUint32(0x8000, dirAt);
    dv.setUint32(0x8004, toneAt);
    dv.setUint32(0x800C, scnAt);
    dv.setUint32(0x8010, seAt);
    dv.setUint32(0x801C, reqAt);
    report.push(`program ROM: new tables 0x${(out.at - PROG).toString(16)}..0x${(end - PROG).toString(16)} of 0x${prog.length.toString(16)}`);

    const sm = swap16(smp);
    const sampleFiles = {};
    stfFiles.names.forEach((n, i) => { sampleFiles[n] = sm.subarray(i * 0x200000, (i + 1) * 0x200000); });
    return { prog: swap16(prog), samples: sampleFiles, codes, report };
}

/* the end of a request entry: a song's playlist, or an effect's track */
function entryEnd(D, e) {
    if (D.p[e] === 0) return D.playlist(e).end;
    if (D.p[e] & 0x80) return D.track(e + 1).end;
    throw new Error(`request entry at 0x${(e + PROG).toString(16)}: kind 0x${D.p[e].toString(16)}`);
}

/* StF's main program as the i960 has it: a word of each ROM in turn */
function interleave(a, b) {
    const o = new Uint8Array(a.length * 2);
    for (let i = 0; i < a.length; i += 2) { o.set(a.subarray(i, i + 2), 2 * i); o.set(b.subarray(i, i + 2), 2 * i + 2); }
    return o;
}

/* from StF's files as import-assets.mjs has them (by name), FV's and VF2's from their zips */
export async function guestSound(stfByName) {
    const stf = stfByName
        ? { prog: new Uint8Array(stfByName[STF_FILES.prog]), samples: STF_FILES.samples.map((n) => new Uint8Array(stfByName[n])),
            main: STF_MAIN.map((n) => new Uint8Array(stfByName[n])) }
        : await readSet({ ...STF_FILES, main: STF_MAIN });
    const boardSrc = readFileSync(new URL('../board/src/megamix.c', import.meta.url), 'utf8');
    return buildGuestSound({ ...stf, main: interleave(...stf.main), boardSrc, names: STF_FILES.samples },
        await readSet(FV_FILES), await readSet(VF2_FILES));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    const r = await guestSound();
    for (const line of r.report) console.log(line);
}
