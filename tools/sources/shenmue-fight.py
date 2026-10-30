#!/usr/bin/env python3
"""Shenmue's fight data: the beta discs' move lists and the fighters' move scripts.

    shenmue-fight.py list GDI_DIR                          # the GD-ROM's files: path, LBA, size
    shenmue-fight.py extract GDI_DIR OUT_DIR [NAME ...]   # files off the GD-ROM (default 1ST_READ.BIN)
    shenmue-fight.py cat GDI_DIR PATH                      # one file off the GD-ROM, to stdout
    shenmue-fight.py moves 1ST_READ.BIN [--json]           # Ryo's hand, leg and throw lists
    shenmue-fight.py cast 1ST_READ.BIN                     # the fighters' EN_ names
    shenmue-fight.py script EN_X.BIN [--names M.TXT]       # disassemble a fighter's move script
    shenmue-fight.py skills EN_X.BIN 1ST_READ.BIN [--names M.TXT] [--json]
                                                           # each skill check: input, action, motion

1ST_READ.BIN loads at 0x0C010000. The tables are found by their first names, so
any of the betas works (Passport 0.300, discs 1-3 of 0.400). M.TXT is
`node tools/sources/shenmue-motion.mjs MOTION.BIN --list` (branch vf3-shenmue-motions),
for the motion names (motion id k is its record k - 1). docs/SHENMUE-FIGHT.md says what it all is.
"""
import json, os, struct, sys

BASE = 0x0C010000
FIRST = {'hand': b'Tiger Knuckle', 'leg': b'Crescent Kick', 'throw': b'Overthrow'}
# 12-byte records {jp*, en*, u16 group, u16 0}; skill ids: hand index, leg index + 32, throw index + 64
SKILL_BASE = {'hand': 0, 'leg': 32, 'throw': 64}

# script ops that are 8 bytes long (76 is 12); the rest are 4
OP_LEN = dict.fromkeys((5, 6, 7, 8, 9, 10, 11, 12, 14, 19, 21, 26, 27, 28, 34, 35, 36, 40, 41, 42, 50, 54,
                        57, 58, 59, 62, 64, 69, 72, 73, 77, 80, 81, 82, 83, 89, 90), 8)
OP_LEN[76] = 12
OP_NAME = {4: 'window', 5: 'play', 13: 'if', 14: 'switch', 15: 'try', 16: 'end', 17: 'goto',
           71: 'action', 72: 'in', 73: 'in_held', 77: 'in_dir', 86: 'skill'}
PAD = [(0x1, 'A'), (0x2, 'X'), (0x4, 'Y'), (0x8, 'B'), (0x10, 'dir0'), (0x20, 'dir180'),
       (0x40, 'dir+90'), (0x80, 'dir-90'), (0x400, 'fwd'), (0x800, 'back'), (0x8000, 'flag8000')]

# --- GD-ROM: the high-density area's data tracks (from LBA 45000), 2048-byte sectors, per the .gdi.

