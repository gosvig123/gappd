#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PROFILE="${1:-${GAPPD_MAC_BUILD:-native}}"
CONFIG="${GAPPD_SWIFT_CONFIGURATION:-release}"
ARGS=(--package-path "$ROOT" -c "$CONFIG")
case "$PROFILE" in
  native) ;;
  universal) ARGS+=(--arch arm64 --arch x86_64) ;;
  *) echo "usage: build.sh [native|universal]" >&2; exit 64 ;;
esac
swift build "${ARGS[@]}"
BIN="$(swift build "${ARGS[@]}" --show-bin-path)/GappdDiarizer"
cp "$BIN" "$ROOT/.build/gappd-diarizer"
chmod 755 "$ROOT/.build/gappd-diarizer"
