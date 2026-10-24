# VF3's and Shenmue's motions, against VF2's

Shenmue's fighting motions are Virtua Fighter 3's, and VF3's are Virtua
Fighter 2's with two objects more. This page covers how each format is laid out
and how one maps onto the next, so that a Shenmue motion (Ryo's, from the
Dreamcast disc) can be played as a VF2 motion on Megamix's board.
`tools/shenmue-motion.mjs` does the conversion.

VF2's own format is in noclip's `vendor/noclip/js/motion.js`. In short: 20
objects of 3 channels. Objects 0–11 are angles, as BRAD floats (65535 a turn);
12–19 are points. Channel types are 3 zero, 4 const, 5 linear and 6 Hermite;
0–2 are latched constants. Key times are f32, from frame 1 to the last frame.
A Hermite key is (value, in, out).

## VF3 (Model 3, `vf3` rev C)

The program is the four epr-1922xc ROMs, interleaved 16 bits each, at
0xFFE00000. The data CROMs are banked through 0xFF000000..0xFF7FFFFF. The
motions and their names are in bank 6.

- **The table** is at 0xFFE40000:
  - u32 count, 0xD18 (3352);
  - u32 0xFFE49D28, the name pointers (3353; entry 0 is "NULL"; name k is motion k);
  - from 0xFFE40008, 3352 × { header, times, values } pointers, with motion k
    at entry k − 1.

  The last 247 motions are in the program ROMs (0xFFEExxxx).
- **The header**:
  - u16 frames (& 0xFFF; the top four bits are flags);
  - 16 control bytes: 64 two-bit types, MSB first, with 63 used (0 zero,
    1 const, 2 linear, 3 Hermite);
  - a key-count byte per keyed channel.
- **Times**: one per interior key, u8 (u16 past 255 frames), padded to 4. The
  first key is at frame 0 and the last at the last frame, both implied.
- **Values** (f32 BE):
  - const: 1;
  - linear: n + 2;
  - Hermite: 3n + 4, laid out v0, out0, in1, v1, out1, … in(n+1), v(n+1).

  All 3352 motions decode end to end with no gaps between them.
- **Functions**:

  | Address | Purpose |
  |---|---|
  | 0xFFF1D100 | set_mot_dat (setup record at `*(id*4 − 0x200004)`, handlers 0x73718) |
  | 0xFFF2D2C4 | attaches a motion |
  | 0xFFF2C688 | evaluates the 63 channels |
  | 0xFFF2E3A0 | per-frame driver |
  | 0xFFF3F5F8 | motion test menu |

  The player's motion fields are +0x1680 frames, +0x4E frame ×256 and +0x1980
  the motion context.

### VF3 → VF2

VF3 has 21 objects: 0–6 are points and 7–20 are angles.

| VF3 | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| VF2 | 12 | 13 | 14 | 15 | 16 | 18 | 19 |

| VF3 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| VF2 | 4 | 5 | 6 | — | 7 | 0 | — | 8 | 1 | 9 | 10 | 2 | 11 | 3 |

- VF3's 10 and 13 are new, one per arm: the shoulders.
- VF2's 17 (pelvis look, a latched (0, 0, 16384)) is gone.
- Points keep their axes. An angle object's axes are reversed: VF3 (x, y, z) is
  VF2 (z, y, x).
- VF3's angles are 65536 a turn: VF3 = VF2 × 65536/65535.
- VF3's tangents are VF2's / 30.

Key times agree to within a frame. 1300 of VF3's 3352 motions have a VF2
motion's key values exactly, for example JAS_YARARE_ISA (VF3 192, VF2 279) and
LAU_WIN_242_VF3 (VF3 1832, VF2 1038).

## Shenmue (Dreamcast, `/MISC/MOTION.BIN`)

- **The header** is u32 LE: table (0x20), names (0x12298), data (0x1AAEC),
  count (1560) and size. A table entry is 8 bytes: the motion's offset from
  data, then one more offset (not decoded). There are 1559 names.
- **263 of the names are VF3's own** (AKIRA_TA_KAMAE_VF3 and so on). Matched
  against VF3's motions of the same names, they gave every rule below.

### Motion layout

A motion is:

- u16 frames, then u16 0;
- four u16 section offsets, from the motion's start;
- the bone list: u16 words, `bone << 9 | mask`, ending in 0. Mask 0x1C0 is a
  position and 0x38 the angles; each is 3 channels (x, y, z), position first.

Then the four sections:

1. a key count per channel (u8);
2. the key times, channel after channel: u8 Shenmue frames, or u16 past 255
   frames;
3. per channel, 2 bits per point (start, the keys, end), with the channel
   padded to a byte. The 2 bits are the number of half floats the point has:
   - 0: none (value 0);
   - 1: value;
   - 2: one tangent for both sides, then value;
   - 3: in, out, value;
4. the half floats (IEEE binary16).

This accounts for the bytes of 1516 of the 1559 motions that have a next
motion to bound them. Most of the rest have odd headers and may not be
motions.

### Bones

Most motions (1109) have 20 bones. 370 have 18: no 25 and 31, VF3's
shoulders. Others are partial overlays (an arm, the upper body).

