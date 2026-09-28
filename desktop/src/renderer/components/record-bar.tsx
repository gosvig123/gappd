import { useEffect, useState } from 'react'
import { Mic, Monitor, Square } from 'lucide-react'
import type { AppView } from '../lib/app-view'
import { cx } from './ui'

/**
 * Recording is app chrome, so it sits in the main toolbar rather than floating
 * over the content. Choose audio and Screen video before starting; the action
 * label carries the live elapsed time.
 */
export function RecordBar({ view }: { view: AppView }) {
  const live = view.recording.status === 'recording'
  const stopping = view.recording.status === 'stopping'
  const elapsed = useElapsed(live ? startedAtOf(view) : null)
  const [videoEnabled, setVideoEnabled] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    window.gappd.startup.getSettings().then(settings => { if (active) setVideoEnabled(settings.screenVideoEnabled) }).catch(() => { if (active) setError('Could not load Screen video. Reopen Meetings to retry.') })
    return () => { active = false }
  }, [])
  const toggleVideo = async () => {
    setSaving(true); setError('')
    try { setVideoEnabled((await window.gappd.startup.setScreenVideoEnabled(!videoEnabled)).screenVideoEnabled) }
    catch { setError('Could not change Screen video. Try again before recording.') }
    finally { setSaving(false) }
  }
  const disabled = saving || stopping || (live ? !view.canStop : !view.canStart)
  const video = view.meetings.find(meeting => meeting.id === view.recording.meetingId)?.status.video
  return (
    <div className="app-toolbar">
      <div className={cx('app-record', live && 'is-recording')}>
        <label className="app-record-device" title="Audio input">
          <Mic aria-hidden="true" />
          <select value={view.device} onChange={(event) => view.actions.setDevice(Number(event.target.value))} disabled={stopping} aria-label="Audio input">
            {view.devices.map((device) => <option key={device.index} value={device.index}>{device.name}</option>)}
          </select>
        </label>
        {!live && !stopping ? <button type="button" className="app-record-video" aria-pressed={videoEnabled ?? false} disabled={videoEnabled === null || saving || !view.canStart} onClick={() => void toggleVideo()} title="Remember this choice for future Meetings. Choose a window or display each time you record."><Monitor aria-hidden="true" />Screen video: {videoEnabled ? 'On' : 'Off'}</button> : null}
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
      <div className="app-record-hint" role="status">
        {error || (live || stopping ? video?.state === 'selecting' ? 'Choose a window or display in the macOS picker. Audio is recording.' : video?.state === 'recording' ? `Recording ${video.sourceType === 'window' ? 'window' : video.sourceType === 'display' ? 'display' : 'screen'} and audio` : video?.state === 'ended' ? 'Screen video ended. Audio continues.' : video && ['failed', 'cancelled', 'skipped'].includes(video.state) ? 'Audio only. Screen video did not start.' : stopping ? 'Saving your recording…' : 'Recording audio' : videoEnabled ? 'Choose a window or display when recording starts.' : 'Audio only. Turn on Screen video to include a window or display.')}
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
