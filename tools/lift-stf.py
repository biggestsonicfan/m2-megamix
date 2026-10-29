#!/usr/bin/env python3
"""Lift Sonic the Fighters' motion code into the board build.

The board build runs StF's own motion pipeline: the i960 routines from
set_motion to calc_unit_mat, copied out of stfdisasm (the owner's
disassembly of StF's program, which assembles to the ROM bit for bit). This
writes them as board/src/stf_motion.s, assembled with the rest of the
program, and board/src/stf_motion.h for the C that drives them.

What changes on the way:
  - Each routine keeps its instructions. A label the disassembler gave to a
    number (`lda loc_3A48, r15` is the coprocessor address 0x3A48,
    `system_address_table_ptr(g6)` is 0(g6)) goes back to the number.
  - StF's RAM (its fixed work-RAM addresses, as numbers or as include.s
    names) moves into blocks of the board program's own RAM, which
    stf_motion.h maps (stf_ram(addr)): the board program's .bss sits where
    StF's globals were.
  - StF's ROM tables at 0xC0000..0xFFFFF (the skeletons, models, motion
    records and hand and head lists, pointers into each other) are copied to
    the same addresses in the board's program ROM (stf_rom_c0000.bin, the
    .stfrom section), so their pointers hold. The tables lower down that
    the routines read (jump tables, the mirror list) come with the code.
  - Collision routines the board does not run return at once (STUBS).

    python3 tools/lift-stf.py [--stfdisasm DIR] [--out board/src]

Needs i960-elf-as and i960-elf-nm (the board's toolchain).
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile

# sub_7F0E8 ("Inits player bodies"): each character's dent pendulum constants.
# action_init and rob_action: a fighter's task (its moves, frame by frame);
# sub_1D47C: rob_control's command decoder (the pad to moves); coli_init and
# collision: the collision task (hits, damage, the walls); get_game_info:
# the task after it (each fighter's own state, and the angle and distance to
# the other, which the fighters turn by); cam_mode_9 and cam_mode_10: the
# fight's camera (camera_work's modes for a round: 9 places it, 10 follows);
# zanzou_control: the afterimages (the projectile task's last call: reserves
# a fighter's trailing parts in the geometrizer's ring while play op 0x26's
# mask is set, effects.c zanzou_draw draws them); sub_8A29C: the projectile
# task's step loop (each live object's step through projectile_list; only
# Eggman's bomb, type 2, has its steps lifted, effects.c tobi_draw draws it).
# The colours (colorxlat), as StF's change_scene and its debug menu's colour
# refresh (0x46754) set them: stage_disp (the stage record's RED, GREEN, BLUE,
# then chg_pol_color_req's ramp, luma 0..47 of rows 0..27, which
# chg_pol_color_send writes a few rows a call), make_lay_col_256_tbl (the
# ARRAY_NUM curves every upload goes through), chg_scr_color_req (luma
# 64..127, the flat band palette colours go through), sub_7B4 (the boot's
# fixed rows 5..6 and 12..13), send_tex_col_stage (the stage's sixteen
# colours, rows 14..27), send_tex_col_skin and send_tex_col_part (a fighter's
# skin rows and part rows); sub_2435C: the stage's colour cycling, once a
# frame (interrupt_wait_b); set_display_type_crt: the test menu's CRT
# setting, the TST_* curve constants (into the backup RAM and its copy, then
# load_COLORS_to_RAM and chg_scr_color_req).
# osage_init: a fighter's sway chains (Honey's ponytail, Fang's tail), the
# task that sets them up and becomes osage_dsp, which steps and draws them.
# The fighters' shadows (docs/SHADOWS.md): sub_63AC4 (camera_init's: the
# light to the coprocessor, op 0x73, then sub_63B10's two masks a player,
# op 0x75), rob_kage_disp_inside (after the stage: the near mask, and the
# projectiles' shadows) and rob_kage_disp_outside (after each fighter: the
# far mask), both through rob_kage_disp_test's op 0x74 and set_obj.
# The eyes: snc_eye_thd_set (camera_init's, a fighter at a time) turns the
# other fighter's head (or the camera) into the head's frame and, through
# clip_medama and its table by character (word_21734), into a shift of each
# eye's texture points, which move_tpd_req queues and tpd.c eyes_frame
# uploads; tpd_move_init empties the queue (main_loop's, once a frame).
# The spin attack (Sonic's spindash; a play op of the motion, sub_81A48, sets
# rob+0x2068): sub_81038 (a battle's start: each fighter's ball models and
# pulse from character_spin_mot_objects), spin_attack_cnt (camera_init's,
# after a spinning fighter's rob_disp: the ball's turn and pulse) and
# spin_smoke_trg (a puff of smoke every third frame); the puffs' own steps
# (sub_81CD8, sub_81D44, sub_81DB0) are what spin_smoke_cnt calls, which
# fighter_draw.c spin_frame draws as it does.
# The replay of a move (FV's REP_WAZA, which StF kept the code of and never
# starts; replay.c rep_start): rec_disp (the record task: both fighters'
# frame into the ring, once a frame) and sub_3900C (the play task's start:
# the effects put by, the first frame loaded, then replay_waza_disp, a
# frame a frame, and put_last_replay back to the live frame at the end).
ROOTS = ['set_motion', 'calc_rob_angle', 'calc_rob_angle_cont', 'calc_unit_mat', 'smooth_int', 'sub_7F0E8',
         'action_init', 'rob_action', 'sub_1D47C', 'coli_init', 'collision', 'get_game_info', 'cmd_native_tail',
         'cop_initialize_end2', '_Scroll_Initialize', 'energy_disp', 'barrier_left_disp_init',
         'barrier_left_disp', 'time_dsp', 'win_lamp_dsp', 'win_lamp_int', 'cam_mode_9', 'cam_mode_10',
         'zanzou_control', 'sub_8A29C',
         'stage_disp', 'make_lay_col_256_tbl', 'chg_scr_color_req', 'chg_pol_color_req', 'chg_pol_color_send',
         'sub_7B4', 'send_tex_col_stage', 'send_tex_col_skin', 'send_tex_col_part', 'sub_2435C',
         'set_display_type_crt', 'osage_init', 'sub_63AC4', 'rob_kage_disp_inside', 'rob_kage_disp_outside',
         'snc_eye_thd_set', 'tpd_move_init', 'sub_81038', 'spin_attack_cnt', 'spin_smoke_trg',
         'sub_81CD8', 'sub_81D44', 'sub_81DB0', 'ring_tobitiri_init', 'ring_tobitiri',
         'efc_disp', 'efc_face_opt_disp', 'guard_attack_effect_disp', 'kira_kira_disp',
         'guard_barrier_effect_disp', 'laser_effect_disp', 'fa_effect', 'ko_disp',
         'rec_disp', 'sub_3900C']
# Routines the board does not run (debug text, name plates,
# Super Sonic's hair objects; the shadow mask balls, which read a table at
# 0x4C84 and kage.c's kage_balls sends): `ret`.
STUBS = ['print_mes', 'print_mes_ex', 'print_hex_w', 'debug_disp_hex', 'dsp_pattern_right',
         'char_nameplate_dsp', 'sub_1BCC0',
         'send_kage_ball_pntr']
# Routines the board's C does in their place: StF's two sound requests,
# which queue a code (g0) for the sound board (sound.c snd_request_u and
# snd_request_special; StF's sends it from an interrupt of its own, which the
# SDK's table does not have). They keep every g register, as StF's do
# (sound_request_special saves g0..g3 and g14; its callers keep values there).
TO_C = {'sound_request_u': '_snd_request_u', 'sound_request_special': '_snd_request_special'}
# Labels the routines use as numbers (`lda loc_10000, r3` is 0x10000, `lda
# off_1010, r13` the flag mask 0x1010; get_en_info's `lda loc_5550` and `lda
# off_1018` are the facing bound 0x5550 and the flag mask 0x1018 its throw
# range bit tests; zanzou_control's `lda loc_32180+1` is the word it sends
# Fn 0x49 before zanzou_ma, `lda loc_1C38` the slot bits it swaps for a
# mirrored fighter); any other code label they load (a
# task's next function, a callback) is lifted and keeps its name.
NUMBERS = {'loc_1FFC', 'loc_2AA8', 'loc_6600', 'loc_7FF8', 'loc_8020', 'loc_8040', 'loc_BFF4', 'loc_10000',
           'loc_20010', 'loc_2100', 'loc_7A00', 'loc_14060', 'sys_proc_table',
           'off_1010', 'dword_4010', 'loc_AAA0', 'loc_5550', 'off_1018', 'loc_32180', 'loc_1C38'}
# Labels the routines' data uses as numbers, where the code uses them as
# labels: the wind table dword_689E4's `.long send_tex_col_part` is 0x800.
DATA_NUMBERS = {'send_tex_col_part'}
# The tail the move tables' inline code (opcode 0x13: `lda N, g0; b 0x1EF48`)
# branches to, after sub_1E468, unlabelled in stfdisasm.
NATIVE_TAIL = 'cmd_native_tail', 0x1EF48, 'ld      0x1A4(g7), r15  # unreachable code'
# Lines given a label of the board's, so that INSERT can put code before
# them: the label, the routine, and the line after which it goes (the first
# match from the routine's label on). coli_cont_cop_g4: the line after
# coli_cont_cop reads function 0x3B's results back (g4 the push).
# area_coli_618: area_coli's store of the copro's 0x618 word.
# rsc_gra_vf2, rsc_gra_done: rob_spd_control's [0x50A004] x gravity and the
# x 0.25 after it (StF 0x17F90..0x17F9C).
NAMED = {'coli_cont_cop_g4': ('coli_cont_cop', 'ld      (g11)[g12*1], g5'),
         'area_coli_618': ('area_coli', 'st      r6, 0x624(g7)'),
         'rsc_gra_vf2': ('rob_spd_control', 'mulr    r13, r14, r5'),
         'rsc_gra_done': ('rob_spd_control', 'mulr    r13, r5, r5'),
         'damage_calc_vf2': ('damage_calculation', 'call    ketchup'),
         'pit_vf2_1': ('loc_1DC74', 'cmpible r4, r3, loc_1DC84'),
         'pit_vf2_2': ('loc_1DCD4', 'cmpible r4, r3, loc_1DCE4'),
         'pit_vf2_3': ('loc_1DD80', 'subo    1, r5, r5'),
         'contact_lag': ('loc_29428', 'call    coli_cont_cop'),
         'vf2_down_pick': ('loc_1E0A0', 'bbc     4, r8, loc_1E0E4')}
# Tables below 0x1000 that are tables all the same (cop_initialize_end2's
# collision-ball pointers).
LOW_TABLES = {'off_FE8'}
# Tables read on past their end, into the next label's (off_1008's eight
# pointers run through off_1010 into off_1018; both labels are numbers to the
# code, so nothing else keeps their data). osage_per_character's 52 entries
# run through kill_osage_sub (player 2's Honey on).
RUN_ON = {'off_1008', 'off_1010', 'osage_per_character'}
# Jump tables in the ROM range that hold code (the camera's script steps;
# projectile_list's records and Eggman's bomb's start and steps):
# lifted with the code, as the copied ROM holds StF's addresses.
ROM_CODE_TABLES = {'off_9C83C', 'off_9C848', 'projectile_list', 'projectile_I_list', 'bean_bomb_roll',
                   'bean_bomb_roll_1', 'off_8D3D8'}
# Data blocks that point into themselves (the fight camera's motion table
# and its scripts, `.short` halves and `.long`s): lifted as words, each
# word that is an address inside the block made relative to its label.
SELF_REL = {'word_6BE90'}
ROM_LO, ROM_HI = 0x80000, 0x100000      # copied to the same addresses
ROM_BIN = 'stf_rom_80000.bin'
# animation_related (519 motions' setups, a 13-byte head then ops, each
# op's length in byte_1D006) and the strike damage that breaks armour
MOTION_SETUPS, MOTIONS, SETUP_HEAD, SETUP_LENGTHS = 0xCE380, 519, 13, 0x1D006
ARMOUR_BREAK = 30
RAM_LO, RAM_HI = 0x500000, 0x600000     # StF's work RAM: moved into the board's
RAM_PAD = 0x400                          # room past the highest address a block names
# RAM the routines reach through a base: the two fighters' motion records
# (action_init: 0x520000 and 0x5207C8, 0x800 bytes each), chg_pol_color_req's
# ramp (0x546008, 0x120 bytes a row, rows 0..27) and the backup RAM's copy
# (add_BACKUP_RAM_TO_RAM, 0x599000, which fighter.c points it at), and the
# scattered rings (ring_tobitiri_set: 24 records of 44 bytes from 0x574010,
# then its counts at 0x574B10); the replay's: rec_disp's ring (240 frames of
# 0x88 bytes from 0x535000) and the effect task's copy while a replay plays
# (sub_3A200, 0xC80 bytes at 0x570000).
RAM_SPANS = [(0x520000, 0x520FC8), (0x546000, 0x547F88), (0x599000, 0x59C400), (0x574000, 0x574B20),
             (0x535000, 0x535000 + 240 * 0x88), (0x570000, 0x570C80)]
# The per-character tables a guest fighter (a character of another game in a
# StF character's place) needs entries of its own in: the routines read them
# at fixed addresses in the data ROM instead (guest_<name>), where
# tools/import-assets.mjs writes StF's tables with the guests' entries in.
# Each is given its room there; the rest, from GUEST_HEAP, is the guests' own
# records, motions and programs. stf_motion.h has the addresses
# (STF_GUEST_<name>).
GUEST_BASE = 0x02E00000
# name, its room, StF's own table's length (what it starts as): 52 characters
# (player 2's are 26 on), 24 move tables, 4 skeletons, 21 kinds of head
# change (each a list by character), 519 motions, and each character's hit
# reactions (sub_2B94C). motion_remap is the board's own (StF has none: it
# starts as zeros): a list by character of a motion each id plays instead.
# char_game is the board's own too: a byte by character (52, player 2's 26
# on), the game the character comes from (GAMES: 0 StF, the zeros it starts
# as), which code that treats another game's fighter its own way branches on.
# rob_coli_ball_types: a list by skeleton type (rob+0x84C) of lists by
# character of collision-ball records; the lists are copied into its room.
# midriff is the board's own: a pointer by character (52) to the band VF2
# and Fighting Vipers draw between the hips and the chest (0: none, as for
# every StF fighter); fighter_draw.c builds it every frame.
# seams is the board's own too: a pointer by character (52) to a list of the
# meshes that span a joint (0: none), each drawn on one part with its far
# corners carried from another's every frame (fighter_draw.c seams_build; Ryo's,
# tools/ryo-guest.mjs).
# off_C2058: a list by skeleton type (rob+0x84C) of lists by character of
# the bones calc_rob_angle_cont solves the pose on (15 points: the chest,
# the head, each arm's and leg's pivot and two bones, the pelvis); the
# lists are copied into its room.
# off_B540C: a list by skeleton type (rob+0x84C) of lists by character of
# the afterimage models (16 parts, each 3 model ids and a pad), which
# zanzou_control reserves for each slot in play op 0x26's mask; the lists
# are copied into its room.
# off_64988: a pointer by character to its shadow table (rob_kage_disp_test,
# 16 entries of 24 bytes and a tail; docs/SHADOWS.md); StF's tables are
# copied into free room in the extra data ROM, the guests' own after them.
# blank_per_character_audio_array: a list by play op 9's sound (19) of lists
# by parent (rob+0x1B1; StF's are 11 long) of sound codes (0: none, as for
# every StF fighter); the lists go in the extra data ROM, 52 long (a guest's
# slot past 10 reads its own entry, not the next list's), a guest's voices in
# them.
# edge_motion is the board's own: a pointer by character (rob+0x1B1, 26) to
# a VF2 fighter's ten edge motions, VF2's 0x182..0x18B as its board ids (0:
# none; rob_check_stage then plays none), then his action slots 31..80
# (VF2_RISE) and reaction 0x2CE's swaps (VF2_HIT's sub_2BA44).
GUESTS = [('CHAR_PARTS', 0x100, 52 * 4), ('SKELETON_TYPE_DATA', 0x400, 4 * 4),
          ('MOVESET_ARRAY', 0x100, 24 * 4), ('player_hand_animations', 0x100, 52 * 4),
          ('player_foot_animation', 0x100, 52 * 4), ('player_body_animation', 0x100, 52 * 4),
          ('PLAYER_HEAD_LIST', 0x1800, 21 * 4), ('animation_related', 0x2000, 519 * 4),
          ('offset_list_motions', 0x2000, 519 * 4), ('ptr_DA0B4', 0x80, 26 * 4),
          ('motion_remap', 0x80, 26 * 4), ('char_game', 0x40, 52),
          ('rob_coli_ball_types', 0x400, 4 * 4), ('midriff', 0x100, 52 * 4),
          ('off_C2058', 0x400, 4 * 4), ('seams', 0x100, 52 * 4), ('off_B540C', 0x400, 4 * 4),
          ('off_64988', 0x100, 52 * 4), ('blank_per_character_audio_array', 0x80, 19 * 4),
          ('edge_motion', 0x80, 26 * 4)]
GAMES = [('STF', 0), ('VF2', 1), ('FV', 2)]      # char_game's values (GAME_<name>)
# Data blocks no lifted code names but StF's ROM tables point at: lifted, and
# the code that loads such a pointer is given the board's copy
# (INSERT_LIFTED).
EXTRA_TABLES = ['dword_2442C']
# Code put in at a label of StF's, before what is there, lifted as StF's own
# lines are (its names made the board's). sub_2435C: the stage record's
# colour-cycle list (+0xB8) is a pointer into dword_2442C, StF's program at
# 0x2442C, which the board's copy is not at: the same prologue, with the
# pointer moved onto the copy.
INSERT_LIFTED = {
    'sub_2435C': ['ld      debug_flag, r15', 'bbs     5, r15, loc_243A8', 'ldob    stage_num, r12',
                  'shlo    8, r12, r4', 'ld      word_8F488(r4), r10',
                  'lda     dword_2442C-0x2442C(r10), r10', 'ldos    word_8F3DE(r4), g1', 'b       loc_24384'],
}
# Code put in at a label of StF's, before what is there. sub_2B94C picks a
# hit's reaction from the defender's table: (side)[category * 8], +2 from
# behind. VF2's tables have a crouching defender's reactions 4 on; StF's
# repeat its first four there, so the crouch term changes nothing for StF's
# own fighters, but only another game's take it. 0x1A4 bit 3: crouching.
# set_motion, before it stores the id (its flags already read): the id the
# fighter's character plays instead (motion_remap; 0: its own). A guest's
# take the place of the ids StF's code plays by number; StF's fighters', of
# the ones a guest's throw gives its victim.
# ACT_RC_JUMP's takeoff: a VF2 fighter jumps under VF2's gravity in StF's
# units (0x3B32674F * SCALE = 0x3BB4D327; StF's 0x50A000 is 9.27x VF2's, not
# SCALE), an FV one under FV's (0x3BAB1F2D, 0.00522, F 0x7284) at his size
# (* K, mahler-guest.mjs: 0x3C2EE9B2). Gravity each frame is 0x50A000 -
# rob+0x5CC, so 0x5CC takes the difference; the next set_motion (landing, a
# hit) clears it.
# ACT_RC_JUMP's landing, r5 the jump's reach (r8 the wall ahead, r9 the
# opponent): a VF2 fighter's as VF2's exec_action (V 0x15444) clamps it, short
# of the wall by 0.6 and outside the opponent's +-0.9, in StF's units (* SCALE:
# 0x3F9BAF44, 0x3FE986E6), where StF has no wall and +-0.4. FV's exec_action
# (F 0x1435C) is StF's, in FV's units: an FV fighter's +-0.4 and 0.8 are * K
# (0x3F515653, 0x3FD15653).
# damage_unit's slot loop (loc_2BBDC, r11 the slot): FV's test whether a hit
# breaks a damaged half of the armour runs only on a slot with crush pieces
# (ptr_CE1CC), and StF has none, so nothing broke. The same test, once (on
# slot 0), with no pieces: a clean hit (+0x26C bit 1 or 4) from a move with
# kind2 bit 5, on a defender without +0x7EC bit 5, in the half the attack's
# class (byte_2CA3C: 0 upper, 1 lower) picks, once the half's sum and its
# last are at the limit and the half is whole: that half's broken bit
# (+0x7F0 bit 2 or 3) and the attacker's kind2 bit 6 (a break dealt: FV's
# replay, replay.c rep_watch); both broken the flags' bit 28. The match's
# winning blow (+0x914) is StF's own.
# ring_tobitiri_set (a hit's rings, damage_calculation's): only StF's own
# fighters carry rings; a guest (char_game not 0) drops none.
# coli_attack_chk (loc_2A6B8): a strike whose move lacks +0x860 bit 22
# lands only while the collision task's 0x2AC is 0, and a hit sets it to 8,
# so in StF the first of two strikes on a frame shuts the other out (no
# trades) and nothing lands for 8 frames after a hit. VF2's (0x22404) and
# FV's (0x25AA4) have no such wait: a strike lands once a move (StF's bit-22
# path, the 0x90 bit and the motion kept at 0x8C), and two on a frame trade.
# A guest (char_game not 0) takes that path.
# coli_recalc_pos (loc_2D7B0, loc_2D7E0): two fighters' bodies are kept
# 0.3 apart, in their game's units; StF's 0.3 (the push factor, +0x67C) is
# taken to the guests' size for a pair from one other game: VF2's always
# 0.3 * SCALE (0x3F1BAF44), FV's StF's factors * K. StF and FV hold the push
# to 0.3 a frame (FV's * K, 0x3F1D00BE); VF2 does not.
# smooth_int (loc_2F668), a motion's blend from the last pose: StF branches
# past its foot hold, VF2 (V 0x27564) runs it: with 0xC30 bit 10 and the
# blend's bit 9, the new pose's z (its first eight) moves by a foot's, the
# old foot's height 0.14 (* SCALE: 0x3E914E40) on one side. VF2 has no
# unit_smooth_cancel_front there. A VF2 guest takes VF2's.
# coli_cont_cop_g4: the push between two VF2 guests is VF2's TGP's (its
# function 0x3B), not StF's SHARC's: vf2_coli_push (stf_call.s, push.c) puts
# it in g4 in place of the one read back, and the pairs that meet in r13
# (+0x164, which coli_recalc_pos pushes on).
# rand mixes the hardware timers (0xF00000) into G_RANDOM; two linked boards
# (link.c, in step: link.state LS_RUN, 5) must draw the same numbers, so
# there it steps G_RANDOM alone (an LCG, its high half).
# rob_check_stage's bounds check (loc_18214, loc_18248): |x| or |z| at or
# past 0x50A00C puts the fighter out (r11 1), its floor 0x50A010 (g4). FV's
# (F 0x588C0) is StF's to the instruction but for two tests that branch
# nowhere, so StF's and FV's fighters run StF's. A VF2 fighter runs VF2's
# (V 0x17B68): measured at its root even with 0x1A4 bit 4 set; 0x1A4 bit 23
# zeroes its fall and height (0x620 1 once 0x624 is); on the ground, no
# 0x61C: 0x804 bit 4 to 0x1A4 bit 4; with 0x61C, bit 4 cleared and, 0x60E
# clear, in bounds 0x620 and its fall and height zeroed, out of bounds the
# landing below; in the air StF's landing test, 0x620 stored only on landing,
# and with 0x61C, out of bounds, it lands at 0 when 0x614 is set, else on the
# ground outside if it was low enough. The landing is VF2's 0x18B58, StF's
# sub_1980C. Its edge stumbles too (V 0x17C00..0x180B4): on the ground at
# an edge (0x618 with 0x1A4 bit 29, or 0x618 0x9000 and 0x614 bit 12 or 15
# after the wall path) a teeter, VF2's 0x18B or 0x18A by the TGP's atan of
# a foot (0x2A8/0x2B0 or 0x284/0x28C) against the edge's angle 0x616, the
# side (w0 bit 6) turned to it; with 0x1A4 bit 14 or 16 and 0x628 & 0x6E03
# a slip, 0x182..0x185 by the root's angle and 0x1A4 bit 11; out of bounds
# in that state, 0x614 & 0xFC00 or & 0x4E, a fall off, 0x186..0x189, then
# the landing at 0. Each turns 0x61A toward the edge (VF2's 0x18008: 0x5B4
# plus the stumble's half turn, within 0x1000..0x7000 of the edge, then
# within 0x3000 or 0x5000 of the angle). VF2's request word is command 0xC
# (its DOWN, StF's 8) or 0 (MOTION) and a VF2 id; the board's is StF's
# command and the fighter's own id (edge_motion), which set_motion's remap
# leaves alone. Left out: VF2's 0x624 setting w0 bit 5 (ringout.c does VF2's
# ring out), and its end without StF's 0x1E18 tail (kept here).
# The turn takes effect as VF2's does: area_coli_618, StF's area_coli stores
# 0x618 as a word, which clears 0x61A each frame; VF2's (V 0x1419C) is a
# short, so a VF2 fighter's 0x61A is kept in the word's high half. And
# rob_revise_yang (V 0x17710): a VF2 fighter turns by VF2's tree, after
# StF's own gate (mod_fa_coli bit 31), into StF's tails where they are the
# same (V 0x17854 = loc_17E3C, 0x17800 = loc_17DE8, 0x17818 = loc_17E00,
# 0x177F0 = loc_17DD8, 0x17890 = loc_17EEC). With 0x1A4 bit 23 (the
# stumbles' motions set it) VF2 turns 0x26 toward 0x61A at 0x38E (5 degrees)
# a frame, no window; StF has no such path. VF2's has none of StF's 0x70C,
# 0x804 and 0x860 turns (0x804 bit 15 turned a VF2 fighter getting up), and
# turns at 0x38E where StF's 0x1A4 bit 13/17/14 turns are 0x71C. VF2's tag_yang native
# (V 0x49040) is the debug menu's display, not a reader.
# rob_spd_control's friction (V 0x1791C): VF2's amount is [0x50A004] x its
# own gravity, 0x3BB4D327 in board units (ACT_RC_JUMP's rob+0x5CC), with no
# x 0.25; StF's is [0x50A004] x [0x50A000] x 0.25, 1.143x VF2's for a guest.
# A VF2 fighter's strike (the attacker g7 VF2's; its +0x822 is VF2's own
# damage, tools/vf2-guest.mjs) hits as VF2's attack_hit does (V 0x2260C..
# 0x2309C): the knockback s = sqrt(P / 30) x 30 x 0.0025 (VF2's list word is
# 1.0), the attacker's speed x 0.5 where StF's is x 0.8; a counter (the
# victim's 0x1A4 bit 8) P x 3/2 (V 0x22A28), else VF2's own cases (V 0x22B00
# with the settings byte [[0x50016C]+0x3351] bit 6 clear): P x 5/4 on the
# victim's first hit (0x6F4, VF2's 0x6D8, is 1) with no 0x1A4 bit 14 and no
# 0x6F0 & 0xD9B0; P x 3/4 for a 0x821 kind-4 strike on a down victim (bit 16
# or 14, no 0x6F0 & 0x264F); P x 3/2 in the air; P + P/8 + 1 (kind 34) on
# 0x804 bit 8 with bit 0; none of StF's ukemi, down, tetsu or multi-hit
# halving (V 0x22BC0); |v| = sqrt(2s / (60 + 0.6 (w -
# 60))) in board units (x 2.02714, VF2's size on the board), with none of
# StF's further factors; and the damage, out of VF2's 220, scaled to StF's 140
# bar (rounded) with no catch-up (V 0x18A54). A plain hit's stun (V 0x22CE4)
# is 4P/5 + 6 with no cap at the attacker's frames left + 6, and it sets
# [0x50A0B6], the frames the fighters don't turn to face (stun + VF2's
# [0x50A0B7], 10 where StF's is 2, + 1, or stun - 1 on a counter), which StF
# works out and drops. pit_vf2_*: the command decoder (sub_1D984) reads at
# most precede_inp_time frames of a fighter's pad history it has not read
# yet; VF2's is 12 (StF's 8), so a press in a reaction's last 12 frames
# still starts the next move.
# rsc_normal_gravity: a VF2 fighter in the air falls by VF2's gravity (V
# 0x17A88, [0x50A000] 0.00272, x 2.027 for its size on the board), with no
# StF 0x1A4 bit 14 (hit in the air) x flt_1D290.
# ACT_RC_TA_GUARD (V 0x14E78): a VF2 fighter crouched (0x1A4 bit 3) guards
# by VF2's slot 12 (crouch to guard, the board's slot 52, vf2-guest.mjs) at
# the frame left (sub_1CE94), or from its start on rob+0 bit 0 or 0x810 bit
# 7; standing with 0x810 bit 7 (and no 0x804 bit 13 or rob+0 bit 0), by the
# same slot at the frame it is at (sub_1CEA8). StF guards by slot 5 from its
# start. Not ported: VF2's first test of the foe's 0x6B4 bit 0 (V 0x1B694),
# whose fields StF lays out elsewhere.
# contact_lag: with two VF2 fighters the copro's contact table (0x90F600, 16
# words), StF's SHARC pairing, is replaced by VF2's own (push.c,
# vf2_contacts): the TGP's ball pairing and its swept test of attack balls,
# on the balls made before the fighters step, as VF2's TGP has them.
# ah_not_finish_blow, loc_2B5E4: a VF2 strike knocks down as VF2's does (V
# 0x22C84..0x22CE0, 0x22E24..0x22F28): at 30 of VF2's damage where StF's is
# 50, or the 0x828 bit 8 kind on a victim without 0x1A4 bit 3, or when the
# board's (scaled) damage takes the rest of the bar; no StF 0x70C bit 2. The
# knock-down's stun is (P/2 - 7) x 2, and its angle and factor come from
# VF2's table by kind (fighter.c, vf2_hit_kinds), then StF's combo limit
# (loc_2B6E8, the same as VF2's). A VF2 defender's reaction 0x2CE becomes
# 0xA7 with 0x1F8 at or under 0.9, 0x2CF at or under 0.6 (V 0x23238, * SCALE;
# sub_2BA44, his ids after the rises in edge_motion). Not ported: VF2's
# character-4 extra angle (V 0x22F28).
VF2_HIT = {
    'loc_2A954': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne GAME_VF2, r14, loc_2A954_own', 'lda     0x3D088888, r13',
                  'mulr    r13, r9, r9', 'lda     0xD001A1A, r15', 'st      r15, (g11)[g12*1]',
                  'st      r9, (g11)[g12*1]', 'ld      (g11)[g12*1], r9', 'lda     0x41F00000, r13',
                  'mulr    r13, r9, r9', 'ld      flt_2BA68, r13', 'mulr    r13, r9, r9',
                  'ldob    stf_ram_50FE00+0x2, r7', 'addo    0x1F, 9, r13', 'mulo    r13, r7, r7',
                  'lda     stf_ram_50A000+0x800(r7), r7',
                  'ld      0x1A4(g7), r15', 'bbc     4, r15, loc_2A9F0', 'bbc     0xC, r15, loc_2A9F0',
                  'ldis    0x5C2(g7), r3', 'subi    r3, r10, r3', 'shlo    0xE, 1, r13',
                  'addi    r13, r3, r3', 'bbs     0xF, r3, loc_2A9F0', 'lda     0x3F000000, r3',
                  'ld      0x2C(g7), r14', 'mulr    r3, r14, r15', 'st      r15, 0x2C(g7)',
                  'ld      0x34(g7), r14', 'mulr    r3, r14, r15', 'st      r15, 0x34(g7)',
                  'b       loc_2A9F0', 'loc_2A954_own:'],
    'loc_2B1A4': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne GAME_VF2, r14, loc_2B1A4_own', 'ld      0x1A4(g8), r15',
                  'bbc     8, r15, ah_vf2_chain', 'lda     aCounter, g0', 'lda     (r11)[r11*2], r11',
                  'shro    1, r11, r11', 'mov     3, r8', 'lda     0x10000004, r15',
                  'st      r15, 0x194(g7)', 'b       loc_2B318', 'ah_vf2_chain:',
                  'ldos    0x6F0(g8), r5', 'ld      0x1A4(g8), r4', 'ldob    0x821(g7), r14',
                  'cmpobne 4, r14, ah_vf2_first', 'bbs     0x10, r4, ah_vf2_tender',
                  'bbc     0xE, r4, ah_vf2_air', 'ah_vf2_tender:', 'lda     0x264F, r3',
                  'and     r5, r3, r15', 'cmpobne 0, r15, loc_2B318', 'lda     aTender, g0',
                  'shro    2, r11, r3', 'subo    r3, r11, r11', 'b       loc_2B318',
                  'ah_vf2_first:', 'ldob    0x6F4(g8), r14', 'cmpobne 1, r14, ah_vf2_air',
                  'bbs     0xE, r4, ah_vf2_air', 'lda     0xD9B0, r3', 'and     r5, r3, r15',
                  'cmpobne 0, r15, ah_vf2_air', 'lda     aTender, g0', 'shro    2, r11, r3',
                  'addo    r3, r11, r11', 'b       loc_2B318', 'ah_vf2_air:', 'lda     0x4010, r13',
                  'and     r13, r4, r3', 'cmpobne 0x10, r3, ah_vf2_hit', 'lda     aAir, g0',
                  'lda     (r11)[r11*2], r11', 'shro    1, r11, r11', 'b       loc_2B318',
                  'ah_vf2_hit:', 'ld      0x804(g8), r15', 'bbc     8, r15, loc_2B318',
                  'bbc     0, r4, loc_2B318', 'lda     aHit_0, g0', 'shro    3, r11, r3',
                  'lda     1(r11)[r3], r11', 'addo    0x1F, 3, r8', 'b       loc_2B318',
                  'loc_2B1A4_own:'],
    'contact_lag': ['ldob    0x1B1(r7), r14', 'ldob    guest_char_game[r14], r14', 'cmpobne GAME_VF2, r14, contact_lag_own', 'ldob    0x1B1(r8), r14', 'ldob    guest_char_game[r14], r14', 'cmpobne GAME_VF2, r14, contact_lag_own', 'mov     g0, r4', 'mov     g1, r5', 'mov     r7, g0', 'mov     r8, g1', 'call    vf2_coli_contacts', 'mov     r4, g0', 'mov     r5, g1', 'contact_lag_own:'],
    'pit_vf2_1': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne GAME_VF2, r14, pit_vf2_1_own', 'mov     12, r3', 'pit_vf2_1_own:'],
    'pit_vf2_2': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne GAME_VF2, r14, pit_vf2_2_own', 'mov     12, r3', 'pit_vf2_2_own:'],
    'pit_vf2_3': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne GAME_VF2, r14, pit_vf2_3_own', 'mov     12, r5', 'pit_vf2_3_own:'],
    'loc_2B488': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne GAME_VF2, r14, loc_2B488_own', 'and     0x1F, r8, g0', 'call    sub_2B94C',
                  'shlo    0x18, 0xB, r14', 'addi    g0, r14, r15', 'st      r15, 0x198(g8)',
                  'ldob    0x85D(g7), r3', 'cmpobne 3, r8, loc_2B488_vf2_set',
                  'ldob    0x85E(g7), r3', 'loc_2B488_vf2_set:', 'cmpobne 0, r3, loc_2B488_vf2_stun',
                  'mulo    4, r11, r3', 'divo    5, r3, r3', 'ldob    byte_2BA7B, r13',
                  'addi    r13, r3, r3', 'loc_2B488_vf2_stun:', 'stos    r3, 0x5DE(g8)',
                  'mov     10, r13', 'addi    r13, r3, r4', 'addo    0x1F, 3, r13',
                  'cmpobe  r13, r8, loc_2B488_vf2_short', 'cmpobne 3, r8, loc_2B488_vf2_turn',
                  'loc_2B488_vf2_short:', 'subi    2, r3, r4', 'loc_2B488_vf2_turn:', 'addo    1, r4, r4',
                  'stob    r4, stf_ram_50A000+0xB6', 'mov     0, r6', 'b       loc_2B738',
                  'loc_2B488_own:'],
    'loc_2B738': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne GAME_VF2, r14, loc_2B738_own', 'ld      0x5D8(g8), r4',
                  'lda     0x42700000, r3', 'subr    r3, r4, r4', 'lda     0x3F19999A, r13',
                  'mulr    r13, r4, r4', 'addr    r3, r4, r4', 'divr    r4, r9, r4',
                  'lda     0x40000000, r13', 'mulr    r13, r4, r4', 'lda     0xD001A1A, r15',
                  'st      r15, (g11)[g12*1]', 'st      r4, (g11)[g12*1]', 'ld      (g11)[g12*1], r4',
                  'lda     0x4001BCB9, r13', 'mulr    r13, r4, r4',
                  'lda     0x12002424, r15', 'st      r15, (g11)[g12*1]', 'st      r6, (g11)[g12*1]',
                  'st      r4, (g11)[g12*1]', 'ld      (g11)[g12*1], r5', 'st      r5, 0x5E4(g8)',
                  'lda     0x12802525, r15', 'st      r15, (g11)[g12*1]', 'st      r6, (g11)[g12*1]',
                  'st      r4, (g11)[g12*1]', 'ld      (g11)[g12*1], r4', 'subi    r10, 0, r12',
                  'lda     0x12002424, r15', 'st      r15, (g11)[g12*1]', 'st      r12, (g11)[g12*1]',
                  'st      r4, (g11)[g12*1]', 'ld      (g11)[g12*1], r5', 'lda     0x12802525, r15',
                  'st      r15, (g11)[g12*1]', 'st      r12, (g11)[g12*1]', 'st      r4, (g11)[g12*1]',
                  'ld      (g11)[g12*1], r6', 'st      r5, 0x5E0(g8)', 'st      r6, 0x5E8(g8)',
                  'b       loc_2B898', 'loc_2B738_own:'],
    'loc_2B898': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne GAME_VF2, r14, loc_2B898_own', 'ldis    stf_ram_500000+0x28, r14',
                  'cmpibge 0, r14, loc_2B8C4', 'mov     g8, r15', 'mov     g7, g8', 'mov     r15, g7',
                  'mulo    14, r11, g0', 'addo    11, g0, g0', 'divo    22, g0, g0',
                  'call    damage_calc_vf2', 'mov     g8, r15', 'mov     g7, g8', 'mov     r15, g7',
                  'b       loc_2B8C4', 'loc_2B898_own:'],
    'ah_not_finish_blow': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne GAME_VF2, r14, ah_not_finish_blow_own', 'ld      0x1A4(g8), r15',
                  'bbs     0x10, r15, loc_2B560', 'bbs     0xE, r15, loc_2B594', 'bbs     4, r15, loc_2B5E4',
                  'bbs     0x1A, r15, loc_2B5E4', 'ldos    stf_ram_50FE00, r14', 'bbs     0xE, r14, loc_2B5E4',
                  'bbs     0xA, r14, anfb_vf2_energy', 'cmpoble 30, r11, loc_2B5E4',
                  'bbc     8, r14, anfb_vf2_kind', 'bbc     3, r15, loc_2B5E4', 'anfb_vf2_kind:',
                  'ldob    0x821(g7), r14', 'cmpobne 1, r14, anfb_vf2_energy', 'bbs     0x18, r15, loc_2B5E4',
                  'anfb_vf2_energy:', 'mulo    14, r11, r3', 'addo    11, r3, r3', 'divo    22, r3, r3',
                  'ldos    0x1AC(g8), r13', 'cmpoble r13, r3, loc_2B5E4', 'b       loc_2B488',
                  'ah_not_finish_blow_own:'],
    'loc_2B5E4': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne GAME_VF2, r14, loc_2B5E4_own', 'ld      0x1A4(g7), r15',
                  'bbc     0x16, r15, kd_vf2_motion', 'ld      0x1A4(g8), r4', 'bbs     4, r4, kd_vf2_motion',
                  'bbs     0xB, r4, loc_2B560', 'kd_vf2_motion:', 'mov     4, g0', 'call    sub_2B94C',
                  'ld      0x1A4(g8), r15', 'bbc     4, r15, kd_vf2_down', 'lda     0xE1, g0', 'kd_vf2_down:',
                  'call    sub_2BA44', 'shlo    0x1B, 1, r14', 'addi    g0, r14, r15', 'st      r15, 0x198(g8)',
                  'shro    1, r11, r3', 'subo    7, r3, r3', 'addo    r3, r3, r3', 'stos    r3, 0x5DE(g8)',
                  'mov     0x11, g1', 'call    calc_mht_adr', 'cmpobe  0, g0, kd_vf2_kind',
                  'ldob    1(g0), r3', 'ldob    2(g0), r15', 'shlo    8, r15, r15', 'addo    r15, r3, r3',
                  'mov     r3, r6', 'ldob    3(g0), r3', 'ldob    4(g0), r15', 'shlo    8, r15, r15',
                  'addo    r15, r3, r3', 'ldob    5(g0), r15', 'shlo    0x10, r15, r15', 'addo    r15, r3, r3',
                  'ldob    6(g0), r15', 'shlo    0x18, r15, r15', 'addo    r15, r3, r3', 'mulr    r9, r3, r9',
                  'b       loc_2B738', 'kd_vf2_kind:', 'ldob    stf_ram_50FE00+0x2, r7', 'shlo    5, r7, r7',
                  'lda     _vf2_hit_kinds(r7), r7', 'ld      0x1A4(g8), r15', 'bbs     4, r15, kd_vf2_low',
                  'cmpobe  3, r8, kd_vf2_counter', 'ldis    0x18(r7), r6', 'ld      0x8(r7), r13',
                  'b       kd_vf2_scale', 'kd_vf2_counter:', 'ldis    0x1A(r7), r6', 'ld      0xC(r7), r13',
                  'b       kd_vf2_scale', 'kd_vf2_low:', 'cmpobe  3, r8, kd_vf2_low_counter',
                  'ldis    0x1C(r7), r6', 'ld      0x10(r7), r13', 'b       kd_vf2_scale',
                  'kd_vf2_low_counter:', 'ldis    0x1E(r7), r6', 'ld      0x14(r7), r13', 'kd_vf2_scale:',
                  'mulr    r13, r9, r9', 'b       loc_2B6E8', 'loc_2B5E4_own:'],
    'sub_2BA44': ['ldob    0x1B1(g8), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne GAME_VF2, r14, sub_2BA44_own', 'ldob    0x1B1(g8), r14',
                  'ld      guest_edge_motion[r14*4], r14', 'ldos    0x78(r14), r13',
                  'cmpobne r13, g0, sub_2BA44_own', 'ld      0x1F8(g8), r3', 'lda     0x3FE986E6, r4',
                  'cmpr    r3, r4', 'bg      sub_2BA44_vf2', 'ldos    0x7A(r14), g0', 'lda     0x3F9BAF44, r4',
                  'cmpr    r3, r4', 'bg      sub_2BA44_vf2', 'ldos    0x7C(r14), g0', 'sub_2BA44_vf2:', 'ret',
                  'sub_2BA44_own:'],
}
# Getting up, VF2's way for a VF2 fighter. Lying down (StF's state 9, VF2's
# 0xD) his input (V 0x1BD38) picks one of VF2's rise kinds (0x19E, 2..12):
# kicks and punches, rolls, a direction by the camera (V 0x1D1DC), where
# StF's (loc_1D774) knows only 5, 6, 9 and 10. ACT_RC_RISE then plays VF2's
# (V 0x157DC): by kind, face up or down (0x1A4 bit 11) and side (0x5B8 bit
# 0), the rolls checked against the ring's edge (0x50A00C, VF2's lengths *
# SCALE). The motions are his action slots 31..80, after his ten edge
# motions in edge_motion (tools/vf2-guest.mjs). Not ported: VF2's longer
# wait for its character 8 (V 0x158B8).
def _vf2_rise_at(off):
    return f'lda     {off - 0x2A:#X}, r13'.replace('0X', '0x')
def _vf2_rise_pick(name, bit_a, bit_b, a, b, c, d):
    """a/b: bit_a clear and bit_b clear/set; c/d: bit_a set and bit_b set/clear,
    VF2's order (bits as 'b r' strings: '0xB, r7' or '0, r6')."""
    return [f'{name}:', f'bbs     {bit_a}, {name}_set', _vf2_rise_at(a), f'bbc     {bit_b}, rise_vf2_play',
            _vf2_rise_at(b), 'b       rise_vf2_play', f'{name}_set:', _vf2_rise_at(c),
            f'bbs     {bit_b}, rise_vf2_play', _vf2_rise_at(d), 'b       rise_vf2_play']
