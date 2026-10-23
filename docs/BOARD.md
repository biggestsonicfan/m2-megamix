# The board build

`board/` is Fighters Megamix as a new program for the Sonic the Fighters board
(Model 2B, MAME `sfight`), built on [m2-sdk](../../m2-sdk). It replaces the
two program EPROMs (epr-19001/19002) and nothing else. It is not a patch of
Sonic the Fighters: StF's program is the map (its disassembly, its symbols in
`stf-fly/data/symbols.json`, and Sega's own C for its hot functions in
`m2-hle2/vendor/gems-c`). The data ROMs are StF's file names and layout, but
hold only the assets the board uses (see "The data ROMs" below).

The aim: a versus-only fighter (two players, no CPU) with fighters and a few
stages from each of the three games, as in the browser game.

## Building and running

```sh
node tools/bake-board.mjs                       # board/src/poses.h, from $ROMS_DIR's zips
python3 tools/lift-stf.py                       # board/src/stf_motion.{s,h}, stf_rom_c0000.bin
node tools/import-assets.mjs                    # board/roms/sfight/'s data ROMs, from $ROMS_DIR's sfight.zip
cmake -G "Unix Makefiles" -B <build> -S board   # m2-sdk beside this checkout
make -C <build> -j2                             # -> board/roms/sfight/epr-19001.15, epr-19002.16
mame sfight -rompath board/roms
```

MAME reports wrong checksums for every ROM of the set; that is expected.
`M2_HLE_GEO_OFF=1` in the environment runs MAME's real geometrizer program
instead of its HLE; both draw the same picture.

`poses.h`, `stf_motion.s`, `stf_rom_c0000.bin` and `roms/` hold Sega's code
and data and are not in git.

`board/src/stf_tex_codec.h` is the SDK's `m2_tex_codec.h` with a bigger
table B (2048 entries, not 512): StF's stage sets need up to 1178, and the
SDK's size drops six of their pages. It keeps the SDK's include guard and is
included in place of it; the SDK itself is used unchanged.

## The data ROMs

`tools/import-assets.mjs` writes `board/roms/sfight/`'s data ROMs: each starts
zero-filled and gets only what the board reads, at StF's own address, so StF's
pointers, its program-ROM tables and the code lifted from it find everything
where it always was. From StF it takes the luma ramp, the polygon palette, the
model-table entries, meshes and texture streams of every model the board draws
(the stages in `poses.h`, and every part StF's code can put on the cast:
the character records' lists, the hand, foot and body swaps and the head
lists), the texture codec's table, the fighters' and stages' texture sets,
the stages' colour blocks, all 519 motions (the lifted reaction code picks
them from tables of its own), the HUD's scroll tiles and patterns, and from
the coprocessor's data ROM the sine and cosine tables StF's coprocessor
firmware (cpres1, which the SDK boots) reads. The sound program, the samples
and the billboard's program (`segabill`'s epr-18022) are zeros: the board
never reads them. Of 53 MB of data it keeps about 4 MB;
`board/roms/assets.txt` lists every run it kept, by region, address and
reason.

The sets in `$ROMS_DIR` are read only by this import (and the bake): the board
runs on `board/roms` alone. Other games' fighters go into the space StF's leave
free (next section).

A run with the stripped ROMs draws the same frames as one with StF's full set
(the same inputs, a snapshot every 40 frames through all 18 pairings on both
stages), and a read trace of the board finds no word it reads that the import
left out.

## How a fighter is drawn

The motions are StF's own code. `tools/lift-stf.py` lifts StF's motion
routines out of its disassembly (`biggestsonicfan/stfdisasm`,
`rom_code1.asm` with `include.s`) as i960 assembly, `board/src/stf_motion.s`:
`set_motion`, `calc_rob_angle` (the frame's angles from the motion's curves,
`get_frame_dat`, `smooth_int`'s blends), `calc_unit_mat` (the sixteen part
matrices, built on the coprocessor's stack and stored in its slots with op
0x35, with the dent pendulums and part scales) and `sub_7F0E8` (each
character's pendulum constants), with every routine and table they reach.
StF's work RAM they use becomes `.bss` blocks of the board's; StF's ROM tables
at 0xC0000..0xFFFFF (the character records, skeletons, motion lists) are
copied raw to the same addresses (`.stfrom`). Collision routines are stubbed.
The coprocessor runs StF's own firmware (m2-sdk's default), so the ops are
the ones StF sends. The code uses the i960's own floating point, as StF does:
fine on MAME and a real board (not on a soft-float i960).

`board/src/stf_call.s` calls a lifted routine with StF's registers (g7 the
fighter, g8 the other one, g10..g12 the RAM and FIFO bases, g14 0). A fighter
is StF's rob structure (0x3400 bytes) and its motion record, set up as a
round's start sets them (the character records at +0x190/+0x1A0, the dent
pendulums, the countdown at +0x219C). `rob_step` is one 60 Hz frame of
`action_init`'s motion part and `play_motion`'s head: the frame on by one,
the next motion or a `smooth_int` blend back past the end, then
`calc_rob_angle` and `calc_unit_mat`. `draw_fighter` is `rob_disp`: under the
camera, each part's slot (op 0x37) after a scale of (1, y, 1), drawn with op
0x78. A fighter at yaw a faces (-sin a, cos a) in x, z.

Checked against real StF (MAME `sfight`, a 2P round, Sonic vs Sonic): at the
same frame of the stance motion (278), all sixteen part positions in the rob
(+0x1F4) match the real board's to the last digit printed, frames 39, 41 and
79 (the second loop).

- Textures: StF texture set 1 (the fighters) and the stage's set are loaded
  by `tex_load_set`, StF's loader: each page goes to the bank its own origin
  names, and a page whose first word is nonzero is a raw page, sent as it is
  (`send_beta_data`); the rest go through the SDK's decoder. Texture RAM then
  matches StF's own, word for word.
- Colours: `m2_load_model_palette` copies each part's colour bases from the
  polygon palette ROM. The colour translation RAM (`0x01810000`) is what turns
  them into RGB, row by row: `bake-board.mjs` bakes runs of it with the browser
  game's `colors.js` (`buildColorxlat`). A stage's run is rows 0..27 with its
  colour set and tint; a fighter's are its part rows (0..4, luma 48..63) and
  skin rows (28..29) for player 1, and 7..11 and 30..31 for player 2.
- Player 2: StF writes palette RAM once, at boot, so a colour base names the
  same rows whichever side draws it. Player 2 is set apart by its own models:
  character c's player 2 is character c + 26 (Sonic 26, Honey 41, Eggman 34),
  whose parts line up one for one with c's and carry their own colour bases.
  Honey's player 2 has blonde hair and a blue dress, Sonic's names part row 7
  and draws dark grey, and Eggman's are the same models as player 1's. Each
  part's `p2` in `poses.h` is that model.
  Honey's white spikes are her lace barrettes. They use colour base 28
  (row 27, grey) on both sides, so they are meant to draw white.