def gdi_files(d, listing=False):
    gdi = [f for f in os.listdir(d) if f.lower().endswith('.gdi')][0]
    tracks = []
    for line in open(os.path.join(d, gdi)).read().splitlines()[1:]:
        f = line.split()
        if len(f) >= 5 and f[2] == '4' and int(f[1]) >= 45000:
            assert f[3] == '2048', 'only 2048-byte data tracks are handled'
            tracks.append((int(f[1]), os.path.join(d, f[4])))
    fh = {lba: open(p, 'rb') for lba, p in tracks}

    def read(lba, n):
        out = b''
        while n > 0:
            start = max(s for s, _ in tracks if lba >= s)
            f = fh[start]
            f.seek((lba - start) * 2048)
            chunk = f.read(min(n, 2048 * 1024))
            if not chunk:
                raise IOError('short read at LBA %d' % lba)
            out += chunk
            n -= len(chunk)
            lba += len(chunk) // 2048
        return out

    pvd = read(45016, 2048)
    assert pvd[1:6] == b'CD001', 'no ISO 9660 volume at LBA 45016'

    def walk(lba, size, path):
        data, i = read(lba, size), 0
        while i < len(data):
            n = data[i]
            if n == 0:
                i = (i // 2048 + 1) * 2048
                continue
            rec = data[i:i + n]
            i += n
            ext, sz, flags = struct.unpack_from('<I', rec, 2)[0], struct.unpack_from('<I', rec, 10)[0], rec[25]
            name = rec[33:33 + rec[32]]
            if name in (b'\0', b'\1'):
                continue
            p = path + '/' + name.decode().split(';')[0]
            if flags & 2:
                yield from walk(ext, sz, p)
            else:
                yield p, ext, sz

    root = pvd[156:156 + 34]
    for p, ext, sz in walk(struct.unpack_from('<I', root, 2)[0], struct.unpack_from('<I', root, 10)[0], ''):
        yield (p, ext, sz) if listing else (p, lambda e=ext, s=sz: read(e, s)[:s])

def read_file(d, path):
    """One file's bytes by its path on the disc (MISC/MOTION.BIN), or None."""
    want = '/' + path.lstrip('/').upper()
    for p, data in gdi_files(d):
        if p.upper() == want:
            return data()
    return None

# --- 1ST_READ.BIN

class Prog:
    def __init__(self, path):
        self.d = open(path, 'rb').read()

    def u16(self, a): return struct.unpack_from('<H', self.d, a - BASE)[0]
    def u32(self, a): return struct.unpack_from('<I', self.d, a - BASE)[0]
    def ok(self, a): return BASE <= a < BASE + len(self.d)

    def cstr(self, a):
        o = a - BASE
        return self.d[o:self.d.index(b'\0', o)]

    def refs(self, a):
        """Aligned words equal to address a."""
        w = struct.pack('<I', a)
        return [BASE + i for i in range(0, len(self.d) - 3, 4) if self.d[i:i + 4] == w]

    def string_at(self, s):
        """Addresses of the NUL-terminated string s."""
        out, i = [], -1
        while (i := self.d.find(s + b'\0', i + 1)) >= 0:
            out.append(BASE + i)
        return out

def find_table(p, first):
    """The record table whose first English name is first (a word before it points at the Japanese)."""
    for a in p.string_at(first):
        for r in p.refs(a):
            if p.ok(p.u32(r - 4)) and p.u16(r + 4) == 0:
                return r - 4
    sys.exit('no move table starting with %r' % first)

def find_cast(p):
    for a in p.string_at(b'RYOU'):
        for r in p.refs(a):
            if p.ok(p.u32(r + 4)) and p.cstr(p.u32(r + 4)) == b'ZAKO1':
                return r
    sys.exit('no EN_ name table')

def descriptions(p, rows):
    """0.400's notebook keeps an array of the names then the descriptions; the Passport hasn't one."""
    if not rows:
        return
    name = p.string_at(rows[0]['name'].encode())[0]
    for r in p.refs(name):
        if all(p.ok(p.u32(r + 4 * i)) and p.cstr(p.u32(r + 4 * i)).decode() == x['name'] for i, x in enumerate(rows)):
            for i, x in enumerate(rows):
                x['text'] = ' '.join(p.cstr(p.u32(r + 4 * (len(rows) + i))).decode('latin-1').split())
            return

def move_list(p, at):
    """Records until the first one whose English name isn't plain ASCII (the glyph rows after)."""
    out = []
    while True:
        jp, en, group = p.u32(at), p.u32(at + 4), p.u16(at + 8)
        if not (p.ok(jp) and p.ok(en)):
            break
        name = p.cstr(en)
        if not name or any(c < 0x20 or c > 0x7E for c in name) or group > 0xFF:
            break
        # jp is in WAZA.FON's own 2-byte encoding; kept as hex
        out.append({'index': len(out), 'name': name.decode(), 'group': group, 'jp': p.cstr(jp).hex()})
        at += 12
    descriptions(p, out)
    return out

def all_moves(p):
    return {k: move_list(p, find_table(p, v)) for k, v in FIRST.items()}

# --- EN_<NAME>.BIN: big-endian; header u32s are file offsets, +4 the script, +8 its end

def pad(mask):
    return '+'.join(n for b, n in PAD if mask & b) or '0'

def motion_names(path):
    """shenmue-motion.mjs --list's records by play's motion id: id k is record k - 1."""
    names = {}
    for line in open(path):
        f = line.rstrip('\n').split('\t')
        if len(f) == 3 and f[0].isdigit():
            names[int(f[0]) + 1] = f[2]
    return names

def script(en):
    """(offset, op, bytes) for each instruction; jump targets in the file are from the script's start."""
    start, end = struct.unpack_from('>II', en, 4)
    pc = start
    while pc < end:
        op = en[pc]
        n = OP_LEN.get(op, 4)
        yield pc, op, en[pc:pc + n]
        pc += n

def describe(op, b, start, names):
    u16 = struct.unpack_from('>H', b, 2)[0]
    if op == 5:
        w = struct.unpack_from('>I', b, 4)[0]
        m = w & 0xFFFF
        return 'motion %d%s %s' % (m, ' flags %08x' % (w & ~0xFFFF) if w & ~0xFFFF else '', names.get(m, ''))
    if op in (72, 73, 77):
        return '%s%s' % (pad(u16), ' byte1 %02x' % b[1] if b[1] else '')
    if op == 4:
        return '%d frames' % b[1]
    if op == 86:
        return 'id %d level >= %d' % (b[1], b[2])
    if op == 71:
        return 'action 0x%02x' % b[1]
    if op in (15, 17):
        return '-> %04x' % (start + u16)
    if op == 14:
        return 'if 0x%04x -> %04x' % (u16, start + struct.unpack_from('>H', b, 4)[0])
    return ''

def skills(en, moves, names):
    """Each skill check with the inputs since the last 'try', and the action and motion after it."""
    by_id = {SKILL_BASE[k] + r['index']: r['name'] for k, rows in moves.items() for r in rows}
    out, inputs, window = [], [], None
    ins = list(script(en))
    start = struct.unpack_from('>I', en, 4)[0]
    # the root is a run of switches on the buttons pressed (ctx+0x7C8): branch target -> key
    root = []
    for pc, op, b in ins:
        if op not in (14, 89):
            if root:
                break
            continue
        if op == 14:
            root.append((start + struct.unpack_from('>H', b, 4)[0], struct.unpack_from('>H', b, 2)[0]))
    root.sort()
    for i, (pc, op, b) in enumerate(ins):
        if op == 15:
            inputs, window = [], None
        elif op == 4:
            window = b[1]
        elif op in (72, 73, 77):
            inputs.append(('held ' if op == 73 else '') + pad(struct.unpack_from('>H', b, 2)[0]))
        elif op == 86:
            keys = [k for t, k in root if t <= pc]
            row = {'at': pc, 'branch': keys[-1] if keys else None, 'id': b[1], 'level': b[2], 'name': by_id.get(b[1], '?'),
                   'inputs': inputs[:], 'window': window}
            for _, op2, b2 in ins[i + 1:i + 4]:
                if op2 == 71:
                    row['action'] = b2[1]
                if op2 == 5:
                    w = struct.unpack_from('>I', b2, 4)[0]
                    row['motion'], row['flags'] = w & 0xFFFF, w & ~0xFFFF
                    row['motion_name'] = names.get(w & 0xFFFF, '')
                    break
            out.append(row)
    return out

def main(argv):
    if len(argv) < 2:
        sys.exit(__doc__)
    cmd = argv[0]
    if cmd == 'list':
        for path, lba, size in gdi_files(argv[1], listing=True):
            print('%8d %10d %s' % (lba, size, path))
        return
    if cmd == 'cat':
        data = read_file(argv[1], argv[2])
        if data is None:
            sys.exit('%s: not on the disc' % argv[2])
        sys.stdout.buffer.write(data)
        return
    if cmd == 'extract':
        want = set(argv[3:]) or {'1ST_READ.BIN'}
        os.makedirs(argv[2], exist_ok=True)
        for path, data in gdi_files(argv[1]):
            if os.path.basename(path) in want or path.lstrip('/') in want:
                # the scenes repeat names (EN_RYOU.BIN in SCENE/03/MFBT and FIGHT/): keep the path
                dst = os.path.join(argv[2], path.lstrip('/'))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                open(dst, 'wb').write(data())
                print(path, '->', dst)
        return
    names = motion_names(argv[argv.index('--names') + 1]) if '--names' in argv else {}
    if cmd == 'script':
        en = open(argv[1], 'rb').read()
        start = struct.unpack_from('>I', en, 4)[0]
        for pc, op, b in script(en):
            print('%04x  %-35s %-8s %s' % (pc, b.hex(' '), OP_NAME.get(op, 'op%d' % op),
                                          describe(op, b, start, names)))
        return
    if cmd == 'skills':
        rows = skills(open(argv[1], 'rb').read(), all_moves(Prog(argv[2])), names)
        if '--json' in argv:
            print(json.dumps(rows, indent=1))
            return
        for r in rows:
            m = 'motion %d%s %s' % (r['motion'], '*' if r['flags'] else '', r['motion_name']) if 'motion' in r else '(goes on)'
            print('%04x  %-6s %2d %-16s lv%d  %-28s action %-4s %s' % (
                r['at'], '%04x' % r['branch'] if r['branch'] is not None else '-', r['id'], r['name'], r['level'], ' '.join(r['inputs']) or '-',
                '0x%02x' % r['action'] if 'action' in r else '-', m))
        return
    p = Prog(argv[1])
    if cmd == 'moves':
        # stats id = kind << 8 | group; kind 1 hand, 2 leg, 3 throw
        lists = all_moves(p)
        if '--json' in argv:
            print(json.dumps(lists, indent=1))
            return
        for kind, (k, rows) in enumerate(lists.items(), 1):
            print('# %s (skill id %d + index; stats id %d<<8 | group)' % (k, SKILL_BASE[k], kind))
            for r in rows:
                print('%2d  %-16s group %2d  %s' % (r['index'], r['name'], r['group'], r.get('text', '')))
    elif cmd == 'cast':
        at, i = find_cast(p), 0
        while p.ok(p.u32(at + 4 * i)) and (n := p.cstr(p.u32(at + 4 * i))).isalnum() and n.isupper():
            print('%2d  EN_%s.BIN' % (i, n.decode()))
            i += 1
    else:
        sys.exit(__doc__)

if __name__ == '__main__':
    main(sys.argv[1:])
