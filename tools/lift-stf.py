#!/usr/bin/env python3
"""Lift Sonic the Fighters' motion code into the board build.

The board build runs StF's own motion pipeline: the i960 routines from
set_motion to calc_unit_mat, copied out of stfdisasm (the owner's
disassembly of StF's program, which assembles to the ROM bit for bit). This
writes them as board/src/stf_motion.s, assembled with the rest of the
program, and board/src/stf_motion.h for the C that drives them.

What changes on the way:
  - Each routine keeps its instructions. A label the disassembler gave to a
    number (`lda loc_3A48, r15` is the coprocessor address 0x3A48,
    `system_address_table_ptr(g6)` is 0(g6)) goes back to the number.
  - StF's RAM (its fixed work-RAM addresses, as numbers or as include.s
    names) moves into blocks of the board program's own RAM, which
    stf_motion.h maps (stf_ram(addr)): the board program's .bss sits where
    StF's globals were.
  - StF's ROM tables at 0xC0000..0xFFFFF (the skeletons, models, motion
    records and hand and head lists, pointers into each other) are copied to
    the same addresses in the board's program ROM (stf_rom_c0000.bin, the
    .stfrom section), so their pointers hold. The tables lower down that
    the routines read (jump tables, the mirror list) come with the code.
  - Collision routines the board does not run return at once (STUBS).

    python3 tools/lift-stf.py [--stfdisasm DIR] [--out board/src]

Needs i960-elf-as and i960-elf-nm (the board's toolchain).
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile

# sub_7F0E8 ("Inits player bodies"): each character's dent pendulum constants.
ROOTS = ['set_motion', 'calc_rob_angle', 'calc_rob_angle_cont', 'calc_unit_mat', 'smooth_int', 'sub_7F0E8']
# Routines the board does not run (collision): `ret`.
STUBS = ['send_init_ram_coli_data', 'set_coli_ball_data', 'rob_ball_data_make', 'send_multi_ball_R']
ROM_LO, ROM_HI = 0xC0000, 0x100000      # copied to the same addresses
RAM_LO, RAM_HI = 0x500000, 0x600000     # StF's work RAM: moved into the board's
RAM_PAD = 0x400                          # room past the highest address a block names

LABEL = re.compile(r'^([A-Za-z_.$][\w.$]*):')
TOKEN = re.compile(r'(?<![\w.$])[A-Za-z_.$][\w.$]*')
NUM = re.compile(r'(?<![\w.$])0x5[0-9A-Fa-f]{5}(?![\w.$])')
REG = re.compile(r'^(?:[rg]\d+|fp|sp|pfp|rip)$')


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw).stdout


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument('--stfdisasm', default=os.path.expanduser('~/source/repos/biggestsonicfan/stfdisasm'))
    ap.add_argument('--out', default=os.path.join(here, '..', 'board', 'src'))
    a = ap.parse_args()
    asm = os.path.join(a.stfdisasm, 'rom_code1.asm')

    # Assemble StF: every label's address, and the ROM image.
    with tempfile.TemporaryDirectory() as tmp:
        obj = os.path.join(tmp, 'stf.o')
        run(['i960-elf-as', '-AKB', '-J', '-I', a.stfdisasm, '-o', obj, asm])
        addr = {}
        for l in run(['i960-elf-nm', obj]).split('\n'):
            p = l.split()
            if len(p) == 3:
                addr[p[2]] = int(p[0], 16)
        img = os.path.join(tmp, 'stf.bin')
        run(['i960-elf-objcopy', '-O', 'binary', '-j', '.text', obj, img])
        rom = open(img, 'rb').read()
    sets = {}
    for l in open(os.path.join(a.stfdisasm, 'include.s'), encoding='latin1'):
        m = re.match(r'\s*\.set\s+(\w+)\s*,\s*(0x[0-9A-Fa-f]+|\d+)', l)
        if m:
            sets[m.group(1)] = int(m.group(2), 0)

    src = open(asm, encoding='latin1').read().split('\n')
    labline = {}
    for i, l in enumerate(src):
        m = LABEL.match(l)
        if m:
            labline[m.group(1)] = i
    def code(l):
        return LABEL.sub('', l).split('#')[0].strip()

    # Blocks: a label and the lines up to the next label. A code block is live
    # when a live branch, call or jump table names it, or a live block falls
    # into it; in a block, the lines after a return or a branch are dead. A
    # table below ROM_LO is live when live code loads from it (`ld
    # off_1B568[r3*4]`, `byte_316A4(r4)`); a label below 0x1000 used as a
    # displacement (`dword_8(g6)`) or naming code (`lda loc_3A48`) is a number.
    starts = sorted(labline.values())
    nxt_start = dict(zip(starts, starts[1:] + [len(src)]))
    name_at = {i: n for n, i in labline.items()}
    def is_data(i):
        c = next((code(l) for l in src[i:nxt_start[i]] if code(l)), '')
        return c.startswith('.') and not c.startswith('.align')
    def is_branch(op):
        return op in ('call', 'callx', 'bal', 'balx', 'b', 'bx') or re.match(r'^(b[a-z]+|cmp[oi]b[a-z]+)$', op)
    def target(op, args):
        a = args.split(',')
        return (a[0] if op in ('bal', 'balx') else a[-1]).strip()
    def lines(i):
        """A block's live lines, and whether it falls into the next."""
        out = []
        for j in range(i, nxt_start[i]):
            c = code(src[j])
            if c:
                out.append(c)
                if c.split()[0] in ('ret', 'b', 'bx'):
                    return out, False
        return out, not is_data(i)
    def table(t):
        return t in labline and is_data(labline[t]) and 0x1000 <= addr.get(t, 0) < ROM_LO
    live, todo, why = set(), [(labline[f], 'root') for f in ROOTS], {}
    stub_lines = {labline[f] for f in STUBS}
    while todo:
        i, w = todo.pop()
        if i in live or i in stub_lines:
            continue
        live.add(i)
        why[i] = w
        body, falls = lines(i)
        for c in body:
            if c.startswith('.asci'):
                continue
            op, _, args = c.partition(' ')
            if op == '.long':
                targets = [t.strip() for t in args.split(',')
                           if t.strip() in labline and (not is_data(labline[t.strip()]) or table(t.strip()))]
            elif is_branch(op):
                targets = [target(op, args)]
            else:
                targets = [m.group(0) for m in TOKEN.finditer(args)
                           if table(m.group(0))]
            for t in targets:
                if t in labline:
                    todo.append((labline[t], f'{name_at[i]}: {c}'))
        if falls:
            n = nxt_start[i]
            if n in stub_lines or n >= len(src):
                sys.exit(f'lift: {name_at[i]} falls through into {name_at.get(n)}')
            todo.append((n, f'{name_at[i]}: falls through'))
    order = sorted(live)
    lifted_labels = {name_at[i] for i in live}

    ram, notes = {}, {}
    def ram_ref(v):
        ram[v] = True
        return f'STFRAM_{v:06X}'

    def fix_token(t, c):
        if t in lifted_labels or t in STUBS:
            return t
        op, _, args = c.partition(' ')
        if t in addr and is_branch(op) and target(op, args) == t:
            sys.exit(f'lift: branch out of the lifted code: {c}')
        if t in sets and t not in addr:
            v = sets[t]
            return ram_ref(v) if RAM_LO <= v < RAM_HI else t
        if t in addr:
            v = addr[t]
            if RAM_LO <= v < RAM_HI:
                return ram_ref(v)
            if ROM_LO <= v < ROM_HI:
                notes.setdefault('rom', set()).add(t)
                return t
            notes.setdefault('num', set()).add(f'{t}=0x{v:X}')
            return f'0x{v:X}'
        if REG.match(t) or t.startswith('.'):
            return t
        sys.exit(f'lift: unknown symbol {t} in: {c}')

    out, prev = [], None
    for i in order:
        if i != prev:
            out.append('                .align  4')
        out.append(name_at[i] + ':')
        for c in lines(i)[0]:
            parts = c.split(None, 1)
            op, args = parts[0], (parts[1] if len(parts) > 1 else '')
            if not op.startswith('.asci'):
                args = TOKEN.sub(lambda mm: fix_token(mm.group(0), c), args)
            args = NUM.sub(lambda mm: ram_ref(int(mm.group(0), 16)), args)
            out.append(f'                {op:<7} {args}'.rstrip())
        prev = nxt_start[i]

    # The RAM StF's routines name: blocks of the board's .bss.
    blocks = []
    for v in sorted(ram):
        if blocks and v - blocks[-1][1] < RAM_PAD:
            blocks[-1][1] = v
        else:
            blocks.append([v & ~0xF, v])
    blocks = [(lo, (hi + RAM_PAD + 0xF) & ~0xF) for lo, hi in blocks]
    def ram_sym(v):
        for lo, hi in blocks:
            if lo <= v < hi:
                return f'stf_ram_{lo:06X}+0x{v - lo:X}'
        raise AssertionError(v)

    text = '\n'.join(out)
    text = re.sub(r'STFRAM_([0-9A-F]{6})', lambda mm: ram_sym(int(mm.group(1), 16)), text)

    S = []
    S.append('# Generated by tools/lift-stf.py from stfdisasm: do not edit.')
    S.append('# Sonic the Fighters\' motion routines, lifted for the board build.')
    S.append('')
    for t in sorted(notes.get('rom', ())):
        S.append(f'                .set    {t}, 0x{addr[t]:X}')
    for t in sorted({t for t in sets if TOKEN.search(t)} & set(re.findall(TOKEN, text)) - set(addr)):
        if not (RAM_LO <= sets[t] < RAM_HI):
            S.append(f'                .set    {t}, 0x{sets[t]:X}')
    S.append('')
    S.append('                .text')
    S.append('                .align  4')
    for f in ROOTS:
        S.append(f'                .globl  {f}')
    S.append(text)
    S.append('')
    S.append('# ---- collision: the board does not run it')
    for f in STUBS:
        S.append(f'{f + ":":<24}ret')
    S.append('')
    S.append('# ---- StF\'s RAM, in the board\'s')
    S.append('                .section .bss')
    for lo, hi in blocks:
        S.append('                .align  4')
        S.append(f'                .globl  stf_ram_{lo:06X}')
        S.append(f'stf_ram_{lo:06X}: .space 0x{hi - lo:X}')
    S.append('')
    S.append('# ---- StF\'s ROM tables at their own addresses')
    S.append('                .section .stfrom,"a"')
    S.append('                .incbin "stf_rom_c0000.bin"')
    S.append('')
    open(os.path.join(a.out, 'stf_motion.s'), 'w').write('\n'.join(S))
    open(os.path.join(a.out, 'stf_rom_c0000.bin'), 'wb').write(rom[ROM_LO:ROM_HI].ljust(ROM_HI - ROM_LO, b'\xff'))

    H = []
    H.append('/* Generated by tools/lift-stf.py: do not edit. */')
    H.append('#ifndef STF_MOTION_H')
    H.append('#define STF_MOTION_H')
    H.append('')
    H.append('/* StF\'s motion routines (stf_motion.s), under their own names (no C')
    H.append(' * underscore): call them with stf_call, which sets up StF\'s registers. */')
    for f in ROOTS:
        H.append(f'extern void stf_{f}(void) __asm__("{f}");')
    H.append('')
    H.append('/* The board\'s copy of StF\'s RAM the routines use. */')
    for lo, hi in blocks:
        H.append(f'extern u8 stf_ram_{lo:06X}[0x{hi - lo:X}] __asm__("stf_ram_{lo:06X}");')
    H.append('static inline void *stf_ram(u32 a) {')
    for lo, hi in blocks:
        H.append(f'    if (a >= 0x{lo:06X}u && a < 0x{hi:06X}u) return stf_ram_{lo:06X} + (a - 0x{lo:06X}u);')
    H.append('    return (void *)0;')
    H.append('}')
    H.append('')
    H.append('#endif')
    open(os.path.join(a.out, 'stf_motion.h'), 'w').write('\n'.join(H) + '\n')

    for i in order:
        print(f'  {name_at[i]:<28} <- {why[i]}')
    print(f'stubs: {" ".join(STUBS)}')
    print(f'ram blocks: {" ".join(f"{lo:06X}..{hi:06X}" for lo, hi in blocks)}')
    print(f'rom tables: {" ".join(sorted(notes.get("rom", ())))}')
    print(f'labels made numbers: {" ".join(sorted(notes.get("num", ())))}')


if __name__ == '__main__':
    main()
