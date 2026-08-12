# gappd Context

gappd records meetings on macOS and turns local audio into transcripts and summaries through desktop-managed local inference by default, with optional external Codex summarization.

## Language

**Local AI**:
Private on-device inference capability used by gappd to transcribe and summarize meetings.
_Avoid_: cloud AI, remote AI

**Managed Runtime**:
Desktop-owned llama.cpp and Apple Speech binaries, processes, and model assets used for **Local AI** summarization and transcription.
_Avoid_: external runtime, user runtime

**Installed Codex**:
Optional user-installed and authenticated Codex CLI used only for remote meeting summarization through its configured absolute executable path.
_Avoid_: bundled Codex, Pi provider host

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

**Speaker Diarization**:
Grouping remote speech into stable anonymous speakers within one meeting, separate from identifying participants by name.
_Avoid_: speaker identification, voice recognition

**Speaker Label**:
Automatic experimental meeting-local `Speaker N` marker for remote speech attributed to an anonymous speaker cluster; it is not participant identity and remains fixed after completion in minimal v1.
_Avoid_: participant name, speaker identity

**Degraded Diarization**:
Terminal speaker-enrichment outcome that preserves a usable `You` / `Other` transcript and permits summary generation when the automatic run is unavailable or fails.
_Avoid_: failed meeting, failed transcript

**Not Requested Diarization**:
Eligible speaker enrichment intentionally never scheduled; transcript remains `You` / `Other` and minimal v1 does not process it later.
_Avoid_: degraded diarization, failed diarization

**Speaker Count**:
Number of attributed people who spoke: `You` when mic speech exists plus visible remote **Speaker Labels**, excluding unattributed `Other` speech.
_Avoid_: attendee count, detected cluster count

## Relationships

- A **Local AI Setup Operation** prepares one **Managed Runtime**.
- A **Managed Runtime** provides **Local AI** for desktop meeting transcription and summarization.
- Desktop workflows use the **Managed Runtime** for transcription and use **Local AI** for summaries by default; **Installed Codex** may replace only summary inference when explicitly selected.
- A healthy **Managed Runtime** should be shared instead of starting duplicate llama.cpp servers.
- A **Meeting Recording Workflow** preserves captured audio even when **Local AI** is unavailable; **Meeting Processing** may run later through **Meeting Reprocessing**.
- Captured audio remains durable after **Meeting Processing** and is deleted when its meeting is deleted, preserving source material for future **Meeting Reprocessing**.
- A **Meeting Lifecycle** defines valid meeting capture and processing state transitions and user-facing state derived from persisted meeting rows.
- **Meeting Processing** keeps transcription local, then uses the selected summary provider to turn a stored transcript into persisted title, extraction, and summary.
- **Installed Codex** reuses the user's existing Codex login; Gappd sends transcript text through the configured CLI but never sends recorded audio.
- **Pending Meeting Processing** derives its next work from persisted artifacts: audio without transcript needs transcription; transcript without summary needs summarization.
- Production **Speaker Labels** and **Speaker Count** are generated automatically and shown as experimental; manual review is development-only evaluation, not a user workflow.
- **Meeting Processing** exposes a persisted `You` / `Other` transcript before **Speaker Diarization**, then atomically refreshes remote labels before summary generation.
- **Speaker Diarization** relabels existing transcript phrases without changing their text, timing, source, or segment identity; uncertain phrases remain `Other`.
- Minimal v1 allows one manual **Speaker Diarization** Retry only after an initial **Degraded Diarization**; completed and **Not Requested Diarization** stay fixed.
- Page search ignores visible **Speaker Labels**, because anonymous labels have no cross-meeting identity.
- Meeting summaries may cite **Speaker Labels** as experimental meeting-local references when distinguishing viewpoints.
- **Meeting Recording** preempts **Speaker Diarization** and summary generation so capture remains reliable; interrupted diarization requeues without becoming degraded.
- **Speaker Diarization** continues while app is hidden, but system sleep cancels and requeues active work without losing transcript state.
- Automatic **Speaker Diarization** defaults On in every build; turning it Off affects future meetings only and preserves existing **Speaker Labels**.
- Development, Beta, and Stable releases use identical **Speaker Diarization** behavior; release channel changes update audience, not domain semantics.
- A **Live Transcript** becomes the persisted transcript only when every captured audio chunk was processed without failure or dropped events; otherwise **Meeting Processing** rebuilds it from durable audio.
- **Live Transcript** audio windows overlap for recognition context, and each window owns a non-overlapping canonical time range; conservative same-speaker phrase-containment reconciliation removes exact or contained boundary repeats, while differently worded fragments remain distinct to avoid deleting legitimate speech.
- **Meeting Reprocessing** explicitly restarts completed or failed **Meeting Processing** for retry, refinement, or enhancement.
- `llama-server` provides meeting summarization through **Local AI**.

## Example dialogue

> **Dev:** "Should settings prepare Apple Speech assets directly?"
> **Domain expert:** "No — settings should ask the **Local AI Setup Operation** to repair the **Managed Runtime**."

## Flagged ambiguities

- Real microphone and system-audio validation confirmed strict contained boundary repeats can be reconciled, but differently worded fragments such as `Confirmation number seven.` / `number 742.` cannot be safely merged without word timing; broad fuzzy reconciliation remains intentionally unresolved.
- `context.md` is a stale code-scout scratch file, not the project glossary. Use `CONTEXT.md` for domain language.
