import { meetingStatusLabel, meetingStatusTone, processingStatusLabel } from '../components/meeting-status'

type Device = Awaited<ReturnType<typeof window.gappd.system.getDevices>>[number]
type MeetingListItem = Awaited<ReturnType<typeof window.gappd.meetings.list>>[number]

type RecordViewProps = {
  title: string
  device: number
  devices: Device[]
  recordingStatus: string
  recentMeeting: MeetingListItem | null
  canStart: boolean
  canStop: boolean
  onTitleChange: (value: string) => void
  onDeviceChange: (value: number) => void
  onStart: () => void
  onStop: () => void
  onOpenMeeting: (id: string) => void
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleString()
}

function recordStatus(canStart: boolean, canStop: boolean, devices: Device[], recordingStatus: string): { tone: string; title: string; detail: string } {
  if (recordingStatus === 'recording') return { tone: 'recording', title: 'Recording now', detail: 'Keep this running. Stop when meeting ends; processing starts next.' }
  if (canStop) return { tone: 'processing', title: 'Stopping / processing', detail: 'Audio handoff is underway. Latest meeting updates below.' }
  if (!devices.length) return { tone: 'error', title: 'No microphone found', detail: 'Connect or enable an input device before recording.' }
  if (canStart) return { tone: 'idle', title: 'Ready', detail: 'Choose microphone, start recording, stop when done, then watch latest meeting.' }
  return { tone: 'processing', title: 'Recorder busy', detail: 'Wait for current handoff before starting another meeting.' }
}

function meetingProgress(meeting: MeetingListItem): { detail: string; cta: string } {
  if (meeting.status.processing.state === 'processing') return { detail: 'AI is preparing transcript and summary.', cta: 'View progress' }
  if (meeting.status.state === 'failed' || meeting.status.processing.state === 'failed') return { detail: 'Processing needs attention.', cta: 'Open details' }
  if (meeting.hasSummary || meeting.hasTranscript) return { detail: 'Notes are ready to review.', cta: 'Review meeting' }
  return { detail: 'Captured. AI processing will update this card.', cta: 'Open meeting' }
}

function RecordFields({ title, device, devices, onTitleChange, onDeviceChange }: Pick<RecordViewProps, 'title' | 'device' | 'devices' | 'onTitleChange' | 'onDeviceChange'>) {
  return (
    <div className="record-fields">
      <label><span>Meeting title</span><input value={title} onChange={(e) => onTitleChange(e.target.value)} placeholder="Sprint planning" /></label>
      <label><span>Audio input</span><select value={device} onChange={(e) => onDeviceChange(Number(e.target.value))}>{devices.map((item) => <option key={item.index} value={item.index}>[{item.index}] {item.name}</option>)}</select></label>
    </div>
  )
}

type StepState = 'complete' | 'current' | 'pending' | 'neutral'

function stepClass(state: StepState): string {
  return state === 'pending' ? '' : state
}

function RecordFlowSteps({ selectedDevice, canStop, recentMeeting }: { selectedDevice: Device | undefined; canStop: boolean; recentMeeting: MeetingListItem | null }) {
  const steps: { label: string; detail: string; state: StepState }[] = [
    { label: 'Choose microphone', detail: selectedDevice ? 'Complete' : 'Current', state: selectedDevice ? 'complete' : 'current' },
    { label: 'Start recording', detail: canStop ? 'Complete' : selectedDevice ? 'Current' : 'Up next', state: canStop ? 'complete' : selectedDevice ? 'current' : 'pending' },
    { label: 'Stop when done', detail: canStop ? 'Current' : 'Up next', state: canStop ? 'current' : 'pending' },
    { label: recentMeeting ? 'Latest meeting below' : 'Processing appears here', detail: recentMeeting ? 'Use card below' : 'After stop', state: 'neutral' },
  ]
  return (
    <ol className="record-flow-steps">
      {steps.map((step, index) => (
        <li key={step.label} className={stepClass(step.state)} aria-current={step.state === 'current' ? 'step' : undefined}>
          <span aria-hidden="true">{index + 1}</span>
          <div className="record-flow-copy"><strong>{step.label}</strong><em>{step.detail}</em></div>
        </li>
      ))}
    </ol>
  )
}

function MeetingStatusCard({ meeting, onOpenMeeting }: { meeting: MeetingListItem | null; onOpenMeeting: (id: string) => void }) {
  if (!meeting) {
    return <div className="record-meeting-card"><strong>Latest meeting</strong><span>After you stop recording, processing and notes appear here.</span></div>
  }
  const progress = meetingProgress(meeting)
  return (
    <div className="record-meeting-card">
      <div className="record-meeting-head">
        <div><span className="label">Latest meeting</span><strong>{meeting.title}</strong></div>
        <div className={`status-pill ${meetingStatusTone(meeting.status.state)}`}>{meetingStatusLabel(meeting.status.state)}</div>
      </div>
      <p>{progress.detail}</p>
      <div className="record-meeting-meta">
        <span>{dateLabel(meeting.startedAt)}</span>
        <span>AI {processingStatusLabel(meeting.status.processing.state)}</span>
        <span>{meeting.hasSummary ? 'Summary ready' : 'Summary pending'}</span>
        <span>{meeting.hasTranscript ? 'Transcript ready' : 'Transcript pending'}</span>
      </div>
      <button className="secondary" onClick={() => onOpenMeeting(meeting.id)}>{progress.cta}</button>
    </div>
  )
}

export function RecordView({ title, device, devices, recordingStatus, recentMeeting, canStart, canStop, onTitleChange, onDeviceChange, onStart, onStop, onOpenMeeting }: RecordViewProps) {
  const status = recordStatus(canStart, canStop, devices, recordingStatus)
  const selectedDevice = devices.find((item) => item.index === device)
  return (
    <section className="panel panel-large">
      <div className="panel-header">
        <div>
          <h1>Record meeting</h1>
          <p>Choose mic, start recording, stop when done. Latest meeting appears below while AI works.</p>
        </div>
        <div className={`status-pill ${status.tone}`}>{status.title}</div>
      </div>
      <div className="record-stack">
        <RecordFlowSteps selectedDevice={selectedDevice} canStop={canStop} recentMeeting={recentMeeting} />
        <div className="record-control-card">
          <div>
            <strong>{status.title}</strong>
            <p className="record-intro">{status.detail}</p>
          </div>
          <RecordFields title={title} device={device} devices={devices} onTitleChange={onTitleChange} onDeviceChange={onDeviceChange} />
          <div className="actions-row">
            <button className="primary" onClick={onStart} disabled={!canStart}>
              Start recording
            </button>
            <button className="secondary" onClick={onStop} disabled={!canStop}>
              Stop and process
            </button>
          </div>
          <div className="record-state-line">
            <span className="label">Recorder</span>
            <strong>{recordingStatus}</strong>
          </div>
        </div>
        <MeetingStatusCard meeting={recentMeeting} onOpenMeeting={onOpenMeeting} />
      </div>
    </section>
  )
}
