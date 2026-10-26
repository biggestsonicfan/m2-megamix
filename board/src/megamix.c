/*
 * megamix.c — Fighters Megamix on the Sonic the Fighters board (Model 2B).
 *
 * A new program for the board, built on m2-sdk. Sonic the Fighters' program is
 * the map: its data ROMs stay on the board, and its own motion code poses the
 * fighters: set_motion, calc_rob_angle and calc_unit_mat, lifted from StF's
 * program into src/stf_motion.s by tools/lift-stf.py. calc_unit_mat leaves one
 * part matrix per slot on the coprocessor, and each part is drawn from its
 * slot (op 0x37) with op 0x78, the object path m2_obj.h proves on the real
 * geometrizer.
 *
 * This draws two fighters in their stance on an StF stage. The stage draw
 * lists, the eye models and the colour runs come from tools/bake-board.mjs
 * (src/poses.h).
 */
#include "m2.h"
#include "m2_obj.h"
#include "stf_tex_codec.h"   /* the SDK's, with room for StF's stage sets */
#include "poses.h"
#include "stf_motion.h"
#include "rob.h"

#define FOCUS 280.0f

/* StF's texture sets: 1 holds the fighters, uploaded with every stage. */
#define SET_FIGHTERS 1u

typedef struct { float r[9], t[3]; } mat_t;   /* column-major, the COP's layout */

/* The faces of every object submitted since it was last zeroed: the high
 * half of the model's header word 3 (obc), its face count, the low half
 * its link count (culled links too), which StF's POLYGON sums instead
 * (set_obj_go). The setup menu shows both (poly_win_draw). */
static u32 polys;

/* Submit one model-table object under the matrix m (model -> camera). With
 * ov nonzero, word ow of the model's header (0 its texture points, 1 its
 * texture headers) is ov instead, as set_obj_tpd and set_obj_thd do. */
static void submit_mat_ov(u32 model, const mat_t *m, u32 ow, u32 ov) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    volatile const u32 *mh = (volatile const u32 *)(M2_MODEL_TABLE + model * 16u);
    u32 hdr[4];
    int i;
    for (i = 0; i < 4; i++) hdr[i] = mh[i];
    if (ov) hdr[ow] = ov;
    polys += hdr[3] >> 16;
    *cf = COP_WMATRIX;
    for (i = 0; i < 9; i++) *cf = m2_obj_fb(m->r[i]);
    for (i = 0; i < 3; i++) *cf = m2_obj_fb(m->t[i]);
    *cf = COP_FADD; *cf = COP_FADD; *cf = COP_FADD;              /* fence, as m2_obj_submit */
    cop_drain(cf, 1u);
    { u32 wr = *(volatile u32 *)COP_WPOS_REG;
      *(volatile u32 *)GEO_WRITE_REG = wr + 0x48u;
      *cf = COP_SUBMIT; *cf = wr; *cf = 0u;
      *cf = hdr[0]; *cf = hdr[1]; *cf = hdr[2]; *cf = hdr[3];
      *cf = g_cop_p2; *cf = g_cop_p;
      g_cop_p2 = *cf; g_cop_p = *cf;
      { u32 ep = *(volatile u32 *)COP_WPOS_REG;
        *(volatile u32 *)(GEO_BUFFERRAM + (ep & 0x0001FFFCu)) = GEO_OP_END; } }
}

static void submit_mat(u32 model, const mat_t *m) { submit_mat_ov(model, m, 0u, 0u); }

/* The same under the coprocessor's current matrix (ow 2: word 2, the
 * object's address, as the midriff's in polygon RAM). */
static void submit_cur_ov(u32 model, u32 ow, u32 ov) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    volatile const u32 *mh = (volatile const u32 *)(M2_MODEL_TABLE + model * 16u);
    u32 hdr[4];
    int i;
    for (i = 0; i < 4; i++) hdr[i] = mh[i];
    if (ov) hdr[ow] = ov;
    polys += hdr[3] >> 16;
    *cf = COP_FADD; *cf = COP_FADD; *cf = COP_FADD;
    cop_drain(cf, 1u);
    { u32 wr = *(volatile u32 *)COP_WPOS_REG;
      *(volatile u32 *)GEO_WRITE_REG = wr + 0x48u;
      *cf = COP_SUBMIT; *cf = wr; *cf = 0u;
      *cf = hdr[0]; *cf = hdr[1]; *cf = hdr[2]; *cf = hdr[3];
      *cf = g_cop_p2; *cf = g_cop_p;
      g_cop_p2 = *cf; g_cop_p = *cf;
      { u32 ep = *(volatile u32 *)COP_WPOS_REG;
        *(volatile u32 *)(GEO_BUFFERRAM + (ep & 0x0001FFFCu)) = GEO_OP_END; } }
}

static void submit_cur(u32 model) { submit_cur_ov(model, 0u, 0u); }

/* The camera: at (0, CAM_Y, CAM_Z) in StF's units (1.6 times the board's
 * world, whose stages are baked at StF's 1/1.6), looking along +z, pitched
 * down by an angle whose sine and cosine are CAM_S and CAM_C (8 degrees). */
#define CAM_Y 1.76f
#define CAM_Z (-7.36f)
#define CAM_S 0.139173f
#define CAM_C 0.990268f
#define STF_CAM_SCALE 0x3FCCCCCDu        /* 1.6 */
static mat_t cam, cam_l;                 /* cam_l: before the scale, for the light and the fighters */

/* camera_init's matrix, with the camera's turn already in the coprocessor:
 * set_pos by the negated position, then (after the light's copy) op 0x07
 * with 1.6, 1.6, 1.6, as StF sends it before it stores the camera. The
 * position is StF's eye, in fighter units, so a stage drawn on cam is
 * R (1.6 v - eye), as in StF. Every stage matrix is cam times its own; the
 * fighters are drawn on cam_l, as rob_disp draws them on the unscaled
 * camera (rob+0x2A40). */
static void camera_place(const float pos[3]) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    int i;
    *cf = COP_SET_POS;
    for (i = 0; i < 3; i++) *cf = m2_obj_fb(pos[i]) ^ 0x80000000u;
    *cf = COP_RMATRIX;
    for (i = 0; i < 9; i++) cam_l.r[i] = m2_cop_gf();
    for (i = 0; i < 3; i++) cam_l.t[i] = m2_cop_gf();
    *cf = COP_WMATRIX;
    for (i = 0; i < 9; i++) *cf = m2_obj_fb(cam_l.r[i]);
    for (i = 0; i < 3; i++) *cf = m2_obj_fb(cam_l.t[i]);
    *cf = COP_SCALE; *cf = STF_CAM_SCALE; *cf = STF_CAM_SCALE; *cf = STF_CAM_SCALE;
    *cf = COP_RMATRIX;
    for (i = 0; i < 9; i++) cam.r[i] = m2_cop_gf();
    for (i = 0; i < 3; i++) cam.t[i] = m2_cop_gf();
}

static void camera_at(const float pos[3], float sy, float cy, float sx, float cx) {
    /* about x by the angle whose sine and cosine are sx, cx (y' = c y - s z,
     * z' = s y + c z), after a turn about y by sy, cy */
    const float turn[9] = {
        cy, 0.0f, -sy,  sx * sy, cx, sx * cy,  cx * sy, -sx, cx * cy };
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    int i;
    *cf = COP_WMATRIX;
    for (i = 0; i < 9; i++) *cf = m2_obj_fb(turn[i]);
    for (i = 0; i < 3; i++) *cf = 0u;
    camera_place(pos);
}

static void camera_init(void) {
    static const float pos[3] = { 0.0f, CAM_Y, CAM_Z };
    camera_at(pos, 0.0f, 1.0f, CAM_S, CAM_C);
}

/* camera_init's light, in the camera's frame: on the coprocessor, the camera's
 * turn, then ang_y by VECTER_Y and ang_x by VECTER_X, and op 0x29 on
 * (0, 0, BRIGHT), from the camera before its scale. StF sends it to the geometrizer (slot 0xA0) before the stage
 * and, scaled by rob_light (1.0 but in a hit flash), before each fighter. It
 * is built every frame from the camera's turn (camera_stf), so it stays fixed
 * in the world as the camera moves. */
static float light[3];

/* StF's frame_counter; the frame loop copies it to 0x500020, where StF's
 * code (sub_2435C's colour cycling) reads it. */
static u32 frame_counter;
/* FV's turning town and its light count from the round start: 0xC568 puts
 * word_50A022 back to 0, so the town snaps home with the objects each round. */
static u32 turn_at;
/* the Western bear's pendulum (kuma_step) */
static int kuma_p, kuma_v;
static u32 kuma_at;

/* VF2's Colosseum storm (VF2 0x2468C), storm[] its four channels by frame:
 * while channel 3 is on, the arena is lit, each draw its lit twin and the
 * light the flash's. */
static u32 storm_lit(const stage_t *st) {
    return st->storm && (st->storm[frame_counter % FLASH_FRAMES] & 8u);
}

static void stage_light(const stage_t *st) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    u32 lit = storm_lit(st);
    int i;
    *cf = COP_WMATRIX;
    for (i = 0; i < 9; i++) *cf = m2_obj_fb(cam_l.r[i]);
    for (i = 0; i < 3; i++) *cf = 0u;
    /* FV's turning town turns its light with it (0x1EF94) */
    *cf = COP_ANG_Y; *cf = (u32)(int)(lit ? st->flash[2] : st->vy) + st->turn * (frame_counter - turn_at);
    *cf = COP_ANG_X; *cf = (u32)(int)(lit ? st->flash[1] : st->vx);
    m2_cop_m2w(0.0f, 0.0f, lit ? st->flash[0] : st->bright, light);
}

/* ---- StF's fighters ----
 *
 * A fighter is StF's rob: its 0x3400-byte block, which StF's motion code
 * (stf_motion.s) reads and writes through g7, the other fighter's through g8.
 * rob.h names its fields, by the names StF's debug mode gives them. A real
 * fight's flag word is 0x84000080 (player 2: 0x84000082): the task runs,
 * smooth_switch, init_end, and disp_left_look for player 2. The motion
 * record is StF's at 0x520000 + 0x7C8 p; the board has its own.
 */
#define ROB_SIZE  0x3400u
#define GAME_TIMER (*(short *)stf_ram(G_GAME_TIMER))   /* s16, the clock in 64ths of a second */
#define MOT_SIZE  0x800u
#define STF_STANCE 278u                  /* the motion both fighters play at a fight's start */
/* 16-byte aligned, as StF's are: its code moves them in triple and quad words. */
static u32 robs[2][ROB_SIZE / 4] __attribute__((aligned(16)));
static u32 mots[2][MOT_SIZE / 4] __attribute__((aligned(16)));
/* What StF's globals point at: the camera (fa_camera, whose +0x18 position
 * and +0x26 yaw get_frame_dat reads to turn a fighter's face), and the
 * replay record and object set_mot_dat reads in a replay. */
static u32 stf_cam[0x500 / 4] __attribute__((aligned(16)));
static u32 stf_rec[0x40] __attribute__((aligned(16))), stf_obj0[0x40] __attribute__((aligned(16)));
/* The other task blocks StF's fight code reaches through its globals, the
 * sizes they have on a real board: the collision task (mod_fa_coli), the
 * effects (mod_fa_effect), the projectiles (mod_fa_tobi), the CPU players
 * (mod_fa_enemy0, _1; the board has none, but get_game_info runs on
 * player 1's) and the game's settings
 * (add_BACKUP_RAM_TO_RAM). */
static u32 stf_coli[0x400 / 4] __attribute__((aligned(16)));
static u32 stf_effect[0xC80 / 4] __attribute__((aligned(16)));
static u32 stf_tobi[0x2000 / 4] __attribute__((aligned(16)));
static u32 stf_enemy[2][0x280 / 4] __attribute__((aligned(16)));
static u32 stf_disp[0x100 / 4] __attribute__((aligned(16)));   /* game_disp's task block */
/* The sway chains (Honey's ponytail, Fang's tail): StF's tasks fa_osage0
 * and fa_osage1 (mod_fa_osage0_1, mod_fa_osage0_2), one a player, 0x280
 * bytes. osage_init reads the fighter's chains (osage_per_character, by
 * +0x1B0) and becomes osage_dsp, which steps them on the coprocessor
 * (Fn_osage, 0x4A, on its records in bufferram at 0x91E800 and 0x91F000)
 * and draws them, in a block of the list that draw_fighter splices in. */
static u32 stf_osage[2][0x280 / 4] __attribute__((aligned(16)));

extern void stf_call(void (*fn)(void), void *rob, void *enemy, u32 arg);
extern void stf_task(void (*fn)(void), void *task, void *rob, void *enemy);

typedef struct { const pose_anim_t *anim; float x; u16 yaw; } fighter_t;

/* CHAR_PARTS: each character's record (+0 its part models, +0xC its
 * motions), in the guest table (StF's, with the guests' records in). */
static const u32 *stf_char(u32 c) { return *(const u32 *const *)(STF_GUEST_CHAR_PARTS + c * 4u); }

/* The game character c comes from (GAME_STF, GAME_VF2, GAME_FV): its byte in
 * the guest table char_game, which tools/vf2-guest.mjs sets for its guests
 * (StF's own are 0). What treats another game's fighter its own way
 * branches on it: here, and in stf_motion.s (lift-stf.py's INSERT). */
static u32 char_game(u32 c) { return *(const u8 *)(STF_GUEST_char_game + c); }
static const char *const game_name[] = { "STF", "VF2", "FV" };

/* The rest of the globals StF's fight code reads, as a real board has them
 * in the attract mode's fight (its RAM read in MAME, 70 s after power-on):
 * the rounds, the energy, the game's settings, the collision and camera
 * constants. A word sets the fields up to the next one; those no name is
 * known for keep their addresses. */
