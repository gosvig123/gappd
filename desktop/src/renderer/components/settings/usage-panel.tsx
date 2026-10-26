import { useState } from 'react'
import type { UsageReportView } from '../../../shared/usage-report'
import { useUsageSharing } from '../../hooks/use-usage-sharing'
import { Button, Card, cx } from '../ui'

/** The usage sharing choice, and the exact report this Mac sends, so nothing is sent unseen. */
export function UsagePanel() {
  const { status, error, setSharing } = useUsageSharing()
  const [view, setView] = useState<UsageReportView | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const toggleReport = async () => {
    if (view) return setView(null)
    try { setView(await window.gappd.usage.report()) } catch (cause) { setReportError(`Could not build the report: ${cause instanceof Error ? cause.message : String(cause)}. Try again.`) }
  }
  const note = error || reportError || sharingNote(status?.sharing === 'on', status?.available ?? true)
  return (
    <Card className="settings-section">
      <div className="settings-section-head"><div><h2>Usage counts</h2><p>Anonymous daily counts that help improve Gappd. No account or ID, and no names, titles, transcripts, or notes.</p></div></div>
      <label className="startup-setting">
        <span className="startup-setting-copy"><strong>Share anonymous usage counts</strong><span>Once a day: Meetings and minutes in ranges, failures, app and macOS version, and which features are on.</span></span>
        <input type="checkbox" checked={status?.sharing === 'on'} disabled={!status} onChange={(event) => void setSharing(event.target.checked)} />
      </label>
      <div><Button onClick={() => void toggleReport()}>{view ? 'Hide report' : 'Show report'}</Button></div>
      {view ? <>
        <p className="status-note">{view.sentAt ? `Last report, sent ${new Date(view.sentAt).toLocaleString()}.` : 'Nothing was sent yet. This is a preview of today\u2019s report.'}</p>
        <pre aria-label="Usage report">{JSON.stringify(view.report, null, 2)}</pre>
      </> : null}
      <div className={cx('status-note', error || reportError ? 'danger' : undefined)}>{note}</div>
    </Card>
  )
}

function sharingNote(on: boolean, available: boolean): string {
  if (!available) return 'This build never sends usage reports.'
  return on ? 'Sharing. The report for each day is sent the next time Gappd runs.' : 'Not shared. Nothing is sent.'
}
