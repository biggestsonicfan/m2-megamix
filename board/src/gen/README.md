# board/src/gen: generated, not in git

The board program's code and data that come from Sega's ROMs. Each is made
from the ROM sets in `$ROMS_DIR` (and StF's disassembly) before CMake runs,
and is never edited by hand:

| File | Made by | What it is |
| --- | --- | --- |
| `poses.h` | `node tools/board/bake-board.mjs` | every fighter's and stage's draws, colour runs and tables, baked |
| `stf_motion.s` | `python3 tools/board/lift-stf.py` | Sonic the Fighters' fight code, lifted as i960 assembly |
| `stf_motion.h` | `python3 tools/board/lift-stf.py` | what the C needs of it: the routines, the guest tables, `stf_ram()` |
| `stf_rom_80000.bin` | `python3 tools/board/lift-stf.py` | StF's program ROM from 0x80000, `.incbin`'d by `stf_motion.s` |

Only this README is tracked. `board/CMakeLists.txt` stops with the command to
run when `poses.h` or `stf_motion.s` is missing. See `docs/BOARD.md`.
