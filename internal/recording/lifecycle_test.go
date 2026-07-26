package recording

import (
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/capture"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
)

func TestFailCapturePersistsFailureAndEmitsEvent(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := createRecordingMeeting(t, store)
	events := &recordingEvents{}
	captureErr := errors.New("start capture: boom")

	if err := testSession(meetinglifecycle.New(store), events, meeting).failCapture(captureErr); !errors.Is(err, captureErr) {
		t.Fatalf("failCapture() error = %v, want %v", err, captureErr)
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

func TestRequireAudioRejectsMissingRequestedMicrophone(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := createRecordingMeeting(t, store)
	artifacts := audioartifact.New(t.TempDir())
	if err := os.WriteFile(artifacts.SystemPath(), []byte(strings.Repeat("s", 45)), 0o644); err != nil {
		t.Fatal(err)
	}
	events := &recordingEvents{}
	session := testSession(meetinglifecycle.New(store), events, meeting).withArtifacts(artifacts)
	if err := session.requireAudio(capture.ModeBoth); err == nil || err.Error() != "microphone audio was not captured" {
		t.Fatalf("requireAudio() error = %v", err)
	}
	if stored := getMeeting(t, store, meeting.ID); stored.CaptureStatus != db.CaptureStatusRecording {
		t.Fatalf("capture_status = %q", stored.CaptureStatus)
	}
	if len(events.events) != 0 {
		t.Fatalf("events = %#v", events.events)
	}
}

func testSession(lifecycle meetinglifecycle.Module, events EventSink, meeting *db.Meeting) recordingSession {
	return recordingSession{lifecycle: lifecycle, events: events, meeting: meeting}
}
