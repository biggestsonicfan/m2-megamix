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

Seed 1, the board at energy 140 and barrier 5, StF's pairings of Sonic,
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

The guests, against their own games: Akira vs Akira on Tou-rin (VF2) 28 F,
Mahler vs Mahler on Western (FV) 21 F (below).

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
  places and angle. On a VF2 stage they now start at VF2's (half StF's
  distance, the same every round), on FV's Western at FV's (a quarter
  turn on each round).

- **The last blow.** A round's KO blow can land on the frame the board
  judges it, which it logs no frame of; the grader takes it from the end
  line's energy.

Left as they are:

- Honey's intro pose: StF's motion 15, the board's 507.
- The board's rounds end 4 or 5 frames before StF's (the winner and the
  energy left are the same).
- The guests part from their source a few frames into the first attack
  (Akira vs Akira on Tou-rin: frame 35; Mahler vs Mahler on Western: 38).
  Two Akiras jabbing at 2.0 apart slide apart about 0.15 a frame from the
  jab's second frame on the board; in VF2 they stand until the hit (frame
  39) and are pushed 0.17. A jab from 3.3 apart doesn't move him on the
  board, so it's StF's push between bodies, not the motion: it reaches
  further than VF2's (or FV's) for the guests' bodies. Graded F (VF2 28,
  FV 21) until it is fixed.
- Sonic vs Sonic and Sonic vs Honey on Aurora stop MAME, always on the
  same frame of round 1 (501; 1092), whatever the fight did up to it:
  `geo_adsp` (the shared build's Model 2B geometrizer, its own SHARC
  program) runs off into garbage (`invalid single-function operation 03`,
  `multi-function opcode 16 not implemented`, `SET_UREG: unknown register
  63`). The frame's FIFO words are as every frame's (606 of them, laid out
  the same); StF's own runs of the pairings don't stop it. Repro:
  `BT_MENU=30,2,1,0,0,140,5 BT_SEED=1`.
