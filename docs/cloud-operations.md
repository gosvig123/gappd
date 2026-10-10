# Cloud operations

How the Gappd cloud service runs, how to change it, and what is still open. The service itself is
described in the [service runbook](../cloud/README.md); retention rules are in the
[lifecycle contract](cloud-data-lifecycle.md). Never print resolved service variables; inspect
names or unresolved references only.

## Railway resources

Workspace: Kristian Gosvig's Projects. Project
[gappd-cloud](https://railway.com/project/b73b1b1e-810b-4c3d-af03-6136244852c0), separate from the
site and OAuth relay project. Railway names the environment `production`.

| Resource | Identifier / configuration |
| --- | --- |
| Project | `b73b1b1e-810b-4c3d-af03-6136244852c0` |
| Environment | `production`: `7b4a6831-62f8-4dda-a2e1-773542c266fb` |
| API service | `gappd-cloud-api`: `7407bf7c-600e-4a4c-928d-bf4c02747463` |
| Cleanup service | `gappd-cloud-cleanup`: `0d10a939-a74c-463f-b1cf-211e15bc230c` |
| Database service | `Postgres`: `1e6d7e2d-b50a-4685-ab97-cacc4557aeae`, image `ghcr.io/railwayapp-templates/postgres-ssl:18` |
| Database volume | `postgres-volume`: `09e2971f-5fba-4cc9-8d60-729a27812e94`, mounted at `/var/lib/postgresql/data` |
| Region | `europe-west4-drams3a` (EU West) |
| Source | `gosvig123/gappd`, branch `beta`, root `/cloud`, watch `/cloud/**` |
| Public MCP URL | `https://gappd-cloud-api-production.up.railway.app/mcp` |

PostgreSQL is private, with no public TCP proxy. The API's `DATABASE_URL` is a private-network URL
for `gappd_reader`; no service holds administrator credentials. Builder (Dockerfile) and the
`/ready` healthcheck are explicit service settings, because the CLI did not persist the nested
`/cloud/railway.toml` path.

Link the CLI explicitly before an infrastructure change:

```sh
railway link --project b73b1b1e-810b-4c3d-af03-6136244852c0 \
  --environment 7b4a6831-62f8-4dda-a2e1-773542c266fb \
  --service 7407bf7c-600e-4a4c-928d-bf4c02747463
```

This CLI version's environment edit reads piped stdin before configuration flags. In automation,
supply a JSON patch on stdin and verify the persisted configuration.

## Deploying the API

A push to `beta` does NOT deploy `gappd-cloud-api`; automatic deployment is off. `railway redeploy`
rebuilds the same commit and cannot ship a newer one. Upload from the repository root with a clean
working tree, because the service sets `rootDirectory=/cloud` with `dockerfilePath=Dockerfile` and
an upload deploys the working tree, not a commit:

```sh
railway up --service 7407bf7c-600e-4a4c-928d-bf4c02747463 \
  --environment 7b4a6831-62f8-4dda-a2e1-773542c266fb \
  --project b73b1b1e-810b-4c3d-af03-6136244852c0 --detach --yes
```

Wait for CI on the commit first. Then confirm the deployment reports `SUCCESS`, and check `/health`,
`/ready`, `/status`, a 401 for `/mcp` without a token, and one authenticated `list_meetings` call.
`railway up` from `/cloud` does not resolve the Dockerfile path. Apply database migrations as the
[runbook](../cloud/README.md#applying-a-migration-in-production) describes.

## Identity (Clerk)

Production uses the Clerk production instance of the `Gappd` application.

| Item | Value |
| --- | --- |
| Application | `app_3Id4GHzrmEco43rxk3si2knnZAZ` |
| Production instance | `ins_3JJlwm8pUSkAERBSaRo0Ii5ue6X` (Hobby plan; OAuth applications and custom scopes are not plan-gated) |
| Issuer (Frontend API) | `https://clerk.getgappd.com` |
| Application domain / account portal | `app.getgappd.com` / `accounts.getgappd.com` |
| Domain | `getgappd.com`, `dmn_3JJlwp7Zpv6SzqzzzNsDF7PgADO`, verified |
| Scopes | `meetings:read` (advertised), `meetings:sync` (not advertised) |
| Dynamic Client Registration | Off; the metadata has no registration endpoint |

Not advertising `meetings:sync` is not an authorization boundary. The server accepts writes only
from the Desktop client, with that scope and a registered device signature.

| Client | Client ID | Scopes | Redirect URIs |
| --- | --- | --- | --- |
| `Gappd Desktop` | `t3RzfAuaxamgqOQV` | `email`, `profile`, `offline_access`, `meetings:sync` | `http://127.0.0.1/callback` |
| `Gappd MCP - Pi` | `WFvlqsHImvP7f14t` | `meetings:read`, `offline_access` | `http://localhost:19876/callback`, `http://127.0.0.1/callback` |

Both clients are public, use PKCE and show a consent screen; no client secret is stored. The bare
`http://127.0.0.1/callback` is deliberate: the desktop binds a random loopback port and Clerk accepts
the port at request time. The release workflow bakes the identity into the desktop build from the
repository variables `GAPPD_CLERK_ISSUER_URL` and `GAPPD_CLERK_CLIENT_ID`. The development instance
(`https://learning-mutt-4805.clerk.accounts.dev`) and its clients are obsolete, and the server refuses
a development issuer with `GAPPD_PRODUCTION_MODE=true`.

**Include Audience must stay on** (Configure → Developers → OAuth applications → Settings → Access
tokens). Without it access tokens have no `aud` claim, and the server answers a bare 401 before any
scope or revocation check, so the fault looks like a bad token.

Five CNAME records at Namecheap serve the instance: `clerk` → `frontend-api.clerk.services`,
`accounts` → `accounts.clerk.services`, `clkmail` → `mail.xk2n1iwgxvot.clerk.services`, and
`clk._domainkey` / `clk2._domainkey` → `dkim1` / `dkim2.xk2n1iwgxvot.clerk.services`.

### Google sign-in

A production instance needs its own Google credentials. Google Cloud project `gappd-production`
holds the Web application client `Gappd Clerk Production v2`
(`185849256404-c3psc1m1h9rl7kknaldc5e9g06cqo87d.apps.googleusercontent.com`) with the redirect URI
`https://clerk.getgappd.com/v1/oauth_callback`. Its secret lives only in Clerk. The `Gappd Desktop`
client in the same project serves the app's Calendar and Gmail access and cannot serve Clerk.

Clerk reports a wrong secret only as `oauth_token_exchange_error`. Check a secret before wiring it in:

```sh
curl -s https://oauth2.googleapis.com/token \
  -d "client_id=$CID" --data-urlencode "client_secret=$SEC" \
  -d grant_type=authorization_code -d code=bogus -d "redirect_uri=https://clerk.getgappd.com/v1/oauth_callback"
```

`invalid_grant` means the credentials are good; `invalid_client` means the secret is wrong.

### Pi re-authorization

Pi keeps its MCP OAuth entry in the system keychain under service `pi-mcp-adapter.oauth` and account
`sha256-<sha256 of the server name>`, plus one `.chunk.*` entry per segment. The `security` command
does not find these entries; delete them with the adapter's own `@napi-rs/keyring` library from
`~/.pi/agent/npm/node_modules/pi-mcp-adapter`. Restart Pi after changing the client ID in
`~/.pi/agent/mcp.json`, because Pi reads it only at start-up.

## Expired copy cleanup

`gappd-cloud-cleanup` runs `/cleanup` (start command override) on the schedule `0 * * * *` UTC, with
restart policy NEVER and no HTTP healthcheck. Its only database setting is
`MEETING_CLEANUP_DATABASE_URL`, a private URL for the restricted non-owner role
`gappd_meeting_cleanup`; the command fails without it.

Each run removes at most 100 expired copies and keeps their deletion markers. At an hourly
frequency that is a nominal 2,400 copies a day, not an SLA: Railway can delay a tick and skips one
while the previous run is active. `GET /status` publishes the backlog; `cleanup.behind` is true when
the oldest unremoved expired copy is older than 24 hours.

`npm run cloud:status` reads `/status` and fails when `cleanup.behind` is true, with a macOS
notification when it can. `npm run cloud:status:install` writes a LaunchAgent that runs it hourly and
logs to `~/Library/Logs/gappd-cloud-status-watch.log`; `cloud:status:uninstall` removes it.

## End-to-end upload proof

`npm run cloud:proof` proves the upload path against the deployed service without the app UI. It
signs in with the Desktop client, registers a device, creates and exports its own fixture Meeting
with the real exporter, signs the upload and sends it, using the app's own device module. The
browser it opens must already hold a Clerk session or complete one sign-in.

`--delete` removes the copy afterwards, `--dry-run` stops before any network call, `--revision=N`
raises the revision, and `--keep` keeps the isolated profile. Each run gets a fresh Meeting, so
`--delete` never spends the proof for the whole account. It passed against the production identity
on 2026-09-14: registration, upload, read-back and delete, with the fixed 30-day expiry.

## Backups and recovery

Daily volume backups: schedule `45cb81af-0160-4847-a7eb-2948aea475c2` on volume instance
`190d6f11-ec72-4a03-a36d-55774b567e7e`, at the provider-selected `16 16 * * *` UTC, retention
518,400 seconds (6 days), below the approved 7-day maximum. There are no weekly or monthly schedules.
A manual backup has no expiry (`expiresAt: null`) and must be deleted by hand; do not use manual
backups as a substitute for the schedule.

Point-in-time recovery is on: `WAL_ARCHIVE_*` variables on `Postgres` point at the `Postgres-PITR`
bucket. A PITR restore creates a new standalone Postgres service and leaves the live one running.
The restorable window starts at the moment PITR was enabled (2026-09-14).

Both paths were drilled on 2026-09-14 into isolated targets, never the live volume. Each restored
cluster had the expected migrations, copies, deletion markers and all `gappd%` roles, and lacked a
sentinel row written after the restore point, which proves a real rollback. A volume restore is
staged (unmount old, mount new, redeploy) and stays discardable until `Deploy`; attach the restored
volume to a throwaway Postgres service instead of deploying it onto live. Delete drill services and
volumes afterwards; Railway completes volume deletion within 48 hours.

A restore must stay offline until current deletion markers and expiry rules are applied: a snapshot
cannot know about deletions made after it.

## Why a re-upload of a deleted Meeting fails with 503

The cloud copy ID is derived (`meeting_copy_id(owner_id, local_id)`), deletion is permanent
(`meeting_lifecycle.deleted_at` is only ever set), and `guard_cloud_meeting_insert` requires a live
accepted lifecycle row. A re-upload of a deleted Meeting therefore fails in `verifyStored`, and
`writeUploadRefusal` falls through to `503 cloud copy unavailable`. The desktop queue stops after
`MAX_SYNC_ATTEMPTS`, so this is a diagnosability problem, not a retry loop. A dedicated sentinel and
a permanent status would make it clear.

To see which local Meetings are spent for an account, read the lifecycle table over the private
tunnel. Never clear `deleted_at` to revive a copy; the permanence is the guarantee.

```sh
printf "SELECT owner_id, left(id::text,8), left(local_id,8), deleted_at IS NOT NULL AS deleted FROM meeting_lifecycle ORDER BY 1;\n" \
  | railway connect Postgres --ssh --project b73b1b1e-810b-4c3d-af03-6136244852c0 \
      --environment 7b4a6831-62f8-4dda-a2e1-773542c266fb
```

## Open gates

| Gate | State |
| --- | --- |
| Log retention | Blocked. The workspace is on Railway Pro, which keeps logs 30 days with no per-service control or drain, against the approved 14-day cap. Options: a log forwarder with its own 14-day store (Railway still keeps its copy) or an owner-approved exception. Logs carry no tokens, account IDs or Meeting text. |
| Backup expiry | Unverified. Observe a scheduled backup and confirm its expiry metadata and actual removal. |
| Deployed-side monitor | Only the development Mac's LaunchAgent polls `/status`. Add a monitor that does not depend on that Mac. |
| Second account and hosted ChatGPT | Deferred. Pi's owned read is proven; a second real account and ChatGPT developer mode are needed for cross-account and client checks. |
| Revocation timing | `POST /revoke` is checked on every request with a 30-second per-instance cache. Clerk refresh tokens do not expire, and signed access tokens stay valid until expiry outside that check. |
| Limits and instances | Rate buckets and the storage check live in one process. Move them to a shared store before running a second instance. |
| Staging | There is no separate staging environment; `beta` is the deploy branch. |

## Primary sources

- [Railway cron semantics](https://docs.railway.com/cron-jobs)
- [Docker entrypoint override](https://docs.railway.com/deployments/start-command)
- [Backup schedules and retention](https://docs.railway.com/volumes/backups)
- [Plan-based log retention](https://docs.railway.com/observability/logs#log-retention)
- [Clerk OAuth behavior, scopes, PKCE and token lifetime](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth)
