# gappd Context

gappd records meetings on macOS and turns local audio into transcripts and summaries through desktop-managed local inference.

## Language

**Local AI**:
Private on-device inference capability used by gappd to transcribe and summarize meetings.
_Avoid_: cloud AI, remote AI

**Managed Runtime**:
Desktop-owned llama.cpp and Apple Speech binaries, processes, and model assets used for **Local AI** summarization and transcription.
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

**Meeting Reprocessing**:
An explicit retry, refinement, or enhancement that moves completed or failed **Meeting Processing** back into active processing.
_Avoid_: processing start, silent retry

**Pending Meeting Processing**:
Durable work remains for captured meeting artifacts, but no worker currently owns that work.
_Avoid_: not started, waiting stage

**Live Transcript**:
Accumulated provisional transcription shown during recording from processed audio chunks.
_Avoid_: final transcript, chunk transcript

## Relationships

- A **Local AI Setup Operation** prepares one **Managed Runtime**.
- A **Managed Runtime** provides **Local AI** for desktop meeting transcription and summarization.
- Desktop workflows always use the **Managed Runtime**; command-line workflows may use user-configured local dependencies.
- A healthy **Managed Runtime** should be shared instead of starting duplicate llama.cpp servers.
- A **Meeting Recording Workflow** preserves captured audio even when **Local AI** is unavailable; **Meeting Processing** may run later through **Meeting Reprocessing**.
- Captured audio remains durable after **Meeting Processing** and is deleted when its meeting is deleted, preserving source material for future **Meeting Reprocessing**.
- A **Meeting Lifecycle** defines valid meeting capture and processing state transitions and user-facing state derived from persisted meeting rows.
- **Meeting Processing** uses **Local AI** to turn captured audio or stored transcript into persisted transcripts and summaries.
- **Pending Meeting Processing** derives its next work from persisted artifacts: audio without transcript needs transcription; transcript without summary needs summarization.
- A **Live Transcript** becomes the persisted transcript only when every captured audio chunk was processed without failure or dropped events; otherwise **Meeting Processing** rebuilds it from durable audio.
- **Live Transcript** audio windows overlap for recognition context, and each window owns a non-overlapping canonical time range; conservative same-speaker phrase-containment reconciliation removes exact or contained boundary repeats, while differently worded fragments remain distinct to avoid deleting legitimate speech.
- **Meeting Reprocessing** explicitly restarts completed or failed **Meeting Processing** for retry, refinement, or enhancement.
- `llama-server` provides meeting summarization through **Local AI**.

## Example dialogue

> **Dev:** "Should settings call the Whisper downloader directly?"
> **Domain expert:** "No — settings should ask the **Local AI Setup Operation** to repair the **Managed Runtime**."

## Flagged ambiguities

- Real microphone and system-audio validation confirmed strict contained boundary repeats can be reconciled, but differently worded fragments such as `Confirmation number seven.` / `number 742.` cannot be safely merged without word timing; broad fuzzy reconciliation remains intentionally unresolved.
- `context.md` is a stale code-scout scratch file, not the project glossary. Use `CONTEXT.md` for domain language.
