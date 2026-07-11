package meetinglifecycle

import (
	"fmt"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

type Captured struct{ At time.Time }

func (Captured) name() string { return "captured" }

func (t Captured) apply(meeting *db.Meeting) (bool, error) {
	if meeting.CaptureStatus == db.CaptureStatusCaptured && meeting.ProcessingStatus == db.ProcessingStatusPending {
		return false, nil
	}
	if meeting.CaptureStatus != db.CaptureStatusRecording || meeting.ProcessingStatus != db.ProcessingStatusNotStarted {
		return false, conflict(meeting, t.name())
	}
	at := timestamp(t.At)
	end(meeting, at)
	setCapture(meeting, db.CaptureStatusCaptured, at, nil)
	setProcessing(meeting, db.ProcessingStatusPending, at, nil)
	return true, nil
}

type CaptureFailed struct {
	At    time.Time
	Cause error
}

func (CaptureFailed) name() string { return "capture_failed" }

func (t CaptureFailed) apply(meeting *db.Meeting) (bool, error) {
	if t.Cause == nil {
		return false, fmt.Errorf("%s transition requires cause", t.name())
	}
	message := t.Cause.Error()
	if meeting.CaptureStatus == db.CaptureStatusFailed && sameText(meeting.CaptureFailureMessage, message) {
		return false, nil
	}
	if meeting.CaptureStatus != db.CaptureStatusRecording || meeting.ProcessingStatus != db.ProcessingStatusNotStarted {
		return false, conflict(meeting, t.name())
	}
	at := timestamp(t.At)
	end(meeting, at)
	setCapture(meeting, db.CaptureStatusFailed, at, t.Cause)
	return true, nil
}

type StaleCaptured struct {
	Cutoff time.Time
	At     time.Time
}

func (StaleCaptured) name() string { return "stale_captured" }

func (t StaleCaptured) apply(meeting *db.Meeting) (bool, error) {
	if !staleRecording(meeting, t.Cutoff) {
		return false, nil
	}
	return Captured{At: t.At}.apply(meeting)
}

type StaleCaptureFailed struct {
	Cutoff time.Time
	At     time.Time
	Cause  error
}

func (StaleCaptureFailed) name() string { return "stale_capture_failed" }

func (t StaleCaptureFailed) apply(meeting *db.Meeting) (bool, error) {
	if !staleRecording(meeting, t.Cutoff) {
		return false, nil
	}
	return CaptureFailed{At: t.At, Cause: t.Cause}.apply(meeting)
}

func staleRecording(meeting *db.Meeting, cutoff time.Time) bool {
	if meeting.CaptureStatus != db.CaptureStatusRecording || meeting.ProcessingStatus != db.ProcessingStatusNotStarted {
		return false
	}
	updatedAt, err := time.Parse(time.RFC3339, meeting.CaptureStatusUpdatedAt)
	return err == nil && updatedAt.Before(cutoff)
}
