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

## Production OAuth clients

The Desktop client is created. The read client is not.

| Client | Client ID | Type | Scopes | State |
| --- | --- | --- | --- | --- |
| `Gappd Desktop` | `t3RzfAuaxamgqOQV` | public, consent on | `email`, `profile`, `offline_access`, `meetings:sync` | **created** |
| `Gappd MCP - Pi` | — | public, consent on | `meetings:read`, `offline_access` | **to create** |

The application's own panel reports the endpoints, which match the issuer:

```
discovery:  https://clerk.getgappd.com/.well-known/openid-configuration
authorize:  https://clerk.getgappd.com/oauth/authorize
token:      https://clerk.getgappd.com/oauth/token
```

Clerk shows a client secret for every application, including a public one. It was not copied or
stored: the desktop is a public client that uses PKCE and must never hold a secret. Confirm the
redirect URI is `http://127.0.0.1/callback` on this client, because the desktop's loopback callback
is checked against it.

## Remaining steps

1. **Create the read client** `Gappd MCP - Pi`: public, consent on, scopes `meetings:read` and
   `offline_access` only. Then re-authorize Pi against it.
2. **Record the redirect URI** on both clients as `http://127.0.0.1/callback`.
3. **Then switch the server**, in this order:
   ```
   CLERK_ISSUER_URL=https://clerk.getgappd.com
   GAPPD_DESKTOP_OAUTH_CLIENT_ID=t3RzfAuaxamgqOQV
   GAPPD_PRODUCTION_MODE=true
   ```
   then deploy. The service refuses to start if the issuer is not a production host.
4. **Then set the two repository variables** `GAPPD_CLERK_ISSUER_URL` and `GAPPD_CLERK_CLIENT_ID`
   so the beta build bakes the production identity.

Do not do step 3 before step 1. Switching first makes the server reject the development tokens that
Pi and the desktop currently hold, and there is no production read client yet to re-authorize with,
so the live read path stops until step 1 is done.
