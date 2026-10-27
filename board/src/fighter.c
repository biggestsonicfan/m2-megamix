/*
 * fighter.c — StF's fighters and the fight: the task blocks StF's lifted
 * code runs on (the robs, the camera, the collision, effect, projectile and
 * display tasks), the globals it reads (stf_globals), a rob's setup for a
 * round (rob_init, rob_start), a 60 Hz frame of the fight (fight_step), a
 * round's start (round_start), the HUD and the boot state two linked boards
 * both start from (boot_state).
 */
#include "megamix.h"

/* ---- StF's fighters ----
 *
 * A fighter is StF's rob: its 0x3400-byte block, which StF's motion code
 * (stf_motion.s) reads and writes through g7, the other fighter's through g8.
 * rob.h names its fields, by the names StF's debug mode gives them. A real
 * fight's flag word is 0x84000080 (player 2: 0x84000082): the task runs,
 * smooth_switch, init_end, and disp_left_look for player 2. The motion
 * record is StF's at 0x520000 + 0x7C8 p; the board has its own.
 */
/* 16-byte aligned, as StF's are: its code moves them in triple and quad words. */
u32 robs[2][ROB_SIZE / 4] __attribute__((aligned(16)));
u32 mots[2][MOT_SIZE / 4] __attribute__((aligned(16)));
/* What StF's globals point at: the camera (fa_camera, whose +0x18 position
 * and +0x26 yaw get_frame_dat reads to turn a fighter's face), and the
 * replay record and object set_mot_dat reads in a replay. */
u32 stf_cam[0x500 / 4] __attribute__((aligned(16)));
u32 stf_rec[0x40] __attribute__((aligned(16))), stf_obj0[0x40] __attribute__((aligned(16)));
/* FV's replay of an armour break (rep_start): its task, whether it runs,
 * the camera's mode, each fighter's kind2 a frame ago */
/* The other task blocks StF's fight code reaches through its globals, the
 * sizes they have on a real board: the collision task (mod_fa_coli), the
 * effects (mod_fa_effect), the projectiles (mod_fa_tobi), the CPU players
 * (mod_fa_enemy0, _1; the board has none, but get_game_info runs on
 * player 1's) and the game's settings
 * (add_BACKUP_RAM_TO_RAM). */
u32 stf_coli[0x400 / 4] __attribute__((aligned(16)));
u32 stf_effect[0xC80 / 4] __attribute__((aligned(16)));
u32 stf_tobi[0x2000 / 4] __attribute__((aligned(16)));
u32 stf_enemy[2][0x280 / 4] __attribute__((aligned(16)));
u32 stf_disp[0x100 / 4] __attribute__((aligned(16)));   /* game_disp's task block */
/* The sway chains (Honey's ponytail, Fang's tail): StF's tasks fa_osage0
 * and fa_osage1 (mod_fa_osage0_1, mod_fa_osage0_2), one a player, 0x280
 * bytes. osage_init reads the fighter's chains (osage_per_character, by
 * +0x1B0) and becomes osage_dsp, which steps them on the coprocessor
 * (Fn_osage, 0x4A, on its records in bufferram at 0x91E800 and 0x91F000)
 * and draws them, in a block of the list that draw_fighter splices in. */
u32 stf_osage[2][0x280 / 4] __attribute__((aligned(16)));


/* A task block as a task starts: cleared, alive, its size. */
void task_reset(u32 *t, u32 size) {
    u32 i;
    for (i = 0; i < size / 4u; i++) t[i] = 0u;
    RW(t, TASK_FLAG) = TASK_ALIVE;
    RW(t, TASK_SIZE) = size;
}

/* CHAR_PARTS: each character's record (+0 its part models, +0xC its
 * motions), in the guest table (StF's, with the guests' records in). */
const u32 *stf_char(u32 c) { return *(const u32 *const *)(STF_GUEST_CHAR_PARTS + c * 4u); }

/* The game character c comes from (GAME_STF, GAME_VF2, GAME_FV): its byte in
 * the guest table char_game, which tools/vf2-guest.mjs sets for its guests
 * (StF's own are 0). What treats another game's fighter its own way
 * branches on it: here, and in stf_motion.s (lift-stf.py's INSERT). */
