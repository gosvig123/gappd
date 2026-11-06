import { Languages } from 'lucide-react'
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
  const busy = meetingHasWork(meeting)
  const choose = (code: string) => {
    const next = TRANSCRIPTION_LANGUAGES.find((item) => item.code === code)
    if (!next || code === meeting.language) return
    confirm.request({
      title: `Transcribe again in ${next.label}?`,
      body: `Gappd makes a new transcript in ${next.label} from the saved audio, then finds the speakers and writes the notes again. Speaker names that you set on this Meeting are cleared. This can take a few minutes.`,
      confirmLabel: 'Transcribe again',
      onConfirm: async () => {
        onError('')
        try { await view.actions.setMeetingLanguage(meeting.id, code) }
        catch (cause) { onError(languageErrorMessage(cause)) }
      },
    })
  }
  return (
    <label className="app-panel-language" title={busy ? 'You can change the language after recording and processing finish.' : 'Language of the transcript and notes'}>
      <Languages aria-hidden="true" />
      <select value={current ? current.code : ''} disabled={busy || !current} onChange={(event) => choose(event.target.value)} aria-label="Meeting language">
        {current ? null : <option value="">{meeting.language || 'Language'}</option>}
        {TRANSCRIPTION_LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
      </select>
    </label>
  )
}

function languageErrorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  const message = raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^(?:Error:\s*)+/, '').trim()
  if (!message) return 'Could not change the language. Try again.'
  return `Could not change the language: ${message.replace(/\.$/, '')}.`
}
