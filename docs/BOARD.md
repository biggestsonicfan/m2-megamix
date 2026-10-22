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
  `loc_2B9CC`, which picks the crouching half of the list.
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
  size.

He walks, attacks, hits, takes hits and goes down, as player 1 or 2 or both.
StF's command interpreter keeps its backtrack base at 0x1214(g13), where g13
is the fighter's rob, so the board runs `sub_1D47C` as a task (`stf_task`).
With g13 left over from C, Akira's first failed match backtracked off the
stack. StF's own scripts never fail all the way back, so they had not shown
it.

Known gaps: his hand shapes change without easing. While he is on, his
colours take rows 0..6 (7..13 for player 2), which includes StF's fixed rows
5/6 (12/13).

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
  The board starts it at 30 << 6 and counts it down once a frame.
- A round ends on a KO (rob w0 bit 5, energy at +0x1AC reaching 0) or when
  the clock runs out; the fighter with more energy takes the win
  (p1_wins 0x50004F, p2_wins 0x500051, two to win). Three seconds later
  the next round starts with both fighters reset.
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

## Where it stands

Two fighters (start cycles each player's: Sonic, Honey, Eggman, Akira) stand
facing each other and play their stance motion with StF's own motion code
(60 Hz steps, drawn at 30 fps), on one of two of
StF's stages, South Island and Aurora Icefield (player 1's start with down held switches
between them). The stages are drawn from StF's stage records with its
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
