import type { AgendaSource } from '../shared/meeting-agenda'

export type CommunicationSource = AgendaSource & { kind: 'gmail' | 'slack'; text: string }
export type AgendaCommunication = { sources: CommunicationSource[]; warning?: string; assertCurrent?: () => void }
export const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
export const COMMUNICATION_DAYS = 30

export async function communicationJSON(response: Response): Promise<any> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Communication service returned an empty response. Try again.')
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 1024 * 1024) throw new Error('Response too large')
      chunks.push(value)
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid response shape')
    return value
  } catch {
    throw new Error('Communication service returned invalid or oversized data. No draft was generated.')
  } finally { await reader.cancel().catch(() => undefined) }
}

export const FOLLOW_UP_DAYS = 7
/** Milliseconds. A number means "the 30 days before this time"; a range sets both ends. */
export type CommunicationPeriod = number | { from: number; until: number }

export function communicationWindow(period: CommunicationPeriod): { oldest: number; latest: number; label: string } {
  if (typeof period === 'number') {
    if (!Number.isFinite(period)) throw new Error('Invalid agenda communication date.')
    const latest = Math.floor(Math.min(period, Date.now()) / 1000)
    return { oldest: latest - COMMUNICATION_DAYS * 86400, latest, label: `from the last ${COMMUNICATION_DAYS} days` }
  }
  if (!Number.isFinite(period.from) || !Number.isFinite(period.until) || period.from > period.until) throw new Error('Invalid communication period.')
  const latest = Math.floor(Math.min(period.until, Date.now()) / 1000)
  return { oldest: Math.floor(period.from / 1000), latest, label: 'from the read period' }
}

/** 30 days before the Meeting starts until 7 days after it ends. */
export function meetingCommunicationPeriod(startedAt: string, endedAt?: string): { from: number; until: number } {
  const start = Date.parse(startedAt)
  const end = endedAt ? Date.parse(endedAt) : start
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Read Meeting communication: the Meeting has an invalid date.')
  return { from: start - COMMUNICATION_DAYS * 86400_000, until: Math.max(start, end) + FOLLOW_UP_DAYS * 86400_000 }
}

export function communicationEmails(emails: string[]): string[] {
  const values = [...new Set(emails.map(email => email.trim().toLowerCase()))]
  if (values.length > 30 || values.some(email => !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email))) {
    throw new Error('Agenda communication needs valid invitee email addresses and at most 30 invitees.')
  }
  return values
}