u32 char_game(u32 c) { return *(const u8 *)(STF_GUEST_char_game + c); }
const char *const game_name[] = { "STF", "VF2", "FV" };

/* pose_anims is poses.h's (static, baked): the one copy lives here */
const pose_anim_t *pose_anim(u32 n) { return &pose_anims[n]; }

/* The rest of the globals StF's fight code reads, as a real board has them
 * in the attract mode's fight (its RAM read in MAME, 70 s after power-on):
 * the rounds, the energy, the game's settings, the collision and camera
 * constants. A word sets the fields up to the next one; those no name is
 * known for keep their addresses. */
static const u32 stf_fight_ram[] = {
    G_GAMEPROGRAM,      0x00000002u,
    G_JUDGE,            0x00020000u,   /* num_rounds_to_win 2 */
    G_STAGE_ID,         0x00000001u,
    G_STAGE,            0x01000001u,
    G_NOT_SCR_BG_MOVE,  0x8400442Cu,
    G_TIME,             0x0000001Eu,   /* 30, replay_countdown 0 */
    G_RANDOM,           0xDD47A900u,
    G_ENERGY_MAX,       0x0000008Cu,   /* 140 */
    G_CAGE_HEIGHT,      0x409EB852u,   /* 4.96 */
    0x501024u,          0x3E6789E7u,
    0x501500u,          0x0000014Fu,
    0x504068u,          0x00040000u,
    0x504078u,          0x00A00003u,
    0x506000u,          0x3C23D70Au,   /* the balls' tables (rob_balls) */
    0x506200u,          0xBD4CCCCDu,
    0x506440u,          0x000CC700u,
    0x506580u,          0x00000001u,
    0x506600u,          0x00000001u,
    G_MODEL_SCALE,      0x3F800000u,   /* 1, 1, 1 */
    G_MODEL_SCALE + 4u, 0x3F800000u,
    G_MODEL_SCALE + 8u, 0x3F800000u,
    G_GRAVITY,          0x3CCE9ED5u,
    0x50A004u,          0x3F800000u,
    0x50A008u,          0x41200000u,
    G_STAGE_X,          0x41000000u,   /* 8.0 */
    G_STAGE_SOKO,       0xC2C80000u,   /* -100.0 */
    G_LIMIT_XANG,       0x02003600u,   /* nagerenai_timer 0, attack_base 2 */
    G_DEBUG_NUMBER,     0x08060000u,   /* both NORMAL_MODE, rise_base 6, precede_inp_time 8 */
    G_GUARD_LIMIT,      0x0580001Eu,   /* 30, combo_sub 0x80 */
    G_COMBO_START - 2u, 0x00030000u,   /* combo_start 3 */
    G_COMBO_LIMIT,      0x00000800u,
    G_NO_COLI_LOW,      0x3F800000u,
    0x50A204u,          0x3EAE978Du,
    0x50A284u,          0x40000000u,   /* the balls' tables */
    0x50A288u,          0x0000001Eu,
    0x50A28Cu,          0x3E916873u,
    0x50A30Cu,          0x40000000u,
    0x50A310u,          0x0000001Eu,
    G_COPRO_ADR,        0x00030600u,
    0x50A324u,          0x3EAE978Du,
    G_ZANZOU_MA,        0x3DCCCCCDu,   /* 0.1 */
    G_BARRIER_DEFAULT,  0x00000005u,
    0x50A800u,          0x3F800000u,   /* list_90_floats_RAM */
    0x50E000u,          0xBDB914C0u,
    0x50E01Cu,          0x45BA174Fu,
    0x50E028u,          0x463C2F12u,
    0x50E034u,          0xC1BEFFE8u,
    0x50FE00u,          0x02008000u,
    0x530004u,          0x0000007Fu,
};

/* StF's globals as they are in a 2-player fight (a real board's RAM at a
 * fight's start): the modes, the task blocks, the debug flags. */
