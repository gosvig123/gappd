package recording

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/capture"
	"github.com/gappd-dev/gappd/internal/db"
)

func TestRunCompletesFullLifecycleWithInternalSeams(t *testing.T) {
	store := newFakeStore()
	recorder := &fakeRecorder{done: make(chan error), dir: t.TempDir()}
	events := &recordingEvents{onEvent: interruptOnStarted(t)}
	modelPath := filepath.Join(t.TempDir(), "model.bin")
	if err := os.WriteFile(modelPath, []byte("model"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	service := Service{
		BaseDir:     t.TempDir(),
		Events:      events,
		store:       store,
		recorder:    func(capture.CaptureMode, string, int) audioRecorder { return recorder },
		transcriber: fakeTranscriber{},
		enhancer:    fakeEnhancer{summary: "summary"},
	}

	err := service.Run(Request{Title: "Lifecycle", ModelPath: modelPath})
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}

	assertCompletedMeeting(t, store.meeting)
	if len(store.segments) != 2 {
		t.Fatalf("segments = %d, want 2", len(store.segments))
	}
	assertEventNames(t, events, EventStarted, EventStopping, EventProcessing, EventCompleted)
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
}