static const u32 stf_fight_ram[] = {
    G_GAMEPROGRAM,      0x00000002u,
    G_RING_OUT,         0x00020000u,   /* num_rounds_to_win 2 */
    G_STAGE_ID,         0x00000001u,
    G_STAGE,            0x01000001u,
    G_NOT_SCR_BG_MOVE,  0x80000000u,
    G_TIME,             0x0000001Eu,   /* 30 */
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
    G_MODEL_SCALE,      0x3F800000u,
    G_GRAVITY,          0x3CCE9ED5u,
    0x50A004u,          0x3F800000u,
    0x50A008u,          0x41200000u,
    G_STAGE_X,          0x41000000u,   /* 8.0 */
    G_STAGE_SOKO,       0xC2C80000u,   /* -100.0 */
    G_LIMIT_XANG,       0x02003600u,   /* nagerenai_timer 0, attack_base 2 */
    G_DEBUG_NUMBER,     0x08060000u,   /* both NORMAL_MODE, rise_base 6, precede_inp_time 8 */
    G_GUARD_LIMIT,      0x0580001Eu,   /* 30, combo_sub 0x80 */
    0x50A1D4u,          0x00030000u,   /* combo_start 3 */
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
static void stf_globals(void) {
    u32 i;
    for (i = 0; i < sizeof stf_fight_ram / sizeof stf_fight_ram[0]; i += 2)
        RAM32(stf_fight_ram[i]) = stf_fight_ram[i + 1];
    RAM32(G_GAME_TIMER) = 0x09090000u;     /* game_timer 0, mode 9, also_mode 9 */
    RAM32(G_MODE_FLAG) = 0x200u;
    RAM32(G_SUB_MODE) = 0x0909u;           /* _sub_mode, also_sub_mode */
    RAM32(G_SUB_MODE + 4u) = 0x200u;
    RAM32(G_NOT_SCR_BG_MOVE) = 0x8400442Cu;
    RAM32(G_TIME) = 0x1Eu;                 /* replay_countdown 0 */
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
    RAM32(G_MODEL_SCALE) = 0x3F800000u;   /* 1, 1, 1 */
    RAM32(G_MODEL_SCALE + 4u) = 0x3F800000u;
    RAM32(G_MODEL_SCALE + 8u) = 0x3F800000u;
    RAM32(G_GRAVITY) = 0x3CCE9ED5u;
}

/* ---- sound ----------------------------------------------------------------
 * StF's sound board (a 68000 running StF's sound program, epr-19021, on its
 * samples) takes 24-bit codes from the i8251 at 0x9C0000, a byte at a time,
 * the high byte first. StF's sound_request_special puts a code in a ring of
 * 32 (AUDIO_2; the count at 0x504001, dropped when it is full), and its IRQ
 * 10 (the USART ready for a byte) sends them (send_sound_code). The SDK's
 * interrupt table has no handler for IRQ 10, so the board sends from its own
 * loop: snd_pump puts out bytes while the USART takes them, without
 * waiting, and the main loop pumps while it waits for the vsync. The lifted
 * code's sound_request_u and sound_request_special come here (lift-stf.py
 * TO_C), with every register kept. */
static u32 snd_q[32], snd_head, snd_tail, snd_n, snd_code, snd_left;

void snd_request_special(u32 code) {
    if (snd_n >= 32u) return;
    snd_q[snd_head] = code;
    snd_head = (snd_head + 1u) & 31u;
    snd_n++;
}

/* sound_request_u: 0xA00001 (the sound program's reset) as it is; a code of
 * bank 0x9E is sent as 0x9C's. (StF's attract mode with its sound off in the
 * backup RAM sends nothing; the board has no attract mode.) */
void snd_request_u(u32 code) {
    if (code != 0xA00001u && (code & 0xFF0000u) == 0x9E0000u) code -= 0x20000u;
    snd_request_special(code);
}

static void snd_pump(void) {
    while (M2_SND_CTL & 1u) {            /* TxRDY */
        if (!snd_left) {
            if (!snd_n) return;
            snd_code = snd_q[snd_tail];
            snd_tail = (snd_tail + 1u) & 31u;
            snd_n--;
            snd_left = 3u;
        }
        snd_left--;
        M2_SND_DATA = (snd_code >> (snd_left * 8u)) & 0xFFu;
    }
}

/* StF's sound codes for the fight's flow: SET_INT's 0xA00003 as a round is
 * set, sd_gong_4 as it starts (ROUND_DSP's gong_ring) and as it is decided
 * (JUDGE_INT), the stage's music from round 1 (stage_bgm_select's
 * STAGE_MUSIC_IN_ORDER by stage_num), and the reset that stops it when the
 * match is over (VIC_INT's 0xA00001). stage_bgm_select's 2-player cases are
 * left out: North Wind is for Sonic against Knuckles, whose slot is Akira's
 * on the board, and South Island's music for stages 4 and 5, which the board
 * does not have. A guest stage plays its own game's song, added to StF's
 * sound program's data by tools/guest-sound.mjs as a song of StF's: FV's
 * Western its western_song, StF's 26th (0xAE1019; the tool checks the
 * numbers), VF2's Tou-rin Lau's (VF2's 0xAD100B) and the Colosseum Akira's
 * (0xAD1003), the 27th and 28th. */
#define SND_RESET   0xA00001u
#define SND_SET     0xA00003u
#define SND_GONG    0xAE1302u
#define SND_FV_WESTERN 0xAE1019u
#define SND_VF2_TOURIN 0xAE101Au
#define SND_VF2_COLOSSEUM 0xAE101Bu
#define STF_STAGE_MUSIC ((const u32 *)0xDBFDCu)   /* STAGE_MUSIC_IN_ORDER, in the copied ROM */

/* by stage (stage_name's order): 0 for StF's own, by its slot */
static const u32 guest_music[] = { 0u, 0u, SND_VF2_TOURIN, SND_VF2_COLOSSEUM, SND_FV_WESTERN };

static void snd_round(u32 stage, const stage_t *st, u32 first) {
    snd_request_u(SND_SET);
    if (first) {
        if (st->slot != 0xFFFFu) snd_request_u(STF_STAGE_MUSIC[st->slot & 15u]);
        else if (guest_music[stage]) snd_request_u(guest_music[stage]);
    }
    snd_request_u(SND_GONG);
}

/* The board's camera as StF's camera object: at (0, CAM_Y, CAM_Z), yaw 0
 * (StF's camera looks along (-sin, cos) in x, z: +z). */
static void stf_camera(void) {
    union { float f; u32 u; } y, z;
    y.f = 1.76f; z.f = -7.36f;
    RW(stf_cam, CAMERA_XPOS) = 0u; RW(stf_cam, CAMERA_XPOS + 4u) = y.u; RW(stf_cam, CAMERA_XPOS + 8u) = z.u;
    RH(stf_cam, CAMERA_XANG) = 0xFA50u;  /* 8 degrees down */
    RH(stf_cam, CAMERA_YANG) = 0u;
    /* both fighters shown: osage_dsp draws their chains */
    RW(stf_cam, CAMERA_FLAG) |= CAMERA_ROB0_DISP | CAMERA_ROB1_DISP;
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

static void rob_init(u32 p, const fighter_t *f) {
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

/* The ball each shadow slot's mask tests, for each fighter, to the
 * coprocessor at 0x306E0 + slot (player 1) and 0x307E0 + slot (player 2):
 * send_kage_ball_pntr's sends, which read StF's table at 0x4C84, where the
 * board has its own code. StF's fighters take StF's table; the guests ride
 * VF2's ball record, so they take the middle ball of each of VF2's slot
 * lists (0x2007BEE), slot 0 that of slot 9, as VF2 does. */
static const u8 kage_ball_stf[16] = { 9, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16 };
static const u8 kage_ball_vf2[16] = { 3, 0, 2, 4, 6, 8, 9, 11, 13, 3, 15, 18, 20, 23, 26, 28 };

static void kage_balls(void) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    u32 p, i;
    for (p = 0; p < 2u; p++) {
        const u8 *b = char_game(RB(robs[p], ROB_CHAR_IS)) == GAME_STF ? kage_ball_stf : kage_ball_vf2;
        for (i = 0; i < 16u; i++) {
            *cf = 0x9801313u; *cf = 0x9801313u; *cf = 0x9801313u; (void)*cf;
            *cf = 0x24804949u; *cf = (p ? 0x307E0u : 0x306E0u) + i; *cf = b[i];
        }
    }
}

/* A fighter's first frame: both fighters' collision balls to the
 * coprocessor (cop_initialize_end2, which also clears their active bits),
 * both bodies' pendulums (sub_7F0E8), then the fighter's task from
 * action_init, which sets up its moves and plays the stance. Its sway
 * chains start over, as a round's start starts them: the task is
 * osage_init again. */
static void rob_start(u32 p) {
    u32 w0[2] = { RW(robs[0], ROB_FLAG), RW(robs[1], ROB_FLAG) }, i;
    stf_call(stf_cop_initialize_end2, robs[0], robs[1], 0u);
    kage_balls();
    RW(robs[0], ROB_FLAG) = w0[0]; RW(robs[1], ROB_FLAG) = w0[1];
    stf_call(stf_sub_7F0E8, robs[0], robs[1], 0u);
    stf_task((void (*)(void))RW(robs[p], TASK_FN), robs[p], robs[p], robs[p ^ 1u]);
    for (i = 0; i < sizeof stf_osage[p] / 4; i++) stf_osage[p][i] = 0u;
    RW(stf_osage[p], TASK_FLAG) = TASK_ALIVE;
    RB(stf_osage[p], TASK_IDNM) = (u8)p;
    RW(stf_osage[p], TASK_SIZE) = sizeof stf_osage[p];
    RW(stf_osage[p], TASK_FN) = (u32)stf_osage_init;
}

/* Each fighter's sway chains, a frame of them: its osage task (osage_init
 * the first time, then osage_dsp), after the fighters' part matrices.
 * set_obj_fifo puts each segment straight in the list (a matrix, then the
 * object from the model table) and counts its polygons in POLYGON against
 * POLYGON_LIMIT, which main_loop starts at 0 every frame; the board's own
 * models go through the coprocessor and keep their own count. In a fight
 * osage_dsp draws on the coprocessor's matrix as it finds it, the fighters'
 * unscaled camera (cam_l: set_obj_fifo skips a segment whose m00 is past
 * 1); only the select screen loads 0x501128. */
static void osage_step(void) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    u32 p;
    *cf = COP_WMATRIX;
    for (p = 0; p < 9; p++) *cf = m2_obj_fb(cam_l.r[p]);
    for (p = 0; p < 3; p++) *cf = m2_obj_fb(cam_l.t[p]);
    RAM32(G_OBJ_COUNT) = 0u;
    RAM32(G_POLYGON) = 0u;
    for (p = 0; p < 2u; p++)
        stf_task((void (*)(void))RW(stf_osage[p], TASK_FN), stf_osage[p], robs[p], robs[p ^ 1u]);
}

/* StF's list blocks: a draw that belongs at another place in the list
 * (osage_dsp's, at the fighter's head) writes a word, its draws and a jump,
 * then turns the word into a jump past them. The layer table (0x501804 +
 * 8 n) holds each layer's first block and the jump at its last one; a block
 * that finds one before it links that jump to itself, and the place it
 * belongs (osage_splice) jumps to the first and has the last jump back.
 * clear_buffer_ptr clears the table every frame. */
static void clear_buffer_ptr(void) {
    u32 *e = (u32 *)stf_ram(G_LIST_BLOCKS), i;
    for (i = 0; i < 43u; i++) e[i] = 0u;
}

/* rob_disp's head entry (unit_efc_kao): layer n's blocks run here (player
 * n's osage blocks; layer 6 both players' mirrored ones, which osage_dsp
 * lays on Aurora Icefield). A word, after which the last block's jump comes
 * back (or, with no block yet, the first one's place); the word becomes the
 * jump to the first. */
#define OSAGE_MIRROR 6u
static void osage_splice(u32 n) {
    volatile u32 *geo = (volatile u32 *)GEO_START, *wpos = (volatile u32 *)COP_WPOS_REG;
    u32 *e = (u32 *)stf_ram(G_LIST_BLOCKS + 4u + n * 8u), at = *wpos;
    *geo = 0u;
    if (e[1] == 0u) e[0] = *wpos;
    else *(volatile u32 *)(GEO_BUFFERRAM + e[1]) = *wpos | 0x80000000u;
    *(volatile u32 *)GEO_WRITE_REG = at;
    e[1] = *wpos;
    *geo = e[0] | 0x80000000u;
}

/* The camera osage_dsp draws the chains on, as camera_init stores it for
 * each player (0x501128, 0x501158): read back after its 1.6 scale, cam. */
static void osage_camera(void) {
    u32 *c0 = (u32 *)stf_ram(G_ROB_CAMERA0), *c1 = (u32 *)stf_ram(G_ROB_CAMERA1), i;
    for (i = 0; i < 9; i++) c0[i] = c1[i] = m2_obj_fb(cam.r[i]);
    for (i = 0; i < 3; i++) c0[9 + i] = c1[9 + i] = m2_obj_fb(cam.t[i]);
}

/* The fighters' shadows, StF's own (docs/SHADOWS.md): camera_init's
 * sub_63AC4 sends the stage's light (rob_kage_set_matrix, op 0x73: the
 * coprocessor builds the flattening and the two passes' matrices on the
 * camera it holds, the fighters' unscaled one, cam_l) and gets each
 * player's two masks of sixteen slots (sub_63B10, op 0x75: the slot's
 * collision ball slid along the light, near the ring or off it). The light
 * is the stage's VECTER_X and VECTER_Y (0x501020, 0x501022; a guest stage's
 * from its own record), the slide (0x501990, 0x501994) worked out from them
 * as loc_23144 does: -sinx(VY + 0x8000, cot VX), cosx(VY + 0x8000, cot VX).
 * Then rob_kage_disp_inside after the stage (the near mask on the ring's
 * matrix, and the projectiles' shadows; all sixteen slots while stage_soko
 * is 0) and rob_kage_disp_outside after each fighter (the far mask, onto
 * the ground stage_soko down). rob_kage_disp_test draws each slot's
 * shadow model with op 0x74 and set_obj in geometrizer mode 2 and leaves
 * StF's mode 1; the board draws in mode 0 (kage_mode). */
#define COP_SIN  COP_CMD(0x21)
#define COP_COS  COP_CMD(0x22)
#define COP_SINX COP_CMD(0x24)
#define COP_COSX COP_CMD(0x25)
#define KAGE_NO_INSIDE 2u                /* Aurora Icefield: StF mirrors its fighters in the ice instead */

static void kage_mode(void) {
    volatile u32 *fifo = (volatile u32 *)M2_GEOFIFO_ADDR;
    *fifo = GEO_OP_MODE; *fifo = GEO_MODE_NP_NS;
}

/* change_scene's part: the light (VECTER_X, VECTER_Y) and stage_soko, the
 * ground below the ring the far pass lays its shadows on (sub_29350: the
 * stage record's +0xC8). A guest stage keeps all its shadows on the ring
 * (stage_soko 0), whose floor is y = 0. */
static void kage_stage(const stage_t *st) {
    RAM16(G_VECTER_X) = (u16)st->vx;
    RAM16(G_VECTER_Y) = (u16)st->vy;
    RAM32(G_STAGE_SOKO) = st->slot != 0xFFFFu ? *(const u32 *)(0x8F3D0u + st->slot * 256u + 0xC8u) : 0u;
}

static void kage_light(const stage_t *st) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    u32 vx, vy, i;
    float sn, cs, cot;
    /* FV's turning town turns its light, and the shadows with it (as
     * stage_light) */
    RAM16(G_VECTER_Y) = (u16)(st->vy + st->turn * (frame_counter - turn_at));
    vx = (u32)(int)(short)RAM16(G_VECTER_X);
    vy = (u32)(int)(short)RAM16(G_VECTER_Y);
    *cf = COP_SIN; *cf = vx; sn = m2_cop_gf();
    *cf = COP_COS; *cf = vx; cs = m2_cop_gf();
    cot = 1.0f / sn * cs;
    vy += 0x8000u;
    *cf = COP_SINX; *cf = vy; *cf = m2_obj_fb(cot); RAM32(G_KAGE_SLIDE_X) = *cf ^ 0x80000000u;
    *cf = COP_COSX; *cf = vy; *cf = m2_obj_fb(cot); RAM32(G_KAGE_SLIDE_Z) = *cf;
    *cf = COP_WMATRIX;
    for (i = 0; i < 9; i++) *cf = m2_obj_fb(cam_l.r[i]);
    for (i = 0; i < 3; i++) *cf = m2_obj_fb(cam_l.t[i]);
    stf_call(stf_sub_63AC4, robs[0], robs[1], 0u);
}