void stf_globals(void) {
    u32 i;
    for (i = 0; i < sizeof stf_fight_ram / sizeof stf_fight_ram[0]; i += 2)
        RAM32(stf_fight_ram[i]) = stf_fight_ram[i + 1];
    RAM32(G_GAME_TIMER) = 0x09090000u;     /* game_timer 0, mode 9, also_mode 9 */
    RAM32(G_MODE_FLAG) = 0x200u;
    RAM32(G_SUB_MODE) = 0x0909u;           /* _sub_mode, also_sub_mode */
    RAM32(G_SUB_MODE + 4u) = 0x200u;
    RAM32(G_FA_ROB0) = (u32)robs[0];
    RAM32(G_FA_ROB1) = (u32)robs[1];
    RAM32(G_BACKUP_RAM_PTR) = (u32)stf_ram(G_BACKUP_RAM);
    RAM32(G_FA_COLI) = (u32)stf_coli;
    RAM32(G_FA_GAME_DISP) = (u32)stf_disp;
    RAM32(G_FA_ENEMY0) = (u32)stf_enemy[0];
    RAM32(G_FA_ENEMY1) = (u32)stf_enemy[1];
    RAM32(G_FA_EFFECT) = (u32)stf_effect;
    RAM32(G_FA_OSAGE0) = (u32)stf_osage[0];
    RAM32(G_FA_OSAGE1) = (u32)stf_osage[1];
    RAM32(G_POLYGON_LIMIT) = 5000u;        /* as change_scene sets it */
    RAM32(G_FA_TOBI) = (u32)stf_tobi;
    RAM32(G_FA_CAMERA) = (u32)stf_cam;
    RAM32(G_FA_RECORD) = (u32)stf_rec;
    RAM32(G_FA_OBJ0) = (u32)stf_obj0;
    RAM32(G_DEBUG_FLAG) = 0x18A00u;
}

/* A fighter's rob, as StF sets one up for a round: player p, at (x, 0, 0)
 * with its yaw, playing the stance from its first frame. */
/* Each fighter's collision-ball tables (+0x1D00..0x1D20), as a game mode's
 * start sets them (ADV_CPU_BATTLE_INT): radii, scales, the ball positions
 * and the part each ball rides; cop_initialize_end2 fills them. */
static const u32 rob_balls[2][9] = {
    { 0x50A208u, 0x50A284u, 0x50A288u, 0x506000u, 0x506400u, 0x506480u, 0x506580u, 0x506680u, 0x5066C0u },
    { 0x50A290u, 0x50A30Cu, 0x50A310u, 0x506200u, 0x506440u, 0x506500u, 0x506600u, 0x5066A0u, 0x5066D0u },
};

void rob_init(u32 p, const fighter_t *f) {
    u32 *r = robs[p];
    union { float f; u32 u; } x;
    u32 i;
    for (i = 0; i < ROB_SIZE / 4; i++) r[i] = 0u;
    for (i = 0; i < MOT_SIZE / 4; i++) mots[p][i] = 0u;
    x.f = f->x;
    RW(r, ROB_FLAG) = p ? 0x84000082u : 0x84000080u;
    RB(r, ROB_IDNM) = (u8)p;
    RW(r, TASK_SIZE) = ROB_SIZE;
    RW(r, TASK_FN) = (u32)stf_action_init;
    RW(r, ROB_CONTROL) = 1u << 3;        /* control_init: the pad drives it */
    RW(r, ROB_XPOS) = x.u;
    RH(r, ROB_YANG) = f->yaw;
    RB(r, ROB_CHAR) = (u8)(f->anim->chr + (p ? 26u : 0u));
    RB(r, ROB_CHAR_IS) = (u8)f->anim->chr;
    RW(r, ROB_CHAR_REC) = (u32)stf_char(RB(r, ROB_CHAR));
    RW(r, ROB_CHAR_MOTS) = stf_char(RB(r, ROB_CHAR))[3];
    for (i = 0; i < 9u; i++) RW(r, ROB_BALLS + 4u * i) = (u32)stf_ram(rob_balls[p][i]);
    RB(r, ROB_SKELTON_TYPE) = 0xFFu;
    RW(r, ROB_MOT_REC) = (u32)mots[p];
    RW(r, ROB_Y_SCALE) = 0x3F800000u;
    /* The dent pendulums, as the round's start sets them (sub_89BF8 with
     * zero angles): unit scale, then the countdown camera_init runs down
     * each frame; dented_cnt only swings them while it is not negative. */
    for (i = 0; i < 3u; i++) {
        RW(r, ROB_DENT_SCALE + 4u * i) = 0x3F800000u;
        RW(r, ROB_DENT_SCALE2 + 4u * i) = 0x3F800000u;
    }
    RW(r, ROB_DENTED_CNT) = 0u;
}

