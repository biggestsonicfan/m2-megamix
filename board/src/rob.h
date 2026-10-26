/* StF's fighter (rob) and the fight's globals, by the names AM2's debug mode
 * gives them (ROBn_INFO, PARAMETER_SET, GAME_PARA: docs/DEBUG-MODE.md, which
 * also has VF2's and FV's offsets). The board's fighters are StF's robs, so
 * these are StF's offsets; VF2 and FV share them up to +0x62A and from +0x800
 * on. The fields no debug window names keep the board's own names. */
#ifndef ROB_H
#define ROB_H

/* ---- the rob, 0x3400 bytes ---- */
#define ROB_FLAG          0x000u   /* u32, the ROB_F_ bits */
#define ROB_IDNM          0x004u   /* u8 player (0, 1), the coprocessor's slot bank */
#define ROB_TASK_SIZE     0x008u   /* the task block's size (every task has it) */
#define ROB_TASK          0x00Cu   /* its task: action_init, then rob_action */
#define ROB_XPOS          0x018u   /* f32; ypos +0x01C, zpos +0x020 */
#define ROB_YPOS          0x01Cu
#define ROB_ZPOS          0x020u
#define ROB_YANG          0x026u   /* u16 facing: forward is (cos, -sin) in x, z */
#define ROB_PARTS         0x040u   /* the sixteen part models (calc_rob_angle_int) */
#define ROB_CHAR_REC      0x190u   /* the character's record (CHAR_PARTS), as action_init sets it */
#define ROB_COMMAND       0x194u   /* u32, the matched command */
#define ROB_ACTION        0x19Cu   /* u32; its top byte (+0x19F) is the state */
#define ROB_ST            0x19Fu   /* u8 state: js/engine.js ST */
#define ROB_CHAR_MOTS     0x1A0u   /* the record's motions (+0xC) */
#define ROB_MOT_KIND      0x1A4u   /* u32 mk_ bits */
#define ROB_MOT_NUM       0x1A8u   /* u16 motion */
#define ROB_MOT_COMA      0x1AAu   /* u16 its frame */
#define ROB_ENERGY        0x1ACu   /* s16 */
#define ROB_CHAR          0x1B0u   /* u8 (1P CHAR / 2P CHAR): player 2's has its own models, character + 26 */
#define ROB_CHAR_IS       0x1B1u   /* u8 the character it is */
#define ROB_GXPOS         0x1F4u   /* f32, the root on the ground; gzpos +0x1FC */
#define ROB_GZPOS         0x1FCu
#define ROB_OUT_ON        0x624u   /* a collision ball outside the ring touches the ground */
#define ROB_HIT_COMBO     0x6F4u   /* u8, counted on the fighter hit (VF2 +0x6D8, FV +0x708) */
#define ROB_MOTD_LENG     0x800u   /* the motion's setup record from here: its length */
#define ROB_MOTD_NEXT     0x802u   /* the next motion */
#define ROB_MOTD_KIND     0x804u   /* u32, the mot_kind bits */
#define ROB_MOTD_MAIN     0x808u   /* u16 hit frame; follow1 +0x80A cancel, follow2 +0x80C end */
#define ROB_SKELTON_TYPE  0x84Cu   /* u8; 0xFF so the first set_motion copies the rig in */
#define ROB_MOT_REC       0xBD8u   /* the motion record (0x800 bytes) */
#define ROB_PAD           0x1200u  /* u8 this frame's pad; the input ring (write_pnt) follows */
#define ROB_CONTROL       0x1208u  /* control_init's bits: 1 << 3 the pad drives it */
#define ROB_PC_COMMAND    0x1218u  /* the command (move matcher) table in use */
#define ROB_BALLS         0x1D00u  /* the collision balls' records, nine pointers */
#define ROB_DENT_SCALE    0x1F88u  /* the dent pendulums: three unit scales, and three at +0x1FEC */
#define ROB_DENT_SCALE2   0x1FECu
#define ROB_DENTED_CNT    0x219Cu  /* the countdown camera_init runs down; swings them while >= 0 */
#define ROB_Y_SCALE       0x27C0u  /* f32 rob_disp's y scale */

/* ROB_FLAG's bits (FV and StF name them from one table, StF 0x44608).
 * Bit 31 is every task block's: the task runs. */
#define ROB_F_MOT_END        (1u << 0)
#define ROB_F_DISP_LEFT_LOOK (1u << 1)   /* player 2 */
#define ROB_F_LOST           (1u << 5)   /* knocked out, or rung out */
#define ROB_F_MIRROR         (1u << 6)
#define ROB_F_INIT_END       (1u << 7)   /* once the first frame is done */
#define ROB_F_LAND           (1u << 13)
#define ROB_F_SMOOTH_SWITCH  (1u << 26)
#define TASK_ALIVE           (1u << 31)

/* ---- the fight's globals: the same addresses in VF2, FV and StF ---- */
#define G_GAME_TIMER      0x500028u  /* s16: time << 6 at a round's start, one off a frame */
#define G_ROUND_WINS0     0x50004Fu  /* u8 round wins, player 1 */
#define G_ROUND_WINS1     0x500051u  /* player 2 */
#define G_WINS_NEEDED     0x500052u  /* u8 */
#define G_STAGE           0x500064u  /* u8 stage */
#define G_ENERGY_MAX      0x5000A0u
#define G_FA_ROB0         0x500804u  /* the fighters */
#define G_FA_ROB1         0x500808u
#define G_FA_CAMERA       0x500814u  /* the camera */
#define G_DEBUG_FLAG      0x508000u
/* the tuning block (VF2 and FV's to 0x50A0DC; StF's from 0x50A148 on 0x68 later) */
#define G_GRAVITY         0x50A000u  /* f32 */
#define G_STAGE_X         0x50A00Cu  /* f32, the half side of the walls (area_coli) */
#define G_BARRIER_DEFAULT 0x50A424u  /* StF's barrier_default_num */

#endif
