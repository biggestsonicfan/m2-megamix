/* StF's work RAM, as the board reaches it: the fighter (rob), the other task
 * blocks and the fight's globals. The names are the ones AM2's debug mode
 * prints beside each field (ROBn_INFO, PARAMETER_SET, GAME_PARA, CAMERA:
 * docs/DEBUG-MODE.md, which also has VF2's and FV's offsets); where no debug
 * window shows one, StF's own label (stfdisasm's include.s); where neither
 * has one, the board's name for it. The board's fighters are StF's robs, so
 * these are StF's offsets; VF2 and FV share them up to +0x62A and from +0x800
 * on. */
#ifndef ROB_H
#define ROB_H

/* A field of a block: RW(rob, ROB_FLAG) and so on. */
#define RW(r, o) (*(u32 *)((u8 *)(r) + (o)))
#define RH(r, o) (*(u16 *)((u8 *)(r) + (o)))
#define RB(r, o) (*(u8 *)((u8 *)(r) + (o)))
/* A global: RAM8(G_STAGE) and so on (stf_ram: where the board keeps it). */
#define RAM8(a)  (*(u8 *)stf_ram(a))
#define RAM16(a) (*(u16 *)stf_ram(a))
#define RAM32(a) (*(u32 *)stf_ram(a))

/* ---- every task block's head ---- */
#define TASK_FLAG         0x000u   /* u32: TASK_ALIVE, and the task's own bits */
#define TASK_IDNM         0x004u   /* u8 its player (0, 1) */
#define TASK_SIZE         0x008u   /* the block's size */
#define TASK_FN           0x00Cu   /* what runs it each frame; a task changes it to go on */
#define TASK_ALIVE        (1u << 31)

/* ---- the rob, 0x3400 bytes ---- */
#define ROB_FLAG          TASK_FLAG   /* u32, the ROB_F_ bits */
#define ROB_IDNM          TASK_IDNM   /* u8 player, the coprocessor's slot bank */
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
#define ROB_TRAIL         0x1004u  /* f32 x3 x8: the last 8 frames' ROB_GXPOS (GAME_DSP) */
#define ROB_TRAIL_AT      0x1064u  /* u32: the next entry to write, 0..7 */
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
#define ROB_EYE_MODEL     0x2050u  /* u32 x2, the face's eyes (player_head_change_2; 0: none) */
#define ROB_EYE_TPD       0x2058u  /* u32 x2, each eye's moved texture points (snc_eye_thd_set) */
#define ROB_SPIN          0x2068u  /* u32, 1 while the spin attack's ball stands in for the body (sub_81A48) */
#define ROB_SPIN_DRAWN    0x2074u  /* f32 x3, the ball's scale as last drawn */
#define ROB_SPIN_ANG      0x2080u  /* u16 x2, the ball's turn on even frames, and on odd */
#define ROB_SPIN_MODEL    0x2084u  /* u16 x2, its models on even frames, and on odd (sub_81038) */
#define ROB_SPIN_PULSE    0x20ACu  /* f32 x3, the pulse added to its scale (rob+0x2088 +0x24, spin_attack_cnt) */
#define ROB_SPIN_DROP     0x20ECu  /* f32, how far below the root the ball and the smoke sit */
#define ROB_SMOKE         0x21A0u  /* the spin's smoke: 20 puffs of 0x48 bytes (spin_smoke_trg) */
#define ROB_SMOKE_LIVE    0x2740u  /* u32, a bit for each live puff */
#define ROB_Y_SCALE       0x27C0u  /* f32 rob_disp's y scale */

/* ROB_FLAG's bits (FV and StF name them from one table, StF 0x44608) */
#define ROB_F_MOT_END        (1u << 0)
#define ROB_F_DISP_LEFT_LOOK (1u << 1)   /* player 2 */
#define ROB_F_LOST           (1u << 5)   /* knocked out, or rung out */
#define ROB_F_MIRROR         (1u << 6)
#define ROB_F_INIT_END       (1u << 7)   /* once the first frame is done */
#define ROB_F_LAND           (1u << 13)
#define ROB_F_NO_EYES        (1u << 20)  /* no eye tracking (camera_init), eyes drawn as they are (rob_disp) */
#define ROB_F_SMOOTH_SWITCH  (1u << 26)

