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
- Materials: StF's `camera_init` sends the stage's 32 material words (prog
  `0x909E0` + stage slot × 4) as GEO texture parameters every frame, each with
  its coefficient from `flt_90BA0`. `m2_obj_frame_setup` fills all 32 with one
  value, so `send_materials` follows it. Without them the palms and the
  waterfall draw white.

## Where it stands

Two fighters (button 1 cycles each player's: Sonic, Honey, Eggman) stand
facing each other and play their stance motion at 30 fps, on one of StF's
nine stages (player 1's button 2 cycles them), drawn from StF's stage records
with its textures, colours and materials. South Island matches StF's own
picture closely.

Known gaps:

- Sonic's eyes are not bent to the face's eye points (`pose.js` eyePoints).
- Player 2's part rows (7..11, luma 48..63) get the fighter's own table, as
  player 1's do. In a 1P round against the CPU, real StF leaves them at zero.
  Mirror matches in real StF (MAME `sfight`, 2P; Honey vs Honey by setting
  slot 0 of the select table at 0xDACAC to 0x0F) draw player 2 as the board
  does: Sonic dark grey, and Honey blonde, with purple fur, a blue dress, a
  blue hairband and white barrettes.
- No stage colour cycling, no sky model or backdrop colour, no stage light
  vector (the SDK's fixed light), no camera of StF's, no shadows.

## Plan

1. The stage's light and sky.
2. The fight: port `js/engine.js` to C (input, commands, moves, hits,
   reactions, rounds), versus only.
3. Motions: baking every motion takes too much room in the program ROM
   (768 bytes a frame). Either bake per-joint angles, much smaller, or port
   the solver to the board (`calc_rob_angle_cont` uses the coprocessor's IK,
   op 0x6B).
4. VF2's and Fighting Vipers' fighters and stages: their models, textures
   and colours go into the data ROMs (StF's unused runs, see
   `STF-BOARD-AKIRA.md`), which then ship as new ROM files beside the
   program.

`STF-BOARD-AKIRA.md` records the earlier route (Akira dropped into StF's own
program by data edits). Its measurements of free ROM and texture RAM still
apply; its attract and select findings do not, since this program has its
own screens.
