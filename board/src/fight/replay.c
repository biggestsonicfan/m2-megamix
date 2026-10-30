/*
 * replay.c — Fighting Vipers' replay of an armour break (REP_WAZA), which
 * StF kept: the watch on the breaking moves, the two passes from the
 * recorder's ring, and FV's replay camera.
 */
#include "megamix.h"

/* FV's replay of an armour break (rep_start): its task, whether it runs,
 * the camera's mode, each fighter's kind2 a frame ago */
u32 stf_play[0x100 / 4] __attribute__((aligned(16)));
u32 rep_on;
static u32 rep_mode, rep_prev[2], rep_mark[2], rep_pend;
static short rep_time[2];

/* Fighting Vipers' replay of an armour break, which StF kept as REP_WAZA
 * (sub_mode 22, its 0x11943FF on): twice, from two of FV's views, the
 * breaking move again from its start, the HUD hidden, then the fight on
 * from where it was.
 * - The recorder: rec_disp, a fight frame's last task, puts both fighters
 *   (their places, motions, frames and the frame's sounds, which
 *   check_same_sound keeps, four a frame) in a ring of 240 frames at
 *   0x535000; stf_rec +0x6C is the next one.
 * - The trigger, as FV's FIGHT_DSP (its 0xD5FC) watches each fighter's
 *   kind2: a breaking move's start (MK2_REPLAY rises) marks the ring's place
 *   and the clock (rep_mark); a break it deals (MK2_REPLAY_INIT, damage_unit's,
 *   lift-stf.py) leaves the replay pending, which starts once the move is
 *   over (MK2_REPLAY falls), P1's first.
 * - The replay (rep_start, rep_step): StF's sub_3900C starts a pass from
 *   the mark and keeps the effects aside (sub_3A200); replay_waza_disp
 *   puts a frame back a frame, with its sounds, and at the ring's place
 *   the replay started from puts the fighters where they were and the
 *   effects back. Each pass the clock goes back to the mark's.
 * - The camera is FV's (its camera modes 0x11, 0x12 and 0x13, rep_cam;
 *   StF's own 0xF and 0x10 follow the round's winner instead): a view
 *   from rep_view (FV's two tables of eight, tools/board/bake-board.mjs) picked
 *   at random, the next one for the second pass, turned and raised to
 *   look at the fighters; then it slides after the point between them
 *   (or the breaker, MK2_PIKA), at a distance that grows with theirs.
 *   FV's 0x513830 on its yaw is its g3, left over from the code before
 *   (the same in every replay, MAME).
 * - The HUD: REP_WAZA's window mask shows tile layer 1, cleared, in place
 *   of layer 0's HUD; FV's over its top 96 lines, the board's over the
 *   whole screen, StF's barrier boxes at the bottom too. */
#define SUB_REP_WAZA  22u
#define CAM_AT        0x120u     /* f32 x3 what the camera looks at */
#define CAM_VIEW      0x210u     /* u32 the view, 0..7 */
#define CAM_KEPT_POS  0x318u     /* REP_WAZA's copy of +0x18, +0x120 (+0x324) and the angles (+0x330) */
#define CAM_KEPT_AT   0x324u
#define CAM_KEPT_ANG  0x330u
#define CAM_DIST      0x338u     /* f32 the view's distance */
#define CAM_HIGH      0x344u     /* f32 the view's height */
#define CAM_MODE_REP  0x11u      /* FV's: a view from table 0; 0x12 table 1; 0x13 following */
#define FV_REP_YAW    0x3830u
#define FV_UNIT       (2.676f / 1.309f)
#define COP_ATAN2F    COP_CMD(0x27)  /* in: a, b; out: i16 the angle of (a, b) */

static u32 cop_angle(u32 op, float a, float b, float c, float d, u32 n) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    *cf = op; *cf = m2_obj_fb(a); *cf = m2_obj_fb(b);
    if (n == 4u) { *cf = m2_obj_fb(c); *cf = m2_obj_fb(d); }
    return *cf;
}

static float rep_f(u32 u) { union { u32 u; float f; } x; x.u = u; return x.f; }

/* what the replay looks at (FV's 0x67444): each fighter's root (on the
 * ground while its motion has MK_MOVE), at its ground's height when it is
 * down (MK_DOWN_POSE, MK_DOWN, MK_AIR), else 0.9 over its feet; the point
 * between them, or the breaker's own with MK2_PIKA */
