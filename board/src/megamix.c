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

#define FOCUS 280.0f

/* StF's texture sets: 1 holds the fighters, uploaded with every stage. */
#define SET_FIGHTERS 1u

typedef struct { float r[9], t[3]; } mat_t;   /* column-major, the COP's layout */

/* a = b * c (both column-major with translation). */
static void mat_mul(mat_t *a, const mat_t *b, const float *c) {
    int i, j;
    for (i = 0; i < 3; i++)
        for (j = 0; j < 3; j++)
            a->r[i * 3 + j] = b->r[j] * c[i * 3] + b->r[3 + j] * c[i * 3 + 1] + b->r[6 + j] * c[i * 3 + 2];
    for (j = 0; j < 3; j++)
        a->t[j] = b->r[j] * c[9] + b->r[3 + j] * c[10] + b->r[6 + j] * c[11] + b->t[j];
}

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

static void stage_light(const stage_t *st) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    int i;
    *cf = COP_WMATRIX;
    for (i = 0; i < 9; i++) *cf = m2_obj_fb(cam_l.r[i]);
    for (i = 0; i < 3; i++) *cf = 0u;
    *cf = COP_ANG_Y; *cf = (u32)(int)st->vy;
    *cf = COP_ANG_X; *cf = (u32)(int)st->vx;
    m2_cop_m2w(0.0f, 0.0f, st->bright, light);
}

/* ---- StF's fighters ----
 *
 * A fighter is StF's rob: its 0x3400-byte block, which StF's motion code
 * (stf_motion.s) reads and writes through g7, the other fighter's through g8.
 * The fields the board sets, at StF's own offsets:
 *   0x000  flags (w0): bit 31 plays a motion, bit 7 once the first frame is
 *          done, bit 1 player 2; 0x84000080 / 0x84000082 in a real fight
 *   0x004  player (0, 1), the coprocessor's slot bank
 *   0x018  position (x, y, z); 0x026 yaw (forward is (cos, -sin) in x, z)
 *   0x1A8  motion, 0x1AA its frame (coma), 0x800 its length, 0x802 the next
 *   0x1B0  character (player 2: its own models, character + 26), 0x1B1 the
 *          character it is; 0x190 its record, 0x1A0 the record's motions
 *          (as action_init sets them)
 *   0x040  the sixteen part models (calc_rob_angle_int fills them)
 *   0x84C  skeleton kind; 0xFF so the first set_motion copies the rig in
 *   0xBD8  the motion record (0x800 bytes, StF's at 0x520000 + 0x7C8 p)
 *   0x27C0 rob_disp's y scale (1.0)
 */
#define ROB_SIZE  0x3400u
#define MOT_SIZE  0x800u
#define STF_STANCE 278u                  /* the motion both fighters play at a fight's start */
#define RW(r, o) (*(u32 *)((u8 *)(r) + (o)))
#define RH(r, o) (*(u16 *)((u8 *)(r) + (o)))
#define RB(r, o) (*(u8 *)((u8 *)(r) + (o)))
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
 * effects (mod_fa_effect), the projectiles (mod_fa_tobi), two control
 * blocks (0x50083C, 0x500840) and the game's settings (0x50016C). */
static u32 stf_coli[0x400 / 4] __attribute__((aligned(16)));
static u32 stf_effect[0xC80 / 4] __attribute__((aligned(16)));
static u32 stf_tobi[0x2000 / 4] __attribute__((aligned(16)));
static u32 stf_ctl[2][0x280 / 4] __attribute__((aligned(16)));
static u32 stf_settings[0x3400 / 4] __attribute__((aligned(16)));
static u32 stf_disp[0x100 / 4] __attribute__((aligned(16)));   /* game_disp's task block */

extern void stf_call(void (*fn)(void), void *rob, void *enemy, u32 arg);
extern void stf_task(void (*fn)(void), void *task, void *rob, void *enemy);

typedef struct { const pose_anim_t *anim; float x; u16 yaw; } fighter_t;

static void stf_set(u32 a, u32 v) { *(u32 *)stf_ram(a) = v; }

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
 * the rounds (0x500052 two to win), the energy (0x5000A0 140), the game's
 * settings, the collision and camera constants. */
