package recording

import (
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/capture"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
)

func TestRunCompletesFullLifecycleWithInternalSeams(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	recorder := &fakeRecorder{done: make(chan error), dir: t.TempDir()}
	events := &recordingEvents{onEvent: interruptOnStarted(t)}
	processor := meetingprocessing.Service{Store: store, Transcriber: fakeTranscriber{}, Notes: fakeEnhancer{title: "Lifecycle Planning", summary: "summary"}, Events: processingEventAdapter{events}}
	service := Service{BaseDir: t.TempDir(), Events: events, Store: store, Processor: processor, recorder: func(capture.CaptureMode, string, int) audioRecorder { return recorder }}

	err := service.Run(Request{Title: "Lifecycle"})
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}

	meeting := latestMeeting(t, store)
	assertCompletedMeeting(t, meeting)
	assertStoredSegmentCount(t, store, meeting.ID, 2)
	assertEventNames(t, events, EventStarted, EventStopping, EventProcessing, EventCompleted)
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

func assertCompletedMeeting(t *testing.T, meeting *db.Meeting) {
	t.Helper()
	if meeting.CaptureStatus != db.CaptureStatusCaptured {
		t.Fatalf("capture_status = %q, want %q", meeting.CaptureStatus, db.CaptureStatusCaptured)
	}
	if meeting.ProcessingStatus != db.ProcessingStatusCompleted {
		t.Fatalf("processing_status = %q, want %q", meeting.ProcessingStatus, db.ProcessingStatusCompleted)
	}
	if meeting.Transcript == nil || !strings.Contains(*meeting.Transcript, "[You] mic.wav hello") {
		t.Fatalf("transcript = %v, want You segment", meeting.Transcript)
	}
	if meeting.Summary == nil || *meeting.Summary != "summary" {
		t.Fatalf("summary = %v, want summary", meeting.Summary)
	}
	if meeting.Title != "Lifecycle Planning" {
		t.Fatalf("title = %q, want generated title", meeting.Title)
	}
}
