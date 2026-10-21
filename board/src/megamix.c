/*
 * megamix.c — Fighters Megamix on the Sonic the Fighters board (Model 2B).
 *
 * A new program for the board, built on m2-sdk. Sonic the Fighters' program is
 * the map: its data ROMs stay on the board, and this draws their fighters the
 * way its calc_unit_mat does, one part matrix per slot on the coprocessor.
 *
 * This draws two fighters in their stance on an StF stage. The poses, stage
 * draw lists and colour runs come from tools/bake-board.mjs (src/poses.h); each part is loaded with COP op 0x04
 * (Fn_load_matrix: three columns, then the translation) and submitted with
 * op 0x78, the object path m2_obj.h proves on the real geometrizer.
 */
#include "m2.h"
#include "m2_obj.h"
#include "stf_tex_codec.h"   /* the SDK's, with room for StF's stage sets */
#include "poses.h"

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

/* Submit one model-table object under the matrix m (model -> camera). */
static void submit_mat(u32 model, const mat_t *m) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    volatile const u32 *hdr = (volatile const u32 *)(M2_MODEL_TABLE + model * 16u);
    int i;
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

typedef struct { const pose_anim_t *anim; float x; int face; u32 frame; } fighter_t;

/* The camera: at (0, CAM_Y, CAM_Z), looking along +z, pitched down by an angle
 * whose sine and cosine are CAM_S and CAM_C (8 degrees). */
#define CAM_Y 1.1f
#define CAM_Z (-4.6f)
#define CAM_S 0.139173f
#define CAM_C 0.990268f
static mat_t cam;

static void camera_init(void) {
    int i;
    for (i = 0; i < 9; i++) cam.r[i] = 0.0f;
    cam.r[0] = 1.0f;                       /* a turn about x: y' = c y - s z, z' = s y + c z */
    cam.r[4] = CAM_C; cam.r[5] = CAM_S;
    cam.r[7] = -CAM_S; cam.r[8] = CAM_C;
    cam.t[0] = 0.0f;
    cam.t[1] = -(CAM_C * CAM_Y - CAM_S * CAM_Z);
    cam.t[2] = -(CAM_S * CAM_Y + CAM_C * CAM_Z);
}

/* A fighter in the world: facing +x (face 1), or turned half way round about
 * y to face -x, standing at (x, 0, 0). A motion's forward is +x in the board's
 * frame, and board and camera share y up. */
static void place(mat_t *w, const fighter_t *f) {
    float s = f->face > 0 ? 1.0f : -1.0f;
    float m[12] = { 0 };
    m[0] = s; m[4] = 1.0f; m[8] = s;
    m[9] = f->x;
    mat_mul(w, &cam, m);
}

static void draw_fighter(const fighter_t *f) {
    const pose_anim_t *a = f->anim;
    const float (*mats)[12] = a->mats[f->frame % a->frames];
    mat_t w, m;
    u32 i;
    place(&w, f);
    for (i = 0; i < a->nparts; i++) {
        mat_mul(&m, &w, mats[a->parts[i].slot]);
        submit_mat(a->parts[i].model, &m);
    }
}

static void draw_stage(const stage_t *st) {
    mat_t m;
    u32 i;
    for (i = 0; i < st->ndraws; i++) {
        mat_mul(&m, &cam, st->draws[i].m);
        submit_mat(st->draws[i].model, &m);
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
 * StF's loader does), its colour bases and its rows of colorxlat. */
static void load_stage(const stage_t *st) {
    u32 i;
    tex_load_set(st->texset);
    cx_put(&st->cx);
    for (i = 0; i < st->ndraws; i++) m2_load_model_palette(st->draws[i].model);
}

static void load_palettes(void) {
    u32 a, i;
    for (a = 0; a < POSE_ANIMS; a++)
        for (i = 0; i < pose_anims[a].nparts; i++)
            m2_load_model_palette(pose_anims[a].parts[i].model);
}

/* Player 1's fighter's part and skin rows (StF's player 1 rows; player 2's
 * fighter is drawn with them too for now). */
static void load_fighter_colors(const pose_anim_t *a) { cx_put(&a->cx[0]); cx_put(&a->cx[1]); }

static u32 edges(u32 now, u32 *held) { u32 e = now & ~*held; *held = now; return e; }

int main(void) {
    fighter_t fs[2];
    u32 i, pick[2] = { 0u, 1u }, stage = 0u;
    u32 held = 0u;

    m2_init();
    m2_silicon_boot();
    m2_cam_set_focus(FOCUS);
    m2_backdrop((u16)M2_RGB(4, 6, 12));
    camera_init();
    tex_load_set(SET_FIGHTERS);
    load_palettes();
    load_stage(&stages[stage]);
    load_fighter_colors(&pose_anims[pick[0]]);
    for (i = 0; i < 8u; i++) { m2_frame_begin(); m2_frame_end(); }

    fs[0].x = -1.1f; fs[0].face = 1;  fs[0].frame = 0u;
    fs[1].x =  1.1f; fs[1].face = -1; fs[1].frame = 0u;
    for (;;) {
        m2_player_t p[2];
        u32 e;
        p[0] = m2_player(0); p[1] = m2_player(1);
        /* button 1 changes that player's fighter, P1's button 2 the stage */
        e = edges((u32)p[0].b1 | (u32)p[1].b1 << 1 | (u32)p[0].b2 << 2, &held);
        for (i = 0; i < 2u; i++) {
            if (e & (1u << i)) { pick[i] = (pick[i] + 1u) % POSE_ANIMS; fs[i].frame = 0u; }
            fs[i].anim = &pose_anims[pick[i]];
        }
        if (e & 4u) { stage = (stage + 1u) % STAGES; load_stage(&stages[stage]); }
        if (e & 5u) load_fighter_colors(fs[0].anim);

        m2_frame_begin();
        m2_obj_frame_setup();
        send_materials(stages[stage].mat);
        draw_stage(&stages[stage]);
        for (i = 0; i < 2u; i++) { draw_fighter(&fs[i]); fs[i].frame++; }
        *(volatile u32 *)ZCLIP_REG = 0xFFFF00FFu;
        m2_frame_commit();
        m2_vsync(); m2_vsync();          /* 30 fps, as StF runs */
    }
    return 0;
}
