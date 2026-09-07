package liveactions

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/db"
)

type extractFunc func(context.Context, string) (*ai.Extraction, error)

func (f extractFunc) Extract(ctx context.Context, text string) (*ai.Extraction, error) {
	return f(ctx, text)
}

func fixture(t *testing.T) (Module, string) {
	t.Helper()
	store, err := db.Open(filepath.Join(t.TempDir(), "meetings.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC().Format(time.RFC3339)
	meeting := &db.Meeting{Title: "Live meeting", StartedAt: at, CaptureStatus: db.CaptureStatusRecording,
		CaptureStatusUpdatedAt: at, ProcessingStatus: db.ProcessingStatusPending, ProcessingStatusUpdatedAt: at, Tags: "[]", Source: "listen"}
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatal(err)
	}
	return Module{Store: store}, meeting.ID
}

func addSegment(t *testing.T, store *db.DB, id, text string) {
	t.Helper()
	segment := &db.Segment{MeetingID: id, Speaker: db.SpeakerYou, Text: text, Start: 0, End: 10}
	if err := store.InsertSegment(segment); err != nil {
		t.Fatal(err)
	}
}

func extraction(task string) *ai.Extraction {
	return &ai.Extraction{ActionItems: []ai.ExtractedAction{{Task: task}}}
}

func assertDraft(t *testing.T, m Module, id string, want *appprotocol.LiveActionDraft) {
	t.Helper()
	got, err := m.Read(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("stored draft = %+v, want %+v", got, want)
	}
}

func assertFinalUntouched(t *testing.T, store *db.DB, id string) {
	t.Helper()
	meeting, err := store.GetMeeting(id)
	if err != nil {
		t.Fatal(err)
	}
	if meeting.Summary != nil || meeting.ExtractionJSON != nil || meeting.Transcript != nil {
		t.Fatal("draft changed final artifacts")
	}
	if meeting.ProcessingStatus != db.ProcessingStatusPending {
		t.Fatal("draft changed final processing")
	}
}
