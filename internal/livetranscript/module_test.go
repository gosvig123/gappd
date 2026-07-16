package livetranscript

import (
	"context"
	"strings"
	"testing"
)

func TestFinishCommitsCompleteLiveTranscript(t *testing.T) {
	rig := newTestRig(t, fakeTranscriber{})
	outcome, err := runEvents(context.Background(), rig, completeEvents())
	if err != nil || outcome != OutcomeComplete {
		t.Fatalf("Finish() = %q, %v", outcome, err)
	}
	meeting, err := rig.store.GetMeeting(rig.meetingID)
	if err != nil || meeting.Transcript == nil {
		t.Fatalf("transcript missing, error = %v", err)
	}
	if !strings.Contains(*meeting.Transcript, "mic.wav") || !strings.Contains(*meeting.Transcript, "system.wav") {
		t.Fatalf("transcript = %q", *meeting.Transcript)
	}
}

func TestFinishIsIdempotent(t *testing.T) {
	rig := newTestRig(t, fakeTranscriber{})
	stream := make(chan Event, len(completeEvents()))
	for _, event := range completeEvents() {
		stream <- event
	}
	close(stream)
	session := rig.module.Start(context.Background(), StartInput{MeetingID: rig.meetingID, Events: stream})
	first, firstErr := session.Finish(context.Background())
	second, secondErr := session.Finish(context.Background())
	if first != OutcomeComplete || second != first || firstErr != nil || secondErr != nil {
		t.Fatalf("Finish() results = %q/%q, %v/%v", first, second, firstErr, secondErr)
	}
}

func TestCommittedLiveTranscriptSurvivesRestart(t *testing.T) {
	rig, path := newFileTestRig(t, fakeTranscriber{})
	outcome, err := runEvents(context.Background(), rig, completeEvents())
	if err != nil || outcome != OutcomeComplete {
		t.Fatalf("Finish() = %q, %v", outcome, err)
	}
	if err := rig.store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened := openTestStore(t, path)
	defer reopened.Close()
	meeting, loadErr := reopened.GetMeeting(rig.meetingID)
	segments, segmentErr := reopened.GetSegments(rig.meetingID)
	if loadErr != nil || segmentErr != nil || meeting.Transcript == nil || len(segments) != 2 {
		t.Fatalf("restart state: transcript=%v segments=%d errors=%v/%v", meeting.Transcript, len(segments), loadErr, segmentErr)
	}
}
