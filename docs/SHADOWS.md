# The fighters' shadows

Each game lays a flat model under each part of a fighter, slid along the
stage's light onto the floor. All three build the same three projections
and walk the same kind of table, but they share out the work in their own
way. Sonic the Fighters is the parent: the board runs StF's code and StF's
coprocessor firmware, so a fighter from any game gets its shadows the way
StF draws them, from its own data put into StF's form.

`tools/shadow-data.mjs` reads every roster fighter's table and every roster
stage's light from the three ROM sets and prints them in StF's form
(`--json` for all of it). `tools/import-assets.mjs` keeps the shadow models
of the board's StF fighters in the data ROMs. Nothing is drawn yet.

## Sonic the Fighters

StF's i960 code (`stfdisasm`, "Shadow (kage)" in its comments) sends the
light and the parts; the coprocessor does the maths, in three ops from
Fighting Vipers' copro source (decompiled from the Sega Ages release in
`m2-hle2/vendor/ages-c/decomp/FV/COP`: `73_Fn_kage_mat.c`, `74_Fn_kage_poly.c`,
`75_Fn_kage_flag.c`). StF's cpres1, which the board boots, has them.

### The light: op 0x73, `Fn_kage_mat`

`sub_63AC4` (from `camera_init`, each frame) copies `VECTER_X` and
`VECTER_Y` (0x501020/22) to 0x5019AC/AE, and `rob_kage_set_matrix` sends
them (a0 the elevation, a1 the azimuth). The copro builds three inner
matrices, as noclip's `js/fightershadow.js` has them for VF2 and FV, with
r = a1 ^ 0x8000:

- `inner[0]` = Ry(r) S(1, 0, 1) Rx(a0 − 0x4000) Ry(−r), the flattening;
- `inner[1]` = Ry(r) S(1, 1, 1/sin a0) Ry(−r), for parts over the ring;
- `inner[2]`, the same moved by (0, g, −g cot a0), for parts off it.

g is the copro's RAM word at +0x2000, which op 0x70 (`Fn_area_coli`)
stores from its second argument: `stage_soko` (0x50A010). The light is the
stage record's (`stage_data`, 0x8F3D0 + 256·stage: `+8` VECTER_X, `+0xA`
VECTER_Y), copied by `change_scene`; `sub_29350` sets `stage_soko` from
`+0xC8`.

### The masks: op 0x75, `Fn_kage_flag`

`sub_63B10` calls `rob_kage_set_flag_sub` for each player: on a player
whose rob +0 has bit 7, on alternate frames (rob +4, the player, against
the low bit of `frame_counter`), it sends the player, `byte_64938[stage]`
(a round test: stages 3 and 7), the slide 0x501990/94 and the ring's
margins, and gets back two masks of sixteen slots: rob +0xAA8 (on the
ring) and +0xAB8 (off it). Without bit 7 both are 0.

- The slide: kx = −sin(a1 + 0x8000) cot a0, kz = cos(a1 + 0x8000) cot a0,
  worked out by `loc_23144` with ops 0x21, 0x22, 0x24 and 0x25.
- The margins: near = `stage_x` · `stage_floats[stage]` − 1.3, far = the
  same + 0.2 (`stage_x` is 8.0; `stage_floats`, 0x64948, is 1.6 or 1.0).
- The test: for each slot, one ball of the player's collision balls (the
  copro's points from word 16000, player 2's from 0x7E80; by the reads,
  not yet traced to their writer), slid along the light onto y = 0, its
  distance max(|x|, |z|), or 0.707106 · hypot on a round stage. Near if
  the ball is at or above the floor and within near; else far if at least
  far; else neither.
- Which ball each slot tests is the table at 0x4C84, the same for every
  character: `9 0 2 3 4 5 6 7 8 9 10 11 12 14 15 16` (slot 0 uses ball 9).
  `send_kage_ball_pntr` (from `cop_initialize_end2`) writes it into the
  copro's 0x306E0 (player 1) and 0x307E0 (player 2). The board already
  runs it.

### The draw: op 0x74, `Fn_kage_poly`

Two passes a player, each `rob_kage_disp_test` with a mask (g4) and an
inner matrix (g5):

- inside, `rob_kage_disp_inside` from `camera_init` after the stage: the
  near mask on `inner[1]`. With `stage_soko` 0 it takes all sixteen slots
  and clears the far mask. Not run on stage 2 (Aurora Icefield), nor for
  a player whose `camera_init` flags (g13 +0) have bit 28 (player 1) or 29
  (player 2). It goes on to the projectiles' shadows (`tobi_kage_set_flag`,
  `tobi_kage_disp`).
- outside, `rob_kage_disp_outside` from `rob_low_disp`, after `rob_disp`:
  the far mask on `inner[2]`, unless the stage record's flags (+0) have bit
  28 (stages 1 and 2).

`rob_kage_disp_test` sets `set_mmode` 2, loads the camera (op 0x44, inner 0)
and walks the character's table, `off_64988[rob +0x1B0]` (player 2 is the
character + 26): sixteen entries of 24 bytes and an 8-byte tail.

