# The code StF and VF2 share

The board runs Sonic the Fighters' own i960 code (`board/src/stf_motion.s`,
from `tools/lift-stf.py`) for every fighter, the VF2 guest too. Both games run
AM2's engine, so most of that code has a VF2 version under the same name.
This is the audit of those functions: which are already one code for both
(StF's copy does what VF2's does), and where VF2's differs, what a VF2
fighter loses on the board and how to give it back: guest data
(`tools/vf2-guest.mjs`) when the code is the same and only his values are
StF's, or a branch on `char_game` (lift-stf.py's `INSERT`, as at
`loc_2B9CC`) when the code itself differs.

## How it was read

A function is shared when stfdisasm and VF2's recovered Sega symbols
(vf2-decomp's `original_symbols.csv`, 301 of them, arcade rev 2.1) give it the
same name. `python3 tools/shared-fns.py` finds them, takes each one's body
(what its entry reaches through branches and jump tables, without calls) in
both programs and scores the two (`--out DIR` writes the bodies and a line
diff; `--all` lists the 240 shared names of the whole programs, not only the
lifted ones). Of the board's lifted code, 45 functions are shared. Each
differing one was then read side by side (StF's commented disassembly, VF2's
disassembly, Sega's C where gems-c and ages-decomp have it); the readings
are the appendices. Addresses are StF's (S) and VF2's (V) program ROM.

| | functions |
|--|--|
| shared with VF2 | 45 |
| the same code (13 byte-for-byte, `calc_rob_angle` up to copro protocol) | 14 |
| different code, nothing to do for a VF2 fighter | 17 |
| different code, work for a VF2 fighter (below) | 14 |

## The 45

`insns` is each body's length in instructions (a body that falls into the
next function includes it). The codes in the last column are the work list
below.

| function | StF | VF2 | insns StF / VF2 | verdict | to do |
|--|--|--|--|--|--|
| `print_mes` | 0x5674 | 0x7FC0 | 12 / 12 | same | stubbed |
| `rand` | 0x66B0 | 0x94D0 | 19 / 19 | same |  |
| `rob_action` | 0x12974 | 0x142F4 | 381 / 301 | differs | D1, D2, D3 (his record); face_mot_control is VF2-only (U9) |
| `decide_command` | 0x12A94 | 0x1442C | 297 / 125 | differs | B5 |
| `decide_my_command` | 0x12F98 | 0x14640 | 42 / 42 | differs | nothing (renumbered types) |
| `exec_command` | 0x13040 | 0x146EC | 887 / 614 | differs | D3, D6, B6; U6 |
| `exec_action` | 0x13510 | 0x1499C | 3727 / 1974 | differs | B4, B9, B10, B11; U7 |
| `get_game_info` | 0x16B9C | 0x1645C | 29 / 29 | same |  |
| `calc_unit_mat` | 0x16C44 | 0x16504 | 834 / 863 | differs | nothing (dents, squash, midriff: covered or never armed) |
| `set_coli_ball_data` | 0x17C14 | 0x176A0 | 27 / 20 | differs | nothing (copro protocol, table placement) |
| `rob_revise_yang` | 0x17CA0 | 0x17710 | 157 / 113 | differs | B12 |
| `rob_spd_control` | 0x17F78 | 0x1791C | 133 / 129 | differs | D1 |
| `action_after` | 0x18404 | 0x180BC | 15 / 34 | differs | nothing (VF2 bit 8 of rob+0 is dead on the board) |
| `get_my_info` | 0x18584 | 0x18144 | 254 / 253 | differs | nothing (slow motion, settings bit) |
| `get_en_info` | 0x18A88 | 0x18644 | 694 / 238 | differs | D2 |
| `calc_land_time` | 0x19900 | 0x18C64 | 52 / 47 | differs | nothing (StF branch on a bit nothing sets) |
| `calc_stage_limit_dist` | 0x199FC | 0x18D44 | 41 / 41 | same |  |
| `calc_gyang_from_fu_vec2` | 0x19AB8 | 0x18E00 | 45 / 45 | same |  |
| `calc_gyang_from_fu_vec` | 0x19AC0 | 0x18E08 | 44 / 44 | same |  |
| `comp_set_motion` | 0x1AF70 | 0x19EF0 | 157 / 129 | differs | B7, U3 (falls into set_motion) |
| `set_motion` | 0x1AF78 | 0x19EF8 | 156 / 128 | differs | as set_motion_comm |
| `set_motion_comm` | 0x1AF7C | 0x19EFC | 155 / 127 | differs | B7, U3 |
| `set_mot_dat` | 0x1B26C | 0x1A1E4 | 576 / 544 | differs | D4; U4 |
| `calc_mht_adr` | 0x1BC80 | 0x1AB34 | 13 / 13 | differs | nothing (formats: the converter writes StF's) |
| `play_motion` | 0x1BDA4 | 0x1AB74 | 767 / 572 | differs | D5; U1, U2 |
| `shift_mot_control` | 0x1CD00 | 0x1B568 | 24 / 24 | same |  |
| `air_mot_control` | 0x1CE08 | 0x1B5C8 | 33 / 33 | same |  |
| `collision` | 0x293EC | 0x221E8 | 87 / 41 | differs | nothing (pair and stage level) |
| `decide_coli_kind` | 0x2CFBC | 0x233D0 | 187 / 90 | differs | B3 |
| `coli_cont_cop` | 0x2D36C | 0x23524 | 98 / 65 | differs | nothing (StF's copro program and walls) |
| `decide_dir` | 0x2D588 | 0x2364C | 55 / 17 | differs | nothing (StF adds hysteresis) |
| `coli_recalc_pos` | 0x2D67C | 0x23694 | 345 / 113 | differs | nothing (pair-level push constants) |
| `calc_attack_flag` | 0x2DC48 | 0x238A4 | 21 / 19 | differs | nothing (table id 20 differs; he has no id 20) |
| `area_coli` | 0x2DCA4 | 0x2396C | 253 / 127 | differs | nothing (StF's cage, VF2's ring) |
| `smooth_int` | 0x2F2B0 | 0x27130 | 291 / 334 | differs | B8; U5 |
| `rear_smooth_int` | 0x2F878 | 0x2776C | 215 / 221 | differs | nothing |
| `calc_rob_angle` | 0x2FF08 | 0x27CE0 | 318 / 257 | same | copro protocol only |
| `calc_rob_angle_cont` | 0x2FF2C | 0x27D04 | 309 / 248 | differs | nothing (bones: off_C2058, done) |
| `get_frame_dat` | 0x304C8 | 0x28184 | 290 / 354 | differs | B2; short opponents (U8) |
| `get_start_value` | 0x30A8C | 0x28780 | 171 / 171 | same |  |
| `get_end_value` | 0x30B54 | 0x28848 | 171 / 171 | same |  |
| `get_fcurve_value` | 0x30C24 | 0x28918 | 236 / 236 | same |  |
| `get_fcurve_value_f` | 0x30C28 | 0x2891C | 235 / 235 | same |  |
| `set_mirror` | 0x30E04 | 0x28AF8 | 121 / 121 | same |  |
| `calc_unit_1` | 0x30FE8 | 0x2901C | 200 / 217 | differs | B1 |

## The work list

What Akira loses on the board to the shared code, in order of what is most
seen in a fight and least work. Each is its own change, checked in MAME and
m2-hle2.

Guest data (his values in StF's fields; no shared code changes):

- **D1 Weight.** Record +0x14 is the weight: `action_init` (S 0x1269C) puts
  it into rob+0x7DC and, plus `sub_3261C`'s, into rob+0x5D8, the friction
  `rob_spd_control` divides by. VF2's record keeps it at +0x2C (`init_fix`;
  Akira 79.0). He has Knuckles' 60. rob+0x5D8 has three more readers
  (`stf_motion.s` lines 4781, 14441, 15397) to check first.
- **D2 Ranges.** Record +0x10's first four floats are `get_en_info`'s near
  and far ranges (rob+0x5F4 against them). VF2 reads its own from rob
  0x62C, 0x668, 0x630, 0x634, which `init_fix` (V 0x14218..0x14234) fills from
  record +0x18..+0x24: Akira's 1.4, 1.7, 1.4, 1.4 (×`SCALE`: 2.84, 3.45,
  2.84, 2.84). He has Knuckles' 2.5, 2.5, 1.6, 2.4. VF2 writes the results to
  rob+0x5B8 bits 8, 12, 9, 10, 13, StF to rob+0x720 bits 0..4, and StF's
  0x5B8 bit 8 means something else (the opponent moving away). So his
  command ops 7/0xA on those bits (10 on bit 8, 2 on bit 11) test the wrong
  thing: the converter has to move them to StF's op 0x34/0x35 on 0x720.
- **D3 Jump time.** Record +0x20 points at two bytes, the jump's frames
  (S 0x13270: rob+0x5BE; the second when rob+0 bit 29 or action bit 18 is
  set). VF2's are record +0x4C: 72, and 32. He has Knuckles' 38, 26.
- **D4 VF2's motion patches.** VF2's `set_mot_dat` changes two of Akira's
  setups in code: motion 40 sets 0x804 bit 7, motion 578 flips bit 15 of
  op 0xB's 0x844 word. Both can go into `convertSetup`.
- **D5 Damage op.** Play op 8 (damage) misses the converter's ×140/200;
  Akira has 4 (motions 16 and 44).
- **D6 Importer slip.** `STF_ACTIONS[31]` should be VF2 action 30, not 29
  (harmless for Akira: his 29 and 30 are one motion).

Branches on `char_game` (the shared code differs):

- **B1 Head turn speed.** `calc_unit_1`: with the look gate shut, StF turns
  the head up to 0x2000 a frame, VF2 0x800 (yaw) and 0x400 (pitch). At
  `loc_31220` and `loc_3128C`.
- **B2 Look gate.** `get_frame_dat` shuts the gate on setup flags 0x802C119,
  VF2 on 0x6C111 (StF adds bits 3, 15, 27; VF2 adds bit 18), and StF biases
  the look yaw by the opponent's heading. Needs a new patch point (no StF
  label at S 0x308B4, 0x308D0). Check in MAME which of his motions it
  changes first.
- **B3 Body contact.** VF2's `dck_special_check` (V 0x23398) makes the pair's
  contact BODY when either plays VF2 motion 0x242, 0x241 or 0x6C, three of
  Akira's. StF loads the same ids (S 0x2CFA8) and does nothing with them.
  A guest table of his ids for the three, and a branch at `loc_2CFF4`.
- **B4 Dash.** `exec_action` RUN: VF2 ends the dash at 10, StF at 8
  (`loc_13850`), and VF2 then plays stop action 21 where StF commits a walk
  (`loc_138D0`).
- **B5 Throw bonus.** `decide_command`: VF2 ×1.25 throw damage when the
  victim's rob+0x1A4 bit 0 is set (V 0x14598). At S 0x12E5C.
- **B6 Chained jump.** `exec_command`: VF2 clears bits 16..18 of the old
  action word on a chained jump (V 0x147E8). At S 0x13238.
- **B7 Motion start mask.** `set_motion_comm`: a motion started with g0 0
  keeps kind bits 0x14060 in StF, 0x814068 in VF2 (crouch bit 3 among
  them). At `loc_1B250`.
- **B8 Blend mode.** `smooth_int`: setup bit 18 is front and rear (mode 3)
  in StF, front only (mode 1) in VF2; 21 of his setups. A branch, or bit 18
  moved in `convertSetup` once no other StF reader of it is found.
- **B9 Jump reach and landing.** `exec_action` JUMP: StF's reach is 0.09,
  0.07, 0.16, 0.12 by jump kind, VF2's 0.05 (about 0.10 in StF's units);
  VF2 clamps at the wall and lands in ±0.9, StF ±0.4. At `loc_13EE4`,
  `loc_13F18`.
- **B10 Get-ups.** `exec_action` RISE: VF2 picks among 46 (actions 31..80)
  by wall and ring-edge tests, StF's slots hold 11. His whole 84-entry
  action list as a guest table, and branches at S 0x14D68 and `loc_14DC4`.
- **B11 Crouching moves.** VF2's crouch walk (types 5, 6) and crouch guard
  (type 0xB), which the converter cannot place, and the crouch branches of
  SYAGAMI, WALK/BWALK, TA_GUARD and GUARD. New guest slots and branches at
  S 0x13628, 0x136AC/0x1373C, 0x1390C, 0x13944.
- **B12 Turning.** `rob_revise_yang`: in several paths VF2 turns 5° a frame
  where StF turns 10°, on other rob+0x1A4 bits. Map VF2's 1A4 bits 13, 23,
  27, 28, 30 to StF's first (a 1A4 trace of the same moves in both).

Unknown (what would settle it is in the appendix):

- **U1** play op 0xD sets kind bit 27 in VF2, 25 in StF (23 uses in his
  motions); **U2** play ops 0x10 (154) and 0x14 (4), dropped by the import;
  **U3** set_motion with g0 bit 15: StF clears kind bit 21, VF2 sets it;
  **U4** VF2's `set_mot_dat` patches of his 734, 67, 739, 753 under backup
  byte 0x59C351 bit 6; **U5** `smooth_int`'s VF2 transition block (V 0x27564,
  after his 17 bit-10 setups; StF has it, unreachable, after `loc_2F668`);
  **U6** VF2 action types 0x1D, 0x1E don't restart a running motion, StF's
  type 0 does; **U7** NAGERARE's late resets, StF's mid-air bounce
  (`loc_14174`); **U8** VF2 lowers some look targets against short
  opponents (Pai, Shun, Lion); **U9** VF2 runs `face_mot_control` each frame
  (his face).

Not to do: the 17 that differ without costing him anything are StF's own
features he never triggers, VF2 ones that are dead on the board, protocol
for StF's coprocessor program, or pair and stage code (`collision`,
`coli_recalc_pos`, `area_coli`: StF's cage, VF2's ring) where there is no
single fighter to branch for.

