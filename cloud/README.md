# Gappd cloud service

Independent Go 1.25 service on Railway. It stores the text of the Meetings that users sync from
the desktop app and serves it to authorized MCP clients. Real Meeting sync is live for beta users;
see the [Meeting document contract](../docs/cloud-meeting-document.md) and the
[lifecycle contract](../docs/cloud-data-lifecycle.md). The synthetic upload demo was removed in
migration 012. One administrator-seeded synthetic Meeting remains for read checks.
Open live checks are tracked in [operations](../docs/cloud-operations.md).

## Runtime

Railway uses root `/cloud`, branch `beta`, explicit Dockerfile builder and `/ready` healthcheck.
These settings are configured on the service: the CLI did not persist the nested TOML path.
Base read-only runtime variables (real Meeting storage is configured below):

- `DATABASE_URL`: private PostgreSQL URL for **gappd_reader**, never the administrator.
- `CLERK_ISSUER_URL`: `https://clerk.getgappd.com` (production identity).
- `MCP_RESOURCE_URL`: `https://gappd-cloud-api-production.up.railway.app/mcp`.
- `PORT`: Railway listening port; default `8080`.

`GET /health` is public liveness; `GET /ready` checks a runtime database connection.
Both protected-resource metadata paths are public:
`/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`.
`/mcp` is authenticated Streamable HTTP, stateless, with three read-only tools over owned
Meetings (the synthetic seed and synced cloud copies): `get_meeting({id})`, `list_meetings({since,until,offset,limit})` and
`search_meetings({query,limit})`. List returns summaries only; search returns ranked passages.
Each request verifies RS256, fixed issuer JWKS, `typ` at+jwt or application/at+jwt,
expiration, optional nbf/iat, a single exact audience, nonempty subject, and
`meetings:read`. Clerk's `scp` array takes precedence over space-delimited `scope`.
Wrong/missing credentials return 401; missing scope returns 403. Both challenge
with `resource_metadata` and `scope`. Bearer query parameters are rejected.

JWKS fetches use a five-second timeout, 128 KiB limit, no redirects, and a five-minute
cache including failures. Unknown keys fail closed until the next refresh. JWT
revocation is NOT immediate: signed tokens remain valid until expiration. No
Clerk secret key, token forwarding, credential logging, or token persistence exists.

Requests: 16 KiB bodies, 32 KiB headers, ten-second handler limit. Database: four
connections, three-second statements, read-only transaction, transaction-local owner.
Forced row-level security (RLS) plus parameterized ID/owner filters enforce isolation.
Runtime connection setup rejects administrator, owner, bypass-RLS, and member roles.
Schema limits UTF-8 bytes: title 512, summary 4096, transcript 16384. JSON escaping
and SDK text/structured duplication can expand the response but remain bounded by
these constraints. The synthetic table accepts only `synthetic=true` rows; real copies have their own limits below.

## Optional real Meeting storage transport (disabled by default)

`GAPPD_MEETING_STORAGE_ENABLED=true` enables `POST /meeting` and `DELETE /meeting`, and requires
`MEETING_STORAGE_DATABASE_URL` for **gappd_meeting_writer** plus the existing Desktop client id.
Missing/other values leave both routes absent and open no writer pool. This needs migration 004
and `provision-meeting` first; both routes are `meetings:sync` and the exact signed Desktop client.

POST takes one version-1 Meeting document ([contract](../docs/cloud-meeting-document.md)), bounded
to 2 MiB. The server validates it, flattens the turns into the searchable transcript, and replaces
the whole copy atomically. A retry never extends the fixed 30-day expiry, an older revision never
replaces a newer one, and one revision always means one document. The 200 response carries
`status`, `subject`, `id`, `revision` and `expires_at`; the reported revision is the stored one,
so a stale upload is visible rather than silent.

DELETE takes a small `{"meeting_id":"<local Meeting UUID>"}` body bounded to 256 bytes. It marks
the identity deleted, removes the copy, and keeps a permanent marker, so the same identity can
never be re-created. A repeated deletion is idempotent, and a deletion of an identity that was
never uploaded is indistinguishable from a successful one.

**A stored real copy is readable by the read tools once storage is enabled.** `GAPPD_MEETING_STORAGE_ENABLED=true`
also switches `get_meeting`, `list_meetings` and `search_meetings` onto `cloud_read_meetings`, the
migration-005 union view of synthetic rows and owned cloud copies. The switch fails closed on
startup when that view is absent, so a deployment cannot serve real reads before migration 005.
Order of work: apply migrations 004 and 005, run `provision-meeting`, then enable the flag.

