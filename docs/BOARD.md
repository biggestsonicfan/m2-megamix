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

The main loop runs once a vsync, as StF's and VF2's do: each pass steps
the fighters once and draws them, so they move at 60 fps. It used to wait
two vsyncs, and its work (about 24 ms, half of it soft-float `mat_mul`
for the stage's 50 to 79 objects) made every pass three vblanks long: the
fighters were drawn at 20 fps, in steps of three motion frames, which is
what made Akira look stiff beside VF2. `mat_mul` now runs on the
coprocessor (op 0x29 on each column, op 0x13 for the translation), and a
pass takes 8.2 ms on South Island and 9.2 ms on Aurora Icefield (10.3 ms
at most) in MAME. A pass that runs long still steps once per vblank it
took.

The board's C is soft-float (`M2_SOFTFLOAT`), all but `src/carry.c`, built
with `-mnumerics` for the i960's own `mulr`/`addr`/`divr` as the lifted
code is. It carries points from one slot's frame into another's (Ryo's
seams and midriff, `megamix.c`); in soft-float its matrix setup took 6.75
ms of a 7.4 ms call, and Ryo's twelve seams held the board to 30 fps (his
`draw_fighter` 10 ms a pass where Akira's is 0.9 ms). Floats cross the two
conventions by pointer only.

Graded against VF2 (MAME `vf2`, Akira vs Lau, the same inputs: walk
forward, punch, kick, walk back, crouch): the board plays the same motions
with the same blends (`smooth_int` modes, length 8), flags and lengths.
It sometimes starts a motion at frame 2 rather than 1, and its walk starts
about three frames later after the press. Check: a frame_counter write
tap gives one pass a frame over 1099 passes on each stage (it was three
vblanks a pass in the menu and the fight). On m2-hle2, a breakpoint on
the counter's store hits every frame with Akira walking. The stage
matrices `submit_mat` sends match the soft-float ones to 1.25e-7.

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
  because a pass that runs long takes more than one. Bit 5 of
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
  stage matrix is `cam` times its own, as in StF. The stage bakes keep
  StF's 1/1.6 (`ARENA.stf.scale`): with the camera's 1.6 they come out as
  StF's matrices, R (1.6 v − eye). The fighters are drawn on `cam_l`, as
  StF's `rob_disp` draws them on the unscaled camera (see Camera, under
  The fight). The cage cull now tests the
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
  never sets and its code turns into a commit of type 0x18. Two setups
  VF2's `set_mot_dat` patches in code get it in the data: motion 40's kind
  word bit 7 and motion 578's op 0xB bit 15 (D4 in `SHARED-CODE.md`; in
  MAME and m2-hle2 his 540 and 708 load them).
