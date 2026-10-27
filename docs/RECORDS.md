# Every fighter and stage record

Pin #1639 asked for every VF2, FV and StF stage and fighter in the web
Megamix, so that the record fields and flag bits nobody has named can be
set beside what each fighter or stage does. This file is that comparison.

- **The web Megamix** now offers every record. The fighters are VF2's 13,
  FV's 13 (the second-player looks, FV's +13 and StF's +26, are not their
  own entries) and StF's 17, after the first eleven, so `?p1=` numbers stay
  as they were. The stages are the 29 arenas as before, then the 18 other
  records (README, URL options). All 47 stages load and all 43 fighters
  pose, move and fight (`tests/fighters.test.mjs`, `tests/bout.test.mjs`).
- **The board** (docs/BOARD.md) cannot hold them all: each guest costs
  program, data and polygon ROM that StF's sizes do not have
  (docs/FV-GUESTS.md). Nothing here changes it.

`node tools/record-survey.mjs` prints the tables below from `$ROMS_DIR`'s
zips (`--json out.json` for the values). Every field whose meaning is not
known is printed for every record, by value: a value only one fighter or
one stage has is a lead. The names come from the code that reads the field.
StF's are read in `~/source/repos/biggestsonicfan/stfdisasm/rom_code1.asm`
(line numbers `L…` below); VF2's and FV's in their Ghidra projects and
docs/SHARED-CODE.md, docs/FV-STAGES.md and docs/DEBUG-MODE.md.

## StF's character records

`CHAR_PARTS` (0xC5268) points at one 0x30-byte record per character.
`action_init` reads every field, with g5 the record (L16495–16726).

| at | what | read |
|--|--|--|
| +0x00 | parts: 16 normal entries, 16 squished | → rob+0x40, drawn by `rob_disp` |
| +0x04 | skeleton | → rob+0x8C |
| +0x08 | a second 16-entry parts list | → rob+0x1B4; `calc_rob_angle_int` (L45269) uses it as the fighter's list when the skeleton type is above 2 |
| +0x0C | action table | → rob+0x1A0 |
| +0x10 | reach table | `get_en_info` |
| +0x14 | weight | → rob+0x5D8 |
| +0x18 | option data | `copy_option_data`, below |
| +0x1C | pointer; only its first word is read | → rob+0x7CC, which nothing reads |
| +0x20 | bytes 0, 1: jump frames (38, 26); floats +4..+0x10: speed scales | → rob+0x5BE; → rob+0x724..0x730, used by the move code (L18334–18353) |
| +0x24 | 8.0: a step radius | → rob+0x6C8; its one reader (0x13FF4, L18429) clamps the (x, z) step from rob+0x600/0x608 to it |
| +0x28 | pointer to three words: 500, 200, 13 | +0 and +4, each × rounds to win, → rob+0xAF0 `brk_up_damage` and rob+0xAF4 `brk_dn_damage`, the high and low guard-break limits (`zibaku_ckeck`, L42686); +8 → rob+0xAF8, the first motion frame a recovery (ukemi) is allowed (`ACT_RC_UKEMI`, L19132) |
| +0x2C | 9.0; Metal Sonic 12.0, Bark 5.0 | → rob+0xC68, which nothing reads |

So of the 0x30 bytes, two are dead. +0x1C points at 0xC5260 for every
character, and the word there is 0. +0x2C is the one field whose value
differs by fighter without a use: Metal Sonic's 12 and Bark's 5 against
everyone's 9. No instruction reads rob+0xC58..0xC6F at any width, so
whatever it tuned, it may be left over from an older build.

### Option data

`copy_option_data` (L27894) reads +0x18: sets of 0x70 bytes, picked by
rob+0xAFC (from 1). Bit 6 of rob+0 picks the second 0x38-byte half. A half
is a pointer to a collision block (+0), slot A (+4) and slot B (+0x1C),
each a unit (s16), a model (u16), a position (3 floats) and three angles
(s16), and a word at +0x34 → rob+0x7F8. A `play_motion` command (L27409)
sets rob+0xAFC, or drops the option with 0. With an option out, rob+0 bit 27
is set, the collision block's +4..+0x23 becomes the hit sphere, and
`rob_disp` draws the option on the part whose unit it names: slot A
normally, slot B with bit 27 (L25040).

Only Amy's set holds anything: slot B is unit 5, model 0x440, which is
likely her hammer. The Megamix does not draw options yet.

### The part lists

Three entries carry bit 15:

| # | character | slot | entry |
|--|--|--|--|
| 13 | Egg Minion | 6, 7 (right upper arm, forearm) | 0x8003, 0x8004 |
| 16 | Super Sonic | 2 (the head) | 0x8000 |

They are models too, out of a second directory. `set_obj` (0x4E98, L4911),
and every `set_obj_*` beside it, tests bit 15: clear, the id indexes the
main directory (count 0x20E0000, entries 0x20E0004, 16 bytes each); set,
`id & 0x7FFF` indexes the one at 0x647F000 (count, which is 4) and
0x647F004, in the EPROM pair IC7/IC8 at 0x7F000. Its five entries are
(uv, material, mesh, ?):

| id | uv | material | mesh |
|--|--|--|--|
| 0x8000 | 0x80C000 | 0x808000 | 0x4 |
| 0x8001 | 0x80C670 | 0x808374 | 0x915 |
| 0x8002 | 0x80CCE0 | 0x8086E8 | 0x1226 |
| 0x8003 | 0x80CD70 | 0x808734 | 0x12EF |
| 0x8004 | 0x80CF08 | 0x808804 | 0x1516 |

Every pointer here is into the board's RAMs: the uv and material pointers
carry bit 23 (texture RAM, MAME `model2_v.cpp`), the mesh pointers lack it
(polygon RAM). The boot fills both once, straight from the same EPROM pair
(XTRA_DATA 0x6400000 is data ROM 0x1000000), in the calls after
`geometry_stuff` (L6795-6801):

