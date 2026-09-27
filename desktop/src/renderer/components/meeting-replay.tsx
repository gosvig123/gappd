import { useEffect, useRef, useState } from 'react'
import type { MeetingDetail } from '../../shared/contracts'

const url = (id: string, kind: string) => `gappd-media://meeting/${encodeURIComponent(id)}/${kind}`

export function MeetingReplay({ meeting, seekTo, onTimeChange }: { meeting: MeetingDetail; seekTo: { sec: number; request: number } | null; onTimeChange: (sec: number) => void }) {
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
  useEffect(() => { if (seekTo !== null) move(seekTo.sec) }, [seekTo])
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

  const label = state.state === 'off' ? 'Off' : state.state === 'selecting' ? 'Choose a window or display in the macOS picker' : state.state === 'recording' ? 'Recording' : state.state === 'ready' ? 'Saved' : state.state === 'ended' ? 'Ended early' : state.state === 'cancelled' ? 'Selection cancelled · audio only' : state.state === 'skipped' ? 'Skipped · audio only' : state.state === 'unfinished' ? 'Not finalized' : 'Failed · audio only'
  return <section className="meeting-replay" aria-label="Screen video">
    <p aria-live="polite"><strong>Screen video: {label}</strong>{state.sourceType ? ` · ${state.sourceType}` : ''}{state.message ? ` · ${state.message}` : ''}</p>
    {ready ? <>
      <video ref={video} src={url(meeting.id, 'video')} preload="metadata" playsInline onError={() => setError('Screen video is unavailable.')} aria-label="Meeting Screen video" />
      <audio ref={mic} src={url(meeting.id, 'mic')} preload="metadata" onError={() => setError('Microphone audio is unavailable.')} />
      <audio ref={system} src={url(meeting.id, 'system')} preload="metadata" onError={() => setError('System audio is unavailable.')} />
      <div className="meeting-replay-controls"><button type="button" onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'} recording</button><input type="range" min={0} max={Math.max(0, duration)} step="0.1" value={time} aria-label="Meeting timeline" onChange={event => move(Number(event.target.value))} /><span>{Math.floor(time)} / {Math.ceil(duration)} s</span></div>
      {state.micStartHostSec === undefined || state.systemStartHostSec === undefined || state.videoStartHostSec === undefined ? <p>One or more audio start times are unavailable. Playback cannot align that voice.</p> : null}
      {(videoStart > 0 && time < videoStart || time >= videoEnd && time < duration) ? <p>Screen video gap · Meeting audio continues.</p> : null}
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>
}
