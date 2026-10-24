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
bank. "Kind" and "Parameter" are the move's top two bytes. "Slots" are the
action-table slots ([Slots](#slots)) the request can play: kind 9's are the
ones its parameter bits pick (46, 47 or 48; none for the others), any other
kind's are every slot its [Kinds](#kinds) row plays, and kinds 0x00, 0x10 and
0x2D, which play the request's motion, have none. "Input" is
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

| At | Move | Motion | Frames | Bank | Kind | Parameter | Slots | Input |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0x01f4 | 0x00000712 | 0x712 | 51 | 135 | 0x00 | 0x00 | | P [+0&10000000 +2c&8000000] |
| 0x0220 | 0x00000659 | 0x659 | 41 | 352 | 0x00 | 0x00 | | d+P [+0&10000000 +4a4&1] |
| 0x0230 | 0x000004da | 0x4da | 41 | 352 | 0x00 | 0x00 | | P [+0&10000000 +4a4&1] |
| 0x0250 | 0x000008ee | 0x8ee | 32 | 135 | 0x00 | 0x00 | | after 0x4da: P |
| 0x0294 | 0x000005aa | 0x5aa | 70 | 135 | 0x00 | 0x00 | | f,d,d/f+P [+0&10000000] |
| 0x02d8 | 0x000008dc | 0x8dc | 70 | 135 | 0x00 | 0x00 | | after 0x5aa: n,f,d,d/f+P |
| 0x030c | 0x00000653 | 0x653 | 60 | 135 | 0x00 | 0x00 | | d/b,d/f+P [+0&10000000 +0&10] |
| 0x0340 | 0x000000ff | 0xff | 64 | 135 | 0x00 | 0x00 | | n,f,n,f+P [!+0&10000000] |
| 0x0350 | 0x000006bf | 0x6bf | 50 | 135 | 0x00 | 0x00 | | n,f,n,f+P |
| 0x0390 | 0x000006be | 0x6be | 62 | 135 | 0x00 | 0x00 | | after 0x6bf: f+P |
| 0x03bc, 0x0938 | 0x000008f3 | 0x8f3 | 81 | 135 | 0x00 | 0x00 | | 0x03bc: after 0x6bf: b,f+P+K; 0x0938: P+K [+0&10000000 +2c&8000000] |
| 0x03e4 | 0x000005ae | 0x5ae | 60 | 135 | 0x00 | 0x00 | | d/f+P [+0&10000000 +0&10] |
| 0x0400 | 0x0000075e | 0x75e | 60 | 135 | 0x00 | 0x00 | | d/f+P [+0&10000000] |
| 0x0428 | 0x000006ff | 0x6ff | 60 | 135 | 0x00 | 0x00 | | b,f+P [+0&10000000] |
| 0x0450 | 0x00000110 | 0x110 | 44 | 135 | 0x00 | 0x00 | | f+P [!+0&10000000] |
| 0x0458 | 0x000006c1 | 0x6c1 | 50 | 135 | 0x00 | 0x00 | | f+P |
| 0x0474 | 0x000006f3 | 0x6f3 | 60 | 135 | 0x00 | 0x00 | | f+P [+0&10000000] |
| 0x04b4 | 0x000006b7 | 0x6b7 | 70 | 135 | 0x00 | 0x00 | | b,d,d/b+P [+0&10000000] |
| 0x04f4 | 0x000006b9 | 0x6b9 | 92 | 135 | 0x00 | 0x00 | | after 0x6b7: f,d,d/f+P |
| 0x0504 | 0x000006b8 | 0x6b8 | 92 | 135 | 0x00 | 0x00 | | after 0x6b7: P |
| 0x0534 | 0x000006b2 | 0x6b2 | 80 | 135 | 0x00 | 0x00 | | b,not d+P [+0&10000000] |
| 0x0574 | 0x000008e0 | 0x8e0 | 80 | 135 | 0x00 | 0x00 | | after 0x6b2: b,not d+P [+2c&4] |
| 0x05a0 | 0x000008e5 | 0x8e5 | 80 | 135 | 0x00 | 0x00 | | after 0x6b2: f,not d+P [+2c&4] |
| 0x05d4 | 0x0000014d | 0x14d | 60 | 135 | 0x00 | 0x00 | | d+P [+0&10000000 +4a4&20] |
| 0x05f8 | 0x0000014e | 0x14e | 62 | 135 | 0x00 | 0x00 | | after 0x14d: P |
| 0x060c, 0x0b68 | 0x00000656 | 0x656 | 27 | 352 | 0x00 | 0x00 | | 0x060c: d*+P; 0x0b68: d*+P+K+G [+0&10000000] |
| 0x062c | 0x000008ed | 0x8ed | 24 | 135 | 0x00 | 0x00 | | P [+0&10000000 dist<1.3] |
| 0x064c | 0x000008ef | 0x8ef | 32 | 135 | 0x00 | 0x00 | | P [+0&10000000 dist>=2] |
| 0x0654 | 0x0000010f | 0x10f | 33 | 135 | 0x00 | 0x00 | | P |
| 0x0688 | 0x2d000146 | 0x146 | 70 | 135 | 0x2d | 0x00 | | n,d*+K [+0&10000000 +4a4&20] |
| 0x06b4 | 0x0000056c | 0x56c | 52 | 352 | 0x00 | 0x00 | | d*+K [+0&10000000 +2c&8000000] |
| 0x06bc, 0x0ab0 | 0x000006db | 0x6db | 71 | 135 | 0x00 | 0x00 | | 0x06bc: K [+0&10000000 +2c&8000000]; 0x0ab0: P+K+G [+0&10000000 +2c&8000000] |
| 0x06e8 | 0x00000658 | 0x658 | 57 | 352 | 0x00 | 0x00 | | d*+K [+0&10000000 +4a4&1] |
| 0x06f8 | 0x000004d6 | 0x4d6 | 57 | 352 | 0x00 | 0x00 | | K [+0&10000000 +4a4&1] |
| 0x0734 | 0x000008e6 | 0x8e6 | 49 | 135 | 0x00 | 0x00 | | f,n,f+K [+0&10000000] |
| 0x074c | 0x0000010e | 0x10e | 46 | 135 | 0x00 | 0x00 | | d/f+K |
| 0x0768 | 0x00000652 | 0x652 | 50 | 135 | 0x00 | 0x00 | | d*+K |
| 0x0784 | 0x000006dd | 0x6dd | 60 | 135 | 0x00 | 0x00 | | f+K [+0&10000000] |
| 0x078c, 0x0a8c | 0x0000010d | 0x10d | 46 | 135 | 0x00 | 0x00 | | 0x078c: K; 0x0a8c: (unreached) |
| 0x07ac | 0x0000066c | 0x66c | 63 | 135 | 0x00 | 0x00 | | P+G [+0&10000000 +2c&8000000] |
| 0x07d4, 0x07dc | 0x10000100 | 0x100 | 71 | 135 | 0x10 | 0x00 | | 0x07d4: P+G [+578&8 !+0&10000000]; 0x07dc: P+G [+578&8] |
| 0x0804 | 0x10040098 | 0x98 | 66 | 135 | 0x10 | 0x04 | | P+G [+0&10000000 +578&4000000] |
| 0x0814 | 0x10040096 | 0x96 | 66 | 135 | 0x10 | 0x04 | | P+G [+0&10000000 +578&8000000] |
| 0x0844, 0x084c | 0x1000088c | 0x88c | 71 | 135 | 0x10 | 0x00 | | 0x0844: (unreached); 0x084c: P+G [+0&10000000 +578&10] |
| 0x08ac | 0x100000c9 | 0xc9 | 109 | 135 | 0x10 | 0x00 | | n,d/b,f+P+G [+0&10000000 +578&1] |
| 0x08b4, 0x08e8, 0x0914, 0x0b4c | 0x00000432 | 0x432 | 50 | 352 | 0x00 | 0x00 | | 0x08b4: n,d/b,f+P+G [+0&10000000]; 0x08e8: b+P+G [+0&10000000]; 0x0914: not d+P+G; 0x0b4c: b,f+P+K+G [+0&10000000] |
| 0x08e0 | 0x1000080d | 0x80d | 66 | 135 | 0x10 | 0x00 | | b+P+G [+0&10000000 +578&1] |
| 0x090c | 0x100000fd | 0xfd | 230 | 135 | 0x10 | 0x00 | | not d+P+G [+578&1] |
| 0x098c, 0x0b0c | 0x0000024b | 0x24b | 60 | 352 | 0x00 | 0x00 | | 0x098c: n,b+P+K [!+0&10000000]; 0x0b0c: n,f,b,f,b+P+K+G [!+0&10000000] |
| 0x09c0 | 0x00000776 | 0x776 | 81 | 135 | 0x00 | 0x00 | | n,b,f,n,f+P+K [+0&10000000] |
| 0x09f8 | 0x0000010b | 0x10b | 42 | 135 | 0x00 | 0x00 | | n,b,d/f+P+K [+0&10000000 !+0&10] |
| 0x0a1c | 0x0000010a | 0x10a | 42 | 135 | 0x00 | 0x00 | | d/f+P+K [+0&10000000 +0&10] |
| 0x0a84 | 0x0000010c | 0x10c | 62 | 135 | 0x00 | 0x00 | | (unreached) |
| 0x0b44 | 0x10000440 | 0x440 | 100 | 135 | 0x10 | 0x00 | | b,f+P+K+G [+0&10000000 +578&1] |
| 0x0b88 | 0x00000883 | 0x883 | 30 | 352 | 0x00 | 0x00 | | b+P+K+G [+0&10000000] |
| 0x0ba8 | 0x00000884 | 0x884 | 30 | 352 | 0x00 | 0x00 | | f+P+K+G [+0&10000000] |
| 0x0bb0 | 0x00000700 | 0x700 | 60 | 135 | 0x00 | 0x00 | | P+K+G |
| 0x0bd4, 0x0df4 | 0x1a000000 | - | - | - | 0x1a | 0x00 | 22, 23, 41, 42, 43 | 0x0bd4: f,n,f; 0x0df4: f+8 |
| 0x0bf4, 0x0e0c | 0x13000000 | - | - | - | 0x13 | 0x00 | 24, 25 | 0x0bf4: b,n,b; 0x0e0c: b+8 |
| 0x0c20 | 0x1d000000 | - | - | - | 0x1d | 0x00 | 26 | d/f,not f/b,d/f [+0&10] |
| 0x0c44 | 0x1e000000 | - | - | - | 0x1e | 0x00 | 27, 28 | d/b,not f/b,d/b [+0&10] |
| 0x0c5c, 0x0d24 | 0x0914013a | 0x13a | 100 | 135 | 0x09 | 0x14 | 46 | 0x0c5c: air 2 P [+0&10000000 +4a4&20]; 0x0d24: air 1 P [+0&10000000 +4a4&20] |
| 0x0c64 | 0x090c0561 | 0x561 | 50 | 135 | 0x09 | 0x0c | 46 | air 2 P [+0&10000000] |
| 0x0c84 | 0x0904089d | 0x89d | 51 | 135 | 0x09 | 0x04 | 46 | air 2 K [+0&10000000 +6c0&40000 +70&10000] |
| 0x0c9c, 0x0ccc | 0x090402fb | 0x2fb | 49 | 135 | 0x09 | 0x04 | 46 | 0x0c9c: air 2 K [+0&10000000 +6c0&40000]; 0x0ccc: air 2 K [+0&10000000 +70&10000] |
| 0x0cb4 | 0x090402ee | 0x2ee | 57 | 352 | 0x09 | 0x04 | 46 | air 2 K [+0&10000000 +4a4&1] |
| 0x0cd4 | 0x090402f9 | 0x2f9 | 49 | 135 | 0x09 | 0x04 | 46 | air 2 K [+0&10000000] |
| 0x0cdc | 0x090c055f | 0x55f | 79 | 135 | 0x09 | 0x0c | 46 | air 4 P [+0&10000000] |
| 0x0cf0 | 0x090402ef | 0x2ef | 44 | 135 | 0x09 | 0x04 | 46 | air 4 K [+0&10000000] |
| 0x0d04 | 0x090c02fc | 0x2fc | 46 | 352 | 0x09 | 0x0c | 46 | air 4 d*+K [+0&10000000] |
| 0x0d0c | 0x090c02f6 | 0x2f6 | 53 | 352 | 0x09 | 0x0c | 46 | air 4 K [+0&10000000] |
| 0x0d2c | 0x09080314 | 0x314 | 80 | 135 | 0x09 | 0x08 | | air 1 P [+0&10000000] |
| 0x0d38 | 0x0900030d | 0x30d | 100 | 352 | 0x09 | 0x00 | | air 1 K [+0&10000000] |
| 0x0d48 | 0x09080561 | 0x561 | 50 | 135 | 0x09 | 0x08 | | air 3 P [+0&10000000] |
| 0x0d60 | 0x09080301 | 0x301 | 59 | 352 | 0x09 | 0x08 | | air 3 b+K [+0&10000000] |
| 0x0d74 | 0x090802ff | 0x2ff | 69 | 352 | 0x09 | 0x08 | | air 3 f+K [+0&10000000] |
| 0x0d88 | 0x09000302 | 0x302 | 60 | 352 | 0x09 | 0x00 | | air 3 d*+K [+0&10000000] |
| 0x0d98 | 0x09000303 | 0x303 | 49 | 352 | 0x09 | 0x00 | | air 3 K [+0&10000000] |
| 0x0dac | 0x09080304 | 0x304 | 60 | 352 | 0x09 | 0x08 | | air 3 d*+K [+0&10000000] |
| 0x0dbc | 0x09080305 | 0x305 | 44 | 352 | 0x09 | 0x08 | | air 3 K [+0&10000000] |
| 0x0e1c | 0x31000000 | - | - | - | 0x31 | 0x00 | 62, 63, 64, 65 | 8 |

`tests/fm-saturn.test.mjs` reads this table back. It checks that every motion
listed with bank 135 is one of the 103 in Hornet's bank, that the 352 ones
are in the common bank, and that the table, inputs included, is what the
tool reads off the disc. It also checks the Slots column against that rule
and that each slot in it is a row of [Slots](#slots).

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

#### Bits 0x40 and 0x80

Of the kinds Hornet uses, only kind 9's handlers test these two bits:
three times in the accept handler, on the request (r11, +0x3C), and three
times in the run handler, on +0x71 (the accept handler stores the request,
bits and all, in +0x70). "Behind" names fighter-flag tests that every path
to the bit's test goes through, and which way each must go; I stopped
there and leave those flags undescribed. Each branch is followed to its
next conditional branch, return or jmp.

| Handler | Bit | Tested at | Behind | With the bit | Without it |
| --- | --- | --- | --- | --- | --- |
| accept | 0x80 | 0x0600dc96 | 0x0600db22 +0x2c & 0x00001000 set; 0x0600dc80 +0x6c0 & 0x02000000 clear | stores the request in +0x70 | plays the request's motion; stores the request in +0x70 |
| accept | 0x40 | 0x0600dce0 | 0x0600db22 +0x2c & 0x00001000 set; 0x0600dc80 +0x6c0 & 0x02000000 set | stores the request in +0x70 | goes on to the 0x80 test at 0x0600dce6 |
| accept | 0x80 | 0x0600dce6 | 0x0600db22 +0x2c & 0x00001000 set; 0x0600dc80 +0x6c0 & 0x02000000 set | stores the request in +0x70 | goes on to the 0x08 test at 0x0600dcee |
| run | 0x80 | 0x0600eeca | 0x0600ed16 +0x00 & 0x00000020 set; 0x0600ee78 +0x6c0 & 0x00030000 set | clears the bit; plays the request's motion | plays no motion |
| run | 0x80 | 0x0600efde | 0x0600ed16 +0x00 & 0x00000020 set; 0x0600ed40 +0x6c0 & 0x02000000 set | clears the bit; plays the request's motion | plays no motion |
| run | 0x40 | 0x0600f1bc | 0x0600ed16 +0x00 & 0x00000020 set; 0x0600ed36 +0x6c0 & 0x00001000 set | clears the bit; plays the request's motion | plays motion 0x8b3 |

- **0x80** holds an air attack's motion for the run handler. A kind 9
  request that reaches the accept handler late in a jump (past the
  stage > 1 branch at 0x0600db2e) plays its motion at once; with 0x80 it
  doesn't (flag clear), or doesn't set the 0x08 hold (flag set). The run
  handler plays the motion, and clears the bit, only at 0x0600eeca or
  0x0600efde, behind their flags; without the bit those branches play
  nothing.
- **0x40**, in the run handler behind +0x6c0 & 0x00001000, picks the
  request's motion over motion 0x8b3 (file 352, 39 frames). In the accept
  handler (flag set) it skips the 0x08 hold, as 0x80 does.
- **Hornet** never sets either: none of his 95 requests' parameter bytes
  has 0x40 or 0x80 (his kind 9 ones are 0, 0x04, 0x08, 0x0C and 0x14).

The bit table's 0x40 and 0x80 rows above name the accept handler's tests
only; the run handler's are the last three rows here.
`tests/fm-saturn.test.mjs` checks this table against the tool's
`readBitTests` and `guard` on a fresh read, and the Hornet line against
his script.

#### The flags behind them

The six distinct flag tests in the Behind column above, read off the disc.
A byte test is given as the long holding it, as there. The accept
handler's 0x0600db22 is reached only when the current action is a kind 9
too, a jump in progress. Each side is followed until it returns, reaches
the run handler's `jmp @r14` ("ends this frame's run": the jump carries on
next frame), or reaches a test of a flag that isn't in the Behind column;
that is "stops at", and that flag is left undescribed.

| Tested at | Handler | Flag | Set | Clear |
| --- | --- | --- | --- | --- |
| 0x0600db22 | accept | +0x2c & 0x00001000 | keeps the jump: the stage test (0x0600db2c); at stage ≤ 1 it adds +0x70's bits to the request (0x0600db3c) and sets +0x4aa, the airtime, (0x0600db86) without clearing +0x50 or +0x60; past it, the +0x6c0 & 0x02000000 test (0x0600dc80); then stores the request in +0x70 (0x0600da7c) | starts the jump over: clears +0x50 (0x0600db42) and +0x60, the stage, (0x0600db46), sets +0x4b0, the direction, (0x0600db60) and +0x4aa, the airtime, (0x0600db86), then stores the request in +0x70 (0x0600da7c) |
| 0x0600dc80 | accept | +0x6c0 & 0x02000000 | with a motion (the motion-id test (0x0600dcd8)), the 0x40 test (0x0600dce0) and then the 0x80 test (0x0600dce6) skip the hold, else the 0x08 test (0x0600dcee) sets +0x4ac, the hold, (0x0600dcc4); plays no motion; then stores the request in +0x70 (0x0600da7c) | with a motion (the motion-id test (0x0600dc88)), the 0x08 test (0x0600dc90) sets +0x4ac, the hold, (0x0600dcc4), else the 0x80 test (0x0600dc96) holds it back, else it plays the request's motion (0x0600dc9c); then stores the request in +0x70 (0x0600da7c) |
| 0x0600ed16 | run | +0x00 & 0x00000020 | changes nothing in the jump before it stops at 0x0600ed20 (+0x6c0 & 0x04000000), the first of a chain of +0x6c0 tests | after the 0x04 test (0x0600f37e) calls 0x06014ca4 (0x0600f386), or with the bit calls 0x06014ca4 (0x0600f398); stops at 0x0600f3a4 (+0x6c0 & 0x20000000); whichever way it goes, it then clears +0x70 (0x0600f3de): the jump ends |
| 0x0600ed36 | run | +0x6c0 & 0x00001000 | while the +0x6c6 counter (0x0600f0d0) isn't 0, moves the fighter and ends this frame's run (0x0600f3f6); at 0 it sets +0x24 (0x0600f17a), calls 0x06012efc (0x0600f182) for a new airtime in +0x4a8 (0x0600f18a) and +0x4aa (0x0600f190), sets +0x6c0 (0x0600f1aa) and goes on to the 0x40 test (0x0600f1bc) | goes on to the +0x6c0 & 0x02000000 test (0x0600ed40) |
| 0x0600ed40 | run | +0x6c0 & 0x02000000 | while the +0x6c6 counter (0x0600efd0) isn't 0, the 0x80 test (0x0600efde): with the bit it plays the request's motion (0x0600eff6) and sets +0x6c0 (0x0600f020) and +0x6c6 (0x0600f046) again, without it it ends this frame's run (0x0600f3f6); at 0 it sets +0x6c0 (0x0600f242) and stops at 0x0600f27a (+0x6c0 & 0x00040000) | changes nothing in the jump before it stops at 0x0600ed4c (+0x00 & 0x04000000) |
| 0x0600ee78 | run | +0x6c0 & 0x00030000 | changes nothing in the jump before it stops at 0x0600ee84 (+0x6c0 & 0x80000000) | ends this frame's run (0x0600f3f6) |

- **+0x2c & 0x00001000**: set, a kind 9 request that comes during a jump
  joins it; clear, it starts a new one from stage 0.
- **+0x6c0 & 0x02000000**, in the accept handler: set, a late air attack's
  motion never plays at once; clear, it plays at once unless 0x08 or 0x80
  holds it back.
- **+0x6c0 & 0x02000000**, in the run handler: set, the branch where a
  held-back 0x80 motion plays while the +0x6c6 counter runs; clear, nothing
  changes before 0x0600ed4c.
- **+0x00 & 0x00000020**: set, nothing changes before 0x0600ed20; clear,
  the jump ends.
- **+0x6c0 & 0x00001000**: set, it runs the +0x6c6 counter down, then
  starts a second arc of airtime and plays the 0x40 test's motion; clear,
  it goes on to the run handler's +0x6c0 & 0x02000000 test.
- **+0x6c0 & 0x00030000**: set, nothing changes before 0x0600ee84; clear,
  the frame ends before the 0x80 test at 0x0600eeca.

`tests/fm-saturn.test.mjs` checks that the rows are the Behind column's
flags, that each row and each bullet gives both sides, each row's field and mask, and every address in a cell against a
fresh read: that it does what the cell says and that the side can reach
it; each "stops at" flag is the one tested there and isn't in the Behind
column.

#### The flags they stop at

The five flag tests that "The flags behind them" stops at, all in the run
handler, read off the disc. Each side is followed path by path from the
registers at the test: a compare's branch both ways, a second test of the
same flag the same way as the first. It ends at the run handler's
`jmp @r14` ("ends this frame's run"), or "stops at" a test of another
flag, which is left undescribed, or goes on to a parameter bit's test.
A cell names every store, call and stop on its side. Constants are 16.16
fixed point.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600ed20 | +0x6c0 & 0x04000000 | ends this frame's run (0x0600f3f6) and nothing else | changes nothing in the jump before it stops at 0x0600ed2a (+0x6c0 & 0x00000040) |
| 0x0600ed4c | +0x00 & 0x04000000 | changes nothing in the jump before it stops at 0x0600ee16 (+0x6c0 & 0x40000000) | changes nothing in the jump before it stops at 0x0600ed58 (+0x6c0 & 0x20000000), the flag 0x0600f3a4 tests, on another path |
| 0x0600ee84 | +0x6c0 & 0x80000000 | changes nothing in the jump before it stops at 0x0600ee8a (+0x6c0 & 0x00000001) | limits +0x20 (0x0600eeaa) and +0x28 (0x0600eec2) to ±0x0a3d (0.04); goes on to the 0x80 test (0x0600eeca) |
| 0x0600f27a | +0x6c0 & 0x00040000 | scales r4, not stored before the stop, by 0x00008e35 (0x0600f27e); after the same test again (0x0600f290) puts 0x8b3 in +0x68a (0x0600f29a); stops at 0x0600f2a0 (+0x6c0 & 0x00080000) | after the same test again (0x0600f290) puts the halfword at +6 of a table entry in +0x68a (0x0600f29a); stops at 0x0600f2a0 (+0x6c0 & 0x00080000) |
| 0x0600f3a4 | +0x6c0 & 0x20000000 | sets +0x20 (0x0600f3d6) and +0x28 (0x0600f3d8) to themselves times 0x0000cccd (0.8); clears +0x70 (0x0600f3de): the jump ends; then, if +0x52 isn't past +0x648, sets +0x2f (0x0600f3f4); ends this frame's run (0x0600f3f6) | clears +0x20 (0x0600f3ae), +0x24 (0x0600f3b0) and +0x28 (0x0600f3b2); clears +0x70 (0x0600f3de): the jump ends; then, if +0x52 isn't past +0x648, sets +0x2f (0x0600f3f4); ends this frame's run (0x0600f3f6) |

- **+0x6c0 & 0x04000000**: set, the jump does nothing more this frame;
  clear, nothing changes before 0x0600ed2a.
- **+0x00 & 0x04000000**: set, nothing changes before 0x0600ee16; clear,
  nothing changes before 0x0600ed58.
- **+0x6c0 & 0x80000000**: set, nothing changes before 0x0600ee8a; clear,
  +0x20 and +0x28 are held within ±0.04 before the 0x80 test at
  0x0600eeca.
- **+0x6c0 & 0x00040000**: set, +0x68a gets 0x8b3; clear, it gets a
  halfword from a table instead.
- **+0x6c0 & 0x20000000**: set, the jump ends with +0x20 and +0x28 scaled
  by 0.8; clear, it ends with +0x20, +0x24 and +0x28 cleared.

The 0x0000cccd at 0x0600f3a4 scales two fields; it is not the 0.8
distance check, which none of these sides reaches, and none reaches `+0`
bit 0x10000000. The flags tested at 0x0600ed2a, 0x0600ed58, 0x0600ee16,
0x0600ee8a and 0x0600f2a0 are left undescribed; 0x0600ed58's is the one
0x0600f3a4 tests, on another path.
`tests/fm-saturn.test.mjs` checks the rows against the stops in "The
flags behind them", and each cell against the tool's `flagSides` on a
fresh read: every claim, and that no store, call or stop is left out.

#### The flags those stop at

The five flag tests that "The flags they stop at" stops at, all in the run
handler, read off the disc and followed the same way. Each field and mask
there matches the disc, 0x0600f2a0's too. r13 holds the opponent, as for
kind 0x10. A test of one of these five is "goes on to" it, in this table;
a test of any other flag "stops at" it. A bit set or cleared is given as
the flag it is, a byte as the long holding it.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600ed2a | +0x6c0 & 0x00000040 | clears +0x30 & 0x00000008 (0x0600f03e); puts +0x63c in +0x6c6 (0x0600f046); takes one from +0x6c6 (0x0600f050); sets +0x6c0 & 0x00001000 (0x0600f05c); puts +0x658 plus 0x0002b333 (2.7) in +0x6f0 (0x0600f068); puts +0xc in +0x6e0 (0x0600f078), +0x10 in +0x6e4 (0x0600f07a) and +0x14 in +0x6e8 (0x0600f07c); sets +0x6f8 (0x0600f09e) to +0x6f0 less +0x10, over the halfword +0x646, with the divide unit; ends this frame's run (0x0600f3f6) | changes nothing in the jump before it stops at 0x0600ed36 (+0x6c0 & 0x00001000) |
| 0x0600ed58 | +0x6c0 & 0x20000000 | changes nothing in the jump before it goes on to the test at 0x0600ee16 (+0x6c0 & 0x40000000) | changes nothing in the jump before it stops at 0x0600ed64 (the opponent's +0x19f0 & 0x00002000) |
| 0x0600ee16 | +0x6c0 & 0x40000000 | with +0x514 and +0x51c both 0, or the halfword +0x4a8 at 1 or less, ends this frame's run (0x0600f3f6); else stops at 0x0600ee44 (+0x30 & 0x00000008) | ends this frame's run (0x0600f3f6) and nothing else |
| 0x0600ee8a | +0x6c0 & 0x00000001 | limits +0x20 (0x0600eeaa) and +0x28 (0x0600eec2) to ±0x0a3d (0.04); goes on to the 0x80 test (0x0600eeca) | ends this frame's run (0x0600f3f6) and nothing else |
| 0x0600f2a0 | +0x6c0 & 0x00080000 | sets +0x6c0 & 0x00400000 (0x0600f304); with the table entry's halfword at +4 negative, goes the clear side's way: sets +0x20 (0x0600f2b2) and +0x28 (0x0600f2c2), skips the call (0x0600f2cc) as that halfword is negative, and puts -0x07ae (-0.03) in +0x24 (0x0600f2f2); else calls 0x06010dda (0x0600f30e) with it: if that returns zero, stops at 0x0600f340 (+0x6c0 & 0x01000000); if nonzero, clears +0x6c0 & 0x00400000 (0x0600f320), clears +0x20 (0x0600f324) and +0x28 (0x0600f326) and puts 0x07ae (0.03) in +0x24 (0x0600f32a); ends this frame's run (0x0600f3f6) | sets +0x20 (0x0600f2b2) and +0x28 (0x0600f2c2); with the table entry's halfword at +4 negative, puts -0x07ae (-0.03) in +0x24 (0x0600f2f2); else calls 0x06010dda (0x0600f2cc) with it, and if that returns nonzero, clears +0x20 (0x0600f324) and +0x28 (0x0600f326) and puts 0x07ae (0.03) in +0x24 (0x0600f32a); ends this frame's run (0x0600f3f6) |

- **+0x6c0 & 0x00000040**: set, it sets +0x6c0 & 0x00001000 and starts
  the +0x6c6 counter from +0x63c, aims +0x6f0 at 2.7 above +0x658 and
  ends the frame; clear, nothing changes before 0x0600ed36.
- **+0x6c0 & 0x20000000**: set, nothing changes before 0x0600ee16; clear,
  nothing changes before 0x0600ed64.
- **+0x6c0 & 0x40000000**: set, the frame ends or it goes on to the
  +0x30 & 0x00000008 test; clear, the frame ends.
- **+0x6c0 & 0x00000001**: set, +0x20 and +0x28 are held within ±0.04
  before the 0x80 test at 0x0600eeca, as on 0x0600ee84's clear side;
  clear, the frame ends.
- **+0x6c0 & 0x00080000**: set, it marks +0x6c0 & 0x00400000 and asks
  0x06010dda about the table halfword; clear, +0x24 gets -0.03, or 0.03
  with +0x20 and +0x28 cleared.

Neither side of 0x0600ed58 joins 0x0600f3a4's path before it stops: set
goes to 0x0600ee16, clear stops at the opponent's flag. 0x0600ed2a's set
side is where +0x6c0 & 0x00001000, the flag 0x0600ed36 tests in "The
flags behind them", is set. None of these sides reaches the 0.8 distance
check or `+0` bit 0x10000000. The flags tested at 0x0600ed36, 0x0600ed64,
0x0600ee44 and 0x0600f340 are left undescribed.
`tests/fm-saturn.test.mjs` checks this section the same way as the one
before it, and also reads 0x0600ee16's two end conditions (the compares
before each branch, in order) and 0x0600ed2a's divide (what goes into the
divide unit's dividend and divisor) off the disc.

#### The flags those four stop at

The four flag tests that "The flags those stop at" stops at, all in the
run handler, read off the disc and followed the same way. Each field and
mask there matches the disc, 0x0600f340's too. 0x0600ed36 is the run
handler's +0x6c0 & 0x00001000 test that "The flags behind them" already
describes; both its sides are as that row says, and are not rewritten
here.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600ed36 | +0x6c0 & 0x00001000 | as "The flags behind them" says for 0x0600ed36 | as "The flags behind them" says for 0x0600ed36 |
| 0x0600ed64 | the opponent's +0x19f0 & 0x00002000 | calls 0x06024094 (0x0600ed7c); if that returns nonzero, sets +0x6c0 & 0x20000000 (0x0600ed8e), calls 0x060564cc (0x0600edb4) and sets +0x20 (0x0600ee0a) and +0x28 (0x0600ee0c); either way stops at 0x0600ee16 (+0x6c0 & 0x40000000) | changes nothing in the jump before it stops at 0x0600ed6a (the opponent's +0x19f0 & 0x00024100) |
| 0x0600ee44 | +0x30 & 0x00000008 | with the table at 0x0606922c's halfword for the byte +0x4 less bit 0x08 over 3, or +0xe4 under 0x00016666 (1.4), ends this frame's run (0x0600f3f6); else stops at 0x0600ee78 (+0x6c0 & 0x00030000) | ends this frame's run (0x0600f3f6) and nothing else |
| 0x0600f340 | +0x6c0 & 0x01000000 | ends this frame's run (0x0600f3f6) and nothing else | calls 0x06024094 (0x0600f34a); if that returns nonzero, sets +0x6c0 & 0x01000000 (0x0600f35c); else calls 0x060129f4 (0x0600f36a); ends this frame's run (0x0600f3f6) |

- **+0x6c0 & 0x00001000**: set, the +0x6c6 counter branch "The flags
  behind them" gives; clear, its +0x6c0 & 0x02000000 test.
- **the opponent's +0x19f0 & 0x00002000**: set, with 0x06024094's yes it
  sets +0x6c0 & 0x20000000 and rewrites +0x20 and +0x28; clear, nothing
  changes before 0x0600ed6a.
- **+0x30 & 0x00000008**: set, the frame ends unless the table halfword
  is 3 or less and +0xe4 is at least 1.4; clear, the frame ends.
- **+0x6c0 & 0x01000000**: set, the frame ends; clear, with 0x06024094's
  yes it sets this same flag, else it calls 0x060129f4.

0x0600ed64 and 0x0600f340 both call 0x06024094, as 0x0600ed58's clear
side does past 0x0600ed64. None of these sides reaches the 0.8 distance
check or `+0` bit 0x10000000. The flags tested at 0x0600ed6a, 0x0600ee16
and 0x0600ee78 are left undescribed here; 0x0600ee16's is in "The flags
those stop at", 0x0600ee78's in "The flags behind them".
`tests/fm-saturn.test.mjs` checks this section the same way, with each
end condition and each call's nonzero and zero ways read off the disc.

#### The flag at 0x0600ed6a

The flag test that "The flags those four stop at" stops at on 0x0600ed64's
clear side, in the run handler, read off the disc and followed the same
way. The field and mask named there match the disc: 0x0600ed6a is
`tst r3,r5`, with r5 the opponent's (r13's) +0x19f0 and r3 0x00024100,
loaded at 0x0600ed68. The mask holds three bits (0x00020000, 0x00004000,
0x00000100); set means any of them is.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600ed6a | the opponent's +0x19f0 & 0x00024100 | changes nothing in the jump before it branches to 0x0600ee0e, on 0x0600ed64's set path past its stores at 0x0600ee0a and 0x0600ee0c, and stops at 0x0600ee16 (+0x6c0 & 0x40000000) | changes nothing in the jump before it stops at 0x0600ed74 (+0x2c & 0x00000100) |

