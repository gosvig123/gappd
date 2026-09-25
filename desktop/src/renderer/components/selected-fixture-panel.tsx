import { useEffect, useRef, useState } from 'react'
import type { SelectedFixtureStatus } from '../../shared/selected-fixture-contract'
import { SELECTED_FIXTURE_ID } from '../../shared/selected-fixture-contract'
import { Button } from './ui'

export function SelectedFixturePanel({ meetingId }: { meetingId: string | null }) {
  const { status, error, run } = useSelectedFixture()
  if (!status?.available || meetingId !== SELECTED_FIXTURE_ID) return null
  const subject = status.account.subject || ''
  const busy = status.sending || status.account.pending
  return <section aria-label="Selected synthetic Meeting upload">
    <h2>Share this synthetic local Meeting</h2>
    <p>Development only. Automatic sync is OFF. Gappd Cloud and authorized AI clients can read the shared text.</p>
    <Button disabled={busy} onClick={() => void run(() => window.gappd.selectedFixture.connect(true))}>Connect demo account</Button>
    <Button onClick={() => void run(() => window.gappd.selectedFixture.connect(false))}>OFF / Cancel</Button>
    <p>Receiving account: {status.account.email || 'Not connected'} ({subject})</p>
    <Button disabled={busy} onClick={() => void run(() => window.gappd.selectedFixture.preview(meetingId))}>Preview exact shared document</Button>
    {status.preview ? <pre tabIndex={0} aria-label="Exact shared JSON document">{status.preview}</pre> : null}
    <p>Shared fields: document version, local identity, title, transcript, summary, start time and revision. No audio, identities, local paths, Calendar caches or Saved Agenda drafts.</p>
    <p>Expires 30 days after first server acceptance. Retries do not extend expiry. OFF does not delete cloud copies. Hourly cleanup and 6-day backups are configured; cleanup deadlines, backup removal and restore remain unverified.</p>
    <ConsentControls status={status} subject={subject} busy={busy} run={run} />
    <p role={error ? 'alert' : 'status'}>{error || status.account.error || status.result}</p>
  </section>
}

type Action = () => Promise<SelectedFixtureStatus>
function ConsentControls({ status, subject, busy, run }: { status: SelectedFixtureStatus; subject: string; busy: boolean; run: (action: Action) => Promise<void> }) {
  return <>
    <label><input type="checkbox" checked={status.consent} disabled={busy || !status.preview || !status.account.enabled} onChange={event => void run(() => window.gappd.selectedFixture.setConsent(subject, event.target.checked, 'upload'))} /> I consent once to upload exactly this preview to the receiving account.</label>
    <Button disabled={busy || !status.consent} onClick={() => void run(() => window.gappd.selectedFixture.perform(subject, 'upload'))}>Upload selected synthetic Meeting</Button>
    <label><input type="checkbox" checked={status.deleteConsent} disabled={busy || !status.preview || !status.account.enabled} onChange={event => void run(() => window.gappd.selectedFixture.setConsent(subject, event.target.checked, 'delete'))} /> I confirm permanent deletion of only this selected synthetic cloud copy for {status.account.email} ({subject}). Local data stays. This cloud ID cannot be reused.</label>
    <Button disabled={busy || !status.deleteConsent} onClick={() => void run(() => window.gappd.selectedFixture.perform(subject, 'delete'))}>Delete selected synthetic cloud copy</Button>
  </>
}

function useSelectedFixture() {
  const [status, setStatus] = useState<SelectedFixtureStatus | null>(null)
  const [error, setError] = useState('')
  const generation = useRef(0)
  useEffect(() => {
    const refresh = () => { const current = generation.current; void window.gappd.selectedFixture.status().then(value => { if (current === generation.current) setStatus(value) }).catch(() => undefined) }
    refresh()
    const timer = setInterval(refresh, 1000)
    return () => { generation.current++; clearInterval(timer); void window.gappd.selectedFixture.cancel() }
  }, [])
  const run = async (action: Action) => {
    const current = ++generation.current
    setError('')
    try { const value = await action(); if (current === generation.current) setStatus(value) }
    catch { if (current === generation.current) setError('Fixture action refused or unavailable. Preview again; no automatic retry.') }
  }
  return { status, error, run }
}
