# Resolution: Define existing-history and sign-out behavior

## Decision

First cloud enablement binds the current unbound local profile to one Apple account in place. All eligible existing meetings upload after one explicit confirmation. Disconnecting revokes the device session immediately while preserving the complete profile and pending outbox offline.

## Profile binding

- The current SQLite database, meeting identifiers, local audio, and generation ownership remain in place.
- The profile becomes bound to exactly one cloud account.
- Gappd creates a new empty account-free Local profile and adds it to the switcher; the newly cloud-bound profile remains selected.
- Version one does not clone or synchronize one profile into multiple cloud accounts.
- Signing into another Apple identity opens or creates another profile.

## First-enable sequence

1. Refuse enablement during active recording.
2. Record a stable `history_cutoff` timestamp.
3. Complete provisional Apple authentication.
4. Fetch the account inventory: meeting IDs, section versions, digests, tombstones, and expiry markers. Do not import remote content yet.
5. Count currently eligible local meetings started at or before the cutoff.
6. Show eligible count, date range, estimated upload size, and the new one-year cloud-retention clock.
7. Require one **Upload All Existing Meetings** confirmation.
8. If cancelled, revoke the provisional session, delete provisional token ciphertext, and leave the profile unchanged and unbound.
9. If confirmed, commit the binding/history policy, seed the outbox, activate token storage, create the blank Local profile, pull remote content, and upload local history in resumable batches.

## Binding state

Persist the source of truth inside the bound profile database:

```text
account_id
device_id
binding_epoch
binding_state          active | disconnected | deletion_scheduled | deleted
history_policy         all
history_cutoff
history_confirmed_at
history_notice_version
last_pull_cursor
```

The global profile registry contains profile ID, display name, kind, state-root path, and selected-profile status only.

Use a binding journal to reconcile crashes between server authentication, SQLite commit, token persistence, and registry update. If local binding commit fails, revoke the provisional server session.

## History eligibility

- Seed every eligible meeting at confirmation.
- Meetings started before the cutoff but still recording, provisional, or processing upload automatically when they later become eligible.
- Meetings created after the cutoff follow normal future synchronization.
- Existing meetings start a new one-year cloud-retention period when first accepted by the server.
- Raw audio remains local in the now-bound profile.

## Existing cloud account merge

1. Apply server tombstone and expiry inventory.
2. Pull remote-only meetings as processing-ineligible replicas.
3. Treat same meeting ID plus same digest as identical.
4. Route same ID plus different digest to **Define synchronization and conflict semantics**.
5. Upload local-only eligible meetings.
6. Never infer duplicates from title, timestamps, or transcript similarity.

## Disconnect Cloud Sync

Use one canonical action rather than separate Sign Out and Disable actions.

Disconnect:

1. Show the unsynchronized-operation count.
2. Cancel active synchronization requests.
3. Revoke this device session immediately.
4. Delete refresh-token ciphertext.
5. Set the binding state to `disconnected`.
6. Preserve meetings, audio, downloaded replicas, versions, expiry markers, and outbox entries.

Local recording, processing, search, editing, and profile switching continue. New portable edits keep entering the retained outbox. Another Apple account cannot access or flush it.

## Reconnect

Reconnect requires the same Apple subject:

1. Issue a new rotating session for the retained device identifier.
2. Pull server meetings, tombstones, and expiry markers first.
3. Apply normal conflict rules.
4. Resume the retained outbox automatically with visible progress.
5. Do not repeat history confirmation for the same account and binding epoch.

## Expired cloud content

If a meeting expires while disconnected:

- keep the complete local meeting;
- mark cloud state expired;
- suppress unchanged re-upload;
- let a later metadata or generation revision recreate it automatically;
- start a new one-year retention period after recreation.

## Cloud-account deletion

During the seven-day undo window, freeze the profile outbox, retain local content, and allow same-account restoration.

After final deletion:

- set binding state to `deleted`;
- invalidate and clear the old account outbox;
- retain meetings and audio as an offline profile;
- never recreate the account automatically.

Later cloud enablement creates a new binding epoch, performs fresh Apple authentication, and requires another **Upload All Existing Meetings** confirmation before creating a new outbox.

## Local erasure

Cloud-account deletion never erases a Mac automatically.

A separate **Erase Profile from This Mac** action:

- revokes any remaining session;
- displays meeting, audio, and unsynchronized-change counts;
- requires destructive confirmation;
- deletes the profile database, audio directory, outbox, markers, and encrypted session data;
- leaves server data unchanged unless account deletion was separately requested.

Do not promise forensic secure erasure on solid-state storage.

## Implementation boundaries

- Do not copy meetings or audio across profiles during first enablement.
- Do not reuse outboxes, cursors, mappings, tokens, or device sessions across accounts or binding epochs.
- Commit history seeding and binding state together in SQLite.
- Commit each portable mutation and outbox operation together.
- Make upload batches resumable and idempotent.
- Leave compare-and-swap, cursor, tombstone wire format, and conflict copies to **Define synchronization and conflict semantics**.
