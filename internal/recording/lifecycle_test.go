package recording

import (
	"context"
	"encoding/json"
	"errors"
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

	if err := testSession(service, meeting).failCapture(captureErr); err != nil {
		t.Fatalf("failCapture() error = %v", err)
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

	err := testSession(service, meeting).saveProcessingFailure(processingErr)
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
	events := &recordingEvents{}
	providerErr := errors.New("llm down")
	service := Service{Store: store, Pipeline: ai.NewPipeline(failingProvider{err: providerErr}, 0), Events: events}
	transcript := "[You] hello\n"

	err := service.processing().enhanceAndSave(context.Background(), testSession(service, meeting), transcript, EnhanceOptions{})
	if err == nil || !strings.Contains(err.Error(), "enhance failed (transcript saved)") {
		t.Fatalf("enhanceAndSave() error = %v, want saved transcript failure", err)
	}
	assertEnhanceFailure(t, getMeeting(t, store, meeting.ID), transcript, providerErr.Error())
	assertOneEvent(t, events, EventFailed, meeting.ID, providerErr)
}

func testSession(service Service, meeting *db.Meeting) recordingSession {
	return recordingSession{
		store: service.meetings(), out: service.Out, errOut: service.ErrOut,
		events: service.Events, meeting: meeting,
	}
}

type failingProvider struct{ err error }

func (p failingProvider) Complete(context.Context, ai.CompletionRequest) (string, error) { return "", p.err }
func (p failingProvider) CompleteJSON(context.Context, ai.CompletionRequest) (json.RawMessage, error) { return nil, p.err }
func (p failingProvider) Available() error { return p.err }

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
