import type { CalendarParticipant, CalendarSnapshot, GmailThread, GoogleAccess } from '../../shared/calendar-contract'
import { mapGoogleEvent, type GoogleEventItem } from './calendar-model'

const CONNECTION_ID = 'synthetic-calendar'
const ACCOUNT = 'you@example.test'
const people = {
  avery: { email: 'avery.chen@example.test', displayName: 'Avery Chen' },
  jordan: { email: 'jordan.patel@example.test', displayName: 'Jordan Patel' },
  sam: { email: 'sam.rivera@example.test', displayName: 'Sam Rivera' },
  morgan: { email: 'morgan.lee@example.test', displayName: 'Morgan Lee' },
  riley: { email: 'riley.brooks@example.test', displayName: 'Riley Brooks' },
}

/**
 * Fictional calendar for a selected-fixture development session, so UI reviews see a
 * realistic day. Times follow the clock: one event is over, the rest are still ahead.
 * Items use Google's event shape and the production mapper.
 */
export function selectedFixtureCalendar(access: GoogleAccess[] = [], now = new Date()): CalendarSnapshot {
  const slot = new Date(now)
  slot.setMinutes(slot.getMinutes() < 30 ? 30 : 60, 0, 0)
  const at = (hours: number, minutes: number) => {
    const start = new Date(slot.getTime() + hours * 3_600_000)
    return { start: { dateTime: start.toISOString() }, end: { dateTime: new Date(start.getTime() + minutes * 60_000).toISOString() } }
  }
  const self = { email: ACCOUNT, self: true, responseStatus: 'accepted' }
  const items: GoogleEventItem[] = [
    { id: 'design-critique', summary: 'Design critique', ...at(-3, 30), location: 'https://meet.google.com/abc-defg-hij', attendees: [self, people.avery, people.morgan] },
    { id: 'advisor-sync', summary: 'Advisor sync', ...at(0, 30), location: 'https://meet.google.com/qwe-rtyu-iop', attendees: [self, people.jordan, people.sam] },
    { id: 'interview', summary: 'Interview: senior engineer', ...at(1, 45), location: 'Google Meet (instructions in description)', attendees: [self, people.riley] },
    { id: 'roadmap', summary: 'Roadmap planning', ...at(2.5, 60), location: 'Room 4B', attendees: [self, people.avery, people.jordan, people.sam, people.morgan] },
    { id: 'tomorrow-standup', summary: 'Team standup', ...at(24, 15), location: 'https://meet.google.com/zxc-vbnm-asd', attendees: [self, people.avery, people.riley] },
  ]
  const events = items.flatMap((item) => mapGoogleEvent({ status: 'confirmed', organizer: people.jordan, ...item }, CONNECTION_ID, ACCOUNT) ?? [])
  return { configured: true, connections: [{ id: CONNECTION_ID, email: ACCOUNT, status: 'ready', lastSyncedAt: now.toISOString(), access }], events, availableAccess: access }
}

/** Fictional saved Google contacts for a selected-fixture session: invitees plus people never invited. */
export function selectedFixtureContacts(): CalendarParticipant[] {
  return [
    ...Object.values(people).map((person) => ({ email: person.email, name: person.displayName })),
    { email: 'casey.nguyen@example.test', name: 'Casey Nguyen' },
    { email: 'drew.okafor@example.test', name: 'Drew Okafor' },
    { email: 'support@example.test' },
  ]
}

/** Fictional Gmail threads for a selected-fixture session; an unknown address has none. */
export function selectedFixtureGmailThreads(email: string, now = new Date()): GmailThread[] {
  const person = Object.values(people).find((item) => item.email === email.toLowerCase())
  if (!person) return []
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString()
  const first = person.displayName.split(' ')[0]
  return [
    { accountEmail: ACCOUNT, threadId: '18f0a1b2c3d4e5f1', subject: 'Notes from our last call', from: `${person.displayName} <${person.email}>`, date: daysAgo(1), snippet: `Thanks for the time today, ${first} here. I added the two open questions to the doc.`, messageCount: 3 },
    { accountEmail: ACCOUNT, threadId: '18f0a1b2c3d4e5f2', subject: 'Agenda for next week', from: `You <${ACCOUNT}>`, date: daysAgo(4), snippet: 'Here is a first draft of the agenda. Let me know what to add before Thursday.', messageCount: 2 },
    { accountEmail: ACCOUNT, threadId: '18f0a1b2c3d4e5f3', subject: 'Intro', from: `${person.displayName} <${person.email}>`, date: daysAgo(21), snippet: 'Great to meet you at the offsite. Sharing the deck we talked about.', messageCount: 1 },
  ]
}