static void kage_inside(const stage_t *st) {
    u32 p;
    if (st->slot == KAGE_NO_INSIDE) return;
    for (p = 0; p < 2u; p++) stf_call(stf_rob_kage_disp_inside, robs[p], robs[p ^ 1u], 0u);
    kage_mode();
}

static void kage_outside(u32 p) {
    stf_call(stf_rob_kage_disp_outside, robs[p], robs[p ^ 1u], 0u);
    kage_mode();
}

/* One 60 Hz frame of StF's fight, its tasks in a real board's order:
 * rob_control (each player's pad to the fighter's +0x1200, then sub_1D47C,
 * which reads the moves the pad makes), each fighter's task (rob_action: the
 * commands, the action, the motion, the part matrices), the collision task
 * (hits, damage, the walls), then get_game_info (each fighter's angle and
 * distance to the other, which it turns by). The pad is StF's: punch 1, kick 2, guard
 * 4, down 0x10, up 0x20, right 0x40, left 0x80. */
static void fight_step(const u32 pad[2]) {
    u32 p;
    if (GAME_TIMER > 0) GAME_TIMER--;
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
}

/* A round: both fighters back to their marks, the collision task, the
 * clock at StF's 30 seconds (MES_READY_INT: time << 6; the collision task
 * only deals damage while it runs). */
static u32 round_time = 30u;             /* seconds, the setup menu's time */

/* The stage the fight is on (load_stage), and VF2's ring out on its
 * stages: each fighter's frames since its root left the ring (0: inside). */
static const stage_t *cur_stage;
static u32 rout[2], ring_out;
static u32 rout_vy[2];            /* its fall's speed, a float's bits */

static void round_start(fighter_t fs[2]) {
    u32 i;
    turn_at = kuma_at = frame_counter;
    kuma_p = kuma_v = 0;
    for (i = 0; i < 2u; i++) {
        /* at yaw a a fighter faces (-sin a, cos a) in x, z, as StF's
         * camera does: 4.0 apart, facing each other, as a real fight starts */
        fs[i].x = i ? 2.0f : -2.0f;
        fs[i].yaw = i ? 0x4000u : 0xC000u;
        rob_init(i, &fs[i]);
    }
    for (i = 0; i < sizeof stf_coli / 4; i++) stf_coli[i] = 0u;
    RW(stf_coli, TASK_FLAG) = TASK_ALIVE;
    RW(stf_coli, TASK_SIZE) = sizeof stf_coli;
    stf_task(stf_coli_init, stf_coli, robs[0], robs[1]);
    /* the projectile task, as fa_tobi starts it: the afterimage ring reset
     * (Fn_zanzou_init) and its 30 objects (0x100 bytes each from +0x200)
     * cleared, so no bomb lives on into the next round */
    *(volatile u32 *)M2_COPFIFO_ADDR = COP_CMD(0x81);
    for (i = 0; i < sizeof stf_tobi / 4; i++) stf_tobi[i] = 0u;
    RW(stf_tobi, TASK_FLAG) = TASK_ALIVE;
    RW(stf_tobi, TASK_SIZE) = sizeof stf_tobi;
    for (i = 0; i < 2u; i++) rob_start(i);
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
    rout[0] = rout[1] = ring_out = 0u;
    rout_vy[0] = rout_vy[1] = 0u;
    /* the HUD, as MES_ROUND_INT and MES_READY_INT leave it: both bars
     * from empty, the lamps (clear_win_lamp_cntr's, then win_lamp_int) */
    for (i = 0; i < sizeof stf_disp / 4; i++) stf_disp[i] = 0u;
    stf_disp[0] = 0x84800000u;
    for (i = 0; i < 10u; i++) {
        RB(stf_disp, DISP_LAMP0 + i) = i < 5u ? 0x3Fu : 4u;
        RB(stf_disp, DISP_LAMP1 + i) = i < 5u ? 0x3Fu : 4u;
    }
    stf_call(stf_win_lamp_int, robs[0], robs[1], 0u);
}

/* StF's HUD, game_display_cont's part of it: the energy bars, the
 * barriers left, the clock and the round lamps, in StF's own tiles. */
static void hud_draw(void) {
    stf_task(stf_energy_disp, stf_disp, robs[0], robs[1]);
    stf_task(stf_energy_disp, stf_disp, robs[1], robs[0]);
    stf_task(stf_barrier_left_disp, stf_disp, robs[0], robs[1]);
    stf_task(stf_time_dsp, stf_disp, robs[0], robs[1]);
    stf_task(stf_win_lamp_dsp, stf_disp, robs[0], robs[1]);
}

/* The fight's camera is StF's own: camera_work's mode 9 (cam_mode_9) places
 * it at a round's start and mode 10 (cam_mode_10) moves it each 60 Hz frame,
 * on the camera object (fa_camera): its place at +0x18 in the fighters'
 * units, its turn at +0x24 (x), +0x26 (y), +0x28 (z). camera_control's
 * matrix from them: identity, ang_z, ang_x and ang_y by the negated angles,
 * then the place; the board's camera is in units 1.6 times the fighters'
 * (as its scale is), so the place goes in 1.6 times. The light is built
 * from the turn every frame, as camera_control builds it. */
static void camera_stf(const stage_t *st) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    float pos[3];
    int i;
    for (i = 0; i < 3; i++) pos[i] = *(float *)((u8 *)stf_cam + CAMERA_XPOS + 4 * i);
    *cf = COP_IDENTITY;
    *cf = COP_ANG_Z; *cf = (u32)-(int)(short)RH(stf_cam, CAMERA_ZANG);
    *cf = COP_ANG_X; *cf = (u32)-(int)(short)RH(stf_cam, CAMERA_XANG);
    *cf = COP_ANG_Y; *cf = (u32)-(int)(short)RH(stf_cam, CAMERA_YANG);
    camera_place(pos);
    stage_light(st);
}

static u32 pad_bits(const m2_player_t *p) {
    return (u32)p->b1 | (u32)p->b2 << 1 | (u32)p->b3 << 2 | (u32)p->down << 4 |
           (u32)p->up << 5 | (u32)p->right << 6 | (u32)p->left << 7;
}

/* rob_disp: under the unscaled camera, each of the sixteen parts with a model, from
 * its slot (op 0x37 multiplies the slot into the current matrix) after a
 * scale of (1, y, 1); then the eyes, on the head's slot: rob_disp_rdn_loop
 * draws the face's two (ROB_EYE_MODEL) with set_obj_tpd, on the texture
 * points snc_eye_thd_set moved (ROB_EYE_TPD), or with set_obj, their own
 * points, while ROB_F_NO_EYES is set or in motion 0x134. */
#define COP_PART COP_CMD(0x37)

/* A slot's matrix (op 0x37 on the identity), read back. */
static void slot_mat(mat_t *m, u32 p, u32 slot) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    int i;
    *cf = COP_IDENTITY;
    *cf = COP_PART; *cf = p; *cf = slot * 12u;
    *cf = COP_RMATRIX;
    for (i = 0; i < 9; i++) m->r[i] = m2_cop_gf();
    for (i = 0; i < 3; i++) m->t[i] = m2_cop_gf();
}

/* Points in slot c's frame carried into slot h's: H^-1 C p for each
 * (carry.c, on the i960's floating point). */
extern void carry(const mat_t *h, const mat_t *c, const float (*in)[3], float (*out)[3], u32 n);

/* The midriff of a VF2 or Fighting Vipers fighter (the guest table midriff,
 * by drawn character; tools/vf2-guest.mjs): the band from a ring on the
 * hips to a ring on the chest that closes the waist; StF's fighters have
 * none. As VF2's calc_unit_mat (0x16F3C) builds it: the chest's ring
 * carried into the hips' frame (H^-1 C p), then geometrizer command 5
 * writes the links to polygon RAM at player << 8, each point a chest point
 * where its index byte is 8 or more, else the link's own (the hips' ring,
 * in the hips' frame already), and the closing word. Returns the model to
 * draw it with (0: none). Leaves the coprocessor's matrix changed. */
#define MID_POLY(p) ((p) << 8)
static u32 midriff_build(u32 p) {
    volatile u32 *fifo = (volatile u32 *)M2_GEOFIFO_ADDR;
    const u32 *mid = *(const u32 *const *)(STF_GUEST_midriff + RB(robs[p], ROB_CHAR) * 4u);
    const float (*ring)[3];
    const u32 *w;
    const u8 *idx;
    float c[8][3];
    mat_t h, ch;
    u32 n, k, j, i;
    if (mid == 0) return 0u;
    n = mid[1]; ring = (const float (*)[3])&mid[2]; w = &mid[2 + 24]; idx = (const u8 *)&w[10u * n + 1u];
    slot_mat(&h, p, 9u);
    slot_mat(&ch, p, 1u);
    carry(&h, &ch, ring, c, 8u);
    *fifo = GEO_OP_POLYDATA; *fifo = MID_POLY(p); *fifo = 10u * n + 1u;
    for (k = 0; k < n; k++, w += 10) {
        for (j = 0; j < 4u; j++) *fifo = w[j];
        for (j = 0; j < 2u; j++) {
            u32 q = idx[k * 2u + j];
            for (i = 0; i < 3; i++) *fifo = q >= 8u ? m2_obj_fb(c[q - 8u][i]) : w[4u + j * 3u + i];
        }
    }
    *fifo = *w;
    return mid[0];
}

/* A mesh built in polygon RAM, at `at`, on the current matrix: rob_disp's
 * slot 9 entry (0x195F8) draws the midriff so on the hips' matrix, from past
 * the first attribute and normal; a seam goes so on its slot S. The model
 * gives the texture points and material. Geometrizer mode 2: the board works
 * out each face's normal from its points, so the mesh shades as it bends
 * (VF2's mode 3 adds the specular VF2 draws with; the board draws in mode 0,
 * without). The list's end goes after the mode word, as after a submit. */
static void poly_draw(u32 model, u32 at) {
    volatile u32 *fifo = (volatile u32 *)M2_GEOFIFO_ADDR;
    *fifo = GEO_OP_MODE; *fifo = GEO_MODE_NN_NS;
    submit_cur_ov(model, 2u, at);
    *fifo = GEO_OP_MODE; *fifo = GEO_MODE_NP_NS;
    *(volatile u32 *)(GEO_BUFFERRAM + (*(volatile u32 *)COP_WPOS_REG & 0x0001FFFCu)) = GEO_OP_END;
}

/* The seams of a fighter whose meshes span his joints (the guest table
 * seams, by drawn character; tools/ryo-guest.mjs): each a mesh drawn on its
 * slot S whose far corners ride slot O, so it stretches over the joint as
 * the mesh skins on its own game's board. Each frame each seam's far points
 * are carried from O's frame into S's (H^-1 C p, as the midriff's ring) and
 * written over its mesh in polygon RAM at SEAM_POLY(p) on, a command a run
 * of words. A seam's whole mesh goes there first, one seam a frame (all of
 * them every frame, for two fighters, ran the frame's display list over its
 * 0x8000-byte buffer), and is drawn from the next frame on. Fills `at` with each seam's
 * address there; returns how many are there (the first so many of `*out`'s
 * list). Leaves the coprocessor's matrix changed. */
#define SEAM_POLY(p) (0x1000u + ((p) << 13))
#define SEAMS_MAX 16u
#define SEAM_PTS 84u
static const u32 *seam_list[2];
static u32 seams_in[2];
/* Not on the stack: main runs on the supervisor stack, from 0x5FF800 up to
 * the end of work RAM at 0x600000, with little of it left by here. */
