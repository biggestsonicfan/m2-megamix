/*
 * fighter_draw.c — rob_disp: a fighter's sixteen parts from their slots, the
 * eyes, a guest's midriff and seams built in polygon RAM, the spin attack's
 * ball and smoke, and the reflections Aurora Icefield draws in its ice.
 */
#include "megamix.h"

/* rob_disp: under the unscaled camera, each of the sixteen parts with a model, from
 * its slot (op 0x37 multiplies the slot into the current matrix) after a
 * scale of (1, y, 1); then the eyes, on the head's slot: rob_disp_rdn_loop
 * draws the face's two (ROB_EYE_MODEL) with set_obj_tpd, on the texture
 * points snc_eye_thd_set moved (ROB_EYE_TPD), or with set_obj, their own
 * points, while ROB_F_NO_EYES is set or in motion 0x134. */
#define COP_PART COP_CMD(0x37)

/* A slot's matrix (op 0x37 on the identity), read back. */
static void slot_mat(mat_t *m, u32 p, u32 slot) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    *cf = COP_IDENTITY;
    *cf = COP_PART; *cf = p; *cf = slot * 12u;
    cop_read(m);
}

/* The midriff of a VF2 or Fighting Vipers fighter (the guest table midriff,
 * by drawn character; tools/vf2-guest.mjs): the band from a ring on the
 * hips to a ring on the chest that closes the waist; StF's fighters have
 * none. As VF2's calc_unit_mat (0x16F3C) builds it: the chest's ring
 * carried into the hips' frame (H^-1 C p), then geometrizer command 5
 * writes the links to polygon RAM at player << 8, each point a chest point
 * where its index byte is 8 or more, else the link's own (the hips' ring,
 * in the hips' frame already), and the closing word. Returns the model to
 * draw it with (0: none). Leaves the coprocessor's matrix changed. */
#define MID_POLY(p) ((p) << 8)
static u32 midriff_build(u32 p) {
    volatile u32 *fifo = (volatile u32 *)M2_GEOFIFO_ADDR;
    const u32 *mid = *(const u32 *const *)(STF_GUEST_midriff + RB(robs[p], ROB_CHAR) * 4u);
    const float (*ring)[3];
    const u32 *w;
    const u8 *idx;
    float c[8][3];
    mat_t h, ch;
    u32 n, k, j, i;
    if (mid == 0) return 0u;
    n = mid[1]; ring = (const float (*)[3])&mid[2]; w = &mid[2 + 24]; idx = (const u8 *)&w[10u * n + 1u];
    slot_mat(&h, p, 9u);
    slot_mat(&ch, p, 1u);
    carry(&h, &ch, ring, c, 8u);
    *fifo = GEO_OP_POLYDATA; *fifo = MID_POLY(p); *fifo = 10u * n + 1u;
    for (k = 0; k < n; k++, w += 10) {
        for (j = 0; j < 4u; j++) *fifo = w[j];
        for (j = 0; j < 2u; j++) {
            u32 q = idx[k * 2u + j];
            for (i = 0; i < 3; i++) *fifo = q >= 8u ? m2_obj_fb(c[q - 8u][i]) : w[4u + j * 3u + i];
        }
    }
    *fifo = *w;
    return mid[0];
}

/* A mesh built in polygon RAM, at `at`, on the current matrix: rob_disp's
 * slot 9 entry (0x195F8) draws the midriff so on the hips' matrix, from past
 * the first attribute and normal; a seam goes so on its slot S. The model
 * gives the texture points and material. Geometrizer mode 2: the board works
 * out each face's normal from its points, so the mesh shades as it bends
 * (VF2's mode 3 adds the specular VF2 draws with; the board draws in mode 0,
 * without). The list's end goes after the mode word, as after a submit. */
static void poly_draw(u32 model, u32 at) {
    volatile u32 *fifo = (volatile u32 *)M2_GEOFIFO_ADDR;
    *fifo = GEO_OP_MODE; *fifo = GEO_MODE_NN_NS;
    submit_cur_ov(model, 2u, at);
    *fifo = GEO_OP_MODE; *fifo = GEO_MODE_NP_NS;
    *(volatile u32 *)(GEO_BUFFERRAM + (*(volatile u32 *)COP_WPOS_REG & 0x0001FFFCu)) = GEO_OP_END;
}

