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

## Who samples StF set 1's pages 1–15

Measured by decoding all 5103 StF models (noclip `decodeModel`) and
attributing each textured face to the page that holds its tile's origin.
Owners come from:

- the character part lists (normal and squished, all 43 records);
- the face-variant tables (`faceVariantOwners`, which gives a face to the
  lowest character that names it);
- every stage record's layer lists and display list.

"Unattributed" covers models none of those name: effects, items and select
or attract screens. Where those are drawn has not been traced.

On the upload path, a stage uploads the boot set 1 plus its own g0
(`resolveTexSets`). No other texture set, set 16 included, puts a
full-size page at any of these 15 places. Whatever set 1 leaves there is
what every fight samples.

| page | main_data, size | Sonic / Honey / Eggman | other fighters | stages | unattributed models |
|--|--|--|--|--|--|
| 1 | `0xB02050` 0xFBC | Sonic, Honey and Eggman bodies and faces (P1 and P2) | 28 | slot 15 | 1988 |
| 2 | `0xB0300C` 0x210 | Sonic and Honey faces | 15 | – | 81 |
| 3 | `0xB0321C` 0x418 | – | Metal Sonic, Rocket Metal | – | 22 |
| 4 | `0xB03634` 0x1250 | Honey body and faces, a Sonic face | 14 | – | 9 |
| 5 | `0xB04884` 0x63C | Sonic and Honey faces, Honey 1674 | 14 | – | 55 |
| 6 | `0xB04EC0` 0x3E8 | – | Tails, Amy, Bark, Bean | – | 192 |
| 7 | `0xB052A8` 0x1478 | Eggman 793, 1373 and faces 3347–3349 | Eggman B, boss, Egg UFO | – | 2 |
| 8 | `0xB06720` 0x1C08 | Honey body and faces, Sonic faces | 20 | – | 65 |
| 9 | `0xB08328` 0xC2C | Honey faces | 10 | – | 9 |
| 10 | `0xB08F54` 0x1C84 | Sonic 22, 23, 1146, 1147 and faces | 12 | – | 127 |
| 11 | `0xB0ABD8` 0xDE8 | – | 12 (Tails, Amy, Bean, Eggman boss, Egg UFO, Egg Minion, Rocket Metal…) | – | 63 |
| 12 | `0xB0B9C0` 0x1954 | – | Eggman boss | – | 24 |
| 13 | `0xB0D314` 0x2334 | Sonic faces 3017–3020, 4140 (P1 and P2) | 12 | – | 46 |
| 14 | `0xB0F648` 0x7F0 | Sonic faces 2703, 2704 (P1 and P2) | 14 | – | 49 |
| 15 | `0xB0FE38` 0x15A0 | – | – | – | 20 (2534–2537, 2611–2614, 3422–3425, 3461–3464, 3469–3472) |

Five pages are sampled by no Megamix StF fighter: 3, 6, 11, 12 and 15
(0x418 + 0x3E8 + 0xDE8 + 0x1954 + 0x15A0 = 0x44DC bytes). The other ten carry Sonic, Honey or Eggman.

Akira's VF2 pages land on all fifteen:

| Akira's VF2 set | StF set 1 pages |
|--|--|
| 1 | 1–3 |
| 2 | 3–11 |
| 40 | 12–15 |

So his pages cannot go in by overwrite without losing the cast's
textures on pages 1, 2, 4, 5, 7, 8, 9, 10, 13 and 14.

Page 1 is shared most widely: 1988 unattributed models sample its first
64×64 tile, some of them with thousands of faces.

## Free texture RAM during a fight: none

Measured by walking every StF texture set's page list (all 18 numbers;
sets 0, 11–15 and 17 are empty) and marking each 8×8 texel cell that a
page's full-size level or mip chain writes. Then every StF model's tiles
were matched to the 256×256 slot they sample. Owners come from the same
lists as above.

Texture RAM is two sheets of 24 full-size 256×256 slots (the lower right
quarter of each sheet holds the mips). In a fight:

- **Sheet 1**: set 1, uploaded with every stage, fills all 24 slots.
- **Sheet 0**: the stage's own set (2–10, or 16 for the story scenes)
  fills all 24 slots. Every stage set has 24 full pages at the same 24
  places. No set leaves any of them out.

No slot is left empty on either sheet, and every mip cell is written too.
No texture RAM is free in any StF fight.

Sheet 0 is stage art, so it is no help: each slot there is sampled by
5 to 15 of the 17 stage records.

