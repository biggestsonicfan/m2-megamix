/*
 * menu.c — the setup menu and the polygon counter, in the style of StF's
 * debug menu, on tile layer 1: its text, frames and window mask.
 */
#include "megamix.h"

/* ---- The setup menu ----
 *
 * A window in the style of StF's debug menu (PARAMETER_SET, which it opens
 * with 2P start held in debug mode): on tile layer 1, StF's own tile words.
 * The frame is tiles 0x200..0x207 (corners, edges), the font is ASCII at
 * codes 0x00..0x7F and drawn inverse at +0x80; every word carries 0x8000.
 * The title is inverse on the first row, the cursor (0x1C) left of the
 * labels, each value inverse and right-aligned one tile in from the frame,
 * and a name line (the stage's) right-aligned one tile further in. As in
 * StF's window: up and down move, punch lowers a value and kick raises it,
 * with guard held they repeat. Start begins the fight. */
/* The polygon count's window, at the screen's top right (62 tiles across). */
#define PWIN_COL   44u
#define PWIN_ROW   1u
#define PWIN_W     17u
#define PWIN_H     10u
#define T_CURSOR   0x801Cu
static const char *const menu_label[M_ITEMS] = {
    "GAME_START", "time", "round", "stage", "1P CHAR", "2P CHAR", "energy", "barrier", "link" };
/* each value's range and step: the clock in seconds (StF's time, 1..99),
 * the rounds to win (0x500052, the lamps StF draws), the energy a round
 * starts with (energy_max, 0x5000A0, which the bars scale by) and the
 * barriers a match starts with (barrier_default_num, 0x50A424) */
/* and the cabinet's link (link.c): OFF, 1P's (the master) or 2P's, this
 * board's own, kept in the backup RAM; the others are the master's once
 * the boards are linked */
static const u16 menu_min[M_ITEMS]  = { 0, 1, 1, 0, 0, 0, 10, 0, LINK_OFF };
static const u16 menu_max[M_ITEMS]  = { 0, 99, 5, STAGES - 1, POSE_ANIMS - 1, POSE_ANIMS - 1, 250, 9, LINK_SLAVE };
static const u16 menu_step[M_ITEMS] = { 0, 1, 1, 1, 1, 1, 10, 1, 1 };
u16 menu_val[M_ITEMS] = { 0, 30, 2, 0, 0, 1, 140, 5, LINK_OFF };
const char *const link_name[3] = { "OFF", "1P", "2P" };
/* the status line, by link.state */
const char *const link_state_name[6] = { "", "NO_COMM_BOARD", "COMM_STARTING", "NO_OTHER_CABINET", "LINKING", "LINKED" };
/* fighter_name and fighter_from, the lineup's (tools/board/lineup.mjs), are in
 * poses.h: the game a fighter's name line shows where it is not the one its
 * code runs as (Ryo and Chai, Shenmue's, and Hornet, Daytona USA's car, as
 * Fighters Megamix had him, run as VF2's Akira does) */
static const char *const stage_name[STAGES] = { "SOUTH_ISLAND", "AURORA_ICEFIELD", "VF2 TOU-RIN", "VF2 COLOSSEUM", "FV WESTERN", "VF2 TEST", "DOA STAGE 10" };
u32 menu_cur;

u32 slen(const char *s) { u32 n = 0; while (s[n]) n++; return n; }

void put_at(u32 col, u32 row, const char *s, u32 base) {
    volatile u16 *t = TILE_L1 + row * 64u + col;
    while (*s) *t++ = (u16)(base | (u8)*s++);
}

void win_put(u32 col, u32 row, const char *s, u32 base) { put_at(WIN_COL + col, WIN_ROW + row, s, base); }

/* n in decimal, into b (at least 6 bytes) */
const char *dec(u32 n, char *b) {
    char *p = b + 5;
    *p = 0;
    do { *--p = (char)('0' + n % 10u); n /= 10u; } while (n && p > b);
    return p;
}

/* tile layers 0 and 1 share a window mask: four words a line, a bit
 * for each 8 pixels (the top bit leftmost), set where layer 1 shows in
 * place of layer 0. StF's windows set it over their frame. */
void mask_rect(u32 col, u32 row, u32 w, u32 h) {
    u32 y, c;
    for (y = row * 8u; y < (row + h) * 8u; y++)
        for (c = col; c < col + w; c++)
            TILE_MASK[y * 4u + (c >> 4)] |= (u16)(0x8000u >> (c & 15u));
}

void menu_ink(u32 on) {
    u32 c;
    /* a palette colour's component c shows through colorxlat row c at
     * luma 0x40, and black there is see-through on the tile layers (MAME
     * reads 0..0x40 as 0): 0x41, the darkest it draws, gives the font's
     * black outlines and the values' black boxes, as StF's menu shows them;
     * 0 again restores the fight's band as StF has it */
    for (c = 0; c < 3u; c++)
        *(volatile u16 *)(M2_COLORXLAT + c * 0x4000u + 0x40u * 2u) = on ? 0x41u : 0u;
}

void menu_mask(u32 on) {
    u32 y, c;
    menu_ink(on);
    for (y = 0; y < 384u; y++)
        for (c = 0; c < 4u; c++) TILE_MASK[y * 4u + c] = 0u;
    if (!on) return;
    mask_rect(WIN_COL, WIN_ROW, WIN_W, M_ITEMS + 5u);
    mask_rect(PWIN_COL, PWIN_ROW, PWIN_W, PWIN_H);
}

void menu_clear(void) {
    u32 i;
    for (i = 0; i < 64u * 64u; i++) TILE_L1[i] = 0x8020u;
    menu_mask(0u);
}

