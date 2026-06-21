import type { Device, RecordingStatus } from '../../shared/contracts'
import { Button, Field, Panel } from '../components/ui'
import { readyState } from './today-model'

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
  const state = readyState(props.canStart, props.canStop, props.devices, props.recordingStatus)
  const action = props.canStop ? props.onStop : props.onStart
  const disabled = !props.canStop && !props.canStart
  const label = props.canStop ? 'Stop and process' : 'Start'
  const variant = props.canStop ? 'secondary' : 'primary'
  const buttonClassName = props.canStop ? 'record-toggle-button stop-process-button' : 'record-toggle-button'

  return (
    <Panel className="record-action-panel">
      <div className="record-action-bar">
        <div className="record-status-copy">
          <strong>Record meeting</strong>
          <p>{state.detail}</p>
        </div>
        <RecordFields {...props} />
        <div className="actions-row record-actions">
          <Button className={buttonClassName} variant={variant} onClick={action} disabled={disabled}>{label}</Button>
        </div>
      </div>
    </Panel>
  )
}

function RecordFields({ device, devices, onDeviceChange }: Pick<CaptureCardProps, 'device' | 'devices' | 'onDeviceChange'>) {
  return (
    <div className="record-fields">
      <Field label="Audio input"><select value={device} onChange={(event) => onDeviceChange(Number(event.target.value))}>{devices.map((item) => <option key={item.index} value={item.index}>{item.name}</option>)}</select></Field>
    </div>
  )
}
