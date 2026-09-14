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

### Log-retention blocker

The workspace API reports plan PRO. Railway documents 30-day log retention for Pro, not
our approved 14-day maximum. No supported per-service 14-day control was identified.
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
   is the signal. Configuring the monitor itself is still outstanding.
3. Test restore in an isolated target with current deletion evidence; do not serve it publicly.
4. Verify aged backup removal and resolve the log-retention blocker before real uploads.

## Primary sources

- [Railway cron semantics](https://docs.railway.com/cron-jobs)
- [Docker entrypoint override](https://docs.railway.com/deployments/start-command)
- [Backup schedules and retention](https://docs.railway.com/volumes/backups)
- [Plan-based log retention](https://docs.railway.com/observability/logs#log-retention)
- [Approved lifecycle contract](cloud-data-lifecycle.md)
