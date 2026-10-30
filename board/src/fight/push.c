/* push.c: the push between two VF2 guests, as VF2's TGP works it out (its
 * function 0x3B, TGP 0x99E; docs/GRADING.md). StF's SHARC program pairs the
 * balls its own way, and on a jab's contact it gives another overlap.
 *
 * The TGP holds 30 balls a fighter. Its ball k has the radius of the rob's
 * ball k (rob+0xD00: x, y, z, r) but the place of ball SENT[k], the order
 * VF2's set_coli_ball_data sends them in. Each pair (1P's ball i, 2P's ball
 * o) not in an attack (bit i of 1P's attack mask, bit o of 2P's) pushes by
 * r_i + r_o - |p_i - p_o|, the largest of them; a pair in both of the
 * kind's masks (VF2's +0xB4 bit i, +0xB8 bit o) is multiplied by the TGP's
 * program word 0xE, which is 0. Kinds 4 and 5 (+0x88) give none. Its
 * other answer (VF2's task +0x148, StF's +0x164) is how many such pairs
 * meet, those multiplied by 0 too: coli_recalc_pos pushes the two apart
 * when it is over 0, by g4 or by how far they are inside each other's
 * reach (VF2 0x236AC). vf2_push leaves it in vf2_push_pairs.
 *
 * The attack mask is VF2's calc_attack_flag's, not StF's (+0x768): VF2 maps
 * ball to unit with its own bytes (UNIT, VF2's 0x23284), where the guest's
 * +0x1D18 holds another order. The part's units are StF's dword_CE020, the
 * same table as VF2's. The kind's masks are VF2's decide_coli_kind's: only
 * BODY, kind 3, has any (0xFFFFDFFC both); StF's +0xC0/+0xC4 are its own.
 * Built for the i960's floating point, as carry.c is: the float goes back
 * as its bits. */
typedef unsigned u32;
typedef unsigned char u8;

#define BALLS 30
static const u8 SENT[BALLS] = { 1, 0, 2, 5, 4, 7, 6, 8, 10, 9, 12, 11, 13, 3, 16,
                                15, 14, 19, 18, 17, 21, 20, 24, 23, 22, 27, 26, 25, 29, 28 };
static const u8 UNIT[BALLS] = { 1, 1, 2, 3, 3, 4, 4, 5, 6, 6, 7, 7, 8, 9, 10,
                                10, 10, 11, 11, 11, 12, 12, 13, 13, 13, 14, 14, 14, 15, 15 };
#define PART_UNITS ((const u32 *)0xCE020)   /* StF's dword_CE020 */
#define NO_PART 41u

/* VF2's calc_attack_flag: the balls on the units of the part attacking. */
static u32 attack_mask(const u8 *rob) {
    u32 part = rob[0x820], units, mask = 0u, k;
    if (!(*(const u32 *)(rob + 0x1A4) >> 8 & 1u)) return 0u;
    if ((u32)*(const short *)(rob + 0x1AA) < (u32)*(const short *)(rob + 0x808)) return 0u;
    if (part == NO_PART) return 0u;
    units = PART_UNITS[part];
    for (k = 0; k < BALLS; k++)
        if (units >> UNIT[k] & 1u) mask |= 1u << k;
    return mask;
}

static float sqrt_r(float v) {
    float r;
    __asm__("sqrtr %1, %0" : "=r"(r) : "r"(v));
    return r;
}

/* The box around a fighter's balls not in its mask (each ball's place ± its
 * radius), lo and hi. */
static void bounds(const float (*b)[4], u32 mask, float *lo, float *hi) {
    u32 k, a;
    for (a = 0; a < 3; a++) lo[a] = 1e30f, hi[a] = -1e30f;
    for (k = 0; k < BALLS; k++) {
        const float *p = b[SENT[k]];
        if (mask >> k & 1u) continue;
        for (a = 0; a < 3; a++) {
            if (p[a] - b[k][3] < lo[a]) lo[a] = p[a] - b[k][3];
            if (p[a] + b[k][3] > hi[a]) hi[a] = p[a] + b[k][3];
        }
    }
}

/* The balls not in the mask whose box meets the other fighter's: only they
 * can overlap one of its balls. */
static u32 near(const float (*b)[4], u32 mask, const float *lo, const float *hi) {
    u32 k, a, out = 0u;
    for (k = 0; k < BALLS; k++) {
        const float *p = b[SENT[k]];
        if (mask >> k & 1u) continue;
        for (a = 0; a < 3; a++)
            if (p[a] - b[k][3] >= hi[a] || p[a] + b[k][3] <= lo[a]) break;
        if (a == 3) out |= 1u << k;
    }
    return out;
}