def _vf2_rise_side(name, a, b, c, d):
    """VF2's kinds 3, 4, 5, 8, 9: side first, then face up or down."""
    return [f'{name}:', 'bbs     0, r6, ' + name + '_set', _vf2_rise_at(a), 'bbc     0xB, r7, rise_vf2_play',
            _vf2_rise_at(b), 'b       rise_vf2_play', f'{name}_set:', _vf2_rise_at(c),
            'bbc     0xB, r7, rise_vf2_play', _vf2_rise_at(d), 'b       rise_vf2_play']
def _vf2_rise_ring(res, skip):
    """res: the distance (copro 0x16802D2D) to the point 1 ahead (r4, r5) of
    0x1F4, unless that from 0x200 or 0x284 is past the ring's edge."""
    out = [f'lda     0x461C4000, {res}']
    for a, b in (('r8', 'r9'), ('r10', 'r11')):
        for v, w in (('r4', a), ('r5', b)):
            out += [f'addr    {v}, {w}, r3', 'clrbit  0x1F, r3, r3', 'lda     0x3ECF945B, r14',
                    'addr    r14, r3, r3', 'ld      stf_ram_50A000+0xC, r14', f'cmpibg  r3, r14, {skip}']
    return out + ['addr    r4, r12, g0', 'addr    r5, r13, g1', 'lda     0x16802D2D, r15',
                  'st      r15, (g11)[g12*1]', 'st      g0, (g11)[g12*1]', 'st      g1, (g11)[g12*1]',
                  f'ld      (g11)[g12*1], {res}', f'{skip}:']
