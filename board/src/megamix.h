/*
 * megamix.h — Fighters Megamix on the Sonic the Fighters board (Model 2B).
 *
 * A new program for the board, built on m2-sdk. Sonic the Fighters' program is
 * the map: its data ROMs stay on the board, and its own motion code poses the
 * fighters: set_motion, calc_rob_angle and calc_unit_mat, lifted from StF's
 * program into src/stf_motion.s by tools/lift-stf.py. calc_unit_mat leaves one
 * part matrix per slot on the coprocessor, and each part is drawn from its
 * slot (op 0x37) with op 0x78, the object path m2_obj.h proves on the real
 * geometrizer.
 *
 * The program is one board of modules, each a .c file of src/ (docs/BOARD.md
 * lists them): this header is what they share. The stage draw lists, the eye
 * models and the colour runs come from tools/bake-board.mjs (src/poses.h).
 */
#ifndef MEGAMIX_H
#define MEGAMIX_H

#include "m2.h"
#include "m2_obj.h"
#include "stf_tex_codec.h"   /* the SDK's, with room for StF's stage sets */
#include "poses.h"
#include "stf_motion.h"
#include "rob.h"
#include "link.h"

#define FOCUS 280.0f

/* StF's texture sets: 1 holds the fighters, uploaded with every stage. */
#define SET_FIGHTERS 1u

typedef struct { float r[9], t[3]; } mat_t;   /* column-major, the COP's layout */

/* A fighter as the setup picks him: his character (and its baked colours),
 * his place (x, z) and yaw at a round's start. */
typedef struct { const pose_anim_t *anim; float x, z; u16 yaw; } fighter_t;

/* stf_call.s: StF's lifted code (stf_motion.s) run with the registers its
 * functions expect: g7 the rob, g8 the other, g13 the task (stf_task), or g0
 * and g1 (stf_call_g01), or g3 (stf_call_g3). */
extern void stf_call(void (*fn)(void), void *rob, void *enemy, u32 arg);
extern void stf_task(void (*fn)(void), void *task, void *rob, void *enemy);
extern void stf_call_g01(void (*fn)(void), u32 g0, u32 g1);
extern void stf_call_g3(void (*fn)(void), void *rob, void *g3);

/* Points in slot c's frame carried into slot h's: H^-1 C p for each
 * (carry.c, on the i960's floating point). */
extern void carry(const mat_t *h, const mat_t *c, const float (*in)[3], float (*out)[3], u32 n);

/* op 0x10: the current matrix's turn faced to the camera */
#define COP_FACE COP_CMD(0x10)

/* ---- cop.c: the coprocessor's matrix and the submits ---- */
extern u32 polys;                        /* the faces submitted since last zeroed */
void cop_load(const mat_t *m);
void cop_load_turn(const mat_t *m);
void cop_read(mat_t *m);
void submit_cur_ov(u32 model, u32 ow, u32 ov);
void submit_mat_ov(u32 model, const mat_t *m, u32 ow, u32 ov);
void submit_mat(u32 model, const mat_t *m);
void submit_cur(u32 model);
void mat_mul(mat_t *a, const mat_t *b, const float *c);
void mat_turn(mat_t *m, u32 op, u32 a);

/* ---- main.c: the frame loop ---- */
extern u32 frame_counter;                /* StF's frame_counter, the 60 Hz count */

/* ---- camera.c ---- */
extern mat_t cam, cam_l;                 /* the camera, and before its 1.6 scale */
extern float light[3];                   /* the stage's light in the camera's frame */
void camera_place(const float pos[3]);
void camera_at(const float pos[3], float sy, float cy, float sx, float cx);
void camera_init(void);
void stf_camera(void);
void camera_stf(const stage_t *st);

/* ---- fighter.c: StF's fighters and the fight ---- */
#define ROB_SIZE  0x3400u
#define GAME_TIMER (*(short *)stf_ram(G_GAME_TIMER))   /* s16, the clock in 64ths of a second */
#define MOT_SIZE  0x800u
#define STF_STANCE 278u                  /* the motion both fighters play at a fight's start */
extern u32 robs[2][ROB_SIZE / 4];
extern u32 mots[2][MOT_SIZE / 4];
extern u32 stf_cam[0x500 / 4];
extern u32 stf_rec[0x40], stf_obj0[0x40];
extern u32 stf_coli[0x400 / 4];
extern u32 stf_effect[0xC80 / 4];
extern u32 stf_tobi[0x2000 / 4];
extern u32 stf_enemy[2][0x280 / 4];
extern u32 stf_disp[0x100 / 4];
extern u32 stf_osage[2][0x280 / 4];
extern u32 round_time;                   /* seconds, the setup menu's time */
extern const char *const game_name[];    /* by char_game's value */
void task_reset(u32 *t, u32 size);
const u32 *stf_char(u32 c);
u32 char_game(u32 c);
const pose_anim_t *pose_anim(u32 n);
void stf_globals(void);
void rob_init(u32 p, const fighter_t *f);
void rob_start(u32 p);
void fight_step(const u32 pad[2]);
void round_start(fighter_t fs[2], u32 next);
void hud_draw(void);
void boot_state(u32 save);

