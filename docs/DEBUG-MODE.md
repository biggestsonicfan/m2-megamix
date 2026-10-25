# Debug mode in VF2, FV and StF

Virtua Fighter 2, Fighting Vipers and Sonic the Fighters all keep AM2's debug
mode in their shipped programs. It is the same code in all three: a secret
command, a flag word, a menu engine and windows that show and edit the
fighters' work areas and the fight's globals by Sega's own field names. This
is a read of it in each game, for the names and offsets it gives
`docs/STRUCTURES.md`.

How it was read:

- StF: the program in IDA (Sega's labels where it has them: `debug_Rob0Info`,
  `DEBUG_PARAMETER_SET`...) and stfdisasm's `rom_code1.asm`.
- VF2: the arcade program, rev 2.1 (MAME `vf2`), with vf2-decomp's recovered
  Sega symbols (`debug_sw_check`, `seclet_command_check`, `read_sw`,
  `fa_rob0`...).
- FV: the arcade program, rev D (MAME `fvipers`), matched routine by routine
  against StF's. Its menu item lists and names are in the data ROM
  (0x06Cxxxxx).

The menu windows print each field's name beside it, so the names below are
the ones the games show. Addresses are i960 addresses, in each game's own
program. Where something is inferred and not read, it says so.

## Getting in

| | VF2 | FV | StF |
|--|--|--|--|
| secret command (hold Service, then P1) | Left, P, K, Right, Right, Down, P, Up, K, K | Right, Right, P, Left, Right, P, K, Right, Right, Up, P | same as FV |
| `seclet_command_check` / its table | 0x1200 / 0x1284 | 0x238C / 0x2410 | 0x18F8 / 0x1978 |
| `debug_sw_check` (every frame) | 0x110F4 | 0x11A58 | 0x11788 |
| root menu table, items | 0x7148C, 34 | 0x42848, 28 | 0x3FDE8, 36 |

The table holds input bit numbers (8 punch, 9 kick, 12 down, 13 up, 14 right,
15 left), ended by 0x20; the cursor is at 0x5001DC in all three. A wrong press
or letting go of Service starts it again. When it is done it sets
`debug_flag` bit 14, and from then on `read_sw` passes all eight DIP switches
to 0x500710 (without it, it masks them to 0x08, so only DIP 4 counts). Then:

- **DIP 1 on** clears bit 9: the debug text is on. Every on-screen print
  below waits on it.
- **DIP 2** sets bit 10, which lets the menu open with the text off. In StF
  and FV, bit 14 forces bit 10 on.
- **P2 Guard (Barrier) held and Start 2** opens the menu and stops the
  fight. `debug_mode` is printed at the top of the text layer (0x1000000).

There is no way in through the test menu or backup RAM. In StF, with the text
on, test mode runs six debug test screens instead of the test menu
(`DEBUG_TEST_MODES` 0x592B8: CONTROL_TEST, MOTION_SET, CAMERA_POSITION_2,
MATERIAL, CENTER, TEXTURE).

## debug_flag (0x508000)

The same word and the same bits in all three games.

| bit | what | |
|--:|--|--|
| 1 | start latch | blocks player entry until both Starts are let go |
| 2 | menu open | |
| 3 | open request | also set when a task runs over its CPU time, so the menu opens by itself |
| 4 / 6 / 7 | one-frame pulses: menu closed, step or resume, menu opened | cleared every frame by `debug_sw_check` |
| 5 | **freeze** | about 55 to 60 game tasks skip their frame (`ld debug_flag; bbs 5`): the timer, `rob_control`, the camera, collision, `enemy_control`, StF's water (`sub_2435C`). A Start press with the menu open runs one frame |
| 8 | EXIT chosen | the close path clears 8, 2 and 5, sets 4 and 6 |
| 9 | **debug text off** | DIP 1 off; set at boot |
| 10 | keys allowed with the text off | DIP 2 |
| 11 | `game_music` | set at boot; PARAMETER_SET toggle |
| 12 / 13 | pause / frozen | dev-kit keys (input bits 24, 25), which a production board cannot press (inferred from `read_sw`) |
| 14 | the secret command was entered | |
| 15 | `SE` | set at boot; `sound_queue_output` tests it |
| 16 | `no_kamae_move` | PARAMETER_SET toggle |

