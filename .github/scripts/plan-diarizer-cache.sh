#!/usr/bin/env bash
# Prints the GitHub Actions cache key and restore prefix for the diarizer Swift scratch paths.
#
# Every input that changes the compiled objects belongs in the restore prefix: toolchain, SDK,
# deployment target, configuration, resolved dependencies, and the build script that names the
# scratch paths. The sources hash is only in the cache key, so a source-only change restores the
# previous prefix and rebuilds incrementally.
#
# Readable fields are truncated for the log, and a digest of the full untruncated inputs keeps the
# key collision-safe and shorter than the 512-character GitHub limit.
set -euo pipefail

usage='usage: plan-diarizer-cache.sh --os OS --arch ARCH --swift SWIFT --xcode XCODE --sdk SDK --target TARGET --configuration CONFIG --resolved-sha SHA --build-script-sha SHA --sources-sha SHA'

sanitize() {
  printf '%s' "$1" | tr -cs 'A-Za-z0-9._-' '-' | sed 's/^-//; s/-$//' | cut -c1-"${2:-120}"
}

os=''
arch=''
swift=''
xcode=''
sdk=''
target=''
configuration=''
resolved_sha=''
build_script_sha=''
sources_sha=''

while [ "$#" -gt 0 ]; do
  [ "$#" -ge 2 ] || { echo "$usage" >&2; exit 64; }
  case "$1" in
    --os) os="$2" ;;
    --arch) arch="$2" ;;
    --swift) swift="$2" ;;
    --xcode) xcode="$2" ;;
    --sdk) sdk="$2" ;;
    --target) target="$2" ;;
    --configuration) configuration="$2" ;;
    --resolved-sha) resolved_sha="$2" ;;
    --build-script-sha) build_script_sha="$2" ;;
    --sources-sha) sources_sha="$2" ;;
    *) echo "$usage" >&2; exit 64 ;;
  esac
  shift 2
done

for value in "$os" "$arch" "$swift" "$xcode" "$sdk" "$target" "$configuration" "$resolved_sha" "$build_script_sha" "$sources_sha"; do
  [ -n "$value" ] || { echo "$usage" >&2; exit 64; }
done

digest="$(printf '%s|%s|%s|%s|%s|%s|%s|%s|%s' "$os" "$arch" "$swift" "$xcode" "$sdk" "$target" "$configuration" "$resolved_sha" "$build_script_sha" | shasum -a 256 | awk '{print $1}')"
prefix="$(sanitize "$os" 24)-$(sanitize "$arch" 24)-diarizer-$(sanitize "$swift" 40)-$(sanitize "$xcode" 24)-$(sanitize "$sdk" 24)-$(sanitize "$target" 16)-$(sanitize "$configuration" 16)-$digest"
printf 'cache-key=%s-%s\n' "$prefix" "$sources_sha"
printf 'restore-key=%s-\n' "$prefix"
