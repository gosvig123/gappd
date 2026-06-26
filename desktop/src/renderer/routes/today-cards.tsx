import type { Device, RecordingStatus } from '../../shared/contracts'
import { Button, Field, Panel } from '../components/ui'
import { readyState } from './today-model'

const RECORDING_STOPPING: RecordingStatus = 'stopping'
const RECORDING_PROCESSING: RecordingStatus = 'processing'

type CaptureCardProps = {
  device: number
  devices: Device[]
  recordingStatus: RecordingStatus
  canStart: boolean
  canStop: boolean
  onDeviceChange: (value: number) => void
  onStart: () => void
  onStop: () => void
}

export function CaptureCard(props: CaptureCardProps) {
  const state = readyState(props.canStart, props.devices, props.recordingStatus)
  const action = captureAction(props)
  return (
    <Panel className="record-action-panel">
      <div className="record-action-bar">
        <div className="record-status-copy record-section"><strong>Record meeting</strong><p>{state.detail}</p></div>
        <div className="record-controls record-section">
          <RecordFields {...props} />
          <div className="actions-row record-actions"><Button className={action.className} variant={action.variant} onClick={action.onClick} disabled={action.disabled}>{action.label}</Button></div>
        </div>
      </div>
    </Panel>
  )
}

function captureAction(props: CaptureCardProps) {
  if (props.recordingStatus === RECORDING_STOPPING) return disabledAction('Stopping…', props.onStop)
  if (props.recordingStatus === RECORDING_PROCESSING) return disabledAction('Processing…', props.onStop)
  return {
    className: props.canStop ? 'record-toggle-button stop-process-button' : 'record-toggle-button',
    disabled: !props.canStop && !props.canStart,
    label: props.canStop ? 'Stop and process' : 'Start',
    onClick: props.canStop ? props.onStop : props.onStart,
    variant: props.canStop ? ('secondary' as const) : ('primary' as const),
  }
}

function disabledAction(label: string, onClick: () => void) {
  return { className: 'record-toggle-button', disabled: true, label, onClick, variant: 'secondary' as const }
}

function RecordFields({ device, devices, onDeviceChange }: Pick<CaptureCardProps, 'device' | 'devices' | 'onDeviceChange'>) {
  return (
    <div className="record-fields">
      <Field label="Audio input"><select value={device} onChange={(event) => onDeviceChange(Number(event.target.value))}>{devices.map((item) => <option key={item.index} value={item.index}>{item.name}</option>)}</select></Field>
    </div>
  )
}
