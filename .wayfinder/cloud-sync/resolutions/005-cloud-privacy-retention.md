# Resolution: Set the cloud privacy and retention promise

## Decision

Cloud Sync is optional and server-readable. Gappd encrypts meeting aggregates in the application before PostgreSQL, limits human access to a single-owner break-glass path, hosts cloud content in the European Union, and automatically expires meetings one year after their latest cloud update.

## Consent

The standard Sign in with Apple button appears only in Cloud Sync settings. Adjacent concise text states that:

- completed transcripts and generated analysis upload to Gappd Cloud;
- raw audio never uploads;
- the service can decrypt content to synchronize it;
- content is hosted in the European Union;
- content expires one year after its latest cloud update;
- the linked privacy policy identifies subprocessors and access rules.

Completing Apple login records the notice version and timestamp. No separate checkbox is required. Existing-history upload remains a separate confirmation in **Define existing-history and sign-out behavior**.

## Stored data

Meeting data includes encrypted aggregate content, typed raw producer payloads within limits, portable diagnostics, ownership/version metadata, retention timestamps, and minimal deletion/expiry markers.

Account data includes Apple's immutable subject, provided relay email, generated account/device identifiers, editable device names, consent history, token hashes, and revocation state. Name is optional. Email is not an ownership key.

## Encryption

1. Validate plaintext `CloudMeeting` against its versioned schema.
2. Serialize it deterministically.
3. Encrypt with AES-256-GCM using the account data-encryption key and a unique nonce.
4. Bind account, meeting, schema, and version as authenticated associated data.
5. Store ciphertext, nonce, and a keyed content digest.
6. Wrap the account data key with a European Union-hosted managed key service.

Transport Layer Security protects every network connection. Database access alone cannot read meeting content. Normal authenticated sync/export service paths may decrypt. This is application envelope encryption, not end-to-end encryption.

## Amended PostgreSQL shape

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

The earlier canonical-JSONB storage decision is replaced by validated encrypted aggregate storage. Local SQLite remains the searchable plaintext replica.

## Human access

Routine support and debugging cannot decrypt meeting content.

Exceptional operator access requires:

- the designated production owner;
- phishing-resistant multi-factor authentication;
- a documented security, legally valid, or recovery reason;
- account-scoped access;
- automatic expiry within one hour;
- immutable reason, account, operation, and time audit;
- managed-key-service audit confirmation.

No bulk transcript access or decrypted content in support tools is permitted.

## Retention

| Data | Retention |
|---|---|
| Active meeting content | One year after latest accepted metadata or generation update |
| Expired/deleted active content | Hidden immediately; purged within 24 hours |
| Encrypted backups | Maximum 30 days |
| Minimal expiry/tombstone marker | Until final account deletion |
| Operational request logs | 30 days |
| Security, export, deletion, and break-glass audits | One year |
| Streamed export | No temporary server object |

Reads, downloads, token refreshes, and sync checks do not extend retention. Title, tag, transcript, or generated-output changes do. Warn through relay email and in-app status 30 days before expiry.

After expiry:

- local copies remain;
- stale reconnection alone cannot recreate cloud content;
- a later local metadata or generation revision automatically recreates it and starts a new year;
- the marker retains account/meeting identifiers, prior section versions/digest, and expiry time, but no content.

## Deletion

### Individual meeting

- Hide immediately and deny normal reads.
- Purge active ciphertext within 24 hours.
- Keep only the minimal synchronization tombstone.
- Expire backup copies through normal rotation within 30 days.
- Never restore backup content without replaying tombstones and expiry markers.

### Cloud account

- Preserve the seven-day undo period.
- Revoke all sessions when deletion is scheduled.
- After seven days, purge active account and meeting data within 24 hours.
- Revoke Apple/provider authorization.
- Expire encrypted backups within 30 days.
- Retain pseudonymous security/audit events only until their one-year deadline.

## Export

Require recent Apple authentication and stream a ZIP archive directly to the desktop over Transport Layer Security:

```text
manifest.json
account.json
devices.json
consent.json
meetings/*.json
audits.jsonl
```

Include active decrypted aggregates, portable diagnostics, account metadata, device records, consent history, and relevant user-visible audits. Exclude local audio, internal operator notes, token hashes, keys, and unrelated infrastructure logs. Do not create a temporary server export object.

## Logging and incidents

- Cloud APIs expose typed redacted log fields only.
- Request bodies, Apple proof, tokens, decrypted aggregates, titles, transcripts, summaries, extraction, and raw diagnostics cannot be logged.
- Security incidents may revoke sessions and keys immediately.
- Notify affected users through relay email and in-app status without undue delay and within applicable legal deadlines.
- Publish hosting, authentication, email, logging, backup, and key-management subprocessors before launch.

## Region

Keep active meeting content, backups, operational logs, and encryption keys in the declared European Union region. Disclose unavoidable global Apple authentication processing and any cross-region support access.
