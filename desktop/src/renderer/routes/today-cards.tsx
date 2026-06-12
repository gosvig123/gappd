import type { Device, RecordingStatus } from '../../shared/contracts'
import { Button, Field, Panel } from '../components/ui'
import { readyState } from './today-model'

type CaptureCardProps = {
  title: string
  device: number
  devices: Device[]
  recordingStatus: RecordingStatus
  canStart: boolean
  canStop: boolean
  onTitleChange: (value: string) => void
  onDeviceChange: (value: number) => void
  onStart: () => void
  onStop: () => void
}

export function CaptureCard(props: CaptureCardProps) {
  const state = readyState(props.canStart, props.canStop, props.devices, props.recordingStatus)
  return (
    <Panel className="record-action-panel">
      <div className="record-action-bar">
        <div className="record-status-copy">
          <strong>Record meeting</strong>
          <p>{state.detail}</p>
        </div>
        <RecordFields {...props} />
        <div className="actions-row record-actions">
          <Button variant="primary" onClick={props.onStart} disabled={!props.canStart}>Start</Button>
          <Button onClick={props.onStop} disabled={!props.canStop}>Stop and process</Button>
        </div>
      </div>
    </Panel>
  )
}

function RecordFields({ title, device, devices, onTitleChange, onDeviceChange }: Pick<CaptureCardProps, 'title' | 'device' | 'devices' | 'onTitleChange' | 'onDeviceChange'>) {
  return (
    <div className="record-fields">
      <Field label="Meeting title"><input value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Sprint planning" /></Field>
      <Field label="Audio input"><select value={device} onChange={(event) => onDeviceChange(Number(event.target.value))}>{devices.map((item) => <option key={item.index} value={item.index}>{item.name}</option>)}</select></Field>
    </div>
  )
}