- **the opponent's +0x19f0 & 0x00024100**: set, it joins 0x0600ed64's set
  path after that path's stores, and nothing changes before 0x0600ee16;
  clear, nothing changes before 0x0600ed74.

0x0600ed74 tests bit 0x01 of the byte +0x2e, given as the long's flag.
Neither side reaches the 0.8 distance check or `+0` bit 0x10000000. The
flags tested at 0x0600ed74 and 0x0600ee16 are left undescribed here;
0x0600ee16's is in "The flags those stop at". `tests/fm-saturn.test.mjs`
checks this section against a fresh read.

#### The flag at 0x0600ed74

The flag test that "The flag at 0x0600ed6a" stops at on its clear side,
in the run handler, read off the disc and followed the same way. The
fighter, field and mask named there match the disc: 0x0600ed6e is
`mov r12,r1`, 0x0600ed70 `add #0x2e,r1`, 0x0600ed72 `mov.b @r1,r0` and
0x0600ed74 `tst #0x01,r0`, then `bf` at 0x0600ed76. That is bit 0x01 of
the byte +0x2e of this fighter (r12), not the opponent's; on the
big-endian SH-2 it is the long +0x2c's 0x00000100.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600ed74 | +0x2c & 0x00000100 | changes nothing in the jump before it branches to 0x0600ee0e, on 0x0600ed64's set path past its stores at 0x0600ee0a and 0x0600ee0c, and stops at 0x0600ee16 (+0x6c0 & 0x40000000) | goes on to 0x0600ed78, where 0x0600ed64's set path starts, and does what "The flags those four stop at" says that side does, to its stop at 0x0600ee16 (+0x6c0 & 0x40000000) |

