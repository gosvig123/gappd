#!/usr/bin/env bash
set -euo pipefail

{
  printf '### Release timings\n\n| Phase | Seconds |\n| --- | --- |\n'
  echo "| npm ci | ${GAPPD_RELEASE_DEPS_SECONDS:-unknown} |"
  echo "| native cache setup | ${GAPPD_RELEASE_CACHE_SECONDS:-unknown} |"
  echo "| build, sign, notarize, package | ${GAPPD_RELEASE_BUILD_SECONDS:-unknown} |"
  printf '\n### Release sizes\n\n| Path | Size |\n| --- | --- |\n'
  for path in desktop/release/*.dmg desktop/release/*.zip desktop/release/*.blockmap \
    desktop/release/mac*/Gappd.app desktop/release/mac*/Gappd.app/Contents/Resources/app.asar; do
    [ -e "$path" ] || continue
    printf '| %s | %s |\n' "$path" "$(du -sh "$path" | cut -f1)"
  done
} | tee -a "$GITHUB_STEP_SUMMARY"