static mat_t seam_m[16];
static float seam_c[SEAM_PTS][3];
static u32 seams_build(u32 p, u32 *at, const u32 **out) {
    volatile u32 *fifo = (volatile u32 *)M2_GEOFIFO_ADDR;
    const u32 *list = *(const u32 *const *)(STF_GUEST_seams + RB(robs[p], ROB_CHAR) * 4u);
    u32 have = 0;
    u32 addr = SEAM_POLY(p), s, n, in;
    if (list != seam_list[p]) { seam_list[p] = list; seams_in[p] = 0; }
    *out = list;
    if (list == 0) return 0;
    n = list[0] < SEAMS_MAX ? list[0] : SEAMS_MAX;
    in = seams_in[p];
    for (s = 0; s < n && s <= in; s++) {
        const u32 *sm = (const u32 *)list[1u + s];
        u32 S = sm[1] & 0xFu, O = (sm[1] >> 8) & 0xFu, W = sm[2], P = sm[3], N = sm[4], k, r;
        const float (*pts)[3] = (const float (*)[3])&sm[5];
        const u32 *runs = &sm[5u + 3u * P];
        const u32 *w = &runs[N];
        const u8 *patch = (const u8 *)&w[W];
        if (!(have & (1u << S))) { slot_mat(&seam_m[S], p, S); have |= 1u << S; }
        if (!(have & (1u << O))) { slot_mat(&seam_m[O], p, O); have |= 1u << O; }
        carry(&seam_m[S], &seam_m[O], pts, seam_c, P < SEAM_PTS ? P : SEAM_PTS);
#define SEAM_WORD(k) (patch[k] ? m2_obj_fb(seam_c[(patch[k] - 1u) / 3u][(patch[k] - 1u) % 3u]) : w[k])
        if (s == in) {
            *fifo = GEO_OP_POLYDATA; *fifo = addr; *fifo = W;
            for (k = 0; k < W; k++) *fifo = SEAM_WORD(k);
        } else
            for (r = 0; r < N; r++) {
                u32 k0 = runs[r] & 0xFFFFu, kn = k0 + (runs[r] >> 16);
                *fifo = GEO_OP_POLYDATA; *fifo = addr + k0; *fifo = kn - k0;
                for (k = k0; k < kn; k++) *fifo = SEAM_WORD(k);
            }
#undef SEAM_WORD
        at[s] = addr;
        addr += W;
    }
    if (in < n) seams_in[p] = in + 1u;
    return in;
}

/* The spin attack (Sonic's spindash): while ROB_SPIN is 1, rob_disp_rdn_loop
 * draws no part but slot 0, and that as the ball, on slot 0's matrix after
 * the (1, y, 1) scale. spin_attack_cnt_nml_dsp (0x81848): turned a quarter
 * back about x, scaled by player_model_y_scale plus the pulse (ROB_SPIN_PULSE,
 * kept in ROB_SPIN_DRAWN), then on even frames turned by the first angle
 * and a half turn about y and drawn as the first model, on odd frames turned
 * by the second (four times the first) and drawn as the second.
 * Espio's (character 7, spin_attack_cnt_esp_dsp, 0x81914) leans by the
 * pulse instead: its x and z times 0x509508 (init_floats' 65536 / 2 pi) are
 * angles, about z, then x, then down by ROB_SPIN_DROP and turned about y. */
#define SPIN_RAD 10430.378f
static int spin_round(float x) { return (int)(x < 0.0f ? x - 0.5f : x + 0.5f); }
static void spin_ball(u32 *r) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    u32 odd = RAM32(G_FRAME_COUNTER) & 1u, model = RH(r, ROB_SPIN_MODEL + odd * 2u), i;
    const float *g = (const float *)((u8 *)r + ROB_SPIN_PULSE);
    float *d = (float *)((u8 *)r + ROB_SPIN_DRAWN), ys = *(const float *)stf_ram(G_MODEL_SCALE);
    int ang = (short)RH(r, ROB_SPIN_ANG + odd * 2u);
    if (RB(r, ROB_CHAR_IS) % 26u == 7u) {
        int ax = spin_round(SPIN_RAD * g[0]), az = spin_round(SPIN_RAD * g[2]);
        *cf = COP_COSSCALE; *cf = (u32)az; *cf = 0x3FC00000u; d[0] = m2_cop_gf();
        d[1] = ys;
        *cf = COP_COSSCALE; *cf = (u32)ax; *cf = 0x3FC00000u; d[2] = m2_cop_gf();
        *cf = COP_ANG_Z; *cf = (u32)az;
        *cf = COP_ANG_X; *cf = (u32)ax;
        *cf = COP_SET_POS; *cf = 0u; *cf = RW(r, ROB_SPIN_DROP) | 0x80000000u; *cf = 0u;
        *cf = COP_ANG_Y; *cf = (u32)ang;
    } else {
        for (i = 0; i < 3u; i++) d[i] = ys + g[i];
        *cf = COP_ANG_X; *cf = 0xFFFFE000u;
        *cf = COP_SCALE; for (i = 0; i < 3u; i++) *cf = m2_obj_fb(d[i]);
        *cf = COP_ANG_X; *cf = (u32)ang;
        if (!odd) { *cf = COP_ANG_Y; *cf = 0x8000u; }
    }
    if (model) submit_cur(model);
}

/* mirror: the fighter's reflection in Aurora Icefield's ice, as
 * rob_disp_mir (0x6428C) draws it: the parts, under the camera scaled by
 * (1, -1, 1), which turns them over the floor's y = 0 (mirror_draw). */
static void draw_fighter(const fighter_t *f, u32 p, u32 mirror) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    const pose_anim_t *a = f->anim;
    u32 *r = robs[p], i, model, tpd;
    u32 mid = midriff_build(p), seam_at[SEAMS_MAX], s;
    const u32 *seams;
    u32 nseams = seams_build(p, seam_at, &seams);
    /* the eyes are StF's (two models on the head); another game's fighter has
     * them in his head */
    u32 n = char_game(a->chr) == GAME_STF ? 18u : 16u;
    u32 still = (RW(r, ROB_FLAG) & ROB_F_NO_EYES) || RH(r, ROB_MOT_NUM) == 0x134u;
    *cf = COP_WMATRIX;
    for (i = 0; i < 9; i++) *cf = m2_obj_fb(cam_l.r[i]);
    for (i = 0; i < 3; i++) *cf = m2_obj_fb(cam_l.t[i]);
    if (mirror) { *cf = COP_SCALE; *cf = 0x3F800000u; *cf = 0xBF800000u; *cf = 0x3F800000u; }
    if (RW(r, ROB_SPIN) == 1u) {
        *cf = COP_PUSH;
        *cf = COP_SCALE; *cf = 0x3F800000u; *cf = RW(r, ROB_Y_SCALE); *cf = 0x3F800000u;
        *cf = COP_PART; *cf = p; *cf = 0u;
        spin_ball(r);
        *cf = COP_POP;
        return;
    }
    /* slot 0 has no model: StF's records leave it 0, and its command
     * interpreter keeps bytes there (+0x40..0x43 of g13, the rob), so a
     * guest's slot 0 (Akira's 0x13AE) turns into an empty StF entry (0xAE),
     * an object at polygon RAM 0, where the midriff is */
    for (i = 1; i < n; i++) {
        u32 slot, seamed = 0u;
        tpd = 0u;
        if (i < 16u) { slot = i; model = RW(r, ROB_PARTS + i * 4u); }
        else {                           /* the eyes, on the head's slot */
            slot = 2u; model = RW(r, ROB_EYE_MODEL + (i - 16u) * 4u);
            if (!still) tpd = RW(r, ROB_EYE_TPD + (i - 16u) * 4u);
        }
        /* a slot whose faces are all in seams (YKB_B's thighs and shins,
         * welded whole to the joint above) has no model, only its seams */
        if (i < 16u)
            for (s = 0; s < nseams; s++) if ((((const u32 *)seams[1u + s])[1] & 0xFFu) == slot) seamed = 1u;
        if (model == 0u && !seamed) continue;
        *cf = COP_PUSH;
        *cf = COP_SCALE; *cf = 0x3F800000u; *cf = RW(r, ROB_Y_SCALE); *cf = 0x3F800000u;
        *cf = COP_PART; *cf = p; *cf = slot * 12u;
        if (model) submit_cur_ov(model, 0u, tpd);
        if (slot == 9u && i < 16u && mid) poly_draw(mid, MID_POLY(p) + 4u);
        if (i < 16u)
            for (s = 0; s < nseams; s++) {
                const u32 *sm = (const u32 *)seams[1u + s];
                if ((sm[1] & 0xFFu) == slot) poly_draw(sm[0], seam_at[s]);
            }
        *cf = COP_POP;
    }
    if (!mirror) osage_splice(p);
}

/* What camera_init does after a fighter's rob_disp while he spins: a puff
 * of smoke every third frame (spin_smoke_trg; not while the motion's kind
 * has bit 4) and the ball's turn and pulse (spin_attack_cnt); then, spinning
 * or not, spin_smoke_cnt, here: under the unscaled camera, down by
 * ROB_SPIN_DROP, each live puff younger than 32 frames takes its step (the
 * routine in SMOKE_STEP, on g3), its speed and place, and is drawn at its
 * place, faced to the camera and scaled, as model 0x323 + age / 25. */
#define COP_FACE COP_CMD(0x10)
extern void stf_call_g3(void (*fn)(void), void *rob, void *g3);
static void spin_frame(u32 p) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    u32 *r = robs[p], live, i, k;
    if (RW(r, ROB_SPIN)) {
        if (!(RW(r, ROB_MOTD_KIND) & 0x10u) && RAM32(G_FRAME_COUNTER) % 3u == 0u)
            stf_call(stf_spin_smoke_trg, r, robs[p ^ 1u], 0u);
        stf_call(stf_spin_attack_cnt, r, robs[p ^ 1u], 0u);
    }
    if ((live = RW(r, ROB_SMOKE_LIVE)) == 0u) return;
    *cf = COP_WMATRIX;
    for (k = 0; k < 9; k++) *cf = m2_obj_fb(cam_l.r[k]);
    for (k = 0; k < 3; k++) *cf = m2_obj_fb(cam_l.t[k]);
    *cf = COP_SET_POS; *cf = 0x80000000u; *cf = RW(r, ROB_SPIN_DROP) ^ 0x80000000u; *cf = 0x80000000u;
    for (i = 0; i < 20u; i++) {
        u8 *q = (u8 *)r + ROB_SMOKE + i * 0x48u;
        float *pos = (float *)(q + SMOKE_POS), *vel = (float *)(q + SMOKE_VEL), *acc = (float *)(q + SMOKE_ACC);
        u32 model;
        if (!(live & (1u << i))) continue;
        live &= ~(1u << i);
        if ((int)RW(q, SMOKE_COUNT) >= 32) continue;
        live |= 1u << i;
        stf_call_g3((void (*)(void))RW(q, SMOKE_STEP), r, q);
        for (k = 0; k < 3u; k++) { vel[k] += acc[k]; pos[k] += vel[k]; }
        model = 0x323u + RW(q, SMOKE_COUNT) / 25u;
        *cf = COP_PUSH;
        *cf = COP_SET_POS; for (k = 0; k < 3u; k++) *cf = RW(q, SMOKE_POS + k * 4u);
        *cf = COP_FACE;
        *cf = COP_SCALE; for (k = 0; k < 3u; k++) *cf = RW(q, SMOKE_SCALE + k * 4u);
        submit_cur(model);
        *cf = COP_POP;
        RW(q, SMOKE_COUNT)++;
    }
    RW(r, ROB_SMOKE_LIVE) = live;
}

/* The afterimages: the coprocessor's ring of 128 copies, which
 * zanzou_control (fight_step) lays from each fighter's parts while his
 * motion's op 0x26 holds a part mask. zanzou_disp (0x8ACD0), under the
 * camera: for each ring slot, Fn_zanzou_get_info (0x85: part, player, life,
 * step, the model its age picks) and, while it has life and frame_counter
 * plus the slot is odd (the copies flicker, out of step with their
 * neighbours: StF draws them opaque), Fn_zanzou_mul_matrix_inner (0x84: the
 * copy's matrix onto the current one) and the model. StF turns it about X
 * by the projectile module's +0x5C first, which is 0. Each copy's faces go
 * to its fighter's count. A model 0 (a part with no card) draws nothing. */
#define COP_ZANZOU_INFO COP_CMD(0x85)
#define COP_ZANZOU_MUL COP_CMD(0x84)
static void zanzou_draw(u32 pn[3]) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    u32 slot, k, info[5];
    *cf = COP_WMATRIX;
    for (k = 0; k < 9; k++) *cf = m2_obj_fb(cam_l.r[k]);
    for (k = 0; k < 3; k++) *cf = m2_obj_fb(cam_l.t[k]);
    for (slot = 0; slot < 128u; slot++) {
        u32 before = polys;
        *cf = COP_ZANZOU_INFO; *cf = slot;
        for (k = 0; k < 5u; k++) info[k] = *cf;
        if ((int)info[2] <= 0 || !((frame_counter + slot) & 1u) || info[4] == 0u) continue;
        *cf = COP_PUSH;
        *cf = COP_ZANZOU_MUL; *cf = slot;
        submit_cur(info[4] & 0xFFFFu);
        *cf = COP_POP;
        pn[1u + (info[1] & 1u)] += polys - before;
    }
}

/* The projectiles: StF's tobi_disp (0x8A518), under the unscaled camera as
 * zanzou_disp. For each live object not hidden whose type draws
 * (_uk_projectile; the bomb's tdl_bakudan): tobi_disp_go, its model at its
 * place, faced to the camera (op 0x10) on TOBI_F_FACE (the burst), else
 * turned by its y, x and z angles unless TOBI_F_TURNLESS, and scaled. Then,
 * while it is in flight, the landing marker: a ring from
 * bomb_fire_location_marker_circle and, by the part of its flight left (in
 * tenths), a marker from bomb_fire_location_marker drawn twice, turned by
 * (1 - left) a quarter turn each way. Then the fuse while it holds a fuse
 * model and has not burst: the point after the last frame of its fuse list
 * (bomb_fuse) carried through the bomb's place, turn and scale (op 0x29),
 * faced to the camera, scaled by its own scale. Each object's faces count
 * toward its thrower. rob.h names the fields (TOBI_). */
static const u16 bomb_ring[11] = { 2204, 2204, 2204, 2205, 2205, 2205, 2205, 2203, 2203, 2203, 2203 };
static const u16 bomb_mark[11] = { 2200, 2200, 2200, 2202, 2202, 2202, 2202, 2201, 2201, 2201, 2201 };

static void tobi_place(const u32 *o) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    *cf = COP_SET_POS; *cf = RW(o, TOBI_XPOS); *cf = RW(o, TOBI_XPOS + 4u); *cf = RW(o, TOBI_XPOS + 8u);
    if (RW(o, TOBI_FLAG) & TOBI_F_FACE) *cf = COP_FACE;
    else if (!(RW(o, TOBI_FLAG) & TOBI_F_TURNLESS)) {
        *cf = COP_ANG_Y; *cf = (u32)(int)(short)RH(o, TOBI_YANG);
        *cf = COP_ANG_X; *cf = (u32)(int)(short)RH(o, TOBI_XANG);
        *cf = COP_ANG_Z; *cf = (u32)(int)(short)RH(o, TOBI_ZANG);
    }
}

