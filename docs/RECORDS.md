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
  928, 610, 622, 623, 640, 422, 421, 417; whose motions they are is not
  traced). Each reader tests the opponent (g8):
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
  never set. What bit 6 is, and so whether a real board ever uses bit 29,
  is still a lead.

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
