import { useEffect, useRef, useState } from 'react'
import { Bell, X } from 'lucide-react'
import type { MeetingListItem } from '../../shared/contracts'
import type { AlertItem } from '../lib/alerts'
import { meetingHasWork, meetingReady } from './meeting-progress'
import { Button, cx } from './ui'

type MeetingNotice = { id: string; kind: 'ready' | 'working'; title: string; detail: string; meetingId?: string }

/**
 * Transient problems stay transient: they land in this corner stack instead of
 * stacking banners above the content.
 */
export function NotificationStack({ alerts, notices, onDismissAlert, onDismissNotice, onOpenMeeting }: {
  alerts: AlertItem[]
  notices: MeetingNotice[]
  onDismissAlert: (id: string) => void
  onDismissNotice: (id: string) => void
  onOpenMeeting: (id: string) => void
}) {
  if (!alerts.length && !notices.length) return null
  return (
    <div className="app-toasts" role="region" aria-label="Notifications" aria-live="polite">
      {notices.map((notice) => (
        <Toast key={notice.id} title={notice.title} detail={notice.detail} tone={notice.kind === 'ready' ? 'info' : 'info'} action={notice.meetingId ? { label: 'Open', run: () => onOpenMeeting(notice.meetingId as string) } : undefined} onDismiss={() => onDismissNotice(notice.id)} />
      ))}
      {alerts.slice(0, 3).map((alert) => (
        <Toast key={alert.id} title={alert.title} detail={alert.detail} tone={alert.kind} action={alert.actionLabel && alert.run ? { label: alert.actionLabel, run: alert.run } : undefined} onDismiss={alert.kind === 'blocking' ? undefined : () => onDismissAlert(alert.id)} />
      ))}
    </div>
  )
}

function Toast({ title, detail, tone, action, onDismiss }: { title: string; detail?: string; tone: string; action?: { label: string; run: () => void }; onDismiss?: () => void }) {
  return (
    <div className={cx('app-toast', tone)} role="status">
      <Bell aria-hidden="true" />
      <div className="app-toast-copy">
        <strong>{title}</strong>
        {detail ? <p>{detail}</p> : null}
        {action ? <div className="app-toast-action"><Button className="compact-action" onClick={action.run}>{action.label}</Button></div> : null}
      </div>
      {onDismiss ? <button type="button" className="app-icon-action" aria-label={`Dismiss ${title}`} onClick={onDismiss}><X aria-hidden="true" /></button> : null}
    </div>
  )
}

const NOTICE_MS = 7000

/** Announces a Meeting the moment its notes and transcript are both ready. */
export function useMeetingReadyNotices(meetings: MeetingListItem[]): [MeetingNotice[], (id: string) => void] {
  const [notices, setNotices] = useState<MeetingNotice[]>([])
  const previous = useRef<Map<string, { ready: boolean; working: boolean }> | null>(null)
  useEffect(() => {
    const next = new Map(meetings.map((meeting) => [meeting.id, { ready: meetingReady(meeting), working: meetingHasWork(meeting) }]))
    const became = meetings.find((meeting) => { const before = previous.current?.get(meeting.id); return Boolean(before?.working) && !before?.ready && meetingReady(meeting) })
    previous.current = next
    if (!became) return
    setNotices((current) => [...current, readyNotice(became)])
    notifyNative(became)
  }, [meetings])
  useEffect(() => {
    if (!notices.length) return undefined
    const timer = window.setTimeout(() => setNotices((current) => current.slice(1)), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notices])
  return [notices, (id) => setNotices((current) => current.filter((notice) => notice.id !== id))]
}

function readyNotice(meeting: MeetingListItem): MeetingNotice {
  return { id: `ready:${meeting.id}:${meeting.status.updatedAt}`, kind: 'ready', title: 'Notes ready', detail: `${meeting.title || 'Meeting'} summary and transcript are ready.`, meetingId: meeting.id }
}

function notifyNative(meeting: MeetingListItem): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    new Notification('Gappd notes ready', { body: `${meeting.title || 'Meeting'} is ready.` })
  } catch (error) {
    console.warn('native notification failed', error)
  }
}
