# Shenmue's fight data (betas 0.300 and 0.400)

The goal is to port Ryo and his best-known moves to Megamix: each move's command,
motion, damage and frames. This page covers what the Shenmue betas hold toward
that. `tools/shenmue-fight.py` reads it. The motions themselves are #1505's work,
in `docs/VF3-SHENMUE.md` and `tools/shenmue-motion.mjs` on branch
`vf3-shenmue-motions`.

**In short:**
- The program on every disc has the fight engine and Ryo's notebook: the move
  names, and on 0.400 their descriptions.
- Each fighter's moves are a script in `EN_<NAME>.BIN`. The script maps a button
  and a direction sequence to a skill, an action number and a motion id.
- The Passport (0.300) has no EN_ files. Discs 1-3 of 0.400 have them.
- A motion id k is MOTION.BIN's record k − 1 (see "Motion ids").
- Damage is a byte in each motion's record in MOTION.BIN, the one the table's
  second offset points to. Elbow Slam's is 4 (see "Damage"). Frame data sits
  in the same record but isn't decoded: the hit block's three frame words
  don't line up across strikes and throws.

## Reading the discs

```bash
D3="$HOME/source/repos/ai/SHENMUE 1 BETA 0.400 DISC 3 PERFECT DUMP"
python3 tools/shenmue-fight.py list "$D3"                            # path, LBA, size
python3 tools/shenmue-fight.py extract "$D3" /tmp/x 1ST_READ.BIN MOTION.BIN SCENE/03/MFBT/EN_RYOU.BIN
python3 tools/shenmue-fight.py moves /tmp/x/1ST_READ.BIN [--json]   # notebook names (+ descriptions)
python3 tools/shenmue-fight.py cast /tmp/x/1ST_READ.BIN             # EN_ file names by fighter id
node tools/shenmue-motion.mjs /tmp/x/MISC/MOTION.BIN --list > /tmp/x/m.txt   # branch vf3-shenmue-motions
python3 tools/shenmue-fight.py script /tmp/x/SCENE/03/MFBT/EN_RYOU.BIN --names /tmp/x/m.txt
python3 tools/shenmue-fight.py skills /tmp/x/SCENE/03/MFBT/EN_RYOU.BIN /tmp/x/1ST_READ.BIN --names /tmp/x/m.txt [--json]
```

- **The discs:** the high-density area is the .gdi's data tracks from LBA
  45000: TRACK03 and TRACK07 on the Passport, TRACK03 and TRACK06 on 0.400. They
  hold ISO 9660 with 2048-byte sectors.
- **extract:** it keeps the disc's paths, because the scenes repeat file names.
- **Addresses:** 1ST_READ.BIN loads at 0x0C010000. Each disc's program is a
  different build, so the tool finds its tables by their first names.
- **Passport addresses:** the ones below are the Passport build's (P), with
  disc 3's (D3) where they were looked up.

## Ryo's notebook

There are three tables of 12-byte records. Each holds a pointer to the Japanese
name (in WAZA.FON's own 2-byte encoding), a pointer to the English name, a u16
group and a u16 zero.

| Table | P | D3 | Moves |
|---|---|---|---|
| hand | 0x0C4526FC | 0x0C2A0F3C | 19, groups 0–16 |
| leg | 0x0C45289C | 0x0C2A10DC | 18, groups 0–15 |
| throw | 0x0C452A24 | 0x0C2A1264 | 14, groups 0–13 |

- **Descriptions:** on 0.400, an array per table holds the names' pointers,
  then the descriptions' (D3: 0x0C2A13AC, 0x0C2A1448 and 0x0C2A14DC). For
  example, Elbow Slam is "a downward rotating blow from the forearm, aimed at
  the opponent's collarbone".
- **Skill id:** the scripts' skill id is the table index (not the group), plus
  0 for hand, 32 for leg and 64 for throw. The bounds table at P 0x0C49506C
  reads [0, 0, 32, 64, 80].
- **Groups:** two names can share a group, which is their counter slot. Pit Blow
  shares Elbow Slam's, and Double Blow shares TwinHandWaves'. The stats id is
  `kind << 8 | group` (kind 1 hand, 2 leg, 3 throw).
- **Use counts:** the save keeps a u16 "used" count and a u16 "hit" count per
  move, at +0xBC4 and +0xCC4 of `*(*(0x0C2F5070) + 0x80)` (P). FUN_0c1e397e adds
  a fight's counts (battle context +0x222/+0x322) to them.

## Fighters: EN_<NAME>.BIN

- **Loader (P):** FUN_0c0e0390(n) loads `scene/%02d/<4CC>/EN_%s.BIN`, tagged
  'FIGH', into `*(0x0C2F4330) + 0x14 + 4n`. n indexes the 58 names (run `cast`):
  RYOU=0, ZAKO1-4, ENOKI, CHAI, ….
- **Fighter setup:** FUN_0c1e4646 picks the file by the fighter's id, falling
  back to RYOU.
- **Where they are (0.400):**
  - Ryo's file is in nearly every scene directory and in /FIGHT/. All copies are
    7596 bytes.
  - Disc 3's ten SCENE/03 copies are identical. /FIGHT/'s differs in a few
    instructions near 0x0C5C.
  - The Free Battle scene is SCENE/03/MFBT. It holds EN_RYOU, ZAKO1-5, KISYO,
    KISY2/3, MURA, PEDRO, SATOS, TIME1-5 and COMM1/4/5, plus M_FGT1.BIN (a motion
    bank of 530 names) and BATTLE70.AFS.
- **Format:** big-endian. The header is five u32s, all file offsets:

  | Offset | Ryo's | Becomes | What it is |
  |---|---|---|---|
  | 0 | 0 | | |
  | +4 | 0x14 | ctx+0x28 | the move script |
  | +8 | 0x17F8 | ctx+0x2C | the script's end. After it, lists of u16s ending 0x7F (not decoded) |
  | +0xC | 0x1BBC | ctx+0x30 | its first word is an offset, kept at ctx+0x3C (not decoded) |
  | +0x10 | 0x1D8A | ctx+0x34 | its first word is an offset, kept at ctx+0x38 (not decoded) |

## The move-script VM

- **Stepping:** FUN_0c1d98e6 (P) steps the script. ctx+0x60C is the
  instruction pointer, and FUN_0c1dbb5a resets it to the start.
- **Handlers:** they are at P 0x0C47BA70, one per op. Each returns 0 next,
  3 backtrack (pop the stack of 0x18-byte frames at ctx+0x648, depth ctx+0x628),
  4/5 wait, 6/7 done, or 1 abort.
- **Instructions:** big-endian, byte 0 the op. Most are 4 bytes. These are 8:
  5–12, 14, 19, 21, 26–28, 34–36, 40–42, 50, 54, 57–59, 62, 64, 69, 72, 73, 77,
  80–83, 89 and 90. Op 76 is 12. With these lengths, Ryo's script parses exactly
  from 0x14 to 0x17F8.
- **Jump targets:** they are offsets from the script's start (file offset
  0x14), so the file needs no relocation.

| Op | Name in the tool | What it does |
|---|---|---|
| 0x0E | switch | if ctx+0x7C8 == u16@2, go to u16@4 |
| 0x0F | try | push u16@2 as the alternative: the next candidate if this one fails |
| 0x04 | window | byte 1 = the input window in frames |
| 0x48 / 0x49 / 0x4D | in / in_held / in_dir | match the pad history against mask u16@2 |
| 0x56 | skill | needs skill id byte 1 at level ≥ byte 2 (FUN_0c22a440 → FUN_0c22a010) |
| 0x47 | action | ctx+0x8D3 = byte 1, the action number |
| 0x05 | play | 8 bytes. u32@4 → ctx+0x318, then starts the action |
| 0x0D | if | conditional jump |
| 0x10 / 0x11 | end / goto | |

- **Actions:**
  - 0x16–0x19 are throws.
  - 0x57 is special.
  - Those under 0x50 are kept as the last attack.
  - The script's first instruction sets action 0x50.
