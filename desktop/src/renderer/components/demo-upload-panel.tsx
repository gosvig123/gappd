import { useEffect, useRef, useState } from 'react'
import type { DemoUploadStatus } from '../../shared/demo-upload-contract'
import { Button, Card } from './ui'

type Action = () => Promise<DemoUploadStatus>

function useDemoUpload() {
  const [status, setStatus] = useState<DemoUploadStatus | null>(null)
  const [error, setError] = useState('')
  const generation = useRef(0)
  useEffect(() => {
    let active = true
    const refresh = async () => {
      const current = generation.current
      try { const value = await window.gappd.demoUpload.status(); if (active && current === generation.current) setStatus(value) }
      catch { if (active) setError('Demo status unavailable.') }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 1000)
    return () => { active = false; generation.current++; clearInterval(timer) }
  }, [])
  const run = async (action: Action) => {
    const current = ++generation.current
    setError('')
    try { const value = await action(); if (current === generation.current) setStatus(value) }
    catch { if (current === generation.current) setError('Demo action failed. Check status before trying again.') }
  }
  return { status, error, run }
}

export function DemoUploadPanel() {
  const { status, error, run } = useDemoUpload()
  if (!status?.available) return null
  const account = status.account
  const subject = account.subject || ''
  const busy = account.pending || status.sending
  return <Card className="settings-section">
    <h2>Synthetic demo Meeting</h2>
    <p>Manual development transport test. The server creates fixed fabricated text. No local Meeting is read or uploaded. Authorized AI clients can read the cloud copy. Gappd Cloud can read this text.</p>
    <div className="actions-row">
      <Button disabled={busy} onClick={() => void run(() => window.gappd.demoUpload.connect(true))}>Connect demo account</Button>
      <Button onClick={() => void run(() => window.gappd.demoUpload.connect(false))}>OFF / Cancel demo</Button>
    </div>
    <p>{account.enabled ? `Demo account: ${account.email} (${subject})` : 'Demo OFF. Connect explicitly; existing Cloud sync login is not upload consent.'}</p>
    <label><input type="checkbox" checked={status.consent} disabled={!account.enabled || busy} onChange={event => void run(() => window.gappd.demoUpload.setConsent(subject, event.target.checked))} /> I consent to create one fixed synthetic Meeting for this account. This consent is used once.</label>
    <div className="actions-row"><Button disabled={!status.consent || busy} onClick={() => void run(() => window.gappd.demoUpload.upload(subject))}>Upload demo Meeting</Button></div>
    <p>Cloud expiry is fixed at 30 days from first server acceptance. Reads stop at expiry; physical cleanup scheduling and 7-day backup retention remain unverified.</p>
    <label><input type="checkbox" checked={status.deleteConsent} disabled={!account.enabled || busy} onChange={event => void run(() => window.gappd.demoUpload.setDeleteConsent(subject, event.target.checked))} /> I confirm permanent deletion of only the synthetic cloud copy for {account.email} ({subject}). Local Meetings and audio stay on this Mac. This demo ID cannot be created again. This separate confirmation is used once.</label>
    <div className="actions-row"><Button disabled={!status.deleteConsent || busy} onClick={() => void run(() => window.gappd.demoUpload.deleteCopy(subject))}>Delete synthetic cloud copy</Button></div>
    <p>OFF cancels locally, not an accepted request. Cloud copies remain. No automatic retry or real Meeting sync.</p>
    <div role={error || account.error ? 'alert' : 'status'}>{error || account.error || status.result || (busy ? 'Waiting for demo operation…' : '')}</div>
  </Card>
}
