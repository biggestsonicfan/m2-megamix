/*
 * tests/node-roms.mjs in the browser (the loader puts it in that one's place):
 * the sets from the player's files under $ROMS_DIR, and the Shenmue beta's
 * files off the player's GD-ROM dump under $SHENMUE_DIR (gdi.mjs), not
 * through Python.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { loadGames } from '../../js/games.js';
import { openGdi } from './gdi.mjs';
import * as vfs from './node/vfs.mjs';

const ROMS = process.env.ROMS_DIR;
export const SHENMUE_DIR = process.env.SHENMUE_DIR;
let disc;

export function shenmueFile(path) {
    if (disc === undefined) {
        const gdi = existsSync(SHENMUE_DIR) && readdirSync(SHENMUE_DIR).find((f) => /\.gdi$/i.test(f));
        disc = gdi ? openGdi(readFileSync(`${SHENMUE_DIR}/${gdi}`, 'utf8'), (name, off, n) => vfs.read(`${SHENMUE_DIR}/${name}`, off, n)) : null;
    }
    const b = disc?.file(path);
    return b ? b.buffer.slice(b.byteOffset, b.byteOffset + b.length) : null;
}

export function loadNodeGames() {
    return loadGames(async (zip) => {
        const b = readFileSync(`${ROMS}/${zip}.zip`);
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    }, () => {}, async (path) => shenmueFile(path));
}
