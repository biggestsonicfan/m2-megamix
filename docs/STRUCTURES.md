# The structures the three games share

Virtua Fighter 2, Fighting Vipers and Sonic the Fighters run the same AM2
fighting engine on Model 2. All the data this game reads comes out of the
ROMs, through the readers in noclip (`vendor/noclip/js`), and the tables
below are where those readers find it. Addresses are i960 addresses
(program ROM, or `0x02xxxxxx` and `0x06xxxxxx` data ROM windows). The code that
reads them is named next to each one.

## The rig: 16 slots

All three games pose a fighter as 16 slots with the same parents
(`SLOT_PARENT` in noclip's `rig.js`):

| slot | part   | parent |  | slot | part    | parent |
|-----:|--------|-------:|--|-----:|---------|-------:|
| 0  | body   | –  |  | 8  | r hand  | 7  |
| 1  | chest  | 0  |  | 9  | pelvis  | 0  |
| 2  | head   | 1  |  | 10–11 | l leg | 9, 10 |
| 3–4 | l arm | 1, 3 |  | 12 | l foot  | 11 |
| 5  | l hand | 4  |  | 13–14 | r leg | 9, 13 |
| 6–7 | r arm | 1, 6 |  | 15 | r foot  | 14 |

A motion is a list of per-slot keyed targets. Its first three floats are the
root, which `js/fighters.js` `rootAt` turns into the viewer's frame as
`[t2, t1, t0]` (the motion's +z is forward). A motion never refers to the
body it is played on, so any game's motion poses any game's fighter. That is
how a throw from one game lands on a fighter from another.

## Per-game tables

| | VF2 | FV | StF |
|--|--|--|--|
| action table (stance, walk, guard…) | fighter record | fighter record | character record |
| command (move matcher) table | `0x1d1fc` | `0x1ebe0` | per character |
| motion setup records | `0x0200d34c`, head 8 | `0x06411e94`, head 12 | `0xce380`, head 13 |
| setup op lengths | `0x1b7f6` | `0x1ce86` | handler table (`STF_LENGTHS`) |
| reaction table / kinds | `0x0201ccfc` / 30 | `0x0641f834` / 22 | common motions 177, 182, 221, 225 |
| energy (`energy_max`, 0x5000A0 in all three) | 200 | 200 | 140 |

The action slots the engine plays are in `js/fighters.js` `ACTION_SLOTS`.
Each game orders its action table its own way, but every slot is there.

## The motion setup record

Each motion has a setup record. It starts with a header and then runs a
list of ops, which ends at op 0 or op 8. The three games share the op
numbers:

| op | what | VF2 / FV | StF |
|---:|------|----------|-----|
| 2 | timing | hit / cancel / end frames | same |
| 4 | strike | byte +2 level (0 high, 1 mid, 2 low; FV 4–5 low), +3 damage | +3 damage out of 140 |
| 5 | throw | the reaction table's victim motion, damage fixed here at 50 | u16 +1 victim motion, +3 damage |

## The player struct

`js/engine.js` `makePlayer` keeps the fields a fighter's work area holds.
The board's C code reaches StF's rob and the fight's globals through
`board/src/fight/rob.h`, which names them the same way.
The names are the ones each game's debug menu prints beside the field
(ROBn_INFO, read in `docs/DEBUG-MODE.md`, which lists all of them). The
main ones, most of which the F1 dump shows:

| field | VF2 | FV | StF | |
|--|--|--|--|--|
| `flag` | +0x000 | +0x000 | +0x000 | u32 bits (mot_end, lost, mirror, land...), not a state |
| `xpos` / `zpos` | +0x018 / +0x020 | same | same | f32; `ypos` +0x01C |
| `yang` | +0x026 | +0x026 | +0x026 | u16 facing |
| `command` | +0x194 | +0x194 | +0x194 | the matched command |
| `action` | +0x19C | +0x19C | +0x19C | u32. Its top byte +0x19F is the state (`ST`: 0 motion, 1 kamae, 2 syagami, 3 walk, 4 bwalk, 5 fumikomi, 6 jump, 8 down, 9 rise, 10 guard, 11 yarare, 12 nage, 13 nagerare) |
| `mot_kind` | +0x1A4 | +0x1A4 | +0x1A4 | u32 bits (mk_attack, mk_guard, mk_down...) |
| `mot_num` / `mot_coma` | +0x1A8 / +0x1AA | same | same | motion / frame |
| `energy` | +0x1AC | +0x1AC | +0x1AC | |
| `fighter` | +0x1B0 | +0x1B0 | +0x1B0 | the character |
| `hit_combo` | +0x6D8 | +0x708 | +0x6F4 | u8, counted on the fighter hit; +1 is the down hit combo |
| `motd_kind` | +0x804 | +0x804 | +0x804 | the setup record's kind, the `mot_kind` bits |
| `motd_main` / `follow1` / `follow2` | +0x808 / +0x80A / +0x80C | same | same | hit / cancel / end frames |
| `motd_damage` | +0x822 | +0x822 | +0x822 | u8 |
| `pad` | +0x1200 | +0x1200 | +0x1200 | the input ring follows (`write_pnt` +0x1202) |
| `pc_command` | +0x1218 | +0x1218 | +0x1218 | the follow (command) table |

It is one struct in the three games. Every field up to +0x62A and from +0x800
on is at the same offset in all three. The fields between move: that is
where the hit combo sits.

Every task block (rob, camera, projectile, HUD) starts with the same head:
`flag` (bit 31 alive), `idnm`, `size` and `fn` (`TASK_` in `rob.h`).
`fa_rob0` / `fa_rob1` (0x500804 / 0x500808) point to the two fighters, and
`fa_camera` (0x500814) to the camera, in all three games; `rob.h` names the
other `fa_` pointers StF uses.

## The fight globals

These are at the same addresses in the three games (`G_` in `rob.h`):

| address | name | |
|--|--|--|
| 0x500028 | `G_GAME_TIMER` | u16: `time` × 64 at the round's start, one off each frame |
| 0x50002A / 0x500030 | `G_MODE` / `G_SUB_MODE` | |
| 0x50004F / 0x500051 | `G_ROUND_WINS0` / `1` | |
| 0x500052 | `G_WINS_NEEDED` | |
| 0x500055 | | current round |
| 0x500064 | `G_STAGE` | |
| 0x50008F / 0x500090 | `G_TIME` (0x500090) | the rounds and time settings |
| 0x5000A0 | `G_ENERGY_MAX` | |

The tuning block at 0x50A000 (throw timer, rise time, combo limits, stage
bounds) is the same in VF2 and FV; StF moves the part from 0x50A148 on by
0x68. `docs/DEBUG-MODE.md` has it.

## Stages

| | reader | draw list |
|--|--|--|
| VF2 | `readVf2Stages` (vf2.js) | `buildPlacementDisplayList` (placements.js) |
| FV | `readStageTable` (stages.js) | `buildFlatDisplayList` (display.js) |
| StF | `readStageTable` | `buildStageDisplayList`. The ops carry a 1.6 scale the fighters do not have, so the stage is drawn at 1/1.6 |

A stage record carries its texture sets, its colour block, a tint, a light
vector and the 32 material slots. `js/render.js` draws each stage and each
fighter with its own game's texture RAM and colour tables.
