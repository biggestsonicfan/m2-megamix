#!/bin/bash
# Grade the board build by replays (docs/GRADING.md, "The board, by replay"):
# each battle is played in its source game (StF, VF2, FV) with battle.lua's
# seeded script and recorded (BT_RECORD), then the recording is played on the
# board (BT_REPLAY) with the same fighters and stage, and the two logs graded.
#
#   tools/mame/board-replays.sh <outdir> <build dir> [jobs file]
#
# <build dir> is the board's cmake build (its game.map); the board's ROMs are
# this checkout's board/roms. A job is a line
#   <name> <game> <p1> <p2> <stage> <board menu>
# (the game's own fighter and stage numbers; the menu as BT_MENU); without a
# jobs file, the list below: every pairing of the board's fighters that one
# of the source games plays, on every board stage that game has. Each goes to
# <outdir>/<name>/: src/ (trace.txt, replay.txt), board/ (trace.txt), and
# grade.txt. A side already logged to its end is kept.
#
# MAME is $MAME (default the shared build), the sets are in $ROMS_DIR.
set -u
OUT=${1:?usage: board-replays.sh <outdir> <build dir> [jobs file]}
BUILD=$(cd "${2:?usage: board-replays.sh <outdir> <build dir> [jobs file]}" && pwd)
JOBS=${3:-}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
MAME=${MAME:-$HOME/build/mame-bin/mame-shared/shared}
ROMS_DIR=${ROMS_DIR:-$HOME/build/mameroms}
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)

# run <dir> <driver> <rompath> [VAR=value ...]: one battle.lua run in <dir>
run() {
  local D=$1 DRV=$2 RP=$3; shift 3
  [ -s "$D/trace.txt" ] && tail -n1 "$D/trace.txt" | grep -qx done && return 0
  rm -rf "$D"; mkdir -p "$D/cfg" "$D/nvram" "$D/snap"
  # MAME's own files (and the geometrizer's logs) land in the run's directory
  (cd "$D" && env "$@" BT_SEED=1 BT_FRAMES=30000 BT_OUT="$D/trace.txt" \
    timeout 900 "$MAME" "$DRV" -rompath "$RP" -video none -sound none -nothrottle -skip_gameinfo \
    -cfg_directory cfg -nvram_directory nvram -snapshot_directory snap \
    -autoboot_script "$HERE/battle.lua" > mame.out 2>&1 < /dev/null)
  rm -rf "$D/cfg" "$D/nvram" "$D/snap" "$D"/geo_*
}

one() {
  local NAME=$1 G=$2 A=$3 B=$4 S=$5 MENU=$6 DRV
  local D=$OUT/$NAME
  case $G in stf) DRV=sfight;; vf2) DRV=vf2;; fv) DRV=fvipers;; *) echo "$G: no such game"; return 1;; esac
  run "$D/src" "$DRV" "$ROMS_DIR" BT_GAME="$G" BT_P1="$A" BT_P2="$B" BT_STAGE="$S" BT_RECORD="$D/src/replay.txt"
  run "$D/board" sfight "$REPO/board/roms;$ROMS_DIR" BT_GAME=board BT_MENU="$MENU" \
    BT_MAP="$BUILD/game.map" BT_REPLAY="$D/src/replay.txt"
  node "$REPO/tools/grade-battle.mjs" "$D/src/trace.txt" "$D/board/trace.txt" > "$D/grade.txt" 2>&1
  echo "$NAME: $(grep -m1 "^scores" "$D/grade.txt" || tail -n1 "$D/grade.txt")"
}

jobs() {
  if [ -n "$JOBS" ]; then cat "$JOBS"; return; fi
  # StF: Sonic 0, Honey 15, Eggman 8 (the menu's 0, 1, 2) on South Island
  # (StF 0, the menu's 0) and Aurora Icefield (StF 2, the menu's 1); energy
  # and barrier as StF's settings
  local c=(0 15 8) names=(sonic honey eggman) st=(0 2)
  for s in 0 1; do for a in 0 1 2; do for b in 0 1 2; do
    echo "stf-${names[a]}-${names[b]}-s$s stf ${c[a]} ${c[b]} ${st[s]} 30,2,$s,$a,$b,140,5"
  done; done; done
  # The board's energy is the one whose ratio to the source's is the
  # guest's damage's: Akira's jab takes 18 of VF2's 220 and 11-12 of the
  # board's 140; Mahler's first hit 13 of FV's 280 and 11-12 of 250. The
  # grader scales the source's damage by the two energies.
  # VF2: Akira (the menu's 3) on Tou-rin (VF2 0, the menu's 2), the
  # Colosseum (1, 3) and the Test stage (12, 5)
  echo "vf2-akira-tourin vf2 0 0 0 30,2,2,3,3,140,5"
  echo "vf2-akira-colosseum vf2 0 0 1 30,2,3,3,3,140,5"
  echo "vf2-akira-test vf2 0 0 12 30,2,5,3,3,140,5"
  # FV: Mahler (8, the menu's 7) on Western (0, the menu's 4)
  echo "fv-mahler-western fv 8 8 0 30,2,4,7,7,250,5"
}

export -f run one; export OUT BUILD HERE REPO MAME ROMS_DIR
jobs | xargs -P3 -L1 bash -c 'one "$@"' _
