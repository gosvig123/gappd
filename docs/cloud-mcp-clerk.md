# Gappd cloud MCP — Clerk setup

## Status

Clerk development configuration is prepared. No cloud backend or device registration has
been implemented, no login flow has been completed here, and no real Meeting data was uploaded.
The existing local MCP remains the default. Cloud sync remains an OFF-by-default feature to
implement behind an explicit Settings toggle. Signing in must never turn it on.

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

## Railway configuration

Added these non-secret values to `gappd-cloud-api` in the reserved Railway environment:

```text
CLERK_ISSUER_URL=https://learning-mutt-4805.clerk.accounts.dev
GAPPD_DESKTOP_OAUTH_CLIENT_ID=iFaeusoYBwClQRoP
```

Variables were set with deployment disabled. There is no consumer for them until the cloud
backend is implemented. The environment is named production by Railway but currently points
to Clerk DEVELOPMENT; it must not accept production users or Meeting data in this state.
No Clerk secret key was copied into Railway or Git. JWT signature verification can use the
public signing-key endpoint; administrative operations may need separately provisioned keys.

## Required implementation

1. Reuse `desktop/src/main/oauth.ts` for PKCE and token exchange where its contracts fit.
   It currently allocates a random loopback port. Clerk lists an exact redirect URI without
   a port; prove Clerk's native loopback-port matching behavior before reusing this callback.
   If unsupported, choose and register a safe callback strategy. Do not add wildcard redirects
   or claim the current desktop flow works without completing an actual authorization test.
2. After explicit sync consent, request `meetings:sync` and the intended upload API resource.
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
- This verifies configuration, NOT a successful token exchange, device upload, or MCP request.
- Application-wide PKCE enforcement affects future logins for every OAuth client in this
  development instance. Only the existing public Gappd Desktop client was listed during setup.

## References

- [Live authorization server metadata](https://learning-mutt-4805.clerk.accounts.dev/.well-known/oauth-authorization-server)
- [Clerk OAuth behavior, scopes, PKCE, and token lifetime](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth)
- [Clerk MCP support](https://clerk.com/docs/guides/ai/overview)
