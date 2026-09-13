import { useEffect, useRef, useState } from 'react'
import { Copy, X } from 'lucide-react'
import type { MeetingDetail } from '../../shared/contracts'
import { meetingStatusPillVisible, meetingStatusTone } from '../../shared/meeting-recording-workflow'
import { Markdown } from '../components/markdown'
import { meetingHasWork, meetingProgressLabel } from '../components/meeting-progress'
import { Button, EmptyState, ProgressBar, StatusPill, cx } from '../components/ui'
import { SpeakerLabels } from '../routes/speaker-labels'
import { TranscriptText, meetingHasSegments, meetingTranscript, meetingTranscriptEmptyText } from '../routes/transcript-view'
import { artifactLine, statusLabel, type AppView } from '../lib/app-view'
import { agendaStateForMeeting, agendaTabLabel } from '../lib/agenda-status'
import { AgendaPane } from './agenda-tab'
import type { MeetingTab } from './meeting-open-scope'
import { meetingDurationLabel, meetingTimeLabel } from '../lib/meeting-grouping'
import type { ConfirmController } from './confirm'

const TABS: ReadonlyArray<{ id: MeetingTab; label: string }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'agenda', label: 'Agenda' },
  { id: 'transcript', label: 'Transcript' },
]
type TabId = MeetingTab

/** Inline Meeting content. No modal or focus trap: the list remains interactive. */
export function MeetingPanel({ view, confirm, initialTab, onOpenSettings }: { view: AppView; confirm: ConfirmController; initialTab?: MeetingTab | null; onOpenSettings: () => void }) {
  const [tab, setTab] = useState<TabId>(initialTab ?? 'summary')
  const closeRef = useRef<HTMLButtonElement>(null)
  const meeting = view.selectedMeeting
  const transcript = meeting ? meetingTranscript(meeting, view.transcript) : ''
  const agendaState = meeting ? agendaStateForMeeting(view, meeting.id) : { kind: 'unlinked' as const }
  useEffect(() => { setTab(initialTab ?? 'summary'); closeRef.current?.focus({ preventScroll: true }) }, [view.selectedMeetingId, initialTab])
  return <article className="app-panel" aria-label={meeting ? `${meeting.title} Meeting` : 'Meeting'}>
    {meeting ? <PanelHead meeting={meeting} transcript={transcript} closeRef={closeRef} onClose={view.actions.closeMeeting} /> : <PanelHeadFallback closeRef={closeRef} onClose={view.actions.closeMeeting} />}
    {meeting ? <TabBar tab={tab} onChange={setTab} labels={{ agenda: agendaTabLabel(agendaState) }} /> : null}
    <div className="app-panel-body ui-scroll">
      {meeting ? <PanelContent view={view} meeting={meeting} transcript={transcript} tab={tab} onOpenSettings={onOpenSettings} /> : <EmptyState>{view.selectedMeetingLoading ? 'Opening Meeting…' : view.selectedMeetingError || 'This Meeting is no longer available.'}</EmptyState>}
    </div>
    {meeting ? <PanelFooter key={`${meeting.id}:${tab}`} view={view} confirm={confirm} meeting={meeting} tab={tab} transcript={transcript} /> : null}
  </article>
}

function PanelFooter({ view, confirm, meeting, tab, transcript }: { view: AppView; confirm: ConfirmController; meeting: MeetingDetail; tab: TabId; transcript: string }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const copy = async () => {
    try { await navigator.clipboard.writeText(copySourceFor(tab, meeting, transcript)); setCopied(true); setError('') }
    catch { setError('Could not copy. Select the text and copy it manually.') }
  }
  const remove = () => confirm.request({ title: 'Delete this Meeting?', body: `Removes the summary, transcript, speaker labels, and audio for “${meeting.title || 'Untitled meeting'}”. This cannot be undone.`, confirmLabel: 'Delete Meeting', tone: 'danger', onConfirm: async () => { await view.actions.deleteMeeting(meeting.id); view.actions.closeMeeting() } })
  return <footer className="app-panel-foot"><Button className="compact-action" disabled={meetingHasWork(meeting)} onClick={remove}>Delete Meeting</Button>{error ? <span role="alert">{error}</span> : null}{copyLabelFor(tab) ? <Button className="compact-action" onClick={() => void copy()}><Copy aria-hidden="true" />{copied ? 'Copied' : copyLabelFor(tab)}</Button> : null}</footer>
}

