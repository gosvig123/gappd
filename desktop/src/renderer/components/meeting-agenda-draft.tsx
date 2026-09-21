import { useEffect, useState } from 'react'
import type { AgendaDraftView } from '../../shared/agenda-draft'
import type { MeetingAgendaDraft } from '../../shared/meeting-agenda'
import { INFERRED_CALENDAR_PROVENANCE } from '../../shared/meeting-agenda'
import type { AgendaDraftController, AgendaSaveState } from '../hooks/use-agenda-draft'
import { useAgendaDraft } from '../hooks/use-agenda-draft'
import { Button } from './ui'

const HISTORY_INCOMPLETE_WARNING = 'Calendar overlap matching is incomplete. Check Calendar settings, then generate again.'
const GENERATE_HINT = 'Checking and syncing Calendar history when needed, then reading Meeting history and connected communication, then preparing with the configured AI provider. Slack rate limits can add up to 10 minutes. Long histories use up to 96 model requests and can take a further 20 minutes. Provider usage charges may apply…'
const REGENERATE_CONFIRM = 'Replace this agenda draft?\n\nGenerating again replaces all local topic edits. Cancel to keep this draft.'
const DELETE_CONFIRM = 'Delete this saved agenda draft?\n\nThis removes the saved topics for this event. It does not change Calendar.'

type PanelProps = { draftKey: string; sourceId: string; canGenerate: boolean; knownMeetingIds?: ReadonlySet<string>; onOpenMeeting: (id: string) => void; onOpenSettings: () => void }

type ViewProps = {
  draft: MeetingAgendaDraft | null
  busy: boolean
  error: string
  onGenerate: () => void
  onChange: (draft: MeetingAgendaDraft) => void
  onOpenMeeting: (id: string) => void
  onOpenSettings: () => void
  canGenerate?: boolean
  knownMeetingIds?: ReadonlySet<string>
  saveState?: AgendaSaveState
  loadingSaved?: boolean
  onRetrySave?: () => void
  onReloadSaved?: () => void
  onDeleteSaved?: () => void
}

export function MeetingAgendaDraftPanel({ draftKey, sourceId, canGenerate, knownMeetingIds, onOpenMeeting, onOpenSettings }: PanelProps) {
  const controller = useAgendaDraft(draftKey, sourceId)
  const [channels, setChannels] = useState('')
  useEffect(() => setChannels(''), [draftKey])
  return (
    <>
    <p>Generation uses the configured AI provider, previous Meetings, Gmail when enabled, and existing Slack DMs with invitees when connected. A remote AI provider receives the selected text. No messages are sent.</p>
    <label>Slack channel IDs (optional, up to three, comma-separated)<input value={channels} disabled={controller.generating} placeholder="C0123456789, C9876543210" onChange={event => setChannels(event.target.value)} /></label>
    <MeetingAgendaDraftView
      draft={controller.draft} busy={controller.generating} error={controller.error}
      canGenerate={canGenerate && controller.canGenerate} knownMeetingIds={knownMeetingIds}
      saveState={controller.saveState} loadingSaved={controller.loading}
      onGenerate={() => void controller.generate(channels.split(',').map(value => value.trim()).filter(Boolean))} onChange={(next) => controller.setTopics(next.items.map((item) => item.topic))}
      onRetrySave={() => void controller.retrySave()} onReloadSaved={() => void controller.reload()}
      onDeleteSaved={confirmRemove(controller)} onOpenMeeting={onOpenMeeting} onOpenSettings={onOpenSettings}
    />
    </>
  )
}

function confirmRemove(controller: AgendaDraftController): () => void {
  return () => {
    if (!window.confirm(DELETE_CONFIRM)) return
    void controller.remove()
  }
}