u32 vf2_push_pairs;

/* The board does it on the i960, not a DSP: the 900 pairs every frame cost
 * it frames, so only the balls near the other fighter are paired (the same
 * result). */
u32 vf2_push(const u8 *rob0, const u8 *rob1, const u8 *task) {
    const float (*b0)[4] = (const float (*)[4])(rob0 + 0xD00);
    const float (*b1)[4] = (const float (*)[4])(rob1 + 0xD00);
    u32 kind = *(const u32 *)(task + 0x88);
    u32 z = kind == 3u ? 0xFFFFDFFCu : 0u, n0, n1, i, o, pairs = 0u;
    float lo0[3], hi0[3], lo1[3], hi1[3], best = 0.0f;
    union { float f; u32 u; } out;
    n0 = attack_mask(rob0), n1 = attack_mask(rob1);
    bounds(b0, n0, lo0, hi0), bounds(b1, n1, lo1, hi1);
    n0 = near(b0, n0, lo1, hi1), n1 = near(b1, n1, lo0, hi0);
    for (o = 0; n0 && o < BALLS; o++) {
        const float *q = b1[SENT[o]];
        if (!(n1 >> o & 1u)) continue;
        for (i = 0; i < BALLS; i++) {
            const float *p = b0[SENT[i]];
            float dx, dy, dz, r, d2, ov;
            if (!(n0 >> i & 1u)) continue;
            dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
            r = b0[i][3] + b1[o][3], d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= r * r) continue;
            pairs++;
            ov = (z >> i & 1u) && (z >> o & 1u) ? 0.0f : r - sqrt_r(d2);
            if (ov > best) best = ov;
        }
    }
    vf2_push_pairs = pairs;
    out.f = kind == 4u || kind == 5u ? 0.0f : best;
    return out.u;
}

/* The contacts VF2's collision reads (its 0x238F8): the TGP's matrix of
 * every pair (1P's ball i, 2P's ball o) that meets, TGP-paired as above,
 * folded to units, table[UNIT[i]] bit UNIT[o]. A pair with 2P's ball in 2P's
 * attack mask, or 1P's in 1P's, is swept (TGP 0x8A5): it meets if the line
 * from last frame's R (2P's ball less 1P's) to this frame's passes within
 * r_i + r_o of 0; any other pair meets if this frame's |R| is under it.
 * StF's SHARC table pairs the balls its own way and puts a jab on a leg
 * where VF2 has none. VF2's TGP works on the balls of the step before; so
 * does the board here, its balls made before the fighters step.
 *
 * 900 pairs in floating point cost the i960 frames, so each pair is first
 * tried in whole numbers (1/1024 of a unit, a unit's slack each way): an
 * axis that keeps the two apart drops it. */
static float last_balls[2][BALLS][3];

/* |the point nearest 0 on the line from a to a + v|, squared (TGP 0x8A5). */
static float line_d2(const float *a, const float *v) {
    float av = a[0] * v[0] + a[1] * v[1] + a[2] * v[2];
    float vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2], t, p[3];
    u32 k;
    if (av >= 0.0f) t = 0.0f;
    else if (vv <= -av) t = 1.0f;
    else t = -av / vv;
    for (k = 0; k < 3; k++) p[k] = a[k] + t * v[k];
    return p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
}

/* A fighter's TGP balls in whole numbers: lo and hi on each axis over this
 * frame's place and last frame's (sw), this frame's alone (st), the radius;
 * and each unit's box (its balls' sw boxes, each grown by its radius). */
typedef struct { int sw[2][3], st[2][3], r; } fix_ball;
typedef struct { fix_ball b[BALLS]; int u[16][2][3]; } fix_rob;
static fix_rob fx[2];   /* not on StF's stack: it is small */
/* The first TGP ball of each unit (1..15) and one past its last. */
static const u8 UNIT_FROM[17] = { 0, 0, 2, 3, 5, 7, 8, 10, 12, 13, 14, 17, 20, 22, 25, 28, 30 };

/* v x 1024 in whole numbers (toward 0), from the float's bits: the i960's
 * own conversion, with its constants in fp0..fp2, cost the board frames.
 * Out of range (or not a number) it is held at +-2^20. */
