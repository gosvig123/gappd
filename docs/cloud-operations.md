# Synthetic cloud operations

The selected-local-fixture document transport is implemented for development only and
OFF by default; see [isolated setup, consent and migration 003](cloud-selected-fixture.md).
It reads only the explicitly bootstrapped synthetic SQLite Meeting. The original
empty-body demo and its permanent deletion markers are unchanged. No real uploads
or live deployment of this new slice are approved. Historical status below describes
the original demo unless stated otherwise.

## Verified on 2026-09-13

This is the development-only synthetic service. Real Meeting uploads remain disabled.
The existing API and local MCP are unchanged by this operations setup.

### Hourly expiry cleanup

The cleanup service sweeps two slices in one run, because real copies need the same 30-day
retention. It handles the synthetic slice with `SYNTHETIC_CLEANUP_DATABASE_URL` and real copies with
`MEETING_CLEANUP_DATABASE_URL`, each under its own restricted non-owner role (`gappd_demo_cleanup`
and `gappd_meeting_cleanup`). A missing variable simply skips that slice.

- Railway service: `gappd-cloud-cleanup`, ID `0d10a939-a74c-463f-b1cf-211e15bc230c`.
- Project: `b73b1b1e-810b-4c3d-af03-6136244852c0`.
- Environment: `7b4a6831-62f8-4dda-a2e1-773542c266fb` (development despite its production label).
- Region: `europe-west4-drams3a`; no public domain or attached volume.
- Source: `gosvig123/gappd`, beta, root `/cloud`, watch `/cloud/**`.
- Explicit Dockerfile builder; start command `/cleanup` overrides the image entrypoint.
- Schedule: `0 * * * *` (UTC). Restart policy: NEVER. No HTTP healthcheck.
- Sole database setting: `SYNTHETIC_CLEANUP_DATABASE_URL`, private-network connection
  for `gappd_demo_cleanup`. No admin, reader or demo-writer credentials in this service.
- Provisioned the restricted role privately with password statement logging/tracking suppressed.
  Temporary local password material was removed after the service setting was verified.

Deployment `0c0f3571-dc28-4a37-a0e6-c4d65f5c9eaa` built commit `33c99e9`.
The first scheduled run logged `expired synthetic copies removed: 0` at 17:01:18 UTC,
then exited. Railway showed zero running/crashed replicas and one exited replica.
This proves scheduled execution, authentication and clean exit, not deletion under live load.
Local PostgreSQL tests already cover expiry removal and the 100-copy batch boundary.

Each run handles at most 100 expired deterministic demo copies and retains deletion markers.
The real-copy sweep is bounded the same way and keeps its own markers.
At hourly frequency, nominal capacity is 2,400 copies per day without failures; this is not
an SLA. Railway can delay ticks and skips a tick while its prior execution is still active.
Before real data, configure failure/missed-run alerts, backlog-age monitoring and enough
capacity, then exercise the <=24-hour physical cleanup deadline. These alerts are not set up.
The seeded fixture remains an explicit synthetic exception, not general retention coverage.

### Deployment path

A push to `beta` does NOT deploy. Commit `dfda434` reached `beta` and the service kept
serving `ca64391`; the handover's "automatic push deployment is not yet proved" is now
settled as disabled for `gappd-cloud-api`. Check the source/auto-deploy setting in the
dashboard before relying on a push.

`railway redeploy --service 7407bf7c-600e-4a4c-928d-bf4c02747463 --environment 7b4a6831-62f8-4dda-a2e1-773542c266fb`
rebuilds the SAME commit and cannot ship a newer one. The working path is an upload from the
repository root, because the service sets `rootDirectory=/cloud` with
`dockerfilePath=Dockerfile`, so the Dockerfile only resolves when the upload root is the
repository root:

```sh
railway up --service 7407bf7c-600e-4a4c-928d-bf4c02747463 \
  --environment 7b4a6831-62f8-4dda-a2e1-773542c266fb \
  --project b73b1b1e-810b-4c3d-af03-6136244852c0 --detach --yes
```

Confirm the new deployment reports `SUCCESS`, then check `/health`, `/ready` and the MCP
tool list. An upload deploys the working tree, not a commit, so keep the tree clean.
`railway up` from `/cloud` does not resolve the configured Dockerfile path.