/* A fighter's first frame: both fighters' collision balls to the
 * coprocessor (cop_initialize_end2, which also clears their active bits),
 * both bodies' pendulums (sub_7F0E8), then the fighter's task from
 * action_init, which sets up its moves and plays the stance. Its sway
 * chains start over, as a round's start starts them: the task is
 * osage_init again. */
void rob_start(u32 p) {
    u32 w0[2] = { RW(robs[0], ROB_FLAG), RW(robs[1], ROB_FLAG) };
    stf_call(stf_cop_initialize_end2, robs[0], robs[1], 0u);
    kage_balls();
    RW(robs[0], ROB_FLAG) = w0[0]; RW(robs[1], ROB_FLAG) = w0[1];
    stf_call(stf_sub_7F0E8, robs[0], robs[1], 0u);
    stf_task((void (*)(void))RW(robs[p], TASK_FN), robs[p], robs[p], robs[p ^ 1u]);
    task_reset(stf_osage[p], sizeof stf_osage[p]);
    RB(stf_osage[p], TASK_IDNM) = (u8)p;
    RW(stf_osage[p], TASK_FN) = (u32)stf_osage_init;
}

/* One 60 Hz frame of StF's fight, its tasks in a real board's order:
 * rob_control (each player's pad to the fighter's +0x1200, then sub_1D47C,
 * which reads the moves the pad makes), each fighter's task (rob_action: the
 * commands, the action, the motion, the part matrices), the collision task
 * (hits, damage, the walls), then get_game_info (each fighter's angle and
 * distance to the other, which it turns by). The pad is StF's: punch 1, kick 2, guard
 * 4, down 0x10, up 0x20, right 0x40, left 0x80. */
void fight_step(const u32 pad[2]) {
    u32 p;
    if (GAME_TIMER > 0) GAME_TIMER--;
    RAM8(G_SOUNDS) = 0u;                 /* GAME_DSP's: the sounds the recorder keeps, from none */
    RAM32(G_SW_HELD) = pad[0] << 8 | pad[1] << 16;
    for (p = 0; p < 2u; p++) RW(robs[p], ROB_DENTED_CNT)--;  /* camera_init's sub_7F5CC */
    for (p = 0; p < 2u; p++) {
        RB(robs[p], ROB_PAD) = (u8)pad[p];
        /* g13 the rob too: the command interpreter keeps its base there */
        stf_task(stf_sub_1D47C, robs[p], robs[p], robs[p ^ 1u]);
    }
    for (p = 0; p < 2u; p++)
        stf_task((void (*)(void))RW(robs[p], TASK_FN), robs[p], robs[p], robs[p ^ 1u]);
    stf_task((void (*)(void))RW(stf_coli, TASK_FN), stf_coli, robs[0], robs[1]);
    stf_task((void (*)(void))RW(stf_effect, TASK_FN), stf_effect, robs[0], robs[1]);
    stf_task(stf_get_game_info, stf_enemy[0], robs[0], robs[1]);
    stf_task(stf_cam_mode_10, stf_cam, robs[0], robs[1]);
    /* the camera's frame count, which StF's camera_init (os display) moves
     * on each frame: a throw's camera script (sub_6BA98) steps to its next
     * key when the count reaches the key's frame; left still, every key ran
     * past its end and the camera flew off */
    RH(stf_cam, CAMERA_CNT)++;
    /* the projectile task (fa_tobi's sub_89FB8): sub_8A29C steps each live
     * object (Eggman's bombs: fly, burst, the hit test whose hit the next
     * frame's collision task deals); sub_8A2E4 is left out (it tells StF's
     * CPU players where a bomb will burst, and the board has none); then
     * the afterimages */
    stf_task(stf_sub_8A29C, stf_tobi, robs[0], robs[1]);
    stf_call(stf_zanzou_control, robs[0], robs[1], 0u);
    /* GAME_DSP's trail: each fighter's place on the ground, kept for the
     * last 8 frames, where kira_kira_disp puts hyper mode's sparkles */
    for (p = 0; p < 2u; p++) {
        u32 at = RW(robs[p], ROB_TRAIL_AT), k;
        RW(robs[p], ROB_TRAIL_AT) = (at + 1u) & 7u;
        for (k = 0; k < 3u; k++) RW(robs[p], ROB_TRAIL + at * 12u + k * 4u) = RW(robs[p], ROB_GXPOS + k * 4u);
    }
    /* the replay's recorder (fa_record): both fighters' frame in the ring */
    stf_task(stf_rec_disp, stf_rec, robs[0], robs[1]);
}

