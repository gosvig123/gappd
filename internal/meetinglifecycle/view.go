package meetinglifecycle

import "github.com/gappd-dev/gappd/internal/db"

// MeetingState is the single user-facing lifecycle state derived from the
// capture and processing statuses stored on a meeting.
type MeetingState string

type MeetingStatusTone string

type View struct {
	State     MeetingState
	UpdatedAt string
}

const (
	MeetingStateRecording  MeetingState = "recording"
	MeetingStatePending    MeetingState = "pending"
	MeetingStateProcessing MeetingState = "processing"
	MeetingStateCompleted  MeetingState = "completed"
	MeetingStateFailed     MeetingState = "failed"

	MeetingStatusToneRecording  MeetingStatusTone = "recording"
	MeetingStatusToneProcessing MeetingStatusTone = "processing"
	MeetingStatusToneIdle       MeetingStatusTone = "idle"
	MeetingStatusToneError      MeetingStatusTone = "error"
)

// The All* slices are the source of truth for generated TypeScript lifecycle types.
var (
	AllMeetingStates      = []MeetingState{MeetingStateRecording, MeetingStatePending, MeetingStateProcessing, MeetingStateCompleted, MeetingStateFailed}
	AllMeetingStatusTones = []MeetingStatusTone{MeetingStatusToneRecording, MeetingStatusToneProcessing, MeetingStatusToneIdle, MeetingStatusToneError}
)

// ViewFor derives the user-facing Meeting Lifecycle view.
func ViewFor(meeting db.Meeting) View {
	return View{State: MeetingStateFor(meeting), UpdatedAt: meetingLifecycleUpdatedAt(meeting)}
}

// MeetingStateFor derives the user-facing state: capture outcomes win over
// processing outcomes, and a capture in progress masks processing entirely.
func MeetingStateFor(meeting db.Meeting) MeetingState {
	switch {
	case meeting.CaptureStatus == db.CaptureStatusFailed:
		return MeetingStateFailed
	case meeting.CaptureStatus == db.CaptureStatusRecording:
		return MeetingStateRecording
	case meeting.ProcessingStatus == db.ProcessingStatusFailed:
		return MeetingStateFailed
	case meeting.ProcessingStatus == db.ProcessingStatusProcessing:
		return MeetingStateProcessing
	case meeting.ProcessingStatus == db.ProcessingStatusCompleted:
		return MeetingStateCompleted
	default:
		return MeetingStatePending
	}
}

func MeetingStatusToneFor(state MeetingState) MeetingStatusTone {
	switch state {
	case MeetingStateRecording:
		return MeetingStatusToneRecording
	case MeetingStateProcessing:
		return MeetingStatusToneProcessing
	case MeetingStateFailed:
		return MeetingStatusToneError
	default:
		return MeetingStatusToneIdle
	}
}

func meetingLifecycleUpdatedAt(meeting db.Meeting) string {
	if usesProcessingTimestamp(meeting) {
		return meeting.ProcessingStatusUpdatedAt
	}
	return meeting.CaptureStatusUpdatedAt
}

func usesProcessingTimestamp(meeting db.Meeting) bool {
	state := MeetingStateFor(meeting)
	return meeting.ProcessingStatus == db.ProcessingStatusFailed || state == MeetingStateProcessing || state == MeetingStateCompleted
}
