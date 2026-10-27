#!/bin/bash
# Two linked cabinets of the board build in MAME: 1P's (the master) and 2P's,
# joined by MAME's comm board (m2comm.cpp) over two local ports. Each runs in
# its own directory under <dir> (cfg, nvram, snapshots), with its role set by
# link-role.lua. Both boot their communication check and link. A cabinet takes
# either pad as its player's, and MAME gives the keys to the focused window:
# play each cabinet in its own window.
#
#   tools/mame/link-cabinets.sh <dir> [mame] [extra MAME options...]
#
# mame defaults to the shared build. Close either window and the other's
# board drops the link and waits; start that cabinet again (the same command,
# or its MAME line) and the two link again. Upstream MAME dies of SIGPIPE
# there; the shared build has the fork's fix (m2comm-drop, Pinboard #1632).
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
dir=${1:?usage: link-cabinets.sh <dir> [mame] [options...]}
mame=${2:-$HOME/build/mame-bin/mame-shared/shared}
shift 2 2>/dev/null || shift $#
roms="$repo/board/roms;${ROMS_DIR:-$HOME/build/mameroms}"
pids=()
trap 'kill "${pids[@]}" 2>/dev/null' EXIT
for role in 1 2; do
  mkdir -p "$dir/cab$role"
  lp=$((15111 + role)); rp=$((15114 - role))
  ( cd "$dir/cab$role" && LINK_ROLE=$role exec "$mame" sfight -rompath "$roms" -window \
      -comm_localhost 127.0.0.1 -comm_localport $lp -comm_remotehost 127.0.0.1 -comm_remoteport $rp \
      -cfg_directory cfg -nvram_directory nvram -snapshot_directory snap \
      -autoboot_script "$here/link-role.lua" "$@" ) &
  pids+=($!)
done
wait
