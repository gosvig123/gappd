# Gappd cloud MCP — Clerk setup

## Status

Clerk development auth is wired to Settings → Connections → Cloud sync, default OFF.
Automated tests and a user-completed live development Settings login passed on 2026-09-13.
`/cloud` now serves synthetic-only read MCP on Railway; live client auth checks are pending.
No upload or device registration exists. See the [service runbook](../cloud/README.md).
The existing local MCP remains the default. No Meetings are uploaded.

This extends [the cloud MCP handover](cloud-mcp-handover.md). Reuse the existing Clerk
application; do not create a second Gappd identity system or reuse Google Calendar credentials.

## Existing resources, verified in Clerk

| Resource | Value |
| --- | --- |
| Workspace / plan | Personal workspace / Hobby |
| Application | Gappd: app_3Id4GHzrmEco43rxk3si2knnZAZ |
| Instance | Development: ins_3Id4GPfx6FsSXul3ssZnAbljXeG |
| Issuer | https://learning-mutt-4805.clerk.accounts.dev |
| Desktop OAuth application | Gappd Desktop: oa_3Id5BEBuhYLGvg5TbwfX8b5QUb8 |
| Desktop public client ID | iFaeusoYBwClQRoP |
| Existing redirect URI | http://127.0.0.1/callback |
| Pi public read client | TWKqKO5MnYvt8bAL; oa_3JGyOCPDXsq5Lxhib8jLTpHfVbd |

The desktop client already used public-client PKCE and an enabled consent screen.
Its original scopes were email, profile, and offline_access. These were preserved.
No client secrets, sign-in methods, user accounts, or redirect URIs were changed.

## Applied configuration

- Created `meetings:read`: read synced transcripts, summaries, Meeting speaker labels, and
  sync status. Advertised in OAuth discovery metadata for MCP clients.
- Created `meetings:sync`: upload, update, and delete cloud copies owned by a recording device.
  Not advertised. Added to the existing Gappd Desktop client's allowed scopes only.
- Required S256 PKCE for authorization-code requests at the instance level.
- Enabled audience inclusion: tokens can contain `aud` when the client requests `resource`.
- Preserved the existing JWT access-token format and desktop consent requirement.
- Kept public Dynamic Client Registration (DCR) disabled. It exposes an unauthenticated
  registration endpoint and requires a deliberate onboarding/security decision.

Not advertising a scope is NOT an authorization boundary. The cloud upload API must accept
only the approved desktop client, the sync scope, a registered device, and the correct owner.
Adding an allowed scope does not grant it to existing tokens or enable application sync.

## Read-only client setup

Pi has a separate public client, `Gappd MCP - Pi (development)`, with consent enabled.
Its only allowed scopes are `meetings:read offline_access`; callback is
`http://127.0.0.1/callback`. Desktop registration and DCR remain unchanged.
Pi configuration was added to the user's shared MCP file; `/reload` is needed to load it.
Automatic installation failed because DCR is disabled; the explicit public client avoids DCR.
Pi live authorization is pending. ChatGPT Developer mode was OFF during inspection;
the user must enable it before its exact connection callback can be obtained.

## Railway configuration

Added these non-secret values to `gappd-cloud-api` in the reserved Railway environment:

```text
CLERK_ISSUER_URL=https://learning-mutt-4805.clerk.accounts.dev
GAPPD_DESKTOP_OAUTH_CLIENT_ID=iFaeusoYBwClQRoP
```

Variables were set with deployment disabled. The cloud backend now consumes CLERK_ISSUER_URL;
MCP_RESOURCE_URL and a private reader DATABASE_URL are also required. The environment is named production by Railway but currently points
to Clerk DEVELOPMENT; it must not accept production users or Meeting data in this state.
No Clerk secret key was copied into Railway or Git. JWT signature verification can use the
public signing-key endpoint; administrative operations may need separately provisioned keys.

## Implemented authentication-only preview

- Explicit development issuer/client in `service-config.ts`; no production fallback or secret.
- ON opens the system browser with public-client authorization code + S256 PKCE and only
  `email profile`. No `meetings:sync`, `offline_access`, resource or upload grant is requested.
- Loopback checks state, duplicate parameters and Clerk issuer before code exchange; errors
  are safe local messages. Trusted HTTPS `/oauth/userinfo` must return subject and verified email.
- Only successful account verification and protected persistence enable the preview. Renderer
  receives account/status only. Tokens never enter preferences, renderer, or logs.
- Credentials use Electron safeStorage in a separate `cloud-auth-development.enc` file.
  Secure storage failure blocks login before opening the browser; there is no plaintext fallback.
- OFF/cancel invalidates pending login, closes the loopback listener, aborts network requests,
  and serializes credential deletion after any in-flight write. It touches no Calendar data.
- Startup reads local protected credentials only, never opens a browser or calls cloud services.
  Expired credentials require explicit reconnect; no refresh token is retained or automatically
  used. Cached identity is not a promise of live Clerk session validity or immediate revocation.
