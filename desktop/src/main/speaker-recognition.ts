import { requestCommand } from './app-protocol'
import { withSavedCalendarContexts } from './participant-calendar'
import type { ParticipantContext } from '../shared/participant-contract'

// This processing hook runs before summary claims and at startup/retry, never on a view read.
export async function recognizePendingSpeakers(signal?: AbortSignal): Promise<void> {
  await withSavedCalendarContexts(async contexts => {
    let after = ''
    while (true) {
      const { targets } = await requestCommand('meetings.voiceTargets', { after }, {}, signal)
      if (!targets.length) return
      for (const target of targets) {
        try {
          const constraint = speakerConstraint(contexts[target.id])
          await requestCommand('meetings.recognizeSpeakers', { ...target, ...constraint }, {}, signal)
        } catch (error) {
          if (signal?.aborted) throw error
          console.error(`Recognize speakers for Meeting ${target.id}: skipped; manual labeling remains available.`, error)
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
