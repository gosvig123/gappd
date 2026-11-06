import { useState } from 'react'
import { ChevronDown, Languages } from 'lucide-react'
import type { MeetingDetail } from '../../../shared/contracts'
import { TRANSCRIPTION_LANGUAGES } from '../../../shared/transcription-languages'
import type { ConfirmController } from '../confirm'
import type { AppView } from '../../lib/app-view'
import { meetingHasWork } from './progress'

/**
 * The language of one saved Meeting. Choosing another one transcribes the saved audio again,
 * so it asks first: speaker labels and notes are made again from the new transcript.
 */
export function MeetingLanguage({ view, confirm, meeting, onError }: { view: AppView; confirm: ConfirmController; meeting: MeetingDetail; onError: (message: string) => void }) {
  const current = TRANSCRIPTION_LANGUAGES.find((item) => item.code === meeting.language)
  const [changing, setChanging] = useState(false)
  const busy = changing || meetingHasWork(meeting)
  // A run that failed without a transcript can be retried, also in the same language.
  // A notes failure keeps its transcript segments, so it does not count.
  const retry = meeting.status.processing.state === 'failed' && !meeting.transcriptText && meeting.segments.length === 0
  const choose = (code: string) => {
    const next = TRANSCRIPTION_LANGUAGES.find((item) => item.code === code)
    if (!next || (code === meeting.language && !retry)) return
    confirm.request({
      title: `Transcribe again in ${next.label}?`,
      body: `Gappd makes a new transcript in ${next.label} from the saved audio, then finds the speakers and writes the notes again. Speaker names that you set on this Meeting are cleared. This can take a few minutes.`,
      confirmLabel: 'Transcribe again',
      onConfirm: async () => {
        onError('')
        setChanging(true)
        try { await view.actions.setMeetingLanguage(meeting.id, code) }
        catch (cause) { onError(languageErrorMessage(cause)) }
        finally { setChanging(false) }
      },
    })
  }
  return (
    <label className="ui-button ui-button-secondary compact-action app-panel-language" title={busy ? 'You can change the language after recording and processing finish.' : retry ? 'Transcription failed. Choose a language to try again.' : 'Language of the transcript and notes'}>
      <Languages aria-hidden="true" />
      <span>{current ? current.label : meeting.language || 'Language'}</span>
      <select value={current && !retry ? current.code : ''} disabled={busy || !current} onChange={(event) => choose(event.target.value)} aria-label="Meeting language">
        {current && !retry ? null : <option value="" disabled={retry}>{retry ? 'Try again in…' : meeting.language || 'Language'}</option>}
        {TRANSCRIPTION_LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
      </select>
      <ChevronDown className="app-panel-language-caret" aria-hidden="true" />
    </label>
  )
}

function languageErrorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  const message = raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^(?:Error:\s*)+/, '').trim()
  if (!message) return 'Could not change the language. Try again.'
  return `Could not change the language: ${message.replace(/\.$/, '')}.`
}
