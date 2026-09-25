import { useEffect, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import type { AppView } from '../lib/app-view'
import { cx } from './ui'

/**
 * Recording is app chrome, so it sits in the main toolbar rather than floating
 * over the content: device on the left, action on the right, and no second
 * status block in between. The action label carries the live elapsed time.
 */
export function RecordBar({ view }: { view: AppView }) {
  const live = view.recording.status === 'recording'
  const stopping = view.recording.status === 'stopping'
  const elapsed = useElapsed(live ? startedAtOf(view) : null)
  const disabled = stopping || (live ? !view.canStop : !view.canStart)
  return (
    <div className="app-toolbar">
      <div className={cx('app-record', live && 'is-recording')}>
        <label className="app-record-device" title="Audio input">
          <Mic aria-hidden="true" />
          <select value={view.device} onChange={(event) => view.actions.setDevice(Number(event.target.value))} disabled={stopping} aria-label="Audio input">
            {view.devices.map((device) => <option key={device.index} value={device.index}>{device.name}</option>)}
          </select>
        </label>
        <button
          type="button"
          className={cx('app-record-button', live && 'is-recording')}
          disabled={disabled}
          title={view.canStart || live ? undefined : 'Connect an audio input to record'}
          onClick={() => (live || stopping ? view.actions.stop() : view.actions.start())}
        >
          {live || stopping ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
          {stopping ? 'Stopping…' : live ? `Stop · ${elapsed}` : 'Record'}
        </button>
      </div>
    </div>
  )
}

function startedAtOf(view: AppView): string | null {
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
