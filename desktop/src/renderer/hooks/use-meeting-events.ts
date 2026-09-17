import { useCallback, useEffect, useRef, useState } from 'react'
import type { CalendarEventSummary, CalendarSnapshot } from '../../shared/calendar-contract'
import type { MeetingListItem } from '../../shared/contracts'
import type { LinkCalendarInput } from '../../shared/participant-contract'
import { MeetingEventCache } from './meeting-event-cache'

/** Shared confirmed links drive both Agenda content and workspace row merging. */
export function useMeetingEvents(meetings: MeetingListItem[], calendar: CalendarSnapshot | null) {
  const [events, setEvents] = useState<Map<string, CalendarEventSummary>>(() => new Map())
  const [revision, setRevision] = useState(0)
  const cache = useRef(new MeetingEventCache())
  const signature = `${meetings.map(meeting => meeting.id).join('|')}::${calendar?.events.length ?? 0}:${calendar?.connections.length ?? 0}`
  const linkCalendar = useCallback((input: LinkCalendarInput) => cache.current.link(input,
    value => window.gappd.meetings.linkCalendar(value),
    next => { setEvents(next); setRevision(current => current + 1) }), [])
  useEffect(() => {
    const current = cache.current
    void current.refresh(meetings.map(meeting => meeting.id), linkedEvent).then(next => { if (next) setEvents(next) })
    return () => current.cancel()
  }, [signature, revision])
  return { events, linkCalendar }
}

async function linkedEvent(meetingId: string): Promise<CalendarEventSummary | undefined> {
  try { return (await window.gappd.meetings.participantContext(meetingId)).event }
  catch { return undefined }
}
