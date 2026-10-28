# m2-megamix

This is a small Fighters Megamix built from three Model 2 games. Virtua
Fighter 2, Fighting Vipers and Sonic the Fighters all run AM2's fighting
engine. This project plays their fighters against each other, on any of
their stages, in one engine:

- VF2: Akira, Sarah, Kage
- Fighting Vipers: Picky, Honey, Mahler, Tokio, Bahn
- Sonic the Fighters: Sonic, Honey, Eggman
- Shenmue (the beta's disc, if you have it): Ryo, see `docs/RYO.md`, and
  Chai, the final boss, see `docs/CHAI.md`

It runs in the browser. Everything you see is read from the original ROM
sets when the page loads: models, motions, move lists, damage, textures,
colour tables and stages. The readers are noclip's, in `vendor/noclip`
(a submodule). Nothing is drawn that the ROMs do not hold. The menu and
HUD are plain text, in the style of a debug menu.

## On the board

`board/` is the same game growing as a new program for the Sonic the Fighters
board (Model 2B), built on m2-sdk, on data ROMs that hold only the assets it
uses (`tools/import-assets.mjs`). It boots into a game setup in the style of
StF's debug menu (time, rounds, stage, both fighters, energy, barriers;
up/down to pick, kick/punch to change, start to fight). Two cabinets can
play one fight over the Model 2 communication board (`tools/mame/link-cabinets.sh`).
A fighter's moves can be written out as text, edited and imported again
(`tools/moves-text.mjs`, `board/moves/`). Its source is `board/src`, one module a file.
See `docs/BOARD.md`.

## Running

```
git submodule update --init
python3 tools/serve.py          # prints http://127.0.0.1:<port>/
```

`tools/serve.py` serves `/roms/vf2.zip`, `/roms/fvipers.zip` and
`/roms/sfight.zip` from `$ROMS_DIR` (default `~/build/mameroms`). It reads
them in place. You can also drop the three zips on the page instead.
With the Shenmue beta's disc (0.400 disc 3, `$SHENMUE_DIR`) it also serves
Ryo's and Chai's files off it at `/shenmue/<path>`, and they join the roster
(`?p1=11`, `?p1=12`).

URL options: `?p1=0&p2=6&stage=3&p1cpu=1&p2cpu=1&rounds=2&start&dump`.

## Controls

| | P1 | P2 |
|--|--|--|
| move | WASD | arrows |
| punch / kick / guard | J K L | 1 2 3 (or , . /) |

Each move is the command its own game gives it: a fighter's command table is
read and matched live, with follow-up strings. Double-tap to dash, and
throws are their game's throw commands (mostly P+G), up close. Esc returns to the menu. F1 toggles the
struct dump, F2 pauses and F3 steps one frame.

## How it fits together

- `js/games.js` loads the three sets and holds the roster and the stage lists.
- `js/fighters.js` adapts each game to one fighter interface: actions,
  commands, setup records (timing, strike, throw), reactions and a body that
  poses any game's motion.
- `js/engine.js` is the fight. It knows nothing about three.js, and runs in
  Node for the tests.
- `js/render.js` draws the stage and fighters with noclip's shader. Each one
  gets its own game's texture RAM and colour tables.
