/*
 * colors.c — the colours (colorxlat): a stage's rows, as StF's own routines
 * set them, each fighter's part and skin rows, and the backdrop colour.
 */
#include "megamix.h"

/* Lay a baked run of colorxlat (R, G and B planes, row by row) over the SDK's ramp. */
void cx_put(const cx_run_t *c) {
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
void stage_colors(const stage_t *st) {
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
    stf_call_g01(stf_send_tex_col_stage, 14u, *(const u16 *)(STF_STAGE_REC(st->slot) + STAGE_TEX_COL));
}

/* A player's part and skin rows: StF's send_tex_col_part and skin for its
 * fighter (player 1's rows 0..4 and 28..29, player 2's 7..11 and 30..31),
 * a guest's own (seven part rows, over StF's fixed rows 5, 6, 12, 13). */
void fighter_colors(u32 p, const pose_anim_t *a) {
    if (a->cx[0].rows) { cx_put(&a->cx[p * 2u]); cx_put(&a->cx[p * 2u + 1u]); return; }
    stf_call_g01(stf_send_tex_col_skin, p, RB(robs[p], ROB_CHAR));
    stf_call_g01(stf_send_tex_col_part, p, RB(robs[p], ROB_CHAR));
}

/* bg_col_set: the backdrop colour in pen 0 of palette banks 0..63, where
 * the 3D layer shows it. StF's scr_bg_int sets it after MES_ROUND_INT's
 * scroll colours, whose tables put 0xB60A (a dark green) there. */
void bg_col_set(u16 c) {
    u32 i;
    for (i = 0; i < 64u; i++) M2_PALETTE[i * 16u] = c;
}

/* Each player's fighter's part and skin rows. */
void load_fighter_colors(const pose_anim_t *p1, const pose_anim_t *p2) {
    fighter_colors(0u, p1);
    fighter_colors(1u, p2);
}
