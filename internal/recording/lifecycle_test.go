package recording

import (
	"errors"
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
)

func TestFailCapturePersistsFailureAndEmitsEvent(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := createRecordingMeeting(t, store)
	events := &recordingEvents{}
	service := Service{Store: store, Events: events}
	captureErr := errors.New("start capture: boom")

	if err := testSession(service, meeting).failCapture(captureErr); !errors.Is(err, captureErr) {
		t.Fatalf("failCapture() error = %v, want %v", err, captureErr)
	}

	stored := getMeeting(t, store, meeting.ID)
	if stored.CaptureStatus != db.CaptureStatusFailed {
		t.Fatalf("capture_status = %q, want %q", stored.CaptureStatus, db.CaptureStatusFailed)
	}
	if stored.CaptureFailureMessage == nil || *stored.CaptureFailureMessage != captureErr.Error() {
		t.Fatalf("capture_failure_message = %v, want %q", stored.CaptureFailureMessage, captureErr.Error())
	}
	if stored.EndedAt == nil || *stored.EndedAt == "" {
		t.Fatal("ended_at = nil or empty, want terminal timestamp")
	}
	if stored.ProcessingStatus != db.ProcessingStatusNotStarted {
		t.Fatalf("processing_status = %q, want %q", stored.ProcessingStatus, db.ProcessingStatusNotStarted)
	}
	assertOneEvent(t, events, EventFailed, meeting.ID, captureErr)
}

func testSession(service Service, meeting *db.Meeting) recordingSession {
	return recordingSession{lifecycle: service.meetingLifecycle(), events: service.Events, meeting: meeting}
}
