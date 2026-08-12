import { useEffect, useRef, useState } from 'react'
import type { MeetingListItem } from '../../shared/contracts'
import { Button } from './ui'
import { CircleDotIcon, CircleCheckIcon } from './icons'
import { meetingHasWork, meetingReady } from './meeting-progress'
import './meeting-announcements.css'

type MeetingNotice = {
  id: string
  title: string
  message: string
  meetingId?: string
  tone: 'working' | 'ready'
}

type MeetingAnnouncementsProps = {
  meetings: MeetingListItem[]
  onOpenMeeting: (id: string) => void
}

type MeetingSnapshot = { ready: boolean; working: boolean }

const TOAST_MS = 7000
export function MeetingAnnouncements({ meetings, onOpenMeeting }: MeetingAnnouncementsProps) {
  const [notice, setNotice] = useState<MeetingNotice | null>(null)
  useCompletionNotice(meetings, setNotice)
  useAutoDismiss(notice, setNotice)
  if (!notice) return null
  return <MeetingToast notice={notice} onDismiss={() => setNotice(null)} onOpenMeeting={onOpenMeeting} />
}

function MeetingToast({ notice, onDismiss, onOpenMeeting }: { notice: MeetingNotice; onDismiss: () => void; onOpenMeeting: (id: string) => void }) {
  const meetingId = notice.meetingId
  const ToastIcon = notice.tone === 'ready' ? CircleCheckIcon : CircleDotIcon
  return (
    <div className={`meeting-toast ${notice.tone}`} role="status" aria-live="polite">
      <div className="meeting-toast-body"><ToastIcon aria-hidden="true" /><div><strong>{notice.title}</strong><p>{notice.message}</p></div></div>
      <div className="meeting-toast-actions">{meetingId ? <Button className="compact-action" onClick={() => onOpenMeeting(meetingId)}>Open</Button> : null}<Button className="compact-action" onClick={onDismiss}>Dismiss</Button></div>
    </div>
  )
}

function useCompletionNotice(meetings: MeetingListItem[], setNotice: (notice: MeetingNotice) => void) {
  const previous = useRef<Map<string, MeetingSnapshot> | null>(null)
  useEffect(() => {
    const next = meetingSnapshots(meetings)
    const completed = completedMeeting(meetings, previous.current)
    previous.current = next
    if (!completed) return
    setNotice(completionNotice(completed))
    notifyNative(completed)
  }, [meetings, setNotice])
}

function useAutoDismiss(notice: MeetingNotice | null, setNotice: (notice: MeetingNotice | null) => void) {
  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(null), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [notice?.id, setNotice])
}

function completionNotice(meeting: MeetingListItem): MeetingNotice {
  return { id: `ready:${meeting.id}:${meeting.status.updatedAt}`, title: 'Notes ready', message: `${meeting.title || 'Meeting'} summary and transcript are ready.`, meetingId: meeting.id, tone: 'ready' }
}

function completedMeeting(meetings: MeetingListItem[], previous: Map<string, MeetingSnapshot> | null): MeetingListItem | null {
  if (!previous) return null
  return meetings.find((meeting) => becameReady(meeting, previous.get(meeting.id))) ?? null
}

function becameReady(meeting: MeetingListItem, previous: MeetingSnapshot | undefined): boolean {
  if (!previous?.working || previous.ready) return false
  return meetingReady(meeting)
}

function meetingSnapshots(meetings: MeetingListItem[]): Map<string, MeetingSnapshot> {
  return new Map(meetings.map((meeting) => [meeting.id, meetingSnapshot(meeting)]))
}

function meetingSnapshot(meeting: MeetingListItem): MeetingSnapshot {
  return { ready: meetingReady(meeting), working: meetingHasWork(meeting) }
}

function notifyNative(meeting: MeetingListItem) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    new Notification('Gappd notes ready', { body: `${meeting.title || 'Meeting'} is ready.` })
  } catch (error) {
    console.warn('native notification failed', error)
  }
}
