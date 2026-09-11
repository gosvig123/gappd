import { useEffect, useRef, useState } from 'react'
import { Copy, X } from 'lucide-react'
import type { MeetingDetail } from '../../../shared/contracts'
import { meetingStatusPillVisible, meetingStatusTone } from '../../../shared/meeting-recording-workflow'
import { Markdown } from '../../components/markdown'
import { meetingHasWork, meetingProgressLabel } from '../../components/meeting-progress'
import { Button, EmptyState, ProgressBar, StatusPill, cx } from '../../components/ui'
import { SpeakerLabels } from '../../routes/speaker-labels'
import { TranscriptText, meetingHasSegments, meetingTranscript, meetingTranscriptEmptyText } from '../../routes/transcript-view'
import { artifactLine, statusLabel, type PrototypeView } from '../contract'
import { agendaStateForMeeting, agendaTabLabel } from '../agenda-status'
import { AgendaPane } from './c-agenda'
import type { MeetingTab } from './c-open-meeting'
import { meetingDurationLabel, meetingTimeLabel } from '../grouping'
import type { ConfirmController } from '../proto-dialog'

const TABS: ReadonlyArray<{ id: MeetingTab; label: string }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'agenda', label: 'Agenda' },
  { id: 'transcript', label: 'Transcript' },
]
type TabId = MeetingTab

/**
 * The Meeting layover. It is a modal for assistive technology, but visually a
 * card that floats over the table rather than a page that replaces it: the row
 * underneath keeps aria-current, and the table keeps its scroll position.
 *
 * Title and tabs are fixed rows and only the pane scrolls, so the Meeting name
 * and its section switcher stay reachable through a long transcript. One close
 * control, not two.
 */
export function DeckPanel({ view, confirm, initialTab, onOpenSettings }: { view: PrototypeView; confirm: ConfirmController; initialTab?: MeetingTab | null; onOpenSettings: () => void }) {
  const [tab, setTab] = useState<TabId>(initialTab ?? 'summary')
  const [copied, setCopied] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const meeting = view.selectedMeeting
  const transcript = meeting ? meetingTranscript(meeting, view.transcript) : ''
  const agendaState = meeting ? agendaStateForMeeting(view, meeting.id) : { kind: 'unlinked' as const }
  const copyValue = copySourceFor(tab, meeting, transcript)
  useRestoreFocus()
  useEscapeToClose(view.actions.closeMeeting)
  useEffect(() => { setTab(initialTab ?? 'summary'); setCopied(false); closeRef.current?.focus() }, [view.selectedMeetingId, initialTab])
  const copy = () => { void navigator.clipboard?.writeText(copyValue).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600) }) }
  const copyLabel = copyLabelFor(tab)
  return (
    <div className="vc-panel-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) view.actions.closeMeeting() }}>
      <article className="vc-panel" role="dialog" aria-modal="true" aria-label={meeting ? `${meeting.title} Meeting` : 'Meeting'}>
        {meeting ? <PanelHead meeting={meeting} transcript={transcript} closeRef={closeRef} onClose={view.actions.closeMeeting} /> : <PanelHeadFallback closeRef={closeRef} onClose={view.actions.closeMeeting} />}
        {meeting ? <TabBar tab={tab} onChange={setTab} labels={{ agenda: agendaTabLabel(agendaState) }} /> : null}
        <div className="vc-panel-body proto-scroll">
          {meeting
            ? <PanelContent view={view} meeting={meeting} transcript={transcript} tab={tab} onOpenSettings={onOpenSettings} />
            : <EmptyState>{view.selectedMeetingLoading ? 'Opening Meeting…' : 'This Meeting is no longer available.'}</EmptyState>}
        </div>
        {meeting ? (
          <footer className="vc-panel-foot">
            <Button
              className="compact-action"
              onClick={() => confirm.request({ title: 'Delete this Meeting?', body: `Removes the summary, transcript, speaker labels, and audio for “${meeting.title || 'Untitled meeting'}”. This cannot be undone.`, confirmLabel: 'Delete Meeting', tone: 'danger', onConfirm: () => { void view.actions.deleteMeeting(meeting.id); view.actions.closeMeeting() } })}
            >Delete Meeting</Button>
            {copyLabel ? <Button className="compact-action" onClick={copy}><Copy aria-hidden="true" />{copied ? 'Copied' : copyLabel}</Button> : null}
          </footer>
        ) : null}
      </article>
    </div>
  )
}

function PanelHead({ meeting, transcript, closeRef, onClose }: { meeting: MeetingDetail; transcript: string; closeRef: React.RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const row = { ...meeting, hasTranscript: Boolean(transcript), hasSummary: Boolean(meeting.summary) }
  return (
    <header className="vc-panel-top">
      <div className="vc-panel-titles">
        <p className="proto-eyebrow">{meetingTimeLabel(row)}</p>
        <h1>{meeting.title || 'Untitled meeting'}</h1>
        <p className="vc-panel-meta">
          <span>{meetingDurationLabel(row)}</span>
          <span aria-hidden="true">·</span>
          <span>{meeting.speakers.length} {meeting.speakers.length === 1 ? 'speaker' : 'speakers'}</span>
          <span aria-hidden="true">·</span>
          <span>{artifactLine(row)}</span>
          {meetingStatusPillVisible(meeting.status.state) ? <StatusPill tone={meetingStatusTone(meeting.status.state)}>{statusLabel(row)}</StatusPill> : null}
        </p>
      </div>
      <button ref={closeRef} type="button" className="vc-icon-action" aria-label="Close Meeting" onClick={onClose}><X aria-hidden="true" /></button>
    </header>
  )
}

function PanelHeadFallback({ closeRef, onClose }: { closeRef: React.RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  return <header className="vc-panel-top"><div className="vc-panel-titles"><h1>Meeting</h1></div><button ref={closeRef} type="button" className="vc-icon-action" aria-label="Close Meeting" onClick={onClose}><X aria-hidden="true" /></button></header>
}

/** Only the pane scrolls, so the speaker controls and the tabs stay reachable. */
function PanelContent({ view, meeting, transcript, tab, onOpenSettings }: { view: PrototypeView; meeting: MeetingDetail; transcript: string; tab: TabId; onOpenSettings: () => void }) {
  const row = { ...meeting, hasTranscript: Boolean(transcript), hasSummary: Boolean(meeting.summary) }
  const meetingLevel = tab !== 'agenda'
  return (
    <>
      {meetingLevel && meetingHasWork(meeting) ? <ProgressBar value={null} label={meetingProgressLabel(row)} /> : null}
      {meetingLevel && meeting.diarization.state === 'degraded' ? <DiarizationNotice view={view} /> : null}
      {meetingLevel ? <SpeakerLabels key={meeting.id} meeting={meeting} onUpdated={view.actions.meetingUpdated} /> : null}
      <section className="vc-panel-pane" role="tabpanel" id={`vc-pane-${tab}`} aria-labelledby={`vc-tab-${tab}`} tabIndex={0}>
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
  if (!meeting) return null
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

function TabBar({ tab, onChange, labels = {} }: { tab: TabId; onChange: (tab: TabId) => void; labels?: Partial<Record<TabId, string>> }) {
  const listRef = useRef<HTMLDivElement>(null)
  const move = (delta: number) => {
    const index = TABS.findIndex((item) => item.id === tab)
    const next = TABS[(index + delta + TABS.length) % TABS.length]
    if (!next) return
    onChange(next.id)
    listRef.current?.querySelector<HTMLButtonElement>(`#vc-tab-${next.id}`)?.focus()
  }
  return (
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
        >{labels[item.id] ?? item.label}</button>
      ))}
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
