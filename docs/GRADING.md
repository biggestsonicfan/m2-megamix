# Grading the board against its source games

A battle is played twice: in a source game (Sonic the Fighters, VF2, FV,
in MAME) and on the board build, with the same fighters, stage, clock,
rounds and inputs. Both runs are logged frame by frame, and the logs are
compared. Where the board's battle turns out differently, the first frame
the two part says where to look.

## Running a battle

`tools/mame/battle.lua` is a MAME autoboot script. It sets the fight up,
plays a seeded input script from each round's start (both games get the
same script: its own LCG, not MAME's), and logs both fighters every frame.
Its header lists the variables and the log's format.

```bash
# the source: Sonic vs Honey on South Island
BT_GAME=stf BT_P1=0 BT_P2=15 BT_STAGE=0 BT_SEED=1 BT_FRAMES=30000 BT_OUT=trace.txt \
  mame sfight -rompath $ROMS_DIR -video none -sound none -nothrottle -skip_gameinfo \
  -autoboot_script tools/mame/battle.lua
# the board: the same fight, set on its menu
BT_GAME=board BT_MENU=30,2,0,0,1,140,5 BT_MAP=<build>/game.map BT_SEED=1 BT_FRAMES=30000 \
  BT_OUT=trace.txt mame sfight -rompath "board/roms;$ROMS_DIR" ...
node tools/grade-battle.mjs <source>/trace.txt <board>/trace.txt
```

Give each run its own directory and its own `-cfg_directory`,
`-nvram_directory` and `-snapshot_directory`.

- StF's characters: Sonic 0, Eggman 8, Honey 15. Its stages: South Island
  0, Aurora Icefield 2 (`levels_in_order`).
- The board's menu indices: fighters SONIC 0, HONEY 1, EGGMAN 2, AKIRA 3,
  RYO 4, CHAI 5, HORNET 6, MAHLER 7; stages South Island 0, Aurora 1,
  Tou-rin 2, Colosseum 3, FV Western 4.
- StF needs two coins in the attract and both Starts some frames apart, or
  one side starts against the CPU. Honey is hidden (Start on Amy); the
  script forces both characters with write taps on the robs' +0x1B0
  instead, and the stage on `stage_num` (0x500064).
- VF2 (`vf2`, Version 2.1): Akira 0; stages 0 Akira's (the board's
  Tou-rin), 1 the Colosseum. Run it on an empty `-nvram_directory`: it
  keeps credits there. Energy 220; both fighters start at x ±1, the same
  every round.
- FV (`fvipers`, Revision D): Mahler 8; stage 0 Western. Energy 280. Round
  1 starts at x ±1, and every round after it a quarter turn on (round 2
  at z ±1).
- The board's menu is driven by what it shows (`menu_cur`, `menu_val`,
  from `BT_MAP`): one press at a time, the next once the last took. A
  pass that loads a stage or a fighter runs many frames and eats presses
  made blind. A value the menu can't show (energy above 250) stops the
  run after 400 presses.

## The board, by replay

The input script plays the same presses in both games, but what a press
does depends on the fight so far, so a small difference grows. The board
is graded by replay instead: the battle is played in its source game and
recorded (`BT_RECORD=<file>`: both pads, every frame from the round's
start), and the recording is played on the board (`BT_REPLAY=<file>`) in
place of the script. With the same fight on both, the first frame they
part is the board's own difference.

```bash
tools/mame/board-replays.sh <outdir> <board build dir> [jobs file]
```

plays every pairing of the board's fighters that a source game has (StF's
Sonic, Honey and Eggman on South Island and Aurora; Akira on VF2's
Tou-rin, Colosseum and Test stage; Mahler on FV's Western), three MAMEs
at a time, and grades each (`<outdir>/<name>/grade.txt`). A job is a line
`<name> <game> <p1> <p2> <stage> <board menu>`. The board's energy is
StF's 140 for StF and Akira (his jab takes 18 of VF2's 220 and 11-12 of
the board's 140), 250 for Mahler (13 of FV's 280 and 11-12 of 250):
Mahler's damage is about 0.88 of FV's, not StF's bar's share. The board
draws the guests and their stages at StF's size (VF2's 2.027, FV's
2.044), and the grader takes its places back to the source's units.

## What is graded

`tools/grade-battle.mjs`, round by round:

- **sync**: the first frame the fights part (a fighter's motion differs,
  or his place by more than 0.05), as a share of the round. Places are
  taken in the round's own frame (from the fighters' midpoint, the x axis
  through 2P), and the frame offset of -4..4 that keeps the fights together
  longest is used.
