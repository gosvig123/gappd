# Desktop macOS release

## What ships in the app bundle

- `build/gappd` is bundled into `Contents/Resources/bin/gappd`
- `build/GappdCapture.app` is bundled into `Contents/Resources/GappdCapture.app`
- Bundled runtimes stay repo-owned: `llamacpp/llama-server` and `whisper/whisper-cli`

## What still downloads on first run

- The LFM2 meeting model is downloaded during managed Local AI setup
- The Whisper model file is still downloaded into the app-managed models directory when needed

## Release workflow inputs

- Manual workflow runs publish stable releases from an existing `v*` tag
- Pushes to `beta` publish prereleases named `v<next-version>-beta.<run-number>` from the pushed commit
- Beta builds use prerelease package versions while keeping macOS bundle/build versions numeric
- Release assets include the first-install DMG plus the updater ZIP, blockmaps, and `*-mac.yml` metadata
- Beta serials use the workflow-wide GitHub run number; manual stable runs consume numbers too, so gaps between beta serials are expected
- Stable releases retain `beta-mac.yml` so beta-channel installs can move onto a promoted stable build
- Beta pushes update the mutable `beta` release's `latest.json` so old beta apps can find the bridge release; its title and notes identify the current versioned beta, while its source archives remain tied to the compatibility tag's original commit
- `release_tag`: existing `vMAJOR.MINOR.PATCH` tag for manual stable release runs
- `APPLE_CERTIFICATE_P12_BASE64`: base64-encoded Developer ID Application certificate
- `APPLE_CERTIFICATE_PASSWORD`: password for the `.p12`
- `APPLE_SIGNING_IDENTITY`: full codesign identity name
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`: notarization credentials
- `GAPPD_ENABLE_NOTARIZATION=1`, `GAPPD_REQUIRE_GATEKEEPER=1`: release-only verification toggles used by CI

## Local packaging

- Use `npm run dev` from `desktop/` for desktop development.
- This repo is not a pnpm workspace; install dependencies and run release packaging for `desktop` with npm.
- From the repo root, run `npm --prefix ./desktop run dist:dir`; it still works without Apple secrets
- Packaged app output now lands under `desktop/release/`; renderer assets stay in `desktop/dist/`
- macOS auto-update requires signed builds and both `dmg` and `zip` targets; the ZIP is consumed by Electron's updater
- Local builds ad-hoc sign nested bundled executables so the packaged app remains runnable for smoke checks
- Release notarization submits and staples the `.app`; later verification validates that same `.app` instead of assuming the `.dmg` was notarized too
- Notarization and Gatekeeper assessment stay gated behind release env vars