- `docs/STRUCTURES.md` lists the shared structures and where each game keeps them.
- `docs/DEBUG-MODE.md` reads the three games' debug mode: how to turn it on, and every field its menus name, by offset in each game.
- `docs/FV-GUESTS.md` measures what Fighting Vipers' Honey, Tokio and Bahn need as board guests, and what room is left in StF's ROMs and at Model 2B's sizes (`tools/fv-guest-survey.mjs`, `tools/model2-rom-limits.py`).
- `docs/FV-MAHLER.md` does the same for Mahler: one record for both players, his shoulder pads and sway chain, the 171 motions he shares with B.M. (`tools/fv-guest-survey.mjs --char 8`), and the cage break that stays broken. On the board he is guest 18 (`tools/mahler-guest.mjs`, his moves by `tools/fv-moves.mjs`; docs/BOARD.md).
- `tools/model-obj.mjs` exports a fighter's models as OBJ and MTL (with its tiles as PNGs) for a 3D program, and reads them back; `tools/import-assets.mjs --obj mahler=<dir>` builds the board's Mahler from the edited folder (docs/BOARD.md, Mahler from an OBJ).
- `docs/SHADOWS.md` is how each game casts the fighters' shadows, StF's way as the parent; `tools/shadow-data.mjs` reads every fighter's table in StF's form.
- `docs/SHARED-CODE.md` audits the i960 functions StF and VF2 share: which are one code, and what a VF2 fighter still needs (guest data or a branch on `char_game`); `tools/shared-fns.py` compares them.
- `docs/FM-SATURN.md` covers Fighters Megamix's (Saturn) fighter data and motions; `tools/fm-saturn.mjs` reads them off the disc and converts them to VF2 motion blocks (Hornet's to start with); `tools/daytona-hornet.mjs` finds Daytona USA's Hornet in the Model 2 set and cuts it where FM cuts its Hornet.
- `docs/PROJECTILES.md` traces StF's projectiles (Eggman's bomb): how one is thrown, hits and is guarded, and what the board needs to run it; `tools/stf-projectiles.mjs` lists every motion that throws one.
- `docs/SHENMUE-SOUND.md` reads Shenmue's fight sounds off the beta's discs: the battle packs (DTPK), the strike sounds' scale by damage, and the lines Ryo and Chai say to each other, for the board to use; `tools/shenmue-sound.py` decodes them to WAVs.

## Not the board's own code

The engine is written from what the three games share, so some parts are
approximations. Each is marked `Here:` in `js/engine.js`:

- Strikes hit with the part their setup record names (op 4's attack part,
  the slot masks at StF 0xCE020, VF2 0x02007ACA, FV 0x0640E72E), each slot
  as a limb, against a capsule from the floor to the head; the board's own
  hit volumes are the coprocessor's.