- OFF removes local credentials, not the Clerk browser session or server-side OAuth grant.
  The next login shows consent and the verified account; use Clerk's browser account switch
  if needed. No account is inferred from a Google Calendar connection.
- Authentication consent is NOT future upload consent. A later sync feature MUST ask again,
  including separate historical Meeting consent; it cannot upgrade this state into upload rights.
- Clerk's official CLI guide documents accepting dynamic native loopback ports with the exact
  registered `http://127.0.0.1/callback`. No redirect allowlist changes were made here.
  Source: https://clerk.com/blog/adding-clerk-auth-to-your-cli . The live development flow passed.

## Live Settings smoke test

Run `cd desktop && npm run dev` (or `npm run dev:start` if native artifacts are prepared).
Do not install/replace app binaries or alter existing user credentials. Use a coordinated test
profile when isolation is needed. Open Settings → Connections, verify OFF and preview copy,
then explicitly turn ON. The user owns browser sign-in/password/2FA. Confirm displayed subject
and verified email, restart without a browser launch, and test OFF/cancel and denied consent.
Do not print OAuth codes or tokens, browser callback URLs, or decrypted store contents.
Live development checks passed: real callback/token/userinfo acceptance, protected credential
persistence through restart without browser launch, OFF removal, recovery after a simulated
filesystem deletion failure, and pending-status refresh after closing/reopening Settings.
The isolated profile ended OFF with its credential file removed. Production remains a gate.
For isolated tests, keep the Electron process HOME unchanged so macOS secure storage works;
isolate Electron userData and pass a separate HOME to backend subprocesses instead.

## Remaining implementation

1. Reuse `desktop/src/main/oauth.ts` for PKCE and token exchange where its contracts fit.
   Dynamic loopback ports follow Clerk's documented native-client contract above.
   Development end-to-end sign-in passed; repeat against the production instance before release.
2. Only in a future sync implementation, after NEW explicit upload consent, request `meetings:sync` and the intended upload API resource.
   Bind the authenticated account and approved desktop client to a device registration.
   Store credentials with macOS-protected storage; a supplied device ID is not authentication.
3. Validate OAuth access tokens, not ID tokens: signature, issuer, expiration, intended audience,
   granted scope, and applicable client identity. Never accept a missing audience simply because
   Clerk includes it only when requested. Enforce Meeting ownership and revoked-device state.
4. Clerk documents one-day OAuth access tokens and refresh tokens that never expire. Do not
   assume short lifetimes or refresh-token rotation. Locally verified JWTs do not provide
   immediate Clerk revocation. Choose and test online verification or Gappd grant/device
   revocation checks before promising immediate revocation.
5. Configure read-only OAuth clients with their actual redirect URIs once the MCP endpoint and
   target clients are known. Prefer explicit registration where supported. If ChatGPT or a
   desktop client requires DCR, review its public-registration risk, restrict grants, configure
   read-only defaults, and test that it cannot obtain upload access. No fabricated callback
   URLs or placeholder OAuth clients were created.
6. Prove hosted ChatGPT and desktop MCP authorization, refresh, denied consent, wrong audience,
   wrong scope, client revocation, device revocation, and cross-account rejection with synthetic
   data. Do not conflate Clerk sign-in with hardware attestation or device ownership enforcement.
7. Create/configure a Clerk production instance and verified domains before public release;
   use separate staging credentials and revisit Railway's development branch/environment setup.

## Verification and limits

- Reloaded the Desktop OAuth client: public and consent enabled; four allowed scopes including
  meetings:sync. Existing redirect URI preserved.
- Reloaded OAuth settings: PKCE required, audience inclusion enabled, JWT format preserved,
  and public DCR disabled.
- Fetched live OAuth metadata: expected issuer, S256 support, authorization-code and refresh
  grants, meetings:read advertised, meetings:sync absent, registration endpoint absent.
- Live Settings login verified token exchange and verified account display. The encrypted file
  was owner-only (0600); OFF removed it. All 258 desktop tests, typecheck, and builds passed.
- Synthetic remote MCP has automated local coverage, not live Clerk/client proof.
  No device upload is implemented. No Meetings were uploaded.
- Application-wide PKCE enforcement affects future logins for every OAuth client in this
  development instance. Only the existing public Gappd Desktop client was listed during setup.

## References

- [Live authorization server metadata](https://learning-mutt-4805.clerk.accounts.dev/.well-known/oauth-authorization-server)
- [Clerk OAuth behavior, scopes, PKCE, and token lifetime](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth)
- [Clerk MCP support](https://clerk.com/docs/guides/ai/overview)

Raw JWT claim references used by `/cloud` (no live tokens retained):
- [Clerk OAuthJwtPayload scp/scope](https://github.com/clerk/javascript/blob/main/packages/backend/src/api/resources/IdPOAuthAccessToken.ts)
- [Clerk OAuth at+jwt discriminator](https://github.com/clerk/javascript/blob/main/packages/backend/src/tokens/machine.ts)
