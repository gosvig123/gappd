import { type RefObject, useEffect, useRef } from 'react'
import { dateLabel, type Entry } from './meetings-calendar-prototype-data'
import './meetings-calendar-prototype-content.css'

export type ContentTab = 'Summary' | 'Transcript' | 'Notes'
export type ContentProps = {
  entry: Entry; note: string; updateNote: (value: string) => void
  topics: string[]; updateTopics: (value: string[]) => void
  tab: ContentTab; setTab: (value: ContentTab) => void
  recording: string | null; record: () => void; close: () => void; open: (id: string) => void
  fullPage: boolean
}

export function MeetingContent(props: ContentProps) {
  const { entry, fullPage, close, recording, record } = props
  const ref = useRef<HTMLElement>(null)
  useContentFocus(ref, entry.id)
  return <section className="mc-document" ref={ref} tabIndex={-1} aria-label={`${entry.title} content`}>
    <div className="mc-document-toolbar"><button onClick={close}>{fullPage ? '← Back to Meetings' : 'Close content'}</button><span>Demo · edits stay in this preview</span></div>
    <header className="mc-document-head"><p>{entry.kind === 'recorded' ? 'Recorded Meeting' : 'Agenda draft'}</p><h2>{entry.title}</h2><span>{dateLabel(entry.day)} at {entry.time} · {entry.people}</span></header>
    {entry.kind === 'recorded' ? <RecordedContent {...props} /> : <AgendaContent {...props} />}
    {entry.kind === 'planned' && <footer className="mc-document-foot"><span>Audio is not captured in this demo.</span><button className="mc-record" disabled={!!recording && recording !== entry.id} onClick={record}>{recording === entry.id ? 'Stop demo recording' : 'Record demo Meeting'}</button></footer>}
  </section>
}

function useContentFocus(ref: RefObject<HTMLElement | null>, id: string) {
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
    ref.current?.scrollIntoView({ block: 'start' })
  }, [id, ref])
}

function AgendaContent({ entry, topics, updateTopics, note, updateNote, open }: ContentProps) {
  const update = (index: number, text: string) => updateTopics(topics.map((topic, i) => i === index ? text : topic))
  return <div className="mc-document-body"><div className="mc-topic-heading"><h3>Topics to discuss</h3><span>{topics.length} topics</span></div>
    <p className="mc-content-muted">{entry.kind === 'draft' ? 'The event has passed. Your saved topics are still editable.' : 'Shape the conversation before it starts. Calendar stays read-only.'}</p>
    <div className="mc-topics">{topics.map((topic, index) => <div className="mc-topic" key={index}><label><span>Topic {index + 1}</span><textarea aria-label={`Topic ${index + 1}`} rows={2} value={topic} onChange={e => update(index, e.target.value)} /></label><button aria-label={`Remove topic ${index + 1}`} onClick={() => updateTopics(topics.filter((_, i) => i !== index))}>×</button></div>)}</div>
    <button className="mc-add-topic" onClick={() => updateTopics([...topics, ''])}>+ Add topic</button>
    <NotesEditor note={note} updateNote={updateNote} label="Preparation notes" />
    <details className="mc-context"><summary>Context from a previous Meeting · demo</summary><p>The last check-in left keyboard navigation to review. Bring the updated flow and confirm who owns the follow-up.</p><button onClick={() => open('standup')}>Open Engineering check-in</button></details>
  </div>
}

function RecordedContent(props: ContentProps) {
  return <><nav className="mc-content-tabs" aria-label="Meeting content">{(['Summary', 'Transcript', 'Notes'] as ContentTab[]).map(tab => <button key={tab} aria-pressed={props.tab === tab} onClick={() => props.setTab(tab)}>{tab}</button>)}</nav><div className="mc-document-body">
    {props.tab === 'Summary' ? <MeetingSummary {...props} /> : props.tab === 'Transcript' ? <Transcript /> : <NotesEditor note={props.note} updateNote={props.updateNote} label="Meeting notes" />}
  </div></>
}

function MeetingSummary({ entry, topics, setTab }: ContentProps) {
  return <div className="mc-reading"><h3>Summary</h3><p className="mc-summary-lead">{entry.note}</p><h3>Decisions</h3><p>Keep local recording available without Calendar. Review the remaining interaction details before the next release.</p><h3>Next steps</h3><ul><li>Alex will prepare an updated walkthrough.</li><li>Review keyboard navigation at the next check-in.</li><li>Confirm the owner and date for each remaining task.</li></ul>
    <details className="mc-context"><summary>Planning topics retained with this demo</summary><ul>{topics.map((topic, i) => <li key={i}>{topic || 'Untitled topic'}</li>)}</ul></details><button onClick={() => setTab('Notes')}>Add your notes</button><p className="mc-content-muted">Illustrative summary content. No AI processing was run.</p>
  </div>
}

function Transcript() {
  const turns = [
    ['00:08', 'Alex', 'The updated flow is ready for review. The main question is how much context should remain visible while someone edits an Agenda.'],
    ['00:32', 'You', 'The content needs room. I want to read a summary or prepare topics without working in a narrow panel.'],
    ['01:04', 'Sam', 'Keep the list simple, then give the selected Meeting most of the window. We should also try a full page.'],
    ['01:38', 'Alex', 'I will prepare the walkthrough. We can compare it with an inline version and confirm the next step.'],
    ['02:10', 'You', 'Let’s check a narrow window and keyboard navigation before we choose.'],
  ]
  return <div className="mc-reading"><h3>Transcript</h3><p className="mc-content-muted">Illustrative demo excerpt · not real audio</p>{turns.map(([time, speaker, text]) => <div className="mc-turn" key={time}><div><time>{time}</time><strong>{speaker}</strong></div><p>{text}</p></div>)}</div>
}

function NotesEditor({ note, updateNote, label }: { note: string; updateNote: (value: string) => void; label: string }) {
  return <label className="mc-writing"><span>{label}</span><textarea aria-label={label} value={note} rows={8} placeholder="Write questions, decisions, or follow-up notes…" onChange={e => updateNote(e.target.value)} /></label>
}
