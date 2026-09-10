import { useEffect, useId, useRef, useState } from 'react'
import { ArrowLeftIcon, CopyIcon } from '../../components/icons'
import { meetingStatusPillVisible, meetingStatusTone } from '../../../shared/meeting-recording-workflow'
import { Markdown } from '../../components/markdown'
import { Button, EmptyState, StatusPill } from '../../components/ui'
import { SpeakerLabels } from '../../routes/speaker-labels'
import { TranscriptText, meetingHasSegments, meetingTranscript, meetingTranscriptEmptyText } from '../../routes/transcript-view'
import { artifactLine, statusLabel, type PrototypeView } from '../contract'
import { meetingDurationLabel } from '../grouping'
import type { ConfirmController } from '../proto-dialog'

const TABS = [{ id: 'summary', label: 'Summary' }, { id: 'transcript', label: 'Transcript' }] as const
type TabId = (typeof TABS)[number]['id']

export function ReadingDetail({ view, confirm }: { view: PrototypeView; confirm: ConfirmController }) {
  const [tab, setTab] = useState<TabId>('summary')
  const meeting = view.selectedMeeting
  useEffect(() => setTab('summary'), [view.selectedMeetingId])
  useBackLink(view)
  if (view.selectedMeetingLoading && !meeting) return <div className="va-column"><p className="proto-muted">Opening Meeting…</p></div>
  if (!meeting) return <div className="va-column"><EmptyState>This Meeting is no longer available.</EmptyState><Button onClick={view.actions.closeMeeting}>Back to Meetings</Button></div>
  const transcriptText = meetingTranscript(meeting, view.transcript)
  return (
    <article className="va-column va-reading">
      <button type="button" className="va-back" onClick={view.actions.closeMeeting}><ArrowLeftIcon aria-hidden="true" /> All meetings</button>
      <header className="va-detail-head">
        <p className="proto-eyebrow">{new Date(meeting.startedAt).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
        <h1 className="proto-hero">{meeting.title || 'Untitled meeting'}</h1>
        <p className="va-detail-meta">
          {meetingDurationLabel({ ...meeting, hasTranscript: Boolean(transcriptText), hasSummary: Boolean(meeting.summary) })} · {meeting.speakers.length} {meeting.speakers.length === 1 ? 'speaker' : 'speakers'} · {artifactLine({ ...meeting, hasTranscript: Boolean(transcriptText), hasSummary: Boolean(meeting.summary) })}
          {meetingStatusPillVisible(meeting.status.state) ? <StatusPill tone={meetingStatusTone(meeting.status.state)}>{statusLabel({ ...meeting, hasTranscript: Boolean(transcriptText), hasSummary: Boolean(meeting.summary) })}</StatusPill> : null}
        </p>
      </header>
      <DiarizationRetry view={view} />
      <SpeakerLabels key={meeting.id} meeting={meeting} onUpdated={view.actions.meetingUpdated} />
      <TabBar tab={tab} onChange={setTab} copyValue={tab === 'summary' ? meeting.summary ?? '' : transcriptText} />
      <section className="va-panel" role="tabpanel" id={`va-panel-${tab}`} aria-labelledby={`va-tab-${tab}`} tabIndex={0}>
        {tab === 'summary' ? <SummaryBody view={view} /> : <TranscriptBody view={view} text={transcriptText} />}
      </section>
      <footer className="va-detail-foot">
        <Button
          className="compact-action"
          onClick={() => confirm.request({ title: 'Delete this Meeting?', body: 'Removes the summary, transcript, speaker labels, and audio. This cannot be undone.', confirmLabel: 'Delete Meeting', tone: 'danger', onConfirm: () => { void view.actions.deleteMeeting(meeting.id); view.actions.closeMeeting() } })}
        >Delete Meeting</Button>
      </footer>
    </article>
  )
}

function SummaryBody({ view }: { view: PrototypeView }) {
  const summary = view.selectedMeeting?.summary
  if (!summary) return <EmptyState>{view.canStop ? 'Notes appear after you stop recording.' : 'No notes yet. Notes are created locally after recording ends.'}</EmptyState>
  return <div className="va-measure"><Markdown value={summary} /></div>
}

function TranscriptBody({ view, text }: { view: PrototypeView; text: string }) {
  const meeting = view.selectedMeeting
  if (!meeting) return null
  if (!text) return <EmptyState>{meetingTranscriptEmptyText(meeting)}</EmptyState>
  if (meetingHasSegments(meeting)) return <div className="va-measure"><TranscriptText value={text} segments={meeting.segments} /></div>
  return <div className="va-measure"><TranscriptText value={text} segments={[]} /></div>
}

function DiarizationRetry({ view }: { view: PrototypeView }) {
  const [busy, setBusy] = useState(false)
  const meeting = view.selectedMeeting
  if (!meeting || meeting.diarization.state !== 'degraded') return null
  const retry = async () => {
    setBusy(true)
    try { await view.actions.retryDiarization(meeting.id) } finally { setBusy(false) }
  }
  return (
    <div className="va-notice">
      <span><strong>Speaker labels need a check.</strong> {meeting.diarization.error ?? 'Speaker separation was uncertain.'} Labels may not always be accurate.</span>
      <Button className="compact-action" disabled={busy} onClick={() => void retry()}>{busy ? 'Retrying…' : 'Retry labeling'}</Button>
    </div>
  )
}

function TabBar({ tab, onChange, copyValue }: { tab: TabId; onChange: (tab: TabId) => void; copyValue: string }) {
  const id = useId()
  const [copied, setCopied] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const move = (delta: number) => {
    const index = TABS.findIndex((item) => item.id === tab)
    const next = TABS[(index + delta + TABS.length) % TABS.length]
    if (!next) return
    onChange(next.id)
    listRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(`va-tab-${next.id}`)}`)?.focus()
  }
  return (
    <div className="va-tabbar">
      <div ref={listRef} className="va-tabs" role="tablist" aria-label="Meeting sections" onKeyDown={(event) => {
        if (event.key === 'ArrowRight') { event.preventDefault(); move(1) }
        if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1) }
      }}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            id={`va-tab-${item.id}`}
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`va-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            className={tab === item.id ? 'va-tab is-active' : 'va-tab'}
            onClick={() => onChange(item.id)}
          >{item.label}</button>
        ))}
      </div>
      {copyValue ? (
        <Button className="compact-action" onClick={() => { void navigator.clipboard?.writeText(copyValue).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600) }) }}>
          <CopyIcon aria-hidden="true" />{copied ? 'Copied' : 'Copy'}
        </Button>
      ) : null}
      <span id={id} className="proto-visually-hidden">{tab} section</span>
    </div>
  )
}

function useBackLink(view: PrototypeView): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      view.actions.closeMeeting()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [view.actions])
}
