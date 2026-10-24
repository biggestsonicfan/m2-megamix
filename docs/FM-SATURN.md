# Fighters Megamix's fighters (Saturn), against VF2's

Hornet is Daytona USA's car as a Fighters Megamix fighter. The plan for
Megamix is to use Daytona's own Model 2 car with FM's moves. This page covers
where FM keeps a fighter's data, how its motions are laid out and how they map
onto Virtua Fighter 2's, so that FM's motions (Hornet's to start with) can be
played as VF2 motions on Megamix's board. `tools/fm-saturn.mjs` reads the disc
and does the conversion.

The disc is the prototype of Apr 08, 1997:
`~/source/repos/ai/Fighters Megamix (Prototype - Apr 08, 1997)`, with a cue,
`Track01.bin` (data, MODE1/2352) and 43 audio tracks. VF2's format is in
`docs/VF3-SHENMUE.md`'s opening and noclip's `vendor/noclip/js/motion.js`.

FM's motions are VF2's, keyframe for keyframe. Against VF2's arcade Akira
they have the same key frames at the same 60 fps, and the same values once
the units are converted. FM has 19 objects (VF3's layout without the two
shoulders, so the same objects VF2 has, less the pelvis look), stored in the
Saturn's fixed point.

## The disc

`Track01.bin` is ISO 9660. Each 2352-byte sector carries 2048 bytes from
offset 16. Its root holds:

- `1ST_READ.DAT`: the SH-2 program, loaded at 0x06004000. Every table below is
  in it, by RAM address (file offset = address − 0x06004000).
- `FMM_DATA.DAT`: 27.7 MB, every fighter's and stage's data, in 396 files.
- `MOV_DATA.DAT` (an AVI), `SEL_DATA.DAT`, `BUP_DATA.DAT`, and the
  abstract/bibliography text files.

## The tables

- **Files**: 0x060816C0, 396 × { u16 sectors, u16 first sector } into
  FMM_DATA.DAT, 2048-byte sectors, laid end to end. The loader is
  FUN_0602df54(id, destination). Textures are gzip, with their own names
  inside (`tex_honet_0.bin` and so on).
- **Characters**: 0x06081CF0, 32 rows of 0x1C bytes (14 × s16):
  - 0–7: the costumes' files, models 0–3 and textures 4–7;
  - 8: the motion bank, loaded by FUN_0602e3e8 into the slot's pointer in
    the table at 0x0602e460;
  - 9: the command script (below), loaded by FUN_0602eb34; 10: one
    FUN_0602e6e8 loads (Hornet's looks like sounds); 11: an optional file of
    about 60 sectors (−1 for the hidden fighters);
  - 12: an id; 13: a count, from 2 to 5.
- **Fighters**: 0x0608DDB0, 32 rows of 0x28 bytes, in the same order:
  - +0: the bones (below);
  - +4: the action table, 66 × u16 motion ids, one per thing the game asks
    of every fighter (not decoded further);
  - +8..: per-fighter numbers (`00550000`, `2e110000`, ...), not decoded.

The rows, by texture names and bones: 0 Grace, 1 Bahn, 2 Raxel, 3 Tokio,
4 Sanman, 5 Jane, 6 Honey (Candy), 7 Picky, 8 Mahler, 9 Deku, 10 Kuma,
11 Bean, 12 Bark, 13 Uraban, **14 Hornet**, 15 B.M., 16 Akira, 17 Pai, 18 Lau,
19 Wolf, 20 Jeffry, 21 Kage, 22 Sarah, 23 Jacky, 24 Shun, 25 Lion, 26 Dural,
27 Kids Akira, 28 Kids Sarah, 29 Siva, 30 Rentahero, 31 Janet.

## Hornet's files

Character row 14 is (130, 132, 130, 130, 131, 133, 131, 131 | 135, 134, 136,
−1, 14, 5):

| File | Sectors | What |
| --- | --- | --- |
| 130, 132 | | models (two costumes) |
| 131, 133 | | textures, `tex_honet_0`, `tex_honet_1` |
| 135 | 40 | the motion bank: 103 motions, ids 0x88–0x80E |
| 134 | 3 | the command script, then the move list's rows (see Moves) |
| 136 | 30 | probably sounds: 7 records of 3 × u32 (start \| 0x80000000, length, a third offset, mostly the start), then signed bytes from 0x58. Not needed for the moves |

For comparison, Akira's are 151 (4 sectors), 152 (his bank), 153 (23) and
154 (59).

### The model

The models are SGL XPDATA: { points, point count, polygons, polygon count,
attributes, vertex normals }. Points are 12 bytes, polygons 20 (a normal and
four u16), attributes 12. The model starts with a table of slots, 0x1 for an
empty one, ending in 0xFFFFFFFF.

A polygon's four corners are point indices × 16. The table is 41 slots of
24 bytes, to 0xFFFFFFFF; a slot whose first word is 0x1 is empty, and a part a
fighter doesn't have is a one-point model. Each fighter row's table offset is
at 0x06079D10 (and three more tables of 32 after it, picked by FUN_0601fcb0's
r7). FUN_0601fcb0 relocates slots 1–40 into the player's part array (player
1 0x06098924, player 2 0x06098CE4), slot s at entry s − 1.

- **0–15** are the pose's slots, VF2's numbering (noclip `pose.js`): 0 the
  shadow, 1 chest, 2 head, 3–5 left arm, 6–8 right arm, 9 pelvis, 10–12 left
  leg, 13–15 right leg.
- **16–30** are slot s's armour-broken part at s + 15 (below).
- **20 and 27, 23 and 30** are also the left and right hands' other models
  (the hand list at 0x0607A3F0: entries 4, 19, 26 and 7, 22, 29).
- **31–36** Akira's small extra parts (3–4 points).

Hornet (130) has its table at 0x714C: 0 the shadow (4 points, 1 polygon); 1
the nose (58/55); 5, 8, 12 and 15 a wheel each (42/50); 9 the cabin and tail
(96/77); 16 the broken nose (80/45); 24 the broken cabin (144/103); and 20,
23, 27 and 30 the same wheels again, as the other hand models. The rest are
one-point models. Akira's model (147) fills slots 1–15, with hands at 20,
23, 27 and 30.

Slots 1 and 9 are the car body cut in two (`fm-saturn.mjs`'s `readModel`
reads them):

- **9, the cabin**: roof, windscreen, doors, rear wings, boot and spoiler, and
  the floor. Its x runs from the nose to the tail (−70 … 333, the floor
  reaching furthest forward), y down, z across (±101).
- **1, the nose**: bonnet, front wings, headlights and bumper, from the front
  edge of the doors forward.
- They hang from the **same origin**, slot 1 turned half a turn about z
  (x → −x, y → −y): slot 1's face at x = 7 is slot 9's at x = −7, point for
  point. So the joint between them is the door line, 42 units above the
  floor, and the nose swings up and down about it.

The Megamix port uses Daytona's Model 2 car, cut the same way (below).

### The armour break

FM keeps Fighting Vipers' armour break. Once player +0x65 has bit 2 (the
upper armour, set at 0x06023E1C) the draw takes slot 15 + s for slot s,
s = 1–9, for each bit of the row's word at 0x0606C6FC (FUN_0600bb20); with bit
3 (the lower, 0x06023E66), s = 9–15 for bits 8–14 of 0x0606C77C's
(FUN_0600bb78). Grace to Mahler (rows 0–8), Deku, Uraban, Hornet, B.M. and
rows 30–31 have words there; Akira and the VF2 cast don't.