| bytes | |
|---|---|
| +0 | slot (u32) |
| +4 | model (u32), 0 for none |
| +8 | flags (u32): bit 0 lay the x axis flat (`Fn_kage_leave_x_axis`), bit 1 the z (bit 1 wins), bit 2 move by the offset first |
| +12 | offset x, y, z (f32) |
| tail +0 | model of the extra part (u16) |
| tail +2, +4 | models of the extra part on rob +0 bit 27; +4 when bit 6 |

For each entry whose slot is in the mask, op 0x74 gets the player, slot · 12
(its matrix), the flags, the offset and g5. The copro takes `inner[0]` ·
the slot's matrix, adds the offset, lays an axis flat, puts `inner[g5]` in
front; `set_obj` draws the model. Two exceptions:

- slot 9 is skipped while the move flags (rob +0x1A4) have bits 14 and 16;
- slot 0 with rob +0x2068 = 1 (the ball, a spin) is model 0x195 under a
  scale of rob +0x2074..+0x7C.

Then the extra part, if its model is not 0: on rob +0 bit 27 clear, the
matrix at rob +0xF34 + 0x34 · rob +0xF00, needing rob +0x78A and the slot
rob +0x788 in the mask; on bit 27, slot rob +0x7A0 (op 0x37), needing rob
+0x7A2. All of StF's tables have a tail of zeros, so no StF fighter uses it.

StF's tables (`node tools/shadow-data.mjs`) are flat cards, flags 0, one a
part (Sonic models 25 to 39, Honey 3822 to 3836, Eggman 1847 to 1860; slot
9 is Sonic's model 33 on every character but 11).
Character 26, player 2's Sonic, points at a table of its own, 0x64EA8,
in VF2's style: offsets, three cards on slot 1 and flags 1, 2, 5 and 6.
That one has not been checked in MAME.

## Virtua Fighter 2

The same projections and entries, but the i960 does more of it (noclip
`TECHNICAL.md`, "The fighters' shadows"):

- the light from the stage record (0x6EE38 + 256·stage, `+0x70`/`+0x72`),
  the ring 8 and the ground −0.5;
- the masks on the i960 (0x61A14), testing the middle ball of each slot's
  list;
- fifteen entries a character, the tables at 0x61CFC by +0x1B1 mod 13 (no
  player 2 table: player 2 changes only colours);
- flags: bit 0 lays the x flat, anything else the z. In StF's terms: x if
  bit 0, else z; bit 2 is the offset in both.

The models are VF2's (Akira 343 to 424), one a part, with offsets on
some.

## Fighting Vipers

FV's copro is the source of StF's ops, and its flags mean what StF's do. It
adds, all from its own tables (noclip `TECHNICAL.md`, "The fighters'
shadows", "Fighting Vipers' wall shadows", "The pieces' floor shadows"):

- 26 tables by +0x1B0 (player 2's look 13 on), fifteen entries each;
- the light from its stage record (0x6CE1048 + 256·stage, `+8`/`+0xA`,
  the same place as StF's), the ring 5 and the ground by stage;
- the stage flags (0x6442BA8 + 12·stage) that stop the shadows (bit 8, the
  mirror; bit 31, Bay Side), and a round test on stages 0 and 4;
- the Factory's four lamps (the light from the nearest one);
- the wall shadows on Bay Side and the flying armour pieces' shadows.

## Putting a fighter's shadows on the board

What the board will need, in StF's form, for a fighter from any game:

1. Its table: 16 entries and a tail, as `tools/shadow-data.mjs` writes it.
   A VF2 or FV fighter's fifteen entries keep their order, the slot they
   lack (slot 0, as in StF's) comes last with model 0, and VF2's flags are
   turned into StF's. StF's own tables are in the program ROM (0x64988 to
   0x66CB8), which the board replaces: the lifter or the import has to put
   them, and the guests', where the board's `off_64988` reads.
2. Its models: StF's fighters' are in the data ROMs now (45 models). A
   guest's (Akira's VF2 343 to 424) have to come in through its import,
   renumbered as its other models are.
3. Its balls: the mask test takes ball `0x4C84[slot]` of the fighter's
   collision balls. A guest's ball list (rob +0x1D00) has to have a ball at
   each of those indices that rides the slot's part.
4. Its stage's light: VECTER_X/Y and `stage_soko` for every stage the
   board offers; a guest stage's from its own record (`tools/shadow-data.mjs`
   prints them). FV's lamps, gates and per-stage ground would be guest
   branches, as would VF2's ring and ground.
5. The calls, in StF's order, in the board's frame: op 0x73 once the
   camera is set, op 0x75 for each player, the inside pass after the stage
   and the outside pass after each fighter.

Left for later, as in noclip: FV's wall shadows, its pieces' shadows, and
StF's projectile, name-plate (`name_char_kage_disp`) and Tails' plane
shadows.
