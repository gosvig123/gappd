# Cloud Meeting deletion and retention

Real Meeting sync is live for beta users; see the [Meeting document contract](cloud-meeting-document.md),
the [service runbook](../cloud/README.md) and [operations](cloud-operations.md).

## Status and scope

The owner approved these retention periods. This page is the product contract, not a legal
compliance claim. [Implementation status](#implementation-status) records which rules are built
and checked. Local-first behavior and OFF-by-default sync are unchanged.

A **cloud copy** is the uploaded text and derived data for one Meeting, not its audio.
A **deletion marker** stores only enough identity/version data to reject an old upload.
An **account generation** is a server-issued version that invalidates earlier upload grants.
These are cloud terms, not changes to the local Meeting model.

## Owner-approved retention periods

| Data | Approved rule |
| --- | --- |
| Local Meetings and audio | Keep existing local behavior; cloud expiry never deletes local data. |
| Active cloud copies | Expire 30 days after the first accepted upload. |
| Cloud backups | Encrypted, restricted to recovery, maximum age 7 days. |
| Content-free operational logs | Maximum age 14 days; never log tokens or Meeting text. |
| Deletion markers and generation state | Keep until old uploads and backups can no longer restore deleted data. No arbitrary time-to-live. |

Use server time. Set and return an explicit expiry time on the first accepted upload.
Edits, reads, retries and reconnects do not extend that time.
After expiry, reads fail even if physical cleanup is delayed; remove live content within
24 hours. Do not automatically upload the retained local Meeting again.
Changing retention later requires explicit product approval and updated consent copy.
No longer retention or historical backfill is silently enabled by an upgrade.

## Separate user actions

| Action | Local effect | Cloud effect |
| --- | --- | --- |
| Turn sync OFF | Stop new uploads and retries; clear upload authorization/consent. | Existing copies remain until deletion or expiry; OFF is not read-client revocation. |
| Delete a local Meeting | Persist its cloud deletion intent before local removal, if it has a cloud copy. | Delete when the request is accepted; show pending status while offline or unauthorized. |
| Delete a cloud copy | Keep the local Meeting and audio. | Remove that copy and reject delayed uploads for its identity. |
| Delete all cloud data | Keep local data; stop pending uploads for that account. | Invalidate the old account generation and delete all owned cloud copies. |
| Disconnect an MCP client | Leave local data unchanged. | Revoke that client's access, not the stored cloud copies. |
| Delete the cloud account | Keep local data; disconnect cloud use on each device when observed. | Block access and uploads, invalidate devices/grants, and delete cloud copies. |

Each destructive cloud action requires confirmation naming the signed-in account and scope.
Cloud actions must never call local Meeting deletion as a side effect.
An offline request is only queued, not complete. Do not claim cloud removal before acknowledgment.
With sync OFF, retain local deletion intents; do not silently authenticate or resume uploads.
The user can explicitly authorize a deletion operation without re-enabling general sync.

## Deletion and expiry contract

1. Authenticate and authorize the owner separately from read-only MCP permissions.
2. In one transaction, mark the identity deleted and remove its live content and derived
   search data. For account-wide deletion, also invalidate the account generation.
3. Acknowledge only after that transaction commits. A later read must not return the copy.
4. Treat duplicate deletion requests as successful. Do not reveal another account's data
   through different errors for missing and other-owner identities.
5. Reject delayed writes even if their claimed revision is newer. A client timestamp,
   reconnect or ordinary edit cannot undo deletion or expiry.
6. A timeout means the outcome is unknown. Show that state; repeat only an authorized,
   idempotent deletion. Cancellation cannot recall an already accepted operation.
7. Requests already in progress may have returned content before deletion committed.
   Gappd cannot erase copies already received by an AI provider or exported by the user.

For intentional re-upload, require new explicit consent and a fresh server-authorized
identity/generation. Do not recycle a deleted ID or interpret old pending work as consent.
Unknown, deleted or invalidated device/account state must fail closed on upload.

## Backups, restore and revocation

Deleted content may remain only in restricted backups until those backups expire.
With the required 24-hour cleanup and 7-day backup limits, expiry-related backup removal
can take up to 8 days after logical expiry. State this limit rather than promising instant erasure.
User-requested deletion removes live content at acknowledgment; backup removal is within 7 days.

Restores remain offline until current deletion markers, generations and expiry rules have
been applied. A database backup alone cannot prove which deletions occurred after it was made.
Maintain recoverable deletion control records separately from the restored snapshot, or
refuse to expose that restore. Never serve a restore with incomplete deletion evidence.
Do not purge control records until the replay/restore rejection condition is proved.
These identifiers remain protected account data; do not call them anonymous.

Current locally verified Clerk JWTs can remain valid until expiry despite grant revocation.
Before promising immediate account/client revocation, add and test server-side revocation
checks or supported online token validation. Deleting content still blocks later reads of it.

## Implementation status

| Rule | State and evidence |
| --- | --- |
| 30-day expiry, permanent deletion markers, generations, device signatures | Built. Cloud tests cover deletion, expiry, stale revisions, delayed uploads after deletion, delete-all, consent generations and revoked devices (`cloud/internal/service/*_test.go`). |
| Bounded cleanup within 24 hours | Built and scheduled hourly; `/status` reports the backlog. |
| Delete a local Meeting | Built. The deletion is recorded in the upload queue before the local Meeting is removed, sent with the next consented sync and retried until acknowledged. A Mac that never synced records nothing. Pending deletions belong to the queue's account; another account cannot send them, and those copies expire on their own. |
| Send a deletion with sync OFF | Not built. Pending deletions and the per-Meeting delete action both need active upload consent, so with sync OFF a deletion waits until sync is turned on again. |
| Turn sync OFF, account switch, reconnect, concurrent sends, lost acknowledgment | Built. Desktop tests cover each (`desktop/src/main/meeting-upload*.test.ts`, `meeting-sync-queue.test.ts`). |
| Show account, expiry, pending deletion and backup limits | Built in Settings → Connections → Cloud Meeting upload: the account, a deletion count while deletions wait, the 7-day backup note, and the expiry in each accepted upload's result. |
| Restore cannot revive deleted content | Partly proven. Isolated volume and PITR restores passed; replaying later deletion markers onto a restore is not automated, so a restore must stay offline. |
| Backup expiry and removal | Configured (6 days); actual removal is unverified. |
| 14-day log retention | Blocked by the Railway plan; see [operations](cloud-operations.md#open-gates). |
