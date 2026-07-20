package meetinglifecycle

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

func TestTransitionRetriesAfterConcurrentSegmentRevision(t *testing.T) {
	module, store := openLifecycle(t)
	defer store.Close()
	meeting := beginRecording(t, module)

	transition := &segmentRevisionRaceTransition{store: store, at: testTime(30)}
	result, err := module.Transition(context.Background(), meeting.ID, transition)
	if err != nil {
		t.Fatalf("transition after segment revision: %v", err)
	}
	if !result.Applied {
		t.Fatal("transition was not applied after retry")
	}
	if transition.calls != 2 {
		t.Fatalf("transition apply calls = %d, want 2", transition.calls)
	}

	persisted, err := store.GetMeeting(meeting.ID)
	if err != nil {
		t.Fatalf("load transitioned meeting: %v", err)
	}
	if persisted.TranscriptRevision != 1 {
		t.Fatalf("transcript revision = %d, want 1", persisted.TranscriptRevision)
	}
	if !sameText(persisted.Transcript, "concurrent transcript") {
		t.Fatalf("transcript = %v, want concurrent transcript", persisted.Transcript)
	}
	if !sameText(persisted.Summary, "concurrent summary") {
		t.Fatalf("summary = %v, want concurrent summary", persisted.Summary)
	}
	if persisted.SummaryTranscriptRevision != 1 {
		t.Fatalf("summary transcript revision = %d, want 1", persisted.SummaryTranscriptRevision)
	}
	if persisted.CaptureStatus != db.CaptureStatusCaptured || persisted.ProcessingStatus != db.ProcessingStatusPending {
		t.Fatalf("statuses = %s/%s, want captured/pending", persisted.CaptureStatus, persisted.ProcessingStatus)
	}
}

// segmentRevisionRaceTransition deterministically inserts a segment after the
// lifecycle read but before its optimistic update on the first attempt.
type segmentRevisionRaceTransition struct {
	store *db.DB
	at    time.Time
	calls int
}

func (*segmentRevisionRaceTransition) name() string { return "segment_revision_race" }

func (t *segmentRevisionRaceTransition) apply(meeting *db.Meeting) (bool, error) {
	t.calls++
	if t.calls == 1 {
		segment := &db.Segment{MeetingID: meeting.ID, Start: 0, End: 1, Speaker: "You", Text: "hello"}
		if err := t.store.InsertSegment(segment); err != nil {
			return false, fmt.Errorf("insert concurrent segment: %w", err)
		}
		if _, err := t.store.Conn.Exec(`UPDATE meetings SET transcript=?, summary=?,
			summary_transcript_revision=transcript_revision WHERE id=?`,
			"concurrent transcript", "concurrent summary", meeting.ID); err != nil {
			return false, fmt.Errorf("write concurrent artifacts: %w", err)
		}
	}
	return (Captured{At: t.at}).apply(meeting)
}