- **Actions:** all 52 of StF's action slots are given one of his motions
  (`STF_ACTIONS`), so he has his own stance, walks, guards, falls and get-ups;
  none of Knuckles' are left. Slot 31 is VF2's action 30 (D6 in
  `SHARED-CODE.md`; it was 29, the same motion 726 for Akira, so his ROM
  did not change).
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
  His throws' victims take more in the motion they play: play op 8 (byte
  +3, off the energy of the fighter playing it) in VF2 motions 16 (10 at
  frames 47 and 62) and 44 (15 at 34, 25 at 48), the victims of his throws
  15 and 43. `convertSetup` scales it too (D5 in `SHARED-CODE.md`): 7, 7,
  11, 18. Checked in MAME and m2-hle2 by giving his motion 527 (P) the
  setup and motion of 525 or 544: he takes 7 at 47 and 7 at 62 (10, 10 on
  the old build), 11 at 34 and 18 at 48 (15, 25).
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
- **Midriff:** why his waist looked broken. VF2 draws a band between the
  chest and the hips each frame from polygon RAM: the record's +0x38 points
  at a struct (model +8, the chest's ring of 8 points +0x70, a link count n
  +0xD0, n links of 0x28 bytes from +0xD4: attribute, normal, two points;
  a closing word, then 2n index bytes, one per link point: below 8, the
  link's own point on the hips; 8 and up, the chest's ring point idx−8).
  Each frame VF2 takes the ring through H⁻¹·C (H the hips' matrix, slot 9;
  C the chest's, slot 1), writes the links to polygon RAM (geo command 5)
  and draws them on the hips' matrix. The board never had it, so where the
  chest bends (a kick, a punch's lean) the gap at the belt showed the floor
  through. At rest the band has no area: the ring through H⁻¹·C (about 180°
  round z) lands on the hips' points, so it only shows when he bends.
  - `midriff` (a guest table of the board's own, `STF_GUEST_midriff`,
    0x02E06640, 0xD0 bytes) is a word by character: 0, or (`vf2-guest.mjs`)
    a struct in the data ROM: +0 the model, +4 n, +8 the ring (8 × 3 floats,
    scaled to StF's size), +0x68 the 10n+1 words of the links (points
    scaled), then the 2n index bytes.
  - `draw_fighter`: `midriff_build` reads both matrices back from the
    coprocessor (`slot_mat`), inverts the hips', and writes the links, the
    chest points put in, to polygon RAM at `player << 8`; after slot 9's
    model, `midriff_draw` submits the band's model with its data pointer
    (header word 2) at that address + 4, in normal mode 2 (no normals; VF2
    uses 3, the same light), then ends the list at `COP_WPOS` (not the geo
    write pointer: there nothing was drawn).
  - Tested on MAME and m2-hle2 (geo on and off): the band fills the belt as
    he kicks; at rest nothing changes. Damage unchanged (Honey 140 → 132 →
    125, Akira 127 → 116 on both).
  - Slot 0 is not drawn. StF's records leave it 0, and its command
    interpreter keeps bytes at +0x40..0x43 of g13 (the rob: slot 0's
    model word), so Akira's 0x13AE became 0xAE, an empty StF entry: an
    object with tpa, tha, oba and count all 0. With the band in polygon RAM
    at 0, m2-hle2 drew that object from P1's band (a big polygon at his
    waist); MAME drew nothing.
  - Akira as player 2 (against Sonic) on m2-hle2: no stray polygon, and the
    band closes the belt through a kick and a punch, as for player 1.

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
  replaces +0, +8, +0xC, +0x10, +0x14 and +0x20 (his ranges, weight and jump time, below) and +4 (the skeleton, as VF2's record +4: his,
  ×`SCALE`, the one `SKELETON_TYPE_DATA` gets; no lifted code reads it, and MAME and
  m2-hle2 give the same energies with it as before).
  +0x20 is the jump's frames, into rob+0x5BE (1587..1600, 1756; the second
  byte on action bit 18): Knuckles' are 38, 26, VF2's `exec_command`
  (V 0x14828) takes record +0x4C or 32, and he has his own 72, 32 (D3 in
  `SHARED-CODE.md`). MAME: his jump lasts VF2's 52 frames, Sonic's is as before.
  +0x14 (a float by character: 60 Knuckles, 40 Amy, 160 Eggman) is the
  weight. `action_init` (802..810) puts it into rob+0x7DC and, with
  `sub_3261C`'s, into rob+0x5D8, the friction `rob_spd_control` divides by;
  he has VF2's record +0x2C, 79.0 (D1 in `SHARED-CODE.md`).
  +0x10 points at 0xC50F8, the cast's one table: 15 floats and a count at
  +0x3C. `get_en_info` (7186) tests the distance (rob+0x5F4) against +0,
  +4, +8, +0xC for its near, far and reach bits (rob+0x720 bits 0..4).
  VF2's `get_en_info` (V 0x18818) reads rob 0x62C, 0x668, 0x630, 0x634,
  which `init_fix` fills from record +0x18..+0x24 (1.4, 1.7, 1.4, 1.4). He
  has his own copy of the table with those ×`SCALE` (2.84, 3.45, 2.84,
  2.84) for Knuckles' 2.5, 2.5, 1.6, 2.4 (D2 in `SHARED-CODE.md`). MAME: his
  near bit holds to 2.84 and far to 3.45; Sonic's are as before.
  These are still Knuckles', because VF2 has no field known to mean the same:
  - +0x18 (0xC5148; Amy 0xC51B8): option data for `copy_option_data`
    (10082). VF2 has none. → A zero block of his own, once it is known what
    zero does.
  - +0x24 (8.0), +0x28 (0xC513C) and +0x2C (9.0): no lifted code reads
    them, and their meaning is unknown.
  - +0x1C (0xC5260, the same in all 26 of StF's records): missed by the
    audit, found by `tools/grade-guest.mjs` (below). Its reader and
    meaning are unknown, so it stays. VF2's record has no pointer there:
    its +0x1C is the 1.7 in the +0x18..+0x24 floats above, whose reader is
    not found either. So VF2 has no field of the same kind, let alone one
    of the same meaning, and a pointer of his own would be invented.
    Neither the audit nor the grader names a reader. → Only once StF's
    reader of +0x1C is found, and a VF2 value of the same meaning.
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
- Sound: `blank_per_character_audio_array` (0xDB25C, 9517,
  `play_audio_per_character`) is a list of tables by the play op's byte 3,
  each indexed by the parent (rob+0x1B1), so Akira (6) gets Knuckles'
  voice codes (0xDB3D0); `dword_DB2A8` after it is by 1B1 too.
  `loc_2B33C` (14175) picks hit sounds by the attacker's parent (3, 11, 12,
  13: robot lists) or else by the drawn character (rob+0x1B0 × 12 into
  `dword_DB964` / `dword_DB6F4`), so Knuckles' again. Left as it is: every
  path ends in `sound_request_u`, which is a stub (`ret`, 25081), and the
  board's sound program and samples are zeros, so nothing is heard and the
  codes change nothing else. VF2 has voice codes of its own (its damage
  code plays one by rob+0x1B1 through 0x201E44C, see `damage_calculation`
  above), but they are commands to VF2's sound program and samples, not
  StF's; the same number sent to StF's sound program plays a different
  sample, so it is not a value of the same meaning, and a mapping from
  VF2's voices to StF's codes would be invented. Gating the lookups on
  `char_game` would change the shared path; neither is done. It stays on
  this list because the tables are by StF id. → Only once the board has
  sound, with a guest's own samples and codes to point at.