static void rep_target(float t[3], float g[2][3]) {
    u32 p, k;
    for (p = 0; p < 2u; p++) {
        u32 *r = robs[p], mk = RW(r, ROB_MOT_KIND);
        u32 o = mk & MK_MOVE ? ROB_GXPOS : ROB_XPOS;
        g[p][0] = *(float *)&RW(r, o);
        g[p][2] = *(float *)&RW(r, o + 8u);
        g[p][1] = mk & (MK_DOWN_POSE | MK_DOWN | MK_AIR) ? *(float *)&RW(r, ROB_GXPOS + 4u)
                                                       : *(float *)&RW(r, ROB_YPOS) + 0.9f * FV_UNIT;
    }
    p = RAM8(G_REP_FLAG) >> 2 & 1u;
    for (k = 0; k < 3u; k++)
        t[k] = RW(robs[p], ROB_KIND2) & MK2_PIKA ? g[p][k] : (g[0][k] + g[1][k]) * 0.5f;
}

/* FV's replay camera: mode 0x11 or 0x12 sets the view up, 0x13 follows */
static void rep_cam(void) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    float t[3], g[2][3], *at = (float *)&RW(stf_cam, CAM_AT), d;
    u32 k;
    rep_target(t, g);
    if (rep_mode != 0x13u) {
        const float *v = rep_view[rep_mode - CAM_MODE_REP][RW(stf_cam, CAM_VIEW)];
        for (k = 0; k < 3u; k++) at[k] = t[k];
        RH(stf_cam, CAMERA_YANG) = (u16)(cop_angle(COP_ATAN2, 0.0f, v[2], v[0], 0.0f, 4u) + FV_REP_YAW);
        d = rep_f(cop_angle(COP_DIST2D, 0.0f, v[0], 0.0f, v[2], 4u));
        *(float *)&RW(stf_cam, CAM_DIST) = d;
        RH(stf_cam, CAMERA_XANG) = (u16)cop_angle(COP_ATAN2F, d, v[1], 0.0f, 0.0f, 2u);
        *(float *)&RW(stf_cam, CAM_HIGH) = v[1];
        rep_mode = 0x13u;
    }
    for (k = 0; k < 3u; k++) at[k] += (t[k] - at[k]) * 0.05f;
    d = rep_f(cop_angle(COP_DIST2D, g[0][0], g[1][0], g[0][2], g[1][2], 4u));
    if (d < 2.0f * FV_UNIT) d = 2.0f * FV_UNIT;
    d = d * 0.717f + 2.0f * FV_UNIT;
    RH(stf_cam, CAMERA_XANG) = (u16)cop_angle(COP_ATAN2F, d, t[1] - *(float *)&RW(stf_cam, CAM_HIGH), 0.0f, 0.0f, 2u);
    *cf = COP_PUSH;
    *cf = COP_IDENTITY;
    *cf = COP_SET_POS; *cf = m2_obj_fb(at[0]); *cf = m2_obj_fb(at[1]); *cf = m2_obj_fb(at[2]);
    *cf = COP_ANG_Y; *cf = (u32)(int)(short)RH(stf_cam, CAMERA_YANG);
    *cf = COP_ANG_X; *cf = (u32)(int)(short)RH(stf_cam, CAMERA_XANG);
    *cf = COP_M2W; *cf = 0u; *cf = 0u; *cf = m2_obj_fb(-d);
    for (k = 0; k < 3u; k++) RW(stf_cam, CAMERA_XPOS + 4u * k) = *cf;
    *cf = COP_POP;
}

/* a pass: the clock back to the mark's, the play task from the mark */
static void rep_pass(void) {
    GAME_TIMER = rep_time[RAM8(G_REP_FLAG) >> 2 & 1u];
    RAM32(G_REP_MARK0) = rep_mark[0];
    RAM32(G_REP_MARK1) = rep_mark[1];
    task_reset(stf_play, sizeof stf_play);
    stf_task(stf_sub_3900C, stf_play, robs[0], robs[1]);
}