## The menu engine

A root entry is `{0x600, lda handler, 0, name}`. The handler loads the
structs it shows into g4..g7 (g7 is the fighter), opens a window and gives it
an item list: a count, then pointers to items. An item:

| offset | what |
|--|--|
| +0x0 | flags: bit 31 show only, 8 editable, 9 action, 10 close after, 30 one bit, 12..15 size (0 s32, 1 u8, 2 u16, 3 float, 5 s8, 6 s16), 16..17 display (dec, hex, float, name table) |
| +0x4 | the 8-byte load that reads the value, e.g. `ldos 0x1a8(g7),g0`. The engine copies it to RAM 0x59F270 and runs it; setting bit 25 turns the load into the store that edits it |
| +0xC | u16: width, decimals |
| +0xE | the bit, for one-bit items |
| +0x10 | min, max, action and name-table words as the flags ask, then the name |

The load in each item is what gives each name its offset.

## The windows

| window | VF2 | FV | StF | shows |
|--|:-:|:-:|:-:|--|
| EXIT, CPU_TIME, CELL DISP, BREAK POINT, COIN SETTING | ✓ | ✓ | ✓ | |
| ROB0_INFO / ROB1_INFO | ✓ | ✓ | ✓ | the fighter, about 90 (VF2), 122 (FV), 150 (StF) fields |
| GAME_PARA, DOWN_EFC_SPD | ✓ | ✓ | ✓ | the fight's tuning values, the knock-down table |
| PARAMETER_SET | ✓ | ✓ | ✓ | time, rounds, stage, both characters, BGM, SE |
| ROB0_PARAMETER / ROB1_PARAMETER | ✓ | ✓ | ✓ | the CPU player |
| CAMERA, CAMERA_INFO | ✓ | ✓ | ✓ | the camera struct |
| GYANG | ✓ | ✓ | unused | facing and ground angle |
| ROB_LIGHT | ✓ | ✓ | unused | per-character light |
| COLOR TEST, OBJECT TEST, POLYGON TEST | ✓ | ✓ | ✓ | |
| COLI BALL0/1 R, PARTS0/1_INFO | – | ✓ | ✓ | collision radii, armour |
| COLI POS0/1, COPRO RAM, DEBUG_UNIT0/1, EN COMMAND, DEBUG | – | – | ✓ | |
| REPLAY, MOT_KIND DISP, ANGLE, POSITON, SYSTEM INFO | ✓ | – | – | |

## The fighter: ROBn_INFO

g7 is `*fa_rob0` (0x500804) or `*fa_rob1` (0x500808) in all three games.
VF2's two are at 0x510980 and 0x512980. A blank is a field that game's window
does not show (it may still be there).

