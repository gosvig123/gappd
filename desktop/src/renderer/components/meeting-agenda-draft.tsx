import { useState } from 'react'
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
  return <div className="meeting-agenda-draft"><Button className="compact-action" disabled={busy || Boolean(draft?.items.length)} onClick={onGenerate}>{busy ? 'Generating agenda…' : 'Generate agenda'}</Button>{busy ? <p role="status">Matching Calendar invitee email addresses and preparing from local Meetings…</p> : null}{error ? <div role="alert"><p>{error}</p><Button onClick={onOpenSettings}>Open Settings</Button></div> : null}{draft ? <DraftContent draft={draft} onChange={onChange} onOpenMeeting={onOpenMeeting} /> : null}</div>
}

function DraftContent({ draft, onChange, onOpenMeeting }: { draft: MeetingAgendaDraft; onChange: (draft: MeetingAgendaDraft) => void; onOpenMeeting: (id: string) => void }) {
  if (!draft.sources.length) return <p role="status">No previous Meetings matched these invitee email addresses. Link a previous Meeting to its Calendar event or save a Person’s email when labeling speakers.</p>
  if (!draft.items.length) return <p role="status">No supported follow-up topics found in {draft.sources.length} matched Meetings.</p>
  return <section aria-label="Editable agenda draft"><p>Local draft for this view only. Nothing is shared or added to Calendar. Based on up to 12 matched Meetings; history may be incomplete. Confirm current status before use.</p>{draft.items.map((item, index) => <div key={`${item.sourceId}:${index}`}><label>Topic {index + 1}<textarea value={item.topic} onChange={event => onChange({ ...draft, items: draft.items.map((value, position) => position === index ? { ...value, topic: event.target.value } : value) })} /></label><blockquote>{item.quote}</blockquote><Button className="compact-action" onClick={() => onOpenMeeting(item.sourceId)}>Open Meeting: {draft.sources.find(source => source.id === item.sourceId)?.title ?? item.sourceId}</Button></div>)}</section>
}
