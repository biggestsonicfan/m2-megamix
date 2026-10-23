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
# action_init and rob_action: a fighter's task (its moves, frame by frame);
# sub_1D47C: rob_control's command decoder (the pad to moves); coli_init and
# collision: the collision task (hits, damage, the walls); get_game_info:
# the task after it (each fighter's own state, and the angle and distance to
# the other, which the fighters turn by); cam_mode_9 and cam_mode_10: the
# fight's camera (camera_work's modes for a round: 9 places it, 10 follows).
ROOTS = ['set_motion', 'calc_rob_angle', 'calc_rob_angle_cont', 'calc_unit_mat', 'smooth_int', 'sub_7F0E8',
         'action_init', 'rob_action', 'sub_1D47C', 'coli_init', 'collision', 'get_game_info', 'cmd_native_tail',
         'cop_initialize_end2', '_Scroll_Initialize', 'energy_disp', 'barrier_left_disp', 'time_dsp',
         'win_lamp_dsp', 'win_lamp_int', 'cam_mode_9', 'cam_mode_10']
# Routines the board does not run (debug text, name plates, projectiles,
# sound, ring scatter, Super Sonic's hair objects): `ret`.
STUBS = ['print_mes', 'print_mes_ex', 'print_hex_w', 'debug_disp_hex', 'dsp_pattern_right',
         'char_nameplate_dsp', 'call_projectile_routine', 'sound_request_u', 'sound_request_special',
         'stage_contact_sound', 'ring_tobitiri_set', 'sub_1BCC0']
# Labels the routines use as numbers (`lda loc_10000, r3` is 0x10000, `lda
# off_1010, r13` the flag mask 0x1010); any other code label they load (a
# task's next function, a callback) is lifted and keeps its name.
NUMBERS = {'loc_1FFC', 'loc_2AA8', 'loc_6600', 'loc_7FF8', 'loc_8020', 'loc_8040', 'loc_BFF4', 'loc_10000',
           'loc_20010', 'loc_78AFC', 'loc_2100', 'loc_7A00', 'loc_14060', 'sys_proc_table',
           'off_1010', 'dword_4010', 'loc_AAA0'}
# The tail the move tables' inline code (opcode 0x13: `lda N, g0; b 0x1EF48`)
# branches to, after sub_1E468, unlabelled in stfdisasm.
NATIVE_TAIL = 'cmd_native_tail', 0x1EF48, 'ld      0x1A4(g7), r15  # unreachable code'
# Tables below 0x1000 that are tables all the same (cop_initialize_end2's
# collision-ball pointers).
LOW_TABLES = {'off_FE8'}
# Tables read on past their end, into the next label's (off_1008's eight
# pointers run through off_1010 into off_1018).
RUN_ON = {'off_1008'}
# Jump tables in the ROM range that hold code (the camera's script steps):
# lifted with the code, as the copied ROM holds StF's addresses.
ROM_CODE_TABLES = {'off_9C83C', 'off_9C848'}
# Data blocks that point into themselves (the fight camera's motion table
# and its scripts, `.short` halves and `.long`s): lifted as words, each
# word that is an address inside the block made relative to its label.
SELF_REL = {'word_6BE90'}
ROM_LO, ROM_HI = 0x80000, 0x100000      # copied to the same addresses
ROM_BIN = 'stf_rom_80000.bin'
RAM_LO, RAM_HI = 0x500000, 0x600000     # StF's work RAM: moved into the board's
RAM_PAD = 0x400                          # room past the highest address a block names
# RAM the routines reach through a base: the two fighters' motion records
# (action_init: 0x520000 and 0x5207C8, 0x800 bytes each).
RAM_SPANS = [(0x520000, 0x520FC8)]
# The per-character tables a guest fighter (a character of another game in a
# StF character's place) needs entries of its own in: the routines read them
# at fixed addresses in the data ROM instead (guest_<name>), where
# tools/import-assets.mjs writes StF's tables with the guests' entries in.
# Each is given its room there; the rest, from GUEST_HEAP, is the guests' own
# records, motions and programs. stf_motion.h has the addresses
# (STF_GUEST_<name>).
GUEST_BASE = 0x02E00000
# name, its room, StF's own table's length (what it starts as): 52 characters
# (player 2's are 26 on), 24 move tables, 4 skeletons, 21 kinds of head
# change (each a list by character), 519 motions, and each character's hit
# reactions (sub_2B94C). motion_remap is the board's own (StF has none: it
# starts as zeros): a list by character of a motion each id plays instead.
# char_game is the board's own too: a byte by character (52, player 2's 26
# on), the game the character comes from (GAMES: 0 StF, the zeros it starts
# as), which code that treats another game's fighter its own way branches on.
# rob_coli_ball_types: a list by skeleton type (rob+0x84C) of lists by
# character of collision-ball records; the lists are copied into its room.
# midriff is the board's own: a pointer by character (52) to the band VF2
# and Fighting Vipers draw between the hips and the chest (0: none, as for
# every StF fighter); megamix.c builds it every frame.
# off_C2058: a list by skeleton type (rob+0x84C) of lists by character of
# the bones calc_rob_angle_cont solves the pose on (15 points: the chest,
# the head, each arm's and leg's pivot and two bones, the pelvis); the
# lists are copied into its room.
GUESTS = [('CHAR_PARTS', 0x100, 52 * 4), ('SKELETON_TYPE_DATA', 0x400, 4 * 4),
          ('MOVESET_ARRAY', 0x100, 24 * 4), ('player_hand_animations', 0x100, 52 * 4),
          ('player_foot_animation', 0x100, 52 * 4), ('player_body_animation', 0x100, 52 * 4),
          ('PLAYER_HEAD_LIST', 0x1800, 21 * 4), ('animation_related', 0x2000, 519 * 4),
          ('offset_list_motions', 0x2000, 519 * 4), ('ptr_DA0B4', 0x80, 26 * 4),
          ('motion_remap', 0x80, 26 * 4), ('char_game', 0x40, 52),
          ('rob_coli_ball_types', 0x400, 4 * 4), ('midriff', 0x100, 52 * 4),
          ('off_C2058', 0x400, 4 * 4)]
