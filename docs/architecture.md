# gappd Architecture

gappd is a macOS desktop application that records meeting audio, transcribes it with Apple SpeechTranscriber, labels remote speakers, and generates notes with local llama.cpp inference.

## System map

```text
Electron renderer
    │ typed preload IPC
    ▼
Electron main process
    ├── permissions, meeting detection, updates
    ├── Managed Runtime and processing drains
    └── `gappd app ...` machine protocol
             │
             ▼
        Go meeting engine ───────────────▶ SQLite + FTS5
             │
             ├── GappdCapture.app ──────▶ mic/system WAV + chunk events
             ├── GappdSpeechTranscriber.app ─▶ Apple Speech transcript
             ├── gappd-diarizer ────────▶ meeting-local speaker windows
             └── llama-server ──────────▶ extraction + summary
```

All inference stays on the Mac. Network access is used for application updates and model downloads.

## Responsibilities

### Electron desktop

`desktop/src/renderer` owns user interface state. A context-isolated preload exposes typed Inter-Process Communication (IPC) operations from `desktop/src/shared/ipc-contract.ts`.

`desktop/src/main` owns operating-system integration and process orchestration:

- capture and speech permissions;
- meeting presence detection and assisted stop;
- native binary resolution and recording process control;
- managed llama.cpp and Apple Speech setup;
- background processing drains and sleep handling;
- stale-recording recovery, launch-at-login, and updates.

### Go meeting engine

`cmd/gappd` contains human commands and the machine-readable `gappd app ...` protocol used by Electron. Core behavior lives under `internal/`:

- `recording`: recording workflow and capture events;
- `capture`: Swift capture-helper process boundary;
- `livetranscript`: provisional chunk transcription and reconciliation;
- `meetingprocessing`: durable transcription, diarization, and summarization queue;
- `meetinglifecycle`: valid capture and processing transitions;
- `transcribe`: Apple SpeechTranscriber process boundary;
- `diarize`: diarizer process boundary and speaker projection;
- `ai`: llama.cpp-compatible extraction and synthesis;
- `db`: SQLite schema, migrations, queries, and full-text search;
- `appprotocol`: machine-readable desktop contracts.

`cmd/gen-protocol` generates TypeScript status, event, and command definitions from Go-owned protocol types. `make check-protocol` detects contract drift.

### Native helpers

- `capture-helper/`: Swift ScreenCaptureKit application that captures microphone and system audio, writes durable WAV artifacts, and emits chunk events.
- `apple-speech-transcriber/`: Swift application that prepares Apple speech assets and transcribes audio locally.
- `gappd-diarizer/`: Swift executable using FluidAudio and bundled models to group remote speech into meeting-local speaker labels.
- `desktop/resources/llamacpp/`: bundled llama.cpp runtime started on demand for summarization.

## Meeting flow

```text
meeting detected or manual start
    ↓
permission check; pause background processing
    ↓
capture mic/system audio to session directory
    ↓
show provisional Live Transcript from chunk events
    ↓
mark capture complete and enqueue durable Meeting Processing
    ↓
transcribe durable audio if needed
    ↓
apply optional Speaker Diarization
    ↓
extract structured facts and synthesize summary
    ↓
persist searchable meeting; resume background processing
```

Recording preempts diarization and summarization. Interrupted background work returns to the queue instead of competing with capture.

## Persistence

State lives under `~/.gappd/` by default:

- `config.toml`: database and managed local-inference configuration;
- `db.sqlite`: meetings, segments, lifecycle state, claims, and FTS5 index;
- session directories: durable microphone and system-audio artifacts;
- managed model assets.

`internal/db/schema.sql` is the current schema source of truth. Meeting rows hold capture, processing, and diarization state; segment rows hold transcript timing, source, and speaker projection.

Deleting a meeting also deletes its managed audio artifacts. Captured audio otherwise remains available for recovery and explicit reprocessing.
