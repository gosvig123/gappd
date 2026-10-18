import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import type { MeetingDetail, MeetingSegment } from '../../../shared/contracts'
import { Captions, Download, Info, Maximize, Minimize, Monitor, Pause, Play, RotateCcw, RotateCw, TriangleAlert } from 'lucide-react'
import { Button } from '../ui'
import { speakerStyle } from './transcript'
import './replay.css'

const timestamp = (sec: number) => {
  const total = Math.max(0, Math.floor(sec))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
const url = (id: string, kind: string) => `gappd-media://meeting/${encodeURIComponent(id)}/${kind}`
const speakerKey = (segment: MeetingSegment) => segment.speakerKey || segment.speaker

/** A Screen video that can play: ready, or ended early with a known end. */
export function replayReady(meeting: MeetingDetail): boolean {
  const video = meeting.status.video
  return video.state === 'ready' || (video.state === 'ended' && video.endSec !== undefined)
}

/** Why a Meeting with Screen video turned on has no replay: still choosing, still recording, skipped, or failed. */
export function ReplayNote({ meeting }: { meeting: MeetingDetail }) {
  const state = meeting.status.video
  if (state.state === 'off' || replayReady(meeting)) return null
  const label = state.state === 'selecting' ? 'Choose what to record' : state.state === 'recording' ? 'Screen video is recording' : state.state === 'cancelled' || state.state === 'skipped' ? 'Audio-only Meeting' : 'Screen video unavailable'
  const note = state.state === 'selecting' ? 'Choose a window or display in the macOS picker. Audio is already recording.' : state.state === 'recording' ? 'Replay will be available after you stop recording.' : state.state === 'cancelled' || state.state === 'skipped' ? 'No screen was selected. Your audio recording was kept.' : 'The screen recording could not be saved. Your audio recording was kept.'
  return <section className="meeting-replay-note" aria-label="Meeting recording">
    <Monitor aria-hidden="true" /><div><strong>{label}</strong><p>{note}</p>{state.message ? <details><summary>Recording details</summary>{state.message}</details> : null}</div>
  </section>
}

/** The Recording tab: Screen video and controls beside a column that shows the transcript, following playback, or the people. */
export function MeetingReplay({ meeting, seekTo, startSec, onTimeChange, people, children }: { meeting: MeetingDetail; seekTo: { sec: number; request: number } | null; startSec: number; onTimeChange: (sec: number) => void; people: ReactNode; children: ReactNode }) {
  const player = useRef<HTMLDivElement>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [ratio, setRatio] = useState(16 / 10)
  const [follow, setFollow] = useState(true)
  const [column, setColumn] = useState<'transcript' | 'people'>('transcript')
  const peopleList = useRef<HTMLDivElement>(null)
  const notesId = useId()
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const mic = useRef<HTMLAudioElement>(null)
  const system = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(startSec)
  const [error, setError] = useState('')
  const state = meeting.status.video
  const videoStart = state.startSec ?? 0
  const videoEnd = state.endSec ?? videoStart
  const duration = Math.max(videoEnd, meeting.endedAt ? (new Date(meeting.endedAt).getTime() - new Date(meeting.startedAt).getTime()) / 1000 : 0)
  const audioOffset = (host: number | undefined) => host === undefined || state.videoStartHostSec === undefined ? null : videoStart + host - state.videoStartHostSec
  const clock = useRef({ time: startSec, started: 0, playing: false })
  // Scroll events before this time come from following playback; any other scroll is the person reading.
  const followScrollUntil = useRef(0)
  const segments = meeting.segments ?? []
  const current = segments.reduce((last, segment, index) => segment.startSec <= time ? index : last, -1)
  const speaking = current >= 0 ? segments[current] : null

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
    setFollow(true); move(seekTo.sec)
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
  // The people list is the speaker-labels disclosure: opening it, also from a speaker name in the transcript, shows the People column.
  useEffect(() => {
    const list = peopleList.current
    if (!list) return
    // Render the switch now, so a speaker-name click can move to that speaker's row in the same frame.
    const toggle = (event: Event) => { if (event.target instanceof HTMLDetailsElement && event.target.open) flushSync(() => setColumn('people')) }
    list.addEventListener('toggle', toggle, true)
    return () => list.removeEventListener('toggle', toggle, true)
  }, [])
  const showColumn = (next: 'transcript' | 'people') => {
    const labels = peopleList.current?.querySelector('details')
    if (labels) labels.open = next === 'people'
    setColumn(next)
  }
  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement !== null && document.fullscreenElement === player.current)
    document.addEventListener('fullscreenchange', change)
    return () => document.removeEventListener('fullscreenchange', change)
  }, [])
  // Keep the turn that is playing in view, a third of the way down, until the person scrolls the transcript.
  useEffect(() => {
    const list = transcript.current
    const turn = list?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!follow || !list || !turn) return
    const offset = turn.getBoundingClientRect().top - list.getBoundingClientRect().top
    if (offset >= list.clientHeight * .15 && offset <= list.clientHeight * .7) return
    followScrollUntil.current = performance.now() + 1500
    list.scrollTo({ top: list.scrollTop + offset - list.clientHeight / 3, behavior: 'smooth' })
  }, [current, follow])

  const exportVideo = async () => {
    setExporting(true); setExported(false); setError('')
    try { setExported(await window.gappd.meetings.exportRecording(meeting.id)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setExporting(false) }
  }
  const toggleFullscreen = () => {
    const request = fullscreen ? document.exitFullscreen() : player.current?.requestFullscreen()
    void request?.catch(() => setError(fullscreen ? 'Could not leave full screen. Press Escape.' : 'Could not open full screen. Try again.'))
  }
  const togglePlayback = () => {
    if (!playing && time >= duration) move(0)
    setPlaying(!playing)
  }
  const percent = (sec: number) => `${duration ? (sec / duration) * 100 : 0}%`
  const before = time < videoStart
  const gap = before || time >= videoEnd
  const turns = segments.filter((segment, index) => index === 0 || speakerKey(segments[index - 1]) !== speakerKey(segment))
  const timingMissing = state.micStartHostSec === undefined || state.systemStartHostSec === undefined || state.videoStartHostSec === undefined
  const speakers = meeting.speakers ?? []
  const suggestions = speakers.filter(speaker => !speaker.personId && speaker.suggestedPersonId).length
  return <section className="meeting-review" aria-label="Meeting recording">
    <div className="meeting-review-grid">
      <div ref={player} className="meeting-review-player">
        <div className="meeting-review-stage">
          <div className="meeting-replay-frame" style={{ '--replay-ratio': ratio } as CSSProperties}>
            <video ref={video} src={url(meeting.id, 'video')} preload="metadata" playsInline onLoadedMetadata={event => { const { videoWidth, videoHeight } = event.currentTarget; if (videoWidth && videoHeight) setRatio(videoWidth / videoHeight); sync(clock.current.time) }} onError={() => setError('Screen video is unavailable. Reopen this Meeting to retry.')} aria-label="Meeting Screen video" />
            {gap ? <div className="meeting-replay-gap">
              <span className="meeting-replay-gap-tag"><Captions aria-hidden="true" />{before ? `Screen video starts at ${timestamp(videoStart)}` : `Screen video ended at ${timestamp(videoEnd)}`}{playing ? ' · Meeting audio continues' : ''}</span>
              {speaking ? <>
                {current > 0 ? <p className="meeting-replay-gap-previous">{segments[current - 1].text}</p> : null}
                <span className="meeting-replay-gap-speaker" style={speakerStyle(speakerKey(speaking))}>{speaking.speaker || 'Meeting audio'}</span>
                <p className="meeting-replay-gap-line">{speaking.text}</p>
              </> : <p className="meeting-replay-gap-line">{playing ? 'Meeting audio continues.' : 'You can still play the Meeting audio.'}</p>}
              {before ? <Button className="compact-action" onClick={() => move(videoStart)}>Jump to video · {timestamp(videoStart)}</Button> : null}
            </div> : null}
          </div>
        </div>
        {state.micStartHostSec !== undefined ? <audio ref={mic} src={url(meeting.id, 'mic')} preload="metadata" onError={() => setError('Microphone audio is unavailable. Reopen this Meeting to retry.')} /> : null}
        {state.systemStartHostSec !== undefined ? <audio ref={system} src={url(meeting.id, 'system')} preload="metadata" onError={() => setError('System audio is unavailable. Reopen this Meeting to retry.')} /> : null}
        <div className="meeting-review-scrub" style={{ '--replay-progress': percent(time) } as CSSProperties}>
          <span className="meeting-review-coverage" style={{ left: percent(videoStart), width: percent(videoEnd - videoStart) }} title={`Screen video ${timestamp(videoStart)}–${timestamp(videoEnd)}`} />
          {turns.map(turn => <span key={turn.id || turn.startSec} className="meeting-review-tick" style={{ ...speakerStyle(speakerKey(turn)), left: percent(turn.startSec) }} />)}
          <input type="range" min={0} max={Math.max(0, duration)} step="0.1" value={time} aria-label="Meeting timeline" aria-valuetext={`${timestamp(time)} of ${timestamp(duration)}`} onChange={event => move(Number(event.target.value))} />
        </div>
        <div className="meeting-review-controls">
          <button type="button" className="meeting-review-play" aria-label={playing ? 'Pause recording' : 'Play recording'} onClick={togglePlayback}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
          <button type="button" className="meeting-review-icon" aria-label="Back 10 seconds" onClick={() => move(time - 10)}><RotateCcw aria-hidden="true" /></button>
          <button type="button" className="meeting-review-icon" aria-label="Forward 10 seconds" onClick={() => move(time + 10)}><RotateCw aria-hidden="true" /></button>
          <span className="meeting-review-time">{timestamp(time)} / {timestamp(duration)}</span>
          {speaking?.speaker ? <span className="meeting-review-speaking" style={speakerStyle(speakerKey(speaking))}><span className="transcript-chip-dot" aria-hidden="true" /><span>{speaking.speaker}</span></span> : null}
          {timingMissing || state.message ? <>
            <button type="button" className={`meeting-review-icon meeting-review-notes-button${timingMissing ? ' is-warning' : ''}`} popoverTarget={notesId} aria-label="Recording notes" title="Recording notes">{timingMissing ? <TriangleAlert aria-hidden="true" /> : <Info aria-hidden="true" />}</button>
            <div id={notesId} popover="auto" className="meeting-review-popover">
              {timingMissing ? <p>Audio without timing information does not play.</p> : null}
              {state.message ? <p><strong>Recording details</strong>{state.message}</p> : null}
            </div>
          </> : null}
          <button type="button" className="meeting-review-icon" aria-label={fullscreen ? 'Exit full screen' : 'Full screen recording'} title={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen}>{fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}</button>
          {meeting.status.capture.state === 'captured' ? <button type="button" className="meeting-review-icon" aria-label="Export recording" title="Export recording" disabled={exporting} onClick={() => void exportVideo()}><Download aria-hidden="true" /></button> : null}
        </div>
      </div>
      <div className="meeting-review-notes">
        {exporting ? <p>Exporting recording…</p> : exported ? <p>Recording exported.</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </div>
      <div className="meeting-review-transcript">
        <header>
          <div className="meeting-review-columns">
            <button type="button" aria-pressed={column === 'transcript'} onClick={() => showColumn('transcript')}>Transcript</button>
            {speakers.length ? <button type="button" aria-pressed={column === 'people'} onClick={() => showColumn('people')}>People <span>{suggestions ? `${suggestions} to check` : speakers.length}</span></button> : null}
          </div>
          {column === 'transcript' ? <button type="button" role="switch" aria-checked={follow} aria-label="Follow playback" title="Follow playback" className="meeting-review-follow" onClick={() => setFollow(!follow)}><span aria-hidden="true" /><span className="meeting-review-follow-label">Follow<span> playback</span></span></button> : null}
        </header>
        {/* Both views stay laid out in one place; the inactive one is inert, so the transcript keeps its scroll position. */}
        <div ref={peopleList} className="meeting-review-people ui-scroll" inert={column !== 'people'}>{people}</div>
        {/* A scrollbar drag, the keyboard, or page search scrolls without a wheel; a wheel or touch also stops a follow scroll in progress. */}
        <div ref={transcript} className="meeting-review-transcript-body ui-scroll" inert={column !== 'transcript'} role="region" aria-label="Transcript" tabIndex={0} onScroll={() => { if (performance.now() > followScrollUntil.current) setFollow(false) }} onScrollEnd={() => { followScrollUntil.current = 0 }} onWheel={() => setFollow(false)} onTouchMove={() => setFollow(false)}>{children}</div>
      </div>
    </div>
  </section>
}