- **play's word:**
  - The low 16 bits are a motion id, one-based: see "Motion ids".
  - Bit 28 (0x10000000) marks every throw and Swallow Flip: the paired motions.
  - FUN_0c1e867e (P) dispatches on one byte of the word through a table at
    0x0C1E8730. Its kinds are not decoded.
- **Pad bits (P 0x0C47BBE4/0x0C47BC28):**
  - Buttons: A 1, X 2, Y 4, B 8.
  - Directions: 0x10, 0x20, 0x40 and 0x80, at 0°, 180°, +90° and −90° of the
    angle table at 0x0C47BC6C.
  - 0x400 and 0x800 OR in the facing-relative forward and back (ctx+0x7DC and
    ctx+0x7E0).
  - The tool prints them as dir0, dir180, …. Going by the notebook text,
    dir180 (0x20) is forward and dir0 (0x10) is back: see "Which way is forward".
- **Root dispatch:** the script starts with a run of switches on ctx+0x7C8, the
  buttons pressed. Ryo's branches:
  - 1: the hand moves (P)
  - 2: the leg moves (K)
  - 0x10: the throws
  - 3: P+K
  - 0x0A and 0x18: three more each
  - 0x0510 and 0x0502: special states
- **One candidate:** `try alt`, `window n`, input checks, `skill id lv1`,
  `action`, `play`. A level-1 check that fails moves on to a level-2 copy of the
  same skill, which often plays a different motion.

## Ryo's moves (0.400 disc 3, SCENE/03/MFBT/EN_RYOU.BIN)

From `skills … --json`, one row per skill:

- **Directions:** the checks in script order. They match the pad history, which
  is probably scanned newest first.
- **Motion:** the play that follows the skill check: its motion id, and the
  name of MOTION.BIN record id − 1. A `*` marks bit 28 (paired).

| Skill | Id | Button | Directions | Action | Motion (MOTION.BIN name) |
|---|---|---|---|---|---|
| Mistral Flash | 12 | P | – | 0x0c | lv1 1203 AKI_AKI_BAT_RUN_ELB_TOP_R |
| Twin Blades | 17 | P | held dir180 0 dir180 dir0 dir0 0 | 0x11 | lv2 779 DMY_AKI_AKI_CHP_MON |
| Rain Thrust | 6 | P | held dir180 dir0 dir0 0 | 0x06 | lv1 793 AKI_AKI_BATTLE_PANCH_STR |
| Elbow Assault | 3 | P | held dir180 0 held dir180 | 0x03 | lv1 1007 AKI_AKI_RIMONT_MID |
| Pit Blow | 13 | P | held dir180 | 0x0d | lv2 1165 AKI_AKI_KONGO_TYUKEN_A_MID |
| Elbow Slam | 1 | P | held dir180 | 0x01 | lv1 847 AKI_AKI_ELBOW |
| Rising Flash | 16 | P | held dir0 0 dir0 dir180 dir180 0 | 0x10 | lv2 1145 AKI_AKI_NEWAP_S1 |
| Sleeve Strike | 5 | P | held dir0 dir180 dir180 0 | 0x05 | lv1 867 AKI_AKI_BATTLE_SEIKEN2_MID |
| Upper Knuckle | 4 | P | held dir0 0 held dir0 | 0x04 | lv1 837 AKI_AKI_BATTLE_PNC_APR |
| Swallow Flip | 15 | P | held dir0 | 0x0f | lv1 1178* AKI_AKI_NGS_INASI |
| Twist Knuckle | 2 | P | held dir0 | 0x02 | lv1 794 AKI_AKI_BATTLE_PNC_FUK |
| Cyclone Kick | 41 | K | – | 0x29 | lv2 1142 AKI_AKI_KICK_BACKROLL_JUMP_S1 |
| Mud Spider | 47 | K | held dir180 0 dir180 dir0 dir0 0 | 0x2f | lv2 1149 AKI_AKI_KICK_SUBERI_S1 |
| HoldAgainstLeg | 38 | K | held dir180 dir0 dir0 0 | 0x26 | lv1 789 AKI_AKI_BATTLE_KICK_SID |
| Tornado Kick | 44 | K | held dir180 0 held dir180 | 0x2c | lv1 1213 AKI_AKI_BAT_KICK_NIREN1_TOP |
| AgainstCascade | 35 | K | held dir180 0 held dir180 | 0x23 | lv2 1438 AKI_AKI_KICK_KERIAGE |
| Trample Kick | 33 | K | held dir180 | 0x21 | lv1 849 AKI_AKI_MAEGERI |
| Crawl Cyclone | 46 | K | held dir0 0 dir0 dir180 dir180 0 | 0x2e | lv2 1107 AKI_AKI_KICK_ZEN_S1 |
| Thunder Kick | 37 | K | held dir0 dir180 dir180 0 | 0x25 | lv2 1439 AKI_AKI_KICK_KKT_S1 |
| Surplice Slash | 36 | K | held dir0 0 held dir0 | 0x24 | lv1 1328 AKI_AKI_KICK_HAZ_KESA_TOP |
| Swallow Dive | 43 | K | held dir0 | 0x2b | lv2 1433 AKI_AKI_KICK_ENSEN1_S1 |
| SideReaperKick | 34 | K | held dir0 | 0x22 | lv1 788 AKI_AKI_BATTLE_KICK_LOW |
| Tiger Storm | 75 | throw | held dir180 0 dir180 dir0 dir0 0 | 0x4b | lv1 1151* AKI_AKI_NGS_HED_1; lv2 930* AKI_AKI_NGS_HED_2_S1 |
| Tengu Drop | 70 | throw | held dir180 dir0 dir0 0 | 0x46 | lv1 1150* AKI_AKI_NGS_BKFRIP |
| Mist Reaper | 67 | throw | held dir180 0 held dir180 | 0x43 | lv1 1204* AKI_AKI_NGS_JUDO_OG |
| Sweep Throw | 65 | throw | held dir180 | 0x41 | lv1 1476* AKI_AKI_NGS_UCH |
| Arm Break Fire | 74 | throw | held dir0 0 dir0 dir180 dir180 0 | 0x4a | lv1 918* AKI_AKI_NGS_SP1_ELB |
| Shoulder Buster | 69 | throw | held dir0 dir180 dir180 0 | 0x45 | lv1 1526* AKI_AKI_NGS_WUDE1 |
| Demon Drop | 68 | throw | held dir0 0 held dir0 | 0x44 | lv1 1292* AKI_AKI_NGS_MAKINAGE |
| Vortex Throw | 66 | throw | held dir0 | 0x42 | lv1 1205* AKI_AKI_NGS_JUDO_TM |
| Windmill | 42 | P+K | – | 0x2a | lv1 1329 AKI_AKI_KICK_HAZ_TOBI_TOP |
| TwinSwallowLeap | 48 | P+K | held dir180 0 dir180 dir0 dir0 0 | 0x30 | lv2 586 DMY_AKI_AKI_KICK_BEST |
| Dark Moon | 40 | P+K | held dir180 dir0 dir0 0 | 0x28 | lv2 1431 AKI_AKI_KICK_ABISEGERI_S1 |
| AvalancheLance | 10 | P+K | held dir180 0 held dir180 | 0x0a | lv2 1290 AKI_AKI_ELB_ROLL_TOP |
| Double Blow | 14 | P+K | held dir180 | 0x0e | lv2 1445 AKI_AKI_YAG_ITIMON1_MID_S1 |
| TwinHandWaves | 8 | P+K | held dir180 | 0x08 | lv1 1422 AKI_AKI_SOUSYOU |
| Stab Armor | 18 | P+K | held dir0 0 dir0 dir180 dir180 0 | 0x12 | lv2 1428 AKI_AKI_BATTLE_PNC_SHOTEI_S1 |
| Brutal Tiger | 39 | P+K | held dir0 dir180 dir180 0 | 0x27 | lv2 1432 AKI_AKI_KICK_BACKROLL_S1 |
| KatanaMistSlash | 11 | P+K | held dir0 0 held dir0 | 0x0b | lv1 1289 AKI_AKI_CHP_NUKE_MID |
| Backfist Willow | 9 | P+K | held dir0 | 0x09 | lv1 898 AKI_AKI_URAKEN_ROLL_TOP |
| Big Wheel | 7 | P+K | – | – | lv2 1427 AKI_AKI_BATTLE_PUNCH_FUK_S1 |
| Shadow Reaper | 49 | 0x0A | – | 0x31 | lv2 1443 AKI_AKI_RUN_KICK_SURA_S1 |
| Cross Charge | 77 | 0x18 | held dir180 0 held dir180 | 0x4d | lv1 929* AKI_AKI_NGS_FROU |
| Shadow Step | 73 | 0x18 | held dir180 | 0x49 | (another candidate) |
| Shadow Blade | 76 | 0x18 | – | – | (another candidate) |

