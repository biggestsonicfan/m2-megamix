/*
 * stage.c — a stage: its load (textures, colours, sky, light, palettes),
 * its draw list each frame (draw_stage: the cage's clipping, FV's sides and
 * swinging bear, the turning town, the storm's light) and its materials.
 */
#include "megamix.h"

/* FV's turning town and its light count from the round start: 0xC568 puts
 * word_50A022 back to 0, so the town snaps home with the objects each round. */
u32 turn_at;
/* the Western bear's pendulum (kuma_step) */
static int kuma_p, kuma_v;
static u32 kuma_at;

/* VF2's Colosseum storm (VF2 0x2468C), storm[] its four channels by frame:
 * while channel 3 is on, the arena is lit, each draw its lit twin and the
 * light the flash's. */
u32 storm_lit(const stage_t *st) {
    return st->storm && (st->storm[frame_counter % FLASH_FRAMES] & 8u);
}

void stage_light(const stage_t *st) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    u32 lit = storm_lit(st);
    cop_load_turn(&cam_l);
    /* FV's turning town turns its light with it (0x1EF94) */
    *cf = COP_ANG_Y; *cf = (u32)(int)(lit ? st->flash[2] : st->vy) + st->turn * (frame_counter - turn_at);
    *cf = COP_ANG_X; *cf = (u32)(int)(lit ? st->flash[1] : st->vx);
    m2_cop_m2w(0.0f, 0.0f, lit ? st->flash[0] : st->bright, light);
}

/* a round's start: FV's town and bear home (0xC568's word_50A022 back to 0) */
void stage_round_start(void) {
    turn_at = kuma_at = frame_counter;
    kuma_p = kuma_v = 0;
}

/* The stage the fight is on (load_stage). */
const stage_t *cur_stage;

/* cage_clip_m's test for one cage panel, as StF does it: the panel's matrix
 * (model -> camera) goes to the coprocessor, and each of its two ends, (x, 0,
 * 0) in its own frame, goes through op 0x29. StF then takes the screen x as
 * focus_dist_x * X / Z (mulr, divr) and gives the end an out-code: 0x1F when
 * Z is 2.0 or less, else bit 0 when the screen x is at or left of -248 and
 * bit 1 at or right of 248 (cmpr against 0x40000000, 0xC3780000 and
 * 0x43780000). A panel whose two ends share a bit is not drawn. The board
 * multiplies and divides on the coprocessor too (ops 0x15 and 0x16), and
 * tests StF's three constants against the results' IEEE bits as integers:
 * no float sums or compares on the i960. That is what keeps a wall the
 * camera stands just outside of (Aurora Icefield's fly-in) off the screen:
 * StF's cage_sub_check leaves it to the later cage_disp_f pass, where both
 * ends are behind the near limit. */
static u32 cage_code(volatile u32 *cf, u32 x) {
    int X, Z, sx;
    *cf = COP_M2W; *cf = x; *cf = 0u; *cf = 0u;
    X = (int)*cf; (void)*cf; Z = (int)*cf;
    if (Z <= 0x40000000) return 0x1Fu;                      /* Z <= 2.0, or negative */
    *cf = COP_FMUL; *cf = m2_obj_fb(FOCUS); *cf = (u32)X;
    sx = (int)*cf;
    *cf = COP_FDIV; *cf = (u32)sx; *cf = (u32)Z;
    sx = (int)*cf;
    if (sx < 0) return (sx & 0x7FFFFFFF) >= 0x43780000 ? 1u : 0u;  /* <= -248.0 */
    return sx >= 0x43780000 ? 2u : 0u;                      /* >= 248.0 */
}

static int cage_clip(const mat_t *m, u32 x0, u32 x1) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    cop_load(m);
    return (cage_code(cf, x0) & cage_code(cf, x1)) != 0u;
}

/* FV's cage side test (cage_display's byte_500288): a side is drawn only
 * while the camera is inside its plane. The panel's z axis points out of the
 * arena (its matrix puts it at z -6 in FV's units), so the camera, at the
 * origin of m's frame, is inside while m's translation is along that axis:
 * dot(t, z axis) < 0. The dot is one op 0x29 on the coprocessor with t as
 * the first row; its sign bit is the answer. */
static int fv_side_in(const mat_t *m) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    int i;
    u32 d;
    *cf = COP_WMATRIX;
    for (i = 0; i < 3; i++) { *cf = m2_obj_fb(m->t[i]); *cf = 0u; *cf = 0u; }
    for (i = 0; i < 3; i++) *cf = 0u;
    *cf = COP_M2W;
    for (i = 6; i < 9; i++) *cf = m2_obj_fb(m->r[i]);
    d = *cf; (void)*cf; (void)*cf;
    return (d & 0x80000000u) != 0u;
}

/* FV's Western bear (kuma_int, 0x6C254): an integer pendulum, a step each
 * 60 Hz frame; the bear swings about x by the negated top half of its
 * place. The hop (a fighter knocked into the wall before it) is the cage
 * break's, which the board does not have. */
