import { useEffect, useRef, useState } from 'react'
import type { MeetingListItem } from '../../../shared/contracts'
import type { MeetingUploadStatus } from '../../../shared/meeting-upload-contract'
import { MEETING_UPLOAD_CONSENT_TEXT } from '../../../shared/meeting-upload-contract'
import { MeetingUploadPanelState } from './cloud-upload-panel-state'
import { useConfirm, type ConfirmController } from '../confirm'
import { Button, Card, StatusPill } from '../ui'

type Run = (action: (api: typeof window.gappd.meetingUpload) => Promise<MeetingUploadStatus>) => Promise<void>

/** Revokes every client of the account, including clients this Mac has never seen. */
const ALL_CLIENTS = '*'

export function MeetingUploadPanel() {
  const { status, error, meetings, clients, run } = useMeetingUploadPanel()
  const confirm = useConfirm()
  if (!status) return null
  const { account } = status
  const busy = account.pending || status.sending
  const titles = new Map(meetings.map(meeting => [meeting.id, meeting.title || 'Untitled Meeting']))
  return <Card className="settings-section">
    <div className="settings-section-head">
      <div><h2>Cloud Meeting sync</h2><p>Sync Meeting text to Gappd Cloud so AI clients you authorize can read it.</p></div>
      <StatusPill tone={pillTone(status, error)}>{pillLabel(status)}</StatusPill>
    </div>
    {account.enabled
      ? renderConnected({ status, busy, run, titles })
      : renderSignedOut(status, busy, run)}
    {account.error ? <p className="status-note danger" role="alert">{account.error}</p> : null}
    {status.result ? <p className="status-note">{status.result}</p> : null}
    {error ? <p className="status-note danger" role="alert">{error}</p> : null}
    {account.enabled && status.consent ? renderManage({ status, busy, run, meetings, clients, confirm }) : null}
    {confirm.dialog}
  </Card>
}

// The panel polls while it is open, so the state and its disposal live together.
function useMeetingUploadPanel() {
  const [status, setStatus] = useState<MeetingUploadStatus | null>(null)
  const [error, setError] = useState('')
  const [meetings, setMeetings] = useState<MeetingListItem[]>([])
  const [clients, setClients] = useState<string[]>([])
  const controller = useRef<MeetingUploadPanelState | null>(null)
  useEffect(() => {
    const state = new MeetingUploadPanelState(window.gappd.meetingUpload,
      (value, message) => { if (value) setStatus(value); setError(message) })
    controller.current = state
    void state.refresh()
    void window.gappd.meetings.list().then(setMeetings).catch(() => setMeetings([]))
    void window.gappd.meetingUpload.knownClients().then(setClients).catch(() => setClients([]))
    return () => state.dispose()
  }, [])
  const run: Run = async (action) => {
    setError('')
    await controller.current?.run(action)
  }
  return { status, error, meetings, clients, run }
}

function renderSignedOut(status: MeetingUploadStatus, busy: boolean, run: Run) {
  return <>
    <p className="status-note">Recording works without an account. Gappd opens your browser to create a Gappd account or sign in. Signing in uploads nothing; you turn sync on in the next step.</p>
    <div className="actions-row">
      <Button variant="primary" disabled={busy} onClick={() => void run((api) => api.connect(true))}>
        {status.account.pending ? 'Waiting for browser sign-in…' : 'Create account or sign in'}
      </Button>
      {status.account.pending ? <Button onClick={() => void run((api) => api.connect(false))}>Cancel</Button> : null}
    </div>
  </>
}

type Connected = { status: MeetingUploadStatus; busy: boolean; run: Run; titles: Map<string, string> }

function renderConnected({ status, busy, run, titles }: Connected) {
  const { account, queue } = status
  const subject = account.subject || ''
  const failed = queue.entries.filter(entry => entry.state === 'failed')
  const retry = () => run(async (api) => {
    for (const entry of failed) await api.enqueue(entry.localId)
    return api.sync()
  })
  return <>
    <p className="status-note">Signed in as {account.email}.{status.consent ? ` ${syncNote(status)}` : ''}</p>
    <div className="actions-row">
      {failed.length > 0 ? <Button variant="primary" disabled={busy} onClick={() => void retry()}>Retry failed uploads</Button> : null}
      <Button onClick={() => void run((api) => api.connect(false))}>{status.consent ? 'Turn off sync and sign out' : 'Sign out'}</Button>
    </div>
    <label className="startup-setting">
      <span className="startup-setting-copy"><strong>Sync Meetings to Gappd Cloud</strong><span>{MEETING_UPLOAD_CONSENT_TEXT}</span></span>
      <input type="checkbox" checked={status.consent} disabled={busy}
        onChange={event => void run((api) => api.setConsent(subject, event.target.checked))} />
    </label>
    {queue.entries.length > 0 ? <details className="technical-details">
      <summary>Upload details</summary>
      <ul>
        {queue.entries.map(entry => <li key={entry.localId}>
          {titles.get(entry.localId) || entry.localId} · {entry.state === 'failed' ? 'failed' : 'waiting'} · {entry.attempts} attempt(s)
          {entry.error ? ` · ${entry.error}` : ''}
        </li>)}
      </ul>
    </details> : null}
  </>
}

