/**
 * The anonymous daily Usage report. Every field is a fixed value or a bucket: no account, device,
 * install id, title, name or path. The cloud service accepts exactly these fields
 * (cloud/internal/service/usage.go), and docs/usage-reports.md explains each one.
 */
export type UsageReport = {
  v: 1
  app_version: string
  channel: 'stable' | 'beta'
  macos_major: number
  install_week: string
  meetings_recorded: '0' | '1' | '2-5' | '6+'
  recording_minutes: '0' | '1-29' | '30-119' | '120+'
  meetings_failed: '0' | '1' | '2+'
  screen_video_used: boolean
  notes_provider: 'off' | 'local' | 'codex_exec' | 'claude_code' | 'pi_agent'
  calendar_connected: boolean
  cloud_sync_on: boolean
  speaker_labels_on: boolean
}

/** unset until the user answers the setup question; nothing is sent unless it is on. */
export type UsageSharing = 'unset' | 'on' | 'off'

/** available is false in a build that never sends, such as a development run. */
export type UsageReportStatus = { sharing: UsageSharing; available: boolean; lastSentAt: string | null }

/** The last report sent, or a preview of today's report when none was sent yet. */
export type UsageReportView = { report: UsageReport; sentAt: string | null }
