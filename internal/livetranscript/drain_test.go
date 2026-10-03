package livetranscript

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

func recordingDrainRig(t *testing.T, transcriber Transcriber) testRig {
	t.Helper()
	rig := newTestRig(t, transcriber)
	_, err := rig.store.Conn.Exec(`UPDATE meetings SET capture_status=?,processing_status=?,ended_at=NULL WHERE id=?`, db.CaptureStatusRecording, db.ProcessingStatusNotStarted, rig.meetingID)
	if err != nil {
		t.Fatal(err)
	}
	return rig
}

func startDrainSession(rig testRig, events []Event) *Session {
	stream := make(chan Event, len(events))
	for _, event := range events {
		stream <- event
	}
	close(stream)
	return rig.module.Start(context.Background(), StartInput{MeetingID: rig.meetingID, Events: stream})
}

func TestDrainJoinsWritesWithoutFinishingBeforeCaptured(t *testing.T) {
	rig := recordingDrainRig(t, fakeTranscriber{})
	session := startDrainSession(rig, completeEvents())
	session.Drain(context.Background())
	session.Drain(context.Background())
	meeting, err := rig.store.GetMeeting(rig.meetingID)
	if err != nil {
		t.Fatal(err)
	}
	if meeting.TranscriptRevision != 2 || meeting.Transcript != nil || meeting.CaptureStatus != db.CaptureStatusRecording {
		t.Fatalf("Drain committed or missed writes: %+v", meeting)
	}
	captureDrained(t, rig)
	outcome, err := session.Finish(context.Background())
	if outcome != OutcomeComplete || err != nil {
		t.Fatalf("Finish=%s %v", outcome, err)
	}
	second, err := session.Finish(context.Background())
	if second != outcome || err != nil {
		t.Fatalf("second Finish=%s %v", second, err)
	}
}

func captureDrained(t *testing.T, rig testRig) {
	t.Helper()
	result, err := rig.lifecycle.Transition(context.Background(), rig.meetingID, meetinglifecycle.Captured{At: time.Now()})
	if err != nil || !result.Applied {
		t.Fatalf("Captured=%+v %v", result, err)
	}
}

func TestDrainTimeoutJoinsCooperativeConsumerBeforeCaptured(t *testing.T) {
	started, stopped := make(chan struct{}), make(chan struct{})
	transcriber := TranscriberFunc(func(ctx context.Context, _, _ string) ([]transcribe.Segment, error) {
		close(started)
		defer close(stopped)
		<-ctx.Done()
		return nil, ctx.Err()
	})
	rig := recordingDrainRig(t, transcriber)
	rig.module.drainTimeout = 10 * time.Millisecond
	session := startDrainSession(rig, []Event{chunk(SourceMic, "mic.wav")})
	<-started
	session.Drain(context.Background())
	select {
	case <-stopped:
	default:
		t.Fatal("Drain returned with active transcriber")
	}
	session.Drain(context.Background())
	captureDrained(t, rig)
	outcome, err := session.Finish(context.Background())
	assertRebuildHidden(t, rig, outcome, err)
}

func TestDrainCancellationRetainsErrorAndCleansUpAfterCaptured(t *testing.T) {
	rig := recordingDrainRig(t, fakeTranscriber{block: true})
	session := startDrainSession(rig, []Event{chunk(SourceMic, "mic.wav")})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	session.Drain(ctx)
	session.Drain(context.Background())
	captureDrained(t, rig)
	_, err := session.Finish(context.Background())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("lost cancellation: %v", err)
	}
	segments, err := rig.store.GetSegments(rig.meetingID)
	if err != nil || len(segments) != 0 {
		t.Fatalf("segments=%v %v", segments, err)
	}
}

func TestDrainFailureDoesNotFinalizeUntilCaptureFails(t *testing.T) {
	rig := recordingDrainRig(t, fakeTranscriber{err: errors.New("speech failed")})
	session := startDrainSession(rig, completeEvents())
	session.Drain(context.Background())
	_, err := rig.lifecycle.Transition(context.Background(), rig.meetingID, meetinglifecycle.CaptureFailed{At: time.Now(), Cause: errors.New("capture failed")})
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := session.Finish(context.Background())
	assertRebuildHidden(t, rig, outcome, err)
	meeting, err := rig.store.GetMeeting(rig.meetingID)
	if err != nil || meeting.CaptureStatus != db.CaptureStatusFailed {
		t.Fatalf("failure state=%+v %v", meeting, err)
	}
}