- Eyes: Sonic's and Honey's eyes are two models drawn on the head's matrix.
  StF's `rob_disp_rdn_loop` (Sega's C in `m2-hle2/vendor/gems-c`) draws them
  right after the head with `set_obj_tpd`, on the same matrix, with no turn
  or offset of their own. The texture points it passes come from the face
  record (`0xC533C` table, +0x10 and +0x14). For Sonic (eyes 217, 218; player 2's
  665, 666) and Honey (3520, 3521; 2735, 2736) those points are the same,
  byte for byte, as the eye models' own, so drawing the models as they are
  is what StF draws. A MAME snapshot of board Sonic in stance beside real StF's
  Sonic at round start shows the same eyes: a white patch over the face
  with the pupil at its front edge.
- Sky and backdrop: the sky is the stage's backdrop ring (`doom_cnt`, the
  record's four models at +0xC0), which the baked draw list already holds.
  Behind it is the record's `stage_bg_color` (+0x16, BGR555). StF's
  `scr_bg_int` passes it to `change_bg_color`, which writes it to pen 0x801
  and fills a tile layer with a solid tile of that pen, and to `bg_col_set`,
  which writes it to pen 0 of palette banks 0..63. `m2_backdrop` does the
  same on the board's own layer, so `load_stage` calls it with the record's
  colour. A palette colour shows each component through colorxlat row c at
  luma 0x40 (MAME's `palette_w`), so the board also writes StF's flat band
  there at boot (`flat_cx`); the SDK's ramp would show it far too bright.
  Real StF and board snapshots show the same pixels: (0, 0, 188) on South
  Island (0xF0C0) and (213, 38, 0) on Dynamite Plant (0x017F).
- Light: `change_scene` copies the stage record's `stage_bright` (+0x04,
  float) and `stage_vecter_x`/`_y` (+0x08, +0x0A, angles) to `BRIGHT` and
  `VECTER_X`/`_Y`. Every frame `camera_init` builds the light on the
  coprocessor: identity, the camera's turn (`ang_z`, `ang_x`, `ang_y` by the
  negated camera angles), then `ang_y` by `VECTER_Y`, `ang_x` by `VECTER_X`
  and op 0x29 on (0, 0, `BRIGHT`). It keeps the result at `0x50108C` and sends
  it to the geometrizer (slot 0xA0) before the stage. Each fighter gets the
  same vector times its `rob_light` (1.0 except in a hit flash, at
  `0x5010AC`/`0x5010B8`). The light is in the camera's frame, so it is fixed in
  the world. In real StF on South Island, 17 samples of the light it sends,
  taken while the camera moved, fit `Rcam · Ry(VECTER_Y) · Rx(VECTER_X) ·
  (0, 0, BRIGHT)` to within 6e-6. The board does the same with the same
  coprocessor ops on StF's camera (`stage_light`, every frame, as the
  camera turns) and sends it after `m2_obj_frame_setup`, whose fixed light is one frame of
  South Island's. The floors and skies are unlit (their light is in the
  texture); posts, ropes, cage, cliffs and fighters are lit. Check: board
  builds with real StF's camera at one frame (identity, the turns, `set_pos`
  by the negated eye, scaled by the bake's 1/1.6) line up with real StF's
  snapshot. On South Island the blue post's faces then show real StF's own
  colours ((30, 30, 238), (17, 17, 192), (2, 2, 144); with the old light 1 of
  663 overlapping pixels matched), and 95% of the red rope's overlapping
  pixels are identical (64% with the old light).
- Colour cycling: once a frame, out of `interrupt_wait_b` (after the wait
  for the vsync), StF's `sub_2435C` walks the stage record's list at +0xB8:
  (colorxlat row, shift) pairs ending in a zero row. For each one,
  `sub_243AC` refills that row's palette slots (luma 48..63, all three
  channels) from the stage colour block in the data ROM (the pointer at
  `0x2101010`, + colour set × 0x540 + (row − 14) × 0x60, 0x20 a channel):
  slot i takes colour `((frame_counter >> shift) + i) & 15`, through
  `ARRAY_NUM_RED/GREEN/BLUE`, the curve `make_lay_col_256_tbl`
  (`color_intensity`) builds from TST_*_ADD/MUL and the stage's trims.
  South Island and Canyon Cruise list rows 18 (shift 2) and 19 (shift 0),
  the waterfall and the shoreline; Casino Night lists 14, 16 and 19 (shift
  1); the other six have no list. `frame_counter` counts StF's 60 Hz loop,
  one per frame in a fight. The board bakes each stage's list, colour set
  and trims, builds the curve in integers on stage load, and rotates the
  rows after each vsync. Its counter follows the vblank count (`frameVBL`),
  because its own loop runs slower than 30 fps. Bit 5 of
  `debug_flag` (`0x508000`) skips `sub_2435C`, so a debug-mode StF shows
  the water standing still. Check: with the board's counter held at the
  value real StF logged, colorxlat rows 14, 16, 18 and 19 (luma 48..63, R,
  G, B) are the same word for word on South Island (counts 1144..1152),
  Canyon Cruise and Casino Night (1235..1435). Throwaway board builds with
  real StF's camera at two South Island frames (no fighters drawn) beside
  real snapshots, both 496×384: of the pixels where both show the
  waterfall, 14,167 of 14,170 (count 1135) and 24,358 of 24,364 (count
  2335) are identical. Over 8 counts the waterfall's band moves on by 8
  slots, e.g. (161, 178, 213) to (101, 144, 213) and (188, 196, 213) to
  (126, 161, 213).
- Sea and aurora: these are not colour cycles. Each frame StF queues
  requests with `move_tpd_req` (at `0x5019BC`). It returns where the data
  will land, `0x805000` (texture RAM word 0x5000, bit 23), and
  `move_tpd_send` sends it there with GEO op 4. Then a model is drawn
  with one word of its header replaced: `set_obj_tpd` replaces word 0,
  the texture points, and `set_obj_thd` replaces word 1, the texture
  header.
  - South Island's sea: `camera_init` calls `send_st01_sea_thd` (stage_num
    0, 13 and 14; 15 has its own). It queues the 12 headers at `0xAF678`
    through `transmap_change`, which sends each one's four words with the
    second word replaced by `((frame_counter >> 1) & 63) + 7`, the luma
    base. `ground_disp` then draws the sea plate (model 555) with
    `set_obj_thd`.
  - Aurora Icefield's aurora: `aurora_init` queues the 36 (v, u) points
    at `0x758FC` through `tpd_move`, which sends each as two 32-bit words,
    with v + `((0 - frame_counter) << 2) & 0x7FF`. `aurora_disp` draws
    model 1604 with `set_obj_tpd`.
  
  The bake keeps each block and its model (`stage_t.tpd`). The board's
  `move_tpd_send` sends it after the light and swaps the word in
  `draw_stage`.

  Check: throwaway board builds with real StF's camera from its intro
  fly-in (no fighters drawn), with the counter held at the value real StF
  used, beside real snapshots, both 496×384. The real captures have every
  tile layer off, so StF's HUD is not drawn: a write tap sets each layer's
  disable bit (bit 15 of its vscroll word, tile RAM words 0x5004..0x5007).
  - South Island's sea: 8,940 of 9,906 sea pixels are identical (luma band
    46). One band on, only 4,829 are. At a second frame, 14,698 of 16,317
    match (band 49), against 6,716 one band on. The pixels that differ are
    scattered one-texel steps where the camera grazes the plane far away.
    One band step moves the sea's texels down the band's ramp, e.g. (38,
    170, 213) to (48, 161, 196), (48, 161, 196) to (30, 161, 196) and
    (21, 161, 213) to (13, 144, 213). That changes 5,672 of 9,906 sea
    pixels.
  - Aurora Icefield's aurora: of the pixels that change with the counter,
    32,680 of 32,971 are identical (count 827) and 29,853 of 30,009 (count
    851). Eight counts either side, only about 6,500 and 5,900 are. Eight
    counts slide the texture points 32 v units, which moves the bands
    along: (0, 0, 30) to (0, 0, 13), (0, 0, 48) to (0, 0, 30), and (0, 21,
    73) to (0, 0, 48).

  From the board's fixed camera the sea is out of view, and so is the
  aurora: it is only seen in StF's intro fly-in.
