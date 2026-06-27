package db

// MeetingState is the single user-facing lifecycle state derived from the
// capture and processing statuses stored on a meeting.
type MeetingState string

const (
	MeetingStateRecording  MeetingState = "recording"
	MeetingStateCaptured   MeetingState = "captured"
	MeetingStateProcessing MeetingState = "processing"
	MeetingStateCompleted  MeetingState = "completed"
	MeetingStateFailed     MeetingState = "failed"
)

// The All* slices are the canonical enumerations of each status enum. They are
// the source of truth for the generated TypeScript protocol (cmd/gen-protocol);
// keep them in sync with the schema CHECK constraints.
var (
	AllCaptureStatuses    = []CaptureStatus{CaptureStatusRecording, CaptureStatusCaptured, CaptureStatusFailed}
	AllProcessingStatuses = []ProcessingStatus{ProcessingStatusNotStarted, ProcessingStatusProcessing, ProcessingStatusCompleted, ProcessingStatusFailed}
	AllMeetingStates      = []MeetingState{MeetingStateRecording, MeetingStateCaptured, MeetingStateProcessing, MeetingStateCompleted, MeetingStateFailed}
)

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

// UsesProcessingTimestamp reports whether the meeting's display timestamp
// should come from the processing status rather than the capture status.
func UsesProcessingTimestamp(meeting Meeting) bool {
	state := MeetingStateFor(meeting)
	return meeting.ProcessingStatus == ProcessingStatusFailed || state == MeetingStateProcessing || state == MeetingStateCompleted
}

func legacyStatusFor(meeting Meeting) MeetingState {
	state := MeetingStateFor(meeting)
	if state == MeetingStateCaptured {
		return MeetingStateProcessing
	}
	return state
}

func legacyStatusUpdatedAtFor(meeting Meeting) string {
	if UsesProcessingTimestamp(meeting) {
		return meeting.ProcessingStatusUpdatedAt
	}
	return meeting.CaptureStatusUpdatedAt
}

func legacyFailureMessageFor(meeting Meeting) *string {
	if meeting.CaptureStatus == CaptureStatusFailed {
		return meeting.CaptureFailureMessage
	}
	if meeting.ProcessingStatus == ProcessingStatusFailed {
		return meeting.ProcessingFailureMessage
	}
	return nil
}
