#!/usr/bin/env python3
"""Shenmue's fight sounds: the battle banks' hits and shouts, and Ryo's and Chai's lines.

    shenmue-sound.py bank FILE.SND [--json] [--wav DIR]    # a DTPK bank: its effects, tones and samples
    shenmue-sound.py lines GDI_DIR [SPEAKER ...] [--json]  # every voiced line in SCENE/*/STREAM
    shenmue-sound.py clip GDI_DIR AFS_PATH NAME OUT.wav    # one line, as 16-bit PCM
    shenmue-sound.py banter GDI_DIR OUT_DIR                # BANTER's lines as WAVs, and banter.json

GDI_DIR is a 0.400 disc (BANTER's lines are on discs 2 and 3: `banter` takes
either, and reads the other from beside it). FILE.SND is SCENE/03/SOUND/BATTLE_1.SND
or BATTLE_2.SND (`shenmue-fight.py extract`). docs/SHENMUE-SOUND.md says what it all is.
"""
import importlib.util, json, os, re, struct, sys, wave

_spec = importlib.util.spec_from_file_location('shenmue_fight', os.path.join(os.path.dirname(__file__), 'shenmue-fight.py'))
sf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sf)

# --- AICA ADPCM (Yamaha's): 4 bits a sample, the low nibble first, from step 127 and 0
STEP = [230, 230, 230, 230, 307, 409, 512, 614]

def adpcm(b):
    out, h, st = [], 0, 127
    for byte in b:
        for n in (byte & 15, byte >> 4):
            d = ((2 * (n & 7) + 1) * st) >> 3
            h = max(-32768, min(32767, h - d if n & 8 else h + d))
            st = max(127, min(24576, (st * STEP[n & 7]) >> 8))
            out.append(h)
    return out

def write_wav(path, pcm, rate):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(rate))
        w.writeframes(struct.pack('<%dh' % len(pcm), *pcm))

def trim(pcm, rate, floor=300):
    """Without the silence before and after (the lines' clips are padded to 2 KB)."""
    loud = [i for i, x in enumerate(pcm) if abs(x) > floor]
    if not loud:
        return pcm
    pad = int(rate * 0.02)
    return pcm[max(0, loud[0] - pad):loud[-1] + pad]

# --- DTPK: a sound pack. u32s at 0x20 point at its sections; 3 the effects, 4 the tones, 7 the samples.

def dtpk(d):
    assert d[:4] == b'DTPK', 'not a DTPK sound pack'
    sec = struct.unpack_from('<8I', d, 0x20)
    # samples: u32 count - 1, then {fmt << 24 | file offset, loop end << 16 | loop start, 0, bytes}
    n = struct.unpack_from('<I', d, sec[7])[0] + 1
    samples = []
    for i in range(n):
        a, lp, _, size = struct.unpack_from('<4I', d, sec[7] + 4 + 16 * i)
        samples.append(dict(index=i, fmt=a >> 24, offset=a & 0xFFFFFF, bytes=size,
                            loop_start=lp & 0xFFFF, loop_end=lp >> 16))
    # tones: a 0x10-byte header, a 0x40-byte program (+0x10: the last tone), then 0x40-byte tones
    # [index][0x80][sample][1] ... +10 s8 coarse tune, +11 fine tune (1/64 semitone), from 44100 Hz
    tones, at = [], sec[4] + 0x50
    for i in range(d[sec[4] + 0x10] + 1):
        r = d[at + 0x40 * i:at + 0x40 * (i + 1)]
        coarse, fine = struct.unpack_from('<bB', r, 10)
        tones.append(dict(index=r[0], sample=r[2], coarse=coarse, fine=fine,
                          rate=round(44100 * 2 ** ((coarse + fine / 64) / 12))))
    # effects: u32 1, two u32s, u32 count, then offsets (from the section) to byte strings:
    # c0 df NN VV 80 ff plays NN at velocity VV; c0 a0 00 80 ff is an empty slot
    n = struct.unpack_from('<I', d, sec[3] + 12)[0]
    offs = struct.unpack_from('<%dI' % n, d, sec[3] + 16)
    effects = []
    for i, o in enumerate(offs):
        s = d[sec[3] + o:sec[3] + o + 6]
        effects.append(dict(index=i, bytes=s.hex(' ') if s[1] == 0xDF else s[:5].hex(' '),
                            note=s[2] if s[1] == 0xDF else None, velocity=s[3] if s[1] == 0xDF else None))
    return dict(samples=samples, tones=tones, effects=effects)

