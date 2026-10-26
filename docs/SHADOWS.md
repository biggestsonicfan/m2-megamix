# The fighters' shadows

Sonic the Fighters, Virtua Fighter 2 and Fighting Vipers lay a flat model
under each part of a fighter, slid along the stage's light onto the floor.
All three build the same three projections and walk the same kind of
table, but they share out the work in their own way. Daytona USA, Fighters
Megamix and Shenmue, where Hornet, Ryo and Chai come from, cast theirs
otherwise (The board's other guests, below). Sonic the Fighters is the parent: the board runs StF's code and StF's
coprocessor firmware, so a fighter from any game gets its shadows the way
StF draws them, from its own data put into StF's form.

`tools/shadow-data.mjs` reads every roster fighter's table and every roster
stage's light from the three ROM sets and prints them in StF's form
(`--json` for all of it). `tools/import-assets.mjs` keeps the shadow models
of the board's StF fighters in the data ROMs. The board draws them with
StF's own code (On the board, below).

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
- The test: for each slot, one ball of the player's collision balls (ball
  i's world point is at copro word 16000 + 3i, player 2's at 0x7E80 + 3i,
  written by op 0x39, `Fn_coli_point_trans`), slid along the light onto y = 0, its
  distance max(|x|, |z|), or 0.707106 · hypot on a round stage. Near if
  the ball is at or above the floor and within near; else far if at least
  far; else neither.
- Which ball each slot tests is the table at 0x4C84, the same for every
  character: `9 0 2 3 4 5 6 7 8 9 10 11 12 14 15 16` (slot 0 uses ball 9).
  `send_kage_ball_pntr` (from `cop_initialize_end2`) writes it into the
  copro's 0x306E0 (player 1) and 0x307E0 (player 2), once for all
  characters. The board already runs it. A number in it is an index into
  the fighter's 32-ball record (`rob_coli_ball_types`, record +0 the balls,
  +4 the part each ball rides). It fits Sonic's record exactly (slot s takes
  a ball on part s); Honey's and Eggman's have one ball fewer up front, so
  on them it takes each slot's next part's ball (slot 9 tests a thigh
  ball), and StF lives with that.

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

