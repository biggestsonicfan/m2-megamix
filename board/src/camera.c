/*
 * camera.c — the board's camera: camera_init's fixed view for the setup,
 * StF's own camera object (stf_camera, fa_camera) and camera_stf, which
 * follows it each frame as camera_control does, and the light it carries.
 */
#include "megamix.h"

/* The camera: at (0, CAM_Y, CAM_Z) in StF's units (1.6 times the board's
 * world, whose stages are baked at StF's 1/1.6), looking along +z, pitched
 * down by an angle whose sine and cosine are CAM_S and CAM_C (8 degrees). */
#define CAM_Y 1.76f
#define CAM_Z (-7.36f)
#define CAM_S 0.139173f
#define CAM_C 0.990268f
#define STF_CAM_SCALE 0x3FCCCCCDu        /* 1.6 */
mat_t cam, cam_l;                 /* cam_l: before the scale, for the light and the fighters */

/* camera_init's matrix, with the camera's turn already in the coprocessor:
 * set_pos by the negated position, then (after the light's copy) op 0x07
 * with 1.6, 1.6, 1.6, as StF sends it before it stores the camera. The
 * position is StF's eye, in fighter units, so a stage drawn on cam is
 * R (1.6 v - eye), as in StF. Every stage matrix is cam times its own; the
 * fighters are drawn on cam_l, as rob_disp draws them on the unscaled
 * camera (rob+0x2A40). */
void camera_place(const float pos[3]) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    int i;
    *cf = COP_SET_POS;
    for (i = 0; i < 3; i++) *cf = m2_obj_fb(pos[i]) ^ 0x80000000u;
    cop_read(&cam_l);
    cop_load(&cam_l);
    *cf = COP_SCALE; *cf = STF_CAM_SCALE; *cf = STF_CAM_SCALE; *cf = STF_CAM_SCALE;
    cop_read(&cam);
}

void camera_at(const float pos[3], float sy, float cy, float sx, float cx) {
    /* about x by the angle whose sine and cosine are sx, cx (y' = c y - s z,
     * z' = s y + c z), after a turn about y by sy, cy */
    const float turn[9] = {
        cy, 0.0f, -sy,  sx * sy, cx, sx * cy,  cx * sy, -sx, cx * cy };
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    int i;
    *cf = COP_WMATRIX;
    for (i = 0; i < 9; i++) *cf = m2_obj_fb(turn[i]);
    for (i = 0; i < 3; i++) *cf = 0u;
    camera_place(pos);
}

void camera_init(void) {
    static const float pos[3] = { 0.0f, CAM_Y, CAM_Z };
    camera_at(pos, 0.0f, 1.0f, CAM_S, CAM_C);
}

/* camera_init's light, in the camera's frame: on the coprocessor, the camera's
 * turn, then ang_y by VECTER_Y and ang_x by VECTER_X, and op 0x29 on
 * (0, 0, BRIGHT), from the camera before its scale. StF sends it to the geometrizer (slot 0xA0) before the stage
 * and, scaled by rob_light (1.0 but in a hit flash), before each fighter. It
 * is built every frame from the camera's turn (camera_stf), so it stays fixed
 * in the world as the camera moves. */
float light[3];

/* The board's camera as StF's camera object: at (0, CAM_Y, CAM_Z), yaw 0
 * (StF's camera looks along (-sin, cos) in x, z: +z). */
void stf_camera(void) {
    RW(stf_cam, CAMERA_XPOS) = 0u;
    RW(stf_cam, CAMERA_XPOS + 4u) = m2_obj_fb(CAM_Y);
    RW(stf_cam, CAMERA_XPOS + 8u) = m2_obj_fb(CAM_Z);
    RH(stf_cam, CAMERA_XANG) = 0xFA50u;  /* 8 degrees down */
    RH(stf_cam, CAMERA_YANG) = 0u;
    /* both fighters shown: osage_dsp draws their chains */
    RW(stf_cam, CAMERA_FLAG) |= CAMERA_ROB0_DISP | CAMERA_ROB1_DISP;
}

/* The fight's camera is StF's own: camera_work's mode 9 (cam_mode_9) places
 * it at a round's start and mode 10 (cam_mode_10) moves it each 60 Hz frame,
 * on the camera object (fa_camera): its place at +0x18 in the fighters'
 * units, its turn at +0x24 (x), +0x26 (y), +0x28 (z). camera_control's
 * matrix from them: identity, ang_z, ang_x and ang_y by the negated angles,
 * then the place; the board's camera is in units 1.6 times the fighters'
 * (as its scale is), so the place goes in 1.6 times. The light is built
 * from the turn every frame, as camera_control builds it. */
void camera_stf(const stage_t *st) {
    volatile u32 *cf = (volatile u32 *)M2_COPFIFO_ADDR;
    float pos[3];
    int i;
    for (i = 0; i < 3; i++) pos[i] = *(float *)((u8 *)stf_cam + CAMERA_XPOS + 4 * i);
    *cf = COP_IDENTITY;
    *cf = COP_ANG_Z; *cf = (u32)-(int)(short)RH(stf_cam, CAMERA_ZANG);
    *cf = COP_ANG_X; *cf = (u32)-(int)(short)RH(stf_cam, CAMERA_XANG);
    *cf = COP_ANG_Y; *cf = (u32)-(int)(short)RH(stf_cam, CAMERA_YANG);
    camera_place(pos);
    stage_light(st);
}