- **+0x2c & 0x00000100**: set, it joins 0x0600ed64's set path after that
  path's stores, and nothing changes before 0x0600ee16; clear, it joins
  0x0600ed64's set path where it starts, which is not rewritten here.

Neither side reaches the 0.8 distance check or `+0` bit 0x10000000. Both
sides stop at 0x0600ee16, whose flag is in "The flags those stop at" and
is left undescribed here. `tests/fm-saturn.test.mjs` checks this section
against a fresh read.

#### Flag tests not yet described

The flag tests in kind 9's run handler, 0x0600ea14 to 0x0600f400, whose
address no Kinds subsection above has as the flag it tests, read off the
disc: every `tst` that a `bt` or `bf` branches on and that the tool's
`flagSides` reads as a fighter field and mask, in address order, whether
or not Hornet's parameters reach it. A byte test is given as the long
holding it, big-endian, as above; +0x70 is the current action, so its
masks are parameter bits.

| Tested at | Fighter | Field | Mask |
| --- | --- | --- | --- |
| 0x0600ea64 | this fighter (r12) | +0x70 | 0x00080000 |
| 0x0600ead0 | this fighter (r12) | +0x70 | 0x00100000 |
| 0x0600eaee | this fighter (r12) | +0x70 | 0x00020000 |
| 0x0600eaf6 | this fighter (r12) | +0x70 | 0x00040000 |
| 0x0600eb08 | this fighter (r12) | +0x70 | 0x00200000 |
| 0x0600eb44 | this fighter (r12) | +0x70 | 0x00200000 |
| 0x0600eb62 | this fighter (r12) | +0x4a4 | 0x00000001 |
| 0x0600eb74 | this fighter (r12) | +0x70 | 0x00200000 |
| 0x0600ec64 | this fighter (r12) | +0x4a4 | 0x00000001 |
| 0x0600ec8e | this fighter (r12) | +0x70 | 0x00040000 |
| 0x0600ecd0 | this fighter (r12) | +0x6c0 | 0x02000000 |
| 0x0600ecda | this fighter (r12) | +0x70 | 0x00080000 |
| 0x0600f008 | this fighter (r12) | +0x11d4 | 0x00100000 |
| 0x0600f1f6 | this fighter (r12) | +0x6c0 | 0x00080000 |
| 0x0600f290 | this fighter (r12) | +0x6c0 | 0x00040000 |
| 0x0600f37e | this fighter (r12) | +0x70 | 0x00040000 |

