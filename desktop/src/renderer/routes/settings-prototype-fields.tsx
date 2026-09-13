import type { ReactNode } from 'react'
import { TRANSCRIPTION_LANGUAGES } from '../../shared/transcription-languages'

export const categories = ['General', 'Meeting processing', 'Connections'] as const
export type Category = typeof categories[number]
export const initialSettings = { theme: 'Dark', login: false, speakers: true, language: 'en-US', provider: 'Local AI', calendar: false, slack: false }
export type PrototypeState = typeof initialSettings
export type FieldsProps = { state: PrototypeState; change: <K extends keyof PrototypeState>(key: K, value: PrototypeState[K]) => void }

function Row({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return <div className="sp-row"><div><strong>{title}</strong><p>{note}</p></div>{children}</div>
}

function Toggle({ title, note, checked, onChange }: { title: string; note: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <Row title={title} note={note}><button className="sp-toggle" role="switch" aria-label={title} aria-checked={checked} onClick={() => onChange(!checked)}><span /></button></Row>
}

export function GeneralFields({ state, change }: FieldsProps) {
  return <>
    <Row title="Appearance" note="Choose how Gappd looks on this Mac."><select aria-label="Appearance" value={state.theme} onChange={e => change('theme', e.target.value)}>{['System', 'Light', 'Dark'].map(t => <option key={t}>{t}</option>)}</select></Row>
    <Toggle title="Open Gappd at login" note="Start in the background when you sign in." checked={state.login} onChange={v => change('login', v)} />
    <Toggle title="Automatic speaker labels" note="Applies to future Meetings only." checked={state.speakers} onChange={v => change('speakers', v)} />
  </>
}

export function ProcessingFields({ state, change }: FieldsProps) {
  return <>
    <Row title="Transcription language" note="Apple SpeechTranscriber runs on this Mac."><select aria-label="Transcription language" value={state.language} onChange={e => change('language', e.target.value)}>{TRANSCRIPTION_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}</select></Row>
    <Row title="Meeting summaries" note="Choose where transcript text is processed."><select aria-label="Meeting summaries" value={state.provider} onChange={e => change('provider', e.target.value)}><option>Local AI</option><option>Installed Codex</option></select></Row>
    <p className="sp-note">{state.provider === 'Local AI' ? 'Transcript text and recorded audio stay on this Mac.' : 'Transcript text goes through Installed Codex. Recorded audio stays on this Mac. Model setup is not simulated.'} Summary language matches the transcript.</p>
  </>
}

export function ConnectionFields({ state, change }: FieldsProps) {
  return <>
    <Row title="Google Calendar" note={state.calendar ? 'Demo account connected. Calendar access is read-only.' : 'See upcoming events. Recording still starts only when you choose.'}><button onClick={() => change('calendar', !state.calendar)}>{state.calendar ? 'Disconnect demo' : 'Connect demo'}</button></Row>
    <Row title="Slack" note={state.slack ? 'Demo workspace connected.' : 'Optional workspace connection.'}><button onClick={() => change('slack', !state.slack)}>{state.slack ? 'Disconnect demo' : 'Connect demo'}</button></Row>
    <p className="sp-note">Connections are optional. Recording, transcription, and Meeting history work without them.</p>
  </>
}

export function CategoryFields({ category, ...props }: FieldsProps & { category: Category }) {
  if (category === 'General') return <GeneralFields {...props} />
  if (category === 'Meeting processing') return <ProcessingFields {...props} />
  return <ConnectionFields {...props} />
}
