# Gappd optional cloud MCP — implementation handover

The selected-local-fixture document transport is implemented for development only and
OFF by default; see [isolated setup, consent and migration 003](cloud-selected-fixture.md).
It reads only the explicitly bootstrapped synthetic SQLite Meeting. The original
empty-body demo and its permanent deletion markers are unchanged. No real uploads
or live deployment of this new slice are approved. Historical status below describes
the original demo unless stated otherwise.

## Status and approved scope

The desktop retains its development auth-only preview. Cloud sync remains unimplemented.
An OFF-by-default synthetic demo action now creates one fixed server-side Meeting per account;
see the runbook for its separate consent, writer role, and parent-owned deployment gates.
Pi live login and owned get_meeting passed; live second-account and ChatGPT checks are deferred.
See [runbook](../cloud/README.md).
Build this for all Gappd users. Target hosted ChatGPT and desktop MCP clients such as Pi/Codex.
Client compatibility must be proved with real authorization and tool calls, not assumed.

**The existing local MCP remains the default, unchanged. Cloud sync defaults to OFF. Real-copy
storage now exists as an OFF-by-default transport: `POST /meeting` and `DELETE /meeting` write and
remove owned copies behind `GAPPD_MEETING_STORAGE_ENABLED`, and no MCP tool reads them yet. There is
still no desktop sync queue, no automatic upload, no device registration and no account generation.
Enabling the real read surface for MCP clients is the next slice.**
Add an explicit Settings toggle. Installing, upgrading, signing in, or connecting Calendar must
never enable sync, upload Meeting data, or replace the local MCP configuration automatically.
Missing settings on existing installations mean OFF. Cloud access requires explicit consent.
Local recording, transcription, history, settings, and local MCP must remain usable offline
and without a Gappd identity. Remote MCP is an additional connection that users choose.

Settings → Connections → Cloud sync defaults OFF and opens Clerk only after explicit ON.
Only a verified account and protected credentials enable the auth-only preview. No Meetings
are uploaded by that preview. Cloud MCP remains synthetic-only and read-only;
no real Meeting upload, sync, or device registration exists. The gated empty-body demo POST
is a consent/transport test, not a Meeting-document upload implementation.
This preview consent is authentication only: a future upgrade MUST ask for new explicit upload
consent. It must never interpret this credential or enabled state as upload permission.

## Proposed architecture

```text
Gappd recording device                    Gappd cloud service
Local Meeting + durable pending changes --HTTPS--> Upload API
Local audio stays here                              |
                                                    v
                                            PostgreSQL + text search
                                                    ^
                                                    |
ChatGPT / desktop MCP clients --------HTTPS--> Read-only MCP endpoint
```

Use one cloud service for uploads and MCP, with separate permissions. Use PostgreSQL text
search first. Do not add Redis, a vector database, object storage, or a queue service initially.
The existing OAuth relay at auth.getgappd.com remains isolated from Meeting storage.
Railway hosts PostgreSQL with persistent storage; this is not a promise of managed HA,
automatic backups, or recovery. Configure and test those operational controls before launch.

## Settings and consent contract

- Current toggle: "Cloud sync", labelled development auth-only preview; default OFF.
- The remaining bullets describe future sync gates, not behavior enabled by this preview.
- Explain that uploaded text becomes available to explicitly authorized AI clients.
- Enabling requires a Gappd identity and consent; a Google Calendar connection is unrelated.
- Ask separately whether to include existing Meetings; do not silently backfill history.
- Show per-Meeting pending/synced/failed state and the last successful device sync.
- Turning OFF stops new uploads and pending retries. Do not silently delete cloud copies.
- State clearly that existing cloud copies can remain readable until access is revoked or
  cloud data is deleted. Provide separate client revocation and "Delete cloud data" controls.
- Define in-flight upload behavior; do not claim an accepted upload can be recalled by OFF.
- Resolve pending deletions and re-enable behavior before shipping; OFF must not leak uploads.
- No cloud read failure may trigger local recording failure or silently switch MCP sources.

## Data and ownership