Hornet's are 0x1 and 0x100: the broken nose (16) in place of the nose (1),
and the broken cabin (24) in place of the cabin (9). A broken part is drawn
on the same joint as the part it replaces. `fm-saturn.mjs`'s `readBreaks`
reads them.

## Daytona's Hornet (Model 2)

The player's car in `daytona` (Revision A). Sega Racing Classic's symbols
(rokuYAMP's `docs/d1a-daytona-symbols.md`) name the routines; their
addresses are a later build's, so the ones here were read off rev A's code.
`tools/daytona-hornet.mjs` finds the car by the instructions below (and fails
on another build), prints it, and writes it cut in two as an OBJ.

- **Set-up** (0xD12C): car +0x14, +0x84 and +0x258 come out of a table at
  0x0281E390, by the car type at 0x501488: 0 or 1 from 0x501464, 2 when the EEPROM word 0x5FE588 is set.
- **dsp_player_car** (0x7D38) draws +0x14, the body; model 2139 (no mesh);
  the glass, column 2; and for car type 2 its plate (+0x258, by the cabinet's
  number 0x5FE604). In the in-car view it draws +0x84 instead.
- **The tires** (0x7DA4): four models out of the program ROM at 0x230496,
  placed at hubs out of 0x230D54 and turned by the car's +0x128, +0x5A,
  +0x52 and +0x56 (the spin and the steering, presumably; not read further).

| | type 0 | type 1 | type 2 |
| --- | --- | --- | --- |
| body (+0x14) | 1460, 325 faces | 1461 (1460's mesh, other textures) | 1835, 314 |
| glass | 1462 | 1463 | 1793 |
| in-car body (+0x84) | 1236 | 1237 | 1802 |
| plates (+0x258) | | | 1794–1801 |

| Tire | Model | Hub (m) |
| --- | --- | --- |
| rear left, rear right | 805, 806 | (∓0.525, 0.32, 1.4125) |
| front left, front right | 805, 806 | (∓0.525, 0.32, −1.4) |

805 and 806 are one tire each side (x −0.40…0 and 0…0.40, radius 0.36),
centred on the hub. In noclip's decode the car's front is −z: the body
runs from z −2.47 (bumper) to 2.46 (spoiler), y 0.11 to 1.27, x ±0.87.
The rival cars are other models (the tables from 0x0281E404: four levels
of detail per car, among models 0–179, and model 770 under them).

### The cut

Daytona's body has an edge at the front of the doors, z = −0.46, where FM
cuts its Hornet. The tool cuts along whole faces: a face wholly in front of
it is the **nose**, the rest the **cabin**, with FM's strip of wing tops up
to the cowl (z ≥ −0.92, above 0.70 m) and the belt line that runs past it.
For 1460 that is 246 triangles of nose and 358 of cabin, none lost.

FM's units are 0.0087 m (its body is 566 × 132 × 203 units, Daytona's
4.93 × 1.16 × 1.74 m), and FM's body origin lands at (0, 0.475, −0.44) on
Daytona's car, the pivot the nose turns about. Axes: FM x = Daytona +z
(rearward), FM y = −y.

```
node tools/daytona-hornet.mjs                     # the car's models and the split
node tools/daytona-hornet.mjs --obj hornet.obj    # nose, cabin and four tires, placed
```

`tests/daytona-hornet.test.mjs` checks the models, the hubs, the cut, and
(with the FM disc) that FM's two pieces meet as described. It also checks
the broken parts, and the car pose's nose, cabin and wheels against
Daytona's (below).

### Bones

Each fighter's +0 points at 15 × (x, y, z) 16.16 offsets, in metres. Entry s
is slot s's place in its parent's frame (noclip `pose.js`'s `SLOT_PARENT`),
on VF2's axes; slot 0, the body, is the root. Akira's (0x0608D6A8) are VF2
arcade Akira's exactly: (0, 0, 0), (0.37, 0, 0), (0.28, 0, −0.24), (0.25, 0, 0),
… (0.44, 0, 0).

Hornet's (0x0608D48C) is a skeleton he shares with Picky:

| Slot | Bone | Hornet's | Hangs from |
| --- | --- | --- | --- |
| 1 | chest | (0, 0, 0) | the body |
| 2 | head | (0.32, 0, 0) | chest |
| 3, 6 | shoulders | (0.25, 0.02, ∓0.17) | chest |
| 4, 7 | upper arms | (0.23, 0, 0) | 3, 6 |
| 5, 8 | forearms (the hands) | (0.24, 0, 0) | 4, 7 |
| 9 | pelvis | (0, 0, 0) | the body |
| 10, 13 | hips | (0.19, 0, ∓0.09) | pelvis |
| 11, 14 | thighs | (0.39, 0, 0) | 10, 13 |
| 12, 15 | shins (the feet) | (0.44, 0, 0) | 11, 14 |

The legs are Akira's. `fm-saturn.mjs hornet --bones` prints them.

### The pose

`fm-saturn.mjs`'s `poseFighter` solves a frame with VF2's pose routine
(noclip `pose.js`, feet level with the floor) on the fighter's own bones,
then steps each slot out from its parent by its bone, as VF2's draw does.
The limbs are IK chains: each hangs at its shoulder or hip and reaches for
the motion's hand or foot target, so a hand's or foot's place is the
target's, give or take what the bones can reach. VF2 solves on one
standard rig for everyone; which one FM solves on hasn't been read.

Akira's stance (0x88) stands him up, his head at 1.34 m and his feet at
0.14. Hornet's stance (0x11C) stands the car on its tail, the nose up. His
car pose is 0x10A (the same at frames 1, 21 and 42; 0x122 is nearly it):
the four wheels down at hub height 0.13 m and the nose level. There, in the
cabin's frame (slot 9; model units, x rearward, y down, z across):

| Slot | Part | Hangs from | At | Daytona |
| --- | --- | --- | --- | --- |
| 1 (16 broken) | nose | chest, at the body | (0, 0, 0), turned half a turn about z | the cut's pivot, (0, 0.475, −0.44) |
| 9 (24 broken) | cabin | pelvis, at the body | (0, 0, 0) | the same |
| 5 | front left wheel | left forearm (hand) | (−113, 21, −72) | tire 2 (805), (−0.525, 0.32, −1.4) |
| 8 | front right wheel | right forearm (hand) | (−112, 22, 73) | tire 3 (806), (0.525, 0.32, −1.4) |
| 12 | rear left wheel | left shin (foot) | (206, 19, −90) | tire 0 (805), (−0.525, 0.32, 1.4125) |
| 15 | rear right wheel | right shin (foot) | (213, 22, 69) | tire 1 (806), (0.525, 0.32, 1.4125) |

So the nose hinges at the door line on the chest, and the cabin carries the
rest on the pelvis. Both are at the body's place, with no bone between them.
The chest turns by its own angle and its aim at the neck target, so in a
move the nose swings about the door line.

The pose's metres are 300 model units. That is fitted, not read off the
draw: the wheels' radius (40 units) is the hubs' height (0.13 m), and the
wheelbase comes out at Daytona's.

Put on Daytona's car with the cut's scale and pivot (`daytona-hornet.mjs`'s
`fmToDaytona`), the axles land 0.02 and 0.03 m from Daytona's along the
car, and 0.02–0.04 m lower. The rear pair stands slightly askew, because
the motion yaws the pelvis 2.8° under the foot targets. FM's hubs sit wider
apart, ±0.63 (front) and ±0.69 (rear) against ±0.525. Daytona's tire models
grow outward from the hub (805 spans x −0.40…0), so its hub is the tire's
inner face; FM's wheel is about centred on its hand or foot. Which side is
FM's left on Daytona's car is taken as −x in noclip's decode. The car is
symmetric, so this only picks 805 or 806 for a slot.

```
node tools/fm-saturn.mjs hornet --pose 10a     # each slot in the cabin's frame
```

## Motions

### The bank

The bank is 12-byte rows { u32 setup offset, u32 motion id, u32 data offset },
ending at id 0. Offsets are from the bank's start, and ids are global (sparse,
the same numbering for every fighter). An id from 0x880 up is a variant that
shares the next row's data. The setup records are op scripts like
set_mot_dat's and are not decoded yet.

40 of the 66 entries in Hornet's action table are in his bank. The others
(0x19F, 0x1A0, 0x1AD, 0x1AE, 0x4CA–0x4D5, 0x6CF, 0x6F0, 0x6F1, 0x8C1, …) are
in no fighter's bank. They are in FMM_DATA file 352 (55 sectors, 162 motions),
a bank of the same layout that every fighter shares. Every action-table id
of all 32 fighters is in that fighter's bank or 352. The only exception is
Bean's and Bark's 0x44EA, which is 0x4EA with a flag in bits 12–15.

### Motion layout

The decoders are FUN_06015100 (attach), FUN_06015A0A (per frame),
FUN_06015c7c (linear) and FUN_06015d0c (Hermite). Big-endian:

- u16 frames, s16 times offset, s16 values offset, u16 size (offsets from the
  motion's start);
- 15 bytes of 2-bit channel types, the first channel in the top bits. Of the
  60, 57 are used: 7 points × (x, y, z), then 12 angles × (x, y, z):
  - 0: zero;
  - 1: a constant, one value;
  - 2: linear. Times [n, n deltas]; n + 2 values;
  - 3: Hermite. Times [n, m, n + m deltas], where an 0xFF after a delta
    marks the key just reached as split (different in and out tangents).
    2(n + 1) + m + 2 values: v0, out0, then per key (in, v), or (in, v, out)
    for a split key, then in, v for the last.
- Keys are at frame 1, then 1 + the running sum of the deltas, then the last
  frame (the frame count).
- Values are s16 (the game keeps them << 6). The times stream ends 0–3 bytes
  before the values offset, and the values end 0–3 bytes before the size.

All 3686 motions of the 32 fighters decode like this, end to end.

### FM → VF2

| FM | VF2 |
| --- | --- |
| point 0–6 | object 12, 13, 14, 15, 16, 18, 19 |
| angle 0–11 | object 4, 5, 6, 7, 0, 8, 1, 9, 10, 2, 11, 3 |
| — | object 17, latched (0, 0, 16384), as for Shenmue's |

- **Points**: 1/1024 m, VF2's (x, y, −z).
- **Angles**: 1024 a turn, so VF2's BRAD is ×64. FM's (x, y, z) are VF2's
  (−z, y, x).
- **Tangents**: per frame. VF2's are per 1/30 s (motion.js's TANGENT_RATE),
  so they get the value's scale ×30.
- **Time**: unchanged. FM's key frames are VF2's.
- Linear channels stay linear (VF2 type 5) and constants stay constant.

This was checked against VF2 arcade Akira: FM Akira's 0x53, 0x54, 0x62 and
0x75 are VF2's motions 11, 12, 24 and 44. Sampling every channel at every
frame, the mean difference is 0.05–0.12° (cm for points), and after the
first segment it is at most 1.03°.

The first segment is the exception. There, FM's out0 is 2–3× VF2's for
points and about 100× for angles, which puts the two up to 13° apart.
Dropping out0, or scaling it toward VF2's, makes the difference larger
(25°), so the tool converts FM's data as stored.

## Moves

### The command script

A fighter's file 9 (Hornet's 134) is a script that FUN_06017366 runs on the
fighter's input. It reads one opcode byte at a time and calls one of 82
handlers through the table at 0x06072394. Offsets in the script are from the
file's start. Each opcode is 4, 8, 12 or 16 bytes, read off its handler's
`add #n,r10` (`OP_SIZE` in the tool).

