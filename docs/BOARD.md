# The board build

`board/` is Fighters Megamix as a new program for the Sonic the Fighters board
(Model 2B, MAME `sfight`), built on [m2-sdk](../../m2-sdk). It replaces the
two program EPROMs (epr-19001/19002) and nothing else. It is not a patch of
Sonic the Fighters: StF's program is the map (its disassembly, its symbols in
`stf-fly/data/symbols.json`, and Sega's own C for its hot functions in
`m2-hle2/vendor/gems-c`), and its data ROMs stay on the board as the asset
store.

The aim: a versus-only fighter (two players, no CPU) with fighters and a few
stages from each of the three games, as in the browser game.

## Building and running

```sh
node tools/bake-board.mjs                       # board/src/poses.h, from $ROMS_DIR's zips
cmake -G "Unix Makefiles" -B <build> -S board   # m2-sdk beside this checkout
make -C <build> -j2                             # -> board/roms/sfight/epr-19001.15, epr-19002.16
mame sfight -rompath "board/roms;$ROMS_DIR"
```

MAME reports wrong checksums for the two program EPROMs; that is expected.
`M2_HLE_GEO_OFF=1` in the environment runs MAME's real geometrizer program
instead of its HLE; both draw the same picture.

`poses.h` and `roms/` hold Sega's data and are not in git.

`board/src/stf_tex_codec.h` is the SDK's `m2_tex_codec.h` with a bigger
table B (2048 entries, not 512): StF's stage sets need up to 1178, and the
SDK's size drops six of their pages. It keeps the SDK's include guard and is
included in place of it; the SDK itself is used unchanged.

## How a fighter is drawn

StF's `calc_unit_mat` builds each of the sixteen part matrices on the
coprocessor's matrix stack and stores it (op 0x35). Here the matrices are
solved ahead of time by the browser game's solver (noclip's `pose.js`, which
follows the board's `calc_rob_angle_cont`), frame by frame, by
`tools/bake-board.mjs`. On the board each part's matrix is the fighter's
placement times the baked one, loaded with op 0x04 (`Fn_load_matrix`: three
columns, then the translation, the layout `pose.js` uses) and drawn with op
0x78 from the model table, as `m2_obj.h` does.

- A motion's forward is +x in the board's frame; y is up in both the board's
  frame and the camera's.
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
  coprocessor ops on its own camera (`stage_light`, once a stage) and sends
  it every frame after `m2_obj_frame_setup`, whose fixed light is one frame of
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
- Materials: StF's `camera_init` sends the stage's 32 material words (prog
  `0x909E0` + stage slot × 4) as GEO texture parameters every frame, each with
  its coefficient from `flt_90BA0`. `m2_obj_frame_setup` fills all 32 with one
  value, so `send_materials` follows it. Without them the palms and the
  waterfall draw white.

## Where it stands

Two fighters (button 1 cycles each player's: Sonic, Honey, Eggman) stand
facing each other and play their stance motion at 30 fps, on one of two of
StF's stages, South Island and Aurora Icefield (player 1's button 2 switches
between them). The stages are drawn from StF's stage records with its
textures, colours, materials, light, colour cycling, and the sea and
aurora. South Island matches StF's own picture closely. Further stages will
come from VF2 and Fighting Vipers.

Known gaps:

- Player 2's part rows (7..11, luma 48..63) get the fighter's own table, as
  player 1's do. In a 1P round against the CPU, real StF leaves them at zero.
  Mirror matches in real StF (MAME `sfight`, 2P; Honey vs Honey by setting
  slot 0 of the select table at 0xDACAC to 0x0F) draw player 2 as the board
  does: Sonic dark grey, and Honey blonde, with purple fur, a blue dress, a
  blue hairband and white barrettes.
- Aurora Icefield seen from real StF's intro camera (frame 84 of the stage,
  a24 2247, a26 −28455): the board draws a large light-blue shape across
  the middle of the picture, and real StF does not draw it. Not yet
  traced.
- No camera of StF's, no shadows.

## Plan

1. The fight: port `js/engine.js` to C (input, commands, moves, hits,
   reactions, rounds), versus only.
2. Motions: baking every motion takes too much room in the program ROM
   (768 bytes a frame). Either bake per-joint angles, much smaller, or port
   the solver to the board (`calc_rob_angle_cont` uses the coprocessor's IK,
   op 0x6B).
3. VF2's and Fighting Vipers' fighters and stages: their models, textures
   and colours go into the data ROMs (StF's unused runs, see
   `STF-BOARD-AKIRA.md`), which then ship as new ROM files beside the
   program.

`STF-BOARD-AKIRA.md` records the earlier route (Akira dropped into StF's own
program by data edits). Its measurements of free ROM and texture RAM still
apply; its attract and select findings do not, since this program has its
own screens.
