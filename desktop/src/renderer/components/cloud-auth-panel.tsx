import { useEffect, useRef, useState } from 'react'
import type { CloudAuthStatus } from '../../shared/cloud-auth-contract'
import { Button, Card } from './ui'
import { CloudAuthPanelState } from './cloud-auth-panel-state'

export function CloudAuthPanel() {
  const [status, setStatus] = useState<CloudAuthStatus | null>(null)
  const controller = useRef<CloudAuthPanelState | null>(null)
  useEffect(() => {
    const active = new CloudAuthPanelState(window.gappd.cloudAuth, setStatus)
    controller.current = active
    void active.refresh()
    return () => { active.dispose(); controller.current = null }
  }, [])
  const update = (enabled: boolean) => controller.current?.update(enabled)
  return <Card className="settings-section"><div className="settings-section-head"><div><h2>Cloud sync</h2><p>Development auth-only preview. No Meetings uploaded. Sync is not yet available.</p></div></div><label className="startup-setting"><span className="startup-setting-copy"><strong>Cloud sync</strong><span>Connect a Gappd development account in your browser. Future uploads will require separate consent.</span></span><input type="checkbox" checked={status?.enabled ?? false} disabled={!status || status.pending} onChange={event => void update(event.target.checked)} /></label>{status?.pending ? <div className="actions-row"><span role="status">Waiting for browser sign-in…</span><Button onClick={() => void update(false)}>Cancel sign-in</Button></div> : null}{status?.error && !status.pending ? <div className="actions-row"><Button onClick={() => void update(false)}>Remove local credentials</Button></div> : null}<div className="status-note" role={status?.error ? 'alert' : 'status'}>{status?.error || (status?.enabled ? `Signed in as ${status.email} (${status.subject}). Authentication only; sync unavailable.` : 'Off. Local features and Google Calendar are unchanged.')}</div></Card>
}
