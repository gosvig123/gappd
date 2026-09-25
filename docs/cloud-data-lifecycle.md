# Cloud Meeting deletion and retention

The selected-local-fixture document transport is implemented for development only and
OFF by default; see [isolated setup, consent and migration 003](cloud-selected-fixture.md).
It reads only the explicitly bootstrapped synthetic SQLite Meeting. The original
empty-body demo and its permanent deletion markers are unchanged. No real uploads
or live deployment of this new slice are approved. Historical status below describes
the original demo unless stated otherwise.

## Status and scope

Owner-approved retention periods; not a full implementation or legal compliance claim.
This batch implements only deterministic synthetic demo deletion and 30-day logical expiry.
Hourly cleanup ran successfully; daily backups are configured with 6-day retention.
Actual backup removal/restore and cleanup alerts remain unverified. Railway Pro's documented
30-day logs conflict with the approved 14-day maximum; see [operations](cloud-operations.md).
Real Meeting uploads, account/device generations and account-wide deletion remain gated.
No existing local or synthetic cloud data is deleted by this document.
Local-first behavior and OFF-by-default sync remain unchanged.
See [cloud handover](cloud-mcp-handover.md) for the wider release gates.

A **cloud copy** is the uploaded text and derived data for one Meeting, not its audio.
A **deletion marker** stores only enough identity/version data to reject an old upload.
An **account generation** is a server-issued version that invalidates earlier upload grants.
These are proposed cloud terms, not changes to the local Meeting model.

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

## Gates before real uploads

- Periods are owner-approved: 30-day content, 7-day backups, 14-day logs. Approve real-upload consent wording separately.
- Implement deletion, expiry filtering, generation/device validation and bounded cleanup.
- Test offline deletion, account switch, OFF, reconnect, concurrent upload/delete, expiry,
  lost acknowledgment, duplicate requests and delayed higher-revision uploads.
- Prove an old device and a restored backup cannot restore deleted content.
- Configure backup expiry, test isolated restore and verify actual removal deadlines.
- Show account, expiry, pending deletion and backup limits in the app.
- Keep the existing production identity, isolation, rate/cost and rollout gates.

## Synthetic implementation status

`DELETE /demo-meeting` takes no content or ID and targets only the authenticated account's
fixed demo ID. It requires signed Desktop client identity, sync scope and a new, separate
one-use desktop destructive confirmation naming that account and scope. OFF/reconnect do
not delete. Missing/other-owner copies have the same committed acknowledgment. A lost
acknowledgment is uncertain; there is no queue, startup network or automatic retry.

A forced-RLS content-free lifecycle table serializes creates/deletes, including absent IDs.
Committed markers and expired identities reject ordinary writes permanently. Acceptance
uses server time, not fabricated Meeting dates; retries never extend the fixed expiry.
Legacy rows fail closed until an operator supplies an evidence-based acceptance timestamp;
backfill only fills missing lifecycle records. The original administrator-seeded fixture is
unchanged and exempt from this synthetic slice: this is a test exception, not general policy.

A restricted cleanup command removes at most 100 expired copies per invocation. The 24-hour
physical purge target is NOT verified until scheduling, capacity and monitoring are configured.
Tests replay old content against current markers; they do not prove a restored database
contains later deletion evidence. External restore control records, backup removal, live Pi
delete/readback, account-wide deletion and intentional fresh-ID re-creation remain gates.
See the [runbook](../cloud/README.md) for migration and private setup.
