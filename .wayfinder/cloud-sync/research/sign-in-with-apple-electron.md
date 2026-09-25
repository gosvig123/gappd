# Research: Sign in with Apple from Electron on macOS

## Summary

The strongest candidate to prototype for Gappd is **native Sign in with Apple through a small Swift `AuthenticationServices` helper**, launched and consumed by Electron's main process. Apple supports `ASAuthorizationAppleIDProvider` on macOS 10.15+, and Supabase recommends native Sign in with Apple on Apple platforms. This avoids embedding Apple web UI and, for a native-only provider flow, avoids the web OAuth Services ID callback and its six-month client-secret rotation obligation. It does not eliminate server-side session handling or provider revocation duties.

Local-only Gappd would remain account-free. Enabling cloud sync would authenticate each Mac separately; the server would validate Apple proof (or delegate that validation to the chosen auth provider) and issue its own short-lived access token plus rotating refresh token. Electron main—not the renderer—should own the session. Persist the refresh token as an Electron `safeStorage` encrypted blob; on macOS its encryption key is held in Keychain. Keep access tokens in memory.

Gappd is not ready for this flow today: `dev.gappd.desktop` has no Sign in with Apple entitlement, no auth helper, no cloud-auth IPC, no callback protocol, and no `safeStorage` session store. The signed native path must be proven in a packaged build before architecture is locked.

## Findings

### 1. Native AuthenticationServices is the best first prototype