static void tobi_draw(u32 pn[3]) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    u32 n, k;
    *cf = COP_WMATRIX;
    for (k = 0; k < 9; k++) *cf = m2_obj_fb(cam_l.r[k]);
    for (k = 0; k < 3; k++) *cf = m2_obj_fb(cam_l.t[k]);
    for (n = 0; n < 30u; n++) {
        u32 *o = stf_tobi + (TOBI_OBJ + n * 0x100u) / 4u;
        u32 before = polys, w0 = RW(o, TOBI_FLAG);
        if (!(w0 & TASK_ALIVE) || (w0 & TOBI_F_HIDDEN) || RW(o, TASK_SIZE) == 0u || RB(o, TOBI_TYPE) != TOBI_BOMB) continue;
        *cf = COP_PUSH;
        tobi_place(o);
        *cf = COP_SCALE; *cf = RW(o, TOBI_SCALE); *cf = RW(o, TOBI_SCALE); *cf = RW(o, TOBI_SCALE);
        if (RH(o, TOBI_MODEL)) submit_cur(RH(o, TOBI_MODEL));
        *cf = COP_POP;
        if (RH(o, TOBI_IN_FLIGHT) && RB(o, TOBI_FLIGHT)) {
            float left = (float)RB(o, TOBI_FLIGHT_LEFT) / (float)RB(o, TOBI_FLIGHT);
            int i = (int)(left * 10.0f), turn = (int)((1.0f - left) * 16384.0f);
            if (i < 0) i = 0;
            if (i > 10) i = 10;
            *cf = COP_PUSH;
            *cf = COP_SET_POS; *cf = RW(o, TOBI_MARK_XPOS); *cf = RW(o, TOBI_MARK_XPOS + 4u); *cf = RW(o, TOBI_MARK_XPOS + 8u);
            submit_cur(bomb_ring[i]);
            *cf = COP_PUSH;
            *cf = COP_ANG_Y; *cf = (u32)turn;
            submit_cur(bomb_mark[i]);
            *cf = COP_POP;
            *cf = COP_ANG_Y; *cf = (u32)-turn;
            submit_cur(bomb_mark[i]);
            *cf = COP_POP;
        }
        if (!(w0 & TOBI_F_BURST) && RH(o, TOBI_FUSE_MODEL)) {
            const u32 *fuse = (const u32 *)RW(o, TOBI_FUSE);
            const u32 *at = fuse + 1 + 4u * fuse[0];
            u32 w[3];
            *cf = COP_PUSH;
            *cf = COP_IDENTITY;
            *cf = COP_SET_POS; *cf = RW(o, TOBI_XPOS); *cf = RW(o, TOBI_XPOS + 4u); *cf = RW(o, TOBI_XPOS + 8u);
            *cf = COP_ANG_Y; *cf = (u32)(int)(short)RH(o, TOBI_YANG);
            *cf = COP_ANG_X; *cf = (u32)(int)(short)RH(o, TOBI_XANG);
            *cf = COP_ANG_Z; *cf = (u32)(int)(short)RH(o, TOBI_ZANG);
            *cf = COP_SCALE; *cf = RW(o, TOBI_SCALE); *cf = RW(o, TOBI_SCALE); *cf = RW(o, TOBI_SCALE);
            *cf = COP_M2W; *cf = at[0]; *cf = at[1]; *cf = at[2];
            w[0] = *cf; w[1] = *cf; w[2] = *cf;
            *cf = COP_POP;
            *cf = COP_PUSH;
            *cf = COP_SET_POS; *cf = w[0]; *cf = w[1]; *cf = w[2];
            *cf = COP_FACE;
            *cf = COP_SCALE; *cf = RW(o, TOBI_FUSE_SCALE); *cf = RW(o, TOBI_FUSE_SCALE); *cf = RW(o, TOBI_FUSE_SCALE);
            submit_cur(RH(o, TOBI_FUSE_MODEL));
            *cf = COP_POP;
        }
        pn[1u + ((u32 *)RW(o, TOBI_OWNER) == robs[1])] += polys - before;
    }
}

/* move_tpd_req and move_tpd_send: once a frame a stage hands move_tpd_req a
 * block, and move_tpd_send uploads what its handler makes of it to the
 * rasterizer's texture RAM at GEO_PROGRAM_START + 0x1000 (GEO op 4), before
 * the draws. Kind 1 (tpd_move, Aurora Icefield's aurora_init): each (v, u)
 * texture point plus (((0 - frame_counter) << 2) & 0x7FF, 0), so the aurora
 * slides half a texel a frame. Kind 2 (transmap_change, South Island's
 * send_st01_sea_thd): each face's texture header with th1, the lumabase, set
 * to ((frame_counter >> 1) & 63) + 7, so the sea walks luma bands 7..70, which
 * are its palette slots rotated one step further each. The stage's model is
 * then drawn with that address in place of its own points (set_obj_tpd) or
 * headers (set_obj_thd). */
#define TPD_ADDR (GEO_TEXRAM_BIT | 0x5000u)

static void move_tpd_send(const tpd_t *t) {
    volatile u32 *fifo = (volatile u32 *)M2_GEOFIFO_ADDR;
    const short *v = t->v;
    u32 i;
    if (t->kind == 0u) return;
    *fifo = GEO_OP_TEXDATA; *fifo = TPD_ADDR; *fifo = t->words;
    if (t->kind == 1u) {
        int g1 = (int)(((0u - frame_counter) << 2) & 0x7FFu);
        for (i = 0; i < t->n; i++, v += 2) { *fifo = (u32)(v[0] + g1); *fifo = (u32)(int)v[1]; }
    } else {
        u32 luma = ((frame_counter >> 1) & 63u) + 7u;
        for (i = 0; i < t->n; i++, v += 4) {
            *fifo = (u16)v[0]; *fifo = luma; *fifo = (u16)v[2]; *fifo = (u16)v[3];
        }
    }
}

/* The eyes, as camera_init moves them: move_tpd_req's queue emptied
 * (tpd_move_init), then snc_eye_thd_set for each fighter whose ROB_F_NO_EYES
 * is clear (g13 the camera, which it looks at in some modes), and
 * move_tpd_send's upload of what it queued: each eye's texture points (a
 * count, then (v, u) pairs) plus its shift (tpd_move), from
 * GEO_PROGRAM_START + 0x1000 on. The stage's block (move_tpd_send above)
 * is first there, as send_st01_sea_thd queues it first, so the eyes start
 * after its words. Run after the fighters are stepped: it reads the head's
 * slot (calc_unit_mat's) and the other fighter's head (+0x20C). */
static void eyes_frame(const tpd_t *st) {
    volatile u32 *fifo = (volatile u32 *)M2_GEOFIFO_ADDR;
    const u8 *q = (const u8 *)stf_ram(G_TPD_QUEUE);
    u32 p, n, at = 0u;
    stf_call(stf_tpd_move_init, robs[0], robs[1], 0u);
    if (st->kind != 0u) RAM32(G_TPD_WORDS) = at = st->words;
    for (p = 0; p < 2u; p++) {
        u32 c = RB(robs[p], ROB_CHAR), from = RAM32(G_TPD_COUNT), e;
        if (RW(robs[p], ROB_FLAG) & ROB_F_NO_EYES) continue;
        stf_task(stf_snc_eye_thd_set, stf_cam, robs[p], robs[p ^ 1u]);
        /* Honey (15, player 2's 41): clip_medama's table puts her pupils
         * off her eyes, so Sega's console build of StF zeroes her shifts
         * (its emulator's hooks at snc_eye_thd_set+0x148 and +0x188,
         * m2-hle2's sfight_console.h): her eyes are drawn still */
        if (c == 15u || c == 41u)
            for (e = from; e < RAM32(G_TPD_COUNT); e++) RW(q, e * 16u + 8u) = 0u;
    }
    for (n = RAM32(G_TPD_COUNT); n--; q += 16) {
        const short *v = (const short *)RW(q, 4u);
        int dv = (short)RH(q, 8u), du = (short)RH(q, 10u);
        u32 words = ((const u16 *)v)[1], i, k = ((const u16 *)v)[0];
        if (!v || RH(q, 0u) != 0u) break;              /* tpd_move only: the eyes' kind */
        *fifo = GEO_OP_TEXDATA; *fifo = GEO_TEXRAM_BIT | (0x5000u + at); *fifo = words;
        for (i = 0, v += 2; i < k; i++, v += 2) { *fifo = (u32)(v[0] + dv); *fifo = (u32)(v[1] + du); }
        at += words;
    }
}

/* cage_clip_m's test for one cage panel, as StF does it: the panel's matrix
 * (model -> camera) goes to the coprocessor, and each of its two ends, (x, 0,
 * 0) in its own frame, goes through op 0x29. StF then takes the screen x as
 * focus_dist_x * X / Z (mulr, divr) and gives the end an out-code: 0x1F when
 * Z is 2.0 or less, else bit 0 when the screen x is at or left of -248 and
 * bit 1 at or right of 248 (cmpr against 0x40000000, 0xC3780000 and
 * 0x43780000). A panel whose two ends share a bit is not drawn. The board
 * multiplies and divides on the coprocessor too (ops 0x15 and 0x16), and
 * tests StF's three constants against the results' IEEE bits as integers:
 * no float sums or compares on the i960. That is what keeps a wall the
 * camera stands just outside of (Aurora Icefield's fly-in) off the screen:
 * StF's cage_sub_check leaves it to the later cage_disp_f pass, where both
 * ends are behind the near limit. */
static u32 cage_code(volatile u32 *cf, u32 x) {
    int X, Z, sx;
    *cf = COP_M2W; *cf = x; *cf = 0u; *cf = 0u;
    X = (int)*cf; (void)*cf; Z = (int)*cf;
    if (Z <= 0x40000000) return 0x1Fu;                      /* Z <= 2.0, or negative */
    *cf = COP_FMUL; *cf = m2_obj_fb(FOCUS); *cf = (u32)X;
    sx = (int)*cf;
    *cf = COP_FDIV; *cf = (u32)sx; *cf = (u32)Z;
    sx = (int)*cf;
    if (sx < 0) return (sx & 0x7FFFFFFF) >= 0x43780000 ? 1u : 0u;  /* <= -248.0 */
    return sx >= 0x43780000 ? 2u : 0u;                      /* >= 248.0 */
}

static int cage_clip(const mat_t *m, u32 x0, u32 x1) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    int i;
    *cf = COP_WMATRIX;
    for (i = 0; i < 9; i++) *cf = m2_obj_fb(m->r[i]);
    for (i = 0; i < 3; i++) *cf = m2_obj_fb(m->t[i]);
    return (cage_code(cf, x0) & cage_code(cf, x1)) != 0u;
}

/* a = b * c (both column-major with translation), on the coprocessor: each
 * column of a is b's rotation times c's (op 0x29 with no translation), and
 * b's translation is added after. In soft float the stage's products were
 * half the board's work per frame. */
static void mat_mul(mat_t *a, const mat_t *b, const float *c) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    int i, j;
    *cf = COP_WMATRIX;
    for (i = 0; i < 9; i++) *cf = m2_obj_fb(b->r[i]);
    for (i = 0; i < 3; i++) *cf = 0u;
    for (i = 0; i < 4; i++) {
        float *o = i < 3 ? &a->r[i * 3] : a->t;
        *cf = COP_M2W;
        for (j = 0; j < 3; j++) *cf = m2_obj_fb(c[i * 3 + j]);
        for (j = 0; j < 3; j++) o[j] = m2_cop_gf();
    }
    for (j = 0; j < 3; j++) {
        *cf = COP_FADD; *cf = m2_obj_fb(a->t[j]); *cf = m2_obj_fb(b->t[j]);
        a->t[j] = m2_cop_gf();
    }
}

/* FV's cage side test (cage_display's byte_500288): a side is drawn only
 * while the camera is inside its plane. The panel's z axis points out of the
 * arena (its matrix puts it at z -6 in FV's units), so the camera, at the
 * origin of m's frame, is inside while m's translation is along that axis:
 * dot(t, z axis) < 0. The dot is one op 0x29 on the coprocessor with t as
 * the first row; its sign bit is the answer. */
static int fv_side_in(const mat_t *m) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    int i;
    u32 d;
    *cf = COP_WMATRIX;
    for (i = 0; i < 3; i++) { *cf = m2_obj_fb(m->t[i]); *cf = 0u; *cf = 0u; }
    for (i = 0; i < 3; i++) *cf = 0u;
    *cf = COP_M2W;
    for (i = 6; i < 9; i++) *cf = m2_obj_fb(m->r[i]);
    d = *cf; (void)*cf; (void)*cf;
    return (d & 0x80000000u) != 0u;
}

/* FV's Western bear (kuma_int, 0x6C254): an integer pendulum, a step each
 * 60 Hz frame; the bear swings about x by the negated top half of its
 * place. The hop (a fighter knocked into the wall before it) is the cage
 * break's, which the board does not have. */
static void kuma_step(void) {
    while (kuma_at != frame_counter) {
        int t = 0x2000 + kuma_v;
        kuma_p += t;
        if (kuma_p >= 0x10000000) { t = 0x2000 + t; if (t > 0) t = -t; }
        kuma_v = t;
        kuma_at++;
    }
}

/* m = m * ang_x(a), on the coprocessor */
static void mat_ang_x(mat_t *m, u32 a) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    int i;
    *cf = COP_WMATRIX;
    for (i = 0; i < 9; i++) *cf = m2_obj_fb(m->r[i]);
    for (i = 0; i < 3; i++) *cf = m2_obj_fb(m->t[i]);
    *cf = COP_ANG_X; *cf = a & 0xFFFFu;
    *cf = COP_RMATRIX;
    for (i = 0; i < 9; i++) m->r[i] = m2_cop_gf();
    for (i = 0; i < 3; i++) m->t[i] = m2_cop_gf();
}

/* m = m * ang_y(a), on the coprocessor */
static void mat_ang_y(mat_t *m, u32 a) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    int i;
    *cf = COP_WMATRIX;
    for (i = 0; i < 9; i++) *cf = m2_obj_fb(m->r[i]);
    for (i = 0; i < 3; i++) *cf = m2_obj_fb(m->t[i]);
    *cf = COP_ANG_Y; *cf = a & 0xFFFFu;
    *cf = COP_RMATRIX;
    for (i = 0; i < 9; i++) m->r[i] = m2_cop_gf();
    for (i = 0; i < 3; i++) m->t[i] = m2_cop_gf();
}