| field | VF2 | FV | StF | what |
|--|--|--|--|--|
| `flag` | +0x000 | +0x000 | +0x000 | u32 bits, below |
| `idnm` | +0x004 | +0x004 | +0x004 | u8 |
| `xpos` `ypos` `zpos` | +0x018..+0x020 | same | same | f32 |
| `yang` | +0x026 | +0x026 | +0x026 | u16; the menu edits its high byte +0x027 |
| `xspd` `yspd` `zspd` | +0x02C..+0x034 | same | same | f32 |
| `hara_xpos` .. `hara_zpos` | +0x080..+0x088 | same | same | f32, the body's centre |
| `command` | +0x194 | +0x194 | +0x194 | u32, the matched command (StF `decide_command` sets 0x21004000+n) |
| `action` | +0x19C | +0x19C | +0x19C | u32; its top byte +0x19F is the action state `js/engine.js` `ST` numbers |
| `mot_kind` | +0x1A4 | +0x1A4 | +0x1A4 | u32 bits, below |
| `mot_num` / `mot_coma` | +0x1A8 / +0x1AA | same | same | u16 motion / frame |
| `energy` | +0x1AC | +0x1AC | +0x1AC | u16 |
| `1P CHAR` / `2P CHAR` | +0x1B0 | +0x1B0 | +0x1B0 | u8 character (PARAMETER_SET) |
| `step` | +0x1B2 | +0x1B2 | +0x1B2 | u8 |
| `gxpos` .. `gzpos` | +0x1F4..+0x1FC | same | same | f32 |
| `act_yang` / `en_dir_yang` | +0x5B4 / +0x5B6 | same | same | |
| `en_flag` | +0x5B8 | +0x5B8 | +0x5B8 | u32 bits, the opponent as seen from here |
| `land_time` / `jump_h` | +0x5BC / +0x5BE | same | same | |
| `jp_next_lacoma` | | +0x5C0 | +0x5C0 | |
| `rob_weight` | | +0x5D8 | +0x5D8 | f32 (VF2 sets it at +0x5D8 too, SHARED-CODE.md) |
| `down_counter` | +0x5DE | +0x5DE | +0x5DE | |
| `en_dist` / `front_out` / `back_out` | +0x5F4 / +0x5F8 / +0x5FC | same | same | f32 |
| `gyang_how` | +0x60D | +0x60D | +0x60D | u8 (GYANG) |
| `stage_on` / `gyang` / `support` | +0x614 / +0x616 / +0x618 | same | same | |
| `tag_yang` | | +0x61A | +0x61A | |
| `out_on` / `tag_en_coma` / `sleep_time` | +0x624 / +0x626 / +0x62A | same | same | |
| `sleep_command` | +0x654 | +0x684 | +0x684 | |
| `hara_yang_ave` / `_mat` | +0x658 / +0x65A | +0x688 / +0x68A | +0x688 / +0x68A | |
| `asi_asi_dist` / `asi_asi_h` | +0x66C / +0x670 | +0x69C / +0x6A0 | +0x69C / +0x6A0 | f32 (GYANG) |
| `min_out` | +0x678 | +0x6A8 | +0x6A8 | f32 |
| `kage in flag` / `kage ot flag` | | +0x6B0 / +0x6B4 | +0x6B0 / +0x6B4 | |
| `SUI_PTN` / `EGG_PTN` | +0x69C | | +0x6CC | u8 (COLOR TEST) |
| `attack_count` | +0x6B2 | +0x6E2 | +0x6D0 | |
| `defence` | +0x6B4 | +0x6E4 | +0x6D4 | bits: hd_ta_guard, hd_sy_guard, hd_sy_yoke, hd_air_yoke, hd_mk_change |
| `gu_atk_count` / `kaeshi_no` | +0x6BC / +0x6BE | +0x6EC / +0x6EE | +0x6D8 / +0x6DA | |
| hit combo / down hit combo | +0x6D8 / +0x6D9 | +0x708 / +0x709 | +0x6F4 / +0x6F5 | u8, counted on the fighter hit. Not in the window: the `%d hit combo` print adds 1 and shows it (VF2 0x22918, FV 0x26254, StF 0x2B018) |
| `no_coli` | +0x6DC | +0x70C | +0x6F8 | |
| `mot_kind2` | | +0x720 | +0x70C | u32 bits |
| `en_nage_flag` | | +0x734 | +0x720 | u32 bits, which throws the opponent can take |
| `parts_weight` / `huamn_weight` (sic) | | +0x7DC / +0x7E0 | +0x7D8 / +0x7DC | f32 |
| `hit_unit` / `hit_ratio` | | +0x7E4 / +0x7E8 | +0x7E0 / +0x7E4 | |
| `parts_unit` / `org_parts_unit` | | +0x7EC / +0x7EE | +0x7E8 / +0x7EA | |
| `flag_old` | | +0x7F0 | +0x7EC | last frame's `flag` |
| `parts_flag` | | +0x7F4 | +0x7F0 | (PARTS_INFO) |
| `motd_leng` / `motd_next` | +0x800 / +0x802 | same | same | the motion's setup record from here on |
| `motd_kind` | +0x804 | +0x804 | +0x804 | u32, the same bits as `mot_kind` |
| `motd_main` / `follow1` / `follow2` | +0x808 / +0x80A / +0x80C | same | same | u16: hit, cancel and end frames |
| `motd_jump_coma` | +0x80E | +0x80E | +0x80E | |
| `mov_yang` | +0x812 | +0x812 | +0x812 | |
| `motd_stop_coma` / `motd_land_coma` | +0x816 / +0x818 | same | same | |
| `motd_ap` | | +0x821 | +0x821 | |
| `motd_damage` | +0x822 | +0x822 | +0x822 | u8 |
| `motd_kaesare` | +0x844 | +0x844 | +0x844 | |
| `skelton_type` | | | +0x84C | u8 |
| `guard_stop` / `yarare_stop` / `counter_stop` | +0x85C / +0x85D / +0x85E | same | same | u8 |
| `motd_ng_para` / `motd_kind2` | | +0x85F / +0x860 | +0x85F / +0x860 | |
| `motd_uk_type` / `motd_uk_coma` | | +0x864 / +0x868 | +0x864 / +0x868 | |
| `motd_down_coma` / `motd_atk_ang` | | +0x872 / +0x876 | +0x872 / +0x876 | |
| `mot_basic_step` | +0xA00 | +0xA00 | +0xA00 | u8 |
| `brk_up_damage` / `brk_dn_damage` | | +0xAF0 / +0xAF4 | +0xAF0 / +0xAF4 | (PARTS_INFO) |
| `smooth_type` / `smooth_f_coma` / `smooth_r_coma` | +0xBDD / +0xBDE / +0xBE0 | same | same | motion blending |
| `smooth_timer` / `smooth_sw` / `smooth_flag` | | +0xBE2 / +0xBE4 / +0xBE5 | same | |
| `old_motd_kind` | | +0xC30 | +0xC30 | |
| `old_mot_coma` | +0xC4E | +0xC4E | +0xC4E | |
| pad | +0x1200 | +0x1200 | +0x1200 | not in the window; the input ring after it is |
| `write_pnt` / `read_pnt` | +0x1202 / +0x1203 | same | same | u8, the input ring |
| `not_rp` / `not_dir_rp` / `not_yoke_rp` | +0x1204..+0x1206 | same | same | u8 |
| `wait_coma` | +0x120E | +0x120E | +0x120E | |
| `pc_command` | +0x1218 | +0x1218 | +0x1218 | the command (move matcher) table in use |
| `pc_spe_adr` / `pc_spe_time` | +0x121C / +0x1220 | same | same | |
| `withhold_time`, `_trig`, `_pnt` (and `1`), `withhold_pnt_c` | +0x123C..+0x1242 | same | same | |
| DEBUG_UNIT part bits / `my_status` | | | +0x124C / +0x1250 | `my_status` bit 0 near a wall, 1 near the wall behind |
| collision balls | | | +0x1D0C | pointer to 32 balls of 16 bytes, radius at +0xC |
| `mov_spd_xpos` .. `zpos` | +0x1E00..+0x1E08 | same | same | f32 |
| `old_gxpos` .. `gzpos` | +0x1E0C..+0x1E14 | same | same | f32 |
| `old_mot_kind` / `old_mot_num` | +0x1E18 / +0x1E1C | same | same | |
| `old_mot_kind2` | | +0x1E24 | +0x1E24 | |
| `dmg_*`, `arm_*` (16 parts, u16) | | +0x1F00, +0x1F20 | same | armour (PARTS_INFO) |
| `pnum_*` (16 parts, u8) | | +0x1F4C | +0x1F4C | |
| `up_damage` / `down_damage` / `old_up_damage` / `old_down_damag` | | +0x1F74..+0x1F80 | same | s32 |

