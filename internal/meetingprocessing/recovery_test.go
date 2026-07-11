package meetingprocessing

import (
	"context"
	"testing"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
)

func TestRecoverStaleRecordingProcessesSavedAudioOnce(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := createStaleRecordingMeeting(t, store, true)
	recovery := staleRecoveryTestService(store)

	recovered, err := recovery.RecoverStale(context.Background(), staleRecoveryTestOptions())
	if err != nil {
		t.Fatalf("RecoverStale() error = %v", err)
	}
	if recovered != 1 {
		t.Fatalf("recovered = %d, want 1", recovered)
	}
	assertRecoveredMeetingPending(t, store, meeting.ID)

	recovered, err = recovery.RecoverStale(context.Background(), staleRecoveryTestOptions())
	if err != nil {
		t.Fatalf("RecoverStale() second error = %v", err)
	}
	if recovered != 0 {
		t.Fatalf("second recovered = %d, want 0", recovered)
	}
	assertSegmentCount(t, store, meeting.ID, 0)
}

func TestRecoverStaleRecordingWithoutAudioFailsCapture(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := createStaleRecordingMeeting(t, store, false)
	recovery := staleRecoveryTestService(store)

	recovered, err := recovery.RecoverStale(context.Background(), staleRecoveryTestOptions())
	if err != nil {
		t.Fatalf("RecoverStale() error = %v", err)
	}
	if recovered != 1 {
		t.Fatalf("recovered = %d, want 1", recovered)
	}
	assertRecoveredMeetingFailed(t, store, meeting.ID)
}

func createStaleRecordingMeeting(t *testing.T, store *db.DB, withAudio bool) *db.Meeting {
	t.Helper()
	meeting := &db.Meeting{
		ID: "meeting-processing", Title: "Processing", StartedAt: "2026-04-10T12:00:00Z",
		CaptureStatus: db.CaptureStatusRecording, CaptureStatusUpdatedAt: "2026-04-10T12:00:00Z",
		ProcessingStatus: db.ProcessingStatusNotStarted, ProcessingStatusUpdatedAt: "2026-04-10T12:00:00Z",
		Tags: "[]", Source: "listen",
	}
	if withAudio {
		meeting.AudioPath = writeUsableAudio(t)
	}
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatalf("CreateMeeting() error = %v", err)
	}
	return meeting
}

func staleRecoveryTestService(store *db.DB) Recovery { return Recovery{Store: store} }

func staleRecoveryTestOptions() RecoveryOptions {
	return RecoveryOptions{Now: time.Date(2026, 4, 10, 12, 10, 0, 0, time.UTC), Timeout: StaleRecordingTimeout}
}

func assertRecoveredMeetingPending(t *testing.T, store *db.DB, id string) {
	t.Helper()
	meeting := getMeeting(t, store, id)
	if meeting.CaptureStatus != db.CaptureStatusCaptured {
		t.Fatalf("capture_status = %q, want %q", meeting.CaptureStatus, db.CaptureStatusCaptured)
	}
	if meeting.ProcessingStatus != db.ProcessingStatusPending {
		t.Fatalf("processing_status = %q, want %q", meeting.ProcessingStatus, db.ProcessingStatusPending)
	}
	if meeting.Transcript != nil {
		t.Fatalf("recovery synchronously transcribed audio")
	}
}

func assertRecoveredMeetingFailed(t *testing.T, store *db.DB, id string) {
	t.Helper()
	meeting := getMeeting(t, store, id)
	if meetinglifecycle.MeetingStateFor(*meeting) != meetinglifecycle.MeetingStateFailed {
		t.Fatalf("state = %q, want %q", meetinglifecycle.MeetingStateFor(*meeting), meetinglifecycle.MeetingStateFailed)
	}
	if meeting.CaptureFailureMessage == nil || *meeting.CaptureFailureMessage != StaleNoAudioMessage {
		t.Fatalf("capture_failure_message = %v, want stale message", meeting.CaptureFailureMessage)
	}
}

func assertSegmentCount(t *testing.T, store *db.DB, meetingID string, want int) {
	t.Helper()
	segments, err := store.GetSegments(meetingID)
	if err != nil {
		t.Fatalf("GetSegments() error = %v", err)
	}
	if len(segments) != want {
		t.Fatalf("segments = %d, want %d", len(segments), want)
	}
}