function PanelHead({ meeting, transcript, closeRef, onClose }: { meeting: MeetingDetail; transcript: string; closeRef: React.RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const row = { ...meeting, hasTranscript: Boolean(transcript), hasSummary: Boolean(meeting.summary) }
  return (
    <header className="app-panel-top">
      <div className="app-panel-titles">
        <p className="ui-eyebrow">{meetingTimeLabel(row)}</p>
        <h1>{meeting.title || 'Untitled meeting'}</h1>
        <p className="app-panel-meta">
          <span>{meetingDurationLabel(row)}</span>
          <span aria-hidden="true">·</span>
          <span>{meeting.speakers.length} {meeting.speakers.length === 1 ? 'speaker' : 'speakers'}</span>
          <span aria-hidden="true">·</span>
          <span>{artifactLine(row)}</span>
          {meetingStatusPillVisible(meeting.status.state) ? <StatusPill tone={meetingStatusTone(meeting.status.state)}>{statusLabel(row)}</StatusPill> : null}
        </p>
      </div>
      <button ref={closeRef} type="button" className="app-icon-action" aria-label="Close Meeting" onClick={onClose}><X aria-hidden="true" /></button>
    </header>
  )
}

function PanelHeadFallback({ closeRef, onClose }: { closeRef: React.RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  return <header className="app-panel-top"><div className="app-panel-titles"><h1>Meeting</h1></div><button ref={closeRef} type="button" className="app-icon-action" aria-label="Close Meeting" onClick={onClose}><X aria-hidden="true" /></button></header>
}

/** Only the pane scrolls, so the speaker controls and the tabs stay reachable. */
function PanelContent({ view, meeting, transcript, tab, onOpenSettings }: { view: AppView; meeting: MeetingDetail; transcript: string; tab: TabId; onOpenSettings: () => void }) {
  const row = { ...meeting, hasTranscript: Boolean(transcript), hasSummary: Boolean(meeting.summary) }
  const meetingLevel = tab !== 'agenda'
  return (
    <>
      {meetingLevel && meetingHasWork(meeting) ? <ProgressBar value={null} label={meetingProgressLabel(row)} /> : null}
      {meetingLevel && meeting.diarization.state === 'degraded' ? <DiarizationNotice view={view} /> : null}
      {meetingLevel ? <SpeakerLabels key={meeting.id} meeting={meeting} onUpdated={view.actions.meetingUpdated} onLinkCalendar={view.actions.linkMeetingCalendar} /> : null}
      <section className="app-panel-pane" role="tabpanel" id={`app-pane-${tab}`} aria-labelledby={`app-tab-${tab}`} tabIndex={0}>
        {tab === 'summary' ? <SummaryPane view={view} /> : null}
        {tab === 'agenda' ? <AgendaPane view={view} meetingId={meeting.id} onOpenSettings={onOpenSettings} /> : null}
        {tab === 'transcript' ? <TranscriptPane view={view} text={transcript} /> : null}
      </section>
    </>
  )
}

function copySourceFor(tab: TabId, meeting: MeetingDetail | null, transcript: string): string {
  if (!meeting) return ''
  if (tab === 'summary') return meeting.summary ?? ''
  if (tab === 'transcript') return transcript
  return ''
}

function copyLabelFor(tab: TabId): string {
  if (tab === 'summary') return 'Copy notes'
  if (tab === 'transcript') return 'Copy transcript'
  return ''
}

function SummaryPane({ view }: { view: AppView }) {
  const summary = view.selectedMeeting?.summary
  if (!summary) return <EmptyState>No notes yet. Notes are created locally after recording ends.</EmptyState>
  return <div className="app-reading"><Markdown value={summary} /></div>
}

function TranscriptPane({ view, text }: { view: AppView; text: string }) {
  const meeting = view.selectedMeeting
  if (!meeting) return null
  if (!text) return <EmptyState>{meetingTranscriptEmptyText(meeting)}</EmptyState>
  return <div className="app-reading"><TranscriptText value={text} segments={meetingHasSegments(meeting) ? meeting.segments : []} /></div>
}

function DiarizationNotice({ view }: { view: AppView }) {
  const [busy, setBusy] = useState(false)
  const meeting = view.selectedMeeting
  if (!meeting) return null
  const retry = async () => {
    setBusy(true)
    try { await view.actions.retryDiarization(meeting.id) } finally { setBusy(false) }
  }
  return (
    <div className="app-notice">
      <span><strong>Speaker labels need a check.</strong> {meeting.diarization.error ?? 'Speaker separation was uncertain.'} Labels may not always be accurate.</span>
      <Button className="compact-action" disabled={busy} onClick={() => void retry()}>{busy ? 'Retrying…' : 'Retry labeling'}</Button>
    </div>
  )
}

function TabBar({ tab, onChange, labels = {} }: { tab: TabId; onChange: (tab: TabId) => void; labels?: Partial<Record<TabId, string>> }) {
  const listRef = useRef<HTMLDivElement>(null)
  const move = (delta: number) => {
    const index = TABS.findIndex((item) => item.id === tab)
    const next = TABS[(index + delta + TABS.length) % TABS.length]
    if (!next) return
    onChange(next.id)
    listRef.current?.querySelector<HTMLButtonElement>(`#app-tab-${next.id}`)?.focus()
  }
  return (
    <div ref={listRef} className="app-tabs" role="tablist" aria-label="Meeting sections" onKeyDown={(event) => {
      if (event.key === 'ArrowRight') { event.preventDefault(); move(1) }
      if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1) }
    }}>
      {TABS.map((item) => (
        <button key={item.id} type="button" id={`app-tab-${item.id}`} role="tab" aria-selected={tab === item.id}
          aria-controls={`app-pane-${item.id}`} tabIndex={tab === item.id ? 0 : -1}
          className={cx('app-tab', tab === item.id && 'is-active')} onClick={() => onChange(item.id)}>{labels[item.id] ?? item.label}</button>
      ))}
    </div>
  )
}
