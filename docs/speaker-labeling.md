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

Saved people remain available across calls. This release requires selecting
the person in each call; automatic recognition from voice profiles is not yet
implemented. Email addresses reuse existing people; names alone do not merge
people. Clearing a label unlinks that speaker without deleting the saved person.

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
