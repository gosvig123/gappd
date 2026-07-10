package meetingprocessing

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
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
	assertRecoveredMeetingCompleted(t, store, meeting.ID)

	recovered, err = recovery.RecoverStale(context.Background(), staleRecoveryTestOptions())
	if err != nil {
		t.Fatalf("RecoverStale() second error = %v", err)
	}
	if recovered != 0 {
		t.Fatalf("second recovered = %d, want 0", recovered)
	}
	assertSegmentCount(t, store, meeting.ID, 1)
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

func staleRecoveryTestService(store *db.DB) Recovery {
	processor := Service{Store: store, Transcriber: fakeTranscriber{}, Notes: &fakeNotes{summary: "summary"}}
	return Recovery{Store: store, Processor: processor}
}

func staleRecoveryTestOptions() RecoveryOptions {
	return RecoveryOptions{Now: time.Date(2026, 4, 10, 12, 10, 0, 0, time.UTC), Timeout: StaleRecordingTimeout}
}

func assertRecoveredMeetingCompleted(t *testing.T, store *db.DB, id string) {
	t.Helper()
	meeting := getMeeting(t, store, id)
	if meeting.CaptureStatus != db.CaptureStatusCaptured {
		t.Fatalf("capture_status = %q, want %q", meeting.CaptureStatus, db.CaptureStatusCaptured)
	}
	if meeting.ProcessingStatus != db.ProcessingStatusCompleted {
		t.Fatalf("processing_status = %q, want %q", meeting.ProcessingStatus, db.ProcessingStatusCompleted)
	}
	if meeting.Transcript == nil || !strings.Contains(*meeting.Transcript, "mic.wav hello") {
		t.Fatalf("transcript = %v, want recovered mic segment", meeting.Transcript)
	}
}

func assertRecoveredMeetingFailed(t *testing.T, store *db.DB, id string) {
	t.Helper()
	meeting := getMeeting(t, store, id)
	if db.MeetingStateFor(*meeting) != db.MeetingStateFailed {
		t.Fatalf("state = %q, want %q", db.MeetingStateFor(*meeting), db.MeetingStateFailed)
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
