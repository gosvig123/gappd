import type { Device, RecordingStatus } from '../../shared/contracts'
import { cx } from '../components/ui'

const RECORDING_STOPPING: RecordingStatus = 'stopping'
const RECORDING_PROCESSING: RecordingStatus = 'processing'

type RecordControlsProps = {
  device: number
  devices: Device[]
  recordingStatus: RecordingStatus
  canStart: boolean
  canStop: boolean
  onDeviceChange: (value: number) => void
  onStart: () => void
  onStop: () => void
}

type RecordAction = { label: string; recording: boolean; disabled: boolean; title?: string; onClick: () => void }

export function RecordControls(props: RecordControlsProps) {
  const action = recordAction(props)
  return (
    <div className={cx('record-cluster', action.recording && 'is-recording')}>
      {props.devices.length > 0 ? (
        <label className="record-input" title="Audio input">
          <MicIcon />
          <select className="record-input-select" value={props.device} onChange={(event) => props.onDeviceChange(Number(event.target.value))} disabled={action.recording} aria-label="Audio input">
            {props.devices.map((item) => <option key={item.index} value={item.index}>{item.name}</option>)}
          </select>
          <CaretIcon />
        </label>
      ) : null}
      <button className="record-button" onClick={action.onClick} disabled={action.disabled} title={action.title} aria-label={action.label}>
        <span className={cx('record-glyph', action.recording && 'is-stop')} aria-hidden="true" />
        {action.label}
      </button>
    </div>
  )
}

function MicIcon() {
  return (
    <svg className="record-input-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <path d="M12 18v4" />
    </svg>
  )
}

function CaretIcon() {
  return (
    <svg className="record-input-caret" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

function recordAction(props: RecordControlsProps): RecordAction {
  if (props.recordingStatus === RECORDING_STOPPING) return { label: 'Stopping…', recording: true, disabled: true, onClick: props.onStop }
  if (props.recordingStatus === RECORDING_PROCESSING) return { label: 'Processing…', recording: true, disabled: true, onClick: props.onStop }
  if (props.canStop) return { label: 'Stop', recording: true, disabled: false, onClick: props.onStop }
  return { label: 'Record', recording: false, disabled: !props.canStart, title: props.canStart ? undefined : 'Connect an audio input to record', onClick: props.onStart }
}
