import { useEffect, useState } from 'react'
import { Bell, Mic, Square, X } from 'lucide-react'
import { Button, cx } from '../../components/ui'
import type { AlertItem, PrototypeView } from '../contract'

/** The record dock follows the user across every section, so recording is never buried in a page. */
export function DeckDock({ view }: { view: PrototypeView }) {
  const live = view.recording.status === 'recording'
  const stopping = view.recording.status === 'stopping'
  const elapsed = useElapsed(live ? startedAtOf(view) : null)
  const label = stopping ? 'Stopping…' : live ? 'Stop' : 'Record'
  const disabled = stopping || (live ? !view.canStop : !view.canStart)
  return (
    <div className={cx('vc-dock', live && 'is-recording')} role="region" aria-label="Recording controls">
      <label className="vc-dock-device" title="Audio input">
        <Mic aria-hidden="true" />
        <select value={view.device} onChange={(event) => view.actions.setDevice(Number(event.target.value))} disabled={stopping} aria-label="Audio input">
          {view.devices.map((device) => <option key={device.index} value={device.index}>{device.name}</option>)}
        </select>
      </label>
      <div className="vc-dock-state">
        <strong>{stopping ? 'Finishing up' : live ? `Recording · ${elapsed}` : 'Ready to record'}</strong>
        <span>{live ? view.recording.title || 'New meeting' : 'Audio stays on this Mac'}</span>
      </div>
      <button type="button" className={cx('vc-dock-button', live && 'is-recording')} disabled={disabled} title={view.canStart || live ? undefined : 'Connect an audio input to record'} onClick={() => (live || stopping ? view.actions.stop() : view.actions.start())}>
        {live || stopping ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
        {label}
      </button>
    </div>
  )
}

/** Transient problems stay transient: they land in this corner stack, not in a banner. */
export function DeckToasts({ alerts, onDismiss }: { alerts: AlertItem[]; onDismiss: (id: string) => void }) {
  if (!alerts.length) return null
  return (
    <div className="vc-toasts" role="region" aria-label="Notifications" aria-live="polite">
      {alerts.slice(0, 3).map((alert) => (
        <div key={alert.id} className={cx('vc-toast', alert.kind)} role="status">
          <Bell aria-hidden="true" />
          <div className="vc-toast-copy">
            <strong>{alert.title}</strong>
            {alert.detail ? <p>{alert.detail}</p> : null}
            {alert.actionLabel && alert.run ? <div className="vc-toast-action"><Button className="compact-action" onClick={alert.run}>{alert.actionLabel}</Button></div> : null}
          </div>
          <button type="button" className="vc-icon-action" aria-label={`Dismiss ${alert.title}`} onClick={() => onDismiss(alert.id)}><X aria-hidden="true" /></button>
        </div>
      ))}
    </div>
  )
}

function startedAtOf(view: PrototypeView): string | null {
  const id = view.recording.meetingId
  if (!id) return null
  return view.meetings.find((meeting) => meeting.id === id)?.startedAt ?? null
}

function useElapsed(startedAt: string | null): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!startedAt) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])
  if (!startedAt) return '0:00'
  return formatElapsed(Math.max(0, now - new Date(startedAt).getTime()))
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}