- **motions**: each fighter's run of motions, how much of the source's the
  board plays in order (LCS).
- **hits**: every energy drop by frame, fighter and amount, matched in
  order; half for the hit, half for the same damage.
- **end**: the winner (half), the frame it ends on and the energy left.

A guest (Akira, Mahler) plays his own game's motions under the board's
new ids (from 519 on); `board/roms/guests.json`'s `motionIds` maps them
back. Against VF2 or FV the board's energy differs (the menu goes to
250), so damage and the energy left are scaled by the two energies, and
the energy is not a setup penalty.

Total: 0.2 sync + 0.3 motions + 0.3 hits + 0.2 end, less 10 for every
setup field that differs. A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, else F.

## Sampling a frame

StF's frame can run past MAME's vblank, so a read at `frame_done` can land
between rob0's task and rob1's. The script snapshots both fighters when
the clock (`game_timer`, 0x500028) is written instead: `game_disp` counts
it down once a frame, after the last frame's fighter tasks and before this
frame's.

## Results

By replay (board-replays.sh), seed 1, the board at energy 140 and
barrier 5, StF's pairings of Sonic,
Honey and Eggman (1P, 2P) on South Island and Aurora Icefield:

| 1P, 2P     | Sonic       | Honey       | Eggman      |
|------------|-------------|-------------|-------------|
| **South Island** |       |             |             |
| Sonic      | 99 A        | 100 A       | 99 A        |
| Honey      | 100 A       | 100 A       | 100 A       |
| Eggman     | 100 A       | 99 A        | 100 A       |
| **Aurora** |             |             |             |
| Sonic      | MAME stops  | MAME stops  | 99 A        |
| Honey      | 100 A       | 100 A       | 100 A       |
| Eggman     | 100 A       | 99 A        | 100 A       |

The guests, against their own games: Akira vs Akira 32 F on Tou-rin, the
Colosseum and the Test stage (the fights are the same on all three: no
ring edge comes in), Mahler vs Mahler on Western (FV) 37 F (below).

## What the grading found

Sonic vs Honey on South Island went from D (44) to A (100):

- **Task order.** The board ran the fighters before the hit check, so
  every hit landed a frame early. `fight_step` now runs StF's tasks in its
  own order, read off a real fight: coli, game_info, the camera, the clock,
  effect, the pads, the recorder, rob0, rob1.
- **Knockback.** No hit pushed anyone: the hit vector scales by
  `list_90_floats_RAM` (0x50A800), which `game_engine_setup`'s `sub_2E2B0`
  copies from ROM, and the board left it 0. It is seeded now, with
  `lau_mul_J` and `lau_add_xang`.
- **Turning.** Honey turned to face Sonic every frame on the board but not
  in StF: `get_en_info` updates the angle to the enemy only past
  `en_ang_dist` (0.6), which the board left 0. The rest of
  `game_engine_setup`'s constants are seeded with it.

