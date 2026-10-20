import { useEffect, useState, type ReactNode } from 'react'
import { RECORDING_STATUS_RECORDING } from '../../shared/meeting-recording-workflow'
import type { AppView } from '../lib/app-view'
import { Button } from './ui'

const TEST_TITLE = 'Test recording'
const TEST_SECONDS = 10
const TRANSCRIPT_POLL_MS = 1500
const TRANSCRIPT_WAIT_MS = 60_000
const HEARD_PREVIEW_CHARS = 160

type Phase =
  | { name: 'idle' }
  | { name: 'starting' }
  | { name: 'recording'; meetingId: string; left: number }
  | { name: 'listening'; meetingId: string }
  | { name: 'heard'; meetingId: string; text: string }
  | { name: 'silent' }
  | { name: 'slow'; meetingId: string }

/**
 * A short first recording, so the user sees a transcript before a real
 * meeting depends on it. It is a normal Meeting named "Test recording".
 */
export function SetupTestRecording({ view }: { view: AppView }) {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const recordingId = view.recording.status === RECORDING_STATUS_RECORDING ? view.recording.meetingId : undefined

  // Start: wait for the recording to begin, or give up when starting failed.
  useEffect(() => {
    if (phase.name !== 'starting') return
    if (recordingId) setPhase({ name: 'recording', meetingId: recordingId, left: TEST_SECONDS })
    else if (view.bannerError) setPhase({ name: 'idle' })
  }, [phase.name, recordingId, view.bannerError])

  // Record: count down, then stop. A Stop from the record bar also ends the test.
  useEffect(() => {
    if (phase.name !== 'recording') return
    if (recordingId !== phase.meetingId) { setPhase({ name: 'listening', meetingId: phase.meetingId }); return }
    if (phase.left <= 0) { view.actions.stop(); setPhase({ name: 'listening', meetingId: phase.meetingId }); return }
    const timer = setTimeout(() => setPhase({ ...phase, left: phase.left - 1 }), 1000)
    return () => clearTimeout(timer)
  }, [phase, recordingId, view.actions])

  // Listen: read the Meeting until its transcript or a failure arrives.
  useEffect(() => {
    if (phase.name !== 'listening') return
    let stopped = false
    const deadline = Date.now() + TRANSCRIPT_WAIT_MS
    const poll = async () => {
      if (stopped) return
      const meeting = await window.gappd.meetings.show(phase.meetingId).catch(() => null)
      if (stopped) return
      const text = meeting?.segments.map((segment) => segment.text.trim()).filter(Boolean).join(' ')
      if (text) return setPhase({ name: 'heard', meetingId: phase.meetingId, text })
      if (meeting?.status.processing.state === 'failed' || meeting?.status.capture.state === 'failed') return setPhase({ name: 'silent' })
      if (Date.now() > deadline) return setPhase({ name: 'slow', meetingId: phase.meetingId })
      setTimeout(poll, TRANSCRIPT_POLL_MS)
    }
    void poll()
    return () => { stopped = true }
  }, [phase])

  const start = () => { setPhase({ name: 'starting' }); view.actions.start(undefined, TEST_TITLE) }
  const microphone = view.devices.find((device) => device.index === view.device)?.name ?? 'the selected microphone'
  const open = (meetingId: string) => <Button onClick={() => view.actions.openMeeting(meetingId)}>Open test recording</Button>

  switch (phase.name) {
    case 'idle': return <TestRow text="Not sure it works? Record 10 seconds and see the transcript." action={<Button disabled={!view.canStart} onClick={start}>Record a 10-second test</Button>} />
    case 'starting': return <TestRow text="Starting the test recording…" />
    case 'recording': return <TestRow live text={`Recording. Say a few words. Stops in ${phase.left} s.`} action={<Button onClick={view.actions.stop}>Stop now</Button>} />
    case 'listening': return <TestRow text="Making the transcript on this Mac…" />
    case 'heard': return <TestRow text={<>Gappd heard: “{preview(phase.text)}”</>} action={open(phase.meetingId)} />
    case 'silent': return <TestRow warning text={`Gappd heard nothing from ${microphone}. Check that it is the microphone you use, speak during the test, then try again.`} action={<Button disabled={!view.canStart} onClick={start}>Try again</Button>} />
    case 'slow': return <TestRow text="The transcript is taking longer than usual. It appears in the test recording when it is ready." action={open(phase.meetingId)} />
  }
}

function TestRow({ text, action, live, warning }: { text: ReactNode; action?: ReactNode; live?: boolean; warning?: boolean }) {
  return (
    <div className="setup-test">
      <p className={warning ? 'setup-step-warning' : undefined} role="status" aria-live="polite">{live ? <span className="setup-test-dot" aria-hidden="true" /> : null}{text}</p>
      {action}
    </div>
  )
}

function preview(text: string): string {
  return text.length > HEARD_PREVIEW_CHARS ? `${text.slice(0, HEARD_PREVIEW_CHARS).trimEnd()}…` : text
}