The three are one struct. Up to +0x62A and from +0x800 on, every field is at
the same offset in all three games. In between, FV has 0x30 bytes more than
VF2 (from `sleep_command` on: VF2's `SUI_PTN` +0x69C is StF's `EGG_PTN`
+0x6CC). StF keeps FV's offsets to +0x6B4, has 0x10 to 0x14 bytes fewer from
`attack_count` to `en_nage_flag`, and 4 fewer from `parts_weight` to
`parts_flag`. That is why the hit combo is at +0x6D8 in VF2, +0x708 in FV and
+0x6F4 in StF.

### flag (+0x000)

| bit | name | bit | name |
|--:|--|--:|--|
| 0 | mot_end | 13 | land |
| 1 | disp_left_look | 14 | can_ukemi |
| 2 | fix_hara | 15 | rise_cancel |
| 3 | ypos_check_pass | 17 | camera_mesen (StF) |
| 4 | compel | 20 | me_muken (StF) |
| 5 | lost (VF2 sets it on the loser at 0xE744) | 21 | kao_init |
| 6 | mirror | 22 | dont_revise |
| 7 | init_end | 23 | kao_muken |
| 8 | pl_syagami | 24 | gyang_disp (shows the ground angle) |
| 9 | tag_yang | 25 | coli_ball_disp (shows the collision balls) |
| 10 | next_mirror | 26 | smooth_switch |
| 11 | mot_change | 27 | option_unit_f |
| 12 | mk_change_req | 28 / 29 / 30 | hadaka, small, automatic (StF) |

