# Chai

Chai is the roster's eleventh fighter: Shenmue's final boss, from the
ending's fight on the beta's disc 3 (0.400). Like Ryo (`docs/RYO.md`),
everything about him is read off the disc when the page loads.
`tools/serve.py` serves his scene's four files at `/shenmue/<path>`. Without
them the roster goes without him.

| file | what |
|--|--|
| `SCENE/03/MEND/MODELS.PKS` (gzip) | `CHA_B.CHRM`, his low model (306 triangles, drawn); `CHA_M.CHRM`, his full one (1979, measured for his size) |
| `SCENE/03/MEND/MODELS.PKF` (gzip) | their textures (`HA_*`, the low model's under their own ids) |
| `SCENE/03/MEND/M_FGT4.BIN` | his own motion bank: ids 0x800 to 0x848 (`CHA_CHA_*`, and the `AKI_AKI_NGR_*` his throws' victims play) |
| `SCENE/03/MEND/EN_CHAI2.BIN` | his move script |

`js/chai.js` holds his spec, and `js/ryo.js` makes either of them a fighter
(`shenmueFighter`). A motion id at the bank's base (0x800, in its header at
+0x14) or above is his bank's, at id − base. Anything lower comes from
`MISC/MOTION.BIN`, which Ryo's motions also come from. The records are
laid out as Ryo's are.

## Body

`CHA_B` has the same 15 bones as Ryo's `YKB_B`, so he is posed and skinned
as Ryo is. Its textures are the fight afterimage's: ARGB4444 at alpha 4 of
15 all over. `js/shenmue.js` reads a 4444 texture with no texel half opaque
as solid, otherwise the alpha test would cut him out entirely.

## Size

He is Ryo's size times the two full models' heights at rest, `CHA_M` 1.706
to `YKB_M` 1.795. That is 0.924 of Akira, 1.513 to 1.638 in Akira's stance.
His own stance is a deep crouch, his head under a metre.

## Moves

His script runs on the same VM as Ryo's, with these differences:

- the root's switches start at the script's start (Ryo's at start + 4);
- ops 0, 1 and 3 are 4-byte forms of 73, 72 and 77 (the stick checks);
- op 40 is a three-way branch like op 76, its targets at bytes 2, 4 and 6;
- op 22 is a one-button table (u16 as a switch's), which his strings go on by.

That gives 17 root entries and 11 string tables:

- P: jab → backknuckle → Kangal kick, nidan punch, the renzoku, the elbow,
  the uppercut and the body blow;
- K: drop kick, samersault, nidan kick → walk-up combo, niren kick →
  samersault combo, senkyu;
- P+K: walk-up, and the big body blow → double punch;
- P+G: the stagger throw (`NGS_YOROKE`) and back + P+G, the crotch throw
  (`NGS_MATA`).

His throws record no damage. Ryo's only such throw is a parry, which is
dropped; Chai's are throws, and do 50 like everyone's. The Tenshin throw
(`NGS_TENSHIN`) needs a state (op 7) and is left out, as is the side kick
(`KICK_B_SOKUTOU`), which needs one too. Damage is scaled as Ryo's is,
which makes his elbow and renzoku 70, the cap.

His stance, walks, dashes and guards are his own (0x800, 0x801, 0x83B,
0x804, 0x805, 0x846, 0x847). The crouch, jump and hits come from
`MOTION.BIN` as Ryo's do, and being knocked down and getting up are Akira's.

## Not Shenmue's own

- On the board (docs/BOARD.md, The guest: Shenmue's Chai) he is StF
  character 12 with CHA_B, on a moveset of his own that is still a copy of
  Akira's, as Ryo's is. His Shenmue moveset is the web roster's.
- The state-gated moves are left out (Tenshin and the rest above).
