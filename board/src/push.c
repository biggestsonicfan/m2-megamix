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
 * program word 0xE, which is 0. Kinds 4 and 5 (+0x88) give none.
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

/* The board does it on the i960, not a DSP: the 900 pairs every frame cost
 * it frames, so only the balls near the other fighter are paired (the same
 * result). */
u32 vf2_push(const u8 *rob0, const u8 *rob1, const u8 *task) {
    const float (*b0)[4] = (const float (*)[4])(rob0 + 0xD00);
    const float (*b1)[4] = (const float (*)[4])(rob1 + 0xD00);
    u32 kind = *(const u32 *)(task + 0x88);
    u32 z = kind == 3u ? 0xFFFFDFFCu : 0u, n0, n1, i, o;
    float lo0[3], hi0[3], lo1[3], hi1[3], best = 0.0f;
    union { float f; u32 u; } out;
    if (kind == 4u || kind == 5u) return 0u;
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
            ov = (z >> i & 1u) && (z >> o & 1u) ? 0.0f : r - sqrt_r(d2);
            if (ov > best) best = ov;
        }
    }
    out.f = best;
    return out.u;
}