def _vf2_down_kind(k):
    return [f'lda     {0x9000000 | k << 16:#X}, r14'.replace('0X', '0x'), 'b       down_vf2_put']
VF2_RISE = {
    'loc_1D774': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne GAME_VF2, r14, loc_1D774_own', 'ld      0x0(g7), r15', 'clrbit  0xF, r15, r15',
                  'st      r15, 0x0(g7)', 'ldob    0x19F(g7), r14', 'cmpobne 9, r14, loc_1D890',
                  'ld      0x1218(g7), r14', 'cmpobne 0, r14, loc_1D890', 'mov     0, r5',
                  'cmpobe  0, r9, down_vf2_any', 'mov     1, r5', 'down_vf2_any:', 'bbc     2, r9, down_vf2_k',
                  'bbs     1, r9, down_vf2_a', 'lda     0xF0, r3', 'and     r8, r3, r3',
                  'cmpobe  0, r3, down_vf2_2', 'shro    4, r3, r3', 'ldis    down_vf2_angle[r3*2], r4',
                  'ld      stf_ram_500000+0x814, r15', 'ldis    0x26(r15), r12', 'ldis    0x5B4(g7), r13',
                  'subi    r12, r13, r13', 'subi    r13, r4, r4', 'bbs     0xF, r4, down_vf2_c',
                  *_vf2_down_kind(0xB), 'down_vf2_c:', *_vf2_down_kind(0xC), 'down_vf2_2:', *_vf2_down_kind(2),
                  'down_vf2_a:', *_vf2_down_kind(0xA), 'down_vf2_k:', 'bbc     1, r9, down_vf2_dir',
                  'bbs     4, r8, down_vf2_kd', *_vf2_down_kind(4), 'down_vf2_kd:', 'bbs     r7, r8, down_vf2_8',
                  'bbs     r6, r8, down_vf2_9', *_vf2_down_kind(3), 'down_vf2_8:', *_vf2_down_kind(8),
                  'down_vf2_9:', *_vf2_down_kind(9), 'down_vf2_dir:', 'mov     r8, r4', 'ldob    0x19E(g7), r14',
                  'cmpobe  0, r14, down_vf2_held', 'mov     r9, r4', 'down_vf2_held:', 'bbs     4, r4, loc_1D848',
                  'bbc     5, r4, down_vf2_6', *_vf2_down_kind(5), 'down_vf2_6:', 'bbc     r7, r4, down_vf2_7',
                  *_vf2_down_kind(6), 'down_vf2_7:', 'bbc     r6, r4, loc_1D848', *_vf2_down_kind(7),
                  'down_vf2_put:', 'addi    r5, r14, r15', 'st      r15, 0x194(g7)', 'b       loc_1E160',
                  'down_vf2_angle:', *['.short  ' + v for v in ('0', '0x8000', '0', '0', '0xC000', '0xA000',
                  '0xE000', '0xC000', '0x4000', '0x6000', '0x2000', '0x4000', '0', '0x8000', '0', '0')],
                  'loc_1D774_own:'],
    'loc_14D54': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne GAME_VF2, r14, loc_14D54_own', 'ld      0x0(g7), r3', 'bbc     0, r3, loc_14EBC',
                  'bbs     5, r3, loc_14EC8', 'ldis    0x1AC(g7), r14', 'cmpibge 0, r14, loc_14EC8',
                  'ldos    (0x30+0x20)(g6), g0', 'bbc     0xB, r7, rise_vf2_lie', _vf2_rise_at(0x40),
                  'ldob    0x1B1(g7), r14', 'ld      guest_edge_motion[r14*4], r14', 'addo    r14, r13, r14',
                  'ldos    (r14), g0', 'rise_vf2_lie:', 'ldob    0x1B2(g7), r14', 'addi    1, r14, r15',
                  'stob    r15, 0x1B2(g7)', 'b       loc_14D7C', 'loc_14D54_own:'],
    'loc_14DD8': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne GAME_VF2, r14, loc_14DD8_own', 'ld      0x0(g7), r15', 'clrbit  0x1D, r15, r15',
                  'st      r15, 0x0(g7)', 'ldob    0x1B2(g7), r14', 'addi    1, r14, r15',
                  'stob    r15, 0x1B2(g7)', 'ld      0x0(g7), r14', 'clrbit  6, r14, r15', 'st      r15, 0x0(g7)',
                  'cmpobe  3, r10, rise_vf2_3', 'cmpobe  4, r10, rise_vf2_4', 'cmpobe  5, r10, rise_vf2_5',
                  'cmpobe  7, r10, rise_vf2_7', 'cmpobe  6, r10, rise_vf2_6', 'cmpobe  9, r10, rise_vf2_9',
                  'cmpobe  8, r10, rise_vf2_8', 'ld      0x1F4(g7), r12', 'ld      0x1FC(g7), r13',
                  'ld      0x200(g7), r8', 'ld      0x208(g7), r9', 'ld      0x284(g7), r10',
                  'ld      0x28C(g7), r11', 'lda     0x2D805B5B, r15', 'st      r15, (g11)[g12*1]',
                  'ldis    0x26(g7), r15', 'st      r15, (g11)[g12*1]', 'lda     0x4001BCB9, r15',
                  'st      r15, (g11)[g12*1]', 'mov     0, r15', 'st      r15, (g11)[g12*1]',
                  'ld      (g11)[g12*1], r4', 'ld      (g11)[g12*1], r5', *_vf2_rise_ring('g2', 'rise_vf2_ahead'),
                  'notbit  0x1F, r4, r4', 'notbit  0x1F, r5, r5', *_vf2_rise_ring('g3', 'rise_vf2_behind'),
                  'ldob    0x19E(g7), r10', 'lda     0x461C4000, r3', 'cmpobe  0xB, r10, rise_vf2_b',
                  'cmpobe  0xC, r10, rise_vf2_c', 'cmpobe  2, r10, rise_vf2_2', 'cmpobe  0xA, r10, rise_vf2_a',
                  'b       rise_vf2_def', 'rise_vf2_c:', 'cmpibge g2, r3, rise_vf2_c2', 'b       rise_vf2_side',
                  'rise_vf2_b:', 'cmpibge g3, r3, rise_vf2_b2', 'b       rise_vf2_fore', 'rise_vf2_2:',
                  'cmpibl  g3, g2, rise_vf2_c2', 'rise_vf2_b2:', 'cmpibge g2, r3, rise_vf2_def',
                  'b       rise_vf2_side', 'rise_vf2_c2:', 'cmpibge g3, r3, rise_vf2_def', 'b       rise_vf2_fore',
                  'rise_vf2_a:', 'cmpibl  g3, g2, rise_vf2_a2', 'cmpibge g2, r3, rise_vf2_4',
                  'b       rise_vf2_roll', 'rise_vf2_a2:', 'cmpibge g3, r3, rise_vf2_def', 'b       rise_vf2_roll2',
                  *_vf2_rise_pick('rise_vf2_side', '0xB, r7', '0, r6', 0x5A, 0x5C, 0x5E, 0x60),
                  *_vf2_rise_pick('rise_vf2_fore', '0xB, r7', '0, r6', 0x52, 0x54, 0x56, 0x58),
                  *_vf2_rise_pick('rise_vf2_roll', '0xB, r7', '0, r6', 0x94, 0x98, 0x9A, 0x9E),
                  *_vf2_rise_pick('rise_vf2_roll2', '0xB, r7', '0, r6', 0x92, 0x96, 0x9C, 0xA0),
                  *_vf2_rise_side('rise_vf2_3', 0x7A, 0x80, 0x7E, 0x7C),
                  *_vf2_rise_side('rise_vf2_4', 0x72, 0x78, 0x76, 0x74),
                  *_vf2_rise_side('rise_vf2_5', 0x6A, 0x70, 0x6E, 0x6C),
                  *_vf2_rise_side('rise_vf2_9', 0x82, 0x88, 0x86, 0x84),
                  *_vf2_rise_side('rise_vf2_8', 0x8A, 0x90, 0x8E, 0x8C),
                  'rise_vf2_7:', 'bbc     0, r6, rise_vf2_def', 'lda     0x40A22BE7, r3', 'ld      0x5F8(g7), r13',
                  'cmpibl  r13, r3, rise_vf2_def', _vf2_rise_at(0x62), 'bbc     0xB, r7, rise_vf2_play',
                  _vf2_rise_at(0x64), 'b       rise_vf2_play',
                  'rise_vf2_6:', 'bbs     0, r6, rise_vf2_def', 'lda     0x40A22BE7, r3', 'ld      0x5FC(g7), r13',
                  'cmpibl  r13, r3, rise_vf2_def', _vf2_rise_at(0x66), 'bbc     0xB, r7, rise_vf2_play',
                  _vf2_rise_at(0x68), 'b       rise_vf2_play',
                  *_vf2_rise_pick('rise_vf2_def', '0xB, r7', '0, r6', 0x42, 0x4A, 0x48, 0x50),
                  'rise_vf2_play:', 'ldob    0x1B1(g7), r14', 'ld      guest_edge_motion[r14*4], r14',
                  'addo    r14, r13, r14', 'ldos    (r14), g0', 'b       loc_14E90', 'loc_14DD8_own:'],
}
INSERT = {
    **VF2_HIT,
    **VF2_RISE,
    'loc_2F668': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne GAME_VF2, r14, loc_2F668_own', 'ld      0xC30(g7), r15',
                  'bbc     0xA, r15, smooth_vf2_go', 'bbs     0xA, r5, loc_2F36C', 'bbc     9, r5, smooth_vf2_go',
                  'ld      0x0(g7), r14', 'bbs     6, r14, smooth_vf2_mir', 'bbs     0xB, r15, smooth_vf2_b',
                  'b       smooth_vf2_a', 'smooth_vf2_mir:', 'bbc     0xB, r15, smooth_vf2_b', 'smooth_vf2_a:',
                  'ld      stf_ram_50E000+0x1D0, r14', 'ld      stf_ram_50E000+0xE0, r13',
                  'lda     0x3E914E40, r15', 'st      r15, stf_ram_50E000+0x1CC', 'b       smooth_vf2_foot',
                  'smooth_vf2_b:', 'ld      stf_ram_50E000+0x1DC, r14', 'ld      stf_ram_50E000+0xEC, r13',
                  'smooth_vf2_foot:', 'lda     0xA001414, r15', 'st      r15, (g11)[g12*1]',
                  'st      r14, (g11)[g12*1]', 'st      r13, (g11)[g12*1]', 'ld      (g11)[g12*1], r11',
                  'mov     8, r10', 'lda     stf_ram_50E000+0x98, r12', 'smooth_vf2_z:', 'ld      (r12), r14',
                  'lda     0x9801313, r15', 'st      r15, (g11)[g12*1]', 'st      r14, (g11)[g12*1]',
                  'st      r11, (g11)[g12*1]', 'ld      (g11)[g12*1], r14', 'st      r14, (r12)',
                  'addo    0xC, r12, r12', 'cmpdeco 1, r10, r10', 'bl      smooth_vf2_z', 'smooth_vf2_go:',
                  'cmpobe  8, r8, loc_2F728', 'cmpobe  4, r8, loc_2F730', 'mov     1, r8', 'b       loc_2F734',
                  'loc_2F668_own:'],
    'rsc_gra_vf2': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                    'cmpobne GAME_VF2, r14, rsc_gra_own', 'lda     0x3BB4D327, r14',
                    'mulr    r13, r14, r5', 'b       rsc_gra_done', 'rsc_gra_own:'],
    'rsc_normal_gravity': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                           'cmpobne GAME_VF2, r14, rsc_normal_gravity_own',
                           'lda     0x3BB4D327, r3', 'rsc_normal_gravity_own:'],
    'ACT_RC_TA_GUARD': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                        'cmpobne GAME_VF2, r14, ta_guard_own', 'ld      0x1A4(g7), r7',
                        'ld      0x0(g7), r6', 'ldos    0x68(g6), g0', 'bbs     3, r7, ta_guard_low',
                        'ld      0x804(g7), r15', 'bbs     0xD, r15, ta_guard_own',
                        'bbs     0, r6, ta_guard_own', 'ldos    0x810(g7), r14',
                        'bbc     7, r14, ta_guard_own', 'call    sub_1CEA8', 'ret',
                        'ta_guard_low:', 'bbs     0, r6, ta_guard_set', 'ldos    0x810(g7), r14',
                        'bbs     7, r14, ta_guard_set', 'call    sub_1CE94', 'ret',
                        'ta_guard_set:', 'call    set_motion', 'ret', 'ta_guard_own:'],
    # VF2's crouch walks (V 0x1C4F4, 0x14C74, 0x14D10): down and forward or
    # back is a state of its own in VF2, which StF lacks (StF crouches); the
    # board's 0x60 and 0x61, past StF's table, dispatched here, their motions
    # VF2's slots 6/7, 24..27 (the board's 53..58, tools/vf2-guest.mjs). Not
    # ported: rob+0 bit 10's motions 0x46A/0x46B, VF2's states 29/30.
    'vf2_down_pick': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14', 'cmpobne GAME_VF2, r14, vf2_down_own', 'bbc     r6, r8, vf2_down_back', 'lda     0x60000000, r15', 'st      r15, 0x194(g7)', 'b       loc_1E1A0', 'vf2_down_back:', 'bbc     r7, r8, vf2_down_own', 'ld      0x5B8(g7), r15', 'bbs     0, r15, vf2_down_dash', 'lda     0x61000000, r15', 'st      r15, 0x194(g7)', 'b       loc_1E1A0', 'vf2_down_dash:', 'shlo    0x18, 5, r15', 'st      r15, 0x194(g7)', 'b       loc_1E180', 'vf2_down_own:'],
    'exec_command': ['ldob    0x197(g7), r3', 'lda     0x60, r4', 'cmpobg  r4, r3, exec_command_own', 'ld      0x194(g7), r11', 'b       loc_13120', 'exec_command_own:'],
    'exec_action': ['ldob    0x19F(g7), r3', 'lda     0x60, r4', 'cmpobe  r4, r3, vf2_cwalk_f', 'addo    1, r4, r4', 'cmpobe  r4, r3, vf2_cwalk_b', 'b       exec_action_own', 'vf2_cwalk_f:', 'ld      0x1A4(g7), r7', 'ld      0x0(g7), r6', 'bbc     3, r7, vf2_cwf_stand', 'bbc     0xA, r7, vf2_cwf_low', 'bbs     0xB, r7, vf2_cwf_back', 'b       vf2_cwf_rise', 'vf2_cwf_stand:', 'ldos    0x6A(g6), g0', 'ldos    0x810(g7), r14', 'bbs     7, r14, vf2_cwf_cut', 'call    set_motion', 'b       syagami_yoke', 'vf2_cwf_cut:', 'call    sub_1CE94', 'b       syagami_yoke', 'vf2_cwf_low:', 'bbs     0, r6, vf2_cwf_back', 'ldos    0x810(g7), r14', 'bbs     7, r14, vf2_cwf_back', 'ldos    0x6A(g6), g0', 'call    sub_1CEA8', 'b       syagami_yoke', 'vf2_cwf_back:', 'ldos    0x6E(g6), g0', 'b       vf2_cwf_set', 'vf2_cwf_rise:', 'bbs     0, r6, vf2_cwf_up', 'ldos    0x810(g7), r14', 'bbc     7, r14, syagami_yoke', 'ret', 'vf2_cwf_up:', 'ldos    0x70(g6), g0', 'bbc     1, r7, vf2_cwf_set', 'ldos    0x6E(g6), g0', 'vf2_cwf_set:', 'call    set_motion', 'ret', 'vf2_cwalk_b:', 'ld      0x1A4(g7), r7', 'ld      0x0(g7), r6', 'bbc     3, r7, vf2_cwb_stand', 'bbc     0xA, r7, vf2_cwb_low', 'bbs     0xB, r7, vf2_cwb_back', 'b       vf2_cwb_rise', 'vf2_cwb_stand:', 'ldos    0x6C(g6), g0', 'ldos    0x810(g7), r14', 'bbs     7, r14, vf2_cwb_cut', 'call    set_motion', 'b       syagami_yoke', 'vf2_cwb_cut:', 'call    sub_1CE94', 'b       syagami_yoke', 'vf2_cwb_low:', 'bbs     0, r6, vf2_cwb_back', 'ldos    0x810(g7), r14', 'bbs     7, r14, vf2_cwb_back', 'ldos    0x6C(g6), g0', 'call    sub_1CEA8', 'b       syagami_yoke', 'vf2_cwb_back:', 'ldos    0x72(g6), g0', 'b       vf2_cwb_set', 'vf2_cwb_rise:', 'bbs     0, r6, vf2_cwb_up', 'ldos    0x810(g7), r14', 'bbc     7, r14, syagami_yoke', 'ret', 'vf2_cwb_up:', 'ldos    0x74(g6), g0', 'bbc     1, r7, vf2_cwb_set', 'ldos    0x72(g6), g0', 'vf2_cwb_set:', 'call    set_motion', 'ret', 'exec_action_own:'],
    # VF2's walks (V 0x14B54, 0x14BE4): from a crouch, or from a guard
    # (0x810 bit 7), VF2 plays its slot 3 or 4 (the board's 59 and 60) as it
    # does a crouch walk's; StF walks on at once. rob+0 bit 10's motions not
    # ported, nor StF's rob+0 bit 29 test, VF2 not having it.
    'ACT_RC_WALK': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14', 'cmpobne GAME_VF2, r14, walk_own', 'ld      0x1A4(g7), r7', 'ld      0x0(g7), r6', 'bbs     3, r7, vf2_walk_low', 'bbc     0xA, r7, vf2_walk_10', 'bbs     0xB, r7, vf2_walk_go', 'b       vf2_walk_23', 'vf2_walk_low:', 'ldos    0x76(g6), g0', 'ldos    0x810(g7), r14', 'bbs     7, r14, vf2_walk_set', 'call    sub_1CE94', 'ret', 'vf2_walk_10:', 'bbs     0, r6, vf2_walk_go', 'ldos    0x810(g7), r14', 'bbc     7, r14, vf2_walk_go', 'ldos    0x76(g6), g0', 'call    sub_1CEA8', 'ret', 'vf2_walk_go:', 'ldos    0x22(g6), g0', 'b       vf2_walk_set', 'vf2_walk_23:', 'bbc     0, r6, vf2_walk_ret', 'ldos    0x26(g6), g0', 'bbc     1, r7, vf2_walk_set', 'ldos    0x22(g6), g0', 'vf2_walk_set:', 'call    set_motion', 'vf2_walk_ret:', 'ret', 'walk_own:'],
    'ACT_RC_BWALK': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14', 'cmpobne GAME_VF2, r14, bwalk_own', 'ld      0x1A4(g7), r7', 'ld      0x0(g7), r6', 'bbs     3, r7, vf2_bwalk_low', 'bbc     0xA, r7, vf2_bwalk_10', 'bbc     0xB, r7, vf2_bwalk_go', 'b       vf2_bwalk_23', 'vf2_bwalk_low:', 'ldos    0x78(g6), g0', 'ldos    0x810(g7), r14', 'bbs     7, r14, vf2_bwalk_set', 'call    sub_1CE94', 'ret', 'vf2_bwalk_10:', 'bbs     0, r6, vf2_bwalk_go', 'ldos    0x810(g7), r14', 'bbc     7, r14, vf2_bwalk_go', 'ldos    0x78(g6), g0', 'call    sub_1CEA8', 'ret', 'vf2_bwalk_go:', 'ldos    0x2A(g6), g0', 'b       vf2_bwalk_set', 'vf2_bwalk_23:', 'bbc     0, r6, vf2_bwalk_ret', 'ldos    0x2E(g6), g0', 'bbc     1, r7, vf2_bwalk_set', 'ldos    0x2A(g6), g0', 'vf2_bwalk_set:', 'call    set_motion', 'vf2_bwalk_ret:', 'ret', 'bwalk_own:'],
    # VF2's action_after (V 0x180D4) keeps rob+0 bit 8, a low posture: set
    # while crouched, or in a crouch's (0x810 bit 7) first half; StF's hit
    # code still reads it but never sets it.
    'action_after': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14', 'cmpobne GAME_VF2, r14, action_after_own', 'ld      0x1A4(g7), r15', 'ldos    0x810(g7), r14', 'ldos    0x800(g7), r3', 'shro    1, r3, r3', 'ldos    0x1AA(g7), r13', 'bbs     3, r15, vf2_low_crouch', 'bbc     7, r14, vf2_low_clr', 'cmpoble r13, r3, vf2_low_set', 'b       vf2_low_clr', 'vf2_low_crouch:', 'bbs     7, r14, vf2_low_set', 'cmpoble r13, r3, vf2_low_clr', 'vf2_low_set:', 'ld      0x0(g7), r15', 'setbit  8, r15, r15', 'st      r15, 0x0(g7)', 'b       action_after_own', 'vf2_low_clr:', 'ld      0x0(g7), r15', 'clrbit  8, r15, r15', 'st      r15, 0x0(g7)', 'action_after_own:'],
    'area_coli_618': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                      'cmpobne GAME_VF2, r14, area_coli_618_own', 'ldos    0x61A(g7), r14',
                      'shlo    16, r14, r14', 'shlo    16, r7, r7', 'shro    16, r7, r7',
                      'or      r14, r7, r7', 'area_coli_618_own:'],
    'rob_revise_yang': ['ldob    0x1B1(g7), r14',
                        'ldob    guest_char_game[r14], r14',
                        'cmpobne GAME_VF2, r14, rob_revise_yang_own',
                        'ld      stf_ram_500000+0x828, r3',
                        'ld      0x0(r3), r15',
                        'bbc     0x1F, r15, loc_17F74',
                        'ldis    0x5B6(g7), r9',
                        'ld      0x1A4(g7), r7',
                        'ld      0x1A4(g8), r8',
                        'bbc     0x17, r7, rob_revise_yang_1',
                        'ldos    0x61A(g7), r9',
                        'ldis    0x26(g7), r13',
                        'subi    r13, r9, r9',
                        'lda     0x38E, r6',
                        'b       loc_17EEC',
                        'rob_revise_yang_1:',
                        'ld      0x0(g7), r15',
                        'bbc     9, r15, rob_revise_yang_2',
                        'ldos    0x61A(g7), r9',
                        'rob_revise_yang_2:',
                        'bbs     0x1B, r7, loc_17F74',
                        'ld      0x0(g7), r15',
                        'bbs     0x16, r15, loc_17F74',
                        'bbc     0x1C, r8, rob_revise_yang_3',
                        'ldos    0x1AA(g8), r14',
                        'cmpobg  10, r14, loc_17F74',
                        'bbs     0xD, r7, loc_17E3C',
                        'bbs     0xA, r7, loc_17E3C',
                        'b       loc_17F74',
                        'rob_revise_yang_3:',
                        'lda     0x1010, r3',
                        'and     r3, r7, r4',
                        'cmpobe  r3, r4, loc_17F74',
                        'bbs     0xE, r7, loc_17F74',
                        'bbc     0x10, r7, rob_revise_yang_4',
                        'bbs     8, r7, rob_revise_yang_4',
                        'bbc     8, r8, rob_revise_yang_4',
                        'bbs     4, r8, loc_17F74',
                        'rob_revise_yang_4:',
                        'bbs     0xD, r7, loc_17DE8',
                        'bbc     0x12, r7, rob_revise_yang_5',
                        'bbs     1, r7, loc_17DD8',
                        'b       loc_17F74',
                        'rob_revise_yang_5:',
                        'bbs     2, r7, loc_17E3C',
                        'bbs     0xA, r7, loc_17DE8',
                        'lda     0x1102, r13',
                        'and     r13, r7, r3',
                        'lda     0x1002, r13',
                        'cmpobe  r13, r3, loc_17DE8',
                        'lda     0x4010, r3',
                        'and     r3, r8, r4',
                        'cmpobe  r3, r4, loc_17E3C',
                        'bbc     1, r7, rob_revise_yang_6',
                        'bbs     0xF, r8, loc_17F74',
                        'b       loc_17E00',
                        'rob_revise_yang_6:',
                        'bbc     0x1E, r7, loc_17F74',
                        'b       loc_17E00',
                        'rob_revise_yang_own:'],
    'rand': ['ld      _link+4, r15', 'cmpobne 5, r15, rand_own',
             'ld      stf_ram_500000+0x98, r15', 'lda     0x41C64E6D, r14',
             'mulo    r14, r15, r15', 'lda     12345, r14', 'addo    r14, r15, r15',
             'st      r15, stf_ram_500000+0x98', 'shro    16, r15, g0', 'ret',
             'rand_own:'],
    'loc_2BBDC': ['cmpobne 0, r11, loc_2BBDC_own', 'ld      0x914(r10), r14',
                  'cmpobne 0, r14, loc_2BBDC_own', 'ld      0x26C(g13), r15',
                  'bbs     1, r15, loc_2BBDC_hit', 'bbc     4, r15, loc_2BBDC_own',
                  'loc_2BBDC_hit:', 'ld      0x70C(g7), r15', 'bbc     5, r15, loc_2BBDC_own',
                  'ld      0x7EC(g8), r15', 'bbs     5, r15, loc_2BBDC_own',
                  'ldob    0x821(g7), r5', 'ldob    byte_2CA3C[r5], r5',
                  'ld      0xAF0(g8)[r5*4], r13', 'ld      0x1F74(g8)[r5*4], r12',
                  'cmpobl  r12, r13, loc_2BBDC_own', 'ld      0x1F7C(g8)[r5*4], r12',
                  'cmpobl  r12, r13, loc_2BBDC_own', 'ld      0x7F0(g8), r15', 'addo    2, r5, r5',
                  'bbs     r5, r15, loc_2BBDC_own', 'setbit  r5, r15, r15', 'st      r15, 0x7F0(g8)',
                  'ld      0x70C(g7), r14', 'setbit  6, r14, r14', 'st      r14, 0x70C(g7)',
                  'and     0xC, r15, r15',
                  'cmpobne 0xC, r15, loc_2BBDC_own', 'ld      0x0(g8), r15',
                  'setbit  0x1C, r15, r15', 'st      r15, 0x0(g8)',
                  'loc_2BBDC_own:'],
    'loc_2A6B8': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne GAME_STF, r14, loc_2A6D0'],
    'ring_tobitiri_set': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                          'cmpobe  GAME_STF, r14, ring_tobitiri_set_own', 'ret',
                          'ring_tobitiri_set_own:'],
    'loc_13F18': ['ldob    0x1B1(g7), r3', 'ldob    guest_char_game[r3], r3',
                  'cmpobe  GAME_FV, r3, loc_13F18_fv',
                  'cmpobne GAME_VF2, r3, loc_13F18_own', 'lda     0x3F9BAF44, r13',
                  'subr    r13, r8, r3', 'cmpible r5, r3, loc_13F18_wall', 'mov     r3, r5',
                  'loc_13F18_wall:', 'lda     0x3FE986E6, r4', 'addr    r4, r9, r3',
                  'cmpibge r5, r3, loc_13F98', 'subr    r4, r9, r3',
                  'cmpible r5, r3, loc_13F98', 'mov     r3, r5', 'b       loc_13F98',
                  'loc_13F18_fv:', 'ld      0x19C(g7), r15', 'bbs     0x15, r15, loc_13F98',
                  'lda     0x3F515653, r4', 'addr    r4, r9, r3', 'cmpibge r5, r3, loc_13F18_fv_near',
                  'subr    r4, r9, r3', 'cmpible r5, r3, loc_13F18_fv_near', 'mov     r3, r5',
                  'b       loc_13F98',
                  'loc_13F18_fv_near:', 'lda     0x3FD15653, r4', 'ld      0x5F4(g7), r3',
                  'cmpr    r4, r3', 'bl      loc_13F98', 'ld      0x710(g8), r3',
                  'lda     0x3FACCCCD, r4', 'cmpr    r4, r3', 'bg      loc_13F98',
                  'lda     0x3F515653, r4', 'bbs     0x1F, r9, loc_13F18_fv_left',
                  'subr    r4, r9, r3', 'cmpr    r5, r3', 'bl      loc_13F98', 'mov     r3, r5',
                  'b       loc_13F98',
                  'loc_13F18_fv_left:', 'addr    r4, r9, r3', 'cmpr    r5, r3', 'bg      loc_13F98',
                  'mov     r3, r5', 'b       loc_13F98',
                  'loc_13F18_own:'],
    'loc_13E2C': ['ldob    0x1B1(g7), r3', 'ldob    guest_char_game[r3], r3',
                  'lda     0x3BB4D327, r4', 'cmpobe  GAME_VF2, r3, loc_13E2C_guest',
                  'lda     0x3C2EE9B2, r4', 'cmpobne GAME_FV, r3, loc_13E2C_own',
                  'loc_13E2C_guest:', 'ld      stf_ram_50A000+0x0, r3',
                  'subr    r4, r3, r3', 'st      r3, 0x5CC(g7)',
                  'loc_13E2C_own:'],
    'loc_1B044': ['ldob    0x1B1(g7), r4', 'ld      guest_motion_remap[r4*4], r4',
                  'cmpobe  0, r4, loc_1B044_own', 'lda     0x1FFF, r5', 'and     r5, g0, r6',
                  'ldos    (r4)[r6*2], r6', 'cmpobe  0, r6, loc_1B044_own', 'andnot  r5, g0, g0',
                  'or      r6, g0, g0', 'loc_1B044_own:'],
    'loc_2D7B0': ['ldob    0x1B1(g7), r3', 'ldob    guest_char_game[r3], r3',
                  'ldob    0x1B1(g8), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne r3, r14, loc_2D7B0_own', 'cmpobe  GAME_STF, r3, loc_2D7B0_own',
                  'cmpobe  GAME_FV, r3, loc_2D7B0_fv', 'cmpobne GAME_VF2, r3, loc_2D7B0_own',
                  'lda     0x3F1BAF44, r15', 'b       loc_2D7B0_own',
                  'loc_2D7B0_fv:', 'lda     0x4002D5F4, r14', 'mulr    r14, r15, r15',
                  'loc_2D7B0_own:'],
    'loc_2D7E0': ['ldob    0x1B1(g7), r3', 'ldob    guest_char_game[r3], r3',
                  'ldob    0x1B1(g8), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne r3, r14, loc_2D7E0_own', 'cmpobe  GAME_VF2, r3, loc_2D7F8',
                  'cmpobne GAME_FV, r3, loc_2D7E0_own', 'lda     0x3F1D00BE, r15',
                  'bbs     0x1F, g4, loc_2D7F8', 'cmpr    r15, g4', 'bge     loc_2D7F8',
                  'mov     r15, g4', 'b       loc_2D7F8',
                  'loc_2D7E0_own:'],
    'coli_cont_cop_g4': ['ldob    0x1B1(g7), r3', 'ldob    guest_char_game[r3], r3',
                         'cmpobne GAME_VF2, r3, coli_cont_cop_g4_own',
                         'ldob    0x1B1(g8), r3', 'ldob    guest_char_game[r3], r3',
                         'cmpobne GAME_VF2, r3, coli_cont_cop_g4_own', 'call    vf2_coli_push',
                         'ld      _vf2_push_pairs, r13', 'coli_cont_cop_g4_own:'],
    'loc_2B9CC': ['ldob    0x1B1(g8), r3', 'ldob    guest_char_game[r3], r3',
                  'cmpobe  GAME_STF, r3, loc_2B9CC_up', 'ld      0x1A4(g8), r3',
                  'bbc     3, r3, loc_2B9CC_up', 'addo    4, r9, r9',
                  'loc_2B9CC_up:'],
    'loc_18214': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne GAME_VF2, r14, loc_18214_own', 'ld      0x1F4(g7), r3',
                  'ld      0x1FC(g7), r5',
                  'loc_18214_own:'],
    'loc_18248': ['ldob    0x1B1(g7), r14', 'ldob    guest_char_game[r14], r14',
                  'cmpobne GAME_VF2, r14, loc_18248_own', 'ld      0x1A4(g7), r15',
                  'bbs     0x17, r15, rcs_vf2_down', 'ld      0x0(g7), r15', 'bbs     2, r15, rcs_vf2_air',
                  'ldos    0x61C(g7), r14', 'cmpobne 0, r14, rcs_vf2_wall', 'ld      0x804(g7), r15',
                  'bbc     4, r15, rcs_vf2_edge', 'ld      0x1A4(g7), r15', 'setbit  4, r15, r15',
                  'st      r15, 0x1A4(g7)', 'rcs_vf2_edge:', 'ldos    0x618(g7), r4',
                  'cmpobe  0, r4, loc_183CC', 'ld      0x1A4(g7), r15', 'bbc     0x1D, r15, loc_183CC',
                  'ld      0x0(g7), r15', 'bbc     0xA, r15, rcs_vf2_tip_far', 'b       rcs_vf2_tip_near',
                  'rcs_vf2_wall:', 'ld      0x1A4(g7), r15', 'clrbit  4, r15, r15', 'st      r15, 0x1A4(g7)',
                  'ldos    0x60E(g7), r14', 'cmpobne 0, r14, rcs_vf2_tip', 'cmpobe  0, r11, rcs_vf2_in',
                  'setbit  0, r10, r10', 'b       rcs_vf2_out', 'rcs_vf2_in:', 'mov     0, r15',
                  'st      r15, 0x620(g7)', 'st      r15, 0x30(g7)', 'st      r15, 0x1C(g7)', 'rcs_vf2_tip:',
                  'ld      0x620(g7), r14', 'cmpobne 0, r14, loc_183CC', 'ld      0x1A4(g7), r15',
                  'bbs     0xE, r15, rcs_vf2_slip', 'bbs     0x10, r15, rcs_vf2_slip',
                  'ldos    0x618(g7), r4', 'shlo    12, 9, r13', 'cmpobne r13, r4, loc_183CC',
                  'ldos    0x614(g7), r14', 'bbs     0xF, r14, rcs_vf2_tip_near',
                  'bbc     0xC, r14, loc_183CC', 'rcs_vf2_tip_far:', 'ld      0x2A8(g7), r6',
                  'ld      0x2B0(g7), r7', 'mov     0, r9', 'b       rcs_vf2_tip_aim', 'rcs_vf2_tip_near:',
                  'ldos    0x614(g7), r14', 'bbs     0xC, r14, loc_183CC', 'ld      0x284(g7), r6',
                  'ld      0x28C(g7), r7', 'subo    1, 0, r9', 'rcs_vf2_tip_aim:', 'ldob    0x1B1(g7), r4',
                  'ld      guest_edge_motion[r4*4], r4', 'cmpobe  0, r4, loc_183CC', 'mov     0, r12',
                  'lda     0x17802F2F, r15', 'st      r15, (g11)[g12*1]', 'st      r12, (g11)[g12*1]',
                  'st      r7, (g11)[g12*1]', 'st      r6, (g11)[g12*1]', 'st      r12, (g11)[g12*1]',
                  'ld      (g11)[g12*1], r8', 'shlo    13, 1, r13', 'addi    r13, r8, r8',
                  'shlo    14, 3, r13', 'and     r13, r8, r8', 'ldis    0x616(g7), r6', 'subi    r8, r6, r5',
                  'addo    g12, r5, r3', 'bbs     0xF, r3, rcs_vf2_tip_back', 'ldos    18(r4), r15',
                  'st      r15, 0x198(g7)', 'shlo    12, 3, r7', 'mov     0, r5', 'b       rcs_vf2_tip_side',
                  'rcs_vf2_tip_back:', 'ldos    16(r4), r15', 'lda     0x8020000, r13',
                  'or      r13, r15, r15', 'st      r15, 0x198(g7)', 'not     r9, r9', 'shlo    12, 5, r7',
                  'mov     0, r5', 'rcs_vf2_tip_side:', 'ld      0x0(g7), r15',
                  'bbc     6, r15, rcs_vf2_tip_turn', 'not     r9, r9', 'rcs_vf2_tip_turn:',
                  'cmpobne 0, r9, rcs_vf2_turn', 'ld      0x0(g7), r15', 'notbit  6, r15, r15',
                  'st      r15, 0x0(g7)', 'b       rcs_vf2_turn', 'rcs_vf2_slip:', 'lda     0x6E03, r13',
                  'ldos    0x628(g7), r14', 'and     r13, r14, r3', 'cmpobe  0, r3, loc_183CC',
                  'ldob    0x1B1(g7), r4', 'ld      guest_edge_motion[r4*4], r4', 'cmpobe  0, r4, loc_183CC',
                  'ld      0x1F4(g7), r6', 'ld      0x1FC(g7), r7', 'mov     0, r12',
                  'lda     0x17802F2F, r15', 'st      r15, (g11)[g12*1]', 'st      r12, (g11)[g12*1]',
                  'st      r7, (g11)[g12*1]', 'st      r6, (g11)[g12*1]', 'st      r12, (g11)[g12*1]',
                  'ld      (g11)[g12*1], r8', 'shlo    13, 1, r13', 'addi    r13, r8, r8',
                  'shlo    14, 3, r13', 'and     r13, r8, r8', 'ldis    0x616(g7), r6', 'subi    r8, r6, r5',
                  'addo    g12, r5, r3', 'bbs     0xF, r3, rcs_vf2_slip_back', 'shlo    12, 3, r7',
                  'ld      0x1A4(g7), r15', 'bbs     0xB, r15, rcs_vf2_slip_fore_b', 'ldos    2(r4), r15',
                  'lda     0x8020000, r13', 'or      r13, r15, r15', 'st      r15, 0x198(g7)',
                  'mov     0, r5', 'b       rcs_vf2_turn', 'rcs_vf2_slip_fore_b:', 'ldos    4(r4), r15',
                  'lda     0x8020000, r13', 'or      r13, r15, r15', 'st      r15, 0x198(g7)',
                  'shlo    15, 1, r5', 'b       rcs_vf2_turn', 'rcs_vf2_slip_back:', 'shlo    12, 5, r7',
                  'ld      0x1A4(g7), r15', 'bbs     0xB, r15, rcs_vf2_slip_back_b', 'ldos    0(r4), r15',
                  'lda     0x8020000, r13', 'or      r13, r15, r15', 'st      r15, 0x198(g7)',
                  'mov     0, r5', 'b       rcs_vf2_turn', 'rcs_vf2_slip_back_b:', 'ldos    6(r4), r15',
                  'lda     0x8020000, r13', 'or      r13, r15, r15', 'st      r15, 0x198(g7)',
                  'shlo    15, 1, r5', 'b       rcs_vf2_turn', 'rcs_vf2_air:', 'ld      0x0(g7), r15',
                  'bbs     3, r15, loc_183CC', 'lda     0x3D261049, r13', 'addr    r13, g4, r5',
                  'ld      0x1C(g7), r6', 'ld      0x81C(g7), r14', 'addr    r5, r14, r3', 'cmpr    r6, r3',
                  'bge     rcs_vf2_up', 'setbit  0, r10, r10', 'ld      0x84(g7), r14', 'addr    r5, r14, r3',
                  'cmpr    r6, r3', 'bge     rcs_vf2_up', 'rcs_vf2_land:', 'ld      0x0(g7), r15',
                  'setbit  0xD, r15, r15', 'st      r15, 0x0(g7)', 'st      g4, 0x1C(g7)',
                  'st      r11, 0x620(g7)', 'mov     0, r15', 'st      r15, 0x30(g7)', 'call    sub_1980C',
                  'b       loc_183CC', 'rcs_vf2_up:', 'ldos    0x61C(g7), r14', 'cmpobe  0, r14, loc_183CC',
                  'bbs     0x1F, g4, rcs_vf2_out', 'bbs     0, r10, rcs_vf2_land', 'b       loc_183CC',
                  'rcs_vf2_out:', 'ldob    0x1B1(g7), r4', 'ld      guest_edge_motion[r4*4], r4',
                  'cmpobe  0, r4, rcs_vf2_still', 'ld      0x1A4(g7), r15', 'bbs     0xE, r15, rcs_vf2_off',
                  'bbc     0x10, r15, rcs_vf2_still', 'rcs_vf2_off:', 'lda     0xFC00, r13',
                  'ldos    0x614(g7), r14', 'and     r13, r14, r3', 'cmpobne 0, r3, rcs_vf2_off_back',
                  'lda     0x4E, r13', 'and     r13, r14, r3', 'cmpobne 0, r3, rcs_vf2_off_side',
                  'rcs_vf2_still:', 'mov     0, r7', 'ldos    0x614(g7), r14',
                  'cmpobne 0, r14, rcs_vf2_floor', 'bbs     0, r10, rcs_vf2_land', 'b       loc_183CC',
                  'rcs_vf2_off_back:', 'ld      0x1F4(g7), r6', 'ld      0x1FC(g7), r7', 'mov     0, r12',
                  'lda     0x17802F2F, r15', 'st      r15, (g11)[g12*1]', 'st      r12, (g11)[g12*1]',
                  'st      r7, (g11)[g12*1]', 'st      r6, (g11)[g12*1]', 'st      r12, (g11)[g12*1]',
                  'ld      (g11)[g12*1], r8', 'shlo    13, 1, r13', 'addi    r13, r8, r8',
                  'shlo    14, 3, r13', 'and     r13, r8, r8', 'ldis    0x616(g7), r6', 'subi    r8, r6, r5',
                  'ld      0x1A4(g7), r15', 'bbs     0xB, r15, rcs_vf2_off_back_b', 'shlo    12, 5, r7',
                  'mov     0, r5', 'ldos    8(r4), r15', 'lda     0x8020000, r13', 'or      r13, r15, r15',
                  'st      r15, 0x198(g7)', 'b       rcs_vf2_floor', 'rcs_vf2_off_back_b:',
                  'shlo    12, 3, r7', 'shlo    15, 1, r5', 'ldos    12(r4), r15', 'lda     0x8020000, r13',
                  'or      r13, r15, r15', 'st      r15, 0x198(g7)', 'b       rcs_vf2_floor',
                  'rcs_vf2_off_side:', 'ld      0x1F4(g7), r6', 'ld      0x1FC(g7), r7', 'mov     0, r12',
                  'lda     0x17802F2F, r15', 'st      r15, (g11)[g12*1]', 'st      r12, (g11)[g12*1]',
                  'st      r7, (g11)[g12*1]', 'st      r6, (g11)[g12*1]', 'st      r12, (g11)[g12*1]',
                  'ld      (g11)[g12*1], r8', 'shlo    13, 1, r13', 'addi    r13, r8, r8',
                  'shlo    14, 3, r13', 'and     r13, r8, r8', 'ldis    0x616(g7), r6', 'subi    r8, r6, r5',
                  'ld      0x1A4(g7), r15', 'bbs     0xB, r15, rcs_vf2_off_side_b', 'shlo    12, 3, r7',
                  'mov     0, r5', 'ldos    10(r4), r15', 'lda     0x8020000, r13', 'or      r13, r15, r15',
                  'st      r15, 0x198(g7)', 'b       rcs_vf2_floor', 'rcs_vf2_off_side_b:',
                  'shlo    12, 5, r7', 'shlo    15, 1, r5', 'ldos    14(r4), r15', 'lda     0x8020000, r13',
                  'or      r13, r15, r15', 'st      r15, 0x198(g7)', 'rcs_vf2_floor:', 'ld      0x0(g7), r15',
                  'setbit  0xD, r15, r15', 'st      r15, 0x0(g7)', 'mov     0, r15', 'st      r15, 0x1C(g7)',
                  'st      r15, 0x620(g7)', 'st      r15, 0x30(g7)', 'call    sub_1980C',
                  'cmpobne 0, r7, rcs_vf2_turn', 'b       loc_183CC', 'rcs_vf2_down:', 'mov     0, r15',
                  'st      r15, 0x30(g7)', 'st      r15, 0x1C(g7)', 'ldos    0x624(g7), r14',
                  'cmpobe  0, r14, loc_183CC', 'mov     1, r15', 'st      r15, 0x620(g7)',
                  'b       loc_183CC', 'rcs_vf2_turn:', 'ldis    0x5B4(g7), r4', 'addo    r5, r4, r4',
                  'addo    r5, r6, r6', 'subi    r6, r4, r5', 'shlo    16, r5, r15', 'shri    16, r15, r5',
                  'bbs     0xF, r5, rcs_vf2_turn_neg', 'bbs     0xE, r5, rcs_vf2_turn_far',
                  'shlo    12, 1, r4', 'cmpobge r5, r4, rcs_vf2_turn_to', 'mov     r5, r4',
                  'b       rcs_vf2_turn_to', 'rcs_vf2_turn_far:', 'shlo    12, 7, r4',
                  'cmpoble r5, r4, rcs_vf2_turn_to', 'mov     r5, r4', 'b       rcs_vf2_turn_to',
                  'rcs_vf2_turn_neg:', 'bbc     0xE, r5, rcs_vf2_turn_negfar', 'lda     0xFFFFF000, r4',
                  'cmpible r5, r4, rcs_vf2_turn_to', 'mov     r5, r4', 'b       rcs_vf2_turn_to',
                  'rcs_vf2_turn_negfar:', 'lda     0xFFFF9000, r4', 'cmpibge r5, r4, rcs_vf2_turn_to',
                  'mov     r5, r4', 'rcs_vf2_turn_to:', 'addo    r6, r4, r6', 'subi    r8, r6, r5',
                  'shlo    16, r5, r15', 'shri    16, r15, r5', 'bbs     0xE, r7, rcs_vf2_turn_wide',
                  'subi    r7, 0, r4', 'cmpibl  r5, r4, rcs_vf2_turn_clamp', 'mov     r7, r4',
                  'cmpible r5, r4, rcs_vf2_turn_set', 'rcs_vf2_turn_clamp:', 'addi    r8, r4, r6',
                  'rcs_vf2_turn_set:', 'stis    r6, 0x61A(g7)', 'b       loc_183CC', 'rcs_vf2_turn_wide:',
                  'mov     r7, r4', 'cmpobl  r5, r4, rcs_vf2_turn_wclamp', 'subi    r7, 0, r4',
                  'cmpoble r5, r4, rcs_vf2_turn_wset', 'rcs_vf2_turn_wclamp:', 'addi    r8, r4, r6',
                  'rcs_vf2_turn_wset:', 'stis    r6, 0x61A(g7)', 'b       loc_183CC', 'loc_18248_own:'],
}

