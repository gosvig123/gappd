package recording

import (
	"os"
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
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
	now := "2026-04-10T12:30:00Z"
	lifecycleFor(meeting).captured(now)
	if err := store.UpdateMeeting(meeting); err != nil {
		t.Fatalf("UpdateMeeting() error = %v", err)
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

func interruptOnStarted(t *testing.T) func(EventName) {
	return func(name EventName) {
		if name != EventStarted {
			return
		}
		process, err := os.FindProcess(os.Getpid())
		if err != nil {
			t.Fatalf("FindProcess() error = %v", err)
		}
		if err := process.Signal(os.Interrupt); err != nil {
			t.Fatalf("Signal() error = %v", err)
		}
	}
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