type Manage = { status: MeetingUploadStatus; busy: boolean; run: Run; meetings: MeetingListItem[]; clients: string[]; confirm: ConfirmController }

// Each destructive action asks once in a dialog that names the account, then spends the
// one-use confirmation the main process requires in the same step.
function renderManage({ status, busy, run, meetings, clients, confirm }: Manage) {
  const subject = status.account.subject || ''
  const email = status.account.email || subject
  return <details className="technical-details">
    <summary>Manage cloud data</summary>
    <ManageMeeting meetings={meetings} busy={busy} onDelete={(meeting) => confirm.request({
      title: 'Delete this cloud copy?',
      body: `Gappd deletes the cloud copy of “${meeting.title || 'Untitled Meeting'}” for ${email}. The local Meeting and its audio stay on this Mac. This Meeting cannot be uploaded again, and backup removal can take up to 7 days.`,
      confirmLabel: 'Delete cloud copy', tone: 'danger',
      onConfirm: () => run(async (api) => { await api.setDeleteConsent(subject, true, meeting.id); return api.deleteCopy(subject, meeting.id) }),
    })} />
    <ManageClient clients={clients} busy={busy} onRevoke={(client) => confirm.request({
      title: 'Revoke AI client access?',
      body: `${client === ALL_CLIENTS ? 'Every AI client' : `Client ${client}`} loses access to the cloud Meetings of ${email} within 30 seconds. Stored cloud copies stay until they are deleted or expire.`,
      confirmLabel: 'Revoke access', tone: 'danger',
      onConfirm: () => run(async (api) => { await api.setRevokeConsent(subject, true, client); return api.revokeClient(subject, client) }),
    })} />
    <div className="actions-row">
      <Button disabled={busy} onClick={() => confirm.request({
        title: 'Delete all cloud data?',
        body: `Gappd deletes every cloud copy for ${email}. Local Meetings and audio stay on this Mac. Those Meetings cannot be uploaded again, uploads stay off until you choose Allow uploads again, and backup removal can take up to 7 days.`,
        confirmLabel: 'Delete all cloud data', tone: 'danger',
        onConfirm: () => run(async (api) => { await api.setAccountDeleteConsent(subject, true); return api.deleteAll() }),
      })}>Delete all cloud data…</Button>
      <Button disabled={busy} onClick={() => void run((api) => api.allowUploads())}>Allow uploads again</Button>
    </div>
    <p className="status-note">Use Allow uploads again after deleting all cloud data, or when sync says uploads are off or this Mac's upload authorization is out of date. After a deletion, every other Mac on this account must allow uploads again too.</p>
  </details>
}

function ManageMeeting({ meetings, busy, onDelete }: { meetings: MeetingListItem[]; busy: boolean; onDelete: (meeting: MeetingListItem) => void }) {
  const [selected, setSelected] = useState('')
  const meeting = meetings.find(item => item.id === selected)
  return <div className="actions-row">
    <select aria-label="Meeting whose cloud copy to delete" value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}>
      <option value="">Choose a Meeting</option>
      {meetings.map(item => <option key={item.id} value={item.id}>{item.title || 'Untitled Meeting'}</option>)}
    </select>
    <Button disabled={!meeting || busy} onClick={() => { if (meeting) onDelete(meeting) }}>Delete cloud copy…</Button>
  </div>
}

function ManageClient({ clients, busy, onRevoke }: { clients: string[]; busy: boolean; onRevoke: (client: string) => void }) {
  const [selected, setSelected] = useState('')
  return <div className="actions-row">
    <select aria-label="AI client to revoke" value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}>
      <option value="">Choose an AI client</option>
      {clients.map(id => <option key={id} value={id}>{id}</option>)}
      <option value={ALL_CLIENTS}>Every AI client</option>
    </select>
    <Button disabled={!selected || busy} onClick={() => onRevoke(selected)}>Revoke access…</Button>
  </div>
}

function syncNote(status: MeetingUploadStatus): string {
  const { pending, failed, deleting } = status.queue
  if (status.sending) return pending > 0 ? `Uploading ${meetingCount(pending)}.` : 'Syncing.'
  const parts = [
    pending > 0 ? `${meetingCount(pending)} waiting to upload` : '',
    failed > 0 ? `${meetingCount(failed)} could not upload` : '',
    deleting > 0 ? `${deleting} cloud ${deleting === 1 ? 'copy waits' : 'copies wait'} for deletion` : '',
  ].filter(Boolean)
  if (parts.length === 0) return 'Up to date. New Meetings sync when they finish processing.'
  return `${parts.join(', ')}.${pending > 0 || deleting > 0 ? ' Gappd retries every minute.' : ''}`
}

function meetingCount(count: number): string {
  return `${count} ${count === 1 ? 'Meeting' : 'Meetings'}`
}

function pillLabel(status: MeetingUploadStatus): string {
  if (status.account.pending) return 'Signing in'
  if (!status.account.enabled) return 'Off'
  if (!status.consent) return 'Signed in'
  if (status.sending) return 'Syncing'
  return status.queue.failed > 0 ? 'Needs attention' : 'On'
}

function pillTone(status: MeetingUploadStatus, error: string): string {
  if (error || status.account.error || (status.consent && status.queue.failed > 0)) return 'danger'
  if (status.account.pending || status.sending) return 'processing'
  return status.consent ? 'success' : 'neutral'
}
