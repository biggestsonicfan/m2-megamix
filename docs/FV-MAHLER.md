# Fighting Vipers' Mahler, ready for the board

The owner asked for FV's Mahler (pin #1613). As with Honey, Tokio and Bahn
(docs/FV-GUESTS.md, pin #1579), there are two places he could be:

- **The web Megamix.** He is already here: `js/games.js` ROSTER has
  `{ game: 'fv', index: 8, name: 'MAHLER' }`, `?p1=5`. `node
  tests/fighters.test.mjs` poses and moves him with the others (212 root
  entries, 181 strikes, 8 throws).
- **The board** (docs/BOARD.md, "The guest: Fighting Vipers' Mahler",
  #1616). He is StF character 18, on his own moves, with his pads on his
  chest, his player 2 the same as player 1 and a shadow of his own parts' hulls; his sway
  chain isn't ported yet. This file lists what his import takes beyond
  the trio's. All of FV-GUESTS.md ("FV's
  tables", "The formats against StF's", "Room", "What importing one
  takes") applies to him unchanged. Its survey covers him now:

      node tools/fv-guest-survey.mjs --char 8          # Mahler alone
      node tools/fv-guest-survey.mjs --char 2,3,4,8,9  # with the trio and B.M.

  `--char` takes FV character numbers. With no `--char` it surveys the
  trio as before.

## Mahler in numbers

| | Mahler (8) | B.M. (9), for comparison |
|--|--|--|
| Record (P1 / P2) | 0x640C218 / **the same** (record 21 is record 8 again) | 0x640C298 / 0x640C918 |
| Weight (record +0x1C) | 95 | 95 |
| Texture sets | 17, 18 (shared with B.M.) | 17, 18 |
| Command program | 0x74EE4, 2711 B, 107 commits, 9 natives | 0x75888, 2877 B, 111 commits, 9 natives |
| Motions (+ thrown copies) | 168 (+10) | 173 (+9) |
| Setups / blocks | 7820 / 360208 B | 8118 / 377924 B |
| Core models, meshes | 28, 106640 B | 41, 137360 B |
| Shoulder pads | 4 (3888-3891), 7640 B | 6, 14160 B |
| Armour models, meshes | 74, 185320 B | 72, 179680 B |
| Core textures | 44 tiles, 290 cells | the same 290 |
| With pads / all armour | 305 / 317 cells | 305 / 317 |
| Sway chain | one tail of 6 (models 1507-1512), both records | the same |
| Shadow table (by record) | models 228-242, StF's form (docs/SHADOWS.md) | the same |

He has fewer core models than the others (28 to their 43-45) only because
his player 2 is the same record. The survey counts both records' parts,
and his are counted once.

Within StF's own ROMs (FV-GUESTS.md, "Room") his heap (370739 B), meshes
and motion ids fit beside Akira and Ryo, but his 290 cells don't fit the
174 that are left. At Model 2B's sizes he fits with room to spare. The
largest fight he can be in is against Tokio: 503 + 305 = 808 cells of
sheet 1's 1536. A Mahler mirror match needs his 305 once, because both
players draw the same tiles.

## What he needs that the trio doesn't

1. **Player 2 is player 1.** FV's record table gives character 8's
   player 2 (record 21, which `0xA0A8` picks when both players choose the
   same fighter) the same record: the same parts, texture set, sway chain
   and shadow table. The trio's player 2 records have models of their own.
   noclip's note (games.js, the fvipers rig) says only his colours change,
   but nothing in his record, models or materials differs, and where FV
   would recolour him hasn't been found. Not checked on screen: a Mahler
   mirror in MAME would settle it. On the board, StF's own rule is that
   player 2 is character + 26 with the player-2 colour table (BOARD.md,
   colours). Mahler's player 2 can follow that rule, with a colour table
   picked for him, or look the same as player 1, as FV's data has it.
   That is the owner's choice.
2. **Shoulder pads.** FV draws them in `kata_pat_disp` (0x32A90, slot 1).
   `0x642147C[char]` gives a left and a right record, 0x24 bytes each,
   with a second model each (noclip `readPads`, TECHNICAL.md "Shoulder
   pads and skirt"). This is FV's code, which StF doesn't have. The trio
   have no pads. Without them Mahler is drawn without his pauldrons,
   which a player would notice. There are two ways to add them:
   - drawn rigid on the chest's matrix, their translate and turns baked in
     (four models, no new code beyond a fixed extra part, as the midriff
     is drawn); or
   - with their swing from the upper arms, which is new board code in
     fighter_draw.c. The left pad goes when slot 6 breaks, the right when slot
     3 does, so with no armour code they never go.

   The survey counts them apart ("pads"): 15 cells and 7640 B more.
3. **His sway chain** is in FV's table at 0x63E34, by record (8 and 21):
   one chain of six segments on models 1507-1512. FV's records are StF's
   types (noclip osage.js: FV's handlers are StF's, 0x4ED4 lower). The
   board already runs StF's `osage_init` / `osage_dsp` (BOARD.md, sway
   chains), so Mahler needs his stream copied into the guest's
   `osage_per_character` entry, with its model ids renumbered. FV's
   gravity is 0.00522, a fifth of StF's, so on StF's code his
   tail will hang and swing differently unless the board gives guests
   FV's value. Honey (FV) has two of 4. Tokio and Bahn have none.
4. **One more commit type.** Besides the trio's types, his program uses
   0x21 once (0x7559F, motion 0) and doesn't use 0x1B or 0x30. FV's
   COMMIT_TYPE map (FV-GUESTS.md, step 3) needs 0x21 too.
5. **Nothing carried.** Record +0x2C is 0x640CB70, the same item records
   as Honey's and Tokio's. Bahn (his hat, 0x640D040) is the only one of
   these four with records of his own.

What he shares with the trio's import: the five play ops whose lengths
differ (0x10 ×70, 0x12 ×116, 0x18 ×13, 0x1B ×6, 0x1C ×81), setup op 4's
19 bytes (×59), the 55 actions, the scale (×2.044), the hands and heads
read FV's way (his heads' second model is the broken helmet, armour), and
a slot and model ids of his own.

## His motions are mostly theirs

Mahler shares 114 motions with Honey and Tokio, 131 with Bahn and 171 with
B.M. (`--char 2,3,4,8,9`). If the trio are imported first and each
motion's setup and block is kept once, he adds only 28 setups of his own,
93955 heap bytes. The ids he has and the trio don't, by FV's names
(`0x6C01080[id]`), are mostly his own strikes and throws: ATAMA_N/Y, BRA_N/Y,
GMS_N, GMS_SYA_N/Y, GMS_Y, MDKI_PU, MDKI_PUPU, TA_SKI_MID_BM,
TA_SKI_MID_BM2, TA_SKI_HI_BM2, TA_TURN_LPU_BM, SY_KI_BM, BM_NAGE_N/Y,
DAT_ONIFUMI, NEK_AIR_N/Y and others. Several end `_BM`: he and B.M. are
one moveset. His stance is motion 21, AK_TA_KAMAE (Akira's name, as
Bahn's and B.M.'s stance), and one strike is JACKY_PU_12.

Six motions are his and not B.M.'s: 396 NAGE_FAIL, 511 SJU_PU_DH,
803 DMY_TA_KI_MID_C, 874 SY_KI_MDKI, 899 DAT_ONIFUMI and 989/990
NEK_AIR_N/Y. Motion 989 is the one his commit type 0x25 plays. If B.M.
comes later, he costs almost nothing more than his own models.

## The order to import him

1. Import the trio first, or at least one of them (FV-GUESTS.md, "What
   importing one takes"). Mahler then adds a COMMIT_TYPE entry, 28
   motions, his models and his textures.
2. Give him a slot (Amy 2, Metal Sonic 3, Fang 4, Bark 5, Espio 7 and
   Bean 10 are free, less what the trio take) and model ids under Akira's
   and Ryo's.
3. Copy his sway chain stream into that slot's `osage_per_character`
   entry.
4. Draw his pads rigid on slot 1, or with their swing.
5. Decide his player 2's colours (above).
6. Give the board the cage break that stays broken (below).

## Breaking the cage

The owner's rule (pin #1614): Mahler breaks FV's cages with his
finishing blows, and the others break them with theirs on him. A broken
side **stays broken for the rest of the match**, and anyone can be rung
out through it. FV's own rule (docs/FV-STAGES.md, Cage break) is the
first half: a KO by a blow of finish kind 3 that drives the loser into a
wall breaks that side, and the loser flies through. FV mends the cage at
the next round (`SET_INT` clears `finish_wall_flag`) and never rings
anyone out. Keeping it broken and ringing out through it are Megamix's.

### His finishing blows

The finish kind is byte +0xE of setup op 4 (the attacker's +0x874). The
survey now lists each fighter's kinds (`finish kinds:`), and the kind-3
motions are the cage breakers:

| | Kind 3 (cage break) | Others |
|--|--|--|
| Mahler | 9: 346 349 355 356 570 676 866 867 868 | 2 ×1, 4 ×2 |
| Honey | 10: 346 349 355 356 497 570 606 676 827 980 | 1, 2, 4 ×7 |
| Tokio | 11: 346 349 355 356 570 609 676 680 830 985 1010 | 2, 4 ×4 |
| Bahn | 13: 346 349 355 356 570 605 652 676 727 826 831 854 981 | 1, 2, 4 ×6 |
| B.M. | 15: Mahler's and 610 822 824 828 830 831 | 2, 4 ×2 |

Mahler's, by FV's names and his inputs (facing right):

- 868 TA_TURN_LPU_BM, ← ↙ ↓ ↘ → + P: his own, one press.
- 866 TA_SKI_MID_BM2 and 867 TA_SKI_HI_BM2, the second kick after
  ↓↘ + K: → + K and K. His and B.M.'s.
- 676 TA_PU_BODY_03, P, P, → + P: the punch string's last blow, which
  the whole cast shares.
- 570 TACKLE_N, and 346-356 (JU_*), the jumping blows: shared.

### On the web Megamix (done)

`js/engine.js` runs it on FV's stages (`ARENA.fv.cage`), and
`tests/cage.test.mjs` checks it:

- A strike that takes the loser's energy to 0 marks it `finished` when it
  is the attacker's kind 3 (`js/fighters.js` reads FV's byte +0xE). VF2's,
  StF's and Shenmue's motions have no finish kinds: their KO blows of 30
  damage or more count (a third or so of each moveset, as FV's kind-3
  share).
- The walls now hold during the KO too (they didn't). A `finished` loser
  that the wall stops breaks that side instead: `fight.broken` gets it
  (FV's numbering, 0 +z, 1 −x, 2 −z, 3 +x), a `cagebreak` event goes out,
  and the loser carries on through.
- `fight.broken` isn't cleared between rounds. On a broken side a fighter
  is not stopped, and one whose body goes past the cage's line is out
  (`ringout`, energy 0, "RING OUT"), as at VF2's ring. A thrown fighter
  is out when the throw lets go. The other sides stay walls.
- `js/render.js` doesn't draw a broken side's panels, top or rail (the
  poles stay), as `cage_display` skips its `cage_clip_m`.
- Not done here: FV's angle test (driven in steeper than 22.5°), the
  flying pieces, the outside segments that stop the loser, the camera
  turn and the replay.

The test: Mahler's 868 KOs Honey at +x and breaks it, and she flies past
the line. It is still broken in round 2, where she backs out through it
and loses the match by ring out. A jab KO (kind 0) at the same wall
breaks nothing, and the −x wall still holds. Honey's 606 and Sonic's 283
(43 damage) break it on Mahler.

### On the board (to do, with or after Western's break)

FV-STAGES.md's "What the board needs" is the break itself. What this rule
adds:

1. **A match-long mask.** New RAM for `finish_wall_flag` (StF uses
   0x574004 for `ring_tobitiri`) plus a broken-sides mask that
   `round_start` (fighter.c) leaves alone and `load_stage` clears. FV's
   clears (`SET_INT` 0xC800, 0x8688, 0xA088, 0xA9E0) aren't ported.
   `cage_display`'s side skip and the shadow code's flag & 15 tests read
   the mask, not the one side.
2. **No wall on a broken side.** StF's `area_coli` walls the fighters in
   at stage_x on all four sides. After it runs, the board clears the push
   (+0x644 x or +0x64C z) toward any broken side for both fighters, as
   FV's 0x28A74 does for the loser after the break. This is every round
   now, not only the KO's.
3. **The ring out.** `ring_out_step` takes a side mask: on VF2's stages
   all four sides, on FV's the broken ones. FV's floor goes on outside
   the cage at y 0, so there is no drop: the 18 frames after the root
   crosses stage_x give w0 bit 5 as VF2's do, and "RING OUT" and the
   round go as now. FV's outside segments (`finish_coli_hit`) would stop
   a fighter at the scenery first. Stage 6 (the elevator) has none, so a
   fighter there falls down the shaft.
4. **Finish kinds for everyone.** The guests' converter keeps op 4's
   byte +0xE. StF's own op 4 is 18 bytes and its byte +0xE isn't read as
   a finish, so the kinds go into a table by motion (one byte each).
   StF's fighters, Akira and Ryo get kinds there too: kind 3 for their
   KO blows of 30 damage or more, as on the web, or hand-picked. The test
   in 0x264E4 (+0x7D6 on a KO) reads the table.
5. **The pieces** come as the arena does. A second break on another side
   in a later round sets up that side's pieces again. FV only ever sets
   up one side's.

Mahler adds nothing of his own here: his kind-3 motions come with his
setups, like everyone else's.
