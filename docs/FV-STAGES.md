# Fighting Vipers' stages, for the board

This page is what an import of Fighting Vipers' (FV's) arenas onto Megamix's
board needs to know: what each stage draws, what it needs in the data ROMs, and
what it does that StF's stage code has no field for. The cage break, FV's
finishing blow through a wall, is under Cage break.
`tools/stages/fv-stages.mjs` gives the plan (`fvStagePlan`), in the shape
`tools/stages/vf2-stages.mjs` has for VF2's:

    node tools/stages/fv-stages.mjs [--json out.json]   (reads $ROMS_DIR's fvipers.zip)

The figures below are its output. FV's stage code and data are read through
noclip (`vendor/noclip/js`: `stages.js`, `display.js`, `fvstages.js`,
`fvobjects.js`). FV has no symbols; names are StF's (stfdisasm), matched by
structure.

## The stage record

FV keeps its stage records in the XTRA window: `stage_data` at 0x06CE1048,
0x100 bytes a slot. The arenas are slots 0, 1, 2, 3, 5, 6, 7 and 8. Slot 4 is a
copy, 9 is Western 2, the rest are name entry and unnamed records. The
record is laid out as StF's (`js/stages.js` fields), with these differences:

- **Lists are flat.** Every model is in world space and drawn at the identity;
  `area_clip` culls it. StF's lists carry a matrix per model. The bake can give
  each draw the identity scaled by FV_SCALE (below) and StF's 1/1.6.
- **The cage list** at +0x84 is 24 words: three groups of eight panels. The
  group is the wall's damage state. `cage_clip_m` (FV 0x22398) picks it by the
  wall's hit timer; `cage_display` is at 0x221A8. In every arena the three
  groups name the same models in the ROM, so the board can keep one group
  and still port the index.
- **Flags** (bit numbers): 0x10 turning, 0x11 rail, 0x12 poles, 0x13 four
  panels a wall, 0x14 cage top (model at +0x20), 0x15 two panels, 0x16 one
  panel, 0x0B no upper list, 0x0D no ground list, 0x0E extra list. StF's
  `cage_clip_m` tests 0x13, 0x15, 0x16 and 0x1D; FV adds the top, the poles
  and the rail.
- **Materials** come from a per-stage table in the XTRA bank (pointers at
  0x06CE33A4 + slot × 4), not StF's 0x909E0. Same packing: diffuse bits 0-7,
  ambient 8-15.
- **Background**: 0x8000 on every arena. No arena has colour cycles.

## Size

FV draws its world at about half StF's size. FV's Sonic stands 1.309 and StF's
2.676 at the top of their stances (`js/fighters.js`, frame 1), so
FV_SCALE = 2.676 / 1.309 = 2.04. That is within 1% of `vf2-guest.mjs` SCALE
(2.03), which sized Akira against FV's Bahn and Sonic. An FV stage scaled by it
puts StF's fighters in it at FV's fighters' size.

FV's ring is 5.0 to a side (half width): MAME reads 5.0 at 0x50A00C from
boot on, through the attract and a fight on Western. Scaled, that is 10.2 in
StF's units, so the board's stage_x for an FV stage is 10.2, not StF's 8.0.
`area_coli` (op 0x70) reads it, so the walls move with it. The cage, the
poles and the rail are modelled at 6.0 and drawn at stage_x: cage_display
(0x221E4) and pole_disp (0x22ED8) push scale (stage_x / 6, 1, stage_x / 6)
over the panels' and poles' six-unit push, and sub_24294 pushes the rail out
stage_x, then scale (stage_x / 6, cage_height / 3.1, 1) (cage_height,
0x50027C, is 3.1). Forcing 6.0 in MAME moves FV's fence out. The platform
is scaled the same way except on Western (stages 0 and 4, sub_235BC).

## The arenas

| Slot | Arena | Draws (moving) | Models | Faces | Mesh | Colour bases | Tiles | Tex set | Colour set |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Western | 80 (35) | 48 | 1050 | 43 KB | 80 | 878 | 20 | 1 |
| 1 | Factory | 93 (5) | 66 | 891 | 37 KB | 49 | 894 | 19 | 0 |
| 2 | UFO Diner | 120 (33) | 74 | 693 | 30 KB | 74 | 1177 | 23 | 4 |
| 3 | Airport | 52 (13) | 35 | 1087 | 44 KB | 44 | 768 | 21 | 2 |
| 5 | Bay Side | 27 (0) | 26 | 474 | 20 KB | 18 | 763 | 24 | 5 |
| 6 | City Hall Elevator | 182 (160) | 53 | 671 | 28 KB | 37 | 798 | 22 | 3 |
| 7 | Observation Deck | 20 (17) | 50 | 2223 | 89 KB | 38 | 529 | 27 | 8 |
| 8 | Tower | 27 (12) | 19 | 586 | 24 KB | 37 | 518 | 26 | 7 |

All eight: 361 models, 7398 faces, 303 KB of mesh, 287 colour bases, 1210
tiles of 32×32. "Models" counts every model a stage can draw: its lists, its
objects' models and flipbooks, the cage groups, the hall's, and the cage
break's pieces (`CAGE_PIECES`). No arena model
points its texture header into texture RAM.

Per arena:

- **Western** (flags 0x172000: no ground, turning, rail, poles, top). Cage
  1040-1047, top 1801, pole 862. The town turns around the ring. Object
  0x6C49C is the bear, which hops when a wall breaks (Cage break). The light
  turns with the town, 10 units of heading a frame (`lightAt`).
- **Factory** (0x40000: poles). Cage 1032-1039, pole 475. Objects 0x6B260,
  0x6B4F4.
- **UFO Diner** (0x20000: rail). Cage 2696-2703. Five object routines
  (0x6D0C4, 0x6D2FC, 0x6D6E4, 0x6DAC0, 0x6E3F8): cars and their headlights.
  `lightAt` and `materialsAt` (material 26 changes with the headlights).
- **Airport** (0x1084800: no upper, extra, four panels). Cage 1381-1384.
  Objects 0x6B7BC (twice), 0x6C198.
- **Bay Side** (0x442800: no upper, no ground, poles, one panel). Cage
  2641-2644, pole 2647. Object 0x6CAF8. The light turns with the camera's
  heading (`lightFromHeading`).
- **City Hall Elevator** (0x28C4008: extra, poles, four panels). Cage
  428-435, pole 756. Object 0x6C67C. The ring rides an elevator: 132 upper
  draws scroll past (`elevator`).
- **Observation Deck** (0x244000: extra, poles, two panels). A hall: the
  platform, poles, cage and dark cage come from `st.hall`. Object 0x6CCE0.
  Its corners are lit (`lightAt`) and its colorxlat changes (`cxlatAt`).
  The heaviest arena: 2223 faces.
- **Tower** (0x244000: extra, poles, two panels). Cage 1386-1389, pole 1397.
  Objects 0x6CF38, 0x6E908.

The hooks are `fvStageHooks` (`js/fvstages.js`); the objects are
`js/fvobjects.js`. StF's stage code has none of them: each is a small
per-frame routine the board would port, as it ported StF's sea and aurora.

## Textures

Each arena loads one texture set (`st.texSets.at(-1)`), and FV's boot loads
set 36. The sets' pages, as sheet/slot (slot as in
`m2_tex_codec.h` and `vf2-stages.mjs` slotOf):