/* The seams of a fighter whose meshes span his joints (the guest table
 * seams, by drawn character; tools/ryo-guest.mjs): each a mesh drawn on its
 * slot S whose far corners ride slot O, so it stretches over the joint as
 * the mesh skins on its own game's board. Each frame each seam's far points
 * are carried from O's frame into S's (H^-1 C p, as the midriff's ring) and
 * written over its mesh in polygon RAM at SEAM_POLY(p) on, a command a run
 * of words. A seam's whole mesh goes there first, one seam a frame (all of
 * them every frame, for two fighters, ran the frame's display list over its
 * 0x8000-byte buffer), and is drawn from the next frame on. Fills `at` with each seam's
 * address there; returns how many are there (the first so many of `*out`'s
 * list). Leaves the coprocessor's matrix changed. */
#define SEAM_POLY(p) (0x1000u + ((p) << 13))
#define SEAMS_MAX 16u
#define SEAM_PTS 84u
static const u32 *seam_list[2];
static u32 seams_in[2];
/* Not on the stack: main runs on the supervisor stack, from 0x5FF800 up to
 * the end of work RAM at 0x600000, with little of it left by here. */
static mat_t seam_m[16];
static float seam_c[SEAM_PTS][3];
static u32 seams_build(u32 p, u32 *at, const u32 **out) {
    volatile u32 *fifo = (volatile u32 *)M2_GEOFIFO_ADDR;
    const u32 *list = *(const u32 *const *)(STF_GUEST_seams + RB(robs[p], ROB_CHAR) * 4u);
    u32 have = 0;
    u32 addr = SEAM_POLY(p), s, n, in;
    if (list != seam_list[p]) { seam_list[p] = list; seams_in[p] = 0; }
    *out = list;
    if (list == 0) return 0;
    n = list[0] < SEAMS_MAX ? list[0] : SEAMS_MAX;
    in = seams_in[p];
    for (s = 0; s < n && s <= in; s++) {
        const u32 *sm = (const u32 *)list[1u + s];
        u32 S = sm[1] & 0xFu, O = (sm[1] >> 8) & 0xFu, W = sm[2], P = sm[3], N = sm[4], k, r;
        const float (*pts)[3] = (const float (*)[3])&sm[5];
        const u32 *runs = &sm[5u + 3u * P];
        const u32 *w = &runs[N];
        const u8 *patch = (const u8 *)&w[W];
        if (!(have & (1u << S))) { slot_mat(&seam_m[S], p, S); have |= 1u << S; }
        if (!(have & (1u << O))) { slot_mat(&seam_m[O], p, O); have |= 1u << O; }
        carry(&seam_m[S], &seam_m[O], pts, seam_c, P < SEAM_PTS ? P : SEAM_PTS);
#define SEAM_WORD(k) (patch[k] ? m2_obj_fb(seam_c[(patch[k] - 1u) / 3u][(patch[k] - 1u) % 3u]) : w[k])
        if (s == in) {
            *fifo = GEO_OP_POLYDATA; *fifo = addr; *fifo = W;
            for (k = 0; k < W; k++) *fifo = SEAM_WORD(k);
        } else
            for (r = 0; r < N; r++) {
                u32 k0 = runs[r] & 0xFFFFu, kn = k0 + (runs[r] >> 16);
                *fifo = GEO_OP_POLYDATA; *fifo = addr + k0; *fifo = kn - k0;
                for (k = k0; k < kn; k++) *fifo = SEAM_WORD(k);
            }
#undef SEAM_WORD
        at[s] = addr;
        addr += W;
    }
    if (in < n) seams_in[p] = in + 1u;
    return in;
}

/* The spin attack (Sonic's spindash): while ROB_SPIN is 1, rob_disp_rdn_loop
 * draws no part but slot 0, and that as the ball, on slot 0's matrix after
 * the (1, y, 1) scale. spin_attack_cnt_nml_dsp (0x81848): turned a quarter
 * back about x, scaled by player_model_y_scale plus the pulse (ROB_SPIN_PULSE,
 * kept in ROB_SPIN_DRAWN), then on even frames turned by the first angle
 * and a half turn about y and drawn as the first model, on odd frames turned
 * by the second (four times the first) and drawn as the second.
 * Espio's (character 7, spin_attack_cnt_esp_dsp, 0x81914) leans by the
 * pulse instead: its x and z times 0x509508 (init_floats' 65536 / 2 pi) are
 * angles, about z, then x, then down by ROB_SPIN_DROP and turned about y. */