/* A round: both fighters back to their marks, the collision task, the
 * clock at StF's 30 seconds (MES_READY_INT: time << 6; the collision task
 * only deals damage while it runs). */
u32 round_time = 30u;             /* seconds, the setup menu's time */


#define COP_ZANZOU_INIT COP_CMD(0x81)

/* next: the match's next round, the armour as the last one left it */
void round_start(fighter_t fs[2], u32 next) {
    u32 i;
    stage_round_start();
    for (i = 0; i < 2u; i++) {
        if (next) armour_keep(i);
        /* at yaw a a fighter faces (-sin a, cos a) in x, z, as StF's
         * camera does: 4.0 apart, facing each other, as a real fight starts */
        fs[i].x = i ? 2.0f : -2.0f;
        fs[i].yaw = i ? 0x4000u : 0xC000u;
        rob_init(i, &fs[i]);
    }
    task_reset(stf_coli, sizeof stf_coli);
    stf_task(stf_coli_init, stf_coli, robs[0], robs[1]);
    /* the projectile task, as fa_tobi starts it: the afterimage ring reset
     * (Fn_zanzou_init) and its 30 objects (0x100 bytes each from +0x200)
     * cleared, so no bomb lives on into the next round */
    *(volatile u32 *)M2_COPFIFO_ADDR = COP_ZANZOU_INIT;
    task_reset(stf_tobi, sizeof stf_tobi);
    for (i = 0; i < 2u; i++) {
        rob_start(i);
        armour_limits(i);
        if (next) armour_back(i);
    }
    /* the effect task, as fa_effect starts it (efc_ram_init: no sparks,
     * smoke or barrier pieces left from the last round), then efc_cont */
    task_reset(stf_effect, sizeof stf_effect);
    stf_task(stf_fa_effect, stf_effect, robs[0], robs[1]);
    /* the scattered rings: none (ring_tobitiri_init, as the battle's start runs it) */
    stf_call(stf_ring_tobitiri_init, robs[0], robs[1], 0u);
    /* the spin attack's models, pulse and drop for both (sub_81038, as
     * StF's battle modes run it before a round) */
    stf_call(stf_sub_81038, robs[0], robs[1], 0u);
    stf_task(stf_cam_mode_9, stf_cam, robs[0], robs[1]);
    GAME_TIMER = (short)(round_time << 6);
    /* stage_x (0x50A00C), the half side of the square area_coli walls the
     * fighters in: StF's cage at 8.0; VF2's ring has no walls, so out of
     * reach (100.0), and the ring out (ring_out_step) at the ring's edge;
     * FV's cage at its own size (FV's 6.0, scaled) */
    RAM32(G_STAGE_X) = cur_stage && m2_obj_fb(cur_stage->ring) ? 0x42C80000u :
                       cur_stage && m2_obj_fb(cur_stage->wall) ? m2_obj_fb(cur_stage->wall) : 0x41000000u;
    ring_out_reset();
    /* no replay, the recorder from the ring's start */
    rep_round();
    RW(stf_rec, REC_NEXT) = 0u;
    /* back to the fight from the last round's judging (ko_disp's K.O. off;
     * its size and turn, stf_disp +0x94 and +0x98, cleared below) */
    RAM8(G_SUB_MODE + 1u) = SUB_FIGHT_DSP;
    RAM8(G_JUDGE) = 0u;
    /* the HUD, as MES_ROUND_INT and MES_READY_INT leave it: both bars
     * from empty, the lamps (clear_win_lamp_cntr's, then win_lamp_int);
     * and MES_FIGHT_INT's barrier boxes (barrier_left_disp_init: each
     * side's box, BARRIER and a chevron a barrier left, or NO BARRIER) */
    for (i = 0; i < sizeof stf_disp / 4; i++) stf_disp[i] = 0u;
    RW(stf_disp, TASK_FLAG) = 0x84800000u;
    for (i = 0; i < 10u; i++) {
        RB(stf_disp, DISP_LAMP0 + i) = i < 5u ? 0x3Fu : 4u;
        RB(stf_disp, DISP_LAMP1 + i) = i < 5u ? 0x3Fu : 4u;
    }
    stf_call(stf_win_lamp_int, robs[0], robs[1], 0u);
    stf_task(stf_barrier_left_disp_init, stf_disp, robs[0], robs[1]);
    armour_hud_load();
}

