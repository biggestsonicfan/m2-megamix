# Ryo Hazuki

Ryo is the roster's tenth fighter, from Shenmue. Like the rest of the cast,
everything about him is read off the original data when the page loads: the
Shenmue beta's GD-ROM (0.400, disc 3). `tools/serve.py` serves four files
off it, at `/shenmue/<path>`. It reads the disc image through
`tools/shenmue-fight.py cat`. Without the disc, the roster is the nine
Model 2 fighters.

| file | what |
|--|--|
| `MISC/MODELS.PKS` (gzip) | `YKB_M.CHRM`, his model (MT5); `YKB_B.CHRM`, the board's (docs/BOARD.md) |
| `MISC/MODELS.PKF` (gzip) | its textures (PVR) |
| `MISC/MOTION.BIN` | his motions, and each one's record (timing, damage) |
| `SCENE/03/MFBT/EN_RYOU.BIN` | the free battle's move script |

`js/shenmue.js` holds the readers. `js/ryo.js` turns them into a fighter
with the same interface as `js/fighters.js`; `games.shenmue.makeFighter`
builds him.

## Body

Shenmue's motions are VF3's, and VF3's are VF2's with two more objects
(`docs/VF3-SHENMUE.md`). So Ryo is posed by VF2's pose routine on a rig
taken from his own model's bone lengths and pivots. His model is then
skinned onto the sixteen slots. Each MT5 node rides on one slot, the slot of
the nearest bone that VF2 has:

`mats[slot] · inv(rest[anchor]) · rest[node]`

The body returns one part, `{skin: {positions, normals}}`. `js/render.js`
builds the mesh once (UVs, and triangles grouped by texture) and updates
the positions every frame. Each texture is its own material: the
punch-through texels are cut out, both faces are drawn, and the lighting is
one sun plus ambient, computed into the vertex colours.

## Size

Ryo is 5 ft 9 in and Akira 5 ft 11 in. Ryo is scaled so that, in Akira's
stance, he stands 69/71 of Akira's height (1.592 to 1.638). His `size`
(69/71) scales the engine's radii:

- the body (when hit);
- the blow (when he hits);
- the push apart (the average of the two fighters' sizes);
- the throw range.

## Moves

The move script is read the way `docs/SHENMUE-FIGHT.md` describes it. The
root is the run of button switches at start + 4: A is P, X is K, A+X is
P+K, and the throw button is P+G. Each candidate (`try` … `play`) becomes a
matcher entry with its stick checks, and the code after the last candidate
is the button's plain move. The parser follows these:

- `if` names where the string goes on;
- `goto`;
- `when` (skipped);
- op 76, the stick's three-way branch (forward, back, neither).

A nested `try` is taken, which gives every skill at its highest level. When
a check inside one fails, the parser goes on at the `try`'s else instead.
A candidate that holds a state the fight lacks (a run, ops 9, 83 and 7) can't
be reached. The play word's id is its low 15 bits, minus 1.

Each move's record in `MOTION.BIN` is 12 bytes of header followed by tagged
blocks. Tag 2 is hit, cancel and end, in 30 fps frames; VF2's frame is
2t + 1. Tag 3 is 14 bytes, not read. After the blocks come:

- the kind: 4 is a strike, 5 a throw;
- the damage;
- for a throw, the motion the victim plays;
- for a strike, its level: 0 high, 1 mid, 2 low, and 3, the sweep, as low.

Damage is doubled, which puts Ryo's jab beside Akira's, and capped at 70,
Akira's most. Throws do 50, as VF2's do. The Swallow Flip parry, a throw
with no damage, is left out.

The root table has 34 entries (31 strikes and 3 throws), and the strings
follow on from it: the jab, body blow and elbow, and the kick combos.

His actions are Shenmue's own (stance, walk, dash, guard, crouch, jump, and
the high, mid and low hits). Getting knocked down and getting up are
Akira's, because the free battle doesn't have them.

## Not Shenmue's own

- The script's state checks are assumed (skills, the string timing) or
  dropped (runs, sidesteps, the parry).
- The damage scale is a guess: Shenmue's own scale is not measured.
- The lighting is a simple lambert, not Shenmue's.