Not listed: the `tst`s of a register against itself, and those at
0x0600edfa, 0x0600ee02 and 0x0600efa0, whose value isn't a fighter field.
`tests/fm-saturn.test.mjs` checks this list against a fresh read.

#### The flag at 0x0600ea64

The earliest row of "Flag tests not yet described", in the run handler,
read off the disc and followed the same way. The fighter, field and mask
in that row match the disc: 0x0600ea5c is `mov #0x70,r0`, 0x0600ea5e
`mov.l @(r0,r12),r3`, 0x0600ea60 `mov #0x08,r0`, 0x0600ea62 `shll16 r0`
and 0x0600ea64 `tst r0,r3`, then `bt` at 0x0600ea66. That is the long
+0x70 of this fighter (r12), not the opponent's, masked with 0x00080000:
parameter bit 0x08. The `bt` branches when the bit is clear, so the
branch is the clear side and the fall-through the set side.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600ea64 | +0x70 & 0x00080000 | unless the halfword +0x4a8 is over the halfword +0x4ac (0x0600ea70), clears +0x70 & 0x00080000 (0x0600ea7a) and calls 0x060131d0 (0x0600ea7e); puts the byte +0x4aa in the halfword +0x4a8 (0x0600ea88); sets +0x24 (0x0600eac8); stops at 0x0600ead0 (+0x70 & 0x00100000) | branches to 0x0600ea7c, where the set side's call is loaded, and calls 0x060131d0 (0x0600ea7e); puts the byte +0x4aa in the halfword +0x4a8 (0x0600ea88); sets +0x24 (0x0600eac8); stops at 0x0600ead0 (+0x70 & 0x00100000) |

- **+0x70 & 0x00080000**: set, it clears this same bit and calls
  0x060131d0, unless the halfword +0x4a8 is over +0x4ac; clear, it calls
  0x060131d0 with no compare. Both sides then put the byte +0x4aa in
  +0x4a8 and set +0x24 before they stop at 0x0600ead0.

Both sides stop at 0x0600ead0, which tests this fighter's (r12) +0x70 &
0x00100000, parameter bit 0x10; it is a row in "Flag tests not yet
described" and is left undescribed here. Neither side reaches the 0.8
distance check or `+0` bit 0x10000000. `tests/fm-saturn.test.mjs` checks
this section against a fresh read.

#### The flag at 0x0600ead0

