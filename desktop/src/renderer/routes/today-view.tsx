import type { Device, MeetingListItem, RecordingStatus } from '../../shared/contracts'
import { CaptureCard, EmptyInbox, LatestCard, QueueSection } from './today-cards'
import './today.css'
import { buildQueues } from './today-model'

type TodayViewProps = {
  title: string
  device: number
  devices: Device[]
  meetings: MeetingListItem[]
  recordingStatus: RecordingStatus
  latestMeeting: MeetingListItem | null
  canStart: boolean
  canStop: boolean
  onTitleChange: (value: string) => void
  onDeviceChange: (value: number) => void
  onStart: () => void
  onStop: () => void
  onOpenMeeting: (id: string) => void
}

export function TodayView(props: TodayViewProps) {
  const queues = buildQueues(props.meetings)
  const hasMeetings = props.meetings.length > 0
  return (
    <>
      <div className="inbox-primary">
        <CaptureCard {...props} />
        {hasMeetings ? <QueueSection title="Needs review" empty="No notes ready for review." meetings={queues.needsReview} onOpenMeeting={props.onOpenMeeting} /> : <EmptyInbox />}
        {hasMeetings ? <QueueSection title="Processing" empty="No meetings processing." meetings={queues.processing} onOpenMeeting={props.onOpenMeeting} /> : null}
      </div>
      {hasMeetings && props.latestMeeting ? (
        <aside className="inbox-side">
          <LatestCard meeting={props.latestMeeting} onOpenMeeting={props.onOpenMeeting} />
          <QueueSection title="Recent saved" empty="No saved meetings yet." meetings={queues.recent} onOpenMeeting={props.onOpenMeeting} />
        </aside>
      ) : null}
    </>
  )
}
