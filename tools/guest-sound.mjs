/*
 * The board's sound ROMs: StF's sound program (epr-19021) with Fighting
 * Vipers' songs added to its data, and a sample ROM holding only what that
 * data plays (docs/BOARD.md, Sound).
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
 * Samples: the board's ROM is 8 MB, which StF's own fill. It keeps the samples
 * StF's sound effects can play (every key of the SE channels' requests, all
 * of groups 0x11..0x14: StF's code sends nearly all of them), StF's bank set
 * 0 (loaded at the driver's start) and the songs the board plays (KEEP_SONGS),
 * then the guests'. A sample nothing kept can play points at a short silence.
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

const PROG = 0x600000, SAMPLES = 0x800000, SAMPLE_BYTES = 0x800000;
const DIR_MAX = 1024, TONE_RAM = 0x7000;   /* RAM 0x9000..0xFFFF: the voices' buffers start at 0x10000 */

export const STF_FILES = { zip: 'sfight', prog: 'epr-19021.31', samples: ['mpr-19022.32', 'mpr-19023.33', 'mpr-19024.34', 'mpr-19025.35'] };
const FV_FILES = { zip: 'fvipers', prog: 'epr-18628.31', samples: ['mpr-18629.32', 'mpr-18630.33', 'mpr-18631.34', 'mpr-18632.35'] };

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
    /* the samples a group of sound effects plays, through the SE channels' tones */
    effects(group) {
        const se = new Map(this.seChannels().map((c) => [this.p[c + 1], this.p[c + 2]]));
        const samples = new Set();
        for (const e of this.requests().groups[group]) {
            if (!(this.p[e] & 0x80)) continue;
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

async function readSet(f) {
    const b = readFileSync(`${ROMS}/${f.zip}.zip`);
    const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    const dir = readZipDirectory(buf);
    const get = async (m) => {
        const d = await extractZipEntry(buf, dir, m);
        if (!d) throw new Error(`${f.zip}.zip: no ${m}`);
        return new Uint8Array(d);
    };
    return { prog: await get(f.prog), samples: await Promise.all(f.samples.map(get)) };
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

/*
 * Build the board's sound program and samples from StF's (stfProg, the
 * four sample ROMs as they are in the zip) and FV's. Returns the files, in
 * the zip's byte order, the codes of the added songs, and a report.
 */
export function buildGuestSound(stfFiles, fvFiles) {
    const S = new SoundData(swap16(stfFiles.prog), swap16(cat(stfFiles.samples)));
    const F = new SoundData(swap16(fvFiles.prog), swap16(cat(fvFiles.samples)));
    const report = [];
    const sDir = S.dir(), fDir = F.dir();
    const sTones = S.table(1).offs.length, sScenes = S.table(3).offs.length;
    const sReq = S.requests();

    /* StF's samples to keep */
    const keep = new Set();
    for (const g of Object.keys(sReq.groups).map(Number).filter((g) => g !== 0x10)) for (const s of S.effects(g)) keep.add(s);
    const nEffects = keep.size;
    for (const s of S.bankSet(0)) keep.add(s);
    for (const i of KEEP_SONGS) {
        const song = S.song(i);
        for (const s of song.samples) keep.add(s);
        const sc = song.scene != null ? S.scene(song.scene) : null;
        if (sc && sc.head[3] !== 0xFF) for (const s of S.bankSet(sc.head[3] & 0x7F)) keep.add(s);
        for (const c of song.cmds) if (c >>> 8 === 0xA005) for (const s of S.bankSet(c & 0x7F)) keep.add(s);
    }
    report.push(`StF: ${sDir.length} samples, keeps ${keep.size} (${nEffects} for its sound effects, the rest for bank set 0 and songs ${KEEP_SONGS.join(', ')})`);

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
    if (sTones + newTones.length > 0x80) throw new Error(`${sTones + newTones.length} tones: a tone number is 7 bits`);
    if (sDir.length + newSamples.length > DIR_MAX) throw new Error(`${sDir.length + newSamples.length} samples: the directory's RAM holds ${DIR_MAX}`);

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
    report.push(`samples: StF's ${(stfBytes / 1048576).toFixed(2)} MB, FV's ${((at - stfBytes) / 1048576).toFixed(2)} MB (${newSamples.length}), ${((SAMPLE_BYTES - at) / 1048576).toFixed(2)} MB free`);

    /* the program ROM: the new tables and tracks after StF's data */
    const prog = S.p.slice();
    const out = new Out(PROG + ((S.used() + 0xFF) & ~0xFF));

    /* the directory */
    const dirAt = out.here;
    out.u16(dirOut.length * 16 - 1);
    for (const e of dirOut) { out.u32(e.start); out.u32(e.bytes); out.u32(e.loop); out.u32(e.loopBytes); }
    out.align(4);

    /* the scenes: StF's, then FV's with their tones renumbered */
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
    out.bytes(S.p.subarray(bodyAt, bodyEnd));
    out.align();
    newTones.forEach(({ t }, i) => {
        out.set16(toneOffs + 2 * (sTones + i), out.here - toneAt);
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

    /* the requests: StF's groups, group 0x10 longer by the added songs */
    const reqAt = out.here;
    const groups = Object.keys(sReq.groups).map(Number).sort((a, b) => a - b);
    out.u16(groups.length - 1);
    const gOffs = out.here;
    for (const g of groups) out.u16(0);
    const lists = new Map();
    for (const g of groups) {
        out.set16(gOffs + 2 * (g - 0x10), out.here - reqAt);
        const n = sReq.groups[g].length + (g === 0x10 ? added.length : 0);
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
    if (out.here - reqAt > 0x10000) throw new Error('requests: over 64 KB, past a word offset');
    const end = out.here;
    if (end - PROG > prog.length) throw new Error(`program ROM: 0x${(end - PROG).toString(16)}, over 0x${prog.length.toString(16)}`);
    prog.set(out.b, out.at - PROG);

    const dv = new DataView(prog.buffer);
    dv.setUint32(0x8000, dirAt);
    dv.setUint32(0x8004, toneAt);
    dv.setUint32(0x800C, scnAt);
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

/* from StF's files as import-assets.mjs has them (by name), FV's from its zip */
export async function guestSound(stfByName) {
    const stf = stfByName
        ? { prog: new Uint8Array(stfByName[STF_FILES.prog]), samples: STF_FILES.samples.map((n) => new Uint8Array(stfByName[n])) }
        : await readSet(STF_FILES);
    return buildGuestSound({ ...stf, names: STF_FILES.samples }, await readSet(FV_FILES));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    const r = await guestSound();
    for (const line of r.report) console.log(line);
}
