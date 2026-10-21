/*
 * megamix.c — Fighters Megamix on the Sonic the Fighters board (Model 2B).
 *
 * A new program for the board, built on m2-sdk. Sonic the Fighters' program is
 * the map: its data ROMs stay on the board, and this draws their fighters the
 * way its calc_unit_mat does, one part matrix per slot on the coprocessor.
 *
 * This first step draws two fighters in their stance. The poses come from
 * tools/bake-poses.mjs (src/poses.h); each part is loaded with COP op 0x04
 * (Fn_load_matrix: three columns, then the translation) and submitted with
 * op 0x78, the object path m2_obj.h proves on the real geometrizer.
 */
#include "m2.h"
#include "m2_obj.h"
#include "m2_tex_codec.h"
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

typedef struct { const pose_anim_t *anim; float x, z; int face; u32 frame; } fighter_t;

/* A fighter's place in camera space: facing +x (face 1), or turned half way
 * round about y to face -x, then moved to (x, y, z). A motion's forward is +x
 * in the board's frame, and board and camera share y up. */
static void place(mat_t *w, const fighter_t *f) {
    float s = f->face > 0 ? 1.0f : -1.0f;
    int i;
    for (i = 0; i < 9; i++) w->r[i] = 0.0f;
    w->r[0] = s; w->r[4] = 1.0f; w->r[8] = s;
    w->t[0] = f->x; w->t[1] = -1.0f; w->t[2] = f->z;
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

static void load_palettes(void) {
    u32 a, i;
    for (a = 0; a < POSE_ANIMS; a++)
        for (i = 0; i < pose_anims[a].nparts; i++)
            m2_load_model_palette(pose_anims[a].parts[i].model);
}

int main(void) {
    fighter_t fs[2];
    u32 i, pick[2] = { 0u, 1u };
    u32 held = 0u;

    m2_init();
    m2_silicon_boot();
    m2_cam_set_focus(FOCUS);
    m2_backdrop((u16)M2_RGB(4, 6, 12));
    tex_load_atlas(SET_FIGHTERS, 0u);
    load_palettes();
    for (i = 0; i < 8u; i++) { m2_frame_begin(); m2_frame_end(); }

    fs[0].x = -1.1f; fs[0].z = 4.5f; fs[0].face = 1;  fs[0].frame = 0u;
    fs[1].x =  1.1f; fs[1].z = 4.5f; fs[1].face = -1; fs[1].frame = 0u;
    for (;;) {
        m2_player_t p[2];
        u32 now = 0u;
        p[0] = m2_player(0); p[1] = m2_player(1);
        /* button 1 changes that player's fighter */
        for (i = 0; i < 2u; i++) {
            if (p[i].b1) now |= 1u << i;
            if ((now & ~held) & (1u << i)) { pick[i] = (pick[i] + 1u) % POSE_ANIMS; fs[i].frame = 0u; }
            fs[i].anim = &pose_anims[pick[i]];
        }
        held = now;

        m2_frame_begin();
        m2_obj_frame_setup();
        for (i = 0; i < 2u; i++) { draw_fighter(&fs[i]); fs[i].frame++; }
        *(volatile u32 *)ZCLIP_REG = 0xFFFF00FFu;
        m2_frame_commit();
        m2_vsync(); m2_vsync();          /* 30 fps, as StF runs */
    }
    return 0;
}
