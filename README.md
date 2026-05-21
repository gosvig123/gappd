# gappd — Meeting intelligence from your Mac

`gappd` records meeting audio, transcribes it locally, stores transcripts in SQLite,
and can run Ollama-based summarization and extraction over saved meetings.

## Current surface area

- Desktop app for macOS
- Terminal CLI
- Local SQLite database at `~/.gappd/db.sqlite` by default
- Local transcription via bundled desktop Whisper runtime or CLI `whisper-local`
- AI provider support: `ollama`
- Meeting capture, listing, display, and post-processing commands

## Desktop macOS fresh-clone setup

Prerequisites:

- macOS `14+` with network access to GitHub for Ollama/Whisper runtime downloads
- Node.js `22.12.0+` and npm
- Go `1.25+`
- Xcode Command Line Tools, including `swiftc`, `codesign`, `lipo`, and `xcrun`
- `cmake`
- `tar`

From repo root:

```bash
git clone https://github.com/gappd-dev/gappd.git
cd gappd
make desktop-bootstrap
make desktop-dev
```

Equivalent npm path from repo root:

```bash
npm run desktop:bootstrap
npm run desktop:dev
```

What bootstrap does:

1. Installs desktop npm dependencies with `npm --prefix ./desktop ci`.
2. Runs macOS prerequisite checks.
3. Downloads Ollama into `desktop/resources/ollama/`.
4. Downloads/builds Whisper into `desktop/resources/whisper/`.
5. Builds native Go and capture-helper artifacts into `build/`.

Generated artifacts are intentionally ignored by git. Fresh clones rebuild or download
these paths:

- `build/gappd`
- `build/GappdCapture.app`
- `desktop/resources/ollama/ollama`
- `desktop/resources/whisper/whisper-cli`
- `desktop/.cache/ollama/`
- `desktop/.cache/whisper/`
- `desktop/dist*` and `desktop/release/`

There are no unpublished local package dependencies required for clone setup: no
npm `file:`, `link:`, or `workspace:` dependencies, and no Go `replace` directives.
Native/runtime artifacts are generated or downloaded by bootstrap scripts.

## Desktop commands from repo root

```bash
make desktop-install     # npm ci in ./desktop
make desktop-preflight   # check macOS toolchain prerequisites
make desktop-prepare     # prepare runtime/native artifacts
make desktop-bootstrap   # install + preflight + prepare
make desktop-typecheck   # TypeScript check
make desktop-dev         # start Vite, Electron main build, and Electron
make desktop-build       # build renderer, native artifacts, and Electron main
make desktop-dist-dir    # package unpacked macOS app directory
```

npm equivalents:

```bash
npm run desktop:install
npm run desktop:preflight
npm run desktop:prepare
npm run desktop:bootstrap
npm run desktop:typecheck
npm run desktop:dev
npm run desktop:build
npm run desktop:dist:dir
```

`npm run dev` remains a shorthand for `npm run desktop:dev`.

## Desktop update checks

Desktop startup checks the continuous release manifest at
`https://github.com/gosvig123/gappd/releases/download/main-latest/latest.json`.
If the manifest version is newer than the packaged app version, the header shows
a manual update button that opens the `main-latest` release page in the browser.
Offline or failed checks are ignored so the app remains usable.

Pushes to `main` publish macOS arm64 DMGs to the moving `main-latest` release.
When Apple signing secrets are configured, CI signs and notarizes the app;
otherwise it publishes an unsigned development DMG so main-push releases still
complete. CI sets the app version to `0.1.<run_number>` for those builds and
uploads a matching `latest.json` manifest.

Set `GAPPD_UPDATE_CHECK_URL` to point at compatible JSON with `version` plus
`releaseUrl` or `downloadUrl` when testing a different release manifest.

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
- Whisper model at `~/.gappd/models/ggml-base.en.bin`, or pass `--model`
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
- If no model path is provided to `gappd listen`, it looks for a Whisper model at `~/.gappd/models/ggml-base.en.bin`.

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