On sheet 1, these are set 1's slots that no Megamix StF fighter (Sonic,
Honey, Eggman, P1 or P2) samples:

| set 1 page | slot (x, y) | page data, ≤ size | page-list entry | sampled by |
|--|--|--|--|--|
| 3 | (0, 768) | `0xB0321C` 0x418 | `0xB00020` | 3 other fighters, 22 unnamed |
| 6 | (256, 512) | `0xB04EC0` 0x3E8 | `0xB0002C` | 8 other fighters, 192 unnamed |
| 11 | (512, 768) | `0xB0ABD8` 0xDE8 | `0xB00040` | 12 other fighters, 63 unnamed |
| 12 | (768, 0) | `0xB0B9C0` 0x1954 | `0xB00044` | 2 other fighters, 24 unnamed |
| 15 | (768, 768) | `0xB0FE38` 0x15A0 | `0xB00050` | 20 unnamed |
| 16 | (1024, 0) | `0xB113D8` 0x2C10 | `0xB00054` | 6 other fighters, 14 unnamed |
| 18 | (1280, 0) | `0xB15930` 0x2BEC | `0xB0005C` | 2 other fighters, Tails' Lab, 149 unnamed |
| 19 | (1280, 256) | `0xB1851C` 0x1CCC | `0xB00060` | 2 other fighters, 69 unnamed |
| 20 | (1536, 0) | `0xB1A1E8` 0x2220 | `0xB00064` | 154 unnamed |
| 21 | (1536, 256) | `0xB1C408` 0x224C | `0xB00068` | Flying Carpet's stage models, 4 unnamed |
| 22 | (1792, 0) | `0xB1E654` 0x150C | `0xB0006C` | 55 unnamed |
| 23 | (1792, 256) | `0xB1FB60` | `0xB00070` | 99 unnamed |

Every one of them is still sampled by something. The other fighters,
stage models and unnamed models (effects, items, screens) that use them
have not been ruled out of a Megamix fight.

The other set 1 slots (pages 0, 1, 2, 4, 5, 7, 8, 9, 10, 13, 14, 17)
carry Sonic, Honey or Eggman.

All page-list entries above are in set 1's list at main_data `0xB00010`
(count word, then one u32 per page from `0xB00014`). Their origins come
from the destination list at `0x30053C`.

## Can Akira's pages go in by pointer changes alone? No

A page-list entry holds only the page data's address. Where the page
lands is set by the origin word in the destination list. Where a face
samples is set by its material record (th2 bits 0–10: the tile's x and y,
bit 12: the sheet), not by its UVs. Akira's material records name VF2's
places, and those are StF set 1's pages 1–15:

| Akira's VF2 page | page data (VF2 main_data) | lands on | StF set 1 page there |
|--|--|--|--|
| 40:0–3 | `0x7A2F24`, `0x7A2F50`, `0x7A3040`, `0x7A6EA8` | (768, 0 / 256 / 512 / 768) | 12, 13, 14, 15 |
| 1:0–1 | `0xB00030`, `0xB0AAC0` | (0, 256 / 512) | 1, 2 |
| 1:2 | `0xB15550`, 256×64 | (0, 768), top 64 rows | 3 |
| 2:0 | `0xB18028`, 256×192 | (0, 832), the rest of that slot | 3 |
| 2:1–4 | `0xB1B340` … `0xB20C70` | (256, 0 / 256 / 512 / 768) | 4, 5, 6, 7 |
| 2:5–8 | `0xB2413C` … `0xB24C64` | (512, 0 / 256 / 512 / 768) | 8, 9, 10, 11 |

(y is within sheet 1.)

His 16 pages need 15 slots. Repointing an entry uploads his page where
StF's page was, which is the overwrite already ruled out. Leaving the
entries alone and adding his pages anywhere else puts them where his
faces don't look. So **none of his 16 pages fits by pointer changes
only**.

- With the material records left alone, 6 of his 16 pages land on a
  slot no Megamix StF fighter samples: 40:0 (page 12), 40:3 (page 15),
  2:3 (page 6), 2:8 (page 11), and 1:2 with 2:0 (both on page 3). Even
  those slots are still sampled by other fighters or unnamed models, and
  putting him there still means repointing set 1's entries (an overwrite).
- Moving him elsewhere means changing the tile field in each of his
  material records (th2 bits 0–10), which is not a UV change but is not
  a pointer change either. Even then, sheet 1 has at most 12 slots no
  Megamix StF fighter samples, against the 15 he needs, and none of them
  is proven unused.

