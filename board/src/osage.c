/*
 * osage.c — the sway chains (Honey's ponytail, Fang's tail): StF's osage
 * tasks, a frame of them, and the list blocks they draw into (osage_splice,
 * clear_buffer_ptr), which the effects use too.
 */
#include "megamix.h"

/* Each fighter's sway chains, a frame of them: its osage task (osage_init
 * the first time, then osage_dsp), after the fighters' part matrices.
 * set_obj_fifo puts each segment straight in the list (a matrix, then the
 * object from the model table) and counts its polygons in POLYGON against
 * POLYGON_LIMIT, which main_loop starts at 0 every frame; the board's own
 * models go through the coprocessor and keep their own count. In a fight
 * osage_dsp draws on the coprocessor's matrix as it finds it, the fighters'
 * unscaled camera (cam_l: set_obj_fifo skips a segment whose m00 is past
 * 1); only the select screen loads 0x501128. */
void osage_step(void) {
    u32 p;
    cop_load(&cam_l);
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
void clear_buffer_ptr(void) {
    u32 *e = (u32 *)stf_ram(G_LIST_BLOCKS), i;
    for (i = 0; i < 43u; i++) e[i] = 0u;
}

/* rob_disp's head entry (unit_efc_kao): layer n's blocks run here (player
 * n's osage blocks; layer 6 both players' mirrored ones, which osage_dsp
 * lays on Aurora Icefield). A word, after which the last block's jump comes
 * back (or, with no block yet, the first one's place); the word becomes the
 * jump to the first. */
void osage_splice(u32 n) {
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
void osage_camera(void) {
    u32 *c0 = (u32 *)stf_ram(G_ROB_CAMERA0), *c1 = (u32 *)stf_ram(G_ROB_CAMERA1), i;
    for (i = 0; i < 9; i++) c0[i] = c1[i] = m2_obj_fb(cam.r[i]);
    for (i = 0; i < 3; i++) c0[9 + i] = c1[9 + i] = m2_obj_fb(cam.t[i]);
}