## Appendix: Commands


Notation: S = StF (sfight program ROM), V = VF2 rev 2.1. Commit word = rob+0x194, its
type = top byte rob+0x197 (0x19B, 0x19F the same byte of 0x198 and 0x19C). StF and VF2
number the commit types differently; "V x -> S y" is `COMMIT_TYPE` in tools/vf2-guest.mjs
(0x10->0xC, 0x11->0xD, 0x18->0x14, 0x19->0x15, 0x1B->0x17, 0x1C->0x18, 0xD->9, 9->6 ...).
Everything below that is only that renumbering is class (c), and the importer already handles it
for every type Akira's program commits. Akira's program (walked from V 0x1D1FC[0]) commits VF2
types 0 x39, 9 x13, 0x10 x10, 0x19 x12, 0x1B x11, and with op 6 one each of 0x13, 0x1A, 0x1D, 0x1E.
His data, read from the VF2 set: record (V 0x200620C[0]) = 0x02001208.

### rob_action (with its head, S `action_init` 0x12398 / V `init_fix` 0x13F08)

1. The fighter task. The head runs once per round: it copies the character record (by rob+0x1B0)
   into the rob, plays the stance and stores `rob_action` (S 0x12974, V 0x142F4) at rob+0xC as the
   resume point. `rob_action` is the per-frame body: decide_command (player 1 only), exec_command,
   exec_action, the motion and speed controls, calc_unit_mat and action_after.
2. Verdict: DIFFERS. The per-frame body is nearly the same. The head differs a lot, because the
   two record layouts differ.
