/*
 * The compiler's worker: the board build's steps as the repo's Node tools do
 * them, on the player's own files, and the set as one zip.
 *
 *   tools/board/bake-board.mjs     board/src/gen/poses.h
 *   tools/board/c-data.mjs         poses.h as the program's bytes (.poses)
 *   tools/board/import-assets.mjs  the data ROMs (board/roms/sfight/), with
 *                                  the player's moves (board/moves/*.moves)
 *   assemble.mjs                   the program EPROMs: the kit's image with
 *                                  StF's words put back and the poses written
 *
 * The tools run once per import (they are scripts), so a page starts a worker
 * for each build. In: { site, kit, lineup, inputs: [{ path, file }], moves:
 * { name: text } }. Out: { log }, { step }, then { done: { zip, sha256, files,
 * same } } or { error }.
 */
import * as vfs from './node/vfs.mjs';
import { Buffer } from './node/buffer.mjs';
import { makeLoader } from './loader.mjs';
import { merge32, split32, program, storeZip, sha256 } from './assemble.mjs';

const say = (m) => postMessage(m);
const PROG = ['epr-19001.15', 'epr-19002.16'];

self.onmessage = async ({ data }) => {
    try {
        say({ done: await compile(data) });
    } catch (e) {
        say({ error: `${e.message}\n${e.stack ?? ''}` });
    }
};

async function compile({ site, kit: kitUrl, lineup, inputs, moves = {} }) {
    const reader = new FileReaderSync();
    vfs.setReader((file, off, n) => new Uint8Array(reader.readAsArrayBuffer(file.slice(off, off + n))));
    for (const { path, file } of inputs) vfs.put(path, { file, size: file.size });

    const root = new URL('./', site);
    const ROOT = vfs.norm(root.href).replace(/\/?$/, '/');
    globalThis.Buffer = Buffer;
    globalThis.process = {
        env: { ROMS_DIR: '/roms', HOME: '/home', SHENMUE_DIR: '/shenmue', LINEUP: lineup },
        argv: ['node'], exitCode: 0,
        exit: (c) => { throw new Error(`a tool stopped (exit ${c})`); },
    };
    for (const k of ['log', 'warn', 'error', 'info']) console[k] = (...a) => say({ log: a.join(' ') });

    say({ step: 'kit' });
    const get = async (f, as) => {
        const r = await fetch(new URL(f, kitUrl));
        if (!r.ok) throw new Error(`kit ${f}: ${r.status}`);
        return r[as]();
    };
    const kit = await get('kit.json', 'json');
    if (kit.lineup !== lineup) throw new Error(`kit is ${kit.lineup}'s, not ${lineup}'s`);
    for (const [f, text] of Object.entries(await get('files.json', 'json'))) vfs.put(`${ROOT}${f}`, text);
    const gz = await get('program.xor.gz', 'blob');
    const image = new Uint8Array(await new Response(gz.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    for (const [name, text] of Object.entries(moves)) vfs.put(`${ROOT}board/moves/${name}`, text);

    const load = makeLoader({ [new URL('tests/node-roms.mjs', root).href]: new URL('node-roms.mjs', import.meta.url).href });

    say({ step: 'bake' });
    await load(new URL('tools/board/bake-board.mjs', root).href);
    const posesH = vfs.bytes(`${ROOT}board/src/gen/poses.h`);
    const { posesData } = await load(new URL('tools/board/c-data.mjs', root).href);
    const poses = posesData(new TextDecoder().decode(posesH));
    if (poses.base !== kit.poses.base || poses.bytes.length !== kit.poses.size) throw new Error('the poses are not where the kit has them: another lineup or source?');

    say({ step: 'import' });
    await load(new URL('tools/board/import-assets.mjs', root).href);

    say({ step: 'program' });
    const { readZipDirectory, extractZipEntry } = await load(new URL('vendor/noclip/js/zip.js', root).href);
    const sfz = vfs.bytes('/roms/sfight.zip');
    const buf = sfz.buffer.slice(sfz.byteOffset, sfz.byteOffset + sfz.length);
    const dir = readZipDirectory(buf);
    const stf = merge32(...await Promise.all(PROG.map((f) => extractZipEntry(buf, dir, f))));
    const prog = program(kit, image, stf, poses.bytes);

    say({ step: 'zip' });
    const set = `${ROOT}board/roms/sfight`;
    const entries = vfs.list(set).map((name) => ({ name, data: vfs.bytes(`${set}/${name}`) }));
    const [p15, p16] = split32(prog);
    entries.push({ name: PROG[0], data: p15 }, { name: PROG[1], data: p16 });
    const files = Object.fromEntries(await Promise.all(entries.map(async (e) => [e.name, await sha256(e.data)])));
    const zip = storeZip(entries);
    const hash = await sha256(zip);
    /* which files are not the published build's (a moves edit, other ROMs) */
    const differ = Object.keys({ ...files, ...kit.files }).filter((f) => files[f] !== kit.files[f]).sort();
    return {
        zip, sha256: hash, files, differ, same: hash === kit.zip,
        poses: await sha256(poses.bytes) === kit.poses.sha256, program: await sha256(prog) === kit.program,
    };
}