- The level is op 4's byte 2 in all three games. Guarding is judged on the
  coprocessor, so here the levels beyond high, mid and low guard as a mid
  (FV's slide as a low).
- Counters: a strike on a fighter whose own strike has not reached its
  cancel counts, as attack_hit does (StF 0x2B1A4, FV 0x2633C, VF2 0x22A28):
  mot_kind's mk_attack, which every strike carries and play_motion clears
  at follow1, +0x80A (StF 0x1BEA0, FV 0x1C1D8, VF2 0x1AC50). VF2 and FV deal
  half again; StF half again of the damage plus a quarter of the countered
  move's. Here: StF's smaller counter on a limb (smlcntr, by the part the
  coprocessor says was struck) is not told apart, so every StF counter is
  the full one, and a throw is never countered.
- In the air: a blow on a fighter whose mot_kind has mk_air and not mk_down
  deals half again in StF and FV (attack_hit's "air", StF 0x2B298, FV
  0x26380), after a counter. mot_kind is the motion's own kind, and the
  jump handler adds mk_air at take-off (fix_hara: StF 0x140CC, FV 0x14508)
  till the next motion. Here: VF2's (0x22B6C) gives way on a combo's first
  hit to a quarter more that needs the struck part, so VF2's is not read;
  play ops that change mot_kind mid-motion are not followed.
- Going down: StF takes a quarter off a blow on a fighter whose mot_kind
  has mk_down and not mk_down_pose (attack_hit's "down", 0x2B238): a fall
  before its play op 5 makes it lie (Sonic's at frame 64). The mot_kind is
  followed frame by frame: set_mot_dat's load, play_motion's clears at the
  hit frame and follow1 (0x1BE78, 0x1BEA0), play ops 5 to 7. FV and VF2
  have no such step.
- Down attacks (level 4, and StF's 8 at half damage) land on a fighter lying
  down. Their entries want en_flag's en_down_attack (+0x5B8 bit 5; bit 11
  in VF2), which get_en_info sets from the other's mot_kind as the board
  does (StF 0x193DC, FV 0x19810, VF2 0x188AC): on mk_down, so on a
  knock-down's fall as well as the lying, but not while it rises or attacks,
  nor over a fall while this fighter is in the air. Here: the hit itself
  still lands only on a fighter lying down, and there is no ukemi
  (mot_kind2 bit 2).
- Jump attacks: up let go before take-off (setup op 3's motd_jump_coma)
  makes the jump the small one, as the board does. A press before take-off
  waits for it and goes to context 1 (2 in a small jump), one in the air to
  3 (4). StF's jump motions stand in place and its jump handler (0x13DB8)
  flies the body by gravity, so the engine does too: from take-off for the
  frames the character record's +0x20 gives (Sonic 38, small 26), with an
  air attack playing on until it lands. FV's jump code is StF's, but its
  motions carry the arc, as VF2's do, and the engine plays them so. An air
  attack whose command has bit 19 is held back, in all three games: it
  waits in the jump until the frames left in the air (+0x5BC) are down to
  its motion's hold (setup op 3, +0x5C0), as the jump handler plays it
  (StF 0x1410C, FV 0x14548, VF2 0x155CC). Sonic's small-jump kick comes out
  with 4 of 26 frames left, Picky's with 9 of 24, Akira's punch with 19 of
  32. Here: StF's jump does not drift forward or back, the frames left
  count down from take-off (the board works them out from the body's height
  each frame), landing does not free the fighter before the motion ends,
  and a press made before take-off plays one frame before take-off, where
  the board plays it at take-off.
- Attacks while getting up: in VF2 a kick while lying picks the rise's
  get-up kick (the decoder's sub-kind at 0x1BD38): mid, or low with down
  held, played as soon as the lying is out (the rise handler at 0x157DC).
  The engine plays only the face-up variants. FV and StF have no get-up
  attacks of their own: P or K held in the rise motion's last frames (setup
  op 23's window before op 2's cancel) ends the rise, and the press is the
  ground table's (StF 0x1D864, FV 0x1D634).
- Throws deal op 5's damage, then the victim motion's own hits (play op 8)
  at their frames; many throws deal none.
- Knock-downs: attack_hit (StF 0x2B41C, FV 0x26508, VF2 0x22C84) knocks
  down a fighter going down, lying or in the air (VF2 also on its hands),
  on a strike whose word (+0x828) has bit 14 (of the command lists'
  strikes, StF 68 of 101, FV 134 of 232, VF2 23 of 107), and, unless the
  word has bit 10, on 50 damage or more (VF2 30; StF out of its 140), on
  ap 1 against mk_gacha, and in VF2 on bit 8 against one not crouching;
  and on the blow that ends it. Here: ukemi, StF's ketchup in that last
  test, and the attacker's mk_ride_on (a down hit instead) are not
  followed; Shenmue's blows knock down at 40.
- The hit combo: attack_hit counts it on the fighter hit (StF 0x2B018, FV
  0x26254, VF2 0x22918), and action_after (StF 0x18400, FV 0x18B58, VF2
  0x18128) ends it on the first frame its mot_kind has no bit 0 (strikes,
  reactions, falls, lying and the rise have it; stance, walk, guard and
  jump do not) and +0 bit 4 is clear (the guard, yarare, ukemi and down
  handlers' stun); StF and FV also not in ukemi. Here: the stun is the
  reaction playing out, not +0x5DE's count; Shenmue's ends once free.
- Not read from the games yet, the engine's own: attack_hit's other changes
  to the damage (StF from 0x2B0F8: tender, multi, ukemi; FV and VF2
  have most of them, and VF2 its air), a guard turned away failing, the
  throw's reach (1.5 bodies), a strike's active frames (hit to the later
  of cancel and hit + 2) and the 50 frames lying before the rise.
- The CPU player is a simple one.
- Rounds last 40 s and need 2 wins (1–3 in the menu).
- FV's cage breaks on a finishing KO and stays broken for the match; a
  fighter past a broken side is out (docs/FV-MAHLER.md, Breaking the cage).
  VF2's, StF's and Shenmue's fighters break it with KO blows of 30 damage
  or more, since their motions have no finish kinds.

## Tests

```
node tests/fighters.test.mjs    # every fighter poses, moves and reacts, across games
node tests/bout.test.mjs        # CPU vs CPU, every pairing (121, 169 with Ryo and Chai)
node tests/cage.test.mjs        # FV's cage: Mahler breaks it, others break it on him, ring out through it
node tests/model-obj.test.mjs   # Akira, Mahler and Sonic out to OBJ/MTL and back, face for face
```

Both read the zips from `$ROMS_DIR`, and Ryo and Chai from `$SHENMUE_DIR` when it is there.
