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
slot order, not the web menu's. rob+0x624 is likely the
ring-out fall (BOARD.md, Ring out), the ground outside the ring.

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
