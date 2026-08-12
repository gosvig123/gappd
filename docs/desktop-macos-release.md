# Desktop macOS release

## Bundle contents

Electron Builder packages these resources into `Gappd.app`:

- Go meeting engine: `build/gappd`;
- Swift capture app: `build/GappdCapture.app`;
- Swift Apple Speech app: `build/GappdSpeechTranscriber.app`;
- Swift diarizer: `build/gappd-diarizer`;
- diarization models and licenses from `gappd-diarizer/`;
- llama.cpp runtime from `desktop/resources/llamacpp/`.

Native runtimes and diarization models ship with the application. Managed setup downloads the selected llama.cpp meeting model and prepares the required Apple Speech asset.

## Release workflow

`.github/workflows/desktop-macos-release.yml` builds universal macOS releases on `macos-26`:

- pushes to `beta` create prerelease versions;
- manual runs publish an existing stable `vMAJOR.MINOR.PATCH` tag;
- Electron Builder emits DMG and updater ZIP targets;
- release verification checks the packaged app and expected artifacts;
- GitHub release publishing includes updater metadata and a generated release manifest.

Signed releases require all signing and notarization secrets. When they are present, the workflow imports the Developer ID certificate, enables hardened runtime, notarizes the app, and requires Gatekeeper verification.

Required secrets:

- `APPLE_CERTIFICATE_P12_BASE64`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

## Local packaging

From repository root:

```bash
npm run desktop:bootstrap
npm run desktop:dist:dir
```

Output lands under `desktop/release/`; renderer assets remain under `desktop/dist/`.

Local packaging does not require Apple credentials. Release-only notarization and Gatekeeper checks are enabled through `GAPPD_ENABLE_NOTARIZATION=1` and `GAPPD_REQUIRE_GATEKEEPER=1`.
