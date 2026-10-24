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
  - 9: a file FUN_0602eb34 loads; 10: one FUN_0602e6e8 loads; 11: an
    optional file of about 60 sectors (−1 for the hidden fighters);
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
| 134 | 3 | not decoded: 12-byte records (0x0E000000, u32 n, u32 offset), then 0x27000000…; commands or a script |
| 136 | 30 | not decoded: a header of pairs, then signed bytes |

For comparison, Akira's are 151 (4 sectors), 152 (his bank), 153 (23) and
154 (59).

### The model

The models are SGL XPDATA: { points, point count, polygons, polygon count,
attributes, vertex normals }. Points are 12 bytes, polygons 20 (a normal and
four u16), attributes 12. The model starts with a table of slots, 0x1 for an
empty one, ending in 0xFFFFFFFF.

A polygon's four corners are point indices × 16. Hornet (130) has its table
at 0x714C, with 17 slots: 0 the shadow (4 points, 1 polygon); 1 the nose
(58/55); 5, 8, 12 and 15 a wheel each (42/50); 9 the cabin and tail (96/77);
16 another nose (80/45); then, past the empty slots, 35, 48, 62 and 75 the
same wheels again and 49 a second cabin (144/103). The others are empty. The wheels sit in the hand and foot slots, so the limbs' IK targets
place them, and the car's "arms" and "legs" are its wheels. Akira's model
(147) fills all 16 humanoid slots.

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
(with the FM disc) that FM's two pieces meet as described.

### Bones

Each fighter's +0 points at 15 × (x, y, z) 16.16 offsets, in metres. They are
VF2's joints 1–15 (VF2's joint 0 is the root's (0, 0, 0)), on the same axes.
Akira's (0x0608D6A8) are VF2 arcade Akira's exactly: (0.37, 0, 0),
(0.28, 0, −0.24), (0.25, 0, 0), … (0.44, 0, 0).

Hornet's (0x0608D48C) is a skeleton he shares with Picky: (0.32, 0, 0),
(0.25, 0.02, −0.17), (0.23, 0, 0), (0.24, 0, 0), the other side mirrored,
then the legs, Akira's (0.19, 0, ∓0.09), (0.39, 0, 0), (0.44, 0, 0).
`fm-saturn.mjs hornet --bones` prints them.

## Motions

### The bank

The bank is 12-byte rows { u32 setup offset, u32 motion id, u32 data offset },
ending at id 0. Offsets are from the bank's start, and ids are global (sparse,
the same numbering for every fighter). An id from 0x880 up is a variant that
shares the next row's data. The setup records are op scripts like
set_mot_dat's and are not decoded yet.

40 of the 66 entries in Hornet's action table are in his bank. The others
(0x19F, 0x1A0, 0x1AD, 0x1AE, 0x4CA–0x4D5, 0x6CF, 0x6F0, 0x6F1, 0x8C1, …) are
in no fighter's bank. Every fighter has some of these, which points to a
common bank that hasn't been found yet.

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

## The tool

```
node tools/fm-saturn.mjs --fighters
node tools/fm-saturn.mjs hornet --list          # id, frames, data and setup offsets
node tools/fm-saturn.mjs hornet --bones
node tools/fm-saturn.mjs hornet --actions
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

- **Daytona's car on the board**: the pieces are found and cut; importing
  them into the board's data ROMs (`tools/import-assets.mjs`) and hanging
  them on FM's skeleton is next. Which FM joints the wheel slots (5, 8, 12,
  15) and the second nose (16) follow, and the FM wheels' rest places, still
  need the skeleton posed.
- **Hornet's moves**: which motions his commands play. That is in file 134
  (probably the command list), 136, and the bank's setup records.
- **The action table's slots** (stance, walk, …), and the common bank that
  holds the ids no fighter's bank has.
- **The fighter rows' numbers** past +4.