Export a versioned, explicit Meeting document, not a copy of the entire local SQLite database.
Version 1 is specified in [the Meeting document contract](cloud-meeting-document.md).
Include stable Meeting ID, title, time/duration, transcript turns and timestamps, Meeting
speaker labels, summaries, existing derived meeting data, revision, and sync timestamps.
Keep audio, speaker embeddings, voice samples, local paths, credentials, Calendar caches,
Saved Agenda drafts, and the global Person directory local in the first version.

Every cloud Meeting belongs to one verified Gappd account. Its source device owns updates.
Use globally unique cloud Meeting identifiers; inspect existing local IDs before deciding
whether to reuse them or add a stable mapping. Two recordings of the same Calendar event
remain separate Meetings. Multiple recording devices can upload different Meetings.
Cross-device app history, editing, team sharing, and device ownership transfer are out of scope.
Changing accounts must not upload a previous account's pending changes to the new account.

## Sync behavior

1. When enabled, a ready Meeting or later edit durably queues a newer revision.
2. Replace the complete cloud Meeting atomically; avoid row-by-row transcript sync initially.
3. An acknowledged revision clears only that queued revision, not a later local edit.
4. Retries use account, Meeting ID, and revision. Duplicate uploads are harmless; old revisions
   never overwrite newer ones. Use a monotonic revision, not device wall clocks, for ordering.
5. Persist a deletion record before removing local Meeting data. Retain sufficient cloud
   deletion state to reject delayed uploads. Account-wide cloud deletion must also invalidate
   stale upload attempts so a device cannot silently restore erased data.
6. Keep pending work across app restarts and network failures. Bound retries and payload sizes.
7. Report cloud freshness honestly. An offline device cannot report its unsent local edits.

## Remote MCP and authentication

Keep cmd/gappd/mcp.go and its local read-only SQL contract intact.
Use remote MCP over Streamable HTTP with standards-based OAuth authorization.
Use the existing Gappd Clerk application; development OAuth configuration is prepared.
See [Clerk setup and remaining integration gates](cloud-mcp-clerk.md) before implementation.
Do not reuse Google Calendar tokens, distribute shared credentials, or expose upload scopes
through an MCP read grant. Users must be able to revoke individual clients and devices.

Only `get_meeting` is implemented, bounded to synthetic data. `list_meetings`
(date filters and offset paging) and `search_meetings` (ranked transcript/summary passages)
are also implemented, bounded to owned synthetic rows. Future proposed tools:
- `get_meeting`: one owned Meeting, with paginated transcript access.
- `get_sync_status`: cloud-observed sync state and freshness, not invented device status.

Return Meeting IDs, revision, and transcript timestamps for citations. Do not expose arbitrary
SQL against shared account data. Validate OAuth tokens and their audience/scopes; enforce
account ownership on every read/write, including search, pagination, and deletion.
Use row-level security as defense in depth with a non-owner runtime database role and tests.
Treat transcript contents as untrusted data, not tool instructions or authorization.

## Privacy and operations gates

- HTTPS, encrypted storage/backups, no credentials in Git, and no transcript bodies in logs.
- Explain that Gappd Cloud can read uploaded text; this is not end-to-end encryption against
  the cloud operator. Connected AI providers receive data their granted tools return.
- Separate migration and runtime database roles; apply least privilege before real data.
- Retention periods are owner-approved; only synthetic deletion/expiry is implemented. See [remaining lifecycle gates](cloud-data-lifecycle.md); confirm data region and incident ownership.
- Configure automatic backups and prove restore into an isolated environment.
- Bound upload size, query time/results, per-account storage, and request rates.
- Add health/readiness checks, error monitoring, and cost monitoring without logging content.
- Use synthetic data until authentication, tenant isolation, deletion, and restore tests pass.

## Provisioned Railway resources

