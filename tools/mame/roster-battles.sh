#!/bin/bash
# The source battles for grading the browser build (docs/GRADING.md, the
# browser build): every fighter record of VF2, FV and StF against himself
# on stage 0, and every stage of each game with its first fighter, each a
# battle.lua run in MAME, three at a time.
#
#   tools/mame/roster-battles.sh <outdir> [jobs file]
#
# Each battle goes to <outdir>/<game>-<p1>-<p2>-s<stage>/trace.txt (with
# mame.out); one already there and finished is kept. A jobs file has lines
# "<game> <p1> <p2> <stage>"; without one, the list above. Then:
#   node tools/grade-roster.mjs <outdir>
#
# MAME is $MAME (default the shared build), the sets are in $ROMS_DIR.
set -u
OUT=${1:?usage: roster-battles.sh <outdir> [jobs file]}
JOBS=${2:-}
HERE=$(cd "$(dirname "$0")" && pwd)
MAME=${MAME:-$HOME/build/mame-bin/mame-shared/shared}
ROMS_DIR=${ROMS_DIR:-$HOME/build/mameroms}
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)

one() {
  local G=$1 A=$2 B=$3 S=$4 DRV
  local D=$OUT/$G-$A-$B-s$S
  [ -s "$D/trace.txt" ] && tail -n1 "$D/trace.txt" | grep -qx done && return 0
  rm -rf "$D"; mkdir -p "$D/cfg" "$D/nvram" "$D/snap"
  case $G in stf) DRV=sfight;; vf2) DRV=vf2;; fv) DRV=fvipers;; *) echo "$G: no such game"; return 1;; esac
  # MAME's own files (and the geometrizer's logs) land in the run's directory
  (cd "$D" && BT_GAME=$G BT_P1=$A BT_P2=$B BT_STAGE=$S BT_SEED=1 BT_FRAMES=20000 BT_OUT=$D/trace.txt \
    timeout 600 "$MAME" $DRV -rompath "$ROMS_DIR" -video none -sound none -nothrottle -skip_gameinfo \
    -cfg_directory cfg -nvram_directory nvram -snapshot_directory snap \
    -autoboot_script "$HERE/battle.lua" > mame.out 2>&1 < /dev/null)
  rm -rf "$D/cfg" "$D/nvram" "$D/snap" "$D"/geo_*
  echo "$G $A $B s$S: $(tail -n1 "$D/trace.txt" 2>/dev/null || echo 'no log')"
}

jobs() {
  if [ -n "$JOBS" ]; then cat "$JOBS"; return; fi
  for c in $(seq 0 12); do echo "vf2 $c $c 0"; done
  for c in $(seq 0 12); do echo "fv $c $c 0"; done
  for c in $(seq 0 16); do echo "stf $c $c 0"; done
  for s in $(seq 1 11); do echo "vf2 0 0 $s"; done
  for s in $(seq 1 8); do echo "fv 8 8 $s"; done
  for s in $(seq 1 9); do echo "stf 0 0 $s"; done
}

export -f one; export OUT HERE MAME ROMS_DIR
jobs | xargs -P3 -L1 bash -c 'one "$@"' _