- Apple's native provider is available on macOS 10.15+ and returns an `ASAuthorizationAppleIDCredential` containing an opaque user identifier, identity token, authorization code, state, and authorized contact data. The identity token is a JSON Web Token; the authorization code is short-lived proof for server interaction ([Apple credential](https://developer.apple.com/documentation/authenticationservices/asauthorizationappleidcredential), [provider](https://developer.apple.com/documentation/authenticationservices/asauthorizationappleidprovider)).
- The native request supports `state` and `nonce`. The returned state must match the request; the nonce must be verified against the identity token to prevent request substitution and replay ([Apple state](https://developer.apple.com/documentation/authenticationservices/asauthorizationopenidrequest/state), [nonce](https://developer.apple.com/documentation/authenticationservices/asauthorizationopenidrequest/nonce)).
- Supabase explicitly supports native macOS Sign in with Apple and says native capabilities are best practice on Apple platforms. Its documentation says the six-month `.p8`-derived secret rotation applies to web OAuth, not native-only implementations ([Supabase Apple login](https://supabase.com/docs/guides/auth/social-login/auth-apple)).
- Electron has no documented `AuthenticationServices` API. Gappd therefore needs a native bridge. A small Swift helper fits the repository's existing helper-process pattern, but presenting the authorization sheet and securely returning the result still needs a prototype.
- Native Sign in with Apple requires the `com.apple.developer.applesignin` entitlement and Apple capability configuration ([Apple entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.applesignin)). Gappd's current `desktop/build/entitlements.mac.plist` lacks it; current release packaging uses bundle ID `dev.gappd.desktop`, hardened runtime, and Developer ID signing.

### 2. Server validation and application sessions are separate concerns

A supported native interaction is:

```text
Renderer            Electron main        Swift helper        Auth server/provider
   │ enable cloud         │                    │                       │
   ├─────────────────────▶│ launch             │                       │
   │                      ├───────────────────▶│ native Apple sheet    │
   │                      │◀───────────────────┤ ID token + code        │
   │                      ├───────────────────────────────────────────▶│ validate/exchange
   │                      │◀───────────────────────────────────────────┤ app access + refresh
   │ status only ◀────────┤ encrypt refresh token; keep access in RAM  │
```

- Apple directs the app to transmit the identity token and authorization code securely to its server. The server verifies the token signature, nonce, issuer (`https://appleid.apple.com`), audience/client ID, and expiry. Apple publishes rotating public keys selected by JWT `kid` ([Apple verification](https://developer.apple.com/documentation/signinwithapple/verifying-a-user), [public keys](https://developer.apple.com/documentation/signinwithapplerestapi/fetch-apple's-public-key-for-verifying-token-signature)).
- If Gappd directly exchanges Apple's authorization code, Apple's token endpoint requires a server-side client ID and client secret and returns Apple access, identity, and refresh tokens. Apple refresh-token validation can check standing and obtain new access tokens ([Apple token validation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens)). Never ship the Apple signing key/client secret in the desktop app.
- If a managed provider such as Supabase validates the native Apple ID token, it issues the application session. Supabase sessions use short-lived JWT access tokens and one-time rotating refresh tokens; refresh writes must be serialized and the newest token persisted atomically to avoid reuse detection terminating the session ([Supabase sessions](https://supabase.com/docs/guides/auth/sessions)).
- The sync server should authorize using the application session, not accept the native Apple user identifier or email as a bearer credential.

### 3. Identity and device lifecycle constraints

- Use Apple's opaque `user`/identity-token subject as the external identity key. Do not key accounts by email: users may choose Hide My Email, and email/name are presentation data ([Apple credential](https://developer.apple.com/documentation/authenticationservices/asauthorizationappleidcredential)).
- Capture name/email on the first successful authorization if the product needs them. Supabase notes that full name is not in the identity token and is only returned by Apple's native response on the first authorization ([Supabase Apple login](https://supabase.com/docs/guides/auth/social-login/auth-apple)).
- Each Mac should create its own app session. Keychain protects a local secret; it is not the cloud account and should not be used to copy sessions between machines.
- At launch/resume, a native helper can call `getCredentialState`. Apple's states include `authorized`, `revoked`, `notFound`, and `transferred`; revoked credentials should sign the app out, while transferred identities require migration handling ([Apple credential states](https://developer.apple.com/documentation/authenticationservices/asauthorizationappleidprovider/credentialstate)). Apple says this local check is inexpensive and should inform session lifetime; repeatedly requesting a new identity token requires interaction and can be throttled ([Apple verification](https://developer.apple.com/documentation/signinwithapple/verifying-a-user)).
- Sign-out must terminate the application/provider session and delete local encrypted session material. Account disconnection/deletion also needs provider authorization revocation. Apple's revocation endpoint requires a valid access or refresh token and is idempotent for an already-invalidated token ([Apple revocation](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens)).

### 4. Keychain behavior in Electron

- `safeStorage` runs in Electron's main process. On macOS, its encryption keys are stored and retrieved from Keychain, protecting ciphertext from other users and apps without override. Electron recommends its asynchronous APIs because they are nonblocking, handle temporary unavailability, and support key rotation ([Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)).
- `safeStorage` encrypts strings; Gappd must still persist the resulting encrypted bytes, preferably under Electron `userData`. It is not an account database or an iCloud synchronization mechanism.
- Store only the current refresh/session secret persistently. Keep access tokens in main-process memory; expose account status and deliberate account operations through typed preload IPC. Do not put tokens in the renderer, SQLite meeting rows, `config.toml`, process arguments, environment variables, URLs, or logs.
- On decrypt, honor `shouldReEncrypt`; on temporary Keychain unavailability, pause cloud sync without breaking local-only recording.

### 5. Browser OAuth remains a fallback, not the first native prototype

- A web OAuth flow needs an Apple Services ID associated with a Sign in with Apple-enabled App ID and registered website domains/return URLs ([Apple web configuration](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/)). Supabase additionally requires Apple OAuth secret rotation every six months ([Supabase Apple login](https://supabase.com/docs/guides/auth/social-login/auth-apple)).
- Electron can open the system browser and handle a packaged-app deep link through `app.setAsDefaultProtocolClient` and the early macOS `open-url` event. Electron warns that macOS deep-link handling works only for packaged apps and that `open-url` must be registered before `ready` ([Electron deep links](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app), [app lifecycle](https://www.electronjs.org/docs/latest/api/app#event-open-url-macos)).
- Supabase supports redirect allowlists and documents custom-scheme deep links for native/mobile clients, but its cited page does not explicitly validate an Electron macOS Apple OAuth callback. A browser fallback therefore requires a packaged proof covering cold start, existing instance, state/PKCE validation, cancellation, and callback replay ([Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)).

## Sources

- [Apple AuthenticationServices provider](https://developer.apple.com/documentation/authenticationservices/asauthorizationappleidprovider)
- [Apple credential and token verification](https://developer.apple.com/documentation/authenticationservices/asauthorizationappleidcredential), [Verifying a user](https://developer.apple.com/documentation/signinwithapple/verifying-a-user)
- [Apple REST token validation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens), [revocation](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens)
- [Apple Sign in with Apple entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.applesignin)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [deep links](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app)
- [Supabase Login with Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple), [sessions](https://supabase.com/docs/guides/auth/sessions), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)

## Gaps

- Apple Developer portal access is required to confirm that `dev.gappd.desktop` is registered with the Sign in with Apple capability and to produce the provisioning/signing assets needed by the Developer ID release pipeline.
- A packaged spike must prove that a Swift helper can present the native authorization UI correctly, bind it to an appropriate presentation anchor, preserve nonce/state, and return credentials to Electron without exposing them to the renderer or logs.
- The chosen authentication provider must document and test native ID-token exchange, provider revocation on account deletion, Apple key/client-secret rotation ownership, and handling of transferred/revoked Apple identities.
- Electron's current documentation describes asynchronous `safeStorage`; confirm those methods against the exact pinned Electron 43.2.0 type/runtime before implementation.
- Provider docs do not fully settle whether Gappd needs an Apple refresh token in addition to its application refresh token. That depends on who owns Apple authorization revocation and ongoing account-state checks.

