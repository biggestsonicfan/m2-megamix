/*
 * linkplay.c — the two-cabinet link's side of the game (link.c runs the
 * comm board): the wait that keeps the sound going, the frame's checksum,
 * the setup the master hands the slave, and the boot's communication check.
 */
#include "megamix.h"

/* link.c's wait for the other board: a vblank, sending the sound meanwhile */
void link_wait(void) {
    u32 v = frameVBL;
    while (frameVBL == v) snd_pump();
}

/* The state a linked frame leaves, for link_check: both fighters' records,
 * StF's clock and random number, the setup and the match. */
u32 link_sum(u32 in_menu, u32 over) {
    u32 i, p, s = 0x811C9DC5u;
    for (p = 0; p < 2u; p++)
        for (i = 0; i < ROB_SIZE / 4u; i++) s = (s ^ robs[p][i]) * 0x01000193u;
    for (i = 0; i < M_LINK; i++) s = (s ^ menu_val[i]) * 0x01000193u;
    s = (s ^ menu_cur ^ in_menu << 8 ^ over << 16) * 0x01000193u;
    s = (s ^ (u16)GAME_TIMER ^ (u32)RAM8(G_ROUND_WINS0) << 16 ^ (u32)RAM8(G_ROUND_WINS1) << 24) * 0x01000193u;
    return (s ^ RAM32(G_RANDOM)) * 0x01000193u;
}

/* The setup's values the master hands the slave, and its cursor */
void link_set(lk_u16 set[LINK_SETS]) {
    u32 i;
    for (i = 0; i < LINK_SETS; i++) set[i] = i < M_LINK ? menu_val[i] : 0u;
    set[M_START] = (u16)menu_cur;
}

/* The boot's watchdog: with a role kept (the setup's LINK) and a comm board
 * that answers, wait up to LINK_BOOT_WAIT for the other cabinet, as a
 * linked game's communication check does. LP_SYNC: the boards are linked
 * (set the master's setup). Else this board boots alone: on a press of
 * start, once the wait runs out, or at once with no role or no board. It
 * links later from the setup (both boards in it), as the other cabinet
 * comes up. */
u32 link_boot(lk_u16 set[LINK_SETS]) {
    u32 t0 = frameVBL, t, lp;
    lk_u32 in[2];
    char b[8];
    if (link.state <= LS_NO_BOARD) return LP_LOCAL;
    while ((t = frameVBL - t0) < LINK_BOOT_WAIT) {
        const char *d = dec((LINK_BOOT_WAIT - t + 59u) / 60u, b);
        win_frame(WIN_COL, WIN_ROW, WIN_W, 6u);
        win_put(1, 1, "COMMUNICATION_CHECK", T_INV);
        win_put(3, 2, "CABINET", T_TEXT);
        win_put(WIN_W - 2u - slen(link_name[link.role]), 2, link_name[link.role], T_INV);
        win_put(3, 3, link_state_name[link.state], T_TEXT);
        win_put(WIN_W - 2u - slen(d), 3, d, T_INV);
        win_put(3, 4, "START:SINGLE_BOARD", T_TEXT);
        link_set(set);
        lp = link_pass(0u, set, in, frameVBL, link_wait);
        if (lp == LP_SYNC) return lp;
        if (m2_player(0).start || m2_player(1).start) break;
        link_wait();
    }
    return LP_LOCAL;
}