### Daily volume backups

- PostgreSQL volume: `09e2971f-5fba-4cc9-8d60-729a27812e94`.
- Volume instance: `190d6f11-ec72-4a03-a36d-55774b567e7e`.
- Schedule: DAILY only, ID `45cb81af-0160-4847-a7eb-2948aea475c2`.
- Provider-selected UTC schedule: `16 16 * * *`.
- API-verified retention: 518,400 seconds (6 days), below the approved 7-day maximum.
- Weekly and monthly schedules are absent. No existing backups were deleted.

The schedule was enabled after that day's scheduled time. The backup list was still empty
at verification. First backup success, actual expiry/removal and isolated restore remain
unverified. Do not create indefinite manual backups as a substitute for this schedule.
Do not restore over the live volume. A restore must remain offline until current deletion
control records and expiry rules are applied; a snapshot alone cannot supply later deletions.
Provider snapshot scheduling is not proof of application-consistent PostgreSQL recovery.

### Operational scripts

Two scripts cover the verification and monitoring the runbook needed by hand.

**`npm run cloud:proof`** proves the whole upload path against the deployed service. It signs in
with the Desktop public client, registers a device, adds one recorded turn to an isolated fixture,
exports the document with the real exporter, signs the upload and sends it. It imports the app's
own device module, so the signing format is not reimplemented.

`--dry-run` stops before any network call, which is the check to run when only the exporter is in
question. `--revision=N` raises the revision: a changed document needs a higher revision, because
one revision means one document, and the identity is deterministic, so re-running at the same
revision with the same bytes is a harmless retry.

The sign-in is the one step no script can do alone: the browser it opens must already hold a Clerk
session. Verified on 2026-09-14 with a revision-2 update, the returned transcript intact
(`[0:00] You: ...`) and the fixed expiry unchanged between revisions.

**`npm run cloud:status`** reads `GET /status` and fails when `cleanup.behind` is true, with a
macOS notification when it can. `cloud:status:install` writes a LaunchAgent that runs it hourly and
logs to `~/Library/Logs/gappd-cloud-status-watch.log`; `cloud:status:uninstall` removes it. A breach
is an exit code and a notification, so any scheduler treats it as a failure.

### Backup restore drill (2026-09-14) — PASSED, in an isolated target

The drill ran under explicit owner approval, and it did **not** touch the live volume.

Method. A manual backup was taken, a sentinel row was written to the live database *after* the
backup, and the backup was then restored. The dashboard stages the restore: it creates the restored
volume **unmounted** and shows three changes (unmount the old volume, mount the new, redeploy), with
`Discard` and `Deploy`. Instead of deploying onto live, the restored volume was attached to a
throwaway Postgres service in the same project and environment, and the staged change on live was
discarded. The live service kept running on its own volume throughout.

Evidence. The restored cluster reported migrations `1 2 3 4 5 6 7 8 9 10`, one cloud copy, two
deletion markers, and **zero sentinel rows** — the row written after the backup was gone, so the
restore really rolled the cluster back rather than being a no-op. It also carried all five `gappd%`
roles, so a restored database is immediately usable. The live database still held its sentinel while
this was true, which is what proves live was never rolled back. The restored cluster rejected the
service's own generated password and accepted the live cluster's credentials, which is further
evidence that the restore is a faithful cluster copy.

Two operational facts worth keeping. A restore creates and stages a volume; the current volume is
preserved and nothing happens until `Deploy`, so a staged restore is discardable. And a manual backup
has no expiry (`expiresAt: null`), so it falls outside the 6-day policy and must be deleted by hand —
the drill backup and every throwaway volume were deleted, and Railway completes volume deletion
within 48 hours.

### Point-in-time recovery enabled and proven (2026-09-14)

PITR was off. It is now on: `WAL_ARCHIVE_*` variables point at a new `Postgres-PITR` archive bucket,
and the service redeployed once.

Enabling is staged like a restore, so it is reviewable before it applies. The drill then restored a
known point: a sentinel row was written at 13:37:25 and the restore target was 13:35, chosen from
the window. The recovered service `Postgres-restored-20260914-1135` reported migrations
`1 2 3 4 5 6 7 8 9 10`, one cloud copy, two deletion markers, all five `gappd%` roles, and **zero
sentinel rows** — genuine point-in-time recovery, not a snapshot.

