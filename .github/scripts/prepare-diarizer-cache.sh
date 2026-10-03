#!/usr/bin/env bash
set -euo pipefail

# Called from the repository root. Keep the full tool versions, including build IDs.
deployment_target="$(node -e "const { DEFAULT_MACOS_MIN_VERSION } = require('./desktop/scripts/mac-release-utils.cjs'); console.log(process.env.GAPPD_MACOS_MIN_VERSION || DEFAULT_MACOS_MIN_VERSION)")"
bash .github/scripts/plan-diarizer-cache.sh \
  --os "$RUNNER_OS" \
  --arch "$RUNNER_ARCH" \
  --swift "$(swift --version 2>&1)" \
  --xcode "$(xcodebuild -version)" \
  --sdk "$(xcrun --sdk macosx --show-sdk-version)" \
  --target "$deployment_target" \
  --configuration "${GAPPD_SWIFT_CONFIGURATION:-release}" \
  --resolved-sha "$(shasum -a 256 gappd-diarizer/Package.resolved | awk '{print $1}')" \
  --build-script-sha "$(shasum -a 256 gappd-diarizer/build.sh | awk '{print $1}')" \
  --sources-sha "$GAPPD_DIARIZER_SOURCES_SHA" >> "$GITHUB_OUTPUT"
