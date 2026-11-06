import { useEffect, useState } from 'react'
import { ChevronDown, Mic, Monitor, MonitorOff, Square } from 'lucide-react'
import { TRANSCRIPTION_LANGUAGES } from '../../shared/transcription-languages'
import type { AppView } from '../lib/app-view'
import { cx } from './ui'

/**
 * Recording is app chrome, so it sits in the main toolbar rather than floating
 * over the content. The chips show icons and short codes; each one keeps a
 * native select laid over it, so the full names appear in the macOS menu and in
 * the tooltip. Choose audio and Screen video before starting; the action label
 * carries the live elapsed time. The language applies to the next
 * Meeting and is remembered; it is locked while recording because the Live
 * Transcript cannot change language mid-run.
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
  const speech = useSpeechLanguage(view.language)
  const language = TRANSCRIPTION_LANGUAGES.find((item) => item.code === view.language)
  const deviceName = view.devices.find((device) => device.index === view.device)?.name ?? 'none'
  const chooseLanguage = (language: string) => { view.actions.setLanguage(language); speech.prepare(language) }
  const disabled = saving || stopping || (live ? !view.canStop : !view.canStart)
  const video = view.meetings.find(meeting => meeting.id === view.recording.meetingId)?.status.video
  return (
    <div className="app-toolbar">
      <div className={cx('app-record', live && 'is-recording')}>
        <label className="app-record-chip" title={`Audio input: ${deviceName}`}>
          <Mic aria-hidden="true" />
          <ChevronDown className="app-record-caret" aria-hidden="true" />
          <select value={view.device} onChange={(event) => view.actions.setDevice(Number(event.target.value))} disabled={stopping} aria-label="Audio input">
            {view.devices.map((device) => <option key={device.index} value={device.index}>{device.name}</option>)}
          </select>
        </label>
        <label className="app-record-chip" title={live || stopping ? `Meeting language: ${language?.label ?? view.language}` : `Meeting language: ${language?.label ?? view.language}. Used for the transcript and notes.`}>
          <span className="app-record-code">{language?.short ?? view.language}</span>
          {live || stopping ? null : <ChevronDown className="app-record-caret" aria-hidden="true" />}
          <select value={view.language} onChange={(event) => chooseLanguage(event.target.value)} disabled={live || stopping} aria-label="Meeting language">
            {TRANSCRIPTION_LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
        </label>
        {!live && !stopping ? <button type="button" className="app-record-chip app-record-video" aria-label="Screen video" aria-pressed={videoEnabled ?? false} disabled={videoEnabled === null || saving || !view.canStart} onClick={() => void toggleVideo()} title={videoEnabled ? 'Screen video is on. You choose a window or display when you record.' : 'Screen video is off. Click to also record a window or display.'}>{videoEnabled ? <Monitor aria-hidden="true" /> : <MonitorOff aria-hidden="true" />}</button> : null}
        <button
          type="button"
          className={cx('app-record-button', live && 'is-recording')}
          disabled={disabled}
          title={view.canStart || live ? undefined : 'Connect an audio input to record'}
          onClick={() => (live || stopping ? view.actions.stop() : view.actions.start())}
        >
          {live || stopping ? <Square aria-hidden="true" /> : <span className="app-record-dot" aria-hidden="true" />}
          {stopping ? 'Stopping…' : live ? `Stop · ${elapsed}` : 'Record'}
        </button>
      </div>
      <div className="app-record-hint" role="status">
        {error || (live || stopping ? video?.state === 'selecting' ? 'Choose a window or display in the macOS picker. Audio is recording.' : video?.state === 'recording' ? `Recording ${video.sourceType === 'window' ? 'window' : video.sourceType === 'display' ? 'display' : 'screen'} and audio` : video?.state === 'ended' ? 'Screen video ended. Audio continues.' : video && ['failed', 'cancelled', 'skipped'].includes(video.state) ? 'Audio only. Screen video did not start.' : stopping ? 'Saving your recording…' : 'Recording audio' : speech.note)}
      </div>
    </div>
  )
}

/** Downloads the Apple speech model when the user picks a language, so the Live Transcript does not wait for it. */
function useSpeechLanguage(language: string) {
  const [state, setState] = useState<{ language: string; note: string } | null>(null)
  const prepare = (next: string) => {
    const label = TRANSCRIPTION_LANGUAGES.find((item) => item.code === next)?.label ?? next
    setState({ language: next, note: `Getting the ${label} speech model ready…` })
    window.gappd.recording.prepareLanguage(next)
      .then((status) => setState((current) => current?.language !== next ? current : status.ready ? null : { language: next, note: status.message ?? '' }))
      .catch(() => setState((current) => current?.language !== next ? current : null))
  }
  return { prepare, note: state?.language === language ? state.note || null : null }
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
