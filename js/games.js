/*
 * The three ROM sets and the Megamix roster.
 *
 * Each set is loaded whole by noclip's loader (js/romset.js), which knows all
 * three games' layouts. Nothing is copied out of them: the fighters, motions,
 * stages, textures and colour tables are read from the loaded ROMs as they
 * are needed.
 */
import { loadRomSet } from '../vendor/noclip/js/romset.js';
import { readStageTable } from '../vendor/noclip/js/stages.js';
import { readVf2Stages } from '../vendor/noclip/js/vf2.js';
import { prepareGame } from './fighters.js';
import { loadShenmue, ryoFighter } from './ryo.js';

export const GAMES = [
    { key: 'vf2', zip: 'vf2', title: 'Virtua Fighter 2', kind: 'vf2' },
    { key: 'fv', zip: 'fvipers', title: 'Fighting Vipers', kind: 'vf2' },
    { key: 'stf', zip: 'sfight', title: 'Sonic the Fighters', kind: 'stf' },
];

/* The eleven: VF2's and FV's record numbers (readFighters), StF's character
 * numbers (js/characters.js CHARACTERS). Honey is in two games. Tokio and
 * Bahn came last so the first nine keep their numbers. */
export const ROSTER = [
    { game: 'vf2', index: 0, name: 'AKIRA' },
    { game: 'vf2', index: 2, name: 'SARAH' },
    { game: 'vf2', index: 3, name: 'KAGE' },
    { game: 'fv', index: 5, name: 'PICKY' },
    { game: 'fv', index: 2, name: 'HONEY' },
    { game: 'fv', index: 8, name: 'MAHLER' },
    { game: 'stf', index: 0, name: 'SONIC' },
    { game: 'stf', index: 15, name: 'HONEY' },
    { game: 'stf', index: 8, name: 'EGGMAN' },
    { game: 'fv', index: 3, name: 'TOKIO' },
    { game: 'fv', index: 4, name: 'BAHN' },
];

/* Ryo, from the Shenmue beta's disc, when it can be had (js/ryo.js). */
export const RYO = { game: 'shenmue', index: 0, name: 'RYO' };

/* The arenas, as the fight code bounds them: VF2's ring is 16 square and a
 * fighter past its edge is out; FV's and StF's cages are walls. StF's stages
 * are drawn at 1/1.6 (their ops carry a 1.6 scale the fighters do not). */
export const ARENA = {
    vf2: { half: 8, ringOut: true, scale: 1 },
    fv: { half: 6, ringOut: false, scale: 1 },
    stf: { half: 5, ringOut: false, scale: 1 / 1.6 },
};

/* The stages offered: the arenas each game fights in, by slot. Left out are
 * VF2's two Test records, FV's copies, Western 2, name entry and unnamed
 * records, and StF's unnamed records, boss room and story scenes. */
const STAGE_SLOTS = {
    vf2: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    fv: [0, 1, 2, 3, 5, 6, 7, 8],
    stf: [0, 1, 2, 3, 4, 5, 6, 7, 9],
};

export function stagesOf(game) {
    const list = game.rom.game.stageTable.vf2 ? readVf2Stages(game.rom) : readStageTable(game.rom);
    return STAGE_SLOTS[game.key].map((n) => list[n]).filter((s) => s && s.name);
}

/** Load the three sets. `fetchZip(zipName)` returns an ArrayBuffer;
 * `fetchShenmue(path)` one of Ryo's files off the Shenmue disc, or null, and
 * with them he joins the roster. */
export async function loadGames(fetchZip, onStatus = () => {}, fetchShenmue = null) {
    const games = {};
    for (const g of GAMES) {
        onStatus(`LOADING ${g.zip}.zip`);
        const buf = await fetchZip(g.zip);
        const rom = await loadRomSet([buf], () => {});
        games[g.key] = prepareGame({ ...g, rom });
    }
    for (const g of Object.values(games)) g.stages = stagesOf(g);
    if (fetchShenmue) {
        onStatus('LOADING SHENMUE');
        const sm = await loadShenmue(fetchShenmue).catch(() => null);
        if (sm) {
            games.shenmue = { ...sm, makeFighter: ryoFighter };
            if (!ROSTER.includes(RYO)) ROSTER.push(RYO);
        }
    }
    return games;
}