static void kuma_step(void) {
    while (kuma_at != frame_counter) {
        int t = 0x2000 + kuma_v;
        kuma_p += t;
        if (kuma_p >= 0x10000000) { t = 0x2000 + t; if (t > 0) t = -t; }
        kuma_v = t;
        kuma_at++;
    }
}

/* DOA's swaying draws: the draw's place with its turn at this frame of the
 * round (tools/bake-board.mjs, stage_draw_t's sway) */
static void sway_mul(mat_t *m, const stage_draw_t *d) {
    const short *s = d->sway + ((frame_counter - turn_at) % SWAY_FRAMES) * 9u;
    float w[12];
    u32 k;
    for (k = 0; k < 9u; k++) w[k] = (float)s[k] * (1.0f / 8192.0f);
    for (k = 9; k < 12u; k++) w[k] = d->m[k];
    mat_mul(m, &cam, w);
}

void draw_stage(const stage_t *st) {
    mat_t m, ct;
    u32 i, model, x0, x1;
    if (st->turn) {
        /* FV's turning town: cam * ang_y(turn * frame) under the draws marked turn */
        ct = cam;
        mat_turn(&ct, COP_ANG_Y, st->turn * (frame_counter - turn_at));
    }
    kuma_step();
    for (i = 0; i < st->ndraws; i++) {
        /* FV's windows (fvBoardPlan): each covers the ones before it */
        if (st->draws[i].win) m2_geo_fifo_window_full();
        if (st->draws[i].sway) sway_mul(&m, &st->draws[i]);
        else mat_mul(&m, st->draws[i].turn ? &ct : &cam, st->draws[i].m);
        if (st->draws[i].side && !fv_side_in(&m)) continue;
        if (st->draws[i].swing) mat_turn(&m, COP_ANG_X, (u32)-(kuma_p >> 16));
        /* StF's sky and Aurora's diamonds turn, a steady step a frame */
        if (st->draws[i].spin) mat_turn(&m, COP_ANG_Y, st->draws[i].spin * frame_counter);
        x0 = m2_obj_fb(st->draws[i].x0); x1 = m2_obj_fb(st->draws[i].x1);
        if (x0 != x1 && cage_clip(&m, x0, x1)) continue;
        model = st->draws[i].model;
        if (st->lit && storm_lit(st)) model = st->lit[i];
        /* South Island's palms and their shadow sway: a model from a table by frame */
        if (st->draws[i].anim) model = st->draws[i].anim[((frame_counter >> st->draws[i].shift) + st->draws[i].phase) & st->draws[i].mask];
        if (st->wind && i == st->wind_at) model = st->wind[(frame_counter >> st->wind_shift) & 255u];
        if (model == 0u) continue;       /* VF2's: nothing in this look or frame */
        if (st->tpd.kind != 0u && model == st->tpd.model) submit_mat_ov(model, &m, st->tpd.kind == 1u ? 0u : 1u, TPD_ADDR);
        else submit_mat(model, &m);
    }
}

/* set_material + sub_29148, which StF's camera_init runs every frame: the
 * stage's 32 material slots (diffuse, ambient, specular) as GEO texture
 * parameters, each with its coefficient from flt_90BA0. m2_obj_frame_setup
 * fills all 32 with one value, so this goes after it. */
void send_materials(const u32 *mat) {
    volatile u32 *fifo = (volatile u32 *)M2_GEOFIFO_ADDR;
    u32 i;
    *fifo = GEO_OP_TEXPARAM; *fifo = 0u; *fifo = 0x20u;
    for (i = 0; i < 0x20u; i++) { *fifo = mat[i]; *fifo = geo_mat_int[i]; }
}

/* A stage: its texture set (each page to the bank its own origin names, as
 * StF's loader does), its colour bases, its rows of colorxlat and their
 * cycling curve, its backdrop colour and its light. */
void load_stage(u32 n) {
    const stage_t *st = &stages[n];
    u32 i, j;
    cur_stage = st;
    kuma_p = kuma_v = 0; kuma_at = frame_counter;
    tex_load_set(st->texset);
    stage_colors(st);
    sky_load(st->sky);                   /* after the colorxlat: palette_w reads it */
    bg_col_set(st->bg);                  /* scr_bg_int: the record's stage_bg_color */
    stage_light(st);
    kage_stage(st);
    for (i = 0; i < st->ndraws; i++) {
        if (st->draws[i].model) m2_load_model_palette(st->draws[i].model);
        if (st->draws[i].anim)
            for (j = 0; j <= st->draws[i].mask; j++) m2_load_model_palette(st->draws[i].anim[j]);
        if (st->lit && st->lit[i]) m2_load_model_palette(st->lit[i]);
    }
    if (st->wind) for (i = 0; i < 256u; i++) if (st->wind[i]) m2_load_model_palette(st->wind[i]);
}
