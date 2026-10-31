/*
 * armour.c — Fighting Vipers' armour, which StF kept FV's code for: its
 * limits, how it is kept from one round to the next, and its two figures on
 * the HUD.
 */
#include "megamix.h"

/* Fighting Vipers' armour, which StF kept FV's code for: damage_unit adds
 * each hit's damage to the part it lands on (ROB_PART_DAMAGE), and
 * calc_up_down_damage sums the upper body's parts and the lower's and sets
 * ARMOUR_UP_DAMAGED or ARMOUR_DOWN_DAMAGED once a sum reaches its limit
 * (ROB_ARMOUR_LIMIT). A damaged piece breaks (ARMOUR_UP_BROKEN,
 * ARMOUR_DOWN_BROKEN) on a hit from a move whose setup has kind2 bit 5
 * (+0x70C): FV's own and FM's for their guests, a strike of 30 or more for
 * the others (tools/board/lift-stf.py, vf2-guest.mjs); both broken, the rob's
 * ROB_F_NAKED. StF's copy tests that only on a slot with crush pieces,
 * which it has none of: lift-stf.py puts the test in without them. The
 * match's winning hit breaks both (mod_fa_effect +0x914).
 * action_init sets the limits from StF's records (500 and 200, which
 * nothing reaches): the board sets FV's (its records' +0x3C, the upper and
 * the lower), in the board's damage (x140/200), times the rounds to win, as
 * action_init multiplies them: Mahler's, FV's fighter 8, 500 and 200, and
 * everyone else's 200 and 75 (six of FV's twenty records; six have 150
 * and 50, the rest more). As in FV, the damage stays from one round to
 * the next and goes at a match's start (FV 0x2CD04).
 * With the setup's FV armour OFF (M_ARMOUR), the limits are ones no sum
 * reaches, as StF's own are: no piece is damaged, so none breaks and FV's
 * replay never runs, and the HUD shows no figures. The source games'
 * replays are graded so (tools/mame/board-replays.sh): FV's with it on,
 * StF's and VF2's off. */
static const u16 armour_fv[2][2] = { { 200u, 75u }, { 500u, 200u } };
static struct { u16 part[16]; u32 sum[4], bits, w0; } armour_kept[2];

void armour_limits(u32 p) {
    const u16 *l = armour_fv[char_game(RB(robs[p], ROB_CHAR_IS)) == GAME_FV];
    u32 k;
    for (k = 0; k < 2u; k++)
        RW(robs[p], ROB_ARMOUR_LIMIT + 4u * k) = menu_val[M_ARMOUR] ? l[k] * 140u / 200u * RAM8(G_WINS_NEEDED) : 0x7FFFFFFFu;
}

void armour_keep(u32 p) {
    u32 k;
    for (k = 0; k < 16u; k++) armour_kept[p].part[k] = RH(robs[p], ROB_PART_DAMAGE + 2u * k);
    for (k = 0; k < 4u; k++) armour_kept[p].sum[k] = RW(robs[p], ROB_ARMOUR_DAMAGE + 4u * k);
    armour_kept[p].bits = RW(robs[p], ROB_ARMOUR) & 0xFu;
    armour_kept[p].w0 = RW(robs[p], ROB_FLAG) & ROB_F_NAKED;
}

void armour_back(u32 p) {
    u32 k;
    for (k = 0; k < 16u; k++) RH(robs[p], ROB_PART_DAMAGE + 2u * k) = armour_kept[p].part[k];
    for (k = 0; k < 4u; k++) RW(robs[p], ROB_ARMOUR_DAMAGE + 4u * k) = armour_kept[p].sum[k];
    RW(robs[p], ROB_ARMOUR) = (RW(robs[p], ROB_ARMOUR) & ~0xFu) | armour_kept[p].bits;
    RW(robs[p], ROB_FLAG) |= armour_kept[p].w0;
}

/* The armour on the HUD, as FV shows it: each fighter's figure (FV's
 * patterns 0x20 and 0x147, in FV's own tiles and colours: tools/board/bake-board.mjs)
 * on the front layer, row 1, at the screen's left (column 0) and right
 * (57), and its two pieces coloured each frame as energy_disp (FV 0x346A8)
 * colours them: green whole, FV's green blink once damaged, its red one
 * once broken. */
static const u32 *const armour_chars[2] = { armour_chars0, armour_chars1 };

void armour_hud_load(void) {
    u32 k, i;
    for (k = 0; k < 2u; k++) {
        volatile u32 *o = (volatile u32 *)(M2_CHARGFX + ((k ? ARMOUR_BLOCK1 : ARMOUR_BLOCK0) * 128u + armour_first[k]) * 32u);
        for (i = 0; i < armour_count[k] * 8u; i++) o[i] = armour_chars[k][i];
    }
}

static u16 armour_pen(u32 bits, u32 damaged, u32 broken) {
    if (bits & broken) return armour_red[(frame_counter >> 3) % 6u];
    if (bits & damaged) return armour_green[(frame_counter >> 2) % 6u];
    return armour_whole;
}

void armour_hud(void) {
    u32 k, i;
    for (k = 0; k < 2u; k++) {
        u32 g = (k ? ARMOUR_BLOCK1 : ARMOUR_BLOCK0) * 16u, bits = RW(robs[k], ROB_ARMOUR), col = k ? 57u : 0u, pen = k ? 12u : 9u;
        if (!menu_val[M_ARMOUR]) {         /* off: the figure's cells blank */
            for (i = 0; i < 55u; i++)
                if (armour_cells[k][i]) M2_TILE_FG[(1u + i / 5u) * 64u + col + i % 5u] = 0x20u;
            continue;
        }
        for (i = 0; i < 16u; i++) M2_PALETTE[g + i] = armour_pal[k][i];
        M2_PALETTE[g + pen + 1u] = armour_pen(bits, ARMOUR_UP_DAMAGED, ARMOUR_UP_BROKEN);
        M2_PALETTE[g + pen] = armour_pen(bits, ARMOUR_DOWN_DAMAGED, ARMOUR_DOWN_BROKEN);
        for (i = 0; i < 55u; i++)
            if (armour_cells[k][i]) M2_TILE_FG[(1u + i / 5u) * 64u + col + i % 5u] = armour_cells[k][i];
    }
}

/* a match's start: no damage kept (FV 0x2CD04) */
void armour_forget(void) {
    u32 i;
    for (i = 0; i < sizeof armour_kept / 4u; i++) ((u32 *)armour_kept)[i] = 0u;
}
