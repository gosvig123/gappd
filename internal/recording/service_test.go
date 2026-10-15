package recording

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gappd-dev/gappd/internal/capture"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/livetranscript"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
)

func TestRunCompletesFullLifecycleWithCaptureModule(t *testing.T) {
	setRecordingCaptureHelper(t, "complete-stream")
	store := openTestDB(t)
	defer store.Close()
	ctx, cancel := context.WithCancel(context.Background())
	events := &recordingEvents{onEvent: cancelOnStarted(cancel)}
	lifecycle := meetinglifecycle.New(store)
	liveTranscript := livetranscript.New(store, lifecycle, fakeTranscriber{})
	service := New(lifecycle, liveTranscript)
	service.BaseDir = t.TempDir()
	service.Events = events

	err := service.run(ctx, Request{Title: "Lifecycle"})
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}

	meeting := latestMeeting(t, store)
	assertCapturedMeetingWithLiveTranscript(t, meeting)
	assertStoredSegmentCount(t, store, meeting.ID, 2)
	assertEventNames(t, events, EventStarted, EventStopping, EventCaptured)
}

func TestRunFailsUnexpectedCaptureExit(t *testing.T) {
	setRecordingCaptureHelper(t, "unexpected")
	store := openTestDB(t)
	defer store.Close()
	events := &recordingEvents{}
	lifecycle := meetinglifecycle.New(store)
	service := New(lifecycle, livetranscript.New(store, lifecycle, fakeTranscriber{}))
	service.BaseDir, service.Events = t.TempDir(), events

	if err := service.run(context.Background(), Request{Title: "Unexpected exit"}); err == nil || !strings.Contains(err.Error(), "capture stopped unexpectedly") {
		t.Fatalf("Run() error = %v", err)
	}
	meeting := latestMeeting(t, store)
	if meeting.CaptureStatus != db.CaptureStatusFailed {
		t.Fatalf("capture_status = %q", meeting.CaptureStatus)
	}
	assertEventNames(t, events, EventStarted, EventFailed)
}

func TestRunFailsAfterMissingMicrophoneCleanup(t *testing.T) {
	setRecordingCaptureHelper(t, "missing-mic")
	store := openTestDB(t)
	defer store.Close()
	ctx, cancel := context.WithCancel(context.Background())
	events := &recordingEvents{onEvent: cancelOnStarted(cancel)}
	lifecycle := meetinglifecycle.New(store)
	service := New(lifecycle, livetranscript.New(store, lifecycle, fakeTranscriber{}))
	service.BaseDir, service.Events = t.TempDir(), events

	if err := service.run(ctx, Request{Title: "Missing mic", Mode: capture.ModeBoth}); err == nil || err.Error() != "microphone audio was not captured" {
		t.Fatalf("Run() error = %v", err)
	}
	meeting := latestMeeting(t, store)
	if meeting.CaptureStatus != db.CaptureStatusFailed {
		t.Fatalf("capture_status = %q", meeting.CaptureStatus)
	}
	assertStoredSegmentCount(t, store, meeting.ID, 0)
	assertEventNames(t, events, EventStarted, EventStopping, EventFailed)
}

func latestMeeting(t *testing.T, store *db.DB) *db.Meeting {
	t.Helper()
	meetings, err := store.ListMeetings(1)
	if err != nil {
		t.Fatalf("ListMeetings() error = %v", err)
	}
	if len(meetings) != 1 {
		t.Fatalf("meetings = %d, want 1", len(meetings))
	}
	return &meetings[0]
}

func assertStoredSegmentCount(t *testing.T, store *db.DB, id string, want int) {
	t.Helper()
	segments, err := store.GetSegments(id)
	if err != nil {
		t.Fatalf("GetSegments() error = %v", err)
	}
	if len(segments) != want {
		t.Fatalf("segments = %d, want %d", len(segments), want)
	}
}

func assertCapturedMeetingWithLiveTranscript(t *testing.T, meeting *db.Meeting) {
	t.Helper()
	if meeting.CaptureStatus != db.CaptureStatusCaptured {
		t.Fatalf("capture_status = %q, want %q", meeting.CaptureStatus, db.CaptureStatusCaptured)
	}
	if meeting.ProcessingStatus != db.ProcessingStatusPending {
		t.Fatalf("processing_status = %q, want %q", meeting.ProcessingStatus, db.ProcessingStatusPending)
	}
	if meeting.Transcript == nil || *meeting.Transcript == "" || meeting.Summary != nil {
		t.Fatalf("Live Transcript was not committed before Pending Meeting Processing")
	}
}

func TestVideoEarlyEndRetainsLowDiskReasonAfterFinalization(t *testing.T) {
	setRecordingCaptureHelper(t, "complete-stream")
	helper := filepath.Join(t.TempDir(), "video")
	events := `#!/bin/sh
printf '%s\n' '{"type":"video_started","sourceType":"window","hostSeconds":1000}' '{"type":"video_ended","reason":"Low disk space"}' '{"type":"video_finalized","sourceType":"window","hostSeconds":1001}'
`
	if err := os.WriteFile(helper, []byte(events), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GAPPD_VIDEO_HELPER_PATH", helper)
	store := openTestDB(t)
	defer store.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	service := New(meetinglifecycle.New(store), livetranscript.New(store, meetinglifecycle.New(store), fakeTranscriber{}))
	service.BaseDir, service.Store, service.Out, service.ErrOut = t.TempDir(), store, io.Discard, io.Discard
	service.Events = testEventSink(func(name EventName, _ db.Meeting, _ error) error {
		if name == EventVideoFinalized {
			cancel()
		}
		return nil
	})
	if err := service.run(ctx, Request{Title: "Low disk", ScreenVideoEnabled: true}); err != nil {
		t.Fatal(err)
	}
	meeting := latestMeeting(t, store)
	message := ""
	if meeting.VideoMessage != nil {
		message = *meeting.VideoMessage
	}
	if meeting.CaptureStatus != db.CaptureStatusCaptured || meeting.VideoState != db.VideoStateEnded || message != "Low disk space" {
		t.Fatalf("audio/video status and reason = %s/%s/%q", meeting.CaptureStatus, meeting.VideoState, message)
	}
}

type testEventSink func(EventName, db.Meeting, error) error

func (f testEventSink) EmitRecordingEvent(name EventName, meeting db.Meeting, err error) error {
	return f(name, meeting, err)
}

func TestVideoHelperFailureDoesNotFailMeetingAudio(t *testing.T) {
	setRecordingCaptureHelper(t, "complete-stream")
	helper := filepath.Join(t.TempDir(), "video")
	if err := os.WriteFile(helper, []byte("#!/bin/sh\nexit 1\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GAPPD_VIDEO_HELPER_PATH", helper)
	store := openTestDB(t)
	defer store.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service := New(meetinglifecycle.New(store), livetranscript.New(store, meetinglifecycle.New(store), fakeTranscriber{}))
	service.BaseDir, service.Store, service.Out, service.ErrOut = t.TempDir(), store, io.Discard, io.Discard
	go func() { time.Sleep(200 * time.Millisecond); cancel() }()
	if err := service.run(ctx, Request{Title: "Video failure", ScreenVideoEnabled: true}); err != nil {
		t.Fatal(err)
	}
	meeting := latestMeeting(t, store)
	if meeting.CaptureStatus != db.CaptureStatusCaptured || meeting.VideoState != "failed" {
		t.Fatalf("audio/video status = %s/%s", meeting.CaptureStatus, meeting.VideoState)
	}
}
