/*
 * main.c — the board's frame loop.
 *
 * The boot (boot_board) sets the board, StF's globals and the setup menu up
 * and links to the other cabinet if there is one. Then, once a vsync: the
 * pads (through the link when the boards are linked), the setup menu or the
 * fight's inputs, the scene's stage (scene_begin), the fight stepped a 60 Hz
 * frame for every vblank since the last pass (fight_frame: the round's end,
 * the ring out, the replay), the fighters and the effects (scene_end), and
 * the wait for the vsync, sending the sound meanwhile (vsync_wait).
 *
 * A match: match_start from the setup, round_judge when a round is decided,
 * round_end three seconds later (the next round, or the setup once the
 * match is won), match_reset when the boards link or part.
 */
#include "megamix.h"

/* StF's frame_counter; the frame loop copies it to 0x500020, where StF's
 * code (sub_2435C's colour cycling) reads it. */
u32 frame_counter;

static fighter_t fs[2];                  /* the fighters, as the setup picks them */
static lk_u16 set[LINK_SETS];            /* the setup, as the link carries it */
static u32 stage;                        /* the stage's number (stages[], the setup's) */
static u32 in_menu = 1u;                 /* the setup menu is up */
static u32 over;                         /* the round is decided: frames to the next */
static u32 quit;                         /* both starts: back to the setup */
static u32 held, pheld;                  /* the starts and pads held last frame (edges) */
static u32 step;                         /* frame_counter at the last fight step */
static u32 vbl;                          /* frameVBL at the last vsync */
static u32 pn[3];                        /* the faces drawn: the stage's, each fighter's */

static u32 pad_bits(const m2_player_t *p) {
    return (u32)p->b1 | (u32)p->b2 << 1 | (u32)p->b3 << 2 | (u32)p->down << 4 |
           (u32)p->up << 5 | (u32)p->right << 6 | (u32)p->left << 7;
}

static u32 edges(u32 now, u32 *last) { u32 e = now & ~*last; *last = now; return e; }

/* StF's blank front layer (clr_pattern_s), the setup's window over it */
static void menu_open(void) {
    u32 i;
    in_menu = 1u;
    for (i = 0; i < 64u * 64u; i++) M2_TILE_FG[i] = 0x20u;
    menu_mask(1u);
}

/* the setup's values into StF's globals, as a match starts on them */
static void setup_apply(void) {
    round_time = menu_val[M_TIME];
    RAM32(G_ENERGY_MAX) = menu_val[M_ENERGY];
    RAM32(G_BARRIER_DEFAULT) = menu_val[M_BARRIER];
    RAM8(G_WINS_NEEDED) = (u8)menu_val[M_ROUND];
    RAM8(G_ROUND_WINS0) = RAM8(G_ROUND_WINS1) = 0u;
}

/* The board as the boot leaves it: the SDK's init, the fighters' textures and
 * palettes, StF's globals, the first stage, StF's tiles, the setup menu
 * over the fighters in their stance, the fight's state kept (boot_state)
 * and the link's role from the backup RAM. Returns link_boot's pass. */
