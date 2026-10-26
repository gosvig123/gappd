# Usage reports

Gappd can send one anonymous **Usage report** per day, only when the user shares usage counts. The
setup card asks once ("Share anonymous usage counts"); Settings › General has the switch and
**Show report**, which shows the exact JSON last sent (or a preview of today's report).

## What a report holds

Every field is a fixed value or a bucket. There is no account, device key, install id, IP-derived
field or free text, so a report cannot carry a title, a name, a path or an error message.

| Field | Values | Source on this Mac |
| --- | --- | --- |
| `v` | `1` | Report format |
| `app_version` | `0.1.28`, `0.1.28-beta.327` | `app.getVersion()` |
| `channel` | `stable`, `beta` | Update channel |
| `macos_major` | `11` to `99` | `process.getSystemVersion()` |
| `install_week` | ISO week, such as `2026-W41` | Creation time of the app data folder |
| `meetings_recorded` | `0`, `1`, `2-5`, `6+` | Meetings started that day |
| `recording_minutes` | `0`, `1-29`, `30-119`, `120+` | Total length of those Meetings |
| `meetings_failed` | `0`, `1`, `2+` | Those Meetings with failed capture or processing |
| `screen_video_used` | `true`, `false` | One of those Meetings has a ready Screen video |
| `notes_provider` | `off`, `local`, `codex_exec`, `claude_code`, `pi_agent` | Notes setting |
| `calendar_connected` | `true`, `false` | A Google Calendar connection exists |
| `cloud_sync_on` | `true`, `false` | Cloud upload consent is active |
| `speaker_labels_on` | `true`, `false` | Automatic speaker labels setting |

The client type is `desktop/src/shared/usage-report.ts`; the server accepts exactly these fields and
values (`cloud/internal/service/usage.go`) and refuses any other report with 400. Change all three
together and raise `v` when a field changes meaning.

## How it is sent

`desktop/src/main/usage-report.ts` checks every hour; the first check waits a random 5 to 60
minutes after launch. When the local day changed, it builds the report for the day that ended from
data already on the Mac (the Meeting list and settings) and sends it with `POST /usage`. Gappd keeps
no usage log: only the sharing choice, the install week, the current day and the last report, in
`usage-report.json` in the app data folder. A failed send is dropped, not retried.

A development run never sends to production. It sends only when `GAPPD_USAGE_REPORT_URL` is set,
for example to a local cloud server (`http://127.0.0.1:58080/usage`). With that variable set, the
first check runs 10 seconds after launch, so a probe can watch the send.

## How it is stored

`POST /usage` needs no token and is bounded to 1 KiB and one shared budget of 600 reports a minute.
It adds one to each field value's total for the UTC day the server received it (`usage_daily`,
migration 014) and stores nothing per report. Totals are per field, so no one can combine two
fields of one report. Only the database owner can read the table; the runtime roles can only call
`record_usage`.

Caller IP addresses are not stored by the service. Railway's edge may keep request logs for its own
retention period.

## Reading the numbers

The private stats dashboard (`stats.getgappd.com`, in the `gappd-site` repository) shows these
totals. It reads them from `GET /usage/totals` with the `GAPPD_STATS_TOKEN` bearer token. The
route calls `usage_totals()` (migration 015): the daily totals of the last 400 days, without any
total under 5. The reader role can call that function but still cannot read `usage_daily`.

Each install sends at most one report per day, so the reports for a day equal the installs that ran
on the day before (or on their last day of use, when the app was closed for a while). To query by
hand, as the database owner:

```sql
-- Active installs per day
SELECT day, sum(reports) FROM usage_daily WHERE field='channel' GROUP BY day ORDER BY day;
-- Retention: active installs by install week
SELECT day, value AS install_week, reports FROM usage_daily WHERE field='install_week' ORDER BY day, value;
-- Notes provider share, last 30 days
SELECT value, sum(reports) FROM usage_daily WHERE field='notes_provider' AND day > current_date - 30 GROUP BY value;
```

Only use a total of 5 or more. A smaller number can describe a single person; leave it out of any
chart or message.

Install and update counts without any report: the GitHub release download counts of the `.dmg`
(new installs), the `-mac.zip` (updates applied), and `latest-mac.yml`/`beta-mac.yml` (update checks).
