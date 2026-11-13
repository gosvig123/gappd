# Error reports

When something fails in production, the team sees it in a private Discord channel. Two sources post
there: the cloud service itself, and the desktop app's anonymous **Error reports**. The service
keeps no database record or file of them: it holds each line in memory until it is posted and writes
it once to its application log. Railway keeps that log and Discord keeps the channel for their own
retention periods.

Only the cloud service knows the Discord webhook URL (`DISCORD_ERRORS_WEBHOOK_URL`). The desktop
app sends its reports to the cloud service, never to Discord.

## Cloud failures

`cloud/internal/service/alerts.go` posts a line for:

- every 5xx answer and every panic, with the route, the status and the kind of each cause;
- a server that stops (`cloud API stopped`) and a failed hourly cleanup (`Meeting cleanup failed`).

The kind of a cause is a code, never error text, because a database error can quote user data:
a SQLSTATE such as `23505`, `database connection failed`, `timeout`, `canceled`, `network`, or the
Go type of the error. A panic keeps a runtime error's text (it names no data, for example `index out
of range`) or else only the panic's type, plus up to 5 frames of the service's own code. Code that
fails with an internal cause wraps it with `WithCause("fixed message", err)` and calls
`noteFailure(r.Context(), err)` before it answers 503, so the report shows the real cause.

Each failure also writes one log line (`error report: …`) to the Railway logs. Without
`DISCORD_ERRORS_WEBHOOK_URL`, only the log line is written. The sender batches lines into Discord
messages of at most 1,900 characters, follows Discord's rate limit and mentions no one. The queue
holds 500 lines; when it is full, newer lines are dropped and the next message says how many. Each
message starts with the Railway environment name (`RAILWAY_ENVIRONMENT_NAME`, else `cloud`).

## Desktop Error reports

The desktop app sends one report per failure unless the user turns them off: Settings › General ›
Error reports › **Send anonymous error reports**. They are on by default. The choice is stored in
`error-report.json` in the app data folder; a damaged file counts as off.

### What a report holds

There is no account, device key, install id, IP-derived field or error message, so a report cannot
carry a title, a name, a path or an email address.

| Field | Values | Source on this Mac |
| --- | --- | --- |
| `v` | `1` | Report format |
| `app_version` | `0.1.28`, `0.1.28-beta.327` | `app.getVersion()` |
| `channel` | `stable`, `beta` | Update channel |
| `macos_major` | `11` to `99` | `process.getSystemVersion()` |
| `source` | `main`, `renderer`, `process`, `meeting` | Where it failed |
| `operation` | Fixed name, such as `calendar.refresh` or `ipc.meeting-upload.sync` | The step that failed |
| `error_name` | `TypeError`, `Error`, `ProcessGone`, `MeetingFailed`, … | Error class name: a name that ends in `Error` or `Exception`, else `Error` |
| `error_code` | `ENOENT`, `ERR_INVALID_ARG_TYPE`, `crashed`, `SQLITE_BUSY_SNAPSHOT` (a backend command failed on a database lock), or empty | An upper-case code constant, a number up to 4 digits, or an Electron exit reason |
| `stack` | Up to 10 frames, such as `connect dist-electron/main/main.js:21886:43` | Frames in Gappd's own code |
| `repeats` | `0` to `100000` | Same failure since the last send |

The lines of a stack that repeat the error message are removed first, in the window for window
errors. A frame is kept only when its file is one of Gappd's own bundles (`dist-electron/main/main.js`,
`dist-electron/preload/index.js`, `dist/assets/*.js`, or the `src/` files of a development window);
any other frame is dropped, so no path from the user's home is sent. A name or code that does not
match its pattern is left out, not cleaned. The client is
`desktop/src/shared/error-report.ts`; the server accepts exactly these fields and patterns
(`cloud/internal/service/error_report.go`) and refuses any other report with 400. Change both
together and raise `v` when a field changes meaning.

### What is reported

| `source` | Failures |
| --- | --- |
| `main` | A failed IPC operation (`ipc.<group>.<operation>`), an uncaught exception or unhandled rejection in the main process, and each background step that logs through `logFailure` in `desktop/src/main/error-log.ts` |
| `renderer` | An uncaught error (`renderer.error`) or unhandled rejection (`renderer.unhandled-rejection`) in the window |
| `process` | The window or a helper process ended other than cleanly (`process.renderer-gone`, `process.gpu-gone`, …) |
| `meeting` | A Meeting whose capture, processing or Screen video is `failed` and was not at the last check (every 15 minutes, first 2 minutes after launch). The app keeps the failed keys (Meeting id and step) in `error-report.json`; they are never sent |

To report a new failure, call `logFailure('area.step', 'local log message', error)`. The message
stays in the local log; only the operation and the error's name, code and frames are sent.

Work that waits is not a failure. A drain that finds its capability not ready (error code
`CAPABILITY_NOT_READY`) writes only a local warning. When Meetings wait for transcription because the
Apple speech model is not ready, the drain retry check downloads it again at most every 5 minutes;
after an hour of waiting it sends `processing.stalled`, again every 10 minutes while the wait lasts
(`desktop/src/main/drain-coordinator.ts`). A later `processing.stalled` with `repeats` above 0 means a
Mac is still stuck; no new line means it recovered or quit.

### How it is sent

`desktop/src/main/error-report.ts` sends `POST /errors` at once, with a 10-second timeout. The same
failure (source, operation, name and code) is sent at most once in 10 minutes; later ones are counted
in `repeats` of the next send. A Mac sends at most 30 reports an hour, and only one at a time: a
report that comes while a send is open is dropped. A failed send is dropped, never retried and never
reported, so reporting cannot loop.

Reporting must never harm the app, also on a slow or broken network:

- The failure path never waits for the send and never sees its errors. 20,000 reports in a burst
  take about 80 ms in total, and a server that never answers, a lost address, a missing DNS name or
  a refused connection each hold one connection until the 10-second timeout.
- The response body is not read. Reporting never throws, also for error values whose getters throw.
- With reports off, nothing is sent and the Meeting check does not call the backend. Turning reports
  off forgets the failed Meetings, so turning them on again does not send old failures.
- The Meeting check starts 2 minutes after launch, runs one at a time, and a backend that does not
  answer or a full disk only skips that check.

A development run never sends to production. It sends only when `GAPPD_ERROR_REPORT_URL` is set,
for example to a local cloud server (`http://127.0.0.1:58080/errors`).

`POST /errors` needs no token and is bounded to 4 KiB (413 beyond), cross-origin protection (403
for a browser request from another site) and one shared budget of 300 reports a minute (429
beyond). It answers 204 or 400 and forwards the report as a 🟣 line. Caller IP addresses are not stored by the service. Railway's edge may keep request logs for its
own retention period.

## Setup

1. In Discord, open the private error channel › Edit Channel › Integrations › Webhooks, and copy
   the webhook URL.
2. Set `DISCORD_ERRORS_WEBHOOK_URL` on the Railway API service and on the cleanup cron service.
3. Deploy (see [Deploying the API](cloud-operations.md#deploying-the-api)).

To check it, stop the database for a moment or send a test report:

```sh
curl -sS -X POST https://gappd-cloud-api-production.up.railway.app/errors -H 'Content-Type: application/json' \
  -d '{"v":1,"app_version":"0.1.0","channel":"beta","macos_major":15,"source":"main","operation":"setup.check","error_name":"Error","error_code":"","stack":[],"repeats":0}'
```
