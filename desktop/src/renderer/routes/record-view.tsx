type Device = Awaited<ReturnType<typeof window.gappd.system.getDevices>>[number]

type RecordViewProps = {
  title: string
  device: number
  devices: Device[]
  recordingStatus: string
  canStart: boolean
  canStop: boolean
  onTitleChange: (value: string) => void
  onDeviceChange: (value: number) => void
  onStart: () => void
  onStop: () => void
}

function recordStatus(canStart: boolean, canStop: boolean, devices: Device[]): { tone: string; title: string; detail: string } {
  if (canStop) return { tone: 'recording', title: 'Recording live', detail: 'Capture is active or finishing processing.' }
  if (!devices.length) return { tone: 'error', title: 'No input device', detail: 'Connect or enable an audio capture device before recording.' }
  if (canStart) return { tone: 'idle', title: 'Ready to record', detail: 'Review the title and input source, then start capture.' }
  return { tone: 'processing', title: 'Recorder busy', detail: 'Finish the current handoff before starting another session.' }
}

function RecordFields({ title, device, devices, onTitleChange, onDeviceChange }: Pick<RecordViewProps, 'title' | 'device' | 'devices' | 'onTitleChange' | 'onDeviceChange'>) {
  return (
    <div className="record-fields">
      <label><span>Meeting title</span><input value={title} onChange={(e) => onTitleChange(e.target.value)} placeholder="Sprint planning" /></label>
      <label><span>Audio input</span><select value={device} onChange={(e) => onDeviceChange(Number(e.target.value))}>{devices.map((item) => <option key={item.index} value={item.index}>[{item.index}] {item.name}</option>)}</select></label>
    </div>
  )
}

function RecordSummary({ title, selectedDevice, devices }: { title: string; selectedDevice: Device | undefined; devices: Device[] }) {
  return (
    <div className="record-summary">
      <div className="record-stat"><span>Input</span><strong>{selectedDevice ? selectedDevice.name : 'No device selected'}</strong></div>
      <div className="record-stat"><span>Fallback title</span><strong>{title.trim() || 'Current date and time'}</strong></div>
      <div className="record-stat"><span>Devices</span><strong>{devices.length}</strong></div>
    </div>
  )
}

export function RecordView({ title, device, devices, recordingStatus, canStart, canStop, onTitleChange, onDeviceChange, onStart, onStop }: RecordViewProps) {
  const status = recordStatus(canStart, canStop, devices)
  const selectedDevice = devices.find((item) => item.index === device)
  return (
    <section className="panel panel-large">
      <div className="panel-header">
        <div>
          <h1>Record</h1>
          <p>Start and stop meeting capture with the current local setup.</p>
        </div>
        <div className={`status-pill ${status.tone}`}>{status.title}</div>
      </div>
      <div className="record-stack">
        <p className="record-intro">{status.detail}</p>
        <RecordFields title={title} device={device} devices={devices} onTitleChange={onTitleChange} onDeviceChange={onDeviceChange} />
        <div className="actions-row">
          <button className="primary" onClick={onStart} disabled={!canStart}>
            Start recording
          </button>
          <button className="secondary" onClick={onStop} disabled={!canStop}>
            Stop recording
          </button>
        </div>
        <div className="record-state-line">
          <span className="label">Status</span>
          <strong>{recordingStatus}</strong>
        </div>
        <RecordSummary title={title} selectedDevice={selectedDevice} devices={devices} />
      </div>
    </section>
  )
}
