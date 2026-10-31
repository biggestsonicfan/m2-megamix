#!/usr/bin/env bash
# The browser compiler's kits (web/kit/<lineup>/), one per lineup: each one's
# board build, from the ROM sets as the native build makes it, then
# tools/web/make-kit.mjs on it, which checks that the kit makes that build again.
#
#   tools/web/make-kits.sh <work dir> [lineup ...]     (default: every lineup)
#
# <work dir> gets each lineup's import (<work dir>/<lineup>/sfight/) and cmake
# build (<work dir>/build-<lineup>); a rerun builds only what changed. The
# lineups' bakes take turns in board/src/gen/poses.h; megamix's is put back last.
# Needs what the native build needs (docs/BOARD.md): $ROMS_DIR's sets, the
# Saturn disc, the Shenmue disc, m2-sdk and its i960 toolchain.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=${1:?tools/web/make-kits.sh <work dir> [lineup ...]}
shift
LINEUPS=("$@")
[ ${#LINEUPS[@]} -gt 0 ] || LINEUPS=($(node -e "import('$ROOT/tools/board/lineup.mjs').then((m) => console.log(Object.keys(m.LINEUPS).join(' ')))"))
mkdir -p "$WORK"
WORK=$(cd "$WORK" && pwd)

[ -f "$ROOT/board/src/gen/stf_motion.s" ] || python3 "$ROOT/tools/board/lift-stf.py"
for L in "${LINEUPS[@]}"; do
    echo "== $L"
    LINEUP=$L node "$ROOT/tools/board/bake-board.mjs"
    LINEUP=$L node "$ROOT/tools/board/import-assets.mjs" "$WORK/$L" > "$WORK/$L.import.log"
    cmake -G "Unix Makefiles" -S "$ROOT/board" -B "$WORK/build-$L" -DROM_DIR="$WORK/$L/sfight" > /dev/null
    make -C "$WORK/build-$L" -j2 --no-print-directory > "$WORK/build-$L.log"
    node "$ROOT/tools/web/make-kit.mjs" "$L" "$WORK/build-$L" "$WORK/$L"
done
# the tree's own lineup back in board/src/gen/poses.h
if [ "${LINEUPS[-1]}" != megamix ]; then node "$ROOT/tools/board/bake-board.mjs"; fi
