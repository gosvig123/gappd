export const PROTOTYPE_VARIANTS = ['A', 'B', 'C'] as const
export type PrototypeVariant = (typeof PROTOTYPE_VARIANTS)[number]
export type ConnectionStep = 'disconnected' | 'selecting' | 'connected'
export type CalendarKey = 'work' | 'personal' | 'team'

export type PrototypeCalendar = {
  id: CalendarKey
  name: string
  account: string
  color: string
}

export type PrototypeEvent = {
  id: string
  calendarId: CalendarKey
  time: string
  duration: string
  title: string
  people: string
  location: string
}

export type CalendarPrototypeProps = {
  step: ConnectionStep
  selected: CalendarKey[]
  recordingId: string | null
  onConnect: () => void
  onToggleCalendar: (id: CalendarKey) => void
  onFinishSelection: () => void
  onDisconnect: () => void
  onRecord: (id: string) => void
}

export const PROTOTYPE_CALENDARS: PrototypeCalendar[] = [
  { id: 'work', name: 'Work', account: 'krisitan@gappd.dev', color: '#699fe5' },
  { id: 'personal', name: 'Personal', account: 'krisitan@gmail.com', color: '#d68fb8' },
  { id: 'team', name: 'Gappd team', account: 'Shared calendar', color: '#79b89a' },
]

export const PROTOTYPE_EVENTS: PrototypeEvent[] = [
  { id: 'product', calendarId: 'work', time: '10:00', duration: '45 min', title: 'Product review', people: 'Maya, Jonas + 3', location: 'Google Meet' },
  { id: 'customer', calendarId: 'work', time: '11:30', duration: '30 min', title: 'Customer call · Northstar', people: 'Alicia Romero', location: 'Google Meet' },
  { id: 'dentist', calendarId: 'personal', time: '14:00', duration: '1 hr', title: 'Dentist', people: 'Private', location: 'Vesterbro' },
  { id: 'planning', calendarId: 'team', time: '16:00', duration: '45 min', title: 'Gappd weekly planning', people: 'Team', location: 'Google Meet' },
]

export function visibleEvents(selected: CalendarKey[]): PrototypeEvent[] {
  return PROTOTYPE_EVENTS.filter((event) => selected.includes(event.calendarId))
}

export function calendarFor(id: CalendarKey): PrototypeCalendar {
  return PROTOTYPE_CALENDARS.find((calendar) => calendar.id === id) ?? PROTOTYPE_CALENDARS[0]
}
