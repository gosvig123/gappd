# Speaker labeling

Open a processed meeting and expand **People in this meeting**, or click a
speaker name in the transcript. Play a short clip, then choose a saved person,
select a calendar invitee, or add a name. Use another clip if the first is unclear.

Starting a recording from a calendar event saves that event with the meeting.
For other recordings, choose a suggested event near the recording time. Calendar
names and email addresses help fill the picker; an invitation does not prove
that someone attended. Calendar access is optional.

Assignments update all of that speaker's transcript turns immediately. The
previous summary remains visible while participants, action items, and summary
are regenerated from the named transcript. If processing fails, the assignment
remains saved and the normal processing recovery flow can retry.

Saved people remain available across calls. An explicit person label can enroll
clean, sufficient remote speech for local speaker auto-fill. Automatic labels
never train voice profiles. **You** and **Other** do not enroll in this version.
Email addresses reuse existing people; names alone do not merge people.

After speaker processing, the desktop can fill names before summarization.
A confirmed Calendar snapshot restricts candidates to exact invitee emails;
Calendar is never voice evidence. Without a confirmed snapshot, candidates must
come from a current manually labeled remote person and previous manually
confirmed coattendance. Global history and automatic labels cannot seed a group.
Unknown or ambiguous voices stay unnamed. Score and margin thresholds are
conservative rules, not measured accuracy guarantees.

**Auto-filled · check label** marks automatic names. Use the person menu to
correct or clear a label. Clearing a remote label stops automatic filling for
that Meeting, including retries, until that cleared label is explicitly assigned
again. It keeps the saved Person. Correction, clear, speaker reprocessing,
transcript replacement, and Meeting deletion retract affected voice samples.
Voice vectors and model/source provenance stay in the local backend database;
the renderer receives names and label provenance only.

Labeling becomes available after recording and speaker processing finish.
The generic **Other** bucket can contain multiple voices and cannot be assigned
as one person. Retrying speaker processing can clear assignments when speaker
grouping changes. Replacing the transcript clears its assignments; saved people
remain available to label the new speakers.

Clips use retained local microphone or system audio, are at most eight seconds,
and prefer speech without overlapping speakers. They are shorter when the
speaker's turn is brief. Missing audio prevents playback but does not prevent
manual labeling.

## Local app commands

All commands require `--json`. The desktop invokes these through its generated
protocol; they are also available from the local CLI.

```sh
gappd app meetings people --json
gappd app meetings assign-speaker MEETING_ID --speaker-key 'Speaker 1' \
  --name 'Sarah Chen' --email 'sarah@example.com' --json
gappd app meetings assign-speaker MEETING_ID --speaker-key 'Speaker 1' \
  --person-id PERSON_ID --json
gappd app meetings assign-speaker MEETING_ID --speaker-key 'Speaker 1' --json
gappd app meetings speaker-clip MEETING_ID --speaker-key 'Speaker 1' --index 0 --json
```

`people` returns `{people: [{id, name, email?}]}`. `assign-speaker` returns
`{meeting}`; omitting identity fields clears the assignment. Meeting details
include `speakers` and `summaryUpdating`. Each segment has a stable `speakerKey`
separate from its displayed `speaker` name. Use the key when assigning people.

`speaker-clip` returns `{audioBase64, mimeType, text, startSec}`. The text is the
source transcript passage and can extend beyond the bounded clip. Increment
`index` to select another available passage; indexes wrap around.

Person records and meeting assignments live in the local SQLite database.
Linked calendar snapshots live in the encrypted desktop store, survive Calendar
disconnection, and are removed when their meeting is deleted. Old meetings
without snapshots can only suggest events still present in the Calendar cache.

Desktop processing uses `voice-targets --after MEETING_ID --json` to page through
eligible Meetings (use an empty `--after` for the first page). It calls
`recognize-speakers MEETING_ID --revision REVISION --emails INVITEE_EMAILS
--calendar=true --json` with the confirmed snapshot constraint. With no confirmed
snapshot it passes `--calendar=false` and an empty email list. The backend rejects
stale revisions and active processing claims. Neither history reads nor Meeting
detail reads run recognition. Speaker views expose `identityOrigin` as `manual`
or `automatic` when a Person is assigned.