| routine | geo header | fills | from | how |
|--|--|--|--|--|
| `sub_11EF8` (0x11EF8) | 0x505 at +0x50: command 5, polygon data | polygon RAM 0..0x7FFF, 16 runs of 0x800 words | 0x6468000 | a word a word |
| `sub_12090` (0x12090) | 0x404 at +0x40: command 4, texture data | texture RAM 0x8000..0xBFFF, 8 runs of 0x800 | 0x6460000 | a halfword a word |
| `sub_12138` (0x12138) | the same | texture RAM 0xC000..0xFFFF | 0x6464000 | a halfword a word |

No other code sends a 0x505 header, and the other 0x404 senders write
texture RAM below 0x8000 (`geometry_stuff`, `move_tpd_send` at 0x5000), so
what the second directory points at stays as the boot left it. It can be
read from the ROM: `js/fighters.js` (`stfRamModel`) decodes those models with
polygon RAM taken from data ROM 0x1068000 and texture RAM's two runs from
0x1060000 and 0x1064000. Super Sonic's 0x8000 is a Sonic head with longer
spikes (1014 vertices, Sonic's 0xBD3 has 972); Egg Minion's 0x8003 and 0x8004
are his left arm's 0xB51 mirrored and 0xB58 again, so they are his right arm
with its drill. The other two are not in a part list: 0x8001 is Super
Sonic's second head, the high half of his face record's +4 (0xC9A74:
0x8000, 0x8001, as Sonic's is 0xBD3, 0xBD4; noclip's `faceModel` drops ids
past the main directory), and 0x8002 is the Chaos Emerald,
`draw_chaos_emeralds` (`lda 0x8002, g0; call set_obj`, L119013). The poly test at L33996 picks the same directory
when `INTERUPT_FLAGS_HELD` bit 17 is set.

## StF's stage records

`stage_data` (0x8F3D0), 256 bytes a record. `change_scene` copies the
current one to 0x504800, but the copy is read only at +0xD0 (`stage_size`,
2.0). The flags (+0) are read from ROM, as `ld stage_data(stage_num<<8)`:

| bit | read by | meaning |
|--|--|--|
| 2 | `camera_init` (L31102) | don't draw the floor model (+0x18) |
| 12 | nothing found | only Stage 99; FV's name entry, bit 12 too, has nothing else |
| 13 | `ground_disp` (L38403) | don't clip and draw the floor tiles (`area_clip`) |
| 14 | `cage_sub_disp` | draw the cage pieces: pole +0x1C, extra +0x1E |
| 18 | `pole_disp` | draw the poles |
| 19, 21, 22, 29 | `cage_clip_m` (L34918) | the wall has 4, 2, 1 or 3 sides; none, 8 |
| 20 | the same | draw the +0x20 model twice, at z = ±6 |
| 23 | `camera_init` | `cage_sub_disp` early (L31247) rather than late (L31383) |
| 24, 26 | `camera_init` | `stage_dsp` early (24, L31162), after the cage (26, L31393), else between (L31307) |
| 25 | `camera_init` (L31315) | skip `rob_low_disp` |
| 27 | `doom_cnt` (L38526) | the second pair of `sky_texture` entries |
| 28 | `rob_kage_disp_outside` (L97907) | no fighter shadows |

Which records set them is the survey's table. Two readings stand out:
Flying Carpet and South Island (alt), the ones in the air, are the two with
bit 28 and no shadows; and Aurora Icefield alone draws its cage early (23),
its stage early (24) and no floor model (2).

+0x20 is read only under bit 20; +0x22..+0x63 and +0xD4..+0xFF have no
reader at all: no `stage_data+N`, no literal 0x8F3Dx/0x8F4xx, no read of the
copy at 0x5048xx. They can be taken as unused.

## VF2's and FV's records

Neither game copies the stage flags to work RAM: both read the ROM record
at `stage_num<<8` each time. Addresses here are in each game's interleaved
program EPRs (disassembled with `i960-nindy-elf-gdb` from a command file;
`-batch -ex` prints nothing).

### VF2's stage records (0x6EE38, flags at +0x68)

| bit | read by | meaning |
|--|--|--|
| 1 | `ground_disp` 0x209BC, loop 0x20AA8–0x20B30 | draw the +0x00 scenery list, cell by cell (masks 0x70058/0x70858). A second pass for the masked cells (0x21224) is dead: its caller hits the `ret` just before it |
| 7 | 0x20908 → 0x20ED4 | the +0x90 models at the XZ points of the +0xD0 list, each only when it is in front of the camera; Ban-ri picks one of four lists by camera Z |
| 9 | 0x20910 → 0x20DE8 | the same models, culled by the camera's yaw against angle pairs in the +0xD0 list |
| 11 | 0x20824 → 0x303E8 | Yuki-yama's own ground: model 0x2DC, a 3×3 grid of pieces picked by camera position and heading, and frame-animated models (0x711DC, 0x7127C); also a late pass (0x3050C) and the ring floor (0x21374) |
| 13 | 0x207BC | skip the +0x40 backdrop picked by camera direction |

Bits 2–6, 8 and 12 were named before (ring, raft, rock, mirror floor,
second look, extra piece, one model).

+0x74 picks the landing and step sounds. 0x43950 reads it
(`ldob 0x6EEAC(stage_num<<8)`) and takes one of three codes per sound out of
the lists at 0x201E29C; the landing and step code (0x15608, 0x1AF44..0x1AF6C)
plays them. No two values share a code. The program's own sound-name table
(0x76C7C on, a code and its name: `metalfoot1`, `wooddown`...) names each:

| sound | +0x74 = 0 | 1 | 2 |
|--|--|--|--|
| 0 (a fall) | 0x9E187F `down` | 0x9E207F `wooddown` | 0x9E1E7F `metaldown` |
| 1 (a foot) | 0x9E155F `land` | 0x9E1B7F `woodfoot1` | 0x9E197F `metalfoot1` |
| 2 (a foot) | 0x9E155F `land` | 0x9E1C7F `woodfoot2` | 0x9E1A7F `metalfoot2` |

Two things override the stage (0x4396C..0x43998): a fighter with rob+0x624
set gets value 0, and fighter 9 plays value 2's sound, the metal one, before
the stage's. The test is `ldob 0x1B1(g7)` against 9 (0x4396C). rob+0x1B1 is
the character, rob+0x1B0 less 13 when it is 13 or more (0xB1DC..0xB1F8; 13 and
up are player 2's records), and every roster name table in the program has
DURAL at 9: 0x2980C, 0x509E8 (read by `ld 0x509E8[r8*4]`, 0x52E10), 0x5CB28
and the debug menu's 0x46298 (ACHO, its development name; its "1P CHAR" and
"2P CHAR" lines read rob+0x1B0 by it, 0x45EC4, 0x45EF8). This is the ROM's
slot order, not the web menu's.

rob+0x624 is the ring-out ground: body parts lying on the floor outside
the ring. The debug menu calls it `out_on` (its string at 0x45158, read by
`ldos 0x624(g7)` at 0x4514C). Only one store puts a value in it:
`stos g3,0x624(g7)` at 0x23B44, in the ring-edge test (from 0x2396C, called
for each fighter at 0x2358C and 0x23598). That code walks the fighter's 29
body spheres (rob+0xD00, 16 bytes each) and keeps two bit masks:

- 0x114(g13): the sphere's bottom (centre y less radius) is at or below
  stage_soko (0x50A010) + 0.05 (0x23A7C..0x23A90).
- g4: the sphere is past one of the ring's edge planes, its count at 0x23BB8
  and its normals at 0x23BBC: the plane's distance, less stage_x (0x50A00C), is
  0 or more (0x23ABC..0x23AF0).

It ANDs the two (0x23B38), maps the sphere bits to body-part bits through
0x23878 (table at 0x2007B76), and stores the result. With the same masks,
+0x614 (`stage_on`) gets the parts on the ring floor and inside it (0x23B58),
and +0x618 gets the parts at the fighter's own floor height, rob+0x1C
(0x23B64). Every other store to +0x624 is a clear to 0: the round reset
(0x14190), fighter setup (0x54AD4) and 36 `mov 0,r15; stis r15,0x624(g7)`
pairs. So the override means a fighter lying outside the ring hears
the plain `down`/`land` set, whatever the stage's +0x74.

0x17BC0 is the other reader: `ldos 0x624(g7),r14`, then `cmpobe 0,r14` and,
when it is not 0, `setbit 5` on w0 (rob+0x0, 0x17BC8..0x17BD0). It sits in
the routine at 0x17B68 (BOARD.md's `rob_check_stage`), which the fighter
update calls at 0x18538. That routine runs only while w0 bit 7 is
set and 0x508000 bit 5 is clear (0x17B6C, 0x17B78), clears w0 bit 13, and
tests the root against stage_x (0x17BA8) before it; the bit 5 test reads
only +0x624. It sets the bit and never clears it, so once any body part has
lain outside the ring the bit stays.

w0 bit 5 is the fighter's lost-the-round flag, not a ring-out flag alone. The
KO sets it too: the damage code at 0x18A70 (0x18A54) and at 0x1B044, both when
rob+0x1AC (energy) drops to 0 or less, which they clamp to 0. The round judge
(`JUDGE_DSP_INT`, 0xE5A8) stores 1 in 0x500050 when both still have energy
(0xE5D0..0xE5F0; BOARD.md reads that as the ring out), then gives the round to
the fighter without bit 5 and sets it on the loser (0xE5F8, 0xE744, 0xE7A4);
when both have it, energy and then tie-breaks decide (0xE618..0xE694), or it
is a draw. Other readers are 0x110CC (either fighter), 0x15830 and 0x1BD20.
What clears it is the fighter start: `w0 &= 0xFF000000`, then bit 31 set
(0x54AE4, and the same next to each of the 36 +0x624 clears, e.g. 0xB250), and
the code by the debug menu's CONTROL TEST strings at 0x55398/0x553B0 and
0x556EC/0x55700, which also refills both fighters' energy from 0x5000A0. The
round reset at 0x14190 leaves it: it clears w0 bits 26 and 29 only (0x141F0,
0x141FC).

The two gates on 0x17B68 are `bbc 7` on w0 at 0x17B6C and `bbs 5` on
0x508000 at 0x17B78. Either one branches to the routine's `ret` at 0x180B8.
The call chain is `rob_action` 0x143F4 → 0x1499C → 0x18144 (0x16478 or
0x16490) → 0x18538. Each of those is the only caller of the next.

- w0 bit 7 is `init_end`, the name in FV's and StF's flag tables (VF2's
  window does not show it). Every fighter start points rob+0xC at the task's
  setup head 0x13F08 (e.g. 0x54AC0, 0xB228). The head stores `rob_action`
  0x142F4 as the resume point (0x142A8) and falls into it in the same frame.
  `rob_action` sets bit 7 as its last act (0x1441C..0x14424), after the update.
  So on the setup frame 0x17B68 is skipped, and it runs on every frame after
  that. The bit also gates the motion frame count at rob+0x1AA/0x1AE
  (0x143B4). Nothing in VF2 clears it on a fighter except the fighter start's
  `w0 &= 0xFF000000`, at the fighter-start sites above (the CONTROL TEST
  code clears bit 5 alone, with `clrbit 5`). The other `clrbit 7` sites are on
  other structs: 0xC90C and 0x3209C on the task at *0x50083C, 0x53E70 on
  `fa_camera`, 0x64474 on a task whose +0x40 is the fighter. `rob_action`
  returns before it sets the bit when mode byte 0x50002B is 6 or 7 (0x14320).
- 0x508000 bit 5 is `debug_flag`'s freeze (DEBUG-MODE.md). In VF2, only
  `debug_sw_check` (0x110F4) writes it, and it stores the word at 0x11280.
  Opening the menu ORs in 0xA6, which is bits 1, 2, 5 and 7 (0x111B4). Each
  frame the menu is open sets bit 5 again (0x111EC). The step key clears it for
  one frame (0x11214), and EXIT clears it together with bits 8 and 2 (0x1122C).
  Boot stores 0 to the whole word (0x994C). The test at 0x17B78 is a second
  guard: `rob_action` already skips the whole update, 0x1499C included, under
  the freeze (`bbs 5` at 0x14370 → 0x14410). So while the debug menu holds the
  fight, the ring test does not run and cannot set w0 bit 5.

The other w0 bits the notes above touch: bit 31 set by the fighter start,
bits 26 and 29 cleared at 0x14190. The fighter start's `w0 &= 0xFF000000`
keeps bits 24 to 31, so it clears neither 26 nor 29. 0x14190 is inside the
setup head 0x13F08 that every fighter start points rob+0xC at, so a start
clears them one frame later, when the head runs.

- w0 bit 31 is the task scheduler's run flag, on every task, not a fighter
  flag. The scheduler walks the task list from 0x510000 (next task at
  +0x8) and calls a task's resume point at +0xC only when its w0 bit 31 is
  set (`bbc 31` at 0x10DC0, `callx` at 0x10DC8). Under 0x500068 bit 16 it
  runs only the fixed list at 0x10EA0, *0x500834, with the same test at
  0x10E88. Bit 31 is set by the fighter start (0x54AE8, and right after 39 of
  the program's 41 `0xFF000000` masks) and by the `setbit 31` writes through *0x500804 and
  *0x500808 (0xB254, 0xB308, 0x318E8, 0x53B28, 0x55220 and others). It is
  cleared by the `mov 1,r4; clrbit 31` sequences that stop tasks: both
  fighters at 0xC690/0xC6A8, 0xEC80/0xEC98, 0xEE2C/0xEE44, 0x3A1DC/0x3A1F4
  and 0x58F10/0x58F28, fighter 0 at 0x54A14 and fighter 1 at 0x5610C. The
  same writes start and stop other tasks: *0x500828, *0x500868, *0x50086C
  and more. Readers on a fighter: 0x1645C calls the fighter update 0x18144
  for each fighter whose bit 31 is set (0x16474, 0x1648C), and 0x18644 only
  when both have it (0x16498). 0x3B158 skips its work when fighter 0's bit
  is clear. FV's and StF's flag tables do not name bit 31.
- w0 bit 26 is `smooth_switch` (FV and StF): blend into a new motion from
  the old pose. Its only test is `bbc 26` at 0x27148, in 0x27130. Callers:
  `set_motion`'s tail (0x1A0C8), 0x1ABE8, 0x3ACC4 and 0x3AEBC. A blend needs
  the bit set, debug byte 0x508008 at 0, rob+0xBE4 not 1, and a motion
  longer than 2 frames (rob+0x800). Then 0x27130 picks a blend kind of 1 to
  3 (by rob+0x1A4, 0x804, 0xC30 and 0x814) into rob+0xBDD. It also picks a
  blend length of 1, 2, 4 or 8 frames, by the motion's length, into
  rob+0xBDE (0x271D8..0x27238), and copies the old pose (rob+0xBD8 → +0x690,
  20 entries of 12 bytes) to 0x50E0F0. Without a blend, rob+0xBE5, +0xBDD
  and +0xBE4 are set to 0 (0x271C4..0x271D0). `set_motion` puts 1 in +0xBE4
  when its g0 has bit 13 or 14 (0x19F40, 0x19FA8), which turns one blend
  off. Writes: boot sets bit 26 on both fighters (0x9B04, 0x9B3C). The setup
  head clears it (0x141F0), plays the stance (`set_motion` 0x14288) and sets
  it again (0x14290), so the stance comes in without a blend and every
  motion after it blends. The frame-timed command player at 0x548CC (lists
  at 0x5001D0 and 0x5001D4, timed by the frame count 0x500024) runs 0x54BE8
  for each entry. That routine stores the entry's command in rob+0x194 and
  sets bit 26, or clears it when the entry's byte +6 is not 0
  (0x54BFC..0x54C08). The `clrbit 26` at 0xCDE8 is on *0x500834, not a
  fighter.
- w0 bit 29 marks a fighter in one of 11 motions that take extra damage.
  VF2 does not name it. StF's table calls bit 29 `small`, which is another
  meaning. Only `set_motion` sets it on a fighter (0x19F90). That happens
  when the motion id (low 13 bits) is in the table at 0x1B98C (288, 926, 934,
  928, 610, 622, 623, 640, 422, 421, 417; listed below). Each reader tests
  the opponent (g8):
  - Throw damage at 0x145C8: + damage/4, debug label "sd_nage" (0x1B982).
  - Hit damage at 0x229E4: × 1.75, label "counter2" (0x23D7D). Unless
    rob+0x1A4 has bit 16 or 14, it is × 1.5 instead, label "counter3"
    (0x23D86), and the bit is cleared (0x22A18).
  - Collision 0x188A8.
  - The opponent logic at 0x41890 and 0x41C2C.

  It is also cleared by the setup head (0x141FC) and by the rise at 0x158D0.
  The other bit 29 writes are on *0x500864 and *0x500834. The set and every
  reader run only when settings byte [0x50016C]+0x3351 has bit 6
  (SHARED-CODE.md: clear on MAME's vf2), so with that bit clear, bit 29 is
  never set.

  The 11 ids in 0x1B98C (u16s up to 0x1B9A2, in table order). A motion id
  is global, an index into the setup table 0x200D34C, so each belongs to one
  fighter: the one whose command program (0x1D1FC[fighter]) plays it. The
  only names the program gives are in its list of named moves at 0x50928:
  for each fighter a pointer to rows of up to 8 motion ids (16 bytes), and
  at 0x50980 a pointer to that fighter's names, one per row, in the same
  order. 0x52B10 reads it: it compares the fighter's motion id (rob+0x1A8)
  with each row and sets the row's bit in +0x244 of the struct in g13.
  (0x2974C holds an older copy of the same lists; no code reads it.)

  | id | hex | fighter | name in the program |
  |--|--|--|--|
  | 288 | 0x120 | Jeffry | Hip Attack (his row 8; command G+K+P) |
  | 926 | 0x39E | Wolf | Drop Kick (his row 6) |
  | 934 | 0x3A6 | Wolf | Drop Kick (the same row) |
  | 928 | 0x3A0 | Wolf | Drop Kick (the same row) |
  | 610 | 0x262 | Shun | Gyoshin-Toutai (his row 7; back+K) |
  | 622 | 0x26E | Shun | Haito-Rensenkyaku (his row 2) |
  | 623 | 0x26F | Shun | none; the motion 622 hands over to (setup op 1, 0x201A4D2) |
  | 640 | 0x280 | Shun | none; his root table, P keys with high byte 2 |
  | 422 | 0x1A6 | Shun | none; G after 419 |
  | 421 | 0x1A5 | Shun | none; after 420 (K after 419); in his command program at 0x38E45, next to 422 at 0x38E52 |
  | 417 | 0x1A1 | Shun | none; his root table, K keys with high byte 2 |

  Wolf's Drop Kick row has seven ids: 926, 932, 1228, 935, 928, 933 and
  934. Only 926, 928 and 934 are in 0x1B98C. No other string, debug label or
  data table in the program names these motions.

  What plays Shun's four unnamed ids. Shun is command program 8 (root table
  0x38B0C). His name rows (0x51096, names from 0x51832) are ten: Drunker's
  Throw(?) 0xAC, Tenshin-Souchusho 0x26C, Haito-Rensenkyaku 0x26E,
  Sakadachi-Geri(?) 0x25B, Honshin-Rensenkyaku 0x248, Chubu-Soutenkyaku
  0x1A0, Renpu-Soutai 0x250/0x251/0x252, Gyoshin-Toutai 0x262, Rabbit Kick
  0x377, Front Over Head Kick 0x46. No setup record of any of the 1359
  motions hands off to 640, 422, 421 or 417 (setup op 1, op 5, op 0x0A, play
  ops 0x0A/0x0B/0x17), and none of the four hands off to anything, so each
  is played only by a commit in Shun's command program:
  - 640 (0x280): root table, the four keys 0x201, 0x203, 0x205, 0x207 (P,
    K+P, G+P, G+K+P, key high byte 2), commit word 0x09040280. No stick
    input, no follow-up table before it.
  - 417 (0x1A1): root table, keys 0x202 and 0x206 (K, G+K, high byte 2),
    commit word 0x1A1. Likewise no stick input and no table before it.
  - 422 (0x1A6): the follow-up table 0x38E18, key 0x004 (G), commit at
    0x38E51. 0x38E18 is parked (op 0x0D at 0x38E0C) by the commit of 419
    (0x1A3, at 0x38E13), which the root table plays for no stick bit, then
    DOWN with the flag-1 side bit, then K with that side bit (key 0x002) or
    G+K (0x006). The flag-1 side bit is LEFT or RIGHT by rob+0x0 bit 1
    (below); the note used to call it "back", a word the program does not
    store.
  - 421 (0x1A5): the same table's K (key 0x002) commits 420 (0x1A4, at
    0x38E34) and parks 0x38E39 (op 0x0D at 0x38E2F). The matcher next runs
    from there: op 0x16, a wait (ops 0x12, 0x1D), then the commit of 421
    at 0x38E44, with no key test (op 0x0E) on the way. So 421 follows 420
    without another button.

  419 and 420 are in no name row, so neither 421 nor 422 comes after a
  named move, and 640 and 417 come after nothing. None of the four is
  reached from a named move or by a handoff from one, and none of them
  plays or hands off to another of the four. 421 and 422 are the two
  branches after 419 (420 then 421, or 422). The program stores no name for
  419, 420 or the high byte 2 of a key.

  How a key is compared, from the matcher that runs Shun's program (the
  table pointer is loaded at 0x1BBD4, the ops dispatch through 0x1D250):
  - Op 0x0E (handler 0x1CA08) reads header bytes +1 and +2 as one 16-bit
    word, +1 low, and compares it with g0 (`cmpobe r3,g0` at 0x1CA18). If
    they are not equal it steps 7 bytes to the next header. The first header
    whose word equals g0 is the one whose script runs. The "second byte" is
    header byte +2, the high byte of g0. The key holds no stick bits.
  - The low three bits of g0 are new presses from byte +2 of a rob+0x1280
    entry (r9), not from rob+0x1200, which holds the buttons held. 0x1BC1C
    loads byte +0 of the previous entry into r6, 0x1BC2C loads rob+0x1200
    into r8, and `andnot r6,r8,r9` at 0x1BC34 makes r9 = r8 AND NOT r6. That
    r9 is stored as byte +2 at 0x1BC40, and 0x1C258 loads it back for an
    older entry. rob+0x1200 is 0x500700 shifted right 8 for player 1
    (0x1BA60) or 16 for player 2 (0x1BAB4). The CONTROL TEST screen (0x607D4,
    labels 0x76A68..0x76AC8) shows player 1's PUNCH from bit 8 of 0x500700,
    KICK 9, GUARD 10, DOWN 12, UP 13, RIGHT 14, LEFT 15. So in the key and in
    rob+0x1200, bit 0 is PUNCH, 1 KICK and 2 GUARD (the note's P, K, G),
    bit 4 is DOWN, 5 UP, 6 RIGHT and 7 LEFT. 0x1C2D4..0x1C308 copies the new
    PUNCH and KICK bits into g0. It copies GUARD only when rob+0x1A4 has bit
    25 or 26 set or g0 is already nonzero.
  - From r9 to 0x1CA18. 0x1C2D4 clears g0. `chkbit`/`alterbit` copy r9
    bits 0 and 1 to g0 bits 0 and 1 (0x1C2D8..0x1C2E4), then r9 bit 2 to
    g0 bit 2 (0x1C2FC, 0x1C300) and r9 bit 8 to g0 bit 5 (0x1C304,
    0x1C308). r9 is loaded as a byte, so bit 8 is set only by `setbit
    8,r9,r9` at 0x1C68C. Before that, 0x1C5FC (`bal` at 0x1BD18 with g0 0,
    at 0x1C270 with g0 1) can change r9: it ands r9 with 7 into r5
    (0x1C600), can hold those bits back in rob+0x123E[g0] and clear them
    from r9 (`andnot r4,r9,r9`, r4 = 7, at 0x1C62C and 0x1C6B0), and puts
    held-back bits into r9 later (`or r5,r9,r9` at 0x1C6C4). 0x1C68C runs
    when the held-back bits are 6 and r8 AND 7 is 2 (0x1C680..0x1C688).
    The ROM stores no name for that bit. The interpreter does not lose r9
    across the calls before 0x1C2D4: 0x1C778 saves r8..r11 (`stq`) and
    0x1D188 loads them back (`ldq`). g0 then reaches the matcher one of
    three ways: as it is, or plus 0x500 (0x1C398), then `bal 0x1c70c` at
    0x1C39C; plus 0x300 or 0x400 (0x1C464, 0x1C46C), then `bal` at
    0x1C470; or through rob+0x120C: `or g0,r4,r4` at 0x1C428 when r4's low
    three bits are 0, `and 7,r4,r3` at 0x1C430, g0 = r3 + 0x100 (`lda
    0x100(r3),g0` at 0x1C43C) or r3 + 0x200 (0x1C444), then `bal` at
    0x1C454. That third way keeps only bits 0..2. 0x1C70C jumps to 0x1C770,
    and 0x1C7E0 dispatches each op through 0x1D250, where entry 0x0E
    (0x1D288) is 0x1CA08. No instruction from 0x1C70C to 0x1CA18 writes
    g0, but native code run by `callx` can, and in two VF2 programs it
    does before a 0x1CA18 compare. `callx (r3)` at 0x1CBE8 is op 0x14
    (0x1D2A0); its callee is the word at script +1, and no script reached
    from the eleven programs at 0x1D1FC (or from the tables op 0x15
    stores, at 0x1CC4C or 0x1CC64) uses op 0x14. `callx (g4)` at 0x1CBB0
    is op 0x13 (0x1D29C); its callee is code inside the script, at script +5 rounded
    up to 4. On return, `mov r3,g4` (0x1CBB4) and `b 0x1c7e0` (0x1CBB8)
    carry on at the word at script +1. All 89 op 0x13 sites those
    programs reach write g0: 87 put a value in g0 (`lda`, `shlo` or
    `addo`) and `b 0x1d194`, which `ret`s with g0 from `testle g0`
    (0x1D1CC) or `mov 0,g0` (0x1D1D4); 0x37EB4 and 0x3863C set g0 to 0
    or 1 and `ret`. In 88 sites the next op is 0x16, which compares g0
    at 0x1C9FC, not 0x1CA18. Two paths reach 0x1CA18 after the call. In
    program 3 (0x378C8) the op 0x13 at 0x37EAF carries on at 0x37ED4, an
    op 0x0E header with key 1, so 0x1CA18 compares the callee's 0 or 1
    there. In program 5 (0x38278) op 0x15 at 0x38614 stores the table at
    0x38633 in rob+0x122C (0x1CC4C). 0x1A100 copies that to rob+0x1228,
    and 0x229AC copies rob+0x1228 to rob+0x121C. A table in rob+0x121C
    runs first (`bal 0x1c758` at 0x1C73C, which saves g4 and g14 but not
    g0). If g0 is 7 (op 0x16 at 0x38633), its op 0x13 at 0x38636 sets g0
    to 0 or 1. If the script
    then fails, the run returns (0x1D17C, `bx (g14)` at 0x1D190) to
    0x1C740, and 0x1C750 runs the fighter's own table from 0x1C758 with
    that g0. A commit ends the whole call instead (0x1C5C8, `ret` at
    0x1C5F8). The ROM stores no name for 0x1D194, 0x37EB4 or 0x3863C.
    Apart from those two paths, the button bits compared at 0x1CA18 come
    from byte +2, not from the held byte.
  - The high byte. With rob+0x1A4 bit 12 clear, g0 is matched at 0x1C39C
    as it is (high byte 0) or with 0x500 added when rob+0x0 has bit 4 set (0x1C394).
    With bit 12 set (`bbs 12` at 0x1C30C) and rob+0x1B2 equal to 2, g0 gets
    0x300 added, or 0x400 when rob+0x19C has bit 18 set (0x1C45C..0x1C46C).
    Otherwise, with bit 12 set, the program keeps the first nonzero buttons
    in the low three bits of rob+0x120C (0x1C428). It matches them once (bit
    6, 0x1C448) after bit 7 of that byte is set. 0x1C400 sets bit 7 when
    rob+0x1AA + 1 is at least rob+0x80E. 0x1C41C also sets it, when the
    input holds no UP and rob+0x19C bit 18 is clear. The key is then 0x200
    plus the buttons if r5 has bit 18 set (`bbs 18` at 0x1C438, 0x1C444),
    or 0x100 plus the buttons if it is clear (r5 in the next item).
  - rob+0x19C bit 18. VF2's ROBn_INFO debug window names rob+0x19C
    `action` (string at 0x44B34) and rob+0x194 `command` (0x44B1C). The ROM
    stores no name for bit 18. Of 0x1C30C, 0x1C3E8 and 0x1C438, only
    0x1C438 tests bit 18: `bbs 18,r5` (0x3791600C). 0x1C30C tests rob+0x1A4
    bit 12 and 0x1C3E8 compares rob+0x1B2 with 2. r5 is a copy, not
    memory. 0x1C3CC loads rob+0x19C into r5, and 0x1C3D8 ands it with
    0xFF040000, which keeps bit 18. Then, if the held input (r8,
    rob+0x1280[i*4], 0x1C250) has no UP (`bbs 5,r8` at 0x1C404) and
    rob+0x19C bit 18 is clear (`bbs 18,r15` at 0x1C40C, r15 loaded from
    rob+0x19C at 0x1C408), 0x1C410 puts 0x09040000 in r5 and 0x1C418 stores
    it in rob+0x194. That value has bit 18 set, so the `bbs 18,r5` at
    0x1C438 is taken. That UP is the CONTROL TEST UP. Byte +0 of a
    rob+0x1280 entry is a copy of rob+0x1200 (`ldob 0x1200(g7),r8` at
    0x1BC2C, `stob r8,0x1280(g7)[r5*4]` at 0x1BC38). When 0x1C244 skips the
    0x1C250 load, r8 is still that 0x1BC2C value. So bit 5 of r8 is bit 13
    of 0x500700, held, not newly pressed (new presses are byte +2, `andnot`
    at 0x1BC34). `bbs 5,r8` jumps to 0x1C420 when the bit is set, so
    0x1C408..0x1C41C run only when UP is not held. The key is 0x2xx when rob+0x19C bit 18 is set, or
    when it is clear and UP is not held. It is 0x1xx only when bit 18 is
    clear and UP is held. The 0x300/0x400 test at 0x1C460 (`bbs 18,r5`)
    branches off at 0x1C3E8, before 0x1C410, so there r5 has rob+0x19C's
    own bit 18. So high byte 2 means rob+0x1A4 bit 12 set, rob+0x1B2 not
    2, and rob+0x19C bit 18 set or UP not held.
  - The stores to rob+0x19C that can set bit 18. 0x146EC loads rob+0x194
    into r11 and jumps on its top byte (rob+0x197) through the table at
    0x1B808 (8 bytes an entry). Four stores write that r11 to rob+0x19C:
    0x14790, 0x147A4, 0x14948 and 0x1497C, so bit 18 comes from rob+0x194.
    The entry for top byte 9 (handler 0x147BC; 0x09040000 above and
    0x09040280 at 0x39102 are type 9) changes r11 before 0x14948.
    0x147E4..0x147F0 or in the old rob+0x19C with bits 16..18 cleared
    (`andnot` 7 << 16). 0x148B4..0x148BC clear bits 18, 24 and 27
    (`andnot` 0x09040000) when rob+0x1A4 bit 12 is clear at 0x148A8. A
    fifth store, 0x16018, writes the sign-extended low half of rob+0x19C
    (`ldos` at 0x1600C) plus 0x11000000, so its bit 18 is the old bit 15.
    Of the rest, 0x15364 and 0x155F0 write rob+0x19C back with bit 19
    cleared, 0x15ED0, 0x1641C and 0x16454 write 0x10000000, 0x03000000 and
    0x04000000, and 18 write 0. (0x1F888 stores to 0x19C(g13), not g7.)
  - Which entry. Every root key with high byte 2 and bit 0 set (0x201,
    0x203, 0x205, 0x207) runs script 0x390EA. Keys 0x202 and 0x206 (bit 1
    set, bit 0 clear) run 0x39107. No root key is 0x204 (GUARD alone).
    0x390EA commits 0x265 if rob+0x5B8 has bit 11 set (op 7, handler
    0x1C974). If not, it commits 0x1AA when rob+0x19C has bit 16 set (op
    0x1C, handler 0x1CD00). Only when both tests fail does it commit
    0x09040280 (at 0x39102), which plays 640. 0x39107 commits 0x1A1 (417, at
    0x3910E) only when rob+0x19C has bit 16 set. If not, it commits
    0x09040090 when bit 17 is set, and 0x377 when it is not. Neither script
    has a stick op, so the earlier "no stick input" holds.
  - The stick tests are separate script ops, not part of the key. Ops 0, 1
    and 3 (handlers 0x1C7F0, 0x1C84C, 0x1C8AC) take a stick mask from byte
    +1. Bit 0 of byte +2 sets bit r6 in the mask and bit 1 sets bit r7. They
    compare it with the input sample masked to 0xF0: held from
    rob+0x1280[i*4], new from rob+0x1282[i*4] (0x1D0E8..0x1D128). Ops 2 and
    0x1E take a bit number, 8 meaning r6 and 9 meaning r7 (0x1C87C,
    0x1C820). Op 0x28
    branches on bit r6 or r7 of rob+0x1281[i*4] (0x1CE84). r6 is 6 (RIGHT)
    and r7 is 7 (LEFT) when rob+0x0 bit 1 is clear, and the other way round
    when it is set (0x1BCE0..0x1BCF8). 419's script (0x38DD7 → 0x38DFB)
    takes the r7 branch of op 0x28 at 0x38DA1. Then it runs op 1 with 0x10
    and flag 2 (DOWN plus the r7 bit), op 3 with the same mask, and op 1
    with 0x00 (no stick bit), most recent first.

  FV and StF have no such table. Their `set_motion` goes straight from the
  bit-14 block to the bit-13 block (FV 0x1B5E4 → 0x1B5FC, StF 0x1AFAC →
  0x1AFC4), with nothing between where VF2 has 0x19F44..0x19F94, and the 22
  bytes of 0x1B98C appear nowhere in either program. Jeffry, Wolf and Shun
  are not in FV's or StF's roster, so neither program has or names these
  motions.
- Settings byte 0x3351 bit 6 is the test menu's GAME ASSIGNMENTS item
  **VERSION**. Its two choices are "NORMAL" (bit clear) and "VERSION 2.1"
  (bit set): the menu record at 0x77BE8 (byte 0x3351, bit code 0x34 = bit 6,
  choice list 0x5B550 → 0x780BB / 0x780C7). Both copies of the menu (tables
  0x5B340 and 0x5B3C0) point at the same handler.
  - 0x3351 is a byte in backup RAM (0x1D03351) with a work copy at
    0x59C351. [0x50016C] holds 0x1D00000 or 0x599000, the base of one or the
    other.
  - The one write that sets it is that handler, 0x5B0F4: `notbit 6`, stored
    to both copies (0x5B110, 0x5B118). Every other bit of the byte is
    another item in the same menu: bit 0 ADVERTISE SOUND, 1 CONTINUE,
    2 DISPLAY TYPE, 3 DRINK, 4 RANKING MODE, 5 VS FINISH.
  - The defaults routine 0x6010C clears it (it stores 0 to the whole byte at
    0x60278/0x60280), so the default is NORMAL. It runs from INITIALIZE
    (0x5B174), from the backup RAM checks (0x6DE4C, 0x6DF30, 0x6E100) and from
    0x58E68 and 0x5EC30. MAME's vf2 has the bit clear because its backup RAM
    holds those defaults.
  - It gates the bit-29 set (`bbc 6` at 0x19F54 skips 0x19F90) and the
    readers above (for example 0x229DC before 0x229E4). The program tests
    bit 6 of 0x3351 in 45 places in all, so VERSION 2.1 changes more than
    bit 29; the others are not traced.
  - FV has the same byte 0x3351 with bits 0, 1, 2, 4 and 5 for the same
    items, but its menu (in the data ROMs) has no VERSION item, and no load
    of 0x3351 in its program is followed by a bit-6 test (VF2 has 45). StF's settings bits are in 0x3353, and its
    bit 6 is a different item, HYPER MODE (record 0x99D68); StF has no
    VERSION item.

Every record, with the floor the web Megamix draws for it (`?stage=N`, the
menu number; noclip's reading of the ring models, not checked against the
board):

| record | stage | menu | +0x74 | floor drawn |
|--|--|--|--|--|
| 0 | Tou-rin | 0 | 0 | stone paving |
| 1 | Colloseum | 1, 2 | 0 | cobbles |
| 2 | Ikada | 3 | 1 | wooden planks (the raft) |
| 3 | Budou-jou | 4 | 0 | grey-blue stone |
| 4 | Ban-ri | 5 | 0 | stone setts |
| 5 | Islands | 6 | 1 | a wood-grain deck with a raised edge |
| 6 | Souseiji | 7 | 0 | rough stone |
| 7 | Stones | 8 | 0 | rock |
| 8 | Yuki-yama | 9 | 2 | a polished brown ring, lined in squares; the snow is around it (bit 11's ground) |
| 9 | Tetsujisi | 10 | 0 | cobbles |
| 10, 11 | Mirror | 11 | 2 | dark water |
| 12 | Test | 29 | 2 | steel tread plate |
| 13 | Tetsujisi (a copy) | - | 0 | the same as record 9 |
| 14 | Colloseum (a copy) | - | 0 | the same as record 1 |
| 15 | Test ("13:") | 30 | 0 | steel tread plate, the same as record 12 |

What each value means (0 and 1 from the floors that share them, 2 from the names):

- **0: a hard floor.** Stone, cobbles, rock, and steel on record 15. They
  all agree.
- **1: wood.** Ikada's raft and Islands' deck are both wood.
- **2: metal.** The program names its sounds `metaldown`, `metalfoot1`
  and `metalfoot2`. It is the sound the game gives Yuki-yama, Mirror and
  Test record 12 whatever their floors look like (snow, water, steel), the
  same set Dural's metal body adds on every stage. Record 15 draws the same
  steel floor with 0 (`down`/`land`), so the byte is set by stage, not read
  from the floor.

+0x66 and
+0x67 are 0xFF everywhere.

### VF2's fighter records (0x200620C)

| at | what |
|--|--|
| +0x08 | 0 for every fighter |
| +0x34 | 16 per-part models for the reflection on Mirror's floor (0x19CB0, under stage bit 5; noclip vf2reflection.js) |
| +0x38 | the midriff: [0] → rob+0x64, [4] → rob+0x44 (0x18FD0), the band built at 0x16F40, its +8 model on slot 9 and its +0xC low hips (noclip games.js) |
| +0x44 | a third 16-part model set, for the ending: `ENDSUB_INT` (0x10500) sets 0x500068 bit 25, the winner's rob+0x700 bit 5, and `rob_disp` draws these instead (0x19178), with a trail of 30 frames of saved matrices (0x19AFC, 0x548010) at a rising level, likely a translucent afterimage. Akira's are 0xF9A–0xFB2, Sarah's 0x10A7–0x10BD; Dural's are his +0x34 set |
| +0x48 | a pointer to one word per fighter, in order except Pai's (0x20061FC); Akira's holds 0x7C, Sarah's 0x7A, Dural's 0. Its reader (→ rob+0x768) is not followed |

The Megamix draws neither the reflection set nor the ending set.

### FV's stage records (XTRA 0x06CE1048)

| bit | read by | meaning |
|--|--|--|
| 3 | 0x1EFBC | City Hall Elevator rises: 0x50A018 += 0.017 a frame unless a fighter has +0 bit 5, and the ground draw (0x239CC) is offset by it, so the world slides past |
| 12 | nothing | Name Entry only; none of FV's 16 flag loads tests it. Likely VF2's "one model" left over |
| 23 | 0x1FA58 / 0x1FC30 | draw the bit-14 wall pieces (0x22C08) in the early display list, not the late one (Elevator) |
| 24 | 0x1F8E0 / 0x1FB2C | the same for the platform (`sub_235BC`) (Airport) |
| 25 | 0x1F8FC / 0x1FB48 | the same for the fighters (0x21C14) (Elevator); a broken wall does it too |

23 to 25 look like draw order inside the elevator car and on the airport
deck. The other bits are docs/FV-STAGES.md's.

FV's fighter records keep their unnamed fields: the table shows most of
them shared by every fighter (+0x18, +0x30, +0x34) or by groups (+0x2C,
+0x38, +0x3C); nothing has been traced for them yet. Bahn, Picky and Raxel,
the three with their own +0x2C and +0x38, are where to start.

## How to use this

When a fighter or stage does something only it does, look up its row: a
value only it has is where to start. Then name the field in
`tools/record-survey.mjs` (the `STF_CHAR`, `VF2_CHAR`, `FV_CHAR` lists and
the `*_FLAGS` maps), and it leaves the unknown columns.