FV and StF name them from one table (FV 0x453A0, StF 0x44608), the same
names. VF2's window toggles bits 22 to 26.

### mot_kind (+0x1A4), motd_kind (+0x804)

0 mk_change, 1 mk_begin, 2 mk_follow, 3 mk_syagami, 4 mk_air, 5 mk_move,
6 mk_turn, 7 mk_trans, 8 mk_attack, 9 mk_kamae, 10 mk_walk, 11 mk_back,
12 mk_jump, 13 mk_guard, 14 mk_down, 15 mk_rise, 16 mk_down_pose,
17 mk_yarare, 18 mk_nage, 19 mk_nagerare, 20 mk_dturn, 21 mk_mirror,
22 mk_ride_on, 23 mk_kaeseru, 24 mk_gacha, 25 mk_dont_r_yang, 26 mk_g_atk,
27 mk_run, 28 mk_revise, 29 mk_nagehanashi, 30 mk_muteki, 31 mk_yoke.

That is StF's table (0x44294). FV's (0x450EC) has the same names, but 26 to
31 read mk_yoke, mk_run, mk_revise, mk_nagehanashi, mk_muteki, mk_ex_step.

### mot_kind2 (StF +0x70C, FV +0x720)

0 mk2_kabe_shift, 1 tsunaganai, 2 ukemi, 3 sankaku, 4 kikite, 5 replay,
6 replay_init, 7 winpose, 8 zibaku, 9 out, 10 pika, 11 air_nstart. StF goes on:
12 skelton, 13 ude_r, 14 ude_l, 15 asi_r, 16 asi_l, 17 jiku, 18 tobikoe,
19 touch_nage, 20 back_attack, 21 hadou, 22 attack_once, 23 kosi_nobi,
24 nc_barrier, 25 tobi_guard, 26 start_combo.

### en_flag (+0x5B8), en_nage_flag (StF +0x720, FV +0x734)

`en_flag`: 0 en_from_behind, 1 en_not_look_me, 2 en_run,
3 en_look_right_attack, 4 en_kamae_mirror, 5 en_down_attack; StF also
6 en_small, 7 en_tikazuku, 8 en_tozakaru, 9 en_up_move, 10 en_down_move. Then
15 kt_right, 16 kt_te_tori, 17 kt_asi_tori, 18 kt_punch_kaeshi,
19 kt_low_punch_kaeshi, 20 kt_hiji_kaeshi, 21 kt_kick_kaeshi,
22 kt_mid_kick_kaeshi, 23 kt_low_kick_kaeshi, 26 kt_nage_special,
30 kt_sy_guard.

`en_nage_flag`: 0 en_nagereru, 1 _2, 2 sy, 3 ura, 4 usy, 5 max, 6 down,
7 ura_down, 8 en_kabe_chikai, 9 en_ura_kabe_chikai, 10 combo, 11 combo_ura,
12 touch, 13 touch_ura, 15 en_touch_nage, 16 air, 17 air_ura, 18 airz,
19 airz_ura, 20 airk, 21 airk_ura.

