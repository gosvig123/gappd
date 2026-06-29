import type { Device, RecordingStatus } from '../../shared/contracts'
import { ChevronDownIcon, MicIcon, SquareIcon } from '../components/icons'
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
          <MicIcon className="record-input-icon" aria-hidden="true" />
          <select className="record-input-select" value={props.device} onChange={(event) => props.onDeviceChange(Number(event.target.value))} disabled={action.recording} aria-label="Audio input">
            {props.devices.map((item) => <option key={item.index} value={item.index}>{item.name}</option>)}
          </select>
          <ChevronDownIcon className="record-input-caret" aria-hidden="true" />
        </label>
      ) : null}
      <button className="record-button" onClick={action.onClick} disabled={action.disabled} title={action.title} aria-label={action.label}>
        {action.recording ? <SquareIcon className="record-button-icon" aria-hidden="true" /> : <MicIcon className="record-button-icon" aria-hidden="true" />}
        {action.label}
      </button>
    </div>
  )
}

function recordAction(props: RecordControlsProps): RecordAction {
  if (props.recordingStatus === RECORDING_STOPPING) return { label: 'Stopping…', recording: true, disabled: true, onClick: props.onStop }
  if (props.recordingStatus === RECORDING_PROCESSING) return { label: 'Processing…', recording: true, disabled: true, onClick: props.onStop }
  if (props.canStop) return { label: 'Stop', recording: true, disabled: false, onClick: props.onStop }
  return { label: 'Record', recording: false, disabled: !props.canStart, title: props.canStart ? undefined : 'Connect an audio input to record', onClick: props.onStart }
}
