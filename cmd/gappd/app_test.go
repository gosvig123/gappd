package main

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
	"github.com/gappd-dev/gappd/internal/recording"
)

func TestAppMeetingDetailForIncludesStructuredStatus(t *testing.T) {
	store, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatalf("Init() error = %v", err)
	}

	meeting := &db.Meeting{
		ID:                        "meeting-1",
		Title:                     "Customer call",
		StartedAt:                 "2026-04-10T12:00:00Z",
		CaptureStatus:             db.CaptureStatusCaptured,
		CaptureStatusUpdatedAt:    "2026-04-10T12:30:00Z",
		ProcessingStatus:          db.ProcessingStatusFailed,
		ProcessingStatusUpdatedAt: "2026-04-10T12:45:00Z",
		Tags:                      "[]",
		Source:                    "listen",
	}
	failure := "summary generation failed"
	meeting.ProcessingFailureMessage = &failure
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatalf("CreateMeeting() error = %v", err)
	}
	if err := store.InsertSegment(&db.Segment{MeetingID: meeting.ID, Start: 0, End: 1, Speaker: "You", Text: "hello"}); err != nil {
		t.Fatalf("InsertSegment() error = %v", err)
	}

	detail, err := appMeetingDetailFor(store, meeting.ID)
	if err != nil {
		t.Fatalf("appMeetingDetailFor() error = %v", err)
	}
	if detail.Status.State != meetinglifecycle.MeetingStateFailed {
		t.Fatalf("status.state = %q, want %q", detail.Status.State, meetinglifecycle.MeetingStateFailed)
	}
	if detail.Status.UpdatedAt != meeting.ProcessingStatusUpdatedAt {
		t.Fatalf("status.updatedAt = %q, want %q", detail.Status.UpdatedAt, meeting.ProcessingStatusUpdatedAt)
	}
	if detail.Status.Processing.FailureMessage == nil || *detail.Status.Processing.FailureMessage != failure {
		t.Fatalf("status.processing.failureMessage = %v, want %q", detail.Status.Processing.FailureMessage, failure)
	}
	if detail.Status.Processing.State != db.ProcessingStatusFailed {
		t.Fatalf("status.processing.state = %q, want %q", detail.Status.Processing.State, db.ProcessingStatusFailed)
	}
	if detail.TranscriptText != "" {
		t.Fatal("transcriptText populated despite segments, want app payload to avoid duplicate transcript")
	}
	if len(detail.Segments) != 1 || detail.Segments[0].Text != "hello" {
		t.Fatalf("segments = %#v, want one segment with text", detail.Segments)
	}
}

func TestAppRecordingEventEmitterEncodesMeetingStatus(t *testing.T) {
	originalStdout := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe() error = %v", err)
	}
	os.Stdout = writer
	t.Cleanup(func() {
		os.Stdout = originalStdout
	})

	emitter := appprotocol.NewRecordingEventEmitter(os.Stdout, true)
	meeting := db.Meeting{
		ID:                        "meeting-42",
		Title:                     "Weekly sync",
		StartedAt:                 "2026-04-10T12:00:00Z",
		CaptureStatus:             db.CaptureStatusCaptured,
		CaptureStatusUpdatedAt:    "2026-04-10T12:30:00Z",
		ProcessingStatus:          db.ProcessingStatusProcessing,
		ProcessingStatusUpdatedAt: "2026-04-10T12:31:00Z",
	}
	if err := emitter.EmitRecordingEvent(recording.EventProcessing, meeting, nil); err != nil {
		t.Fatalf("EmitRecordingEvent() error = %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("writer.Close() error = %v", err)
	}

	var buf bytes.Buffer
	if _, err := buf.ReadFrom(reader); err != nil {
		t.Fatalf("ReadFrom() error = %v", err)
	}

	var event appprotocol.RecordingEvent
	if err := json.Unmarshal(buf.Bytes(), &event); err != nil {
		t.Fatalf("json.Unmarshal() error = %v\noutput=%s", err, buf.String())
	}
	if event.Type != recording.EventProcessing {
		t.Fatalf("event.type = %q, want %q", event.Type, recording.EventProcessing)
	}
	if event.MeetingID != meeting.ID {
		t.Fatalf("event.meetingId = %q, want %q", event.MeetingID, meeting.ID)
	}
	if event.Title != meeting.Title {
		t.Fatalf("event.title = %q, want %q", event.Title, meeting.Title)
	}
	if event.Status.State != meetinglifecycle.MeetingStateProcessing {
		t.Fatalf("event.status.state = %q, want %q", event.Status.State, meetinglifecycle.MeetingStateProcessing)
	}
	if event.Status.Processing.State != db.ProcessingStatusProcessing {
		t.Fatalf("event.status.processing.state = %q, want %q", event.Status.Processing.State, db.ProcessingStatusProcessing)
	}
}
