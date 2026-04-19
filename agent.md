# agent.md — gappd

## What is gappd?

Meeting intelligence from the terminal. Record meeting audio, transcribe locally,
store transcripts in SQLite, and run Ollama-based summarisation/extraction.

## Tech stack

| Layer | Tech |
|---|---|
| Language | Go 1.25 |
| CLI | `spf13/cobra` |
| Database | SQLite via `modernc.org/sqlite` (pure Go), WAL mode, FTS5 for search |
| Config | TOML (`~/.gappd/config.toml`), parsed with `BurntSushi/toml` |
| AI | Ollama (local LLM inference), pipeline-based prompts |
| Transcription | Local whisper binary (`whisper-local`) |
| Audio capture | macOS ScreenCaptureKit helper (Swift, `capture-helper/`) |
| Build | Makefile — `make build`, `make install`, `make dev` (watchexec) |

## Project layout

```
cmd/gappd/           CLI entry point & command definitions
  main.go          root command, setup, search, actions, ci sub-commands
  commands.go      enhance, meetings, show, summarize commands
  listen.go        listen (record) & devices commands
  helpers.go       shared CLI helpers (loadDeps, formatTranscript, etc.)

internal/
  ai/              LLM inference layer
    provider.go    InferenceProvider interface + factory
    ollama.go      Ollama implementation
    pipeline.go    Multi-step AI pipeline (summarise, extract, etc.)
    prompts.go     Prompt templates
  capture/         Audio capture (macOS)
    capture.go     ScreenCaptureKit integration
    recorder.go    WAV recording logic
  config/          TOML config loading
    config.go      Config struct & Load()
  db/              SQLite storage
    db.go          DB connection & migrations
    schema.go      Programmatic schema init
    schema.sql     Full DDL (tables, FTS, triggers, indexes)
    meetings.go    Meeting CRUD
    segments.go    Transcript segment CRUD
  transcribe/      Local whisper transcription
    whisper.go     Whisper binary wrapper

capture-helper/    macOS Swift helper app (ScreenCaptureKit)
docs/              Design docs (architecture, capture, inference, resilience)
```

## Key commands

```
gappd setup              Interactive first-run configuration
gappd listen             Record & transcribe a meeting (mic/system/both)
gappd devices            List audio devices
gappd meetings           List stored meetings
gappd show <id>          Display a meeting transcript + summary
gappd search <query>     FTS5 full-text search over meetings
gappd enhance <id>       Run AI extraction pipeline on a transcript
gappd summarize <id>     Generate an AI summary
gappd actions            Action item management
gappd ci                 CI check stubs
```

## Database

- Default path: `~/.gappd/db.sqlite`
- Schema in `internal/db/schema.sql`
- Tables: `meetings`, `segments`, `action_items`, `participants`, `ci_checks`, `templates`, `migrations`
- FTS5 virtual table `meetings_fts` on `title, transcript, summary` with insert/update/delete triggers
- All timestamps are ISO 8601 UTC strings

## Build & test

```bash
make build          # → ./build/gappd
make install        # → /usr/local/bin/gappd
make dev            # watchexec live reload
make db-reset       # drop + recreate local DB
go test ./...       # run all tests
```

## Contributor workflow note

- `pnpm dev` at the repo root is only a convenience shim into `desktop` dev.
- Do not treat this repo as a pnpm workspace.
- `desktop` dependency installation and packaging/release commands remain npm-based.

## Conventions

- **Errors**: wrap with `fmt.Errorf("context: %w", err)`, return early
- **Packages**: thin `cmd/` layer delegates to `internal/` packages
- **Config**: all runtime config flows through `config.Config`; no globals
- **AI provider**: new providers implement `ai.InferenceProvider` interface
- **SQL**: use parameterised queries, never string-interpolate user input
- **Schema changes**: add migration entry to `migrations` table; keep `schema.sql` as source of truth
- **Tests**: place `_test.go` next to the code; use table-driven tests where sensible
- **Commits**: small, focused; one logical change per commit