static const u32 stf_fight_ram[] = {
    0x50004Cu, 0x00000002u, 0x500050u, 0x00020000u, 0x500054u, 0x00000001u,
    0x500064u, 0x01000001u, 0x500068u, 0x80000000u, 0x500090u, 0x0000001Eu,
    0x500098u, 0xDD47A900u, 0x5000A0u, 0x0000008Cu, 0x50027Cu, 0x409EB852u,
    0x501024u, 0x3E6789E7u, 0x501500u, 0x0000014Fu, 0x504068u, 0x00040000u,
    0x504078u, 0x00A00003u, 0x506000u, 0x3C23D70Au, 0x506200u, 0xBD4CCCCDu,
    0x506440u, 0x000CC700u, 0x506580u, 0x00000001u, 0x506600u, 0x00000001u,
    0x509518u, 0x3F800000u, 0x50A000u, 0x3CCE9ED5u, 0x50A004u, 0x3F800000u,
    0x50A008u, 0x41200000u, 0x50A00Cu, 0x41000000u, 0x50A010u, 0xC2C80000u,
    0x50A0B4u, 0x02003600u, 0x50A0B8u, 0x08060000u, 0x50A1B4u, 0x0580001Eu,
    0x50A1D4u, 0x00030000u, 0x50A1D8u, 0x00000800u, 0x50A1DCu, 0x3F800000u,
    0x50A204u, 0x3EAE978Du, 0x50A284u, 0x40000000u, 0x50A288u, 0x0000001Eu,
    0x50A28Cu, 0x3E916873u, 0x50A30Cu, 0x40000000u, 0x50A310u, 0x0000001Eu,
    0x50A320u, 0x00030600u, 0x50A324u, 0x3EAE978Du, 0x50A418u, 0x3DCCCCCDu,
    0x50A424u, 0x00000005u, 0x50A800u, 0x3F800000u, 0x50E000u, 0xBDB914C0u,
    0x50E01Cu, 0x45BA174Fu, 0x50E028u, 0x463C2F12u, 0x50E034u, 0xC1BEFFE8u,
    0x50FE00u, 0x02008000u, 0x530004u, 0x0000007Fu,
};

/* StF's globals as they are in a 2-player fight (a real board's RAM at a
 * fight's start): the modes, the debug flags, the stage's walls. */
static void stf_globals(void) {
    u32 i;
    for (i = 0; i < sizeof stf_fight_ram / sizeof stf_fight_ram[0]; i += 2)
        stf_set(stf_fight_ram[i], stf_fight_ram[i + 1]);
    stf_set(0x500028u, 0x09090000u);     /* also_mode 9 (0x50002B) */
    stf_set(0x50002Cu, 0x200u);          /* mode_flag */
    stf_set(0x500030u, 0x0909u);         /* _sub_mode, also_sub_mode */
    stf_set(0x500034u, 0x200u);
    stf_set(0x500068u, 0x8400442Cu);     /* not_scr_bg_move */
    stf_set(0x500090u, 0x1Eu);           /* replay_countdown (0x500092) 0 */
    stf_set(0x500804u, (u32)robs[0]);    /* fa_rob0 */
    stf_set(0x500808u, (u32)robs[1]);    /* fa_rob1 */
    stf_set(0x50016Cu, (u32)stf_settings);
    stf_set(0x500828u, (u32)stf_coli);   /* mod_fa_coli */
    stf_set(0x500834u, (u32)stf_disp);   /* mod_fa_game_disp */
    stf_set(0x50083Cu, (u32)stf_ctl[0]);
    stf_set(0x500840u, (u32)stf_ctl[1]);
    stf_set(0x500844u, (u32)stf_effect); /* mod_fa_effect */
    stf_set(0x5008A4u, (u32)stf_tobi);   /* mod_fa_tobi */
    stf_set(0x500814u, (u32)stf_cam);    /* fa_camera */
    stf_set(0x500854u, (u32)stf_rec);    /* mod_fa_record */
    stf_set(0x500870u, (u32)stf_obj0);   /* mod_fa_obj0 */
    stf_set(0x508000u, 0x18A00u);        /* debug_flag */
    stf_set(0x509518u, 0x3F800000u);     /* player_model_y_scale 1, 1, 1 */
    stf_set(0x50951Cu, 0x3F800000u);
    stf_set(0x509520u, 0x3F800000u);
    stf_set(0x50A000u, 0x3CCE9ED5u);
}

