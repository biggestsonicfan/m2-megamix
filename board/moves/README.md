# Moves to import

`tools/import-assets.mjs` takes each `<chr>-<name>.moves` file here in place
of that fighter's moves on the board. These are the command program and the
setup records of the motions it plays. To get a file to edit, run
`node tools/moves-text.mjs`, which writes every fighter's file to
`board/moves-out/`, and copy the one you want here. The format is described
at the top of `tools/moves-text.mjs` and in `docs/BOARD.md` (Moves as text).

If a program or setup is still what the ROM has, it stays where it is.
Anything you changed goes in the guest heap. A setup belongs to its motion,
so a change to one applies to every fighter who plays that motion.
