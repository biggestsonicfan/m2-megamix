/*
 * effects.c — what camera_init draws after the fighters: the afterimages
 * (zanzou_disp), the projectiles (tobi_disp: Eggman's bombs, their markers
 * and fuses) and StF's effect tasks (sparks, rings, barriers, the K.O.).
 */
#include "megamix.h"

/* The afterimages: the coprocessor's ring of 128 copies, which
 * zanzou_control (fight_step) lays from each fighter's parts while his
 * motion's op 0x26 holds a part mask. zanzou_disp (0x8ACD0), under the
 * camera: for each ring slot, Fn_zanzou_get_info (0x85: part, player, life,
 * step, the model its age picks) and, while it has life and frame_counter
 * plus the slot is odd (the copies flicker, out of step with their
 * neighbours: StF draws them opaque), Fn_zanzou_mul_matrix_inner (0x84: the
 * copy's matrix onto the current one) and the model. StF turns it about X
 * by the projectile module's +0x5C first, which is 0. Each copy's faces go
 * to its fighter's count. A model 0 (a part with no card) draws nothing. */
#define COP_ZANZOU_INFO COP_CMD(0x85)
#define COP_ZANZOU_MUL COP_CMD(0x84)
void zanzou_draw(u32 pn[3]) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    u32 slot, k, info[5];
    cop_load(&cam_l);
    for (slot = 0; slot < 128u; slot++) {
        u32 before = polys;
        *cf = COP_ZANZOU_INFO; *cf = slot;
        for (k = 0; k < 5u; k++) info[k] = *cf;
        if ((int)info[2] <= 0 || !((frame_counter + slot) & 1u) || info[4] == 0u) continue;
        *cf = COP_PUSH;
        *cf = COP_ZANZOU_MUL; *cf = slot;
        submit_cur(info[4] & 0xFFFFu);
        *cf = COP_POP;
        pn[1u + (info[1] & 1u)] += polys - before;
    }
}

/* The projectiles: StF's tobi_disp (0x8A518), under the unscaled camera as
 * zanzou_disp. For each live object not hidden whose type draws
 * (_uk_projectile; the bomb's tdl_bakudan): tobi_disp_go, its model at its
 * place, faced to the camera (op 0x10) on TOBI_F_FACE (the burst), else
 * turned by its y, x and z angles unless TOBI_F_TURNLESS, and scaled. Then,
 * while it is in flight, the landing marker: a ring from
 * bomb_fire_location_marker_circle and, by the part of its flight left (in
 * tenths), a marker from bomb_fire_location_marker drawn twice, turned by
 * (1 - left) a quarter turn each way. Then the fuse while it holds a fuse
 * model and has not burst: the point after the last frame of its fuse list
 * (bomb_fuse) carried through the bomb's place, turn and scale (op 0x29),
 * faced to the camera, scaled by its own scale. Each object's faces count
 * toward its thrower. rob.h names the fields (TOBI_). */
static const u16 bomb_ring[11] = { 2204, 2204, 2204, 2205, 2205, 2205, 2205, 2203, 2203, 2203, 2203 };
static const u16 bomb_mark[11] = { 2200, 2200, 2200, 2202, 2202, 2202, 2202, 2201, 2201, 2201, 2201 };

static void tobi_place(const u32 *o) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    *cf = COP_SET_POS; *cf = RW(o, TOBI_XPOS); *cf = RW(o, TOBI_XPOS + 4u); *cf = RW(o, TOBI_XPOS + 8u);
    if (RW(o, TOBI_FLAG) & TOBI_F_FACE) *cf = COP_FACE;
    else if (!(RW(o, TOBI_FLAG) & TOBI_F_TURNLESS)) {
        *cf = COP_ANG_Y; *cf = (u32)(int)(short)RH(o, TOBI_YANG);
        *cf = COP_ANG_X; *cf = (u32)(int)(short)RH(o, TOBI_XANG);
        *cf = COP_ANG_Z; *cf = (u32)(int)(short)RH(o, TOBI_ZANG);
    }
}

