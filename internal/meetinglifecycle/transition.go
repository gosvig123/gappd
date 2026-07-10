package meetinglifecycle

import (
	"fmt"

	"github.com/gappd-dev/gappd/internal/db"
)

type Transition interface {
	apply(*db.Meeting) (bool, error)
	name() string
}

type ConflictError struct {
	MeetingID  string
	Transition string
	Capture    db.CaptureStatus
	Processing db.ProcessingStatus
}

func (e *ConflictError) Error() string {
	return fmt.Sprintf("transition meeting %s with %s: capture=%s processing=%s", e.MeetingID, e.Transition, e.Capture, e.Processing)
}

func conflict(meeting *db.Meeting, transition string) error {
	return &ConflictError{
		MeetingID: meeting.ID, Transition: transition,
		Capture: meeting.CaptureStatus, Processing: meeting.ProcessingStatus,
	}
}

func failureMessage(err error) *string {
	if err == nil {
		return nil
	}
	message := err.Error()
	return &message
}

func sameText(value *string, want string) bool { return value != nil && *value == want }

func end(meeting *db.Meeting, at string) { meeting.EndedAt = &at }

func setCapture(meeting *db.Meeting, status db.CaptureStatus, at string, err error) {
	meeting.CaptureStatus = status
	meeting.CaptureStatusUpdatedAt = at
	meeting.CaptureFailureMessage = failureMessage(err)
}

func setProcessing(meeting *db.Meeting, status db.ProcessingStatus, at string, err error) {
	meeting.ProcessingStatus = status
	meeting.ProcessingStatusUpdatedAt = at
	meeting.ProcessingFailureMessage = failureMessage(err)
}