/* The board's camera as StF's camera object: at (0, CAM_Y, CAM_Z), yaw 0
 * (StF's camera looks along (-sin, cos) in x, z: +z). */
static void stf_camera(void) {
    union { float f; u32 u; } y, z;
    y.f = 1.76f; z.f = -7.36f;
    stf_cam[0x18 / 4] = 0u; stf_cam[0x1C / 4] = y.u; stf_cam[0x20 / 4] = z.u;
    RH(stf_cam, 0x24) = 0xFA50u;         /* 8 degrees down */
    RH(stf_cam, 0x26) = 0u;
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
    RW(r, 0x000) = p ? 0x84000082u : 0x84000080u;
    RB(r, 0x004) = (u8)p;
    RW(r, 0x008) = ROB_SIZE;             /* the task block's size */
    RW(r, 0x00C) = (u32)stf_action_init; /* its task: action_init, then rob_action */
    RW(r, 0x1208) = 1u << 3;             /* control_init: the pad drives it */
    RW(r, 0x018) = x.u;
    RH(r, 0x026) = f->yaw;
    RB(r, 0x1B0) = (u8)(f->anim->chr + (p ? 26u : 0u));
    RB(r, 0x1B1) = (u8)f->anim->chr;
    RW(r, 0x190) = (u32)stf_char(RB(r, 0x1B0));
    RW(r, 0x1A0) = stf_char(RB(r, 0x1B0))[3];
    for (i = 0; i < 9u; i++) RW(r, 0x1D00 + 4u * i) = (u32)stf_ram(rob_balls[p][i]);
    RB(r, 0x84C) = 0xFFu;
    RW(r, 0xBD8) = (u32)mots[p];
    RW(r, 0x27C0) = 0x3F800000u;
    /* The dent pendulums, as the round's start sets them (sub_89BF8 with
     * zero angles): unit scale, then the countdown camera_init runs down
     * each frame; dented_cnt only swings them while it is not negative. */
    for (i = 0; i < 3u; i++) {
        RW(r, 0x1F88 + 4u * i) = 0x3F800000u;
        RW(r, 0x1FEC + 4u * i) = 0x3F800000u;
    }
    RW(r, 0x219C) = 0u;
}

/* A fighter's first frame: both fighters' collision balls to the
 * coprocessor (cop_initialize_end2, which also clears their active bits),
 * both bodies' pendulums (sub_7F0E8), then the fighter's task from
 * action_init, which sets up its moves and plays the stance. */
static void rob_start(u32 p) {
    u32 w0[2] = { RW(robs[0], 0), RW(robs[1], 0) };
    stf_call(stf_cop_initialize_end2, robs[0], robs[1], 0u);
    RW(robs[0], 0) = w0[0]; RW(robs[1], 0) = w0[1];
    stf_call(stf_sub_7F0E8, robs[0], robs[1], 0u);
    stf_task((void (*)(void))RW(robs[p], 0xC), robs[p], robs[p], robs[p ^ 1u]);
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
    short *timer = (short *)stf_ram(0x500028u);
    if (*timer > 0) (*timer)--;
    stf_set(0x500700u, pad[0] << 8 | pad[1] << 16);  /* INTERUPT_FLAGS_HELD */
    for (p = 0; p < 2u; p++) RW(robs[p], 0x219C)--;  /* camera_init's sub_7F5CC */
    for (p = 0; p < 2u; p++) {
        RB(robs[p], 0x1200) = (u8)pad[p];
        /* g13 the rob too: the command interpreter keeps its base there */
        stf_task(stf_sub_1D47C, robs[p], robs[p], robs[p ^ 1u]);
    }
    for (p = 0; p < 2u; p++)
        stf_task((void (*)(void))RW(robs[p], 0xC), robs[p], robs[p], robs[p ^ 1u]);
    stf_task((void (*)(void))RW(stf_coli, 0xC), stf_coli, robs[0], robs[1]);
    stf_task(stf_get_game_info, stf_ctl[0], robs[0], robs[1]);
    stf_task(stf_cam_mode_10, stf_cam, robs[0], robs[1]);
}