- **0x0E**: `if r5 == u32 goto u32` (12 bytes). The script opens with a
  switch on the caller's r5 (cases 1, 2, 3, 5, 6, 7, 8, 0). After 0x4A 0x0050,
  r5 is the motion being played (fighter +0x50), so a follow-up can check
  what it follows.
- **0x0F, 0x27**: push the u32 offset as the alternative. **0x10**: fail
  back to the last alternative. **0x11**: goto. **0x28**: a three-way branch
  on the stick (three u32 offsets).
- **0x00, 0x01, 0x02, 0x2B, 0x03, 0x04**: match the stick history (see
  Inputs). **0x07–0x0C, 0x1C, 0x36, 0x37, 0x3A, 0x3B, 0x43**: pass if a
  flag of the fighter is set or clear. **0x1A, 0x1B**: pass if the distance
  to the opponent (+0x4D8, 16.16, worked out at 0x06011d3e) is at least, or
  under, a value.
- **0x0D, 0x38**: set the follow-up point (+0x124C). While the move plays,
  the next press runs the script from there instead of from the top.
- **0x05**: request a move and stop. **0x06**: the same, unless +0x31
  bit 0x40 is set (then it stops without a request). **0x32**: the same, if
  FUN_06017c5e passes: +0x2C bit 0x10 is set and the fighter's +0x4A8 has
  reached the motion's +6 (an air attack needs height). All three end the
  run (0x06017422, 0x06017466, 0x06017738).

