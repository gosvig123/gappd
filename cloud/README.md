# Synthetic cloud MCP

Independent Go 1.25 service. The desktop and root CLI are unchanged. No uploads,
real Meeting access, audio, list, search, storage sync, or automatic seed exists.
Private Railway migration, reader-role provisioning, and synthetic seed are complete.
Independent review, Go 1.25.13 PostgreSQL 18 race tests, and Docker build passed.
Live API deployment, Clerk, Pi, and hosted ChatGPT validation remain pending.

## Runtime

Set only these variables on the Railway API service (root `/cloud`, branch `beta`):

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
