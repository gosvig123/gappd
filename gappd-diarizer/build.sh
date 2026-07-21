#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PROFILE="${1:-${GAPPD_MAC_BUILD:-native}}"
CONFIG="${GAPPD_SWIFT_CONFIGURATION:-release}"
export MACOSX_DEPLOYMENT_TARGET="${GAPPD_MACOS_MIN_VERSION:-26.0}"
ARGS=(--package-path "$ROOT" -c "$CONFIG" --product GappdDiarizer)
OUTPUT="$ROOT/.build/gappd-diarizer"

build_binary() {
  local output="$1"
  shift
  local build_args=("${ARGS[@]}" "$@")
  swift build "${build_args[@]}"
  local bin_path
  bin_path="$(swift build "${build_args[@]}" --show-bin-path)/GappdDiarizer"
  cp "$bin_path" "$output"
}

mkdir -p "$ROOT/.build"
case "$PROFILE" in
  native) build_binary "$OUTPUT" ;;
  arm64) build_binary "$OUTPUT" --arch arm64 ;;
  x64) build_binary "$OUTPUT" --arch x86_64 ;;
  universal)
    TEMP_DIR="$(mktemp -d "$ROOT/.build/gappd-diarizer-universal.XXXXXX")"
    trap 'rm -rf "$TEMP_DIR"' EXIT
    build_binary "$TEMP_DIR/arm64" --scratch-path "$ROOT/.build/arm64" --arch arm64
    build_binary "$TEMP_DIR/x86_64" --scratch-path "$ROOT/.build/x86_64" --arch x86_64
    lipo -create "$TEMP_DIR/arm64" "$TEMP_DIR/x86_64" -output "$OUTPUT"
    ;;
  *) echo "usage: build.sh [native|arm64|x64|universal]" >&2; exit 64 ;;
esac
chmod 755 "$OUTPUT"