### Inputs

The script runs when a button is pressed (and once a frame without one).
r5 holds state << 8 | buttons. The pad goes through the table at 0x06072304
(P2: 0x0607233C):

- B is P (1), C is K (2), A is G (4);
- X is P+G, Y is K+G, Z is P+K+G;
- L, R and Start give nothing.

Bit 8 is a fourth button that no default key gives.

The state is 0 on the ground and 1–4 in the air (0x06016e28: up there
requests kind 9, the jump). States 5–10 come from other flags of the
fighter (0x06016d4a). Hornet's script only uses 0–4, plus 8 in the case
for button 8.

Before any of this, the engine asks for its own default moves: 1 idle,
3 forward, 4/7 back, 9 jump (parameter 1 forward, 2 back, 0 straight up),
0x0A crouch guard, 0x0B guard.

The stick history is fighter +0x1274: 64 entries of {held, held', pressed,
released}. The bits are:

- down 0x10 and up 0x20;
- +0x123C forward and +0x1240 back. These are the pad's left and right as
  the fighter faces, set at 0x06016546 from +0 bit 0x08000000, which
  0x06011bc0 sets from the fighter's yaw against the camera.

The ops match the history newest first, from the frame of the press back:

- **0x00**: a tap. The stick was pressed into exactly this.
- **0x01**: held exactly this.
- **0x02**: held includes it.
- **0x2B**: held lacks it.
- **0x03**: let these through for n frames.
- **0x04**: the window for the next match.
- **0x28**: a three-way branch: forward, back or neither, at the press.

`readInputs` walks every path to each request. It drops the paths a
simpler path covers, and the paths whose flag tests contradict each other.
`inputText` writes a path out:

- the stick oldest first, then `+` and the buttons;
- `n` is neutral, `d*` is down held (with anything else), and
  `not f/b` means neither forward nor back;
- `air 1`–`air 4` is the state;
- `after 0x…:` is a follow-up, pressed while that motion plays;
- `[…]` lists the flag and distance tests on the way: `+0&10000000` means
  fighter +0 & 0x10000000 is set, and `!` means clear.

Most of those flags aren't named yet. When several paths reach a move, they
are separated by `;`. A path that is listed earlier in the script wins.

A **move** is the u32 that a request opcode stores in the fighter's +0x3C:
{ u8 kind, u8 parameter, u16 motion }. The kind picks one of 104 handlers at
0x06012AEC; kind 0 just plays the motion. FUN_060131d0 starts the motion: it
takes the u16 & 0xFFF as the id, keeps bits 12–15 as flags, and plays 0x88
for anything past 0x8F3. The data comes from per-id tables in RAM, 0x06091CAC
(data) and 0x0608F8BC (setup), which the banks fill. A motion can therefore
come from the fighter's own bank or from the common one, 352.

The move list follows the script: 16-byte rows padded with 0xFF (Hornet's
84 start at 0x1214). The script ends at the first word whose low three bytes
are 0xFFFFFF.

These checks hold for all 32 fighters' scripts:

- each one decodes cleanly up to its move list;
- all 7121 jump offsets land on an opcode;
- every requested motion is in the fighter's bank or in 352.

### Hornet's

Hornet's script makes 95 requests, which come to 81 different moves:

- 56 play motions from his own bank 135;
- 20 play motions from the common bank 352;
- 5 (kinds 0x13, 0x1A, 0x1D, 0x1E and 0x31) have no motion.

Below, "at" is the request's offset in 134 (every one, if a move is
requested from more than one place). "Frames" is the motion's length in the
bank. "Kind" and "Parameter" are the move's top two bytes. "Input" is
`inputText` for every path to the request (with its offset, on a row of
more than one).

What each kind does is in [Kinds](#kinds), below the table. The inputs
add: kind 0x10's moves are P+G and test +0x578 (maybe the opponent's state);
0x1A is f,n,f and 0x13 b,n,b; 0x1D and 0x1E are d/f twice and d/b twice;
0x2D is one move (n,d*+K); 0x31 is button 8 on its own, and its follow-up
(0xE24) waits a frame and goes back to the top.

Three requests have no
path:

- 0x0A84 and 0x0A8C sit in 0x0A28–0x0A94, which nothing branches to;
- 0x0844 needs +0 bit 0x10000000 both set (0x0824) and clear (0x083C).

Hornet's 22 throws aren't requests at all. Op 0x46 in the P+G block
(0xE7C–0x11D8) asks for kind 0x1B plus the opponent's +0x6AC, so they
aren't in this table.