static void draw_stage(const stage_t *st) {
    mat_t m, ct;
    u32 i, model, x0, x1;
    if (st->turn) {
        /* FV's turning town: cam * ang_y(turn * frame) under the draws marked turn */
        volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
        *cf = COP_WMATRIX;
        for (i = 0; i < 9u; i++) *cf = m2_obj_fb(cam.r[i]);
        for (i = 0; i < 3u; i++) *cf = m2_obj_fb(cam.t[i]);
        *cf = COP_ANG_Y; *cf = (st->turn * (frame_counter - turn_at)) & 0xFFFFu;
        *cf = COP_RMATRIX;
        for (i = 0; i < 9u; i++) ct.r[i] = m2_cop_gf();
        for (i = 0; i < 3u; i++) ct.t[i] = m2_cop_gf();
    }
    kuma_step();
    for (i = 0; i < st->ndraws; i++) {
        /* FV's windows (fvBoardPlan): each covers the ones before it */
        if (st->draws[i].win) m2_geo_fifo_window_full();
        mat_mul(&m, st->draws[i].turn ? &ct : &cam, st->draws[i].m);
        if (st->draws[i].side && !fv_side_in(&m)) continue;
        if (st->draws[i].swing) mat_ang_x(&m, (u32)-(kuma_p >> 16));
        /* StF's sky and Aurora's diamonds turn, a steady step a frame */
        if (st->draws[i].spin) mat_ang_y(&m, st->draws[i].spin * frame_counter);
        x0 = m2_obj_fb(st->draws[i].x0); x1 = m2_obj_fb(st->draws[i].x1);
        if (x0 != x1 && cage_clip(&m, x0, x1)) continue;
        model = st->draws[i].model;
        if (st->lit && storm_lit(st)) model = st->lit[i];
        /* South Island's palms and their shadow sway: a model from a table by frame */
        if (st->draws[i].anim) model = st->draws[i].anim[((frame_counter >> st->draws[i].shift) + st->draws[i].phase) & st->draws[i].mask];
        if (st->wind && i == st->wind_at) model = st->wind[(frame_counter >> st->wind_shift) & 255u];
        if (model == 0u) continue;       /* VF2's: nothing in this look or frame */
        if (st->tpd.kind != 0u && model == st->tpd.model) submit_mat_ov(model, &m, st->tpd.kind == 1u ? 0u : 1u, TPD_ADDR);
        else submit_mat(model, &m);
    }
}

/* Lay a baked run of colorxlat (R, G and B planes, row by row) over the SDK's ramp. */
static void cx_put(const cx_run_t *c) {
    const u16 *v = c->v;
    u32 ch, r, l;
    for (ch = 0; ch < 3u; ch++)
        for (r = c->row0; r < (u32)c->row0 + c->rows; r++)
            for (l = c->luma0; l < (u32)c->luma0 + c->n; l++)
                *(volatile u16 *)(M2_COLORXLAT + ch * 0x4000u + r * 0x200u + l * 2u) = *v++;
}

/* The colours (colorxlat), as StF's own routines set them (stf_motion.s):
 * change_scene's stage_disp (the stage record's RED, GREEN and BLUE into
 * 0x5000E0, then chg_pol_color_req's ramp, luma 0..47 of rows 1..27, which
 * chg_pol_color_send writes a few rows each vsync), the boot's
 * make_lay_col_256_tbl (ARRAY_NUM_RED/GREEN/BLUE, the curves every upload
 * goes through), chg_scr_color_req (luma 64..127, the flat band palette
 * colours go through) and sub_7B4 (the fixed rows 5..6 and 12..13), then
 * the debug menu's colour refresh (0x46754): send_tex_col_stage with the
 * record's colour set (+0x0E, rows 14..27), send_tex_col_skin and
 * send_tex_col_part for each player (rob+0x1B0's character). A guest stage
 * or fighter takes its own game's colours, baked (cx): its stage's trims
 * go where stage_disp puts a StF record's. */
extern void stf_call_g01(void (*fn)(void), u32 g0, u32 g1);

static void stage_colors(const stage_t *st) {
    u32 i;
    if (st->slot != 0xFFFFu) {
        RAM8(G_STAGE) = (u8)st->slot;
        stf_call(stf_stage_disp, robs[0], robs[1], 0u);
    } else
        for (i = 0; i < 3u; i++) RAM8(G_RED + i) = st->tint[i];
    stf_call(stf_make_lay_col_256_tbl, robs[0], robs[1], 0u);
    stf_call(stf_chg_scr_color_req, robs[0], robs[1], 0u);
    if (st->slot == 0xFFFFu) { cx_put(&st->cx); return; }
    while (*(volatile u32 *)stf_ram(G_POL_COLOR_REQ)) stf_call(stf_chg_pol_color_send, robs[0], robs[1], 0u);
    stf_call(stf_sub_7B4, robs[0], robs[1], 0u);
    stf_call_g01(stf_send_tex_col_stage, 14u, *(const u16 *)(0x8F3DEu + st->slot * 256u));
}

/* A player's part and skin rows: StF's send_tex_col_part and skin for its
 * fighter (player 1's rows 0..4 and 28..29, player 2's 7..11 and 30..31),
 * a guest's own (seven part rows, over StF's fixed rows 5, 6, 12, 13). */
static void fighter_colors(u32 p, const pose_anim_t *a) {
    if (a->cx[0].rows) { cx_put(&a->cx[p * 2u]); cx_put(&a->cx[p * 2u + 1u]); return; }
    stf_call_g01(stf_send_tex_col_skin, p, RB(robs[p], ROB_CHAR));
    stf_call_g01(stf_send_tex_col_part, p, RB(robs[p], ROB_CHAR));
}

/* send_beta_data: an uncompressed page, every level's texels already in
 * texram order. Two bytes of size (in 2x2 blocks, less one), a header the
 * third byte skips, then 16-byte groups: four words, whose low halves come
 * first and high halves second. Each level halves both sizes. */
static void tex_send_beta(u32 body, const u32 mip[10]) {
    u32 w = *(volatile u8 *)body + 1u, h = *(volatile u8 *)(body + 1u) + 1u;
    u32 p = body + 2u, lvl, i, g;
    p += *(volatile u8 *)p;
    if (p & 0xFu) return;
    for (lvl = 0; lvl < 10u; lvl++) {
        u32 row = mip[lvl];
        w >>= 1; h >>= 1;
        if (w < 1u || h < 8u) return;
        for (i = 0; i < w; i++, row += 0x400u) {
            volatile u16 *o = (volatile u16 *)row;
            for (g = h >> 3; g > 0u; g--, p += 16u) {
                const volatile u32 *q = (const volatile u32 *)p;
                u32 a = q[0], b = q[1], c = q[2], d = q[3];
                o[0] = (u16)a; o[1] = (u16)b; o[2] = (u16)c; o[3] = (u16)d;
                o[4] = (u16)(a >> 16); o[5] = (u16)(b >> 16); o[6] = (u16)(c >> 16); o[7] = (u16)(d >> 16);
                o += 8;
            }
        }
    }
}

/* tex_load_atlas with StF's raw pages (a page's first word nonzero) sent as
 * they are; the SDK's loader takes every page for a compressed one. */
static void tex_load_set(u32 page) {
    u32 HDR_TABLE = *(volatile u32 *)STF_TEX_HDR_TABLE_PTR;
    u32 DATA_TABLE = *(volatile u32 *)STF_TEX_DATA_TABLE_PTR;
    u32 P = *(volatile u32 *)(HDR_TABLE + page * 4u);
    const volatile u32 *dptr = (const volatile u32 *)(P + 4u);
    u32 D = *(volatile u32 *)(DATA_TABLE + *(volatile u32 *)P * 4u);
    u32 count = *(volatile u32 *)D, i, mip[10];
    const volatile u32 *hdrw = (const volatile u32 *)(D + 4u);
    if (count > 24u) count = 24u;
    for (i = 0; i < count; i++) {
        u32 g2 = hdrw[i], blk = dptr[i], idx;
        if (blk == 0u) continue;
        idx = (g2 >> 1) & 0x7FFFu; if (idx > 23u) continue;
        tex_mip_dests((u32)g_tex_lutx[idx] + (g2 >> 24), (u32)g_tex_luty[idx] + ((g2 >> 16) & 0xFFu), g2 & 1u, mip);
        if (mip[0] == 0u) continue;
        if (*(volatile u32 *)blk != 0u) { tex_send_beta(blk + 4u, mip); continue; }
        tex_decode_page(blk + 4u, (volatile u16 *)mip[0]);
        tex_build_mips(mip);
    }
}

/* set_material + sub_29148, which StF's camera_init runs every frame: the
 * stage's 32 material slots (diffuse, ambient, specular) as GEO texture
 * parameters, each with its coefficient from flt_90BA0. m2_obj_frame_setup
 * fills all 32 with one value, so this goes after it. */
static void send_materials(const u32 *mat) {
    volatile u32 *fifo = (volatile u32 *)M2_GEOFIFO_ADDR;
    u32 i;
    *fifo = GEO_OP_TEXPARAM; *fifo = 0u; *fifo = 0x20u;
    for (i = 0; i < 0x20u; i++) { *fifo = mat[i]; *fifo = geo_mat_int[i]; }
}

/* Aurora Icefield's reflections, as camera_init draws them there in place
 * of the shadows inside the ring: material slots 0 to 15 dimmed to ambient
 * 0x70 with no diffuse (change_material, dword_90F90), each fighter turned
 * over the ice (mirror_rob_disp), the mirrored sway chains osage_dsp laid in
 * list layer 6, then the stage's materials back. Their faces count as each
 * fighter's. */
static void mirror_draw(const stage_t *st, const fighter_t fs[2], u32 pn[3]) {
    volatile u32 *fifo = (volatile u32 *)M2_GEOFIFO_ADDR;
    u32 i;
    *fifo = GEO_OP_TEXPARAM; *fifo = 0u; *fifo = 0x10u;
    for (i = 0; i < 0x10u; i++) { *fifo = 0x7000u; *fifo = geo_mat_int[i]; }
    for (i = 0; i < 2u; i++) { polys = 0u; draw_fighter(&fs[i], i, 1u); pn[1u + i] = polys; }
    osage_splice(OSAGE_MIRROR);
    send_materials(st->mat);
}

/* VF2's sky (tools/vf2-stages.mjs vf2SkyPlan), as 0x24314 sets it up at
 * stage start and 0x24534 moves it every frame; FV's (tools/fv-stages.mjs
 * fvSkyPlan, sub_29728 and 0x29A40) is the same but for its heading, which
 * adds the sky's own turn (head) and the arena's (0x50A022, the board's
 * -turn * frames, as stage_light turns the light). The tilemap's map2 holds 32
 * column pairs of the 256 in the panorama (pair c in slot c & 31); map3,
 * which split mode 1 draws above the line the vertical scroll names, is the
 * top row's first eight tiles over and over, and map2 below the strip the
 * last row's (0x24444, 0x243E0). VF2 reads its camera's pitch (+0x24) and
 * heading (+0x26) two frames late (0x503010, 0x503012), the board's StF
 * camera has the same fields. Across, the strip keeps VF2's 16 heading
 * units a pixel, a turn to its 4096 pixels: on StF's wider view (FOCUS 280
 * to VF2's 600) it turns faster than the stage behind it. */
#define TILE_L3 ((volatile u16 *)0x01006000u)
static u16 sky_have[32], sky_head[2];
static short sky_pitch[2];
static u8 sky_storm;

static void sky_load(const sky_t *s) {
    const volatile u16 *pano;
    u32 b, i;
    if (!s) { M2_L2_VPOS = 0x8000u; return; }    /* StF's stages: map2 off, as m2_init leaves it */
    for (b = 0; b < s->nblocks; b++) {
        volatile u32 *o = (volatile u32 *)(M2_CHARGFX + s->dest[b] * 4096u);
        const volatile u32 *c = (const volatile u32 *)(s->chars + b * 4096u);
        const volatile u16 *pal = (const volatile u16 *)(s->pal + b * 32u);
        for (i = 0; i < 1024u; i++) o[i] = c[i];
        for (i = 0; i < 16u; i++) M2_PALETTE[s->dest[b] * 16u + i] = pal[i];
    }
    pano = (const volatile u16 *)s->pano;
    for (i = 0; i < 64u * 64u; i++) {
        TILE_L3[i] = pano[i & 7u];
        if (i >= s->rows * 64u) M2_TILE_BG[i] = pano[(s->rows - 1u) * 512u + (i & 7u)];
    }
    for (i = 0; i < 32u; i++) sky_have[i] = 0xFFFFu;
    sky_storm = 0;
    sky_pitch[0] = sky_pitch[1] = (short)RH(stf_cam, CAMERA_XANG);
    sky_head[0] = sky_head[1] = (u16)(RH(stf_cam, CAMERA_YANG) + s->head);
}

static void sky_frame(const stage_t *st) {
    const sky_t *s = st->sky;
    const volatile u32 *pano;
    u32 y, c, k, r;
    int p;
    if (!s) return;
    p = sky_pitch[1]; y = (u16)-(int)sky_head[1];
    sky_pitch[1] = sky_pitch[0]; sky_head[1] = sky_head[0];
    sky_pitch[0] = (short)RH(stf_cam, CAMERA_XANG);
    sky_head[0] = (u16)(RH(stf_cam, CAMERA_YANG) + s->head - st->turn * (frame_counter - turn_at));
    /* split mode 1 at VF2's V = 8 * list[2] - (pitch - 0x2E0) / 16, which
     * puts the strip's row 238 + 8 * list[2] on the eye line, screen row
     * 192 + pitch / 16 (its focal, 600); FV's list[2] - 480 tan(pitch) puts
     * row 192 + list[2] there. The board's focal is StF's, FOCUS, so the
     * same row (eye) goes on the board's eye line, 192 + FOCUS tan(pitch). */
    M2_L2_VPOS = (u16)(0x2000u + ((u32)((int)s->eye - 192 -
                       m2_cop_f2int(m2_cop_fmul(FOCUS, m2_cop_tan((u32)p & 0xFFFFu)))) & 0x3FFu));
    pano = (const volatile u32 *)s->pano;
    for (k = 0; k < 32u; k++) {
        c = ((y >> 8) + k) & 255u;
        if (sky_have[c & 31u] == c) continue;
        sky_have[c & 31u] = (u16)c;
        for (r = 0; r < s->rows; r++) ((volatile u32 *)M2_TILE_BG)[r * 32u + (c & 31u)] = pano[r * 256u + c];
    }
    M2_L2_HPOS = (u16)((0u - (y >> 4)) & 0x1FFu);
}

