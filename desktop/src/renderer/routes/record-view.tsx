type Device = Awaited<ReturnType<typeof window.gappd.system.getDevices>>[number]

type RecordViewProps = {
  title: string
  device: number
  devices: Device[]
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

function RecordHeader({ tone, title, detail }: { tone: string; title: string; detail: string }) {
  return (
    <>
      <div className="record-hero"><div className="record-hero-copy"><div className="record-kicker">Capture</div><div><h1>Record</h1><p>Start and stop meeting recording using the existing gappd backend.</p></div></div><div className={`status-pill ${tone}`}>{title}</div></div>
      <div className="record-callout"><p>{detail}</p></div>
    </>
  )
}

function RecordFields({ title, device, devices, onTitleChange, onDeviceChange }: Pick<RecordViewProps, 'title' | 'device' | 'devices' | 'onTitleChange' | 'onDeviceChange'>) {
  return (
    <div className="form-grid">
      <label><span>Title</span><input value={title} onChange={(e) => onTitleChange(e.target.value)} placeholder="Sprint planning" /></label>
      <label><span>Device</span><select value={device} onChange={(e) => onDeviceChange(Number(e.target.value))}>{devices.map((item) => <option key={item.index} value={item.index}>[{item.index}] {item.name}</option>)}</select></label>
    </div>
  )
}

function RecordRail({ title, selectedDevice, devices }: { title: string; selectedDevice: Device | undefined; devices: Device[] }) {
  return (
    <aside className="record-rail">
      <div className="record-rail-card"><div className="meeting-section-label">Session snapshot</div><div className="record-stats"><div className="record-stat"><span>Input</span><strong>{selectedDevice ? selectedDevice.name : 'No device selected'}</strong></div><div className="record-stat"><span>Fallback title</span><strong>{title.trim() || 'Current date and time'}</strong></div><div className="record-stat"><span>Devices available</span><strong>{devices.length}</strong></div></div></div>
      <div className="record-rail-card"><div className="meeting-section-label">Before you start</div><ul className="record-checklist"><li>Choose the correct system capture device.</li><li>Leave the title blank to use the current timestamp.</li><li>Stop once the meeting ends so processing can finish.</li></ul></div>
    </aside>
  )
}

export function RecordView({ title, device, devices, canStart, canStop, onTitleChange, onDeviceChange, onStart, onStop }: RecordViewProps) {
  const status = recordStatus(canStart, canStop, devices)
  const selectedDevice = devices.find((item) => item.index === device)
  return (
    <section className="panel panel-large">
      <div className="record-shell">
        <div className="record-form">
          <RecordHeader tone={status.tone} title={status.title} detail={status.detail} />
          <RecordFields title={title} device={device} devices={devices} onTitleChange={onTitleChange} onDeviceChange={onDeviceChange} />
          <div className="actions-row">
            <button className="primary" onClick={onStart} disabled={!canStart}>
              Start recording
            </button>
            <button className="secondary" onClick={onStop} disabled={!canStop}>
              Stop recording
            </button>
          </div>
        </div>
        <RecordRail title={title} selectedDevice={selectedDevice} devices={devices} />
      </div>
    </section>
  )
}
