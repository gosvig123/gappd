package recording

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

func TestRecoverStaleRecordingProcessesSavedAudioOnce(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := createStaleRecordingMeeting(t, store, true)
	modelPath := writeTestModel(t)
	service := staleRecoveryTestService(store)

	recovered, err := service.RecoverStale(context.Background(), staleRecoveryTestOptions(modelPath))
	if err != nil {
		t.Fatalf("RecoverStale() error = %v", err)
	}
	if recovered != 1 {
		t.Fatalf("recovered = %d, want 1", recovered)
	}
	assertRecoveredMeetingCompleted(t, store, meeting.ID)

	recovered, err = service.RecoverStale(context.Background(), staleRecoveryTestOptions(modelPath))
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
	service := staleRecoveryTestService(store)

	recovered, err := service.RecoverStale(context.Background(), staleRecoveryTestOptions(""))
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
	meeting := createRecordingMeeting(t, store)
	meeting.CaptureStatusUpdatedAt = "2026-04-10T12:00:00Z"
	meeting.AudioPath = nil
	if withAudio {
		meeting.AudioPath = writeUsableAudio(t)
	}
	if err := store.UpdateMeeting(meeting); err != nil {
		t.Fatalf("UpdateMeeting() error = %v", err)
	}
	return meeting
}

func writeUsableAudio(t *testing.T) *string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, micAudioFilename)
	if err := os.WriteFile(path, []byte(strings.Repeat("m", 45)), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	return &dir
}

func writeTestModel(t *testing.T) string {
	t.Helper()
	modelPath := filepath.Join(t.TempDir(), "model.bin")
	if err := os.WriteFile(modelPath, []byte("model"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	return modelPath
}

func staleRecoveryTestService(store *db.DB) Service {
	return Service{Store: store, Out: io.Discard, ErrOut: io.Discard, transcriber: fakeTranscriber{}, enhancer: fakeEnhancer{summary: "summary"}}
}

func staleRecoveryTestOptions(modelPath string) RecoverStaleOptions {
	return RecoverStaleOptions{Now: time.Date(2026, 4, 10, 12, 10, 0, 0, time.UTC), Timeout: StaleRecordingTimeout, ModelPath: modelPath, DefaultModelPath: modelPath}
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
	if meeting.CaptureFailureMessage == nil || *meeting.CaptureFailureMessage != staleNoAudioMessage {
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
