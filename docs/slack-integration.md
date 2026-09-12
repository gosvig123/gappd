# Slack integration

Status: direct desktop sign-in foundation. Gappd uses Slack's PKCE public-client flow from the Electron main process. There is no server, no client secret, no proxy, and no sending feature yet.

## Components

- `slack-app/manifest.json`: the Gappd-owned Slack app definition (no secrets).
- `desktop/src/main/slack-oauth.ts`: PKCE authorization, code exchange, token refresh, token parsing.
- `desktop/src/main/slack-connection.ts`: serialized refresh and atomic token persistence.
- `desktop/src/main/slack-service.ts`: Electron composition (secure store, shell, client ID).
- Settings panel: `desktop/src/renderer/components/slack-panel.tsx` with `use-slack-connection.ts`; IPC group `slack` in `desktop/src/shared/ipc-contract.ts`.

## Slack app

| Item | Value |
| --- | --- |
| App | `A0C1C2FVC78` in workspace `T0C19BLLJBX` (gappd) |
| Client ID | `12043394698405.12046083998246` (public; app-owned default in `service-config.ts`, overridable with `GAPPD_SLACK_OAUTH_CLIENT_ID`) |
| Redirect URL | `http://localhost:45874/slack/oauth/callback` (exact match) |
| User scopes | `chat:write` only |
| Bot scopes | none; Slack rejects bot scopes for desktop redirects |
| PKCE | enabled |
| Token rotation | enabled; required for refresh tokens with a localhost redirect |
| Client secret | none; Gappd is a public client and never stores one |
| Socket mode / interactivity | disabled; unused, no event subscriptions |

The client ID is public. It is baked into the app as a default in `desktop/src/main/service-config.ts`; `GAPPD_SLACK_OAUTH_CLIENT_ID` at build time (tsup define) or runtime still overrides it. No client secret is needed, read, or stored.

Install the app by connecting from Gappd Settings. Do not use the Slack portal "Install App" button: it starts a server-style flow, while Gappd installs on first authorization of the desktop PKCE flow.

## Architecture

```text
renderer (Settings)                       main process                                slack.com
  │ slack:connect (IPC)   ───────────▶  PKCE S256 + state
  │                                      loopback http://localhost:45874
  │                                      opens the system browser ─────────────▶ user approves
  │                                                                              redirect with code + state
  │                                      validates state, exchanges code  ─────▶ oauth.v2.access
  │                                      (code_verifier, no client_secret)        rotating user token
  │                                      writes encrypted store (atomic)
  │ slack:status (IPC)     ◀───────────  configured / connected / reconnect due
  │ slack:disconnect (IPC) ───────────▶  clears the encrypted store
```

Tokens never reach the renderer. The status payload contains only `configured`, `connected`, `teamId`, `userId`, and `refreshExpiresAt`.

## OAuth flow

1. Settings calls `slack:connect`. The main process creates a 32-byte `code_verifier`, its SHA-256 `code_challenge`, and a random `state`.
2. `startLoopback` (in `desktop/src/main/oauth.ts`) binds `127.0.0.1:45874`, checks the `Host` header and path, and compares `state` with a timing-safe comparison.
3. The main process opens `https://slack.com/oauth/v2/authorize` with `client_id`, `user_scope=chat:write`, `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, and `state`.
4. The user approves. Slack redirects to the loopback callback with `code` and `state`.
5. The main process calls `https://slack.com/api/oauth.v2.access` with `grant_type=authorization_code`, `client_id`, `code`, `redirect_uri`, and `code_verifier`. No `client_secret`.
6. The rotating user token is read from `authed_user` (top-level as fallback), then written to `slack-connection.enc` in Electron `safeStorage` before it is used.

## Token lifecycle

