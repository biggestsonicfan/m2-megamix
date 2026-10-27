/*
 * cop.c — the coprocessor's matrix and the model-table submits.
 *
 * Every draw on the board goes through the coprocessor's current matrix
 * (cop_load, cop_read) and a submit of a model-table object under it
 * (submit_cur, submit_mat), the object path m2_obj.h proves on the real
 * geometrizer; mat_mul and mat_turn do the stages' matrix products there
 * too, where soft float was half a frame's work.
 */
#include "megamix.h"

/* The faces of every object submitted since it was last zeroed: the high
 * half of the model's header word 3 (obc), its face count, the low half
 * its link count (culled links too), which StF's POLYGON sums instead
 * (set_obj_go). The setup menu shows both (poly_win_draw). */
u32 polys;

/* The coprocessor's current matrix: m loaded (op 0x04, its turn and its
 * place), m's turn alone (no place), or read back (op 0x05). */
void cop_load(const mat_t *m) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    int i;
    *cf = COP_WMATRIX;
    for (i = 0; i < 9; i++) *cf = m2_obj_fb(m->r[i]);
    for (i = 0; i < 3; i++) *cf = m2_obj_fb(m->t[i]);
}

void cop_load_turn(const mat_t *m) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    int i;
    *cf = COP_WMATRIX;
    for (i = 0; i < 9; i++) *cf = m2_obj_fb(m->r[i]);
    for (i = 0; i < 3; i++) *cf = 0u;
}

void cop_read(mat_t *m) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    int i;
    *cf = COP_RMATRIX;
    for (i = 0; i < 9; i++) m->r[i] = m2_cop_gf();
    for (i = 0; i < 3; i++) m->t[i] = m2_cop_gf();
}

/* Submit one model-table object under the coprocessor's current matrix.
 * With ov nonzero, word ow of the model's header is ov instead: 0 its
 * texture points and 1 its texture headers, as set_obj_tpd and set_obj_thd
 * do; 2 the object's address, as the midriff's in polygon RAM. */
void submit_cur_ov(u32 model, u32 ow, u32 ov) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    volatile const u32 *mh = (volatile const u32 *)(M2_MODEL_TABLE + model * 16u);
    u32 hdr[4];
    int i;
    for (i = 0; i < 4; i++) hdr[i] = mh[i];
    if (ov) hdr[ow] = ov;
    polys += hdr[3] >> 16;
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

/* The same under the matrix m (model -> camera). */
void submit_mat_ov(u32 model, const mat_t *m, u32 ow, u32 ov) {
    cop_load(m);
    submit_cur_ov(model, ow, ov);
}

void submit_mat(u32 model, const mat_t *m) { submit_mat_ov(model, m, 0u, 0u); }

void submit_cur(u32 model) { submit_cur_ov(model, 0u, 0u); }

/* a = b * c (both column-major with translation), on the coprocessor: each
 * column of a is b's rotation times c's (op 0x29 with no translation), and
 * b's translation is added after. In soft float the stage's products were
 * half the board's work per frame. */
void mat_mul(mat_t *a, const mat_t *b, const float *c) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    int i, j;
    cop_load_turn(b);
    for (i = 0; i < 4; i++) {
        float *o = i < 3 ? &a->r[i * 3] : a->t;
        *cf = COP_M2W;
        for (j = 0; j < 3; j++) *cf = m2_obj_fb(c[i * 3 + j]);
        for (j = 0; j < 3; j++) o[j] = m2_cop_gf();
    }
    for (j = 0; j < 3; j++) {
        *cf = COP_FADD; *cf = m2_obj_fb(a->t[j]); *cf = m2_obj_fb(b->t[j]);
        a->t[j] = m2_cop_gf();
    }
}

/* m = m * ang(a), op one of COP_ANG_X, COP_ANG_Y, on the coprocessor */
void mat_turn(mat_t *m, u32 op, u32 a) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    cop_load(m);
    *cf = op; *cf = a & 0xFFFFu;
    cop_read(m);
}
