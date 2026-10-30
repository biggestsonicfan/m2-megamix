/*
 * kage.c — the fighters' shadows, StF's own (docs/SHADOWS.md): the balls
 * each shadow slot tests, the stage's light and ground, and the two passes
 * (inside the ring after the stage, outside it after each fighter).
 */
#include "megamix.h"

/* The ball each shadow slot's mask tests, for each fighter, to the
 * coprocessor at 0x306E0 + slot (player 1) and 0x307E0 + slot (player 2):
 * send_kage_ball_pntr's sends, which read StF's table at 0x4C84, where the
 * board has its own code. StF's fighters take StF's table; the guests ride
 * VF2's ball record, so they take the middle ball of each of VF2's slot
 * lists (0x2007BEE), slot 0 that of slot 9, as VF2 does. */
static const u8 kage_ball_stf[16] = { 9, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16 };
static const u8 kage_ball_vf2[16] = { 3, 0, 2, 4, 6, 8, 9, 11, 13, 3, 15, 18, 20, 23, 26, 28 };

#define COP_POKE COP_CMD(0x49)           /* in: address, word: the word to the coprocessor's memory */
void kage_balls(void) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    u32 p, i;
    for (p = 0; p < 2u; p++) {
        const u8 *b = char_game(RB(robs[p], ROB_CHAR_IS)) == GAME_STF ? kage_ball_stf : kage_ball_vf2;
        for (i = 0; i < 16u; i++) {
            *cf = COP_FADD; *cf = COP_FADD; *cf = COP_FADD; (void)*cf;   /* a fence */
            *cf = COP_POKE; *cf = (p ? 0x307E0u : 0x306E0u) + i; *cf = b[i];
        }
    }
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

void kage_mode(void) {
    volatile u32 *fifo = (volatile u32 *)M2_GEOFIFO_ADDR;
    *fifo = GEO_OP_MODE; *fifo = GEO_MODE_NP_NS;
}

/* change_scene's part: the light (VECTER_X, VECTER_Y) and stage_soko, the
 * ground below the ring the far pass lays its shadows on (sub_29350: the
 * stage record's +0xC8). A guest stage keeps all its shadows on the ring
 * (stage_soko 0), whose floor is y = 0. */
void kage_stage(const stage_t *st) {
    RAM16(G_VECTER_X) = (u16)st->vx;
    RAM16(G_VECTER_Y) = (u16)st->vy;
    RAM32(G_STAGE_SOKO) = st->slot != 0xFFFFu ? *(const u32 *)(STF_STAGE_REC(st->slot) + STAGE_SOKO) : 0u;
}

void kage_light(const stage_t *st) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    u32 vx, vy;
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
    cop_load(&cam_l);
    stf_call(stf_sub_63AC4, robs[0], robs[1], 0u);
}

void kage_inside(const stage_t *st) {
    u32 p;
    if (st->slot == KAGE_NO_INSIDE) return;
    for (p = 0; p < 2u; p++) stf_call(stf_rob_kage_disp_inside, robs[p], robs[p ^ 1u], 0u);
    kage_mode();
}

void kage_outside(u32 p) {
    stf_call(stf_rob_kage_disp_outside, robs[p], robs[p ^ 1u], 0u);
    kage_mode();
}
