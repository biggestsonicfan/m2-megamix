# Projectiles

Eggman's bomb is a projectile: an object of its own that flies, lands and
explodes, apart from his body's collision balls. The board build runs StF's
own fight code, so the projectile can come from StF's code too. This note
traces the code from stfdisasm (addresses are StF's), lists Eggman's data
(`tools/survey/stf-projectiles.mjs` reads it from `sfight.zip`), says what damage a
bomb does and when a guard stops it, and lists what the board needs to run it.
Eggman's bomb runs on the board (#1601): StF's step loop and the bomb's
steps are lifted, the board (`effects.c`) runs them each frame and draws the bomb, its
fuse, its landing marker and its burst. See Checks for what was tested.

## StF's path

| step | routine | what it does |
|--|--|--|
| throw | play op 0x23, `call_projectile_routine` (0x1C8D8, 0x1C bytes) | calls `projectile_main_routine` on the frame the op names |
| make | `projectile_main_routine` (0x89FD4) | takes the first free one of 30 objects (0x100 bytes each, from `mod_fa_tobi`+0x200) and fills it from the op and the motion's strike |
| start | the type's record (`projectile_list`, 0xB46AC; `projectile_I_list`, 0xB472C, for a player 2 whose 1B1 differs from 1B0), word 0 | the object's first step, e.g. the bomb's `loc_8D1C4` |
| each frame | `fa_tobi`'s task, `sub_89FB8`: `sub_8A29C` | calls each live object's step (+8), counts its frames (+0x28) |
| | `sub_8A2E4` | tells `mod_fa_enemy0/1` (StF's CPU players) where a bomb will burst |
| hit test | `sub_8AE48` (0x8AE48), called by the step | coprocessor op 0x3B807777: the object's place (+0x44) and radius (+0x6C) against both fighters' balls; +0x38 the thrower's hit, +0x3C the other's |
| hit | `collision` → `sub_2BEF4` (0x2BEF4) | for each object with bit 31 and bit 1: `loc_2C004` on the other fighter if +0x3C, and on the thrower too if bit 4 and +0x38 |
| damage | `loc_2C004` … `loc_2C780` | guard or hit, reaction, push, then `damage_calculation` |
| drawn | `tobi_disp` (0x8A518), `_uk_projectile` by type | the bomb's `tdl_bakudan`: the bomb (`tobi_disp_go`, `set_obj`) and its landing marker |

`sub_2BEF4` only walks the objects in also_mode 8 or 9 with also_sub_mode 9
(and 0x10, 0x11, 8 are left out). The board's globals are mode 9, sub-mode 9,
so it walks them. With `mod_fa_coli`+0 bit 31 clear it only marks the object
hit (`sub_2C7B4`); the board sets that bit.

## The object

What `projectile_main_routine` copies (op bytes after the 0x23, the frame
word and the type byte):

| object | from | meaning |
|--|--|--|
| +0x0 | op +4..7, with bit 31 | flags (below) |
| +0x26 | op +3 | type |
| +0x8F | op +8 (through `byte_B5248` when rob bit 6) | the thrower's ball it starts at (coprocessor op 0x1B003636 → +0x44) |
| +0x89, +0xA2 | op +9 | flight frames (and the count down) |
| +0x90 | op +0xC, float | radius when it bursts (→ +0x6C) |
| +0x94, +0x98 | op +0x10, +0x14, floats | where it aims: this far beside and ahead of its target, by the target's turn |
| +0x8E | strike +2 | level (0 high, 1 mid, 4 hits a fighter lying down) |
| +0x24 | strike +3 | damage (a quarter of it while rob+0 bit 18 and rob+0xC7C < 640) |
| +0xD | strike +4 | stun (+0xA6) |
| +0x7E | strike +7..8 | reaction: low byte the `uk_hit_motions` row, bit 9 no guard, bit 14 knocks down |
| +0x88 | strike +9 | hit sound list |
| +0x25 | strike +0xA | the push record at 0x50A800 + 0x28 × it |
| +0x1C, +0x20 | | the thrower; its opponent (the target) |
| +0x72 | rob+0x26 | its heading |

Flags: bit 1 bursting (the frame the hit test counts), bit 4 can hit its
thrower, bit 5 has hit, bit 16 bursts where it lands, bit 18 no guard, bit 19
hits a fighter that rob+0x70C bit 25 would spare, bit 20 any guard stops it
(no facing test).

## Eggman's bomb

`node tools/survey/stf-projectiles.mjs` lists every motion. Eggman (character 8)
throws type 2, `bean_bomb_roll`:

| motion | command | bombs (flight frames, aim) | level | damage | stun |
|--|--|--|--|--|--|
| 297 | ff_punch | 3 at frame 27: 60 (0, 1), 70 (1.5, 0), 80 (−1.5, 0) | 4 | 10 each | 4 |
| 298 | fta_p | 1 at frame 13: 50 | 1 | 20 | 10 |
| 299 | fta_pp | 1 at frame 27: 20 | 1 | 20 | 10 |
| 300 | fta_ppp | 1 at frame 27: 60 | 1 | 20 | 5 |

All have flags 4, 16, 20 (297 also 19), radius 1.0, reaction 0x4009 and push
record 3. Bean (10) throws the same bomb (38, 356, 472) and a faster one (405).

The bomb (`loc_8D1C4`): it aims at the target's place plus the offset, no
farther than `stage_x` (3.0 while the thrower's 0x1A4 bit 22), and flies
there in an arc in its flight frames (gravity 0x50A000), with a fuse of 180
frames (+0x2E). Its steps (`off_8D3D8`): 0 flying, 1 rolling (only without
bit 16), 2 the burst. With bit 16 it bursts where it lands: bit 1 set, radius
from +0x90, `sub_8AE48`'s hit test. The next frame it clears bits 1 and 5 and
plays the burst, then frees itself.

Models: the bomb 1703 (flight, scale 0.91–1.09), the burst 807–810 (scale
24 to 8.8), the fuse 1710 and 1711, the landing marker 2200–2205. None is in
the board's data ROMs yet (`board/roms/assets.txt`).

## Damage and guard

`loc_2C004`, on the victim (g8) of a bursting bomb from g7:

1. No hit if: level 0 and the victim crouches (0x1A4 bit 3); level 1, the
   victim in the air (bit 4) and the thrower's 0x5B8 bit 9; the victim's 0x1A4
   bit 30, 18 or 19; the victim lying (bit 15 or 16) and the level is not 4.
   297 hits a fighter lying down; 298–300 do not.
2. Guard: the victim guards (0x1A4 bit 13), the flags have no bit 18, and
   either bit 20 or the bomb's heading is more than a quarter turn from the
   victim's (it comes at the front). Eggman's bombs have bit 20, so a guard
   stops them from any side. Then, without +0x7E bit 9: `sub_2B94C` with 0
   (the guard reaction, through `guest_ptr_DA0B4` as for a strike), stun
   +0xA6 − 4, damage 0 to `damage_calculation`: no energy is lost. The push
   (loc_2C694) still moves the victim.
3. Hit: the damage byte, halved on an ukemi (0x70C bit 2), −1/4 on a fighter
   down (0x1A4 bit 14 without 16), halved for level 8 on bit 16. The reaction
   (bit 14 of 0x4009: knocked down) from `uk_hit_motions` row 9 by
   `sub_2C7E4`, the push from record 3, then `damage_calculation` takes the
   damage off rob+0x1AC (out of 140) while the clock (0x500028) runs.

So an unguarded bomb takes 20 (298–300) or 10 a bomb (297) and knocks the
fighter down; a guarded one takes nothing. With bit 4 it hits Eggman too if
he stands in the burst.

`sub_2C7E4` picks the reaction from StF's shared `uk_hit_motions`, not the
victim's own list, so Akira would get StF's (then `motion_remap`). See
docs/BOARD.md, `sub_2C7E4`.

## What the board does

`tools/board/lift-stf.py` lifts it all with no new RAM (`stf_rom_80000.bin`
unchanged):

- STUBS: drop `call_projectile_routine`.
- ROOTS: add `sub_8A29C` (the step loop). Leave `sub_8A2E4` out: it writes to
  `mod_fa_enemy0/1`, which the board has no CPU players for (its pointers are 0).
- ROM_CODE_TABLES: `projectile_list`, `projectile_I_list`, `bean_bomb_roll`,
  `bean_bomb_roll_1` and `off_8D3D8` (the bomb's steps); and, for the stf
  lineup (docs/BOARD.md, Lineups), every other type's record
  (PROJECTILE_RECORDS) and their steps' jump tables (PROJECTILE_STEPS).
  Before #1921 those records still held StF's code addresses, and Fang's
  first cork (type 1) stopped the board ("I960: Unhandled 00").

On the board (`fighter.c` and `effects.c`):

1. `round_start` zeroes `stf_tobi` at each round's start, as `fa_tobi` does
   (and sends coprocessor op 0x81, `Fn_zanzou_init`).
2. `fight_step` runs `stf_task(stf_sub_8A29C, stf_tobi, robs[0], robs[1])`
   each frame, before `zanzou_control` (StF's own order in `fa_tobi`). The
   step sets the burst's hit balls; the next frame's collision task deals
   the damage, as in StF.
3. `tobi_draw` draws each live object (bit 31; not bit 9) by its type's
   routine (`_uk_projectile`):
   - `tobi_disp_go` (types 0, 1, 4–6, 12–14, 16): its model (+0x7C) at
     +0x44, turned by +0x72, +0x70, +0x74 unless bit 7 or 3, scaled by
     +0x68. `tdl_otoshi2` (17) is the same, always turned.
   - `tdl_bakudan` (2, 3, 7–9): that, and the bomb's marker at +0x50 and its fuse.
   - `tdl_bero` (11) and `tdl_berotsukami` (15), Espio's tongue: model 954
     from its root (+0xA8, or +0x44 once it has caught), turned by y then x
     (+0xCA, +0xC8 or +0x72, +0x70), stretched along z to its length (+0xC4
     or +0xB4); and the tip, 955, at its end (not while +0xC is 1).
   - `tdl_laser` (10, Metal Sonic's) is not drawn; no lineup has him.
4. `tools/board/import-assets.mjs` keeps the models of the types the lineup's
   fighters throw (THROWS: Eggman 2; Bean 2, 8; Fang 1, 4, 14; Amy 12, 13,
   16, 17 and `amy_drop_item_list`'s 11 things; Espio 11, 15 and models 954,
   955), from both lists' records, and the marker lists: for the default
   lineup models 1703, 807–810, 1710, 1711 and 2200–2205 and their textures.

## Checks

Done on MAME (`shared`, board ROMs), P1 Eggman against P2 Honey, standing:

- 298 (forward+punch): one bomb 12 frames in, bursts on her 50 frames
  later; 0x1AC 140 → 120, knocked down (motion 266). Snapshots show the
  bomb with its lit fuse, the marker going from green to red, and the burst.
- 298 with Honey holding guard: 0x1AC stays 140, guard reaction (109).
- 297 (forward, neutral, forward+punch): three bombs; 140 → 130 → 123 →
  115 (the second and third hit her while down, at StF's reduced rate).

#1921, the stf lineup, by replay snapshots: Fang's cork (753) in flight and
its burst, his spinning cork (1220), and Bean's bomb (1703) with its marker
draw. Espio's tongue and Amy's hammer and anvil are drawn by the code
above but were not seen in a snapshot.

Not checked yet: the guard from behind, Eggman in his own burst, the clock
at 0, and m2-hle2. The original list, each beside real StF on MAME:

- 298 at a Sonic who stands: Sonic's 0x1AC 140 → 120, knocked down.
- The same with Sonic holding guard: 0x1AC stays 140, guard reaction, pushed.
- The same from behind him: still guarded (bit 20).
- 297 on Sonic lying down: 10 a bomb; 298 on Sonic lying down: no hit.
- Eggman in his own burst: he loses the damage too (bit 4).
- With the clock at 0: no damage.
