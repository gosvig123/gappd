# gappd Context

gappd records meetings on macOS and turns local audio into transcripts and summaries through desktop-managed local inference.

## Language

**Local AI**:
Private on-device inference capability used by gappd to transcribe and summarize meetings.
_Avoid_: cloud AI, remote AI

**Managed Runtime**:
Desktop-owned llama.cpp, Whisper binaries, processes, and model files used for **Local AI**.
_Avoid_: external runtime, user runtime

**Local AI Setup Operation**:
Main-process workflow that turns missing, stale, or broken **Managed Runtime** state into ready **Local AI** state.
_Avoid_: onboarding script, repair flow

**Meeting Recording Workflow**:
Core workflow that records meeting audio, turns it into transcript and summary through **Local AI**, and persists meeting state.
_Avoid_: recorder service, capture command

**Meeting Processing**:
Shared workflow that turns captured audio or stored transcript into persisted transcript, title, and summary through **Local AI**.
_Avoid_: post-processing helper, enhancer wrapper

**Meeting Lifecycle**:
Rules that create, transition, and derive meeting capture, processing, and user-facing state from persisted meeting rows.
_Avoid_: legacy status mirror, status helper

## Relationships

- A **Local AI Setup Operation** prepares one **Managed Runtime**.
- A **Managed Runtime** provides **Local AI** for meeting transcription and summarization.
- A **Meeting Recording Workflow** uses **Meeting Processing** after capture.
- A **Meeting Lifecycle** defines valid meeting capture and processing state transitions and user-facing state derived from persisted meeting rows.
- **Meeting Processing** uses **Local AI** to turn captured audio or stored transcript into persisted transcripts and summaries.
- `llama-server` provides meeting summarization through **Local AI**.

## Example dialogue

> **Dev:** "Should settings call the Whisper downloader directly?"
> **Domain expert:** "No — settings should ask the **Local AI Setup Operation** to repair the **Managed Runtime**."

## Flagged ambiguities

- `context.md` is a stale code-scout scratch file, not the project glossary. Use `CONTEXT.md` for domain language.
