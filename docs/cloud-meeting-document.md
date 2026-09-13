# Cloud Meeting document — version 1

This is the contract only. No upload is implemented and every upload capability is OFF.
Real Meeting uploads stay gated by [the cloud handover](cloud-mcp-handover.md) and
[the lifecycle contract](cloud-data-lifecycle.md).

One document is the complete uploaded text of one Meeting. It is not a copy of the local
SQLite database. `ParseMeetingDocument` in `cloud/internal/service/document.go` is the
executable form of this page.

## Envelope

```json
{
  "version": 1,
  "meeting_id": "72619a1d-f713-4f46-a2b8-c74e568726b1",
  "revision": 4,
  "title": "Weekly sync",
  "started_at": "2026-09-14T12:00:00Z",
  "ended_at": "2026-09-14T12:31:00Z",
  "language": "en",
  "summary": "Prototype review.",
  "speakers": [
    { "key": "You", "label": "Kristian" },
    { "key": "Other", "label": "Sam" }
  ],
  "turns": [
    { "start_sec": 0, "end_sec": 4.5, "speaker_key": "You", "text": "Hello." },
    { "start_sec": 5, "end_sec": 9, "speaker_key": "Other", "text": "Hi there." }
  ]
}
```

`meeting_id` is the local Meeting ID. Two recordings of one Calendar event stay separate
Meetings with separate documents. `revision` is a monotonic per-Meeting counter owned by the
recording device; it never uses a wall clock, and a lower revision never replaces a higher one.

`ended_at` and `language` are optional. `speakers` may be empty only when `turns` is empty.

## Bounds

| Field | Rule |
| --- | --- |
| Raw document | 1 byte to 2 MiB |
| `version` | exactly 1 |
| `revision` | 1 to 2^31, monotonic per Meeting |
| `title` | 1 to 512 bytes |
| `summary` | 0 to 4096 bytes |
| `language` | 0 to 32 bytes |
| `speakers` | 0 to 32, `key` unique and 1 to 128 bytes, `label` 0 to 128 bytes |
| `turns` | 0 to 5000, `text` 0 to 4096 bytes each |
| Transcript total | 0 to 1 MiB of turn text |
| Turn offsets | `0 <= start_sec <= end_sec <= 86400`, ordered and non-overlapping |

Lengths are UTF-8 bytes. `encoding/json` replaces invalid UTF-8 bytes with U+FFFD, so a
decoded document is always valid UTF-8.

## Rules

1. Unknown fields are rejected at every level. The document is the privacy boundary, so a
   caller cannot add a field and rely on the cloud ignoring it.
2. Audio, Person identity, voice samples and embeddings, speaker audio previews, local
   filesystem paths, credentials, Calendar caches and Saved Agenda drafts must be absent.
   A document that carries one is invalid, not silently trimmed.
3. The cloud replaces a Meeting's document atomically. Row-by-row transcript sync is not
   used in version 1.
4. A deleted or expired cloud copy rejects later writes even when their revision is higher.

## Required schema change

The deployed `meetings.transcript` column caps UTF-8 bytes at 16384. That is a synthetic-demo
bound, not a real-Meeting bound; a 30-minute Meeting exceeds it. Migration 004 must raise the
searchable transcript projection to the 1 MiB transcript limit above, and must keep the
`title` and `summary` caps this table already matches.
