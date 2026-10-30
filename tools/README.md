# tools: scripts

Node (`.mjs`) and Python scripts. Who, when and why are in
[docs/CODE-MAP.md](../docs/CODE-MAP.md). Each script's header says how to
run it; run them from the repo's root (`node tools/board/bake-board.mjs`).
They read the ROM sets from `$ROMS_DIR`.

## board/: making the board's sources and ROMs

Run in this order before building `board/` (docs/BOARD.md):

| Script | What it does |
| --- | --- |
| `bake-board.mjs` | bakes fighters' and stages' draws into `board/src/gen/poses.h` |
| `lift-stf.py` | lifts StF's fight code into `board/src/gen/stf_motion.s`, `.h` and `stf_rom_80000.bin` |
| `import-assets.mjs` | writes `board/roms/sfight/`'s data ROMs, only the assets used, guests and stages in |
| `guest-sound.mjs` | the sound ROMs: StF's sound program with the guests' songs and sounds (run by the import) |
| `moves-text.mjs` | a fighter's moves as text and back (`board/moves/`) |
| `model-obj.mjs` | a fighter's models as OBJ/MTL and back |

## guests/: fighters brought onto StF's board

| Script | What it does |
| --- | --- |
| `vf2-guest.mjs` | VF2's Akira (character 6), and what every guest builds on |
| `ryo-guest.mjs` | Ryo and Chai from Shenmue |
| `hornet-guest.mjs` | FM's Hornet, Daytona USA's car |
| `mahler-guest.mjs` | FV's Mahler |
| `fv-moves.mjs`, `fm-moves.mjs`, `shenmue-moves.mjs` | guests' own moves from FV, FM and Shenmue |
| `guest-shadows.mjs` | guests' own floor shadows |
| `pack-akira.mjs` | Akira's tiles packed into StF set 1's free pages |

## stages/: stages brought onto the board

`vf2-stages.mjs` (Tou-rin, Colosseum), `fv-stages.mjs` (Western),
`doa-stages.mjs` (DOA's stage 10).

## sources/: data from outside the three Model 2 sets

| Script | What it reads |
| --- | --- |
| `fm-saturn.mjs` | Fighters Megamix's (Saturn) fighters and motions |
| `daytona-hornet.mjs` | Daytona USA's Hornet, cut as FM cuts it |
| `shenmue-motion.mjs` | Shenmue's motions as VF2 motion blocks |
| `shenmue-fight.py` | the Shenmue betas' move lists and scripts |
| `shenmue-sound.py` | Shenmue's fight sounds and lines (loads `shenmue-fight.py` beside it) |

## grade/: grading against the source games

| Script | What it does |
| --- | --- |
| `grade-battle.mjs` | grades a board (or browser) battle's trace against the source game's |
| `grade-guest.mjs` | what each board guest lost on the way in |
| `js-battle.mjs` | one battle on the browser build, logged as the MAME traces are |
| `grade-roster.mjs` | every record on the browser build, graded (runs the two above) |

## survey/: read-only surveys behind the docs

`record-survey.mjs` (docs/RECORDS.md), `shadow-data.mjs` (docs/SHADOWS.md),
`stf-projectiles.mjs` (docs/PROJECTILES.md), `fv-guest-survey.mjs` and
`model2-rom-limits.py` (docs/FV-GUESTS.md), `shared-fns.py`
(docs/SHARED-CODE.md).

## mame/ and serve.py

`mame/` holds the Lua and shell run in MAME: battles and replays to grade
(docs/GRADING.md), two linked cabinets, screen and model surveys.
`serve.py` serves the browser game and the ROM sets (README.md, Running).
