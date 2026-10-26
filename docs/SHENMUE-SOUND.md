# Shenmue's fight sounds (0.400)

The goal: Ryo and Chai should hit with Shenmue's own hit sounds, on Shenmue's
own scale of strengths, and talk to each other when they meet. On the board they
make the sounds of the StF characters whose slots they take (Ryo Tails', slot 1;
Chai's blows the robots' lists, slot 12; docs/BOARD.md, Sound). This page is what
the discs hold toward that, and what the board will need. `tools/shenmue-sound.py`
reads it all.

**In short:**
- The hits, swings and shouts are two sound packs, `SCENE/0n/SOUND/BATTLE_1.SND`
  and `BATTLE_2.SND` (DTPK), in AICA ADPCM. BATTLE_1's tones 0..37 are the hits
  and swings, 38..69 shouts at 14 kHz.
- Each motion names its own strike sound in MOTION.BIN: SE 25 light, 26 middle,
  28 heavy, 27 throws (Shenmue's punch scale, below). This beta's code skips it.
- The scenes' lines are `SCENE/0n/STREAM/<scene>.AFS` (SPSD clips, AICA ADPCM at
  14000 Hz, with the subtitles) and `<scene>.IDX` (the clips' names).
- Ryo and Chai talk to each other in five scenes on discs 2 and 3. `BANTER` in the
  tool picks 14 of their lines and 10 of Chai's fight shouts, by the fight's
  moments: 65 s, 887 KB as 8-bit PCM.
- `BTT00.AFS`'s `BVOICE.SRF` (the name the program gives the battle voices,
  with BVOICE018..031) is an empty stub on all three discs.

```bash
D3="$HOME/source/repos/ai/SHENMUE 1 BETA 0.400 DISC 3 PERFECT DUMP"
python3 tools/shenmue-fight.py extract "$D3" /tmp/x SCENE/03/SOUND/BATTLE_1.SND SCENE/03/SOUND/BATTLE_2.SND
python3 tools/shenmue-sound.py bank /tmp/x/SCENE/03/SOUND/BATTLE_1.SND [--json] [--wav /tmp/b1]
python3 tools/shenmue-sound.py lines "$D3" CHAI          # every scene Chai speaks in
python3 tools/shenmue-sound.py banter "$D3" /tmp/banter  # BANTER as WAVs (disc 2 beside disc 3) + banter.json
```

## AICA ADPCM

Both kinds of file hold Yamaha's ADPCM as the AICA plays it: 4 bits a sample,
the low nibble first, from a step of 127 and a sample of 0. A nibble n gives
d = ((2·(n&7)+1)·step) >> 3, added (subtracted if n&8), clamped to 16 bits; the
step is multiplied by [230, 230, 230, 230, 307, 409, 512, 614][n&7] / 256 and
kept in 127..24576. Every sample and clip decodes to sound with silences and an
end that dies to 0 (the clips' rms by half second rises and falls with the
words).

