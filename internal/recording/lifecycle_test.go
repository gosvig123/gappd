package recording

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/db"
)

func TestFailCapturePersistsFailureAndEmitsEvent(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := createRecordingMeeting(t, store)
	events := &recordingEvents{}
	service := Service{Store: store, Events: events}
	captureErr := errors.New("start capture: boom")

	if err := service.FailCapture(meeting, captureErr); err != nil {
		t.Fatalf("FailCapture() error = %v", err)
	}

	stored := getMeeting(t, store, meeting.ID)
	if stored.CaptureStatus != db.CaptureStatusFailed {
		t.Fatalf("capture_status = %q, want %q", stored.CaptureStatus, db.CaptureStatusFailed)
	}
	if stored.CaptureFailureMessage == nil || *stored.CaptureFailureMessage != captureErr.Error() {
		t.Fatalf("capture_failure_message = %v, want %q", stored.CaptureFailureMessage, captureErr.Error())
	}
	if stored.EndedAt == nil || *stored.EndedAt == "" {
		t.Fatal("ended_at = nil or empty, want terminal timestamp")
	}
	if stored.ProcessingStatus != db.ProcessingStatusNotStarted {
		t.Fatalf("processing_status = %q, want %q", stored.ProcessingStatus, db.ProcessingStatusNotStarted)
	}
	assertOneEvent(t, events, EventFailed, meeting.ID, captureErr)
}

func TestSaveProcessingFailurePreservesCaptureAndEmitsEvent(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := createCapturedMeeting(t, store)
	events := &recordingEvents{}
	service := Service{Store: store, Events: events}
	processingErr := errors.New("no audio to transcribe")

	err := service.saveProcessingFailure(meeting, processingErr)
	if err == nil || !strings.Contains(err.Error(), "transcription failed: no audio to transcribe") {
		t.Fatalf("saveProcessingFailure() error = %v, want transcription failure", err)
	}

	stored := getMeeting(t, store, meeting.ID)
	if stored.CaptureStatus != db.CaptureStatusCaptured {
		t.Fatalf("capture_status = %q, want %q", stored.CaptureStatus, db.CaptureStatusCaptured)
	}
	if stored.ProcessingStatus != db.ProcessingStatusFailed {
		t.Fatalf("processing_status = %q, want %q", stored.ProcessingStatus, db.ProcessingStatusFailed)
	}
	if stored.ProcessingFailureMessage == nil || *stored.ProcessingFailureMessage != processingErr.Error() {
		t.Fatalf("processing_failure_message = %v, want %q", stored.ProcessingFailureMessage, processingErr.Error())
	}
	assertOneEvent(t, events, EventFailed, meeting.ID, processingErr)
}

func TestEnhanceFailureSavesTranscriptAndEmitsEvent(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := createCapturedMeeting(t, store)
	setProcessingStatus(meeting, db.ProcessingStatusProcessing, *meeting.EndedAt, nil)
	if err := store.UpdateMeeting(meeting); err != nil {
		t.Fatalf("UpdateMeeting() error = %v", err)
	}
	events := &recordingEvents{}
	providerErr := errors.New("llm down")
	server := failingOllamaServer(t, providerErr.Error())
	service := Service{Store: store, Pipeline: ai.NewPipeline(ai.NewOllama(server.URL, "test"), 0), Events: events}
	transcript := "[You] hello\n"

	err := service.enhanceAndSave(meeting, transcript)
	if err == nil || !strings.Contains(err.Error(), "enhance failed (transcript saved)") {
		t.Fatalf("enhanceAndSave() error = %v, want saved transcript failure", err)
	}
	assertEnhanceFailure(t, getMeeting(t, store, meeting.ID), transcript, providerErr.Error())
	assertOneEvent(t, events, EventFailed, meeting.ID, providerErr)
}

func failingOllamaServer(t *testing.T, message string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"`+message+`"}`, http.StatusInternalServerError)
	}))
	t.Cleanup(server.Close)
	return server
}

func assertEnhanceFailure(t *testing.T, stored *db.Meeting, transcript string, providerErr string) {
	t.Helper()
	if stored.Transcript == nil || *stored.Transcript != transcript {
		t.Fatalf("transcript = %v, want %q", stored.Transcript, transcript)
	}
	if stored.ProcessingStatus != db.ProcessingStatusFailed {
		t.Fatalf("processing_status = %q, want %q", stored.ProcessingStatus, db.ProcessingStatusFailed)
	}
	if stored.ProcessingFailureMessage == nil || !strings.Contains(*stored.ProcessingFailureMessage, providerErr) {
		t.Fatalf("processing_failure_message = %v, want contains %q", stored.ProcessingFailureMessage, providerErr)
	}
}
