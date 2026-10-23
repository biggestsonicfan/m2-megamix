#!/usr/bin/env python3
"""Compare the i960 functions Sonic the Fighters and Virtua Fighter 2 share.

A function is shared when StF's disassembly (stfdisasm) and VF2's recovered
Sega symbols (vf2-decomp's original_symbols.csv) give it the same name. Each
one's body is what its entry reaches through branches and jump tables (not
calls), up to its returns. It prints, per function, both addresses, both
sizes in instructions, and two similarity ratios: one with RAM and code
addresses folded (`ratio`), one with every number folded (`struct`, which
ignores struct offsets and constants). docs/SHARED-CODE.md is the audit
read from these.

    python3 tools/shared-fns.py [--all] [--out DIR]   # DIR: body/{stf,vf2}_<name>.s, diff/<name>.txt

By default only the functions the board lifts (labels of board/src/stf_motion.s,
which tools/lift-stf.py writes); --all lists every shared name.

Needs node (tests/node-roms.mjs reads $ROMS_DIR's vf2.zip and sfight.zip),
i960-elf-as, i960-elf-nm and i960-elf-objdump.
"""
import argparse
import bisect
import csv
import difflib
import os
import re
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
STFDISASM = os.path.expanduser('~/source/repos/biggestsonicfan/stfdisasm')
VF2_SYMBOLS = os.path.expanduser('~/source/repos/ai/celsowm/vf2-decomp/decomp/i960/original_symbols.csv')
DATA = ('loc_', 'byte_', 'word_', 'dword_', 'off_', 'flt_', 'unk_')


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw).stdout


def stf_labels(tmp):
    obj = os.path.join(tmp, 'stf.o')
    run(['i960-elf-as', '-AKB', '-J', '-I', STFDISASM, '-o', obj, os.path.join(STFDISASM, 'rom_code1.asm')])
    out = {}
    for l in run(['i960-elf-nm', obj]).split('\n'):
        p = l.split()
        if len(p) == 3:
            out[p[2]] = int(p[0], 16)
    return out


def program_images(tmp):
    js = ("import { loadNodeGames } from %r; import { writeFileSync } from 'fs';"
          "const NG = await loadNodeGames();"
          "writeFileSync(%r, NG.vf2.rom.maincpu); writeFileSync(%r, NG.stf.rom.maincpu);"
          % (os.path.join(HERE, '..', 'tests', 'node-roms.mjs'), tmp + '/vf2.bin', tmp + '/stf.bin'))
    run(['node', '--input-type=module', '-e', js])
    return {g: open(f'{tmp}/{g}.bin', 'rb').read() for g in ('stf', 'vf2')}


def disassemble(path):
    ins = {}
    for l in run(['i960-elf-objdump', '-D', '-b', 'binary', '-m', 'i960:core', path]).split('\n'):
        m = re.match(r'\s*([0-9a-f]+):\t(?:[0-9a-f]{2} ){4}\t[0-9a-f]{8} ?(?:[0-9a-f]{8})?\s*\t(.*)', l)
        if m:
            ins[int(m.group(1), 16)] = m.group(2).strip()
    return ins


def body(ins, rom, entry):
    """The instructions entry reaches without calls; and its jump table's cases."""
    seen, todo, cases = set(), [entry], []
    while todo:
        p = todo.pop()
        while p in ins and p not in seen and len(seen) < 6000:
            seen.add(p)
            t = ins[p]
            op = t.split()[0] if t else ''
            m = re.search(r'(0x[0-9a-f]+)$', t)
            if op == 'ret':
                break
            if op == 'b' and m:
                p = int(m.group(1), 16)
                continue
            if op == 'bx':
                before = [x for x in seen if x < p]
                mm = re.match(r'ld\s+(0x[0-9a-f]+)\[r\d+\*(\d+)\]', ins.get(max(before), '')) if before else None
                if mm:      # read the table while its words are code addresses
                    tb, st = int(mm.group(1), 16), int(mm.group(2))
                    for k in range(256):
                        v = int.from_bytes(rom[tb + k * st:tb + k * st + 4], 'little')
                        if v not in ins or v < 0x1000:
                            break
                        todo.append(v)
                        cases.append(v)
                break
            if (re.match(r'^b(e|ne|l|le|g|ge|o|no)$', op) or re.match(r'^(cmp[oi]b|bb[cs])', op)) and m:
                todo.append(int(m.group(1), 16))
            nxt = p + 4
            while nxt not in ins and nxt < p + 12:
                nxt += 4
            p = nxt
    return [(x, ins[x]) for x in sorted(seen)], cases