The SCSP (Model 2B's sound) has no ADPCM: on the board they are 8- or 16-bit PCM.

## The battle packs: DTPK

Little-endian. "DTPK", then at 0x20 eight u32s, the sections' offsets:

| # | BATTLE_1 | What it is |
|---|---|---|
| 0 | 0x60 | 8 channel records (0x28 bytes) |
| 1 | 0x198 | not decoded |
| 2 | 0x230 | a 0x84-byte curve (velocity) |
| 3 | 0x2B4 | the effects |
| 4 | 0x5FC | the tones |
| 6 | 0x17CC | not decoded |
| 7 | 0x23F4 | the samples |

- **Samples:** u32 count − 1, then 16 bytes each: {fmt << 24 | file offset,
  loop end << 16 | loop start, 0, bytes}. fmt 3 is ADPCM (every one here). The
  data runs to the file's end. BATTLE_1 has 67, BATTLE_2 41.
- **Tones:** 0x10 bytes of header, a 0x40-byte program (+0x10: the last tone,
  69 in BATTLE_1, 40 in BATTLE_2), then 0x40-byte tones: [index][0x80][sample][1],
  and at +10 a coarse tune (s8, semitones) and +11 a fine one (1/64 semitone)
  from 44100 Hz. −12 is 22050 Hz; the shouts' −20 +8 is 13991 Hz, the clips'
  14000.
- **Effects:** u32 1, two u32s, u32 count (69, 43), then u32 offsets from the
  section to byte strings: `c0 df NN VV 80 ff` plays NN at velocity VV, and
  `c0 a0 00 80 ff` is an empty slot. NN counts the effects that are not empty
  (0..56 in BATTLE_1), so it is not the tone's index (70 tones); which tones an
  NN plays is not decoded.

BATTLE_1 (scenes 01 and 03; disc 1's SCENE/01 copy is 309480 bytes, the
others 284444) and BATTLE_2 share their first 23 tones (the same samples, the
same tunes). Then:

| Tones | BATTLE_1 | BATTLE_2 |
|---|---|---|
| 0..22 | hits and swings, 22050 Hz (some 5840..27781) | the same |
| 23..37 | more, 11025 Hz and 13111 Hz | 23..40: 18 more at 11025 Hz |
| 38..69 | 32 shouts, 13991 Hz, voiced (autocorrelation 0.3..0.8 against the hits' 0.05..0.5) | |

## The scenes' lines: AFS, IDX and SPSD

- **AFS:** "AFS\0", u32 count, then {offset, bytes} each. The data starts at
  0x80000. Some scenes are stubs: an AFS of the header only (BTT00, and disc 1's
  01BEDA..). The last entry is the text.
- **IDX:** "IDX0", u16 entries (the AFS's), u16 the text entry's index, 12 bytes,
  then 20-byte records: the clip's name (12 bytes: scene, speaker letter, number,
  `A0184DB002`), u16 its AFS entry, u16 the text entry, u32 the line's offset in it.
- **The text:** at the offset, u32 8, the speaker (AKIR is Ryo, CHAI, KISY Gui
  Zhang, TAIJ Master Chen, FUKU, ...), u32 bytes, the subtitle (NUL-ended,
  `=@` an ellipsis, A1 F5 a line break), then the lip sync (u32 pairs, to
  0xFFFFFFFF). A subtitle of one byte is a line with none: a shout or a grunt.
- **SPSD:** a 0x40-byte header (+8 the codec, 3 ADPCM; +0xC the data's bytes;
  +0x2A the rate, 14000), then the data. A clip is padded to a 2 KB sector.

### Where Ryo and Chai meet

`lines "$D2" CHAI` and `"$D3" CHAI` (disc 1 has none; on each disc a few scenes are not read: the BGMnn and FREEnn music scenes and E1018, whose IDX is laid out otherwise):

| Scene | Disc | What it is | Lines |
|---|---|---|---|
| A0159 | 2 | Chai takes the Phoenix Mirror and runs | Chai 9, Ryo 24, Master Chen, Gui Zhang |
| A0167 | 2 | Gui Zhang guards Ryo | Chai 1 (9 s, "the Phoenix Mirror?") |
| A0172, A0172A | 2 | the fight at the warehouse at night | Chai 9, Ryo 6 |
| 01GET | 3 | Chai calls about Nozomi | Chai 4 |
| A0184B, C, D | 3 | the harbour: Chai's last fight | Chai 9, Ryo 12 |
| E1062 | 3 | Chai's fight shouts | Chai 14, no subtitles |

### BANTER

The tool's pick, by the moment of a fight it suits (`when`): `intro` as a round
starts (an exchange: `reply` names the answer), `win` and `lose` the round's
winner and loser, `down` knocked down, `match` the match's winner, `shout` Chai's
strikes and being hit. Trimmed of the silence around them:

| id | who | when | s | line |
|---|---|---|---|---|
| chai_ticket → ryo_lan_di → chai_not_going | Chai, Ryo, Chai | intro | 4.9, 2.6, 6.9 | Came for your Hong Kong ticket, did you? / What are you doing here? Where is Lan Di?! / But you are not going to Hong Kong. |
| ryo_work → chai_dream | Ryo, Chai | intro | 1.9, 5.8 | Do you work for Lan Di? / Me? Work? For Lan Di-sama? Heeggh... that's my dream! |
| chai_stronger | Chai | intro | 6.7 | Heeggh... I'll only tell you if you prove stronger than me! |
| chai_great | Chai | intro | 8.9 | Heegh! You, you aren't going to Hong Kong. Because, The great Chai will defeat you... |
| chai_laugh | Chai | win | 2.6 | Heeggh, heeggh! |
| chai_interrupted, chai_forget | Chai | lose | 7.0, 2.5 | Heeggh! Interrupted! I'll save the fun for later! / I won't forget this! Heeggh. |
| chai_no | Chai | down | 2.4 | Heeggh! Ahhh, nooo! |
| ryo_why_you, ryo_why_you_2 | Ryo | down | 1.4, 0.9 | Why you! / Why you...! |
| ryo_left | Ryo | match | 2.8 | So, Lan Di's already left for Hong Kong... |
| chai_shout_06..15 | Chai | shout | 0.5..1.2 | (E1062B006..015) |

Only when Ryo faces Chai: against anyone else they say nothing new.

## On the board (not done yet)

What the next step needs, from docs/BOARD.md (Sound, Akira's sounds):

- **The data:** a new request group in `tools/guest-sound.mjs`, as VF2's are
  group 0x15: 0xAE16xx for the hits (a by-key tone on an effects channel, one
  note an effect) and 0xAE17xx for the lines and shouts. The samples converted
  to PCM at their own rates (the SCSP's pitch plays them). 3.17 MB of the sample
  ROMs is free: the lines are 887 KB as 8-bit PCM, BATTLE_1's tones about
  1 MB as 8-bit.
- **Long lines:** a SCSP slot's loop end is 16 bits, 65535 samples: 4.7 s at
  14000 Hz. Seven of BANTER's lines are longer (chai_not_going, chai_dream,
  chai_stronger, chai_great, chai_interrupted, chai_ticket 4.9): they need two
  notes in one track, or 7 kHz.
- **The hits:** StF picks a hit's sound in `loc_2B33C` by the attacker's parent
  (rob+0x1B1: 3, 11, 12 and 13 have robot lists) or by the drawn character
  (rob+0x1B0 × 12 into `dword_DB6F4`, 13 rows of `sd_punch_m/j/k`, then
  `dword_DB964`, 19 rows of `sd_punch_a/b/c`). A row is 4 groups of 3
  strengths; Sonic's last group is `sd_WB02_24_01`, Knuckles' first two
  `sd_WB04_82_04`. Shenmue's scale goes into rows of their own for slots 1 and
  12 (and the robot lists' 12 out of the way), at Shenmue's strengths (below).
- **The lines:** `snd_round` in megamix.c sends the round's sounds; the intro
  exchange would go after the gong when the two fighters are Ryo and Chai
  (a line's length in frames before the reply), the others at JUDGE_INT
  and VIC_INT, `down` from the knockdown, `shout` from Chai's play op as
  Akira's voices are sent (op 9).

## Shenmue's punch scale

Read from disc 3's 1ST_READ (loaded at 0x0C010000) and MOTION.BIN, not run.
There is no table that picks a sound by strength or by hit, guard and miss:
each motion's record names its own, at the frame it strikes.

- **The call:** a sound is `SE << 16 | 0x0Sab`, S the bank's slot: 0x76AB slot
  6, the battle pack (BATTLE_1 or _2; which one a scene loads is not found),
  0x77AB slot 7 (Ryo's voices, it seems), 0x00AB the system's. `0x0C1946DE`
  (code, fighter) plays one at the fighter's place (`0x0C17B008`, which sets
  the volume by distance and the pan); five functions call it.
- **The record's events:** after the record's ops (dispatcher `0x0C1AE374`,
  table 0x0C2A06A4), op 8 starts its events, `[u16 frame][u8 type][u8 arg]
  [payload]` (`0x0C1AEBDC`, table 0x0C2A0718). Type 4, `04 05 <u32 code>`,
  holds every strike's sound: Elbow Slam's is `09 00 04 05 ab 76 19 00`, SE 25
  at frame 9, its blow's first frames being 8..12. **This beta's handler for
  type 4 (`0x0C1AEE82`) only steps over it**: as the code reads, strikes make no
  sound. Type 0x20 plays its code (5 records, all SE 12), type 9 a voice by the
  fighter's class, type 0x2D a line.
- **The scale** (MOTION.BIN's type-4 events, by the record's kind, 4 strike
  or 5 throw, and damage):

  | SE | Tone → sample | Events | Used for |
  |---|---|---|---|
  | 25 | 17 → 41 | 104 | light strikes, damage 3–6 |
  | 26 | 18 → 42 | 114 | middle and heavy strikes, 8–15, kicks mostly |
  | 28 | 20 → 44 (velocity 0x78) | 26 | heavy strikes, 14–15 |
  | 27 | 19 → 43 | 55 | throws, 0–80 |
  | 23 | 15 → 56 | 41 | strikes and throws |
  | 2, 8, 12, 17 | 2 → 47, 6 → 58, 8 → 35, 12 → 53 | 32, 15, 21, 29 | throws' slams and falls, damage 30–40 |
  | 38, 39, 41, 42 | 26 → 29, 27 → 30, 29 → 26, 30 → 27 | 50, 125, 17, 12 | voices |

  SE 0..32 are laid out alike in both packs, so the scale sounds the same with
  either. The sound marks the blow's frame whether it lands or not.
- **Sounds the code plays:** landing (`0x0C1930D0`): SE 12 below speed 20.0 and
  SE 13 from 20.0 on ground 5 or 6, SE 2 elsewhere (SE 1 from a table at
  0x0C2A0B8C). A knockout (`0x0C1B207C`): a cry by the fighter (table
  0x0C2A096C: SE 51, 54, 55, 66, or slot 9's voices; else SE 64, 65, 67 or 68 at
  random), then 0xC77AB. `0x0C1B1E16`: SE 30, when not found.
- **Voices (type 9):** by the fighter's own id: Ryo (0) slot 7's, the
  thugs SE 50..63, others slot 9's (`…09A9`), from the table at 0x0C2A0B40.
  BATTLE_2 has no SE past 43, so none of these: a fight with fewer voices.

On the board: Ryo's and Chai's rows of the StF table get SE 25 for the light
strength, SE 26 the middle, SE 28 the heavy, SE 27 for throws (and their slams
from the move's own event).
