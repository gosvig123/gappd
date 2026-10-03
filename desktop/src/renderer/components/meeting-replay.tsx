import { useEffect, useRef, useState } from 'react'
import type { MeetingDetail } from '../../shared/contracts'
import { ChevronDown, ChevronUp, Download, Maximize, Monitor, Pause, Play, RotateCcw, RotateCw } from 'lucide-react'
import { Button } from './ui'
import './meeting-replay.css'

const timestamp = (sec: number) => {
  const total = Math.max(0, Math.floor(sec))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
const url = (id: string, kind: string) => `gappd-media://meeting/${encodeURIComponent(id)}/${kind}`

export function MeetingReplay({ meeting, seekTo, onTimeChange }: { meeting: MeetingDetail; seekTo: { sec: number; request: number } | null; onTimeChange: (sec: number) => void }) {
  const panel = useRef<HTMLElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const mic = useRef<HTMLAudioElement>(null)
  const system = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [error, setError] = useState('')
  const state = meeting.status.video
  const ready = state.state === 'ready' || (state.state === 'ended' && state.endSec !== undefined)
  const videoStart = state.startSec ?? 0
  const videoEnd = state.endSec ?? videoStart
  const duration = Math.max(videoEnd, meeting.endedAt ? (new Date(meeting.endedAt).getTime() - new Date(meeting.startedAt).getTime()) / 1000 : 0)
  const audioOffset = (host: number | undefined) => host === undefined || state.videoStartHostSec === undefined ? null : videoStart + host - state.videoStartHostSec
  const clock = useRef({ time: 0, started: 0, playing: false })

  const move = (sec: number) => {
    const next = Math.max(0, Math.min(duration, sec))
    clock.current.time = next
    if (clock.current.playing) clock.current.started = performance.now()
    setTime(next); onTimeChange(next)
    sync(next)
  }
  const sync = (sec: number) => {
    const movie = video.current
    if (movie) {
      const local = sec - videoStart
      if (local >= 0 && sec < videoEnd) {
        if (Math.abs(movie.currentTime - local) > .25) movie.currentTime = local
        if (clock.current.playing) void movie.play().catch(() => setError('Could not play Screen video.'))
      } else movie.pause()
    }
    for (const [element, offset] of [[mic.current, audioOffset(state.micStartHostSec)], [system.current, audioOffset(state.systemStartHostSec)]] as const) {
      if (!element || offset === null) continue
      const local = sec - offset
      if (local >= 0 && local < element.duration) {
        if (Math.abs(element.currentTime - local) > .25) element.currentTime = local
        if (clock.current.playing) void element.play().catch(() => setError('Could not play Meeting audio.'))
      } else element.pause()
    }
  }
  useEffect(() => {
    if (seekTo === null) return
    setExpanded(true); move(seekTo.sec)
    const frame = requestAnimationFrame(() => panel.current?.scrollIntoView({ block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [seekTo])
  useEffect(() => {
    if (!playing) return
    clock.current.playing = true
    clock.current.started = performance.now()
    sync(clock.current.time)
    const timer = window.setInterval(() => {
      const next = Math.min(duration, clock.current.time + (performance.now() - clock.current.started) / 1000)
      setTime(next); onTimeChange(next)
      sync(next)
      if (next >= duration) setPlaying(false)
    }, 200)
    return () => { window.clearInterval(timer); clock.current.time = Math.min(duration, clock.current.time + (performance.now() - clock.current.started) / 1000); clock.current.playing = false; video.current?.pause(); mic.current?.pause(); system.current?.pause() }
  }, [playing, meeting.id, duration])
  useEffect(() => { setPlaying(false); clock.current = { time: 0, started: 0, playing: false }; setTime(0); setError('') }, [meeting.id])

  const exportVideo = async () => {
    setExporting(true); setExported(false); setError('')
    try { setExported(await window.gappd.meetings.exportRecording(meeting.id)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setExporting(false) }
  }
  const togglePlayback = () => {
    if (!playing && time >= duration) move(0)
    setPlaying(!playing)
  }
  if (state.state === 'off') return null
  const label = ready ? state.state === 'ended' ? 'Screen video ended early' : 'Screen video' : state.state === 'selecting' ? 'Choose what to record' : state.state === 'recording' ? 'Screen video is recording' : state.state === 'cancelled' || state.state === 'skipped' ? 'Audio-only Meeting' : 'Screen video unavailable'
  const note = state.state === 'selecting' ? 'Choose a window or display in the macOS picker. Audio is already recording.' : state.state === 'recording' ? 'Replay will be available after you stop recording.' : state.state === 'cancelled' || state.state === 'skipped' ? 'No screen was selected. Your audio recording was kept.' : 'The screen recording could not be saved. Your audio recording was kept.'
  const gap = time < videoStart || time >= videoEnd
  return <section ref={panel} className="meeting-replay" aria-label="Meeting recording">
    <header className="meeting-replay-head">
      <div><Monitor aria-hidden="true" /><strong>{label}</strong>{ready ? <span>{timestamp(duration)}{state.sourceType === 'window' ? ' · Window' : state.sourceType === 'display' ? ' · Display' : ''}</span> : null}</div>
      {ready ? <button type="button" className="meeting-replay-toggle" aria-label={expanded ? 'Collapse recording' : 'Show recording'} aria-expanded={expanded} onClick={() => { setExpanded(!expanded); setPlaying(false) }}>{expanded ? 'Hide' : 'Watch'}{expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}</button> : null}
    </header>
    {ready ? <div hidden={!expanded}>
      <div className="meeting-replay-stage">
        <video ref={video} src={url(meeting.id, 'video')} preload="metadata" playsInline onLoadedMetadata={() => sync(clock.current.time)} onError={() => setError('Screen video is unavailable. Reopen this Meeting to retry.')} aria-label="Meeting Screen video" />
        {gap ? <div className="meeting-replay-gap"><Monitor aria-hidden="true" /><strong>{time < videoStart ? 'Screen video starts later' : 'Screen video has ended'}</strong><span>{playing ? 'Meeting audio continues.' : 'You can still play the Meeting audio.'}</span>{time < videoStart ? <Button onClick={() => move(videoStart)}>Jump to video · {timestamp(videoStart)}</Button> : null}</div> : null}
      </div>
      {state.micStartHostSec !== undefined ? <audio ref={mic} src={url(meeting.id, 'mic')} preload="metadata" onError={() => setError('Microphone audio is unavailable. Reopen this Meeting to retry.')} /> : null}
      {state.systemStartHostSec !== undefined ? <audio ref={system} src={url(meeting.id, 'system')} preload="metadata" onError={() => setError('System audio is unavailable. Reopen this Meeting to retry.')} /> : null}
      <div className="meeting-replay-transport">
        <input type="range" min={0} max={Math.max(0, duration)} step="0.1" value={time} aria-label="Meeting timeline" aria-valuetext={`${timestamp(time)} of ${timestamp(duration)}`} onChange={event => move(Number(event.target.value))} />
        <div className="meeting-replay-controls">
          <Button className="compact-action" aria-label={playing ? 'Pause recording' : 'Play recording'} onClick={togglePlayback}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{playing ? 'Pause' : 'Play'}</Button>
          <button type="button" className="app-icon-action" aria-label="Back 10 seconds" onClick={() => move(time - 10)}><RotateCcw aria-hidden="true" /></button>
          <button type="button" className="app-icon-action" aria-label="Forward 10 seconds" onClick={() => move(time + 10)}><RotateCw aria-hidden="true" /></button>
          <span className="meeting-replay-time">{timestamp(time)} / {timestamp(duration)}</span>
          <button type="button" className="app-icon-action" aria-label="Full screen recording" onClick={() => { void panel.current?.requestFullscreen().catch(() => setError('Could not open full screen. Try again.')) }}><Maximize aria-hidden="true" /></button>
        </div>
      </div>
      <footer className="meeting-replay-foot"><span>{exported ? 'Recording exported.' : 'Saved on this Mac. Select a transcript time to seek.'}</span>{meeting.status.capture.state === 'captured' ? <Button className="compact-action" disabled={exporting} onClick={() => void exportVideo()}><Download aria-hidden="true" />{exporting ? 'Exporting…' : 'Export recording'}</Button> : null}</footer>
      {state.micStartHostSec === undefined || state.systemStartHostSec === undefined || state.videoStartHostSec === undefined ? <p className="meeting-replay-notice">Some audio timing is missing. Only audio with known timing can play in sync.</p> : null}
    </div> : <p className="meeting-replay-notice">{note}</p>}
    {state.message ? <details className="meeting-replay-notice"><summary>Recording details</summary>{state.message}</details> : null}
    {error ? <p className="meeting-replay-notice" role="alert">{error}</p> : null}
  </section>
}
