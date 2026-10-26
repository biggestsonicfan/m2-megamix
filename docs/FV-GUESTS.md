# Fighting Vipers guests: Honey, Tokio and Bahn

The owner asked for FV's Honey, Tokio and Bahn (pin #1579). They are in two
places:

- **The web Megamix.** Here they are done. `js/games.js` ROSTER has FV Honey
  (record 2), and now Tokio (3) and Bahn (4) after the first nine. The
  first nine keep their numbers, so Ryo is now `?p1=11` and Chai `?p1=12`.
  `tests/bout.test.mjs` fights all 169 pairings (121 without Ryo and Chai).
- **The board** (the StF Model 2B build, docs/BOARD.md). An FV fighter
  could be a guest there as Akira is (`tools/vf2-guest.mjs`) and Ryo is
  (`tools/ryo-guest.mjs`). This file records what that needs and what is
  left to hold it. `tools/fv-guest-survey.mjs` measures it from the ROMs
  and changes nothing:

      node tools/fv-guest-survey.mjs [--json]

Mahler (pin #1613) has a file of his own, docs/FV-MAHLER.md: what he needs
beyond the three (`--char 8`).

None of the three is imported on the board yet. Within StF's own ROMs,
motion ids and meshes fit, the guest heap fits two of them, and the
texture pages fit none. At the sizes a Model 2B game can have, with
textures loaded per fight, all of it fits ("Room", below).

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

Two sets of limits matter here. "StF's ROMs" is the room in StF's own ROM
files and in texture RAM as StF lays it out. "Model 2B" is the room the
hardware gives, as large as any Model 2B game in MAME's driver fills it.
The board build is our own program, so it doesn't have to stop at StF's
fill. `tools/model2-rom-limits.py` reads the ROM regions from the fork's
`src/mame/sega/model2.cpp`; `--all` covers 2O, 2A and 2C too:

| Region | StF fills | Model 2B fills | Largest | What it holds here |
|--|--|--|--|--|
| maincpu (program) | 1 MB | 2 MB | vonu | the board program |
| main_data | 16 MB + 1 MB mirrored (epr-19003/4 at 0x1000000) | 32 MB | dyndeka2b | setups, motion blocks, texture pages, the guest heap |
| polygons | 16 MB | 32 MB | pltkids | meshes |
| textures (material and UV streams) | 16 MB | 16 MB | sfight | materials, UVs |
| copro_data | 4 MB | 8 MB | gunblade | StF's collision and height maps |
| samples | 8 MB | 8 MB | | sound |

Two more limits aren't ROM sizes:

- **Texture RAM is fixed.** Every Model 2 draws from the same two sheets
  of texture RAM, 2048×1024 4-bit texels each (`model2_v.cpp`: texsheet
  is textureram0 or textureram1). The lower right quarter of each sheet
  holds the mips, so a sheet has 24 full-size 256×256 slots, 1536 cells
  of 32×32. StF puts a stage's set on sheet 0 and all of set 1, every
  fighter's art at once, on sheet 1. The board's loader (`tex_load_set`)
  only copies that. Loading the two fighters in the fight, plus what they
  share, instead of all of set 1 is a loader change. It doesn't need more
  RAM.
- **Motion ids are 13 bits** (MOTION_ID 0x1FFF), so 8192 of them. The
  guest lists hold 2048 because `tools/lift-stf.py` GUESTS gives
  `offset_list_motions` and `animation_related` 0x2000 bytes each.

What Akira and Ryo leave in each case (`node tools/fv-guest-survey.mjs`):

| What | Room, StF's ROMs | Room, Model 2B | All three FV (core) |
|--|--|--|--|
| Motion ids (Akira 519..878) | 1169 | 7313, with GUESTS grown | 570 |
| Guest heap (setups, blocks, programs) | 944724 B (0x2F195AC..0x3000000) | 16.7 MB, with main_data's upper 16 MB less StF's 1 MB | 1277040 B |
| Meshes | 805528 B (polygon ROM 0xF3B568..0x1000000) | 17.6 MB, with the polygon ROM's second 16 MB | 577320 B |
| Texture cells | 174 for every guest at once (set 1's seven pages, 448, less Akira's 266 and Ryo's 8) | 1536 a fight, for both fighters and what they share | 1411; the largest two 981 |

With StF's ROMs, motion ids and meshes fit. The heap fits any two of the
fighters, not all three. The textures fit none of them: each takes
430-503 cells against 174. FV's textures are finer than VF2's; Akira's
take 266 cells.

With Model 2B's sizes, everything fits:

- **Motion ids, heap and meshes** fit all three, with room for many more.
  The armour models fit too (2.7 MB of meshes).
- **Textures** fit a fight's two fighters: 981 cells at most (Tokio and
  Bahn), out of sheet 1's 1536. That leaves 555 cells, about 8.7 slots,
  for what every fight needs from set 1: effects, items and anything else
  the two don't own. Nobody has measured that yet.
  docs/STF-BOARD-AKIRA.md lists which fighters and unnamed models sample
  each set-1 page. Measure it first: it decides whether FV's armour (up to
  682 cells for Honey) fits too, or has to go in at a lower level.

What it takes to get there:

1. **A ROM set with the larger regions.** MAME's `sfight` has polygons
   at 0x1000000. Its main_data upper half is one 1 MB pair, copied every
   MB. The board build needs its own set in the fork's `model2.cpp`: a
   `sfight` clone on `model2b` with polygons at 0x2000000 and 16 MB of
   main_data at 0x1000000 (dyndeka2b's layout). Make it on a fork branch,
   merge it into `shared` and rebuild with `build-shared-mame.sh`.
   `import-assets.mjs`'s `xtra` (1 MB) and `polygons` sizes grow with it.
2. **StF's 1 MB in the upper half.** StF reads its epr-19003/4 MB through
   the XTRA window (0x06000000 = main_data 0x1000000). Its motion list is
   at 0x06400004, and the scroll and pattern tables are at 0x06480000 and
   0x06480300. With 16 MB there, the mirrors are gone, so that MB has to
   be at every place StF reads it. Find the places (a trace of reads in
   0x06000000..0x06FFFFFF, or of main_data 0x1000000 and up), and copy
   the MB to each.
3. **A per-fight texture loader.** It loads sheet 1 from the two fighters'
   pages plus the shared pages, not set 1 whole. Each guest's material
   records then name his tiles' places on that fight's sheet. Either he
   packs to the same place every fight, or the board patches th2 when it
   loads him.
4. **The real board.** MAME's sets show 2B ROM boards with all eight
   polygon and eight main_data sockets filled (dyndeka2b, pltkids). StF's
   own ROM board numbers its ICs differently (main_data 7-12, polygons
   17/18/21/22). Before burning ROMs, check that the owner's board has
   the sockets and decodes the extra address lines.

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
8. The larger ROM set and the per-fight texture loader ("Room").

The skeleton, collision balls and the pose rig are the cast-wide tables
VF2 has too. Their FV addresses still need finding.

Akira took about 90 commits. Much of that work (the midriff, hands, heads,
throws and the strike parts) carries over. What every fight needs from
set 1 is the number to measure first.