The flag test that both sides of "The flag at 0x0600ea64" stop at, the
next row of "Flag tests not yet described", read off the disc and
followed the same way. The fighter, field and mask in that row match the
disc: 0x0600eaca is `mov r12,r1`, 0x0600eacc `add #0x71,r1`, 0x0600eace
`mov.b @r1,r0` and 0x0600ead0 `tst #0x10,r0`, then `bt` at 0x0600ead2.
That is bit 0x10 of the byte +0x71 of this fighter (r12), not the
opponent's; on the big-endian SH-2 it is the long +0x70's 0x00100000:
parameter bit 0x10. The `bt` branches when the bit is clear, so the
branch is the clear side and the fall-through the set side.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600ead0 | +0x70 & 0x00100000 | goes on to the `bra` at 0x0600ead4, which branches to 0x0600ec58; no store or call; stops at 0x0600ec64 (+0x4a4 & 0x00000001) | branches to 0x0600ead8; no store or call; stops at 0x0600eaee (+0x70 & 0x00020000) |

- **+0x70 & 0x00100000**: set, it jumps ahead to 0x0600ec58 and stops at
  0x0600ec64; clear, it goes on at 0x0600ead8 and stops at 0x0600eaee.
  Neither side stores or calls anything before its stop.

The set side stops at 0x0600ec64, which tests this fighter's (r12)
+0x4a4 & 0x00000001; the clear side stops at 0x0600eaee, which tests this
fighter's (r12) +0x70 & 0x00020000, parameter bit 0x02. Both are rows in
"Flag tests not yet described" and are left undescribed here. Neither
side reaches the 0.8 distance check or `+0` bit 0x10000000.
`tests/fm-saturn.test.mjs` checks this section against a fresh read.

#### The flag at 0x0600eaee

The flag test that the clear side of "The flag at 0x0600ead0" stops at,
the next row of "Flag tests not yet described", read off the disc and
followed the same way. The fighter, field and mask in that row match the
disc: 0x0600eae6 is `mov #0x70,r0`, 0x0600eae8 `mov.l @(r0,r12),r3`,
0x0600eaea `mov #0x02,r0`, 0x0600eaec `shll16 r0` and 0x0600eaee
`tst r0,r3`, then `bf` at 0x0600eaf0. That is the long +0x70 of this
fighter (r12), not the opponent's, masked with 0x00020000: parameter bit
0x02. The `bf` branches when the bit is set, so the branch is the set
side and the fall-through the clear side.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600eaee | +0x70 & 0x00020000 | branches to 0x0600eb52, where `tst r7,r7` and the `bt` at 0x0600eb54 go both ways: it goes on with no store or call and stops at 0x0600eb62 (+0x4a4 & 0x00000001); or it branches to 0x0600ebda, puts the halfword +0x1a, or that minus 0x8000, in the halfword +0x4ae (0x0600ec08); sets +0x20 (0x0600ec42); sets +0x28 (0x0600ec44); calls 0x06012d50 (0x0600ec7a); adds 1 to the byte +0x60 (0x0600ec86); stops at 0x0600ec8e (+0x70 & 0x00040000) | goes on to 0x0600eaf2; no store or call; stops at 0x0600eaf6 (+0x70 & 0x00040000) |

- **+0x70 & 0x00020000**: set, it jumps ahead to 0x0600eb52, and from
  there either stops at 0x0600eb62 or goes on at 0x0600ebda to store
  +0x4ae, +0x20 and +0x28, call 0x06012d50 and add 1 to +0x60 before it
  stops at 0x0600ec8e; clear, it goes on at 0x0600eaf2 and stops at
  0x0600eaf6 with no store or call.

The 0x8000 is the halfword at 0x0600ec4a, read with `mov.w`, so it is
added as −0x8000. The set side stops at 0x0600eb62, which tests this
fighter's (r12) +0x4a4 & 0x00000001, or at 0x0600ec8e, which tests this
fighter's (r12) +0x70 & 0x00040000, parameter bit 0x04; the clear side
stops at 0x0600eaf6, which tests this fighter's (r12) +0x70 & 0x00040000,
parameter bit 0x04. All three are rows in "Flag tests not yet described"
and are left undescribed here, and so is the `tst r7,r7`. Neither side
reaches the 0.8 distance check or `+0` bit 0x10000000.
`tests/fm-saturn.test.mjs` checks this section against a fresh read.

#### The flag at 0x0600eaf6

The flag test that the clear side of "The flag at 0x0600eaee" stops at,
the next row of "Flag tests not yet described", read off the disc and
followed the same way. The fighter, field and mask in that row match the
disc: r3 still holds what 0x0600eae6 `mov #0x70,r0` and 0x0600eae8
`mov.l @(r0,r12),r3` loaded; 0x0600eaf2 is `mov #0x04,r0`, 0x0600eaf4
`shll16 r0` and 0x0600eaf6 `tst r0,r3`, then `bt` at 0x0600eaf8. That is
the long +0x70 of this fighter (r12), not the opponent's, masked with
0x00040000: parameter bit 0x04. The `bt` branches when the bit is clear,
so the branch is the clear side and the fall-through the set side.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600eaf6 | +0x70 & 0x00040000 | goes on to 0x0600eafa; no store or call; stops at 0x0600eb08 (+0x70 & 0x00200000) | branches to 0x0600eb40; no store or call; stops at 0x0600eb44 (+0x70 & 0x00200000) |

- **+0x70 & 0x00040000**: set, it goes on at 0x0600eafa and stops at
  0x0600eb08; clear, it jumps ahead to 0x0600eb40 and stops at
  0x0600eb44. Neither side stores or calls anything before its stop.

The set side stops at 0x0600eb08 and the clear side at 0x0600eb44; both
test this fighter's (r12) +0x70 & 0x00200000, parameter bit 0x20. Both
are rows in "Flag tests not yet described" and are left undescribed
here. Neither side reaches the 0.8 distance check or `+0` bit 0x10000000.
`tests/fm-saturn.test.mjs` checks this section against a fresh read.

#### The flag at 0x0600eb08

The flag test that the set side of "The flag at 0x0600eaf6" stops at, the
next row of "Flag tests not yet described", read off the disc and
followed the same way. The fighter, field and mask in that row match the
disc: r3 still holds what 0x0600eae6 `mov #0x70,r0` and 0x0600eae8
`mov.l @(r0,r12),r3` loaded; 0x0600eb04 is `mov #0x20,r0`, 0x0600eb06
`shll16 r0` and 0x0600eb08 `tst r0,r3`, then `bt` at 0x0600eb0a. That is
the long +0x70 of this fighter (r12), not the opponent's, masked with
0x00200000: parameter bit 0x20. The `bt` branches when the bit is clear,
so the branch is the clear side and the fall-through the set side.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600eb08 | +0x70 & 0x00200000 | goes on to 0x0600eb0c; no store or call; the `bra` at 0x0600eb16 branches to 0x0600eb52, where `tst r7,r7` and the `bt` at 0x0600eb54 go both ways: it goes on with no store or call and stops at 0x0600eb62 (+0x4a4 & 0x00000001); or it branches to 0x0600ebda, puts the halfword +0x1a, or that minus 0x8000, in the halfword +0x4ae (0x0600ec08); sets +0x20 (0x0600ec42); sets +0x28 (0x0600ec44); calls 0x06012d50 (0x0600ec7a); adds 1 to the byte +0x60 (0x0600ec86); stops at 0x0600ec8e (+0x70 & 0x00040000) | branches to 0x0600eb52; no store or call; from there on the same as the set side, to the same stops |

- **+0x70 & 0x00200000**: set, it goes on at 0x0600eb0c and the `bra` at
  0x0600eb16 takes it to 0x0600eb52; clear, it jumps straight to
  0x0600eb52. From there both either stop at 0x0600eb62 or go on at
  0x0600ebda to store +0x4ae, +0x20 and +0x28, call 0x06012d50 and add 1
  to +0x60 before they stop at 0x0600ec8e.

The 0x8000 is the halfword at 0x0600ec4a, read with `mov.w`, so it is
added as −0x8000. The `tst r7,r7` at 0x0600eb52 is the one the set side
of "The flag at 0x0600eaee" reaches, and is left undescribed here too.
Both sides stop at 0x0600eb62, which tests this fighter's (r12) +0x4a4 &
0x00000001, or at 0x0600ec8e, which tests this fighter's (r12) +0x70 &
0x00040000, parameter bit 0x04. Both are rows in "Flag tests not yet
described" and are left undescribed here. Neither side reaches the 0.8
distance check or `+0` bit 0x10000000. `tests/fm-saturn.test.mjs` checks
this section against a fresh read.

#### The flag at 0x0600eb44

The flag test that the clear side of "The flag at 0x0600eaf6" stops at,
the next row of "Flag tests not yet described", read off the disc and
followed the same way. The fighter, field and mask in that row match the
disc: r3 still holds what 0x0600eae6 `mov #0x70,r0` and 0x0600eae8
`mov.l @(r0,r12),r3` loaded; 0x0600eb40 is `mov #0x20,r0`, 0x0600eb42
`shll16 r0` and 0x0600eb44 `tst r0,r3`, then `bt` at 0x0600eb46. That is
the long +0x70 of this fighter (r12), not the opponent's, masked with
0x00200000: parameter bit 0x20. The `bt` branches when the bit is clear,
so the branch is the clear side and the fall-through the set side.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600eb44 | +0x70 & 0x00200000 | goes on to 0x0600eb48; no store or call; runs on into 0x0600eb52, where `tst r7,r7` and the `bt` at 0x0600eb54 go both ways: it goes on with no store or call and stops at 0x0600eb62 (+0x4a4 & 0x00000001); or it branches to 0x0600ebda, puts the halfword +0x1a, or that minus 0x8000, in the halfword +0x4ae (0x0600ec08); sets +0x20 (0x0600ec42); sets +0x28 (0x0600ec44); calls 0x06012d50 (0x0600ec7a); adds 1 to the byte +0x60 (0x0600ec86); stops at 0x0600ec8e (+0x70 & 0x00040000) | branches to 0x0600eb52; no store or call; from there on the same as the set side, to the same stops |

- **+0x70 & 0x00200000**: set, it goes on at 0x0600eb48 and runs on into
  0x0600eb52; clear, it jumps straight to 0x0600eb52. From there both
  either stop at 0x0600eb62 or go on at 0x0600ebda to store +0x4ae, +0x20
  and +0x28, call 0x06012d50 and add 1 to +0x60 before they stop at
  0x0600ec8e.