| At | Move | Motion | Frames | Bank | Kind | Parameter | Input |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x01f4 | 0x00000712 | 0x712 | 51 | 135 | 0x00 | 0x00 | P [+0&10000000 +2c&8000000] |
| 0x0220 | 0x00000659 | 0x659 | 41 | 352 | 0x00 | 0x00 | d+P [+0&10000000 +4a4&1] |
| 0x0230 | 0x000004da | 0x4da | 41 | 352 | 0x00 | 0x00 | P [+0&10000000 +4a4&1] |
| 0x0250 | 0x000008ee | 0x8ee | 32 | 135 | 0x00 | 0x00 | after 0x4da: P |
| 0x0294 | 0x000005aa | 0x5aa | 70 | 135 | 0x00 | 0x00 | f,d,d/f+P [+0&10000000] |
| 0x02d8 | 0x000008dc | 0x8dc | 70 | 135 | 0x00 | 0x00 | after 0x5aa: n,f,d,d/f+P |
| 0x030c | 0x00000653 | 0x653 | 60 | 135 | 0x00 | 0x00 | d/b,d/f+P [+0&10000000 +0&10] |
| 0x0340 | 0x000000ff | 0xff | 64 | 135 | 0x00 | 0x00 | n,f,n,f+P [!+0&10000000] |
| 0x0350 | 0x000006bf | 0x6bf | 50 | 135 | 0x00 | 0x00 | n,f,n,f+P |
| 0x0390 | 0x000006be | 0x6be | 62 | 135 | 0x00 | 0x00 | after 0x6bf: f+P |
| 0x03bc, 0x0938 | 0x000008f3 | 0x8f3 | 81 | 135 | 0x00 | 0x00 | 0x03bc: after 0x6bf: b,f+P+K; 0x0938: P+K [+0&10000000 +2c&8000000] |
| 0x03e4 | 0x000005ae | 0x5ae | 60 | 135 | 0x00 | 0x00 | d/f+P [+0&10000000 +0&10] |
| 0x0400 | 0x0000075e | 0x75e | 60 | 135 | 0x00 | 0x00 | d/f+P [+0&10000000] |
| 0x0428 | 0x000006ff | 0x6ff | 60 | 135 | 0x00 | 0x00 | b,f+P [+0&10000000] |
| 0x0450 | 0x00000110 | 0x110 | 44 | 135 | 0x00 | 0x00 | f+P [!+0&10000000] |
| 0x0458 | 0x000006c1 | 0x6c1 | 50 | 135 | 0x00 | 0x00 | f+P |
| 0x0474 | 0x000006f3 | 0x6f3 | 60 | 135 | 0x00 | 0x00 | f+P [+0&10000000] |
| 0x04b4 | 0x000006b7 | 0x6b7 | 70 | 135 | 0x00 | 0x00 | b,d,d/b+P [+0&10000000] |
| 0x04f4 | 0x000006b9 | 0x6b9 | 92 | 135 | 0x00 | 0x00 | after 0x6b7: f,d,d/f+P |
| 0x0504 | 0x000006b8 | 0x6b8 | 92 | 135 | 0x00 | 0x00 | after 0x6b7: P |
| 0x0534 | 0x000006b2 | 0x6b2 | 80 | 135 | 0x00 | 0x00 | b,not d+P [+0&10000000] |
| 0x0574 | 0x000008e0 | 0x8e0 | 80 | 135 | 0x00 | 0x00 | after 0x6b2: b,not d+P [+2c&4] |
| 0x05a0 | 0x000008e5 | 0x8e5 | 80 | 135 | 0x00 | 0x00 | after 0x6b2: f,not d+P [+2c&4] |
| 0x05d4 | 0x0000014d | 0x14d | 60 | 135 | 0x00 | 0x00 | d+P [+0&10000000 +4a4&20] |
| 0x05f8 | 0x0000014e | 0x14e | 62 | 135 | 0x00 | 0x00 | after 0x14d: P |
| 0x060c, 0x0b68 | 0x00000656 | 0x656 | 27 | 352 | 0x00 | 0x00 | 0x060c: d*+P; 0x0b68: d*+P+K+G [+0&10000000] |
| 0x062c | 0x000008ed | 0x8ed | 24 | 135 | 0x00 | 0x00 | P [+0&10000000 dist<1.3] |
| 0x064c | 0x000008ef | 0x8ef | 32 | 135 | 0x00 | 0x00 | P [+0&10000000 dist>=2] |
| 0x0654 | 0x0000010f | 0x10f | 33 | 135 | 0x00 | 0x00 | P |
| 0x0688 | 0x2d000146 | 0x146 | 70 | 135 | 0x2d | 0x00 | n,d*+K [+0&10000000 +4a4&20] |
| 0x06b4 | 0x0000056c | 0x56c | 52 | 352 | 0x00 | 0x00 | d*+K [+0&10000000 +2c&8000000] |
| 0x06bc, 0x0ab0 | 0x000006db | 0x6db | 71 | 135 | 0x00 | 0x00 | 0x06bc: K [+0&10000000 +2c&8000000]; 0x0ab0: P+K+G [+0&10000000 +2c&8000000] |
| 0x06e8 | 0x00000658 | 0x658 | 57 | 352 | 0x00 | 0x00 | d*+K [+0&10000000 +4a4&1] |
| 0x06f8 | 0x000004d6 | 0x4d6 | 57 | 352 | 0x00 | 0x00 | K [+0&10000000 +4a4&1] |
| 0x0734 | 0x000008e6 | 0x8e6 | 49 | 135 | 0x00 | 0x00 | f,n,f+K [+0&10000000] |
| 0x074c | 0x0000010e | 0x10e | 46 | 135 | 0x00 | 0x00 | d/f+K |
| 0x0768 | 0x00000652 | 0x652 | 50 | 135 | 0x00 | 0x00 | d*+K |
| 0x0784 | 0x000006dd | 0x6dd | 60 | 135 | 0x00 | 0x00 | f+K [+0&10000000] |
| 0x078c, 0x0a8c | 0x0000010d | 0x10d | 46 | 135 | 0x00 | 0x00 | 0x078c: K; 0x0a8c: (unreached) |
| 0x07ac | 0x0000066c | 0x66c | 63 | 135 | 0x00 | 0x00 | P+G [+0&10000000 +2c&8000000] |
| 0x07d4, 0x07dc | 0x10000100 | 0x100 | 71 | 135 | 0x10 | 0x00 | 0x07d4: P+G [+578&8 !+0&10000000]; 0x07dc: P+G [+578&8] |
| 0x0804 | 0x10040098 | 0x98 | 66 | 135 | 0x10 | 0x04 | P+G [+0&10000000 +578&4000000] |
| 0x0814 | 0x10040096 | 0x96 | 66 | 135 | 0x10 | 0x04 | P+G [+0&10000000 +578&8000000] |
| 0x0844, 0x084c | 0x1000088c | 0x88c | 71 | 135 | 0x10 | 0x00 | 0x0844: (unreached); 0x084c: P+G [+0&10000000 +578&10] |
| 0x08ac | 0x100000c9 | 0xc9 | 109 | 135 | 0x10 | 0x00 | n,d/b,f+P+G [+0&10000000 +578&1] |
| 0x08b4, 0x08e8, 0x0914, 0x0b4c | 0x00000432 | 0x432 | 50 | 352 | 0x00 | 0x00 | 0x08b4: n,d/b,f+P+G [+0&10000000]; 0x08e8: b+P+G [+0&10000000]; 0x0914: not d+P+G; 0x0b4c: b,f+P+K+G [+0&10000000] |
| 0x08e0 | 0x1000080d | 0x80d | 66 | 135 | 0x10 | 0x00 | b+P+G [+0&10000000 +578&1] |
| 0x090c | 0x100000fd | 0xfd | 230 | 135 | 0x10 | 0x00 | not d+P+G [+578&1] |
| 0x098c, 0x0b0c | 0x0000024b | 0x24b | 60 | 352 | 0x00 | 0x00 | 0x098c: n,b+P+K [!+0&10000000]; 0x0b0c: n,f,b,f,b+P+K+G [!+0&10000000] |
| 0x09c0 | 0x00000776 | 0x776 | 81 | 135 | 0x00 | 0x00 | n,b,f,n,f+P+K [+0&10000000] |
| 0x09f8 | 0x0000010b | 0x10b | 42 | 135 | 0x00 | 0x00 | n,b,d/f+P+K [+0&10000000 !+0&10] |
| 0x0a1c | 0x0000010a | 0x10a | 42 | 135 | 0x00 | 0x00 | d/f+P+K [+0&10000000 +0&10] |
| 0x0a84 | 0x0000010c | 0x10c | 62 | 135 | 0x00 | 0x00 | (unreached) |
| 0x0b44 | 0x10000440 | 0x440 | 100 | 135 | 0x10 | 0x00 | b,f+P+K+G [+0&10000000 +578&1] |
| 0x0b88 | 0x00000883 | 0x883 | 30 | 352 | 0x00 | 0x00 | b+P+K+G [+0&10000000] |
| 0x0ba8 | 0x00000884 | 0x884 | 30 | 352 | 0x00 | 0x00 | f+P+K+G [+0&10000000] |
| 0x0bb0 | 0x00000700 | 0x700 | 60 | 135 | 0x00 | 0x00 | P+K+G |
| 0x0bd4, 0x0df4 | 0x1a000000 | - | - | - | 0x1a | 0x00 | 0x0bd4: f,n,f; 0x0df4: f+8 |
| 0x0bf4, 0x0e0c | 0x13000000 | - | - | - | 0x13 | 0x00 | 0x0bf4: b,n,b; 0x0e0c: b+8 |
| 0x0c20 | 0x1d000000 | - | - | - | 0x1d | 0x00 | d/f,not f/b,d/f [+0&10] |
| 0x0c44 | 0x1e000000 | - | - | - | 0x1e | 0x00 | d/b,not f/b,d/b [+0&10] |
| 0x0c5c, 0x0d24 | 0x0914013a | 0x13a | 100 | 135 | 0x09 | 0x14 | 0x0c5c: air 2 P [+0&10000000 +4a4&20]; 0x0d24: air 1 P [+0&10000000 +4a4&20] |
| 0x0c64 | 0x090c0561 | 0x561 | 50 | 135 | 0x09 | 0x0c | air 2 P [+0&10000000] |
| 0x0c84 | 0x0904089d | 0x89d | 51 | 135 | 0x09 | 0x04 | air 2 K [+0&10000000 +6c0&40000 +70&10000] |
| 0x0c9c, 0x0ccc | 0x090402fb | 0x2fb | 49 | 135 | 0x09 | 0x04 | 0x0c9c: air 2 K [+0&10000000 +6c0&40000]; 0x0ccc: air 2 K [+0&10000000 +70&10000] |
| 0x0cb4 | 0x090402ee | 0x2ee | 57 | 352 | 0x09 | 0x04 | air 2 K [+0&10000000 +4a4&1] |
| 0x0cd4 | 0x090402f9 | 0x2f9 | 49 | 135 | 0x09 | 0x04 | air 2 K [+0&10000000] |
| 0x0cdc | 0x090c055f | 0x55f | 79 | 135 | 0x09 | 0x0c | air 4 P [+0&10000000] |
| 0x0cf0 | 0x090402ef | 0x2ef | 44 | 135 | 0x09 | 0x04 | air 4 K [+0&10000000] |
| 0x0d04 | 0x090c02fc | 0x2fc | 46 | 352 | 0x09 | 0x0c | air 4 d*+K [+0&10000000] |
| 0x0d0c | 0x090c02f6 | 0x2f6 | 53 | 352 | 0x09 | 0x0c | air 4 K [+0&10000000] |
| 0x0d2c | 0x09080314 | 0x314 | 80 | 135 | 0x09 | 0x08 | air 1 P [+0&10000000] |
| 0x0d38 | 0x0900030d | 0x30d | 100 | 352 | 0x09 | 0x00 | air 1 K [+0&10000000] |
| 0x0d48 | 0x09080561 | 0x561 | 50 | 135 | 0x09 | 0x08 | air 3 P [+0&10000000] |
| 0x0d60 | 0x09080301 | 0x301 | 59 | 352 | 0x09 | 0x08 | air 3 b+K [+0&10000000] |
| 0x0d74 | 0x090802ff | 0x2ff | 69 | 352 | 0x09 | 0x08 | air 3 f+K [+0&10000000] |
| 0x0d88 | 0x09000302 | 0x302 | 60 | 352 | 0x09 | 0x00 | air 3 d*+K [+0&10000000] |
| 0x0d98 | 0x09000303 | 0x303 | 49 | 352 | 0x09 | 0x00 | air 3 K [+0&10000000] |
| 0x0dac | 0x09080304 | 0x304 | 60 | 352 | 0x09 | 0x08 | air 3 d*+K [+0&10000000] |
| 0x0dbc | 0x09080305 | 0x305 | 44 | 352 | 0x09 | 0x08 | air 3 K [+0&10000000] |
| 0x0e1c | 0x31000000 | - | - | - | 0x31 | 0x00 | 8 |

