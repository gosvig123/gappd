import { GearIcon, MicIcon, SquareIcon } from '../../components/icons'
import { Button } from '../../components/ui'
import type { PrototypeView } from '../contract'

/**
 * The only Record control in variant B. Keeping it here, and out of the detail
 * pane, means the primary action never competes with reading the Meeting.
 */
export function TopStrip({ view, onOpenSettings }: { view: PrototypeView; onOpenSettings: () => void }) {
  return (
    <header className="vb-top">
      <div className="vb-brand">
        <span className="vb-mark" aria-hidden="true">G</span>
        <div>
          <p className="proto-eyebrow">Gappd</p>
          <p className="vb-wordmark">{view.selectedMeeting ? 'Meeting workspace' : 'Meeting console'}</p>
        </div>
      </div>
      <div className="vb-top-actions">
        <RecordCluster view={view} />
        <Button className="vb-icon-button" aria-label="Settings" title="Settings" onClick={onOpenSettings}><GearIcon aria-hidden="true" /></Button>
      </div>
    </header>
  )
}

function RecordCluster({ view }: { view: PrototypeView }) {
  const active = view.recording.status === 'recording' || view.recording.status === 'stopping'
  const disabled = active ? !view.canStop : !view.canStart
  return (
    <div className={active ? 'vb-record is-active' : 'vb-record'}>
      <label className="vb-device" title="Audio input">
        <MicIcon aria-hidden="true" />
        <select value={view.device} disabled={active} onChange={(event) => view.actions.setDevice(Number(event.target.value))} aria-label="Audio input">
          {view.devices.map((device) => <option key={device.index} value={device.index}>{device.name}</option>)}
        </select>
      </label>
      <button
        type="button"
        className="vb-record-button"
        disabled={disabled}
        title={view.canStart || active ? undefined : 'Connect an audio input to record'}
        onClick={() => (active ? view.actions.stop() : view.actions.start())}
      >
        {active ? <SquareIcon aria-hidden="true" /> : <MicIcon aria-hidden="true" />}
        {view.recording.status === 'stopping' ? 'Stopping…' : active ? 'Stop' : 'Record'}
      </button>
    </div>
  )
}