The 0x8000 is the halfword at 0x0600ec4a, read with `mov.w`, so it is
added as −0x8000. The `tst r7,r7` at 0x0600eb52 is the one the set side
of "The flag at 0x0600eaee" reaches, and is left undescribed here too.
Both sides stop at 0x0600eb62, which tests this fighter's (r12) +0x4a4 &
0x00000001, or at 0x0600ec8e, which tests this fighter's (r12) +0x70 &
0x00040000, parameter bit 0x04. Both are rows in "Flag tests not yet
described" and are left undescribed here. Neither side reaches the 0.8
distance check or `+0` bit 0x10000000. `tests/fm-saturn.test.mjs` checks
this section against a fresh read.

#### The flag at 0x0600eb62

The flag test that the `tst r7,r7` at 0x0600eb52 goes on to when its `bt`
does not branch, where "The flag at 0x0600eaee", "The flag at 0x0600eb08"
and "The flag at 0x0600eb44" stop, the next row of "Flag tests not yet
described", read off the disc and followed the same way. The fighter,
field and mask in that row match the disc: 0x0600eb5a is `mov r12,r1`,
0x0600eb5c `mov.w @(0x0600eb94),r0`, which loads 0x04a7, 0x0600eb5e
`add r0,r1`, 0x0600eb60 `mov.b @r1,r0` and 0x0600eb62 `tst #0x01,r0`,
then `bt` at 0x0600eb64. That is bit 0x01 of the byte +0x4a7 of this
fighter (r12), not the opponent's: big-endian, the long +0x4a4 masked
with 0x00000001. The `bt` branches when the bit is clear, so the branch
is the clear side and the fall-through the set side.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600eb62 | +0x4a4 & 0x00000001 | goes on to 0x0600eb66, where `cmp/pz r9` and the `bt` at 0x0600eb68 go both ways: it goes on to 0x0600eb6a, or it branches to 0x0600eb6c; no store or call either way; both run on to 0x0600eb74; stops at 0x0600eb74 (+0x70 & 0x00200000) | branches to 0x0600eb6e; no store or call; stops at 0x0600eb74 (+0x70 & 0x00200000) |

- **+0x4a4 & 0x00000001**: set, it goes on at 0x0600eb66 and, whichever
  way the `bt` at 0x0600eb68 goes, runs on to 0x0600eb74; clear, it jumps
  to 0x0600eb6e and runs on to 0x0600eb74. Neither side stores or calls
  anything.

The set side's words are 0x0600eb66 `cmp/pz r9`, 0x0600eb68 `bt`, and
0x0600eb6a and 0x0600eb6c `neg r9,r9`; they change only r9, which
0x0600eb58 `mov.l @(r0,r12),r9` loaded from the long +0x4d8 (the `mov.w`
literal at 0x0600eb92). Both sides stop at 0x0600eb74, which tests this
fighter's (r12) +0x70 & 0x00200000, parameter bit 0x20. It is a row in
"Flag tests not yet described" and is left undescribed here. Neither side
reaches the 0.8 distance check or `+0` bit 0x10000000.
`tests/fm-saturn.test.mjs` checks this section against a fresh read.

#### The flag at 0x0600eb74

The flag test that both sides of "The flag at 0x0600eb62" stop at, the
next row of "Flag tests not yet described", read off the disc and
followed the same way. The fighter, field and mask in that row match the
disc: 0x0600eb6e is `mov r12,r1`, 0x0600eb70 `add #0x71,r1`, 0x0600eb72
`mov.b @r1,r0` and 0x0600eb74 `tst #0x20,r0`, then `bf` at 0x0600eb76.
That is bit 0x20 of the byte +0x71 of this fighter (r12), not the
opponent's: big-endian, the long +0x70 masked with 0x00200000, parameter
bit 0x20. The `bf` branches when the bit is set, so the branch is the
set side and the fall-through the clear side.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600eb74 | +0x70 & 0x00200000 | branches to 0x0600ebda; puts the halfword +0x1a, or that minus 0x8000, in the halfword +0x4ae (0x0600ec08); sets +0x20 (0x0600ec42); sets +0x28 (0x0600ec44); calls 0x06012d50 (0x0600ec7a); adds 1 to the byte +0x60 (0x0600ec86); stops at 0x0600ec8e (+0x70 & 0x00040000) | goes on to 0x0600eb78; no store or call; the `bt` at 0x0600eb80 or the one at 0x0600eb88 branches to 0x0600eb98 and stops at the 0.8 distance check there; if neither branches, the `bra` at 0x0600eb8c jumps to 0x0600ebda, and from there on it is the same as the set side, to the same stop |

- **+0x70 & 0x00200000**: set, it jumps to 0x0600ebda to store +0x4ae,
  +0x20 and +0x28, call 0x06012d50 and add 1 to +0x60 before it stops at
  0x0600ec8e; clear, it goes on at 0x0600eb78 with no store or call, and
  either stops at the 0.8 distance check at 0x0600eb98 or jumps to
  0x0600ebda and goes on the same way as the set side.

0x0600ebda is where the `bt` after the `tst r7,r7` at 0x0600eb52 lands,
the path "The flag at 0x0600eb08" names; the 0x8000 is the `mov.w`
halfword at 0x0600ec4a, added as −0x8000. The clear side's words up to
0x0600eb8e only move, add, subtract and compare registers. The 0.8
distance check starts at 0x0600eb98, `mov.l` of 0x0000cccd, compared at
0x0600eb9e with the long +0x4d8; it is the only one in kind 9's handlers,
and is not explained here. It is not the 0.8 scale at 0x0600f3a4. Both
sides' other stop is 0x0600ec8e, which tests this fighter's (r12) +0x70 &
0x00040000, parameter bit 0x04. It is a row in "Flag tests not yet
described" and is left undescribed here. Neither side reaches `+0` bit
0x10000000. `tests/fm-saturn.test.mjs` checks this section against a
fresh read.

#### The flag at 0x0600ec64

The flag test that the set side of "The flag at 0x0600ead0" stops at, the
next row of "Flag tests not yet described", read off the disc and
followed the same way. The fighter, field and mask in that row match the
disc: 0x0600ec5c is `mov r12,r1`, 0x0600ec5e `mov.w @(0x0600ec9e),r0`,
which loads 0x04a7, 0x0600ec60 `add r0,r1`, 0x0600ec62 `mov.b @r1,r0` and
0x0600ec64 `tst #0x01,r0`, then `bt` at 0x0600ec66. That is bit 0x01 of
the byte +0x4a7 of this fighter (r12), not the opponent's: big-endian,
the long +0x4a4 masked with 0x00000001. The `bt` branches when the bit is
clear, so the branch is the clear side and the fall-through the set side.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600ec64 | +0x4a4 & 0x00000001 | goes on to 0x0600ec68 and runs on to 0x0600ec6e; calls 0x06012844 (0x0600ec74); calls 0x06012d50 (0x0600ec7a); adds 1 to the byte +0x60 (0x0600ec86); stops at 0x0600ec8e (+0x70 & 0x00040000) | branches to 0x0600ec6e, and from there on it is the same as the set side, to the same stop |

- **+0x4a4 & 0x00000001**: set, it goes on at 0x0600ec68 and runs on to
  0x0600ec6e; clear, it jumps to 0x0600ec6e. From there both call
  0x06012844 and 0x06012d50 and add 1 to +0x60 before they stop at
  0x0600ec8e.

0x0600ec58 is where the `bra` at 0x0600ead4 lands; its `mov #0x1a,r0`
and 0x0600ec5a `mov.w @(r0,r12),r7` load the halfword +0x1a into r7. The
set side's words are 0x0600ec68 `mov.w @(0x0600eca0),r1`, which loads
0x8000, added as −0x8000, 0x0600ec6a `add r1,r7` and 0x0600ec6c
`exts.w r7,r7`; they change only r1 and r7, and store nothing.

Both sides stop at 0x0600ec8e, which tests this
fighter's (r12) +0x70 & 0x00040000, parameter bit 0x04. It is a row in
"Flag tests not yet described" and is left undescribed here. Neither side
reaches the 0.8 distance check or `+0` bit 0x10000000.
`tests/fm-saturn.test.mjs` checks this section against a fresh read.

#### The flag at 0x0600ec8e

The flag test that both sides of "The flag at 0x0600eb74" and "The flag
at 0x0600ec64" stop at, the next row of "Flag tests not yet described",
read off the disc and followed the same way. The fighter, field and mask
in that row match the disc: 0x0600ec88 is `mov r12,r1`, 0x0600ec8a
`add #0x71,r1`, 0x0600ec8c `mov.b @r1,r0` and 0x0600ec8e `tst #0x04,r0`,
then `bf` at 0x0600ec90. That is bit 0x04 of the byte +0x71 of this
fighter (r12), not the opponent's: big-endian, the long +0x70 masked with
0x00040000, parameter bit 0x04. The `bf` branches when the bit is set, so
the branch is the set side and the fall-through the clear side.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600ec8e | +0x70 & 0x00040000 | branches to 0x0600ecb4; calls 0x060148ae (0x0600ecb8); ends this frame's run (0x0600ecbc) | goes on to 0x0600ec92; calls 0x060148ae (0x0600ec96); the `bra` at 0x0600ec9a jumps to 0x0600ecbc; ends this frame's run (0x0600ecbc) |

- **+0x70 & 0x00040000**: set, it jumps to 0x0600ecb4 and calls
  0x060148ae; clear, it goes on at 0x0600ec92, calls 0x060148ae and jumps
  to 0x0600ecbc. Both end this frame's run at 0x0600ecbc and store
  nothing.

Both sides load the call's address and r4 from `mov.l` literals before
the `jsr @r0`: the set side 0x0600ecb4 `mov.l @(0x0600ecc0),r0`, which
loads 0x060148ae, and 0x0600ecb6 `mov.l @(0x0600ecc4),r4`, which loads
0xa01112ff; the clear side 0x0600ec92 `mov.l @(0x0600ecac),r0`, which
loads 0x060148ae, and 0x0600ec94 `mov.l @(0x0600ecb0),r4`, which loads
0xa01112ff. So both call 0x060148ae with the same r4. 0x0600ecbc is the
run handler's `jmp @r14`.

Neither side stops at another flag test, and neither reaches the 0.8
distance check or `+0` bit 0x10000000. `tests/fm-saturn.test.mjs` checks
this section against a fresh read.

#### The flag at 0x0600ecd0