Workspace: Kristian Gosvig's Projects (the existing workspace containing Gappd services).
Project: [gappd-cloud](https://railway.com/project/b73b1b1e-810b-4c3d-af03-6136244852c0).
This is separate from the existing site/auth project. PostgreSQL incurs ongoing usage costs.

| Resource | Identifier / configuration |
| --- | --- |
| Project | b73b1b1e-810b-4c3d-af03-6136244852c0 |
| Environment | production: 7b4a6831-62f8-4dda-a2e1-773542c266fb |
| API service | gappd-cloud-api: 7407bf7c-600e-4a4c-928d-bf4c02747463 |
| Database service | Postgres: 1e6d7e2d-b50a-4685-ab97-cacc4557aeae |
| Database image | ghcr.io/railwayapp-templates/postgres-ssl:18 |
| Database volume | postgres-volume: 09e2971f-5fba-4cc9-8d60-729a27812e94 |
| Volume mount | /var/lib/postgresql/data |
| Region | europe-west4-drams3a (EU West) |
| GitHub source | gosvig123/gappd, beta branch |
| API root / watched paths | /cloud / ["/cloud/**"] |
| API DATABASE_URL | Private-network URL for gappd_reader; no administrator credentials |
| Public MCP URL | https://gappd-cloud-api-production.up.railway.app/mcp |

PostgreSQL is private, with no public TCP proxy. Migration, reader-role provisioning, and
one explicit synthetic seed completed through SSH. No user Meeting data was uploaded.
The original administrator DATABASE_URL reference was replaced and verified as gappd_reader.
Independent review, Go 1.25.13 race tests against PostgreSQL 18, and Docker build passed.
`/cloud` contains the service, admin commands, Docker and Railway configuration.
Deployment `d0ceed7a-1c53-443f-811b-5b160f6ec015` serves commit `7eb4058` from GitHub beta.
Public health/readiness/metadata and unauthenticated 401 checks passed; CI passed.
Builder Dockerfile and `/ready` healthcheck are explicit service settings: the CLI discarded
`configFile=/cloud/railway.toml`. Config edits attempted old main builds, which failed;
explicit source connection with `--branch beta` deployed the correct tested commit.
Automatic push deployment and CI gating are NOT yet proved. Inspect branch selection before
future configuration changes. Pi owned read passed; second-account and ChatGPT are deferred.
The environment name production is Railway's default, not approval to serve production users.
Before launch, add an isolated staging environment and choose the production release branch;
beta is the current development branch, not a permanent production-branch decision.

Reconnect the CLI explicitly before any future infrastructure change:

```sh
railway link --project b73b1b1e-810b-4c3d-af03-6136244852c0 \
  --environment 7b4a6831-62f8-4dda-a2e1-773542c266fb \
  --service 7407bf7c-600e-4a4c-928d-bf4c02747463
railway service list --json
```

CLI note: this installed version's environment edit reads piped stdin before configuration
flags. In non-interactive automation, supply a JSON patch on stdin and verify persisted config.
Never print resolved service variables; inspect names or unresolved references only.

## Implementation sequence and acceptance

1. Prove OAuth + one read-only tool with synthetic data in hosted ChatGPT and a desktop client.
   Record client versions, account/plan restrictions, login/revocation results, and limitations.
2. Implement the smallest /cloud service, schema migrations, account isolation, health checks,
   deployment configuration, and CI checks. Validate the GitHub deployment path in staging.
3. Add the OFF-by-default Settings toggle and persistent one-way sync, then MCP read tools.
4. Test fresh installs/upgrades/sign-in stay OFF; local MCP is unchanged; OFF causes no Meeting
   upload; local recording works offline; consent is required for historical uploads.
5. Test retries/restarts, reordered revisions, edits during upload, toggling OFF, account
   switches, deletions, stale-device resurrection prevention, and unauthorized cross-account
   reads/writes. Verify remote reads while the recording Mac is asleep.
6. Validate real client compatibility, privacy controls, limits, backup restore, and rollout
   before adding a public production endpoint or accepting real user data.

## Repository starting points

- CONTEXT.md: current domain terms and local-first boundaries; planned cloud behavior is here.
- cmd/gappd/mcp.go, mcp_protocol.go, mcp_query.go: existing local MCP contract.
- internal/db/: local schema, Meeting mutation/deletion paths, and search.
- internal/config/, cmd/gappd/app_config.go: persisted settings and app configuration.
- desktop/src/renderer/routes/settings-view.tsx: inspect current Settings composition.
- desktop/src/main/: inspect identity, credential storage, and lifecycle integration.
- .github/workflows/ci.yml, Makefile, package.json: reuse relevant checks; do not invent CI.

Run relevant tests/build checks for implementation changes, commit only owned changes, and
push the current branch after validation. Preserve unrelated work already in CONTEXT.md.
