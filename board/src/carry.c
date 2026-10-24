/* carry.c: points in one slot's frame carried into another's, the seams'
 * and the midriff's (megamix.c). This file alone is built for the i960's own
 * floating point (mulr, addr, divr on the global and local registers, as
 * StF's lifted code does), the rest of the board soft-float: Ryo's twelve
 * seams in soft-float took 7 ms a pass and held the board to 30 frames a
 * second. Floats go by pointer only, so the two calling conventions meet. */
typedef unsigned u32;
typedef struct { float r[9], t[3]; } mat_t;   /* megamix.c's: column-major, the COP's layout */

/* H^-1 C p for each point (the slots' matrices may be scaled, so H^-1 by
 * its cofactors), made once as a 3x4 a. */
void carry(const mat_t *h, const mat_t *c, const float (*in)[3], float (*out)[3], u32 n) {
    float x[3][3], a[3][4], inv;
    u32 k, j, i;
    /* x[i]: H's other two columns crossed, so (H^-1 d)[i] = d . x[i] / det */
    for (i = 0; i < 3; i++) {
        const float *u = &h->r[((i + 1u) % 3u) * 3u], *v = &h->r[((i + 2u) % 3u) * 3u];
        x[i][0] = u[1] * v[2] - u[2] * v[1];
        x[i][1] = u[2] * v[0] - u[0] * v[2];
        x[i][2] = u[0] * v[1] - u[1] * v[0];
    }
    inv = 1.0f / (h->r[0] * x[0][0] + h->r[1] * x[0][1] + h->r[2] * x[0][2]);
    for (i = 0; i < 3; i++) {
        for (j = 0; j < 3; j++) x[i][j] *= inv;
        for (k = 0; k < 3; k++)
            a[i][k] = x[i][0] * c->r[k * 3u] + x[i][1] * c->r[k * 3u + 1u] + x[i][2] * c->r[k * 3u + 2u];
        a[i][3] = x[i][0] * (c->t[0] - h->t[0]) + x[i][1] * (c->t[1] - h->t[1]) + x[i][2] * (c->t[2] - h->t[2]);
    }
    for (k = 0; k < n; k++)
        for (i = 0; i < 3; i++) out[k][i] = a[i][0] * in[k][0] + a[i][1] * in[k][1] + a[i][2] * in[k][2] + a[i][3];
}
