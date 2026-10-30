#!/usr/bin/env python3
"""How big each ROM region gets across the Model 2 library, from MAME's
driver (src/mame/sega/model2.cpp): the board's room as the hardware has it,
not as Sonic the Fighters fills it (docs/FV-GUESTS.md, "Room").

    python3 tools/survey/model2-rom-limits.py [model2.cpp] [--all]

For every game it reads the ROM regions (ROM_REGION size) and how far its
ROM_LOADs fill each one (ROM_COPY mirrors are not counted), and the machine
it runs on (the GAME line's machine config, by its state class: model2o,
model2a, model2b or model2c). It prints, by board (only model2b without
--all), the largest fill of each region and the game that has it, beside
sfight's.
"""
import re
import sys
from pathlib import Path

DEFAULT = Path.home() / 'source/repos/ai/claude_mame/mame/src/mame/sega/model2.cpp'
REGIONS = ['maincpu', 'main_data', 'polygons', 'textures', 'copro_data', 'samples']

args = [a for a in sys.argv[1:] if not a.startswith('--')]
src = Path(args[0] if args else DEFAULT).read_text()

games = {}
for m in re.finditer(r'ROM_START\(\s*(\w+)\s*\)(.*?)ROM_END', src, re.S):
    regions, cur = {}, None
    for line in m.group(2).split('\n'):
        r = re.search(r'ROM_REGION\w*\(\s*(0x[0-9a-fA-F]+)\s*,\s*"([^"]+)"', line)
        if r:
            cur = r.group(2)
            regions[cur] = [int(r.group(1), 16), 0]
            continue
        lo = re.search(r'ROM_LOAD\w*\(\s*"[^"]*"\s*,\s*(0x[0-9a-fA-F]+)\s*,\s*(0x[0-9a-fA-F]+)', line)
        if lo and cur:
            at, n = int(lo.group(1), 16), int(lo.group(2), 16)
            if 'LOAD32_WORD' in line:          # two chips side by side: n each, interleaved
                at, n = at & ~3, n * 2
            regions[cur][1] = max(regions[cur][1], at + n)
    games[m.group(1)] = regions

# each machine config's board: its state class (model2o_state, model2a_state...)
board = {m.group(2): m.group(1)
         for m in re.finditer(r'void (model2\w?)_state::(\w+)\(machine_config &config\)', src)}
machines = {m.group(1): board.get(m.group(2), m.group(2))
            for m in re.finditer(r'GAME\(\s*\d+,\s*(\w+),\s*\w+,\s*(\w+),', src)}

boards = sorted({b for b in machines.values()}) if '--all' in sys.argv else ['model2b']
sf = games['sfight']
for b in boards:
    names = [g for g, mb in machines.items() if mb == b and g in games]
    print(f'{b}: {len(names)} games')
    for reg in REGIONS:
        have = [(games[g][reg][1], games[g][reg][0], g) for g in names if reg in games[g]]
        if not have:
            continue
        fill, _, who = max(have)
        size = max(h[1] for h in have)
        s = sf.get(reg, [0, 0])[1]
        print(f'  {reg:10} filled to {fill:#09x} ({who}), regions up to {size:#09x}; sfight {s:#09x}')