## Which way is forward

dir180 (0x20) is forward, toward the opponent, and dir0 (0x10) is back. This
comes from the notebook descriptions (1ST_READ.BIN 0x26EB10 on, one per move in
the name list's order) laid against the script's checks. The game doesn't confirm
it: the notebook text gives no commands, and it isn't checked on screen.

- **Reading a check:** the script lists the newest input first, so a row reads
  backwards in time. `held dir180 0 held dir180` is dir180, let go, dir180 held
  with the button: a double tap. `held dir180 dir0 dir0 0` is dir0, then dir180
  with the button. Ryo's script uses only dir0 and dir180: no up or down.
- **A double tap of dir180 rushes in:**
  - Elbow Assault: "a full-body rush".
  - Cross Charge: "moves in for an elbow strike".
  - Tiger Storm: "aggressively lunging into the opponent". Its check ends in the
    same double tap.
  - Mud Spider: "slides toward the opponent". Its check ends the same way too.
  A dash is a double tap forward; a double tap back is a back step.
- **dir180 held steps in:** TwinHandWaves ("advancing a step forward") and
  Double Blow ("begins with a step forward"). Trample Kick, a front kick
  (AKI_AKI_MAEGERI), is dir180 too.
- **dir0 held goes back:** Vortex Throw is the sacrifice throw, in which Ryo
  "falls backward" (AKI_AKI_NGS_JUDO_TM, tomoe nage). Swallow Flip deflects the
  attack (AKI_AKI_NGS_INASI, a parry). Both are moves you'd do pulling back.
- **Against it:**
  - KatanaMistSlash "advances one step with the forward leg" but is a dir0
    double tap.
  - Stab Armor is "stepping in deeper", and its check ends dir0 held.
  These are two to the nine above. The step may belong to the motion, not to
  the stick.
- **Still to check on screen:** in Free Battle, dir180 + P should play Elbow
  Slam (AKI_AKI_ELBOW) and dir0 + P Twist Knuckle (AKI_AKI_BATTLE_PNC_FUK), with
  Ryo facing either way.

## Motion ids

A play's motion id k names MOTION.BIN's record k − 1 (disc 3's `/MISC/MOTION.BIN`).
`shenmue-motion.mjs --list` prints records from 0, so `--names` takes 1 off the id.

- **The file's records line up:** the name list (1559 pointers at 0x12298) and the
  table at 0x20 (1559 × 8 bytes, ending in a zero entry at 0x30D8) have the same
  count, and every `ERROR`, `ERROR_n` name sits on the table entry pointing at
  the shared error motion (0x105D8A, 0x3540). So record i is name i. The slip
  was in reading the id as a record number.
- **Id − 1 fits the moves** (notebook description → the name):

  | Move | Id | Record id − 1 (now) | Record id (before) |
  |---|---|---|---|
  | Elbow Slam: a downward blow from the forearm | 847 | AKI_AKI_ELBOW | AKI_AKI_HIZA (knee) |
  | Upper Knuckle: lowers, then rises to the jaw | 837 | AKI_AKI_BATTLE_PNC_APR (uppercut) | AKI_AKI_BATTLE_ROLL_KICK_MID |
  | Twist Knuckle: a sweeping horizontal hook | 794 | AKI_AKI_BATTLE_PNC_FUK | AKI_AKI_BATTLE_SEIKEN_MID (straight) |
  | Tornado Kick: two spin kicks | 1213 | AKI_AKI_BAT_KICK_NIREN1_TOP (two kicks) | AKI_AKI_BAT_KICK_NIREN2_TOP |
  | Vortex Throw: the judo sacrifice throw | 1205* | AKI_AKI_NGS_JUDO_TM (tomoe nage) | AKI_AKI_NGS_YAG_TENTI |

- **The rest fit too:** Rain Thrust (a straight punch) → PANCH_STR, Sleeve
  Strike (a step-in punch) → SEIKEN2_MID, Backfist Willow → URAKEN_ROLL (a
  spinning backfist), Mistral Flash (from a run) → BAT_RUN_ELB, Swallow Flip
  (deflects) → NGS_INASI, Windmill (a flying kick) → KICK_HAZ_TOBI, Mud Spider →
  KICK_SUBERI (a slide), Shoulder Buster (an armlock) → NGS_WUDE1, Demon Drop →
  NGS_MAKINAGE. Without the − 1, Demon Drop and Backfist Willow land on YKI_
  (the victim's side) and Windmill on JIJ_ (another character).
- **Not checked on screen:** the names make it near certain, but no
  breakpoint on play (ctx+0x318) has confirmed it. The code that turns the id
  into a record isn't found either.

## Damage

Each move's damage is in its motion's record in MOTION.BIN, not in EN_RYOU.
Elbow Slam's damage is **4**. It hasn't been checked on screen.

- **EN_RYOU's tables after the script have none.** None has one entry per
  skill (45):
  - **0x17F8–0x1BB8:** 48 records of 20 bytes, then 0x7F. A record is up to
    10 input bytes (0x01 P, 0x02 K, 0x10/0x20 the directions, 0x21 dir180+P …)
    ending 0x7F, padded, then one byte per input (1 or 5). These look like
    command strings, maybe for the CPU, not damage.
  - **0x1BBC:** 0x1BB8 (that table's end), the fixed-point numbers 1.8 and
    3.0, some bytes and colours, then at 0x1C44 40 u16 motion ids (0x00BC …
    0x04F0): the basic motions. 0x1D2A holds more motion ids.
  - **0x1D8A:** 0x1C44 (that list), then 1.6 four times, 3.0, 0x41 and 1.
- **The motion record:** a MOTION.BIN table entry's second word is a file
  offset, between the table's end and the names (0x30E0–0x12298). The
  records are 80–124 bytes, in record order. Every skill motion of Ryo's has
  one. Like this one, Elbow Slam's (id 847, record 846, at 0x8CE4):

  ```
  21 01 20 00 00 00 00 00 00 00 00 00   header: byte 0 0x21 strike, 0x31 two hits, 0xA1/0xE1 throw
  02 00 08 00 0c 00 1b 00               tag 2, u16 LE 8, 12, 27 (the motion has 27 frames)
  04 04 01 0e                           kind (4 strike, 5 throw), damage, then u16 LE: on a throw the victim's motion id
  00 00 b3 33                           16.16 big-endian, 0.7 (see "The number after the group")
  00 00                                 s16 LE angle, 0x10000 = 360°: 0 (see "The angle after the number")
  00                                    u8: 0 (see "The byte after the angle")
  00                                    bits, not a number: 0 (see "The bits after that byte")
  00 00 00 00 00 00 00 00               on strikes, not decoded: all 0 (see "The bytes after the bits")
  0b                                    on strikes, not decoded: 11 (see "The byte after those eight")
  00                                    on strikes, not decoded: 0 (see "The byte after that")
  00                                    on strikes, not decoded: 0 (see "The byte after that one")
  00                                    on strikes, not decoded: 0 (see "The fourth byte after those eight")
  00                                    on strikes, not decoded: 0 (see "The fifth byte after those eight")
  10                                    on strikes, not decoded: 16 (see "The sixth byte after those eight")
  …
  ```

- **Why the second byte is damage** (kind, damage, then the next two bytes):

  | Move | Kind | Damage | Last two |
  |---|---|---|---|
  | Double Blow, Pit Blow, Big Wheel, Elbow Assault | 4 | 3–5 | |
  | Elbow Slam | 4 | 4 | 1, 14 |
  | Twist Knuckle | 4 | 5 | 0, 6 |
  | Upper Knuckle | 4 | 5 | 1, 12 |
  | Rain Thrust, Stab Armor, Sleeve Strike | 4 | 6 | |
  | HoldAgainstLeg, Mud Spider, Shadow Reaper | 4 | 9 | |
  | Trample Kick | 4 | 10 | 1, 12 |
  | Tornado Kick and most kicks | 4 | 14–15 | |
  | AvalancheLance, KatanaMistSlash, Backfist Willow | 4 | 26–27 | |
  | TwinHandWaves | 4 | 40 | |
  | Swallow Flip (a parry) | 5 | **0** | 0x9C, 4 |
  | Arm Break Fire, Tiger Storm | 5 | 15, 20 | |
  | Vortex Throw | 5 | 30 | 0x42, 3 |
  | Sweep Throw, Shoulder Buster, Tiger Storm lv2 | 5 | 34–35 | |
  | Mist Reaper, Tengu Drop, Demon Drop, Cross Charge | 5 | 40–47 | |

  - The jabs and elbows are the weakest, the kicks do more, and the throws the
    most. Swallow Flip, which only deflects, does 0.
  - The two bytes after damage are one field on throws (see "The last two
    bytes"). On strikes they aren't decoded.
  - The scale isn't known: Shenmue's life bar isn't measured here.
- **The last two bytes:** on a throw (kind 5) they are one u16, little-endian:
  the one-based MOTION.BIN id of the motion the thrown fighter plays (record =
  id − 1, as in the script). On a strike (kind 4) they aren't that, and they
  aren't decoded. Not checked on screen.

  | Move | Bytes | u16 | Record | Its name |
  |---|---|---|---|---|
  | Vortex Throw | 42 03 | 834 | 833 | AI_FT_NG_041_YA |
  | Swallow Flip | 9c 04 | 1180 | 1179 | YKI_AKI_NGR_INASI |
  | Demon Drop | 13 05 | 1299 | 1298 | YKI_AKI_NGR_MAKINAGE |
  | Shoulder Buster | fc 05 | 1532 | 1531 | YKI_AKI_NGR_WUDE1 |
  | Elbow Slam | 01 0e | 3585 | none (1559 records) | |
  | Twist Knuckle | 00 06 | 1536 | 1535 | TMN_BENM2, not a fight motion |

  - **Throws:** all 10 of Ryo's throw motions and Swallow Flip point at a
    motion named for the receiving side: NGR (投げられ, thrown), _YA
    (やられ). Tengu Drop's NGR_BKFRIP, Arm Break Fire's NGR_SP1_ELB, Sweep
    Throw's NGR_UCH and the others match their own throw's name.
  - **All of MOTION.BIN:** 84 of its 86 kind-5 groups point at a receiving
    motion (TUKAMARE grabbed, NAGERARE thrown, YARARE, UKERARE, HAGAI_SIME,
    BA_*_Y_WA beside BA_*_N_WA). The other two are in receiving motions
    themselves (NGR_HED_1_NK, NGR_UCH_FUKU) and are out of range (17295,
    17880).
  - **Strikes:** read the same way, only 20 of 229 kind-4 groups give an id
    at or below 1559. Elbow Slam's is 3585, which no record has, so Elbow Slam
    has no number under this reading. As two bytes, a strike has 0–5 in the
    first (2 on SideReaperKick, KICK_LOW) and 3–80 in the second. That
    doesn't name either byte.
- **The number after the group:** the four bytes after kind, damage and the
  last two are a 16.16 fixed-point number, **big-endian** (unlike the tag-2
  words, which are little-endian; EN_RYOU's 1.8 and 3.0 are big-endian 16.16
  too). Elbow Slam's is **0.7**. What it scales isn't known. Not checked on
  screen.

  | Move | Kind | Damage | Bytes | Number |
  |---|---|---|---|---|
  | Elbow Slam | 4 | 4 | 00 00 b3 33 | 0.7 |
  | Twist Knuckle | 4 | 5 | 00 00 b3 33 | 0.7 |
  | Upper Knuckle | 4 | 5 | 00 00 b3 33 | 0.7 |
  | Vortex Throw | 5 | 30 | 00 01 33 33 | 1.2 |
  | Demon Drop, Sweep Throw | 5 | 45, 35 | 00 01 33 33 | 1.2 |
  | Swallow Flip | 5 | 0 | 00 01 80 00 | 1.5 |

  - **The same reading holds for strikes and throws,** unlike the last two
    bytes. Read little-endian the bytes give nothing round (0x33B30000).
  - **All of MOTION.BIN:** of the 317 kind-4/5 groups, 264 give a multiple of
    0.05 between 0.7 and 1.7: 0.7 (41), 0.8 (1), 0.9 (39), 1.0 (17), 1.05 (3),
    1.1 (49), 1.2 (103, 72 of them throws), 1.5 (9), 1.6 (1), 1.7 (1). 52
    are 0, and one is `ff bf 00 00` (−65). Big-endian, 0x199A, 0x3333, 0xB333
    … are what 0.1, 0.2, 0.7 … round to in 16.16, so the field is a number
    someone typed in tenths.
  - **It isn't the damage:** Elbow Slam (4) and Upper Knuckle (5) both have
    0.7; Swallow Flip (0) has 1.5. Most throws have 1.2.
  - The u16 after it is an angle (see "The angle after the number").
- **The angle after the number:** the next two bytes are one u16,
  **little-endian**, a signed angle with 0x10000 = 360°. Elbow Slam's is
  **0 (0°)**. What it turns isn't known. Not checked on screen.

  | Move | Kind | Bytes | s16 | Degrees |
  |---|---|---|---|---|
  | Elbow Slam | 4 | 00 00 | 0 | 0 |
  | Twist Knuckle | 4 | 00 00 | 0 | 0 |
  | Upper Knuckle | 4 | 00 00 | 0 | 0 |
  | Vortex Throw | 5 | f8 7f | 32760 | 179.96 (180) |
  | Swallow Flip | 5 | f6 9f | −24586 | −135.05 (−135) |

  - **Strikes and throws agree:** the same values turn up on both (0x7FF8 on
    32 strikes and 18 throws, 0x3FFC, 0x9FF6, 0xBFF4 on both).
  - **All of MOTION.BIN:** of the 319 kind-4/5 groups, 199 are 0 (156
    strikes, 43 throws). The other 21 values are all within 0.1° of a whole
    degree (−135 is stored two ways, 0x9FF6 and 0xA00F): 180, 150, 90, 60, 45, 38, 30, 6, −10, −30, −40, −45, −50, −60,
    −65, −80, −90, −120, −135, −142. 0x7FF8, 0x3FFC and 0x1FFE (180, 90, 45)
    halve each other. Read big-endian (0xF87F, 0xF69F …) they give nothing
    round.
  - The byte after it is one u8 (see "The byte after the angle").
- **The byte after the angle:** the next field is **one byte**, not a u16.
  Elbow Slam's is **0**. What it counts or picks isn't known. Not checked on
  screen.

  | Move | Kind | Two bytes after the angle | The byte |
  |---|---|---|---|
  | Elbow Slam | 4 | 00 00 | 0 |
  | Twist Knuckle | 4 | 00 80 | 0 |
  | Rain Thrust | 4 | 00 00 | 0 |
  | Trample Kick | 4 | 04 00 | 4 |
  | Upper Knuckle | 4 | 0b 80 | 11 |
  | Vortex Throw, Swallow Flip, Demon Drop | 5 | 00 00 | 0 |

  - **Why one byte, not two:** the byte after it moves on its own. Across
    the 231 strikes the same first bytes (0, 1, 3, 4, 11, 18, 28, 34) turn
    up with a second byte of 0x00, 0x40 and 0x80 alike. The second bytes are
    all made of the bits 0x80, 0x40, 0x20, 0x10, 0x04, 0x02, 0x01 (0x00 98
    times, 0x80 47, 0x40 34, 0xC0 18, 0x20 11, then 0x10, 0x11, 0x90, 0xC2,
    0x60, 0x42, 0x52, 0x04). Read as one u16 these give 0x8000, 0x4001,
    0x0023 …: not a count, and not the angle again (0x0023 is 0.19°, and the
    angle field's values sit just under a whole degree, these just over).
    That second byte is a set of bits (see "The bits after that byte").
  - **All of MOTION.BIN, strikes:** 20 values, 0 to 35: 0 (35), 1 (34),
    3 (32), 9 (26), 4 (17), 18 (15), 11 (13), 28 (13), 19 (11), 35 (8),
    7 (5), 25 (5), 34 (4), 12 (3), 15, 17, 22, 23 (2 each), 8, 13 (1 each).
  - **Throws:** 0 on all 88, and so is the byte after it. That doesn't
    contradict the reading, but it doesn't test it either: whether a throw
    could use this byte isn't known.
  - **Strikes agree with each other:** Elbow Slam and Twist Knuckle both
    have 0, but with different second bytes (0x00, 0x80), which is what
    splits the field there.
- **The bits after that byte:** the next byte is a set of bits, not one
  number. Elbow Slam's is **0x00**. What the bits mean isn't known, and they
  aren't named here. Not checked on screen.

  | Move | Kind | Byte | |
  |---|---|---|---|
  | Elbow Slam | 4 | 00 | no bits |
  | Rain Thrust | 4 | 00 | no bits |
  | Twist Knuckle | 4 | 80 | 0x80 |
  | Upper Knuckle | 4 | 80 | 0x80 |
  | Trample Kick | 4 | 00 | no bits |
  | Vortex Throw, Swallow Flip, Demon Drop, Sweep Throw | 5 | 00 | |

  - **Why bits:** across the 231 strikes the byte takes 13 values, all made
    of 0x80, 0x40, 0x20, 0x10, 0x04, 0x02, 0x01 (0x08 never): 0x00 (99),
    0x80 (47), 0x40 (32), 0xC0 (19), 0x20 (11), 0x10 (5), 0x11 (5), 0x90 (4),
    0xC2 (3), 0x04, 0x60 (2 each), 0x42, 0x52 (1 each). 0x01 and 0x02 never
    turn up alone, only beside a high bit. 0x80 is on 73 strikes and 0x40 on
    58; both are on 22, about what two independent bits give (18).
  - **Not a number:** it doesn't follow the damage (0x80 is on damage-3
    jabs, 0x40 on damage 6–10, 0xC0 on 5–14). Read as a byte angle (0x100 =
    360°), 0x80, 0x40, 0xC0, 0x20 would be 180°, 90°, −90°, 45°, but 0x11,
    0x42, 0x52, 0xC2 give 24°, 93°, 115°, −87°; the bits cover all 13.
  - **Width:** the byte after it is 0 on every strike, so a u16 LE read gives
    the same values; the byte after that (0 or 1) moves on its own. Read
    big-endian (0x8000, 0x4000 …) it gives nothing more.
  - **Throws split from strikes here:** the byte is 0 on every kind-5 group,
    which doesn't test the reading. After it the two diverge. On a strike
    eight more bytes follow, nearly all 0, before a byte that is 11 on most
    (126 of 231). On a throw the next byte is already 0x0C, 0x08 or 0x0F
    (93 of 104 groups found here), never 0 as on every strike. So the strike
    group runs longer than the throw group. The bytes after this one aren't
    decoded.
- **The bytes after the bits (read on strikes):** not decoded. Elbow Slam and
  Twist Knuckle have the same eight bytes there, all 0, so they can't show
  a field's width or give a number other than 0. The strikes that aren't 0
  there don't line up as one field. Throws aren't read here (their next
  byte is 0x0C, 0x08 or 0x0F; see the bits part).

  | Move | Record | Bits | The 8 bytes after the bits | Next byte |
  |---|---|---|---|---|
  | Elbow Slam | 846 | 00 | 00 00 00 00 00 00 00 00 | 0b |
  | Twist Knuckle | 793 | 80 | 00 00 00 00 00 00 00 00 | 0b |
  | Upper Knuckle, Rain Thrust, Trample Kick | 836, 792, 848 | 80, 00, 00 | 00 00 00 00 00 00 00 00 | 0b |
  | AKI_AKI_HIZA, JEF_TA_SU_UPPER, TAO_PU_09_00 and 7 more | 847, 1102, 510 … | 00, c0, 20 … | 00 01 00 00 00 00 00 00 | 0b (9), 0c (1) |
  | JU_KI_SYO_M | 342 | 40 | 00 00 05 00 00 00 00 00 | 03 |
  | AKI_AKI_OK_AO_KAITEN, _UTU_KAITEN | 1355, 1356 | 04 | 00 00 0c 11 11 00 00 00 | 08, 0c |
  | AKIRA_SY_KI_SYO_L_VF3 | 16 | 00 | 00 00 00 13 17 00 00 00 | 0b |

  - **Across the 231 strikes:** the eight bytes are all 0 on 217. The first
    is 0 on all 231, and so are the sixth to eighth. The second is 1 on 10
    and 0 elsewhere. The third to fifth are not 0 on 4 records only, each a
    different shape (05; 0c 11 11; 13 17).
  - **No one reading fits them:** the second byte is 0 or 1 with the first 0
    beside it (one byte, or a u16 that is 0x0100 little-endian or 1
    big-endian, can't be told apart), and the four odd records put their
    non-zero bytes at different places and widths. With Elbow Slam and Twist
    Knuckle both all 0, the data doesn't say whether this is one field,
    several, or padding.
  - **Where the 14 put their non-zero bytes (bytes 1–8 after the bits):**
    they don't line up as one field of one width.

    | Records | Non-zero bytes | Values |
    |---|---|---|
    | AKI_AKI_HIZA 847, JEF_TA_SU_UPPER 1102, TAO_PU_09_00 510, TAO_PU_10_00 511, TAO_PU_04_S00 506, TAO_PU_05_S00 507, SUI_DFP_122_01 492, SUI_SUFA_191 1137, AK_KATA_ATK 150, DMY_JACKY_TA_KI_HIZA_L 581 | 2 | 01 |
    | JU_KI_SYO_M 342 | 3 | 05 |
    | AKI_AKI_OK_AO_KAITEN 1355, _UTU_KAITEN 1356 | 3, 4, 5 | 0c 11 11 |
    | AKIRA_SY_KI_SYO_L_VF3 16 | 4, 5 | 13 17 |

    - The four shapes start at three different bytes (2, 3, 4) and run one,
      two or three bytes. The 1 in byte 2 and the bytes 3–5 are never on the
      same record, so whether byte 2 goes with them can't be told.
    - The smallest span holding them all is bytes 2–5. As one u32 it gives
      1, 0x500, 0x11110C00, 0x17130000 little-endian, and 0x01000000,
      0x00050000, 0x000C1111, 0x00001317 big-endian: nothing that reads as
      one number across the four. As u16s, at either alignment the KAITEN
      bytes 0c 11 11 split across two of them.
    - So no field and no width is read here. Elbow Slam and Twist Knuckle
      are all 0 there under any reading.
- **The byte after those eight (read on strikes):** not decoded. It isn't
  the same on every strike, and its values don't line up as one number the
  way the 16.16 number and the angle do. Elbow Slam's is **0x0B (11)**, and
  so is Twist Knuckle's. Throws aren't read here. The byte after it isn't
  read either.

  | Move | Record | The byte |
  |---|---|---|
  | Elbow Slam | 846 | 0b (11) |
  | Twist Knuckle | 793 | 0b (11) |
  | Upper Knuckle, Rain Thrust, Trample Kick | 836, 792, 848 | 0b (11) |

  - **Across the 231 strikes:** 10 values.

    | Value | Strikes | Some of them |
    |---|---|---|
    | 0x0B (11) | 126 | AKIRA_KI_01 10, AKIRA_PU_00_VF3 11, AKI_AKI_ELBOW 846 |
    | 0x0C (12) | 36 | AKIRA_PU_SAFE 15, AK_KATA_ATK 150, AK_KOUTEN_KI_00 155 |
    | 0x06 (6) | 23 | AK_KATA_MATA_YA_AN 153, AI_FT_NG_041_YA 833, YKI_AKI_NGR_SEOI 931 |
    | 0x08 (8) | 20 | AK_DW_TA_KI_00 131, AK_SOUKA_HOU 185, AKI_AKI_SY_HARAI 1422 |
    | 0x03 (3) | 10 | JU_KI_SYO_M 342, SUI_JU_KI_00 499, AKI_AKI_KICK_DRAGON 1290 |
    | 0x0E (14) | 5 | AK_SOUSYOU 186, BA_00 253, PAI_LSPIN_KICK 1136 |
    | 0x05 (5) | 5 | AKI_AKI_HAGAI_SARE_KERI 1080, AKI_AKI_UDEKIME_L_KICK_B 1230 … _R 1233 |
    | 0x07 (7) | 3 | AK_RUF_541_02 176, AK_RUF_551_02 177, RUF_551_02 447 |
    | 0x01 (1) | 2 | SUI_DRP_092_00 494, SUI_DRP_132_02 497 |
    | 0x09 (9) | 1 | DEB_HOU_BOMBER 1049 |

  - **Not one number:** the values are few, but the ones that repeat (11,
    12, 6, 8, 3, 14, 5, 7) aren't round or regular the way the 16.16
    values (0.7, 0.9, 1.1, 1.2 …) and the angles (180°, 90°, 45° …) are. So
    no reading is made here.
- **The byte after that (read on strikes):** r[p+21], where p is the
  kind byte (4). Not decoded. It isn't the same on every strike: it is 0 on
  189 of the 231, and 20 other values share the other 42. Elbow Slam's is
  **0**, and so is Twist Knuckle's. Throws aren't read here. The byte after
  it isn't read either.

  | Move | Record | The byte |
  |---|---|---|
  | Elbow Slam | 846 | 00 (0) |
  | Twist Knuckle | 793 | 00 (0) |
  | Upper Knuckle, Rain Thrust, Trample Kick | 836, 792, 848 | 00 (0) |

  - **Across the 231 strikes:** 21 values.

    | Value | Strikes | Some of them |
    |---|---|---|
    | 0x00 (0) | 189 | AKIRA_KI_01 10, AKIRA_PU_00_VF3 11, AKI_AKI_ELBOW 846 |
    | 0x19 (25) | 6 | AKIRA_PU_SAFE 15, AK_RUF_561_02 178, RUF_481_02 441 |
    | 0x16 (22) | 6 | AK_KOUTEN_KI_11 158, AK_OUTEN_KI_01 161, DMY_AKI_AKI_URAKEN_ROLL_TOP 647 |
    | 0x17 (23) | 4 | AK_OUTEN_KI_00_M 160, AK_RUF_521_02 174, AKI_AKI_YAG_SANSEI_MID 1208 |
    | 0x13 (19) | 3 | AK_KOUTEN_KI_01 156, DW_KOUTEN_KI_12 287, AKI_AKI_SY_ABISE_CMB 1345 |
    | 0x1A (26) | 3 | AK_RUF_501_02 170, AK_RUF_511_02 172, AK_RUF_571_02 179 |
    | 0x14 (20) | 3 | BA_00 253, DMY_BA_00 580, AKI_AKI_KICK_HAZ_KESA_TOP 1327 |
    | 0x15 (21) | 2 | AK_KOUTEN_KI_00 155, DW_KOUTEN_KI_10 286 |
    | 0x18 (24) | 2 | AK_OUTEN_KI_01_M 162, AK_OUTEN_KI_02 163 |
    | 0x1B (27) | 2 | AKI_AKI_CHP_MON 715, AKI_AKI_BATTLE_ROLL_KICK_MID 837 |
    | 0x12 (18) | 1 | AK_KATA_ATK 150 |
    | 0x1E (30) | 1 | AK_SOUSYOU 186 |
    | 0x10 (16) | 1 | DW_TA_KI_00 290 |
    | 0x08 (8) | 1 | DEB_HOU_BOMBER 1049 |
    | 0x31 (49) | 1 | AKI_AKI_HKK_SOUTOU_MID 1170 |
    | 0x24 (36) | 1 | AKI_AKI_ROKU_SENHOU_MID 1173 |
    | 0x28 (40) | 1 | AKI_AKI_YAG_ITIMON2_MID 1207 |
    | 0x11 (17) | 1 | AKI_AKI_SY_PNC_AP_CMB 1274 |
    | 0x1C (28) | 1 | AKI_AKI_OK_UTU_KAITEN 1356 |
    | 0x0A (10) | 1 | AKI_AKI_SOUSYOU 1421 |
    | 0x25 (37) | 1 | AKI_AKI_YAG_ITIMON2_MID_S1 1445 |
- **The byte after that one (read on strikes):** r[p+22], where p is the
  kind byte (4). Not decoded. It isn't the same on every strike: it is 0 on
  185 of the 231, and 29 other values share the other 46. Elbow Slam's is
  **0**, and so is Twist Knuckle's. Throws aren't read here. The byte after
  it isn't read either.

  | Move | Record | The byte |
  |---|---|---|
  | Elbow Slam | 846 | 00 (0) |
  | Twist Knuckle | 793 | 00 (0) |
  | Upper Knuckle, Rain Thrust, Trample Kick | 836, 792, 848 | 00 (0) |

  - **Across the 231 strikes:** 30 values.

    | Value | Strikes | Some of them |
    |---|---|---|
    | 0x00 (0) | 185 | AKIRA_KI_01 10, AKIRA_PU_00_VF3 11, AKI_AKI_ELBOW 846 |
    | 0x1E (30) | 4 | DMY_BA_00 580, YKI_AKI_TUKAMI_SEOI_NAGERARE 898, YKI_JIM_TB_NGR_BO 940 |
    | 0xF8 (248) | 3 | AK_RUF_541_02 176, AK_RUF_551_02 177, RUF_551_02 447 |
    | 0x05 (5) | 3 | SUI_JU_PU_S_00 500, AKI_AKI_KICK_DRAGON 1290, AKI_AKI_KICK_HAZ_TOBI_TOP 1328 |
    | 0x21 (33) | 3 | YKI_AKI_NGR_SEOI 931, YKI_AKI_NGR_JUDO_TM 1210, YKI_AKI_NGR_MAKINAGE 1298 |
    | 0x18 (24) | 3 | YKI_AKI_NGR_ROKU_SYAKO 1160, YKI_AKI_NGR_ROKU_JUNPO 1174, YKI_AKI_NGR_ROKU_KAKUDA 1175 |
    | 0x1A (26) | 3 | YKI_AKI_NGR_JUDO_OG 1209, YKI_AKI_NGR_SY_NUKI2 1518, YKI_AKI_NGR_SY_NUKI2_L 1519 |
    | 0x20 (32) | 2 | TA_NG_IP_YA_WA 852, YKI_AKI_NGR_UCH 1480 |
    | 0x07 (7) | 2 | AKI_AKI_KICK_BACKROLL_JUMP 867, AKI_AKI_KICK_BACKROLL_JUMP_S1 1141 |
    | 0x24 (36) | 2 | YKI_AKI_NAGERARE_YOKO1_L 1055, YKI_AKI_NAGERARE_YOKO1_R 1056 |
    | 0x2A (42) | 2 | YKI_AKI_NGR_ROKU_KOKKO 1159, YKI_AKI_NGR_ROKU_TANHE 1161 |
    | 0x29 (41) | 1 | AK_KATA_MATA_YA_AN 153 |
    | 0x19 (25) | 1 | AK_SOUSYOU 186 |
    | 0x28 (40) | 1 | BA_00 253 |
    | 0xF0 (240) | 1 | SUI_DRP_092_00 494 |
    | 0xF3 (243) | 1 | SUI_DRP_132_02 497 |
    | 0x08 (8) | 1 | SUI_JU_KI_00 499 |
    | 0x09 (9) | 1 | AKI_AKI_KICK_BEST_S1 758 |
    | 0x2E (46) | 1 | YKI_AKI_TUKAMARE_BODY3_KICK 826 |
    | 0x1F (31) | 1 | AI_FT_NG_041_YA 833 |
    | 0x1C (28) | 1 | YKI_AKI_NGR_HED_2_S1 922 |
    | 0x01 (1) | 1 | DEB_HOU_BOMBER 1049 |
    | 0x4C (76) | 1 | AKI_AKI_HAGAI_SARE_KERI 1080 |
    | 0xD6 (214) | 1 | AKI_AKI_UDEKIME_L_KICK_B 1230 |
    | 0xD7 (215) | 1 | AKI_AKI_UDEKIME_L_KICK_F 1231 |
    | 0xD8 (216) | 1 | AKI_AKI_UDEKIME_L_KICK_L 1232 |
    | 0xD9 (217) | 1 | AKI_AKI_UDEKIME_L_KICK_R 1233 |
    | 0x17 (23) | 1 | YKI_AKI_UKRARE_L_HIZA 1268 |
    | 0x04 (4) | 1 | AKI_KIS_KICK_NIKI 1336 |
    | 0x14 (20) | 1 | AKI_AKI_SOUSYOU 1421 |
- **The fourth byte after those eight (read on strikes):** r[p+23], where
  p is the kind byte (4). Not decoded. It isn't the same on every strike:
  it is 0 on 221 of the 231, and 3 other values share the other 10. Elbow
  Slam's is **0**, and so is Twist Knuckle's. Throws aren't read here. The
  byte after it isn't read either.

  | Move | Record | The byte |
  |---|---|---|
  | Elbow Slam | 846 | 00 (0) |
  | Twist Knuckle | 793 | 00 (0) |
  | Upper Knuckle, Rain Thrust, Trample Kick | 836, 792, 848 | 00 (0) |

  - **Across the 231 strikes:** 4 values.

    | Value | Strikes | Records |
    |---|---|---|
    | 0x00 (0) | 221 | AKIRA_KI_00_13 9, AKIRA_KI_01 10, AKI_AKI_ELBOW 846, … |
    | 0x04 (4) | 5 | AKI_AKI_HAGAI_SARE_KERI 1080, AKI_AKI_UDEKIME_L_KICK_B 1230, AKI_AKI_UDEKIME_L_KICK_F 1231, AKI_AKI_UDEKIME_L_KICK_L 1232, AKI_AKI_UDEKIME_L_KICK_R 1233 |
    | 0x7F (127) | 3 | AK_RUF_541_02 176, AK_RUF_551_02 177, RUF_551_02 447 |
    | 0x01 (1) | 2 | SUI_DRP_092_00 494, SUI_DRP_132_02 497 |
- **The fifth byte after those eight (read on strikes):** r[p+24], where
  p is the kind byte (4). Not decoded. It isn't the same on every strike:
  it takes 24 values across the 231. Elbow Slam's is **0** and Twist
  Knuckle's is **1**. Throws aren't read here. The byte after it isn't read
  either.

  | Move | Record | The byte |
  |---|---|---|
  | Elbow Slam | 846 | 00 (0) |
  | Twist Knuckle | 793 | 01 (1) |
  | Upper Knuckle | 836 | 01 (1) |
  | Rain Thrust, Trample Kick | 792, 848 | 00 (0) |

  - **Across the 231 strikes:** 24 values.

    | Value | Strikes | Records |
    |---|---|---|
    | 0x01 (1) | 75 | AKIRA_KI_01 10, AKIRA_PU_00_VF3 11, AKIRA_PU_01_VF3 12, AKI_AKI_BATTLE_PNC_FUK 793, … |
    | 0x00 (0) | 74 | AKIRA_KI_00_13 9, AKIRA_SY_KI_SYO_L_VF3 16, AKIRA_TA_KI_LOW_VF3 19, AKI_AKI_ELBOW 846, … |
    | 0x08 (8) | 31 | AKIRA_PU_SAFE 15, AK_KATA_ATK 150, AK_KOUTEN_KI_00 155, … |
    | 0xF8 (248) | 16 | AK_KATA_MATA_YA_AN 153, AI_FT_NG_041_YA 833, YKI_AKI_NGR_HED_2_S1 922, … |
    | 0x0A (10) | 6 | RUF_521_02 445, RUF_531_02 446, AKI_AKI_KICK_BACKROLL_JUMP_S1 1141, AKI_AKI_KICK_DRAGON 1290, AKI_AKI_KICK_HAZ_KESA_TOP 1327, AKI_KIS_KICK_NIKI 1336 |
    | 0x0B (11) | 5 | SUI_DRP_092_00 494, SUI_DRP_132_02 497, AKI_AKI_CHP_MON 715, AKI_AKI_BATTLE_ROLL_KICK_MID 837, AKI_AKI_KICK_HAZ_TOBI_TOP 1328 |
    | 0x0E (14) | 3 | JU_KI_SYO_M 342, PRI_DFK_023 382, DMY_JU_KI_SYO_M 583 |
    | 0x0C (12) | 2 | AK_RUF_541_02 176, RUF_551_02 447 |
    | 0x07 (7) | 2 | TA_KI_HIZA_L 523, AKI_AKI_OK_UTU_KAITEN 1356 |
    | 0x1B (27) | 2 | DMY_DMY_AKI_AKI_URAKEN_ROLL_TOP 566, DMY_AKI_AKI_URAKEN_ROLL_TOP 647 |
    | 0xF4 (244) | 2 | YKI_AKI_NGR_ROKU_TANHE 1161, YKI_AKI_UKRARE_L_HIZA 1268 |
    | 0x06 (6) | 1 | AK_DW_TA_KI_00 131 |
    | 0x02 (2) | 1 | SUI_DRP_092_01 495 |
    | 0x14 (20) | 1 | SUI_JU_KI_00 499 |
    | 0x17 (23) | 1 | SUI_JU_PU_S_00 500 |
    | 0x04 (4) | 1 | SUI_KI_00 501 |
    | 0x05 (5) | 1 | TA_KI_SYO_LL 525 |
    | 0x0D (13) | 1 | AKI_AKI_KICK_BEST_S1 758 |
    | 0x9C (156) | 1 | YKI_AKI_TUKAMARE_BODY3_KICK 826 |
    | 0xF6 (246) | 1 | TA_NG_IP_YA_WA 852 |
    | 0x0F (15) | 1 | AKI_AKI_KICK_BACKROLL_JUMP 867 |
    | 0xFF (255) | 1 | DEB_HOU_BOMBER 1049 |
    | 0xFC (252) | 1 | YKI_AKI_NGR_ROKU_SYAKO 1160 |
    | 0xFE (254) | 1 | YKI_AKI_NGR_JUDO_OG 1209 |
- **The sixth byte after those eight (read on strikes):** r[p+25], where
  p is the kind byte (4). Not decoded. It isn't the same on every strike:
  it takes 20 values across the 231. Elbow Slam's is **16** (0x10) and
  Twist Knuckle's is **5**. Throws aren't read here. The byte after it isn't
  read either.

  | Move | Record | The byte |
  |---|---|---|
  | Elbow Slam | 846 | 10 (16) |
  | Twist Knuckle | 793 | 05 (5) |
  | Upper Knuckle, Rain Thrust | 836, 792 | 05 (5) |
  | Trample Kick | 848 | 40 (64) |

  - **Across the 231 strikes:** 20 values.

    | Value | Strikes | Records |
    |---|---|---|
    | 0x00 (0) | 85 | AKIRA_PU_SAFE 15, AK_DW_TA_KI_00 131, AK_KATA_ATK 150, … |
    | 0x05 (5) | 46 | AKIRA_PU_00_VF3 11, AKIRA_PU_01_VF3 12, AKIRA_TA_PU_MOUKO 20, AKI_AKI_BATTLE_PNC_FUK 793, … |
    | 0x22 (34) | 21 | AKIRA_KI_00_13 9, AKIRA_KI_01 10, AKI_AKI_KICK_KKT_S1_2 114, … |
    | 0x10 (16) | 18 | ST_PU_05 478, ST_PU_05_M 480, ST_PU_05_M_VF3 482, AKI_AKI_ELBOW 846, … |
    | 0x7F (127) | 16 | AK_KATA_MATA_YA_AN 153, AI_FT_NG_041_YA 833, YKI_AKI_NGR_HED_2_S1 922, … |
    | 0x40 (64) | 11 | AKIRA_TA_KI_LOW_VF3 19, SUI_DRK_012_01 493, TA_KI_LOW_03 589, … |
    | 0x01 (1) | 9 | SUI_DRP_132_03 498, DMY_BA_00 580, AKI_AKI_BATTLE_SEIKEN_MID 794, … |
    | 0x80 (128) | 7 | AKIRA_SY_KI_SYO_L_VF3 16, AKI_AKI_BATTLE_KICK_LOW 787, AKI_AKI_KICK_SUBERI_S1 1148, … |
    | 0x42 (66) | 3 | AKI_AKI_BATTLE_KICK_SID 788, YKI_AKI_RUN_KICK 901, AKI_AKI_KICK_KKT_S1 1438 |
    | 0x82 (130) | 3 | AKI_AKI_KICK_ZEN 1105, AKI_AKI_KICK_ZEN_S1 1106, AKI_AKI_SY_B_KICK_SURI 1478 |
    | 0x11 (17) | 2 | AKI_AKI_ELB_Y_ROLL_TOP 618, AKI_AKI_ELB_ROLL_TOP 1289 |
    | 0xBF (191) | 2 | YKI_AKI_NGR_ROKU_TANHE 1161, YKI_AKI_UKRARE_L_HIZA 1268 |
    | 0x17 (23) | 1 | AK_RUF_541_02 176 |
    | 0x18 (24) | 1 | RUF_551_02 447 |
    | 0xEA (234) | 1 | YKI_AKI_TUKAMARE_BODY3_KICK 826 |
    | 0x9F (159) | 1 | TA_NG_IP_YA_WA 852 |
    | 0xFF (255) | 1 | DEB_HOU_BOMBER 1049 |
    | 0x02 (2) | 1 | PAI_LSPIN_KICK 1136 |
    | 0x3F (63) | 1 | YKI_AKI_NGR_ROKU_SYAKO 1160 |
    | 0xD5 (213) | 1 | YKI_AKI_NGR_JUDO_OG 1209 |
- **Counting kind-5 groups (86, 88, 104):** the three counts are the same
  layout (header, one tag-2 block, kind 5) with different checks on the
  tag-2 words. The scans didn't walk off the hit block.
  - **104:** every kind-5 group, words not checked (the bits part above).
  - **88:** words strictly rising, word 1 < word 2 < word 3 (the angle and
    the byte after it).
  - **86:** that, and word 3 ≤ the motion's frames + 2 (the throw's motion
    id). It drops AKI_AKI_BATTLE_TUKAMI_ALL (1, 30, 84; 80 frames) and
    AKI_AKI_NGS_B_HIKI (1, 35, 57; 48 frames).
  - **The 16 in 104 but not 88** all have word 2 = word 3 (1, 18, 18 …),
    damage 0 (14) or 1 (2). None is a throw move: they are receiving,
    escape, grab and hold motions (AK_FB_CHG_YA_SK, AK_UKASHI_YA_ESCP,
    BA_02_SK_Y, TOMOE_01_SK_Y, AKI_AKI_TUKAMI_BODY2,
    YKI_AKI_BATTLE_TUKAMARE_MISS, AI_FT_NGSK_041_YA, YKI_AKI_HAGAI_SIME and
    _LP, AKI_AKI_UDEKIME_L_LP …). 10 of them give a u16 after damage past the
    1559 records. So 104 isn't a count of throw groups. 88 and 86 are
    throw-group counts with the stricter checks. The bits byte is 0 on all
    104, including these 16.
  - The strikes' 231 (the bits part, and "The byte after the angle") is
    likewise unchecked: 226 have rising words and 224 also pass the frames
    check.
- **Frames (the tag-2 words): not settled.** The three words don't line up
  across Elbow Slam, Twist Knuckle and Vortex Throw, so none of them is named
  here. What the records show (frames = the motion's own count):

  | Move | Record | Words | Frames |
  |---|---|---|---|
  | Elbow Slam | 846 | 8, 12, 27 | 27 |
  | Twist Knuckle | 793 | 6, 8, 21 | 24 |
  | Vortex Throw | 1204 | 9, 27, 55 | 57 |
  | Upper Knuckle, Trample Kick, Rain Thrust | 836, 848, 792 | 10, 13, 27; 6, 8, 24; 6, 8, 20 | 28, 27, 21 |
  | Swallow Flip, Sweep Throw, Demon Drop | 1177, 1475, 1291 | 1, 12, 36; 1, 24, 53; 1, 53, 60 | 36, 56, 60 |

  - **What holds for every one:** word 1 < word 2 < word 3 ≤ the motion's
    frames. So they are frame numbers in the motion, in order.
  - **Word 3 isn't the motion's length:** it is for Elbow Slam (27 of 27),
    but Twist Knuckle's is 3 short (21 of 24) and Vortex Throw's 2 (55 of 57).
  - **Words 1–2 as the active frames fit the strikes only:** 8–12 and 6–8 are
    short windows early in the move. Vortex Throw's 9–27 is 19 frames, and the
    other paired motions start at 1 (Demon Drop 1–53). A throw's motion plays
    once the grab has connected, so a strike-style active window may not apply
    to it, or the words mean something else there.
  - **The motion curves don't decide it:** sampling the bones' angles frame by
    frame (shenmue-motion.mjs's keys, read as Hermite curves) is too noisy to
    put the elbow's or the fist's impact on one frame.
  - Tornado Kick's record adds a tag-3 block (7, 12, 20) before its tag-2 one
    (15, 19, 35), and Dark Moon's one (9, 12, 17).

## Open

- **Damage on screen:** Elbow Slam should take 4 off in Free Battle, Vortex Throw
  30. Neither is checked.
- **Frame data:** what the tag-2 words are (see "Damage", Frames): they don't
  line up across the strikes and the throws. The last two bytes of the
  kind/damage group are named on throws only. The 16.16 number after the
  group is read (0.7 on Elbow Slam) but not named, and so are the angle after
  it (0° on Elbow Slam), the byte after that (0 on Elbow Slam, 0 on every
  throw) and the set of bits after that (none on Elbow Slam, 0x80 on Twist
  Knuckle, none on every throw). After those bits strikes have eight bytes,
  all 0 on Elbow Slam and Twist Knuckle and on 217 of 231 strikes; their
  width isn't settled (see "The bytes after the bits"). The byte after them
  is 11 on Elbow Slam and Twist Knuckle and takes 10 values across the
  strikes; it isn't read as one number (see "The byte after those eight").
  The byte after that is 0 on Elbow Slam and Twist Knuckle and on 189 of
  the strikes, and takes 21 values in all; it isn't decoded (see "The byte
  after that"). The byte after that one is 0 on Elbow Slam and Twist
  Knuckle and on 185 of the strikes, and takes 30 values in all; it isn't
  decoded (see "The byte after that one"). The fourth byte after those
  eight is 0 on Elbow Slam and Twist Knuckle and on 221 of the strikes, and
  takes 4 values in all; it isn't decoded (see "The fourth byte after those
  eight").
  The fifth byte after those eight is 0 on Elbow Slam and 1 on Twist
  Knuckle, and takes 24 values across the strikes; it isn't decoded (see
  "The fifth byte after those eight").
  The sixth byte after those eight is 16 on Elbow Slam and 5 on Twist
  Knuckle, and takes 20 values across the strikes; it isn't decoded (see
  "The sixth byte after those eight").
  The record's other fields aren't decoded.

## Other leads

- **Debug moves (P):** a debug table of scripted moves at 0x0C482CD8 has 16-byte
  records: a name, a type, a script pointer and a flag. Entries 60–76 are named:
  TYU KEN, ENSEN HAIRYU_A–D, TORNADO KICK_A–C, KASANE ATE, ENSEN KOSYU_A/B,
  KAGEMI_A/B.
- **Their scripts:** they use a different VM of little-endian u32 pairs (op 8
  wait, 7 buttons, 3/5 an id, 6 end). They are input sequences for the demo,
  not motions.
