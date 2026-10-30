/*
 * The input matcher (js/moves.js's, run live): the buttons and the stick,
 * an entry's tests, the entry a press lands on. Part of js/fighters.js.
 */

/* ---- the input matcher (js/moves.js's, run live) ------------------------- */

const OP_EXACT_NEW = 0x00, OP_EXACT = 0x01, OP_SUBSET = 0x03, OP_BRANCH = 0x28;
export const P = 0x01, K = 0x02, G = 0x04, DOWN = 0x10, UP = 0x20, FWD = 0x40, BACK = 0x80;

/* Would the entry's direction tests pass on this history, oldest first? Each
 * test, most recent first, is tried on the sample under the cursor and then
 * one further back until it passes (js/moves.js satisfies, `loc_1EE74`). */
function satisfies(e, hist) {
    let i = hist.length - 1;
    for (const { op, mask, here } of e.dirs) {
        const ok = (s) => (op === OP_EXACT_NEW || op === OP_EXACT) ? s === (mask & 0xf0)
            : op === OP_SUBSET ? (s & ~mask & 0xf0) === 0
                : op === OP_BRANCH && !mask ? (s & (FWD | BACK)) === 0
                    : (s & mask) !== 0;
        if (here) {
            if (i < 0 || !ok(hist[i])) return false;
            continue;
        }
        while (i >= 0 && !ok(hist[i])) i--;
        if (i < 0) return false;
        i--;
    }
    return true;
}

/* The guards a live fight can answer: the distance tests against the real
 * distance, `vs` passes, and the en_flag (+0x5B8) tests read `en`, the bits
 * of it the engine works out (enFlag); the other flags read clear. */
function guardsPass(e, dist, en) {
    return e.guards.every(([g, v]) => {
        if (g === 'en_set') return (en >>> v & 1) === 1;
        if (g === 'en_clear') return (en >>> v & 1) === 0;
        if (g.endsWith('_clear')) return true;
        if (g === 'nearer_than') return dist < v;
        if (g === 'further_than') return dist > v;
        return g === 'vs';
    });
}

/** The entry a press lands on: the first, in the engine's order, whose tests
 * pass. `hist` is the stick since the last press, collapsed, oldest first.
 * `ctx` is the key's high byte the caller is in (0 on the ground; the jump's
 * contexts, see the engine); `en` the fighter's en_flag (enFlag). */
export function matchPress(entries, btn, hist, dist, { ctx = 0, en = 0 } = {}) {
    return entries?.find((e) => (e.key & 0xff) === btn && (e.key >> 8) === ctx
        && guardsPass(e, dist, en) && satisfies(e, hist)) ?? null;
}