## Cleanup backlog monitoring

The 24-hour physical cleanup deadline was unobservable: the reader cannot see an expired row and
every runtime read is owner scoped. `GET /status` publishes it as two aggregate numbers.

```json
{"status":"ok","cleanup":{"expired_copies":0,"oldest_expired_seconds":0,"target_seconds":86400,"behind":false}}
```

`cleanup_backlog()` is a `SECURITY DEFINER` aggregate owned by the administrator. It returns counts
and nothing else, so it is not a way to read a row or another account, and the reader gains only
`EXECUTE`. The endpoint is public like liveness and carries no account and no content.

`behind` is true when the oldest unremoved expired copy is older than the target. It is never a
non-200, because a policy breach must not look like an outage: **the monitor alerts on the field.**
An external check should poll `/status` and alert when `behind` is true, which covers both a failed
sweep and a missed run. A missed run with nothing expired has no user impact, so the backlog is the
signal that matters.

## Client inventory

Revocation is keyed on a client id, so the service keeps the clients it has seen for each account.
A client is recorded on its first authenticated request in a process, in the background, so the hot
path pays one small insert per client rather than one per request. A recording failure is ignored
and retried on a later request: a missed entry only means the user types an id instead of picking one.

The write uses the writer pool, because the reader pool is deliberately unable to write anything.
Without the meeting writer pool there is nothing to record, and recording is a no-op.

`POST /clients` lists them, most recently used first, bounded to 50. It is a read, but it needs the
writer pool, so it carries a device signature like the other writer-pool actions. The list is
bounded account data: no lifecycle metadata and no read content is exposed.

## Device registration

A bearer token alone must not be enough to write. Every write route except registration needs a
registered device and a signature over the exact request.

| Header | Value |
| --- | --- |
| `X-Gappd-Device` | The device id: the SHA-256 of the raw Ed25519 public key, hex |
| `X-Gappd-Signature` | Base64url, no padding, of the Ed25519 signature |
| `X-Gappd-Generation` | The account generation, when the account has one |

`POST /device` registers a 32-byte Ed25519 public key as `{"public_key":"<base64url>"}`. It is the
one write that needs no signature, because it is how a signature becomes possible, and it stays on
the sync scope and the signed Desktop client. Registration is idempotent for the same key. A revoked
device can never register again.

The signed message is, joined by newlines:

```
gappd-write-v1
<METHOD>
<PATH>
<device id>
<generation, or 0>
<hex SHA-256 of the body>
```

It binds the request to the device, to the account generation and to the body, so a signature cannot
be moved to another request, device, generation or body. A missing, unknown or revoked device and a
bad signature are all refused with 403, with no way to tell them apart.

The gate buffers the body to sign over it and hands the same bytes to the handler, so an oversize
body is refused with 413 before the handler sees it. When the meeting writer pool is absent the write
routes are absent too, so a deployment cannot expose an unprotected write.

## Account deletion and generations

`POST /delete-all` erases every cloud copy of the calling account in one transaction: it marks each
identity deleted, removes the content, and closes uploads under a new generation. All three happen
under the same account lock as an upload, so a write cannot race the deletion. The response reports
how many copies were removed.

Uploads then stay closed until an explicit `POST /consent`, which opens them again and issues a new
generation. An upload must present that generation in `X-Gappd-Generation`; a device that never
learned it is refused with 409. A blocked account is refused with 403. An account with no state row,
which is every account before its first deletion, has uploads open and nothing to match.

Two properties to keep in mind:

- A deletion is permanent per identity. Consent reopens uploads for **new** Meetings only; an erased
  Meeting cannot be uploaded again at any revision.
- The generation is not a token claim, so the client must carry it. A client that ignores it can
  still not upload while the account is blocked.

## Grant revocation

A signed token otherwise stays valid until it expires. `POST /revoke` cuts a client off before
that, on the sync scope and the exact signed Desktop client, with a 256-byte
`{"client_id":"<id>"}` body. The literal `*` revokes every client of the account, which also
covers a token that carries no client claim.

