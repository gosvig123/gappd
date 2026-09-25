# Cloud Meeting document — version 1

This is the Meeting text document contract. Desktop uploads require the
`GAPPD_MEETING_UPLOAD_ENABLED` build/runtime capability, a connected upload account, and
separate explicit upload consent. See [the cloud handover](cloud-mcp-handover.md) and
[the lifecycle contract](cloud-data-lifecycle.md) for rollout and retention constraints.

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
| `summary` | 0 to 65536 bytes |
| `language` | 0 to 32 bytes |
| `speakers` | 0 to 32, `key` unique and 1 to 128 bytes, `label` 0 to 128 bytes |
| `turns` | 0 to 5000, `text` 0 to 4096 bytes each |
| Transcript total | 0 to 1 MiB of turn text |
| Turn offsets | `0 <= start_sec <= end_sec <= 86400`, ordered by start time; overlap preserves simultaneous speech |

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

## Local producer

`gappd meeting-document export <meeting-id> <revision>` prints these exact bytes for one local
Meeting. It opens the normal local store and never contacts the network. The sync queue owns the
revision: it starts at 1 and increases by one for each change it sends, so ordering never depends
on a local counter or the device clock.

Meeting speaker labels are part of the document. An unconfirmed speaker keeps its generic key
("You", "Other"), but a speaker assigned to a saved Person uploads that assigned name. That is a
Meeting speaker label, and it is the one place a person's name can reach the cloud, so the upload
consent must say so.

`internal/meetingdocument` is the local builder and `cloud/internal/service/document.go` is the
cloud validator. The two modules cannot share a type, so both tests pin the same literal bytes:
a contract change on either side fails its own test instead of silently breaking uploads.

## Automatic desktop sync

Upload consent starts an immediate scan of all completed Meetings (not only the newest 50), then a background check every
minute while the app is running. Processing completion also requests a scan. New and changed
documents join the existing durable queue; unchanged text does not create another revision.
Pending sends retry without requiring a new Meeting or an open Settings panel. An unchanged
document stops after five failed attempts; a server-refused document stops immediately.
Failed entries require an explicit per-Meeting upload to try again.

The encrypted queue stores a SHA-256 content hash for each accepted Meeting, excluding its
revision. Older queues without hashes send one new revision on the next consented scan to
establish a baseline. Hashes and queued work remain scoped to the upload account. Deleted and
expired cloud identities remain blocked by the server; edits never extend retention.

Upload consent is stored in the same encrypted on-device record as the upload account's
credentials. Startup restores only an explicitly saved opt-in for that authorization; signing
in alone never grants upload consent. Background sync resumes without opening Settings.
Destructive confirmations are one-use and are never restored.

Upload sign-in requests `offline_access` and retains the refresh token. Before an access token
expires, Gappd refreshes it and verifies that the account is unchanged. Refresh preserves
upload consent; a temporary connection failure pauses sending and retries without erasing
consent. Rotated tokens remain encrypted and unusable until identity verification succeeds.
An invalid or revoked refresh grant requires an explicit reconnect. Older connections that
discarded their refresh tokens need one reconnect to obtain offline access.

Turning sync off or removing consent stops the background timer and cancels the current send
locally. It does not delete cloud copies. Disconnecting or reconnecting the upload account
clears its saved upload consent; a new authorization never inherits a previous opt-in.

Provider contract: [Clerk OAuth and offline access](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth).

## Storage

Migration 004 puts a real copy in its own `cloud_meetings` table with 1 MiB `transcript`,
512-byte `title`, 4096-byte `summary` and 2 MiB `document` bounds. Migration 011 raises only
the real-copy summary limit to 65536 bytes; deploy it before enabling longer summaries. The synthetic `meetings`
table keeps its 16384-byte transcript cap, its constraints and its policies untouched, so a
real copy and a demo row never share a table or a policy.

`cloud_meetings.id` is `meeting_copy_id(owner_id, local_id)` in a namespace separate from
every synthetic namespace. `meeting_lifecycle` holds the acceptance, the fixed 30-day expiry
and the permanent deletion marker, and it owns the `local_id` mapping.

An insert must find a live accepted lifecycle row; the trigger never creates one. A copy that
is deleted or expired can never be inserted again, even at a higher revision.