`tests/fm-saturn.test.mjs` reads this table back. It checks that every motion
listed with bank 135 is one of the 103 in Hornet's bank, that the 352 ones
are in the common bank, and that the table, inputs included, is what the
tool reads off the disc.

### Kinds

A request only stores the move in +0x3C. Each frame the fighter's update
(0x0600d318) calls FUN_0600d7f6. If +0x3C isn't 0, it jumps to the move's
kind's **accept** handler, the word at 0x06012AEC + kind × 8. Most of them
refuse while the current action's kind is 0x21, or is their own kind. The
common one (0x0600DA70) clears the stage +0x60 and +0x61E and copies the
move into +0x70, the current action. FUN_0600dda0 then jumps each frame to
the **run** handler at 0x06012AF0 + kind × 8 for +0x70's kind. Clearing
+0x70 ends the action.

"Plays" says whether the handler plays the move's own motion, and which
slots of the fighter's action table (+0x34, the row's +4; `--actions`) it
plays. A slot is used when the move has no motion. "Bits" are the parameter
bits that the handler tests (+0x3C or +0x70 bits 16–23, or the byte +0x71).
"Distances" are the ones it compares the distance to the opponent (+0x4D8)
with. These are the kinds Hornet uses; his throws use kind 0x1B, whose run
handler does nothing.

| Kind | Accept | Run | Plays | Bits | Distances | What it does |
| --- | --- | --- | --- | --- | --- | --- |
| 0x00 | 0x0600da70 | 0x0600ddfc | motion | | | Plays the motion on the first frame and ends when the motion has ended (+0x50 is 0). |
| 0x09 | 0x0600db04 | 0x0600ea14 | motion; 45, 46, 47, 48 | 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80 | 0.8 | A jump, or, with a motion, an air attack: the parameter bits (below) pick its direction, airtime, motion and timing; a kind 9 request early in a jump (stage ≤ 1) adds its bits to the jump in progress; the 0.8 compare, against the opponent's +0x56C, isn't read. |
| 0x10 | 0x0600da70 | 0x0600fee0 | motion | 0x04 | | Plays the motion, stops the fighter, then puts it on the opponent's +0x19C8 point facing +0x1A08, at once or halfway each frame if +0x2F bit 1 is set (bit 0x04 eases the facing too); probably throws. |
| 0x13 | 0x0600d858 | 0x0600e2d0 | 24, 25 | | 1.8 | A back dash: slot 24, or 25 from 1.8 away or more; another one is refused until frame 22. |
| 0x1a | 0x0600da52 | 0x0600e2e8 | 22, 23, 41, 42, 43 | | 2, 3 | A forward dash: slot 22, or 23 from 3.0 away or more; with +0x4A7 bit 2 it goes on into slot 41 after frame 8, then 42 or 43 (motion 0x725 inside 2.0), and without it into a walk (kind 3). |
| 0x1d | 0x0600d8d0 | 0x0600e2d0 | 26 | | | Plays slot 26 and ends at its last frame (+0x52 ≥ +0x63C). |
| 0x1e | 0x0600d898 | 0x0600e2d0 | 27, 28 | | 1.8 | Plays slot 27, or 28 from 1.8 away or more, and ends at its last frame. |
| 0x2d | 0x0600dac4 | 0x0600e93c | motion | | | Plays the motion and steers and moves at the opponent's +0x19BC point (kept at the start) until frame +0x4AA, then stops. |
| 0x31 | 0x0600d908 | 0x0600e2d0 | 62, 63, 64, 65 | | | Plays slot 62 or 63 (64 or 65 with +0x4A7 bit 0), picked by down (+0x1230 bit 0x10) and +0's bits 0x08000000 and 0x40. |

