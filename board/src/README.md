# board/src: the board program

The Megamix program for the Sonic the Fighters board (Model 2B), in C for
the i960 on m2-sdk. Who, when and why are in
[docs/CODE-MAP.md](../../docs/CODE-MAP.md); how to build and run it, and what
each part does on the board, in [docs/BOARD.md](../../docs/BOARD.md).

`megamix.c` includes every `.c` below (but those marked "own object") in a
fixed order and compiles them as one unit: m2-sdk is header-only, and a
module built alone would carry its own copy of it. `megamix.h` declares what
they share. Paths in the includes are from this folder; keep the order.

| Where | File | What it holds |
| --- | --- | --- |
| `.` | `megamix.c` | the unit: includes the modules in order |
| | `megamix.h` | what the modules share; includes the SDK, `gen/`, `fight/rob.h`, `link/link.h` |
| | `main.c` | the frame loop: boot, the setup, a round's start and end, the vblank steps, the link's sync |
| | `menu.c` | the setup menu, on tile layer 1 |
| | `sound.c` | the sound requests to the 68000 |
| `fight/` | `fighter.c` | StF's fighters: tasks and globals, `rob_init`, `fight_step`, `round_start`, the HUD |
| | `rob.h` | StF's rob and the fight's globals, named as the debug mode names them |
| | `stf_call.s` | calling StF's lifted code with its registers (own object) |
| | `armour.c` | FV's armour: limits, HUD, kept across rounds |
| | `osage.c` | the sway chains and StF's list blocks |
| | `push.c` | VF2's TGP push between two VF2 guests (own object, `-mnumerics`) |
| | `ringout.c` | VF2's ring out and its message |
| | `replay.c` | FV's replay |
| `draw/` | `cop.c` | the coprocessor's matrix and the submits |
| | `camera.c` | the camera and the stage's light in its frame |
| | `fighter_draw.c` | a fighter's parts, seams and midriff, the spin ball, the mirror image |
| | `kage.c` | the shadows |
| | `effects.c` | afterimages, projectiles and StF's effects |
| | `tpd.c` | the moving texture points: eyes, pit, pipes |
| | `carry.c` | points carried between slots, on the i960's floating point (own object, `-mnumerics`) |
| `stage/` | `stage.c` | the stage's meshes, materials and light; `load_stage`; FV's town turn and Kuma |
| | `colors.c` | the colour translation runs |
| | `texture.c` | the texture sets and palettes |
| | `sky.c` | the sky on the tile layers |
| | `stf_tex_codec.h` | the SDK's texture codec with room for StF's stage sets |
| `link/` | `link.c`, `link.h` | the comm board's protocol (own object) |
| | `linkplay.c` | the two-cabinet link's glue |
| `gen/` | (generated) | `poses.h`, `stf_motion.s`, `stf_motion.h`, `stf_rom_80000.bin`: see `gen/README.md` |
