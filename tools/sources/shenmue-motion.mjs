/*
 * Shenmue's motions (the Dreamcast disc's /MISC/MOTION.BIN) as Virtua
 * Fighter 2 motion blocks, the format Megamix's board plays
 * (docs/VF3-SHENMUE.md). Shenmue's fighting motions are VF3's, carried over
 * (263 of its names are VF3's own), and VF3's are VF2's with two objects
 * more, so a Shenmue motion maps channel for channel onto VF2's 20 objects:
 * the shoulders VF3 added are dropped, VF2's pelvis look (object 17) gets
 * its usual latched (0, 0, 16384).
 *
 *   node tools/sources/shenmue-motion.mjs MOTION.BIN --list
 *   node tools/sources/shenmue-motion.mjs MOTION.BIN <index|name> [--json] [--out block.bin]
 *
 * What changes on the way (docs/VF3-SHENMUE.md, "Shenmue to VF2"):
 *   - time: Shenmue runs at 30 fps, VF2 at 60, so frames ×2. VF2's keys
 *     start at frame 1 and end at the motion's last frame; Shenmue's key t
 *     is VF2's 2t or 2t + 2 (VF3's own rounding), so it goes to 2t + 1;
 *   - angles: Shenmue's are turns, VF2's binary radians (65535 a turn);
 *   - axes: Shenmue's z is VF2's -z, positions and angles alike;
 *   - tangents: Shenmue stores twice VF2's (both per key: in, out; VF3's
 *     are Shenmue's / 60).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readMotionBin, decodeShenmue, toVF2, encodeVF2 } from '../../js/shenmue/shenmue.js';

/* The conversion is js/shenmue/shenmue.js's, which Ryo's fighter plays (js/shenmue/ryo.js). */
export { readMotionBin, decodeShenmue, toVF2, encodeVF2 };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [path, which, ...rest] = process.argv.slice(2);
    if (!path || !which) {
        console.error('usage: shenmue-motion.mjs MOTION.BIN --list | <index|name> [--json] [--out block.bin]');
        process.exit(2);
    }
    const file = readMotionBin(new Uint8Array(readFileSync(path)));
    if (which === '--list') {
        for (const m of file.motions) {
            const f = file.v.getUint16(m.offset, true);
            console.log(`${m.index}\t${f}\t${m.name ?? ''}`);
        }
        process.exit(0);
    }
    const i = /^\d+$/.test(which) ? +which : file.motions.findIndex(m => m.name === which);
    if (i < 0 || i >= file.motions.length) { console.error(`no motion ${which}`); process.exit(1); }
    const m = decodeShenmue(file, i), vf2 = toVF2(m);
    if (rest.includes('--json')) console.log(JSON.stringify({ shenmue: m, vf2 }, null, 1));
    else console.log(`${i} ${m.name}: ${m.frames} frames (VF2 ${vf2.frames}), ${m.channels.length} channels` +
        (vf2.shoulders.length ? `; shoulders dropped (bones ${vf2.shoulders})` : '') +
        (vf2.unknown.length ? `; bones with no VF2 object: ${vf2.unknown}` : ''));
    const out = rest.indexOf('--out');
    if (out >= 0) writeFileSync(rest[out + 1], encodeVF2(vf2));
}