- Cage walls: StF tests each cage panel before it draws it.
  `cage_clip_m` takes the panel's two ends, (x, 0, 6) in the wall's frame
  for x from a table at `0x24C80` (8 panels a wall), `0x24CA4` (4),
  `0x24CB8` (2), `0x24CC4` (3) or `0x24CD4` (1), chosen by stage flags
  0x13, 0x15, 0x1D and 0x16. It moves each end into the camera's frame with
  COP op 0x29. An end gets out-code 0x1F when its Z ≤ 2.0, otherwise bit 0
  when 280·X/Z ≤ −248 and bit 1 when it is ≥ 248. A panel whose two ends
  share a bit is skipped. Besides this, `cage_sub_check` (from
  `camera_init`) marks the walls the camera is inside of (mask at
  `0x500288`). `cage_display` draws those walls, and `cage_disp_f` draws
  the others in a later pass, when camera flag bit 0xE is set. The board
  bakes each panel's two ends (`stage_draw_t.x0`, `x1`). In `draw_stage`
  it sends the panel's matrix and puts both ends through op 0x29 with
  StF's own command word (`0x14802929`). StF's `mulr` and `divr` become
  coprocessor ops 0x15 and 0x16. Its `cmpr` against 2.0, −248 and 248
  becomes an integer test of the result's IEEE bits: sign bit, then
  magnitude against `0x40000000` or `0x43780000`. There is no float maths
  or compare on the i960, and no soft-float call. The board has no
  passes, so it does not port the mask. From inside the ring every wall
  is in it.

  Check: Aurora Icefield from real StF's intro camera (frames 84 and 108
  of the stage, mask 0x0E, all cage panels drawn in the first pass). A read
  tap on models 1125..1127 shows real StF drawing 7 panels: one on side
  1, and three each on sides 2 and 3. The panels of side 0, which the
  camera is just outside of, are culled because their ends are behind the
  near limit. The board drew all 12. Those 3 extra panels (1125, 1126 and
  1127 on side 0) were the large light-blue shape across the middle of the
  picture: 19,290 pixels at frame 84 and 31,918 at frame 108, mostly
  (160, 205, 250) and (169, 202, 250). Only 79 and 12 of them matched real
  StF. With the test, the board's throwaway builds draw the same 7 panels
  as real StF, and none of those pixels is (160, 205, 250) or (169, 202,
  250) at frame 84 (11 at frame 108; real StF has 74 and 350 there). Of those pixels, 16,915 and 25,612 now match real StF. In the
  whole 496×384 frame, 173,142 and 180,153 pixels are identical (156,306
  and 154,553 before).
- Materials: StF's `camera_init` sends the stage's 32 material words (prog
  `0x909E0` + stage slot × 4) as GEO texture parameters every frame, each with
  its coefficient from `flt_90BA0`. `m2_obj_frame_setup` fills all 32 with one
  value, so `send_materials` follows it. Without them the palms and the
  waterfall draw white.
- Camera scale: after the camera's turn and
  its translate by the stage position, StF's `camera_init` sends the
  coprocessor scale op `0x3800707` with 1.6, 1.6, 1.6 (`0x3FCCCCCD` × 3),
  then stores the matrix (`0x21804343`). Every stage matrix StF's display
  list carries is 1.6 times the board's. The board's camera has no scale,
  and its positions are 0.625 times StF's. The picture has the same shape,
  because a uniform scale projects the same. But the geometrizer transforms
  each normal by the object matrix. On the board the normals are 0.625 as
  long, so `dotl` and the diffuse term are 0.625 as large. The light
  vector, mode (1), and material table are word-for-word the same on both
  sides. Only the matrices differ.

  Check: a parse of each side's display list at the Aurora intro's frame
  84, taken when the i960 writes the read start at 0x803008. The side-3
  cage panels (models 1125..1127) have matrix columns of length
  1.333/1.6/1.333 in StF and 0.833/1.0/0.833 on the board. A throwaway
  board sends StF's camera (translate by the unscaled position, then the
  1.6 scale; the light is still built from the camera before the scale,
  so it stays bit-identical). That makes the panel matrices match StF's to
  within 8e-6. Of the 4,963 differing pixels in side 3's 6,801-pixel
  footprint, it fixes 4,725, and 13 others become wrong. Most of the rest
  are where StF's fighters stand. Whole frame, HUD off, no fighters,
  counter held: 179,775 identical pixels at frame 84 and 184,355 at frame
  108 (was 173,142 and 180,153).

  In the board: `camera_place` does the same. The camera's position is in
  StF's units (`CAM_Y` 1.76, `CAM_Z` -7.36, 1.6 times the old 1.1 and
  -4.6), `set_pos` by its negation, then op `0x07` with 1.6 three times;
  `cam_l`, the matrix before the scale, is what `stage_light` turns. Every
  stage and fighter matrix is `cam` times its own, as in StF, where
  `rob_disp` builds the fighters on the stored, scaled camera (op
  `0x2800505`). The stage bakes keep StF's 1/1.6 (`ARENA.stf.scale`): with
  the camera's 1.6 they come out as StF's matrices. The fighter poses are
  not rebaked: the whole camera frame is 1.6 times what it was, which
  projects the same, so the fighters stand where they stood and only
  their normals change (as long as StF's). The cage cull now tests the
  same Z as StF's. Check, the real camera path with StF's intro camera
  in its place (HUD off, no fighters, counter held): the display list at
  frame 84 is byte-for-byte the throwaway's (74 objects, 7 side-3 panels,
  light `BF28A51A,BF22C62B,BECDE87B`), side 3 fixes the same 4,725 of
  4,963 (13 newly wrong), and the frames are 179,775 and 184,355 pixels
  identical to StF's, the throwaway's counts.

