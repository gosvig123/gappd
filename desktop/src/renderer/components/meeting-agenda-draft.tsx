import { useState } from 'react'
import { INFERRED_CALENDAR_PROVENANCE } from '../../shared/meeting-agenda'
import type { MeetingAgendaDraft } from '../../shared/meeting-agenda'
import { Button } from './ui'

type Props = { sourceId: string; onOpenMeeting: (id: string) => void; onOpenSettings: () => void }
type ViewProps = Omit<Props, 'sourceId'> & { draft: MeetingAgendaDraft | null; busy: boolean; error: string; onGenerate: () => void; onChange: (draft: MeetingAgendaDraft) => void }

export function MeetingAgendaDraftPanel({ sourceId, onOpenMeeting, onOpenSettings }: Props) {
  const [draft, setDraft] = useState<MeetingAgendaDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function generate() {
    setBusy(true); setError('')
    try { setDraft(await window.gappd.googleCalendar.generateAgenda(sourceId)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <MeetingAgendaDraftView draft={draft} busy={busy} error={error} onGenerate={() => void generate()} onChange={setDraft} onOpenMeeting={onOpenMeeting} onOpenSettings={onOpenSettings} />
}

export function MeetingAgendaDraftView({ draft, busy, error, onGenerate, onChange, onOpenMeeting, onOpenSettings }: ViewProps) {
  const retry = Boolean(draft?.items.length && (draft.historyIncomplete || draft.ambiguousMeetings?.length))
  const generate = () => {
    if (retry && !window.confirm('Replace this agenda draft?\n\nGenerating again replaces all local topic edits. Cancel to keep this draft.')) return
    onGenerate()
  }
  return <div className="meeting-agenda-draft"><Button className="compact-action" disabled={busy || Boolean(draft?.items.length && !retry)} onClick={generate}>{busy ? 'Generating agenda…' : retry ? 'Generate again…' : 'Generate agenda'}</Button>{busy ? <p role="status">Matching Calendar invitee email addresses and preparing from local Meetings…</p> : null}{error ? <div role="alert"><p>{error}</p><Button onClick={onOpenSettings}>Open Settings</Button></div> : null}{draft?.ambiguousMeetings?.length ? <AmbiguousCalendarMeetings meetings={draft.ambiguousMeetings} onOpenMeeting={onOpenMeeting} /> : null}{draft ? <DraftContent draft={draft} busy={busy} onChange={onChange} onOpenMeeting={onOpenMeeting} /> : null}</div>
}

function DraftContent({ draft, busy, onChange, onOpenMeeting }: { draft: MeetingAgendaDraft; busy: boolean; onChange: (draft: MeetingAgendaDraft) => void; onOpenMeeting: (id: string) => void }) {
  if (!draft.sources.length && draft.historyIncomplete) return <p role="status">Calendar overlap matching is incomplete. Connect or sync all Calendar accounts and resolve any Calendar history error, then generate again. Meetings need a valid recorded time range.</p>
  if (!draft.sources.length && draft.ambiguousMeetings?.length) return null
  if (!draft.sources.length) return <p role="status">No previous Meetings matched these invitee email addresses. Link a previous Meeting to its Calendar event or save a Person’s email when labeling speakers.</p>
  if (!draft.items.length) return <p role="status">No supported follow-up topics found in {draft.sources.length} matched Meetings.{draft.historyIncomplete ? ' Calendar overlap matching is incomplete. Sync all Calendar accounts and resolve any Calendar history error, then generate again.' : ''}</p>
  return <section aria-label="Editable agenda draft"><p>Local draft for this view only. Nothing is shared or added to Calendar. Based on up to 12 matched Meetings; history may be incomplete. Confirm current status before use.</p>{draft.historyIncomplete ? <p role="status">Some Calendar overlap matching is unavailable. Sync all Calendar accounts and resolve any Calendar history error, then generate again.</p> : null}{draft.sources.filter(source => source.calendarProvenance).map(source => <p key={source.id}>{source.title}: {source.calendarProvenance === INFERRED_CALENDAR_PROVENANCE ? 'Inferred Calendar overlap (attendance unconfirmed)' : 'Confirmed Calendar link'} — {source.calendarTitle}</p>)}{draft.items.map((item, index) => <div key={`${item.sourceId}:${index}`}><label>Topic {index + 1}<textarea readOnly={busy} value={item.topic} onChange={event => onChange({ ...draft, items: draft.items.map((value, position) => position === index ? { ...value, topic: event.target.value } : value) })} /></label><blockquote>{item.quote}</blockquote><Button className="compact-action" onClick={() => onOpenMeeting(item.sourceId)}>Open Meeting: {draft.sources.find(source => source.id === item.sourceId)?.title ?? item.sourceId}</Button></div>)}</section>
}

function AmbiguousCalendarMeetings({ meetings, onOpenMeeting }: { meetings: NonNullable<MeetingAgendaDraft['ambiguousMeetings']>; onOpenMeeting: (id: string) => void }) {
  return <section aria-label="Unconfirmed Calendar matches"><p role="status">Multiple Calendar events overlap these Meetings. Automatic matching remains unconfirmed. Open each Meeting and choose its Calendar event under People in this meeting, then generate again.</p>{meetings.map(meeting => <Button key={meeting.id} className="compact-action" onClick={() => onOpenMeeting(meeting.id)}>Choose Calendar event: {meeting.title}</Button>)}</section>
}
