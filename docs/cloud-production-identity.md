# Production identity cutover

The stack runs on a Clerk **development** instance. That instance cannot verify a domain, and the
server refuses it in production mode, so this is the last gate before real Meetings. This page is
the order of work, with the checks that fail closed if a step is skipped.

Nothing here changes code. Every value is configuration.

## Live state (2026-09-14)

A production instance was created by cloning the development instance, because the identity work
cannot be finished without it and the cloning is what preserves the authentication and theme
settings.

| Item | Value |
| --- | --- |
| Application | `Gappd`, id `app_3Id4GHzrmEco43rxk3si2knnZAZ` |
| Production instance | `ins_3JJlwm8pUSkAERBSaRo0Ii5ue6X` |
| Application domain | `app.getgappd.com` |
| **Issuer (Frontend API)** | **`https://clerk.getgappd.com`** |
| Account portal | `accounts.getgappd.com` |
| Domain record | `getgappd.com`, `dmn_3JJlwp7Zpv6SzqzzzNsDF7PgADO`, **Verified** (API, portal and 3/3 email) |
| Plan | Hobby. OAuth applications and custom scopes are **not** plan-gated, so no upgrade is needed |
| Scopes | `meetings:read` (advertised) and `meetings:sync` (not advertised) recreated |
| OAuth applications | **Not yet created.** They do not migrate and must be recreated |

`clerk.` and `accounts.` are reserved by Clerk as *application* subdomains. `clerk.getgappd.com` is
still the Frontend API host, which is why it is the issuer.

## DNS records (added and verified)

Five CNAME records were added at Namecheap and verified by Clerk on 2026-09-14. All five now resolve
at Namecheap's nameservers.

| Type | Name | Value | Purpose |
| --- | --- | --- | --- |
| CNAME | `clerk` | `frontend-api.clerk.services` | Frontend API: the issuer host |
| CNAME | `accounts` | `accounts.clerk.services` | Account portal |
| CNAME | `clkmail` | `mail.xk2n1iwgxvot.clerk.services` | Email sending |
| CNAME | `clk._domainkey` | `dkim1.xk2n1iwgxvot.clerk.services` | DKIM |
| CNAME | `clk2._domainkey` | `dkim2.xk2n1iwgxvot.clerk.services` | DKIM |

The live authorization-server metadata confirms the instance is correct:

```
issuer: https://clerk.getgappd.com
scopes_supported: openid profile email public_metadata private_metadata offline_access meetings:read
registration_endpoint: absent
```

`meetings:read` is advertised, `meetings:sync` is absent, and there is no registration endpoint, which
is the contract this project requires.

## Switch state

The server runs on the production identity. `/.well-known/oauth-protected-resource/mcp` returns:

```
resource: https://gappd-cloud-api-production.up.railway.app/mcp
authorization_servers: ['https://clerk.getgappd.com']
scopes_supported: ['meetings:read']
```

Railway variables now set on `gappd-cloud-api`:

```
CLERK_ISSUER_URL=https://clerk.getgappd.com
GAPPD_DESKTOP_OAUTH_CLIENT_ID=t3RzfAuaxamgqOQV
GAPPD_PRODUCTION_MODE=true
```

## Production OAuth clients

Both are public with a consent screen and the same redirect rule. Clerk shows a client secret for
every application, public included; none was copied or stored, because both clients use PKCE.

| Client | Client ID | Scopes | Redirect URIs |
| --- | --- | --- | --- |
| `Gappd Desktop` | `t3RzfAuaxamgqOQV` | `email`, `profile`, `offline_access`, `meetings:sync` | `http://127.0.0.1/callback` |
| `Gappd MCP - Pi` | `WFvlqsHImvP7f14t` | `meetings:read`, `offline_access` | `http://localhost:19876/callback`, `http://127.0.0.1/callback` |

The desktop asks for `email profile meetings:sync` and lets the server add the rest. The bare
`http://127.0.0.1/callback` is deliberate: the desktop binds a random loopback port, so the
registered URI carries no port and Clerk accepts the port at request time.

The development clients are obsolete. `TWKqKO5MnYvt8bAL` (Pi) and `iFaeusoYBwClQRoP` (desktop) live
on the development instance and no longer work against this server.

## Pi re-authorization

Pi keeps its MCP OAuth entry in the operating system credential store, under keychain service
`pi-mcp-adapter.oauth` and account `sha256-<sha256 of the server name>`. For `gappd-cloud` that is
`sha256-b98d15b1fb413cb00e5e53f15bc15c0643f96e01776cc9550e7b7e7e1a3c97ce`, plus a `.chunk.*` entry
for each segment.

To clear it, use the adapter's own keyring library, because the `security` command line tool does not
find these entries:

```sh
cd ~/.pi/agent/npm/node_modules/pi-mcp-adapter
node -e "const {Entry}=require('@napi-rs/keyring');
for (const a of ['sha256-b98d15b1fb413cb00e5e53f15bc15c0643f96e01776cc9550e7b7e7e1a3c97ce',
                 'sha256-b98d15b1fb413cb00e5e53f15bc15c0643f96e01776cc9550e7b7e7e1a3c97ce.chunk.3b7188aaa8ea4a6f.0',
                 'sha256-b98d15b1fb413cb00e5e53f15bc15c0643f96e01776cc9550e7b7e7e1a3c97ce.chunk.3b7188aaa8ea4a6f.1'])
  new Entry('pi-mcp-adapter.oauth', a).deleteCredential();"
```

Then restart Pi, because the MCP client ID is read from `mcp.json` at process start. Without the
restart Pi keeps the old client ID in memory and the production issuer rejects it.

`~/.pi/agent/mcp.json` already points at `WFvlqsHImvP7f14t`.

