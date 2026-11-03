import { requestCommand } from './app-protocol'
import { withSavedCalendarContexts } from './participant-calendar'
import type { ParticipantContext } from '../shared/participant-contract'
import { logFailure } from './error-log'

// The drain coordinator runs this as its own step, never on a view read. It returns false when a
// Meeting failed, so the coordinator repeats the pass later. The backend skips a Meeting that
// changed after it was listed: the change that moved it asks for recognition again.
export async function recognizePendingSpeakers(signal?: AbortSignal): Promise<boolean> {
  return withSavedCalendarContexts(async contexts => {
    let complete = true
    let after = ''
    while (true) {
      const { targets } = await requestCommand('meetings.voiceTargets', { after }, {}, signal)
      if (!targets.length) return complete
      for (const target of targets) {
        try {
          const constraint = speakerConstraint(contexts[target.id])
          await requestCommand('meetings.recognizeSpeakers', { ...target, ...constraint }, {}, signal)
        } catch (error) {
          if (signal?.aborted) throw error
          complete = false
          logFailure('speakers.recognize', `Recognize speakers for Meeting ${target.id}: skipped; manual labeling remains available.`, error)
        }
      }
      after = targets[targets.length - 1].id
    }
  })
}

export function speakerConstraint(context?: ParticipantContext): { calendar: boolean; emails: string } {
  const event = context?.event
  if (!event) return { calendar: false, emails: '' }
  const self = event.accountEmail.trim().toLowerCase()
  const emails = [...new Set((event.attendees ?? []).filter(person => !person.self)
    .map(person => person.email.trim().toLowerCase()).filter(email => email && email !== self))]
  if (emails.length > 100 || emails.some(email => email.length > 254 || email.includes(','))) {
    throw new Error('Recognize speakers: Calendar invitee list exceeds supported limits. Choose speaker labels manually.')
  }
  return { calendar: true, emails: emails.join(',') }
}