/* The storm's sky (VF2 0x2468C's channels 0..2): channel 0 flashes the sky's
 * palette, channel 1 the far one's (each entry its on and off colour, which
 * VF2 writes as the channel steps on or off), and channel 2 draws the bolt
 * on the panorama's column pairs 24..31 from row 8, where those are on the
 * map (VF2 0x8F1C). sky_frame streams a column back unlit, so a lit bolt is
 * drawn every frame. */
static void sky_storm_frame(const stage_t *st) {
    const sky_t *s = st->sky;
    const volatile u32 *pano;
    u32 b, ch, i, k, r, n;
    const u16 *e;
    if (!s || !s->bolt || !st->storm) return;
    b = st->storm[frame_counter % FLASH_FRAMES];
    for (ch = 0, e = s->storm_pal; ch < 2u; e += 3u * s->storm_n[ch], ch++) {
        if (!((b ^ sky_storm) >> ch & 1u)) continue;
        for (i = 0, n = s->storm_n[ch]; i < n; i++) M2_PALETTE[e[3u * i]] = e[3u * i + (b >> ch & 1u ? 1u : 2u)];
    }
    if ((b | sky_storm) & 4u) {
        pano = (const volatile u32 *)s->pano;
        for (k = 0; k < 8u; k++) {
            if (sky_have[24u + k] != 24u + k) continue;
            for (r = 0; r < 18u; r++)
                ((volatile u32 *)M2_TILE_BG)[(8u + r) * 32u + 24u + k] =
                    b & 4u ? s->bolt[k * 18u + r] : pano[(8u + r) * 256u + 24u + k];
        }
    }
    sky_storm = (u8)b;
}

/* A stage: its texture set (each page to the bank its own origin names, as
 * StF's loader does), its colour bases, its rows of colorxlat and their
 * cycling curve, its backdrop colour and its light. */
static void load_stage(const stage_t *st) {
    u32 i, j;
    cur_stage = st;
    kuma_p = kuma_v = 0; kuma_at = frame_counter;
    tex_load_set(st->texset);
    stage_colors(st);
    sky_load(st->sky);                   /* after the colorxlat: palette_w reads it */
    m2_backdrop(st->bg);                 /* scr_bg_int: the record's stage_bg_color */
    stage_light(st);
    kage_stage(st);
    for (i = 0; i < st->ndraws; i++) {
        if (st->draws[i].model) m2_load_model_palette(st->draws[i].model);
        if (st->draws[i].anim)
            for (j = 0; j <= st->draws[i].mask; j++) m2_load_model_palette(st->draws[i].anim[j]);
        if (st->lit && st->lit[i]) m2_load_model_palette(st->lit[i]);
    }
    if (st->wind) for (i = 0; i < 256u; i++) if (st->wind[i]) m2_load_model_palette(st->wind[i]);
}

/* Every model a fighter can draw: its sixteen parts (its character record's
 * first list; player 2's at character + 26) and its eyes. */
/* A character's shadow models (its off_64988 table, a guest table:
 * sixteen 24-byte entries, the model at +4, then three u16 models), StF's
 * own colours. */
static void kage_palettes(u32 c) {
    u32 t = *(const u32 *)(STF_GUEST_off_64988 + c * 4u), i, m;
    for (i = 0; i < 16u; i++) if ((m = *(const u32 *)(t + i * 24u + 4u)) != 0u) m2_load_model_palette(m);
    for (i = 0; i < 3u; i++) if ((m = *(const u16 *)(t + 16u * 24u + i * 2u)) != 0u) m2_load_model_palette(m);
}

#define STF_SPIN_MOT 0x81138u            /* character_spin_mot_objects, 0x20 bytes a drawn character */
static void load_palettes(void) {
    u32 a, i, p, m;
    for (a = 0; a < POSE_ANIMS; a++)
        for (p = 0; p < 2u; p++) {
            const u32 *parts = *(const u32 *const *)stf_char(pose_anims[a].chr + p * 26u);
            for (i = 0; i < 16u; i++) if (parts[i]) m2_load_model_palette(parts[i]);
            kage_palettes(pose_anims[a].chr + p * 26u);
            /* the spin attack's ball and blur (character_spin_mot_objects) */
            for (i = 0; i < 2u; i++)
                if ((m = *(const u16 *)(STF_SPIN_MOT + (pose_anims[a].chr + p * 26u) * 0x20u + i * 2u)) != 0u)
                    m2_load_model_palette(m);
            if (char_game(pose_anims[a].chr) != GAME_STF) continue;
            for (i = 0; i < pose_anims[a].nparts; i++)
                m2_load_model_palette(p ? pose_anims[a].parts[i].p2 : pose_anims[a].parts[i].model);
        }
    m2_load_model_palette(0x195u);  /* rob_kage_disp_test's slot 0 ball */
    m2_load_model_palette(0x736u);  /* tobi_kage_disp: a projectile's shadow */
    m2_load_model_palette(0x323u);  /* spin_smoke_cnt's puffs, young and old */
    m2_load_model_palette(0x324u);
}

/* Each player's fighter's part and skin rows. */
static void load_fighter_colors(const pose_anim_t *p1, const pose_anim_t *p2) {
    fighter_colors(0u, p1);
    fighter_colors(1u, p2);
}

static u32 edges(u32 now, u32 *held) { u32 e = now & ~*held; *held = now; return e; }

/* ---- The setup menu ----
 *
 * A window in the style of StF's debug menu (PARAMETER_SET, which it opens
 * with 2P start held in debug mode): on tile layer 1, StF's own tile words.
 * The frame is tiles 0x200..0x207 (corners, edges), the font is ASCII at
 * codes 0x00..0x7F and drawn inverse at +0x80; every word carries 0x8000.
 * The title is inverse on the first row, the cursor (0x1C) left of the
 * labels, each value inverse and right-aligned one tile in from the frame,
 * and a name line (the stage's) right-aligned one tile further in. As in
 * StF's window: up and down move, punch lowers a value and kick raises it,
 * with guard held they repeat. Start begins the fight. */
#define TILE_L1    ((volatile u16 *)0x01002000u)
#define WIN_COL    16u
#define WIN_ROW    3u
#define WIN_W      28u
/* The polygon count's window, at the screen's top right (62 tiles across). */
#define PWIN_COL   44u
#define PWIN_ROW   1u
#define PWIN_W     17u
#define PWIN_H     10u
#define T_TEXT     0x8000u
#define T_INV      0x8080u
#define T_CURSOR   0x801Cu
enum { M_START, M_TIME, M_ROUND, M_STAGE, M_P1, M_P2, M_ENERGY, M_BARRIER, M_ITEMS };
static const char *const menu_label[M_ITEMS] = {
    "GAME_START", "time", "round", "stage", "1P CHAR", "2P CHAR", "energy", "barrier" };
/* each value's range and step: the clock in seconds (StF's time, 1..99),
 * the rounds to win (0x500052, the lamps StF draws), the energy a round
 * starts with (energy_max, 0x5000A0, which the bars scale by) and the
 * barriers a match starts with (barrier_default_num, 0x50A424) */
static const u16 menu_min[M_ITEMS]  = { 0, 1, 1, 0, 0, 0, 10, 0 };
static const u16 menu_max[M_ITEMS]  = { 0, 99, 5, STAGES - 1, POSE_ANIMS - 1, POSE_ANIMS - 1, 250, 9 };
static const u16 menu_step[M_ITEMS] = { 0, 1, 1, 1, 1, 1, 10, 1 };
static u16 menu_val[M_ITEMS] = { 0, 30, 2, 0, 0, 1, 140, 5 };
static const char *const fighter_name[POSE_ANIMS] = { "SONIC", "HONEY", "EGGMAN", "AKIRA", "RYO", "CHAI", "HORNET", "MAHLER" };
/* The game a fighter's name line shows where it is not the one its code
 * runs as: Ryo and Chai (Shenmue's) and Hornet (Daytona USA's car, as Fighters
 * Megamix had him) run as VF2's Akira does, on moves turned into VF2's. */
static const char *const fighter_from[POSE_ANIMS] = { 0, 0, 0, 0, "SHENMUE", "SHENMUE", "DAYTONA", 0 };
static const char *const stage_name[STAGES] = { "SOUTH_ISLAND", "AURORA_ICEFIELD", "VF2 TOU-RIN", "VF2 COLOSSEUM", "FV WESTERN" };
static u32 menu_cur;

static u32 slen(const char *s) { u32 n = 0; while (s[n]) n++; return n; }

static void put_at(u32 col, u32 row, const char *s, u32 base) {
    volatile u16 *t = TILE_L1 + row * 64u + col;
    while (*s) *t++ = (u16)(base | (u8)*s++);
}

static void win_put(u32 col, u32 row, const char *s, u32 base) { put_at(WIN_COL + col, WIN_ROW + row, s, base); }

/* n in decimal, into b (at least 6 bytes) */
static const char *dec(u32 n, char *b) {
    char *p = b + 5;
    *p = 0;
    do { *--p = (char)('0' + n % 10u); n /= 10u; } while (n && p > b);
    return p;
}

/* tile layers 0 and 1 share a window mask: four words a line, a bit
 * for each 8 pixels (the top bit leftmost), set where layer 1 shows in
 * place of layer 0. StF's windows set it over their frame. */
#define TILE_MASK  ((volatile u16 *)0x0100C000u)

static void mask_rect(u32 col, u32 row, u32 w, u32 h) {
    u32 y, c;
    for (y = row * 8u; y < (row + h) * 8u; y++)
        for (c = col; c < col + w; c++)
            TILE_MASK[y * 4u + (c >> 4)] |= (u16)(0x8000u >> (c & 15u));
}

static void menu_ink(u32 on) {
    u32 c;
    /* a palette colour's component c shows through colorxlat row c at
     * luma 0x40, and black there is see-through on the tile layers (MAME
     * reads 0..0x40 as 0): 0x41, the darkest it draws, gives the font's
     * black outlines and the values' black boxes, as StF's menu shows them;
     * 0 again restores the fight's band as StF has it */
    for (c = 0; c < 3u; c++)
        *(volatile u16 *)(M2_COLORXLAT + c * 0x4000u + 0x40u * 2u) = on ? 0x41u : 0u;
}

static void menu_mask(u32 on) {
    u32 y, c;
    menu_ink(on);
    for (y = 0; y < 384u; y++)
        for (c = 0; c < 4u; c++) TILE_MASK[y * 4u + c] = 0u;
    if (!on) return;
    mask_rect(WIN_COL, WIN_ROW, WIN_W, M_ITEMS + 5u);
    mask_rect(PWIN_COL, PWIN_ROW, PWIN_W, PWIN_H);
}

static void menu_clear(void) {
    u32 i;
    for (i = 0; i < 64u * 64u; i++) TILE_L1[i] = 0x8020u;
    menu_mask(0u);
}

/* A window's frame, w tiles by rows, its inside blank. */
static void win_frame(u32 col, u32 row, u32 w, u32 rows) {
    u32 r, c;
    for (r = 0; r < rows; r++) {
        volatile u16 *t = TILE_L1 + (row + r) * 64u + col;
        u32 edge = r == 0u ? 0x8200u : r == rows - 1u ? 0x8205u : 0x8203u;
        t[0] = (u16)edge;
        for (c = 1; c < w - 1u; c++) t[c] = (u16)(r == 0u ? 0x8201u : r == rows - 1u ? 0x8206u : 0x8020u);
        t[w - 1u] = (u16)(edge + (r == 0u || r == rows - 1u ? 2u : 1u));
    }
}

static void menu_draw(void) {
    u32 r, i;
    char b[24];
    win_frame(WIN_COL, WIN_ROW, WIN_W, M_ITEMS + 5u);   /* the frame, title, items, name line, a blank */
    win_put(1, 1, "GAME_SETUP", T_INV);
    for (i = 0, r = 2; i < M_ITEMS; i++, r++) {
        const char *v = 0;
        if (i == menu_cur) TILE_L1[(WIN_ROW + r) * 64u + WIN_COL + 2u] = T_CURSOR;
        win_put(3, r, menu_label[i], T_TEXT);
        if (i == M_P1 || i == M_P2) {      /* its game and name, as "VF2:AKIRA" */
            const char *g = fighter_from[menu_val[i]] ? fighter_from[menu_val[i]]
                : game_name[char_game(pose_anims[menu_val[i]].chr)];
            v = fighter_name[menu_val[i]];
            win_put(WIN_W - 3u - slen(v) - slen(g), r, g, T_INV);
            win_put(WIN_W - 3u - slen(v), r, ":", T_INV);
        } else if (i != M_START) v = dec(menu_val[i], b);
        if (v) win_put(WIN_W - 2u - slen(v), r, v, T_INV);
        if (i == M_STAGE) {               /* the name line, as StF's "15:ADV_MOV2" */
            const char *n = stage_name[menu_val[i]];
            const char *d = dec(menu_val[i], b);
            u32 len = slen(d) + 1u + slen(n);
            r++;
            win_put(WIN_W - 3u - len, r, d, T_TEXT);
            win_put(WIN_W - 3u - len + slen(d), r, ":", T_TEXT);
            win_put(WIN_W - 3u - slen(n), r, n, T_TEXT);
        }
    }
}

/* The faces the last frame submitted (polys): each fighter's, by the name
 * the menu shows, the stage's and the frame's. Faces sent, before the
 * geometrizer culls those turned away; a fighter's seams are counted with
 * him (after he changes they come in one a pass, each drawn from the pass
 * after its upload). Under them StF's own count: POLYGON, which the
 * coprocessor keeps (g_cop_p) by adding each object's link count (the low
 * half of obc; culled links too), and the POLYGON_LIMIT StF's boot sets
 * (5000), past which its set_obj draws nothing more. The board does not
 * stop there. Ryo's meshes carry a culled link after every face, so he
 * costs twice his faces in links. */