Revocations live in `revoked_grants` and are permanent: there is no un-revoke path and a row is
never deleted. The check runs on every authenticated request, and its answer is cached for up to
30 seconds in the process, so a revoked client can keep working for that long and the cache is a
per-instance ceiling rather than a shared one. A lookup failure answers 503 and serves nothing,
because the service must not claim a token is good when it cannot tell.

The runtime role only needs SELECT on `revoked_grants`; the Meeting writer inserts the rows. An
admin can also revoke directly with SQL if the API is unreachable.

## Request and storage limits

One account cannot exhaust the service or its cost, and one runaway client cannot spend the
owner's budget alone.

| Limit | Value |
| --- | --- |
| Read requests to `/mcp` | 60 per minute per account |
| Write requests to `/meeting` | 12 per minute per account |
| Stored copies | 500 per account |
| Stored bytes (title + summary + transcript) | 64 MiB per account |

Each account gets its own token bucket per class, so reads and writes do not consume each
other, and a refusal answers 429 with `Retry-After: 60`. The storage cap answers 413 and
excludes the copy being written, so a revision update still passes when the account is full.

The buckets live in the process: a restart clears them and a second instance would count
separately. They are installed by the server entrypoint, so a different entrypoint would run
unlimited. Move them to a shared store before running more than one instance.

## Real copy cleanup

Real Meeting copies are swept by the same `/cleanup` process, in addition to the synthetic slice.
It needs `MEETING_CLEANUP_DATABASE_URL` for a separate non-owner **gappd_meeting_cleanup** role;
without that variable it sweeps only the synthetic slice.

Run `provision-meeting-cleanup` with a separate 24+ character `MEETING_CLEANUP_DB_PASSWORD` in the
private admin session. The role can read expired copies, mark them deleted and remove their content.
It cannot insert, cannot remove or clear a lifecycle marker, cannot move an acceptance or expiry,
and cannot see a live copy. The lifecycle trigger refuses a marker change for every role, including
an administrator.

Each run removes at most 100 expired copies, marks them first and deletes the content in the same
transaction. A capped batch cannot starve the next one, because the sweep selects only rows that
still have content.

## Private administrator setup

Use a trusted private Railway shell with Go source or the image's `/admin` binary.
Do not open a public database proxy. Do not enable shell tracing or print env values.
Use a separate temporary admin session, not API runtime service variables. Supply:

- `ADMIN_DATABASE_URL`: PostgreSQL administrator URL, used only by `/admin`.
- `RUNTIME_DB_PASSWORD`: securely generated password of at least 24 characters.
- `DEMO_OWNER_ID`: exact verified Clerk user subject from the approved synthetic test.

Run in `/cloud` (or substitute `/admin` for `go run ./cmd/admin` in the built image):

```sh
go run ./cmd/admin migrate
go run ./cmd/admin provision
go run ./cmd/admin seed
unset ADMIN_DATABASE_URL RUNTIME_DB_PASSWORD DEMO_OWNER_ID
```

Migrations 001-012 are transactional, advisory-locked, and recorded in `cloud_migrations`.
It creates `meetings`, enables/forces RLS, and grants no PUBLIC table access.
Migration 004 additionally creates `cloud_meetings` and `meeting_lifecycle` for real copies:
a separate table, separate identity namespace, 1 MiB transcript bound and its own guards. It is
purely additive and does not alter `meetings`, its constraints, its policies or its records.
Migration 005 adds `cloud_read_meetings`, a `security_invoker` union view of synthetic rows and
owned cloud copies. `security_invoker` is required: without it the view runs as its owner and
would bypass both tables' row level security.
Migration 012 removes the synthetic upload demo from migrations 002 and 003: its copies, triggers,
policies, `demo_lifecycle` and helper functions. It keeps the seeded Meeting. Roles are cluster-wide,
so it only revokes `gappd_demo_writer` and `gappd_demo_cleanup` access in this database; drop those
roles separately (`DROP ROLE gappd_demo_writer, gappd_demo_cleanup`). Production applied 012 on
2026-10-03, dropped both roles and removed `GAPPD_SYNTHETIC_UPLOAD_ENABLED`,
`SYNTHETIC_UPLOAD_DATABASE_URL` and `SYNTHETIC_CLEANUP_DATABASE_URL`.