static int fix(float v) {
    union { float f; u32 u; } b;
    u32 e, m;
    int x;
    b.f = v, e = b.u >> 23 & 0xFFu, m = (b.u & 0x7FFFFFu) | 0x800000u;
    if (e >= 137u) x = 1 << 20;
    else if (e < 117u) x = 0;
    else x = (int)(m >> (140u - e));   /* v = m x 2^(e - 150) */
    return b.u >> 31 ? -x : x;
}

static void fix_balls(const float (*b)[4], const float (*l)[3], fix_rob *f) {
    u32 k, a, u;
    for (u = 1; u < 16; u++)
        for (a = 0; a < 3; a++) f->u[u][0][a] = 0x7FFFFFFF, f->u[u][1][a] = -0x7FFFFFFF;
    for (k = 0; k < BALLS; k++) {
        const float *p = b[SENT[k]], *q = l[SENT[k]];
        fix_ball *x = &f->b[k];
        int (*bx)[3] = f->u[UNIT[k]];
        x->r = fix(b[k][3]) + 1;
        for (a = 0; a < 3; a++) {
            int c = fix(p[a]), d = fix(q[a]);
            x->st[0][a] = c - 1, x->st[1][a] = c + 1;
            x->sw[0][a] = (c < d ? c : d) - 1, x->sw[1][a] = (c < d ? d : c) + 1;
            if (x->sw[0][a] - x->r < bx[0][a]) bx[0][a] = x->sw[0][a] - x->r;
            if (x->sw[1][a] + x->r > bx[1][a]) bx[1][a] = x->sw[1][a] + x->r;
        }
    }
}

/* Whether boxes x and y, each grown by part of ir, can meet. */
static int boxes_meet(const int (*x)[3], const int (*y)[3], int ir) {
    return y[0][0] - x[1][0] < ir && x[0][0] - y[1][0] < ir &&
           y[0][1] - x[1][1] < ir && x[0][1] - y[1][1] < ir &&
           y[0][2] - x[1][2] < ir && x[0][2] - y[1][2] < ir;
}

/* Whether 1P's ball i meets 2P's ball o (see above). */
static int balls_meet(const float (*b0)[4], const float (*b1)[4], u32 i, u32 o, u32 swept) {
    const float *p = b0[SENT[i]], *q = b1[SENT[o]];
    float rel[3], v[3], r = b0[i][3] + b1[o][3], d2;
    u32 a;
    for (a = 0; a < 3; a++) rel[a] = q[a] - p[a];
    if (swept) {
        const float *lp = last_balls[0][SENT[i]], *lq = last_balls[1][SENT[o]];
        for (a = 0; a < 3; a++) v[a] = rel[a], rel[a] = lq[a] - lp[a], v[a] -= rel[a];
        d2 = line_d2(rel, v);
    } else d2 = rel[0] * rel[0] + rel[1] * rel[1] + rel[2] * rel[2];
    return d2 < r * r;
}

void vf2_contacts(const u8 *rob0, const u8 *rob1, u32 *table) {
    const float (*b0)[4] = (const float (*)[4])(rob0 + 0xD00);
    const float (*b1)[4] = (const float (*)[4])(rob1 + 0xD00);
    u32 m0 = attack_mask(rob0), m1 = attack_mask(rob1), i, o, u, w, a;
    for (i = 0; i < 16; i++) table[i] = 0u;
    fix_balls(b0, (const float (*)[3])last_balls[0], &fx[0]);
    fix_balls(b1, (const float (*)[3])last_balls[1], &fx[1]);
    for (u = 1; u < 16; u++)
        for (w = 1; w < 16; w++) {
            if (!boxes_meet((const int (*)[3])fx[0].u[u], (const int (*)[3])fx[1].u[w], 0)) continue;
            for (i = UNIT_FROM[u]; i < UNIT_FROM[u + 1]; i++)
                for (o = UNIT_FROM[w]; o < UNIT_FROM[w + 1]; o++) {
                    u32 swept = (m1 >> o & 1u) | (m0 >> i & 1u);
                    const fix_ball *x = &fx[0].b[i], *y = &fx[1].b[o];
                    if (!boxes_meet(swept ? (const int (*)[3])x->sw : (const int (*)[3])x->st,
                                    swept ? (const int (*)[3])y->sw : (const int (*)[3])y->st,
                                    x->r + y->r) ||
                        !balls_meet(b0, b1, i, o, swept)) continue;
                    table[u] |= 1u << w;
                    goto next_unit;
                }
        next_unit:;
        }
    for (i = 0; i < BALLS; i++)
        for (a = 0; a < 3; a++) last_balls[0][i][a] = b0[i][a], last_balls[1][i][a] = b1[i][a];
}