| Shenmue bone | 0 pos | 0 | 1 | 5 | 8 pos | 9 | 12 | 15 pos | 16 | 18 | 20 pos |
|---|---|---|---|---|---|---|---|---|---|---|---|
| VF3 object | 0 | 7 | 16 | 17 | 5 | 18 | 19 | 6 | 20 | 8 | 1 |
| VF2 object | 12 | 4 | 9 | 10 | 18 | 2 | 11 | 19 | 3 | 5 | 13 |

| Shenmue bone | 21 | 23 pos | 25 | 26 | 29 pos | 30 | 31 | 32 | 35 pos | 36 |
|---|---|---|---|---|---|---|---|---|---|---|
| VF3 object | 9 | 2 | 13 | 14 | 4 | 15 | 10 | 11 | 3 | 12 |
| VF2 object | 6 | 14 | — | 8 | 16 | 1 | — | 7 | 15 | 0 |

### Shenmue → VF2

- **Axes**: Shenmue (x, y, z) is VF2 (x, y, −z), for positions and angles
  alike. Against VF3, an angle is (VF3 z, VF3 y, −VF3 x).
- **Angles** are in turns: VF2 = turns × 65535.
- **Time**: Shenmue runs at 30 fps, so VF2's frames are twice Shenmue's.
  Shenmue's key t lands on VF2 frame 2t (2586 keys), 2t + 1 (3953) or 2t + 2
  (1716), counted over 110 motions that match VF2's. VF3 rounded its times
  its own way and Shenmue halved them, so the converter uses 2t + 1. VF2's
  start key goes at frame 1.
- **Tangents** are twice VF2's (and 60 × VF3's). The converted tangents are
  VF2's to a median ratio of 1.0003 over the same 110 motions.

What the conversion loses:

- the odd frames;
- the shoulders;
- some motions' start tangents, which Shenmue zeroed.

Sampled frame by frame against the same VF2 motions:

- **Positions**: a median 0.16 worst error.
- **Angles**: per motion, the worst channel's worst frame is a median 13.5°
  off (6° to 29° interquartile). The worst errors are all in fast swings
  whose key landed a frame early or late.

## The tool

```
node tools/shenmue-motion.mjs MOTION.BIN --list
node tools/shenmue-motion.mjs MOTION.BIN AKIRA_TA_KAMAE_VF3 --out kamae.bin
node tools/shenmue-motion.mjs MOTION.BIN 16 --json
```

`--out` writes a VF2 motion block at VF2's size; `tools/vf2-guest.mjs`'s
SCALE is not applied. `--json` prints Shenmue's channels and VF2's.

## Through Akira's import

I tested one motion: Shenmue 524, TA_KI_SYO_L, converted and put in VF2's
ROM in place of motion 738, the same move and one of the 328 that
`importAkira` carries. Then I ran `tools/import-assets.mjs` unchanged.

- **It is accepted.** The import ran through without an error, and its report
  and `guests.json` match the plain import's. The block has VF2's key counts,
  so it is 2248 bytes, as 738's is. The only bytes that differ in the board's
  ROMs are the block's, at main_data 0xEA67AC.
- **The block** in the board's ROM parses to its full length and has 738's
  channel types. Object 17 holds its latched (0, 0, 16384). It has 50 frames
  to VF2's 49.
- **Accuracy:** sampled frame by frame, it is within 3.6° and 0.067 (StF's
  units) of VF2's own 738.
- **Size:** `scaleMotion` scaled it like any of Akira's motions. The body's
  height at frame 1 is 2.055, against VF2's 2.057.

What a converted block does not bring with it:

- **A setup record.** Playback depends on one. Every motion id needs an
  `animation_related` entry: StF's set_mot_dat reads the header (the kind word
  0x804, 0x810..) and the ops from it. The test had 738's own VF2 setup,
  converted. For a motion only Shenmue has, `importAkira` can't take it:
  `readSetup` reads VF2's setup table, and ids at 1360 and above throw. A
  Shenmue motion needs a new id with a setup that someone writes or derives.
  A header and op 0 alone should play the motion with no hit, damage or
  cancel timing (not tested). The timing (op 2), strike (op 4) and throw
  (op 5) ops are the move's properties.
- **The table's second offset.** It is only in Shenmue's file, and nothing on
  the VF2 or StF path has a field for it. It doesn't block anything.
- **Size scaling** is not missing. The import applies SCALE (Akira's, 2.03) to
  objects 12–19. Shenmue's units are VF2's, so a Ryo would need only his own
  factor for his own height. That is a property and doesn't block anything.

## Open

- **Ryo's motions**: which MOTION.BIN entries Free Battle plays, and with
  which commands. #1504 is decoding that from 1ST_READ.BIN's fight data.
  `MISC/COLD.BIN` and `MISC/COLDINIT.PKS` hold other copies of MOTION.BIN, of
  other sizes.
- **Setups**: Shenmue's own, and VF3's setup records (set_mot_dat's handlers)
  against VF2's setup ops, so that a Shenmue-only motion can get one ("Through
  Akira's import").
- **The table's second offset** per motion.
