import { useErrorReports } from '../../hooks/use-error-reports'
import { Card, cx } from '../ui'

/** The error report choice. Reports are on unless the user turns them off. */
export function ErrorReportsPanel() {
  const { status, error, setSharing } = useErrorReports()
  const note = error || reportsNote(status?.sharing === 'on', status?.available ?? true)
  return (
    <Card className="settings-section">
      <div className="settings-section-head"><div><h2>Error reports</h2><p>When something fails, Gappd tells its team what failed and where in its own code, so it can be fixed. No account or ID, no error text, and no names, titles, paths, transcripts, or notes.</p></div></div>
      <label className="startup-setting">
        <span className="startup-setting-copy"><strong>Send anonymous error reports</strong><span>For failures: the step that failed, the error type and code, the place in Gappd's code, and the app and macOS version.</span></span>
        <input type="checkbox" checked={status?.sharing === 'on'} disabled={!status} onChange={(event) => void setSharing(event.target.checked)} />
      </label>
      <div className={cx('status-note', error ? 'danger' : undefined)}>{note}</div>
    </Card>
  )
}

function reportsNote(on: boolean, available: boolean): string {
  if (!available) return 'This build never sends error reports.'
  return on ? 'On. Failures are reported soon after they happen; repeats are grouped.' : 'Off. Nothing is sent.'
}