## The fight's globals

### The match

The same addresses in all three games.

| address | name | what |
|--|--|--|
| 0x500024 | `ctrl_timer` | |
| 0x500028 | game timer | u16, set to `time` × 64 when a round starts (VF2 0xE398, FV 0xD530), counted down each frame (VF2 0xBC30, FV 0x9D90), stopped by `debug_flag` bit 5 |
| 0x50002A / 0x500030 | `mode` / `sub_mode` | the main mode and the round's sub-mode; the debug text prints their names |
| 0x50004C | `gameprogram` | (VF2 REPLAY) |
| 0x50004D | round winner | 0, 1, or 2 for a draw (VF2) |
| 0x50004E | match winner | |
| 0x50004F / 0x500051 | round wins P1 / P2 | a draw gives both one (VF2 0xE6B4) |
| 0x500052 | wins needed | |
| 0x500055 | current round | |
| 0x500064 | `stage` | 0..15; changing it in PARAMETER_SET reloads the stage |
| 0x500065 | `winner` | (VF2 REPLAY) |
| 0x50008F | `round` | the rounds setting |
| 0x500090 | `time` | the round time setting, 1..99 |
| 0x500091 | `look_char` | (VF2 REPLAY) |
| 0x5000A0 | `energy_max` | |
| 0x500804 / 0x500808 | `fa_rob0` / `fa_rob1` | the fighters |
| 0x500814 | `fa_camera` | the camera |

### The tuning block (0x50A000)

GAME_PARA, DOWN_EFC_SPD, PARAMETER_SET and GYANG edit it. VF2 and FV keep
every field at the same address. StF does too up to 0x50A0DC, and from
0x50A148 on it has them 0x68 later.

| name | VF2, FV | StF |
|--|--|--|
| `stage_x` | 0x50A00C | 0x50A00C |
| `stage_xpos` / `stage_ypos` | 0x50A014 / 0x50A018 | same |
| `stage_xang` / `stage_yang` / `stage_zang` | 0x50A021 / 0x50A023 / 0x50A025 | same |
| `en_ang_dist` | 0x50A028 | 0x50A028 |
| `lau_mul_J` / `lau_add_xang` / `limit_xang` | 0x50A0A8 / 0x50A0B0 / 0x50A0B4 | same |
| `nagerenai_timer` / `attack_base` | 0x50A0B6 / 0x50A0B7 | same |
| `DEBUG_NUMBER` P1 / P2 | 0x50A0B8 / 0x50A0B9 | same; StF names 0 NORMAL_MODE, 1 COM_PLAYER, 3 DEKU_MODE, 5 MAN_PLAYER |
| `rise_base` / `precede_inp_time` | 0x50A0BA / 0x50A0BB | same |
| `gyang_yvec` .. `gyang_asi_h` | 0x50A0BC..0x50A0CC | same |
| `stage_xmin` / `xmax` / `vxmin` / `vxmax` | 0x50A0D0..0x50A0DC | same |
| ROB_LIGHT (per character) | 0x50A0E0.. | (unused window) |
| `stage_low_judge` | 0x50A148 | 0x50A1B0 |
| `guard_limit` | 0x50A14C | 0x50A1B4 |
| pole shift | 0x50A14D bit 0 | 0x50A1B5 bit 0 |
| `combo_sub` | 0x50A14E | 0x50A1B6 |
| `cage_ypos` | 0x50A160 | 0x50A1C8 |
| `combo_start` / `combo_limit` | 0x50A16E / 0x50A170 | 0x50A1D6 / 0x50A1D8 |
| `no_coli_low` / `no_coli_ahigh` | 0x50A174 / 0x50A178 | 0x50A1DC / 0x50A1E0 |

The knock-down table DOWN_EFC_SPD shows is one entry per down type of
`pow`, `cu_pow`, `dw_pow`, `cu_dw_pow`, `dw_air_pow`, `cu_dw_air_pow` (f32)
and `dw_xang`, `cu_dw_xang`, `dw_air_xang`, `cu_dw_air_xang` (s16): how hard
and at what angle a fighter is knocked down, `cu_` on a counter (inferred).

