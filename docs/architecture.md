# gappd Architecture

## Directory Structure

```
gappd/
├── cmd/
│   └── gappd/              # CLI entrypoint, cobra commands
├── internal/
│   ├── db/               # SQLite schema and queries
│   ├── capture/          # System audio capture (macOS)
│   ├── transcribe/       # Whisper.cpp / Deepgram / AssemblyAI
│   ├── ai/               # LLM summarization + extraction
│   ├── tui/              # Bubbletea screens and components
│   └── config/           # TOML config parsing and defaults
├── docs/                 # Architecture and design docs
└── go.mod
```

## Data Flow

```
┌──────────┐    ┌─────────────┐    ┌────────────┐    ┌────────────┐
│  System   │───▶│ Transcribe  │───▶│  AI Layer  │───▶│   SQLite   │
│  Audio    │    │  (STT)      │    │ (summarize │    │  Storage   │
│  Capture  │    │             │    │  + extract)│    │            │
└──────────┘    └─────────────┘    └────────────┘    └────────────┘
```

1. **Capture** records system audio via ScreenCaptureKit (macOS)
2. **Transcribe** converts audio chunks to text (local Whisper.cpp or cloud STT API)
3. **AI** sends transcript to LLM and returns structured notes
4. **DB** persists meetings, transcripts, summaries, and transcript segments

## Component Responsibilities

### `cmd/gappd`
Entry point. Cobra root command with subcommands such as `listen`, `devices`,
`meetings`, `show`, `enhance`, `summarize`, `setup`, and `app`. Parses flags,
loads config, delegates.

### `internal/db`
Schema: `meetings`, `segments`, `migrations`, and `meetings_fts`. Uses
modernc.org/sqlite (pure Go). Provides typed query functions. Initializes from
embedded `internal/db/schema.sql`.

### `internal/capture`
Audio capture behind a `Recorder` interface.
Returns `io.Reader` of PCM/WAV chunks. macOS impl uses ScreenCaptureKit
via cgo bridge (pmoust/audiorec for system audio, malgo for mic).

### `internal/transcribe`
`Transcriber` interface with implementations: `WhisperLocal` (whisper.cpp
binary), `Deepgram`, `AssemblyAI`. Accepts audio chunks, returns
timestamped segments. Handles streaming where supported.

### `internal/ai`
`Summarizer` interface. Implementations for OpenAI, Claude, Ollama.
Two-phase prompt: (1) structured summary, (2) action extraction.
Returns `Summary` and `[]Action` structs. Configurable model/temperature.

### `internal/tui`
Bubbletea app with screen-based navigation. Shared layout with header,
content area, status bar. Each screen is a `tea.Model`.

### `internal/config`
Loads `~/.gappd/config.toml`, merges with defaults and env vars.
Validates required fields. Exposes typed `Config` struct.

## TUI Screens

### Dashboard (default)
Split layout: upcoming meetings and recent meeting activity. Keybinds for quick nav.

### Meeting List
Filterable table of all meetings. Columns: date, title, duration, and status.
Enter opens detail.

### Meeting Detail
Tabbed view: Summary | Transcript. Summary shows AI output.
Transcript shows timestamped segments.

### Navigation

```
Dashboard ──▶ Meeting List ──▶ Meeting Detail
```

Global: `?` help, `q` back/quit, `tab` cycle focus, `:` command mode.

## Configuration

`~/.gappd/config.toml`:

```toml
[audio]
backend = "screencapture"   # macOS ScreenCaptureKit
sample_rate = 16000
format = "wav"

[transcription]
engine = "whisper_local"    # "whisper_local" | "deepgram" | "assemblyai"
model = "base.en"           # whisper model size
api_key = ""                # for cloud engines

[ai]
provider = "openai"         # "openai" | "claude" | "ollama"
model = "gpt-4o"
api_key = ""
temperature = 0.3
base_url = ""               # for ollama or proxies

[integrations]
slack_webhook = ""
```

Env var override pattern: `GAPPD_AI_API_KEY` overrides `ai.api_key`.