His page data itself has room: ~168 KB fits in the 2.6 MB 0xFF run at
main_data `0xD6F1AE`. Texture RAM is what is short, not ROM.

## A repacked set 1: what a fight draws

The alternative to finding free pages is to build a new set 1: keep only
the tiles a Megamix fight needs, pack Akira's beside them, and repoint the
tile field (th2) of every material record whose tile moved. This section
is step 1: which StF models a fight actually draws.

`tools/mame/fight-models.lua` logs every model-table entry the i960 reads
(main_data `0xE0004 + id*16`) under the game's mode (`0x50002A`). Mode 9 is
the fight scene: intro, rounds, K.O. and stage clear. It ran on the shared
MAME 28 times: P1 forced to Sonic, Honey and Eggman, each on the nine arena
stages (0–7, 9), 6000 frames of mashing each, plus one unforced Sonic run.
Every run reached the fight (≈3800–4400 frames in mode 9, sub 9).
The list of model ids is in `docs/data/stf-fight-models.txt`.

1053 models were read in mode 9: the cast, 53 models of other fighters
(the CPU opponents), 259 stage models and 662 unnamed ones. 224 of the
unnamed ones sample sheet 1.

In 32×32 tiles of sheet 1 (24 slots × 64 = 1536):

| what has to stay | tiles |
|--|--|
| Sonic, Honey, Eggman: every part and face, P1 and P2, drawn or not | 469 |
| unnamed models a fight drew (HUD, effects, items) | 332 more |
| stage models a fight drew | 0 (they are all on sheet 0) |
| **kept** | **637** |
| **free after a repack** | **899** |

Kept tiles per set 1 slot (of 64; `--` is the mip area):

```
  40   64   40    0    0    0   16   64
  45   64   28   16   20    0    0   32
  64   16   32   16   --   --   --   --
   0   64   16    0   --   --   --   --
```

Seven slots hold nothing a fight draws: (768, 0), (1024, 0), (1280, 0),
(1280, 256), (1536, 256), (0, 768) and (768, 768), i.e. set 1 pages 12, 16,
18, 19, 21, 3 and 15. That is 448 tiles, enough for Akira's 266. Packing
him into those seven pages would leave every StF page and material record
alone: only his own (copied) material records get new tile fields.

What the guests need, in the same units (union over each game's three,
since they share tiles):

| guests | tiles |
|--|--|
| Akira (VF2) | 262 (266 with his item 2442) |
| Akira, Sarah, Kage (VF2) | 363 |
| Picky, Honey, Mahler (FV) | 563 |
| all six | 926 |

So Akira fits in a repacked set 1 with room to spare. All six guests
are 27 tiles over, before packing losses. The unnamed 332 still include
some opponent-only effects (e.g. models 818–826, 859, 860, 938, 939 were
drawn in only 3 of 28 runs), and sheet 0 is per-stage art that has not been
measured for slack.

Limits of the measurement: it sees only draws that go through the model
table. Meshes the game builds in polygon RAM, or draws by a mesh pointer
it kept, are not counted. Attract and select screens (modes 0–8) are not
part of a fight and were left out. They still need the old set 1, which
stays in ROM.

## Akira packed into the seven pages

`node tools/pack-akira.mjs` builds this and checks it in memory (`--out DIR`
writes the two patch blobs). No ROM file was changed. No StF page, page-list
entry, model or material record is touched: the only bytes that change are
in two runs of 0xFF.

How it is packed:

- His 49 distinct tiles (266 cells of 32×32) keep their power-of-two
  sizes and stay on the 32-pixel grid. Two of them overlap in VF2, (256, 864)
  128×32 and (288, 864) 32×32, so they move together. That leaves 48 groups.
- The seven pages are uncompressed (type 1, header `FF FF 0A`, texels at +16)
  and 256×256. Each holds levels 0–4, 0xAA90 bytes per page. Cells nothing
  was packed into are 0.
- Mip levels 5–9 of these pages are not in a raw page, so the board keeps
  whatever was there before: 134 halfwords over the seven slots. That only
  matters for a face drawn smaller than 1/32 of its tile.

### main_data (empty run from 0xD6F1AE)