export function MeetingAgendaDraftView({ draft, busy, error, onGenerate, onChange, onOpenMeeting, onOpenSettings, canGenerate = true, knownMeetingIds, saveState, loadingSaved, onRetrySave, onReloadSaved, onDeleteSaved }: ViewProps) {
  const retry = Boolean(draft?.items.length)
  const generate = () => {
    if (retry && !window.confirm(REGENERATE_CONFIRM)) return
    onGenerate()
  }
  return (
    <div className="meeting-agenda-draft">
      <Button className="compact-action" disabled={busy || !canGenerate} onClick={generate}>{busy ? 'Generating agenda…' : retry ? 'Generate again…' : 'Generate agenda'}</Button>
      {!canGenerate ? <p role="status">Regeneration is off for this event. Saved topics stay editable.</p> : null}
      {loadingSaved ? <p role="status">Loading saved agenda…</p> : null}
      {busy ? <p role="status">{GENERATE_HINT}</p> : null}
      {error ? <div role="alert"><p>{error}</p><Button onClick={onOpenSettings}>Open Settings</Button></div> : null}
      {draft ? <SavedStateNote draft={draft} saveState={saveState} onRetrySave={onRetrySave} onReloadSaved={onReloadSaved} /> : null}
      {draft ? <DraftContent draft={draft} busy={busy || saveState === 'conflict'} onChange={onChange} onOpenMeeting={onOpenMeeting} knownMeetingIds={knownMeetingIds} onDeleteSaved={onDeleteSaved} /> : null}
    </div>
  )
}

function SavedStateNote({ draft, saveState, onRetrySave, onReloadSaved }: { draft: MeetingAgendaDraft; saveState?: AgendaSaveState; onRetrySave?: () => void; onReloadSaved?: () => void }) {
  if (!saveState) return null
  const metadata = draft as Partial<AgendaDraftView>
  return (
    <div className="status-note" role="status">
      <span>{saveLabel(saveState)} · Generated {timestampLabel(metadata.generatedAt)} with {generationLabel(metadata)}</span>
      {saveState === 'failed' && onRetrySave ? <Button className="compact-action" onClick={onRetrySave}>Retry save</Button> : null}
      {saveState === 'conflict' && onReloadSaved ? <Button className="compact-action" onClick={onReloadSaved}>Reload saved version</Button> : null}
    </div>
  )
}

function saveLabel(state: AgendaSaveState): string {
  if (state === 'saving') return 'Saving…'
  if (state === 'pending') return 'Unsaved changes'
  if (state === 'failed') return 'Not saved yet'
  if (state === 'conflict') return 'A newer saved version exists'
  return 'Saved locally'
}

function timestampLabel(value?: string): string {
  if (!value) return 'an unknown time'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'an unknown time' : parsed.toLocaleString()
}

function generationLabel(draft: Partial<AgendaDraftView>): string {
  if (draft.reasoningEffort) return `${draft.model} · ${draft.reasoningEffort} reasoning`
  return draft.model || 'the configured model'
}

function DraftContent({ draft, busy, onChange, onOpenMeeting, knownMeetingIds, onDeleteSaved }: { draft: MeetingAgendaDraft; busy: boolean; onChange: (draft: MeetingAgendaDraft) => void; onOpenMeeting: (id: string) => void; knownMeetingIds?: ReadonlySet<string>; onDeleteSaved?: () => void }) {
  return (
    <section aria-label="Saved agenda draft">
      <DraftNotice draft={draft} />
      {draft.communicationWarning ? <p role="status">{draft.communicationWarning}</p> : null}
      {draft.items.length ? <AgendaTopics draft={draft} busy={busy} onChange={onChange} onOpenMeeting={onOpenMeeting} knownMeetingIds={knownMeetingIds} /> : null}
      {draft.ambiguousMeetings?.length ? <AmbiguousCalendarMeetings meetings={draft.ambiguousMeetings} onOpenMeeting={onOpenMeeting} /> : null}
      {onDeleteSaved ? <Button className="compact-action" onClick={onDeleteSaved}>Delete saved agenda</Button> : null}
    </section>
  )
}