/* A window's frame, w tiles by rows, its inside blank. */
void win_frame(u32 col, u32 row, u32 w, u32 rows) {
    u32 r, c;
    for (r = 0; r < rows; r++) {
        volatile u16 *t = TILE_L1 + (row + r) * 64u + col;
        u32 edge = r == 0u ? 0x8200u : r == rows - 1u ? 0x8205u : 0x8203u;
        t[0] = (u16)edge;
        for (c = 1; c < w - 1u; c++) t[c] = (u16)(r == 0u ? 0x8201u : r == rows - 1u ? 0x8206u : 0x8020u);
        t[w - 1u] = (u16)(edge + (r == 0u || r == rows - 1u ? 2u : 1u));
    }
}

void menu_draw(void) {
    u32 r, i;
    char b[24];
    win_frame(WIN_COL, WIN_ROW, WIN_W, M_ITEMS + 5u);   /* the frame, title, items, name line, a blank */
    win_put(1, 1, "GAME_SETUP", T_INV);
    for (i = 0, r = 2; i < M_ITEMS; i++, r++) {
        const char *v = 0;
        if (i == menu_cur) TILE_L1[(WIN_ROW + r) * 64u + WIN_COL + 2u] = T_CURSOR;
        win_put(3, r, menu_label[i], T_TEXT);
        if (i == M_P1 || i == M_P2) {      /* its game and name, as "VF2:AKIRA" */
            const char *g = fighter_from[menu_val[i]] ? fighter_from[menu_val[i]]
                : game_name[char_game(pose_anim(menu_val[i])->chr)];
            v = fighter_name[menu_val[i]];
            win_put(WIN_W - 3u - slen(v) - slen(g), r, g, T_INV);
            win_put(WIN_W - 3u - slen(v), r, ":", T_INV);
        } else if (i == M_LINK) v = link_name[menu_val[i]];
        else if (i != M_START) v = dec(menu_val[i], b);
        if (v) win_put(WIN_W - 2u - slen(v), r, v, T_INV);
        if (i == M_STAGE) {               /* the name line, as StF's "15:ADV_MOV2" */
            const char *n = stage_name[menu_val[i]];
            const char *d = dec(menu_val[i], b);
            u32 len = slen(d) + 1u + slen(n);
            r++;
            win_put(WIN_W - 3u - len, r, d, T_TEXT);
            win_put(WIN_W - 3u - len + slen(d), r, ":", T_TEXT);
            win_put(WIN_W - 3u - slen(n), r, n, T_TEXT);
        }
    }
    win_put(3, r, link_state_name[link.state], T_TEXT);   /* the blank line */
}

/* The faces the last frame submitted (polys): each fighter's, by the name
 * the menu shows, the stage's and the frame's. Faces sent, before the
 * geometrizer culls those turned away; a fighter's seams are counted with
 * him (after he changes they come in one a pass, each drawn from the pass
 * after its upload). Under them StF's own count: POLYGON, which the
 * coprocessor keeps (g_cop_p) by adding each object's link count (the low
 * half of obc; culled links too), and the POLYGON_LIMIT StF's boot sets
 * (5000), past which its set_obj draws nothing more. The board does not
 * stop there. Ryo's meshes carry a culled link after every face, so he
 * costs twice his faces in links. */
#define STF_POLYGON_LIMIT 5000u
void poly_win_draw(const u32 n[3]) {
    static const char *const label[6] = { "1P ", "2P ", "STAGE", "TOTAL", "LINKS", "LIMIT" };
    u32 r, v;
    char b[8];
    win_frame(PWIN_COL, PWIN_ROW, PWIN_W, PWIN_H);
    put_at(PWIN_COL + 1u, PWIN_ROW + 1u, "POLYGON", T_INV);
    for (r = 0; r < 6u; r++) {
        const char *d;
        u32 row = PWIN_ROW + 2u + r + (r >= 4u);         /* a blank line before StF's count */
        put_at(PWIN_COL + 1u, row, label[r], T_TEXT);
        if (r < 2u) put_at(PWIN_COL + 4u, row, fighter_name[menu_val[r ? M_P2 : M_P1]], T_TEXT);
        v = r < 2u ? n[1u + r] : r == 2u ? n[0] : r == 3u ? n[0] + n[1] + n[2]
          : r == 4u ? g_cop_p : STF_POLYGON_LIMIT;
        d = dec(v, b);
        put_at(PWIN_COL + PWIN_W - 1u - slen(d), row, d, T_INV);
    }
}

/* One pass of the menu on the pads' new presses (e) and held bits (h),
 * StF's pad bits. Returns the item whose value changed, M_START when the
 * fight is to begin, or M_ITEMS for neither. */
u32 menu_input(u32 e, u32 h, u32 start) {
    u32 i = menu_cur, v;
    if (h & 4u) e |= h;                  /* guard held: repeat, as StF's window does */
    if (start || (i == M_START && (e & 3u))) return M_START;
    if (e & 0x10u) { menu_cur = (menu_cur + 1u) % M_ITEMS; return M_ITEMS; }
    if (e & 0x20u) { menu_cur = (menu_cur + M_ITEMS - 1u) % M_ITEMS; return M_ITEMS; }
    if (i == M_START || !(e & 3u)) return M_ITEMS;
    v = menu_val[i];
    if (e & 2u) v = v + menu_step[i] > menu_max[i] ? menu_min[i] : v + menu_step[i];
    else v = v < menu_min[i] + menu_step[i] ? menu_max[i] : v - menu_step[i];
    menu_val[i] = (u16)v;
    return i;
}
