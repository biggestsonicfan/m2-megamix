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
import { loadShenmue, shenmueFighter, RYO as RYO_SPEC } from './ryo.js';
import { CHAI as CHAI_SPEC } from './chai.js';

export const GAMES = [
    { key: 'vf2', zip: 'vf2', title: 'Virtua Fighter 2', kind: 'vf2' },
    { key: 'fv', zip: 'fvipers', title: 'Fighting Vipers', kind: 'vf2' },
    { key: 'stf', zip: 'sfight', title: 'Sonic the Fighters', kind: 'stf' },
];

/* The record names the extra entries go by: noclip's (vf2fighters.js
 * `rig.fighters.names`, characters.js CHARACTERS), shortened where noclip
 * adds a note. VF2's 11 and 12 and FV's 11 and 12 are records no select
 * screen offers. */
const VF2_NAMES = { 1: 'JACKY', 4: 'LAU', 5: 'JEFFRY', 6: 'PAI', 7: 'WOLF', 8: 'SHUN', 9: 'DURAL', 10: 'LION', 11: 'MUE', 12: 'KOJACKY' };
const FV_NAMES = { 0: 'JANE', 1: 'GRACE', 6: 'RAXEL', 7: 'SANMAN', 9: 'B.M.', 10: 'SONIC', 11: 'DUMMY 11', 12: 'DUMMY 12' };
const STF_NAMES = { 1: 'TAILS', 2: 'AMY', 3: 'METAL SONIC', 4: 'FANG', 5: 'BARK', 6: 'KNUCKLES', 7: 'ESPIO', 9: 'EGGMAN B',
    10: 'BEAN', 11: 'EGGMAN BOSS', 12: 'EGG UFO', 13: 'EGG MINION', 14: 'ROCKET METAL', 16: 'SUPER SONIC' };

/* The eleven first: VF2's and FV's record numbers (readFighters), StF's
 * character numbers (js/characters.js CHARACTERS). Honey is in two games.
 * Tokio and Bahn came last so the first nine keep their numbers, and the
 * rest come after them so the eleven keep theirs (?p1=, the tests). */
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
    /* Every other record the three games keep, so each can be fought and its
     * record fields compared (docs/RECORDS.md): VF2's ten and Dural, and
     * its two records past Lion's; FV's six, its own Sonic and its two
     * dummies; StF's eleven, the bosses and Super Sonic. A record's second
     * player look (FV's +13, StF's +26) is not its own entry. */
    ...[1, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((index) => ({ game: 'vf2', index, name: VF2_NAMES[index] })),
    ...[0, 1, 6, 7, 9, 10, 11, 12].map((index) => ({ game: 'fv', index, name: FV_NAMES[index] })),
    ...[1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 16].map((index) => ({ game: 'stf', index, name: STF_NAMES[index] })),
];

/* Ryo and Chai, from the Shenmue beta's disc, when it can be had (js/ryo.js, js/chai.js). */
export const RYO = { game: 'shenmue', index: 0, name: 'RYO' };
export const CHAI = { game: 'shenmue', index: 1, name: 'CHAI' };

/* The arenas, as the fight code bounds them: VF2's ring is 16 square and a
 * fighter past its edge is out; FV's and StF's cages are walls, and FV's
 * breaks (js/engine.js, the cage break). StF's stages
 * are drawn at 1/1.6 (their ops carry a 1.6 scale the fighters do not). */
export const ARENA = {
    vf2: { half: 8, ringOut: true, scale: 1 },
    fv: { half: 6, ringOut: false, cage: true, scale: 1 },
    stf: { half: 5, ringOut: false, scale: 1 / 1.6 },
};

/* The arenas each game fights in, by slot. The rest (VF2's two Test
 * records, FV's copies, Western 2, name entry and unnamed records, and
 * StF's unnamed records, boss room and story scenes) are extraStagesOf. */
const STAGE_SLOTS = {
    vf2: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    fv: [0, 1, 2, 3, 5, 6, 7, 8],
    stf: [0, 1, 2, 3, 4, 5, 6, 7, 9],
};

function stageList(game) {
    return game.rom.game.stageTable.vf2 ? readVf2Stages(game.rom) : readStageTable(game.rom);
}

export function stagesOf(game) {
    const list = stageList(game);
    return STAGE_SLOTS[game.key].map((n) => list[n]).filter((s) => s && s.name);
}

/* The records left out above, offered after every game's arenas (so the
 * arenas keep their numbers): each one's flags and fields can then be seen
 * at work (docs/RECORDS.md). They are fought in as their game's arena. */
export function extraStagesOf(game) {
    const list = stageList(game);
    return list.filter((s, n) => s && !STAGE_SLOTS[game.key].includes(n));
}

/** Load the three sets. `fetchZip(zipName)` returns an ArrayBuffer;
 * `fetchShenmue(path)` a file off the Shenmue disc, or null, and
 * with them Ryo and Chai join the roster. */
export async function loadGames(fetchZip, onStatus = () => {}, fetchShenmue = null) {
    const games = {};
    for (const g of GAMES) {
        onStatus(`LOADING ${g.zip}.zip`);
        const buf = await fetchZip(g.zip);
        const rom = await loadRomSet([buf], () => {});
        games[g.key] = prepareGame({ ...g, rom });
    }
    for (const g of Object.values(games)) { g.stages = stagesOf(g); g.extraStages = extraStagesOf(g); }
    if (fetchShenmue) {
        onStatus('LOADING SHENMUE');
        const sm = await loadShenmue(fetchShenmue, [RYO_SPEC, CHAI_SPEC]).catch(() => null);
        if (sm) {
            games.shenmue = { ...sm, makeFighter: shenmueFighter };
            /* after the eleven, so they stay ?p1=11 and ?p1=12 */
            const join = [RYO, CHAI].filter((e) => sm.chars[e.name] && !ROSTER.includes(e));
            ROSTER.splice(11, 0, ...join);
        }
    }
    return games;
}
