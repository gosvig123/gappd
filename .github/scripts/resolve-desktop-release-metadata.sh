#!/usr/bin/env bash
set -euo pipefail

if [[ "$GITHUB_EVENT_NAME" == "workflow_dispatch" ]]; then
  [[ "$INPUT_RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    echo "Stable release tag must match vMAJOR.MINOR.PATCH: $INPUT_RELEASE_TAG" >&2
    exit 1
  }
  release_version="${INPUT_RELEASE_TAG#v}"
  release_core="$release_version"
  release_channel="stable"
  release_prerelease="0"
else
  latest_stable="$(git tag -l 'v[0-9]*.[0-9]*.[0-9]*' --sort=-version:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)"
  package_version="$(node -p "require('./desktop/package.json').version")"
  release_core="$(node - "$latest_stable" "$package_version" <<'NODE'
const [stableTag, packageVersion] = process.argv.slice(2)
const stable = parse(stableTag || 'v0.0.0')
const packageCore = parse(packageVersion)
const base = compare(packageCore, stable) > 0 ? packageCore : [stable[0], stable[1], stable[2] + 1]
console.log(base.join('.'))
function parse(value) {
  const match = String(value).match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (!match) throw new Error(`Invalid version: ${value}`)
  return match.slice(1).map(Number)
}
function compare(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}
NODE
)"
  release_version="$release_core-beta.$GITHUB_RUN_NUMBER"
  release_channel="beta"
  release_prerelease="1"
fi

release_tag="v$release_version"
{
  echo "GAPPD_BUILD_VERSION=$release_core"
  echo "GAPPD_BUNDLE_SHORT_VERSION=$release_core"
  echo "GAPPD_UPDATE_CHANNEL=$release_channel"
  echo "RELEASE_CHANNEL=$release_channel"
  echo "RELEASE_CORE=$release_core"
  echo "RELEASE_PRERELEASE=$release_prerelease"
  echo "RELEASE_TAG=$release_tag"
  echo "RELEASE_VERSION=$release_version"
} >> "$GITHUB_ENV"
printf 'Release: %s (%s)\n' "$release_tag" "$release_channel"
