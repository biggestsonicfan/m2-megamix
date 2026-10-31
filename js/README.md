# js: the browser game

Fighters Megamix in a web page (`game.html` loads `main.js`). Who, when and
why are in [docs/CODE-MAP.md](../docs/CODE-MAP.md); this is what is where.
Everything is read from the ROM sets through `vendor/noclip`'s readers.

| File | What it holds |
| --- | --- |
| `main.js` | the page: the text menu, the pads, the fight at 60 frames a second, the HUD, the struct dump |
| `render.js` | drawing a stage and two fighters, each with its own game's texture RAM and colour tables |
| `games.js` | the three ROM sets, the roster and the stage lists |
| `fighters.js` | one fighter interface over the three games (`makeFighter`); re-exports `fighters/` |
| `engine.js` | the fight (`createFight`, `stepFight`, `cpuPad`); re-exports `engine/`. No three.js: Node runs it for the tests |

Import from `fighters.js` and `engine.js`, not from their folders: they
hold the API (the same names as before the split), the folders the parts.

## fighters/: one fighter interface over three games

| File | What it holds |
| --- | --- |
| `rom.js` | what all fighters share (motion ids, slots, action slots, attack levels, energy) and a motion by id; imports nothing of the folder's |
| `setup.js` | the setup records: each motion's ops, part masks, take-off, air hold, get-up window, throw hits |
| `matcher.js` | the input matcher run live: buttons, stick, an entry's tests, `matchPress` |
| `rules.js` | the games' attack_hit rules: en_flag, from behind, throw flags, counters, damage, stun, knock-down |
| `vf.js` | a VF2 or FV fighter, its attacks, throws and flight; `prepareGame` |
| `stf.js` | a Sonic the Fighters fighter, its RAM models, attacks and flight |

## engine/: the fight

| File | What it holds |
| --- | --- |
| `state.js` | what every part shares: the action states (`ST`), timings, sizes, vectors; imports nothing of the folder's |
| `player.js` | the player record (the rob): making one, its motion and action, its body's points |
| `rounds.js` | `createFight`, a round's reset, `stepFight` (one frame, in the board's order), the referee |
| `input.js` | the pad in the fighter's frame, the press buffer, the matcher run on it, committing to a move |
| `jumps.js` | take-off, the small jump, the air context, flight, an air attack's hold |
| `throws.js` | who can be thrown, a throw's start and damage |
| `playback.js` | a frame's advance, a combo's end, getting up, the rising kick, a motion's end |
| `strikes.js` | the limbs a strike tests, the hit's flags, the hit, counters, the reaction |
| `arena.js` | pushing apart, the walls and the ring's edge |
| `cpu.js` | a CPU player whose output is a pad |

What the engine does where the games' rules are not read is marked `Here:`
in these files (README.md, Not the board's own code).

A module's top-level constants may use only `state.js`/`rom.js` and modules
outside the folder: the others import each other in a cycle, which is fine
for functions but not for a value needed while the modules load.

## shenmue/: the Shenmue beta's fighters

| File | What it holds |
| --- | --- |
| `shenmue.js` | the disc's files: packs, models, textures, motions (docs/RYO.md) |
| `ryo.js` | Ryo as a Megamix fighter, and the maker the other Shenmue fighters share |
| `chai.js` | Chai, the final boss, on Ryo's maker (docs/CHAI.md) |