static u32 boot_board(void) {
    u32 i;
    m2_init();
    m2_silicon_boot();
    m2_sound_init();                     /* init_sound: the USART, then the sound program's reset */
    m2_cam_set_focus(FOCUS);
    camera_init();
    tex_load_set(SET_FIGHTERS);
    load_palettes();
    stf_globals();
    /* the test menu's monitor setting as the boot reads it: CRT, StF's
     * TST_* curve constants (load_COLORS_to_RAM, chg_scr_color_req) */
    stf_call(stf_set_display_type_crt, robs[0], robs[1], 0u);
    load_stage(stage);                   /* its fighters' colours once they are set up (round_start) */
    for (i = 0; i < 8u; i++) { m2_frame_begin(); m2_frame_end(); }

    stf_camera();
    /* StF's tiles and their colours: the set the boot loads (the clock's
     * digits, the bars, the debug font and frames), then the fight's, as
     * MES_ROUND_INT loads them */
    stf_call(stf__Scroll_Initialize, robs[0], robs[1], 0u);
    stf_call(stf__Scroll_Initialize, robs[0], robs[1], 70u);
    stf_call(stf__Scroll_Initialize, robs[0], robs[1], 170u);
    bg_col_set(cur_stage->bg);           /* scr_bg_int, after them: the stage's pen 0 again */
    for (i = 0; i < 64u * 64u; i++) M2_TILE_FG[i] = 0x20u;   /* StF's blank (clr_pattern_s) */
    menu_clear();
    menu_mask(1u);
    fs[0].anim = pose_anim(menu_val[M_P1]);
    fs[1].anim = pose_anim(menu_val[M_P2]);
    round_start(fs, 0u);
    load_fighter_colors(fs[0].anim, fs[1].anim);
    boot_state(1u);
    menu_val[M_LINK] = (u16)link_saved();
    link_start(menu_val[M_LINK]);
    return link_boot(set);
}

/* The boards linked (LP_SYNC: both from the same start, the master's setup
 * and its cursor) or parted (LP_DROP: this one alone again): the setup, the
 * fight's state as the boot left it, the clock counted from 0. */
static void match_reset(u32 lp) {
    u32 i;
    if (lp == LP_SYNC) {
        for (i = 1; i < M_LINK; i++) menu_val[i] = set[i];
        menu_cur = set[M_START] % M_ITEMS;
    }
    if (rep_on) rep_quit();
    boot_state(0u);
    rep_forget();
    armour_forget();
    stf_globals();
    frame_counter = step = 0u;
    RAM32(G_FRAME_COUNTER) = 0u;
    setup_apply();
    stage = menu_val[M_STAGE];
    load_stage(stage);
    fs[0].anim = pose_anim(menu_val[M_P1]);
    fs[1].anim = pose_anim(menu_val[M_P2]);
    menu_open();
    round_start(fs, 0u);
    stage_colors(cur_stage);
    load_fighter_colors(fs[0].anim, fs[1].anim);
    menu_ink(1u);
    snd_request_u(SND_RESET);
    over = quit = held = pheld = 0u;
}

/* The setup window, on either pad: h its held pad bits, e the new start
 * presses. The fighters stand in their stance behind it, on the stage it
 * picks, with the clock held. */
static void menu_frame(u32 h, u32 e) {
    u32 c = menu_input(edges(h, &pheld), h, e & 3u), i;
    if (c == M_LINK) {
        /* this cabinet's role, a fresh start of its comm board;
         * linked, both boards see the press: both go alone */
        u32 r = link.state == LS_RUN ? LINK_OFF : menu_val[M_LINK];
        menu_val[M_LINK] = (u16)r;
        link_save(r);
        link_start(r);
    }
    if (c == M_STAGE) {
        stage = menu_val[M_STAGE];
        load_stage(stage);
        load_fighter_colors(fs[0].anim, fs[1].anim);   /* their bands, over the stage's rows */
        menu_ink(1u);
    }
    if (c == M_P1 || c == M_P2) {
        i = c == M_P1 ? 0u : 1u;
        fs[i].anim = pose_anim(menu_val[c]);
        rob_init(i, &fs[i]);
        rob_start(i);
        armour_limits(i);
        /* the scene's rows again: a guest's seven part rows took StF's fixed ones */
        stage_colors(cur_stage);
        load_fighter_colors(fs[0].anim, fs[1].anim);
        menu_ink(1u);
    }
    if (c == M_START) {
        setup_apply();
        menu_clear();
        round_start(fs, 0u);
        snd_round(stage, cur_stage, 1u);
        over = 0u;
        in_menu = 0u;
    } else {
        menu_draw();
        GAME_TIMER = (short)(round_time << 6);
    }
}

