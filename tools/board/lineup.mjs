/*
 * The board's lineups: which fighters a build has, in the setup menu's order.
 *
 * Texture RAM holds one fighters' sheet (StF's set 1), and the guests' tiles
 * are packed into the cells StF's own cast leaves free (tools/guests/pack-akira.mjs),
 * so a build cannot have every fighter: each lineup is its own build.
 *
 *   LINEUP=<name> node tools/board/bake-board.mjs   (default megamix)
 *
 * picks one; tools/board/import-assets.mjs then imports the fighters board/src/gen/poses.h
 * names, and leaves the cells of each StF fighter in it free.
 *
 * - megamix: StF's Sonic, Honey and Eggman, and the five guests: VF2's Akira,
 *   Shenmue's Ryo and Chai, Daytona's Hornet and FV's Mahler.
 * - stf: StF's whole fighting cast but Tails and Knuckles (whose slots are
 *   Ryo's and Akira's) and Metal Sonic (whose page 3 is Akira's), with Akira
 *   and Mahler: every fighter of it but the two guests runs on StF's own data,
 *   so StF grades it whole.
 */
export const LINEUPS = {
    megamix: ['SONIC', 'HONEY', 'EGGMAN', 'AKIRA', 'RYO', 'CHAI', 'HORNET', 'MAHLER'],
    stf: ['SONIC', 'HONEY', 'EGGMAN', 'AKIRA', 'MAHLER', 'AMY', 'FANG', 'BARK', 'ESPIO', 'BEAN'],
};
export const LINEUP = process.env.LINEUP || 'megamix';
if (!LINEUPS[LINEUP]) throw new Error(`LINEUP=${LINEUP}: no such lineup (${Object.keys(LINEUPS).join(', ')})`);
/* The game a fighter's name line shows where it is not the one its code runs
 * as (menu.c): Ryo and Chai run as VF2's Akira does, and Hornet too. */
export const FROM = { RYO: 'SHENMUE', CHAI: 'SHENMUE', HORNET: 'DAYTONA' };
