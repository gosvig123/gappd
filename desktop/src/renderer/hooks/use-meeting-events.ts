import { useEffect, useState } from 'react'
import type { CalendarEventSummary, CalendarSnapshot } from '../../shared/calendar-contract'
import type { MeetingListItem } from '../../shared/contracts'

/**
 * Resolves the Calendar event behind each Meeting through the real
 * `meetings:participantContext` operation, so the Agenda tab reflects a
 * confirmed link rather than a guess made in the renderer.
 */
export function useMeetingEvents(meetings: MeetingListItem[], calendar: CalendarSnapshot | null): Map<string, CalendarEventSummary> {
  const [events, setEvents] = useState<Map<string, CalendarEventSummary>>(() => new Map())
  const signature = `${meetings.map((meeting) => meeting.id).join('|')}::${calendar?.events.length ?? 0}:${calendar?.connections.length ?? 0}`
  useEffect(() => {
    let active = true
    void resolve(meetings).then((next) => { if (active) setEvents(next) })
    return () => { active = false }
  }, [signature])
  return events
}

async function resolve(meetings: MeetingListItem[]): Promise<Map<string, CalendarEventSummary>> {
  const pairs = await Promise.all(meetings.map(async (meeting) => [meeting.id, await linkedEvent(meeting.id)] as const))
  return new Map(pairs.filter((pair): pair is [string, CalendarEventSummary] => Boolean(pair[1])))
}

async function linkedEvent(meetingId: string): Promise<CalendarEventSummary | undefined> {
  try {
    const context = await window.gappd.meetings.participantContext(meetingId)
    return context.event
  } catch {
    return undefined
  }
}
