/*
 * sky.c — the guest stages' sky on the tilemap: VF2's and FV's panorama,
 * streamed a column at a time as the camera turns, and the storm's flashes
 * and bolt.
 */
#include "megamix.h"

/* VF2's sky (tools/stages/vf2-stages.mjs vf2SkyPlan), as 0x24314 sets it up at
 * stage start and 0x24534 moves it every frame; FV's (tools/stages/fv-stages.mjs
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

void sky_load(const sky_t *s) {
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

void sky_frame(const stage_t *st) {
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
void sky_storm_frame(const stage_t *st) {
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
