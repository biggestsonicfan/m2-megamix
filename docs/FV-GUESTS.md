# Fighting Vipers guests: Honey, Tokio and Bahn

The owner asked for FV's Honey, Tokio and Bahn (pin #1579). They are in two
places:

- **The web Megamix.** Here they are done. `js/games.js` ROSTER has FV Honey
  (record 2), and now Tokio (3) and Bahn (4) after the first nine. The
  first nine keep their numbers, so Ryo is now `?p1=11`.
  `tests/bout.test.mjs` fights all 144 pairings (121 without Ryo).
- **The board** (the StF Model 2B build, docs/BOARD.md). An FV fighter
  could be a guest there as Akira is (`tools/vf2-guest.mjs`) and Ryo is
  (`tools/ryo-guest.mjs`). This file records what that needs and what is
  left to hold it. `tools/fv-guest-survey.mjs` measures it from the ROMs
  and changes nothing:

      node tools/fv-guest-survey.mjs [--json]

None of the three is imported on the board yet. In short, motion ids and
meshes fit. The guest heap fits one or two of them. The texture pages fit
none of them as they are ("Room", below).

## FV's tables, beside VF2's

`importAkira` reads these from VF2. Here is where FV keeps each one. The FV
addresses are from noclip's `fvipers` rig and FV's program ROM.

