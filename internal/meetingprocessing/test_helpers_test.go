package meetingprocessing

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

type testEvent struct {
	name    EventName
	meeting db.Meeting
	err     error
}

type testEvents struct{ events []testEvent }

func (s *testEvents) EmitProcessingEvent(event Event) error {
	s.events = append(s.events, testEvent{event.Name, event.Meeting, event.Err})
	return nil
}

type fakeNotes struct {
	title     string
	summary   string
	err       error
	runCalled bool
	feedback  string
}

func (e *fakeNotes) RunWithOptions(context.Context, string, ai.RunOptions) (*ai.Extraction, string, error) {
	e.runCalled = true
	return &ai.Extraction{Title: e.title}, e.summary, e.err
}

func (e *fakeNotes) RefineNotes(_ context.Context, _ *ai.Extraction, _ string, feedback string, _ string) (string, error) {
	e.feedback = feedback
	return e.summary, e.err
}

type fakeTranscriber struct{}

func (fakeTranscriber) Transcribe(_ context.Context, audioPath, _ string) ([]transcribe.Segment, error) {
	return []transcribe.Segment{{Start: 0, End: 1, Text: filepath.Base(audioPath) + " hello"}}, nil
}

type failingProvider struct{ err error }

func (p failingProvider) Complete(context.Context, ai.CompletionRequest) (string, error) {
	return "", p.err
}
func (p failingProvider) CompleteJSON(context.Context, ai.CompletionRequest) (json.RawMessage, error) {
	return nil, p.err
}
func (p failingProvider) Available() error { return p.err }

func openTestDB(t *testing.T) *db.DB {
	t.Helper()
	store, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	if err := store.Init(); err != nil {
		store.Close()
		t.Fatalf("Init() error = %v", err)
	}
	return store
}

func createRecordingMeeting(t *testing.T, store *db.DB) *db.Meeting {
	t.Helper()
	meeting := &db.Meeting{ID: "meeting-processing", Title: "Processing", StartedAt: "2026-04-10T12:00:00Z", CaptureStatus: db.CaptureStatusRecording, CaptureStatusUpdatedAt: "2026-04-10T12:00:00Z", ProcessingStatus: db.ProcessingStatusNotStarted, ProcessingStatusUpdatedAt: "2026-04-10T12:00:00Z", Tags: "[]", Source: "listen"}
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatalf("CreateMeeting() error = %v", err)
	}
	return meeting
}

func createCapturedMeeting(t *testing.T, store *db.DB) *db.Meeting {
	t.Helper()
	meeting := createRecordingMeeting(t, store)
	if err := store.MarkCaptured(meeting, "2026-04-10T12:30:00Z"); err != nil {
		t.Fatalf("MarkCaptured() error = %v", err)
	}
	return meeting
}

func getMeeting(t *testing.T, store *db.DB, id string) *db.Meeting {
	t.Helper()
	meeting, err := store.GetMeeting(id)
	if err != nil {
		t.Fatalf("GetMeeting() error = %v", err)
	}
	return meeting
}

func writeUsableAudio(t *testing.T) *string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, audioartifact.MicFilename)
	if err := os.WriteFile(path, []byte(strings.Repeat("m", 45)), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	return &dir
}
