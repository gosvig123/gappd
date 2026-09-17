# Resolution: Define the cloud meeting projection

## Decision

Synchronize a versioned, atomic meeting aggregate. Never copy the SQLite row directly: portable content and generated output cross devices, while capture, processing, queue, filesystem, and claim state remain local.

## Eligibility

A local meeting may enter the synchronization outbox when:

```sql
capture_status = 'captured'
AND processing_status IN ('completed', 'failed')
AND transcript IS NOT NULL
AND processing_claim_token IS NULL
AND processing_eligible = 1
```

Provisional Live Transcript segments never upload. A terminal failed run may upload a final transcript plus portable diagnostics. Later successful generation replaces the full generated section. Title/tag edits may publish metadata-only versions after the first upload.

## Aggregate contract

```text
CloudMeeting
├── schemaVersion
├── meetingId
├── identity
│   ├── originDeviceId
│   ├── generationOwnerDeviceId
│   ├── createdAt
│   └── source
├── timing
│   ├── startedAt
│   └── endedAt
├── metadata
│   ├── revision
│   ├── title
│   ├── titleSource
│   ├── tags
│   ├── updatedAt
│   └── updatedByDeviceId
└── generation
    ├── revision
    ├── language
    ├── transcript
    ├── ordered segments
    ├── summary
    ├── extraction
    ├── diarization
    ├── diagnostics
    └── omissions
```

`transcript.sourceRevision` preserves the origin SQLite transcript revision. Summary carries the transcript revision from which it was produced. Cloud synchronization uses separate server, metadata, and generation versions rather than treating the SQLite transcript revision as a distributed version.

## Segments

Every generation version contains the complete ordered segment set. Each segment may include:

- origin-generated identifier;
- array index;
- start/end seconds;
- text and speaker;
- speaker source and confidence;
- speaker assignment reason;
- speaker-group start/end seconds.

Segment identifiers are traceability values, not merge keys. Retranscription replaces the whole array because current local replacement deletes and regenerates segments.

## Generated payloads

Extraction and diarization use a typed shell:

```json
{
  "producer": "name",
  "producerVersion": "version",
  "schemaVersion": 1,
  "common": {},
  "raw": {}
}
```

`common` contains stable fields understood across producer versions. `raw` preserves validated producer output.

Portable diagnostics contain terminal stage, stable code, sanitized message, producer, producer version, and outcome. They exclude stack traces, filesystem paths, claim tokens, transient retries, and process logs.

Initial configurable limits:

- complete uncompressed aggregate: 8 MiB;
- each raw producer payload: 2 MiB.

Oversized raw sections do not block transcript synchronization. `omissions` records section, reason, original byte count, and digest. Wire requests may use compression.

## Field ownership

- Any authorized device may update title and tags.
- Only the generation-owner device may replace transcript, segments, summary, extraction, diarization, or generation diagnostics.
- The latest explicit title event wins.
- Generation-only uploads preserve current server metadata and cannot overwrite a newer title/tag edit.
- Timing, source, origin device, and generation owner are immutable.
- If the origin device disappears, generated content freezes while metadata remains editable.

## PostgreSQL shape

```sql
cloud_meetings (
  account_id uuid not null,
  meeting_id uuid not null,
  schema_version integer not null,
  version bigint not null,
  metadata_version bigint not null,
  generation_version bigint not null,
  origin_device_id uuid not null,
  generation_owner_device_id uuid not null,
  ciphertext bytea not null,
  nonce bytea not null,
  content_hmac bytea not null,
  last_content_update_at timestamptz not null,
  retention_expires_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  primary key (account_id, meeting_id)
)
```

The server validates the versioned aggregate, then applies the application-envelope encryption required by **Set the cloud privacy and retention promise** before commit. PostgreSQL stores ciphertext rather than canonical plaintext JSONB. Compare-and-swap, idempotency, and tombstone behavior belong to **Define synchronization and conflict semantics**.

## Local SQLite mapping

Add local state that is never copied as cloud content:

```sql
content_origin TEXT NOT NULL DEFAULT 'local',
processing_eligible INTEGER NOT NULL DEFAULT 1,
origin_device_id TEXT,
generation_owner_device_id TEXT,
metadata_revision INTEGER NOT NULL DEFAULT 0,
generation_revision INTEGER NOT NULL DEFAULT 0,
generation_diagnostics_json TEXT
```

`content_origin` is `local` or `cloud`. Every processing claim and audio-dependent command requires `processing_eligible = 1`.

A downloaded meeting uses:

```text
content_origin              cloud
processing_eligible         false
audio_path                  null
processing_claim_*          null
capture_status              captured
processing_status           completed
capture/processing failures null
source                      original source
```

Terminal generated output, including raw typed payloads, is imported. Portable diagnostics use `generation_diagnostics_json`, not local failure columns. FTS5 is rebuilt locally from title, transcript, and summary.

## Downloaded behavior

Downloaded meetings support list, view, local search, title/tag edits, and synchronized deletion once tombstone rules are settled. They cannot play audio, retranscribe, rediarize, regenerate summaries, retry processing, or enter any audio-dependent queue.

## Code boundaries

- Add a dedicated `CloudMeeting` data-transfer type; do not reuse `MeetingDetail`.
- Use one projection function from `db.Meeting` plus ordered segments.
- Use one import transaction that validates ownership and atomically replaces portable meeting content and segments.
- Record the outbox operation in the same transaction as each portable local mutation.
- Never import remote capture, processing, claim, or filesystem state.
