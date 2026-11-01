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

### Release notes

Before you tag a stable release, commit `desktop/release-notes/vMAJOR.MINOR.PATCH.md` on `beta`. Write it for people who use Gappd: what changed for them, in short `-` items, with no internal changes (CI, migrations, docs). The workflow checks out the tag and uses this file as the GitHub release body. Without the file, the body is a placeholder line. [getgappd.com/releases/](https://getgappd.com/releases/) shows the body of each stable release (markdown headings, `-` lists, paragraphs, `**bold**`, `` `code` ``, and `https` links) and shows "Fixes and improvements." for the placeholder. To fix the notes of a published release, edit the file and run `gh release edit <tag> --notes-file desktop/release-notes/<tag>.md`; the website shows the change within 10 minutes.

Workflow releases require all signing and notarization secrets. The workflow fails before building if any are absent, then imports the Developer ID certificate, enables hardened runtime, notarizes the app, and requires Gatekeeper verification.

The signing setup exports `CSC_KEYCHAIN` so Electron Builder uses the verified keychain. Do not also set `CSC_LINK`: that asks the builder to import the certificate again into a separate keychain.

Calendar-enabled releases also require the public `GAPPD_GOOGLE_OAUTH_CLIENT_ID` repository variable and the `GAPPD_GOOGLE_OAUTH_CLIENT_SECRET` repository secret, both from the Desktop client in the Gappd Production Google Cloud project. The build bakes both into the app, which exchanges and refreshes Google tokens directly with Google. Google requires the Desktop client secret at its token endpoint but does not treat it as confidential in an installed app.

Required secrets:

- `APPLE_CERTIFICATE_P12_BASE64`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `GAPPD_GOOGLE_OAUTH_CLIENT_SECRET`

## Local packaging

From repository root:

```bash
npm run desktop:bootstrap
npm run desktop:dist:dir
```

Output lands under `desktop/release/`; renderer assets remain under `desktop/dist/`.

For one architecture, set the native build profile and pass the matching builder flags, for example `GAPPD_MAC_BUILD=x64 npm --prefix desktop run dist -- --mac dir --x64`. The release workflow uses `dist:mac:universal`.

Local packaging does not require Apple credentials. Release-only notarization and Gatekeeper checks are enabled through `GAPPD_ENABLE_NOTARIZATION=1` and `GAPPD_REQUIRE_GATEKEEPER=1`.
