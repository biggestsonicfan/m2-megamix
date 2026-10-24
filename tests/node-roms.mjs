/* Load the three sets from $ROMS_DIR, read in place, for the Node tests; and
 * Ryo's files off the Shenmue disc in $SHENMUE_DIR, when it is there. */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadGames } from '../js/games.js';

const ROMS = process.env.ROMS_DIR || `${process.env.HOME}/build/mameroms`;
export const SHENMUE_DIR = process.env.SHENMUE_DIR || `${process.env.HOME}/source/repos/ai/SHENMUE 1 BETA 0.400 DISC 3 PERFECT DUMP`;
const TOOL = fileURLToPath(new URL('../tools/shenmue-fight.py', import.meta.url));

function shenmueFile(path) {
    if (!existsSync(SHENMUE_DIR)) return null;
    const b = execFileSync('python3', ['-I', TOOL, 'cat', SHENMUE_DIR, path], { maxBuffer: 1 << 26 });
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}

export function loadNodeGames() {
    return loadGames(async (zip) => {
        const b = readFileSync(`${ROMS}/${zip}.zip`);
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    }, () => {}, async (path) => shenmueFile(path));
}
