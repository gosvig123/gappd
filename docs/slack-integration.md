# Slack integration

Status: direct desktop sign-in with confirmed message sending. Gappd uses Slack's PKCE public-client flow from the Electron main process with a registered macOS `gappd://` callback. There is no server, no client secret, and no proxy. The user can send one plain-text message at a time to a validated destination after reviewing it and confirming it in a local scrolling confirmation window. A live Slack send has not been run yet (see Open items).

## Components

- `slack-app/manifest.json`: the Gappd-owned Slack app definition (no secrets).
- `desktop/src/main/slack-oauth.ts`: PKCE authorization, code exchange, token refresh, token parsing.
- `desktop/src/main/slack-connection.ts`: serialized refresh, atomic token persistence, reviewed-account binding.
- `desktop/src/main/slack-destination.ts`: validation of channel IDs and Slack channel or thread links.
- `desktop/src/main/slack-message.ts`: message length validation, control-syntax escaping, `chat.postMessage` payload.
- `desktop/src/main/slack-send.ts`: reviewed message store, confirmation boundary, fixed Slack request, error mapping.
- `desktop/src/main/slack-service.ts`: Electron composition (secure store, shell, client ID, local scrolling confirmation window).
- Settings panel: `desktop/src/renderer/components/slack-panel.tsx` with `use-slack-connection.ts`, and `slack-composer.tsx` with `use-slack-send.ts`; IPC group `slack` in `desktop/src/shared/ipc-contract.ts`.

## Slack app

| Item | Value |
| --- | --- |
| App | `A0C1C2FVC78` in workspace `T0C19BLLJBX` (gappd) |
| Client ID | `12043394698405.12046083998246` (public; app-owned default in `service-config.ts`, overridable with `GAPPD_SLACK_OAUTH_CLIENT_ID`) |
| Redirect URL | `gappd://slack/oauth/callback` (exact match; registered in the macOS app bundle) |
| User scopes | `chat:write` only |
| Bot scopes | none; Slack rejects bot scopes for desktop redirects |
| PKCE | enabled |
| Token rotation | enabled; custom desktop redirects always receive rotating tokens |
| Client secret | none; Gappd is a public client and never stores one |
| Socket mode / interactivity | disabled; unused, no event subscriptions |

The client ID is public. It is baked into the app as a default in `desktop/src/main/service-config.ts`; `GAPPD_SLACK_OAUTH_CLIENT_ID` at build time (tsup define) or runtime still overrides it. No client secret is needed, read, or stored.

Install the app by connecting from Gappd Settings. Do not use the Slack portal "Install App" button: it starts a server-style flow, while Gappd installs on first authorization of the desktop PKCE flow.

## Architecture

```text
renderer (Settings)                       main process                                slack.com
  │ slack:connect (IPC)   ───────────▶  PKCE S256 + state
  │                                      waits for gappd://slack/oauth/callback
  │                                      opens the system browser ─────────────▶ user approves
  │                                                                              redirect with code + state
  │                                      validates state, exchanges code  ─────▶ oauth.v2.access
  │                                      (code_verifier, no client_secret)        rotating user token
  │                                      writes encrypted store (atomic)
  │ slack:status (IPC)     ◀───────────  configured / connected / reconnect due
  │ slack:disconnect (IPC) ───────────▶  clears the encrypted store
```

```text
renderer (Settings)                       main process                                slack.com
  │ slack:review (IPC)     ───────────▶  validates destination, text, and account
  │                                      holds the reviewed message under one id
  │ slack:review (IPC)     ◀───────────  review id, destination, account, exact text
  │ slack:send (IPC)       ───────────▶  re-checks the reviewed account
  │                                      local scrolling confirmation window
  │                                      fetches or rotates the stored token
  │                                      fixed POST chat.postMessage  ─────────▶ posted as the user
  │ slack:send (IPC)       ◀───────────  sent / cancelled / failed (not-sent or unknown)
```

Tokens never reach the renderer. The status payload contains only `configured`, `connected`, `teamId`, `teamName`, `userId`, and `refreshExpiresAt`. Settings displays the workspace name, falling back to its ID for older stored connections.

## OAuth flow

1. Settings calls `slack:connect`. The main process creates a 32-byte `code_verifier`, its SHA-256 `code_challenge`, and a random `state`.
2. The main process starts a five-minute callback wait. The packaged app registers the `gappd` URL scheme. Electron's `open-url` handler accepts only the exact Slack callback target and compares `state` with a timing-safe comparison. Wrong-target, unsolicited, wrong-state, and replayed links are ignored.
3. The main process opens `https://slack.com/oauth/v2/authorize` with `client_id`, `user_scope=chat:write`, `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, and `state`.
4. The user chooses a workspace and approves. Slack opens the desktop callback with `code` and `state`; Gappd returns its window to the foreground. The callback is consumed once. Duplicate parameters, denied consent, and invalid codes fail before token exchange.
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
- The desktop callback requires an active authorization attempt, the exact scheme/host/path, and matching state. No callback codes or tokens are logged. PKCE protects the code exchange if another application intercepts a custom-scheme link.
- Tokens are stored with Electron `safeStorage` encryption and never appear in URLs, logs, errors, or the renderer.
- No Slack API proxy exists. The main process calls Slack directly with the stored token.
- Sending uses the fixed endpoint `https://slack.com/api/chat.postMessage`. Gappd never fetches a user-supplied URL.

## Sending a message

