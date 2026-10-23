# m2-megamix

This is a small Fighters Megamix built from three Model 2 games. Virtua
Fighter 2, Fighting Vipers and Sonic the Fighters all run AM2's fighting
engine. This project plays their fighters against each other, on any of
their stages, in one engine:

- VF2: Akira, Sarah, Kage
- Fighting Vipers: Picky, Honey, Mahler
- Sonic the Fighters: Sonic, Honey, Eggman

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
up/down to pick, kick/punch to change, start to fight). See `docs/BOARD.md`.

## Running

```
git submodule update --init
python3 tools/serve.py          # prints http://127.0.0.1:<port>/
```

`tools/serve.py` serves `/roms/vf2.zip`, `/roms/fvipers.zip` and
`/roms/sfight.zip` from `$ROMS_DIR` (default `~/build/mameroms`). It reads
them in place. You can also drop the three zips on the page instead.

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
- `docs/SHARED-CODE.md` audits the i960 functions StF and VF2 share: which are one code, and what a VF2 fighter still needs (guest data or a branch on `char_game`); `tools/shared-fns.py` compares them.

## Not the board's own code

The engine is written from what the three games share, so some parts are
approximations. Each is marked `Here:` in `js/engine.js`:

- Hits are tested from the forward-most hand, foot or head against a capsule,
  not from the part the setup record names.
- StF's strike level is not read. The input decides it.
- The CPU player is a simple one.
- Throws use 50 damage on VF2/FV, because their damage is not read.
- Rounds last 40 s and need 2 wins (1–3 in the menu).

## Tests

```
node tests/fighters.test.mjs    # every fighter poses, moves and reacts, across games
node tests/bout.test.mjs        # CPU vs CPU, all 81 pairings
```

Both read the zips from `$ROMS_DIR`.
