/*
 * stage.c — a stage: its load (textures, colours, sky, light, palettes),
 * its draw list each frame (draw_stage: the cage's clipping, StF's culls of
 * the ground and the backdrop ring, FV's sides and swinging bear, the turning
 * town, the storm's light) and its materials.
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

/* StF's stage culls, which the camera object's flags (word 0) switch:
 * bit 0x10 drops ground_disp (the chunks and South Island's sea), 0x11
 * doom_cnt's backdrop ring, and 0x1B draws the whole ring untested. */
#define CAM_NO_GROUND (1u << 0x10)
#define CAM_NO_RING   (1u << 0x11)
#define CAM_RING_ALL  (1u << 0x1B)

static u32 cop2(volatile u32 *cf, u32 op, u32 a, u32 b) { *cf = op; *cf = a; *cf = b; return *cf; }

/* doom_cnt's test for one segment of the backdrop ring. StF reads the
 * camera's z column (op 0x58, Fn_get_z_axis: r[6..8] of the camera before
 * its 1.6, unit length) and its translation (op 0x0F), then for each segment
 * puts (-39.018, -39.018, 196.157) through the segment's own matrix
 * (identity, the stage's turns and place, the segment's turn; op 0x29) to
 * get P, and takes a = T.x - P.x and c = P.z - T.z (subr, the two the other
 * way about), len = |a, c| (op 0x2D) and the 2D dot of (z.x, z.z) with them
 * (op 0x59): the segment is not drawn when dot / len is over g1. g1 is
 * 0.866 (30 degrees behind the camera) until a segment is drawn, but the
 * draw's set_obj call clears g1 first (mov 0, g1), so from then on every
 * segment with dot / len over 0 is dropped as well: StF draws 7 to 10 of
 * the 16 (its own COP data, 524 frames of Aurora, all agree). The board's
 * draw is the segment's matrix at 1/1.6 (with doom_cnt's 1.6 tail where it
 * has one), so the point goes in at 1/1.6 of it on those and P comes out at
 * 1/1.6, as does the camera's place it is taken from (ring_t): the ratio is
 * StF's. */
static u32 ring_t[2];

static void ring_setup(volatile u32 *cf) {
    ring_t[0] = cop2(cf, COP_FMUL, m2_obj_fb(cam.t[0]), 0x3F200000u);   /* * 0.625 */
    ring_t[1] = cop2(cf, COP_FMUL, m2_obj_fb(cam.t[2]), 0x3F200000u);
}

static int ring_hidden(volatile u32 *cf, const stage_draw_t *d, int g1) {
    static const float pt[2][3] = {
        { -39.0180016f, -39.0180016f, 196.156998f },           /* 0xC21C126F, 0x43442831 */
        { -39.0180016f / 1.6f, -39.0180016f / 1.6f, 196.156998f / 1.6f } };
    const float *p = pt[d->cull == CULL_RING16];
    u32 px, pz, a, c, len, dot;
    int i;
    cop_load((const mat_t *)d->m);
    if (d->spin) { *cf = COP_ANG_Y; *cf = (d->spin * frame_counter) & 0xFFFFu; }
    *cf = COP_M2W;
    for (i = 0; i < 3; i++) *cf = m2_obj_fb(p[i]);
    px = *cf; (void)*cf; pz = *cf;
    a = cop2(cf, COP_FSUB, ring_t[0], px);
    c = cop2(cf, COP_FSUB, pz, ring_t[1]);
    len = cop2(cf, COP_MAG2D, a, c);
    *cf = COP_DOT2D; *cf = m2_obj_fb(cam_l.r[6]); *cf = a; *cf = m2_obj_fb(cam_l.r[8]); *cf = c;
    dot = *cf;
    return (int)cop2(cf, COP_FDIV, dot, len) > g1;
}

/* ground_disp's chunks through area_clip. clip_point_check_yoko puts a 5 by
 * 5 grid of points (dword_90654: x and z from -200 to 200 by 100, y 0) through
 * the stage's matrix before its 1.6 (cam times the chunks' own), and codes
 * each (at 0x50E000): 0x90 when its Z is 1.0 or less, else 0x81 when
 * focus_dist_x * 0.6667 * X / Z is at or left of -248, 0x82 at or right of
 * 248. Chunk i (stage_parts[i], row i / 4, column i % 4) has the four points
 * around it (area_clip_data) and is drawn unless the four codes share a bit;
 * as bit 7 is any of them, a chunk whose corners are all off the screen is
 * not drawn even if it spans it. Then the chunk under the camera is drawn
 * whatever its corners: the camera's place in the chunks' frame at 1.6
 * (op 0x6A of the origin, which is rot^T (-T), not divided by the scale),
 * plus 320, rounded (cvtri), over 160, & 3 in x and z. */