The image is distroless, so `railway ssh` into the API cannot run `/admin` with an admin URL. On
2026-10-03 012 ran instead through `railway ssh --service Postgres` with the container's local
`psql`, inside one transaction holding `pg_advisory_xact_lock(74812001)` like `/admin migrate`.
`railway ssh` joins its arguments into a remote `bash -c`, so pass SQL base64-encoded and decode
it remotely. No admin credential leaves Railway and no public proxy is opened.
Provision grants `gappd_reader` SELECT only on `meetings`, `cloud_meetings`,
`meeting_lifecycle` and `cloud_read_meetings`, with read-only defaults.
Both tables force owner RLS; missing owner context denies access. No lifecycle metadata is in MCP output.
It disables PostgreSQL statement/duration/error statement logs in its transaction
before password DDL. Confirm no external audit extension records password DDL;
provision through your secret manager instead if policy mandates external auditing.
On Railway, pg_stat_statements is preloaded. Set `PGOPTIONS='-c pg_stat_statements.track=none'`
for the entire private admin session so utility statements cannot retain password DDL.
Provision needs an administrator allowed to change these log settings. It fails
closed otherwise. Use a fresh isolated database/role, not a role with existing grants.
Seed is explicit/idempotent and refuses an existing seed owned by another account.
No runtime process migrates, provisions, or seeds. No admin secret belongs in runtime.
Replace Railway's original admin DATABASE_URL reference with a private reader URL;
URL-encode its password. Keep admin credentials only in the administrator session.

Seeded synthetic Meeting: `b47c5e70-8030-4b9e-bb5a-146d17c68731`.

Real copies need two more roles. With the same private admin session, set securely generated
`MEETING_WRITER_DB_PASSWORD` and `MEETING_CLEANUP_DB_PASSWORD` (24+ characters each), then run
`go run ./cmd/admin provision-meeting` and `go run ./cmd/admin provision-meeting-cleanup`.
`provision-meeting` creates the separate `gappd_meeting_writer` role and its owner-scoped policies on
`cloud_meetings` and `meeting_lifecycle`; `provision-meeting-cleanup` creates the separate
`gappd_meeting_cleanup` role for expired copies only. Neither role can reach the synthetic table.
Do NOT re-run plain `provision` on a working deployment: it resets the `gappd_reader` password,
which the API's `DATABASE_URL` already holds. Migrations grant the reader new SELECT privileges
themselves when the role already exists.

## Local/CI checks

Tests create only synthetic data. Use an isolated disposable PostgreSQL database.
Set `TEST_ADMIN_DATABASE_URL` to its administrator URL and `TEST_DATABASE_URL` to its
reader URL with password `synthetic-test-password-only`; the tests provision that role.
Also set `TEST_MEETING_DATABASE_URL` (`gappd_meeting_writer`) and
`TEST_MEETING_CLEANUP_DATABASE_URL` (`gappd_meeting_cleanup`) for the real-copy isolation tests,
using that same synthetic-only test password. CI supplies all four URLs.
Never point these variables at a deployed or real Meeting database.

```sh
go test -race ./...
go vet ./...
go build ./...
docker build -t gappd-cloud:test .
```

Without test database variables, integration tests explicitly skip; auth tests still
run. CI supplies PostgreSQL 18 and runs the real isolation/MCP tests and Docker build.
Tests cover official SDK initialize/list/call, per-request identity changes, invalid
claims/signatures/types, scope representations, RLS without app filters, pooled owner
reset, runtime write/admin rejection, schema/input limits, and fixed JWKS fetch bounds.

## Live gates (parent-owned)

1. Apply migration/provision/seed privately; configure reader URL and canonical resource.
2. Deploy from beta with Railway root `/cloud`; check health/readiness and metadata.
3. Register distinct read-only clients with actual callbacks. Do NOT reuse Desktop
   client `iFaeusoYBwClQRoP`. Keep DCR OFF and S256 required. Request `resource` exactly
   equal to MCP_RESOURCE_URL so Clerk includes audience; request `meetings:read`.
4. Inspect only sanitized claim names/types (never log tokens). Verify documented
   at+jwt, RS256, sub, aud, expiration and scp/scope match the actual issued token.
5. With Pi and hosted ChatGPT, initialize/list then read the seeded Meeting ID as its owner;
   prove another verified account cannot read it. Test denied consent, wrong scope,
   wrong audience, missing/expired token, refresh, and grant revocation limitations.
6. Record client versions, callback/plan requirements, and actual results. Do not
   claim compatibility until these pass. DCR-dependent clients remain blocked.
