import { useEffect, useRef, useState } from 'react'
import { meetingStatusPillVisible, meetingStatusTone } from '../../../shared/meeting-recording-workflow'
import type { MeetingDetail } from '../../../shared/contracts'
import { Markdown } from '../../components/markdown'
import { Button, EmptyState, StatusPill } from '../../components/ui'
import { SpeakerLabels } from '../../routes/speaker-labels'
import { TranscriptText, meetingHasSegments, meetingTranscript, meetingTranscriptEmptyText } from '../../routes/transcript-view'
import { artifactLine, statusLabel, type PrototypeView } from '../contract'
import { meetingDurationLabel } from '../grouping'

const TABS = [{ id: 'summary', label: 'Summary' }, { id: 'transcript', label: 'Transcript' }] as const
type TabId = (typeof TABS)[number]['id']

/**
 * The right pane. Destructive actions deliberately do not appear here: the rail
 * row for this Meeting stays visible beside the pane, so one place owns delete.
 */
export function DetailPane({ view }: { view: PrototypeView }) {
  const [tab, setTab] = useState<TabId>('summary')
  const meeting = view.selectedMeeting
  useEffect(() => { setTab('summary') }, [view.selectedMeetingId])
  useEscapeClose(view)
  if (!meeting && view.selectedMeetingLoading) return <p className="vb-placeholder proto-muted">Opening Meeting…</p>
  if (!meeting) return <div className="vb-pane-empty"><EmptyState>That Meeting is no longer available.</EmptyState><Button onClick={view.actions.closeMeeting}>Back to the console</Button></div>
  const text = meetingTranscript(meeting, view.transcript)
  const progress = { ...meeting, hasTranscript: Boolean(text), hasSummary: Boolean(meeting.summary) }
  return (
    <article className="vb-detail">
      <header className="vb-detail-head">
        <p className="proto-eyebrow">{new Date(meeting.startedAt).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
        <h1 className="vb-meeting-title">{meeting.title || 'Untitled meeting'}</h1>
        <p className="vb-detail-meta">
          <span>{meetingDurationLabel(progress)}</span>
          <span aria-hidden="true">·</span>
          <span>{meeting.speakers.length} {meeting.speakers.length === 1 ? 'speaker' : 'speakers'}</span>
          <span aria-hidden="true">·</span>
          <span>{artifactLine(progress)}</span>
          {meetingStatusPillVisible(meeting.status.state) ? <StatusPill tone={meetingStatusTone(meeting.status.state)}>{statusLabel(progress)}</StatusPill> : null}
        </p>
      </header>
      <DiarizationNotice view={view} meeting={meeting} />
      <SpeakerLabels key={meeting.id} meeting={meeting} onUpdated={view.actions.meetingUpdated} />
      <TabBar tab={tab} onChange={setTab} />
      <section className="vb-panel" id={`vb-panel-${tab}`} role="tabpanel" aria-labelledby={`vb-tab-${tab}`} tabIndex={0}>
        {tab === 'summary' ? <SummaryBody meeting={meeting} /> : <TranscriptBody meeting={meeting} text={text} />}
      </section>
    </article>
  )
}

function SummaryBody({ meeting }: { meeting: MeetingDetail }) {
  if (!meeting.summary) return <EmptyState>{meeting.status.state === 'recording' ? 'Notes appear after you stop recording.' : 'No notes yet. Notes are created locally after recording ends.'}</EmptyState>
  return <div className="vb-measure"><Markdown value={meeting.summary} /></div>
}

function TranscriptBody({ meeting, text }: { meeting: MeetingDetail; text: string }) {
  if (!text) return <EmptyState>{meetingTranscriptEmptyText(meeting)}</EmptyState>
  return <div className="vb-measure"><TranscriptText value={text} segments={meetingHasSegments(meeting) ? meeting.segments : []} /></div>
}

function DiarizationNotice({ view, meeting }: { view: PrototypeView; meeting: MeetingDetail }) {
  const [busy, setBusy] = useState(false)
  if (meeting.diarization.state !== 'degraded') return null
  const retry = async () => {
    setBusy(true)
    try { await view.actions.retryDiarization(meeting.id) } finally { setBusy(false) }
  }
  return (
    <div className="vb-notice">
      <span><strong>Speaker labels need a check.</strong> {meeting.diarization.error ?? 'Speaker separation was uncertain.'} Labels may not always be accurate.</span>
      <Button className="compact-action" disabled={busy} onClick={() => void retry()}>{busy ? 'Retrying…' : 'Retry labeling'}</Button>
    </div>
  )
}

function TabBar({ tab, onChange }: { tab: TabId; onChange: (tab: TabId) => void }) {
  const listRef = useRef<HTMLDivElement>(null)
  const step = (delta: number) => stepTab(listRef, tab, delta, onChange)
  return (
    <div
      ref={listRef}
      className="vb-tabs"
      role="tablist"
      aria-label="Meeting sections"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') { event.preventDefault(); step(1) }
        if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1) }
      }}
    >
      {TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          id={`vb-tab-${item.id}`}
          role="tab"
          aria-selected={tab === item.id}
          aria-controls={`vb-panel-${item.id}`}
          tabIndex={tab === item.id ? 0 : -1}
          className={tab === item.id ? 'vb-tab is-active' : 'vb-tab'}
          onClick={() => onChange(item.id)}
        >{item.label}</button>
      ))}
    </div>
  )
}

/** Arrow keys move selection and focus together, as the tab pattern requires. */
function stepTab(listRef: React.RefObject<HTMLDivElement | null>, tab: TabId, delta: number, onChange: (tab: TabId) => void): void {
  const index = TABS.findIndex((item) => item.id === tab)
  const next = TABS[(index + delta + TABS.length) % TABS.length]
  if (!next) return
  onChange(next.id)
  listRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(`vb-tab-${next.id}`)}`)?.focus()
}

function useEscapeClose(view: PrototypeView): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      view.actions.closeMeeting()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [view.actions])
}