GAMES = [('STF', 0), ('VF2', 1), ('FV', 2)]      # char_game's values (GAME_<name>)
# Code put in at a label of StF's, before what is there. sub_2B94C picks a
# hit's reaction from the defender's table: (side)[category * 8], +2 from
# behind. VF2's tables have a crouching defender's reactions 4 on; StF's
# repeat its first four there, so the crouch term changes nothing for StF's
# own fighters, but only another game's take it. 0x1A4 bit 3: crouching.
# set_motion, before it stores the id (its flags already read): the id the
# fighter's character plays instead (motion_remap; 0: its own). A guest's
# take the place of the ids StF's code plays by number; StF's fighters', of
# the ones a guest's throw gives its victim.
INSERT = {
    'loc_1B044': ['ldob    0x1B1(g7), r4', 'ld      guest_motion_remap[r4*4], r4',
                  'cmpobe  0, r4, loc_1B044_own', 'lda     0x1FFF, r5', 'and     r5, g0, r6',
                  'ldos    (r4)[r6*2], r6', 'cmpobe  0, r6, loc_1B044_own', 'andnot  r5, g0, g0',
                  'or      r6, g0, g0', 'loc_1B044_own:'],
    'loc_2B9CC': ['ldob    0x1B1(g8), r3', 'ldob    guest_char_game[r3], r3',
                  'cmpobe  GAME_STF, r3, loc_2B9CC_up', 'ld      0x1A4(g8), r3',
                  'bbc     3, r3, loc_2B9CC_up', 'addo    4, r9, r9',
                  'loc_2B9CC_up:'],
}

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
    tail, tail_at, tail_line = NATIVE_TAIL
    src[[l.strip() for l in src].index(tail_line)] = f'{tail}: {tail_line}'
    addr[tail] = tail_at
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
        return out, not is_data(i) or name_at[i] in RUN_ON
    def table(t):
        return (t in labline and is_data(labline[t]) and t not in NUMBERS
                and (0x1000 <= addr.get(t, 0) < ROM_LO or t in LOW_TABLES or t in ROM_CODE_TABLES))
    def code_ptr(t):
        return (t in labline and not is_data(labline[t]) and t not in NUMBERS
                and not 0x3A00 <= addr.get(t, 0) < 0x3C00 and addr.get(t, 0) >= 0x1000)
    def base(t):
        return t.split('+')[0].strip()
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
                targets = [base(t) for t in args.split(',')
                           if base(t) in labline and (not is_data(labline[base(t)]) or table(base(t)))]
            elif is_branch(op):
                targets = [target(op, args)]
            else:
                targets = [m.group(0) for m in TOKEN.finditer(args)
                           if table(m.group(0)) or (code_ptr(m.group(0)) and args[m.end():m.end() + 1] in ('', ',', ' '))]
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

    guest_at, at = {}, GUEST_BASE
    for t, n, _ in GUESTS:
        guest_at[t] = at
        at += n
    guest_heap = at

    def fix_token(t, c):
        if t in guest_at:
            notes.setdefault('guest', set()).add(t)
            return f'guest_{t}'
        if t in NUMBERS:
            notes.setdefault('num', set()).add(f'{t}=0x{addr[t]:X}')
            return f'0x{addr[t]:X}'
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
        for c in INSERT.get(name_at[i], ()):
            out.append(c if c.endswith(':') else f'                {c}')
        if name_at[i] in SELF_REL:
            lo = addr[name_at[i]]
            hi = min(v for v in addr.values() if v > lo)
            for o in range(lo, hi, 4):
                w = int.from_bytes(rom[o:o + 4], 'little')
                v = f'{name_at[i]}+0x{w - lo:X}' if lo <= w < hi else f'0x{w:X}'
                out.append(f'                .long   {v}')
            prev = nxt_start[i]
            continue
        for c in lines(i)[0]:
            parts = c.split(None, 1)
            op, args = parts[0], (parts[1] if len(parts) > 1 else '')
            if not op.startswith('.asci'):
                args = TOKEN.sub(lambda mm: fix_token(mm.group(0), c), args)
            args = NUM.sub(lambda mm: ram_ref(int(mm.group(0), 16)), args)
            out.append(f'                {op:<7} {args}'.rstrip())
        prev = nxt_start[i]

    # The RAM StF's routines name: blocks of the board's .bss.
    for lo, hi in RAM_SPANS:
        for v in range(lo, hi, RAM_PAD // 2):
            ram[v] = True
        ram[hi - 1] = True
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
    for t, _, _ in GUESTS:
        S.append(f'                .set    guest_{t}, 0x{guest_at[t]:X}')
    for g, v in GAMES:
        S.append(f'                .set    GAME_{g}, {v}')
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
    S.append('# ---- StF routines the board leaves out')
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
    # The move tables' inline code branches to the lifted tail instead.
    image = rom[ROM_LO:ROM_HI].ljust(ROM_HI - ROM_LO, b'\xff')
    patches = []
    for o in range(0, len(image), 4):
        w = int.from_bytes(image[o:o + 4], 'little')
        disp = w & 0xFFFFFC
        prev = int.from_bytes(image[o - 4:o], 'little') >> 16
        if w >> 24 == 0x08 and ROM_LO + o + disp - 0x1000000 == tail_at and prev in (0x8C80, 0x5C80):
            patches.append(o)                       # after `lda N, g0` or `mov N, g0`
    if not patches:
        sys.exit(f'lift: no branches to {tail} in the move tables')
    # A branch can't leave the section: they go through `bx` in the ROM's
    # free space past StF's last table.
    used = len(image.rstrip(b'\xff'))
    tramp = (used + 0xF) & ~0xF
    S.append('                .section .stfrom,"a"')
    at = 0
    for o, ins in sorted([(o, f'b       {tail}_far') for o in patches] + [(tramp, f'bx      {tail}')]):
        S.append(f'                .incbin "{ROM_BIN}", 0x{at:X}, 0x{o - at:X}')
        if ins.startswith('bx'):
            S.append(f'{tail}_far:')
        S.append(f'                {ins}')
        at = o + (8 if ins.startswith('bx') else 4)
    S.append(f'                .incbin "{ROM_BIN}", 0x{at:X}')
    S.append('')
    open(os.path.join(a.out, 'stf_motion.s'), 'w').write('\n'.join(S))
    open(os.path.join(a.out, ROM_BIN), 'wb').write(image)

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
    H.append('/* The tables the routines read a guest fighter\'s entries from, in the')
    H.append(' * data ROM (tools/import-assets.mjs writes them), and the guests\' heap;')
    H.append(' * _SRC and _LEN: StF\'s own table, which they start as. */')
    for t, _, n in GUESTS:
        H.append(f'#define STF_GUEST_{t} 0x{guest_at[t]:08X}u')
        H.append(f'#define STF_GUEST_{t}_SRC 0x{addr[t] if t in addr else sets.get(t, 0):08X}u')
        H.append(f'#define STF_GUEST_{t}_LEN 0x{n:X}u')
    H.append(f'#define STF_GUEST_HEAP 0x{guest_heap:08X}u')
    H.append('/* STF_GUEST_char_game\'s values: the game a character comes from. */')
    for g, v in GAMES:
        H.append(f'#define GAME_{g} {v}u')
    H.append('/* The move tables\' inline code goes on here (`bx`, from anywhere). */')
    H.append(f'#define STF_NATIVE_TAIL_FAR 0x{ROM_LO + tramp:05X}u')
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
    print(f'move-table branches to {tail}: {len(patches)}')
    print(f'ram blocks: {" ".join(f"{lo:06X}..{hi:06X}" for lo, hi in blocks)}')
    print(f'rom tables: {" ".join(sorted(notes.get("rom", ())))}')
    print(f'guest tables: {" ".join(sorted(notes.get("guest", ())))}')
    print(f'labels made numbers: {" ".join(sorted(notes.get("num", ())))}')


if __name__ == '__main__':
    main()