/* ---- the camera (fa_camera; CAMERA, CAMERA_INFO) ---- */
#define CAMERA_FLAG       TASK_FLAG   /* the CAMERA_ROBn_DISP bits */
#define CAMERA_CNT        0x006u   /* u16 frames, one up a frame (camera_init's end); a throw's camera script runs on it */
#define CAMERA_XPOS       0x018u   /* f32; ypos +0x01C, zpos +0x020, in the fighters' units */
#define CAMERA_XANG       0x024u   /* u16 pitch */
#define CAMERA_YANG       0x026u   /* u16 heading */
#define CAMERA_ZANG       0x028u   /* u16 roll */
#define CAMERA_ROB0_DISP  (1u << 1)
#define CAMERA_ROB1_DISP  (1u << 2)

/* ---- a projectile (fa_tobi's thirty objects, 0x100 bytes from +0x200) ---- */
#define TOBI_OBJ          0x200u
#define TOBI_FLAG         TASK_FLAG   /* the TOBI_F_ bits */
#define TOBI_FUSE         0x018u   /* the fuse's list: a count, then 16-byte frames */
#define TOBI_OWNER        0x01Cu   /* its thrower's rob */
#define TOBI_TYPE         0x026u   /* u8: TOBI_BOMB is Eggman's */
#define TOBI_XPOS         0x044u   /* f32; ypos +0x048, zpos +0x04C */
#define TOBI_MARK_XPOS    0x050u   /* f32, the landing marker's place; +0x054, +0x058 */
#define TOBI_SCALE        0x068u   /* f32 */
#define TOBI_XANG         0x070u   /* u16; yang +0x072, zang +0x074 */
#define TOBI_YANG         0x072u
#define TOBI_ZANG         0x074u
#define TOBI_MODEL        0x07Cu   /* u16 */
#define TOBI_FLIGHT       0x089u   /* u8 its flight's length */
#define TOBI_IN_FLIGHT    0x08Cu   /* u16, set while it flies */
#define TOBI_FUSE_SCALE   0x098u   /* f32 */
#define TOBI_FUSE_MODEL   0x0A0u   /* u16 */
#define TOBI_FLIGHT_LEFT  0x0A2u   /* u8 of TOBI_FLIGHT */
#define TOBI_F_TURNLESS   (1u << 3)
#define TOBI_F_BURST      (1u << 6)   /* the fuse is gone */
#define TOBI_F_FACE       (1u << 7)   /* faced to the camera: the burst */
#define TOBI_F_HIDDEN     (1u << 9)
#define TOBI_BOMB         2u

/* ---- the HUD's task (fa_game_disp) ---- */
#define DISP_LAMP0        0x064u   /* u8 x10, player 1's round lamps; player 2's at +0x06E */
#define DISP_LAMP1        0x06Eu