#define SPIN_RAD 10430.378f
static int spin_round(float x) { return (int)(x < 0.0f ? x - 0.5f : x + 0.5f); }
static void spin_ball(u32 *r) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    u32 odd = RAM32(G_FRAME_COUNTER) & 1u, model = RH(r, ROB_SPIN_MODEL + odd * 2u), i;
    const float *g = (const float *)((u8 *)r + ROB_SPIN_PULSE);
    float *d = (float *)((u8 *)r + ROB_SPIN_DRAWN), ys = *(const float *)stf_ram(G_MODEL_SCALE);
    int ang = (short)RH(r, ROB_SPIN_ANG + odd * 2u);
    if (RB(r, ROB_CHAR_IS) % 26u == 7u) {
        int ax = spin_round(SPIN_RAD * g[0]), az = spin_round(SPIN_RAD * g[2]);
        *cf = COP_COSSCALE; *cf = (u32)az; *cf = 0x3FC00000u; d[0] = m2_cop_gf();
        d[1] = ys;
        *cf = COP_COSSCALE; *cf = (u32)ax; *cf = 0x3FC00000u; d[2] = m2_cop_gf();
        *cf = COP_ANG_Z; *cf = (u32)az;
        *cf = COP_ANG_X; *cf = (u32)ax;
        *cf = COP_SET_POS; *cf = 0u; *cf = RW(r, ROB_SPIN_DROP) | 0x80000000u; *cf = 0u;
        *cf = COP_ANG_Y; *cf = (u32)ang;
    } else {
        for (i = 0; i < 3u; i++) d[i] = ys + g[i];
        *cf = COP_ANG_X; *cf = 0xFFFFE000u;
        *cf = COP_SCALE; for (i = 0; i < 3u; i++) *cf = m2_obj_fb(d[i]);
        *cf = COP_ANG_X; *cf = (u32)ang;
        if (!odd) { *cf = COP_ANG_Y; *cf = 0x8000u; }
    }
    if (model) submit_cur(model);
}

/* mirror: the fighter's reflection in Aurora Icefield's ice, as
 * rob_disp_mir (0x6428C) draws it: the parts, under the camera scaled by
 * (1, -1, 1), which turns them over the floor's y = 0 (mirror_draw). */
void draw_fighter(const fighter_t *f, u32 p, u32 mirror) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    const pose_anim_t *a = f->anim;
    u32 *r = robs[p], i, model, tpd;
    u32 mid = midriff_build(p), seam_at[SEAMS_MAX], s;
    const u32 *seams;
    u32 nseams = seams_build(p, seam_at, &seams);
    /* the eyes are StF's (two models on the head); another game's fighter has
     * them in his head */
    u32 n = char_game(a->chr) == GAME_STF ? 18u : 16u;
    u32 still = (RW(r, ROB_FLAG) & ROB_F_NO_EYES) || RH(r, ROB_MOT_NUM) == 0x134u;
    cop_load(&cam_l);
    if (mirror) { *cf = COP_SCALE; *cf = 0x3F800000u; *cf = 0xBF800000u; *cf = 0x3F800000u; }
    if (RW(r, ROB_SPIN) == 1u) {
        *cf = COP_PUSH;
        *cf = COP_SCALE; *cf = 0x3F800000u; *cf = RW(r, ROB_Y_SCALE); *cf = 0x3F800000u;
        *cf = COP_PART; *cf = p; *cf = 0u;
        spin_ball(r);
        *cf = COP_POP;
        return;
    }
    /* slot 0 has no model: StF's records leave it 0, and its command
     * interpreter keeps bytes there (+0x40..0x43 of g13, the rob), so a
     * guest's slot 0 (Akira's 0x13AE) turns into an empty StF entry (0xAE),
     * an object at polygon RAM 0, where the midriff is */
    for (i = 1; i < n; i++) {
        u32 slot, seamed = 0u;
        tpd = 0u;
        if (i < 16u) { slot = i; model = RW(r, ROB_PARTS + i * 4u); }
        else {                           /* the eyes, on the head's slot */
            slot = 2u; model = RW(r, ROB_EYE_MODEL + (i - 16u) * 4u);
            if (!still) tpd = RW(r, ROB_EYE_TPD + (i - 16u) * 4u);
        }
        /* a slot whose faces are all in seams (YKB_B's thighs and shins,
         * welded whole to the joint above) has no model, only its seams */
        if (i < 16u)
            for (s = 0; s < nseams; s++) if ((((const u32 *)seams[1u + s])[1] & 0xFFu) == slot) seamed = 1u;
        if (model == 0u && !seamed) continue;
        *cf = COP_PUSH;
        *cf = COP_SCALE; *cf = 0x3F800000u; *cf = RW(r, ROB_Y_SCALE); *cf = 0x3F800000u;
        *cf = COP_PART; *cf = p; *cf = slot * 12u;
        if (model) submit_cur_ov(model, 0u, tpd);
        if (slot == 9u && i < 16u && mid) poly_draw(mid, MID_POLY(p) + 4u);
        if (i < 16u)
            for (s = 0; s < nseams; s++) {
                const u32 *sm = (const u32 *)seams[1u + s];
                if ((sm[1] & 0xFFu) == slot) poly_draw(sm[0], seam_at[s]);
            }
        *cf = COP_POP;
    }
    if (!mirror) osage_splice(p);
}