| page | slot on sheet 1 | page data | copy-list entry | value |
|--|--|--|--|--|
| 3 | (0, 768) | 0xD6F1B0 | 0xDB9BB0 | 0x02D6F1B0 |
| 12 | (768, 0) | 0xD79C40 | 0xDB9BD4 | 0x02D79C40 |
| 15 | (768, 768) | 0xD846D0 | 0xDB9BE0 | 0x02D846D0 |
| 16 | (1024, 0) | 0xD8F160 | 0xDB9BE4 | 0x02D8F160 |
| 18 | (1280, 0) | 0xD99BF0 | 0xDB9BEC | 0x02D99BF0 |
| 19 | (1280, 256) | 0xDA4680 | 0xDB9BF0 | 0x02DA4680 |
| 21 | (1536, 256) | 0xDAF110 | 0xDB9BF8 | 0x02DAF110 |

- The copy of set 1's page list is at 0xDB9BA0..0xDB9C04: listIdx 0, then
  24 pointers. The other 17 entries are the same as the live list at
  0xB00010. Its address as a pointer is 0x02DB9BA0.
- Pages 19 and 21 came out empty, since Akira needed only 4.2 of the 7 pages.
  Their entries still point at new, all-zero pages, as asked, so the copy
  draws no StF texels from any of the seven.
- A fight reaches the copy through a copy of the set table; see
  "Pointing set 1 at the copy" below.

### Pointing set 1 at the copy (data only)

Set 1's page list is found through data, not code. The program names only
the header word that holds the set table's address:

| prog | instruction | does |
|--|--|--|
| `0x4A988`..`0x4A994` | `mov 1,g0` … `call 0x4AAE4` | send_tex_default: `send_tex_rob(1, 0, 0)` queues set 1 |
| `0x4AFD0` | `ld 0x230000C,r4` | TEX_HEADER+0x0C: the set table's address (data) |
| `0x4AFD8` | `ld (r4)[r3*4],r10` | the set's page-list pointer (r3 = set number) |
| `0x4B0CC` | | each page pointer, read from that list |

`0x0230000C` is the only reference to the header word in the program ROM.
`0x02B00010` is held only at main_data `0x300DB4`, set 1's entry in the set
table at `0x300DB0`.

Set 1 is uploaded once, at boot, and nothing uploads it again. In a MAME run
(boot, attract, select, then a fight on stage 0), the set table is read 4
times: set 1 at frame 6 (boot), set 2 at frame 36, set 16 for attract, and set 2 for the
fight's stage (frame 752). A fight never reads set 1's list. Its sheet 1 holds
what the boot upload put there. So the edit can't apply to fights only.
It also changes the seven slots on the attract and select screens, which
were not checked.

The edit (made by `tools/pack-akira.mjs`, in memory; `--out` writes the bytes):

| where | old | new |
|--|--|--|
| main_data `0x30000C` (TEX_HEADER+0x0C) | `0x02300DB0` | `0x02DB9C10` |
| main_data `0xDB9C10..0xDB9C58`, empty run | 0xFF fill | copy of the 18 set-table words; entry 1 (`0xDB9C14`) = `0x02DB9BA0`, the other 17 the same as `0x300DB0` |

The live set table at `0x300DB0` and the live list at `0xB00010` stay as they
are. One word outside the empty runs changes: the header word. Changing
`0x300DB4` itself (`0x02B00010` → `0x02DB9BA0`) would have the same effect
without the table copy. No instruction changes.

Checked in MAME (shared build, `sfight`), with the patch bytes written into
the `main_data` and `textures` regions before boot:

- Frame 6: `0x4AFD0` reads `0x02DB9C10`, `0x4AFD8` reads `0x02DB9BA0`, and
  `0x4B0CC` reads the 24 entries of the copy. Among them are the seven new
  pages, `0x02D6F1B0`, `0x02D79C40`, `0x02D846D0`, `0x02D8F160`, `0x02D99BF0`,
  `0x02DA4680` and `0x02DAF110`, and their bytes are then read. The live list
  at `0xB00010` is not read at all.
- Texture RAM at frame 2500, in the fight (stage 0), compared with an
  unpatched run of the same inputs: the seven slots' levels 0–4 are exactly
  what was packed (152,768 halfwords, 141,221 of them changed). Nothing
  outside the seven slots differs. Inside them, only the 134 level 5–9
  halfwords above differ.

### Where his tiles went

VF2 positions are sheet 1, (x, y); "→" is the new position on StF sheet 1.

- **Page 3:** 128×128 (0,256)→(0,768); (128,256)→(128,768); (0,384)→(0,896); (0,896)→(128,896).
- **Page 12:**
  - 128×128 (128,896)→(768,0)
  - 64×128 (192,384)→(896,0); (256,384)→(960,0); (0,512)→(768,128); (256,512)→(960,128)
  - 128×64 (128,512)→(832,128)
  - 64×64 (256,256)→(832,192); (192,576)→(896,192)
