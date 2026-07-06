#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT/build"
APP_DIR="$BUILD_DIR/GappdSpeechTranscriber.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
OUTPUT="$MACOS_DIR/apple-speech-transcriber"
LEGACY_OUTPUT="$BUILD_DIR/apple-speech-transcriber"
PROFILE="${GAPPD_MAC_BUILD:-native}"
MIN_VERSION="${GAPPD_MACOS_MIN_VERSION:-26.0}"

build_one() {
  local arch="$1"
  local output="$2"
  swiftc -parse-as-library -target "$arch-apple-macosx$MIN_VERSION" "$ROOT/apple-speech-transcriber/main.swift" -o "$output"
}

build_universal() {
  local temp_dir arm64_path x64_path
  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/gappd-apple-speech.XXXXXX")"
  arm64_path="$temp_dir/apple-speech-transcriber-arm64"
  x64_path="$temp_dir/apple-speech-transcriber-x64"
  trap 'rm -rf "$temp_dir"' RETURN
  build_one arm64 "$arm64_path"
  build_one x86_64 "$x64_path"
  lipo -create "$arm64_path" "$x64_path" -output "$OUTPUT"
}

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR"
cp "$ROOT/apple-speech-transcriber/Info.plist" "$CONTENTS_DIR/Info.plist"

case "$PROFILE" in
  native) build_one "$(uname -m)" "$OUTPUT" ;;
  arm64) build_one arm64 "$OUTPUT" ;;
  x64) build_one x86_64 "$OUTPUT" ;;
  universal) build_universal ;;
  *) echo "Unsupported GAPPD_MAC_BUILD value: $PROFILE" >&2; exit 1 ;;
esac

chmod 755 "$OUTPUT"
cp "$OUTPUT" "$LEGACY_OUTPUT"
chmod 755 "$LEGACY_OUTPUT"
