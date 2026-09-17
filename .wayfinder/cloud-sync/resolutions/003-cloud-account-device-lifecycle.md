# Resolution: Define the cloud account and device lifecycle

## Decision

Cloud sync is optional. Gappd remains fully usable through a local-only profile without authentication. Enabling cloud sync uses native Sign in with Apple and creates or opens an isolated cloud profile.

## Profile model

- A profile owns one SQLite database, one audio-session directory, synchronization metadata, and at most one cloud-account binding.
- Existing installations migrate to an unbound `local` profile.
- First enablement binds that current profile in place and creates a new empty account-free Local profile.
- Other Apple identities create or open different isolated profiles under `~/.gappd/profiles/<profile-id>/`.
- Non-sensitive application settings and the selected profile remain global.
- Session tokens never appear in profile metadata, SQLite, TOML, renderer state, process arguments, URLs, or logs.
- Meetings are never silently reassigned between accounts, and one profile cannot bind to multiple accounts.

## Profile switching

Version one switches profiles through a controlled relaunch:

1. Refuse switching while recording.
2. Stop processing drains and child processes.
3. Persist the selected profile identifier.
4. Relaunch Gappd.
5. Open only the selected profile root.

Removing a cloud profile revokes its device session, then asks whether to keep the profile offline or erase its local database and audio.

## Account and device model

- The server keys account ownership by Apple's immutable subject, never email.
- Each profile installation generates a random device identifier and editable device name.
- Reinstalling or clearing app data creates a new device.
- One cloud account supports at most ten active devices in version one.
- There is no staff-assisted account transfer or recovery code. Losing the Apple identity loses cloud access; offline profiles remain usable.

## Session policy

- Access tokens last approximately 15 minutes.
- Refresh sessions expire after 30 days of inactivity.
- Refresh tokens rotate on every use.
- Refresh-token reuse revokes that device's token family.
- The server stores refresh-token hashes only.
- Electron main keeps access tokens in memory.
- Electron main persists refresh-token ciphertext with Keychain-backed `safeStorage`, keyed by profile.
- The renderer sees account and synchronization status, never bearer tokens.

## Authentication boundary

The stable desktop/server contract is:

```text
POST /v1/auth/challenge
  -> challenge ID, nonce, expiry

Swift AuthenticationServices helper
  -> Apple identity token, authorization code

POST /v1/auth/apple
  <- challenge ID, Apple proof, device ID, device name
  -> application access token, refresh token, account, device

POST /v1/auth/refresh
  <- rotating refresh token
  -> replacement access token, refresh token
```

The synchronization server may validate Apple directly or delegate validation to the chosen authentication platform. That provider choice must not change the desktop contract.

## Lifecycle behavior

### Enable cloud sync

1. Cloud Sync settings places a concise upload/privacy notice and policy link beside the standard Apple login button.
2. Native Apple authentication creates a provisional device session and records notice acceptance.
3. Gappd fetches cloud inventory and asks once to upload all eligible existing meetings.
4. Cancelling revokes the provisional session and leaves the profile unbound.
5. Confirming binds the current profile in place, activates token storage, seeds history outbox entries, and creates a new empty Local profile.
6. Gappd pulls remote state before uploading local history in resumable batches.

### Invalid or revoked session

- Pause synchronization and preserve pending outbox entries.
- Keep recording, processing, search, and reading available locally.
- Show `Reconnect` and require the same Apple subject to reconnect that profile.
- A different Apple subject opens another profile.

### Disconnect Cloud Sync

- Show pending-operation count, then revoke this device session immediately.
- Delete local session ciphertext while preserving the cloud account and server data.
- Keep the profile, meetings, audio, versions, markers, and outbox offline.
- Reconnecting the same account reuses the profile/device identity, pulls first, then resumes the outbox automatically.

### Remote device revocation

- Revoke the selected device's refresh-token family.
- An offline device continues local work.
- Its next server request enters `REAUTH_REQUIRED` while preserving pending changes.

### Delete cloud account

1. Require fresh Apple authentication.
2. Mark the account `deletion_scheduled` for seven days.
3. Revoke all application sessions immediately.
4. Reject synchronization and hide active cloud data.
5. Permit explicit restoration by the same Apple identity during the seven-day window.
6. After seven days, permanently purge active data and revoke provider authorization.
7. Backup expiry and disclosure remain for **Set the cloud privacy and retention promise**.

## Required account endpoints

```text
POST   /v1/auth/challenge
POST   /v1/auth/apple
POST   /v1/auth/refresh
POST   /v1/auth/logout
GET    /v1/devices
PATCH  /v1/devices/:id
DELETE /v1/devices/:id
GET    /v1/account/status
POST   /v1/account/deletion
POST   /v1/account/deletion/cancel
```

Meeting payloads, conflict handling, privacy periods, and the concrete server framework remain separate decisions.