- **Page 15:**
  - 64×128 (320,512)→(768,768); (384,512)→(832,768); (448,512)→(896,768); (256,640)→(960,768); (320,640)→(768,896); (320,896)→(832,896)
  - 64×64 (0,768)→(896,896); (64,768)→(960,896); (128,768)→(896,960); (256,768)→(960,960)
- **Page 16:**
  - 64×64 (0,832)→(1024,0); (64,832)→(1088,0); (128,832)→(1152,0); (192,832)→(1216,0); (384,832)→(1152,64); (448,832)→(1216,64); (448,896)→(1088,128); (448,960)→(1152,128)
  - 128×32 (256,832)→(1024,64)
  - 128×32 (256,864)→(1024,96), moved together with 32×32 (288,864)→(1056,96)
  - 32×128 (384,896)→(1024,128); (416,896)→(1056,128)
  - 64×32 (128,384)→(1216,128); (128,416)→(1216,160); (128,448)→(1088,192); (384,704)→(1088,224)
  - 32×64 (64,512)→(1152,192); (416,640)→(1184,192); (448,640)→(1216,192); (384,768)→(1248,192)
- **Page 18:** 64×32 (384,736)→(1280,0); (320,768)→(1344,0); (448,768)→(1408,0); (320,800)→(1472,0); 32×32 (384,640)→(1280,32); (384,672)→(1312,32).
- **Pages 19 and 21:** nothing.

### Material records and UVs (textures region, empty run from 0x78BDB8)

Material and UV pointers are halfword indices into the textures ROM, not
into main_data, so these cannot go in the 0xD6F1AE run. They use
0x78BDC0..0x792E70 (28.8 KB) of the 0xFF run that ends at 0x800000.

- Each model's material bytes are copied as VF2 has them, with th2 bits
  0–10 (tile x/32, y/32) set to the new place. The sheet bit, the
  microtexture bits and th0/th1/th3 are left as they were.
- The UV bytes are copied unchanged.

| model | material at | matPtr | uvPtr |
|--|--|--|--|
| 407 | 0x78BDC0 | 0x3C5EE0 | 0x3C5FE0 |
| 408 | 0x78C380 | 0x3C61C0 | 0x3C62C0 |
| 409 | 0x78C940 | 0x3C64A0 | — |
| 410 | 0x78C950 | 0x3C64A8 | 0x3C65A0 |
| 411 | 0x78CF40 | 0x3C67A0 | 0x3C6898 |
| 412 | 0x78D530 | 0x3C6A98 | 0x3C6F08 |
| 413 | 0x78F120 | 0x3C7890 | 0x3C79A0 |
| 414 | 0x78F770 | 0x3C7BB8 | 0x3C7CC8 |
| 416 | 0x78FDD0 | 0x3C7EE8 | 0x3C7F88 |
| 417 | 0x790190 | 0x3C80C8 | 0x3C8168 |
| 419 | 0x790550 | 0x3C82A8 | — |
| 420 | 0x7908D0 | 0x3C8468 | — |
| 421 | 0x790C50 | 0x3C8628 | 0x3C86E8 |
| 422 | 0x7910D0 | 0x3C8868 | 0x3C8928 |
| 2452 | 0x791550 | 0x3C8AA8 | 0x3C8BC8 |
| 2454 | 0x791CB0 | 0x3C8E58 | 0x3C9048 |
| 2442 | 0x7928E0 | 0x3C9470 | 0x3C9558 |

Models 409, 419 and 420 have no textured faces, so they read no UVs. Their
uvPtr is left 0.

Not placed yet: his meshes (VF2 polygon ROM) and model-table entries that
would name these pointers. The free polygon-ROM run at 0xEC2578 is where the
meshes would go.

### What was checked (in memory)

- main_data and textures differ from StF's only inside the two runs, and
  main_data in the header word `0x30000C`.
- Set 1 was walked through the patched header and compared with the live
  set 1:
  - nothing differs outside the seven slots;
  - inside them, levels 0–4 are exactly what was packed;
  - levels 5–9 are the 134 halfwords above.
- Each of Akira's 17 models was decoded from its VF2 mesh, using the copied
  material and UV pointers against the patched StF. All 1963 textured faces
  have the same tile sizes and UVs as in VF2. Every texel at levels 0–4 of
  every face's tile matches VF2's texture RAM (sets 40, 1, 2), and every
  tile lies inside one of the seven pages.
