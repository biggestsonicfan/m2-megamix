/*
 * The browser compiler's kit for one lineup (web/kit/<lineup>/), from a
 * native board build of it: what compile.html needs besides the player's own
 * ROMs, with nothing of Sega's in it.
 *
 *   kit.json         where StF's words go back in (xor), the poses' range,
 *                    the SHA-256 of every file the build made, the inputs
 *   program.xor.gz   the program image (1 MB, both EPROMs merged): the
 *                    board's code as built, the code lifted from StF's
 *                    program and its ROM tables XORed with StF's words, the
 *                    poses' range zeros
 *   files.json       the repo files the tools read (board/src's C, docs/data's
 *                    model list), and the addresses they read in the lifted
 *                    code's header
 *
 *   node tools/web/make-kit.mjs <lineup> <cmake build dir> <roms dir> [out dir]
 *       (<roms dir>/sfight/: import-assets.mjs's data ROMs and the build's
 *        program pair; sfight.zip from $ROMS_DIR; tools/web/make-kits.sh runs it)
 *
 * It rebuilds the set from the kit as the browser does (web/compile/assemble.mjs)
 * and stops unless that is the native build, byte for byte.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { readZipDirectory, extractZipEntry } from '../../vendor/noclip/js/zip.js';
import { merge32, split32, program, storeZip, sha256 } from '../../web/compile/assemble.mjs';
import { posesData } from '../board/c-data.mjs';
import { LINEUPS } from '../board/lineup.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const [lineup, build, roms, outArg] = process.argv.slice(2);
if (!LINEUPS[lineup] || !build || !roms) throw new Error('node tools/web/make-kit.mjs <lineup> <cmake build dir> <roms dir> [out dir]');
const OUT = outArg ?? `${ROOT}web/kit/${lineup}`;
const ROMS = process.env.ROMS_DIR || `${process.env.HOME}/build/mameroms`;
const PROG = ['epr-19001.15', 'epr-19002.16'];

/* ---- the build */

const image = new Uint8Array(readFileSync(`${build}/game.bin`));
if (image.length !== 0x100000) throw new Error(`game.bin: ${image.length} bytes`);
const map = readFileSync(`${build}/game.map`, 'utf8');
const section = (re) => {
    const m = map.match(re);
    if (!m) throw new Error(`game.map: no ${re}`);
    return [parseInt(m[1], 16), parseInt(m[2], 16)];
};
const [posesAt, posesSize] = section(/^\.poses\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)/m);
const [stfromAt, stfromSize] = section(/^\.stfrom\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)/m);
const [liftAt, liftSize] = section(/^ \.text\s+0x([0-9a-f]+)\s+0x([0-9a-f]+) \S*stf_motion\.s\.obj/m);

const poses = posesData(readFileSync(`${ROOT}board/src/gen/poses.h`, 'utf8'));
if (poses.base !== posesAt || poses.bytes.length !== posesSize) throw new Error('game.map: .poses is not where c-data.mjs puts board/src/gen/poses.h');
if (!poses.bytes.every((b, i) => b === image[posesAt + i])) throw new Error('game.bin: .poses is not c-data.mjs\'s poses.bin');

/* ---- StF's program */

const zipBuf = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
const sfz = zipBuf(readFileSync(`${ROMS}/sfight.zip`));
const sfd = readZipDirectory(sfz);
const stf = merge32(...await Promise.all(PROG.map((f) => extractZipEntry(sfz, sfd, f))));

/* StF's program by its 16-byte runs (at every even offset; not those mostly
 * zeros or blank), each to where it is. */
const key = (b, i) => Buffer.from(b.subarray(i, i + 16)).toString('latin1');
const plainRun = (b, i) => {
    let z = 0;
    for (let k = 0; k < 16; k++) if (!b[i + k] || b[i + k] === 0xff) z++;
    return z < 8;
};
const at = new Map();
for (let i = 0; i + 16 <= stf.length; i += 2) {
    if (!plainRun(stf, i)) continue;
    const k = key(stf, i);
    if (!at.has(k)) at.set(k, []);
    at.get(k).push(i);
}

/* The lifted code is StF's, moved (lift-stf.py relocates it word for word):
 * each of its words is XORed with the StF word it came from. Which one: the
 * run found in StF's program nearest to the last one's offset. */
function liftRuns(lo, hi) {
    const delta = [];
    let d = null;
    for (let i = lo; i < hi; i += 4) {
        const c = at.get(key(image, i))?.filter((x) => x < 0x80000 && !(x & 3));
        if (c?.length) d = c.reduce((a, b) => (Math.abs(b - i - (d ?? 0)) < Math.abs(a - i - (d ?? 0)) ? b : a)) - i;
        delta.push(d);
    }
    const first = delta.find((x) => x !== null);
    const runs = [];
    for (let w = 0; w < delta.length; w++) {
        const dd = delta[w] ?? first, dst = lo + w * 4;
        if (dst + dd < 0 || dst + dd + 4 > 0x80000) continue;      /* none of StF's lines up with it */
        if (!(image[dst] | image[dst + 1] | image[dst + 2] | image[dst + 3])) continue;   /* a zero needs no hiding */
        const r = runs[runs.length - 1];
        if (r && r[0] + r[1] === dst && r[2] - r[0] === dd) r[1] += 4;
        else runs.push([dst, 4, dst + dd]);
    }
    return runs;
}