## The camera (`*0x500814`)

From CAMERA and CAMERA_INFO; FV and StF agree, VF2 at the angles it shows.

| offset | name |
|--|--|
| +0x00 | display flags: 1 rob0_disp, 2 rob1_disp, 14 cage_f_disp, 15 cage_no_disp, 16..21 o_, u_, g_, stage_, obj_, etc_no_disp |
| +0x18 / +0x1C / +0x20 | `xpos` / `ypos` / `zpos` |
| +0x24 / +0x26 / +0x28 | `xang` / `yang` / `zang` (u16; the menu edits the high bytes) |
| +0x40 | `cam_mode` |
| +0xB4 / +0xB8 / +0xBC | `intrXpos` .. `intrZpos`, the point it looks at |
| +0xDF bit 0 | `thunder` |
| +0xF8 | `game_xang` |
| +0x120..+0x128 | `cam_st_x` .. `cam_st_z` |
| +0x2DC / +0x2E0 | `ypos_bias` / `dir_bias` |
| +0x2E8 / +0x2EC / +0x2F0 | `cam_dist` / `center` / `zure` |
| +0x304 / +0x306 / +0x309 | `yang_spd` / `yang_kirikae` / `next_yang` |
| +0x30C | `cam_dist_ratio` |

## The CPU player (ROBn_PARAMETER)

The window's g7 is the CPU player's work area: VF2 `*fa_enemy0/1`
(0x500844 / 0x500848), StF `mod_fa_enemy0/1` (0x50083C / 0x500840). FV's
items read the same offsets as StF's (its pointer was not traced).

| name | VF2 | FV | StF |
|--|--|--|--|
| `NAGE_YAME_TIME` | +0x4C | +0x4C | +0x4C |
| `ATTACK`, `SYA_ATTACK`, `UP_ATTACK`, `DEFENCE`, `YOKE`, `CHANCE`, `KAESI`, `DOWN_ATTACK`, `OKIAGARI`, `FUKKATSU`, `NAGE` | +0x50..+0x5A | +0x54..+0x5E | +0x54..+0x5E |
| `TEKAGEN` | +0x5B | | +0x5F |
| current rates (same order) | +0x5C.. | | +0x60..+0x6A |
| `ENEMY_MODE` | | +0x6C | +0x6C |
| `WAZA_NUM` / `WAZA_CNTR` | +0x9E / +0xAB | | +0xBA / +0xC5 |
| `WAZA_CHECK` / `WAZA_NUMBER` | | +0xD1 / +0xD2 | +0xD1 / +0xD2 |

With `WAZA_CHECK` on, StF refills both energies, sets the timer to 0x780 and
checks each move it plays against its expected main frame, follow length and
damage (+0xD3..+0xD5), printing `MAIN OK !!` or `MAIN`, `FOLLOW` or
`DAMAGE WRONG !!`. FV prints the same strings (0x3FAC4).

## On screen, with the text on

- The mode and sub-mode names (`ROUND_INT`, `READY_DSP`, `FIGHT_INT`,
  `JUDGE_WAIT`...).
- CPU time per task (`CPU_TIME`, `GAME_TIMER`, `CPU_POWER`, `WORST`, `FAIL`,
  `POLYGON`, `working_rate`); a task over its limit opens the menu.
- `%d hit combo` and `%d down hit combo`, from the victim's counters above.
- The matched command's class (`airn`, `nage`) and the hit's kind
  (`tetsu`, `air`, `tender`, `hit`, `multi`); VF2 prints `sd_nage` and `hit`.
- The overlays the menus switch on: collision balls and ground angle (`flag`
  bits 25 and 24), VF2's MOT_KIND DISP and replay keys.

The print routines are `debug_disp_mes` (inline string), `_int`, `_hex`,
`_hex_h`, `_float` (StF 0x6624, 0x65C0, 0x65D0, 0x65E8, 0x65BC; FV
0x6D3C, 0x6CD8, 0x6CE8, 0x6D00, 0x6CD4).
