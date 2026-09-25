---
title: Optional cloud sync across Macs
type: map
status: open
label: wayfinder:map
---

## Destination

Reach a build-ready specification and thin working prototype for optional account-scoped cloud sync, showing the complete Electron → Go → sync server → PostgreSQL interaction while preserving Gappd's account-free local mode.

## Notes

- Planning is the default; prototype code is allowed only to resolve interaction and feasibility decisions.
- Consult the `grilling`, `domain-modeling`, `research`, and `prototype` skills as each ticket requires.
- Current direction: Sign in with Apple is required only when cloud sync is enabled.
- Version one synchronizes completed meeting text and metadata, not raw audio.
- Version one uses Transport Layer Security, application-envelope encryption backed by a managed European Union key service, account authorization, and server-readable transcripts rather than end-to-end encryption.
- SQLite remains the operational database on every Mac; the cloud is an optional synchronization service.

## Decisions so far

- [Research Sign in with Apple from Electron on macOS](001-research-sign-in-with-apple-electron.md): Native `AuthenticationServices` through a Swift helper is the strongest prototype path; Electron main owns a separate per-device application session protected with Keychain-backed `safeStorage`.
- [Research backend platform fit for explicit meeting sync](002-research-backend-platform-fit.md): Every candidate requires a deliberate cloud projection and sync protocol; Supabase bundles the most version-one infrastructure, a Go service offers the most control, and CloudKit creates the strongest Apple coupling.
- [Define the cloud account and device lifecycle](003-define-cloud-account-device-lifecycle.md): Cloud sync binds the current profile to one account, maintains isolated profiles, uses native Apple authentication and per-device sessions, relaunches on profile switch, and gives account deletion a seven-day undo window.
- [Define the cloud meeting projection](004-define-cloud-meeting-projection.md): Synchronize an atomic encrypted meeting aggregate with section revisions, origin-owned generated output, cross-device metadata edits, portable diagnostics, and explicit local queue exclusion for downloaded replicas.
- [Set the cloud privacy and retention promise](005-set-cloud-privacy-retention-promise.md): Cloud data is application-encrypted in the European Union, accessible to humans only through audited single-owner break-glass, expires one year after its latest update, and leaves active storage within 24 hours plus 30-day backup rotation.
- [Define existing-history and sign-out behavior](006-define-history-sign-out-behavior.md): First enablement binds the current profile, uploads all eligible history after one confirmation, merges by ID/digest, and uses a single disconnect action that preserves the offline profile and outbox.

## Not yet specified

- Exact desktop synchronization cadence, status indicators, and recovery controls depend on the account lifecycle and working protocol prototype.
- Migration, rollback, and two-device acceptance scenarios depend on the proven synchronization behavior.

## Out of scope

- Production implementation, deployment, and rollout beyond the thin decision-making prototype.
- Raw audio synchronization or cloud audio processing.
- Remote transcription, diarization, or inference.
- End-to-end encrypted transcript storage in version one.
- Authentication methods other than Sign in with Apple in version one.
