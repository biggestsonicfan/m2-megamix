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
node tools/bake-poses.mjs                       # board/src/poses.h, from $ROMS_DIR's zips
cmake -G "Unix Makefiles" -B <build> -S board   # m2-sdk beside this checkout
make -C <build> -j2                             # -> board/roms/sfight/epr-19001.15, epr-19002.16
mame sfight -rompath "board/roms;$ROMS_DIR"
```

MAME reports wrong checksums for the two program EPROMs; that is expected.
`M2_HLE_GEO_OFF=1` in the environment runs MAME's real geometrizer program
instead of its HLE; both draw the same picture.

`poses.h` and `roms/` hold Sega's data and are not in git.

## How a fighter is drawn

StF's `calc_unit_mat` builds each of the sixteen part matrices on the
coprocessor's matrix stack and stores it (op 0x35). Here the matrices are
solved ahead of time by the browser game's solver (noclip's `pose.js`, which
follows the board's `calc_rob_angle_cont`), frame by frame, by
`tools/bake-poses.mjs`. On the board each part's matrix is the fighter's
placement times the baked one, loaded with op 0x04 (`Fn_load_matrix`: three
columns, then the translation, the layout `pose.js` uses) and drawn with op
0x78 from the model table, as `m2_obj.h` does.

- A motion's forward is +x in the board's frame; y is up in both the board's
  frame and the camera's.
- Textures: StF texture set 1 (the fighters) is loaded with `tex_load_atlas(1, 0)`
  from the texture ROM. Every face of these models samples texture RAM: with
  the wrong bank parity they all draw black.
- Colours: `m2_load_model_palette` copies each part's colour bases from the
  polygon palette ROM.

## Where it stands

Two fighters (button 1 cycles each player's: Sonic, Honey, Eggman) stand
facing each other and play their stance motion at 30 fps, on a plain
backdrop.

Known gaps:

- Sonic's eyes draw grey. StF bends the eye models to the face's eye points
  (`pose.js` eyePoints); the board draws the models unbent. Not yet known
  whether that or a texture tile `tex_load_atlas` skips (it skips tiles in
  the both-high corner of a sheet) is the cause.
- No stage, no camera of StF's, no shadows.

## Plan

1. A stage: StF's stage records (prog `0x8F3D0`) and their texture set on
   sheet 0.
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
