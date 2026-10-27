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
- Down attacks (level 4, and StF's 8 at half damage) land on a fighter lying
  down. Their entries want en_flag's en_down_attack (+0x5B8 bit 5), which
  StF's get_en_info sets while the other is down and not rising; here it is
  set while the other lies in the down action, not during the fall before.
- Jump attacks: a press in the jump goes to the context-keyed entries, 1
  rising and 3 falling (StF's: 1). The engine has one jump, the big one, so
  the small jump's 2 and 4, StF's second air step and the rising attacks are
  not reached.
- Throws deal op 5's damage, then the victim motion's own hits (play op 8)
  at their frames; many throws deal none.
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