function DraftNotice({ draft }: { draft: MeetingAgendaDraft }) {
  if (!draft.sources.length && draft.historyIncomplete) return <p role="status">{draft.historyWarning ?? HISTORY_INCOMPLETE_WARNING}</p>
  if (!draft.sources.length && draft.ambiguousMeetings?.length) return null
  if (!draft.sources.length) return <p role="status">No Meeting or communication evidence matched. Check the invitee email addresses and communication connections, or link a previous Meeting to its Calendar event.</p>
  if (!draft.items.length) return <p role="status">No supported follow-up topics found in {draft.sources.length} matched sources.{draft.historyIncomplete ? ` ${draft.historyWarning ?? HISTORY_INCOMPLETE_WARNING}` : ''}</p>
  return null
}

function AgendaTopics({ draft, busy, onChange, onOpenMeeting, knownMeetingIds }: { draft: MeetingAgendaDraft; busy: boolean; onChange: (draft: MeetingAgendaDraft) => void; onOpenMeeting: (id: string) => void; knownMeetingIds?: ReadonlySet<string> }) {
  return (
    <>
      <p>Saved on this Mac for this event only. The draft is not sent or added to Calendar. Based on up to 12 matched Meetings and 16 recent messages per connected communication service from the last 30 days; history may be incomplete. Confirm current status before use.</p>
      {draft.historyIncomplete ? <p role="status">{draft.historyWarning ?? HISTORY_INCOMPLETE_WARNING}</p> : null}
      {draft.sources.filter((source) => source.calendarProvenance).map((source) => <p key={source.id}>{source.title}: {source.calendarProvenance === INFERRED_CALENDAR_PROVENANCE ? 'Inferred Calendar overlap (attendance unconfirmed)' : 'Confirmed Calendar link'} — {source.calendarTitle}</p>)}
      {draft.items.map((item, index) => <AgendaTopic key={`${item.sourceId}:${index}`} index={index} topic={item.topic} quote={item.quote} readOnly={busy} onChange={(topic) => onChange({ ...draft, items: draft.items.map((value, position) => position === index ? { ...value, topic } : value) })} sourceId={item.sourceId} sourceLabel={draft.sources.find((source) => source.id === item.sourceId)?.title ?? item.sourceId} kind={draft.sources.find(source => source.id === item.sourceId)?.kind} removed={Boolean(knownMeetingIds && !knownMeetingIds.has(item.sourceId))} onOpenMeeting={onOpenMeeting} />)}
    </>
  )
}

function AgendaTopic({ index, topic, quote, readOnly, onChange, sourceId, sourceLabel, kind, removed, onOpenMeeting }: { index: number; topic: string; quote: string; readOnly: boolean; onChange: (topic: string) => void; sourceId: string; sourceLabel: string; kind?: 'gmail' | 'slack'; removed: boolean; onOpenMeeting: (id: string) => void }) {
  return (
    <div>
      <label>Topic {index + 1}<textarea readOnly={readOnly} value={topic} onChange={(event) => onChange(event.target.value)} /></label>
      <blockquote>{quote}</blockquote>
      {kind ? <p>Source: {sourceLabel} · {sourceId}</p> : removed ? <p role="status">Source Meeting removed: {sourceLabel}</p> : <Button className="compact-action" onClick={() => onOpenMeeting(sourceId)}>Open Meeting: {sourceLabel}</Button>}
    </div>
  )
}

function AmbiguousCalendarMeetings({ meetings, onOpenMeeting }: { meetings: NonNullable<MeetingAgendaDraft['ambiguousMeetings']>; onOpenMeeting: (id: string) => void }) {
  return <section aria-label="Unconfirmed Calendar matches"><p role="status">Multiple Calendar events overlap these Meetings. Automatic matching remains unconfirmed. Open each Meeting and choose its Calendar event under People in this meeting, then generate again.</p>{meetings.map((meeting) => <Button key={meeting.id} className="compact-action" onClick={() => onOpenMeeting(meeting.id)}>Choose Calendar event: {meeting.title}</Button>)}</section>
}