StF's tables (`node tools/shadow-data.mjs`) have flags 0 and one model a
part (Sonic models 25 to 39, Honey 3822 to 3836, Eggman 1847 to 1860; slot
9 is Sonic's model 33 on every character but 11). Those models are not
flat: each is a low solid of the part (noclip's `decodeModel`: Sonic's
head, 26, 74 faces 1.9 m across with the quills; his chest, 25, 43; a limb
6 or 9, a three-sided prism), which op 0x74's `inner[0]` flattens. A
table is 209 to 265 faces (Honey 209, Tails 246, Sonic 251, Eggman 265).
VF2's and FV's are two quads a part.
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

## The board's other guests

Ryo, Chai and Hornet come from games that cast shadows another way.
StF's own `off_64988` would give each guest the table of the StF character
whose slot it takes (`tools/shadow-data.mjs` prints this): Ryo, character
1, Tails' cards (0x658D0, models 57 to 71); Chai, 12, and Hornet, 17,
Sonic's (0x65748); Akira, 6, Knuckles' (0x65BE0). StF's cards on a guest's
slots are the wrong shape (on Hornet, slot 1 is the nose and slot 9 the
cabin), so the board gives each guest a table of its own
(`tools/guest-shadows.mjs`, On the board, below).

### Daytona's Hornet (Model 2)

Daytona USA (rev A, `daytona`) lays one flat card under each car, squashed
onto the road by an ordinary scale. There is no light, no copro op and no
texture. (Read in rev A's code with stf-tools' `i960dis.mjs`; the models
decoded with noclip's `decodeModel`; not run in MAME.)

- **The models.** The player's car is model 791 (record 0x02843980): 6
  untextured black quads at y = 0 in a car's outline with tapered ends, x
  ±1.00 m, z −2.35 (the front) to +2.50. That is 2.0 × 4.85 m, a little
  wider than the 1.74 m body, so it covers the tyres. It has the checker bit
  (texheader bit 15), so it draws every other pixel, the board's
  half-transparency. The rivals' card is model 800 (0x02843A34), the same
  outline in 4 quads without the checker bit, solid black.
- **Where.** The player's car, 0x7598 (called from 0x74F0), after the
  body (0x7D38) and the tyres (0x7FB4), at 0x7738 to 0x785C: push;
  T(+0x1C, +0x20, +0x24), the car's x and z and the road's height (+0x20,
  without the car's height +0x5C); RY(+0x4E) RX(+0x4C) RZ(+0x50), the car's
  heading, pitch and roll; S(1, 0.01, 1) (op 0x13, at 0x77CC); RZ(+0xA2)
  RY(+0xA0) RX(+0x9E), the body's sway; model 791; pop. So the card lies
  flat along the road's normal. Every car type uses 791. It is skipped
  when 0x5014A4 is 2, probably the in-car view.
- **Rivals.** `dsp_other_car` (0x8298) draws 800 the same way at detail
  levels 4 to 2 (0x8970, 0x8D68, 0x9144) and none at level 1. At most 3
  shadows a frame are drawn (the count at 0x501120, zeroed at 0x1848): the
  player's and the first two rivals in the list.
- **The balls the cards would hang off** (#1600; read from `hornet-board`
  ae5eefa, `hornet-guest.mjs` and `ryo-guest.mjs`'s `fitBalls`; not run).
  Hornet's 32-ball record is Akira's VF2 one (VF2's one set for its cast,
  30 balls at 0x020078A8), each ball kept on its VF2 part and its index,
  and moved into his part's box where he has a model there. VF2's
  balls by part: 1: 0, 1; 2: 2; 9: 3; 3: 4, 5; 4: 6, 7; 5: 8; 6: 9, 10; 7:
  11, 12; 8: 13; 10: 14-16; 11: 17-19; 12: 20, 21; 13: 22-24; 14: 25-27; 15:
  28, 29. Through StF's 0x4C84:
  - **slot 1, the nose: ball 0**, on part 1. It rides the nose, fitted to
    its box. This one holds.
  - **slot 9, the cabin: ball 9**, on part 6, the right shoulder. Hornet
    has no model on slot 6 (a one-point part), so the ball is Akira's
    scaled by `k` and hangs off the chest, the nose's frame, at FM's
    shoulder bone (0.25, 0.02, 0.17): by the bones, near the door line,
    not over the cabin (where it lands in a pose was not run). The cabin has a
    ball: **ball 3**, VF2's only part 9 ball, fitted to the cabin's box.
    No index points the cabin's test at it.
  - So the split card holds for the nose but not as it stands for the
    cabin: its card would go in or out of the inside and outside passes by
    a point on the nose's frame, which is wrong where the car crosses the ring's
    margin (the car is 4.9 m long). Either Hornet gets a 0x4C84 of his own
    with slot 9 on ball 3 (sent per player at round start, since
    `send_kage_ball_pntr` sends one table for both), or his balls 3 and 9
    swap places in his record. The swap also changes which index each hit
    and hurt mask (rob +0x1D14, op 0x3B) means, so the table is the safer
    of the two. The wheels' slots (5, 8, 12, 15) take balls on parts 3, 5,
    11 and 14, but their entries have model 0, so they don't matter.
  - Akira, Ryo and Chai have the same VF2 record, so 0x4C84 tests the
    wrong part's ball for most of their slots too (slot 3 a pelvis ball,
    slot 9 a shoulder's). A by-character table fixes them all: VF2 tests
    each slot's middle ball.
- Model 770 is no shadow: it is a green and grey card that no code reads.
  `docs/FM-SATURN.md`'s "model 770 under them" (on `hornet-board`) is wrong
  about that.

### Fighters Megamix's Hornet (Saturn)

FM (the prototype of Apr 08, 1997; read in Ghidra, not run) has two kinds
of shadow, picked by the fighter row in FUN_06019440, which
FUN_06019008 calls before it draws the body. It skips the shadow if player
+0x67 has bit 1, or if the fighter is off the ring (|x| or |z| beyond
`*0x060E10A4`) and `*0x060E10B0` is 0.

- **Everyone but Kuma, Bark and Hornet** (FUN_0601948c): VF2's way with
  one set of models for all. FUN_06019516 builds Ry(r) S(1, 0, 1/sin a0)
  Rx(a0 − 0x4000) Ry(−r) from the light at 0x0607A454 (elevation 0x2800,
  negated and clamped to 0xA000..0xE000, the azimuth 0x8000), which
  flattens onto y = 0 along the light. It draws 7 shared closed prisms,
  each on its part's matrix (table 0x06075688): the chest (slot 1), both
  upper arms (3, 6), both thighs (10, 13) and both shins (11, 14). There are
  none for the head, the forearms or the feet. The VF2 cast's own models are
  not used.
- **Kuma, Bark and Hornet** (rows 10, 12, 14; FUN_060194d2): one ellipse
  (0x06086D8C, 17 points and 16 polygons, outer half-axes 0.31 × 0.25 m)
  at slot 1's x and z on y = 0, with no turn, so it keeps the world's
  axes. It is scaled by (2k, 0, 2k), where k is a stack word no code found
  so far writes, so its size is not known.
- Each model slot 0, which `docs/FM-SATURN.md` calls the shadow, is a 4-point
  square of 2 to 5 cm that no code draws.
- The draw (FUN_06020d88) sends every face as a VDP1 polygon of colour
  0xFFFF, in replace mode, at a fixed sort depth 0x5000. How that colour
  comes out dark (a VDP2 sprite shadow setting, probably) is not found.

The board's Hornet is Daytona's car, so his shadow should be Daytona's
791 too, not FM's ellipse.

### Shenmue's Ryo and Chai

Shenmue (beta 0.400, disc 3; `1ST_READ.BIN` at 0x0C010000, not scrambled)
casts a fighter's shadow as a PowerVR modifier volume, not as a flat
model. Neither his models nor their textures have anything for it.

- **The mode.** Each character's `Shadow{...}` block in a scene's
  MAPINFO.BIN (Image, Mode, Position, Scale, Yang, Height; read by
  0x0C179EC8) sets char +0x7C. In the free battle (SCENE/03/MFBT) Ryo
  (`AKIR`) has Mode 4, his mode nearly everywhere on disc 3. The
  dispatcher is at 0x0C113F4C (jump table 0x0C113F70):
  - modes 0, 1, 6 and 10 flatten a stand-in man (MISC/COLD.BIN entry 11,
    `SYD_S.BIN`, 13 untextured meshes on the same bones) onto the ground
    at y + 0.013 (0x0C17978A), and modes 7, 8 and 11 do the same with the
    character's own model;
  - modes 2, 3 and 9 go to 0x0C179C2C (not read);
  - modes 4 and 5 (0x0C12DE3C) build a shadow volume.
- **The volume.** MISC/COLD.BIN entry 7, `SYD_MUNE.BIN` (magic MVSD,
  10224 bytes, loaded by 0x0C12DC72): 13 hulls, one per bone (1, the
  head 0xFFBD, 5, 6, 0xFFBF, 10, 11, 0xFFBE, 14, 16, 17, 21, 22), 116
  points, 269 edges and 162 triangles in all (table below). There are none
  for the feet. Each hull is placed by its bone's matrix in the character's model.
  For each of up to 32 scene lights, the silhouette is drawn out along the
  light (a directional light's direction, or the light-to-character line)
  by 1.8 / −dir.y, at most 50. The caps and sides are built from 0x0C1D0F00
  and sent to the opaque modifier volume list (0x0C1D1C90). Inside it the
  scene is darkened to 127/256 (0x0C12DCB8(0.5) writes 0x17F to the shadow
  scale register, 0x005F8074).
- **Chai.** All 13 bone ids are in CHA_B and CHA_M, so the same hulls fit
  him. Which mode his ending fight (SCENE/03/MEND) gives him is not known:
  MEND has no Shadow block for him or Ryo. The only scene that lists him,
  MC5Q, gives Mode 0. Breaking on the mode's writer (0x0C0AB2A0) in that
  fight would settle it.

The board has no modifier volumes, but the copro's `inner[0]` flattens
whatever model it is given, and StF's own shadow models are solids. So
each SYD_MUNE hull can be a shadow model on the slot of its bone, flattened
by op 0x74 as StF's are. That draws the outline Shenmue's volume casts on
flat ground.

The hulls (#1600; read off disc 3's MISC/COLD.BIN, the MVSD at 0x21B880,
10224 bytes; not built or run). A node is: the bone (u16) +0, child +4,
next +8, points (3 × f32) +12, face normals +16, a work buffer +20, edges
(two u16 points) +24, faces +28 (24 bytes: the normal, three points, three
edges), and the counts of points, edges and faces at +32, +34, +36. The
slot is the board's `SLOT_BONES` (js/ryo.js on the chai branch), which the model rides on too.

| bone | slot | points | triangles | open ends | |
|---|---|---|---|---|---|
| 0x01 | 1 chest | 12 | 20 | none | x −0.14..0.41, y ±0.11, z ±0.23 |
| 0xFFBD | 2 head | 21 | 36 | one, 4 edges (the neck) | |
| 0x05, 0x0A | 3, 6 | 7 | 9 | one, 3 edges | |
| 0x06, 0x0B | 4, 7 | 6 | 6 | two, 3 edges each | a three-sided tube |
| 0xFFBF, 0xFFBE | 5, 8 | 10 | 15 | one, 3 edges | |
| 0x0E | 9 pelvis | 13 | 22 | none | |
| 0x10, 0x11, 0x15, 0x16 | 10, 11, 13, 14 | 6 | 6 | two, 3 edges each | three-sided tubes |

Take the chest: 12 points and 20 triangles on bone 1 (StF slot 1), a
closed shell (12 − 30 + 20 = 2). Every hull's faces wind the way their
normals point, and all point out. They are near convex: no point is more
than 2 cm in front of a face's plane, but the head's 4 cm. So flattened
along any light each hull covers one patch, a near-convex polygon, once by
its faces turned to the light and once by those turned away. With culling
only the first half is drawn, as on StF's solids.

One card a bone works; nothing has to be dropped or split:

- 13 hulls on 13 slots, no two on one slot, so they fit StF's sixteen
  entries; slots 0, 12 and 15 (the feet, which SYD_MUNE has none for) get
  model 0.
- 162 triangles in all, under any StF table (209 to 265), and the biggest
  (the head, 36) is under Sonic's head card (74). A Model 2 mesh holds
  triangles as they are.
- The open ends are where a hull meets the next at a joint (the neck, the
  shoulders, elbows, wrists, hips and knees).
  Flattened, a tube seen end on (a forearm pointing at the light) leaves a
  small hole, mostly under the next hull's patch. Closing each end costs a
  triangle (the neck two): 18 more, 180 in all.
- Still to do when they are built: the board's Z is mirrored from
  Shenmue's (js/ryo.js `local`), which turns every face's winding round;
  the hulls are in bone space at Shenmue's size, so they take the model's
  `shenmueFit` scale; and they take StF's
  shadow models' material. Shenmue uses the same hulls for every
  character, so Chai's are Ryo's.

## On the board

The board runs StF's routines, lifted by `tools/lift-stf.py` (roots
`sub_63AC4`, `rob_kage_disp_inside`, `rob_kage_disp_outside`; the lift
pulls in `rob_kage_set_matrix`, `rob_kage_set_flag_sub`,
`rob_kage_disp_test`, `tobi_kage_set_flag`, `tobi_kage_disp` and
`off_64988` with its tables). `megamix.c` calls them in StF's order:

- `kage_stage`, with the stage (`load_stage`): VECTER_X/Y (0x501020/22)
  from the stage's light, and `stage_soko` (0x50A010) from StF's stage
  record (+0xC8: South Island −10, Aurora 0). A guest stage has no StF
  record and gets 0: its shadows all lie on the ring, whose floor is y = 0.
- `kage_light`, each frame once the fighters are stepped: the slide
  (0x501990/94, −sinx and cosx of VECTER_Y + 0x8000 by cot VECTER_X, as
  StF's stage routines work it out), the fighters' unscaled camera as the
  current matrix, then `sub_63AC4`: op 0x73 and op 0x75 for each player.
- `kage_inside`, after the stage: `rob_kage_disp_inside` for each player
  (and the projectiles' shadows). StF skips it on Aurora Icefield, where it
  mirrors its fighters in the ice instead, and so does the board.
- `kage_outside`, after each fighter: `rob_kage_disp_outside`, which StF's
  stage flag (bit 28) turns off on Aurora.
- On Western, VECTER_Y turns with the round as FV's light does: `kage_light`
  sets it each frame from the stage's light and its turn since the round
  start.

The guests' tables (`tools/guest-shadows.mjs`) go into `off_64988`'s room
in the extra data ROM after StF's own copied tables, and their models after
the guests' others, each with StF's shadow cards' material and every face
both ways round:

- Akira: VF2's own table (0x61D64) as StF's (`guestTable`), VF2's cards
  scaled as his body is.
- Ryo and Chai: Shenmue's 13 SYD_MUNE hulls (MISC/COLD.BIN), each on its
  bone's slot, ends capped, at each one's own size.
- Hornet: Daytona's car card (model 791) cut into a nose half on slot 1 and
  a cabin half on slot 9, each stood up into a prism (#1610).
- Mahler: a low solid a part, as StF's tables have: the convex hull of
  each part's farthest points along 26 directions (the chest with its pads,
  the hands; `convexHull`), 26 to 48 triangles each, flags 0 (#1616). FV's
  own table (0x60BC8) is two crossed cards a part, which op 0x74 flattens
  into thin broken strips (Akira's VF2 cards do the same).

The masks: `send_kage_ball_pntr` sends each slot's collision ball to the
copro (0x306E0 + slot for player 1, 0x307E0 + slot for player 2), which
op 0x75 tests. It reads the ball numbers from 0x4C84, which on the board is
UART code, so the masks were garbage (Akira's shadow broke into pieces).
The lift stubs it, and `megamix.c`'s `kage_balls` sends the tables at
`rob_start`: StF's (9 0 2 3 4 5 6 7 8 9 10 11 12 14 15 16) for an StF
fighter, and VF2's record's middle balls (3 0 2 4 6 8 9 11 13 3 15 18 20
23 26 28) for a guest, all of whom ride VF2's ball record.

The reflection on Aurora Icefield is `mirror_draw`, as StF's camera_init
draws it there: materials 0 to 15 set to 0x7000 (ambient 0x70, no
diffuse: StF's `change_material`), then each fighter's parts under the
camera scaled by (1, −1, 1) (`rob_disp_mir`, 0x6428C), then the mirrored
osage chains (`osage_dsp`'s list layer 6, Honey's ponytail), then the
stage's materials back.

The fighters draw in a geo window of their own, after the stage, its
shadows and the reflections, as StF's camera_init calls
`set_window(win_down)` before `rob_disp`. MAME draws a later window over an
earlier one; in one window, the shadows and reflections, a hair under or
over the floor, clipped through the feet. FV's Western windows (the cage)
come before it.

`rob_kage_disp_test` leaves the geometrizer in StF's mode 1; the board
draws in mode 0 and sets it back after each pass. It also draws slot 0's
entry, model 0, while the slot-0 ball is off, so the import keeps model 0's
header (set_obj stops at a model whose header is 0: the board crashed in
`poly_data_err`). `load_palettes` loads the colours of every fighter's
table models, the ball (0x195) and the projectile shadow (0x736).

Checked in MAME (`sfight`, the shared build) and m2-hle2, Sonic against
Honey: shadows on South Island, Tou-rin, the Colosseum and Western, none
on Aurora; on South Island they look as real StF's do (black, cast away
from the light). Akira, Ryo, Chai, Hornet and Mahler each cast their own, whole,
on South Island and Tou-rin; on Western they turn with the light. On
Aurora, Sonic, Honey (and her ponytail) and Akira are mirrored, dimmed,
under their feet (m2-hle2 too, Akira against Honey), and nothing clips
through the feet there or on South Island.

## Putting a fighter's shadows on the board

What the board will need, in StF's form, for a fighter from any game:

1. Its table: 16 entries and a tail, as `tools/shadow-data.mjs` writes it
   (done for every guest: On the board, above).
   A VF2 or FV fighter's fifteen entries keep their order, the slot they
   lack (slot 0, as in StF's) comes last with model 0, and VF2's flags are
   turned into StF's. StF's own tables are in the program ROM (0x64988 to
   0x66CB8), which the board replaces: the lifter or the import has to put
   them, and the guests', where the board's `off_64988` reads.
2. Its models: StF's fighters' are in the data ROMs now (45 models). A
   guest's (Akira's VF2 343 to 424) have to come in through its import,
   renumbered as its other models are. Ryo's and Chai's: the 13 SYD_MUNE
   hulls as they are, one on each bone's slot (their ends capped). Hornet's: Daytona's
   791 cut at the body's cut (z = −0.46, with a row of points at x ±0.976)
   into a nose half on slot 1 and a cabin half on slot 9, each stood up into
   a prism over the card (the nose to the cowl, 0.70 m; the cabin to the
   roof, 1.16 m), in those slots' frames as `hornetObjects` puts the nose and
   cabin. A flat card stood edge-on to the floor on FM's stance (0x11C, the
   car on its tail), and op 0x74 flattened it into a strip hidden behind
   the tyres; a solid's outline along the light is the car's in any pose. His
   other slots, the wheels included, get model 0. Every guest's cards take
   StF's shadow cards' header and colour; Daytona's colour means nothing in
   StF's palette.
3. Its balls (done: `kage_balls`, On the board): the mask test takes ball `0x4C84[slot]` of the fighter's
   collision balls. A guest's ball list (rob +0x1D00) has to have a ball at
   each of those indices that rides the slot's part. Every guest has VF2's
   record, on which most of 0x4C84's indices fall on another part (Hornet's
   cabin, slot 9, tests a shoulder ball): see Daytona's Hornet, above, for
   the table each would need.
4. Its stage's light: VECTER_X/Y and `stage_soko` for every stage the
   board offers (done: the stage's light, StF's soko, 0 on a guest stage);
   a guest stage's ground from its own record (`tools/shadow-data.mjs`
   prints them). FV's lamps, gates and per-stage ground would be guest
   branches, as would VF2's ring and ground.
5. The calls, in StF's order, in the board's frame (done, On the board,
   above).

What the guests will look like against their own games: StF's op 0x74
flattens along the stage's light, where Daytona flattens straight down
onto the road. On the car pose the two match closely. On Hornet's stance
(0x11C, the car on its tail) his prisms cast a long shadow away from the
light, as a standing car would. Ryo's
and Chai's will be single, hard-edged shadows from one light, where
Shenmue draws one for each scene light, half dark.

Left for later, as in noclip: FV's wall shadows, its pieces' shadows, and
StF's projectile, name-plate (`name_char_kage_disp`) and Tails' plane
shadows.
