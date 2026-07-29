package recording

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
)

type recordingEvent struct {
	name    EventName
	meeting db.Meeting
	err     error
}

type recordingEvents struct {
	events  []recordingEvent
	onEvent func(EventName)
}

func (s *recordingEvents) EmitRecordingEvent(name EventName, meeting db.Meeting, err error) error {
	s.events = append(s.events, recordingEvent{name: name, meeting: meeting, err: err})
	if s.onEvent != nil {
		s.onEvent(name)
	}
	return nil
}

func openTestDB(t *testing.T) *db.DB {
	t.Helper()
	store, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	store.Conn.SetMaxOpenConns(1)
	if err := store.Init(); err != nil {
		store.Close()
		t.Fatalf("Init() error = %v", err)
	}
	return store
}

func createRecordingMeeting(t *testing.T, store *db.DB) *db.Meeting {
	t.Helper()
	meeting := &db.Meeting{ID: "meeting-start-failure", Title: "Start failure", StartedAt: "2026-04-10T12:00:00Z", CaptureStatus: db.CaptureStatusRecording, CaptureStatusUpdatedAt: "2026-04-10T12:00:00Z", ProcessingStatus: db.ProcessingStatusNotStarted, ProcessingStatusUpdatedAt: "2026-04-10T12:00:00Z", Tags: "[]", Source: "listen"}
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatalf("CreateMeeting() error = %v", err)
	}
	return meeting
}

func createCapturedMeeting(t *testing.T, store *db.DB) *db.Meeting {
	t.Helper()
	meeting := createRecordingMeeting(t, store)
	at := time.Date(2026, 4, 10, 12, 30, 0, 0, time.UTC)
	result, err := meetinglifecycle.New(store).Transition(context.Background(), meeting.ID, meetinglifecycle.Captured{At: at})
	if err != nil {
		t.Fatalf("Captured transition error = %v", err)
	}
	meeting = result.Meeting
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

const (
	captureHelperEnvName   = "GAPPD_CAPTURE_HELPER_PATH"
	captureScenarioEnvName = "GAPPD_TEST_CAPTURE_SCENARIO"
)

func cancelOnStarted(cancel context.CancelFunc) func(EventName) {
	return func(name EventName) {
		if name == EventStarted {
			cancel()
		}
	}
}

func setRecordingCaptureHelper(t *testing.T, scenario string) {
	t.Helper()
	helper, err := filepath.Abs(filepath.Join("..", "capture", "testdata", "capture-helper.sh"))
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(captureHelperEnvName, helper)
	t.Setenv(captureScenarioEnvName, scenario)
}

func assertEventNames(t *testing.T, events *recordingEvents, want ...EventName) {
	t.Helper()
	if len(events.events) != len(want) {
		t.Fatalf("event count = %d, want %d", len(events.events), len(want))
	}
	for i, name := range want {
		if events.events[i].name != name {
			t.Fatalf("events[%d] = %q, want %q", i, events.events[i].name, name)
		}
	}
}

func assertOneEvent(t *testing.T, events *recordingEvents, name EventName, meetingID string, eventErr error) {
	t.Helper()
	if len(events.events) != 1 {
		t.Fatalf("event count = %d, want 1", len(events.events))
	}
	event := events.events[0]
	if event.name != name {
		t.Fatalf("event.name = %q, want %q", event.name, name)
	}
	if event.meeting.ID != meetingID {
		t.Fatalf("event.meeting.ID = %q, want %q", event.meeting.ID, meetingID)
	}
	if event.err == nil || !strings.Contains(event.err.Error(), eventErr.Error()) {
		t.Fatalf("event.err = %v, want contains %q", event.err, eventErr.Error())
	}
}
