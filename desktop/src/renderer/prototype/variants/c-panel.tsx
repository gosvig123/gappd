import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Copy, X } from 'lucide-react'
import type { MeetingDetail } from '../../../shared/contracts'
import { meetingStatusPillVisible, meetingStatusTone } from '../../../shared/meeting-recording-workflow'
import { Markdown } from '../../components/markdown'
import { meetingHasWork, meetingProgressLabel } from '../../components/meeting-progress'
import { Button, EmptyState, ProgressBar, StatusPill, cx } from '../../components/ui'
import { SpeakerLabels } from '../../routes/speaker-labels'
import { TranscriptText, meetingHasSegments, meetingTranscript, meetingTranscriptEmptyText } from '../../routes/transcript-view'
import { artifactLine, statusLabel, type PrototypeView } from '../contract'
import { meetingDurationLabel, meetingTimeLabel } from '../grouping'

const TABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'transcript', label: 'Transcript' },
] as const
type TabId = (typeof TABS)[number]['id']

/**
 * A Meeting opens as a deck card layered over the current section, so the table
 * underneath keeps its scroll position and can still mark the open row with
 * aria-current. Variant A replaces its column instead; variant B uses a pane.
 */
export function DeckPanel({ view }: { view: PrototypeView }) {
  const [tab, setTab] = useState<TabId>('summary')
  const closeRef = useRef<HTMLButtonElement>(null)
  useRestoreFocus()
  useEffect(() => { setTab('summary'); closeRef.current?.focus() }, [view.selectedMeetingId])
  useEscapeToClose(view.actions.closeMeeting)
  const meeting = view.selectedMeeting
  const transcript = meeting ? meetingTranscript(meeting, view.transcript) : ''
  return (
    <div className="vc-panel-layer" role="presentation">
      <article className="vc-panel" role="dialog" aria-modal="true" aria-label={meeting ? `${meeting.title} Meeting` : 'Meeting'}>
        <header className="vc-panel-head">
          <button type="button" className="vc-back" onClick={view.actions.closeMeeting}><ArrowLeft aria-hidden="true" /> Close</button>
          <button ref={closeRef} type="button" className="vc-icon-action" aria-label="Close Meeting" onClick={view.actions.closeMeeting}><X aria-hidden="true" /></button>
        </header>
        {meeting
          ? <PanelBody view={view} meeting={meeting} transcript={transcript} tab={tab} onTab={setTab} />
          : <EmptyState>{view.selectedMeetingLoading ? 'Opening Meeting…' : 'This Meeting is no longer available.'}</EmptyState>}
      </article>
    </div>
  )
}

type PanelBodyProps = { view: PrototypeView; meeting: MeetingDetail; transcript: string; tab: TabId; onTab: (tab: TabId) => void }

function PanelBody({ view, meeting, transcript, tab, onTab }: PanelBodyProps) {
  const row = { ...meeting, hasTranscript: Boolean(transcript), hasSummary: Boolean(meeting.summary) }
  return (
    <div className="vc-panel-body proto-scroll">
      <div className="vc-panel-titles">
        <p className="proto-eyebrow">{meetingTimeLabel(row)}</p>
        <h1 className="proto-title">{meeting.title || 'Untitled meeting'}</h1>
        <p className="vc-panel-meta">
          {meetingDurationLabel(row)} · {meeting.speakers.length} {meeting.speakers.length === 1 ? 'speaker' : 'speakers'} · {artifactLine(row)}
          {meetingStatusPillVisible(meeting.status.state) ? <StatusPill tone={meetingStatusTone(meeting.status.state)}>{statusLabel(row)}</StatusPill> : null}
        </p>
      </div>
      {meetingHasWork(meeting) ? <ProgressBar value={null} label={meetingProgressLabel(row)} /> : null}
      <DiarizationNotice view={view} />
      <SpeakerLabels key={meeting.id} meeting={meeting} onUpdated={view.actions.meetingUpdated} />
      <TabBar tab={tab} onChange={onTab} copyValue={tab === 'summary' ? meeting.summary ?? '' : transcript} />
      <section className="vc-panel-pane" role="tabpanel" id={`vc-pane-${tab}`} aria-labelledby={`vc-tab-${tab}`} tabIndex={0}>
        {tab === 'summary' ? <SummaryPane view={view} /> : <TranscriptPane view={view} text={transcript} />}
      </section>
    </div>
  )
}

function SummaryPane({ view }: { view: PrototypeView }) {
  const summary = view.selectedMeeting?.summary
  if (!summary) return <EmptyState>No notes yet. Notes are created locally after recording ends.</EmptyState>
  return <div className="vc-reading"><Markdown value={summary} /></div>
}

function TranscriptPane({ view, text }: { view: PrototypeView; text: string }) {
  const meeting = view.selectedMeeting
  if (!meeting) return null
  if (!text) return <EmptyState>{meetingTranscriptEmptyText(meeting)}</EmptyState>
  return <div className="vc-reading"><TranscriptText value={text} segments={meetingHasSegments(meeting) ? meeting.segments : []} /></div>
}

function DiarizationNotice({ view }: { view: PrototypeView }) {
  const [busy, setBusy] = useState(false)
  const meeting = view.selectedMeeting
  if (!meeting || meeting.diarization.state !== 'degraded') return null
  const retry = async () => {
    setBusy(true)
    try { await view.actions.retryDiarization(meeting.id) } finally { setBusy(false) }
  }
  return (
    <div className="vc-notice">
      <span><strong>Speaker labels need a check.</strong> {meeting.diarization.error ?? 'Speaker separation was uncertain.'} Labels may not always be accurate.</span>
      <Button className="compact-action" disabled={busy} onClick={() => void retry()}>{busy ? 'Retrying…' : 'Retry labeling'}</Button>
    </div>
  )
}

function TabBar({ tab, onChange, copyValue }: { tab: TabId; onChange: (tab: TabId) => void; copyValue: string }) {
  const [copied, setCopied] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const move = (delta: number) => {
    const index = TABS.findIndex((item) => item.id === tab)
    const next = TABS[(index + delta + TABS.length) % TABS.length]
    if (!next) return
    onChange(next.id)
    listRef.current?.querySelector<HTMLButtonElement>(`#vc-tab-${next.id}`)?.focus()
  }
  return (
    <div className="vc-tabbar">
      <div ref={listRef} className="vc-tabs" role="tablist" aria-label="Meeting sections" onKeyDown={(event) => {
        if (event.key === 'ArrowRight') { event.preventDefault(); move(1) }
        if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1) }
      }}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            id={`vc-tab-${item.id}`}
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`vc-pane-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            className={cx('vc-tab', tab === item.id && 'is-active')}
            onClick={() => onChange(item.id)}
          >{item.label}</button>
        ))}
      </div>
      {copyValue ? (
        <Button className="compact-action" onClick={() => { void navigator.clipboard?.writeText(copyValue).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600) }) }}><Copy aria-hidden="true" />{copied ? 'Copied' : 'Copy'}</Button>
      ) : null}
    </div>
  )
}

function useEscapeToClose(close: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [close])
}

/** Closing the card returns focus to the row or link that opened it. */
function useRestoreFocus(): void {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    return () => { previous?.focus?.() }
  }, [])
}