def fold(s):
    s = re.sub(r'\s+', ' ', s)
    return re.sub(r'0x[0-9a-f]+', lambda m: 'RAM' if int(m.group(0), 16) >= 0x500000
                  else 'ADR' if int(m.group(0), 16) >= 0x1000 else m.group(0), s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--all', action='store_true', help='not only the functions the board lifts')
    ap.add_argument('--out', help='write each function\'s bodies and line diff here')
    a = ap.parse_args()
    with tempfile.TemporaryDirectory(dir='/dev/shm' if os.path.isdir('/dev/shm') else None) as tmp:
        stf = stf_labels(tmp)
        rom = program_images(tmp)
        ins = {g: disassemble(f'{tmp}/{g}.bin') for g in rom}
    vf2 = {r['name']: int(r['address'], 16) for r in csv.DictReader(open(VF2_SYMBOLS))}
    names = sorted((n for n in stf if n in vf2 and not n.startswith(DATA)), key=lambda n: stf[n])
    if not a.all:
        lifted = set(re.findall(r'^(\w+):', open(os.path.join(HERE, '..', 'board', 'src', 'stf_motion.s')).read(), re.M))
        names = [n for n in names if n in lifted]
    if a.out:
        for d in ('body', 'diff'):
            os.makedirs(os.path.join(a.out, d), exist_ok=True)
    print(f'{"function":24} {"StF":>8} {"VF2":>8} {"n StF":>6} {"n VF2":>6} {"cases":>9} {"ratio":>6} {"struct":>6}')
    for n in names:
        (bs, js), (bv, jv) = body(ins['stf'], rom['stf'], stf[n]), body(ins['vf2'], rom['vf2'], vf2[n])
        fs, fv = [fold(t) for _, t in bs], [fold(t) for _, t in bv]
        sm = difflib.SequenceMatcher(None, fs, fv, autojunk=False)
        num = lambda L: [re.sub(r'0x[0-9a-f]+|\b\d+\b', 'N', x) for x in L]
        st = difflib.SequenceMatcher(None, num(fs), num(fv), autojunk=False).ratio()
        cases = f'{len(js)}/{len(jv)}' if js or jv else ''
        print(f'{n:24} {stf[n]:8x} {vf2[n]:8x} {len(bs):6} {len(bv):6} {cases:>9} {sm.ratio():6.3f} {st:6.3f}')
        if not a.out:
            continue
        for tag, b, j in (('stf', bs, js), ('vf2', bv, jv)):
            with open(os.path.join(a.out, 'body', f'{tag}_{n}.s'), 'w') as o:
                if j:
                    o.write('# jump table cases (index: address): ' + ' '.join(f'{i}:{x:x}' for i, x in enumerate(j)) + '\n')
                o.writelines(f'{p:6x}  {t}\n' for p, t in b)
        with open(os.path.join(a.out, 'diff', f'{n}.txt'), 'w') as o:
            for tag, i1, i2, j1, j2 in sm.get_opcodes():
                if tag == 'equal':
                    o.write(f'  = {i2 - i1} same ({bs[i1][0]:x} / {bv[j1][0]:x})\n')
                    continue
                o.writelines(f'  S {bs[k][0]:6x} {bs[k][1]}\n' for k in range(i1, i2))
                o.writelines(f'  V {bv[k][0]:6x} {bv[k][1]}\n' for k in range(j1, j2))


if __name__ == '__main__':
    main()