- `sub_2C7E4` (15480), a projectile's hit: it picks the victim's reaction
  from StF's `uk_hit_motions` (0xDA0B4) by the projectile's kind byte
  (+0x7E of the object), crouch (0x1A4 bit 3), side and behind, not through
  `guest_ptr_DA0B4`[rob+0x1B1] as `sub_2B94C` does for a strike. So a
  projectile on Akira would give him StF's shared lists, not his own (his
  StF reaction ids then go through `motion_remap`). Left as it is:
  - It never runs on the board. Its only callers are in `sub_2BEF4`
    (14936, from `collision`), which walks the projectile objects of
    `mod_fa_tobi` (0x5008A4, the board's zeroed `stf_tobi`) and takes only
    ones with bit 31 set. Nothing in the lifted code or `megamix.c` makes
    one, so the loop finds none.
  - VF2 has no projectiles. His reaction lists (VF2's 40 by category,
    crouch, behind and side) are what VF2 gives him for a strike. VF2 never
    picks a reaction for a projectile, and StF's projectile kind byte is
    not known to index the same kinds as VF2's strikes. So there is no VF2
    value of the same meaning to give him.
  - Reading `guest_ptr_DA0B4` here would change StF's lifted routine (the
    shared path), with no way to test it while the path never runs.

  Neither is done. → Only once projectiles run on the board, and a guest
  with a projectile reaction of its own comes in.