1. The composer takes a destination and message. `slack:review` validates both in the main process and stores one pending message with the connected `teamId` and `userId`.
2. Accepted destinations: a channel ID (`C…`, `G…`, or `D…`), `https://<workspace>.slack.com/archives/<channel>[/p<timestamp>]`, or `https://app.slack.com/client/<teamId>/<channel>[/thread/<channel>-<timestamp>]`. Query strings are limited to `thread_ts` and `cid`.
3. `slack:send` accepts only the review id. The main process re-checks the account, shows a local scrolling confirmation window, then retrieves or rotates the token and posts.
4. The payload is plain text: `mrkdwn`, `unfurl_links`, and `unfurl_media` are false, and `&`, `<`, `>` are escaped so text cannot activate mentions, channel alerts, or links.
5. A link to a reply keeps its `thread_ts` parent and sets `reply_broadcast` to false. A bare message link (`/p<timestamp>`) becomes a thread reply. A channel-only link posts a new message.

## Send limits

- One pending review per connection. Editing the destination or text, disconnecting, reconnecting, or changing accounts invalidates it; a second send is rejected while one is in flight.
- The message is at most 4000 characters, before and after escaping. Slack shows the text literally.
- No channel names, no directory listing, no bot impersonation, and no search. The user supplies a channel ID or a link copied from Slack.
- Gappd never retries automatically. HTTP 200 with `ok: false` is not-sent; network, timeout, 5xx, unreadable responses, and Slack `fatal_error` or `internal_error` are delivery-unknown, so the user checks Slack before sending again.
- HTTP 429 returns guidance from `Retry-After`; the user decides when to review and send again.
- Success requires `ok: true` plus a valid `channel` and `ts`. The result carries a best-effort `https://slack.com/app_redirect` link; opening it may pick another signed-in workspace.

## Scopes

- `chat:write` (user) is the only scope. It is the smallest scope that can post a confirmed message as the authorizing user.
- Destination listing (`channels:read`, `groups:read`, `im:read`, `mpim:read`) and `chat:write.public` are not requested because no feature uses them yet. Adding them requires the user to authorize again in Slack.
- `search.messages` with `search:read` is legacy. Gappd does not request it and does not promise search eligibility.

## Send-confirmation boundary

- Gappd posts only after the user reviews a specific message and destination and then confirms the local scrolling confirmation window. No background, automatic, scheduled, or silent retry sends.
- The main process holds the reviewed message, so only the review id crosses IPC for a send. The renderer cannot alter the message, destination, account, or thread after the review.
- The reviewed account is bound with the connection lifecycle generation, `teamId`, and `userId`. A disconnect, reconnect, or account change between review, confirmation, token retrieval, and the request fails before Slack is contacted.
- Tests assert that cancellation, validation failures, and account changes return before any post exists.

## Integration map

| Phase | Work | Files |
| --- | --- | --- |
| 1 | Manifest, PKCE sign-in, encrypted storage, refresh, Settings connect/reconnect/disconnect | listed under Components |
| 2 (this change) | Send one reviewed, confirmed plain-text message: destination validation, reviewed-account binding, `chat.postMessage`, local scrolling confirmation, friendly errors | `slack-destination.ts`, `slack-message.ts`, `slack-send.ts`, `slack-connection.ts`, `slack-service.ts`, IPC group, panel composer |
| 3 | Destination-scope additions (`channels:read`, `groups:read`, `im:read`, `mpim:read`) with re-authorization | manifest, `slack-oauth.ts` scopes, panel copy |
| 4 | Slack `auth.revoke` on disconnect and user display names (workspace names already shown) | `slack-service.ts`, manifest |
| 5 | Optional read features with explicit scopes; no search promises | separate design |

## Local testing strategy

- `npm --prefix desktop test` runs the main-process tests with injected fake Slack endpoints and in-process desktop callback delivery. No Slack network calls, credentials, or occupied callback port are needed.
- Focused: `node --experimental-strip-types --test desktop/src/main/slack-oauth.test.ts desktop/src/main/slack-connection.test.ts desktop/src/main/slack-destination.test.ts desktop/src/main/slack-send.test.ts desktop/src/main/slack-send-post.test.ts`.
- The send tests cover destination validation, no-token and cancellation paths, one post per confirmation, concurrent sends, account change or reconnect during review and confirmation, token rotation, plain-text payload controls, thread handling, Slack error mapping, 429 `Retry-After`, delivery-unknown outcomes, and that failures never expose tokens or message text.
- Checks: `npm --prefix desktop run typecheck`, `npm --prefix desktop run build:electron`, `npm --prefix desktop run build:renderer`.
- Live manual test: configure the app Redirect URL and scopes in the Slack portal. The client ID is already the app default; `GAPPD_SLACK_OAUTH_CLIENT_ID` only overrides it. Run the desktop app and use Settings → Slack → Connect. Sending needs a separate live test with an approved workspace and destination; none has been run yet.

## Open items

- The Slack portal must have the exact Redirect URL `gappd://slack/oauth/callback`, user scope `chat:write`, PKCE enabled, and Token Rotation enabled. Public Distribution must be enabled to connect workspaces other than the app's development workspace.
- Slack's distribution checklist rejects HTTP redirects, including localhost. Remove the old HTTP redirect only after the desktop-callback build is available. Old builds that still use localhost will then need an update.
- Confirm the Slack app ID in the manifest after the portal matches; the ID is not used at runtime.
- Test desktop URL routing with an installed, packaged macOS app. An unpackaged Electron development process does not own the `gappd` URL scheme.
- Token rotation and PKCE cannot be turned off for this app once enabled.
- Remaining live test: send one confirmed message to a test channel in the connected workspace, then check plain-text rendering, thread reply behavior, and the `app_redirect` link. This needs explicit user authorization; no live send was run for this change.
- DM, private-channel, and member-only destinations work only when the user's account can post there; Slack errors map to guidance, not to a destination directory.
