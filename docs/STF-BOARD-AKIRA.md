# Akira on the Sonic the Fighters board: what would be overwritten

This file covers the first step of the Model 2B port. The target is the
Sonic the Fighters board: MAME `sfight` (Model 2B). `m2kernel` (shared
branch) carries the same set in its second program pair. The question is
where Sonic the Fighters keeps its roster, motion tables and stage list,
and what in those places would have to be overwritten to drop in Akira's
existing VF2 data. No new assets are made, and there is no i960 code yet.

Akira stands in for Sonic, StF character 0 (and 26, player 2's record).

All numbers were measured from the sets in `$ROMS_DIR` with noclip's
readers (vendor/noclip). Sizes marked ≤ are distances to the next block
of the same kind, which makes them upper bounds.

Two address spaces are used:

- **prog** offsets are in the i960 program ROM (epr-19001/19002, 1 MB).
- **main_data** offsets are in MAME's `main_data` region, which the CPU
  sees at `0x02000000 + off`. 0x1000000 and up is epr-19003/19004, mirrored
  every MB as the XTRA window at `0x06000000`.

## StF tables (overwritten in place)

| what | where | size | notes |
|--|--|--|--|
| character record pointer table `CHAR_PARTS` | prog `0xC5268` | 43 × 4 B | entry 0 → Sonic's record |
| Sonic's character record | prog `0xC4A84` | 0x30 | +0 parts, +4 skeleton, +0xC actions, +0x14 height |
| Sonic's part list | prog `0xC3584` | 0x80 | 16 normal + 16 squished model ids (u32) |
| Sonic's skeleton (type 0) | prog `0xC2558`, through `SKELETON_TYPE_DATA` `0xC2068` | 16 × 12 B | the record's own +4 is not the one used |
| Sonic's action table | prog `0xD9908` | 52 × u16 = 0x68 | |
| command program pointers `MOVESET` | prog `0x1EFAC` | 4 B per character | Sonic's program is at prog `0x820D8`, ≤ 0xAF4 |
| motion setup list `MOT_LIST` | prog `0xCE380` | 519 × 4 = 0x81C | Sonic's 101 setup records total 0x232F, spread over `0xCF544..0xD97BC` |
| motion block list `offset_list_motions` | main_data `0x1000004` (`0x06400004`) | 519 × 4 = 0x81C | packed: the first block follows at `0x1000820` |
| Sonic's motion blocks | 101 blocks in main_data `0xC121EE..0x103EB28` | 0x4D350 (309 KB) | scattered among the other fighters' blocks |
| model table | main_data `0xE0004` | 5103 × 16 B = 0x13EF0 | Sonic's parts are models 8, 10–13, 15, 16, 18–23, 3027 (14 normal) and 1146–1164 (squished) |
| Sonic's meshes | polygon ROM, 28 meshes `0x44F0..0x7D285C` | 0xF840 (62 KB) | |
| stage records | prog `0x8F3D0` | 16 × 256 B = 0x1000 | material pointers at prog `0x909E0` |
| texture set 1 (fighters, uploaded with every stage) | page list main_data `0xB00010`, origins `0x30053C` | 24 pages, data `0xB00074..` | see Textures |

## Akira's VF2 data (what would go in)

| what | VF2 location | size |
|--|--|--|
| record | `0x02001208` | |
| action table (+0x14) | | 84 × u16 (StF has 52 slots, so it must be remapped: `js/fighters.js` ACTION_SLOTS) |
| command program | prog `0x346B8` | ≤ 0x8F8 |
| motions (actions + every command target) | 134 ids, 1..1285, in VF2's 1360-entry list at main_data `0x120004` | 0x63D14 (399 KB) |
| setup records | `0x0200D34C[id]` | 134 records, 0x1862 |
| models | 16 parts (407–414, 416, 417, 419–422, 2452, 2454) + item 2442 | meshes 0xE61C (57.5 KB) |
| textures | sets 40 (4 pages), 1 (3), 2 (9) | ≈ 0x29EC0 (168 KB) of page data |

## What fits where

Akira's data is larger than Sonic's in every category (134 vs 101 motions,
399 vs 309 KB), so a straight overwrite of Sonic's bytes does not fit. The
tables are pointer tables, so the blocks can go into the ROMs' unused fill
instead, with only the entries repointed:

| ROM | unused run (0xFF fill) | size | for |
|--|--|--|--|
| main_data (mpr-19005/06 half) | `0xD6F1AE` | 0x290E52 (2.6 MB) | motion blocks (399 KB), VF2 texture pages (168 KB) |
| polygons (mpr-19010/13 pair) | `0xEC2578` | 0x13DA88 (1.24 MB) | Akira's meshes (57.5 KB) |
| program (epr-19001/02) | `0xF2234` | 0xDDCC (55 KB) | command program (≤ 0x8F8), setup records (0x1862), part list, action table |

main_data also has 0x00 runs: `0x120E6C` (1.9 MB), `0x4EADFB` and `0x9F3DF0`. These
are probably free too, but that is not confirmed: nothing has been checked
for reads of them.

The motion id space is the real limit. StF's lists hold exactly 519 ids,
and the block list is packed: its first block follows directly at
`0x1000820`. Akira's 134 ids therefore have to take over existing ids.
Sonic's 101 cover most of them. The other 33 have to come from StF
characters Megamix does not use (Tails, Amy, Metal Sonic, Fang, Bark,
Knuckles, Espio, Bean…). Otherwise both tables have to be moved to free
space, which means changing the program's references to them.

## Textures

Akira's pages go to the same texture-RAM pages as StF's set 1, origin word
for origin word. The two games use the same page grid.

| VF2 set:page | origin | StF set 1 page it lands on (main_data, ≤ size) |
|--|--|--|
| 1:0–2 | 0x2, 0x4, 0x6 | pages 1–3 (`0xB02050` 0xFBC, `0xB0300C` 0x210, `0xB0321C` 0x418) |
| 2:0 | 0x40000006 | page 3 again, 0x40 rows down |
| 2:1–8 | 0x8 … 0x16 | pages 4–11 (`0xB03634` … `0xB0ABD8`) |
| 40:0–3 | 0x18 … 0x1E | pages 12–15 (`0xB0B9C0` … `0xB0FE38`) |

Overwriting all 15 pages (StF pages 1–15, main_data `0xB02050..0xB113D8`,
0xF388 B) would wipe whatever StF's cast keeps in them. Every StF stage
uploads set 1. Sonic, Honey and Eggman have to stay. Before any page is
overwritten, someone has to check which of their tiles lie in pages
1–15.

The alternative is to keep set 1 and move Akira's pages elsewhere by
rewriting the UVs in his meshes. That changes existing data rather than
adding any.

## Formats that differ

Neither of these is new data, but both have to be converted, not copied:

- **Setup records.** VF2's op 4 (strike) is 19 bytes; StF's is 18. Other op
  lengths match (`SETUP_LENGTH` in vf2fighters.js, `STF_LENGTHS` in
  js/fighters.js).
- **Command programs.** VF2's matcher stops at op 0x33, and ops 0x32/0x33 are
  jumps on a setting StF does not test (`isa` in noclip's VF2 profile).
  The commit ops carry VF2 motion ids, which have to be renumbered into StF
  ids.

Motion blocks, meshes, skeleton layout (16 × xyz) and texture pages are the
same format on both boards, and noclip decodes both with the same code.
The model table's uv and material fields (VF2 entries at main_data
`0xE1974..0xE9964`) point into VF2's own data. That data has to come
along too. Exactly what it covers has not been traced yet.
