# Gappd

Gappd is a local-first macOS meeting application. Recording, transcription, meeting history, model setup, and settings remain usable without a cloud identity or Google Calendar connection.

## Language

**Meeting**:
A user-initiated local recording with its derived transcript and meeting data.

**Screen video**:
Optional local capture of a user-selected window or display, retained as part of one Meeting for synchronized replay.

**Person**:
A saved identity that can be assigned to speakers in multiple meetings.

**Meeting speaker**:
A voice identified within one meeting, optionally linked to a saved person.

**Voice suggestion**:
A likely **Person** for an unlabeled **Meeting speaker**, based on voice similarity, that the user confirms or ignores.

**Calendar invitee**:
A person listed on a calendar event whose attendance and voice identity still need confirmation.

**Google Calendar connection**:
Read-only authorization for one Google account's primary calendar, with independent synchronization, errors, reconnect, and disconnect behavior.

**Cloud upload consent**:
Explicit permission to sync Meeting text from this Mac under one Gappd account authorization.

## Relationships

- A Gappd identity and a **Google Calendar connection** are separate and neither gates local app features.
- **Screen video** is enabled before a Meeting and requires a fresh source choice for each Meeting; video failure does not stop its audio recording, and deleting the Meeting removes its managed video but not any exported copy.
- A finalized **Screen video** is encoded again as HEVC in the background (AC power, no Meeting recording) with the same timeline; the managed movie is replaced only when the new one is complete and smaller.
- Live Transcript chunks are provisional copies of the Meeting audio; they are deleted when the recording ends, and a background pass deletes leftovers of interrupted recordings.
- Once a Meeting is idle (captured, processing finished, speaker labeling not waiting or running), its `mic.wav` and `system.wav` are replaced by lossless `mic.flac` and `system.flac` copies with the same frame count; readers prefer the FLAC when it exists.
- Each **Google Calendar connection** owns its encrypted on-device tokens and Calendar cache.
- **Cloud upload consent** is separate from sign-in, survives app restarts and token refresh, and never transfers to another account authorization; turning sync off or reconnecting clears it, while destructive cloud actions require separate one-use confirmation.
- Deleting a **Meeting** that was synced also deletes its cloud copy: the deletion is recorded on this Mac first and sent while **Cloud upload consent** is active.
- Assigning a **Person** to a **Meeting speaker** names their transcript turns and refreshes the meeting's summary.
- Renaming a **Person** or merging two People refreshes the transcript and summary of each **Meeting** whose shown name changes. A merge moves speaker labels and voice evidence to the kept **Person**, which keeps one email; two People with different emails are never suggested as duplicates.
- Explicitly labeling clean remote speech can supply local voice evidence for future **Meeting speaker** auto-fill; automatic labels never supply training evidence, and correction or removal retracts the affected evidence.
- Voice evidence needs at least 15 seconds of clean speech (good quality, no overlap) and comes from the whole speaker's voice; one unclear span no longer rejects the speaker.
- A **Voice suggestion** considers every Person with voice evidence, but never labels a speaker, changes the transcript, or adds voice evidence; confirming it is a manual label. Closer voices are auto-filled instead.
- Speaker auto-fill uses confirmed **Calendar invitee** emails as a candidate constraint, or a manually confirmed remote **Person** and previous confirmed coattendance; Calendar alone never identifies a voice.
- A **Meeting** can retain a calendar event snapshot to suggest **Calendar invitees** when labeling speakers.
- Disconnecting one **Google Calendar connection** removes only that account's authorization and Calendar cache; existing **Meetings** and their confirmed Calendar snapshots remain.
- The renderer receives Calendar snapshots and account operations, never Google tokens.
- The desktop app exchanges and refreshes Google tokens directly with Google; no Gappd server receives Google tokens or Google user data.
- Meeting notes are optional. Every **Meeting** gets a transcript from the Apple speech model, which downloads by itself; notes need a chosen AI provider: Local AI on this Mac or Installed Codex. Skipping notes leaves transcripts only.
- Gappd finds Installed Codex itself (the newest install, including the copy inside the ChatGPT app); users never type its path.
- Installed Codex operations use one model and one reasoning effort from the installed Codex model catalog; an unset model uses the app default, and Gappd never substitutes a model or effort the catalog does not advertise.
- Gappd suggests Calendar events that overlap a **Meeting**; only the user's choice links one, and a suggestion never confirms attendance or identifies a **Meeting speaker**.

## Example dialogue

> **Dev:** "Does connecting Google change recording behavior?"
> **Domain expert:** "No. Calendar access is read-only and recording remains user-initiated."

## Flagged ambiguities

No durable domain ambiguities are currently unresolved.
