import { Trash2 } from 'lucide-react'
import { meetingStatusPillVisible, meetingStatusTone } from '../../../shared/meeting-recording-workflow'
import type { MeetingListItem } from '../../../shared/contracts'
import { meetingHasWork } from '../../components/meeting-progress'
import { StatusPill, cx } from '../../components/ui'
import { artifactLine, statusLabel } from '../contract'
import { meetingDurationLabel, meetingTimeLabel } from '../grouping'
import { InlineConfirm } from './b-inline-confirm'

export type MeetingRowProps = {
  meeting: MeetingListItem
  open: boolean
  highlighted: boolean
  pending: boolean
  reason?: string
  onOpen: () => void
  onHighlight: () => void
  onRequestDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  register: (element: HTMLButtonElement | null) => void
}

/** Dense two-line row: title, then time, duration, artifact state, and a status pill when it matters. */
export function MeetingRow(props: MeetingRowProps) {
  const { meeting, open, highlighted, pending, reason, onOpen, onHighlight, register } = props
  if (pending) return <li className="vb-row-item"><InlineConfirm question={`Delete “${meeting.title || 'Untitled meeting'}”?`} detail="Notes, transcript, speaker labels, and audio go too." confirmLabel="Delete" onConfirm={props.onConfirmDelete} onCancel={props.onCancelDelete} /></li>
  return (
    <li className="vb-row-item">
      <button ref={register} type="button" className={cx('vb-row', open && 'is-open', highlighted && 'is-highlighted')} aria-current={open ? 'true' : undefined} onClick={onOpen} onFocus={onHighlight}>
        <span className="vb-row-head">
          <span className="vb-row-title">{meeting.title || 'Untitled meeting'}</span>
          {meetingStatusPillVisible(meeting.status.state) ? <StatusPill tone={meetingStatusTone(meeting.status.state)}>{statusLabel(meeting)}</StatusPill> : null}
        </span>
        <RowMeta meeting={meeting} reason={reason} />
      </button>
      {meetingHasWork(meeting) ? null : (
        <button type="button" className="vb-row-delete" aria-label={`Delete ${meeting.title || 'meeting'}`} onClick={props.onRequestDelete}><Trash2 aria-hidden="true" /></button>
      )}
    </li>
  )
}

function RowMeta({ meeting, reason }: { meeting: MeetingListItem; reason?: string }) {
  return (
    <span className="vb-row-meta">
      <span>{meetingTimeLabel(meeting)}</span>
      <span aria-hidden="true">·</span>
      <span>{meetingDurationLabel(meeting)}</span>
      <span aria-hidden="true">·</span>
      <span className="vb-row-artifact">{reason ?? artifactLine(meeting)}</span>
    </span>
  )
}
