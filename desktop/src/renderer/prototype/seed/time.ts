/** Relative-time helpers so seeded data always looks current. */

const DAY_MS = 24 * 60 * 60 * 1000

export function at(dayOffset: number, hour: number, minute = 0): Date {
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  date.setDate(date.getDate() + dayOffset)
  return date
}

export function minutesLater(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60 * 1000)
}

export function dayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function clockLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

export function relativeLabel(date: Date, now = new Date()): string {
  const days = Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS)
  if (days === 0) return clockLabel(date)
  if (days === -1) return 'Yesterday'
  if (days > -7) return date.toLocaleDateString(undefined, { weekday: 'long' })
  return dayLabel(date)
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}