The next row of "Flag tests not yet described", read off the disc and
followed the same way. The fighter, field and mask in that row match the
disc: 0x0600ecc8 is `mov r12,r1`, 0x0600ecca `mov.w @(0x0600ed06),r0`,
which loads 0x06c0, 0x0600eccc `add r0,r1`, 0x0600ecce `mov.b @r1,r0` and
0x0600ecd0 `tst #0x02,r0`, then `bf` at 0x0600ecd2. That is bit 0x02 of
the byte +0x6c0 of this fighter (r12), not the opponent's: big-endian,
the long +0x6c0 masked with 0x02000000. The `bf` branches when the bit is
set, so the branch is the set side and the fall-through the clear side.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600ecd0 | +0x6c0 & 0x02000000 | branches to 0x0600ecfe; no store or call; the `bra` at 0x0600ed02 jumps to 0x0600ed10; stops at 0x0600ed16 (+0x00 & 0x00000020) | goes on to 0x0600ecd4; no store or call; stops at 0x0600ecda (+0x70 & 0x00080000) |

- **+0x6c0 & 0x02000000**: set, it jumps to 0x0600ecfe and on to
  0x0600ed10 with no store or call, and stops at 0x0600ed16; clear, it
  goes on at 0x0600ecd4 with no store or call, and stops at 0x0600ecda.

The set side's words before the `bra` are 0x0600ecfe
`mov.w @(0x0600ed06),r0`, which loads 0x06c0, and 0x0600ed00
`mov.l @(r0,r12),r4`, which loads the long +0x6c0 into r4; they store
nothing. The set side's stop, 0x0600ed16, tests this fighter's (r12)
+0x00 & 0x00000020; it is a row in "The flags behind them", which
describes its sides. The clear side's stop, 0x0600ecda, tests this
fighter's (r12) +0x70 & 0x00080000, parameter bit 0x08. It is a row in
"Flag tests not yet described" and is left undescribed here. Neither side
reaches the 0.8 distance check or `+0` bit 0x10000000.
`tests/fm-saturn.test.mjs` checks this section against a fresh read.

#### The flag at 0x0600ecda

The next row of "Flag tests not yet described", read off the disc and
followed the same way. The fighter, field and mask in that row match the
disc: 0x0600ecd4 is `mov r12,r1`, 0x0600ecd6 `add #0x71,r1`, 0x0600ecd8
`mov.b @r1,r0` and 0x0600ecda `tst #0x08,r0`, then `bt` at 0x0600ecdc.
That is bit 0x08 of the byte +0x71 of this fighter (r12), not the
opponent's: big-endian, the long +0x70 masked with 0x00080000, as "The
flag at 0x0600ecd0" names it. The `bt` branches when the bit is clear, so
the branch is the clear side and the fall-through the set side.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600ecda | +0x70 & 0x00080000 | goes on to 0x0600ecde; the `bt` at 0x0600ece8 splits it at 0x0600ecfe; calls 0x060131d0 and stores +0x71 only when it does not branch; stops at 0x0600ed16 (+0x00 & 0x00000020) | branches to 0x0600ecfe; no store or call; the `bra` at 0x0600ed02 jumps to 0x0600ed10; stops at 0x0600ed16 (+0x00 & 0x00000020) |

- **+0x70 & 0x00080000**: set, it goes on at 0x0600ecde, and the `bt` at
  0x0600ece8 either jumps to 0x0600ecfe with no store or call, or goes on
  at 0x0600ecea, calls 0x060131d0 at 0x0600ecf0 and stores the byte +0x71
  at 0x0600ecfc; both paths stop at 0x0600ed16; clear, it jumps to
  0x0600ecfe with no store or call, and stops at 0x0600ed16.

The set side's split: 0x0600ecde `mov.w @(0x0600ed08),r0`, which loads
0x04a8, 0x0600ece0 `mov.w @(r0,r12),r3`, 0x0600ece2
`mov.w @(0x0600ed0a),r0`, which loads 0x04ac, 0x0600ece4
`mov.w @(r0,r12),r4`, 0x0600ece6 `cmp/gt r4,r3` and `bt` at 0x0600ece8,
which lands at 0x0600ecfe. It branches when this fighter's halfword
+0x4a8 is greater (signed) than its halfword +0x4ac. Not branching, it
goes on at 0x0600ecea `mov #0x72,r0`, 0x0600ecec `mov.w @(r0,r12),r4`,
0x0600ecee `mov.l @(0x0600ed0c),r0`, which loads 0x060131d0, and
0x0600ecf0 `jsr @r0`, so r4 holds this fighter's halfword +0x72 for the
call. Then 0x0600ecf4 `mov r12,r1`, `add #0x71,r1`, `mov.b @r1,r0`,
0x0600ecfa `and #0xf7,r0` and 0x0600ecfc `mov.b r0,@r1`: it clears bit
0x08 of the byte +0x71, the bit this test reads. The two paths meet at
0x0600ecfe, the clear side's target, whose words "The flag at 0x0600ecd0"
gives; the `bra` at 0x0600ed02 jumps to 0x0600ed10. Both sides stop at
0x0600ed16, which tests this fighter's (r12) +0x00 & 0x00000020; it is a
row in "The flags behind them", which describes its sides. Neither side
reaches the 0.8 distance check or `+0` bit 0x10000000.
`tests/fm-saturn.test.mjs` checks this section against a fresh read.

#### The flag at 0x0600f008

The next row of "Flag tests not yet described", read off the disc and
followed the same way. The fighter, field and mask in that row match the
disc: 0x0600f000 is `mov r12,r1`, 0x0600f002 `mov.w @(0x0600f0a6),r0`,
which loads 0x11d5, 0x0600f004 `add r0,r1`, 0x0600f006 `mov.b @r1,r0` and
0x0600f008 `tst #0x10,r0`, then `bt` at 0x0600f00a. That is bit 0x10 of
the byte +0x11d5 of this fighter (r12), not the opponent's: big-endian,
the long +0x11d4 masked with 0x00100000. The `bt` branches when the bit
is clear, so the branch is the clear side and the fall-through the set
side.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600f008 | +0x11d4 & 0x00100000 | goes on to 0x0600f00c; stores +0x1a (0x0600f014); goes on to 0x0600f016 and from there does what the clear side does; ends this frame's run (0x0600f3f6) | branches to 0x0600f016; stores +0x6c0, +0x6c8, +0x6cc, +0x6d0, +0x33, +0x6c6, +0x6c2, +0x6f0, +0x6e0, +0x6e4, +0x6e8 and +0x6f8; no call; the `bra` at 0x0600f0a0 jumps to 0x0600f3f6; ends this frame's run (0x0600f3f6) |

- **+0x11d4 & 0x00100000**: set, it goes on at 0x0600f00c, stores the
  byte +0x1a at 0x0600f014 and goes on at 0x0600f016; clear, it jumps to
  0x0600f016. From there both sides make the same stores, call nothing,
  and end this frame's run at 0x0600f3f6.

The set side's store: 0x0600f00c `mov r12,r1`, 0x0600f00e `add #0x1a,r1`,
0x0600f010 `mov.b @r1,r0`, 0x0600f012 `xor #0x80,r0` and 0x0600f014
`mov.b r0,@r1`: it flips bit 0x80 of this fighter's byte +0x1a.

From 0x0600f016 both sides run the same code. 0x0600f016
`mov.l @(0x0600f0c4),r2` loads 0x02800000, 0x0600f01c `or r2,r3` and
0x0600f020 `mov.l r3,@(r0,r12)` store the long +0x6c0 ORed with it. Then:
at 0x0600f030 the long +0x20 in the long +0x6c8; at 0x0600f032 the long
+0x24 in the long +0x6cc; at 0x0600f034 the long +0x28 in the long +0x6d0;
at 0x0600f03e the byte +0x33 ANDed with 0xf7 in the byte +0x33; at
0x0600f046 the halfword +0x63c in the halfword +0x6c6; at 0x0600f050 the
halfword +0x6c6 less one in the halfword +0x6c6; at 0x0600f05c the byte
+0x6c2 ORed with 0x10 in the byte +0x6c2; at 0x0600f068 the long +0x658
plus 0x0002b333 in the long +0x6f0; at 0x0600f078 the long +0xc in the
long +0x6e0; at 0x0600f07a the long +0x10 in the long +0x6e4; at
0x0600f07c the long +0x14 in the long +0x6e8; at 0x0600f09e the divide
unit's quotient of the long +0x658 plus 0x0002b333, less the long +0x10,
over the halfword +0x646, in the long +0x6f8. All are this fighter's
(r12). The `bra` at 0x0600f0a0 jumps to 0x0600f3f6, the run handler's
`jmp @r14`. Neither side calls anything or stops at another flag test,
and neither reaches the 0.8 distance check or `+0` bit 0x10000000.
`tests/fm-saturn.test.mjs` checks this section against a fresh read.

#### The flag at 0x0600f1f6

The next row of "Flag tests not yet described", read off the disc and
followed the same way. The fighter, field and mask in that row match the
disc: 0x0600f1ee is `mov r12,r1`, 0x0600f1f0 `mov.w @(0x0600f20c),r0`,
which loads 0x06c1, 0x0600f1f2 `add r0,r1`, 0x0600f1f4 `mov.b @r1,r0` and
0x0600f1f6 `tst #0x08,r0`, then `bt` at 0x0600f1f8. That is bit 0x08 of
the byte +0x6c1 of this fighter (r12), not the opponent's: big-endian,
the long +0x6c0 masked with 0x00080000. The `bt` branches when the bit
is clear, so the branch is the clear side and the fall-through the set
side.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600f1f6 | +0x6c0 & 0x00080000 | goes on to 0x0600f1fa; no store or call; the `bra` at 0x0600f1fa jumps to 0x0600f338; stops at 0x0600f340 (+0x6c0 & 0x01000000) | branches to 0x0600f2a4; stores +0x20 and +0x28; the `bf` at 0x0600f2c6 splits it at 0x0600f2f0, which stores +0x24; else it calls 0x06010dda, and the `bf` at 0x0600f2d2 splits it at 0x0600f322, which stores +0x20, +0x28 and +0x24; ends this frame's run (0x0600f3f6) |

- **+0x6c0 & 0x00080000**: set, the `bra` at 0x0600f1fa jumps to
  0x0600f338 with no store or call, and it stops at 0x0600f340; clear, it
  jumps to 0x0600f2a4 and stores the longs +0x20 and +0x28, then with r5
  negative stores the long +0x24, else calls 0x06010dda and, if that
  returns nonzero, stores the longs +0x20, +0x28 and +0x24; every clear
  path ends this frame's run at 0x0600f3f6.

