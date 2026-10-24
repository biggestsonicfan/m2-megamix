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
- Still not found: damage and frame data (see "Open").

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

## Open

- **Damage and frames:** these are probably in the file's two tables after the
  script (0x1BBC and 0x1D8A in Ryo's), or in the motion table's second offset
  per motion, which #1505 hasn't decoded.

## Other leads

- **Debug moves (P):** a debug table of scripted moves at 0x0C482CD8 has 16-byte
  records: a name, a type, a script pointer and a flag. Entries 60–76 are named:
  TYU KEN, ENSEN HAIRYU_A–D, TORNADO KICK_A–C, KASANE ATE, ENSEN KOSYU_A/B,
  KAGEMI_A/B.
- **Their scripts:** they use a different VM of little-endian u32 pairs (op 8
  wait, 7 buttons, 3/5 an id, 6 end). They are input sequences for the demo,
  not motions.