static void rep_start(u32 p) {
    u32 i;
    RAM8(G_REP_FLAG) = (u8)(p << 2);
    RAM8(G_REP_PASSES) = 2u;
    /* both: set_mot_dat marks each motion's start in FIGHT_DSP only */
    RAM8(G_SUB_MODE) = RAM8(G_SUB_MODE + 1u) = SUB_REP_WAZA;
    for (i = 0; i < 3u; i++) {
        RW(stf_cam, CAM_KEPT_POS + 4u * i) = RW(stf_cam, CAMERA_XPOS + 4u * i);
        RW(stf_cam, CAM_KEPT_AT + 4u * i) = RW(stf_cam, CAM_AT + 4u * i);
        RH(stf_cam, CAM_KEPT_ANG + 2u * i) = RH(stf_cam, CAMERA_XANG + 2u * i);
    }
    i = frame_counter * 0x41C64E6Du + 12345u;
    RW(stf_cam, CAM_VIEW) = (i >> 16) & (cur_stage && (cur_stage->slot == 3u || cur_stage->slot == 6u) ? 3u : 7u);
    rep_mode = CAM_MODE_REP;
    for (i = 0; i < 64u * 48u; i++) TILE_L1[i] = 0x8020u;
    for (i = 0; i < 384u * 4u; i++) TILE_MASK[i] = 0xFFFFu;
    rep_on = 1u;
    rep_pass();
}

void rep_quit(void) {
    u32 i;
    for (i = 0; i < 2u; i++) RW(robs[i], ROB_KIND2) &= ~MK2_REPLAY_INIT;
    rep_pend = 0u;
    RW(stf_cam, CAMERA_FLAG) &= ~CAMERA_F_REPLAY;
    for (i = 0; i < 3u; i++) {
        RW(stf_cam, CAMERA_XPOS + 4u * i) = RW(stf_cam, CAM_KEPT_POS + 4u * i);
        RW(stf_cam, CAM_AT + 4u * i) = RW(stf_cam, CAM_KEPT_AT + 4u * i);
        RH(stf_cam, CAMERA_XANG + 2u * i) = RH(stf_cam, CAM_KEPT_ANG + 2u * i);
    }
    RW(stf_cam, CAMERA_FLAG) |= CAMERA_ROB0_DISP | CAMERA_ROB1_DISP;
    RAM8(G_SUB_MODE) = RAM8(G_SUB_MODE + 1u) = SUB_FIGHT_DSP;
    for (i = 0; i < 384u * 4u; i++) TILE_MASK[i] = 0u;
    rep_on = 0u;
}

/* a 60 Hz frame of the replay: the play task's frame, the effects, the
 * camera; a pass over, the next from the other table, or the fight */
void rep_step(void) {
    stf_task((void (*)(void))RW(stf_play, TASK_FN), stf_play, robs[0], robs[1]);
    stf_task((void (*)(void))RW(stf_effect, TASK_FN), stf_effect, robs[0], robs[1]);
    rep_cam();
    RH(stf_cam, CAMERA_CNT)++;
    if (RW(stf_play, TASK_FLAG) & TASK_ALIVE) return;
    if (--RAM8(G_REP_PASSES) == 0u) { rep_quit(); return; }
    rep_mode = CAM_MODE_REP + 1u;
    RW(stf_cam, CAM_VIEW) = (RW(stf_cam, CAM_VIEW) + 1u) & 7u;
    rep_pass();
}

/* FV's FIGHT_DSP's watch on the breaking moves; 1 once a replay starts.
 * Its marks and pending bits are the board's own: StF's set_mot_dat marks
 * (G_REP_MARK0, G_REP_TIME) and clears the bits at every motion's start,
 * the one that ends the breaking move too. */
u32 rep_watch(void) {
    u32 p, k[2];
    for (p = 0; p < 2u; p++) {
        k[p] = RW(robs[p], ROB_KIND2);
        if (k[p] & MK2_REPLAY_INIT) rep_pend |= 1u << p;
        if ((k[p] & ~rep_prev[p]) & MK2_REPLAY) {
            rep_mark[p] = RW(stf_rec, REC_NEXT);
            rep_time[p] = GAME_TIMER;
            rep_pend &= ~(1u << p);
        }
    }
    for (p = 0; p < 2u; p++) {
        u32 fell = (rep_prev[p] & ~k[p]) & MK2_REPLAY;
        rep_prev[p] = k[p];
        if (fell && (rep_pend & 1u << p) && !rep_on) rep_start(p);
    }
    return rep_on;
}

/* a round's start: no replay */
void rep_round(void) {
    rep_on = rep_prev[0] = rep_prev[1] = rep_pend = 0u;
    RAM8(G_REP_FLAG) = 0u;
}

/* a match from the boot state: no marks, no clocks */
void rep_forget(void) {
    rep_mark[0] = rep_mark[1] = 0u;
    rep_time[0] = rep_time[1] = 0;
}