/* ---- sound.c ---- */
#define SND_RESET   0xA00001u            /* the sound program's reset: silence */
#define SND_GONG    0xAE1302u            /* sd_gong_4: a round starts or is decided */
void snd_request_special(u32 code);
void snd_request_u(u32 code);
void snd_pump(void);
void snd_round(u32 stage, const stage_t *st, u32 first);

/* ---- armour.c ---- */
void armour_limits(u32 p);
void armour_keep(u32 p);
void armour_back(u32 p);
void armour_forget(void);
void armour_hud_load(void);
void armour_hud(void);

/* ---- osage.c: the sway chains and StF's list blocks ---- */
#define OSAGE_MIRROR 6u                  /* the layer of the chains' reflections */
void osage_step(void);
void clear_buffer_ptr(void);
void osage_splice(u32 n);
void osage_camera(void);

/* ---- kage.c: the shadows ---- */
#define KAGE_NO_INSIDE 2u                /* Aurora Icefield: StF mirrors its fighters in the ice instead */
/* StF's stage records (sub_29350's), 256 bytes a stage slot, in the copied ROM */
#define STF_STAGE_REC(slot) (0x8F3D0u + (slot) * 256u)
#define STAGE_TEX_COL       0x0Eu        /* u16, send_tex_col_stage's g1 */
#define STAGE_SOKO          0xC8u        /* f32 stage_soko */
void kage_balls(void);
void kage_mode(void);
void kage_stage(const stage_t *st);
void kage_light(const stage_t *st);
void kage_inside(const stage_t *st);
void kage_outside(u32 p);

/* ---- fighter_draw.c ---- */
void draw_fighter(const fighter_t *f, u32 p, u32 mirror);
void spin_frame(u32 p);
void mirror_draw(const stage_t *st, const fighter_t fs[2], u32 pn[3]);

/* ---- effects.c: afterimages, projectiles, StF's effects ---- */
void zanzou_draw(u32 pn[3]);
void tobi_draw(u32 pn[3]);
void effects_draw(void);

/* ---- tpd.c: the moving texture points ---- */
#define TPD_ADDR (GEO_TEXRAM_BIT | 0x5000u)
void move_tpd_send(const tpd_t *t);
void eyes_frame(const tpd_t *st);

/* ---- stage.c ---- */
extern const stage_t *cur_stage;         /* the stage the fight is on (load_stage) */
extern u32 turn_at;                      /* frame_counter at the round's start: FV's town turns from it */
u32 storm_lit(const stage_t *st);
void stage_light(const stage_t *st);
void stage_round_start(void);
void draw_stage(const stage_t *st);
void send_materials(const u32 *mat);
void load_stage(u32 n);
u32 stage_index(void);                  /* cur_stage's menu index (stages[] is each file's own) */

/* ---- colors.c ---- */
void cx_put(const cx_run_t *c);
void stage_colors(const stage_t *st);
void fighter_colors(u32 p, const pose_anim_t *a);
void bg_col_set(u16 c);
void load_fighter_colors(const pose_anim_t *p1, const pose_anim_t *p2);

/* ---- texture.c ---- */
void tex_load_set(u32 page);
void load_palettes(void);

/* ---- sky.c ---- */
void sky_load(const sky_t *s);
void sky_frame(const stage_t *st);
void sky_storm_frame(const stage_t *st);

/* ---- menu.c: the setup menu, on tile layer 1 ---- */
#define TILE_L1    ((volatile u16 *)0x01002000u)
#define TILE_MASK  ((volatile u16 *)0x0100C000u)   /* layers 0 and 1's window mask */
#define WIN_COL    16u
#define WIN_ROW    3u
#define WIN_W      28u
#define T_TEXT     0x8000u
#define T_INV      0x8080u
enum { M_START, M_TIME, M_ROUND, M_STAGE, M_P1, M_P2, M_ENERGY, M_BARRIER, M_LINK, M_ITEMS };
extern u16 menu_val[M_ITEMS];
extern u32 menu_cur;
extern const char *const link_name[3];
extern const char *const link_state_name[6];
u32 slen(const char *s);
void put_at(u32 col, u32 row, const char *s, u32 base);
void win_put(u32 col, u32 row, const char *s, u32 base);
const char *dec(u32 n, char *b);
void mask_rect(u32 col, u32 row, u32 w, u32 h);
void menu_ink(u32 on);
void menu_mask(u32 on);
void menu_clear(void);
void win_frame(u32 col, u32 row, u32 w, u32 rows);
void menu_draw(void);
void poly_win_draw(const u32 n[3]);
u32 menu_input(u32 e, u32 h, u32 start);

/* ---- ringout.c ---- */
extern u32 ring_out;                     /* the round ended in a ring out */
void ring_out_reset(void);
void ring_out_step(const stage_t *st);
void ring_msg(u32 on);

/* ---- replay.c ---- */
extern u32 stf_play[0x100 / 4];
extern u32 rep_on;                       /* a replay runs */
void rep_quit(void);
void rep_step(void);
u32 rep_watch(void);
void rep_round(void);
void rep_forget(void);

/* ---- linkplay.c ---- */
void link_wait(void);
u32 link_sum(u32 in_menu, u32 over);
void link_set(lk_u16 set[LINK_SETS]);
u32 link_boot(lk_u16 set[LINK_SETS]);

#endif
