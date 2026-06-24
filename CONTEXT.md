# gappd Context

gappd records meetings on macOS and turns local audio into transcripts and summaries through desktop-managed local inference.

## Language

**Local AI**:
Private on-device inference capability used by gappd to transcribe and summarize meetings.
_Avoid_: cloud AI, remote AI

**Managed Runtime**:
Desktop-owned Ollama and Whisper binaries, processes, and model files used for **Local AI**.
_Avoid_: external Ollama, user runtime

**Local AI Setup Operation**:
Main-process workflow that turns missing, stale, or broken **Managed Runtime** state into ready **Local AI** state.
_Avoid_: onboarding script, repair flow

## Relationships

- A **Local AI Setup Operation** prepares one **Managed Runtime**.
- A **Managed Runtime** provides **Local AI** for meeting transcription and summarization.
- External Ollama configuration bypasses the **Managed Runtime** but still feeds **Local AI**.

## Example dialogue

> **Dev:** "Should settings call the Whisper downloader directly?"
> **Domain expert:** "No — settings should ask the **Local AI Setup Operation** to repair the **Managed Runtime**."

## Flagged ambiguities

- `context.md` is a stale code-scout scratch file, not the project glossary. Use `CONTEXT.md` for domain language.