- **Start places.** The board started every stage's fighters at StF's
  places and angle. On a VF2 stage they now start at VF2's (±1, the same
  every round), on FV's Western at FV's (a quarter turn on each round),
  in the guests' units: ±1 × VF2's (or FV's) size on the board.

- **The last blow.** A round's KO blow can land on the frame the board
  judges it, which it logs no frame of; the grader takes it from the end
  line's energy.

Left as they are:

The guests, by replay (Akira from 28 F by script to 32 F, Mahler from 21
F to 37 F):

- **No trade lockout.** StF's `coli_attack_chk` keeps a fighter whose
  strike just landed from being hit back for a while (+0x2AC); VF2 and FV
  have no such lockout, and two guests' jabs trade. It is skipped when
  both fighters are guests (`loc_2A6B8`, tools/lift-stf.py).
- **The push between bodies.** `coli_recalc_pos` keeps two bodies 0.3
  apart and caps the push at 0.3 a frame, in StF's units; for two guests
  of one game it is in theirs now (`loc_2D7B0`, `loc_2D7E0`): VF2's
  factor is always 0.3 × its size and has no cap, FV's are StF's × its
  size.
- **The reach guards.** The guests' command programs went over with
  their `nearer_than`/`further_than` distances (ops 0x1A, 0x1B) in their
  own units, against a distance the board measures at their size: Mahler
  took his far jab (FV 672) where FV takes the near one (671). They are
  scaled now (`reachAt`, tools/vf2-guest.mjs), and his first punch is
  FV's, on FV's frame.

Left as they are:

- **The guests' push, still.** The fights part on the first jab's contact
  (Akira frame 40, Mahler 39). The overlap the COP returns (g4) is where:
  on Akira's frame 39 the board's matches VF2's (0.1169 VF2 units; the
  largest ball pair's overlap, balls 6 and 6), but on frame 40 VF2's is
  0.2233 and the board's (StF's SHARC program) 0.0834, with the same
  contact vector. The arms have crossed by then, and VF2's 0.2233 is
  neither the largest pair's overlap (0.0932) nor their sum (0.4557):
  VF2's COP is a TGP program of its own, whose rule for it is not known.
  Its masks (+0x264/0x268, the balls' C0/C4) are VF2's, and the strike's
  balls sent or not make no difference. Mahler parts the same way (frame
  39: the board has pushed him 0.040 FV units, FV 0.014).
- Honey's intro pose: StF's motion 15, the board's 507.
- The board's rounds end 4 or 5 frames before StF's (the winner and the
  energy left are the same).
- Sonic vs Sonic and Sonic vs Honey on Aurora stop MAME, always on the
  same frame of round 1 (501; 1092), whatever the fight did up to it:
  `geo_adsp` (the shared build's Model 2B geometrizer, its own SHARC
  program) runs off into garbage (`invalid single-function operation 03`,
  `multi-function opcode 16 not implemented`, `SET_UREG: unknown register
  63`). The frame's FIFO words are as every frame's (606 of them, laid out
  the same); StF's own runs of the pairings don't stop it. Repro:
  `BT_MENU=30,2,1,0,0,140,5 BT_SEED=1`.

## The browser build, every record

The board plays eight fighters; the browser build (`js/`) plays every
fighter record of the three games, so every one of them is graded there,
against itself in its own game. `tools/js-battle.mjs` plays a battle on
`js/engine.js` with battle.lua's input script and writes battle.lua's log
(`setup js`); the grader takes it as the board's. The engine runs one
energy bar (200) for every game, so damage and the energy left are scaled
by the two bars, as for a guest. It fights on the game's arena: the stage
number is only logged.

```bash
tools/mame/roster-battles.sh <dir>       # the source battles, 3 MAMEs at a time
node tools/grade-roster.mjs <dir>        # each one played on the browser build, and graded
```

Seed 1, 30 seconds, 2 rounds to win; every record against himself on
stage 0:

| game | record | total | motions | hits | end | first split (round 1) |
|------|--------|-------|---------|------|-----|-----------------------|
| vf2 | 0 Akira | 19 F | 33 | 28 | 3 | 34: 1P's motion 18 vs 17 |
| vf2 | 1 Jacky | 11 F | 19 | 17 | 0 | 34: 1P's motion 271 vs 270 |
| vf2 | 2 Sarah | 26 F | 39 | 33 | 24 | 34: 1P's motion 505 vs 504 |
| vf2 | 3 Kage | 11 F | 22 | 14 | 0 | 34: 1P's motion 330 vs 329 |
| vf2 | 4 Lau | 15 F | 26 | 23 | 0 | 34: 1P's motion 694 vs 693 |
| vf2 | 5 Jeffry | 20 F | 21 | 11 | 54 | 34: 1P's motion 915 vs 914 |
| vf2 | 6 Pai | 26 F | 29 | 12 | 68 | 34: 1P's motion 400 vs 399 |
| vf2 | 7 Wolf | 13 F | 26 | 16 | 0 | 34: 1P's motion 956 vs 955 |
| vf2 | 8 Shun | 11 F | 22 | 10 | 8 | 34: 1P's motion 655 vs 654 |
| vf2 | 9 Dural | 24 F | 28 | 18 | 50 | 34: 1P's motion 330 vs 329 |
| vf2 | 10 Lion | 19 F | 13 | 18 | 50 | 34: 1P's motion 849 vs 848 |
| vf2 | 11 Mue | 22 F | 35 | 22 | 25 | 34: 1P's motion 18 vs 17 |
| vf2 | 12 Kojacky | 22 F | 35 | 22 | 25 | 34: 1P's motion 18 vs 17 |
| fv | 0 Jane | 10 F | 27 | 7 | 0 | 34: 1P's motion 674 vs 670 |
| fv | 1 Grace | 24 F | 20 | 24 | 55 | 34: 1P's motion 673 vs 670 |
| fv | 2 Honey | 5 F | 23 | 20 | 10 | 34: 1P's motion 674 vs 670 |
| fv | 3 Tokio | 26 F | 27 | 11 | 73 | 34: 1P's motion 671 vs 670 |
| fv | 4 Bahn | 14 F | 27 | 10 | 15 | 34: 1P's motion 846 vs 845 |
| fv | 5 Picky | 22 F | 24 | 9 | 61 | 43: 1P's place off by 0.086 |
| fv | 6 Raxel | 10 F | 25 | 8 | 0 | 34: 1P's motion 671 vs 670 |
| fv | 7 Sanman | 35 F | 34 | 23 | 87 | 34: 1P's motion 671 vs 670 |
| fv | 8 Mahler | 12 F | 23 | 8 | 12 | 34: 1P's motion 671 vs 670 |
| fv | 9 B.M. | 9 F | 24 | 7 | 0 | 34: 1P's motion 671 vs 670 |
| fv | 10 Sonic | 12 F | 28 | 13 | 0 | 34: 1P's motion 850 vs 848 |
| fv | 11 dummy | 11 F | 28 | 7 | 2 | 34: 1P's motion 673 vs 670 |
| fv | 12 dummy | FV stops | | | | `I960: Unhandled 00` before the fight |
| stf | 0 Sonic | 23 F | 24 | 17 | 51 | start: x -1.99 vs -1.00 |
| stf | 1 Tails | 9 F | 21 | 8 | 0 | start |
| stf | 2 Amy | 11 F | 20 | 18 | 0 | start |
| stf | 3 Metal Sonic | 18 F | 28 | 17 | 20 | start |
| stf | 4 Fang | 10 F | 22 | 12 | 0 | start |
| stf | 5 Bark | 24 F | 24 | 22 | 50 | start |
| stf | 6 Knuckles | 30 F | 32 | 17 | 76 | start |
| stf | 7 Espio | 25 F | 21 | 13 | 72 | start |
| stf | 8 Eggman | 28 F | 36 | 10 | 70 | start |
| stf | 9 Eggman B | 21 F | 38 | 17 | 24 | start |
| stf | 10 Bean | 16 F | 26 | 10 | 24 | start |
| stf | 11 Eggman (boss) | 25 F | 21 | 21 | 61 | start |
| stf | 12 Egg UFO | 13 F | 25 | 13 | 7 | start |
| stf | 13 Egg Minion | 23 F | 29 | 15 | 50 | start |
| stf | 14 Rocket Metal | 33 F | 33 | 18 | 87 | start |
| stf | 15 Honey | 20 F | 33 | 18 | 23 | start |
| stf | 16 Super Sonic | 7 F | 23 | 0 | 0 | start |

Sync is 0 in every one: they part on the script's first press. The
stages, each game's first fighter against himself: VF2's Akira on 1-11,
19 F on each but 10 (29 F: VF2's round runs 3076 frames there, past its
clock); FV's Mahler on 1-8, 12 F on each; StF's Sonic on 1-9, 23 F on
each. The source fights the same on its stages until a wall or the ring's
edge comes in, and the browser build fights every stage of a game alike.

What parts them:

- **VF2: the reach guard.** Every VF2 record's first jab is the motion
  after the one VF2 plays. A jab has two entries in the command table, the
  first guarded `further_than 1.5`; the engine measures the two fighters
  2.0 apart at the start, so it takes the far jab, where VF2 takes the near
  one. With the guard read 0.6 nearer (the fighters' bodies, by the look of
  it), Lau vs Lau stays together until the jab lands on frame 40: VF2's
  jab hits 2P there (motion 258), the browser build's does not.
- **The press comes late.** VF2 starts the jab the frame after it sees
  the button; the browser build three frames after (its two frames'
  wait for a chord, `CHORD`). The grader's offset hides one frame of it.
- **FV: further off.** The first jab is 1 to 4 motions off (670 against
  671-674): more than VF2's one guard is choosing there.
- **StF: the start.** StF starts its fighters 4 apart (±1.99 on the
  round's axis, turned 45° on the stage); the browser build starts every
  game's at ±1, VF2's places. Everything after that differs.
- **The bar.** The engine's bar is 200 for every game, but VF2's and FV's
  damage are their own (VF2's bar is 220, FV's 280): a VF2 or FV fighter
  goes down in fewer blows than in his game.
- FV's Honey's battle runs 5 rounds in FV: two of them stop with
  `also_sub_mode` 23 and no winner.
