/*
 * ringout.c — VF2's ring out on its stages: a fighter past the ring's edge
 * falls, and loses the round once he lands outside it.
 */
#include "megamix.h"

/* each fighter's frames since its root left the ring (0: inside) */
static u32 rout[2];
u32 ring_out;
static u32 rout_vy[2];            /* its fall's speed, a float's bits */

/* a round's start: both inside */
void ring_out_reset(void) {
    rout[0] = rout[1] = ring_out = 0u;
    rout_vy[0] = rout_vy[1] = 0u;
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

void ring_out_step(const stage_t *st) {
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
void ring_msg(u32 on) {
    u32 y, c;
    put_at(MSG_COL, MSG_ROW, on ? "RING OUT" : "        ", on ? T_INV : 0x8020u);
    if (on) { mask_rect(MSG_COL, MSG_ROW, 8u, 1u); return; }
    for (y = MSG_ROW * 8u; y < MSG_ROW * 8u + 8u; y++)
        for (c = MSG_COL; c < MSG_COL + 8u; c++) TILE_MASK[y * 4u + (c >> 4)] &= (u16)~(0x8000u >> (c & 15u));
}
