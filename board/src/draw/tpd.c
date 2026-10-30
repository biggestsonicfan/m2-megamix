/*
 * tpd.c — the texture points that move each frame (move_tpd_send): a
 * stage's sliding aurora or walking sea, and the fighters' eyes.
 */
#include "megamix.h"

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

void move_tpd_send(const tpd_t *t) {
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
void eyes_frame(const tpd_t *st) {
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
