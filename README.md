# gappd — Meeting intelligence from your Mac

`gappd` records meeting audio, transcribes it locally, stores transcripts in SQLite,
and can run Ollama-based summarization and extraction over saved meetings.

## Surface area

macOS desktop app and CLI. Data lives in local SQLite at `~/.gappd/db.sqlite` by
default. Transcription uses bundled desktop Whisper or CLI `whisper-local`; AI
post-processing uses Ollama.

## Fresh-clone setup for contributors

Most contributors should use the desktop setup. Prereqs: macOS `14+`, Node.js
`22.12.0+`, Go `1.25+`, Xcode Command Line Tools, `cmake`, `tar`, and GitHub
network access for runtime downloads.

From repo root:

```bash
git clone https://github.com/gappd-dev/gappd.git
cd gappd
npm run desktop:bootstrap
npm run desktop:dev
```

On first app launch, the in-app local AI onboarding may download the selected
Ollama model and the Whisper model into the app user-data directory. No API keys,
Apple signing credentials, private packages, or checked-in binary artifacts are
required for local development.

Bootstrap installs desktop npm dependencies, checks macOS prerequisites,
downloads Ollama/Whisper runtimes, and builds native Go/capture artifacts.
Generated paths stay ignored: `build/`, `desktop/resources/`,
`desktop/.cache/`, `desktop/dist*`, and `desktop/release/`. There are no local
npm `file:`, `link:`, or `workspace:` dependencies, and no Go `replace`
directives.

If setup fails, run the checks separately so the failing layer is obvious:

```bash
npm run desktop:install
npm run desktop:preflight
npm run desktop:prepare
```

## Desktop commands from repo root

```bash
npm run desktop:install     # npm ci in ./desktop
npm run desktop:preflight   # check macOS toolchain prerequisites
npm run desktop:prepare     # prepare runtime/native artifacts
npm run desktop:bootstrap   # install + preflight + prepare
npm run desktop:typecheck   # TypeScript check
npm run desktop:dev         # start Vite, Electron main build, and Electron
npm run desktop:build       # build renderer, native artifacts, and Electron main
npm run desktop:dist:dir    # package unpacked macOS app directory
```

`npm run dev` remains a shorthand for `npm run desktop:dev`.

Contributor validation before opening a PR:

```bash
go test ./...
npm run desktop:typecheck
```

## Desktop updates

Desktop startup uses `electron-updater` against GitHub Releases. Signed macOS
builds publish a first-install DMG, updater ZIP, blockmaps, and `*-mac.yml`
metadata. Updates download in the background and install when the user clicks
`Restart to update` or quits after the download completes.

The macOS release workflow publishes stable builds only from manual runs with
an existing `v*` tag. Pushes to the `beta` branch publish prerelease builds named
`v<next-version>-beta.<run-number>`. Each run still writes `latest.json` so
older custom-updater apps can bridge onto the Electron updater build.

Beta builds use the Electron updater beta channel. Set `GAPPD_UPDATE_CHANNEL`
only to override the release channel, or `GAPPD_FORCE_DEV_AUTO_UPDATE=1` with a
local `dev-app-update.yml` when testing updater UI from an unpackaged app.

## CLI install

```bash
git clone https://github.com/gappd-dev/gappd.git
cd gappd
make build
make install
```

This builds `./build/gappd` and installs `gappd` to `/usr/local/bin/gappd`.

### macOS capture helper for CLI

`gappd listen` uses the ScreenCaptureKit helper on macOS. Build and install it with:

```bash
make install-capture
```

That installs `GappdCapture.app` to `~/.gappd/GappdCapture.app`.

### CLI runtime requirements

The CLI does not bundle Whisper or Ollama. For `gappd listen` and AI commands,
provide these separately:

- Whisper CLI binary in `PATH`, or set `GAPPD_WHISPER_BIN`
- Whisper model at `~/.gappd/models/ggml-small.en-q5_1.bin`, or pass `--model`
- Ollama running locally with configured model available, for example `llama3.1:8b`

## CLI commands

```bash
gappd setup
gappd devices
gappd listen [--device N] [--title TITLE] [--model /path/to/model.bin] [--mode mic|system|both]
gappd meetings
gappd show <meeting-id>
gappd enhance <meeting-id> [--notes "rough notes"]
gappd summarize <meeting-id>
```

Notes:

- `gappd` by itself does not launch a dashboard.
- There is no global `--json` output mode.
- `gappd summarize` is an alias for running the AI pipeline on an existing meeting.
- `gappd listen` stops with `Ctrl+C`.
- If no model path is provided to `gappd listen`, it looks for a Whisper model at `~/.gappd/models/ggml-small.en-q5_1.bin`.

## CLI quick start

1. Optional: copy the example config. If this file is missing, `gappd` uses built-in defaults.

   ```bash
   mkdir -p ~/.gappd
   cp config.example.toml ~/.gappd/config.toml
   ```

2. Make sure Ollama is running and the configured model is available.

   ```bash
   ollama serve
   ollama pull llama3.1:8b
   ```

3. Run setup:

   ```bash
   gappd setup
   ```

4. List devices and start a recording:

   ```bash
   gappd devices
   gappd listen --title "Sprint planning"
   ```

## Configuration

Config lives at `~/.gappd/config.toml`. Unknown keys are rejected.

```toml
db_path = "~/.gappd/db.sqlite"

[ai]
provider = "ollama"
model = "llama3.1:8b"
endpoint = "http://localhost:11434"
temperature = 0.3
```

Current validation rules:

- `db_path` must be set; `~` and `~/...` are expanded
- `ai.provider` must be `ollama`
- `ai.model` and `ai.endpoint` must be non-empty
- `ai.temperature` must be between `0` and `2`

See `config.example.toml` for the full example, including optional commented fields.

## Development checks

```bash
go test ./...
go build ./cmd/gappd
cd desktop && npx tsc --noEmit
```

This repo is not an npm workspace. Root npm scripts delegate into `./desktop` with
`npm --prefix ./desktop ...`.

## License

MIT