/* StF's HUD, game_display_cont's part of it: the energy bars, the
 * barriers left, the clock and the round lamps, in StF's own tiles; then
 * the armour, in FV's. */
void hud_draw(void) {
    stf_task(stf_energy_disp, stf_disp, robs[0], robs[1]);
    stf_task(stf_energy_disp, stf_disp, robs[1], robs[0]);
    stf_task(stf_barrier_left_disp, stf_disp, robs[0], robs[1]);
    stf_task(stf_time_dsp, stf_disp, robs[0], robs[1]);
    stf_task(stf_win_lamp_dsp, stf_disp, robs[0], robs[1]);
    armour_hud();
}

/* The fight's state as the boot leaves it: StF's RAM (lift-stf.py lays its
 * blocks out in one run, stf_ram_500000 to the end of stf_ram_599000) and
 * the task blocks its code keeps. Two boards that link both start again from
 * it, whatever each ran before: StF's code keeps state from past fights where
 * a round's start leaves it (the recorder, the CPU players' info, the
 * camera's, the hit sparks' positions). */
static u32 boot_ram[0x18000u / 4];
static u32 boot_blocks[(sizeof robs + sizeof mots + sizeof stf_cam + sizeof stf_rec + sizeof stf_obj0 +
                        sizeof stf_play + sizeof stf_coli + sizeof stf_effect + sizeof stf_tobi +
                        sizeof stf_enemy + sizeof stf_disp + sizeof stf_osage) / 4];

void boot_state(u32 save) {
    u32 *const blk[] = { robs[0], mots[0], stf_cam, stf_rec, stf_obj0, stf_play, stf_coli,
                         stf_effect, stf_tobi, stf_enemy[0], stf_disp, stf_osage[0], (u32 *)stf_ram_500000 };
    const u32 len[] = { sizeof robs, sizeof mots, sizeof stf_cam, sizeof stf_rec, sizeof stf_obj0,
                        sizeof stf_play, sizeof stf_coli, sizeof stf_effect, sizeof stf_tobi,
                        sizeof stf_enemy, sizeof stf_disp, sizeof stf_osage,
                        (u32)(stf_ram_599000 + sizeof stf_ram_599000 - stf_ram_500000) };
    u32 b, i, *k = boot_blocks;
    for (b = 0; b < sizeof len / sizeof len[0]; b++) {
        if (b == sizeof len / sizeof len[0] - 1u) {
            k = boot_ram;
            while (len[b] > sizeof boot_ram) ;   /* StF's RAM outgrew boot_ram: make it bigger */
        }
        for (i = 0; i < len[b] / 4u; i++, k++) {
            if (save) *k = blk[b][i];
            else blk[b][i] = *k;
        }
    }
}
