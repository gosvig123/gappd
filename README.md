# grn — Meeting intelligence from the terminal

`grn` records meeting audio, transcribes it locally, stores transcripts in SQLite,
and can run Ollama-based summarization and extraction over saved meetings.

## Current surface area

- Terminal CLI only
- Local SQLite database at `~/.grn/db.sqlite` by default
- Local transcription via `whisper-local`
- AI provider support: `ollama`
- Meeting capture, listing, search, display, and post-processing commands
- Basic action-item and CI placeholder commands are present in the CLI

## Requirements

- Go `1.25.0` (from `go.mod`)
- Ollama running locally if you want AI summaries/extraction
- On macOS, the capture helper for `grn listen`

## Install

```bash
git clone https://github.com/grn-dev/grn.git
cd grn
make build
make install
```

This builds `./build/grn` and installs `grn` to `/usr/local/bin/grn`.

### macOS capture helper

`grn listen` uses the ScreenCaptureKit helper on macOS. Build and install it with:

```bash
make install-capture
```

That installs `GrnCapture.app` to `~/.grn/GrnCapture.app`.

## Commands

```bash
grn setup
grn devices
grn listen [--device N] [--title TITLE] [--model /path/to/model.bin] [--mode mic|system|both]
grn meetings
grn show <meeting-id>
grn search <query>
grn enhance <meeting-id> [--notes "rough notes"]
grn summarize <meeting-id>
grn actions list
grn actions done <id>
grn ci status
grn ci run
```

Notes:

- `grn` by itself does not launch a dashboard.
- There is no global `--json` output mode.
- `grn summarize` is an alias for running the AI pipeline on an existing meeting.
- `grn listen` stops with `Ctrl+C`.
- If no model path is provided to `grn listen`, it looks for a Whisper model at `~/.grn/models/ggml-base.en.bin`.

## Quick start

1. Copy the example config:

   ```bash
   mkdir -p ~/.grn
   cp config.example.toml ~/.grn/config.toml
   ```

2. Make sure Ollama is running and the configured model is available.

3. Run setup:

   ```bash
   grn setup
   ```

4. List devices and start a recording:

   ```bash
   grn devices
   grn listen --title "Sprint planning"
   ```

## Configuration

Config lives at `~/.grn/config.toml`. Unknown keys are rejected.

```toml
db_path = "~/.grn/db.sqlite"

[audio]
backend = "screencapturekit"
sample_rate = 16000
channels = 1

[transcription]
engine = "whisper-local"
model = "base.en"
language = "en"

[ai]
provider = "ollama"
model = "llama3.1:8b"
endpoint = "http://localhost:11434"
temperature = 0.3

[ci]
enabled = false
poll_interval = "15m"
reminders = true
watched_repos = []

[integrations]
github_token = ""
```

Current validation rules to be aware of:

- `db_path` must be set; `~` and `~/...` are expanded
- `transcription.engine` must be `whisper-local`
- `ai.provider` must be `ollama`
- `ai.model` and `ai.endpoint` must be non-empty
- `ai.temperature` must be between `0` and `2`
- `ci.poll_interval` must be a valid Go duration if set

See `config.example.toml` for the full example, including optional commented fields.

## Development

```bash
go test ./...
go build ./cmd/grn
```

## License

MIT
