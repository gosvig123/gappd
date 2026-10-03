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
vite_port="${GAPPD_UI_VITE_PORT:-5173}"
[[ "$vite_port" =~ ^[0-9]+$ && "$vite_port" -gt 0 && "$vite_port" -le 65535 ]] || { echo 'Invalid GAPPD_UI_VITE_PORT' >&2; exit 1; }
cd "$(dirname "$0")/.."
export PATH="$PWD/node_modules/.bin:$PATH"
node ./scripts/dev-runtime-assets.mjs
exec concurrently -k "vite --host 127.0.0.1 --port $vite_port --strictPort" 'tsup --config tsup.config.ts --watch' "wait-on tcp:$vite_port dist-electron/main/main.js && VITE_DEV_SERVER_URL=http://127.0.0.1:$vite_port electron --remote-debugging-address=127.0.0.1 --remote-debugging-port=$port ."