## Why production sign-in returned 400

Two separate faults, both found in the instance log rather than by guessing.

**1. Google sign-in cannot work on a production instance without your own credentials.**
The SSO connection page says it plainly: "This provider is enabled but won't work until you add custom
credentials" and "You must provide your own credentials on production instances". A development
instance runs on Clerk's shared OAuth application; a production instance does not. The instance log
shows the owner's two attempts as `sign_in.created` with `strategy: oauth_google` at 14:56 and 15:00,
which is the round trip that cannot finish.

If you want Google sign-in, create a Google Cloud OAuth client of type Web application with the
authorized redirect URI Clerk shows on that page:

```
https://clerk.getgappd.com/v1/oauth_callback
```

Then paste its client ID and secret into the same page. Clerk's redirect URI must be entered exactly.

Email address with password already works on production. The sign-up page offers it, and production
has **no users yet**, so the owner must sign up there before any sign-in can succeed.

**2. The Google enable toggle does not persist.** The "Enable for sign-up and sign-in" switch returns
to on after Save and after a reload, tried twice, by clicking both the hidden input and the visible
control. Do not spend time on it; either supply credentials or leave it alone.

**3. A separate log entry explains the earlier Pi failure**, and is not a Google problem:

```
oauth_authorization.failed  14:50:56  oauth_client_id: "TWKqKO5MnYvt8bAL"
redirect_uri: "http://localhost:19876/callback"
reason: "oauth2idp_patch_fosite_state_non_invalid_state_error"
```

`TWKqKO5MnYvt8bAL` is the obsolete development Pi client. That attempt failed because Pi still held
that client ID in memory when it ran against the production issuer, which is the fault the restart
note above addresses.

## The setting that production needs and development hid

**Include Audience must be on**, under Configure, Developers, OAuth applications, Settings, Access
tokens. Clerk's own text: "OAuth access tokens will include an optional `aud` claim. This will be
populated based on a client's requested `resource`, if requested."

Without it the access token has no `aud` claim at all, and `service.Auth.identity` requires `aud` to
be exactly the one resource. The server answers `401 Unauthorized` and says nothing else. The
decoded production token looked like this:

```
iss: https://clerk.getgappd.com        client_id: t3RzfAuaxamgqOQV
scope: email profile meetings:sync offline_access
claims: client_id, exp, iat, iss, jti, nbf, scope, sub      <- no aud
```

This is worth remembering because the fault is invisible from our side. The 401 arrives before any
revocation or scope check, so it looks like a bad token rather than a missing instance setting.

## Google sign-in on production

A development instance runs on Clerk's shared Google application. A production instance does not,
and the SSO page says so: "You must provide your own credentials on production instances."

The Gappd Production Google Cloud project, `gappd-production`, now holds a Web application client:

| Field | Value |
| --- | --- |
| Name | `Gappd Clerk Production v2` |
| Type | Web application |
| Client ID | `185849256404-c3psc1m1h9rl7kknaldc5e9g06cqo87d.apps.googleusercontent.com` |
| Authorized redirect URI | `https://clerk.getgappd.com/v1/oauth_callback` |

The separate `Gappd Desktop` client in the same project is a Desktop client for the app's own
Calendar and Gmail use. It has no secret and loopback redirects, so it cannot serve Clerk. Leave it
alone.

The client secret lives only in Clerk. **Verify a secret before wiring it in**, because the failure
is otherwise opaque: Clerk reports `oauth_token_exchange_error` and nothing more. Google's token
endpoint tells you which half is wrong:

```sh
curl -s https://oauth2.googleapis.com/token \
  -d "client_id=$CID" --data-urlencode "client_secret=$SEC" \
  -d grant_type=authorization_code -d code=bogus -d "redirect_uri=https://clerk.getgappd.com/v1/oauth_callback"
```

`invalid_grant` means the credentials are good and only the code was rejected. `invalid_client` means
the secret is wrong. Read the secret from the creation dialog by its element text, not by a loose
pattern over the whole page; a single misread character costs a full re-create.

## Validation result

`npm run cloud:proof -- --delete` ran green against the production identity on 2026-09-14:

```
registered device deb30a3bc5b0581a4a58387dbf5d6a271609dfe85fd55a3d1e5f3634e3a7b605 for leasemobil@gmail.com
UPLOAD OK {"subject":"user_3JK8zogxx8h4LLlE6uEL5NGjHBg","email":"leasemobil@gmail.com",
           "cloud_id":"5f5b4ff5-e7f0-8ae0-944e-1133f65bcef3","revision":1,
           "expires_at":"2026-10-14 15:18:21.137318+00","bytes":475}
deleted the cloud copy 5f5b4ff5-e7f0-8ae0-944e-1133f65bcef3
```

That covers production sign-in through the production Desktop client, device registration, upload,
read-back and delete, with the fixed 30-day expiry unchanged. The production account is
`leasemobil@gmail.com`, subject `user_3JK8zogxx8h4LLlE6uEL5NGjHBg`.

Repository variables now carry the production identity for the beta build:

```
GAPPD_CLERK_ISSUER_URL=https://clerk.getgappd.com
GAPPD_CLERK_CLIENT_ID=t3RzfAuaxamgqOQV
```

## Remaining steps

1. **Restart Pi**, then authorize the read client. Pi reads the MCP client ID only at start-up, so
   the running session still holds the obsolete development ID even though `mcp.json` is updated.
2. **Delete the old synthetic proof copy** `6625cbdd-e463-8b15-a0b0-8a7157400ef6` when convenient.
   It still carries the older expiry and is no longer needed.
3. **Then cut the beta build.** The repository variables are set, so the build will carry the
   production identity.
