/*
 * texture.c — the texture sets (StF's loader, its raw pages sent as they
 * are) and the palettes of every model the fighters can draw.
 */
#include "megamix.h"

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
void tex_load_set(u32 page) {
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
void load_palettes(void) {
    u32 a, i, p, m;
    for (a = 0; a < POSE_ANIMS; a++)
        for (p = 0; p < 2u; p++) {
            const u32 *parts = *(const u32 *const *)stf_char(pose_anim(a)->chr + p * 26u);
            for (i = 0; i < 16u; i++) if (parts[i]) m2_load_model_palette(parts[i]);
            kage_palettes(pose_anim(a)->chr + p * 26u);
            /* the spin attack's ball and blur (character_spin_mot_objects) */
            for (i = 0; i < 2u; i++)
                if ((m = *(const u16 *)(STF_SPIN_MOT + (pose_anim(a)->chr + p * 26u) * 0x20u + i * 2u)) != 0u)
                    m2_load_model_palette(m);
            if (char_game(pose_anim(a)->chr) != GAME_STF) continue;
            for (i = 0; i < pose_anim(a)->nparts; i++)
                m2_load_model_palette(p ? pose_anim(a)->parts[i].p2 : pose_anim(a)->parts[i].model);
        }
    m2_load_model_palette(0x195u);  /* rob_kage_disp_test's slot 0 ball */
    m2_load_model_palette(0x736u);  /* tobi_kage_disp: a projectile's shadow */
    m2_load_model_palette(0x323u);  /* spin_smoke_cnt's puffs, young and old */
    m2_load_model_palette(0x324u);
}
