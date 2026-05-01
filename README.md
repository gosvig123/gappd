# gappd — Meeting intelligence from the terminal

`gappd` records meeting audio, transcribes it locally, stores transcripts in SQLite,
and can run Ollama-based summarization and extraction over saved meetings.

## Current surface area

- Terminal CLI only
- Local SQLite database at `~/.gappd/db.sqlite` by default
- Local transcription via `whisper-local`
- AI provider support: `ollama`
- Meeting capture, listing, display, and post-processing commands

## Requirements

- Go `1.25.0` (from `go.mod`)
- Ollama running locally if you want AI summaries/extraction
- On macOS, the capture helper for `gappd listen`

## Install

```bash
git clone https://github.com/gappd-dev/gappd.git
cd gappd
make build
make install
```

This builds `./build/gappd` and installs `gappd` to `/usr/local/bin/gappd`.

### macOS capture helper

`gappd listen` uses the ScreenCaptureKit helper on macOS. Build and install it with:

```bash
make install-capture
```

That installs `GappdCapture.app` to `~/.gappd/GappdCapture.app`.

## Commands

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

## Quick start

1. Copy the example config:

   ```bash
   mkdir -p ~/.gappd
   cp config.example.toml ~/.gappd/config.toml
   ```

2. Make sure Ollama is running and the configured model is available.

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

Current validation rules to be aware of:

- `db_path` must be set; `~` and `~/...` are expanded
- `ai.provider` must be `ollama`
- `ai.model` and `ai.endpoint` must be non-empty
- `ai.temperature` must be between `0` and `2`

See `config.example.toml` for the full example, including optional commented fields.

## Development

```bash
go test ./...
go build ./cmd/gappd
```

Desktop note:

- Use `npm run dev` from `desktop/` for desktop development.
- This repo is not a pnpm workspace.
- For `desktop` dependency install and packaging/release commands, keep using `npm` inside `desktop/`.

## License

MIT
