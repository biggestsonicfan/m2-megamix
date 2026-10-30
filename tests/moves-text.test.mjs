/* Each board fighter's moves, as tools/board/moves-text.mjs writes them, assemble
 * where they came from to the bytes that are there (needs board/roms: run
 * tools/board/import-assets.mjs first); and assembled somewhere else, they read
 * back as the same moves. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { decodeBoard, parseMoves, assembleProgram, assembleSetup, decodeMoves, memory } from '../tools/board/moves-text.mjs';

const dir = new URL('../board/roms', import.meta.url).pathname;
if (!existsSync(`${dir}/sfight`)) { console.log('moves-text: no board/roms, skipped'); process.exit(0); }

const FAR = 0xf2240;
/* the listing without its addresses */
const bare = (text) => text.split('\n').filter((l) => l && !/^(org |[TS]_[0-9A-F]+:|#)/.test(l))
    .map((l) => l.replace(/[TS]_[0-9A-F]+/g, 'L').replace(/ near$/, ` far=0x${FAR.toString(16).toUpperCase()}`)).join('\n');

for (const { chr, name, text, mem, root, setupAt, lens, names } of await decodeBoard(dir)) {
    const p = parseMoves(text);
    const here = assembleProgram(p);
    assert.equal(here.root, root, `${name} root`);
    let n = 0;
    for (const { at, bytes } of here.runs) {
        assert.deepEqual([...bytes], [...mem.bytes(at, bytes.length)], `${name} ${at.toString(16)}`);
        n += bytes.length;
    }
    let setups = 0;
    for (const [id, s] of p.setups) {
        const b = assembleSetup(s);
        if (!b) continue;
        setups++;
        assert.deepEqual([...b], [...mem.bytes(setupAt(id), b.length)], `${name} setup ${id}`);
    }
    /* moved into the heap, near natives made far */
    const main = Uint8Array.from({ length: 0x1000000 }, (_, a) => mem.u8(0x02000000 + a));
    /* somewhere nothing is: 64K of zeros */
    let base = 0x1000000 - 0x10000;
    while (main.subarray(base, base + 0x10000).some((x) => x)) base -= 0x10000;
    const moved = assembleProgram(p, { base: 0x02000000 + base, far: FAR });
    let m = 0;
    for (const { at, bytes } of moved.runs) { main.set(bytes, at - 0x02000000); m += bytes.length; }
    const mem2 = memory(new Uint8Array(0x100000).map((_, a) => mem.u8(a)), main, new Uint8Array(0x100000).map((_, a) => mem.u8(0x06000000 + a)));
    const again = decodeMoves(mem2, { chr, name, root: moved.root, setupAt, lens, names });
    assert.equal(bare(again), bare(text), `${name} moved`);
    console.log(name.padEnd(7), 'program', n, 'bytes in', here.runs.length, 'runs, moved', m, '; setups', setups, 'of', p.setups.size);
}
