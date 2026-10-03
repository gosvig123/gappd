import type { CalendarSnapshot } from '../shared/calendar-contract'
import { mapGoogleEvent, type GoogleEventItem } from './google-calendar-model'

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
export function selectedFixtureCalendar(now = new Date()): CalendarSnapshot {
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
  return { configured: true, connections: [{ id: CONNECTION_ID, email: ACCOUNT, status: 'ready', lastSyncedAt: now.toISOString() }], events }
}
