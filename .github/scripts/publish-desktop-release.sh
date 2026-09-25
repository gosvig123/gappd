#!/usr/bin/env bash
set -euo pipefail

notes="Gappd macOS $RELEASE_CHANNEL signed and notarized build for $RELEASE_TAG."
if [[ "$RELEASE_CHANNEL" == "beta" ]]; then
  printf -v notes '%s\n\nSource commit: %s' "$notes" "$GITHUB_SHA"
fi

edit_flags=(--title "Gappd $RELEASE_TAG" --notes "$notes")
create_flags=(--title "Gappd $RELEASE_TAG" --notes "$notes")
if [[ "$RELEASE_PRERELEASE" == "1" ]]; then
  edit_flags+=(--prerelease)
  create_flags+=(--prerelease --latest=false --target "$GITHUB_SHA")
else
  edit_flags+=(--latest)
  create_flags+=(--verify-tag --latest)
fi

if gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  gh release edit "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" "${edit_flags[@]}"
else
  gh release create "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" "${create_flags[@]}"
fi

gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json assets --jq '.assets[].name' |
  while read -r asset; do
    case "$asset" in
      *.dmg|*.zip|*.blockmap|*-mac.yml|latest.json)
        gh release delete-asset "$RELEASE_TAG" "$asset" --repo "$GITHUB_REPOSITORY" --yes
        ;;
    esac
  done

shopt -s nullglob
assets=(desktop/release/*.dmg desktop/release/*.zip desktop/release/*.blockmap desktop/release/*-mac.yml desktop/release/latest.json)
gh release upload "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" "${assets[@]}" --clobber

if [[ "$RELEASE_CHANNEL" == "beta" ]]; then
  title="Gappd beta pointer - $RELEASE_TAG"
  printf -v beta_notes 'Compatibility update-manifest pointer for older Gappd beta builds.\n\nCurrent beta: [%s](https://github.com/%s/releases/tag/%s)\n\nDownload app builds and current source archives from the versioned release above. Source archives on this `beta` tag reflect its original commit.' "$RELEASE_TAG" "$GITHUB_REPOSITORY" "$RELEASE_TAG"
  if gh release view beta --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
    gh release edit beta --repo "$GITHUB_REPOSITORY" --title "$title" --notes "$beta_notes" --prerelease
    if gh release view beta --repo "$GITHUB_REPOSITORY" --json assets --jq '.assets[].name' | grep -Fx latest.json >/dev/null; then
      gh release delete-asset beta latest.json --repo "$GITHUB_REPOSITORY" --yes
    fi
  else
    gh release create beta --repo "$GITHUB_REPOSITORY" --title "$title" --notes "$beta_notes" --prerelease --latest=false --target "$GITHUB_SHA"
  fi
  gh release upload beta --repo "$GITHUB_REPOSITORY" desktop/release/latest.json --clobber
fi
