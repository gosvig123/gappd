package db

import "testing"

const (
	captureAt    = "2026-04-10T12:00:00Z"
	processingAt = "2026-04-10T12:05:00Z"
)

func TestMeetingLifecycleStatusFor(t *testing.T) {
	cases := []struct {
		name      string
		meeting   Meeting
		wantState MeetingState
		wantAt    string
	}{
		{"recording", meetingWith(CaptureStatusRecording, ProcessingStatusNotStarted), MeetingStateRecording, captureAt},
		{"captured", meetingWith(CaptureStatusCaptured, ProcessingStatusNotStarted), MeetingStateCaptured, captureAt},
		{"processing", meetingWith(CaptureStatusCaptured, ProcessingStatusProcessing), MeetingStateProcessing, processingAt},
		{"completed", meetingWith(CaptureStatusCaptured, ProcessingStatusCompleted), MeetingStateCompleted, processingAt},
		{"capture failed", meetingWith(CaptureStatusFailed, ProcessingStatusNotStarted), MeetingStateFailed, captureAt},
		{"processing failed", meetingWith(CaptureStatusCaptured, ProcessingStatusFailed), MeetingStateFailed, processingAt},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) { assertMeetingLifecycleStatus(t, tc.meeting, tc.wantState, tc.wantAt) })
	}
}

func TestMeetingStatusToneFor(t *testing.T) {
	cases := map[MeetingState]MeetingStatusTone{
		MeetingStateRecording:  MeetingStatusToneRecording,
		MeetingStateCaptured:   MeetingStatusToneIdle,
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

func meetingWith(capture CaptureStatus, processing ProcessingStatus) Meeting {
	return Meeting{CaptureStatus: capture, CaptureStatusUpdatedAt: captureAt, ProcessingStatus: processing, ProcessingStatusUpdatedAt: processingAt}
}

func assertMeetingLifecycleStatus(t *testing.T, meeting Meeting, wantState MeetingState, wantAt string) {
	t.Helper()
	got := MeetingLifecycleStatusFor(meeting)
	if got.State != wantState || got.UpdatedAt != wantAt {
		t.Fatalf("MeetingLifecycleStatusFor() = {%q %q}, want {%q %q}", got.State, got.UpdatedAt, wantState, wantAt)
	}
}