## The guest: VF2's Akira

`tools/vf2-guest.mjs` (called by the import) brings in VF2's Akira as StF
character 6, Knuckles' slot (32 for player 2), which Megamix does not use. He
runs on StF's own code like the rest of the cast: everything of his that the
code reads is converted into StF's formats and written into the guest tables
`tools/lift-stf.py` moves out of the program ROM (`GUESTS`, at 0x02E00000),
with a heap after them.

- **Motions:** the ones his actions, his reactions, his command program and
  their setups reach (328), as new motion ids from 519 on. The blocks are in
  StF's format already; their setups are converted op by op (VF2's play ops
  differ in length and number). Play op 5 (set a flag bit) is kept only for
  the bits StF's own motions set: VF2's thrown motions set bit 24, which StF
  never sets and its code turns into a commit of type 0x18.
- **Actions:** all 52 of StF's action slots are given one of his motions
  (`STF_ACTIONS`), so he has his own stance, walks, guards, falls and get-ups;
  none of Knuckles' are left.
- **Reactions:** `sub_2B94C` picks a hit reaction from a list by character
  (StF's 0xDA0B4, now the guest table `ptr_DA0B4`). Akira's is VF2's own: 30
  kinds of hit, each by category, crouch, behind and side. StF's lists ignore
  crouching, so the lift puts in a test of the crouch flag (0x1A4 bit 3) at
  `loc_2B9CC`, which picks the crouching half of the list. Only a fighter
  whose game is not StF's takes it (`char_game`, below).
- **Thrown motions:** a throw's setup (op 5) gives its victim a motion, the
  one after the throw in VF2's numbering, usually. StF's fighters play those
  too, as copies (847..878) scaled to them (×1.07 in height, `THROWN`).
- **Remap:** `motion_remap` (a guest table of the board's own, a list by
  character) gives `set_motion` (`loc_1B044`, a hook the lift puts in) a motion
  to play in place of an id. StF's code still asks for its own ids at times
  (the stance, getting up, a few reactions): for Akira they become his (68 of
  them); for the others, his throws' victim motions become the copies.
- **Command program:** converted op by op. Commits get StF's longer form. His
  native ops (one instruction putting a motion id in g0) become `lda` plus a
  jump to `cmd_native_tail`. VF2's 0x32 is dropped and 0x33 becomes 0x11.
  Op 0x15's script (what a throw runs once it lands, through 0x1228 into the
  command pointer 0x121C) is converted too: left at its VF2 address, it ran
  StF's ROM as commands and the board stopped.
- **Records:** Knuckles' record and actions, with his parts and his actions in
  place of Knuckles'. Also his skeleton, his hand shapes, and a head record
  of one frame.
- **Models:** 95 models (P1 and P2 parts and his hands) under free model ids
  from 5102 down. Their meshes go in the polygon ROM's empty run, and the
  materials, UVs and textures are packed by `tools/pack-akira.mjs`. Colour
  bases whose palette entries differ between the games are moved to a StF
  entry with VF2's colour, or to a free one that is given it.
- **Size:** StF's world is about twice the size of VF2's and Fighting Vipers'.
  Fighting Vipers has a Sonic of its own, so Akira is sized by height against
  it: 71/73 of Bahn (5'11" to 6'1"), scaled from FV's Sonic to StF's. That
  comes to ×2.03 (`SCALE`, with the measurements). The mesh points, the
  skeleton and the motions' float objects (the body's place and the aim and IK
  targets) are scaled, so StF's code poses, steps and hits with him at that
  size. A float object's latched constants (channel types 0..2) are not: they
  are angles the pose code holds. Object 17, the pelvis's roll, is (0, 0,
  16384.0), a quarter turn, in nearly all of VF2's motions. Scaled, it rolled
  his pelvis half a turn: his waist rode high, his legs went straight and wide
  and he leaned forward in his stance.
- **Collision balls:** `rob_coli_ball_table_all_init` (stf_motion.s 125)
  copies a fighter's balls from `rob_coli_ball_types`, now a guest table:
  four lists by skeleton type (rob+0x84C) of 52 records by character. A
  record is four pointers: the balls (32 × x, y, z, r in their part's
  frame), the part each ball rides, the balls by part (ball × 4, 8 bytes a
  part) and the count by part. Types 0 and 1 share one list, type 2 is one
  record every character shares, and type 3's list is used from its second
  half. VF2 has one set for its whole cast (code 0x176A0): 30 balls at
  0x020078A8, a list pointer by part at 0x02007BEE and a count by part at
  0x02007C68, by VF2's part index, which is his StF part index too. The
  importer turns them into a record of his (×`SCALE`) and points characters
  6 and 32 at it in types 0, 1 and 3 (both halves); StF's records and type 2
  are as they were. Checked in MAME and m2-hle2 (Akira against Honey): his
  balls in RAM are VF2's ×2.03 (a 0.26 head, 0.14 fists, in place of
  Knuckles' 0.32 head), the copro's part matrices carry them
  with his body (he pushes Honey back ball to ball, gap about 0, and his
  second and third punches take her from 140 to 128 to 117, the same frames
  and values on both), and Honey's tables are byte for byte StF's record.