#define STF_POLYGON_LIMIT 5000u
static void poly_win_draw(const u32 n[3]) {
    static const char *const label[6] = { "1P ", "2P ", "STAGE", "TOTAL", "LINKS", "LIMIT" };
    u32 r, v;
    char b[8];
    win_frame(PWIN_COL, PWIN_ROW, PWIN_W, PWIN_H);
    put_at(PWIN_COL + 1u, PWIN_ROW + 1u, "POLYGON", T_INV);
    for (r = 0; r < 6u; r++) {
        const char *d;
        u32 row = PWIN_ROW + 2u + r + (r >= 4u);         /* a blank line before StF's count */
        put_at(PWIN_COL + 1u, row, label[r], T_TEXT);
        if (r < 2u) put_at(PWIN_COL + 4u, row, fighter_name[menu_val[r ? M_P2 : M_P1]], T_TEXT);
        v = r < 2u ? n[1u + r] : r == 2u ? n[0] : r == 3u ? n[0] + n[1] + n[2]
          : r == 4u ? g_cop_p : STF_POLYGON_LIMIT;
        d = dec(v, b);
        put_at(PWIN_COL + PWIN_W - 1u - slen(d), row, d, T_INV);
    }
}

/* One pass of the menu on the pads' new presses (e) and held bits (h),
 * StF's pad bits. Returns the item whose value changed, M_START when the
 * fight is to begin, or M_ITEMS for neither. */
static u32 menu_input(u32 e, u32 h, u32 start) {
    u32 i = menu_cur, v;
    if (h & 4u) e |= h;                  /* guard held: repeat, as StF's window does */
    if (start || (i == M_START && (e & 3u))) return M_START;
    if (e & 0x10u) { menu_cur = (menu_cur + 1u) % M_ITEMS; return M_ITEMS; }
    if (e & 0x20u) { menu_cur = (menu_cur + M_ITEMS - 1u) % M_ITEMS; return M_ITEMS; }
    if (i == M_START || !(e & 3u)) return M_ITEMS;
    v = menu_val[i];
    if (e & 2u) v = v + menu_step[i] > menu_max[i] ? menu_min[i] : v + menu_step[i];
    else v = v < menu_min[i] + menu_step[i] ? menu_max[i] : v - menu_step[i];
    menu_val[i] = (u16)v;
    return i;
}

/*
 * VF2's ring out (checked in its program, Ghidra and objdump): once a frame
 * the fighter's root (rob part 0, +0x1F4 x and +0x1FC z) against stage_x
 * (0x50A00C, 8.0 at the default ring size, from 0x11530): at |x| or |z| at
 * or past it the fighter falls (0x17BA8) to the ground outside (0x50A010,
 * -0.5); once a collision ball outside the ring touches that ground (rob
 * +0x624, area_coli 0x2396C, about 18 frames from standing) rob_check_stage
 * (0x17BC0) sets w0 bit 5, a knock-out's bit, and JUDGE_DSP_INT (0xE5A8)
 * calls it a ring out (0x500050) while both energies are above 0; the
 * round goes to the one whose bit 5 is clear. StF has the same code with
 * the bit set left out (rob_check_stage 0x181D8) and walls instead, so the
 * board does it here: the ring, the drop and the ground in StF's units
 * (VF2's times the guests' scale), the bit after VF2's 18 frames.
 */
#define RING_OUT_FRAMES 18u
/* float order on the bits (the board has no float compares) */
static u32 f_key(u32 u) { return u & 0x80000000u ? ~u : u | 0x80000000u; }
static u32 f_add(u32 a, u32 b) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    *cf = COP_FADD; *cf = a; *cf = b;
    return m2_obj_fb(m2_cop_gf());
}

static void ring_out_step(const stage_t *st) {
    u32 p, ring = m2_obj_fb(st->ring), ground = m2_obj_fb(-0.5f * VF2_SCALE);
    u32 g = RAM32(G_GRAVITY) ^ 0x80000000u;   /* -gravity */
    if (ring == 0u) return;
    for (p = 0; p < 2u; p++) {
        u32 *r = robs[p], y;
        if (!rout[p]) {
            if ((RW(r, ROB_GXPOS) & 0x7FFFFFFFu) < ring && (RW(r, ROB_GZPOS) & 0x7FFFFFFFu) < ring) continue;
            rout_vy[p] = 0u;
        }
        rout_vy[p] = f_add(rout_vy[p], g);
        y = f_add(RW(r, ROB_YPOS), rout_vy[p]);
        RW(r, ROB_YPOS) = f_key(y) < f_key(ground) ? ground : y;
        if (++rout[p] == RING_OUT_FRAMES) {
            if ((short)RH(robs[0], ROB_ENERGY) > 0 && (short)RH(robs[1], ROB_ENERGY) > 0) ring_out = 1u;
            RW(r, ROB_FLAG) |= ROB_F_LOST;
        }
    }
}

/* RING OUT, over the 3D while the round ends */
#define MSG_COL 27u
#define MSG_ROW 12u
static void ring_msg(u32 on) {
    u32 y, c;
    put_at(MSG_COL, MSG_ROW, on ? "RING OUT" : "        ", on ? T_INV : 0x8020u);
    if (on) { mask_rect(MSG_COL, MSG_ROW, 8u, 1u); return; }
    for (y = MSG_ROW * 8u; y < MSG_ROW * 8u + 8u; y++)
        for (c = MSG_COL; c < MSG_COL + 8u; c++) TILE_MASK[y * 4u + (c >> 4)] &= (u16)~(0x8000u >> (c & 15u));
}

int main(void) {
    fighter_t fs[2];
    u32 i, stage = 0u;
    u32 held = 0u, pheld = 0u, vbl, step = 0u, over = 0u, in_menu = 1u, quit = 0u;
    u32 pn[3];                           /* the faces drawn: the stage's, each fighter's */

    m2_init();
    m2_silicon_boot();
    m2_sound_init();                     /* init_sound: the USART, then the sound program's reset */
    m2_cam_set_focus(FOCUS);
    camera_init();
    tex_load_set(SET_FIGHTERS);
    load_palettes();
    stf_globals();
    /* the test menu's monitor setting as the boot reads it: CRT, StF's
     * TST_* curve constants (load_COLORS_to_RAM, chg_scr_color_req) */
    stf_call(stf_set_display_type_crt, robs[0], robs[1], 0u);
    load_stage(&stages[stage]);          /* its fighters' colours once they are set up (round_start) */
    for (i = 0; i < 8u; i++) { m2_frame_begin(); m2_frame_end(); }

    stf_camera();
    /* StF's tiles and their colours: the set the boot loads (the clock's
     * digits, the bars, the debug font and frames), then the fight's, as
     * MES_ROUND_INT loads them */
    stf_call(stf__Scroll_Initialize, robs[0], robs[1], 0u);
    stf_call(stf__Scroll_Initialize, robs[0], robs[1], 70u);
    stf_call(stf__Scroll_Initialize, robs[0], robs[1], 170u);
    for (i = 0; i < 64u * 64u; i++) M2_TILE_FG[i] = 0x20u;   /* StF's blank (clr_pattern_s) */
    menu_clear();
    menu_mask(1u);
    fs[0].anim = &pose_anims[menu_val[M_P1]];
    fs[1].anim = &pose_anims[menu_val[M_P2]];
    round_start(fs);
    load_fighter_colors(fs[0].anim, fs[1].anim);
    vbl = frameVBL;
    for (;;) {
        m2_player_t p[2];
        u32 e, pad[2] = { 0u, 0u };
        p[0] = m2_player(0); p[1] = m2_player(1);
        e = edges((u32)p[0].start | (u32)p[1].start << 1, &held);
        if (in_menu) {
            /* the setup window, on either pad; the fighters stand in their
             * stance behind it, on the stage it picks, with the clock held */
            u32 h = pad_bits(&p[0]) | pad_bits(&p[1]);
            u32 c = menu_input(edges(h, &pheld), h, e & 3u);
            if (c == M_STAGE) {
                /* m2_backdrop takes pen 1 (the font's white) and layer 0 for
                 * its field; StF's pen 0 is the backdrop here, as at boot */
                u16 ink = M2_PALETTE[1];
                stage = menu_val[M_STAGE];
                load_stage(&stages[stage]);
                load_fighter_colors(fs[0].anim, fs[1].anim);   /* their bands, over the stage's rows */
                menu_ink(1u);
                M2_PALETTE[1] = ink;
                for (i = 0; i < 64u * 64u; i++) M2_TILE_FG[i] = 0x20u;
            }
            if (c == M_P1 || c == M_P2) {
                i = c == M_P1 ? 0u : 1u;
                fs[i].anim = &pose_anims[menu_val[c]];
                rob_init(i, &fs[i]);
                rob_start(i);
                /* the scene's rows again: a guest's seven part rows took StF's fixed ones */
                stage_colors(&stages[stage]);
                load_fighter_colors(fs[0].anim, fs[1].anim);
                menu_ink(1u);
            }
            if (c == M_START) {
                round_time = menu_val[M_TIME];
                RAM32(G_ENERGY_MAX) = menu_val[M_ENERGY];
                RAM32(G_BARRIER_DEFAULT) = menu_val[M_BARRIER];
                RAM8(G_WINS_NEEDED) = (u8)menu_val[M_ROUND];
                RAM8(G_ROUND_WINS0) = RAM8(G_ROUND_WINS1) = 0u;
                menu_clear();
                round_start(fs);
                snd_round(stage, &stages[stage], 1u);
                over = 0u;
                in_menu = 0u;
            } else {
                menu_draw();
                GAME_TIMER = (short)(round_time << 6);
            }
        } else {
            pad[0] = pad_bits(&p[0]); pad[1] = pad_bits(&p[1]);
            /* both starts at once: back to the setup */
            if ((e & 3u) && p[0].start && p[1].start) quit = 1u;
        }

        m2_frame_begin();
        m2_obj_frame_setup();
        clear_buffer_ptr();
        send_materials(stages[stage].mat);
        camera_stf(&stages[stage]);
        sky_frame(&stages[stage]);
        sky_storm_frame(&stages[stage]);
        osage_camera();
        m2_geo_fifo_light(m2_obj_fb(light[0]), m2_obj_fb(light[1]), m2_obj_fb(light[2]));
        move_tpd_send(&stages[stage].tpd);
        polys = 0u;
        draw_stage(&stages[stage]);
        pn[0] = polys;
        /* StF steps its fighters once a 60 Hz frame and draws every other
         * one: a frame of the motion for every vblank since the last pass
         * (up to four), the last one's matrices drawn. */
        { u32 n = frame_counter - step;
          if (n > 4u) n = 4u;
          if (n == 0u) n = 1u;
          step = frame_counter;
          while (n--) {
              short clock = GAME_TIMER;
              fight_step(pad);
              if (in_menu) continue;
              if (over) GAME_TIMER = clock;  /* the clock stops once the round is decided */
              if (!over && !quit) ring_out_step(&stages[stage]);
              /* a knock-out (a fighter's w0 bit 5) or the clock's end: the
               * next round three seconds later, or the setup once a
               * fighter has won the match */
              if (quit || over) {
                  if (quit || !--over) {
                      u32 won = menu_val[M_ROUND];
                      if (ring_out) ring_msg(0u);
                      if (quit || RAM8(G_ROUND_WINS0) >= won ||
                          RAM8(G_ROUND_WINS1) >= won) {
                          in_menu = 1u;
                          for (i = 0; i < 64u * 64u; i++) M2_TILE_FG[i] = 0x20u;
                          menu_mask(1u);
                          RAM8(G_ROUND_WINS0) = RAM8(G_ROUND_WINS1) = 0u;
                          round_start(fs);
                          snd_request_u(SND_RESET);
                          over = quit = 0u;
                          break;
                      }
                      round_start(fs);
                      snd_round(stage, &stages[stage], 0u);
                      over = 0u;
                  }
              }
              else if (((RW(robs[0], ROB_FLAG) | RW(robs[1], ROB_FLAG)) & ROB_F_LOST) ||
                       GAME_TIMER <= 0) {
                  /* the round, as VF2's JUDGE_DSP_INT gives it: to the one
                   * whose bit 5 is clear (a knock-out, a ring out), else to
                   * the one with more energy left */
                  short e0 = (short)RH(robs[0], ROB_ENERGY), e1 = (short)RH(robs[1], ROB_ENERGY);
                  u32 l0 = RW(robs[0], ROB_FLAG) & ROB_F_LOST, l1 = RW(robs[1], ROB_FLAG) & ROB_F_LOST;
                  if (l0 != l1) (RAM8(l0 ? G_ROUND_WINS1 : G_ROUND_WINS0))++;
                  else if (e0 != e1) (RAM8(e0 > e1 ? G_ROUND_WINS0 : G_ROUND_WINS1))++;
                  if (ring_out) ring_msg(1u);
                  snd_request_u(SND_GONG);
                  over = 180u;
              }
          } }
        if (!in_menu) hud_draw();
        eyes_frame(&stages[stage].tpd);
        osage_step();
        kage_light(&stages[stage]);
        kage_inside(&stages[stage]);
        if (stages[stage].slot == KAGE_NO_INSIDE) mirror_draw(&stages[stage], fs, pn);
        else pn[1] = pn[2] = 0u;
        /* the fighters in one more window, over the stage, the shadows on
         * it and the reflections, as StF draws them (camera_init's
         * set_window(win_down) before rob_disp) and FV over its cage */
        m2_geo_fifo_window_full();
        for (i = 0; i < 2u; i++) { polys = 0u; draw_fighter(&fs[i], i, 0u); spin_frame(i); kage_outside(i); pn[1u + i] += polys; }
        zanzou_draw(pn);
        tobi_draw(pn);
        if (in_menu) poly_win_draw(pn);
        *(volatile u32 *)ZCLIP_REG = 0xFFFF00FFu;
        m2_frame_commit();
        /* 60 fps, as StF and VF2 run: a pass a vsync, the fighters stepped
         * once and drawn every frame. StF's frame_counter counts its 60 Hz
         * loop and sub_2435C runs once a pass, after the wait for the vsync.
         * A pass that runs past a vsync steps the fighters for each vblank it
         * took, so the count follows the vblanks. */
        {
            u32 v = frameVBL;
            /* m2_vsync's wait, sending the sound queue meanwhile */
            while (frameVBL == v) snd_pump();
            v = frameVBL; frame_counter += v - vbl; vbl = v;
            RAM32(G_FRAME_COUNTER) = frame_counter;
            if (stages[stage].slot != 0xFFFFu) stf_call(stf_sub_2435C, robs[0], robs[1], 0u);
        }
    }
    return 0;
}