def sample_pcm(d, s):
    b = d[s['offset']:s['offset'] + s['bytes']]
    if s['fmt'] == 3:
        return adpcm(b)
    if s['fmt'] == 0:
        return list(struct.unpack('<%dh' % (len(b) // 2), b))
    return [(x - 256 if x > 127 else x) * 256 for x in b]

# --- the scenes' lines: STREAM/<scene>.AFS (SPSD clips and a text entry) and <scene>.IDX naming them

def afs_entries(afs):
    assert afs[:4] == b'AFS\0', 'not an AFS'
    n = struct.unpack_from('<I', afs, 4)[0]
    return [struct.unpack_from('<II', afs, 8 + 8 * i) for i in range(n)]

def spsd(clip):
    """An SPSD clip: 0x40 bytes of header (+8 codec, 3 AICA ADPCM; +0xC data bytes; +0x2A rate)."""
    assert clip[:4] == b'SPSD', 'not an SPSD clip'
    codec, size, rate = clip[8], struct.unpack_from('<I', clip, 0xC)[0], struct.unpack_from('<H', clip, 0x2A)[0]
    data = clip[0x40:0x40 + size]
    pcm = adpcm(data) if codec == 3 else list(struct.unpack('<%dh' % (len(data) // 2), data))
    return pcm, rate

def scene_lines(afs, idx):
    """IDX0: u16 entries (the AFS's), u16 the text entry's index, 12 bytes, then 20-byte records
    {name[12], u16 clip, u16 the text entry, u32 offset in it}. At the offset: u32 8, the
    speaker's 4CC, u32 bytes, the subtitle (NUL-ended; '=@' an ellipsis, '\\xa1\\xf5' a line break),
    then the lip sync. A subtitle of one byte is a line without one (a shout, a grunt)."""
    if idx[:4] != b'IDX0':
        return []
    count, text_at = struct.unpack_from('<HH', idx, 4)
    ents = afs_entries(afs)
    if count == 0 or len(ents) < count:
        return []      # a stub: the AFS holds only its header
    o, s = ents[text_at]
    text = afs[o:o + s]
    out = []
    for k in range(count - 1):
        e = idx[20 + 20 * k:40 + 20 * k]
        name = e[:12].split(b'\0')[0].decode()
        clip, _, to = struct.unpack_from('<HHI', e, 12)
        _, speaker, tl = struct.unpack_from('<I4sI', text, to)
        t = text[to + 12:to + 12 + tl].split(b'\0')[0]
        co, cs = ents[clip]
        c = afs[co:co + cs]
        size, rate = struct.unpack_from('<I', c, 0xC)[0], struct.unpack_from('<H', c, 0x2A)[0]
        out.append(dict(name=name, clip=clip, speaker=speaker.decode('latin1'),
                        text=t.replace(b'=@', b'...').replace(b'\xa1\xf5', b' ').decode('latin1') if len(t) > 1 else '',
                        seconds=round(size * 2 / rate, 2)))
    return out

def disc_lines(gdi, speakers=()):
    files = dict(sf.gdi_files(gdi))
    for p in sorted(files):
        if '/STREAM/' in p and p.endswith('.IDX') and p[:-4] + '.AFS' in files:
            idx = files[p]()
            if idx[:4] != b'IDX0' or struct.unpack_from('<H', idx, 4)[0] == 0:
                continue
            try:
                lines = scene_lines(files[p[:-4] + '.AFS'](), idx)
            except struct.error:
                # BGMnn, FREEnn, E1018: their IDX is laid out otherwise, or names past the AFS's text
                print('%s: not read' % p, file=sys.stderr)
                continue
            if not speakers or any(l['speaker'] in speakers for l in lines):
                yield p[:-4] + '.AFS', lines

# --- Ryo against Chai: their lines to each other, by the fight's moments. Disc 2's are
# the warehouse fight at night (A0172), Chai's escape with the Phoenix Mirror (A0159);
# disc 3's the harbour before the ship (A0184B, A0184D) and his fight shouts (E1062).
# `when`: intro (a round starts), win (the round's winner), lose (the round's loser),
# down (knocked down), match (the match's winner). Ryo's and Chai's lines alternate in
# an exchange: `reply` names the line that answers.
BANTER = [
    dict(id='chai_ticket', who='CHAI', when='intro', disc=2, afs='/SCENE/02/STREAM/A0172.AFS', name='A0172B008',
         text='Came for your Hong Kong ticket, did you?', reply='ryo_lan_di'),
    dict(id='ryo_lan_di', who='RYO', when='intro', disc=3, afs='/SCENE/03/STREAM/A0184D.AFS', name='A0184DA001',
         text='What are you doing here? Where is Lan Di?!', reply='chai_not_going'),
    dict(id='chai_not_going', who='CHAI', when='intro', disc=2, afs='/SCENE/02/STREAM/A0172.AFS', name='A0172B002',
         text='But you are not going to Hong Kong.'),
    dict(id='ryo_work', who='RYO', when='intro', disc=2, afs='/SCENE/02/STREAM/A0172.AFS', name='A0172A002',
         text='Do you work for Lan Di?', reply='chai_dream'),
    dict(id='chai_dream', who='CHAI', when='intro', disc=2, afs='/SCENE/02/STREAM/A0172.AFS', name='A0172B003',
         text="Me? Work? For Lan Di-sama? Heeggh... that's my dream!"),
    dict(id='chai_stronger', who='CHAI', when='intro', disc=2, afs='/SCENE/02/STREAM/A0172.AFS', name='A0172B006',
         text="Heeggh... I'll only tell you if you prove stronger than me!"),
    dict(id='chai_great', who='CHAI', when='intro', disc=3, afs='/SCENE/03/STREAM/A0184B.AFS', name='A0184BD002',
         text="Heegh! You, you aren't going to Hong Kong. Because, The great Chai will defeat you..."),
    dict(id='chai_laugh', who='CHAI', when='win', disc=2, afs='/SCENE/02/STREAM/A0159.AFS', name='A0159D001',
         text='Heeggh, heeggh!'),
    dict(id='chai_interrupted', who='CHAI', when='lose', disc=2, afs='/SCENE/02/STREAM/A0172A.AFS', name='A0172AB002',
         text="Heeggh! Interrupted! I'll save the fun for later!"),
    dict(id='chai_no', who='CHAI', when='down', disc=2, afs='/SCENE/02/STREAM/A0159.AFS', name='A0159D006',
         text='Heeggh! Ahhh, nooo!'),
    dict(id='chai_forget', who='CHAI', when='lose', disc=2, afs='/SCENE/02/STREAM/A0159.AFS', name='A0159D009',
         text="I won't forget this! Heeggh."),
    dict(id='ryo_why_you', who='RYO', when='down', disc=2, afs='/SCENE/02/STREAM/A0167.AFS', name='A0167A002',
         text='Why you!'),
    dict(id='ryo_why_you_2', who='RYO', when='down', disc=3, afs='/SCENE/03/STREAM/A0184B.AFS', name='A0184BA004',
         text='Why you...!'),
    dict(id='ryo_left', who='RYO', when='match', disc=3, afs='/SCENE/03/STREAM/A0184D.AFS', name='A0184DA002',
         text="So, Lan Di's already left for Hong Kong..."),
] + [
    # Chai's shouts in his fight (no subtitles): for his strikes and for being hit
    dict(id='chai_shout_%02d' % n, who='CHAI', when='shout', disc=3, afs='/SCENE/03/STREAM/E1062.AFS',
         name='E1062B%03d' % n, text='')
    for n in (6, 7, 8, 9, 10, 11, 12, 13, 14, 15)
]

def disc_dirs(gdi):
    """The 0.400 discs beside gdi's, by number."""
    parent, base = os.path.split(os.path.abspath(gdi.rstrip('/')))
    out = {}
    for n in (1, 2, 3):
        p = os.path.join(parent, re.sub(r'DISC \d', 'DISC %d' % n, base))
        if os.path.isdir(p):
            out[n] = p
    return out

def banter(gdi, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    discs, cache, rows = disc_dirs(gdi), {}, []
    for b in BANTER:
        if b['disc'] not in discs:
            sys.exit('disc %d is not beside %s' % (b['disc'], gdi))
        key = (b['disc'], b['afs'])
        if key not in cache:
            cache[key] = (sf.read_file(discs[b['disc']], b['afs']), sf.read_file(discs[b['disc']], b['afs'][:-4] + '.IDX'))
        afs, idx = cache[key]
        line = next(l for l in scene_lines(afs, idx) if l['name'] == b['name'])
        o, s = afs_entries(afs)[line['clip']]
        pcm, rate = spsd(afs[o:o + s])
        pcm = trim(pcm, rate)
        write_wav(os.path.join(out_dir, b['id'] + '.wav'), pcm, rate)
        rows.append(dict(b, rate=rate, samples=len(pcm), seconds=round(len(pcm) / rate, 2),
                         subtitle=line['text'], speaker=line['speaker']))
        print('%-18s %-4s %-6s %5.2f s  %s' % (b['id'], b['who'], b['when'], len(pcm) / rate, b['text']))
    json.dump(rows, open(os.path.join(out_dir, 'banter.json'), 'w'), indent=1)
    print('%d lines, %.1f s, %d KB as 8-bit PCM' % (len(rows), sum(r['seconds'] for r in rows),
                                                   sum(r['samples'] for r in rows) // 1024))

def main(argv):
    if len(argv) < 2:
        sys.exit(__doc__)
    cmd = argv[0]
    if cmd == 'bank':
        d = open(argv[1], 'rb').read()
        b = dtpk(d)
        if '--wav' in argv:
            out = argv[argv.index('--wav') + 1]
            os.makedirs(out, exist_ok=True)
            for t in b['tones']:
                write_wav(os.path.join(out, 'tone%02d.wav' % t['index']), sample_pcm(d, b['samples'][t['sample']]), t['rate'])
        if '--json' in argv:
            print(json.dumps(b, indent=1))
            return
        print('# effects: index, the note it plays (velocity)')
        print(' '.join('%d:%s' % (e['index'], '%d(%d)' % (e['note'], e['velocity']) if e['note'] is not None else '-')
                       for e in b['effects']))
        print('# tones: index, sample, rate, seconds')
        for t in b['tones']:
            s = b['samples'][t['sample']]
            n = s['bytes'] * 2 if s['fmt'] == 3 else s['bytes'] // (2 if s['fmt'] == 0 else 1)
            print('%2d  sample %2d  %5d Hz  %.2f s  (tune %d %+d/64)' % (t['index'], t['sample'], t['rate'],
                                                                      n / t['rate'], t['coarse'], t['fine']))
        return
    if cmd == 'lines':
        speakers = [a for a in argv[2:] if not a.startswith('--')]
        found = dict(disc_lines(argv[1], speakers))
        if '--json' in argv:
            print(json.dumps(found, indent=1))
            return
        for afs, lines in found.items():
            print('#', afs)
            for l in lines:
                print('  %-12s %-4s %5.2f s  %s' % (l['name'], l['speaker'], l['seconds'], l['text'] or '(no subtitle)'))
        return
    if cmd == 'clip':
        afs, idx = sf.read_file(argv[1], argv[2]), sf.read_file(argv[1], argv[2][:-4] + '.IDX')
        line = next(l for l in scene_lines(afs, idx) if l['name'] == argv[3])
        o, s = afs_entries(afs)[line['clip']]
        pcm, rate = spsd(afs[o:o + s])
        write_wav(argv[4], trim(pcm, rate), rate)
        print(line)
        return
    if cmd == 'banter':
        banter(argv[1], argv[2])
        return
    sys.exit(__doc__)

if __name__ == '__main__':
    main(sys.argv[1:])
