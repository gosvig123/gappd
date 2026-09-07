package db

import (
	"context"
	"errors"
	"testing"
)

func liveActionMeeting(t *testing.T) (*DB, string) {
	t.Helper()
	store := openTestDB(t)
	t.Cleanup(func() { store.Close() })
	meeting := lifecycleRoundTripMeeting()
	meeting.CaptureStatus = CaptureStatusRecording
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatal(err)
	}
	return store, meeting.ID
}

func TestLiveActionsExpiredClaimCannotSaveOrReleaseReplacement(t *testing.T) {
	store, id := liveActionMeeting(t)
	ctx := context.Background()
	old, err := store.ClaimLiveActions(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Conn.Exec(`UPDATE live_action_drafts SET claim_until='2000-01-01T00:00:00Z' WHERE meeting_id=?`, id); err != nil {
		t.Fatal(err)
	}
	current, err := store.ClaimLiveActions(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.ReleaseLiveActions(id, old); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveLiveActions(ctx, id, old, `{"stale":true}`); !errors.Is(err, ErrLiveActionsUnavailable) {
		t.Fatalf("stale save: %v", err)
	}
	if err := store.SaveLiveActions(ctx, id, current, `{"current":true}`); err != nil {
		t.Fatal(err)
	}
}

func TestLiveActionsStorageDoesNotChangeFinalArtifacts(t *testing.T) {
	store, id := liveActionMeeting(t)
	before, err := store.GetMeeting(id)
	if err != nil {
		t.Fatal(err)
	}
	token, err := store.ClaimLiveActions(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveLiveActions(context.Background(), id, token, `{"actions":[]}`); err != nil {
		t.Fatal(err)
	}
	after, err := store.GetMeeting(id)
	if err != nil {
		t.Fatal(err)
	}
	if *before.Transcript != *after.Transcript || *before.ExtractionJSON != *after.ExtractionJSON || before.SummaryTranscriptRevision != after.SummaryTranscriptRevision {
		t.Fatal("draft modified final artifacts")
	}
}
