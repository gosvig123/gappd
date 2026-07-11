package meetinglifecycle

import (
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
)

const (
	captureAt    = "2026-04-10T12:00:00Z"
	processingAt = "2026-04-10T12:05:00Z"
)

func TestViewFor(t *testing.T) {
	cases := []struct {
		name      string
		meeting   db.Meeting
		wantState MeetingState
		wantAt    string
	}{
		{"recording", meetingWith(db.CaptureStatusRecording, db.ProcessingStatusNotStarted), MeetingStateRecording, captureAt},
		{"pending", meetingWith(db.CaptureStatusCaptured, db.ProcessingStatusNotStarted), MeetingStatePending, captureAt},
		{"processing", meetingWith(db.CaptureStatusCaptured, db.ProcessingStatusProcessing), MeetingStateProcessing, processingAt},
		{"completed", meetingWith(db.CaptureStatusCaptured, db.ProcessingStatusCompleted), MeetingStateCompleted, processingAt},
		{"capture failed", meetingWith(db.CaptureStatusFailed, db.ProcessingStatusNotStarted), MeetingStateFailed, captureAt},
		{"processing failed", meetingWith(db.CaptureStatusCaptured, db.ProcessingStatusFailed), MeetingStateFailed, processingAt},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) { assertView(t, tc.meeting, tc.wantState, tc.wantAt) })
	}
}

func TestMeetingStatusToneFor(t *testing.T) {
	cases := map[MeetingState]MeetingStatusTone{
		MeetingStateRecording:  MeetingStatusToneRecording,
		MeetingStatePending:    MeetingStatusToneIdle,
		MeetingStateProcessing: MeetingStatusToneProcessing,
		MeetingStateCompleted:  MeetingStatusToneIdle,
		MeetingStateFailed:     MeetingStatusToneError,
	}
	for state, tone := range cases {
		if got := MeetingStatusToneFor(state); got != tone {
			t.Fatalf("MeetingStatusToneFor(%q) = %q, want %q", state, got, tone)
		}
	}
}

func meetingWith(capture db.CaptureStatus, processing db.ProcessingStatus) db.Meeting {
	return db.Meeting{CaptureStatus: capture, CaptureStatusUpdatedAt: captureAt, ProcessingStatus: processing, ProcessingStatusUpdatedAt: processingAt}
}

func assertView(t *testing.T, meeting db.Meeting, wantState MeetingState, wantAt string) {
	t.Helper()
	got := ViewFor(meeting)
	if got.State != wantState || got.UpdatedAt != wantAt {
		t.Fatalf("ViewFor() = {%q %q}, want {%q %q}", got.State, got.UpdatedAt, wantState, wantAt)
	}
}
