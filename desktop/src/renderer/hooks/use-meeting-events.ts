import { useCallback, useEffect, useRef, useState } from 'react'
import type { CalendarEventSummary } from '../../shared/calendar-contract'
import type { MeetingListItem } from '../../shared/contracts'
import type { LinkCalendarInput } from '../../shared/participant-contract'
import { MeetingEventCache } from './meeting-event-cache'

/** Confirmed Calendar links drive workspace row merging. */
export function useMeetingEvents(meetings: MeetingListItem[]) {
  const [events, setEvents] = useState<Map<string, CalendarEventSummary>>(() => new Map())
  const [revision, setRevision] = useState(0)
  const cache = useRef(new MeetingEventCache())
  const signature = meetings.map(meeting => `${meeting.id}:${meeting.status.state}`).join('|')
  const linkCalendar = useCallback((input: LinkCalendarInput) => cache.current.link(input,
    value => window.gappd.meetings.linkCalendar(value),
    next => { setEvents(next); setRevision(current => current + 1) }), [])
  useEffect(() => {
    const current = cache.current
    void current.refresh(meetings.map(meeting => meeting.id), loadCalendarLinks).then(next => { if (next) setEvents(next) })
    return () => current.cancel()
  }, [signature, revision])
  return { events, linkCalendar }
}

async function loadCalendarLinks(): Promise<Record<string, CalendarEventSummary>> {
  try { return await window.gappd.meetings.calendarLinks() }
  catch { return {} }
}