/* Elsewhere, what the build has of StF's as it is (the SDK links in the
 * coprocessor's program, cpres_data, which StF's ROM holds too, and some of
 * StF's code is the SDK's), and what the lift's runs left of it: every run of
 * 16 bytes or more found in StF's program, XORed with it, until none is left. */
function copyRuns(b, lo, hi) {
    const runs = [];
    for (let i = lo; i + 16 <= hi;) {
        let best = [0, 0];
        for (const c of (plainRun(b, i) && at.get(key(b, i))) || []) {
            let n = 16;
            while (i + n < hi && c + n < stf.length && b[i + n] === stf[c + n]) n++;
            if (n > best[0]) best = [n, c];
        }
        if (best[0]) { runs.push([i, best[0], best[1]]); i = (i + best[0] + 1) & ~1; } else i += 2;
    }
    return runs;
}
const kitImage = Uint8Array.from(image);
kitImage.fill(0, posesAt, posesAt + posesSize);
const xor = [];
const apply = (runs) => {
    for (const [dst, n, src] of runs) for (let i = 0; i < n; i++) kitImage[dst + i] ^= stf[src + i];
    xor.push(...runs);
    return runs.length;
};
apply([...liftRuns(liftAt, liftAt + liftSize), [stfromAt, stfromSize, stfromAt]]);
for (let pass = 0; apply(copyRuns(kitImage, 0, posesAt)); pass++) if (pass > 8) throw new Error('kit: the copy runs do not end');
xor.sort((x, y) => x[0] - y[0]);

/* What of StF's program the kit still holds as it is: 16-byte runs of it, alone
 * (shorter than copyRuns takes) and by chance. */
{
    let n = 0;
    for (let i = 0; i + 16 <= kitImage.length; i += 2) if (plainRun(kitImage, i) && at.has(key(kitImage, i))) n++;
    console.log(`kit: ${n} 16-byte runs of StF's program left as they are`);
    if (n > 64) throw new Error('kit: too much of StF\'s program is left in it');
}

/* ---- what the build made */

const set = `${roms}/sfight`;
const names = readdirSync(set).sort();
const built = Object.fromEntries(names.map((f) => [f, new Uint8Array(readFileSync(`${set}/${f}`))]));
const [p15, p16] = split32(image);
for (const [f, d] of [[PROG[0], p15], [PROG[1], p16]])
    if (!built[f] || !Buffer.from(built[f]).equals(Buffer.from(d))) throw new Error(`${set}/${f} is not game.bin's`);

const kit = {
    lineup,
    source: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    xor,
    poses: { base: posesAt, size: posesSize, sha256: await sha256(poses.bytes) },
    program: await sha256(image),
    files: Object.fromEntries(await Promise.all(names.map(async (f) => [f, await sha256(built[f])]))),
    zip: await sha256(storeZip(names.map((f) => ({ name: f, data: built[f] })))),
};

/* ---- the repo files the tools read that the site does not serve */

const files = {};
for (const f of readdirSync(`${ROOT}board/src`, { recursive: true }).filter((f) => f.endsWith('.c')).sort())
    files[`board/src/${f}`] = readFileSync(`${ROOT}board/src/${f}`, 'utf8');
files['docs/data/stf-fight-models.txt'] = readFileSync(`${ROOT}docs/data/stf-fight-models.txt`, 'utf8');
/* of the lifted code's header, the addresses import-assets.mjs and moves-text.mjs read */
files['board/src/gen/stf_motion.h'] = readFileSync(`${ROOT}board/src/gen/stf_motion.h`, 'utf8').split('\n')
    .filter((l) => /^#define (STF_GUEST_|GAME_|STF_NATIVE_TAIL_FAR )/.test(l)).join('\n') + '\n';

/* ---- the round trip, as the browser makes it */

const again = program(kit, kitImage, stf, poses.bytes);
if (!again.every((b, i) => b === image[i])) throw new Error('kit: the program it makes is not game.bin');

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/kit.json`, JSON.stringify(kit, null, 1).replace(/\[\s+(\d+),\s+(\d+),\s+(\d+)\s+\]/g, '[$1, $2, $3]') + '\n');
writeFileSync(`${OUT}/program.xor.gz`, gzipSync(kitImage, { level: 9 }));
writeFileSync(`${OUT}/files.json`, JSON.stringify(files) + '\n');
console.log(`kit ${lineup}: ${xor.length} xor runs, poses 0x${posesAt.toString(16)}+0x${posesSize.toString(16)}, zip ${kit.zip.slice(0, 16)}`);
