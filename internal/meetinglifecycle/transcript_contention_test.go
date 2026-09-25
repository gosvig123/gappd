package meetinglifecycle

import (
	"context"
	"errors"
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
)

// Each provisional chunk lands after the lifecycle read but before its guarded update.
type provisionalWriteCaptured struct {
	Captured
	store  *db.DB
	writes int
}

func (transition *provisionalWriteCaptured) apply(meeting *db.Meeting) (bool, error) {
	changed, err := transition.Captured.apply(meeting)
	if err != nil {
		return changed, err
	}
	transition.writes++
	return changed, transition.store.ReplaceSegments(meeting.ID, []db.Segment{{MeetingID: meeting.ID, Start: 0, End: 1, Text: "provisional"}})
}

func TestCapturedRejectsConcurrentProvisionalRevisions(t *testing.T) {
	module, store := openLifecycle(t)
	defer store.Close()
	meeting := beginRecording(t, module)
	captured := &provisionalWriteCaptured{Captured: Captured{At: testTime(30)}, store: store}
	_, err := module.Transition(context.Background(), meeting.ID, captured)
	var conflict *ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("wanted guarded conflict, got %v", err)
	}
	t.Logf("reproduced after %d provisional writes: %v", captured.writes, err)
	assertProvisionalConflictState(t, store, meeting.ID, captured.writes)
	result, err := module.Transition(context.Background(), meeting.ID, Captured{At: testTime(30)})
	if err != nil || !result.Applied || result.Meeting.TranscriptRevision != 2 {
		t.Fatalf("drained transition: %+v %v", result, err)
	}
}

func assertProvisionalConflictState(t *testing.T, store *db.DB, id string, writes int) {
	t.Helper()
	current, err := store.GetMeeting(id)
	if err != nil {
		t.Fatal(err)
	}
	if writes != 2 || current.TranscriptRevision != 2 || current.CaptureStatus != db.CaptureStatusRecording {
		t.Fatalf("guard lost revision/state: writes=%d meeting=%+v", writes, current)
	}
}