/* ---- the fight's globals: the same addresses in VF2, FV and StF to 0x5000A0 ---- */
#define G_FRAME_COUNTER   0x500020u  /* StF's 60 Hz loop's count */
#define SMOKE_COUNT       0x00u    /* a puff: s32 its age in frames (it goes at 32), */
#define SMOKE_STEP        0x04u    /* its step (sub_81CD8 ...: the pull and the scale, on g3), */
#define SMOKE_POS         0x08u    /* f32 x3 its place, from the root (+0x1F4), */
#define SMOKE_VEL         0x14u    /* f32 x3, */
#define SMOKE_ACC         0x20u    /* f32 x3, */
#define SMOKE_SCALE       0x2Cu    /* f32 x3, */
#define G_GAME_TIMER      0x500028u  /* s16: time << 6 at a round's start, one off a frame */
#define G_MODE            0x50002Au  /* u8 mode; also_mode +0x2B */
#define G_MODE_FLAG       0x50002Cu
#define G_SUB_MODE        0x500030u  /* u8 _sub_mode; also_sub_mode +0x31 */
#define SUB_FIGHT_DSP     9u         /* ROUND_STATE's: the fight */
#define SUB_JUDGE_DSP     13u        /* the round's result shown */
#define G_JUDGE           0x500050u  /* u8: 0 a knock-out, 2 the time ran out */
#define G_GAMEPROGRAM     0x50004Cu
#define G_ROUND_WINS0     0x50004Fu  /* u8 round wins, player 1 (p1_wins) */
#define G_RING_OUT        0x500050u  /* u8, a ring out ended the round (VF2) */
#define G_ROUND_WINS1     0x500051u  /* player 2 */
#define G_WINS_NEEDED     0x500052u  /* u8 num_rounds_to_win */
#define G_STAGE_ID        0x500054u
#define G_STAGE           0x500064u  /* u8 stage (stage_num) */
#define G_NOT_SCR_BG_MOVE 0x500068u
#define G_TIME            0x500090u  /* u8 the round's time setting; replay_countdown +0x92 */
#define G_RANDOM          0x500098u
#define G_ENERGY_MAX      0x5000A0u
#define G_RED             0x5000E0u  /* u8 the stage's tint: RED, GREEN, BLUE */
#define G_BACKUP_RAM_PTR  0x50016Cu  /* add_BACKUP_RAM_TO_RAM: StF's copy of the backup RAM */
#define G_BACKUP_RAM      0x599000u  /* BACKUP_RAM_TO_RAM */
#define G_CAGE_HEIGHT     0x50027Cu  /* f32 */
#define G_SW_HELD         0x500700u  /* INTERUPT_FLAGS_HELD: P1's pad << 8, P2's << 16 */
#define G_TPD_COUNT       0x5019B0u  /* move_tpd_req's queue: its entries, */
#define G_TPD_WORDS       0x5019B4u  /* the words they take from GEO_PROGRAM_START + 0x1000, */
#define G_TPD_QUEUE       0x5019BCu  /* and 16 bytes each: kind, source, the shift (g1, g2) */
#define G_FA_ROB0         0x500804u  /* the fighters */
#define G_FA_ROB1         0x500808u
#define G_FA_CAMERA       0x500814u  /* the camera */
#define G_FA_COLI         0x500828u  /* the task blocks (mod_fa_...): collision */
#define G_FA_GAME_DISP    0x500834u  /* the HUD */
#define G_FA_ENEMY0       0x50083Cu  /* the CPU players (ROBn_PARAMETER) */
#define G_FA_ENEMY1       0x500840u
#define G_FA_EFFECT       0x500844u
#define G_FA_RECORD       0x500854u  /* the replay record */
#define G_FA_OSAGE0       0x500860u  /* the sway chains (mod_fa_osage0_1, _2) */
#define G_FA_OSAGE1       0x500864u
#define G_FA_OBJ0         0x500870u
#define G_FA_TOBI         0x5008A4u  /* the projectiles */
#define G_OBJ_COUNT       0x501010u  /* set_obj's objects this frame */
#define G_POLYGON_LIMIT   0x501018u
#define G_POLYGON         0x50101Cu  /* set_obj_fifo's polygons this frame */
#define G_VECTER_X        0x501020u  /* s16 the stage's light; VECTER_Y +0x22 */
#define G_VECTER_Y        0x501022u
#define G_ROB_CAMERA0     0x501128u  /* the camera camera_init keeps for each player; +0x158 */
#define G_ROB_CAMERA1     0x501158u
#define G_LIST_BLOCKS     0x501800u  /* the list blocks' layer table: 43 words, layer n's at +4 + 8 n */
#define G_KAGE_SLIDE_X    0x501990u  /* f32 the shadows' slide along the light; z +0x994 */
#define G_KAGE_SLIDE_Z    0x501994u
#define G_DEBUG_FLAG      0x508000u
#define G_MODEL_SCALE     0x509518u  /* f32 x3 player_model_y_scale, _horiz_scale... */
#define G_POL_COLOR_REQ   0x546000u  /* chg_pol_color_req's rows still to send */
/* the tuning block (GAME_PARA: VF2 and FV's to 0x50A0DC; StF's from 0x50A148 on 0x68 later) */
#define G_GRAVITY         0x50A000u  /* f32 */
#define G_STAGE_X         0x50A00Cu  /* f32, the half side of the walls (area_coli) */
#define G_STAGE_SOKO      0x50A010u  /* f32, the ground below the ring */
#define G_STAGE_YANG      0x50A022u  /* u16 the arena's turn (the menu edits its high byte) */
#define G_LIMIT_XANG      0x50A0B4u
#define G_DEBUG_NUMBER    0x50A0B8u  /* u8 per player: 0 NORMAL_MODE, 1 COM_PLAYER... */
#define G_GUARD_LIMIT     0x50A1B4u
#define G_COMBO_START     0x50A1D6u
#define G_COMBO_LIMIT     0x50A1D8u
#define G_NO_COLI_LOW     0x50A1DCu
#define G_COPRO_ADR       0x50A320u
#define G_ZANZOU_MA       0x50A418u
#define G_BARRIER_DEFAULT 0x50A424u  /* StF's barrier_default_num */

#endif
