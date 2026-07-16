package livetranscript

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

type fakeTranscriber struct {
	err      error
	block    bool
	segments map[string][]transcribe.Segment
}

func (f fakeTranscriber) Transcribe(ctx context.Context, path, _ string) ([]transcribe.Segment, error) {
	if f.block {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	if f.err != nil {
		return nil, f.err
	}
	if segments, ok := f.segments[path]; ok {
		return segments, nil
	}
	return []transcribe.Segment{{Start: 0, End: 1, Text: filepath.Base(path)}}, nil
}

type testRig struct {
	store     *db.DB
	lifecycle meetinglifecycle.Module
	module    Module
	meetingID string
}

func newTestRig(t *testing.T, transcriber Transcriber) testRig {
	t.Helper()
	store := openTestStore(t, ":memory:")
	rig := buildTestRig(t, store, transcriber)
	t.Cleanup(func() { _ = store.Close() })
	return rig
}

func newFileTestRig(t *testing.T, transcriber Transcriber) (testRig, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "meetings.db")
	store := openTestStore(t, path)
	return buildTestRig(t, store, transcriber), path
}

func openTestStore(t *testing.T, path string) *db.DB {
	t.Helper()
	store, err := db.Open(path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	if err := store.Init(); err != nil {
		t.Fatalf("Init() error = %v", err)
	}
	return store
}

func buildTestRig(t *testing.T, store *db.DB, transcriber Transcriber) testRig {
	t.Helper()
	meeting := capturedMeeting()
	if err := store.CreateMeeting(&meeting); err != nil {
		t.Fatalf("CreateMeeting() error = %v", err)
	}
	lifecycle := meetinglifecycle.New(store)
	return testRig{store: store, lifecycle: lifecycle, module: New(store, lifecycle, transcriber), meetingID: meeting.ID}
}

func capturedMeeting() db.Meeting {
	stamp := "2026-07-16T10:00:00Z"
	audioPath := "/tmp/live-transcript"
	return db.Meeting{ID: "meeting-live", Title: "Live", StartedAt: stamp, EndedAt: &stamp,
		AudioPath: &audioPath, CaptureStatus: db.CaptureStatusCaptured, CaptureStatusUpdatedAt: stamp,
		ProcessingStatus: db.ProcessingStatusPending, ProcessingStatusUpdatedAt: stamp,
		Language: "en-US", Tags: "[]", Source: "listen"}
}

func completeEvents() []Event {
	return []Event{
		chunk(SourceMic, "mic.wav"), chunk(SourceSystem, "system.wav"),
		{Kind: EventSourceComplete, Source: SourceMic, Count: 1, CanonicalEnd: 10},
		{Kind: EventSourceComplete, Source: SourceSystem, Count: 1, CanonicalEnd: 10},
		{Kind: EventStreamComplete, Sources: []Source{SourceMic, SourceSystem}},
	}
}

func chunk(source Source, path string) Event {
	return Event{Kind: EventChunk, Source: source, Path: path, End: 10, CanonicalEnd: 10}
}

func runEvents(ctx context.Context, rig testRig, events []Event) (Outcome, error) {
	stream := make(chan Event, len(events))
	for _, event := range events {
		stream <- event
	}
	close(stream)
	session := rig.module.Start(ctx, StartInput{MeetingID: rig.meetingID, Language: "en-US", Events: stream})
	return session.Finish(ctx)
}

func assertRebuildHidden(t *testing.T, rig testRig, outcome Outcome, err error) {
	t.Helper()
	if err != nil || outcome != OutcomeRebuildQueued {
		t.Fatalf("Finish() = %q, %v", outcome, err)
	}
	meeting, loadErr := rig.store.GetMeeting(rig.meetingID)
	if loadErr != nil || meeting.Transcript != nil {
		t.Fatalf("meeting transcript = %v, error = %v", meeting.Transcript, loadErr)
	}
	segments, segmentErr := rig.store.GetSegments(rig.meetingID)
	if segmentErr != nil || len(segments) != 0 {
		t.Fatalf("segments = %d, error = %v", len(segments), segmentErr)
	}
}

func waitForSegments(t *testing.T, store *db.DB, meetingID string, want int) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		segments, err := store.GetSegments(meetingID)
		if err == nil && len(segments) == want {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal(errors.New("timed out waiting for provisional segments"))
}