| What | VF2 (vf2-guest.mjs) | FV |
|--|--|--|
| Command programs, by character | program 0x1D1FC | program 0x1EBE0 |
| Command op lengths | moves.js OP_LENGTH, but for VF2's own 5, 0x32 and 0x33 | moves.js OP_LENGTH as it is (StF's matcher) |
| Setups (mot_list) | 0x0200D34C | 0x06411E94 |
| Setup op lengths | 0x1B7F6, 0x12 ops | 0x1CE86, 25 ops, a 12-byte head |
| Motion blocks | 0x02120004, 1360 | 0x06C00004, 1055 |
| Reactions | 0x0201CCFC, 30 kinds of 40 | 0x0641F834, 22 kinds of 40 |
| Records (P1; P2 +26 on StF) | readFighters | 0x0640D2B0 on; P2 records 13 on; texture set at +0x20 |
| Actions | record, StF's 52 slots from STF_ACTIONS | record +0x14, 55 entries |
| Weight | record +0x2C | record +0x1C |
| Hands | record +0x3C, 32 shapes a hand | 0x0640EBF4 by record, 4 shapes a hand, s16 model ids |
| Head | the record | the face op (play op 0x10): 0x0640D31C[arg][record], a pair of s16 models (the head, then its armoured one) |
| Midriff | record +0x38 | record +0x24 (model at +8, as VF2's) |
| Armour | none | 0x0640EDAC (broken parts, bounces, hips, flying pieces) |
| Motion ids in play ops | 0x0A/0x0B at +5, 0x17 at +4 | the same |
| Setup handovers | | op 1, op 0x13 (two), op 0x0A at +4 |
| Throw victim | | setup op 5, +1 |

## The formats against StF's

- **The command program.** FV's matcher is StF's: the same opcodes and the
  same OP_LENGTH table. The program can be copied op by op with only the
  motion ids and commit types renumbered. VF2's needed three op lengths
  changed.
- **Setups.** FV's setup ops are StF's, op for op, except op 4 (the
  strike): 19 bytes on FV, 18 on StF. That is the same difference VF2
  has, and vf2-guest's op 4 conversion should apply. Each fighter uses
  op 4 60-72 times.
- **Play ops.** Five of FV's 31 play ops have lengths StF's 0x2C don't
  (FV / StF):

  | Op | FV | StF | Uses (Honey, Tokio, Bahn) |
  |--|--|--|--|
  | 0x10 | 4 | 5 | 74, 75, 73 (the face op) |
  | 0x12 | 7 | 5 | 172, 132, 137 |
  | 0x18 | 12 | 4 | 13, 16, 13 |
  | 0x1B | 4 | 6 | 6 each |
  | 0x1C | 6 | 3 | 79, 92, 67 |

  Each needs a PLAY_TO entry, as VF2's do: the same op cut or padded, the
  StF op that does the same thing, or nothing. Which one it is takes
  reading FV's play_motion against StF's (Ghidra).
- **Commit types** (the commit word's top byte). FV uses 0x00, 0x09, 0x10,
  0x13, 0x1A, 0x1B, 0x1D, 0x1E, 0x23, 0x25, 0x2B, 0x2D and 0x30. VF2's
  COMMIT_TYPE map does not cover 0x23, 0x25, 0x2B, 0x2D or 0x30, and FV's
  numbering need not be VF2's. FV needs a COMMIT_TYPE map of its own,
  read from its commit code.
- **Actions.** FV's record has 55 actions to StF's 52. STF_ACTIONS (StF slot
  to VF2 action) has to be redone against FV's list.
- **Size.** FV has a Sonic of its own, so an FV guest scales by Sonic to
  Sonic: StF's 2.676 over FV's 1.309 = ×2.044. That is the factor Akira's
  SCALE already carries (vf2-guest.mjs, "his size"), without its VF2-to-FV
  step. It is also close to Ryo's ×2.0441.
- **Armour.** FV's armour (the pieces that break off, the chest's bounce,
  the hips by motion and in the air, the debris flipbook) is FV's own code.
  StF's code has none of it. A guest without that code draws only the
  whole body, which is what the survey's "core" counts. Breaking armour on
  the board would be new board code (megamix.c), as the midriff was.

## Slots

StF characters Megamix does not use: Amy 2, Metal Sonic 3, Fang 4, Bark 5,
Espio 7 and Bean 10. Ryo is on Tails (1) and Akira on Knuckles (6).
`char_game` (docs/BOARD.md) already has GAME_FV = 2 for StF code that
branches by game. Model ids are taken from the top down among ids the
board does not keep (Akira 5006..5102, Ryo 4983..5005), so there are
plenty.

## Per fighter

`node tools/fv-guest-survey.mjs`. "Core" models are what StF's code would
draw: both records' parts, the midriff, the hands and the heads. "Armour"
models are the rest.

| | Honey (2) | Tokio (3) | Bahn (4) |
|--|--|--|--|
| Command program | 0x73208, 2962 B, 122 commits, 9 natives | 0x73C60, 3022 B, 124 commits, 8 natives | 0x746E4, 2239 B, 90 commits, 9 natives |
| Motions (+ thrown copies) | 186 (+14) | 182 (+13) | 166 (+9) |
| Setups / blocks | 9241 / 446484 B | 8753 / 443528 B | 7979 / 352832 B |
| Core models, meshes | 45, 205040 B | 44, 204600 B | 43, 167680 B |
| Armour models, meshes | 278, 1177360 B | 84, 188320 B | 236, 1301840 B |
| Texture sets (P1, P2) | 5/6, 81/82 | 7/8 | 9/10 |
| Core textures | 56 tiles, 430 cells | 68 tiles, 503 cells | 66 tiles, 478 cells |
| With armour | 81 tiles, 682 cells | 73 tiles, 531 cells | 75 tiles, 532 cells |

Cells are 32×32 cells on the 32-pixel grid, counted as pack-akira counts
them. For scale: Akira's 49 tiles take 266 cells.

## Room

What Akira and Ryo leave (import-assets on `ryo-board`):

| What | Left | All three FV (core) |
|--|--|--|
| Motion ids (guest lists hold 2048; Akira 519..878) | 1169 | 570 |
| Guest heap, main_data 0x2F195AC..0x3000000 (setups, blocks, programs) | 944724 B | 1277040 B |
| Polygon ROM's empty run after Ryo (0xF3B568..0x1000000) | 805528 B | 577320 B |
| Texture cells in the seven set-1 pages (448; Akira 266, Ryo 8) | 174 | 1411 |

- **Motion ids and meshes fit** all three.
- **The heap fits two of them** (Honey and Bahn come to 822 KB, for
  example), not all three. The blocks are most of it. main_data has
  larger zero runs further down (0x447484 bytes in one). But
  import-assets drops runs of StF zeros the board reads, so a run has to
  be shown unread before the heap can use it.
- **The textures don't fit.** Any one of them takes 2.5-3 times the free
  cells. FV's textures are finer than VF2's: Akira takes 266 cells, they
  take 430-503. "Free texture RAM during a fight: none"
  (docs/STF-BOARD-AKIRA.md), so the options are:
  1. **Swap pages by matchup.** Load a guest's pages only when he is
     picked, over pages the two fighters in play do not use. The board
     loads textures at the fight's start, so this is a loader change, not
     more RAM.
  2. **Halve them.** Pack FV's tiles a level down (a 128×128 tile as
     64×64): about a quarter of the cells, 108-126 a fighter. That fits
     one beside Akira and Ryo.
  3. **Fewer fighters.** Tokio alone at half size fits. All three need
     option 1.

## What importing one takes

vf2-guest's import is VF2-shaped throughout. For FV it needs:

1. The FV table addresses above in place of its VF2 constants.
2. FV's own PLAY lengths and PLAY_TO for the five ops.
3. A COMMIT_TYPE (and COMMIT_ACTION) map for FV's commit types.
4. STF_ACTIONS against FV's 55 actions.
5. SCALE = 2.676 / 1.309.
6. The hands (4 shapes) and heads (the face op's table) read FV's way.
7. A character slot (CHR) and model ids that don't clash with Akira's or
   Ryo's.
8. A texture plan from "Room".

The skeleton, collision balls and the pose rig are the cast-wide tables
VF2 has too. Their FV addresses still need finding.

Akira took about 90 commits. Much of that work (the midriff, hands, heads,
throws and the strike parts) carries over. The texture budget is the open
question. Settle it before importing anyone.
