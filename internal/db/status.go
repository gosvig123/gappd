package db

// MeetingState is the single user-facing lifecycle state derived from the
// capture and processing statuses stored on a meeting.
type MeetingState string

type MeetingStatusTone string

type MeetingLifecycleStatus struct {
	State     MeetingState
	UpdatedAt string
}

const (
	MeetingStateRecording  MeetingState = "recording"
	MeetingStateCaptured   MeetingState = "captured"
	MeetingStateProcessing MeetingState = "processing"
	MeetingStateCompleted  MeetingState = "completed"
	MeetingStateFailed     MeetingState = "failed"

	MeetingStatusToneRecording  MeetingStatusTone = "recording"
	MeetingStatusToneProcessing MeetingStatusTone = "processing"
	MeetingStatusToneIdle       MeetingStatusTone = "idle"
	MeetingStatusToneError      MeetingStatusTone = "error"
)

// The All* slices are the canonical enumerations of each status enum. They are
// the source of truth for the generated TypeScript protocol (cmd/gen-protocol);
// keep them in sync with the schema CHECK constraints.
var (
	AllCaptureStatuses    = []CaptureStatus{CaptureStatusRecording, CaptureStatusCaptured, CaptureStatusFailed}
	AllProcessingStatuses = []ProcessingStatus{ProcessingStatusNotStarted, ProcessingStatusProcessing, ProcessingStatusCompleted, ProcessingStatusFailed}
	AllMeetingStates      = []MeetingState{MeetingStateRecording, MeetingStateCaptured, MeetingStateProcessing, MeetingStateCompleted, MeetingStateFailed}
	AllMeetingStatusTones = []MeetingStatusTone{MeetingStatusToneRecording, MeetingStatusToneProcessing, MeetingStatusToneIdle, MeetingStatusToneError}
)

// MeetingLifecycleStatusFor derives the user-facing Meeting Lifecycle state.
func MeetingLifecycleStatusFor(meeting Meeting) MeetingLifecycleStatus {
	return MeetingLifecycleStatus{State: MeetingStateFor(meeting), UpdatedAt: meetingLifecycleUpdatedAt(meeting)}
}

// MeetingStateFor derives the user-facing state: capture outcomes win over
// processing outcomes, and a capture in progress masks processing entirely.
func MeetingStateFor(meeting Meeting) MeetingState {
	switch {
	case meeting.CaptureStatus == CaptureStatusFailed:
		return MeetingStateFailed
	case meeting.CaptureStatus == CaptureStatusRecording:
		return MeetingStateRecording
	case meeting.ProcessingStatus == ProcessingStatusFailed:
		return MeetingStateFailed
	case meeting.ProcessingStatus == ProcessingStatusProcessing:
		return MeetingStateProcessing
	case meeting.ProcessingStatus == ProcessingStatusCompleted:
		return MeetingStateCompleted
	default:
		return MeetingStateCaptured
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

func meetingLifecycleUpdatedAt(meeting Meeting) string {
	if usesProcessingTimestamp(meeting) {
		return meeting.ProcessingStatusUpdatedAt
	}
	return meeting.CaptureStatusUpdatedAt
}

func usesProcessingTimestamp(meeting Meeting) bool {
	state := MeetingStateFor(meeting)
	return meeting.ProcessingStatus == ProcessingStatusFailed || state == MeetingStateProcessing || state == MeetingStateCompleted
}