- Access tokens expire after 12 hours (`expires_in` 43,200 s).
- Refresh tokens are single use and rotate on every refresh. Refreshes in `SlackConnection` are serialized through one in-flight promise so two callers cannot revoke each other.
- The new token set is written with the existing `SecureJsonStore` (temporary file, then rename) before the access token is returned. A refresh never leaves a half-written pair.
- PKCE refresh tokens expire after 30 days. `refreshExpiresAt` is stored locally (`now + 30 days` per rotation) and drives the "Reconnect needed" state.
- When Slack rejects a refresh (`invalid_refresh_token`, `token_expired`, `invalid_auth`, `account_inactive`), `SlackReconnectError` is thrown, the stored token set is cleared, and the user connects again.
- Disconnect clears the store. The old access token stops working when it expires; revoking in Slack also ends the connection.

## Security rules

- No client secret is used, stored, or shipped. Slack's PKCE public-client flow does not require one.
- Only user scopes are requested. Desktop redirects cannot request bot scopes.
- `code_challenge_method` is S256; `state` is validated once per callback.
- The loopback listener binds `127.0.0.1` and rejects mismatched Host headers and paths.
- Tokens are stored with Electron `safeStorage` encryption and never appear in URLs, logs, errors, or the renderer.
- No Slack API proxy exists. When sending ships, the main process calls Slack directly with the stored token.

## Scopes

- `chat:write` (user) is the only scope. It is the smallest scope that can post a confirmed message as the authorizing user.
- Destination listing (`channels:read`, `groups:read`, `im:read`, `mpim:read`) and `chat:write.public` are not requested because no feature uses them yet. Adding them requires the user to authorize again in Slack.
- `search.messages` with `search:read` is legacy. Gappd does not request it and does not promise search eligibility.

## Send-confirmation boundary

- No sending is implemented in this phase. The stored token is unused until the send feature ships.
- When sending ships, Gappd posts only after the user confirms a specific message and destination. No background, automatic, scheduled, or silent retry sends.
- Tests assert that failure paths return before any post exists; there is no `chat.postMessage` call in the codebase yet.

## Integration map

| Phase | Work | Files |
| --- | --- | --- |
| 1 (this change) | Manifest, PKCE sign-in, encrypted storage, refresh, Settings connect/reconnect/disconnect | listed under Components |
| 2 | Send confirmed meeting notes: destination picker, `chat.postMessage` after confirmation, errors and retry with a new confirmation | new main module plus `slack-service.ts`, IPC group, a panel action |
| 3 | Destination-scope additions (`channels:read`, `groups:read`, `im:read`, `mpim:read`) with re-authorization | manifest, `slack-oauth.ts` scopes, panel copy |
| 4 | Slack `auth.revoke` on disconnect and richer connection identity (workspace and user names) | `slack-service.ts`, manifest |
| 5 | Optional read features with explicit scopes; no search promises | separate design |

## Local testing strategy

- `npm --prefix desktop test` runs the main-process tests with injected fake Slack endpoints and an ephemeral loopback port. No network, no credentials, no live Slack needed.
- Focused: `node --experimental-strip-types --test desktop/src/main/slack-oauth.test.ts desktop/src/main/slack-connection.test.ts`.
- Checks: `npm --prefix desktop run typecheck`, `npm --prefix desktop run build:electron`, `npm --prefix desktop run build:renderer`.
- Live manual test: configure the app Redirect URL and scopes in the Slack portal. The client ID is already the app default; `GAPPD_SLACK_OAUTH_CLIENT_ID` only overrides it. Run the desktop app and use Settings → Slack → Connect.

## Open items

- The Slack portal must have the exact Redirect URL `http://localhost:45874/slack/oauth/callback`, user scope `chat:write`, PKCE enabled, and Token Rotation enabled.
- Confirm the Slack app ID in the manifest after the portal matches; the ID is not used at runtime.
- Port 45874 could be occupied by another process; the flow reports "local port 45874 is in use" and can be retried.
- Token rotation and PKCE cannot be turned off for this app once enabled.