The set side: 0x0600f1fa `bra`, with 0x0600f1fc `nop` in its delay slot,
lands at 0x0600f338 `mov r12,r1`, 0x0600f33a `mov.w @(0x0600f362),r0`,
which loads 0x06c0, `add r0,r1`, `mov.b @r1,r0` and 0x0600f340
`tst #0x01,r0`. That stop tests this fighter's (r12) +0x6c0 & 0x01000000;
it is a row in "The flags those four stop at", which describes its sides.

The clear side's splits: 0x0600f2c4 `cmp/pz r5` and `bf` at 0x0600f2c6,
which lands at 0x0600f2f0, so it branches when r5, the halfword that
0x0600f1ec `mov.w @r6+,r5` loads, is negative. There 0x0600f2f0
`mov.w @(0x0600f2f8),r8` loads -0x07ae and 0x0600f2f2
`mov.l r8,@(0x24,r12)` stores it in the long +0x24; the `bra` at
0x0600f2f4 jumps to 0x0600f3f6. Not branching, it goes on at 0x0600f2c8
`mov r5,r4`, 0x0600f2ca `mov.l @(0x0600f2ec),r0`, which loads 0x06010dda,
and 0x0600f2cc `jsr @r0`, then 0x0600f2d0 `tst r0,r0` and `bf` at
0x0600f2d2, which lands at 0x0600f322, so it branches when the call
returns nonzero. There it stores 0 in the long +0x20 at 0x0600f324 and
in the long +0x28 at 0x0600f326, and 0x0600f328 `mov.w @(0x0600f332),r3`
loads 0x07ae for the long +0x24 at 0x0600f32a; the `bra` at 0x0600f32c
jumps to 0x0600f3f6. With zero, the `bra` at 0x0600f2d4 jumps to
0x0600f3f6. The stores at 0x0600f2b2 and 0x0600f2c2, before the splits,
are this fighter's longs +0x20 and +0x28, whose values `flagSides` does
not follow. 0x0600f2a4 is the fall-through of the `bf` at 0x0600f2a2
after the test at 0x0600f2a0 (+0x6c0 & 0x00080000), a row in "The flags
those stop at"; from 0x0600f2a4 `flagSides` lists the same events as for
that row's clear side. 0x0600f3f6 is the run handler's `jmp @r14`. Neither
side calls anything else or stops at another flag test, and neither
reaches the 0.8 distance check or `+0` bit 0x10000000.
`tests/fm-saturn.test.mjs` checks this section against a fresh read.

#### The flag at 0x0600f290

The next row of "Flag tests not yet described", read off the disc and
followed the same way. It is not a byte test: 0x0600f260
`mov.w @(0x0600f2d8),r0` loads 0x06c0 and 0x0600f262
`mov.l @(r0,r12),r8` loads the long +0x6c0 of this fighter (r12), not the
opponent's, into r8. 0x0600f28c `mov #0x04,r0` and 0x0600f28e
`shll16 r0` make the mask 0x00040000, 0x0600f290 is `tst r0,r8`, then
`bf` at 0x0600f292. That is the long +0x6c0 masked with 0x00040000, as
the row names it. The `bf` branches when the bit is set, so the branch
is the set side and the fall-through the clear side.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600f290 | +0x6c0 & 0x00040000 | branches to 0x0600f298; stores +0x68a (0x0600f29a); stops at 0x0600f2a0 (+0x6c0 & 0x00080000) | goes on to 0x0600f294; stores +0x68a (0x0600f29a); stops at 0x0600f2a0 (+0x6c0 & 0x00080000) |

- **+0x6c0 & 0x00040000**: set, it jumps to 0x0600f298 and puts 0x08b3
  in the halfword +0x68a; clear, it puts the halfword at +6 of r11 there
  instead; neither side calls anything, and both stop at 0x0600f2a0.

Both sides store with 0x0600f298 `mov.w @(0x0600f2de),r0`, which loads
0x068a, and 0x0600f29a `mov.w r3,@(r0,r12)`. The set side's r3 is from
0x0600f28a `mov.w @(0x0600f2dc),r3`, which loads 0x08b3, before the
test. The clear side sets it at 0x0600f294 `mov.w @(6,r11),r0` and
0x0600f296 `mov r0,r3`, a value `flagSides` does not follow. The stop at
0x0600f2a0 tests this fighter's (r12) +0x6c0 & 0x00080000; it is a row
in "The flags those stop at", which describes its sides. Neither side
reaches the 0.8 distance check or `+0` bit 0x10000000.
`tests/fm-saturn.test.mjs` checks this section against a fresh read.

#### The flag at 0x0600f37e

The next row of "Flag tests not yet described", read off the disc and
followed the same way. 0x0600f378 is `mov r12,r1`, 0x0600f37a
`add #0x71,r1`, 0x0600f37c `mov.b @r1,r0` and 0x0600f37e
`tst #0x04,r0`, then `bf` at 0x0600f380. That is bit 0x04 of the byte
+0x71 of this fighter (r12), not the opponent's: big-endian, the long
+0x70 masked with 0x00040000, as the row names it. The `bf` branches
when the bit is set, so the branch is the set side and the fall-through
the clear side.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600f37e | +0x70 & 0x00040000 | branches to 0x0600f394; calls 0x06014ca4 (0x0600f398); stops at 0x0600f3a4 (+0x6c0 & 0x20000000) | goes on to 0x0600f382; calls 0x06014ca4 (0x0600f386); the `bra` at 0x0600f38a jumps to 0x0600f39c; stops at 0x0600f3a4 (+0x6c0 & 0x20000000) |

- **+0x70 & 0x00040000**: set, it jumps to 0x0600f394 and calls
  0x06014ca4 with r4 = 2; clear, it calls 0x06014ca4 with r4 = 1 and
  the `bra` at 0x0600f38a jumps to 0x0600f39c; neither side stores
  anything, and both stop at 0x0600f3a4.

The set side: 0x0600f394 `mov #0x02,r4`, 0x0600f396
`mov.l @(0x0600f3bc),r0`, which loads 0x06014ca4, and 0x0600f398
`jsr @r0`, then 0x0600f39c `mov r12,r1`. The clear side: 0x0600f382
`mov #0x01,r4`, 0x0600f384 `mov.l @(0x0600f390),r0`, which loads
0x06014ca4, and 0x0600f386 `jsr @r0`, then the `bra` at 0x0600f38a,
with `nop` in its delay slot, lands at 0x0600f39c. From there both go on
with 0x0600f39e `mov.w @(0x0600f3b8),r0`, which loads 0x06c0, `add r0,r1`,
`mov.b @r1,r0` and 0x0600f3a4 `tst #0x20,r0`. That stop tests this
fighter's (r12) +0x6c0 & 0x20000000; it is a row in "The flags they stop
at", which describes its sides. Neither side calls anything else or
stops at another flag test, and neither reaches the 0.8 distance check
or `+0` bit 0x10000000.
`tests/fm-saturn.test.mjs` checks this section against a fresh read.

#### The flag at 0x0600edfa

The first test the sentence under "Flag tests not yet described" leaves
out, read off the disc and followed the same way. It is not a
fighter-field test: 0x0600edec `mov.w @(0x0600ef18),r0` loads 0x06c0 and
0x0600edee `mov.l @(r0,r12),r3` loads the long +0x6c0 of this fighter
(r12) into r3; 0x0600edf0 `mov.w @(0x0600ef1e),r0` loads 0x19f8 and
0x0600edf2 `mov.l @(r0,r13),r5` loads the long +0x19f8 of the opponent
(r13) into r5; 0x0600edf4 `xor r3,r5` leaves the two combined in r5.
0x0600edf6 `mov #0x01,r0` and 0x0600edf8 `shll16 r0` make the mask
0x00010000, 0x0600edfa is `tst r0,r5`, then `bf` at 0x0600edfc. That is
bit 0x00010000 of this fighter's +0x6c0 xor the opponent's +0x19f8: set
when the two longs differ in that bit, clear when they match. `flagSides`
reads r3 as this fighter's +0x6c0 but does not follow the xor, so it
gives no fighter field for the test. The `bf` branches when the bit is
set, so the branch is the set side and the fall-through the clear side.

| Tested at | Flag | Set | Clear |
| --- | --- | --- | --- |
| 0x0600edfa | (+0x6c0 xor the opponent's +0x19f8) & 0x00010000 | branches to 0x0600ee0a; stores +0x20 (0x0600ee0a) and +0x28 (0x0600ee0c); stops at 0x0600ee16 (+0x6c0 & 0x40000000) | goes on to 0x0600edfe; the test at 0x0600ee02 goes either way to 0x0600ee0a; stores +0x20 (0x0600ee0a) and +0x28 (0x0600ee0c); stops at 0x0600ee16 (+0x6c0 & 0x40000000) |

- **(+0x6c0 xor the opponent's +0x19f8) & 0x00010000**: set, it jumps to
  0x0600ee0a and stores r4 in the long +0x20 and r6 in the long +0x28;
  clear, it goes on to the test at 0x0600ee02, whose `bf` at 0x0600ee04
  jumps to the same two stores and whose fall-through runs `neg r4,r4`
  and `neg r6,r6` first; neither side calls anything, and both stop at
  0x0600ee16.

The stores are 0x0600ee0a `mov.l r4,@(0x20,r12)` and 0x0600ee0c
`mov.l r6,@(0x28,r12)`, this fighter's longs +0x20 and +0x28, whose
values `flagSides` does not follow. The test at 0x0600ee02 is another
one the sentence leaves out, and is left undescribed here. `flagSides`
follows both ways of its `bf` at 0x0600ee04 and lists both paths in one
list, split here at that `bf`'s target: the branch lands at 0x0600ee0a,
the fall-through runs 0x0600ee06 `neg r4,r4` and 0x0600ee08
`neg r6,r6` and goes on to 0x0600ee0a, and both paths store the same two
longs from the same two places. From there both sides run 0x0600ee0e
`mov r12,r1`, 0x0600ee10 `mov.w @(0x0600ef18),r0`, which loads 0x06c0,
`add r0,r1`, `mov.b @r1,r0` and 0x0600ee16 `tst #0x40,r0`. That stop
tests this fighter's (r12) +0x6c0 & 0x40000000; it is a row in "The
flags those stop at", which describes its sides. Neither side calls
anything or stops at another flag test, and neither reaches the 0.8
distance check or `+0` bit 0x10000000.
`tests/fm-saturn.test.mjs` checks this section against a fresh read.

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
