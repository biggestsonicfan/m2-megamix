/*
 * Chai, Shenmue's final boss (disc 3, the ending's fight: SCENE/03/MEND).
 *
 * His scene has everything of his: MODELS.PKS his two models (CHA_B, the
 * low one of 306 triangles on the 15 bones of Ryo's YKB_B, drawn here;
 * CHA_M, his full one of 1979), MODELS.PKF their textures, M_FGT4.BIN his
 * own motion bank (ids 0x800 to 0x848: CHA_CHA_KAMAE_LP and the rest), and
 * EN_CHAI2.BIN his move script, read as Ryo's is (js/ryo.js readMoves).
 * What his bank lacks (a crouch, a jump, being hit) is MOTION.BIN's, as
 * Ryo's are.
 */
import { SIZE, HIT, GUARD_PUSH, ACTS as RYO_ACTS, restHeight } from './ryo.js';

const SCENE = 'SCENE/03/MEND/';

/* Ryo's full model's height at rest (YKB_M), for when Ryo's files are not
 * loaded to measure it from. */
const RYO_REST = 1.795;

/* His actions: his own stance, walks, dashes and guards (M_FGT4.BIN); the
 * rest Ryo's. */
export const ACTS = {
    ...RYO_ACTS,
    stance: 0x800, walkF: 0x801, walkB: 0x83b, dashF: 0x804, dashB: 0x805,
    guard: 0x846, crouchGuard: 0x847,
};

export const CHAI = {
    name: 'CHAI',
    files: { pks: SCENE + 'MODELS.PKS', pkf: SCENE + 'MODELS.PKF', bank: SCENE + 'M_FGT4.BIN', script: SCENE + 'EN_CHAI2.BIN' },
    model: 'CHA_B.CHRM', lowModel: 'CHA_B.CHRM', fullModel: 'CHA_M.CHRM',
    /* Ryo's size, by their full models' heights at rest: a little shorter. */
    size: (chars) => SIZE * restHeight(chars.CHAI.fullModel) / (chars.RYO ? restHeight(chars.RYO.model) : RYO_REST),
    acts: ACTS, hit: HIT, guardPush: GUARD_PUSH,
};
