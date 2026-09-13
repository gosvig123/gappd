# Selected synthetic local Meeting transport

Development only, OFF by default. Automatic sync and real Meeting uploads remain OFF.
This slice reads a real local SQLite Meeting, previews its exact version-1 JSON bytes,
then sends those retained bytes only after new one-use consent. It does not accept
arbitrary Meeting documents. Migration 003 was applied privately on 2026-09-13;
the old deletion marker and seeded fixture were verified intact. No live selected
upload or deletion has been performed for this slice.

## Explicit isolated local setup

Use a fresh canonical absolute path. The command refuses any existing destination,
including a symlink. It never loads normal user configuration or Meeting storage.
From the repository root, build the CLI and create the isolated profile explicitly:

```sh
go build -o /tmp/gappd-selected-fixture ./cmd/gappd
/tmp/gappd-selected-fixture selected-fixture bootstrap /private/tmp/gappd-selected-profile
```

On macOS `/tmp` and `/var` can be aliases. Use their canonical `/private/...` paths.
The profile contains `backend-home/.gappd/db.sqlite` and a development marker. It has
one fabricated completed Meeting, ID `72619a1d-f713-4f46-a2b8-c74e568726b1`.
No startup path creates the fixture. The marker is only an extra development guard;
exact local identity and exported content checks are the egress boundary.

After preparing normal development build artifacts, start from `desktop`:

```sh
GAPPD_BINARY_PATH=/tmp/gappd-selected-fixture \
GAPPD_SELECTED_FIXTURE_PROFILE=/private/tmp/gappd-selected-profile \
GAPPD_SYNTHETIC_UPLOAD_ENABLED=true npm run dev:start
```

Electron keeps its original HOME for macOS secure storage. Only its `userData` moves
to `electron-user-data` inside the profile. Backend command subprocesses receive the
profile's separate HOME. Packaged builds reject the selected-profile flag. Never
point this setup at existing user storage or copy a real database into the profile.
Close the test app before removing the owned disposable profile and CLI binary.
No application installation is required.

## Selection, preview and consent

Select the synthetic Meeting in the existing Meeting list. Its detail panel shows
“Share this synthetic local Meeting”. Connect the demo account explicitly. This uses
the existing app-owned protected demo credential store and Desktop PKCE flow, not
Pi or CLI credentials. Auth-only Cloud sync credentials are not upload permission.

Choose **Preview exact shared document**. The backend calls `db.GetMeeting` and
serializes an explicit document. Main validates the exact allowlisted bytes before
retaining them and presenting them as plain JSON. Shared fields are version, local
identity, title, transcript, summary, start time and revision. Audio, Person identities,
voice evidence, filesystem paths, Calendar caches and Saved Agenda drafts are absent.
Only the fixed fabricated fixture is accepted; a synthetic flag is not sufficient.

Consent names the verified receiving email/subject and binds the exact token,
authorization generation, selected local identity and immutable bytes. Before sending,
main rereads the local Meeting and compares it with the retained preview. It never
replaces an approved payload with newly read bytes. A changed document, selection,
OFF, cancellation, reconnect, changed token/account or expired authorization cannot
reuse consent. Shared authorization changes invalidate both old-demo and selected-demo
consent. There is no queue, startup upload, backfill, hidden login or automatic retry.

Cloud operators and authorized AI clients can read the text. Expiry is fixed at 30
days after first server acceptance. Retries do not extend it. OFF does not delete.
A lost acknowledgment means the server may have accepted the request; do not report
success or automatic rollback. Acknowledged cloud IDs appear in the result for Pi
`get_meeting`. Deletion has a separate one-use confirmation for this selected fixture
and account. It leaves the local Meeting intact and permanently bars that cloud ID.

## Cloud API and lifecycle

The existing OFF-by-default `GAPPD_SYNTHETIC_UPLOAD_ENABLED=true` capability enables
`POST /selected-demo-meeting` and empty-body `DELETE /selected-demo-meeting` alongside
the unchanged old `/demo-meeting` routes. They use the same existing writer pool.
The routes require `meetings:sync` and the exact signed Desktop `client_id`; owner
comes only from the verified JWT subject. MCP discovery, scopes and role stay read-only.

POST accepts only the exact version-1 JSON fixture bytes, with a 4 KiB body bound.
The server decodes those uploaded bytes and inserts their title, summary, transcript
and start time into the existing cloud Meeting row. Version/local identity/revision
are fixed validation fields, not a new general sync schema or MCP output contract.
The main process repeats the exact allowlist check before network egress. Responses
are bounded to 4 KiB in main, with a 15-second transport timeout; cloud retains its
10-second handler and 3-second database statement bounds. No content/token logging
is added.

The new deterministic namespace is `gappd-selected-local-fixture-v1:<verified subject>`.
It uses the same SHA-256 UUID construction as the old demo, but not the old namespace.
The previously deleted `eb811da9-bdb3-8bdd-befd-ccdfecb5acd6` remains forbidden.
The original seed `b47c5e70-8030-4b9e-bb5a-146d17c68731` stays unchanged and exempt.
No account generation, device registration or general identity recreation is added.

## Parent-owned migration and deployment order

1. Keep both desktop and cloud capabilities OFF. Use the existing private admin
   session safeguards, including `PGOPTIONS='-c pg_stat_statements.track=none'` when
   applicable. Never put an administrator URL or password in runtime configuration.
2. Build the reviewed new admin binary and run `/admin migrate`. Transactional,
   advisory-locked migration 003 is version-recorded and repeat-safe. It extends the
   lifecycle identity CHECK to exactly the old and selected namespaces, installs the
   selected insert guard and narrow exact-payload writer/marked-delete policies,
   and adds selected cleanup policies. It does not modify old rows or acceptance,
   expiry, deletion markers, grants or the seeded exception.
3. Existing deployed reader/writer/cleanup grants already suffice. No new role,
   password or runtime variable is needed. For a fresh database, follow the existing
   private `provision`, `provision-demo`, `provision-cleanup` steps after migration.
   Those commands preserve the added selected policies. No live seed is required.
4. The deployed hourly cleanup binary is compatible: its existing SQL selects expired
   lifecycle/content rows and removes at most 100. New narrow RLS policies let that
   unchanged SQL include selected fixtures. The reader's existing lifecycle filter
   enforces selected expiry even before cleanup. Deploy reviewed API code only after
   migration, then let the parent explicitly enable a coordinated synthetic test.
5. Parent owns live browser login, account check, new consent, upload, Pi readback,
   separate deletion and capability shutdown. Do not recycle a deleted selected ID.

## Validation and unresolved gates

Automated disposable SQLite/PG18 tests exercise local CLI bootstrap/export through
HTTP and the official MCP SDK, exact body checks, cross-owner isolation, wrong
scope/client, mutation bounds, repeat migration, old markers, fixed expiry, cleanup,
delete-before-retry, consent changes, cancellation and no automatic uploads. CI uses
its existing four synthetic database URLs; no additional database variable is needed.
Independent review found no implementation blocker. Parent strengthened the transport
test to assert persisted fields and exact MCP fields before retry; the full PG18 race
suite and cloud vet/build passed afterward. Parent also verified 286 desktop tests
and the protocol check.

These are local synthetic checks, not live release approval. Real data still requires
production identity, device/account generations, revocation decisions, rate/cost
controls, staging, live second-account/ChatGPT checks, cleanup alerts and deadline
proof, backup removal/restore evidence and resolution of Railway Pro's 30-day logs
against the approved 14-day cap. Daily 6-day backups and hourly cleanup are configured;
their operational guarantees remain unverified as recorded in the operations runbook.