Kind 9's parameter bits (Hornet's moves use 0, 0x04, 0x08, 0x0C and 0x14):

| Bit | Selects |
| --- | --- |
| 0x01 | forward (+0x4B0 = 1.0) |
| 0x02 | back (+0x4B0 = −1.0) |
| 0x04 | 24 frames of airtime (+0x4AA) instead of the row's +0x0C, and the jump motion from slot 46 (47 if also 0x02) instead of 45 |
| 0x08 | holds the attack motion back until the airtime left (+0x4A8) is down to the motion's +6 halfword |
| 0x10 | leaps at the opponent's +0xE0 position (kept in +0x4E4) |
| 0x20 | the jump motion from slot 48 |
| 0x40 | tested only when a request adds to a jump in progress; not read |
| 0x80 | tested only when a request adds to a jump in progress; not read |

`tests/fm-saturn.test.mjs` reads both tables back. It checks the handler
addresses against the words at 0x06012AEC, and the Plays, Bits and
Distances columns against what the tool's `readKind` reads from those
handlers. A row whose handler no longer does what it says fails.

### Slots

The action-table slots that those handlers play, read the way 0x0600CEC8
reads the table: the fighter row's +4 (Hornet's row is at 0x0608DFE0), stored
in the fighter's +0x34, 66 halfword motion ids. A handler takes slot n's id
from +0x34 + 2n and plays it through 0x060131D0, which looks id & 0xFFF up
in the motion directory at 0x06091CB0 + (id − 1) × 4. 0x0601FC70 fills that
from player 1's bank, then player 2's, then the common one (file 352,
loaded at 0x278000 by 0x0602E8AC), so an id that both banks hold plays the
common copy: 0x11E and 0x6D0 are in file 135 too, with the same keys.
Frames are the motion's length from its bank row.

| Slot | Motion | Frames | Bank | Kinds |
| --- | --- | --- | --- | --- |
| 22 | 0x11b | 36 | 135 | 0x1a |
| 23 | 0x11b | 36 | 135 | 0x1a |
| 24 | 0x11a | 36 | 135 | 0x13 |
| 25 | 0x11a | 36 | 135 | 0x13 |
| 26 | 0x119 | 40 | 135 | 0x1d |
| 27 | 0x117 | 40 | 135 | 0x1e |
| 28 | 0x117 | 40 | 135 | 0x1e |
| 41 | 0x112 | 26 | 135 | 0x1a |
| 42 | 0x111 | 12 | 135 | 0x1a |
| 43 | 0x111 | 12 | 135 | 0x1a |
| 45 | 0x6cf | 77 | 352 | 0x09 |
| 46 | 0x6d0 | 51 | 352 | 0x09 |
| 47 | 0x6d0 | 51 | 352 | 0x09 |
| 48 | 0x8c1 | 73 | 352 | 0x09 |
| 62 | 0x11d | 28 | 135 | 0x31 |
| 63 | 0x11e | 28 | 352 | 0x31 |
| 64 | 0x679 | 30 | 352 | 0x31 |
| 65 | 0x67a | 30 | 352 | 0x31 |

The near and far slots of a dash (22/23, 24/25) and of 0x1E (27/28) hold
the same motion for Hornet, and so do 42/43 and 46/47. Kind 0x1A's 0x725
is a motion id in its code (file 352, 40 frames), not a slot. `--actions`
prints all 66 slots this way. `tests/fm-saturn.test.mjs` checks the table
against a fresh read of Hornet's action table and banks, that its Kinds
column is the Plays column above, and that every slot the Kinds sentences
and the kind 9 bit table name is a row of it.

## The tool

```
node tools/fm-saturn.mjs --fighters
node tools/fm-saturn.mjs hornet --list          # id, frames, data and setup offsets
node tools/fm-saturn.mjs hornet --bones
node tools/fm-saturn.mjs hornet --actions        # slot, motion, frames, bank
node tools/fm-saturn.mjs hornet --moves         # at, move, motion, frames, bank
node tools/fm-saturn.mjs hornet --pose 10a 1    # the car pose, in the cabin's frame
node tools/fm-saturn.mjs hornet 0x11c --out stance.bin
node tools/fm-saturn.mjs hornet 0x11c --json
node tools/fm-saturn.mjs --file 134 --out 134.bin
```

`--disc` reads another `Track01.bin`. `--out` writes a VF2 motion block
(shenmue-motion.mjs's `encodeVF2`, which now also counts linear channels).
`--json` prints FM's channels and VF2's. `tests/fm-saturn.test.mjs` checks
that every motion's keys come out of its VF2 block unchanged, and FM Akira's
0x53 against VF2's motion 11. It skips itself when the disc isn't there.

## Open

- **Daytona's car on the board**: the pieces are found and cut, and each one's
  joint is known (above). Importing them into the board's data ROMs
  (`tools/import-assets.mjs`) and hanging them on those joints is next. That
  includes a broken nose and cabin, if Daytona's car is to break.
- **FM's pose rig and model scale**: which rig FM's solve uses (VF2 has one
  standard rig), and the draw's model scale (300 units a metre is fitted).
- **Hornet's commands**: each move's input is in the Moves table. Still
  open:
  - what the flags it tests mean (+0 bit 0x10000000 above all; nothing
    found sets it with a literal);
  - kind 9's bits 0x40 and 0x80, and its 0.8 compare;
  - the move list's rows after the script (the in-game command list's
    glyphs, probably).
  - The decode is from reading the SH-2 with Capstone. It hasn't been
    checked in Ghidra, or against the game running.
- **The action table's other slots** (stance, walk, …): only those the
  kinds above play are in [Slots](#slots).
- **The fighter rows' numbers** past +4.