/* What camera_init does after a fighter's rob_disp while he spins: a puff
 * of smoke every third frame (spin_smoke_trg; not while the motion's kind
 * has bit 4) and the ball's turn and pulse (spin_attack_cnt); then, spinning
 * or not, spin_smoke_cnt, here: under the unscaled camera, down by
 * ROB_SPIN_DROP, each live puff younger than 32 frames takes its step (the
 * routine in SMOKE_STEP, on g3), its speed and place, and is drawn at its
 * place, faced to the camera and scaled, as model 0x323 + age / 25. */
void spin_frame(u32 p) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    u32 *r = robs[p], live, i, k;
    if (RW(r, ROB_SPIN)) {
        if (!(RW(r, ROB_MOTD_KIND) & MK_AIR) && RAM32(G_FRAME_COUNTER) % 3u == 0u)
            stf_call(stf_spin_smoke_trg, r, robs[p ^ 1u], 0u);
        stf_call(stf_spin_attack_cnt, r, robs[p ^ 1u], 0u);
    }
    if ((live = RW(r, ROB_SMOKE_LIVE)) == 0u) return;
    cop_load(&cam_l);
    *cf = COP_SET_POS; *cf = 0x80000000u; *cf = RW(r, ROB_SPIN_DROP) ^ 0x80000000u; *cf = 0x80000000u;
    for (i = 0; i < 20u; i++) {
        u8 *q = (u8 *)r + ROB_SMOKE + i * SMOKE_SIZE;
        float *pos = (float *)(q + SMOKE_POS), *vel = (float *)(q + SMOKE_VEL), *acc = (float *)(q + SMOKE_ACC);
        u32 model;
        if (!(live & (1u << i))) continue;
        live &= ~(1u << i);
        if ((int)RW(q, SMOKE_COUNT) >= 32) continue;
        live |= 1u << i;
        stf_call_g3((void (*)(void))RW(q, SMOKE_STEP), r, q);
        for (k = 0; k < 3u; k++) { vel[k] += acc[k]; pos[k] += vel[k]; }
        model = 0x323u + RW(q, SMOKE_COUNT) / 25u;
        *cf = COP_PUSH;
        *cf = COP_SET_POS; for (k = 0; k < 3u; k++) *cf = RW(q, SMOKE_POS + k * 4u);
        *cf = COP_FACE;
        *cf = COP_SCALE; for (k = 0; k < 3u; k++) *cf = RW(q, SMOKE_SCALE + k * 4u);
        submit_cur(model);
        *cf = COP_POP;
        RW(q, SMOKE_COUNT)++;
    }
    RW(r, ROB_SMOKE_LIVE) = live;
}

/* Aurora Icefield's reflections, as camera_init draws them there in place
 * of the shadows inside the ring: material slots 0 to 15 dimmed to ambient
 * 0x70 with no diffuse (change_material, dword_90F90), each fighter turned
 * over the ice (mirror_rob_disp), the mirrored sway chains osage_dsp laid in
 * list layer 6, then the stage's materials back. Their faces count as each
 * fighter's. */
void mirror_draw(const stage_t *st, const fighter_t fs[2], u32 pn[3]) {
    volatile u32 *fifo = (volatile u32 *)M2_GEOFIFO_ADDR;
    u32 i;
    *fifo = GEO_OP_TEXPARAM; *fifo = 0u; *fifo = 0x10u;
    for (i = 0; i < 0x10u; i++) { *fifo = 0x7000u; *fifo = geo_mat_int[i]; }
    for (i = 0; i < 2u; i++) { polys = 0u; draw_fighter(&fs[i], i, 1u); pn[1u + i] = polys; }
    osage_splice(OSAGE_MIRROR);
    send_materials(st->mat);
}