- Every arena set fills the same 20 pages: sheet 0 slots 12-23 and sheet 1
  slots 16-23.
- Set 36 fills sheet 1 slots 12-15.

The arenas' models read only from sheet 0 slots 12-23 and sheet 1 slots
12-23: 11 to 19 pages an arena (`node tools/stages/fv-stages.mjs` prints the tiles used
a page). UFO Diner reads sheet 0 slots 12-14, and a few tiles on Bay Side and
City Hall Elevator sit on sheet 1 slots 12-15 (set 36's). An earlier
`modelNeeds` read past a model's last face and counted tiles on sheet 1 slots
1-5 and 9; no model uses them.

On the board, StF's set 1 holds the fighters' sheet. So, as VF2's stages do,
an import repacks each arena's pages onto the stages' sheet. FV's arenas need
more pages than VF2's two: up to 21. Only the used tiles need carrying, so a
repack by tile, not by page, may be needed to fit.

## Colours

Each arena names a colour set (record +0x0E, `send_tex_col_stage`'s block),
and its models' texture headers name colour bases (th3 >> 6): 18 to 80 an
arena, 287 over all eight. These are FV's palette, so they need a remap into
StF's colour RAM, as Akira's were (docs/BOARD.md, The guest: VF2's Akira).

## Model ids

FV's model numbers overlap StF's. As for the guests, the import allocates the
arena models ids downward from `R.modelCount - 1`, skipping `R.models` and the
earlier guests' ids, and the bake writes those ids into `stage_t` and
`stage_draw_t`.

## Cage break

A finishing blow of kind 3 sends the loser through a wall. The wall's side
stops being drawn, its pieces fly and bounce, the loser lands against the
scenery outside, and the camera turns to follow. Stage numbers here are the
record slots above. Read from FV's code, except where marked MAME: a shared
build in the attract fight with a kind-3 KO forced (a Lua tap sets both
fighters' +0x874 to 3 and drops a fighter's life to 1 past |x| or |z| 5),
which broke the +x side.

The PS2 Sega Ages port of FV has C for the main routines, with names from the
arcade: `~/source/repos/ai/m2-hle2/vendor/ages-c`, `decomp/FV/FN/INDEX.md`,
`fn/area_coli.h` (`colig_ac_finish`, `colig_ac_wall_hit`,
`colig_ac_stage_walls`), `fn/finish_wall_calc_pos.h` and
`fn/finish_coli_pos_get.h`. They are the port's starting point.

### finish_wall_flag (0x574004, u32)

| Bits | Meaning |
|---|---|
| 0-3 | The broken side: 0 +z, 1 −x, 2 −z, 3 +x. `finish_wall_calc_pos` (0x7B694) picks it from the loser's \|x\| against \|z\|. |
| 23 | The loser hit an outside segment. `kuma_int` (0x6C334, Western's bear) reads and clears it. |
| 24 | First frame: the next frame runs 0x7B790 (collects the segments the loser can cross, count 0x574014, bytes 0x574018), not 0x7B8FC. |
| 25 | Landing sound held off; timer 0x574008, 6 frames. |
| 26 | Set for finish kind 1; nothing reads it. |
| 27 | Segment tests on. Cleared once a segment is hit (0x7BC28). |
| 28 | The cage is broken. |
| 29 | Set up the pieces this frame. Cleared the same frame. |
| 30, 31 | The loser is player 1, player 2. |

Beside it: 0x574000, the place along the wall (for side 3, −z); 0x57400C/10,
the loser's last x, z; 0x5740AC, the segment hit. MAME, from the break:
0x99000008, 0x98000008, 0x9A000008 (a landing), 0x92800008 (segment hit),
then bit 25 toggling, and 0 at the next demo.

StF's include.s names 0x574004 and 0x574014 too (`finish_wall_flag`,
`finish_coli_num`), but StF uses that RAM for `ring_tobitiri`. The board
needs new RAM for them.

### The trigger

- The finish kind is the attacker's +0x874, from byte +0xE of the motion
  script's setup op 4. Kind 3 is the cage break; 51 motions set it (346,
  349, 355, 356, 413, 414, 497, 569, 570, 600, 602, 605-610, 639, 652,
  675-677, 680, 709, 727, 786, 820-831, 851, 852, 854, 866-868, 934, 980,
  981, 984, 985, 1003, 1010).
- The hit routine (0x264E4): if the blow takes the defender's life (+0x1AC)
  to 0 or below and the attacker's kind is not 0, the attacker's +0x7D6 is
  set to 1 and the score gets 500 (0x29040).
- Knockback: table 0x29314 (8 bytes a kind) scales the defender's +0x5E4 and
  +0x5E0. Kind 0 (1, 1), 1 (1.75, 1.5), 2 (2, 1), 3 (1.5, 2.25; the second
  3.0 with +0x7D6 set), 4 (2.75, 2). A +0x843 == 3 strike scales by 3.7.
- The test is in `area_coli` (0x28750), at 0x288CC. `coli_cont_cop`
  (0x27E18) calls it for each fighter (g7) with the other as g8. It breaks
  the wall when all hold:
  - no hitstop (+0xA0E == 0) and flag bit 28 clear;
  - the other fighter has +0x7D6 bit 0 and kind 3;
  - g7 is reacting (+0x1A4 bit 4 set, bit 16 clear, motion not 0x31E);
  - the wall pushes it (+0x644 x or +0x64C z not 0);
  - `Fn_atan`(|v along the wall|, |v into the wall|) > 0x1000, 22.5°.
    Shallower, the wall bounces it instead (the into-wall speed negated).

  Any KO by a kind-3 blow breaks the wall, in any round.
- On a break the push is cleared; the flag gets bits 27, 28, 29 and the
  loser's; `finish_wall_calc_pos` runs and sets bit 24; 0x57400C/10 come
  from `finish_coli_pos_get` (0x7B73C).
- The cage's height for the test is 0x50027C − 0.19, plus 10 unless the
  other fighter has +0x7D6 (or g7 +0x720 bit 9): a KO'd fighter can clear
  the top too.
- After the break, 0x28A74 clears the loser's push every frame, so it flies
  on through the wall (MAME: x 4.8 to 15.9 at 0.308 a frame). On stages with
  u32 0x28F80[stage] not 0 (all but 7 and 8), the winner's push toward the
  broken side is cleared as well (table 0x29000, {bit, x, z} for each side).
  StF's wall splat (`kabe_hit` 0x24B18/0x24C20, `kabe_parts_damage`
  0x273F4) does not fire, since there is no push.

### The wall and its pieces

- `cage_display` (0x221A8) skips the broken side's `cage_clip_m`. Bay Side's
  cage is `boss_cage` (0x22668): models 0xA51-0xA54 (table 0x22900), and
  0xBBB on side 1. The shadow code tests flag & 15 too (0x5FA38, 0x6031C,
  0x60434, 0x7696C, 0x76A60), and the flying armour (0x2D078) passes through
  the broken side.
- With bit 29 set, `cage_display` calls 0x78888, which jumps through
  0x798A8[stage] (0x79A10 for stage 1 … 0x79FF0 for stage 4) to set the
  pieces up. It plays the break sound 0xAE1152 (stage 6: 0xAE1113) through
  0x41FA4 and 0x41EA4.
- Pieces: records from 0x57411C, 0x88 bytes each (stage 6: 0x78); +0x60
  position, +0x6C speed, +0x78 spin axis, +0x84 bit 0 skip. Piece i's turn
  is kept in matrix slot 9·i. Random numbers: 66 floats at 0x798E8, by
  rand (0x6DC8) & 63.

| Stage | Pieces | Models | Notes |
|---|---|---|---|
| 0 (and 4) | 17 | 0xA90 | at x = 2i/3 − 6, y 1.5, z 6; v = (r.x, 3 r.y + 0.2, r.z + 0.07) |
| 1 | 24 + 4 + 1 | 0xA85, 0x14F4, 0x1523 | MAME: piece 0 from (−5.25, 1.3, 6.0), v (0.029, 0.313, 0.052) |
| 2 | 4 + 3 | 0xAAA, 0x14F6 | |
| 3 | 5 | 0x14F5 | |
| 5 | 4 + 7 | 0xA96, 0xA95 | |
| 6 | 50 shards | 0xA97, scaled ×3 | own physics, no floor: they fall for ever down the shaft |
| 7, 8 | rope fence | 0xA92, 0xA93 | tables 0x797D8, 0x79718; `line_disp` (0x7AB24), 5 strands a half |

- The rope fence (7, 8): for frames 1-14 the loser is slowed by v/15; at
  frame 15 its speed is 0 and vy 0.2, with a spring of −depth/225 (on a
  sign change ×−0.7, and v ×0.4). It is held until frame 25, then thrown
  back into the ring.
- Each frame 0x799F0 runs 0x7B210[stage], which calls `cage_break_calc`
  (0x7B27C): gravity 0x50A000 (0.0052222 a frame; MAME agrees), floor y 0
  tested at corner points (count 0x5740B0, list 0x5740BC), bounce 0.2 with a
  new spin. Pieces never expire. Landing sound 0x7B250[stage] (0xAE116A;
  stage 2 0xAE112A, stage 5 0xAE1105) when vy ≤ −0.04 and bit 25 is clear.

### Outside segments

`finish_coli_hit` (0x7B8FC) tests the loser's path against the scenery
outside the ring. u32 0x6443F1C[stage] points at a count and then
{x0, z0, dx, dz} floats:

| Stage | Segments | List |
|---|---|---|
| 0 (and 4) | 24 | 0x6444030 |
| 1 | 13 | 0x6443F5C |
| 2 | 11 | 0x644422C |
| 3 | 7 | 0x64441B4 |
| 5 | 4 (a square, ±18) | 0x64442E0 |
| 7 | 16 | 0x6444328 |
| 6, 8 | 0 | |

UFO Diner first tests the truck's 8 segments at 0x57402C, which the trailer
routines fill (0x6D67C, 0x6D6CC, 0x6D948, 0x6D998, 0x6DFBC, 0x6E230).
Western rotates its segments by the town's turn (0x7BCB8, 0x50A022).
Observation Deck goes to 0x7BC40: vy is negated at y ≥ 4 and the loser is
turned back inside radius 23.

### The fighters

- The loser keeps its knockback (motion 589 in MAME) and gravity, and flies
  through the open side. At a segment, `finish_coli_hit` pulls it back by
  the overshoot, sets +0x2C/+0x34 to a unit vector from `Fn_atan` of it,
  +0x30 to 0.2, and command +0x198 to 0x2200031E: motion 0x31E (798), the
  wall splat, which stops it the next frame. MAME: about 50 frames later it
  lies at (14.0, 0.3, −0.83).
- The winner plays its finishing motion (652 in MAME), then stands (21).

### The camera

- At the break the camera (0x500814) takes mode 0x1A (0x6A958) unless
  0x500030 is 0xF. Mode 0x1A keeps the eye and turns the yaw a quarter of
  the way toward the loser each frame. There is no slow motion. MAME: mode
  26 for the whole KO. While bit 28 is set, `camera_control` (0x1EBC0) also
  runs the fighter pass 0x21C14 (0x1F8F0, 0x1FB3C).
- Replay (game mode only; the demo has none): at the KO (0x35104-0x353C8) a
  kind-3 finish picks a shot 0-3 at random, sets camera +0x400 to 1, and
  leaves out some stages (fallback 0x6AA30). `REPLAY_INT` (0xE3DC) takes the
  mode from u32 0x6CE1024[shot] (0x21, 0x1F, 0x25, 0x28, then 0x1B, 0x14,
  0x1D, 0x2B, 0x23), through `cam_mode_list` (0x6CEBA74, 45 modes) and
  `camera_work` (0x64D98).

| Shot | Modes | Not on stages | Shot |
|---|---|---|---|
| 0 | 0x21, 0x22 | 1 | eye in a corner at height 9.3, counter 300, closing on the loser |
| 1 | 0x1F, 0x20 | 1, 5, 6, 7, 8 | follows the loser at (−1, 1.35, −2) |
| 2 | 0x25, 0x26, 0x27 | 7, 8 | from the side, then round |
| 3 | 0x28, 0x29, 0x2A | 1, 3, 6, 7, 8 | tracks it out; +0x3FE on stages 0, 4, 5 |

- The recorder (0x3BD48) keeps 282 records of 0x98 bytes at 0x535000, with
  the flag at +0x40 and 0x50A022 at +0x44. Playback (0x3C348, 0x3C604)
  puts the flag back each frame, so the pieces fly again in the replay; mode
  0x1A is not forced there. `REPLAY_INT` sets camera mode 3, +0x3E4 to the
  flag, the flag to 0 and `replay_countdown` (0x500092) to 640. The slow
  motion at 0xE674-0xE6D4 is dead code (`b 0xe6dc` at 0xE670).
- The flag is cleared at `SET_INT` (0xC800), at the end of `REPLAY_DSP`
  (0xE890), and at 0x8688, 0xA088 and 0xA9E0. With bit 28 clear the wall is
  whole again and the pieces stop; nothing else needs resetting.

### What the board needs

The board has StF's camera and fight but no round-end or replay modes
(docs/BOARD.md, Where it stands). For the break:

- Tables: 0x29314 (knockback), 0x28F80 and 0x29000 (the winner's push),
  0x798A8, 0x7B210, 0x7B250 and 0x798E8 (pieces), 0x22900 (Bay Side's
  cage), 0x797D8 and 0x79718 (rope), 0x6443F1C and its lists (segments),
  0x6CE1024 (replay shots), and the finish kind in each motion's setup op 4.
- Routines: the test at 0x288CC-0x28AA8 and the push clear at 0x28A74;
  0x7B694 and 0x7B73C; 0x7B790 and 0x7B8FC (with 0x7BCB8, 0x7BC40); 0x78888
  and the per-stage set-ups; 0x7B27C; 0x7AB24 for the ropes; the side skip
  in `cage_display`; the kind multipliers in 0x264E4 and 0x26840; camera mode
  0x1A, then the replay shots once the board has a replay.
- The piece models (0xA85-0xAAA, 0x14F4-0x14F6, 0x1523) are not in the
  arena lists; `tools/stages/fv-stages.mjs` adds them to each stage's models
  (`CAGE_PIECES`).
- StF's motions have no finish kinds; StF's fighters on an FV arena need
  kind-3 moves picked for them.

## Next steps for an importer

Western is on the board (docs/BOARD.md, FV's Western): steps 1-5 below are
done for it, and its turn, light, cage culling and bear (without the hop).

1. Pick the arenas and their stage slots on the board.
2. Allocate model ids; copy meshes and texture headers (`modelNeeds`).
3. Repack the textures onto the stages' sheet; remap the colour bases.
4. Bake `stage_t`/`stage_draw_t`: identity × FV_SCALE / 1.6 per draw, the
   cage panels' ends for 4/2/1 panels a wall, poles, top and rail.
5. Set stage_x 10.2 for FV arenas; scale the cage, poles and rail by 5/6.
6. Port the hooks and object routines arena by arena; Factory or Tower
   next (few moving parts).
7. Port the cage break (above): camera mode 0x1A first, the replay later.
8. FV's skies: `fvSkyPlan` bakes each board arena's (docs/BOARD.md, FV's
   Western); another arena needs only its slot in `FV_BOARD_SLOTS`, its
   blocks free on the board, and its own sky routines (record +0x04, +0x08)
   looked at.