/* A round: both fighters back to their marks, the collision task, the
 * clock at StF's 30 seconds (MES_READY_INT: time << 6; the collision task
 * only deals damage while it runs). */
static u32 round_time = 30u;             /* seconds, the setup menu's time */

static void round_start(fighter_t fs[2]) {
    u32 i;
    for (i = 0; i < 2u; i++) {
        /* at yaw a a fighter faces (-sin a, cos a) in x, z, as StF's
         * camera does: 4.0 apart, facing each other, as a real fight starts */
        fs[i].x = i ? 2.0f : -2.0f;
        fs[i].yaw = i ? 0x4000u : 0xC000u;
        rob_init(i, &fs[i]);
    }
    for (i = 0; i < sizeof stf_coli / 4; i++) stf_coli[i] = 0u;
    RW(stf_coli, 0x000) = 0x80000000u;
    RW(stf_coli, 0x008) = sizeof stf_coli;
    stf_task(stf_coli_init, stf_coli, robs[0], robs[1]);
    for (i = 0; i < 2u; i++) rob_start(i);
    stf_task(stf_cam_mode_9, stf_cam, robs[0], robs[1]);
    *(short *)stf_ram(0x500028u) = (short)(round_time << 6);
    /* the HUD, as MES_ROUND_INT and MES_READY_INT leave it: both bars
     * from empty, the lamps (clear_win_lamp_cntr's, then win_lamp_int) */
    for (i = 0; i < sizeof stf_disp / 4; i++) stf_disp[i] = 0u;
    stf_disp[0] = 0x84800000u;
    for (i = 0; i < 10u; i++) {
        RB(stf_disp, 0x64 + i) = i < 5u ? 0x3Fu : 4u;
        RB(stf_disp, 0x6E + i) = i < 5u ? 0x3Fu : 4u;
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
    for (i = 0; i < 3; i++) pos[i] = *(float *)((u8 *)stf_cam + 0x18 + 4 * i);
    *cf = COP_IDENTITY;
    *cf = COP_ANG_Z; *cf = (u32)-(int)(short)RH(stf_cam, 0x28);
    *cf = COP_ANG_X; *cf = (u32)-(int)(short)RH(stf_cam, 0x24);
    *cf = COP_ANG_Y; *cf = (u32)-(int)(short)RH(stf_cam, 0x26);
    camera_place(pos);
    stage_light(st);
}

static u32 pad_bits(const m2_player_t *p) {
    return (u32)p->b1 | (u32)p->b2 << 1 | (u32)p->b3 << 2 | (u32)p->down << 4 |
           (u32)p->up << 5 | (u32)p->right << 6 | (u32)p->left << 7;
}

/* rob_disp: under the unscaled camera, each of the sixteen parts with a model, from
 * its slot (op 0x37 multiplies the slot into the current matrix) after a
 * scale of (1, y, 1); then the eyes, on the head's slot (rob_disp_rdn_loop's
 * set_obj_tpd, whose texture points are the eye models' own). */
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
    const u32 *mid = *(const u32 *const *)(STF_GUEST_midriff + RB(robs[p], 0x1B0) * 4u);
    const float (*ring)[3];
    const u32 *w;
    const u8 *idx;
    float c[8][3], d[3], x[3][3], det;
    mat_t h, ch;
    u32 n, k, j, i;
    if (mid == 0) return 0u;
    n = mid[1]; ring = (const float (*)[3])&mid[2]; w = &mid[2 + 24]; idx = (const u8 *)&w[10u * n + 1u];
    slot_mat(&h, p, 9u);
    slot_mat(&ch, p, 1u);
    /* x[i]: the hips' other two columns crossed, so (H^-1 d)[i] = d . x[i] / det */
    for (i = 0; i < 3; i++) {
        const float *u = &h.r[((i + 1u) % 3u) * 3u], *v = &h.r[((i + 2u) % 3u) * 3u];
        x[i][0] = u[1] * v[2] - u[2] * v[1];
        x[i][1] = u[2] * v[0] - u[0] * v[2];
        x[i][2] = u[0] * v[1] - u[1] * v[0];
    }
    det = h.r[0] * x[0][0] + h.r[1] * x[0][1] + h.r[2] * x[0][2];
    for (k = 0; k < 8u; k++) {
        for (j = 0; j < 3; j++)
            d[j] = ch.r[j] * ring[k][0] + ch.r[3 + j] * ring[k][1] + ch.r[6 + j] * ring[k][2] + ch.t[j] - h.t[j];
        for (i = 0; i < 3; i++) c[k][i] = (d[0] * x[i][0] + d[1] * x[i][1] + d[2] * x[i][2]) / det;
    }
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

/* rob_disp's slot 9 entry (0x195F8): the midriff on the hips' matrix, from
 * polygon RAM past the first attribute and normal, with the model's texture
 * points and material, in geometrizer mode 2: the board works out each
 * face's normal from its points, so the band shades as it bends (VF2's mode
 * 3 adds the specular VF2 draws with; the board draws in mode 0, without).
 * The list's end goes after the mode word, as after a submit. */
static void midriff_draw(u32 model, u32 p) {
    volatile u32 *fifo = (volatile u32 *)M2_GEOFIFO_ADDR;
    *fifo = GEO_OP_MODE; *fifo = GEO_MODE_NN_NS;
    submit_cur_ov(model, 2u, MID_POLY(p) + 4u);
    *fifo = GEO_OP_MODE; *fifo = GEO_MODE_NP_NS;
    *(volatile u32 *)(GEO_BUFFERRAM + (*(volatile u32 *)COP_WPOS_REG & 0x0001FFFCu)) = GEO_OP_END;
}

static void draw_fighter(const fighter_t *f, u32 p) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    const pose_anim_t *a = f->anim;
    u32 *r = robs[p], i, model, head = 0u;
    u32 mid = midriff_build(p);
    /* the eyes are StF's (a second head model); another game's fighter has
     * them in his head */
    u32 n = char_game(a->chr) == GAME_STF ? 16u + a->nparts : 16u;
    *cf = COP_WMATRIX;
    for (i = 0; i < 9; i++) *cf = m2_obj_fb(cam_l.r[i]);
    for (i = 0; i < 3; i++) *cf = m2_obj_fb(cam_l.t[i]);
    for (i = 0; i < n; i++) {
        u32 slot;
        if (i < 16u) { slot = i; model = RW(r, 0x40 + i * 4u); }
        else {                           /* the eyes: a second model on the head's slot */
            const pose_part_t *pt = &a->parts[i - 16u];
            if (pt->slot != 2u || !head++) continue;
            slot = 2u; model = p ? pt->p2 : pt->model;
        }
        if (model == 0u) continue;
        *cf = COP_PUSH;
        *cf = COP_SCALE; *cf = 0x3F800000u; *cf = RW(r, 0x27C0); *cf = 0x3F800000u;
        *cf = COP_PART; *cf = p; *cf = slot * 12u;
        submit_cur(model);
        if (slot == 9u && i < 16u && mid) midriff_draw(mid, p);
        *cf = COP_POP;
    }
}

