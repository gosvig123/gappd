# Production identity cutover

The stack runs on a Clerk **development** instance. That instance cannot verify a domain, and the
server refuses it in production mode, so this is the last gate before real Meetings. This page is
the order of work, with the checks that fail closed if a step is skipped.

Nothing here changes code. Every value is configuration.

## What is in place

| Piece | State |
| --- | --- |
| Server issuer | `CLERK_ISSUER_URL`, validated as an HTTPS URL with no path, query or fragment |
| Server production guard | `GAPPD_PRODUCTION_MODE=true` refuses any issuer containing `.clerk.accounts.dev` at startup |
| Desktop identity | `GAPPD_CLERK_ISSUER_URL` and `GAPPD_CLERK_CLIENT_ID`, or the matching build variables, defaulting to the development instance |
| Cloud resource | `GAPPD_CLOUD_RESOURCE_URL` on the desktop, `MCP_RESOURCE_URL` on the server; both must name the same `/mcp` URL |
| Scopes | `meetings:read` for read clients, `meetings:sync` for the Desktop client, neither advertised to sync |

## Order of work

1. **Create the Clerk production instance** in the same application, and add the Gappd domain. Clerk
   requires DNS records for the domain; the desktop and the server both need the resulting issuer.
   Do not delete the development instance: existing development credentials keep working until they
   expire, and the beta build still points at it.
2. **Recreate the two OAuth clients** in the production instance, because clients do not migrate:
   - `Gappd Desktop`, public client, PKCE required, redirect `http://127.0.0.1/callback`, allowed
     scopes `email`, `profile`, `offline_access`, `meetings:sync`. Keep its client id private to the
     product; it is a public client, so the id is not a secret, but only it may request the sync
     scope.
   - `Gappd MCP - <client>`, one per read client, public, PKCE required, redirect
     `http://127.0.0.1/callback`, allowed scopes `meetings:read` and `offline_access` only.
   - Recreate the custom scopes `meetings:read` and `meetings:sync` first: scopes do not migrate
     either.
3. **Enable audience inclusion** on the production instance and **keep Dynamic Client Registration
   off**. DCR is an unauthenticated registration endpoint; enabling it would let any caller register
   a client and ask for the read scope.
4. **Point the server at production**, in this order, and nothing else at the same time:
   `CLERK_ISSUER_URL` to the production issuer, then `GAPPD_PRODUCTION_MODE=true`, then deploy.
   Setting the flag before the issuer is correct and safe: the service refuses to start and says so,
   rather than serving development tokens.
5. **Build the desktop against production.** The release workflow already reads
   `GAPPD_CLERK_ISSUER_URL` and `GAPPD_CLERK_CLIENT_ID` from repository variables, so setting those
   two is the whole step. A packaged build cannot read a runtime environment variable, which is why
   these are build variables and not settings.
6. **Re-authorize every client.** A production token is a different token: Pi and ChatGPT need a
   fresh authorization, and the desktop needs a fresh sign-in. Old development tokens do not become
   production tokens.
7. **Re-register the device.** A device key registered under the development instance is
   re-registered automatically on the first write after sign-in, because registration is per
   credential. Nothing to do by hand; verify the first upload still succeeds.

## Checks that must pass

| Check | How | Fail closed if |
| --- | --- | --- |
| The issuer is production | `GET /health` is 200 after deploy | The service refuses to start when `GAPPD_PRODUCTION_MODE=true` and the issuer is a development host |
| The audience is the cloud resource | A read client authorizes, then `GET /mcp` with its token | The verifier requires exactly one audience equal to `MCP_RESOURCE_URL` |
| The read scope is read-only | `POST /meeting` with a read token | The write route requires `meetings:sync` and the exact signed desktop client id |
| The device gate is live | `POST /meeting` with no device headers | Refused with 403 |
| Account isolation survives | Two accounts, one upload, one read | RLS and the owner filter are unchanged by identity |
| Revocation works | `POST /revoke`, then the revoked client's next call | The check runs on every request, cached for at most 30 seconds |
| The old development issuer is not trusted | A development token against production `/mcp` | The issuer is pinned; a development `iss` fails signature and issuer validation |

## What must be true before step 4

- Backup restore is proven in an isolated target, and point-in-time recovery is enabled.
- A monitor polls `GET /status` and alerts on `cleanup.behind`.
- Log retention has a decision, or a forwarder with its own retention.
- A second account has been tested end to end, and hosted ChatGPT has been tested or explicitly
  deferred.

## Cost and rollback

Reverting is configuration: set `CLERK_ISSUER_URL` back and remove `GAPPD_PRODUCTION_MODE`. That
does **not** revoke production grants or delete production cloud copies, because the issuer is only
one end of the trust. Deleting cloud copies is `POST /delete-all`, and revoking a client is
`POST /revoke`.

The production instance changes the cost profile: Clerk bills per monthly active user above its free
tier, and Railway bills for the PITR archive bucket plus the volume. Check both before opening
sign-ups.