LABEL = re.compile(r'^([A-Za-z_.$][\w.$]*):')
TOKEN = re.compile(r'(?<![\w.$])[A-Za-z_.$][\w.$]*')
NUM = re.compile(r'(?<![\w.$])0x5[0-9A-Fa-f]{5}(?![\w.$])')
REG = re.compile(r'^(?:[rg]\d+|fp|sp|pfp|rip)$')


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw).stdout


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument('--stfdisasm', default=os.path.expanduser('~/source/repos/biggestsonicfan/stfdisasm'))
    ap.add_argument('--out', default=os.path.join(here, '..', 'board', 'src'))
    a = ap.parse_args()
    asm = os.path.join(a.stfdisasm, 'rom_code1.asm')

    # Assemble StF: every label's address, and the ROM image.
    with tempfile.TemporaryDirectory() as tmp:
        obj = os.path.join(tmp, 'stf.o')
        run(['i960-elf-as', '-AKB', '-J', '-I', a.stfdisasm, '-o', obj, asm])
        addr = {}
        for l in run(['i960-elf-nm', obj]).split('\n'):
            p = l.split()
            if len(p) == 3:
                addr[p[2]] = int(p[0], 16)
        img = os.path.join(tmp, 'stf.bin')
        run(['i960-elf-objcopy', '-O', 'binary', '-j', '.text', obj, img])
        rom = open(img, 'rb').read()
    sets = {}
    for l in open(os.path.join(a.stfdisasm, 'include.s'), encoding='latin1'):
        m = re.match(r'\s*\.set\s+(\w+)\s*,\s*(0x[0-9A-Fa-f]+|\d+)', l)
        if m:
            sets[m.group(1)] = int(m.group(2), 0)

    src = open(asm, encoding='latin1').read().split('\n')
    tail, tail_at, tail_line = NATIVE_TAIL
    src[[l.strip() for l in src].index(tail_line)] = f'{tail}: {tail_line}'
    addr[tail] = tail_at
    for name, (routine, after) in NAMED.items():
        at = [l.split('#')[0].strip() for l in src].index(f'{routine}:')
        at = next(j for j in range(at, len(src)) if src[j].split('#')[0].strip() == after) + 1
        src[at] = f'{name}: {src[at]}'
    labline = {}
    for i, l in enumerate(src):
        m = LABEL.match(l)
        if m:
            labline[m.group(1)] = i
    def code(l):
        return LABEL.sub('', l).split('#')[0].strip()

    # Blocks: a label and the lines up to the next label. A code block is live
    # when a live branch, call or jump table names it, or a live block falls
    # into it; in a block, the lines after a return or a branch are dead. A
    # table below ROM_LO is live when live code loads from it (`ld
    # off_1B568[r3*4]`, `byte_316A4(r4)`); a label below 0x1000 used as a
    # displacement (`dword_8(g6)`) or naming code (`lda loc_3A48`) is a number.
    starts = sorted(labline.values())
    nxt_start = dict(zip(starts, starts[1:] + [len(src)]))
    name_at = {i: n for n, i in labline.items()}
    def is_data(i):
        c = next((code(l) for l in src[i:nxt_start[i]] if code(l)), '')
        return c.startswith('.') and not c.startswith('.align')
    def is_branch(op):
        return op in ('call', 'callx', 'bal', 'balx', 'b', 'bx') or re.match(r'^(b[a-z]+|cmp[oi]b[a-z]+)$', op)
    def target(op, args):
        a = args.split(',')
        return (a[0] if op in ('bal', 'balx') else a[-1]).strip()
    def lines(i):
        """A block's live lines, and whether it falls into the next."""
        out = []
        for j in range(i, nxt_start[i]):
            c = code(src[j])
            if c:
                out.append(c)
                if c.split()[0] in ('ret', 'b', 'bx'):
                    return out, False
        return out, not is_data(i) or name_at[i] in RUN_ON
    def table(t):
        return (t in labline and is_data(labline[t]) and t not in NUMBERS
                and (0x1000 <= addr.get(t, 0) < ROM_LO or t in LOW_TABLES or t in ROM_CODE_TABLES))
    def code_ptr(t):
        return (t in labline and not is_data(labline[t]) and t not in NUMBERS
                and not 0x3A00 <= addr.get(t, 0) < 0x3C00 and addr.get(t, 0) >= 0x1000)
    def base(t):
        return t.split('+')[0].strip()
    live, todo, why = set(), [(labline[f], 'root') for f in ROOTS + EXTRA_TABLES], {}
    stub_lines = {labline[f] for f in STUBS + list(TO_C)}
    while todo:
        i, w = todo.pop()
        if i in live or i in stub_lines:
            continue
        live.add(i)
        why[i] = w
        body, falls = lines(i)
        for c in body:
            if c.startswith('.asci'):
                continue
            op, _, args = c.partition(' ')
            if op == '.long':
                targets = [base(t) for t in args.split(',')
                           if base(t) in labline and base(t) not in NUMBERS | DATA_NUMBERS and (not is_data(labline[base(t)]) or table(base(t)))]
            elif is_branch(op):
                targets = [target(op, args)]
            else:
                targets = [m.group(0) for m in TOKEN.finditer(args)
                           if table(m.group(0)) or (code_ptr(m.group(0)) and args[m.end():m.end() + 1] in ('', ',', ' '))]
            for t in targets:
                if t in labline:
                    todo.append((labline[t], f'{name_at[i]}: {c}'))
        if falls:
            n = nxt_start[i]
            if n in stub_lines or n >= len(src):
                sys.exit(f'lift: {name_at[i]} falls through into {name_at.get(n)}')
            todo.append((n, f'{name_at[i]}: falls through'))
    order = sorted(live)
    lifted_labels = {name_at[i] for i in live}

    ram, notes = {}, {}
    def ram_ref(v):
        ram[v] = True
        return f'STFRAM_{v:06X}'

    guest_at, at = {}, GUEST_BASE
    for t, n, _ in GUESTS:
        guest_at[t] = at
        at += n
    guest_heap = at

    def fix_token(t, c):
        if t in guest_at:
            notes.setdefault('guest', set()).add(t)
            return f'guest_{t}'
        if t in NUMBERS or (t in DATA_NUMBERS and c.startswith('.long')):
            notes.setdefault('num', set()).add(f'{t}=0x{addr[t]:X}')
            return f'0x{addr[t]:X}'
        if t in lifted_labels or t in STUBS or t in TO_C:
            return t
        op, _, args = c.partition(' ')
        if t in addr and is_branch(op) and target(op, args) == t:
            sys.exit(f'lift: branch out of the lifted code: {c}')
        if t in sets and t not in addr:
            v = sets[t]
            return ram_ref(v) if RAM_LO <= v < RAM_HI else t
        if t in addr:
            v = addr[t]
            if RAM_LO <= v < RAM_HI:
                return ram_ref(v)
            if ROM_LO <= v < ROM_HI:
                notes.setdefault('rom', set()).add(t)
                return t
            notes.setdefault('num', set()).add(f'{t}=0x{v:X}')
            return f'0x{v:X}'
        if REG.match(t) or t.startswith('.'):
            return t
        sys.exit(f'lift: unknown symbol {t} in: {c}')

    out, prev = [], None
    for i in order:
        if i != prev:
            out.append('                .align  4')
        out.append(name_at[i] + ':')
        for c in INSERT.get(name_at[i], ()):
            out.append(c if c.endswith(':') else f'                {c}')
        for c in INSERT_LIFTED.get(name_at[i], ()):
            op, _, args = c.partition(' ')
            args = TOKEN.sub(lambda mm: fix_token(mm.group(0), c), args.strip())
            args = NUM.sub(lambda mm: ram_ref(int(mm.group(0), 16)), args)
            out.append(f'                {op:<7} {args}'.rstrip())
        if name_at[i] in SELF_REL:
            lo = addr[name_at[i]]
            hi = min(v for v in addr.values() if v > lo)
            for o in range(lo, hi, 4):
                w = int.from_bytes(rom[o:o + 4], 'little')
                v = f'{name_at[i]}+0x{w - lo:X}' if lo <= w < hi else f'0x{w:X}'
                out.append(f'                .long   {v}')
            prev = nxt_start[i]
            continue
        for c in lines(i)[0]:
            parts = c.split(None, 1)
            op, args = parts[0], (parts[1] if len(parts) > 1 else '')
            if not op.startswith('.asci'):
                args = TOKEN.sub(lambda mm: fix_token(mm.group(0), c), args)
            args = NUM.sub(lambda mm: ram_ref(int(mm.group(0), 16)), args)
            out.append(f'                {op:<7} {args}'.rstrip())
        prev = nxt_start[i]

    # The RAM StF's routines name: blocks of the board's .bss.
    for lo, hi in RAM_SPANS:
        for v in range(lo, hi, RAM_PAD // 2):
            ram[v] = True
        ram[hi - 1] = True
    blocks = []
    for v in sorted(ram):
        if blocks and v - blocks[-1][1] < RAM_PAD:
            blocks[-1][1] = v
        else:
            blocks.append([v & ~0xF, v])
    blocks = [(lo, (hi + RAM_PAD + 0xF) & ~0xF) for lo, hi in blocks]
    def ram_sym(v):
        for lo, hi in blocks:
            if lo <= v < hi:
                return f'stf_ram_{lo:06X}+0x{v - lo:X}'
        raise AssertionError(v)

    text = '\n'.join(out)
    text = re.sub(r'STFRAM_([0-9A-F]{6})', lambda mm: ram_sym(int(mm.group(1), 16)), text)

    S = []
    S.append('# Generated by tools/lift-stf.py from stfdisasm: do not edit.')
    S.append('# Sonic the Fighters\' motion routines, lifted for the board build.')
    S.append('')
    for t in sorted(notes.get('rom', ())):
        S.append(f'                .set    {t}, 0x{addr[t]:X}')
    for t, _, _ in GUESTS:
        S.append(f'                .set    guest_{t}, 0x{guest_at[t]:X}')
    for g, v in GAMES:
        S.append(f'                .set    GAME_{g}, {v}')
    for t in sorted({t for t in sets if TOKEN.search(t)} & set(re.findall(TOKEN, text)) - set(addr)):
        if not (RAM_LO <= sets[t] < RAM_HI):
            S.append(f'                .set    {t}, 0x{sets[t]:X}')
    S.append('')
    S.append('                .text')
    S.append('                .align  4')
    for f in ROOTS:
        S.append(f'                .globl  {f}')
    S.append(text)
    S.append('')
    S.append('# ---- StF routines the board leaves out')
    for f in STUBS:
        S.append(f'{f + ":":<24}ret')
    S.append('')
    S.append('# ---- StF routines the board\'s C does: g0..g7, g13 and g14 kept')
    for f, c in TO_C.items():
        S.append(f'{f}:')
        for l in ['movq    g0, r4', 'movq    g4, r8', 'mov     g13, r12', 'mov     g14, r13', 'mov     0, g14',
                  f'call    {c}', 'movq    r4, g0', 'movq    r8, g4', 'mov     r12, g13', 'mov     r13, g14', 'ret']:
            S.append(f'                {l}')
    S.append('')
    S.append('# ---- StF\'s RAM, in the board\'s')
    S.append('                .section .bss')
    for lo, hi in blocks:
        S.append('                .align  4')
        S.append(f'                .globl  stf_ram_{lo:06X}')
        S.append(f'stf_ram_{lo:06X}: .space 0x{hi - lo:X}')
    S.append('')
    S.append('# ---- StF\'s ROM tables at their own addresses')
    # The move tables' inline code branches to the lifted tail instead.
    image = bytearray(rom[ROM_LO:ROM_HI].ljust(ROM_HI - ROM_LO, b'\xff'))
    # Fighting Vipers' armour (docs/BOARD.md): a motion whose setup has
    # kind2 bit 5 (head byte 4, 0x20; set_mot_dat puts it in +0x70C) breaks
    # a damaged piece, damage_unit's test. FV flags its heavy hits by hand
    # and no StF motion has it: StF's strikes of ARMOUR_BREAK or more (30
    # of its 209; FV flags one in ten of its strikes) get it.
    u32 = lambda o: int.from_bytes(rom[o:o + 4], 'little')
    for i in range(MOTIONS):
        rec = u32(MOTION_SETUPS + i * 4)
        if not ROM_LO <= rec < ROM_HI:
            continue
        p = rec + SETUP_HEAD
        while rom[p] not in (0, 8) and rom[SETUP_LENGTHS + rom[p]]:
            if rom[p] == 4:
                if rom[p + 3] >= ARMOUR_BREAK:
                    image[rec + 4 - ROM_LO] |= 0x20
                break
            p += rom[SETUP_LENGTHS + rom[p]]
    image = bytes(image)
    patches = []
    for o in range(0, len(image), 4):
        w = int.from_bytes(image[o:o + 4], 'little')
        disp = w & 0xFFFFFC
        prev = int.from_bytes(image[o - 4:o], 'little') >> 16
        if w >> 24 == 0x08 and ROM_LO + o + disp - 0x1000000 == tail_at and prev in (0x8C80, 0x5C80):
            patches.append(o)                       # after `lda N, g0` or `mov N, g0`
    if not patches:
        sys.exit(f'lift: no branches to {tail} in the move tables')
    # A branch can't leave the section: they go through `bx` in the ROM's
    # free space past StF's last table.
    used = len(image.rstrip(b'\xff'))
    tramp = (used + 0xF) & ~0xF
    S.append('                .section .stfrom,"a"')
    at = 0
    for o, ins in sorted([(o, f'b       {tail}_far') for o in patches] + [(tramp, f'bx      {tail}')]):
        S.append(f'                .incbin "{ROM_BIN}", 0x{at:X}, 0x{o - at:X}')
        if ins.startswith('bx'):
            S.append(f'{tail}_far:')
        S.append(f'                {ins}')
        at = o + (8 if ins.startswith('bx') else 4)
    S.append(f'                .incbin "{ROM_BIN}", 0x{at:X}')
    S.append('')
    open(os.path.join(a.out, 'stf_motion.s'), 'w').write('\n'.join(S))
    open(os.path.join(a.out, ROM_BIN), 'wb').write(image)

    H = []
    H.append('/* Generated by tools/lift-stf.py: do not edit. */')
    H.append('#ifndef STF_MOTION_H')
    H.append('#define STF_MOTION_H')
    H.append('')
    H.append('/* StF\'s motion routines (stf_motion.s), under their own names (no C')
    H.append(' * underscore): call them with stf_call, which sets up StF\'s registers. */')
    for f in ROOTS:
        H.append(f'extern void stf_{f}(void) __asm__("{f}");')
    H.append('')
    H.append('/* The tables the routines read a guest fighter\'s entries from, in the')
    H.append(' * data ROM (tools/import-assets.mjs writes them), and the guests\' heap;')
    H.append(' * _SRC and _LEN: StF\'s own table, which they start as. */')
    for t, _, n in GUESTS:
        H.append(f'#define STF_GUEST_{t} 0x{guest_at[t]:08X}u')
        H.append(f'#define STF_GUEST_{t}_SRC 0x{addr[t] if t in addr else sets.get(t, 0):08X}u')
        H.append(f'#define STF_GUEST_{t}_LEN 0x{n:X}u')
    H.append(f'#define STF_GUEST_HEAP 0x{guest_heap:08X}u')
    H.append('/* STF_GUEST_char_game\'s values: the game a character comes from. */')
    for g, v in GAMES:
        H.append(f'#define GAME_{g} {v}u')
    H.append('/* The move tables\' inline code goes on here (`bx`, from anywhere). */')
    H.append(f'#define STF_NATIVE_TAIL_FAR 0x{ROM_LO + tramp:05X}u')
    H.append('')
    H.append('/* The board\'s copy of StF\'s RAM the routines use. */')
    for lo, hi in blocks:
        H.append(f'extern u8 stf_ram_{lo:06X}[0x{hi - lo:X}] __asm__("stf_ram_{lo:06X}");')
    H.append('static inline void *stf_ram(u32 a) {')
    for lo, hi in blocks:
        H.append(f'    if (a >= 0x{lo:06X}u && a < 0x{hi:06X}u) return stf_ram_{lo:06X} + (a - 0x{lo:06X}u);')
    H.append('    return (void *)0;')
    H.append('}')
    H.append('')
    H.append('#endif')
    open(os.path.join(a.out, 'stf_motion.h'), 'w').write('\n'.join(H) + '\n')

    for i in order:
        print(f'  {name_at[i]:<28} <- {why[i]}')
    print(f'stubs: {" ".join(STUBS)}')
    print(f'move-table branches to {tail}: {len(patches)}')
    print(f'ram blocks: {" ".join(f"{lo:06X}..{hi:06X}" for lo, hi in blocks)}')
    print(f'rom tables: {" ".join(sorted(notes.get("rom", ())))}')
    print(f'guest tables: {" ".join(sorted(notes.get("guest", ())))}')
    print(f'labels made numbers: {" ".join(sorted(notes.get("num", ())))}')


if __name__ == '__main__':
    main()
