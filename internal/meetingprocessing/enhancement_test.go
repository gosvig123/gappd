package meetingprocessing

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
)

func TestEnhanceRefinesStoredSummaryWithFeedback(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := createCapturedMeeting(t, store)
	extractionJSON := `{"title":"Planning","participants":[],"topics":[],"decisions":[],"action_items":[],"open_questions":[],"sentiment":"neutral"}`
	summary := "draft"
	transcript := "[Ada] plan"
	completion := meetinglifecycle.Completion{Title: "Planning", Transcript: transcript, Summary: summary, ExtractionJSON: extractionJSON, At: testProcessingTime()}
	result, err := meetinglifecycle.New(store).Transition(context.Background(), meeting.ID, meetinglifecycle.ProcessingCompleted{Completion: completion})
	if err != nil {
		t.Fatalf("ProcessingCompleted transition error = %v", err)
	}
	meeting = result.Meeting
	notes := &fakeNotes{summary: "refined"}
	service := Service{Store: store, Notes: notes}

	if err := service.EnhanceStored(context.Background(), StoredRequest{MeetingID: meeting.ID, Notes: "prefer bullets", Feedback: "shorter", Refine: true}); err != nil {
		t.Fatalf("EnhanceStored() error = %v", err)
	}
	if notes.runCalled {
		t.Fatalf("RunWithOptions called, want stored-summary refinement")
	}
	if !strings.Contains(notes.feedback, "prefer bullets") || !strings.Contains(notes.feedback, "shorter") {
		t.Fatalf("feedback = %q, want notes and feedback", notes.feedback)
	}
	if got := getMeeting(t, store, meeting.ID).Summary; got == nil || *got != "refined" {
		t.Fatalf("summary = %v, want refined", got)
	}
}

func TestProcessCapturedFailurePreservesCaptureAndEmitsEvent(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := createCapturedMeeting(t, store)
	events := &testEvents{}
	service := Service{Store: store, Notes: &fakeNotes{}, Transcriber: fakeTranscriber{}, Events: events}

	err := service.ProcessCaptured(context.Background(), CapturedRequest{MeetingID: meeting.ID, AudioDir: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "transcription failed: no audio captured") {
		t.Fatalf("ProcessCaptured() error = %v, want transcription failure", err)
	}
	stored := getMeeting(t, store, meeting.ID)
	assertProcessingFailed(t, stored, "no audio captured")
	assertLastProcessingEvent(t, events, EventFailed, meeting.ID, ErrNoAudio)
}

func TestEnhanceFailureSavesTranscriptAndEmitsEvent(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := createCapturedMeeting(t, store)
	events := &testEvents{}
	providerErr := errors.New("llm down")
	service := Service{Store: store, Pipeline: ai.NewPipeline(failingProvider{err: providerErr}, 0), Events: events}
	transcript := "[You] hello\n"
	transition := meetinglifecycle.TranscriptSaved{At: testProcessingTime(), Transcript: transcript}
	if _, err := meetinglifecycle.New(store).Transition(context.Background(), meeting.ID, transition); err != nil {
		t.Fatalf("TranscriptSaved transition error = %v", err)
	}

	err := service.EnhanceStored(context.Background(), StoredRequest{MeetingID: meeting.ID})
	if err == nil || !strings.Contains(err.Error(), "enhance failed (transcript saved)") {
		t.Fatalf("EnhanceStored() error = %v, want saved transcript failure", err)
	}
	assertEnhanceFailure(t, getMeeting(t, store, meeting.ID), transcript, providerErr.Error())
	assertLastProcessingEvent(t, events, EventFailed, meeting.ID, providerErr)
}

func testProcessingTime() time.Time {
	return time.Date(2026, 4, 10, 12, 45, 0, 0, time.UTC)
}

func assertProcessingFailed(t *testing.T, stored *db.Meeting, want string) {
	t.Helper()
	if stored.CaptureStatus != db.CaptureStatusCaptured {
		t.Fatalf("capture_status = %q, want %q", stored.CaptureStatus, db.CaptureStatusCaptured)
	}
	if stored.ProcessingStatus != db.ProcessingStatusFailed {
		t.Fatalf("processing_status = %q, want %q", stored.ProcessingStatus, db.ProcessingStatusFailed)
	}
	if stored.ProcessingFailureMessage == nil || *stored.ProcessingFailureMessage != want {
		t.Fatalf("processing_failure_message = %v, want %q", stored.ProcessingFailureMessage, want)
	}
}

func assertEnhanceFailure(t *testing.T, stored *db.Meeting, transcript string, providerErr string) {
	t.Helper()
	if stored.Transcript == nil || *stored.Transcript != transcript {
		t.Fatalf("transcript = %v, want %q", stored.Transcript, transcript)
	}
	assertProcessingFailedContains(t, stored, providerErr)
}

func assertProcessingFailedContains(t *testing.T, stored *db.Meeting, providerErr string) {
	t.Helper()
	if stored.ProcessingStatus != db.ProcessingStatusFailed {
		t.Fatalf("processing_status = %q, want %q", stored.ProcessingStatus, db.ProcessingStatusFailed)
	}
	if stored.ProcessingFailureMessage == nil || !strings.Contains(*stored.ProcessingFailureMessage, providerErr) {
		t.Fatalf("processing_failure_message = %v, want contains %q", stored.ProcessingFailureMessage, providerErr)
	}
}

func assertLastProcessingEvent(t *testing.T, events *testEvents, name EventName, meetingID string, eventErr error) {
	t.Helper()
	if len(events.events) == 0 {
		t.Fatal("event count = 0, want events")
	}
	event := events.events[len(events.events)-1]
	if event.name != name || event.meeting.ID != meetingID {
		t.Fatalf("event = %#v, want %s for %s", event, name, meetingID)
	}
	if event.err == nil || !strings.Contains(event.err.Error(), eventErr.Error()) {
		t.Fatalf("event.err = %v, want contains %q", event.err, eventErr.Error())
	}
}
