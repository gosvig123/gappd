package meetinglifecycle

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

func TestTransitionRejectsContradictionAndAcceptsRepeat(t *testing.T) {
	module, store := openLifecycle(t)
	defer store.Close()
	meeting := beginRecording(t, module)
	captured := Captured{At: testTime(30)}

	first := transition(t, module, meeting.ID, captured)
	if !first.Applied {
		t.Fatal("first captured transition not applied")
	}
	second := transition(t, module, meeting.ID, captured)
	if second.Applied {
		t.Fatal("repeated captured transition applied")
	}
	_, err := module.Transition(context.Background(), meeting.ID, CaptureFailed{At: testTime(31), Cause: errors.New("late failure")})
	var conflict *ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("contradictory transition error = %v, want ConflictError", err)
	}
}

func TestProcessingRestartIsExplicit(t *testing.T) {
	module, store := openLifecycle(t)
	defer store.Close()
	meeting := beginRecording(t, module)
	transition(t, module, meeting.ID, Captured{At: testTime(30)})
	completion := Completion{Title: "Planning", Transcript: "notes", Summary: "summary", ExtractionJSON: "{}", At: testTime(40)}
	transition(t, module, meeting.ID, ProcessingCompleted{Completion: completion})

	_, err := module.Transition(context.Background(), meeting.ID, ProcessingStarted{At: testTime(41)})
	var conflict *ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("processing start error = %v, want ConflictError", err)
	}
	restarted := transition(t, module, meeting.ID, ProcessingRestarted{At: testTime(41), Reason: ReprocessingRefinement})
	if restarted.Meeting.ProcessingStatus != db.ProcessingStatusProcessing {
		t.Fatalf("processing status = %q, want processing", restarted.Meeting.ProcessingStatus)
	}
}

func TestStaleCaptureClaimUsesPersistedHeartbeat(t *testing.T) {
	module, store := openLifecycle(t)
	defer store.Close()
	meeting := beginRecording(t, module)
	claim := StaleCaptured{Cutoff: testTime(10), At: testTime(11)}

	first := transition(t, module, meeting.ID, claim)
	if !first.Applied {
		t.Fatal("stale capture claim not applied")
	}
	second := transition(t, module, meeting.ID, claim)
	if second.Applied {
		t.Fatal("repeated stale capture claim applied")
	}
}

func openLifecycle(t *testing.T) (Module, *db.DB) {
	t.Helper()
	store, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := store.Init(); err != nil {
		store.Close()
		t.Fatalf("initialize database: %v", err)
	}
	return New(store), store
}

func beginRecording(t *testing.T, module Module) *db.Meeting {
	t.Helper()
	start := RecordingStart{Title: "Planning", SessionDir: t.TempDir(), Language: "en_US", At: testTime(0)}
	meeting, err := module.BeginRecording(context.Background(), start)
	if err != nil {
		t.Fatalf("begin recording: %v", err)
	}
	return meeting
}

func transition(t *testing.T, module Module, id string, value Transition) Result {
	t.Helper()
	result, err := module.Transition(context.Background(), id, value)
	if err != nil {
		t.Fatalf("transition %s: %v", value.name(), err)
	}
	return result
}

func testTime(minutes int) time.Time {
	return time.Date(2026, 4, 10, 12, minutes, 0, 0, time.UTC)
}
