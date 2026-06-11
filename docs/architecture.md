# gappd Architecture

## Directory Structure

```
gappd/
├── cmd/gappd/             # Cobra CLI and desktop app subcommands
├── internal/
│   ├── ai/                # Ollama client, prompts, extraction/synthesis pipeline
│   ├── capture/           # macOS recording wrapper around capture-helper
│   ├── config/            # TOML config loading and validation
│   ├── db/                # SQLite schema, migrations, meeting/segment queries
│   ├── recording/         # recording lifecycle: capture → transcribe → enhance
│   └── transcribe/        # local whisper CLI wrapper
├── desktop/               # Electron app, managed Ollama/Whisper runtime setup
├── capture-helper/        # Swift ScreenCaptureKit helper app
├── docs/                  # Architecture and release docs
└── Makefile               # Go/capture-helper build helpers
```

## Product Shape

```
Electron UI ──IPC──▶ Go CLI app commands ──▶ SQLite
     │                    │                     ▲
     │                    ├── capture-helper ───┘
     │                    ├── whisper-local ───▶ segments
     │                    └── Ollama ──────────▶ summary
     └── managed Ollama/Whisper setup
```

The desktop app owns user-facing setup and runtime management. It downloads and starts managed Ollama, downloads/builds Whisper assets, and calls machine-readable `gappd app ...` commands over IPC.

The Go CLI owns capture orchestration, transcription, AI post-processing, and SQLite persistence. The CLI can also run standalone when the user provides external Ollama and Whisper runtime dependencies.

## Data Flow

1. User starts a recording from desktop or `gappd listen`.
2. Go creates a `meetings` row with capture status `recording`.
3. `capture-helper` records mic/system WAV files into the session directory.
4. Stop signal marks capture `captured` and processing `processing`.
5. `whisper-local` transcribes available audio streams into timestamped segments.
6. Segments are stored in SQLite.
7. Ollama runs extraction then synthesis prompts over the transcript.
8. Summary, transcript text, and lifecycle status are saved on the meeting.

## Component Responsibilities

### `cmd/gappd`

Cobra commands for humans (`listen`, `devices`, `meetings`, `show`, `enhance`, `setup`) and desktop IPC (`app ... --json`). It loads config, opens SQLite, and delegates core work to internal packages.

### `internal/recording`

Coordinates one recording session. It creates the session directory, starts capture, persists lifecycle status, transcribes audio streams, stores segments, runs enhancement, and emits desktop events when used by `gappd app record start`.

### `internal/capture`

Wraps the macOS Swift `capture-helper` app. Capture modes are `mic`, `system`, and `both`. Output is WAV files consumed after recording stops.

### `internal/transcribe`

Shells out to the configured local `whisper-local` binary. It parses Whisper output into timestamped segments and assigns speakers based on source stream.

### `internal/ai`

Ollama-only inference. The pipeline runs two prompts: extraction to JSON, then synthesis to human-readable meeting notes.

### `internal/db`

SQLite storage using `modernc.org/sqlite`. Schema source of truth lives in `internal/db/schema.sql`. Tables: `meetings`, `segments`, `migrations`, plus FTS5 table/triggers for meeting search.

### `desktop/`

Electron renderer, preload IPC bridge, and main-process runtime management. Main process owns native process calls, managed Ollama, managed Whisper, onboarding, update checks, and app command IPC.

## Configuration

Config lives at `~/.gappd/config.toml`; missing config falls back to defaults.

```toml
db_path = "~/.gappd/db.sqlite"

[ai]
provider = "ollama"
model = "llama3.1:8b"
endpoint = "http://localhost:11434"
temperature = 0.3
```

Current validation rules:

- `ai.provider` must be `ollama`
- `ai.model` and `ai.endpoint` must be non-empty
- `ai.temperature` must be between `0` and `2`
- `db_path` must be set and may use `~`

## Boundaries

- Desktop setup can manage bundled runtimes; CLI setup only checks externally available dependencies.
- Transcription is local Whisper only.
- AI inference is Ollama only.
- No Bubbletea TUI, cloud STT, OpenAI, or Claude integration exists in current code.
