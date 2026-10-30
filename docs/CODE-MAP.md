# The code, area by area

Where each part of Megamix is, what it does, why it is there, when it came
and who made it. The repo has three parts, each with its own README:

| Part | Where | What it is |
| --- | --- | --- |
| The browser game | `js/` ([js/README.md](../js/README.md)) | Fighters Megamix in a web page, on three.js and noclip's readers |
| The board program | `board/` ([board/src/README.md](../board/src/README.md)) | the same game as a new i960 program for the Sonic the Fighters board (Model 2B) |
| The tools | `tools/` ([tools/README.md](../tools/README.md)) | Node and Python scripts that read the games' data, build the board's ROMs, and grade both builds |

and beside them `tests/` (Node tests for the browser game and the tools),
`docs/` (what was read off the games, one subject a file), and
`vendor/noclip` (a submodule: the Model 2 readers both builds use).

## Who

The project is the owner's (biggestsonicfan; commits as rob and
biggestsonicfan). Each feature started as an idea on the owner's Pinboard,
and its number is in the commit and PR titles (#1505, #1631, ...). Claude
agents wrote the code to those ideas: 340 of the first 382 commits carry a
Claude co-author line. Other people's work comes in only as read-only
sources: noclip's readers (`vendor/noclip`), the StF disassembly
`tools/board/lift-stf.py` lifts (stfdisasm), vf2-decomp's symbols, and the
games themselves.

## Why

Virtua Fighter 2, Fighting Vipers and Sonic the Fighters run one AM2
fighting engine. Megamix puts their fighters (and guests from Shenmue,
Fighters Megamix's Saturn data, Daytona USA and Dead or Alive) in one fight.
It does that twice:

- **In the browser** (`js/`), to read and test the games' data quickly: every
  record of all three games, posed and fought with one engine written from
  what they share.
- **On the real board** (`board/`), the goal: StF's own fight code, lifted
  from its ROM, runs every fighter, and the guests are put into StF's tables
  as if StF had shipped them. Nothing is drawn that the ROMs do not hold.

The tools exist because the board cannot read other games' ROMs at run
time: everything it needs is baked, lifted or imported before it is built,
and graded against the source games after.

## When

| Date (2026) | What came |
| --- | --- |
| 10-20 | the browser game: `js/engine.js`, `js/fighters.js`, `js/games.js`, `js/render.js`, `tools/serve.py`, the first tests; Akira's tiles packed for StF (`tools/guests/pack-akira.mjs`) |
| 10-21 | the board build: `board/src/megamix.c`, StF's motion code lifted (`tools/board/lift-stf.py`, `board/src/fight/stf_call.s`), its stages (`tools/board/bake-board.mjs`), data ROMs holding only what it uses (`tools/board/import-assets.mjs`), VF2's Akira as a guest (`tools/guests/vf2-guest.mjs`) |
| 10-22 | guest grading (`tools/grade/grade-guest.mjs`) |
| 10-23 | Shenmue's fight data and motions (`tools/sources/shenmue-fight.py`, `tools/sources/shenmue-motion.mjs`), the StF/VF2 shared code audit (`tools/survey/shared-fns.py`) |
| 10-24 | Ryo and Chai (`js/shenmue/`, `tools/guests/ryo-guest.mjs`), FM's and Daytona's Hornet (`tools/sources/`), VF2's and FV's stages (`tools/stages/`), the FV guest survey |
| 10-25 | Hornet and Mahler as board guests, FM and FV moves, shadows, guest sound, projectiles |
| 10-26 | two cabinets over the comm board (`board/src/link/`), Shenmue's sounds |
| 10-27 | the board program split into one module a file (#27), moves as text, models to OBJ, the record survey |
| 10-28 | VF2's push (`board/src/fight/push.c`), DOA's stage, battle grading (`tools/grade/`, `tools/mame/`) |
| 10-30 | this layout (#1913): the files grouped by what they do, this map |

`git log --follow <file>` gives any file's own history across the moves.

## Where, and what

### The browser game, `js/`

| Where | What |
| --- | --- |
| `js/main.js` | the page: menu, input, the frame loop |
| `js/render.js` | draws stages and fighters with noclip's shader, each in its own game's texture RAM and colours |
| `js/games.js` | loads the ROM sets; the roster and the stage lists |
| `js/fighters.js`, `js/fighters/` | one fighter interface over three games' data |
| `js/engine.js`, `js/engine/` | the fight, the same for every fighter; no three.js, so the tests run it in Node |
| `js/shenmue/` | the Shenmue beta's readers, and Ryo and Chai as fighters |

`js/fighters.js` and `js/engine.js` are the modules everything imports;
each re-exports its folder's API and nothing else changed for callers.

### The board program, `board/`

`board/src/megamix.c` includes every module in a fixed order and compiles
them as one unit (m2-sdk is header-only). Grouped:

| Where | What |
| --- | --- |
| `board/src/` | `megamix.c`, `megamix.h` (the unit and what it shares), `main.c` (the frame loop), `menu.c` (the setup menu), `sound.c` |
| `board/src/fight/` | StF's fighters and what drives the fight: `fighter.c`, `rob.h`, the lifted code's bridge `stf_call.s`, FV's armour and replay, VF2's push and ring out, the sway chains |
| `board/src/draw/` | drawing: the coprocessor (`cop.c`), the camera, a fighter's parts, shadows, effects, texture points, the floating-point carry |
| `board/src/stage/` | the stage: meshes and light, colour runs, texture sets, the sky |
| `board/src/link/` | two cabinets over the comm board: the protocol and its glue |
| `board/src/gen/` | generated from the ROMs, not in git: `poses.h`, `stf_motion.s`, `.h`, `stf_rom_80000.bin` |
| `board/moves/` | fighters' moves as edited text, imported in place of the ROM's |
| `board/CMakeLists.txt` | the build: the unit, the separately compiled files, the ROM pair |

### The tools, `tools/`

| Where | What |
| --- | --- |
| `tools/board/` | what makes the board's sources and ROMs: bake, lift, import, sound, moves as text, models as OBJ |
| `tools/guests/` | each guest fighter brought onto StF's board, and his moves and shadows |
| `tools/stages/` | VF2's, FV's and DOA's stages brought onto the board |
| `tools/sources/` | readers for data outside the three Model 2 sets: FM Saturn, Daytona, Shenmue |
| `tools/grade/` | grading the board and the browser build against the source games |
| `tools/survey/` | read-only surveys behind the docs: records, shadows, projectiles, room, shared code |
| `tools/mame/` | Lua and shell for MAME: battles, replays, the link, screen surveys |
| `tools/serve.py` | serves the browser game and the ROM sets |

## How the layout was checked (#1913)

The regrouping moved files and split the two biggest JS modules; no code
changed. Before (A, `battle-grade` 240bd9a) and after (B) were built and run
the same way, and their outputs compared:

- the board's `game.bin` (both program EPROMs) and every data and sound ROM
  in `board/roms/`, byte for byte;
- the generated `poses.h`, `stf_motion.s`, `stf_motion.h`, `stf_rom_80000.bin`;
- every test's output, and the tools' outputs (five browser battles' traces,
  moves as text, a model export, the surveys, guest grading, FV stages,
  guest sound, Akira's pack, Daytona's Hornet, the ROM limits, the shared
  functions);
- the export names and kinds of `js/engine.js`, `js/fighters.js`,
  `js/games.js` and the Shenmue modules.

The results are in the PR that made this layout.
