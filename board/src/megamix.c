/*
 * megamix.c — the whole program as one compilation unit.
 *
 * m2-sdk is header-only: its functions and their state are defined in the
 * headers themselves, and the boot asm calls some of them (kickGEO, waitVBL,
 * handleSerialIRQ), so CMakeLists.txt builds them global (M2_API=). Compiling
 * each module on its own would give every one its own copy of the SDK, so
 * the modules are included here instead and compiled together, in the order
 * they depend on each other. Each is a file of its own under src/, and
 * megamix.h declares what they share; docs/BOARD.md describes the layout.
 */
#include "megamix.h"

#include "cop.c"           /* the coprocessor's matrix and the submits */
#include "camera.c"        /* the camera and the stage's light */
#include "fighter.c"       /* StF's fighters: tasks, the fight, the HUD */
#include "sound.c"         /* the sound requests to the 68000 */
#include "armour.c"        /* FV's armour: limits, HUD, kept across rounds */
#include "osage.c"         /* the sway chains and StF's list blocks */
#include "kage.c"          /* the shadows */
#include "fighter_draw.c"  /* drawing a fighter, its spin and its mirror image */
#include "effects.c"       /* afterimages, projectiles, StF's effects */
#include "tpd.c"           /* the moving texture points: eyes, pit, pipes */
#include "stage.c"         /* the stage's meshes, materials and light */
#include "colors.c"        /* the colour translation runs */
#include "texture.c"       /* the texture sets and palettes */
#include "sky.c"           /* the sky on the tile layers */
#include "menu.c"          /* the setup menu, on tile layer 1 */
#include "ringout.c"       /* VF2's ring out */
#include "replay.c"        /* FV's replay */
#include "linkplay.c"      /* the two-cabinet link's glue */
#include "main.c"          /* the frame loop */
