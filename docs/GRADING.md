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
BT_GAME=board BT_MENU=30,2,0,0,1,140,5,0 BT_MAP=<build>/game.map BT_SEED=1 BT_FRAMES=30000 \
  BT_OUT=trace.txt mame sfight -rompath "board/roms;$ROMS_DIR" ...
node tools/grade/grade-battle.mjs <source>/trace.txt <board>/trace.txt
```

Give each run its own directory and its own `-cfg_directory`,
`-nvram_directory` and `-snapshot_directory`.

- StF's characters: Sonic 0, Eggman 8, Honey 15. Its stages: South Island
  0, Aurora Icefield 2 (`levels_in_order`).
- The board's menu indices: fighters SONIC 0, HONEY 1, EGGMAN 2, AKIRA 3,
  RYO 4, CHAI 5, HORNET 6, MAHLER 7; stages South Island 0, Aurora 1,
  Tou-rin 2, Colosseum 3, FV Western 4.
- The menu's last value is its FV armour (0 off, 1 on; the menu's own,
  on, when left out). A source with no armour (StF, VF2) is graded with
  it off, FV with it on (`tools/mame/board-replays.sh`): with it on, a
  StF strike of 30 or more breaks a damaged piece and the board plays
  FV's armour-break replay, a round its source never had.
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

Keep MAME's SHARC recompiler on (no `-nodrc`): the interpreter rounds
differently, and Mahler's round 1 then parts on frame 1378, not 1604.

## What is graded

`tools/grade/grade-battle.mjs`, round by round:

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
| Sonic      | 100 A       | 100 A       | 100 A       |
| Honey      | 100 A       | 100 A       | 100 A       |
| Eggman     | 100 A       | 100 A       | 100 A       |
| **Aurora** |             |             |             |
| Sonic      | 100 A       | 100 A       | 100 A       |
| Honey      | 100 A       | 100 A       | 100 A       |
| Eggman     | 100 A       | 100 A       | 100 A       |

The shared MAME is mainline (mamedev/mame 6df80b69e1e, 0.289). On the
fork's build, Sonic vs Sonic and Sonic vs Honey on Aurora stopped the
geometrizer (board frames 501 and 1093, "geo_adsp: compute: invalid
single-function operation 03"; below).

### The stf lineup

The stf lineup's build (docs/BOARD.md, Lineups), graded the same way
(`LINEUP=stf tools/mame/board-replays.sh`): each of Amy, Fang, Bark, Espio
and Bean (1P) against Sonic, Honey and Eggman and the other four, on South
Island, and the mirrors and each against Eggman on Aurora. The default
lineup's 22 fights, run again on the same source, are still 100 A.

| 1P, 2P | Sonic | Honey | Eggman | Amy | Fang | Bark | Espio | Bean |
|--------|-------|-------|--------|-----|------|------|-------|------|
| **South Island** | | | | | | | | |
| Amy    | 100 A | 100 A | 100 A | 100 A | 100 A | 100 A | 100 A | 100 A |
| Fang   | 100 A | 100 A | 100 A |       | 100 A | 91 A  | 100 A | 100 A |
| Bark   | 100 A | 100 A | 100 A |       |       | 100 A | 100 A | 100 A |
| Espio  | 100 A | 100 A | 100 A |       |       |       | 100 A | 100 A |
| Bean   | 100 A | 100 A | 100 A |       |       |       |       | 100 A |
| **Aurora** | | | | | | | | |
| Amy    |       |       | 100 A | 100 A |  |      |       |      |
| Fang   |       |       | 100 A |       | 100 A |     |       |      |
| Bark   |       |       | 100 A |       |       | 100 A |      |      |
| Espio  |       |       | 100 A |       |       |       | 100 A |     |
| Bean   |       |       | 100 A |       |       |       |       | 100 A |

What is left is the megamix's own, not the lift's (39 of 40 are 100 A):

- **Bark vs Espio and Bark vs Honey: the armour break.** On the board
  with FV armour on (the menu's default), every fighter wears FV's armour
  (200 and 75 for a non-FV fighter), and a StF strike of 30 or more breaks
  it (tools/board/lift-stf.py `ARMOUR_BREAK`). Bark's double kick (motion
  158, 35) does, and the board plays FV's armour-break replay (sub_mode
  22) with the clock going back with it: a round StF, which has no armour,
  never had. These two graded 62 C and 80 B so. StF's replays are now
  graded with the armour off (Running a battle), and both are 100 A.
- **Fang vs Bark (91): Fang's intro.** StF's round 1 starts with each
  fighter's intro, and Fang's leaves him at (-1.410, -1.410), not
  (-1.414, -1.414) (round 2 has none). The board plays no intros. It is
  one frame of Bark's kick landing later (frame 182) in this pairing only.

Bean's five fights went from 72..96 to 100 (below, the jump's setup).

### Aurora: the geometrizer's frame runs over

On Aurora Icefield the board's display list takes the geometrizer (MAME's
SHARC running StF's cpres2) about 0.9 of a frame, from its first FIFO read
to the END: about 140 objects a frame (the stage 76, the reflections 30,
the fighters 35). StF's own takes 0.6 to 0.75 of a frame, 35 to 94
objects. About round frame 450 StF's stage was 32 objects, the board's
76: StF's `ground_disp` puts the 16 ground chunks through `area_clip`
and draws 8 to 10 of them (none at that point), and `doom_cnt` draws 7 to
10 of the 16 backdrop-ring segments (model 1129); the board drew all 32,
and 6 cage panels to StF's 2. Now and then the board's list ran past the
vblank (Sonic vs Sonic: board frames 834, 842, 895, 1133, 1225). The
fork's Model 2B put the geometrizer's FIFO back at the read start at
every vblank, so cpres2, still in the last list's MATRIX, read the next
list's header as operands and stopped. Mainline has no such reset, and
both fights play to the end at 100 A.

The board now has both culls (BOARD.md, "Stage culls"). On Aurora, Sonic
vs Sonic, it draws the ring segments StF does (8 or 9 a frame, in step
with StF's own COP data on all 524 frames logged) and 9 ground chunks a
frame to StF's 9, its 8s and 10s within a few frames of StF's. The models
it reads a frame came down to 130 on average, StF's 114.

The guests, against their own games: Akira vs Akira 100 A on Tou-rin, the
Colosseum and the Test stage (the fights are the same on all three: no
ring edge comes in), Mahler vs Mahler on Western (FV) 97 A (below; 100 A on mainline MAME
with the culls, sync 100).

Mahler from 37 F to 54 D (sync 6, motions 76, hits 59, end 59), by FV's
own rules for an FV fighter (tools/board/lift-stf.py):

- **The knock-down.** An FV strike knocks down by FV's angle and factor
  table by kind (`fv_hit_kinds`, F 0x291DC) and FV's lift by the strike's
  byte 0xE (`fv_hit_lift`, F 0x29314), not StF's ×2 and ×5.
- **The fall.** A knocked-down FV fighter falls by FV's gravity (0.00522
  × K), not StF's.
- **The walks.** FV's walk forward and back (F 0x13878, 0x13934): VF2's
  with FV's own actions, and on rob+0 bit 10 its motions 0x9E/0x9D and
  0x289/0x288 (the board's slots 61..70).
- **The landing.** A knocked-down FV fighter lands taking a quarter of
  the last damage again (F 0x15130), leaving him 1.

Then to 88 B: FV's down flag (rob+0 bit 16) and its hit damage (armour
× 0.75, FV's counter, air and chain rules), its low-posture bit and look
block, and its guard action and guard stun.

Then to 97 A (sync 87, motions 100, hits 100, end 100):

- **The land time.** calc_land_time (F 0x19C7C) under FV's gravity, and
  the landing's margin (0.02 over the floor, F 0x18A4C) × K. 91 A.
- **The follow-ups.** FV's follow-up tables end in op 0x36 (park the table,
  try again next frame); tools/guests/fv-moves.mjs keeps that tail. FV's hit sets
  no multi-hit flag and halves nothing (StF's loc_2B304; FV's rob+0 bit 16
  is its down). 93 A.
- **The reactions.** StF's 30 kinds merge some of FV's 22 (FV's 5 and 10
  are both StF's 11). An FV strike carries FV's own kind (rob+0x875, above
  the lift in byte 0xE), and an FV victim picks from FV's own lists
  (F 0x26978), which follow StF's 30 in his kind table. 94 A.
- **The guard.** An FV strike is guarded as FV's attack_hit decides
  (F 0x25DD0): a low (0x821 kind 2, 5 or 6) goes through a standing guard,
  as VF2's; StF reads only the strike's flags. 96 A.
- **The bar.** FV's damage × 25/28 carries its remainder on the victim
  (rob+0x87D), so the board's bar is out only when FV's is: rounding each
  hit had the board's 1P out a hit early. 97 A.

Round 1 is in step to its last frames. Round 2 parts on frame 1206 (sync
74): FV's round 2 is not round 1 turned 90 degrees. Its yaws are a unit off
by frame 70 (16383, not 16384), which moves a push (F 0x25244) a frame
later on frame 83, and on frame 1206 2P's atan target (F 0x190CC) stops
150 short.

It is not the trig. FV is Model 2B too, with a SHARC, not a TGP. Its COP
runs its own revision of StF's program, which differs in result in three
places:
- the atan and sine constants (StF's are an ulp low);
- area_table_gen's broad-phase cell (16.0, StF's 8.0);
- get_sm_ang_r's second angle.

stf-sharc's `FV_COP` build carries all three behind one command (0x88). On
the board this replay's trace is the same to the byte with any of them, or
with that image loaded. The split is FV's own: on round 2's steps 39-40 FV's
1P stands a little lower than in round 1 (ball heights 1.2106 and 1.2154).
outside_ball's push is then 0.1173 deep, not 0.1193 (the board's 0.1193
matches round 1's). That leaves the board 0.0014 out, and on step 63
get_2d_dir gives 998 against FV's 997 (998.1 and 997.8, truncated). A turn
step of 12 against 11 grows into the split.

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
  both fighters are guests (`loc_2A6B8`, tools/board/lift-stf.py).
- **The push between bodies.** `coli_recalc_pos` keeps two bodies 0.3
  apart and caps the push at 0.3 a frame, in StF's units; for two guests
  of one game it is in theirs now (`loc_2D7B0`, `loc_2D7E0`): VF2's
  factor is always 0.3 × its size and has no cap, FV's are StF's × its
  size.
- **The reach guards.** The guests' command programs went over with
  their `nearer_than`/`further_than` distances (ops 0x1A, 0x1B) in their
  own units, against a distance the board measures at their size: Mahler
  took his far jab (FV 672) where FV takes the near one (671). They are
  scaled now (`reachAt`, tools/guests/vf2-guest.mjs), and his first punch is
  FV's, on FV's frame.

- **The guests' push.** The fights parted on the first jab's contact
  (Akira frame 40, Mahler 39), in the overlap the COP returns (g4): on
  Akira's frame 40 VF2's is 0.2233 VF2 units and StF's SHARC program gave
  0.0834. Between two VF2 guests the board now works it out as VF2's TGP
  does (its function 0x3B, TGP 0x99E, sent by `coli_cont_cop` 0x23524 as
  `0x1D803B3B` + kind, P1's and P2's g3 masks, 0xB4 and 0xB8):
  `vf2_push` (board/src/fight/push.c), called from StF's `coli_cont_cop` in place
  of the g4 read back (`coli_cont_cop_g4`, tools/board/lift-stf.py).
  - The TGP holds 30 balls per fighter, k = 0..29. Ball k has i960 ball
    k's radius (TGP program table 0xAD4+30−k, the same as rob+0xD00's)
    but the position of i960 ball SENT[k], the order
    `set_coli_ball_data` sends them in (bufferram 0x3F40, 0x7F40):
    SENT = 1 0 2 5 4 7 6 8 10 9 12 11 13 3 16 15 14 19 18 17 21 20 24 23
    22 27 26 25 29 28.
  - Pair P2's ball o with P1's ball i; skip it when P2's mask has bit o
    or P1's has bit i (those go to the swept attack test, sub 0x8A5,
    which only counts).
  - g4 = the largest r[i] + r[o] − |pos_i − pos_o| (× const $e(o), 0,
    when 0xB4 has bit i and 0xB8 bit o; only VF2's BODY, kind 3, has
    them, 0xFFFFDFFC both). Kinds 4 and 5 give none.
  - The masks are VF2's, not the board's: its g3 (`calc_attack_flag`
    0x238a4) maps ball to unit with VF2's bytes at 0x23284, where the
    guest's rob+0x1D18 has another order (frame 40: VF2 0xE0, the board's
    +0x768 0x1C0); StF's task +0xC0/+0xC4 are not VF2's 0xB4/0xB8.

  Frame 39 (masks 0): TGP balls 6 and 6, 0.1169. Frame 40 (masks 0xE0):
  TGP balls 3 and 3, ball 5's place (a hand) with ball 3's radius 0.13
  each, 0.26 − 0.0367 = 0.2233. The board's own g4 is 0.1168 and 0.2234
  there (÷ 2.027), and its places on 39 and 40 are VF2's. 900 pairs a
  frame on the i960 cost the board frames (3 behind on the round), so
  only the balls in the other fighter's box are paired.

  Akira vs Akira on Tou-rin, regraded: 32 (F) as before (sync 1, motions
  36, hits 24, end 69). The fight now parts on frame 41, 1P's place off
  by 0.090 (VF2 −0.621, the board −0.531): the push is 0 on both there;
  it is the first frame of the jab's reaction (VF2 motion 258, the
  board's 638). Mahler's push (frame 39: the board 0.040 FV units, FV
  0.014) is not looked at.
- **Frame 41: the knockback, not the motion.** 638 is 258
  (`guests.json` `motionIds["638"] = 258`): the reaction is the same, and
  the grader parts the fights there on 1P's place. Through the reaction's
  start (set_motion +0.638, the next step +0.070, VF2 units) the two agree
  to the fifth decimal; then VF2 adds 1P's speeds, `x += rob+0x2C` (pc
  0x17AB8) and `x += rob+0x5C8` (0x17B30), −0.031 and −0.128, the board
  (0x13434, 0x1346C) −0.017 and −0.053. Both are the hit vector rob+0x5E0
  (written on frame 40) times 1.0 and 5.0 (VF2 ROM 0x1B7DC, 0x1B7E0, the
  same on the board), less a frame's drag. The hit vector:
  - VF2 (0x2260C..0x2306C): P = the attacker's +0x822 (signed byte),
    s = √(P/30) × 30 × [0x23270] (0.0025) × list 0x50A800 (by +0x843),
    |v| = √(2s / (60 + 0.6 (w − 60))), w = the victim's +0x5D8.
  - The board runs StF's (`loc_2A8F8` 0x1AEC4, `loc_2B738` 0x1BCCC):
    s = √(P × 0.01) × 50 × 0.0025 × list StF 0x50A800 (by 0x50FFB2) +8,
    |v| = √(4s / (60 + 0.3 (w − 60))), and none of it in the board's 2.027.
  - Akira's jab: VF2 P 12, s 0.047434, |v| 0.03645; the board P 8,
    s 0.035355, |v| 0.04640 board units, 0.02289 VF2 units (×0.628 of
    VF2's). w is 79 on both. With VF2's P the board's formula still gives
    0.0253: the formula is the gap, P only part of it.
  - The drag on frame 41 (VF2 0x179E8: |v| less a constant k) is
    1.14× VF2's on the board too (rob+0x5C8: 0.1245 board units, VF2
    0.0538 × 2.027 = 0.1090).
- **Frame 41: where P comes from.** P (+0x822) is the strike's damage byte,
  copied from byte +3 of the setup's op 4 (the strike) when 2P's jab starts
  (clock 1887, VF2 motion 18, the board's 527). VF2's set_mot_dat (0x1A728)
  copies it as P = b[3] × (100 + 5 × rob+0x69C) / 100, rob+0x69C 0 here, from
  Akira's script in data ROM (record at 0x2014B77: `04 05 00 0c ..`): 12.
  The board's `_uk_read_move_data` (0x155B0) copies b[3] as it is from the
  converted record (0x2E0E560: `04 05 00 08 ..`): 8. The 8 is written when
  the board is built, not when it runs: `tools/guests/vf2-guest.mjs` `damage()`
  (`convertSetup`, op 4) makes it max(1, round(b[3] × DAMAGE)), DAMAGE =
  140/200 (StF's energy over VF2's); round(12 × 0.7) = 8 (`guests.json`
  `damage["12"] = 8`). The one byte is both the damage and the knockback's
  power on both machines, so the energy scale shrinks the knockback too.
- **Frame 41: one knockback.** StF's `sub_2A7E4` (from `coli_attack_chk`)
  is the board's only knockback, for every fighter with no check of the
  game, and VF2's formula (0x2260C..0x2306C) is not on the board.
- **Frame 41: where a VF2 knockback would sit.** Still open: nothing is
  ported. The knockback is not hand-written: tools/board/lift-stf.py lifts StF's
  `collision` and what it calls into board/src/gen/stf_motion.s (generated, do
  not edit). `sub_2A7E4` is a 4-line bit-clear; the formula is in the next
  routine, `attack_hit` (stf_motion.s 15656), g7 the attacker, g8 the
  victim. Two labels hold it (stf_motion.s at 6416c9a):
  - s, `loc_2A954` (15732): r9 is P as a float (from `ldob 0x822(g7)`;
    the `be` taken when P is 0 arrives with r9 = 0). `mulr` 0x3C23D70A
    (0.01), TGP 0xD001A1A (√), `mulr` 0x42480000 (50), `mulr flt_2BA68`
    (0.0024999999), `mulr` `ld 8(r7)`, r7 = stf_ram_50A000+0x800 +
    0x28 × [0x50FE02] (the attacker's +0x843, or 4 when the victim's
    rob+0x0 bit 29 is set). s = √(P × 0.01) × 50 × 0.0025 × list+8.
  - |v|, `loc_2B738` (16558): `ld 0x5D8(g8)` (w), `subr` 0x42700000 (60),
    `mulr` 0x3E99999A (0.3), `addr` 60, `divr` (s over it), `mulr`
    0x40800000 (×4), TGP 0xD001A1A. |v| = √(4s / (60 + 0.3 (w − 60))).
    Then two turns (TGP 0x12002424/0x12802525, by r6 and by −r10, r10 =
    the attacker's +0x82A + +0x26) and the stores: rob+0x5E4 (× 4, × 2 or
    × `ld 4(r7)`), rob+0x5E0 and rob+0x5E8 (× `ld 0(r7)` unless r8 is 0
    or in the attacker's rob+0x0 bit 18 case), and one more scaling by
    `flt_2B904` when the attacker's rob+0x7D2 bit 0 (the finishing blow)
    is set.
  A VF2 branch would be two entries in lift-stf.py's INSERT, beside
  `rsc_gra_vf2` (line 327); INSERT puts its lines right after the label
  it is keyed on (line 696), and both sites have labels, so no NAMED
  entry: INSERT['loc_2A954'] (VF2's ×1/30 then ×30, where StF has ×0.01
  then ×50) and INSERT['loc_2B738'] (VF2's 0.6 and ×2, where StF has 0.3
  and ×4). The game check the other inserts use (`ldob 0x1B1(gN)`,
  `ldob guest_char_game[…]`, `cmpobne GAME_VF2`) is in reach for g7 and
  g8 at both (`loc_2B9CC` and `coli_cont_cop_g4` already check g8). Whose
  fighter decides (the attacker, who owns P, or the victim, who owns w)
  matters only in a mixed fight; Akira vs Akira is VF2 on both sides. It
  is left open.
  The jab's path, from the source: every hit past `attack_hit`'s head
  (the round-state gates on 0x50002B/0x500031 to `loc_2B900`, and the
  victim's rob+0x19F = 0x12 to `sub_19888`) falls through `loc_2A8F8`
  into `loc_2A954`, so s is always worked out there. Then the guard
  (victim rob+0x1A4 bit 13) goes to `loc_2B738` by `loc_2AE28` (16011),
  and a hit by `loc_2AE40` (r8 = 2, 3 on a counter at `loc_2B1A4`) to
  one of three:
  - `loc_2B488`, the stagger: r6 = 0, `b loc_2B738` (16439), s as it is.
  - `loc_2B5E4`, which multiplies s again before `loc_2B738`: by the
    motion's hit-table value × 2 (`calc_mht_adr`, 16495..16515) or, with
    no table, by `ld 0x10/0x14/0x18/0x1C(r7)` (`loc_2B69C`, picked by the
    victim's rob+0x1A4 bit 4 and r8 = 3), with r6 capped.
  - `loc_2B560` (victim rob+0x1A4 bit 16 with the attacker's bit 22, or
    bit 11 from `loc_2B5E4`): straight to `loc_2B898`, no new vector.
  `loc_2B5E4` is taken when the victim's rob+0x1A4 has bit 4, 14 or 16
  (bit 16 without the attacker's bit 22), or bit 24 with the attacker's
  +0x821 = 1; when the victim's rob+0x70C has bit 2; when [0x50FE00] has
  bit 14 (0x4006, the victim's bit-29 case, has it); when r11 (P, raised
  on a counter) is 50 or more; or when the blow finishes the victim
  (`sub_19730` against rob+0x1AC). Otherwise `loc_2B488`.
  For this jab P is 8, it is round 1's first hit, and the friction run
  logged the victim's rob+0x1A4 as 0x121 at rob_spd_control's entry on
  frame 40 (bits 0, 5, 8; 4, 14, 16, 24 clear; bit 8 is the counter
  check, which changes only r8 and r11). That points to `loc_2B488`, s
  unscaled. But 0x121 was read at the friction tap, not at the hit, and
  [0x50FE00] (the attacker's +0x828), the victim's rob+0x0 bit 29 and
  rob+0x70C were not logged, so the source alone does not prove it. The
  measured adds agree with no extra factor: the board's −0.017 on 41 is
  0.02289 less a frame's drag (0.0061434), as VF2's −0.031 is 0.03645 −
  0.0053764, so whatever ran, the extra factors (an s table, list+0 on
  rob+0x5E0) came to about 1.0 for this jab. The jab's path is still
  open (a tap at 16439 against 16495 settles it); the written s and |v|
  hold to the three decimals measured.
- **Frame 41: the factor on rob+0x5E0/+0x5E8.** `ld 0(r7)` (`loc_2B850`,
  stf_motion.s 16622) is word 0 of the same 0x28-byte list record whose
  +8 scales s: r7 is set once at `loc_2A954` and not changed before the
  stores. The list is in the tree, `stf_list_90` (board/src/fight/fighter.c
  156, copied to 0x50A800 by `stf_globals`). The index is [0x50FE02], the
  attacker's +0x843, which `_uk_read_move_data` copies from byte 10 of
  the strike record; `convertSetup` op 4 puts VF2's byte 13 there. Akira's
  jab in VF2's data ROM (0x2014B77) is `04 05 00 0c 33 33 33 3f 00 00 00
  80 00 00 00 00 00`: byte 13 is 0, so +0x843 = 0 selects record 0,
  word 0 `stf_list_90[0]` = 0x3F800000 (1.0), unless the victim's
  rob+0x0 bit 29 is set at the hit. That bit forces [0x50FE02] = 4
  (`attack_hit`'s head), record 4, word 0 `stf_list_90[40]` = 0x41A00000
  (20.0), and it also sets [0x50FE00] = 0x4006, which sends the hit to
  `loc_2B5E4`. The multiply is skipped when r8 is 0 or in the attacker's
  rob+0x0 bit 18 case.
  The victim's rob+0x0 bit 29 was not observed at the hit; the next item
  settles it from the source (clear, so the factor is 1.0). The three-way
  split stays unproven, and the knockback item stays open (nothing
  ported).
- **Frame 41: the victim's rob+0x0 bit 29 is clear at the hit (source).**
  `rob_init` zeroes the block and writes rob+0x0 = 0x84000080 (1P) or
  0x84000082 (2P), bit 29 clear (board/src/fight/fighter.c 217, 221). The one
  setter is play op 0x20 (`loc_1C748`, stf_motion.s 11058..11061), and
  only when rob+0x84C = 2. +0x84C is written by `rob_init` (0xFF) and by
  `set_mot_dat` from setup head byte 12 (stf_motion.s 9842), and
  `convertSetup` writes byte 12 = 0 for every VF2 Akira setup
  (tools/guests/vf2-guest.mjs 547). StF's own setups with byte 12 = 2 are
  motions 215..221; Akira gets none of them: his 52 action slots and
  reaction positions 0..40 are his VF2 ids (vf2-guest.mjs 721, 738), the
  kept tails 41..43 are StF's 0 or 59, and set_motion's remap
  (`loc_1B044`) turns StF ids in those places into his. The other
  writers of rob+0x0 change other bits and keep bit 29 (stf_motion.s
  1822, 9301 and the alterbit/notbit stores; armour.c 48 ORs bit 28;
  `rob_start` restores the word). So at this jab's `attack_hit`
  [0x50FE02] stays the attacker's +0x843 = 0, [0x50FE00] is not forced
  to 0x4006, the `ld 0(r7)` factor is 1.0, the stored +0x5E0/+0x5E8
  vector is unchanged, and the written |v| holds. Bit 29 is not the
  missing observation. This does not by itself prove `loc_2B488`; the
  three-way split stays unproven and the knockback item open (nothing
  ported).
- **Frame 41: the split after `loc_2A954`: `loc_2B488` (tap).** The
  selecting branches are `loc_2A9F0` (stf_motion.s 15765; the victim's
  rob+0x1A4 bit 13, the guard, to `loc_2B738` by `loc_2AE28` with r11 =
  r6 = 0), `loc_2AE40` (16012; the attacker's rob+0x70C bit 20 /
  rob+0x5B8 bit 0 to `loc_2B8C8`), the counter at `loc_2B1A4` (16198)
  and `ah_not_finish_blow` (16355..16379). What the jab's own data
  fixes: its VF2 setup (0x2014B77) is op 4, op 0xB (0x844 =
  0x00058000), end 8, so no op 5 (`sub_1B7C4`) rewrites +0x828;
  `convertSetup` puts VF2's bytes 10 and 11 (00 80) in StF's 7 and 8, so
  +0x828 = 0x8000 and `attack_hit`'s head stores [0x50FE00] = 0x8000
  (not 0x4006: bit 29 is clear). Bits 14 and 10 are clear, so the
  [0x50FE00] bit-14 entry to `loc_2B5E4` is out and the hit goes on to
  the r11 ≥ 50 check. +0x821 is VF2's byte 2 = 0, so the bit-24 case is
  out too. The victim's rob+0x1A4 bit 13 (the guard) is clear at the
  hit. Its setters are `set_mot_dat` (9861, a setup's kind word), play
  ops 5/7 (`loc_1C29C`/`loc_1C2CC`) and the armour-break replay restore
  (24757/24896). No VF2 setup has a play op 5/7 on bit 13. VF2 Akira's
  bit-13 setups are guard stances and guard reactions only. They are
  reached through action slot 5 (VF2 action 8, setup 241) in
  `ACT_RC_TA_GUARD`/`ACT_RC_GUARD` (2845/2898), or through
  guard-category reactions (`sub_2B94C` g0 = 0/1). Those are entered
  only by the pad's guard bit (`sub_1D984`, 12219) or by guarded-hit
  stores that sit behind a bit-13 test (15813/15867/15931, 17244). No
  command commit, native, or setup/play reference leads to one.
  battle.lua's seed-1 script gives 1P no G before script frame 57 (round
  frame 87), and the jab is the round's first hit. So this entry no
  longer opens `loc_2B738`. The rest was read in MAME (the board build,
  the Tou-rin replay, a read/write tap on both robs and [0x50FE00] with
  the pc in `attack_hit`). On frame 41 the two jabs trade: 2P's hits 1P,
  then 1P's hits 2P, the same way. At 2P's hit, 1P is in its own jab:
  its rob+0x1A4 is 0x121 (bits 16, 14, 4 and 13 clear), its rob+0x70C is
  0 (bit 2 clear), its +0x822 is 8 (under 104, so no counter), and the
  hit reaches `ah_not_finish_blow` (not a finishing blow). The hit then
  runs `loc_2B488` (the 0x0B00027E store to 1P's +0x198), `loc_2B4A8`,
  `loc_2B4E4`, `loc_2B510` and `loc_2B738`; `loc_2B5E4` and `loc_2B560`
  are not run. So this fight takes exactly one path, `loc_2B488`, to the
  `loc_2B738` store with r6 = 0 and s unscaled. The split is settled;
  the knockback item stays open (nothing ported).
- **Frame 41: one slowdown.** StF's `rob_spd_control` (the block after
  `rsc_fric_end`) is the board's only slowdown, and VF2's constant-k
  slowdown is not on the board.
- **Frame 41: rob+0x5D4.** 1P's rob+0x5D4 is 0.5 at the slowdown on both
  sides, and the board's 0.5 already includes `ACT_RC_YARARE`'s +0.5.
- **Frame 41: the slowdown's globals.** On the board at the frame-41
  slowdown, [0x50A000] = 0.025222, [0x50A004] = 1.0 and [0x50A008] = 10.0,
  and these are not VF2's k.
- **Frame 42: 1P's place.** At the end of frame 42, 1P is at −0.702 on VF2
  and −0.540 on the board in VF2 units (−1.095 board units), both still in
  the jab reaction (board motion 638, VF2 motion 258).
- **Frame 42: the adds to 1P's place.** On frame 42, VF2 adds −0.024
  (rob+0x2C) and −0.057 (rob+0x5C8) to 1P's place; the board adds −0.009
  and 0.000 in VF2 units (−0.01734 and 0 board units).
- **The slowdown, read side by side.** VF2's slowdown (0x179DC..0x17A3C,
  in its `rob_spd_control` at 0x1791C) is StF's block after `rsc_fric_end`
  instruction for instruction: k = [0x50A000] × [0x50A004] × w / 60 ×
  (1 + rob+0x5D4) × [0x50A008]; |rob+0x5C8, rob+0x5D0| loses k, or both
  are zeroed if k is larger (rob+0x5D4 with them, unless rob+0x2C/0x34
  were slowed rather than stopped). The one change is StF's extra × 0.25
  (0x3E800000, StF 0x17F9C), which VF2 lacks. So "VF2's constant-k
  slowdown is not on the board" holds for its constants, not its code.
  VF2 sets the globals at 0x9984: 0.0027222 (0x3B32674F), 1.0, 10.0 (and
  0.00067556 with 2.0 in its bit-20 slow motion, 0x1FD5C). With w 79 and
  rob+0x5D4 0.5, VF2's k = 0.05376 and the board's 0.025222 × 0.25 × … =
  0.12453 board units: the 0.0538 and 0.1245 measured on frame 41. In VF2
  units the board's is 0.06144, 1.143× VF2's, because StF's gravity × 0.25
  ÷ 2.027 (0.003111) is not VF2's 0.0027222. On frame 42 the board's
  0.10744 is below k, so it is zeroed. The rest of the routine: only StF
  has the rob+0xA0E countdown and × 0.7 gravity on rob+0x1A4 bit 14; only
  VF2 adds rob+0x5C8/0x5D0 at × 0.5 under [0x500068] bit 20.
- The rob+0xA0E countdown, read in StF, g4/vf2.dis and the board side by
  side: the board has StF's, VF2 has none. The board's rob_spd_control is
  StF's lifted (board/src/gen/stf_motion.s 7357), and after rsc_espd_end
  (StF 0x180AC) it decrements a non-zero rob+0xA0E; while it stays above
  0 the routine returns (loc_181D4) before gravity, the move of rob+0x18..
  by rob+0x2C..0x34 and rob_check_stage, so the fighter holds still; on
  the frame it reaches 0 rob+0x2C..0x34 are restored from rob+0xA10 and
  the frame goes on. Friction on rob+0x5C8/0x5D0 still runs on the held
  frames. VF2's routine goes straight from its rob+0x5D4 store (0x17A3C)
  to the gravity check (0x17A40, the same code as StF's rsc_gra_chk), and
  no instruction in vf2.dis addresses 0xA0E or 0xA10 on a fighter. The
  board's setters are StF's: ACT_RC_JUMP (6 frames, rob+0x2C..0x34 saved
  to 0xA10 and zeroed: the jump's start-up), the wall hit (ACT_RC_KABEHIT's
  arkh_0: 7..15 from weight − 60, or 30 with rob+0x7D2 bit 0), sub_165D4 and
  ACT_RC_JUMP's other path (from rob+0x800), and clears in
  init_barrier_count_for_player_per_match and _uk_display_hit_combo. They
  run for every fighter, VF2's guests too, so a VF2 fighter on the board
  can be held where VF2 never holds one.
- StF's × 0.7 gravity, read in StF, g4/vf2.dis and the board side by side:
  the board has StF's, VF2 has none, and on the board it never fires. In
  the board's rob_spd_control (rsc_gra_calc, board/src/gen/stf_motion.s 7457,
  StF 0x1811C) the gravity [0x50A000] is multiplied by flt_1D290 (0.7)
  when rob+0x1A4 bit 14 is set, before it is taken off rob+0x30; sub_16A4C
  (6159) and calc_land_time (8987) have the same test and multiply.
  VF2's gravity (0x17A88..0x17AA8) takes [0x50A000] off rob+0x30 as it is,
  with no bit test and no multiply. With the bit set a fighter would fall
  with 0.7 of the gravity (rob+0x5CC still added), so the same jump speed
  would carry it higher and keep it up longer. Nothing on the board sets
  rob+0x1A4 bit 14: no StF code stores it, the one data-driven setter
  (play op 5, loc_1C29C 10314) takes its bit from the motion, StF's
  motions never ask for 14, and vf2-guest.mjs keeps only STF_FLAG_BITS
  (no 14) in a guest's op 5. So every fighter on the board, VF2's guests
  too, falls with the full gravity, as on VF2: for a VF2 fighter the
  branch changes nothing now. Read from the code only; the board was not
  run.
- The stage bounds into gravity, read in StF, g4/vf2.dis and the board
  side by side: VF2 pulls a grounded fighter past the bounds into gravity,
  StF never does, and the board keeps StF's. The test is the same in all
  three: with rob+0x0 bit 2 clear (grounded) and rob+0x61C 0, it marks the
  fighter out (r6 = 1) when |rob+0x1F4| or |rob+0x1FC| is at or past
  [0x50A00C] (StF 0x180C8..0x18110, board/src/gen/stf_motion.s 7437..7453,
  VF2 0x17A40..0x17A80; StF compares as floats with cmpr/bge, VF2 the
  sign-cleared bits with cmpibge, which agree for these values; the
  [0x50A010] each loads into r4 is dead). Only the branch after it
  differs. VF2's 0x17A84 skips gravity when the fighter is inside and falls
  into it (0x17A88) when out, so an out grounded fighter has [0x50A000]
  taken off and rob+0x5CC added to rob+0x30 each frame, and rob+0x1C
  moves by it: it sinks while still grounded. StF's 0x18114 skips when
  inside and its 0x18118 skips when out (b 0x1815C), so a grounded fighter
  never gets gravity; StF reads out-of-bounds again in rob_check_stage
  (0x18214, into rob+0x620). The board has StF's pair (loc_18114, 7454)
  and runs it for every fighter: a VF2 guest standing past the bounds
  keeps its height on the board where VF2 would sink it. The glance
  before this item was right. Read from the code only; the board was not
  run.
- VF2's × 0.5 slow-motion add, read in StF, g4/vf2.dis and the board side
  by side: VF2 has it, StF and the board do not. After the move of rob+0x18..
  by rob+0x2C..0x34 (which all three add in full), VF2 loads [0x500068] at
  0x17ADC and tests bit 20 (0x17AE4): set, rob+0x18 and rob+0x20 get
  rob+0x5C8 and rob+0x5D0 × 0.5 (0x3F000000; 0x17AE8..0x17B20); clear, they
  get them in full (0x17B24..0x17B40). So the half is not an extra add but
  the slow-motion form of the one add. VF2 sets bit 20 at 0x1FD5C (with
  gravity 0.00067556 and [0x50A004] 2.0) and 0x295C4. StF's own bytes
  (sfight.zip) keep the load (0x1818C) but no test: the full add follows
  (0x18194..0x181B0), and no StF code sets, clears or tests bit 20 of
  [0x500068]. The board is StF's (board/src/gen/stf_motion.s 7485..7493, its
  load dead too), its fight RAM starts the word with bit 20 clear
  (fighter.c, 0x8400442C), and nothing on it sets the bit. Outside VF2's
  slow motion the three agree. In it, a VF2 fighter's push (rob+0x5C8/
  0x5D0) moves it half as far each frame while its own speed moves it in
  full; on the board a VF2 guest's push always moves it in full, and the
  board never enters that slow motion anyway. The prior note was right, with
  the half replacing the full add rather than adding to it. Read from the
  code only; the board was not run.
- rob_check_stage's later bounds check, read in StF, g4/vf2.dis and the
  board side by side: the test is the same in all three, but its input,
  where its result goes and how it lands an out fighter differ, and the board
  keeps StF's. StF's own bytes (sfight.zip) check at 0x18214..0x18244, and
  the board's copy is the same instruction for instruction
  (board/src/gen/stf_motion.s 7517..7529). VF2's check is at 0x17B94..0x17BBC.
  In all three, g4 = [0x50A010] (the ground outside) and r11 = 1 when
  |x| or |z| is at or past [0x50A00C]; inside, both are 0 (StF compares
  as floats, VF2 the bits; they agree, as before). The differences:
  - **What it measures.** VF2 always measures the root, rob+0x1F4/0x1FC.
    StF measures rob+0x18/0x20 instead when rob+0x1A4 bit 4 is set
    (0x18204..0x18210).
  - **Where r11 goes.** StF stores r11 to rob+0x620 every frame, right away
    (0x18248). VF2 never does that: it writes rob+0x620 only when the
    fighter lands (r11 at 0x17E54, 0 at 0x17C48 and 0x17FD0), or sets it
    to 1 with rob+0x1A4 bit 23 (0x18000).
  - **An out fighter in the air.** VF2 lands it on g4 with its usual
    landing test (g4 + 0.02 against rob+0x1C, 0x17E10..0x17E60), the same
    test StF uses inside the bounds. So VF2's out fighter falls to the
    ground outside (−0.5, set at 0x99CC) and lands there. StF lands an out
    fighter only when rob+0x624 and rob+0xA29 are both set, and then at
    once: rob+0x1C = g4 with no height test (0x18334..0x1835C). Otherwise
    every branch goes to 0x183CC (the −1.0 compare at 0x18314 is dead), so
    rob_check_stage never lands it.
  - **An out fighter on the ground.** StF clears rob+0x1A4 bit 4 and
    rob+0x30 only if rob+0x624 is set (0x18254..0x18278). VF2 uses r11 on
    the ground only when rob+0x61C is set and rob+0x60E is clear
    (0x17C34): an out fighter then goes to its landing path (0x17E7C).

  On the board every fighter runs StF's path, VF2's guests too, so a
  guest gets rob+0x620 every frame and StF's landing rule. The bounds are
  the board's own (fighter.c 393): [0x50A00C] is 8.0 on StF's cage, FV's
  wall on FV's stages, and 100.0 on VF2's rings. So on a VF2 ring the check
  never marks anyone out; there ringout.c's ring_out_step (C, not
  graded here) drops a fighter past the edge instead. On a cage stage, a
  VF2 guest at the bounds is not landed on [0x50A010] (kage.c 62) as VF2
  would land it: it lands at once only with rob+0x624 and rob+0xA29 set.
  With rob+0x1A4 bit 4 set it is measured by rob+0x18/0x20, not its root.
  Read from the code only; the board was not run.

  Since then the check goes by the fighter's game (`guest_char_game`;
  tools/board/lift-stf.py, INSERT at loc_18214 and loc_18248). FV's (F 0x588C0,
  rebuilt from `fvipers.zip`) is StF's to the instruction but for two
  tests that branch nowhere (rob+0x7D6 in place of 0x7D2), so StF's and
  FV's fighters keep StF's path. A VF2 fighter now runs VF2's: measured
  at its root, rob+0x1A4 bit 23 zeroing its fall and height, rob+0x620
  stored only where VF2 stores it, and VF2's landings (on the ground
  outside when out of bounds, 0x17E44; at 0 when rob+0x614 is set,
  0x17FB8), through StF's sub_1980C (VF2's 0x18B58, the same routine on
  each game's offsets). Left out: VF2's rob+0x624 setting w0 bit 5
  (ringout.c does VF2's ring out) and its end without StF's rob+0x1E18
  tail (the edge stumbles came later; below). Run on MAME (Akira vs Sonic, South Island): Akira
  takes VF2's path every frame (seeds 2 and 3: its ground, wall, air and
  landing branches hit), and with seeds 1 and 2 the logs match the build
  before it frame for frame; none of those fights landed him out of
  bounds.

  Forced out of bounds (MAME's debugger at rob_check_stage's compare:
  [0x50A00C] read as 1.0 and [0x50A010] as -0.5, so both fighters, at
  x and z +-1.414 from the round's start, are out by the same margin;
  both jump on frame 40; a write tap logs each rob+0x620 store and its
  pc):
  - Sonic (StF's path): rob+0x620 stored every frame (1 once out, pc of
    StF's store), ground and air. In the air rob+0x624 and rob+0xA29
    came on by themselves, and he was put on -0.5 at once from y 3.09 on
    his way down. With rob+0x624 held clear he was never landed: he fell
    to y -148, rob+0x620 still stored every frame, until the bounds came
    back and the in-bounds landing put him at 0.
  - Akira (VF2's path): rob+0x620 not stored on any frame in the air or
    on the ground. Over StF's floor rob+0x614 (0x8000, the floor under
    him) comes on before he is low enough for the ground outside, so he
    lands at 0 (VF2's 0x17FB8, rob+0x620 stored once, 0). With rob+0x614
    held clear and rob+0x61C set, as over VF2's empty outside, he fell
    on to -0.5 (VF2's 0x17E44: rob+0x1C at or under g4 + 0.02 +
    rob+0x81C), and rob+0x620 was stored once, 1, on that landing, and
    on no frame before or after it.
  So on a cage stage a VF2 fighter out of bounds lands on the cage's
  floor, not the ground outside: StF's floor is under him there. (The
  board's [0x50A010] on South Island is -10.0, not VF2's -0.5.)

  VF2's edge stumbles are in the same branch now (INSERT at loc_18248,
  VF2's 0x17BD4..0x180B4 instruction for instruction, each `ret` a branch
  to 0x183CC). The teeter, VF2's 0x18B or 0x18A, picked by the atan of a
  foot (rob+0x2A8/0x2B0 or 0x284/0x28C) against rob+0x616, the side bit
  turned; the slips, 0x182..0x185; the falls off, 0x186..0x189, then the
  landing at 0; and the turn VF2 writes to rob+0x61A (0x18008). VF2's
  request command 0xC (DOWN, V 0x1564C) is StF's 8 (ACT_RC_DOWN), 0
  (MOTION) is 0 in both. The motion ids are the fighter's own, from the
  board's table `edge_motion` (by rob+0x1B1; VF2's 0x182..0x18B as board
  ids; 0 for a fighter without them, which then plays none). Forced in
  MAME (Akira vs Sonic, South Island, both forced the same way for 3
  frames from frame 35; a tap on rob+0x198 and rob+0x618..0x61B with
  their pcs):
  - Near teeter (rob+0x614 = 0x8000, rob+0x620 = 0; VF2's wall path, as
    on South Island rob+0x61C is never 0): Akira's request 0x080202A9
    (board pc 0x1367C; motion 681, VF2's 0x18A), rob+0x61A = 0xE000
    (pc 0x13A70), his side bit turned; he plays 681 for 49 frames.
  - Far teeter (rob+0x614 = 0x1000): the same request at the same pc,
    rob+0x61A = 0xE000, side kept.
  - Teeter facing in (rob+0x616 = 0xA000): request 0x2AA (pc 0x1365C;
    682, VF2's 0x18B, command 0), rob+0x61A = 0x5000 (pc 0x13A54); 682
    for 71 frames.
  - Slip: request 0x080202A1 (pc 0x1377C; 673, VF2's 0x182), rob+0x61A =
    0xE000; 673 for 52 frames.
  - Off (out of bounds as above): request 0x080202A5 (pc 0x138CC; 677,
    VF2's 0x186), rob+0x61A = 0xE000, then the landing at 0; 677 for 42
    frames.
  - Sonic, in every run: no motion 673..682 and no rob+0x61A write; his
    only rob+0x198 write was StF's own (0x9000000, pc 0x1009C), and
    rob+0x620 = 1 from StF's path.

  The turn takes effect now, for a VF2 fighter only. Two things kept it
  from doing anything:
  - StF's area_coli stores the copro's rob+0x618 as a word (`st r7,
    0x618(g7)`, board pc 0x1E7B0 before), which cleared rob+0x61A every
    frame. VF2 stores it as a short (V 0x1419C). For a VF2 fighter the board now keeps
    rob+0x61A in the word's high half (a label, area_coli_618, before
    the store).
  - VF2's rob_revise_yang (V 0x17710) turns rob+0x26 toward rob+0x61A
    while rob+0x1A4 bit 23 is set, 0x38E (5 degrees) a frame, with no
    window (V 0x1771C, 0x177E0, into the turn at V 0x17890). The stumble
    motions set that bit (Akira's 0x1A4 is 0x804021 in 681, 0x800021 in
    682, 0x800861 in 673 and 677). StF's has no such path: it reads
    rob+0x61A only with w0 bit 9 (StF 0x17CD0), which nothing sets
    during a stumble. The board's rob_revise_yang now takes VF2's path
    for a VF2 fighter with bit 23, after StF's own gate (mod_fa_coli
    bit 31). VF2's `tag_yang` (V 0x49040) is not a reader the stumble
    needs: it is the debug menu's display of rob+0x61A.
  Forced again in MAME the same way (Akira vs Sonic, South Island, 3
  frames from frame 35, rob+0x26 logged each frame):
  - Teeter facing in (rob+0x616 = 0xA000): rob+0x61A = 0x5000; Akira's
    rob+0x26 goes 0xE000, 0xE38E, 0xE71C ... 0x5000 by frame 71 (0x38E a
    frame through 0) and stays 0x5000 to the end of the log (frame
    198), motion 682 still playing under idle input. (#1825's "682 for
    71 frames" was its log's window.) Before: rob+0x26 stayed 0xE000.
  - Slip with rob+0x616 = 0xA000: rob+0x61A = 0xF000; rob+0x26 0xE000 to
    0xF000 in 4 frames and held through motion 673. On the fall that
    follows (606) the board's usual 0x8000 flip (StF's, also VF2's V
    0x1B454) turns both rob+0x26 and rob+0x61A.
  - Near teeter and off the edge with rob+0x616 = 0xE000: rob+0x61A =
    0xE000, the yang he already had, so rob+0x26 stays 0xE000 as before.
  - Sonic, in every run: rob+0x61A 0 and rob+0x26 0x6000 throughout.
  Unforced, the board's fights are the same as before frame for frame:
  battle.lua, 12000 frames, Akira vs Sonic seeds 1 and 2 and Sonic vs
  Honey seed 1, old and new ROMs' traces identical.
- rob_check_stage's tail, read in StF, g4/vf2.dis and the board side by
  side: the board has StF's, VF2 has none; for Akira it writes rob+0x760
  but nothing reads it.
  Every path of the board's routine ends at loc_183CC (StF 0x183CC), VF2's
  branch too (its `ret`s branch there): unless rob+0x1E18 (last frame's
  rob+0x1A4, stored at loc_129DC) has bit 8, a fighter with rob+0x1A4 bit 8
  gets rob+0x760 = the halfword at [0x500828]+0x1E0 (an angle that moves
  during the round; get_my_info reads it too), + 0x8000 for 2P (rob+4). Its one reader
  is StF's rob_revise_yang (board/src/gen/stf_motion.s 7186..7192, StF 0x17CBC):
  with rob+0x1A4 bit 8 and rob+0x821 == 4 (byte 2 of setup op 4, the
  strike, from _uk_read_move_data) it turns him to rob+0x760 at 0x71C a
  frame. VF2's routine ends at its last store (V 0x180B4, `ret` at
  0x180B8), its rob_revise_yang (V 0x17710..) has no bit-8 path, and its
  rob+0x760 is another field (a word its rob init clears, V 0x14020). StF's
  other rob+0x1E18 bit-8 reader (loc_1B15C, frame 4 on a new bit 8) needs w0
  bit 18, Super Sonic's. For Akira on the board both of the tail's
  conditions are rare: no setup of his 339 sets bit 8 by play op 5 (bit 8 is
  in STF_FLAG_BITS, so one would keep it), and only VF2 432 and 567 have
  strike byte 2 = 4. Bit 8 could still come from a request's kind flags in
  StF's code; that was not followed. A port would be a GAME_VF2 branch at
  loc_183CC to its `ret` (rob+0x760 unwritten) or at rob_revise_yang's
  bit-8 test; a MAME check: Akira vs Sonic, battle.lua seeds 1 and 2, a
  write tap on rob+0x760 (pc of the stis at loc_183FC) and on rob+0x1A4
  for bit 8, with rob+0x821; no hit means nothing to port.
  Run on MAME (board at 29c0458, Akira 1P vs Sonic 2P, South Island,
  battle.lua seeds 1 and 2, whole matches; taps on rob+0x760 and rob+0x1A4,
  rob+0x821 read at each and every frame):
  - The tail fires for Akira: rob+0x760 stored at board pc 0x13C5C 40
    times (seed 1, frames 715..3740) and 28 times (seed 2, 715..3164), once
    each time his rob+0x1A4 bit 8 came on (0xDD81..0xE32A). The bit comes
    from StF's code, not his data: it came on in his motions 526, 527, 529,
    558, 559, 600, 731, 732 and 781.
  - Its reader never does: rob+0x821 was 0, 1 or 2 at each of those stores
    and never 4 on any frame of his, so rob_revise_yang's bit-8 path (pc
    0x13008) never turned him to rob+0x760.
  - Sonic's tail fired too (48 and 34 stores), and his bit 8 was set with
    rob+0x821 = 4 on 96 and 74 frames: StF's own path, as in StF.
  So for Akira the difference is a dead store: the board writes a field VF2
  does not, and nothing reads it in his fights. Nothing to port.
- rob_spd_control's head (the friction on the fighter's own speed), read in
  g4/vf2.dis and the board side by side: the same code but for two
  instructions, and the friction does not match for a VF2 fighter. VF2's
  routine (V 0x1791C..0x179D8) and the board's (board/src/gen/stf_motion.s
  7372..7417, StF 0x17F78..) both save rob+0x18.. to 0x50E000, work out
  r5 = [0x50A004] × [0x50A000] × w (rob+0x5D8) × 1/60 (0x3C888888) ×
  (1 + rob+0x5D4) and r6 = r5 × [0x50A008] (the push's k, above), and, unless
  rob+0x1A4 bit 4 is set, take r5 off |rob+0x2C, rob+0x34| (copro function
  0x2D, the length) by scaling both by 1 − r5/|v|, or zero them when |v| is
  at or under r5 (r7 = 1 when scaled). The board's two extras:
  - `stt r4, 0xA4C(g7)`: rob+0x18..0x20 also saved to rob+0xA4C..0xA57. No
    instruction in stf_motion.s or stf_call.s and no C file reads
    rob+0xA3C..0xA57 there (the nearest are 0xA44's st/ld and 0xA58's
    stq/ldq, other fields), and vf2.dis has no 0xA4x(g7) access at all. A
    dead store, as far as the board's code goes.
  - × 0.25 (0x3E800000) after [0x50A004] × [0x50A000]. This is the same
    × 0.25 the slowdown item above names, but it scales r5 too, so it
    also changes the friction on the fighter's own speed, not only the push.
  With VF2's gravity 0.0027222 (5.518e-3 in board units, the 0x3BB4D327
  ACT_RC_JUMP gives a VF2 fighter's rob+0x5CC) and the board's 0.025222 ×
  0.25 = 6.306e-3, a VF2 guest's own speed loses 1.143× VF2's friction each
  frame (w 79, rob+0x5D4 0.5: VF2 5.376e-3 VF2 units, the board 1.2453e-2
  board units = 6.144e-3 VF2 units), and stops at a speed 1.143× VF2's.
  Frame 42's rob+0x2C add (VF2 −0.024, the board −0.009, above) is mostly
  the hit vector's difference; this is the part of it that is left.
  A port would be a GAME_VF2 branch after rob_spd_control's `mulr r13, r14,
  r5` (StF 0x17F90..0x17F9C): r5 = [0x50A004] × 0x3BB4D327 (VF2's gravity ×
  SCALE) in place of [0x50A004] × [0x50A000] × 0.25. It would fix the push's
  k (r6) in the same stroke, since r6 is r5 × [0x50A008]. It reads
  rob+0x1B1 (the character, for guest_char_game) and changes how rob+0x2C,
  rob+0x34, rob+0x5C8, rob+0x5D0 (and rob+0x5D4 with them) wind down. The
  rob+0xA4C store can stay: nothing reads it. A MAME check: the graded
  Akira vs Akira replay on Tou-rin, a tap at rob_spd_control's entry and at
  rsc_fric_end (and V 0x1791C, V 0x179DC on VF2's own run), logging
  rob+0x2C/0x34/0x5D4/0x5D8 and r5 for 1P on frames 40..60; the board's r5
  in VF2 units should be 1.143× VF2's before the port and equal after it,
  and the motions and hits should be graded again (the knockback's own
  difference stays).
  Run in MAME (the shared build; the board at 65d16ec), Akira vs Akira on
  Tou-rin, round 1, 1P, frames 40..60: VF2 by battle.lua's script, the
  board by its replay. Taps: the stt to 0x50E000 (the entry; ip after it
  VF2 0x17928, the board 0x1328C), the ld of rob+0x1A4 (r5 read there;
  VF2 0x17978, the board 0x132E8) and the first ld of rob+0x5C8 after it
  (the end; VF2 0x179EC, the board 0x1335C). The friction runs on every
  one of those frames on both: rob+0x1A4 bit 4 is clear (0x121 on 40,
  0x20001 or 0x20005 after it, the board's 0xC..0x123 from 55). w is 79,
  [0x50A004] 1.0 and [0x50A008] 10.0 on both; the gravity is VF2's
  0.0027222 and the board's 0.0252222. r5:
  - rob+0x5D4 0 (frame 40; the board's 55..60): VF2 0.0035843, the board
    0.0083023 board units = 0.0040956 VF2 units (÷ SCALE 2.02714).
  - rob+0x5D4 0.5 (41; VF2 46..60, the board 44..54): VF2 0.0053764, the
    board 0.0124535 = 0.0061434.
  - rob+0x5D4 1.0 (42): VF2 0.0071685, the board 0.0166046 = 0.0081911.
  - rob+0x5D4 1.5 (43): VF2 0.0089606, the board 0.0207558 = 0.0102389.
  At the same rob+0x5D4 the board's r5 is 1.1427× VF2's on every frame:
  the 1.143 read from the code (0.0252222 × 0.25 ÷ 2.02714 = 0.0031106,
  over 0.0027222). r6 (the push's k) is r5 × 10 on both, so 1.1427× too.
  rob+0x5D4 goes up 0.5 a frame while 1P slides, on both, and is reset
  when the speed is zeroed, so the two part from frame 44: 1P's speed in
  on 41 is 0.02289 VF2 units on the board, VF2's 0.03645 (the knockback's
  difference, above); the board zeroes it on frame 43 (|v| 0.00855 under
  r5), VF2 on 45. VF2's rob+0x5D4 is 2.0 and 2.5 on 44 and 45 and 0.5
  after; the board's 0.5 on 44..54 and 0 from 55 (1P is out of the jab
  reaction there, VF2's still in it). The frames whose ratio is not 1.1427
  (44, 45: 0.571, 0.490; 55..60: 0.762) have a different rob+0x5D4, not a
  different formula.
  Ported: after the `mulr r13, r14, r5`, a VF2 fighter (guest_char_game of
  rob+0x1B1) takes r5 = [0x50A004] × 0x3BB4D327 (INSERT `rsc_gra_vf2`
  in tools/board/lift-stf.py); StF's fighters keep
  [0x50A004] × [0x50A000] × 0.25. The same run on the board after it
  (VF2's own run unchanged), frames 40..60: w 79, [0x50A004] 1.0,
  [0x50A008] 10.0, the board's gravity still 0.0252222 (it is not read
  for a VF2 fighter now). r5:
  - rob+0x5D4 0 (frame 40; the board's 55..60): VF2 0.0035843, the board
    0.0072658 board units = 0.0035843 VF2 units.
  - rob+0x5D4 0.5 (41; 46..54 on both): VF2 0.0053764, the board 0.0108987
    = 0.0053764.
  - rob+0x5D4 1.0 (42): VF2 0.0071685, the board 0.0145316 = 0.0071685.
  - rob+0x5D4 1.5 (43): VF2 0.0089606, the board 0.0181645 = 0.0089607.
  - rob+0x5D4 2.0 (44): VF2 0.0107528, the board 0.0217974 = 0.0107528.
  The ratio is 1.0000 on every frame whose rob+0x5D4 matches (40..44,
  46..54), and r6 is r5 × 10 on both, so the push's k matches too. 1P's
  speed in is still the board's smaller one (0.02289 VF2 units on 41,
  VF2's 0.03645: the knockback's difference), so the board now zeroes it
  on frame 44 (|v| 0.00138 under r5), VF2 on 45: rob+0x5D4 differs on 45
  (VF2 2.5, the board 0.5; ratio 0.4286) and on 55..60 (VF2 0.5, the
  board 0; 0.6667), as before, from the knockback, not this formula.
- **The jump's setup (Bean, #1921).** Out of a roll (378, 279), Bean's
  ta_kick (240) crept 0.003 a frame toward Eggman in StF and stood on the
  board. 240 runs `ACT_RC_JUMP`, which steps by the setup op 9's vector
  (rob+0x830/0x834) over its frames (rob+0x5BE), but 240's setup has no
  op 9. It steps by the last one's, and `set_mot_dat` clears none of it
  (the block rob+0x818..0x83F that setup ops 5, 9 and 0xA write; +0x5BC,
  +0x5CC). StF had z 1.0 over 30 frames there, left by its attract demo's
  fight. The board zeroed its robs every round. Two changes:
  - battle.lua zeroes those fields in StF's robs at the picks. A real
    cabinet has run its attract demo, so what is left there is chance,
    and the board starts zeroed. That took Bean's round 1s to 100.
  - The board keeps them from round to round (fighter.c `setup_keep`),
    as StF's round start does. That took the round 2s to 100.

Left as they are:

- Honey's intro pose: StF's motion 15, the board's 507. Fang's intro
  leaves him 0.004 nearer the middle (above, The stf lineup).
- The armour break's replay, on any fighter's 30-damage strike, with the
  menu's FV armour on (above; graded with it off against StF and VF2).
- The board's rounds end 4 or 5 frames before StF's (the winner and the
  energy left are the same).
- Sonic vs Sonic and Sonic vs Honey on Aurora stop MAME, always on the
  same frame of round 1 (501; 1092), whatever the fight did up to it:
  `geo_adsp` (the shared build's Model 2B geometrizer, its own SHARC
  program) runs off into garbage (`invalid single-function operation 03`,
  `multi-function opcode 16 not implemented`, `SET_UREG: unknown register
  63`). The frame's FIFO words are as every frame's (606 of them, laid out
  the same); StF's own runs of the pairings don't stop it. Repro:
  `BT_MENU=30,2,1,0,0,140,5,0 BT_SEED=1`.

## The browser build, every record

The board plays eight fighters; the browser build (`js/`) plays every
fighter record of the three games, so every one of them is graded there,
against itself in its own game. `tools/grade/js-battle.mjs` plays a battle on
`js/engine.js` with battle.lua's input script and writes battle.lua's log
(`setup js`); the grader takes it as the board's. The engine runs one
energy bar (200) for every game, so damage and the energy left are scaled
by the two bars, as for a guest. It fights on the game's arena: the stage
number is only logged.

```bash
tools/mame/roster-battles.sh <dir>       # the source battles, 3 MAMEs at a time
node tools/grade/grade-roster.mjs <dir>        # each one played on the browser build, and graded
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