static u32 chunk_cell(volatile u32 *cf, u32 v) {
    v = cop2(cf, COP_FADD, v, 0x43A00000u);                      /* + 320 */
    v = cop2(cf, COP_FADD, v, (v & 0x80000000u) | 0x3F000000u);  /* round: +-0.5 */
    *cf = COP_F2INT; *cf = v;
    return (u32)*cf / 160u & 3u;
}

static u32 area_clip(volatile u32 *cf, const stage_draw_t *d) {
    static const float at[5] = { -200.0f, -100.0f, 0.0f, 100.0f, 200.0f };
    mat_t g;
    u8 oc[25];
    u32 i, k, fx, vis = 0u;
    int X, Z;
    mat_mul(&g, &cam, d->m);
    cop_load(&g);
    fx = cop2(cf, COP_FMUL, m2_obj_fb(FOCUS), 0x3F2AACDAu);     /* * 0.6667 */
    for (i = 0; i < 25u; i++) {
        *cf = COP_M2W; *cf = m2_obj_fb(at[i % 5u]); *cf = 0u; *cf = m2_obj_fb(at[i / 5u]);
        X = (int)*cf; (void)*cf; Z = (int)*cf;
        if (Z <= 0x3F800000) { oc[i] = 0x90u; continue; }       /* Z <= 1.0, or negative */
        X = (int)cop2(cf, COP_FMUL, fx, (u32)X);
        X = (int)cop2(cf, COP_FDIV, (u32)X, (u32)Z);
        if (X < 0) oc[i] = (X & 0x7FFFFFFF) >= 0x43780000 ? 0x81u : 0u;
        else oc[i] = X >= 0x43780000 ? 0x82u : 0u;
    }
    for (i = 0; i < 16u; i++) {
        k = i / 4u * 5u + i % 4u;
        if ((oc[k] & oc[k + 1u] & oc[k + 5u] & oc[k + 6u]) == 0u) vis |= 1u << i;
    }
    *cf = COP_SCALE; *cf = 0x3FCCCCCDu; *cf = 0x3FCCCCCDu; *cf = 0x3FCCCCCDu;
    *cf = COP_W2M; *cf = 0u; *cf = 0u; *cf = 0u;
    X = (int)*cf; (void)*cf; Z = (int)*cf;
    return vis | 1u << (chunk_cell(cf, (u32)X) + 4u * chunk_cell(cf, (u32)Z));
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
 * round (tools/board/bake-board.mjs, stage_draw_t's sway) */
static void sway_mul(mat_t *m, const stage_draw_t *d) {
    const short *s = d->sway + ((frame_counter - turn_at) % SWAY_FRAMES) * 9u;
    float w[12];
    u32 k;
    for (k = 0; k < 9u; k++) w[k] = (float)s[k] * (1.0f / 8192.0f);
    for (k = 9; k < 12u; k++) w[k] = d->m[k];
    mat_mul(m, &cam, w);
}

void draw_stage(const stage_t *st) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    mat_t m, ct;
    u32 i, model, x0, x1, cull, chunks = 0u, clipped = 0u, ringed = 0u;
    int g1 = 0;
    u32 camf = RW(stf_cam, CAMERA_FLAG);
    if (st->turn) {
        /* FV's turning town: cam * ang_y(turn * frame) under the draws marked turn */
        ct = cam;
        mat_turn(&ct, COP_ANG_Y, st->turn * (frame_counter - turn_at));
    }
    kuma_step();
    for (i = 0; i < st->ndraws; i++) {
        /* FV's windows (fvBoardPlan): each covers the ones before it */
        if (st->draws[i].win) m2_geo_fifo_window_full();
        cull = st->draws[i].cull;
        if (cull >= CULL_CHUNK || cull == CULL_SEA) {
            if (camf & CAM_NO_GROUND) continue;
            if (cull >= CULL_CHUNK) {
                if (!clipped) { chunks = area_clip(cf, &st->draws[i]); clipped = 1u; }
                if (!(chunks >> (cull - CULL_CHUNK) & 1u)) continue;
            }
        } else if (cull) {
            if (camf & CAM_NO_RING) continue;
            if (!(camf & CAM_RING_ALL)) {
                if (!ringed) { ring_setup(cf); ringed = 1u; g1 = 0x3F5DB3D7; }   /* 0.866 */
                if (ring_hidden(cf, &st->draws[i], g1)) continue;
                g1 = 0;
            }
        }
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

u32 stage_index(void) { return cur_stage ? (u32)(cur_stage - stages) : 0u; }

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