/* The round, as VF2's JUDGE_DSP_INT gives it: to the one whose bit 5 is
 * clear (a knock-out, a ring out), else to the one with more energy left.
 * Then StF's judging, for ko_disp and the rules that stop at the round's
 * end (attack_hit, damage_unit): also_sub_mode JUDGE_DSP, and 0x500050 0
 * for a knock-out (the K.O.), 2 for the time running out (JUDGE_DSP_INT's
 * not_scr_bg_move bit 0) or a ring out, which StF never has. _sub_mode
 * stays FIGHT_DSP, so cam_mode_10 keeps following. */
static void round_judge(void) {
    short e0 = (short)RH(robs[0], ROB_ENERGY), e1 = (short)RH(robs[1], ROB_ENERGY);
    u32 l0 = RW(robs[0], ROB_FLAG) & ROB_F_LOST, l1 = RW(robs[1], ROB_FLAG) & ROB_F_LOST;
    if (l0 != l1) (RAM8(l0 ? G_ROUND_WINS1 : G_ROUND_WINS0))++;
    else if (e0 != e1) (RAM8(e0 > e1 ? G_ROUND_WINS0 : G_ROUND_WINS1))++;
    if (ring_out) ring_msg(1u);
    RAM8(G_SUB_MODE + 1u) = SUB_JUDGE_DSP;
    RAM8(G_JUDGE) = (l0 | l1) && !ring_out ? 0u : 2u;
    snd_request_u(SND_GONG);
    over = 180u;
}

/* Three seconds after a round is decided (at once on quit): the next round,
 * or the setup once a fighter has won the match. Returns 0 then: no more
 * fight steps this pass. */
static u32 round_end(void) {
    u32 won = menu_val[M_ROUND];
    if (!quit && --over) return 1u;
    if (ring_out) ring_msg(0u);
    if (quit || RAM8(G_ROUND_WINS0) >= won || RAM8(G_ROUND_WINS1) >= won) {
        menu_open();
        RAM8(G_ROUND_WINS0) = RAM8(G_ROUND_WINS1) = 0u;
        round_start(fs, 0u);
        snd_request_u(SND_RESET);
        over = quit = 0u;
        return 0u;
    }
    round_start(fs, 1u);
    snd_round(stage, cur_stage, 0u);
    over = 0u;
    return 1u;
}

/* One 60 Hz frame of the fight (or of the replay): StF's tasks, then the
 * round's end looked for: an armour break's replay first (FV's FIGHT_DSP),
 * a knock-out (a fighter's w0 bit 5) or the clock's end. Returns 0 when
 * the match is over: no more steps this pass. */
static u32 fight_frame(const u32 pad[2]) {
    short clock = GAME_TIMER;
    if (rep_on) { rep_step(); return 1u; }
    fight_step(pad);
    if (in_menu) return 1u;
    if (over) GAME_TIMER = clock;        /* the clock stops once the round is decided */
    if (!over && !quit) ring_out_step(cur_stage);
    if (!over && !quit && rep_watch()) return 1u;
    if (quit || over) return round_end();
    if (((RW(robs[0], ROB_FLAG) | RW(robs[1], ROB_FLAG)) & ROB_F_LOST) || GAME_TIMER <= 0) round_judge();
    return 1u;
}

/* StF steps its fighters once a 60 Hz frame and draws every other one: a
 * frame of the motion for every vblank since the last pass (up to four),
 * the last one's matrices drawn. */
static void fight_frames(const u32 pad[2]) {
    u32 n = frame_counter - step;
    if (n > 4u) n = 4u;
    if (n == 0u) n = 1u;
    step = frame_counter;
    while (n--)
        if (!fight_frame(pad)) break;
}

/* The frame's start: the list, the camera and the light, the sky, the
 * moving texture points and the stage. */
static void scene_begin(void) {
    m2_frame_begin();
    m2_obj_frame_setup();
    clear_buffer_ptr();
    send_materials(cur_stage->mat);
    camera_stf(cur_stage);
    sky_frame(cur_stage);
    sky_storm_frame(cur_stage);
    osage_camera();
    m2_geo_fifo_light(m2_obj_fb(light[0]), m2_obj_fb(light[1]), m2_obj_fb(light[2]));
    move_tpd_send(&cur_stage->tpd);
    polys = 0u;
    draw_stage(cur_stage);
    pn[0] = polys;
}

