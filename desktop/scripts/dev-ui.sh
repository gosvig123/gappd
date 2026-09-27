#!/usr/bin/env bash
set -euo pipefail
: "${GAPPD_SELECTED_FIXTURE_PROFILE:?Set a fresh selected-fixture profile before launching dev UI}"
profile="$GAPPD_SELECTED_FIXTURE_PROFILE"
[[ -f "$profile/selected-fixture" && $(< "$profile/selected-fixture") == gappd-selected-local-fixture-v1 ]] || {
  echo 'Run build/gappd selected-fixture bootstrap with a fresh absolute profile first.' >&2
  exit 1
}
port="${GAPPD_UI_CDP_PORT:-9337}"
[[ "$port" =~ ^[0-9]+$ && "$port" -gt 0 && "$port" -le 65535 ]] || { echo 'Invalid GAPPD_UI_CDP_PORT' >&2; exit 1; }
cd "$(dirname "$0")/.."
export PATH="$PWD/node_modules/.bin:$PATH"
exec concurrently -k 'vite' 'tsup --config tsup.config.ts --watch' "wait-on tcp:5173 dist-electron/main/main.js && VITE_DEV_SERVER_URL=http://127.0.0.1:5173 electron --remote-debugging-address=127.0.0.1 --remote-debugging-port=$port ."