- **Damage:** the setup's op 4 (a strike) and op 5 (a throw) carry the
  damage at byte +3, out of VF2's 200 energy; StF's fighters have 140.
  `convertSetup` scales both ×140/200 (`DAMAGE`), rounded, at least 1 where
  VF2's is not 0: 10→7, 12→8, 20→14, a throw's 50→35, 80→56 (the import
  prints the whole list). Only his converted setups change; StF's are
  StF's. At hit time StF's `ketchup` multiplies the setup's number by
  1 + 0.01 × (victim's energy − attacker's), the gap capped at −30 and,
  above, at 50 − (energy_max − victim's energy) / 2, then rounds. So a drop
  is ×140/200 of the old one only up to that rounding. Checked in MAME
  and m2-hle2 (Akira against Honey, the same inputs as before): his two
  punches that land take her 140 → 132 → 125 (8, then 8 × 0.92 = 7), where
  they took 140 → 128 → 117 (12, then 12 × 0.88 = 11). Her punch is her
  own 11 on both builds: thrown first, at even energy, 140 → 129 → 119
  → 110 on the old build and the new.
- **Game:** `char_game` (a guest table of the board's own, at
  `STF_GUEST_char_game`, 0x02E06200) is a byte by character, 52 of them
  (player 2's 26 on): the game the character comes from, `GAME_STF` (0, what
  it starts as), `GAME_VF2` (1) or `GAME_FV` (2). `lift-stf.py` defines the
  values for the lifted code (`.set GAME_<game>`) and `stf_motion.h`
  (`#define GAME_<game>`); `vf2-guest.mjs` sets characters 6 and 32 to VF2.
  What treats another game's fighter its own way branches on it:
  - in the lifted code, an `INSERT` hook reads `guest_char_game[0x1B1(rob)]`
    (the crouch test at `loc_2B9CC`, so far);
  - in C, `char_game(c)`: the eyes (StF's second head model) are drawn and
    their palettes loaded only for StF's fighters, and the setup menu shows
    each fighter as `<game>:<name>` (`STF:SONIC`, `VF2:AKIRA`).
  A Fighting Vipers guest sets its characters to `GAME_FV` the same way.

He walks, attacks, hits, takes hits and goes down, as player 1 or 2 or both.
StF's command interpreter keeps its backtrack base at 0x1214(g13), where g13
is the fighter's rob, so the board runs `sub_1D47C` as a task (`stf_task`).
With g13 left over from C, Akira's first failed match backtracked off the
stack. StF's own scripts never fail all the way back, so they had not shown
it.

Known gaps: his hand shapes change without easing. While he is on, his
colours take rows 0..6 (7..13 for player 2), which includes StF's fixed rows
5/6 (12/13).

### Grading a guest

`node tools/grade-guest.mjs [romdir] [--json]` (after the import; romdir
defaults to `board/roms`) compares the built data ROMs with StF's set and
grades each guest. A guest table slot or record field is his own when it
differs from StF's and a stand-in when it is StF's; StF's program-ROM
tables (the list below) carry the audit's verdicts (closed: no value of
the same meaning in his game; open; inert on the board; unsettled). It
lists what StF's fighters have that he has none of (a foot and a body
swap: one of StF's 26 has each), and what the import dropped of VF2's
data, from `guests.json`, which `import-assets.mjs` writes beside the
ROMs: VF2 play ops with no StF op (0x04 ×148, 0x09 ×25, 0x10 ×154, 0x14
×4), flag bits StF never sets, strike bytes 4..7 (82 strikes), setup op
6's bytes 1..2 (29), three command ops 0x32, and 40 of 1200 reactions
VF2 has none for. Every StF slot, and StF's 519 motions, must be StF's:
if one is not, it says which and exits 1. On 89696fb's data: 12 of 30
items are Akira's own.

### Where a guest is still treated as StF's

An audit of the lifted code, `megamix.c` and `vf2-guest.mjs` (no code
changed). Line numbers are `stf_motion.s`'s. What a VF2 or FV fighter
should get is after the arrow.

Acting on him now:
- **Record fields:** `vf2-guest.mjs` copies Knuckles' 0x30-byte record and
  replaces +0, +8, +0xC and +4 (the skeleton, as VF2's record +4: his,
  ×`SCALE`, the one `SKELETON_TYPE_DATA` gets; no lifted code reads it, and MAME and
  m2-hle2 give the same energies with it as before).
  These are still Knuckles', because VF2 has no field known to mean the same:
  - +0x10 (0xC50F8, the cast's one table): 15 floats and a count at +0x3C.
    `get_en_info` (7186) tests the distance (rob+0x5F4) against +0, +4, +8,
    +0xC… for its near, far and reach bits. VF2's record has no pointer
    there. Its +0x18..+0x24 hold 1.4, 1.7, 1.4, 1.4 and +0x28 3.0, but no
    one has found what reads them, so they are not known to be ranges.
    → Find VF2's reader first, then ×`SCALE`.
  - +0x18 (0xC5148; Amy 0xC51B8): option data for `copy_option_data`
    (10082). VF2 has none. → A zero block of his own, once it is known what
    zero does.
  - +0x20 (0xC50E4, the cast's bytes 38, 26): rob+0x5BE (1585..1596,
    1756). What rob+0x5BE is, and VF2's equivalent, are unknown.
  - +0x14 (a float by character: 60 Knuckles, 40 Amy, 160 Eggman), +0x24
    (8.0), +0x28 (0xC513C) and +0x2C (9.0): no lifted code reads them, and
    their meaning is unknown. VF2's +0x2C (79.0) is not known to match.
  - +0x1C (0xC5260, the same in all 26 of StF's records): missed by the
    audit, found by `tools/grade-guest.mjs` (below). Its reader and
    meaning are unknown, so it stays.
- **Body pendulum:** `sub_7F0E8` (24413) and `scale_something` (24764)
  take a row of `flt_7F198` by character mod 26: Knuckles'
  (0.985, 0.30/0.18/0.30), into the dent pendulums at rob+0x1F88 (both)
  and rob+0x2758. Left as Knuckles': VF2 has no dents and no pendulum
  constants in its data, so it has no value of the same meaning to give
  him, and a scaled one would be invented (the numbers are rates, not
  lengths, so ×`SCALE` does not apply either). His row is StF's own ROM
  table, not a guest one, and skipping it for non-StF would change the
  shared path, so neither is done. → Once what the dents do to a guest
  model is checked in MAME: a guest table or a `char_game` gate, not a
  made-up row.
- **Throw camera:** `cam_mode_10` looks the motion either fighter plays up
  in `word_6BE90` (16-byte records: a motion id, a frame window, two
  script pointers; 25 of StF's ids: 466, 167, 284…). His ids are 519 on and
  the victims' copies 847..878, so his throws get no camera. Left as it
  is: no camera script by motion is known in VF2's data (neither the
  audit nor the importer's reading of VF2 names one), so he has no value
  of the same meaning, and giving his throws StF's scripts would be a
  mapping made up for him, not his own. StF's table is StF's, and a
  `char_game` gate in `cam_mode_10` would change the shared path; neither
  is done. A throw of an StF fighter's on him still gets its camera (the
  thrower's id is StF's). → Only once a VF2 equivalent is found.
- **Opponent mask:** command op 0x21, `loc_1EA88` (11984), tests bit
  rob+0x1B1 of the opponent (the parent character) in the op's 32-bit mask.
  Akira's 1B1 is 6, Knuckles'. Left as it is, because no script tests bit 6.
  StF's programs use the op with only four masks: 0x4, 0x10, 0x80 and 0x400
  (Amy, Fang, Espio and Bean), each in 8 of the programs. No StF script
  singles out Knuckles, so none singles out Akira, and he passes and fails
  each test the way an id no mask holds would. VF2's handler for op 0x21
  (0x1CDA8) is the same code as StF's, but none of VF2's 11 programs, his
  included, uses it. That leaves him no mask and no bit of his own to take
  from VF2. A bit of his own would mean a 1B1 other than 6, which StF's
  code reads as his parent character everywhere (the shared path). It would
  also change no test's result, so it is not done. → Only if a script that
  tests bit 6 comes in, or one of his own that uses op 0x21. (The grader
  still lists the item as open.)

Hard-coded characters, by id:
- `selected_player_check` (1471) is the stance's (`ACT_RC_KAMAE`) end
  handler in `ACTUAL_MOVES`. For parents 5, 8, 9 and 11 (Bark, Eggman, Big
  Eggman, Boss Eggman) it returns. For everyone else it goes on to
  `loc_13120`, which stores r11 at rob+0x19C and clears rob+0x1B2 and
  rob+0x1AE. Akira (6) takes `loc_13120`. Left as it is, because that is
  already VF2's own: VF2's action table (0x1B808, the same layout) has the
  same stance code at 0x149EC (StF's `ACT_RC_KAMAE`, byte for byte). Its end
  handler there is 0x147A4, the same code as `loc_13120`, with no character
  check. A VF2 fighter's stance ends the way his does now, so there is
  nothing to swap in. It stays on this list only because the check is still
  by StF id: a guest put in slot 5, 8, 9 or 11 would skip the reset.
- The command decoder at `loc_1E0A0` (11322) runs when a direction is held
  (r8 & 0xF0; bit 4 is down, r6 and r7 the forward and back bits) and no
  command matched. For everyone but 5, 8, 9 and 11, if w0 bit 29 is clear
  and down is held, it commits 1 << 25 (type 2) at rob+0x194, whatever
  forward or back do. Otherwise it goes to `loc_1E0E4`, the forward and
  back tree (3 << 24, 5 << 24, 1 << 26, 7 << 25 or 1 << 24, by 0x5B8 bit 0
  and the motion kind at rob+0x19F). Akira takes the first path. Left as
  it is, because VF2's decoder (0x1C4B8, the same code up to here) matches
  neither path:
  - It has no character check and no w0 bit 29 test.
  - With down held it runs a tree of its own: down with forward commits
    5 << 24 (type 5). Down with back commits 1 << 27 (type 8) if 0x5B8
    bit 0 is set, else 3 << 25 (type 6). Down alone commits 1 << 25
    (type 2), and only that one is the same as his path now. Each commit
    is skipped for some motion kinds (29, 30, VF2's numbers).
  - Without down it runs the forward and back tree, with other kinds
    (26, 18, 19) than StF's (22, 14, 15).

  VF2's types 5 and 6 have no StF type in the importer's `COMMIT_TYPE`.
  StF's kinds are not known to mean VF2's. The difference is in code, not
  in a number: there is no value to give him. Getting VF2's down tree would
  need a `char_game` branch in StF's decoder (the shared path), and putting
  him on the 5/8/9/11 path would take away his crouch. Neither is done.
  What he has now: down alone is VF2's, and down-forward and down-back act
  as down. → Only with a guest decoder of his own (VF2's tree, its types
  mapped), not a change to StF's.
- `sub_2EF9C` (17178), called from the motion setup at 17172 before it
  copies the 0x40-byte block to rob+0x40: if the drawn character
  (rob+0x1B0) is 7 or 33 (Espio, either colour), it sets bit 8 of
  rob+0x2A3C (r9 bit 6 set) or bit 5 (clear); for anyone else it returns
  having done nothing. Akira (1B0 6 or 32) returns, as every non-Espio
  fighter does. Left as it is: what bits 5 and 8 of rob+0x2A3C mean is not
  known, and VF2 has no Espio, so there is no VF2 value of the same
  meaning to give him; skipping it is already what a fighter who is not
  Espio gets. It stays on this list only because the check is by StF id:
  a guest put in slot 7 or 33 would get Espio's bits. → Nothing to do for
  Akira; only if a guest takes slot 7 or 33.
- `damage_calculation` (7981; StF ROM 0x19708): after `ketchup`, if the
  clock (0x500028) is above 0 and the victim's parent (rob+0x1B1) is not
  16 (Super Sonic), it takes the damage off rob+0x1AC and sets w0 bit 5 at
  0. If the parent is 16, the victim takes no damage. Akira (1B1 6) takes
  the damage, as every fighter who is not Super Sonic does. Left as it is,
  because that is already VF2's own: VF2's damage code (0x18A54, called
  the same way, with its own `ketchup` at 0x18AC8) subtracts and sets the
  KO bit with no character check (and no clock test), so there is no VF2
  value to give him. What it does after that (a sound by rob+0x1B1 through
  0x201E44C once the damage is above 40) is VF2's voice path, not this
  check. It stays on this list only because the check is by StF id: a
  guest put in slot 16 would take no damage. → Nothing to do for Akira;
  only if a guest takes slot 16.
- `original_combo_control` (10184; StF ROM 0x1CD8C), called each frame from
  the motion update (1023, ROM 0x12A78) before `air_mot_control`: if the
  parent (rob+0x1B1) is 16 (Super Sonic) and 0x5004F4 and 0x5004F8 are both
  0, it sets w0 bit 18 and puts 0x18C0 in rob+0xC7C, the timer that bit 18
  then counts down (and keeps rob+0xC7E at 0x140) until it clears the bit.
  Akira (1B1 6) skips this, as every fighter who is not Super Sonic does.
  Left as it is, because that is already VF2's own: VF2's frame loop (0x143E4,
  the same code as StF's up to the call) has no such routine; it goes from
  the same `st r5` straight to `air_mot_control` (0x1B5C8, StF's 0x1CE34
  byte for byte), and nothing in VF2's program uses rob+0xC7C. So there is no
  VF2 value to give him. The rest of the routine (the timer set when
  0x50004C is at most 1 and 0x500064 is 9, and the countdown) has no
  character check.
  It stays on this list only because the check is by StF id: a guest put in
  slot 16 would get Super Sonic's timer. → Nothing to do for Akira; only if
  a guest takes slot 16.
- The Super Sonic change (9283, `pm_game_2P_ss_check_pass`; StF ROM
  0x1BFEC..0x1C058), in the block after `pm_ba_ex` that runs when rob+0x70C
  bit 26 is set, rob+0xC7E is at most 0, w0 bit 18 is clear and rob+0xC70 is
  above 0: if the game mode bytes pass and 0x5004F4 and 0x5004F8 are 0, a
  fighter whose parent (rob+0x1B1) is 0 (Sonic) facing an opponent whose
  parent is 3, 13 or 11 becomes Super Sonic (rob+0x1B0 = 16, then `sub_1BCC0`,
  `sub_81038`, `sub_7F0E8`, `scale_something` and `char_nameplate_dsp` run
  again, a sound, and rob+0x1AC set from 0x5000A0). Everyone else goes on
  to `not_super_sonic`, which puts 0xC0 in rob+0xC7C and sets w0 bit 18 with
  no character check. Akira (1B1 6) is not 0, so he never changes; as the
  opponent, 6 is not 3, 11 or 13, so Sonic does not change against him.
  Left as it is, because VF2 has no such block: after the same
  `st r5, 0x1A4(g7)` (VF2 0x1ACB0; the code before it, 0x1AC98, is StF's
  0x1BF58 byte for byte) VF2 goes on to its own test of 0x3351 bit 6, and
  nothing in VF2's program uses rob+0x70C, rob+0xC70, rob+0xC7C or
  rob+0xC7E. So there is no VF2 value of the same meaning to give him. It
  stays on this list only because the check is by StF id: a guest put in
  slot 0 would turn into Super Sonic against 3, 11 or 13, and a guest in 3,
  11 or 13 would let Sonic change. → Nothing to do for Akira; only if a guest
  takes one of those slots.
- `egg_robo_condition` (20339; StF ROM 0x33920), the end of the intro
  animation's forward step (rob+0x7F0 bit 10): when the frame index at
  rob+0x2A88 reaches the count in the character's
  `opening_cutscene_anim_data` row, it calls `uk_egg_robo_head_sub` (which
  puts one of two `uk_egg_robo_head` values in rob+0x48) if the drawn
  character (rob+0x1B0) is 13 or 39 (Egg Robo, either colour), and returns
  for anyone else. Akira never gets here: his rows (6 and 32) in
  `opening_cutscene_anim_data` are 0, as are every other row but 13/39
  (`egg_robo_head_rising_cutscene_anim`) and 14/40 (`_uk_rocket_metal_trans`),
  so the step returns at loc_33A00 before the check. Left as it is, because
  VF2 has no such step: nothing in VF2's program uses rob+0x7F0, rob+0x2A88
  or rob+0x2A8A, so there is no VF2 intro frame table or head value of the
  same meaning to give him. It stays on this list only because the check is
  by StF id: a guest put in slot 13 or 39 would get Egg Robo's intro and
  head. → Nothing to do for Akira; only if a guest takes slot 13 or 39.
- The intro animation step (20296, loc_33824 forward on rob+0x7F0 bit 10;
  20349, loc_33910 backward on bit 11): it takes the drawn character's
  (rob+0x1B0) row of `opening_cutscene_anim_data` and writes one frame of
  it per step to rob+0x40[rob+0x2A8A], counting rob+0x2A88. Only rows 13/39
  (`egg_robo_head_rising_cutscene_anim`) and 14/40 (`_uk_rocket_metal_trans`)
  are set; when the parent (rob+0x1B1) is 14, it first zeroes rob+0x40..0x7C,
  0x2050, 0x2054, 0x2A80 and 0x2A84. Every other row is 0, so the step
  returns at once. Akira's rows (6 and 32) are 0 and his 1B1 is 6, so he
  gets that early return, as every fighter but 13 and 14 does. Left as it
  is, because VF2 has no such step: nothing in VF2's program uses rob+0x7F0,
  rob+0x2A88 or rob+0x2A8A, so there is no VF2 intro frame table of the
  same meaning to give him a row from. It stays on this list only because
  the table and the 14 check are by StF id: a guest put in slot 13/39 or
  14/40 would play Egg Robo's frames or row 14's (`_uk_rocket_metal_trans`). → Nothing to do
  for Akira; only if a guest takes one of those slots.

Inert on the board, for later:
- `character_spin_mot_objects` (0x81138, `sub_81038` 24842): 0x20-byte rows
  by the drawn character (rob+0x1B0, no mod 26), the spin attack's two
  models (the "spindash" non-ball and ball; Akira's rows 6 and 32 are
  Knuckles', 360/359), a float and two float triples, which `sub_81038`
  puts in rob+0x2084, 0x2086, 0x20EC and 0x2088+0x30/0x3C for both
  fighters. In StF they are drawn by `rob_disp`'s `spin_attack_cnt_nml_dsp`
  / `_esp_dsp` while rob+0x2068 is 1 (set by `sub_81A48`, a motion op).
  On the board it is inert for Akira: `sub_81038` is lifted only for the
  Super Sonic change (9295), which never runs with him in the fight (see
  the 9283 entry), and neither spin display routine is lifted, so nothing
  reads those fields. Left as it is, because VF2 has no spin attack:
  nothing in VF2's program uses rob+0x2068, 0x2080..0x2088 or 0x20EC, so
  there is no VF2 model pair or constant of the same meaning to give him a
  row from. A row of his own would be invented, and skipping the routine
  for non-StF would change the shared path; neither is done. It stays on
  this list because the rows are by StF id. → Only if spin attacks are
  drawn on the board and a guest motion starts one.
- Sound (`sound_request_u` is stubbed): `blank_per_character_audio_array`
  (0xDB25C, 9517) gives Knuckles' voices (0xDB3D0); `loc_2B33C` (14184)
  picks robot hit sounds by id. → A guest voice table when sound comes in.
- `sub_2C7E4` (15482), a projectile's hit: StF's `uk_hit_motions` direct,
  not `guest_ptr_DA0B4`, so Knuckles' reactions. → The guest table, when
  projectiles come in.
- `ptr_CE1CC` (`damage_unit` 14752, 15559; `sub_3261C` 19934): every row is
  the same empty `word_CE1CC`. → Skip for non-StF if StF's rows are filled.

Not settled: all his setups have skeleton type 0 and 0x860 clear
(`convertSetup` zeroes header bytes 4..7 and 12), so `calc_rob_angle_cont`
(18164) reads `off_C2058`[0][6], the sibling of `SKELETON_TYPE_DATA` that is
not a guest table. That row is 0xC2558 (StF's `model_floats_0`) for every
character, StF's or not. Check in MAME what it feeds before giving it a
guest copy.

Already his own or fine: `CHAR_PARTS`, `MOVESET_ARRAY`, `ptr_DA0B4`,
`motion_remap`, `SKELETON_TYPE_DATA` (all four kinds) and his records' +4,
the hand, foot,
body and head lists, `char_game`, `rob_coli_ball_types` (his collision
balls, above), his damage (×140/200 in his setups, above); `_uk_gravity` (0.0, as Sonic's). In C,
`rob_init`, `draw_fighter` and `load_palettes` read the guest tables and
`char_game`. The camera (`camera_place`, `cam_mode_9`/`10`) reads no
character, only positions, flags and the motion id; it aims at root
y + 1.0, which holds while guests are scaled to StF's size.

## The fight

The rounds run on StF's own code, lifted by `tools/lift-stf.py`; the board
sets up what StF's game loop would have set up around it.

- Contact: `coli_init` runs as a task at each round start, and `rob_init`
  points rob+0x1D00 at the fighter's ball list. The 0x3B copro op (fighter
  against fighter) takes its masks from the rob+0x1D14 tables, which
  `decide_coli_kind` picks from `off_1008`. That table's eight pointers run
  on past its label through `off_1010` into `off_1018`, so the lifter keeps
  such tables whole (`RUN_ON`). Without that, player 2's table was garbage
  and the fighters passed through each other.
- Walls: op 0x70 (`area_coli`, the distances at rob+0x650) reads the ring
  size from stage_x (0x50A00C, 8.0) and stage_soko (0x50A010, -100.0), as
  in the real fight RAM. With them overridden it returned 100.0 and nobody
  stopped at the ropes.
- Damage only lands while game_timer (0x500028, seconds << 6) is above 0.
  The board starts it at the setup's time << 6 and counts it down once a
  frame.
- A round ends on a KO (rob w0 bit 5, energy at +0x1AC reaching 0) or when
  the clock runs out; the fighter with more energy takes the win
  (p1_wins 0x50004F, p2_wins 0x500051, the setup's round count to win).
  Three seconds later the next round starts with both fighters reset, or,
  once a fighter has won the match, the setup comes back.
- HUD: StF's own `energy_disp`, `barrier_left_disp`, `time_dsp`,
  `win_lamp_dsp` and `win_lamp_int`, with the board's game_disp block
  (0x500834; w0 0x84800000, lamp bytes as in the real block) in g13. They
  write StF's tiles to the FG layer; `_Scroll_Initialize` loads the CG
  slots they need (0 at boot, 70 and 170 as `MES_ROUND_INT` does). The FG
  layer is cleared to StF's blank tile 0x20 first.
- Camera: StF's own. `camera_work` runs the camera object (`fa_camera`,
  0x500814) by its mode byte (+0x40) through `cam_mode_list`. In a round
  mode 9 places the camera and sets mode 10, the in-fight follow; 11, 12,
  25, 35 and 4 are round ends and replays, which the board does not run.
  `round_start` runs `cam_mode_9` as a task (g13 the camera, g7/g8 the
  robs) after `rob_start`; `fight_step` runs `cam_mode_10` once a frame.
  Mode 10 also plays the special moves' camera scripts (`word_6BE90`, a
  table of self-pointers the lifter relocates, `SELF_REL`; its step
  handlers are the ROM jump tables `off_9C83C`/`off_9C848`, lifted as code,
  `ROM_CODE_TABLES`). `camera_stf` then builds StF's `camera_control`
  matrix: identity, `ang_z`, `ang_x`, `ang_y` by the negated +0x28, +0x24,
  +0x26, and `camera_place` at the position (+0x18..+0x20). StF keeps that
  position in fighter units; the board's camera is in the stage's 1.6
  units (Camera scale, above), so it is passed times 1.6. In real StF
  the fighters are drawn on the unscaled matrix (rob+0x2A40 equals the
  camera at 0x5010F8, unit columns); the board draws them on the scaled
  one, which projects the same with 1.6-times normals.
  Check: real StF, 1P fight on South Island: mode 10, camera y about 3.0,
  4.5 to 5.0 from the fighters' midpoint, pitch -2600 to -3300. Board,
  fighters 4.0 apart: mode 10, camera (0, 3.31, -4.85), pitch -2560 (its
  0xF8 target), aimed at (0, 2.1, 0); as they part to 14 it backs off to
  (0.2, 6.6, -9.9) and stays on the midpoint; snapshots keep both in
  frame.
- Characters: rob+0x1B0 is the character drawn (the alternates are +26),
  rob+0x1B1 the parent. `ADV_CPU_BATTLE_INT` sets 1B1 = 1B0 - 0x1A, and a
  real P2 Honey alternate has 1B0 0x24, 1B1 0x0A.

## Game setup

The board boots into a setup window in the style of StF's debug menu
(`DEBUG_PARAMETER_SET`, its `PARAMETER_SET` window), drawn over the live
stage: the two fighters stand in their stance behind it, with the clock
held, and a change of stage or fighter shows at once.

    GAME_SETUP
     GAME_START
     time        30   round time, 1..99 s (game_timer 0x500028)
     round        2   wins to take the match, 1..5 (0x500052, the lamps)
     stage        0   South Island, Aurora Icefield
          0:SOUTH_ISLAND
     1P CHAR  SONIC   Sonic, Honey, Eggman, Akira
     2P CHAR  HONEY
     energy     140   energy_max (0x5000A0), 10..250; the bars scale by it
     barrier      5   barrier_default_num (0x50A424), 0..9

- Controls, either player, as in StF's menu: up and down move the cursor,
  kick raises a value and punch lowers it (both wrap), guard held repeats
  them. Start, or punch or kick on GAME_START, starts the match. Both
  starts at once during a fight go back to the setup; so does the end of
  a match.
- The look is StF's own tile words, on tile layer 1 (0x01002000): the blue
  frame 0x8200..0x8207, text 0x8000 | ascii, the inverse title and values
  0x8080 | ascii (a black box, palette bank 1), the cursor 0x801C. The
  board's character RAM already holds StF's font and frames there.
- Tile layers 0 and 1 share a window mask (tile RAM 0x0100C000, four
  words a line, a bit per 8 pixels, top bit leftmost): layer 1 shows only
  where its bit is set. StF sets it over its window (lines 160..271, x
  64..255, for its PARAMETER_SET); the board sets it over the setup's frame
  and clears it for the fight, where the HUD is on layer 0.
- Black: palette colours show through colorxlat row c at luma 0x40, and
  MAME reads 0..0x40 there as 0, which the tile layers treat as
  see-through. The fight's band (`flat_cx`, as in StF's fight) has 0 for
  component 0, so the font's black outlines vanish; the setup writes 0x41
  there and the fight's start puts 0 back. m2-hle2 shows the window, the
  boxes and the outlines the same.
- `m2_backdrop` (the stage's backdrop colour) takes pen 1, the font's
  white, and fills layer 0 with its solid tile: a stage switch from the
  setup keeps pen 1 and clears layer 0, as the boot does.

## Where it stands

Two fighters (Sonic, Honey, Eggman or Akira, picked in the setup) stand
facing each other and play their stance motion with StF's own motion code
(60 Hz steps, drawn at 30 fps), on one of two of
StF's stages, South Island and Aurora Icefield (see Game setup). The stages are drawn from StF's stage records with its
textures, colours, materials, light, colour cycling, and the sea and
aurora. South Island matches StF's own picture closely. They push, hit and
knock each other down, rounds end on a KO or the clock, and StF's HUD shows
the energy bars, the clock and the round stars (see The fight). Further stages will
come from VF2 and Fighting Vipers.

Known gaps:

- Player 2's part rows (7..11, luma 48..63) get the fighter's own table, as
  player 1's do. In a 1P round against the CPU, real StF leaves them at zero.
  Mirror matches in real StF (MAME `sfight`, 2P; Honey vs Honey by setting
  slot 0 of the select table at 0xDACAC to 0x0F) draw player 2 as the board
  does: Sonic dark grey, and Honey blonde, with purple fur, a blue dress, a
  blue hairband and white barrettes.
- Eggman's head (model 793) takes its texture from StF's texture set 7,
  which the board does not load (it loads set 1 and the stage's), so it
  does not show.
- No shadows. The camera's round-end and replay modes are not run.
  Near the ring's edge the near ropes cross the view.

## Plan

1. The fight: port `js/engine.js` to C (input, commands, moves, hits,
   reactions, rounds), versus only.
2. Motions: StF's motion code runs on the board (above), so every StF
   motion is there. Next: the rest of `play_motion` (its motion commands,
   such as the dent pendulums' kicks) as the fight needs them.
3. VF2's and Fighting Vipers' fighters and stages: their models, textures
   and colours go into the data ROMs (StF's unused runs, see
   `STF-BOARD-AKIRA.md`), which then ship as new ROM files beside the
   program.

`STF-BOARD-AKIRA.md` records the earlier route (Akira dropped into StF's own
program by data edits). Its measurements of free ROM and texture RAM still
apply; its attract and select findings do not, since this program has its
own screens.
