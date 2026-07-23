package livetranscript

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

func TestMissingSourceQueuesRebuildAndHidesPartial(t *testing.T) {
	rig := newTestRig(t, fakeTranscriber{})
	events := []Event{
		chunk(SourceMic, "mic.wav"),
		{Kind: EventSourceComplete, Source: SourceMic, Count: 1, CanonicalEnd: 10},
		{Kind: EventStreamComplete, Sources: []Source{SourceMic, SourceSystem}},
	}
	outcome, err := runEvents(context.Background(), rig, events)
	assertRebuildHidden(t, rig, outcome, err)
}

func TestDroppedEventQueuesRebuildAndHidesPartial(t *testing.T) {
	rig := newTestRig(t, fakeTranscriber{})
	events := append(completeEvents(), Dropped(errors.New("parser drop")))
	outcome, err := runEvents(context.Background(), rig, events)
	assertRebuildHidden(t, rig, outcome, err)
}

func TestTranscriptionFailureQueuesRebuild(t *testing.T) {
	rig := newTestRig(t, fakeTranscriber{err: errors.New("speech failed")})
	outcome, err := runEvents(context.Background(), rig, completeEvents())
	assertRebuildHidden(t, rig, outcome, err)
}

func TestDrainTimeoutQueuesRebuild(t *testing.T) {
	rig := newTestRig(t, fakeTranscriber{block: true})
	rig.module.drainTimeout = 10 * time.Millisecond
	stream := make(chan Event, 1)
	stream <- chunk(SourceMic, "mic.wav")
	session := rig.module.Start(context.Background(), StartInput{MeetingID: rig.meetingID, Events: stream})
	outcome, err := session.Finish(context.Background())
	assertRebuildHidden(t, rig, outcome, err)
}

func TestFailedCaptureDiscardsProvisionalSegments(t *testing.T) {
	rig := newTestRig(t, fakeTranscriber{})
	if err := rig.store.InsertSegment(&db.Segment{MeetingID: rig.meetingID, Start: 0, End: 1, Text: "partial"}); err != nil {
		t.Fatal(err)
	}
	if _, err := rig.store.Conn.Exec(`UPDATE meetings SET capture_status=?,processing_status=? WHERE id=?`,
		db.CaptureStatusFailed, db.ProcessingStatusNotStarted, rig.meetingID); err != nil {
		t.Fatal(err)
	}
	stream := make(chan Event)
	close(stream)
	session := rig.module.Start(context.Background(), StartInput{MeetingID: rig.meetingID, Events: stream})
	if outcome, err := session.Finish(context.Background()); err != nil || outcome != OutcomeRebuildQueued {
		t.Fatalf("Finish() = %q, %v", outcome, err)
	}
	segments, err := rig.store.GetSegments(rig.meetingID)
	if err != nil || len(segments) != 0 {
		t.Fatalf("segments = %d, error = %v", len(segments), err)
	}
}

func TestCommitFailureLeavesNoCommittedTranscript(t *testing.T) {
	rig, path := newFileTestRig(t, fakeTranscriber{})
	stream := make(chan Event, len(completeEvents()))
	for _, event := range completeEvents() {
		stream <- event
	}
	close(stream)
	session := rig.module.Start(context.Background(), StartInput{MeetingID: rig.meetingID, Events: stream})
	waitForSegments(t, rig.store, rig.meetingID, 2)
	if err := rig.store.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := session.Finish(context.Background()); err == nil {
		t.Fatal("Finish() error = nil")
	}
	assertTranscriptUncommitted(t, path, rig.meetingID)
}

func assertTranscriptUncommitted(t *testing.T, path, meetingID string) {
	t.Helper()
	store := openTestStore(t, path)
	defer store.Close()
	meeting, err := store.GetMeeting(meetingID)
	if err != nil || meeting.Transcript != nil {
		t.Fatalf("transcript = %v, error = %v", meeting.Transcript, err)
	}
}