- `ptr_CE1CC` (0xCE0F8; `damage_unit` 14752, 15559; `sub_3261C` 19934):
  the crushed-parts table, by drawn character (rob+0x1B0). Each of 16
  parts has an 8-byte entry: four counts and a pointer to 0x28-byte pieces.
  `damage_unit` uses it, for each part, with rob+0x1F20/0x1F4C, and hands
  the pieces to `efc_crush_parts_put_cont` (effect +0x918/+0x920). It sets
  the part's bit in rob+0x1F48. `sub_3261C` adds up the pieces. Left as it is:
  - All 52 rows in the board's ROM (`stf_rom_80000.bin`) point to the same
    `word_CE1CC`, which is 0x80 zero bytes. StF's rows are not filled. Every
    count is 0, so `damage_unit` skips at `cmpobe 0, r8` and `sub_3261C`
    returns 0 and 0 for every fighter. Akira's rows (6, 32) are the same
    as every StF fighter's. He is not treated differently from them.
  - VF2 has no crushed parts. Nothing in VF2's program uses rob+0x1F20,
    0x1F48 or 0x1F4C, or the effect's +0x918, +0x91E, +0x91F or +0x920
    (StF's program uses them 14, 15, 14, 6, 4, 4 and 5 times). So there is
    no VF2 value of the same meaning.
  - The old note "skip for non-StF if StF's rows are filled" doesn't apply,
    because the rows are not filled. Skipping it for guests would mean a
    char_game check on the shared path.

  Neither is done. → Only if a StF row is ever filled, and then only with
  a VF2 table of the same meaning.

- `off_C2058` (0xC2058; `calc_rob_angle_cont` 18164): the bones the
  per-frame angle code solves the pose on and sends to the copro (op
  0x35806B6B). It picks `off_C2058`[type][drawn character] by rob+0x84C,
  unless rob+0x860 bit 12 is set; then it uses rob+0x8C, which
  `calc_rob_angle_int` filled from `SKELETON_TYPE_DATA`. `set_motion` sets
  bit 12 when the setup's type (header byte 12) is not 0. All his setups
  are type 0 with 0x860 clear (`convertSetup` zeroes header bytes 4..7 and
  12), and type 0's list in StF's ROM is 0xC2558 for all 26 characters.
  **Now his own** (the lifter makes `off_C2058` a guest table;
  `vf2-guest.mjs` fills [0..3][6] and [0..3][32]):
  - StF's row is 15 points: the chest (+0), the head (+0xC, the pivot the
    head aim in `calc_unit_1` turns about), each arm's pivot (+0x18,
    +0x3C) and its two bones (the x of points at +0xC and +0x18 from the
    pivot), the pelvis (+0x60), each leg's pivot (+0x6C, +0x90) and two
    bones. 0xC2558's head is x 0.361.
  - VF2's routine (around 0x27D68, the same copro stream) loads one fixed
    table for its whole cast (`lda 0x296A0, g6`). It has the same points at
    +0, +0xC, +0x18, +0x2C, +0x40, +0x4C, +0x60, with each limb's two bone
    lengths as scalars at its pivot +0xC and +0x10 (VF2's 0x27E4C and
    0x27E9C send +0x10 and +0xC where StF's send +0x18 and +0xC). Its head
    is x 0.39. His row is that table ×`SCALE` (lengths, as his skeleton):
    head 0.79.
  - On StF's row his head turned about a point 0.43 below his own head.
    His face target (+0xB0C, at his head height) was then above the
    pivot, and in every motion with the look gate closed (punch 527,
    kick 720, crouch) the pitch sat at its −0x2000 clamp: he looked up
    over the opponent instead of at them. Idle (gate open) was not
    affected. Now the head angles follow VF2's model posed on the same
    motion: punch pitch about −3000 (VF2 18 frame 4: −3125); kick
    (VF2 738) frames 9..13 turn −26045, −25666, −24970, −24058, −23034 on
    both. Sonic's head angles are unchanged frame for frame.

The entries above `off_C2058` are left because VF2 has no equivalent of
the same meaning, or because the meaning is not known (the record fields,
+0x1C included). None of them can be replaced without an invented value or
a change to the shared path. The next step is new knowledge (a VF2 reader
of his record +0x18..+0x2C, or StF's reader of +0x1C).

Already his own or fine: `CHAR_PARTS`, `MOVESET_ARRAY`, `ptr_DA0B4`,
`motion_remap`, `SKELETON_TYPE_DATA` (all four kinds) and his records' +4,
the hand, foot,
body and head lists, `char_game`, `midriff` (his waist band, above),
`rob_coli_ball_types` (his collision
balls, above), `off_C2058` (his solve bones, above), his damage (×140/200 in his setups, above); `_uk_gravity` (0.0, as Sonic's). In C,
`rob_init`, `draw_fighter` and `load_palettes` read the guest tables and
`char_game`. The camera (`camera_place`, `cam_mode_9`/`10`) reads no
character, only positions, flags and the motion id; it aims at root
y + 1.0, which holds while guests are scaled to StF's size.

## The guest: Shenmue's Ryo

Ryo Hazuki (the Shenmue beta's, js/ryo.js) is StF character 1
(Tails, whom Megamix does not use; 27 for player 2), picked as RYO in the
setup. tools/ryo-guest.mjs builds him on top of what tools/vf2-guest.mjs
put in for Akira, and import-assets runs it after Akira's.

- **Moves.** Akira's: his command program, actions, reactions, motion remap
  and setups, so he plays as a VF2 fighter (`char_game` VF2). His own
  motions are VF3-style Shenmue ones the board cannot play yet
  (docs/VF3-SHENMUE.md).
- **Model.** YKB_B, the model Shenmue draws him with from afar (#1556):
  the same bones as his own YKB_M, at the same places, but one node a slot
  (15) and 288 triangles to YKB_M's 1793, the jacket, shirt, jeans and skin
  painted on two 64×64 ARGB4444 textures (KB_MUF_, KB_MUB_; their alpha is
  0-3 throughout and is not read as holes). Both are in MISC/MODELS.PKS,
  with their textures in MODELS.PKF; the disc has no other Ryo between them
  (YKB_Z, 2835, is a bigger one). `RYO_MODEL=M node tools/import-assets.mjs`
  builds him with YKB_M instead. The web page draws YKB_M.
- **Parts.** Each node rides the StF part its nearest anchored bone drives
  (`SLOT_BONES`), so each part is rigid. YKB_B: 11 parts and 288 triangles,
  112 of them in the seams below (YKB_M: 15 parts, 1793, 193). YKB_B's
  thighs and shins are welded whole to the joint above, so those four slots
  have no part, only seams, and `draw_fighter` draws a slot's seams with no
  model. Scaled by `ryoFit` (1.0084 of
  Akira's height) × SCALE. Each
  part is one mesh of independent triangles: per triangle a triangle link
  (points A, B) and a culled quad link (points C, C) whose material step
  moves to the next triangle's record. The meshes go in the polygon ROM's
  empty run after Akira's, as model ids counted down from the table's end.
  The import decodes each mesh back with noclip's `decodeModel` and stops if
  a corner, tile or UV differs from what it put in.
- **Textures.** His textures (YKB_M's seven, YKB_B's two) become 4-bit brightness tiles (the 99th
  percentile = 15; a texture with holes keeps 15 for them and sets th0 bit
  13), mipmapped to level 4, packed into Akira's seven pages after his
  (pack-akira's `extra`). Their material and UV streams follow Akira's in the
  textures region.
- **Colour.** The board takes a face's colour from its colorbase and only the
  brightness from the texel, so each face takes, per channel, the StF ramp
  row (0..27, lumabase 0) whose values at its texels' brightness come
  nearest to their colour (15 texels sampled across the face's UVs). The
  fit compares what the screen shows: the board's output curve is black up
  to 64 and stretches the rest by 255/191 (MAME's `m_gamma_table`, the
  monitor's bias and gain), so a ramp value v shows as (v − 64)·255/191.
  Fitting the raw ramp values instead chose rows too strong. A dark texel
  can want more of a channel than row 27 gives: the jeans' green and blue
  both stopped there, came out equal and turned the blue cyan. A face whose
  fitted hue is more than 8° from its texels' (and is not grey) is fitted to
  a dimmer copy of its colour, in steps of 5% down to half, until it keeps
  its hue. The jacket's red, short alone, keeps its hue and is left. 262
  colours: StF's own palette entry where one matches, 219 new colorbases
  from the free ones at the top. The SDK's boot copies all 1024 entries, so
  they are loaded.
- **Skeleton, solve bones.** Akira's, with Ryo's spine, pivots and bone
  lengths (`prepareModel(model).rig` × his size).
- **Collision balls.** Akira's 30 (the hurt and hit spheres), each moved from
  Akira's part to Ryo's: its centre mapped across the two parts' bounding
  boxes, axis by axis, and its radius scaled by the cube root of the three
  ratios (each 0.5..2, the result 0.6..1.6).
- **Hands, head.** His own hand parts (one shape) and head; no midriff.
- **Seams.** A Shenmue node's strips also run through points of its parent
  node, and where the parent rides another StF part, a cut that keeps each
  triangle rigid on one part opens a gap at the joint when it bends (the
  knees, elbows, wrists, hips and neck). These 193 triangles are 12 seams
  instead, each with the part S it is drawn on and the part O its far
  corners ride. They are rebuilt in polygon RAM, as the VF2 midriff is.
  The guest table `seams`, by character, lists them. Each holds its model,
  S and O, its far points (in O's frame), the runs of mesh words that hold
  them, and the mesh with a byte a word saying which coordinate goes there.
  The import puts a seam triangle's far corners first (A, or A and B, turning
  its corners round), so each is one run. megamix.c's `seams_build` carries
  the far points into S's frame (H⁻¹C p, `carry`, shared with the midriff).
  It sends one whole seam a frame to polygon RAM (player 1 at 0x1000, player
  2 at 0x3000; 3980 words for all 12) until all are there, and after that
  only the runs (1446 words a frame). `draw_fighter` draws each seam after
  part S, in geometrizer mode 2, so the board works out its normals from
  the points.
  - The words sent go in the frame's display list. A frame list has one of
    the 4 buffers of 0x8000 bytes. Sending every seam whole every frame, for
    two Ryos, ran over it, and MAME (whose `push_geo_data` does not wrap)
    wrote past its buffer RAM and crashed.
  - `seams_build`'s matrices and points are static. main runs on the
    supervisor stack, from 0x5FF800 up to the end of work RAM at 0x600000,
    and is near 0x5FFF00 there. 1.8 KB of locals ran off the end of RAM, and
    the caller's seam list came back as garbage, so no seam was drawn.

Checked in MAME (`sfight`, the shared build): Ryo vs Akira and Akira vs
Ryo, both drawn, each knocking the other from 140 to 0 with punches.
With the seams (#1540): Ryo vs Akira and Ryo vs Ryo in MAME, the joints
closed standing, walking and punching, and Ryo as player 2 too. On m2-hle2,
Ryo vs Ryo loads both players' seams and fights (player 2's energy 140 to
49 under player 1's punches). Its bridge has no screenshots, so (#1545)
m2hle ran on an Xvfb display of its own, grabbed with `ffmpeg -f x11grab`
while stopped (`emu_stop`), and each seam drawn alone with `set_geo_isolate`
(index = the `get_geo_captures` entry whose mesh is in polygon RAM, 0x1000
to 0x4000). 24 seam draws a frame, 12 a player, each after its part; over
10 shots of the fight the knees, hips, elbows, shoulders, wrists and neck
are closed, the seams lying over them.

The seams leave the ankles alone, and there a bent rear leg seen from the
front showed the shin part (model 4995, slot 11, one rigid part) with every
other triangle gone at its bottom: dark spikes of jeans down to the shoe,
in MAME and m2-hle2 alike. It was the faces' stored normals (#1546). The
board culls a face by its stored normal against corner C (MAME
`check_culling`, with `face` from normal · C), not by its winding, and each
face is stored with its three corners' Shenmue normals averaged. The shin is
a tube of long faces from the knee ring to the hem ring, and the hem ring's
corners share their normals with the cuff inside, so they lean down the
leg. A face whose stored normal leans θ from its own is culled while still
turned to the eye whenever it is seen within θ of edge-on, which a long
shin face at a bent ankle is. The winding, the indices and the geometry
were right: every face's normal was on its outward side, and no corner was
missing.

Only the faces the board was seen to hide changed. In the poses that spiked
(MAME frames 720, 750, 810, 858, 864 and 882 of the run below, and m2-hle2
shots t05 and t11) the cull test was run again on every shin face of both
players, slot 11 (model 4995) and slot 14 (model 4992), the two players'
rear legs being opposite legs: the matrix each shin was drawn with (MAME's
display list in buffer RAM, op 0Bh before the object; m2-hle2's
`get_geo_captures`), its stored normal and its corner C. A face counts if
the stored normal said rear (normal · C < 0) while the face's own normal
said front. Those faces, and only those, are stored with their own flat
normal (`FLAT` in tools/ryo-guest.mjs); every other face, on the shins too,
keeps the corner average, and the seams (normals worked out by the board,
mode 2) are not touched. By index in the part, with the angle between the
stored normal and the eye when the face was hidden, then the least the
face's own normal was from the eye:

- slot 11: 0 (96-119°/58°), 1 (96-102/76), 2 (92-101/80), 4 (92/89),
  6 (94/83), 7 (92/84), 9 (90-94/84), 11 (92-93/88), 13 (90-91/61),
  14 (99-104/85), 15 (108-112/84), 16 (92-107/71), 20 (118-120/86),
  21 (102-122/69), 30 (91-99/77), 34 (95-99/84), 35 (94-105/53),
  36 (92/72), and the cuff's inner cone 40 (118-119/70), 41 (116-120/70),
  42 (98-105/79).
- slot 14: 0 (92-100/64), 6 (97-101/86), 14 (99-100/66), 17 (94-106/60),
  18 (94-115/51), 20 (90/80), 24 (91-102/47), 25 (102-104/84),
  26 (91-112/70), 27 (96-102/84).

The faces measured from m2-hle2 were all among MAME's. The rear legs alone
were not enough: correcting a front shin's face 0 without its neighbour 17
drew a dark sliver off that ankle, so every face hidden on any of the four
shins in those frames is in. A face's lean from its corners' normals does
not predict it: 4, 6, 7 and 9 lean under 15°, while slot 11's 12, 22, 28
and 29 lean 16-24° and were never hidden. Outside the spiking frames the
run still hides a few shin faces (slot 11's 26, 27, 32; slot 14's 1, 2,
13, 31, 34, 72-90° from the eye) with no spike seen; they are left as they
were, and so are the other parts' leaning faces (the chest, the arms, the
feet).

Those eight were checked in the frames (#1549): a build with them flat too,
the same run, 32 frames, every pixel that differs and lies on one of them
traced to its face. None opens a hole or a spike. They are near edge-on,
so drawn they only add pixels along the leg's outline: 26 adds none, 13, 27
and 31 at most 5 pixels a frame, 34 at most 8, 32 a line up to 2 pixels
wide (P1's rear shin, frame 822). The largest are slot 14's face 1 and face 2,
a wedge up to 3 pixels wide at the back of a cuff (face 1: P1, frame 870;
face 2: P2, frame 840). At 2x the frames with and without them look the
same, and the shoe meets the hem in both. Flat, they also relight wherever
they are seen (up to 130 pixels a frame elsewhere on the shins, frame 858), so they stay
on their corners' normals.

Checked in MAME (Ryo vs Ryo, the same inputs, frames 720 to 906 every 6,
against the ROMs before the change): the main ROMs are byte for byte the
same, and only the two shin meshes differ in the polygon ROM. A third build
with the corrected faces collapsed to a point shows where they land. Every
one of the 28479 pixels that changed across the 32 frames is on a corrected
face in one build or the other, and every other pixel is the same as before.
The bent rear shins are whole in all six spiking frames, and each shoe
meets its hem with no gap, so the ankle needs no seam. On m2-hle2, shots
t05 and t11 are whole too.

**The back of the collar** (#1549, "the back of the jacket looks funny
while he blocks"). Ryo vs Ryo: frames 701-1000 P1 holds Barrier while P2
punches and kicks, then the other way round, a shot every 4th frame. While
P1 blocks, the camera sees his back. Run against every chest and head face
in each frame's display list, the same test finds 68 chest and 46 head
faces that the board hides while they face the eye. A build with all of
them flat, painted magenta, and another with them magenta but left on their
corners' normals show which pixels flattening fills for the first time.
On P1's back only chest face 100 fills a hole there: the collar where it
stands up behind his neck. Without it a patch of neck about 6 by 2 pixels
shows through, a notch in the collar, in every frame his back is seen, 13 to 16
pixels a frame. The others fill pixels that were already dark jacket at the
hem (229, 231, 233, 192, 131; no visible change), or relight faces that
were already seen. The head's flagged faces change 12 pixels on his upper
body over the 75 blocking frames. Face 100 is flat now. Against the build
before it, 2156 pixels change over 150 frames, all on P1, and all but 70
are inside face 100's outline on the screen (those 70 lie within a pixel
of it). Nothing else changes: not the shins, not the seams, not P2.

**Graded against the Dreamcast** (beta 0.400 disc 3's Free Battle in Flycast,
full body beside a MAME shot, mean colour per region): the shape and
proportions match (head ≈ 0.135 of his height in both), and so does the hue
of every part within 5° except the jeans (190° against 211°, too cyan). The
colours are too saturated: hair, skin and jacket s ≈ 0.97-0.99 against
0.47-0.69, so the skin reads orange (85,33,1 against 102,72,47) and the
jacket black-brown. The jeans are also too dark (v 0.08 against 0.19). The
shoes match. The cause was the output curve (Colour above).

Graded again (#1540) the same way, after the fit was moved onto what is
shown: a new Free Battle shot (Ryo seen from behind, so the skin is his
neck and ear) and MAME's `sfight` at frame 760 of Ryo vs Akira. Mean colour
per region, then its hue, saturation and value; the jeans are two boxes
(thigh and shin) clear of the floor, and "med" is the median hue of their
coloured pixels:

| part   | board, 68a318c         | board, hue kept        | Dreamcast              |
|--------|------------------------|------------------------|------------------------|
| hair   | 26° 0.75 0.03          | 26° 0.75 0.03          | 34° 0.40 0.05          |
| skin   | 27° 0.68 0.43          | 27° 0.68 0.43          | 27° 0.61 0.45          |
| jacket | 25° 0.79 0.15          | 22° 0.81 0.15          | 25° 0.76 0.20          |
| jeans  | 179° 0.46 0.13 (med 195°) | 190° 0.48 0.13 (med 202°) | 211° 0.52 0.15 (med 211°) |
| shoes  | 197° 0.03 0.28         | 213° 0.03 0.28         | 217° 0.13 0.29         |

The skin and jacket are within 3° and 0.07 of saturation of the
Dreamcast, and the shoes are the same grey, a touch less blue (s 0.03
against 0.13); the jacket and jeans are a little darker (the stage's light is
not the warehouse's). The hair is near black in both, where saturation
means little. The jeans were the one part still clearly off, 32° too cyan:
green and blue stopped at the top row (Colour above). With the hue kept they
are 21° off by the mean, 9° by the median. What the fit wrote for the jeans
(parts 9, 10, 11, 13 and 14, every face, at each texel's full-light luma)
is 203° (201-205° part by part), against 206° in the texture itself. Dimmed
to 0.5 of that luma it stays 203-205°, so dimming does not move their hue,
and the screen's median (202°) is the fitted colour. Of the 21°, about 13°
is in the screen's mean and not in what the fit wrote. That mean is not
explained (a few off-hue pixels in the boxes, not traced). 3° is the fit
(206° to 203°), and 5° is the texture against the Dreamcast's own screen
(206° to 211°), which no fit to the texture can reach. The first Dreamcast shot (#1536) gave
hair 29° 0.47 0.05, skin 27° 0.54 0.40, jacket 25° 0.69 0.12, jeans 211°
0.60 0.19 and shoes 217° 0.17 0.25, close to the new one.

Reaching Free Battle on disc 3 (from 1ST_READ.BIN, base 0x0C010000): the
title's extras menu (table 0x0C29E008: debug, OPTION, SPACE HARRIER, HANG
ON, STAFF ROLL, FREE BATTLE) opens when Start comes while the title state
(0x0C226100) is 0. That is the first moments after the title appears at
boot; in state 2 Start gives the START MENU instead. The triggers (game
bits 0x00C0, the pad byte-swapped) step the items. FREE BATTLE needs disc
number 3 (0x0C0200E4) and sets scene 3, area `MFBT`, entry 99
(0x0C20D220/4/8). Start begins it. In RetroArch the triggers need keys
(`input_player1_l2/r2`).

## The fight

The rounds run on StF's own code, lifted by `tools/lift-stf.py`; the board
sets up what StF's game loop would have set up around it.

- Contact: `coli_init` runs as a task at each round start, and `rob_init`
  points rob+0x1D00 at the fighter's ball list. The 0x3B copro op (fighter
  against fighter) takes its masks from the rob+0x1D14 tables, which
  `decide_coli_kind` picks from `off_1008`. That table's eight pointers run
  on past its label through `off_1010` into `off_1018`, so the lifter keeps
  such tables whole (`RUN_ON`, both labels). Without that, player 2's table was garbage
  and the fighters passed through each other.
- Throws: P+G (`ACT_RC_NAGE_TOUCH`) grabs only on rob+0x720 bit 12, which
  `get_en_info` sets against the numbers 0x5550 (facing) and 0x1018 (the
  victim's 1A4). stfdisasm labels them `loc_5550` and `off_1018`, and the
  lifter turns them back into numbers (`NUMBERS`). As labels they were
  0x48D0 and 0x427C, a mask with the standing bit 9 in it, so no P+G
  grabbed anybody, StF's fighters or Akira (docs/SHARED-CODE.md L1).
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
  +0x26, and `camera_place` at the position (+0x18..+0x20). That position
  is the eye in fighter units, and it is passed as it is: StF translates
  by it before the 1.6 scale, so a stage point v lands at R (1.6 v − eye)
  and the ring is drawn at the size the walls (stage_x 8.0) give it. In real
  StF the fighters are drawn on the unscaled matrix (rob+0x2A40 equals the
  camera at 0x5010F8, unit columns), and so does the board (`cam_l`).
  Until now the board passed the eye times 1.6 and drew the fighters on
  the scaled matrix: the fighters came out right, but the ring was drawn
  1/1.6 its size around them (they walked out past the ropes) and the
  camera sat on the near rope, which cut across the view. Check: MAME and
  m2-hle2, Sonic and Honey walked back to x −6.9 and 7.3 stand inside
  the ropes, the near rope across the bottom of the picture; Akira's
  punches still take Honey 140 → 132 → 125, and hers him to 127, 116.
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
- A second window at the top right (`poly_win_draw`) counts the last
  frame's polygons while the setup is up: each fighter's faces (by name),
  the stage's and the total, then StF's own count and limit. A face count
  is the high half of the model header's word 3 (obc), summed for every
  object submitted (seams and the midriff with their fighter); the low half
  is the link count, culled links too. StF's `POLYGON` is the coprocessor's
  running sum of link counts (the board's `g_cop_p`, which `set_obj` and
  the board's submits hand it and read back), and its boot sets
  `POLYGON_LIMIT` to 5000, past which `set_obj` draws no more objects; the
  board shows both and does not stop. Ryo's meshes have a culled link after
  every triangle, so he costs about twice his faces in links:

      MAME, settled              1P    2P  stage  faces  links
      Sonic vs Honey, S. Island  784   750  1286   2820   3155
      Ryo vs Ryo, South Island   288   288  1286   1862   2735
      YKB_M (RYO_MODEL=M):
      Ryo vs Ryo, South Island  1793  1793  1286   4872   8646, 8763
      Ryo vs Ryo, Aurora        1793  1793   640   4226   8022

  The faces are the same every settled frame; the coprocessor's link count
  moved by about a hundred between two runs of the same menu (8646, 8763),
  which the header sums do not explain (not looked into).

  Ryo's 288 (YKB_M's 1793) is the import's count, his seams' faces in
  it. After a fighter changes, his seams come in one a pass, so his
  count climbs for a few passes.

## Where it stands

Two fighters (Sonic, Honey, Eggman, Akira or Ryo, picked in the setup) stand
facing each other and play their stance motion with StF's own motion code
(stepped and drawn at 60 fps, as StF and VF2 are), on one of two of
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
