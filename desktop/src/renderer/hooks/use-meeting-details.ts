import { useCallback, useEffect, useState } from 'react'
import type { MeetingDetail, MeetingListItem } from '../../shared/contracts'

const cache = new Map<string, MeetingDetail>()

/**
 * Loads every Meeting detail once per revision so search and tables can use real content.
 * Also returns `remember`, which stores a newer detail for a Meeting that is not open.
 */
export function useMeetingDetails(meetings: MeetingListItem[], selected: MeetingDetail | null): [Map<string, MeetingDetail>, (detail: MeetingDetail) => void] {
  const [details, setDetails] = useState<Map<string, MeetingDetail>>(new Map())
  const signature = meetings.map(keyOf).join('|')
  useEffect(() => {
    let active = true
    void load(meetings).then((next) => { if (active) setDetails(next) })
    return () => { active = false }
  }, [signature])
  // A speaker label does not change the revision, so a newer detail replaces the cached one.
  const remember = useCallback((detail: MeetingDetail) => {
    cache.set(keyOf(detail), detail)
    setDetails((current) => current.has(detail.id) && current.get(detail.id) !== detail ? new Map(current).set(detail.id, detail) : current)
  }, [])
  useEffect(() => { if (selected) remember(selected) }, [selected, remember])
  return [details, remember]
}

async function load(meetings: MeetingListItem[]): Promise<Map<string, MeetingDetail>> {
  const stale = meetings.filter((meeting) => !cache.has(keyOf(meeting)))
  const fetched = await Promise.all(stale.map(fetchDetail))
  for (const detail of fetched) if (detail) cache.set(keyOf(detail), detail)
  const next = new Map<string, MeetingDetail>()
  for (const meeting of meetings) next.set(meeting.id, cache.get(keyOf(meeting)) ?? fallbackDetail(meeting))
  return next
}

async function fetchDetail(meeting: MeetingListItem): Promise<MeetingDetail | null> {
  try { return await window.gappd.meetings.show(meeting.id) } catch { return null }
}

function keyOf(meeting: Pick<MeetingListItem, 'id' | 'status'>): string {
  return `${meeting.id}:${meeting.status.updatedAt}`
}

function fallbackDetail(meeting: MeetingListItem): MeetingDetail {
  return { id: meeting.id, title: meeting.title, startedAt: meeting.startedAt, endedAt: meeting.endedAt, status: meeting.status, transcriptProvisional: false, speakers: [], summaryUpdating: false, segments: [], diarization: { state: 'not_requested' } }
}
