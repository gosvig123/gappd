import { useEffect, useRef, useState } from 'react'
import type { MeetingListItem } from '../../shared/contracts'
import type { MeetingUploadStatus } from '../../shared/meeting-upload-contract'
import { MEETING_UPLOAD_CONSENT_TEXT } from '../../shared/meeting-upload-contract'
import { MeetingUploadPanelState } from './meeting-upload-panel-state'
import { Button, Card } from './ui'

export function MeetingUploadPanel() {
  const [status, setStatus] = useState<MeetingUploadStatus | null>(null)
  const [error, setError] = useState('')
  const [meetings, setMeetings] = useState<MeetingListItem[]>([])
  const [selected, setSelected] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const controller = useRef<MeetingUploadPanelState | null>(null)

  useEffect(() => {
    const state = new MeetingUploadPanelState(window.gappd.meetingUpload,
      (value, message) => { if (value) setStatus(value); setError(message) })
    controller.current = state
    void state.refresh()
    void window.gappd.meetings.list().then(setMeetings).catch(() => setMeetings([]))
    return () => state.dispose()
  }, [])

  if (!status?.available) return null
  const account = status.account
  const subject = account.subject || ''
  const run = (action: (api: typeof window.gappd.meetingUpload) => Promise<MeetingUploadStatus>) => {
    setError('')
    return controller.current?.run(action)
  }
  const busy = account.pending || status.sending
  return <Card className="settings-section">
    <h2>Cloud Meeting upload</h2>
    <p>Send Meeting text to Gappd Cloud so your authorized AI clients can read it. Read the consent below before turning this on.</p>
    <div className="actions-row">
      <Button disabled={busy} onClick={() => void run((api) => api.connect(true))}>Connect upload account</Button>
      <Button onClick={() => void run((api) => api.connect(false))}>OFF / Cancel upload</Button>
      <Button disabled={!status.consent || busy || status.queue.pending === 0} onClick={() => void run((api) => api.sync())}>Upload queued Meetings</Button>
    </div>
    <p>{account.enabled ? `Upload account: ${account.email} (${subject})` : 'Upload OFF. Connect explicitly; a signed-in account is not upload consent.'}</p>
    <label><input type="checkbox" checked={status.consent} disabled={!account.enabled || busy}
      onChange={event => void run((api) => api.setConsent(subject, event.target.checked))} /> {MEETING_UPLOAD_CONSENT_TEXT}</label>
    {renderQueue(status, busy)}
    {renderActions({ meetings, selected, setSelected, confirmed, setConfirmed, status, subject, busy, run })}
    {status.result ? <p>{status.result}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </Card>
}

function renderQueue(status: MeetingUploadStatus, busy: boolean) {
  if (status.queue.entries.length === 0) return <p>{busy ? 'Uploading.' : 'Nothing is queued.'}</p>
  return <ul>
    {status.queue.entries.map(entry => <li key={entry.localId}>
      {entry.localId} · revision {entry.revision} · {entry.state} · {entry.attempts} attempt(s)
      {entry.error ? ` · ${entry.error}` : ''}
    </li>)}
  </ul>
}

type Actions = {
  meetings: MeetingListItem[]
  selected: string
  setSelected: (value: string) => void
  confirmed: boolean
  setConfirmed: (value: boolean) => void
  status: MeetingUploadStatus
  subject: string
  busy: boolean
  run: (action: (api: typeof window.gappd.meetingUpload) => Promise<MeetingUploadStatus>) => void
}

function renderActions({ meetings, selected, setSelected, confirmed, setConfirmed, status, subject, busy, run }: Actions) {
  const pick = (value: string) => { setSelected(value); setConfirmed(false) }
  return <>
    <h3>Meetings on this Mac</h3>
    <p>Uploading a Meeting stores its text. The local Meeting and its audio stay as they are.</p>
    <select value={selected} disabled={busy || !status.consent} onChange={event => pick(event.target.value)}>
      <option value="">Choose a Meeting</option>
      {meetings.map(meeting => <option key={meeting.id} value={meeting.id}>{meeting.title || meeting.id}</option>)}
    </select>
    <div className="actions-row">
      <Button disabled={!selected || !status.consent || busy}
        onClick={() => void run(async (api) => { await api.enqueue(selected); return api.sync() })}>Upload to cloud</Button>
      <Button disabled={!selected || !status.consent || busy}
        onClick={() => void run((api) => api.setDeleteConsent(subject, true, selected))}>Confirm cloud deletion</Button>
      <Button disabled={!selected || !confirmed || !status.deleteConsent || busy}
        onClick={() => void run((api) => api.deleteCopy(subject, selected))}>Delete cloud copy</Button>
    </div>
    <label><input type="checkbox" checked={confirmed} disabled={!selected || busy}
      onChange={event => { setConfirmed(event.target.checked); if (!event.target.checked && status.deleteConsent) void run((api) => api.setDeleteConsent(subject, false, selected)) }} />
      {' '}I understand this removes the cloud copy for {selected || 'the chosen Meeting'} only. Its cloud identity is barred permanently, the local Meeting is kept, and backup removal can take up to 7 days.</label>
  </>
}
