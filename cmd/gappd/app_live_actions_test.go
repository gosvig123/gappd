package main

import (
	"context"
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
)

func liveActionMeetingStore(t *testing.T) (*db.DB, string) {
	t.Helper()
	store, err := db.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	meeting := &db.Meeting{Title: "Synthetic draft test", StartedAt: "2026-01-01T00:00:00Z", CaptureStatus: db.CaptureStatusRecording, ProcessingStatus: db.ProcessingStatusPending, Tags: "[]", Source: "listen"}
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatal(err)
	}
	return store, meeting.ID
}

func storeExternalDraft(t *testing.T, store *db.DB, id, snapshot string) {
	t.Helper()
	ctx := context.Background()
	token, err := store.ClaimLiveActions(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveLiveActions(ctx, id, token, `{"snapshotId":"`+snapshot+`","actions":[]}`); err != nil {
		t.Fatal(err)
	}
	if err := store.ReleaseLiveActions(id, token); err != nil {
		t.Fatal(err)
	}
}

func TestAppMeetingReadIncludesExternalDraftReplacement(t *testing.T) {
	store, id := liveActionMeetingStore(t)
	detail, err := appMeetingDetailFor(store, id)
	if err != nil || detail.LiveActionDraft != nil {
		t.Fatalf("empty draft: %+v, %v", detail.LiveActionDraft, err)
	}
	for _, snapshot := range []string{"first", "replacement"} {
		storeExternalDraft(t, store, id, snapshot)
		detail, err := appMeetingDetailFor(store, id)
		if err != nil {
			t.Fatal(err)
		}
		if detail.LiveActionDraft == nil || detail.LiveActionDraft.SnapshotID != snapshot {
			t.Fatalf("draft = %+v, want %s", detail.LiveActionDraft, snapshot)
		}
		if detail.Summary != "" {
			t.Fatal("draft changed final summary")
		}
	}
}