void tobi_draw(u32 pn[3]) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    u32 n;
    cop_load(&cam_l);
    for (n = 0; n < 30u; n++) {
        u32 *o = stf_tobi + (TOBI_OBJ + n * 0x100u) / 4u;
        u32 before = polys, w0 = RW(o, TOBI_FLAG);
        if (!(w0 & TASK_ALIVE) || (w0 & TOBI_F_HIDDEN) || RW(o, TASK_SIZE) == 0u || RB(o, TOBI_TYPE) != TOBI_BOMB) continue;
        *cf = COP_PUSH;
        tobi_place(o);
        *cf = COP_SCALE; *cf = RW(o, TOBI_SCALE); *cf = RW(o, TOBI_SCALE); *cf = RW(o, TOBI_SCALE);
        if (RH(o, TOBI_MODEL)) submit_cur(RH(o, TOBI_MODEL));
        *cf = COP_POP;
        if (RH(o, TOBI_IN_FLIGHT) && RB(o, TOBI_FLIGHT)) {
            float left = (float)RB(o, TOBI_FLIGHT_LEFT) / (float)RB(o, TOBI_FLIGHT);
            int i = (int)(left * 10.0f), turn = (int)((1.0f - left) * 16384.0f);
            if (i < 0) i = 0;
            if (i > 10) i = 10;
            *cf = COP_PUSH;
            *cf = COP_SET_POS; *cf = RW(o, TOBI_MARK_XPOS); *cf = RW(o, TOBI_MARK_XPOS + 4u); *cf = RW(o, TOBI_MARK_XPOS + 8u);
            submit_cur(bomb_ring[i]);
            *cf = COP_PUSH;
            *cf = COP_ANG_Y; *cf = (u32)turn;
            submit_cur(bomb_mark[i]);
            *cf = COP_POP;
            *cf = COP_ANG_Y; *cf = (u32)-turn;
            submit_cur(bomb_mark[i]);
            *cf = COP_POP;
        }
        if (!(w0 & TOBI_F_BURST) && RH(o, TOBI_FUSE_MODEL)) {
            const u32 *fuse = (const u32 *)RW(o, TOBI_FUSE);
            const u32 *at = fuse + 1 + 4u * fuse[0];
            u32 w[3];
            *cf = COP_PUSH;
            *cf = COP_IDENTITY;
            *cf = COP_SET_POS; *cf = RW(o, TOBI_XPOS); *cf = RW(o, TOBI_XPOS + 4u); *cf = RW(o, TOBI_XPOS + 8u);
            *cf = COP_ANG_Y; *cf = (u32)(int)(short)RH(o, TOBI_YANG);
            *cf = COP_ANG_X; *cf = (u32)(int)(short)RH(o, TOBI_XANG);
            *cf = COP_ANG_Z; *cf = (u32)(int)(short)RH(o, TOBI_ZANG);
            *cf = COP_SCALE; *cf = RW(o, TOBI_SCALE); *cf = RW(o, TOBI_SCALE); *cf = RW(o, TOBI_SCALE);
            *cf = COP_M2W; *cf = at[0]; *cf = at[1]; *cf = at[2];
            w[0] = *cf; w[1] = *cf; w[2] = *cf;
            *cf = COP_POP;
            *cf = COP_PUSH;
            *cf = COP_SET_POS; *cf = w[0]; *cf = w[1]; *cf = w[2];
            *cf = COP_FACE;
            *cf = COP_SCALE; *cf = RW(o, TOBI_FUSE_SCALE); *cf = RW(o, TOBI_FUSE_SCALE); *cf = RW(o, TOBI_FUSE_SCALE);
            submit_cur(RH(o, TOBI_FUSE_MODEL));
            *cf = COP_POP;
        }
        pn[1u + ((u32 *)RW(o, TOBI_OWNER) == robs[1])] += polys - before;
    }
}

/* The effects camera_init draws after the projectiles, on the fighters'
 * camera, in its order, each with set_obj (its faces in POLYGON, as
 * osage_dsp's), on the camera's block (g13: they face the camera by its
 * angles):
 * - efc_disp: the hit sparks, dust and flying pieces efc_cont steps (the
 *   collision's efc_rob_set_set and the like put them in);
 * - efc_face_opt_disp: the marks over a fighter's head (shock, "?", "NO");
 * - guard_attack_effect_disp: a guarded hit's flash (smoke_pattern_put, before
 *   it, draws nothing in StF: its pointers at 0x500890 are never set);
 * - ring_tobitiri: the rings a hit knocks out of one of StF's fighters
 *   (damage_calculation's ring_tobitiri_set: more for a bigger hit; parts
 *   in their place from StF's boss robots, characters 0xB and 0xD, which the
 *   board has not, so Eggman drops rings as in StF) and the stars over
 *   a stunned one. It steps them too (they fall, bounce off the walls at 7.5
 *   and blink out); on Aurora Icefield (stage_num 2) each has its reflection;
 * - kira_kira_disp, each fighter's: hyper mode's sparkles;
 * - guard_barrier_effect_disp: a barrier's shield, and its pieces when it
 *   breaks;
 * - laser_effect_disp: Metal Sonic's laser charging;
 * - ko_disp, after the HUD's text: the turning K.O. that grows in over a
 *   knock-out, while also_sub_mode is JUDGE_DSP (the round's end sets it).
 * The sparks that efc_disp puts in list blocks (layers 9 and 13, which
 * camera_init runs before the stage and after the cage) run here. */
#define EFC_LAYER_A 9u
#define EFC_LAYER_B 13u
void effects_draw(void) {
    u32 p;
    cop_load(&cam_l);
    stf_task(stf_efc_disp, stf_cam, robs[0], robs[1]);
    stf_task(stf_efc_face_opt_disp, stf_cam, robs[0], robs[1]);
    stf_task(stf_guard_attack_effect_disp, stf_cam, robs[0], robs[1]);
    stf_task(stf_ring_tobitiri, stf_cam, robs[0], robs[1]);
    for (p = 0; p < 2u; p++) stf_task(stf_kira_kira_disp, stf_cam, robs[p], robs[p ^ 1u]);
    stf_task(stf_guard_barrier_effect_disp, stf_cam, robs[0], robs[1]);
    stf_task(stf_laser_effect_disp, stf_cam, robs[0], robs[1]);
    osage_splice(EFC_LAYER_A);
    osage_splice(EFC_LAYER_B);
    stf_task(stf_ko_disp, stf_cam, robs[0], robs[1]);
}