/* StF's frame_counter (see stage_col_cycle). */
static u32 frame_counter;

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

static void draw_stage(const stage_t *st) {
    mat_t m;
    u32 i, model, x0, x1;
    for (i = 0; i < st->ndraws; i++) {
        mat_mul(&m, &cam, st->draws[i].m);
        x0 = m2_obj_fb(st->draws[i].x0); x1 = m2_obj_fb(st->draws[i].x1);
        if (x0 != x1 && cage_clip(&m, x0, x1)) continue;
        model = st->draws[i].model;
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

/* Stage colour cycling, as StF does it. make_lay_col_256_tbl (color_intensity)
 * builds ARRAY_NUM_RED/GREEN/BLUE: 256 entries per channel, the curve
 * (x - 116) * mul / 37 + add, 0 at or below zero, -1 from 256, then trimmed by
 * the stage's RED/GREEN/BLUE (* t >> 7). Once a frame, out of
 * interrupt_wait_b, sub_2435C walks the stage record's (row, shift) list and
 * sub_243AC refills that colorxlat row's palette slots (luma 48..63) from the
 * stage colour block in the data ROM (pointer at 0x2101010, colour set * 0x540,
 * (row - 14) * 0x60, 0x20 a channel), slot i taking colour
 * ((frame_counter >> shift) + i) & 15 through the curve. That is South
 * Island's and Canyon Cruise's shoreline and waterfall (rows 18 and 19) and
 * Casino Night's rows 14, 16 and 19. */
#define STF_STAGE_COL_PTR 0x02101010u
static u16 array_num[3][256];

static void make_lay_col_256_tbl(const stage_t *st) {
    u32 ch, x;
    for (ch = 0; ch < 3u; ch++)
        for (x = 0; x < 256u; x++) {
            int v = ((int)x - 116) * (int)tst_mul[ch] / 37 + (int)tst_add[ch];
            u32 u = 0u;
            if (v > 0) {
                u = (u32)v;
                if (u >= 0x100u) u = 0xFFFFFFFFu;
                u = (u * st->tint[ch]) >> 7;
            }
            array_num[ch][x] = (u16)u;
        }
}

static void stage_col_cycle(const stage_t *st) {
    const u16 *c;
    for (c = st->cyc; c[0] != 0u; c += 2) {
        u32 row = c[0], ph = frame_counter >> c[1], ch, i;
        u32 blk = *(volatile u32 *)STF_STAGE_COL_PTR + st->cset * 0x540u + (row - 14u) * 0x60u;
        for (ch = 0; ch < 3u; ch++, blk += 0x20u) {
            volatile u16 *o = (volatile u16 *)(M2_COLORXLAT + ch * 0x4000u + row * 0x200u + 0x60u);
            for (i = 0; i < 16u; i++)
                o[i] = array_num[ch][*(volatile u16 *)(blk + ((ph + i) & 15u) * 2u)];
        }
    }
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

/* A stage: its texture set (each page to the bank its own origin names, as
 * StF's loader does), its colour bases, its rows of colorxlat and their
 * cycling curve, its backdrop colour and its light. */
static void load_stage(const stage_t *st) {
    u32 i;
    tex_load_set(st->texset);
    cx_put(&st->cx);
    make_lay_col_256_tbl(st);
    m2_backdrop(st->bg);                 /* scr_bg_int: the record's stage_bg_color */
    stage_light(st);
    for (i = 0; i < st->ndraws; i++) m2_load_model_palette(st->draws[i].model);
}

/* Every model a fighter can draw: its sixteen parts (its character record's
 * first list; player 2's at character + 26) and its eyes. */
static void load_palettes(void) {
    u32 a, i, p;
    for (a = 0; a < POSE_ANIMS; a++)
        for (p = 0; p < 2u; p++) {
            const u32 *parts = *(const u32 *const *)stf_char(pose_anims[a].chr + p * 26u);
            for (i = 0; i < 16u; i++) if (parts[i]) m2_load_model_palette(parts[i]);
            if (char_game(pose_anims[a].chr) != GAME_STF) continue;
            for (i = 0; i < pose_anims[a].nparts; i++)
                m2_load_model_palette(p ? pose_anims[a].parts[i].p2 : pose_anims[a].parts[i].model);
        }
}

/* Each player's fighter's part and skin rows: player 1's 0..4 and 28..29,
 * player 2's 7..11 and 30..31, as StF's send_tex_col_part and skin upload. */
static void load_fighter_colors(const pose_anim_t *p1, const pose_anim_t *p2) {
    cx_put(&p1->cx[0]); cx_put(&p1->cx[1]);
    cx_put(&p2->cx[2]); cx_put(&p2->cx[3]);
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
#define WIN_COL    18u
#define WIN_ROW    3u
#define WIN_W      26u
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
static const char *const fighter_name[POSE_ANIMS] = { "SONIC", "HONEY", "EGGMAN", "AKIRA" };
static const char *const stage_name[STAGES] = { "SOUTH_ISLAND", "AURORA_ICEFIELD" };
static u32 menu_cur;

static u32 slen(const char *s) { u32 n = 0; while (s[n]) n++; return n; }

static void win_put(u32 col, u32 row, const char *s, u32 base) {
    volatile u16 *t = TILE_L1 + (WIN_ROW + row) * 64u + WIN_COL + col;
    while (*s) *t++ = (u16)(base | (u8)*s++);
}

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

static void menu_mask(u32 on) {
    u32 y, c;
    /* a palette colour's component c shows through colorxlat row c at
     * luma 0x40, and black there is see-through on the tile layers (MAME
     * reads 0..0x40 as 0): 0x41, the darkest it draws, gives the font's
     * black outlines and the values' black boxes, as StF's menu shows them;
     * 0 again restores the fight's band as StF has it */
    for (c = 0; c < 3u; c++)
        *(volatile u16 *)(M2_COLORXLAT + c * 0x4000u + 0x40u * 2u) = on ? 0x41u : 0u;
    for (y = 0; y < 384u; y++)
        for (c = 0; c < 4u; c++) TILE_MASK[y * 4u + c] = 0u;
    if (!on) return;
    for (y = WIN_ROW * 8u; y < (WIN_ROW + M_ITEMS + 5u) * 8u; y++)
        for (c = WIN_COL; c < WIN_COL + WIN_W; c++)
            TILE_MASK[y * 4u + (c >> 4)] |= (u16)(0x8000u >> (c & 15u));
}

static void menu_clear(void) {
    u32 i;
    for (i = 0; i < 64u * 64u; i++) TILE_L1[i] = 0x8020u;
    menu_mask(0u);
}

static void menu_draw(void) {
    u32 rows = M_ITEMS + 5u, r, c, i;     /* the frame, title, items, name line, a blank */
    char b[24];
    for (r = 0; r < rows; r++) {
        volatile u16 *t = TILE_L1 + (WIN_ROW + r) * 64u + WIN_COL;
        u32 edge = r == 0u ? 0x8200u : r == rows - 1u ? 0x8205u : 0x8203u;
        t[0] = (u16)edge;
        for (c = 1; c < WIN_W - 1u; c++) t[c] = (u16)(r == 0u ? 0x8201u : r == rows - 1u ? 0x8206u : 0x8020u);
        t[WIN_W - 1u] = (u16)(edge + (r == 0u || r == rows - 1u ? 2u : 1u));
    }
    win_put(1, 1, "GAME_SETUP", T_INV);
    for (i = 0, r = 2; i < M_ITEMS; i++, r++) {
        const char *v = 0;
        if (i == menu_cur) TILE_L1[(WIN_ROW + r) * 64u + WIN_COL + 2u] = T_CURSOR;
        win_put(3, r, menu_label[i], T_TEXT);
        if (i == M_P1 || i == M_P2) {      /* its game and name, as "VF2:AKIRA" */
            const char *g = game_name[char_game(pose_anims[menu_val[i]].chr)];
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

int main(void) {
    fighter_t fs[2];
    u32 i, stage = 0u;
    u32 held = 0u, pheld = 0u, vbl, step = 0u, over = 0u, in_menu = 1u, quit = 0u;

    m2_init();
    m2_silicon_boot();
    m2_cam_set_focus(FOCUS);
    cx_put(&flat_cx);                    /* StF's flat band, which palette colours go through */
    camera_init();
    tex_load_set(SET_FIGHTERS);
    load_palettes();
    load_stage(&stages[stage]);
    load_fighter_colors(&pose_anims[menu_val[M_P1]], &pose_anims[menu_val[M_P2]]);
    for (i = 0; i < 8u; i++) { m2_frame_begin(); m2_frame_end(); }

    stf_globals();
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
                M2_PALETTE[1] = ink;
                for (i = 0; i < 64u * 64u; i++) M2_TILE_FG[i] = 0x20u;
            }
            if (c == M_P1 || c == M_P2) {
                i = c == M_P1 ? 0u : 1u;
                fs[i].anim = &pose_anims[menu_val[c]];
                rob_init(i, &fs[i]);
                rob_start(i);
                load_fighter_colors(fs[0].anim, fs[1].anim);
            }
            if (c == M_START) {
                round_time = menu_val[M_TIME];
                stf_set(0x5000A0u, menu_val[M_ENERGY]);          /* energy_max */
                stf_set(0x50A424u, menu_val[M_BARRIER]);         /* barrier_default_num */
                *(u8 *)stf_ram(0x500052u) = (u8)menu_val[M_ROUND];
                *(u8 *)stf_ram(0x50004Fu) = *(u8 *)stf_ram(0x500051u) = 0u;
                menu_clear();
                round_start(fs);
                over = 0u;
                in_menu = 0u;
            } else {
                menu_draw();
                *(short *)stf_ram(0x500028u) = (short)(round_time << 6);
            }
        } else {
            pad[0] = pad_bits(&p[0]); pad[1] = pad_bits(&p[1]);
            /* both starts at once: back to the setup */
            if ((e & 3u) && p[0].start && p[1].start) quit = 1u;
        }

        m2_frame_begin();
        m2_obj_frame_setup();
        send_materials(stages[stage].mat);
        camera_stf(&stages[stage]);
        m2_geo_fifo_light(m2_obj_fb(light[0]), m2_obj_fb(light[1]), m2_obj_fb(light[2]));
        move_tpd_send(&stages[stage].tpd);
        draw_stage(&stages[stage]);
        /* StF steps its fighters once a 60 Hz frame and draws every other
         * one: a frame of the motion for every vblank since the last pass
         * (up to four), the last one's matrices drawn. */
        { u32 n = frame_counter - step;
          if (n > 4u) n = 4u;
          if (n == 0u) n = 1u;
          step = frame_counter;
          while (n--) {
              fight_step(pad);
              if (in_menu) continue;
              /* a knock-out (a fighter's w0 bit 5) or the clock's end: the
               * next round three seconds later, or the setup once a
               * fighter has won the match */
              if (quit || over) {
                  if (quit || !--over) {
                      u32 won = menu_val[M_ROUND];
                      if (quit || *(u8 *)stf_ram(0x50004Fu) >= won ||
                          *(u8 *)stf_ram(0x500051u) >= won) {
                          in_menu = 1u;
                          for (i = 0; i < 64u * 64u; i++) M2_TILE_FG[i] = 0x20u;
                          menu_mask(1u);
                          *(u8 *)stf_ram(0x50004Fu) = *(u8 *)stf_ram(0x500051u) = 0u;
                          round_start(fs);
                          over = quit = 0u;
                          break;
                      }
                      round_start(fs);
                      over = 0u;
                  }
              }
              else if (((RW(robs[0], 0) | RW(robs[1], 0)) & 0x20u) ||
                       *(short *)stf_ram(0x500028u) <= 0) {
                  /* the round to the one with more energy left */
                  short e0 = (short)RH(robs[0], 0x1AC), e1 = (short)RH(robs[1], 0x1AC);
                  if (e0 != e1) (*(u8 *)stf_ram(e0 > e1 ? 0x50004Fu : 0x500051u))++;
                  over = 180u;
              }
          } }
        if (!in_menu) hud_draw();
        for (i = 0; i < 2u; i++) draw_fighter(&fs[i], i);
        *(volatile u32 *)ZCLIP_REG = 0xFFFF00FFu;
        m2_frame_commit();
        /* 30 fps, as StF runs. StF's frame_counter counts its 60 Hz loop and
         * sub_2435C runs once a pass, after the wait for the vsync. This loop
         * can take longer than a vsync, so the count follows the vblanks. */
        for (i = 0; i < 2u; i++) {
            u32 v;
            m2_vsync();
            v = frameVBL; frame_counter += v - vbl; vbl = v;
            stage_col_cycle(&stages[stage]);
        }
    }
    return 0;
}
