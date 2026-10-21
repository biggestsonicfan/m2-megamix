/* Load the three sets from $ROMS_DIR, read in place, for the Node tests. */
import { readFileSync } from 'node:fs';
import { loadGames } from '../js/games.js';

const ROMS = process.env.ROMS_DIR || `${process.env.HOME}/build/mameroms`;

export function loadNodeGames() {
    return loadGames(async (zip) => {
        const b = readFileSync(`${ROMS}/${zip}.zip`);
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    });
}