/* The frame's rest, after the fighters are stepped: the HUD, the eyes, the
 * sway chains, the shadows inside the ring (or Aurora's reflections), then
 * the fighters in one more window, over the stage, the shadows on it and
 * the reflections, as StF draws them (camera_init's set_window(win_down)
 * before rob_disp) and FV over its cage; the afterimages, the projectiles,
 * the effects and the polygon counter. */
static void scene_end(void) {
    u32 i;
    if (!in_menu) hud_draw();
    eyes_frame(&cur_stage->tpd);
    osage_step();
    kage_light(cur_stage);
    kage_inside(cur_stage);
    if (cur_stage->slot == KAGE_NO_INSIDE) mirror_draw(cur_stage, fs, pn);
    else pn[1] = pn[2] = 0u;
    m2_geo_fifo_window_full();
    for (i = 0; i < 2u; i++) { polys = 0u; draw_fighter(&fs[i], i, 0u); spin_frame(i); kage_outside(i); pn[1u + i] += polys; }
    zanzou_draw(pn);
    tobi_draw(pn);
    effects_draw();
    if (in_menu) poly_win_draw(pn);
    *(volatile u32 *)ZCLIP_REG = 0xFFFF00FFu;
    m2_frame_commit();
}

/* 60 fps, as StF and VF2 run: a pass a vsync, the fighters stepped once
 * and drawn every frame. StF's frame_counter counts its 60 Hz loop and
 * sub_2435C runs once a pass, after the wait for the vsync. A pass that
 * runs past a vsync steps the fighters for each vblank it took, so the
 * count follows the vblanks. Linked, a pass is a frame of both boards',
 * however long it waited. */
static void vsync_wait(u32 lp) {
    u32 v = frameVBL;
    /* m2_vsync's wait, sending the sound queue meanwhile */
    while (frameVBL == v) snd_pump();
    v = frameVBL; frame_counter += lp == LP_TICK ? 1u : v - vbl; vbl = v;
    RAM32(G_FRAME_COUNTER) = frame_counter;
    if (cur_stage->slot != 0xFFFFu) stf_call(stf_sub_2435C, robs[0], robs[1], 0u);
}

int main(void) {
    u32 boot = boot_board();
    vbl = frameVBL;
    for (;;) {
        m2_player_t p[2];
        u32 i, e, pad[2] = { 0u, 0u }, pb[2], lp;
        lk_u32 in[2];
        p[0] = m2_player(0); p[1] = m2_player(1);
        /* each pad, start as LINK_START; linked, the cabinet's two pads
         * are its player's, and each player's comes from both boards */
        for (i = 0; i < 2u; i++) pb[i] = pad_bits(&p[i]) | (p[i].start ? LINK_START : 0u);
        /* alone, a fight keeps the other cabinet waiting: the boards link
         * from the setup */
        link.hold = !in_menu;
        if (boot) lp = boot, boot = 0u;
        else {
            link_set(set);
            lp = link_pass(pb[0] | pb[1], set, in, frameVBL, link_wait);
        }
        if (lp == LP_TICK) { pb[0] = in[0]; pb[1] = in[1]; }
        if (lp == LP_SYNC || lp == LP_DROP) { match_reset(lp); continue; }
        e = edges((pb[0] >> 8 & 1u) | (pb[1] >> 8 & 1u) << 1, &held);
        if (in_menu) menu_frame((pb[0] | pb[1]) & 0xFFu, e);
        else {
            pad[0] = pb[0] & 0xFFu; pad[1] = pb[1] & 0xFFu;
            /* both starts at once: back to the setup */
            if ((e & 3u) && (pb[0] & pb[1] & LINK_START)) quit = 1u;
        }

        scene_begin();
        fight_frames(pad);
        if (lp == LP_TICK) link_check(link_sum(in_menu, over));
        scene_end();
        vsync_wait(lp);
    }
    return 0;
}