Two properties worth knowing. A PITR restore **creates a new standalone Postgres service and leaves
the current one running**, so it is the isolated target this runbook wanted, and unlike a volume
restore it never swaps the live volume. And the restorable window starts when PITR is enabled, so
until archiving has run for a while the earliest target is the enablement moment.

The drill service and its volume were deleted, and the live service was verified healthy with its own
volume still mounted throughout.

### Log-retention blocker### Log-retention blocker

The workspace API reports plan **PRO**. Railway documents 30-day log retention for Pro, and the
documentation is now explicit that **there is no log drain setting and no per-service retention
control**: the plan fixes the window, and an upgrade "immediately restore[s] logs that were
previously outside of the retention period". So the 14-day cap cannot be enforced by configuration.
The only options are a third-party log forwarder with its own 14-day retention, or an owner-approved
exception. Either way the window holds content-free operational logs only: the service never logs
tokens, account ids or Meeting text.
Its documentation also says a plan upgrade can restore logs outside the previous retention
window, so a visibility window alone is not proof of physical deletion.

The 14-day limit is NOT enforced or verified. No plan change, log erasure or policy exception
was made. Before real data, obtain Railway confirmation of a hard deletion control, or get
explicit owner approval for a different policy/platform. A shorter downstream log-store
setting would not remove Railway's own captured logs.

## Next verification

1. Observe a completed daily backup and verify its expiry metadata.
2. Point an external monitor at `GET /status` and alert when `cleanup.behind` is true. The endpoint
   is public and content free; a missed run with nothing expired has no user impact, so the backlog
   is the signal. Done on the development Mac: `npm run cloud:status:install` writes a LaunchAgent
   that runs hourly and notifies on a breach. A second monitor on the deployed side is still
   outstanding.
3. Test restore in an isolated target with current deletion evidence; do not serve it publicly.
4. Verify aged backup removal and resolve the log-retention blocker before real uploads.

## Primary sources

- [Railway cron semantics](https://docs.railway.com/cron-jobs)
- [Docker entrypoint override](https://docs.railway.com/deployments/start-command)
- [Backup schedules and retention](https://docs.railway.com/volumes/backups)
- [Plan-based log retention](https://docs.railway.com/observability/logs#log-retention)
- [Approved lifecycle contract](cloud-data-lifecycle.md)


## Why a re-upload of a deleted Meeting fails with 503

Three deliberate rules meet here, and together they produce a confusing error.

1. The cloud copy id is derived, not random: `meeting_copy_id(owner_id, local_id)`.
   The same local Meeting always maps to the same cloud id.
2. Deletion is permanent. `meeting_lifecycle` keeps `deleted_at` and the DELETE path only sets it.
3. `guard_cloud_meeting_insert` requires a live accepted lifecycle row, so a deleted or expired copy
   never returns.

A re-upload therefore reaches `verifyStored`, finds no live lifecycle row, and fails. That failure has
no sentinel of its own, so `writeUploadRefusal` falls through to its default and answers
`503 cloud copy unavailable`. A 503 reads as retryable and names nothing, so it looks like an
outage rather than a permanent refusal of that one Meeting. The desktop queue does stop after
`MAX_SYNC_ATTEMPTS`, so it is a diagnosability problem, not a retry loop. Giving this case its own
sentinel and a permanent status is worth doing.

To see which local Meetings are spent for an account, read the lifecycle table over the private
tunnel:

```sh
printf "SELECT owner_id, left(id::text,8), left(local_id,8), deleted_at IS NOT NULL AS deleted FROM meeting_lifecycle ORDER BY 1;\n" \
  | railway connect Postgres --ssh --project b73b1b1e-810b-4c3d-af03-6136244852c0 \
      --environment 7b4a6831-62f8-4dda-a2e1-773542c266fb
```

Never reach for this to revive a copy. The permanence is the guarantee, and clearing `deleted_at`
would break it.

`cloud:proof` used to hit this on its second run in an account, because it reused the one pinned
synthetic fixture identity. It now creates and exports its own Meeting with a fresh id, so each run
gets its own cloud copy and `--delete` no longer consumes the proof for the whole account.
