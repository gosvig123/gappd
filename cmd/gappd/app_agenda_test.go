package main

import (
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
)

func agendaTestStore(t *testing.T, text string) (*db.DB, string) {
	t.Helper()
	store, err := db.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	meeting := &db.Meeting{Title: "Planning", StartedAt: "2026-09-01T12:00:00Z", CaptureStatus: db.CaptureStatusCaptured, ProcessingStatus: db.ProcessingStatusCompleted, Transcript: &text, Tags: "[]", Source: "listen"}
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatal(err)
	}
	return store, meeting.ID
}

func TestAgendaSourcesPreserveLaterResolutionWithoutTruncation(t *testing.T) {
	text := strings.Repeat("Earlier discussion. ", 1000) + "The proposal was sent and approved."
	store, id := agendaTestStore(t, text)
	sources, err := agendaSources(store, []string{id})
	if err != nil {
		t.Fatal(err)
	}
	if len(sources) != 1 || sources[0].Text != text {
		t.Fatal("source transcript was truncated")
	}
}

func TestAgendaSourcesRejectMissingEmptyAndOversizedInput(t *testing.T) {
	store, id := agendaTestStore(t, "")
	for _, ids := range [][]string{nil, {id}, {"missing"}, make([]string, maxAgendaSources+1)} {
		if _, err := agendaSources(store, ids); err == nil {
			t.Errorf("accepted invalid sources: %v", ids)
		}
	}
	if _, err := store.Conn.Exec(`UPDATE meetings SET transcript=?`, strings.Repeat("x", maxAgendaSourceBytes+1)); err != nil {
		t.Fatal(err)
	}
	if _, err := agendaSources(store, []string{id}); err == nil || !strings.Contains(err.Error(), "input limit") {
		t.Fatalf("expected honest size error: %v", err)
	}
}
