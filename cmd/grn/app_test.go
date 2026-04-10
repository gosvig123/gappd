package main

import (
	"testing"

	"github.com/grn-dev/grn/internal/db"
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
	if detail.Status.State != appMeetingStateFailed {
		t.Fatalf("status.state = %q, want %q", detail.Status.State, appMeetingStateFailed)
	}
	if detail.Status.UpdatedAt != meeting.ProcessingStatusUpdatedAt {
		t.Fatalf("status.updatedAt = %q, want %q", detail.Status.UpdatedAt, meeting.ProcessingStatusUpdatedAt)
	}
	if detail.Status.Processing.FailureMessage == nil || *detail.Status.Processing.FailureMessage != failure {
		t.Fatalf("status.processing.failureMessage = %v, want %q", detail.Status.Processing.FailureMessage, failure)
	}
	if detail.Status.Processing.State != string(db.ProcessingStatusFailed) {
		t.Fatalf("status.processing.state = %q, want %q", detail.Status.Processing.State, db.ProcessingStatusFailed)
	}
	if detail.TranscriptText == "" {
		t.Fatal("transcriptText = empty, want fallback transcript from segments")
	}
}
