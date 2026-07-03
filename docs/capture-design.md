# Capture Pipeline Design

## Current Pipeline

`gappd` is botless: it records local Mac audio instead of joining calls.

```
Mic/System audio ──▶ capture-helper ──▶ WAV files ──▶ whisper-local ──▶ SQLite segments ──▶ llama.cpp notes
```

## Implemented Design

### Capture

- User starts capture explicitly from desktop or `gappd listen`.
- Capture runs until `Ctrl+C` or desktop stop signal.
- Capture modes: `mic`, `system`, `both`.
- macOS helper app uses ScreenCaptureKit and writes session audio files.
- Go service treats missing/empty streams as absent audio and continues when at least one stream transcribes.

### Transcription

- Transcription happens after recording stops.
- `internal/transcribe` shells out to configured `whisper-local` binary.
- Default model path is `~/.gappd/models/ggml-base.en.bin` unless caller passes `--model`.
- Segments receive source-derived speaker labels: `You` for mic and `Other` for system.
- Segments persist in SQLite before AI enhancement runs.

### Enhancement

- llama.cpp is the only AI runtime.
- Enhancement runs two stages:
  1. extract participants, topics, decisions, actions, questions, and sentiment as JSON;
  2. synthesize meeting notes from extracted JSON and optional user notes.
- CLI command: `gappd enhance <meeting-id> [--notes ...]`.

## Session Lifecycle

```
start
  │
  ├─ create session directory
  ├─ create meeting row: capture=recording, processing=not_started
  ├─ start capture-helper recorder
  ├─ wait for stop signal
  ├─ mark capture=captured, processing=processing
  ├─ transcribe mic/system WAV files
  ├─ insert segments
  ├─ run llama.cpp extraction/synthesis
  └─ save transcript, summary, processing=completed
```

Failure states are persisted on the meeting row:

| Failure | Stored status |
|---|---|
| Capture start/stops unexpectedly | `capture=failed` |
| No captured audio | `capture=failed` |
| Whisper model missing | `processing=failed` |
| Transcription error | `processing=failed` |
| llama.cpp/enhancement error | `processing=failed`, transcript retained |

## Storage

- Default DB: `~/.gappd/db.sqlite`.
- Session audio directory is stored on each meeting as `audio_path`.
- Transcript segments live in `segments`.
- Human-readable transcript and summary live on `meetings`.
- FTS5 indexes title, transcript, and summary for search.

## Code Map

```
internal/recording/
├── service.go      # session lifecycle and status transitions
├── audio.go        # recorder/audio helpers
└── transcript.go   # transcription, segment storage, enhancement

internal/capture/
├── capture.go      # device/capture-helper integration
└── recorder.go     # recorder process wrapper and output paths

internal/transcribe/
└── whisper.go      # whisper-local execution and parsing

internal/ai/
├── openai_compat.go # llama-server HTTP client
├── pipeline.go     # extraction/synthesis orchestration
└── prompts.go      # prompt templates
```

## Not Implemented

These ideas are out of current scope and must not be documented as active behavior:

- cloud STT providers such as Deepgram or AssemblyAI;
- OpenAI or Claude AI providers;
- live streaming transcript UI;
- Bubbletea recording dashboard;
- Linux/PipeWire capture;
- CoreAudio process-tap fallback;
- automatic meeting-app detection;
- action-item persistence outside generated notes.
