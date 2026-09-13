# Synthetic cloud MCP

Independent Go 1.25 service. Local MCP and the root CLI are unchanged. The optional
synthetic demo transport creates fixed fabricated text only; no real Meeting access,
audio, list, search, storage sync, or automatic seed exists.
Private Railway migration, reader-role provisioning, and synthetic seed are complete.
Independent review, Go 1.25.13 PostgreSQL 18 race tests, and Docker build passed.
Railway deployed commit `7eb4058`; health, readiness, public metadata and unauthenticated
401 checks passed. Pi live login and owned get_meeting passed. Live second-account
and hosted ChatGPT checks are explicitly deferred, not validated.

## Runtime

Railway uses root `/cloud`, branch `beta`, explicit Dockerfile builder and `/ready` healthcheck.
These settings are configured on the service: the CLI did not persist the nested TOML path.
Base read-only runtime variables (optional demo configuration is below):

- `DATABASE_URL`: private PostgreSQL URL for **gappd_reader**, never the administrator.
- `CLERK_ISSUER_URL`: `https://learning-mutt-4805.clerk.accounts.dev`.
- `MCP_RESOURCE_URL`: `https://gappd-cloud-api-production.up.railway.app/mcp`.
- `PORT`: Railway listening port; default `8080`.

`GET /health` is public liveness; `GET /ready` checks a runtime database connection.
Both protected-resource metadata paths are public:
`/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`.
`/mcp` is authenticated Streamable HTTP, stateless, with one `get_meeting({id})` tool.
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
these constraints. Only `synthetic=true` rows are allowed and returned.

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

Migration 001 is transactional, advisory-locked, and recorded in `cloud_migrations`.
It creates `meetings`, enables/forces RLS, and grants no PUBLIC table access.
Provision creates/updates `gappd_reader` with SELECT only and read-only defaults.
It disables PostgreSQL statement/duration/error statement logs in its transaction
before password DDL. Confirm no external audit extension records password DDL;
provision through your secret manager instead if policy mandates external auditing.
On Railway, pg_stat_statements is preloaded. Set `PGOPTIONS='-c pg_stat_statements.track=none'`
for the entire private admin session so utility statements cannot retain password DDL.
Provision needs an administrator allowed to change these log settings. It fails
closed otherwise. Use a fresh isolated database/role, not a role with existing grants.
Seed is explicit/idempotent and refuses an existing demo owned by another account.
No runtime process migrates, provisions, or seeds. No admin secret belongs in runtime.
Replace Railway's original admin DATABASE_URL reference with a private reader URL;
URL-encode its password. Keep admin credentials only in the administrator session.

Demo Meeting ID: `b47c5e70-8030-4b9e-bb5a-146d17c68731`.
Title, summary, transcript, and timestamps are clearly fabricated. A missing Meeting
and another account's Meeting give the same tool error. No `user_id` input exists.

## Local/CI checks

Tests create only synthetic data. Use an isolated disposable PostgreSQL database.
Set `TEST_ADMIN_DATABASE_URL` to its administrator URL and `TEST_DATABASE_URL` to its
reader URL with password `synthetic-test-password-only`; the tests provision that role.
For demo integration tests also set `TEST_DEMO_DATABASE_URL` to the isolated
`gappd_demo_writer` URL with that same synthetic-only test password.
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
5. With Pi and hosted ChatGPT, initialize/list then read the demo ID as its owner;
   prove another verified account cannot read it. Test denied consent, wrong scope,
   wrong audience, missing/expired token, refresh, and grant revocation limitations.
6. Record client versions, callback/plan requirements, and actual results. Do not
   claim compatibility until these pass. DCR-dependent clients remain blocked.

Before real data: production identity/domains, new desktop upload consent, deletion,
rate/cost controls, grant revocation policy, retention, backups/restore, and staging.
This slice intentionally serves only synthetic data and does not relax those gates.

## Optional synthetic demo transport (disabled by default)

`GAPPD_SYNTHETIC_UPLOAD_ENABLED=true` explicitly enables `POST /demo-meeting`.
Missing/other values leave the route absent and never open a writer pool. Enabling
requires `GAPPD_DESKTOP_OAUTH_CLIENT_ID` and `SYNTHETIC_UPLOAD_DATABASE_URL` for
**gappd_demo_writer**, never admin or reader credentials. `/mcp` and public discovery
still advertise/require only `meetings:read`; gappd_reader grants are unchanged.

POST requires the same strict JWT checks plus `meetings:sync` and exact signed
`client_id` equal to the configured Desktop client. Missing client_id fails closed.
The body must be empty, including chunked requests; even `{}` or synthetic-tagged
caller text is rejected. Server code constructs the fixed fixture. This proves demo
creation/consent transport, NOT validation or upload of Meeting documents.
Ownership comes only from verified token `sub`. A deterministic account-specific UUID
provides idempotency without updates; a collision fails generically, never reassigns
or exposes another account. The seeded demo ID is not reused or changed. A successful
200 response contains `status: accepted`, `id`, and `subject`; use the returned ID in Pi.

### Parent-owned live setup and checks

1. Publish reviewed changes only after local tests/builds pass. Do not mutate seeded data.
2. In the trusted private admin session described above, set
   `PGOPTIONS='-c pg_stat_statements.track=none'` if preloaded, BEFORE opening the connection.
   Supply `ADMIN_DATABASE_URL` and a securely generated `DEMO_WRITER_DB_PASSWORD`
   (24+ characters). Confirm no external auditing captures role/password DDL.
3. Run `go run ./cmd/admin migrate` then `go run ./cmd/admin provision-demo` (or `/admin`).
   The latter creates the separate non-owner role and fixed-payload INSERT RLS policy;
   grants SELECT/INSERT only, no UPDATE/DELETE. Use a fresh isolated role without other grants.
   Unset admin URL/password after provisioning. Never place either in API runtime.
4. Set private writer URL (URL-encoded password), Desktop client `iFaeusoYBwClQRoP`,
   and the explicit capability flag on the API. Keep existing reader URL, issuer and
   canonical resource unchanged. Deploy; disabled mode must need no writer configuration.
5. Start an isolated desktop development profile with `GAPPD_SYNTHETIC_UPLOAD_ENABLED=true`.
   No app binary replacement is needed. Settings → Connections → Synthetic demo Meeting:
   Connect demo account explicitly; complete user-owned browser consent. OAuth requests
   `email profile meetings:sync` and canonical resource, never offline_access/refresh.
   Confirm actual signed client_id exists; do not relax validation if it does not.
6. Verify displayed account, check the NEW unchecked consent, then Upload demo Meeting.
   Read the acknowledged ID through Pi as its owner. Repeat only with new manual consent;
   it returns the same ID. Check OFF, denied login, expired login, failure, and account switch.
   No acknowledgment means outcome unknown, not proof that the server rejected it.
7. Disable both flags after the coordinated test. OFF clears demo credentials/consent and
   cancels locally; it does not recall accepted requests or delete cloud copies.

Desktop demo credentials are separate, protected, and resource-bound. Startup only reads
local credentials; saved auth-only credentials never enable uploads or browser login.
Consent exists only in main-process memory, bound to the userinfo-verified account and
exact token, and is consumed once at the final action. No silent retry exists.
Automated two-account isolation is not live second-account proof. ChatGPT remains deferred.
General uploads/device registration, production identity, retention/deletion, revocation,
rate/cost controls, backups/restore and staging remain required before real Meeting data.