3. Differences.
   Per frame:
   - (b) V 0x14310: returns without doing anything when mode byte 0x50002B is 6 or 7. That is a
     game-wide test; StF's mode numbers apply on the board, so it is inert.
   - (b) V 0x14338: g6 (the action-slot table) becomes 0x0201C8E4 if rob+0x1A4 bit 25 is set, or
     0x0201C98C if bit 26 is set; otherwise it is rob+0x1A0. StF (0x129A0) always uses rob+0x1A0.
     Those two tables differ from Akira's own (0x0201C2FC) in entry 0 (590 or 596 instead of 1285)
     and in most entries from 29 on (common reactions 438..482 in place of his 1011..1020). In VF2,
     bit 26 is set only by play op 5 in motions 246, 336, 445, 628, 710, 1258, 1259 and 1282.
     None of them is in his closure: guests.json lost.flagBits has only 16, 18 and 24, and the
     importer drops bit 26 anyway. No VF2 op 5 sets bit 25. For Akira this is inert.
   - (a) S 0x129E0..0x12A00: copies the flags to 0x7EC, the energy to 0x6D2 and 0x70C to 0x1E24
     (previous-frame values). VF2 has none of this. Harmless.
   - (a) S 0x12A54 `original_combo_control` (Super Sonic's timer, by 1B1 == 16, and stage 9).
     VF2 calls only `air_mot_control`. Harmless for 1B1 = 6.
   - (b) V 0x14408 `face_mot_control` (0x4B640): it eases a face pattern (rob 0x6A8..0x6B0), puts
     the head model in parts slot word rob+0x48, and uploads face textures (0x5501C8..0x550228).
     StF has no such call. On the board, his face never changes (BOARD.md: "a head record of one
     frame"). Cosmetic only.
   - (c) the debug test is the same (0x508000 bit 5, then calc_rob_angle_cont).
   Head (record fields copied into the rob, by StF record offset and VF2 record offset):
   - (d)/(c) the same in both: +0 parts to rob+0x40, +4 skeleton to rob+0x8C, +8 to rob+0x1B4, and
     the action table (S +0xC, V +0x14) to rob+0x1A0.
   - **(c) rob_weight rob+0x5D8.** S 0x12698..0x126B8: rob+0x5D8 = record +0x14 (60.0 for Sonic
     and Knuckles) + sub_3261C (a parts-weight sum through ptr_CE1CC, always 0). This is done only
     in the first round, outside modes 0x10/0x11. V 0x14204: rob+0x5D8 = record +0x2C (Akira 79.0,
     Pai 75.0, char 3 66.0). Both games read it the same way: S 0x17FA8 and V 0x1793C in
     rob_spd_control (× 1/60; StF also has an extra × 0.25 there), and S 0x1626C and V 0x22FBC
     (weight − 60, clamped). So BOARD.md's "+0x14 ... no lifted code reads them" is wrong:
     +0x14 is the base weight. Akira now has Knuckles' 60.
   - **(c) reach ranges.** S 0x128B0 copies the +0x10 table's [0], [1], [2], [3] to rob 0x62C, 0x698,
     0x630 and 0x634. No StF code reads those rob fields; StF's get_en_info reads the table itself.
     V 0x14218..0x14234 copies record +0x18, +0x1C, +0x20 and +0x24 (1.4, 1.7, 1.4, 1.4) to rob
     0x62C, 0x668, 0x630 and 0x634. VF2's get_en_info (0x18818..0x18868) compares the distance
     rob+0x5F4 with 0x62C (bit 8), 0x668 (bit 12), 0x630 (the opponent-down branch, bit 9) and
     0x634 (bit 10 or 13). That has the same shape as StF's get_en_info 0x19108..0x19160 with g0's
     +0, +4, +8 and +0xC. This is the VF2 reader BOARD.md was missing: StF table [0..3] = VF2
     record +0x18..+0x24. Knuckles' values are 2.5, 2.5, 1.6 and 2.4; VF2 × SCALE gives 2.84,
     3.45, 2.84 and 2.84.
   - **(c) rob 0x6C8 (S) = rob 0x698 (V).** S 0x128A4 stores record +0x24 (8.0) to rob+0x6C8,
     which exec_action reads at S 0x13FF4. V 0x1423C stores record +0x28 (Akira 3.0) to rob+0x698,
     read at V 0x154D0 in the same code (both feed copro command 0x2D805B5B). Their offsets differ,
     but the role is the same. VF2 also stores 2.5 there for 1B0 == 18 when 0x3351 bit 6 is set;
     that is not Akira. Akira has 8.0 on the board.
   - (b) VF2-only record fields:
     - +0xC goes to rob+0x5EC and to parts words 0x4C, 0x50, 0x58 and 0x5C (`disp_hiji_ptn`, the
       elbow). It is 0 for Akira, so inert.
     - +0x10 goes to rob+0x5F0 (`set_ashi_ptn`, the feet). 0 for Akira, so inert.
     - +0x3C goes to rob+0x67C (`set_te_ptn`). The importer already brings in his hand shapes.
     - +0x40 is a hat struct, to rob 0x700..0x764 (`hat_off_disp`). Its first word is 0 for
       Akira, so inert.
     - +0x48 goes to rob+0x768. It is read only by `sel_pl_p1_nise_add_skip`; meaning unknown.
     - +0x30 goes to rob+0x640, then `send_tex_rob`. The board packs his textures itself, so inert.
     - 1B1 == 3 sets 0x700 bit 3, and 1B1 == 8 calls `sui_ta_kamae_set`. Neither is Akira.
     - 0x500068 bit 25 with the player bit sets 0x700 bit 5 and calls 0x19AAC. Unknown.
   - (a) StF-only:
     - the dent and effect clears (0x1F48.., `fa_rob0`/`fa_rob1`);
     - option data from +0x18 to rob 0x784..0x7F8;
     - +0x1C to rob+0x7CC;
     - +0x28 × the rounds to win, to 0xAF0..0xAF8;
     - the barrier count 0xC70;
     - the position copies 0x6FC and 0x1004..0x1028;
     - `send_init_ram_coli_data`;
     - energy 1 when 0x500068 bit 4 is set (VF2 always takes 0x5000A0).
     All harmless.
   - (d) the zeroed fields are the same list, at VF2's offsets (0x684 -> 0x654, 0x6F4/5 -> 0x6D8/9,
     0x7D0 -> 0x770, ...).
4. Board impact: Akira has Knuckles' weight (60, where his own is 79), Knuckles' reach ranges
   (2.5, 2.5, 1.6, 2.4 instead of about 2.84, 3.45, 2.84, 2.84 at his size) and Knuckles'
   rob+0x6C8 (8.0, where his own is 3.0). Recommendation: no code branch. Give him a record of his
   own in vf2-guest.mjs:
   - +0x14 = 79.0. A mass, so not × SCALE. Mind StF's extra × 0.25 in rob_spd_control; that
     belongs to that function's audit.
   - +0x10 = a copy of 0xC50F8 with [0..3] = VF2 +0x18..+0x24 × SCALE. Its [4..] stay StF's
     until their VF2 equivalents are known.
   - +0x24 = VF2 +0x28. Whether to scale it is unknown: check what copro command 0x2D805B5B
     does with it (exec_action group).
   Leave the face, hat and texture paths as they are.

### decide_command (S 0x12A94, V 0x1442C)

1. It runs decide_my_command for both fighters, then settles commits the two make at once
   (throw against throw, throw escape, a throw that lands: it commits the reaction to the victim
   with the thrower's motion data, the damage byte into rob+0x822).
2. Verdict: DIFFERS.
3. Differences.
   - (c) the type numbers, all mapped by COMMIT_TYPE:
     - 0x19B/0x197 == 12 / 20 / 21 / 23 (S 0x12AB8..0x12B90) = V 16 / 24 / 25 / 27 (0x14450..0x14528);
     - the motion kinds 0x19F 21 / 18 (S 0x12AE0) = V 25 / 22;
     - the committed reaction type 0xD (S `shlo 24,13`, 0x12B48 and 0x12E50) = V 0x11.
   - (d) S rob+0x684 = V rob+0x654 (0x12B80 / 0x14518). The print_mes calls differ only by address.
   - (a) StF-only commit types: 0x22 (S 0x12BB0, reaction 0x23 "airn", copies 0x2C/0x34 to
     0xA10/0xA18, `fix_hara`), 0x20 (0x12C9C, reaction 0x21), 0x1E (0x12D48, reaction 0x1F,
     `fix_hara`) and 0x24 (0x12ECC, reaction 0x25; type 1 if the victim's flags bit 5 is set).
     VF2 has none of these. Akira never commits them (COMMIT_TYPE only produces types up to 0x1A),
     so this is harmless for his own moves. When an StF fighter air-throws him, he gets StF's
     reaction type and motion; whether motion_remap covers those motions is unknown.
   - **(b) V 0x14598..0x145D4: the throw damage bonus.** After `ldob 3(g0),r3` (the damage), it adds
     r3 >> 2 (× 1.25, message " nage") if the victim's rob+0x1A4 bit 0 is set. It adds another
     r3 >> 2 ("sd_nage") if backup byte 0x50016C->0x3351 bit 6 and the victim's rob+0 bit 29 are
     both set. Bit 0 of 1A4 has the same meaning in both games: both set it in play_motion when
     rob+0 bit 12 clears (S 0x1CAE4, V 0x1B4DC). StF has no bonus. So on the board, Akira's throws
     never do VF2's × 1.25.
4. Board impact: Akira's throws lose VF2's 1.25× damage on a victim whose 0x1A4 bit 0 is set.
   Recommendation: branch on char_game[0x1B1(g7)] (g7 is the thrower here) at S 0x12E5C (in
   `loc_12E40`, after `ldob 3(g0),r3` and before `stob r3,0x822(g8)`). For GAME_VF2, if
   0x1A4(g8) bit 0 is set, do r3 += r3 >> 2. Leave out the "sd_nage" bonus until 0x3351 bit 6
   and rob+0 bit 29 are known: VF2 also tests 0x3351 bit 6 in init_fix and type 0x13, and
   rob+0 bit 29 in get_en_info, collision and enemy_control.

### decide_my_command (S 0x12F98, V 0x14640)

1. For one fighter, it settles a new commit against the running one (0x198, 0x684 / V 0x654,
   0x62A). The hold type sets a hold-until frame from the motion's type-15 record bytes 1..2. Another
   type adds 3 frames to 0x1AA.
2. Verdict: DIFFERS (small).
3. Differences.
   - (c) types: S 23 / 24 / 9 (0x12FB8, 0x12FEC, 0x13008) = V 27 / 28 / 13. These are mapped:
     V 0x1B -> S 0x17 and V 0xD -> S 9; V 0x1C (28) -> S 0x18 (24).
   - (a) S 0x1300C also tests type 28 (0x1C), which is StF-only. Akira never commits it. Harmless.
   - (d) 0x684 / 0x654. S reads bytes 1 and 2 separately; V uses `ldos 1(g0)`. Same value.
   - (b) V 0x14678: it doubles that frame count when 0x500068 bit 20 is set (display mode 10,
     which also sets 0x50A004 = 2.0). Live VF2 snapshots have 0x500068 = 0x80004400, bit 20
     clear, so this is inert in normal play.
4. Board impact: none. Recommendation: nothing.

### exec_command (S 0x13040, table 0x1D04C; V 0x146EC, table 0x1B808)

1. It dispatches the commit through an 8-byte table by type. Word 0 is this function's handler;
   word 1 is exec_action's, left to that group. The usual handler stores the word at 0x19C
   (the running action) and clears 0x1B2 and 0x1AE.
   Table sizes: S 44 types (0..0x2B); V 33 (0..0x20). The body file's longer lists run into
   play_motion's table (0x1CA10.. / 0x1B43C..).
2. Verdict: DIFFERS.
3. Index by index (handler word 0). `C` = the common store (S 0x13120 = V 0x147A4, the same
   code); `R` = "if 0x197 == 0x19F return, else C" (S 0x13114 = V 0x14798).

   | idx | StF | VF2 |
   |---|---|---|
   | 0,1,3,4 | C | C |
   | 2 | 0x130F0: 1B1 5/8/9/11 return, else C | C |
   | 5 | 0x13074: set_motion g6+0x2E, or g6+0x30 if flags bit 29 | C |
   | 6 | 0x131E4 (jump, below) | C |
   | 7 | 0x130E4: 1A4 bit 26 ? return : C | 0x14714: set_motion g6+0x24 (action 18) |
   | 8 | C | 0x14708: set_motion g6+0x26 (action 19) |
   | 9 | 0x13418: 19F == 9 -> add to 0x5DC | 0x147BC (jump, = S 6) |
   | 0xA | 0x130E4 | C |
   | 0xB, 0xC | C | C |
   | 0xD | 0x13138: barrier (below) | 0x14950 (= S 9 with 19F == 13) |
   | 0xE | R | C |
   | 0xF | 0x13090: distance-chosen set_motion | C |
   | 0x10 | 0x1344C: search_shift_data_adr | C |
   | 0x11 | C | C |
   | 0x12 | C | 0x14754: set_motion g6+0x1C (action 14) |
   | 0x13 | C | 0x14720: set_motion g6+0x1E (action 15), unless 0x3351 bit 6 and 1AA <= 18 and the same type runs |
   | 0x14 | C | 0x14984 (= S 0x10, shift) |
   | 0x15 | C | C |
   | 0x16 | R | C |
   | 0x17..0x18 | C | C |
   | 0x19, 0x1A | R | C, R |
   | 0x1B | C | C |
   | 0x1C | 0x1305C: 19F == 0x1C return, else 19C (no 1AE clear) | C |
   | 0x1D | 0x13464: store only | 0x14778: R, else set_motion g6+0x20 (action 16) |
   | 0x1E | C | 0x14760: R, else set_motion g6+0x22 (action 17) |
   | 0x1F, 0x20 | C | R, R |
   | 0x21..0x25 | C | (no entry) |
   | 0x26 | 0x131B0: set_motion, 0x600 = opponent position | (no entry) |
   | 0x27 | 0x1318C: 19F == 6 -> set_motion, 1AA = 15 | (no entry) |
   | 0x28, 0x29 | 0x13178: set_motion if motion != 0 | (no entry) |
   | 0x2A | 0x1346C: 0xA08 bit 10 latch | (no entry) |
   | 0x2B | 0x134A8: a jump with its own 0x5BE, 1A4 bit 0 | (no entry) |

   By type, after COMMIT_TYPE:
   - Same: V 0/1/3/4 -> S same, 0xC -> 8, 0xD -> 9 (the same code, 19F 13 vs 9), 0xF -> 0xB,
     0x10 -> 0xC, 0x15..0x19 -> 0x11..0x15, 0x1A -> 0x16 (R = R), 0x1B -> 0x17, 0x1C -> 0x18,
     0x1F -> 0x19 and 0x20 -> 0x1A (R = R).
   - Also the same: V 0x14 is S 0x10 (shift) byte for byte, but COMMIT_TYPE lacks 0x14 -> 0x10.
     Akira does not commit it.
   - (a) V 2 -> S 2: StF's check of characters 5, 8, 9 and 11. Akira (6) takes C, which is VF2's.
     Already in BOARD.md.
   - (a) V 0xA -> S 7 and V 0xE -> S 0xA: StF returns if 1A4 bit 26 is set. For Akira only StF's
     code can set it, since the importer drops it from his motions. Harmless.
   - (a) V 0x11 -> S 0xD: S 0x13138 decrements the barrier count rob+0xC70 and sets 0xC6C = 0x13
     when 1A4 bit 13 is set and 0x70C bit 24 is clear. This is StF's barrier rule; it applies to
     him as to anyone. Harmless.
   - (a) S 5, 0xE, 0xF, 0x1C, 0x1D and 0x21..0x2B are StF-only types. Akira commits none of them;
     StF's own decoder (`loc_1E0A0`) commits 5 and 0xE for him, as BOARD.md says.
   - **V 9 -> S 6, the jump** (S 0x131E4 / V 0x147BC):
     - (a) S 0x131E4: if 19F == 0x2A, keep the type at 0x2A (StF-only).
     - **(b)/(c) S 0x13238 vs V 0x147E8:** on a chained jump (the same type, 1A4 bit 12, 1B2 <= 1)
       StF ORs the whole old word into r11. VF2 first clears bits 16..18 of the old word (`andnot
       7<<16`). Akira's jump words do use bit 18 (0x40029, 0x402A, 0xC0037, 0xC012B, 0xC0414,
       0x140237); bits 16 and 17 never. So on the board an old bit 18 can stay set and pick the
       short-jump time and slot.
     - **(c) jump time rob+0x5BE** (read as frames by exec_action, V 0x1536C). StF takes record
       +0x20 byte 0, or byte 1 when bit 18 or flags bit 29 is set (Knuckles: 38 and 26). VF2 takes
       record +0x4C byte (Akira 0x48 = 72; char 3 88), or the constant 32 when bit 18 is set
       (V 0x14828..0x1483C). VF2 also doubles some of these frame counts in mode 10 (inert). So
       BOARD.md's open item "+0x20 -> rob+0x5BE, VF2 equivalent unknown" is settled: it is VF2
       +0x4C, and 32.
     - (c) the fallback motion when the commit's type-3 record is empty: StF chooses g6+0x38, 0x3A,
       0x3C or 0x3E by bits 21, 18 and old 17; VF2 chooses 0x38, 0x3A or 0x3C by bit 18 and old
       bit 17. So StF slot 31 (0x3E) is VF2 action 30, but STF_ACTIONS[31] = 29. That does not
       matter for Akira (his actions 29 and 30 are both motion 726), but it would for another VF2
       guest. Bit 21 never appears in his words.
     - (c) the type cleared to 0 when 1A4 bit 12 is clear: S andnot 0x6040000, V andnot 0x9040000
       (bit 18 plus the type's own bits). The same behaviour.
     - (a) StF-only: flags bit 29 paths (S 0x13270, 0x132B8, 0x13374), 0xA08 bit 9 (return) and
       bit 25 (0x133A0..0x133B0), bit 23 (skip set_motion). None of bits 21 or 23 is in his words;
       0xA08 is StF's own state.
     - (b) V 0x14934: 0x5C0 doubled under 0x500068 bit 20 (inert).
   - **(b) VF2 types played straight from the action table:** 7, 8, 0x12, 0x13, 0x1D, 0x1E
     (actions 18, 19, 14, 15, 16, 17). COMMIT_ACTION turns them into StF type 0 with the action's
     motion, and S type 0 = C, which always restarts the motion: 1B2 = 0, so exec_action's
     ACT_RC_MOTION calls set_motion again. VF2's 0x1D and 0x1E return when the same type is
     already running, and 0x13 does when 0x3351 bit 6 is set. Akira's program commits 0x13, 0x1D
     and 0x1E once each (op 6, at V 0x34D27 area: 0x34D3F, 0x34D52, and 0x13 at the op-6 site
     listed in guests.json commitsAsAction = 3). His actions 16 and 17 are motions 66 and 64.
4. Board impact:
   - (i) His motion is restarted if the script commits 0x1D or 0x1E again while it is playing.
     Unknown whether it does: a script may commit once per input or every frame.
   - (ii) A stale bit 18 on a chained jump.
   - (iii) Knuckles' jump time 38/26 where his own is 72/32. VF2's jump is long; this is probably
     the most visible gap.
   Recommendations:
   - (iii) A record +0x20 of his own in vf2-guest.mjs: bytes {72, 32}, the frames; no SCALE.
     Then check that exec_action's use matches (V 0x1536C divides the height by it).
   - (ii) Branch on char_game at S 0x13238 (`ld 0x19C(g7),r3` / `or r3,r11,r11`): for GAME_VF2,
     clear bits 16..18 of r3 first.
   - (i) Settle it first. In MAME, hold the input that reaches 0x1D or 0x1E and watch Akira's
     rob+0x1AA. If it keeps going back to 0, have the converter use a guest commit type whose
     exec_command handler is R and whose exec_action handler plays 0x19C's motion the way
     ACT_RC_MOTION does. The candidates are StF 0x16 (0x137E4), 0x19 (0x16558) and 0x1A
     (0x16594); the exec_action audit has to say whether one of them does.
   - Optionally add 0x14 -> 0x10 to COMMIT_TYPE (the same handler), for other guests.

## Appendix: Actions (exec_action)


StF labels are from rom_code1.asm (ACTUAL_MOVES, line 28271). VF2 addresses are from the ROM and vf2-decomp's original_symbols.csv. "Slot n" means StF g6 slot n, i.e. halfword n of the character's action list. tools/vf2-guest.mjs fills it with VF2 action STF_ACTIONS[n]. "Action n" means index n of Akira's VF2 action list (84 entries). "Slow mode" is 0x500068 bit 20. VF2 sets it in display mode 10 (0x1fd14, along with gravity 0x50a000=0x3a3117c4 and 0x50a004=2.0), and the board never has it. In StF, 0x500068 is not_scr_bg_move, so the bit means nothing there.

### exec_action (StF ACTUAL_MOVES / VF2 0x1b80c)
- Returns if rob+0x19C is 0. Otherwise it jumps to handler[rob+0x19F]. That byte is the committed command type, so this runs the per-frame half of the current command.
- DIFFERS, mostly in the tables.

#### Tables
- StF: {action, command} pairs with stride 8. action[i] is at 0x1d050+8i and cmd[i] at 0x1d04c+8i (SOMETHING_MOVES). There are 44 types (0..43); index 44 runs into _uk_player_actions (0x1d1b0).
- VF2: cmd[i] is at 0x1b808+8i and action[i] at 0x1b80c+8i. There are 33 types (0..32); index 33 (0x1ad98) is the next table.
- The board translates the guest's commits with vf2-guest.mjs:
  - COMMIT_TYPE: VF2 0-4 stay 0-4, 9→6, a→7, c→8, d→9, e→a, f→b, 10→c, 11→d, 15..1c→11..18, 1f→19, 20→1a.
  - COMMIT_ACTION: VF2 types 7, 8, 12, 13, 1d and 1e become a type-0 play of actions 18, 19, 14, 15, 16 and 17.
  - The converter throws on types 5, 6, b and 14.
- The pairs below follow that map (VF2 n → StF m).

#### Same (apart from commit-type renumbering, class d rob offsets, or action slots that STF_ACTIONS converts, class c)
- 0→0 ACT_RC_MOTION (0x149b8 / 0x1352c): identical.
- Ret-only types: VF2 20, 27 and 28 (0x149b4) are ret-only, like StF 16, 23, 24 (0x13528) and 29 (0x165d0).
- 21→17 (0x161f4 / 0x163a0): identical, 77 instructions.
- 16→12 ACT_RC_NAGE (0x15f04 / 0x15210); 25→21 KAWASHI (0x15e28 / 0x14f34); 23→19 (0x15fe8 / 0x16120); 22→18 KAESHI (0x15dc8 / 0x14ed4). These are the same except for renumbering: shlo 24,9 vs 24,13; cmp 13 vs 17; 3<<26 vs 1<<28; 13 vs 17. KAESHI jumps into KAMAE, so KAMAE's differences apply to it.
- 15→11 YARARE (0x151e0 / 0x13ae8): the same, except that StF clamps rob+0x5de to ≥0 at 0x13b04 (a, harmless).
- The FUMIKOMI step body (StF ACT_RC_FUMIKOMI 0x137cc, used by StF 5, 14, 15) is the same code as VF2 0x14dac, used by VF2 7, 8, 18, 19, 29, 30. It is 6 instructions and ends at frame 0x1aa ≥ 0x800. The board does not run it for Akira, because COMMIT_ACTION turns those types into type-0 plays. The two games' command handlers for those types differ (VF2 cmds 0x14714, 0x14708, 0x14754, 0x14720, 0x14778, 0x14760); that belongs to the exec_command audit.
- These helper calls are the same code in both games:
  - VF2 0x1b654 / 0x1b668 / 0x1b694 = StF sub_1CE94 / sub_1CEA8 / sub_1CED4. StF passes 0x83e/0x843/0x828 through globals 0x50fe00-03, and VF2's 0x230d4 = StF sub_2B94C.
  - The shared tail VF2 0x14b18 = StF 0x13670, an opponent 1a4-bit-8 frame sync.
- Layout (d) everywhere:
  - VF2 0x6b2/0x6b4/0x6bc/0x6d9/0x698 = StF 0x6d0/0x6d4/0x6d8/0x6f5/0x6c8;
  - VF2 0x818 vs StF 0x872 in NAGERARE (probably layout, unconfirmed).

#### Differences
1. **KAMAE**, 1→1 (StF 0x13560 / VF2 0x149ec).
   - StF loc_135DC: under w0 bit 29, plays slot 1 instead of slot 0 (a). w0 bit 29 is set only by StF's play op at 0x1C7D0 when rob+0x84C == 2, i.e. never for Akira.
   - VF2 0x14a68: if 1b1 == 8, calls sui_ta_kamae_set 0x1b74c (b, another fighter).
   - Board: nothing.
2. **SYAGAMI** (crouch), 2→2 (0x135fc / 0x14a88).
   - VF2-only, at 0x14ab4: when crouched, not already in the crouch motion, and 0x810 bit 7 is set: if 0x804 bit 13, plays action 11 (motion 0xe6), via 0x1b654 when 1a4 bit 1, else plain set_motion (b).
   - StF 0x13628 returns on bit 2 and otherwise plays slot 4.
   - Board: Akira never gets action 11, because no StF slot maps to it. The impact is unknown (it is a crouch-transition motion choice). Recommendation: a branch on char_game at StF 0x13628 that plays action 11, which needs a guest slot holding it (STF_ACTIONS has none). A board check of crouching from a crouch-kind motion with 0x810 bit 7 would settle whether it shows.
3. **WALK / BWALK**, 3→3 and 4→4 (0x136ac, 0x1373c / 0x14b54, 0x14be4).
   - (a) StF has a w0-bit-29 branch (loc_136FC), harmless.
   - (b) VF2 0x14b5c / 0x14bec: when crouched (1a4 bit 3), plays action 3 / 4. Under w0 bit 10 the motion is 0x46c / 0x46d instead. It goes via 0x1b654 unless 0x810 bit 7 is set.
   - (b) VF2 0x14b94: if !1a4 bit 10, !w0 bit 0 and 0x810 bit 7, plays action 3 / 4 via 0x1b668 (blend).
   - (c) Under w0 bit 10, StF plays slot 13 / 15 (actions 20 / 22), where VF2 plays the literal motions 0x2e9 / 0x2e8.
   - Board: Akira walking out of a crouch, or out of a 0x810-bit-7 motion, starts the walk without VF2's blend or crouch handling. w0 bit 10 is set by the same code in both games (VF2 0x655f8, StF ~0x68ab0, from 0x500064), and its meaning is unknown. Recommendation:
     - Branch on char_game at StF 0x136ac / 0x1373c and run VF2's prologue (crouch test, then 0x810 bit 7 blend through sub_1CEA8).
     - Whether the 0x2e8/0x2e9/0x46c/0x46d literals matter depends on what w0 bit 10 means. If they do, the motions need guest ids.
4. **JUMP**, 9→6 (VF2 0x15308, 191 instructions / StF 0x13dc0, 655 instructions).
   - (a) w0 bit 29 skips set_motion (0x13df4, 0x1410c); a08 bit 25 test at 0x14114.
   - (a) StF-only mid-air block 0x14148-0x14870. It runs when w0 bit 2 is set in phase 2 (VF2 returns at 0x155f8) and is gated by a08 bits 26/6/12/25/29/30 and by [0x500828]+0x164. Its loc_14174 path sets a08 bit 29 (a bounce that halves velocity) for any fighter whenever [0x500828]+0x164 ≠ 0. The meaning of 0x164 is unknown. If it is nonzero in a board match, Akira bounces where VF2 never does (harmful).
   - (a) Landing, loc_14870: a08 bit 29 scales velocity by 0.8 instead of zeroing it. This follows from the bounce above.
   - (c) Horizontal reach:
     - StF: airtime × rob+0x724 (0.09), or 0x728 (0.07), 0x72c (0.16), 0x730 (0.12) by 19c bits 17/18/21. These come from the character record's +0x20 table at 0xC50E4, which every StF character shares, Akira's (Knuckles') record included.
     - VF2: airtime × 0.05 (0.025 in slow mode).
     - With vf2-guest.mjs SCALE ≈ 2.03, VF2's 0.05 is ≈ 0.10 in StF units. That is close to StF's 0.09, but StF varies it by jump kind and VF2 does not.
   - (b)/(c) Landing clamp:
     - VF2 0x15444 clamps to (0x5f8 or 0x5fc) − 0.6 (a wall/stage limit) and keeps the landing out of the opponent's ±0.9 band.
     - StF has no wall clamp and uses a ±0.4 band, skipped on 19c bit 21.
     - StF also has an extra rule at 0x13f40 (0x5f4 < 0.8 and the opponent's 0x710 > 1.35).
   - (c) Target jump (19c bit 20): StF reads 0x6c8 and adds 0x8000 to the angle when 5b8 bit 0; VF2 reads 0x698 with no flip.
   - (c) Sound ids: StF 0xae1100/0xae1101 vs VF2 0x9e0e5f/0x9e0d5f. The board needs the guest's sound mapping here, if sounds are carried over at all.
   - Board: Akira's jumps go about 0.09 instead of about 0.10 (×0.07-0.16 by kind), and land closer to the opponent (0.4 band, not 0.9) with no wall clamp. Recommendation: branch on char_game at loc_13EE4 / loc_13F18 to use 0.05×SCALE, VF2's ±0.9 band and the wall clamp. The bounce depends on [0x500828]+0x164; reading it during a board match would settle that.
5. **TA_GUARD**, a→7 (VF2 0x14e78, 32 instructions / StF 0x1390c, 13 instructions). Everything here is VF2-only (b):
   - If the opponent's 0x6b4 bit 0 (StF 0x6d4) is set, calls 0x1b694 (= sub_1CED4) and clears 1a4 bit 0.
   - When crouched, plays action 12 (motion 0xe8) instead of action 8.
   - 0x810 bit 7 blends.
   - StF always plays slot 5 (action 8).
   - Board: Akira's crouching guard start shows the standing guard motion, and he misses VF2's opponent-side sync. Recommendation: branch on char_game at StF 0x1390c and run VF2's body. That needs a guest slot for action 12.
6. **DOWN**, c→8 (VF2 0x1564c / StF 0x14b90).
   - (b) VF2 0x156b0: slow-mode velocity add (n/a).
   - (a) StF 0x14c2c: sub_32948 (rob 0x1f4 → 0x50a3fc, 0x50a414 = 6, 0x50a416 bit 2, call 0x32a5c).
   - (a) StF 0x14c58: [0x500814]+0xfc = 0.15 when rob+0x1c ≤ −100.0. This looks camera-like; its meaning is unknown.
   - (a) StF 0x14c90: angle offset ∓0x520 under w0 bit 6.
   - (d) 0x6f5 vs 0x6d9; type 9 vs 13 (renumbering).
   - Board: the StF-only effects are presumably presentation; their effect on Akira is unknown. Recommendation: nothing, unless a board check shows a camera jolt or wrong down angle.
7. **RISE** (get-up), d→9 (VF2 0x157dc, 301 instructions / StF 0x14d00, 105 instructions). This is the biggest difference.
   - Phase 1: StF plays slot 40 (action 31). VF2 plays action 31, or action 32 when 1a4 bit 11.
   - Phase 3 (StF loc_14DC4 / VF2 0x158a4):
     - StF switches on 0x19e cases 6, 5, 9, 10 and default, giving slots 41-50 by 5b8 bit 0.
     - VF2 switches on 0x19e cases 2-9, 11, 12 and default. It adds 1a4-bit-11 variants, wall-distance tests (0x5f8/0x5fc ≥ 2.5) and stage-edge tests against 0x50a00c (±0.2, with a 0x461c4000 sentinel).
     - VF2 picks among actions 31-80. STF_ACTIONS covers only 31, 34, 35, 36, 38, 39, 40, 50, 51, 54 and 60.
   - VF2 clears w0 bit 29 at 0x158cc. Shun (1b1 == 8) gets a 60-frame delay.
   - Phase 4: StF also ends on w0 bit 15 and clears 1a4 bit 0 (loc_14E98).
   - Board: most of Akira's VF2 get-ups (about 35 of the 46 actions) can never play, and the ones that do are chosen by StF's rules. Recommendation:
     - Needs a guest table: Akira's full VF2 action list (all 84 entries) reachable from the board.
     - Branch on char_game at 0x14d68 (phase 1) and loc_14DC4 (phase 3) to run VF2's selection.
8. **GUARD**, e→a (VF2 0x1502c / StF 0x13944).
   - VF2 0x150d8 plays action 10 when crouched and action 8 standing. StF always plays slot 5 (action 8). The sub_1CED4 call offsets are layout.
   - Board: Akira's crouching guard plays the standing motion. Recommendation: branch on char_game at StF 0x13944 to choose action 10 when 1a4 bit 3, which needs a guest slot for action 10. Like item 5, it is only reachable once crouch guard commits (see VF2-only type 11 below).
9. **NAGERARE** (being thrown), 11→d (VF2 0x16030 / StF 0x152f4). VF2 17 is structurally closer to StF 33 (loc_15C48).
   - (b) VF2 0x1608c-0x160d0: at frame ≥ 0x85a, clears w0 bit 4, sets 0x198 = 1<<24 and clears 1a4 bit 6. If 0x804 bit 20 is set, it sets 1a4 bit 6 and 0x812 = 0x8000.
   - (b) VF2 checks the [0x500028] clock > 0 before the damage path.
   - (c) 0x5de: StF accumulates it on 0xa28 bit 0; VF2 doubles it in slow mode.
   - (a) StF 0x15448 clears 1a4 bit 0 when 0x802 == 0; VF2 doesn't.
   - Board: Akira being thrown misses VF2's late-frame state reset. The effect is unknown. It would be settled by a board check of Akira thrown at round end (clock 0) and the frame after release. Recommendation: none until then.
10. **StF 20 / VF2 24** (StF loc_164DC / VF2 0x16330), an action played backwards (frame −= 2).
    - VF2 first: if the motion is 0x209-0x20e, it plays stance (action 0, or Shun's) and ends.
    - VF2 (gated by [0x50016c]+0x3351 bit 6): with motion 0x2f0/0x2f1 and frame < 6, sets 1b2 = 1.
    - The end test differs: VF2 ends at frame < 0, StF at frame < 2.
    - The thresholds differ: StF early-outs on 0x842 and thresholds on 0x841; VF2 uses 0x842.
    - StF also clears 1a4 bits 8 and 1 and sets bit 2.
    - Board: the reversed action ends 2 frames early for Akira (c), with different flags. Recommendation: branch on char_game at loc_164DC to run VF2's end test. The impact is small, and which of Akira's commits use type 24 is unknown.
11. **RUN**, 1a→16 (VF2 0x14dc4 / StF 0x137e4).
    - (a) StF 0x13804: no restart when 0x5f4 ≤ 3.0 and the motion is slot 8.
    - (c) Phase-1 frame threshold: 8 at loc_13850 vs 10 at VF2 0x14df8.
    - (c) Phase 2 with 5b8 bit 2 clear: StF commits type 3 (loc_138D0, 0x03000000 into 0x19c), where VF2 plays action 21 (0x2a).
    - (a) StF loc_138E4 keeps going while the motion is slot 7 and frame ≤ 15; VF2 just ends.
    - Slots 25-27 are actions 81-83.
    - Board: Akira's dash ends 2 frames early and turns into a walk instead of VF2's stop motion. Recommendation: branch on char_game at loc_13850 (threshold 10), and at loc_138D0 play action 21 (slot 11 or 19) instead of committing type 3.
12. **StF 25/26 / VF2 31/32** (StF 0x16558 / 0x16594). StF plays slots 13 / 15 (actions 20 / 22); VF2 plays the literal motions 0x2e9 / 0x2e8 (c). Board: unknown, the same question as the w0 bit 10 literals in item 3. It is settled by checking whether 0x2e8/0x2e9 differ from Akira's actions 22/20 (0x4b/0x4d).

#### Types only one game has
- VF2-only: these never reach the board, because the converter throws on them.
  - 5 / 6 (0x14c74 / 0x14d10): crouch-walk down+forward / down+back. VF2's decoder commits them. They use actions 6/24/25 and 7/26/27, and literals 0x46a/0x46b under w0 bit 10.
  - b (0x14f04): crouching guard, committed at VF2 0x1c034 on guard+down. When the opponent's 0x6b4 bit 1 is set, it calls 0x230d4 from the opponent's side. It uses actions 10/13.
  - Board: Akira cannot crouch-walk or crouch-guard as VF2 does. Recommendation: map them to new board types. That needs StF handlers (a guest table entry), or branches in SYAGAMI/WALK on char_game, plus guest slots for actions 6, 7, 10, 13 and 24-27. It also needs the exec_command audit to agree.
- The step types 7, 8, 12, 13, 1d and 1e: same body as StF FUMIKOMI (above). They are turned into type-0 plays, so they are not missing.
- StF-only: 27 KABEHIT, 28 UKEMI, 30-35 (loc_1560C, loc_156EC, loc_15A4C, loc_15C48, loc_15DFC, loc_15EE8), 36 KABE_NAGE, 37 j_ACT_RC_NAGERARE, 38 DOWN_ATTACK, 39 loc_159B0, 40 DOWN_NAGE_TOUCH, 41 NAGE_TOUCH, 42 sub_165D4, 43 sub_168DC (second jump).
  - Akira's program never commits these (a). They can still be entered from StF-side code such as walls, ukemi or the opponent's throws. Each one plays slots ≤ 51, and STF_ACTIONS fills those with the nearest VF2 action, so they play something plausible. Whether StF-side code puts Akira into one of them is unknown; a board check against a wall would settle KABEHIT/KABE_NAGE.

## Appendix: Motions


StF addresses are from rom_code1.asm (Sega's labels where it has them). VF2 addresses are from vf2-decomp's original_symbols.csv. "Akira's" means the id is among the 328 VF2 motion ids that tools/vf2-guest.mjs carries over. Counts of Akira's play ops come from his VF2 setups in that same set: op 1 x23, 2 x1, 3 x1, 4 x148, 5 x60, 6 x46, 8 x4, 9 x25, 0xa x101, 0xd x23, 0xe x7, 0x10 x154, 0x12 x132, 0x14 x4, 0x16 x2, 0x17 x16. He has no 0x7, 0xb, 0xc, 0xf, 0x11, 0x13 or 0x15, and no setup kind word with bit 23 set.

"Gated" means it runs only when the VF2 byte 0x59c351 (backup-SRAM settings copy, [0x50016c]+0x3351) has bit 6 set. vf2-decomp calls this "VF2_GAME_DISP_MODE_OFFSET"; what it means is unknown. Finding where VF2 sets that bit (its test menu or the attract code) would settle every gated item below.

### calc_mht_adr (StF 0x1bc80 / VF2 0x1ab34)
- Finds setup op type g1 in motion g0's setup record. It skips the header and walks the ops by the length table until it reaches 0 or 8.
- DIFFERS, class (c) only: setup table 0xce380 vs 0x200d34c, header 13 vs 8 bytes, op-length table 0x1d006 vs 0x1b7f6.
- Board: nothing. convertSetup writes StF's 13-byte header and StF op numbers and lengths.

### comp_set_motion / set_motion / set_motion_comm (StF 0x1af70 / 0x1af78 / 0x1af7c; VF2 0x19ef0 / 0x19ef8 / 0x19efc)
- Start a motion. They set the kind flags (0x1A4), the turn and move, the motion id (0x1A8) and frame 1 (0x1AA), call set_mot_dat, then set up the angle and smoothing. comp_set_motion sets r10=1, which turns the fighter to gyang.
- DIFFERS:
  1. 0x60c is cleared as a byte by StF (stib, 1af88) and as a short by VF2 (stis, 19f08). VF2's play op 0xa also writes it as a word. (d), the field is a different size. Board: nothing (the lifted code is consistent with itself).
  2. VF2 19f44-19f94, gated: if the id is in table 0x1b98c (288, 926, 934, 928, 610, 622, 623, 640, 422, 421, 417), set w0 bit 29. (b). None of these is Akira's. Board: nothing.
  3. VF2 19ff8-1a004: if the old kind has bit 23, rob+0x1c (y) = [0x50a010] (probably the floor height; unknown). (b). No Akira kind has bit 23. Board: nothing.
  4. StF 1b060-1b158 (loc_1B044 .. loc_1B15C): delete_option (0x1cb3c) when w0 bit 27 is set, i.e. StF's options. (a). Akira makes no options (no play op 0x11). Board: nothing. The existing motion_remap INSERT at loc_1B044 sits here.
  5. VF2 1a048/1a054: in slow mode (0x500068 bit 20, set by chk_slow_stage 0x2954c and change_scene 0x1fd5c), call 0x1a138, which doubles the frame fields 0x800, 0x808, 0x80a, 0x80c, 0x80e, 0x816, 0x818, 0x81a, 0x841, 0x842, 0x84d, 0x84e, 0x850, 0x858. (b). The board has no slow mode. Board: nothing.
  6. StF 1b160-1b180: coma = 4 when w0 bit 18, kind bit 8 and not 0x1e18 bit 8. (a). Bit 18 comes from the Super Sonic (0x70c) path, which Akira never takes. Board: nothing.
  7. VF2 1a05c-1a078: set the move flag if [0x508000] bit 16 is clear, rob+0x1b1==8 (another VF2 fighter), old kind bit 9 is set and new kind bit 9 is clear. (b). Not Akira. Board: nothing.
  8. g0 bit 15 path: StF 1b19c always does notbit 21 on r8; VF2 1a090-1a098 does setbit 21, and only when w0 bit 6 is clear. (c), or a real change in behaviour. Board impact: unknown. It would be settled by finding which of Akira's set_motion calls pass g0 bit 15, and what kind bit 21 does in each game.
  9. Smoothing counter at StF 0x6d0 vs VF2 0x6b2. (d). Board: nothing.
  10. VF2 1a0ac-1a0b4: yang = gyang when the new kind has bit 23. (b). No Akira kind has bit 23. Board: nothing.
  11. StF 1b210-1b244 (loc_1B210 .. loc_1B240): handling of 0x1246/0x1248. (a). Its last store goes to 0x1224, which looks like a typo for 0x1246 (unconfirmed). Board: nothing for Akira.
  12. g0==0 mask at loc_1B250: StF ANDs with 0x14060; VF2 (1a11c) ANDs with 0x814068, so it also keeps bit 3 (crouch) and bit 23. (c). Board: when a motion is started with g0==0, Akira loses kind bit 3 where VF2 keeps it, so a crouching motion started this way is not marked as a crouch. Impact unknown, since I did not count which of Akira's starts pass g0==0. Recommendation: a branch on char_game at loc_1B250 that uses 0x814068 for GAME_VF2. A board test of a crouch-to-crouch chain on Akira would settle whether it is needed.

### set_mot_dat (StF 0x1b26c / VF2 0x1a1e4)
- Reads the motion's setup record. The header gives the kind word (0x804) and 0x810.., then the setup ops run through a jump table: StF has 25 cases (table 0x1b568), VF2 has 18 (table 0x1a350).
- DIFFERS:
  1. StF-only clears and setup (a): 0x87a, 0x86c, 0x870, 0x872, 0x864, 0xa25, 0xa28, 0xacc, 0xc60, 0x2a92, 0x2a94, w0 bits 16/17, 0x7f0 bit 16; the 0x2a70 head list (0xc540c, indexed by 0x1b0); the block for 0x500030==9; zeroing 0x2068 and 0x20f0; 0x70c/0x860 from header bytes 4-7 and 0x84c from byte 12 (zero in converted headers); the 0xc6570 setup at 1b510. Board: nothing. These are StF state, and the zero header bytes keep Akira off them.
  2. VF2 hard-coded patches by motion id (b), ungated:
     - id 40 (Akira's): 0x804 |= bit 7 (1a26c-1a274). LOST on the board. Recommendation: a guest data fix in vf2-guest.mjs convertSetup: h[0] |= 0x80 for VF2 id 40.
     - ids 219 and 411: clear kind bit 25. Not Akira's. Nothing.
     - op 0xb (1a8f0, word into 0x844): notbit 15 for ids 578, 550, 802, 528, 529, 38, 707, 691, 290, 604, 630, 632. 578 is Akira's. LOST on the board. Recommendation: a guest data fix in convertSetup that flips bit 15 of the 0x844 word in id 578's op 0xb.
     - op 2 (1a420): 0x12e -> 0x49 and 0x375 -> 46. Not Akira's. Nothing.
     - op 4 strike: id 0xbd sets 0x82a=0xbff4; 0x12e adds +9 damage. Not Akira's. Nothing.
  3. VF2 gated patches (b):
     - 734 clears kind bit 4.
     - 67 sets w0 bits 29 and 11.
     - op 0xc (1a9d8): 739 sets 0x841=10.
     - op 4 (1a694 bbc skips to 1a710 when the bit is clear): 753 changes 0x828 bit 14, 0x85f and damage 29.
     - 734, 67, 739 and 753 are Akira's. The others are not: 996/997 (0x1218), 800 and 0x162 in op 4, 0x12d and table 0x1b9a2 (70, 820, 818, 821) in op 2, 752, 653, 817, 688, 692.
     - With the bit set, op 2 also stores 0x80a=0x80c (1a530).
     - Board: unknown. They matter only if the board should behave as VF2 does with that mode bit set. Recommendation: unknown until the meaning of 0x59c351 bit 6 is known. If the bit is on in the arcade default, these four become guest data fixes like id 40.
  4. Damage x(100+5*rob+0x69c)/100 in VF2's op 4 (1a710), op 5 (1a7a0) and op 0xe (1aae0). (b). 0x69c is per fighter, loaded from [0x500168]+0xfff/0xffe at 0xb688/0xb6a0 (probably a handicap setting) and raised by play op 0xf, which Akira does not use. At the default of 0 it is x1.0. Board: nothing. The converter's own x0.7 rescale is a separate choice.
  5. Layout (d): script pointer 0x6ec vs 0x6d0; 0x6da vs 0x6be; the byte pair 0x840/0x841 (StF) vs 0x841/0x842 (VF2); mirror table 0xce0cc vs 0x2007c78. Board: nothing (the converter already writes StF's layout).
  6. StF-only setup cases 18-24 (a): 0x864..; 0x802/0x86c..; 0x870; damage by distance at 1bbcc; 0x87a. Also the strike op's write to 0x50a284/0x50a30c and its call to 0x132c. Akira's converted setups never emit these. Board: nothing.
  7. VF2 op 0xe (1aa30), damage interpolated by distance: I did not compare it with StF's op 0xe. Unknown. The converter copies op 0xe unchanged, so a side-by-side read of StF's case 0xe would settle it. Akira uses setup op 0xe only if his records carry it (not counted).

### play_motion (StF 0x1bda4 / VF2 0x1ab74)
- Runs one frame of the motion. It advances the frame, chains to the next motion at the end, then runs the play ops due on this frame through a jump table: StF 0x1d1ac with 44 cases, VF2 0x1b910 with 24.
- DIFFERS. Loop head and tail:
  1. StF 1bda8: the whole advance is gated on w0 bit 31. When the bit is clear, only ops with bit 7 set run (1c0b4-1c0cc). The tail is gated the same way. (a). Board: nothing.
  2. StF 0x86c alternate next motion; StF copies 0x70c to 0xc58 and clears 0x1248; extra window test at 1beec (w0 bit 18); the Super Sonic block 1bf48-1c084 (already in BOARD.md). (a). Board: nothing.
  3. Next motion 0xfffe calls 0x1b74c in VF2 (b). At the motion's end, VF2 calls 0x1b74c if 1b1==8, else takes (g6)[0]; StF takes (g6)[0], or (g6)[2] when w0 bit 29 is set. Board: nothing for Akira (1b1=6; the converter does not emit 0xfffe, or the id closure would have thrown).
  4. VF2 gated id patches at 1acb4-1ad54: 734 (Akira's) sets kind bit 4 at frame 16 and clears it at 28; also 0x8d, 0x8b, 0x99; 0x59/0x5b set bit 24 at frame 20. (b). Board: unknown, tied to 0x59c351 bit 6 as in set_mot_dat.
  5. VF2 slow-mode frame doubling at 1ad74 (b). Board: nothing.
  6. Script pointer 0x6ec vs 0x6d0 (d).
  7. Tail, bit 20 turn: StF sets gyang from 0x870 when that is set, else flips; VF2 always flips. Equal for Akira (0x870 stays 0). VF2's 0x6c4 timer loop (1b4e8-1b52c) belongs to its op 0x12 (below).
- Ops, VF2 -> StF as the converter maps them:
  - 0x1 -> 1: SAME.
  - 0x2 -> 2: commit type 13<<24 in VF2 vs 9<<24 in StF (c). The converter already maps it. Nothing.
  - 0x3 -> 3: same, apart from VF2's slow mode and a gated id 0x324 (r6=0x421c0000 at low energy). It calls VF2 0x18b14 vs StF 0x197c8 (names not checked). Nothing.
  - 0x4 (sound): dropped, x148. Harmless (BOARD.md: sound stubs).
  - 0x5/0x6/0x7: SAME (the converter filters op 5's flag bits; see BOARD.md).
  - 0x8 -> 8 (damage):
    - VF2 scales by the opponent's 0x69c, has a gated id 0xf9 -> 20, calls ketchup 0x18ac8 and stores 0x1e20(g8).
    - StF uses the raw damage, adds into 0x5de/0xa28 and stores 0x1f70(g8). It makes no ketchup call. (c)+(a).
    - Akira uses it 4 times, in motions 16 (twice, 10) and 44 (15, 25).
    - The converter does not apply its x0.7 damage scale here, while it does in setup ops 4/5. Board: those four hits do VF2's full damage on StF's scale. Recommendation: a guest data fix that sends op 8's damage byte through damage() in convertSetup, if the x0.7 rescale is meant to cover all of Akira's damage. The blood (ketchup) splash is lost; that is unknown, and probably cosmetic.
  - 0x9 (voice): dropped, x25. Harmless.
  - 0xa -> 0xa (input-match branch):
    - VF2 exits early when 0x50002c==8 and 0x500034==0x20 (a mode; unknown). Ids 0x485/0x486 force r10=1 (not Akira's). The direction mirroring is inline.
    - StF calls 0x1caf4 and has an r6==1 energy test.
    - Both write 0x60c=31 and 0x852/0x853. (c).
    - Akira uses it 101 times. Board: probably nothing. Unknown whether StF's energy test (r6==1) ever fires for his records; reading 0x1caf4 and the r6 meaning in Akira's op 0xa bytes would settle it.
  - 0xb -> 0xb: the helper called is 0x94d0 in VF2 vs 0x66b0 in StF (c, probably a random number). Akira uses none. Nothing.
  - 0xc: SAME. Akira uses none.
  - 0xd -> 0xd: sets/clears kind bit 27 in VF2, bit 25 in StF (c). Akira uses it x23. Board: unknown. If VF2's bit 27 and StF's bit 25 mean the same thing, the converted op is right. If not, Akira sets StF bit 25 where VF2 set bit 27. Finding VF2's readers of 1A4 bit 27 and StF's readers of bit 25 would settle it.
  - 0xe: SAME (x7).
  - 0xf -> 0xf: increments 0x69c (VF2) vs 0x6cc (StF), capped at 8 (d). Akira uses none. Nothing.
  - 0x10 (VF2: call 0x4b604 through table 0x2006278[b3][rob+0x1b1]): dropped, x154. (b). Meaning unknown; reading 0x4b604 would settle it. It is the largest dropped group after sound.
  - 0x11 (VF2: w0 bit 27): dropped. Akira uses none. Nothing.
  - 0x12 -> StF op 0x10 (hand): VF2 eases a ramp into the 0x6c4 slots, counted down at 1b4e8-1b52c; StF calls 0x330d0 and sets the shape at once (c). Akira uses it x132. Known gap (BOARD.md: hand shapes without easing).
  - 0x13 -> 0x12 (0x5de): same apart from slow mode. Akira uses none.
  - 0x14 (VF2: 0x1218 = table 0x1b3b8[...]): dropped, x4. (b). Meaning unknown; finding VF2's readers of rob+0x1218 would settle it.
  - 0x15 -> 0x14: 0x69e vs 0x6ce (d). Akira uses none.
  - 0x16 -> 0x15 and 0x17 -> 0x16: SAME (x2 and x16).
  - StF ops 0x17-0x2b: StF-only (a). The converter never emits them for Akira. Nothing.

## Appendix: Pose

Classes: (a) StF only, (b) VF2 only, (c) same behaviour with different constants or protocol, (d) layout only.
Copro protocol differences (StF rotate ops 0x08/0x09/0x0a with an inline angle vs VF2 TGP 0x6c/0x6d/0x6e with an angle ring at 0x90e000; StF's 0x13 sync ops, its 3-angle op 0x1f and the extra read after 0x3f) are (c) in every function. The board runs StF's SHARC firmware, so they are covered and are not repeated below.

### calc_unit_mat (StF 0x16C44 / VF2 0x16504)
1. Builds the 16 part matrices (slot op 0x35) and the collision balls for one fighter.
2. DIFFERS.
3. Differences:
   - (a) StF 0x16C44-0x16CDC: op 0x7F (0x3F807F7F) with the slot when 0x508000 bit 5 is clear. Also smooths 0x1E28 toward 0x1F4 when 0x70C bit 23 is set (copy at frame <2, lerp 0.4 at frames 14..23, clear at >=24); the extra translate at 0x17530 (op 0x0E by 0x1E28) uses it. VF2 has no 0x70C.
   - (d) rob+0x678 (StF 0x16D40) vs rob+0x650 (VF2 0x16548); move-data byte 0xB at rob+0x83F vs 0x840; previous position 0x6FC vs 0x6E0. The use patterns are identical.
   - (a) StF dented_cnt 0x7F414 (0x1FEC/0x1F88), and scale_parts_cnt 0x7F648 with player_model_y_scale 0x509518 and op 0x07 (0x16F00, 0x17038, 0x17290, 0x174BC, 0x17888, 0x17AFC). Only sub_7F5F4 (a play_motion op that VF2 lacks) arms the part squash.
   - (a) StF 0x17B70 calls rob_ball_data_make 0x2989C (collision).
   - (b) VF2 0x16F40-0x17068: the midriff band, 16 points from record+0x38 to 0x1860 (written via g10).
4. Board impact: nothing. The dents are already documented in BOARD.md (left as Knuckles'). The squash is never armed for Akira. Collision is stubbed. 0x70C is never set by VF2 data. The midriff is covered by the board's C midriff band. Recommendation: nothing.

### calc_rob_angle (StF 0x2FF08 / VF2 0x27CE0)
1. Exits early when frame 1 holds the same motion (0xC4C/0xC4E). Otherwise calls get_frame_dat and falls into calc_rob_angle_cont.
2. SAME apart from copro protocol (covered). Recommendation: nothing.

### calc_rob_angle_cont (StF follows calc_rob_angle / VF2 follows 0x27CE0)
1. Solves the pose on the skeleton's bones (IK for the limbs) and sends the part angles to the copro.
2. DIFFERS.
3. Differences:
   - (c) Bones: StF loads off_C2058[0x84C][0x1B0], or index 0x8C if 0x860 bit 12 (0x2FFA8-0x2FFC4). VF2 loads the fixed table 0x296A0 (0x27D68).
   - (d) Bone-record layout: StF +0x18 / stride 36 vs VF2 +0x10 / stride 20 (0x300EC/0x27E4C, 0x3013C/0x27E9C and the matching loads).
   - (c) Tail: StF 0x30484-0x304B8 sets rob+0xC50 = table 0x31354[type][0x1B0] * 0.85 * rob+0x84 (0 when the entry is 0). VF2 calls adj_taikaku 0x29414, which is nonzero only for Pai/Lion (6, 10) and Shun (8). For those it ramps by 0x1A4 bit 19 over frames 10..20 and also moves 0x18A/0x17C.
4. Board impact: the bones are already covered. off_C2058 gives Akira VF2's 0x296A0 table in StF's layout. For the tail, Akira's StF entries (chars 6 and 32) are 0.0 (the only nonzero entries are type 0 chars 1, 9, 27, 35), and VF2's adj_taikaku gives Akira 0, so the result is the same. Recommendation: nothing.

### get_frame_dat (StF 0x304C8 / VF2 0x28184)
1. Reads the frame's curve values (key-time remap via 0x854), applies the front/rear blends (0xBDD modes) and stores the part angles and IK targets (0x140, 0xBA8, 0x80, 0xB00..). Then gates and computes the face/look target 0xB0C.
2. DIFFERS.
3. Differences:
   - (b) VF2 0x281C8-0x281FC: when 0x500068 bit 20 is set, the frame is remapped to 1+(f-1)(len/2-1)/(len-1). This is VF2's 2-tick (half-rate) mode; the board runs at 60 fps, so it is dead. Nothing.
   - (a) StF 0x30564: at frame 1, if 0x19F == 20, it uses get_fcurve_value instead of the start-value path. Akira never commits kind 20: StF 20 comes only from VF2 type 0x18, and none of his commits have that type (types seen: 0, 9, 16, 19, 25, 26, 27, 29, 30). Nothing. If ever needed, a branch fits at loc_30560.
   - (b) VF2 0x283EC-0x2851C, short-opponent aim. When the opponent (g8+0x1B1) is Pai, Shun or Lion (6, 8, 10), with 0x804 bit 8, 0x821 < 4, and 0x820 in {5,26 -> +0xB8; 6,27 -> +0xC4; 9,14 -> +0xDC; 10,15 -> +0xE8}, it lowers that IK target's y (frame-data triples 15/16/18/19) by -0.1/-0.2, ramped over the motion and floored at 0.14, using rob+0xC34/0xC38/0xC3C. These fields are unused in StF.
     Board: Akira does not lower these attacks against short opponents. 0x820/0x821/0x804 already hold VF2 values for him (82 setups have bit 8). Needs a guest table: a "short opponent" flag indexed by the StF character, since VF2's 6/8/10 have no StF counterpart. Low priority.
   - (c) StF 0x30728/0x30734 compares as floats (cmpr) where VF2 uses cmpibge. Same result for non-negative values. Nothing.
   - Look gate, StF 0x30814-0x309C4 vs VF2 0x28634-0x286A0:
     - (a) StF clears/sets the gate flag 0x7D3. It also has paths that VF2 lacks: w0 bit 19 (target = camera point fa_camera+0x41C), the 0x50002C bit 7 test, the w0 bit 23 and bit 8 tests, and w0 bit 17 (target = midpoint of camera and opponent head). StF scene features; harmless for Akira.
     - (c) The game-state test: StF 0x500034 & 0x3033C030; VF2 requires 0x500034 > 6 and & 0x3F0000. Game state, not per fighter. Leave.
     - (c) The 0x1A4 closing mask differs. StF 0x802C119 = bits 0,3,4,8,14,15,17,27; VF2 0x6C111 = bits 0,4,8,14,15,17,18. StF closes the gate on bit 3 and bit 27, which VF2 does not; VF2 closes it on bit 18. Akira's op-5 flags keep bit 3 (STF_FLAG_BITS) and drop 14/17/18, so on the board his look gate closes in his bit-3 motions, where VF2 keeps it open.
     - (c) Yaw: StF uses own 0x26 - (int16)(opp.0x26 - own.0x26)/4 (0x308D0-0x308F8); VF2 uses own 0x26 alone.
     Board: Akira's head may stop tracking in his bit-3 motions, and his look yaw is biased toward the opponent's heading. Recommendation: branch on char_game to VF2's mask and plain yaw. There is no StF label at 0x308B4/0x308D0, so lift-stf.py needs a new patch point (or a label added there). To settle it: a VF2 MAME tap of rob+0xB0C / 0x7D3-equivalent in a bit-3 motion, and the board's rob+0x26 for both fighters (if they are equal, the yaw term is 0 and only the mask matters).
   - (b) VF2 0x286A4-0x28778: grab target for motions 0x1A8 == 216 or 1305 at frames 13..157. Op 0x36 takes opponent part 24, transforms (0.15, 0, -0.05) and stores into 0xB18 (w0 bit 6 clear) or 0xB24. StF has the same code, unreachable after loc_309C4. VF2 216 and 1305 are not among Akira's 328 motions. Nothing.
4. Board impact summary: the look-gate mask/yaw (branch, needs a patch point) and the short-opponent lowering (needs a guest table). The rest is nothing.

### smooth_int (StF 0x2F2B0 / VF2 0x27130)
1. Picks the blend mode 0xBDD (0 none, 1 front, 2 rear, 3 both) for a new motion and sets up the blend start pose.
2. DIFFERS.
3. Differences:
   - (a) StF 0x2F2CC-0x2F2D8: 0x70C bit 1 or 0x860 bit 2 -> no blend. Akira's 0x860 is zeroed, and nothing in VF2 sets 0x70C. Harmless.
   - (c) 0x804 bits, StF 0x2F2F0-0x2F30C vs VF2 0x27160-0x2716C: StF bit 18 -> mode 3 and bit 19 -> mode 1; VF2 either bit -> mode 1. On the board, Akira's 21 bit-18 setups (VF2 13 14 15 22 30 36 43 92 109 111 115 347 559 750 1113 1187 1192 1229 1255 1257 1264) get front+rear (3) where VF2 gives front only (1).
     Recommendation: branch on char_game (rob+0x1B1) in that test, to take the bit-19 path for VF2. There is no label inside it (the labels are smooth_int, loc_2F354, loc_2F35C, loc_2F364, loc_2F36C), so this needs a new patch point. Alternatively, convertSetup could move bit 18 to bit 19 in Akira's 0x804, if no other StF reader of bit 18 matters (unknown; would need a grep of 0x804 bit-18 readers).
   - (b) VF2 0x27174: old_motd_kind 0xC30 bit 23 -> no blend. Akira has no bit-23 setups. Nothing.
   - (a) StF 0x2F338: 0x1A4 bit 26 -> mode 3. Not in Akira's op-5 bits; harmless unless StF code sets bit 26 on him at run time (unknown).
   - (b) VF2 0x27564-0x27608: if old 0xC30 bit 10, current 0x1A4 bit 9 and not 0x804 bit 10, it runs op 0x14 on 0x50E1D0/0x50E0E0 (0x50E1DC/0x50E0EC by w0 bit 6 / old bit 11), then op 0x13 on 8 entries at 0x50E098, and stores 0.14 in 0x50E1CC. Meaning unknown. StF has the identical code dead after `b loc_2F714` at loc_2F668 (0x2F670..0x2F710).
     Board: Akira has 17 setups with bit 10 (VF2 61-66, 72-75, 77, 78, 494-498), so this can run in VF2 and never does on the board.
     Recommendation: branch on char_game at loc_2F668 into the dead block. This needs a label at 0x2F670. Falling through to loc_2F714's call 0x2FC58 afterwards is harmless (0x860/0xC5C bit 12 clear -> returns). To settle whether it matters: whether his bit-10 motions are ever followed by a motion with 0x1A4 bit 9, and a VF2 tap of 0x50E1CC.
   - (a) StF calls 0x2FC58: a partial-body copy by 0x860/0xC5C bit 12. A no-op for Akira.
4. Board impact: wrong blend mode on 21 setups (branch, needs a patch point), and VF2's bit-10 transition block (unknown effect; branch at loc_2F668, needs a label).

### rear_smooth_int (StF 0x2F36C / VF2 0x271C4)
1. The rear (end-of-motion) blend into the next motion's start pose.
2. DIFFERS, all harmless.
3. Differences:
   - (b) VF2 0x27780: 0x500068 bit 20 halves g6 (half-rate mode). Dead at 60 fps.
   - (a) StF 0x2FAF0 calls 0x2FC40: a partial-body copy by 0x860 bits. Akira's 0x860 is 0.
4. Board impact: nothing. Recommendation: nothing.

### calc_unit_1 (StF 0x30FE8 / VF2 0x2901C)
1. Head aim: turns the head's yaw and pitch toward the 0xB0C target with a per-frame step clamp.
2. DIFFERS. Apart from protocol (including the extra FIFO read at StF 0x31030), there is one difference.
3. (a) StF 0x31214 and 0x31280: when 0x7D3 == 0 (look gate closed), the clamp is 0x2000 instead of 0x800 (yaw) / 0x400 (pitch). VF2 always uses 0x800/0x400 (0x292B0/0x29310).
4. Board impact: with the gate closed, Akira's head snaps up to 4x (yaw) / 8x (pitch) faster than in VF2. Recommendation: branch on char_game at loc_31220 and loc_3128C (r15 is free there):
   loc_31220: `ldob 0x1B1(g7),r15; ldob guest_char_game[r15],r15; cmpobe GAME_STF,r15,loc_31220_stf; shlo 0xB,1,r12; loc_31220_stf:`
   loc_3128C: the same, with `shlo 0xA,1,r12`.
   (Check against the lifted listing that r12 holds the clamp at those labels before applying.)

## Appendix: Movement and info


Lifted lines are board/src/stf_motion.s's. "rob" fields are StF's layout unless marked VF2. VF2's
record pointer is `ld 0x200620C[rob+0x1B0*4]` (VF2 init_fix 0x13F10, kept at rob+0x190 as in StF).
The board runs StF's game globals: gravity 0x50A000 = 0.0252222 (0x3CCE9ED5) where VF2 has 0.0027222
(0x3B32674F), 9.27x, not SCALE (2.0271); 0x50A004 = 1.0, 0x50A008 = 10.0 in both.

### set_coli_ball_data (StF 0x17C14, lifted 6278 / VF2 0x176A0)
1. Sends each of a fighter's collision balls (list by player g0) through the coprocessor's transform.
2. DIFFERS, in the coprocessor protocol and table placement only (d).
3. - (d) StF takes its tables from pointers in the work area (0x1D0C(g7) points, 0x1D00 radii, 0x1D14 the
     lists, 8 bytes per player, 0x1D20 the counts). VF2 uses fixed RAM: 0x20078A8 points, 0x2007BEE[g0*4]
     lists, 0x2007C68 counts. StF goes forward through the list and VF2 backward.
   - (d) Copro: StF sends 0x1C803939 with the point plus a 4th word 3*(ball>>2), then 0x14802929 and
     reads the 3 words back and drops them (the SHARC program keeps the result). VF2 (TGP) sends the
     point without the index and stores the result plus the point's 4th word as a quad at
     0xD00(g7)[ball*4] (0x17700). The gems-c and ages-decomp C versions agree with this.
4. Akira: none. His balls come from the guest `rob_coli_ball_types`, and the board's copro is StF's.
   Recommendation: nothing. VF2's form would be wrong on a Model 2B.

### rob_revise_yang (StF 0x17CA0, lifted 6309 / VF2 0x17710)
1. Turns the fighter toward the opponent each frame: it picks a target angle (0x5B6, the angle to
   the opponent; 0x5B4; 0x61A; ...), a window and a per-frame step from rob/opponent flags, then turns
   and moves the root around the body.
2. DIFFERS.
3. - (a) StF-only: the whole function is gated on [0x500828]+0 bit 31 (0x17CA0). 0x70C bit 2 → turn at
     0xE38 per frame (20 degrees), window 0x7FF8 (0x17CDC/0x17EAC). 0x860 bits 19/20, the opponent's 0x860
     bit 21, 0x804 bits 8/15, and 1A4 bit 31 with 0x804 bit 8 → loc_17E58/loc_17E74 (0x17CF4..0x17D40).
     1A4 bit 19 → return (0x17D58). Bits 17/14 → loc_17E58 (0x17D6C; the bit-14 one is dead, since bit 14
     already returned at 0x17D44).
   - (b) VF2-only: if the opponent has 1A4 bit 28 set, it returns while the opponent's frame (0x1AA) is
     below 10; otherwise it turns with bit 13 or 10 and returns without them (0x17740..0x17754).
     (r7 & 0x1010) == 0x1010 → return (0x17758).
   - (c) The same tree with other bits and steps. Forced target: VF2 1A4 bit 23 → 0x61A, step 0x38E
     (5 degrees), no window (0x1771C/0x177E0). StF 1A4 bit 8 with 0x821 == 4 → 0x760 (set in
     rob_check_stage from [0x500828]+0x1E0), step 0x71C (10 degrees) (0x17CBC/0x17E90). Return bit:
     VF2 27 (0x17734), StF 25 (0x17CE4). Bit 13: VF2 limited turn (0x17800: step 45, or 0x5B, window
     0x2AA8 = 60 degrees, out of window → no turn). StF full turn, loc_17E58 (step 0x71C).
     "Limited" mask: VF2 (r7 & 0x1102) == 0x1002 (0x17794). StF (r7 & 0x1010) == 0x1000 (0x17D88).
     The tail for bit 1 clear: VF2 1A4 bit 30 (0x177C8), StF bit 28 (0x17DB0). With bit 1, opponent bit 15
     clear: VF2 always goes to the 0x16C/0x2AA8 turn (0x177C4). StF goes there only with opponent
     bit 31, else to loc_17E58. StF's default step in these paths is 0x71C where VF2's is 0x38E.
   - (d) 0x83F (StF) / 0x840 (VF2) byte (0x17F10/0x178B4).
4. Akira: his 1A4 and 0x860/0x804 bits on the board are set by StF's code and by his converted setups
   (op 5 keeps only StF's bits), so StF's tree reads them with StF's meanings. What he loses is VF2's
   tree: the 5-degree step and the 60-degree limited turn on bit 13. He tracks at StF's 10 degrees
   where VF2 tracked at 5. Recommendation: unknown for now. A char_game branch at `rob_revise_yang` to a
   copy of VF2's tree would test VF2 bit numbers (23, 27, 28, 30) against StF's meanings. What would
   settle it is a map from VF2's 1A4 bits to StF's, from a trace of rob+0x1A4 during the same Akira
   moves on VF2 (MAME vf2) and on the board. Once 13/23/27/28/30 are matched, branch at
   rob_revise_yang+0x50 (`bbs 0xD, r7, loc_17E58`) and at loc_17E58/loc_17E90 (r6 = 0x38E) for GAME_VF2.

### rob_spd_control (StF 0x17F78, lifted 6499 / VF2 0x1791C)
1. Friction on the fighter's own and external velocity, gravity, and integration into the root.
2. DIFFERS.
3. - (c) Friction: r5 = g * [0x50A004] * rob+0x5D8 / 60 * (1 + rob+0x5D4). StF multiplies by an extra
     0.25 (0x17F9C). rob+0x5D8 is the fighter's weight. VF2 sets it from record +0x2C (VF2 0x14204;
     Akira 79.0). StF sets it in action_init (0x1269C, lifted line 802) from record +0x14 plus a part
     sum from ptr_CE1CC (always 0), so it is Knuckles' 60 for Akira now. docs/BOARD.md says no lifted
     code reads +0x14. It does: lifted 802..810 and loc_325FC (19928). rob+0x5D8 is also read at lifted
     4781, 14441 and 15397.
   - (a) StF-only: stt 0x18 → 0xA4C (0x17F7C). The 0xA0E countdown that restores velocity 0x2C..0x34
     from 0xA10 when it reaches 0 (0x180AC). Low gravity, x0.7 (flt_1D290) while 1A4 bit 14 (0x1811C);
     no StF code sets that bit with setbit/st, and StF's op 5 bits exclude 14.
   - (b) VF2-only: with [0x500068] bit 20, external velocity 0x5C8/0x5D0 is added at x0.5 (0x17ADC).
     VF2 sets that bit at 0x1FD5C together with gravity/4 (0x3A3117C4) and 0x50A004 = 2.0. It looks
     like slow motion; the meaning is not confirmed. It is a global, so no fighter has it on the board.
   - (d) Stage bounds: StF uses cmpr and VF2 cmpibge on the abs floats. Same result.
4. Akira: his friction is Knuckles'. On the board it is 0.02522*0.25*60/60 = 0.006306 per frame.
   VF2's is 0.0027222*79/60 = 0.003584, which is 0.007266 in board units (xSCALE). Recommendation:
   needs a guest table value, not a branch. His record +0x14 = 69.14 (79 * SCALE * 0.0027222 /
   (0.025222 * 0.25)) gives VF2's slide per frame. It also changes the other three 0x5D8 readers
   (unknown roles), so check those first. Separately: gravity is StF's for him (9.27x VF2's, against
   SCALE 2.03). That is a world value, not something to branch on, but it bears on his jump arcs.

### action_after (StF 0x18404, lifted 6788 / VF2 0x180BC)
1. After the action: sets 0x5B4 (yang, plus 0x812 under 1A4 bit 6) and clears the hit-combo byte.
2. DIFFERS.
3. - (d) Hit combo: StF 0x6F4, VF2 0x6D8.
   - (a) StF-only: the clear is skipped under 0x70C bit 2 (0x1841C).
   - (b) VF2-only (0x180D4..0x18124): it sets rob+0 bit 8 ("low") by crouch (1A4 bit 3), 0x810 bit 7
     and frame 0x1AA against half the motion length 0x800. Standing: set if 0x810 bit 7 and
     frame <= len/2. Crouching: set if 0x810 bit 7, or frame > len/2. Its readers are VF2's
     get_en_info: the opponent's +0 bit 8 at 0x18810 and 0x1887C. StF never sets rob+0 bit 8 (no
     setbit/clrbit 8 stored to +0 anywhere), so StF's matching branches (0x19104, 0x19178) never fire.
4. Akira: StF's fighters never set it either, so he is treated like them. Setting it for him alone
   would make StF fighters see him "low" in their 0x720 bits 2/4, which StF never tested in play.
   His program tests none of VF2's low bits (9, 13; below). Recommendation: nothing.

### get_my_info (StF 0x18584, wrapper get_my_info_new at lifted 6806; lifted 6882 / VF2 0x18144)
1. The fighter's own state word (0x6D4), its status bits, hit-stop (0x50A0B6) and contact info.
2. DIFFERS.
3. - (d) Outputs: StF 0x69C/0x6A0/0x6A4/0x6A8/0x6D4 = VF2 0x66C/0x670/0x674/0x678/0x6B4.
   - (b) VF2-only: hit-stop 0x50A0BA is doubled into 0x50A0B6 under [0x500068] bit 20, the
     slow-motion-like global above (0x18168). Also a counter at VF2 rob+0x6DA: 30 while 1A4 bits 29 and
     11, else counting down, unless [0x508000] bit 5 (0x18614..0x1863C). Its only reader picks reaction
     table 0x23E48 (0x2317C), gated on settings [0x50016C]+0x3351 bit 6, which is clear on MAME's vf2.
     StF's 0x6DA is something else (the attack id, 0x1B978).
   - (a) StF-only: rob+0 bit 14 from 0x864/0x868/0x878 against 0x5BC and the frame (0x18A48..0x18A80).
     The 0x821 jump table has 9 entries (0x189FC) where VF2's has 7 (0x185D0); cases 7 and 8 are StF's.
     There is also the get_my_info_new wrapper.
4. Akira: none. VF2's extras are globals or gated off, and StF's read his StF-format setups.
   Recommendation: nothing.

### get_en_info (StF 0x18A88, lifted 7181 / VF2 0x18644)
1. Relation to the opponent: distance 0x5F4, angle 0x5B6, facing, range bits and the opponent's
   attack properties into 0x5B8 (StF also 0x720, 0x734.., 0x740, 0x750.., 0x7D4).
2. DIFFERS: StF's is rewritten (694 lines against 238), and the range bits moved word.
3. VF2's ranges, which docs/BOARD.md asks for: VF2 reads them from the fighter's **own rob**:
   0x62C, 0x668, 0x630, 0x634. init_fix fills them (0x14218..0x14234) from **VF2 record +0x18, +0x1C,
   +0x20, +0x24**. **Akira's (record 0x2001208, and P2's 0x2003638): 1.4, 1.7, 1.4, 1.4.** Record +0x28
   (Akira 3.0) → rob+0x698, a distance limit read in exec_action (0x154D0); role unknown. +0x2C (79.0)
   → rob+0x5D8, his weight (rob_spd_control).
   Where they go (VF2 → StF), when facing each other within 0x1554 (30 degrees) of each other:
   - VF2 0x5B8 bit 8: dist <= rec+0x18, opponent not low. → StF **0x720 bit 0**: dist <= rec[+0x10]+0.
   - VF2 bit 12: dist <= +0x1C. → StF 0x720 bit 1: <= +4.
   - VF2 bit 9: opponent low (+0 bit 8 or 1A4 bit 25), dist <= +0x20. → StF 0x720 bit 2: <= +8.
   - Opponent's back to me, dist <= +0x24: VF2 bit 10, or bit 13 when low. → StF 0x720 bits 3/4: <= +0xC.
   - The "opponent bit 1 and 0x844 bit 27" shortcut: VF2 bit 8 (0x18828) → StF 0x720 bit 0 (0x1911C).
   - Gate masks: VF2 needs opponent 1A4 & 0x10002604 and skips on & 0x401C010. StF needs & 0x4003614,
     skips on & 0x40089008, and splits off 1A4 bits 14/16 to the 0x720 bit 6/7 path (rec +0x38) and
     bit 4 to bit 20 (+0x2C..+0x34).
   Knuckles' table 0xC50F8: +0 2.5, +4 2.5, +8 1.6, +0xC 2.4 (rest 1.45 0.4 0.5 1.5 1.3 2.5 1.4 1.4 2.15 1.5
   1.8, count +0x3C = 1, and +0x40 = 1.0, which 0x19654 also reads).
   - (c) In 0x5B8, StF reuses bits 7..10 for other things: 7/8 = the distance to the opponent's position
     one frame earlier (rob+0x1E0C, saved in calc_unit_mat 0x17B88) is greater/less than now, i.e.
     approaching/moving away (0x18B9C). 9/10 = the opponent's y rising/falling while airborne (0x18C44).
     Bits 11..14 are never set. VF2 bit 11 (opponent open) is StF bit 5: same tests, minus VF2's
     settings-gated rob+0 bit 29 case, plus StF's 0x70C bit 2 (0x193DC). StF bit 6 = opponent +0 bit 29.
   - (c) Bit 2: VF2 dist >= 3.0 (1.5 under settings bit 6; 0x1B7EC/0x1B7F0) or (mine|opponent's) 0x5B8
     bit 1. StF dist >= 1.8 (0x1D000), or the opponent's bit 1, or opponent 1A4 bits 14 and 4.
   - (a) StF-only: bit 0 is held off for a fresh turn within 0.4 when either is airborne or
     [0x500828]+0x164 (0x18E4C). Also 0x720 bits 6..20 (the 0x1244 / 0x650 / record +0x10..+0x40 tests),
     the landing prediction 0x734..0x740, and 0x7D4.
   - (c) The tail call: VF2 kind 22 → 0x18BD4; StF kind 18 → 0x19888, the same frame (0x80A-1) and
     <= 1.4 test.
   - Same: 0x5F4, 0x5B6 and bits 0, 1, 3, 4 and 15..31.
4. Akira: his command program, which tools/vf2-guest.mjs copies op for op, tests 0x5B8 with op 7 (bit
   set) for bits 0 x6, 3 x6, **8 x10**, **11 x2**, 18..23 x1-2 and 26 x11 (no op 0xA). On the board, bit 8
   means "opponent moving away" instead of "in range", and bit 11 is never set. So his 10 range-gated
   commands fire on the wrong condition, and his 2 bit-11 commands never fire.
   Recommendation: no shared-path branch. Fix it in the converter and a guest record value:
   (1) In vf2-guest.mjs's command conversion, rewrite op 7/0xA with bit 8 → StF op 0x34/0x35 (0x720
   test; StF table 0x1F00C, handlers 0x1ECF8/0x1ED0C, 2 bytes like op 7) with bit 0. Likewise 12 → 1,
   9 → 2, 10 → 3, 13 → 4, and 11 → op 7/0xA bit 5.
   (2) Give his records +0x10 a copy of 0xC50F8 with +0, +4, +8, +0xC = 1.4, 1.7, 1.4, 1.4 x SCALE =
   **2.838, 3.446, 2.838, 2.838**. The rest stays Knuckles' (VF2 has no equivalents). VF2's
   low-opponent bits (9/13) need rob+0 bit 8, which neither game's board code sets (action_after), so
   they stay dead as for StF's fighters.

### calc_land_time (StF 0x19900, lifted 8129 / VF2 0x18C64)
1. Frames until landing, from y, vertical speed and gravity.
2. DIFFERS (one StF-only branch).
3. (a) StF scales gravity by 0.7 (flt_1D290) while 1A4 bit 14 (0x1990C..0x1992C), as rob_spd_control
   does. Otherwise it is the same (gravity minus rob+0x5CC, the same copro sqrt/int sequence).
4. Akira: none; that bit is not set for him (see rob_spd_control). Recommendation: nothing.

## Appendix: Collision


Lifter status (tools/lift-stf.py): `collision` is a ROOT; all seven functions are lifted live into
board/src/stf_motion.s (collision 12470, area_coli 16684, decide_coli_kind 15855 with its chunk
player_mot_nums_read 15851). None is in STUBS and none calls a STUB directly. In the tree under
`collision`, the stubs reached are `sound_request_u` (hit/voice sounds in attack_hit/damage code,
e.g. loc_2B390, loc_2BD80, loc_2C438) and `print_mes` (the "HIT COMBO" debug text, loc_2B318);
`call_projectile_routine` is a stub and `sub_2BEF4` (projectiles) walks the board's zeroed stf_tobi.
`gusya_ckeck` is a bare `ret` in StF itself. The lifter drops StF's dead `setbit 1,g6; b loc_2D0D8`
after player_mot_nums_read (0x2CFB4), so it is not in stf_motion.s.

All seven are pair-level: they run once per frame for both fighters (fa_rob0/fa_rob1, task g13)
and feed StF's coprocessor program (commands 0x1F003E3E, 0x1D003A3A, 0x1D803B3B, 0x18003030,
0x1E803D3D, 0x38007070, 0x39007272, 0x15802B2B). VF2's versions talk to VF2's copro program, whose
commands take other arguments, so "branching to VF2's code" is not available for most of this;
only per-fighter data differences can be branched.

### collision (StF 0x293EC, VF2 0x221E8)
1. The collision task: per frame, ball data, attack/guard test of each fighter on the other, hits
   and damage, walls.
2. DIFFERS.
3. - (a) StF-only, before the pair test: also_sub_mode 0x1A/0x1B early-out (0x293EC), the 0x2AC(g13)
     countdown (0x29418), sub_425D8, finish_val_cont x2 (rob+0x1A18 finish state, 0x29430),
     rob_ball_data_make x2 (0x2945C; VF2 does its ball data elsewhere, unknown where),
     support_rob_position (0x29478). After it: sub_2BEF4 (projectiles), mod_fa_effect+0x908 clear,
     kabe_hit (cage walls), zibaku_ckeck x2, gusya_ckeck x2 (0x29534..0x29598). None of these is in
     VF2's collision. Harmless for Akira: they are StF's arena and StF's systems, which the board's
     fight is.
   - (c) Hit bookkeeping: StF's coli_attack_chk results go through task 0x274/0x276 (0x294C8);
     VF2's equivalent (0x22404) returns them in g0 (0x2222C/0x2223C). Same decision tree.
   - (d) Priority compare when both hit: StF `ldob 0x822` (0x294F0), VF2 `ldos 0x822` (0x2225C);
     0x804 bit 15 and 0x808 compares identical. Size only; on the board 0x822 is written by StF's
     own move-data reader.
   - (a) StF calls attack_hit then damage_unit as two routines; VF2 calls one routine (0x225CC).
     Whether VF2's folds damage in is unknown (not needed: the board runs StF's).
4. Board impact for Akira: none. Recommendation: nothing.

### decide_coli_kind (StF 0x2CFBC + chunk 0x2CFA8, VF2 0x233D0 + dck_special_check 0x23398)
1. Picks the pair's body-contact kind (NORMAL, FIX, BODY, RIDE, ...) and its record: ball masks,
   push split, kind id (task 0x88), sets g6 kind bits.
2. DIFFERS.
3. - (b) VF2-only, dck_special_check (0x23398..0x233CC): if either fighter's motion (rob+0x1A8) is
     0x242, 0x241 or 0x6C, set g6 bit 1 (BODY/BODY_0 kind) and skip the other tests. StF's chunk
     player_mot_nums_read (0x2CFA8) loads the same two ids and then does nothing with them; its
     dead `setbit 1,g6; b loc_2D0D8` (0x2CFB4) shows StF's source had this check and dropped it.
     All three VF2 motions are Akira's: commits in his command program (VF2 0x348A0 -> 0x242,
     0x348B7 -> 0x241, 0x34BFB -> 0x6C), imported as new ids (>= 519). What moves they are is
     unknown. On the board they never force BODY: Akira loses VF2's body contact for those moves.
   - (a) StF-only: TOBIKOE0/1 (0x2D00C..0x2D0A4: 0x70C bit 18 differs between the two, 0x1A4 bit 3,
     0xC58 bit 18, 0x1AA < 4, 0x5B8 bits 8/9 or 0x5F4 < 0.4), KABE/KABE_0 (BODY when the wall
     distance rob+0x650[dword_2E290/2E270 by 0x1E0(g13)] < 0.1, 0x2D15C..0x2D1E8), JUMP_0/1 (0x1A4
     bit 4 differs, 0x2D1EC), RISE_0/1 (the other's 0x1A4 bit 15 in FIX, 0x2D20C/0x2D228).
     VF2 has none (VF2 0x234A8 goes to NORMAL where StF tests JUMP; 0x234CC picks FIX without the
     bit 15 test). Harmless: StF behaviour of the pair on StF's stage.
   - (c) Records: StF 8 words (part masks run through unit_to_ball on rob+0x1D14, then `not`;
     ratios; name pointer -> 0xC8; kind id -> 0x88; two push part masks -> 0x264/0x268), VF2 6 words
     (ball masks stored as they are -> 0xB4/0xB8; ratios -> 0xC0/0xC4; 0 -> 0xBC; id -> 0x88). Kind
     ids 0..5 and the ratio pairs are equal (NORMAL 0.5/0.5, FIX_0 0/1, FIX_1 1/0, BODY 0/1, BODY_0
     1/0, RIDE_1 0/1, RIDE_0 1/0). NORMAL: StF ~(balls of parts 1..15) = 0 for real balls, VF2 0;
     same. BODY: StF parts 0x264A (1,3,6,9,10,13) excluded, which with Akira's map is balls
     0,1,3,4,8,9,13..16,22..24; VF2 0xFFFFDFFC excludes balls 0,1,13 (copro order; parts 1 and 8
     by VF2's lists). Different sets, pair-level.
   - (d) Task offsets: StF 0xC0/0xC4/0xCC/0xD0/0xC8 = VF2 0xB4/0xB8/0xC0/0xC4/0xBC.
4. Board impact: Akira's three moves 0x6C/0x241/0x242 (VF2 ids) get NORMAL/FIX contact instead of
   BODY. Recommendation: branch on char_game at StF `loc_2CFF4` (INSERT before it; r3/r4 already
   hold rob+0x1A8 of g7/g8): for each fighter whose char_game is GAME_VF2, if its 0x1A8 equals the
   board id of VF2 motion 0x242, 0x241 or 0x6C, `setbit 1,g6,g6; b loc_2D0D8` (StF's own dropped
   code). Needs a guest table (e.g. a short list by character of "BODY-contact motion ids", written
   by vf2-guest.mjs from newId.get(0x242/0x241/0x6C)); check first whether StF keeps flag bits in
   0x1A8 (VF2 compares the whole short). BODY's ball set (above) stays StF's; leave it.

### coli_cont_cop (StF 0x2D36C, VF2 0x23524)
1. Drives the pair's collision on the copro: attack flags, area (wall) test, contact kind, push
   direction, then the push (coli_recalc_pos).
2. DIFFERS.
3. - (c) Order and copro protocol: StF calc_attack_flag x2 then sends 0x1D003A3A with both flags and
     both 0x821 (0x2D3A0..0x2D3EC), coli_ram_init, area_coli x2 (g7,g8 both ways), decide_coli_kind.
     VF2 clears 16 words at 0x40(g13) (0x23554), sends 0x1D003A3A bare, area_coli(g7, g9=0x1000550)
     x2, decide_coli_kind, then calc_attack_flag x2 (0x235B4). 0x1D803B3B: StF 7 args (adds the
     push masks 0x264/0x268, 0x2D4D4), VF2 5; StF's flags come from rob+0x768, VF2's from g3.
   - (a) StF-only: 0x1A4 bit 29 on either -> decide_dir only (0x2D428); g6 bit 5/7 (RIDE_0/RIDE_1
     when 0x1AA is within 0x80A..0x80A+15) -> decide_dir and recalc without the copro push
     (0x2D444..0x2D47C). VF2 only takes g6 bit 0. Harmless.
   - (b) VF2-only: coli_flag_conv (0x23640) after the copro reply (copro-slot ball hits to parts at
     0x40(g13)). StF has no such step; its copro program returns another form. Not portable.
   - (d) Task 0x160/0x164, 0xF8..0x100 (StF) = 0x144/0x148, 0xEC..0xF4 (VF2).
4. Board impact: none (pair-level, StF's copro). Recommendation: nothing.

### decide_dir (StF 0x2D588, VF2 0x2364C)
1. The unit push direction from fighter 0 to fighter 1 in x/z (copro 0x18003030).
2. DIFFERS.
3. - (a) StF-only hysteresis (0x2D588..0x2D61C): a threshold 0.4, 0.3 when one is attacking
     (0x804 bit 8) with 0x821 == 5, 0.85 when rob0 0x1A4 bit 14, 0 when rob0 0x7D4 >= 0x5F4; stored
     in 0x270(g13); if 0x168(g13) is above it the old direction is kept. Skipped when 0x1A4 bit 29
     or 18 on either. Also a zero-vector guard (0x2D63C). VF2 always recomputes. Harmless.
   - (d) Result at 0xD4..0xDC (StF) / 0xC8..0xD0 (VF2).
4. Board impact: none. Recommendation: nothing.

### coli_recalc_pos (StF 0x2D67C, VF2 0x23694)
1. Splits the overlap push between the two fighters, applies wall pushes, moves both (rob+0x18,
   +0x20).
2. DIFFERS.
3. - (c) RIDE lift clamp (kinds 4/5): StF rob+0x678 at least 0.15 (0x3E19999A, 0x2D6D4), VF2
     rob+0x650 at least 0.2 (0x3E4CCCCD, 0x236D4); both decay by 0.03 a frame (0x3CF5C28F).
   - (c) Push factor: VF2 always 0.3 (0x23748). StF 0.3, or 0.7 (0x3F333333) when 0x804 bits
     0x2100 together, or 0.65 (0x3F266666) by 0x804>>6 & 0x1A4 bit 2, none of it when one attacks
     (0x804 & 0x1A4 bit 8); stored at rob+0x67C (0x2D73C..0x2D7B0); StF clamps g4 to >= 0.3
     (0x2D7E0).
   - (a) StF-only: 0x1A4 bit 29 skip, g6 bit 0 path sharing the wall vectors 0x644/0x64C when both
     have 0x1A4 bit 18/19 (0x2D84C), cage-wall handling by 0x23C(g13) and rob+0x26 (0x2D8B4), the
     wall-side choice by rob+0x680 with 1.0/0.9/0 factors (0x2D8FC..0x2DA68), clamps to the wall
     distances 0x650..0x65C (0x2DA68..0x2DB3C), rob+0xA68/0xA6C, and copro 0x39007272 -> rob+0xA29
     (area id) per fighter. Harmless: StF's stage.
   - (d) Task 0x164 = VF2 0x148; 0xD4..0xDC = 0xC8..0xD0; 0xCC/0xD0 = 0xC0/0xC4; outputs
     0xE0..0xF4 = 0xD4..0xE8. rob+0x644/0x64C are the same offsets in both.
4. Board impact: none for one fighter; the constants are the pair's. Recommendation: nothing
   (a VF2-pair feel would need both fighters to be VF2's).

### calc_attack_flag (StF 0x2DC48, VF2 0x238A4)
1. Turns the move's attack part id (rob+0x820) into a mask of the balls that attack.
2. DIFFERS (logic the same; tables differ).
3. - (c) Part mask by attack id: StF dword_CE020[0x820], VF2 0x02007ACA[0x820]; the 41 entries are
     equal except id 20: StF 0x206 (parts 1,2,9), VF2 0x202 (parts 1,9). Akira's strikes use ids
     3,4,5,6,8,9,10,13,14,15,16,21,26,40, never 20.
   - (c) Ball -> part: StF rob+0x1D18 (32 words, per fighter, from rob_coli_ball_types), VF2 a fixed
     30-byte table 0x23284 in copro-slot order (VF2's copro returns balls permuted by 0x2394C).
     Checked: 0x23284 equals VF2's part lists (0x02007BEE/0x02007C68) through that permutation, so
     Akira's record (ball order, balls 30/31 on part 0, which no attack id < 41 sets) gives the
     same balls.
   - (a) StF stores rob+0xAC8 (part mask) and rob+0x768 (ball mask); VF2 only returns g3. Harmless.
4. Board impact: none. Recommendation: nothing.

### area_coli (StF 0x2DCA4, VF2 0x2396C)
1. One fighter against the arena edge: wall distances, wall push vector rob+0x644/0x64C, edge
   masks rob+0x614/0x618/0x624.
2. DIFFERS (different arena, different method).
3. - (b)/(c) VF2 does it on the CPU for VF2's ring: copies the 30 copro ball positions (0x90FA00 /
     0x91FA00 by side) to rob+0xD00, tests each against the ring size 0x50A010, height rob+0x1C and
     the ring's edge planes (0x23BB8 count, 0x23BBC normals) and sets the masks and the push
     (ring-out). StF sends the fighter to copro 0x38007070 with stage_soko, stage_x and cage_height
     (raised 10.0 unless rob+0x1A18 finish state or 0x70C bit 9), reads wall distances
     0x650..0x65C, 0x660..0x66C, 0xA58, 0x670, 0x710, and builds the cage-wall state (0x1F0..0x204
     (g13), 0xA08, 0xAE2, byte_2E260/2E230/2E250 tables). Akira fights in StF's stage, so StF's is
     the right one; VF2's ring-edge behaviour (and ring-out) does not exist on the board.
   - (d) rob+0x644/0x64C/0x614/0x618/0x624 are the same offsets and roles in both.
4. Board impact: none. Recommendation: nothing.
