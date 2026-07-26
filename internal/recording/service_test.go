package recording

import (
	"testing"

	"github.com/gappd-dev/gappd/internal/capture"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/livetranscript"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
)

func TestRunCompletesFullLifecycleWithInternalSeams(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	recorder := &fakeRecorder{done: make(chan error), dir: t.TempDir()}
	events := &recordingEvents{onEvent: interruptOnStarted(t)}
	lifecycle := meetinglifecycle.New(store)
	liveTranscript := livetranscript.New(store, lifecycle, fakeTranscriber{})
	service := New(lifecycle, liveTranscript)
	service.BaseDir = t.TempDir()
	service.Events = events
	service.recorder = func(capture.CaptureMode, string, int) audioRecorder { return recorder }

	err := service.Run(Request{Title: "Lifecycle"})
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}

	meeting := latestMeeting(t, store)
	assertCapturedMeeting(t, meeting)
	assertStoredSegmentCount(t, store, meeting.ID, 0)
	assertEventNames(t, events, EventStarted, EventStopping, EventCaptured)
}

func TestRunFailsAfterMissingMicrophoneCleanup(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	recorder := &fakeRecorder{done: make(chan error), dir: t.TempDir(), omitMic: true}
	events := &recordingEvents{onEvent: interruptOnStarted(t)}
	lifecycle := meetinglifecycle.New(store)
	service := New(lifecycle, livetranscript.New(store, lifecycle, fakeTranscriber{}))
	service.BaseDir, service.Events = t.TempDir(), events
	service.recorder = func(capture.CaptureMode, string, int) audioRecorder { return recorder }

	if err := service.Run(Request{Title: "Missing mic", Mode: capture.ModeBoth}); err == nil || err.Error() != "microphone audio was not captured" {
		t.Fatalf("Run() error = %v", err)
	}
	meeting := latestMeeting(t, store)
	if meeting.CaptureStatus != db.CaptureStatusFailed {
		t.Fatalf("capture_status = %q", meeting.CaptureStatus)
	}
	assertStoredSegmentCount(t, store, meeting.ID, 0)
	assertEventNames(t, events, EventStarted, EventStopping, EventFailed)
}

func latestMeeting(t *testing.T, store *db.DB) *db.Meeting {
	t.Helper()
	meetings, err := store.ListMeetings(1)
	if err != nil {
		t.Fatalf("ListMeetings() error = %v", err)
	}
	if len(meetings) != 1 {
		t.Fatalf("meetings = %d, want 1", len(meetings))
	}
	return &meetings[0]
}

func assertStoredSegmentCount(t *testing.T, store *db.DB, id string, want int) {
	t.Helper()
	segments, err := store.GetSegments(id)
	if err != nil {
		t.Fatalf("GetSegments() error = %v", err)
	}
	if len(segments) != want {
		t.Fatalf("segments = %d, want %d", len(segments), want)
	}
}

func assertCapturedMeeting(t *testing.T, meeting *db.Meeting) {
	t.Helper()
	if meeting.CaptureStatus != db.CaptureStatusCaptured {
		t.Fatalf("capture_status = %q, want %q", meeting.CaptureStatus, db.CaptureStatusCaptured)
	}
	if meeting.ProcessingStatus != db.ProcessingStatusPending {
		t.Fatalf("processing_status = %q, want %q", meeting.ProcessingStatus, db.ProcessingStatusPending)
	}
	if meeting.Transcript != nil || meeting.Summary != nil {
		t.Fatalf("capture synchronously produced transcript or summary")
	}
}
