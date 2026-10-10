#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p ../build
min="${GAPPD_MACOS_MIN_VERSION:-26.0}"
profile="${GAPPD_MAC_BUILD:-native}"
case "$profile" in
  native) archs=("$(uname -m)");;
  arm64) archs=(arm64);;
  x64) archs=(x86_64);;
  universal) archs=(arm64 x86_64);;
  *) echo "Unsupported GAPPD_MAC_BUILD: $profile" >&2; exit 1;;
esac
tmp="$(mktemp -d ../build/gappd-export.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
for arch in "${archs[@]}"; do
  swiftc -O -swift-version 6 -parse-as-library -strict-concurrency=complete -target "${arch}-apple-macos${min}" -framework AVFoundation export-helper/main.swift -o "$tmp/export-$arch"
done
if [[ ${#archs[@]} -eq 1 ]]; then cp "$tmp/export-${archs[0]}" ../build/gappd-export
else lipo -create "$tmp/export-arm64" "$tmp/export-x86_64" -output ../build/gappd-export; fi
codesign --force --sign - ../build/gappd-export
