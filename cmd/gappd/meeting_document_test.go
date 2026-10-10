package main

import (
	"encoding/json"
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetingdocument"
)

const localMeetingID = "72619a1d-f713-4f46-a2b8-c74e568726b1"

func documentStore(t *testing.T) *db.DB {
	t.Helper()
	store, err := db.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	transcript, summary, ended := "Hello.", "Prototype review.", "2026-09-14T12:31:00Z"
	meeting := &db.Meeting{ID: localMeetingID, Title: "Weekly sync",
		StartedAt: "2026-09-14T12:00:00Z", EndedAt: &ended, Transcript: &transcript, Summary: &summary,
		CaptureStatus: db.CaptureStatusCaptured, ProcessingStatus: db.ProcessingStatusCompleted}
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatal(err)
	}
	if err := store.InsertSegment(&db.Segment{ID: "s1", MeetingID: localMeetingID, Start: 0, End: 4.5,
		Text: "Hello.", Speaker: db.SpeakerYou}); err != nil {
		t.Fatal(err)
	}
	return store
}

func buildLocalDocument(t *testing.T, store *db.DB) meetingdocument.Document {
	t.Helper()
	data, err := exportMeetingDocument(store, localMeetingID, 4)
	if err != nil {
		t.Fatal(err)
	}
	var document meetingdocument.Document
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	return document
}

func TestExportMeetingDocumentFromLocalStorage(t *testing.T) {
	document := buildLocalDocument(t, documentStore(t))
	if document.Revision != 4 || document.Title != "Weekly sync" || len(document.Turns) != 1 {
		t.Fatalf("document: %+v", document)
	}
	if document.Turns[0].Text != "Hello." || document.StartedAt != "2026-09-14T12:00:00Z" {
		t.Fatalf("content: %+v", document)
	}
}

// An unconfirmed speaker must not carry a name into the cloud copy.
func TestUnconfirmedSpeakerUploadsNoName(t *testing.T) {
	document := buildLocalDocument(t, documentStore(t))
	if len(document.Speakers) != 1 || document.Speakers[0].Label != db.SpeakerYou {
		t.Fatalf("unconfirmed label: %+v", document.Speakers)
	}
}

// A confirmed Person label is a Meeting speaker label, so it is part of the document.
func TestConfirmedSpeakerUploadsTheAssignedLabel(t *testing.T) {
	store := documentStore(t)
	if err := store.AssignSpeaker(localMeetingID, db.SpeakerYou, db.Person{Name: "Kristian"}); err != nil {
		t.Fatal(err)
	}
	document := buildLocalDocument(t, store)
	if len(document.Speakers) != 1 || document.Speakers[0].Key != db.SpeakerYou || document.Speakers[0].Label != "Kristian" {
		t.Fatalf("confirmed label: %+v", document.Speakers)
	}
}

func TestExportMeetingDocumentRefusesUnknownMeeting(t *testing.T) {
	store := documentStore(t)
	if _, err := exportMeetingDocument(store, "00000000-0000-0000-0000-000000000000", 1); err == nil {
		t.Fatal("unknown Meeting exported")
	}
}

func TestPositiveIntRejectsNonPositiveValues(t *testing.T) {
	if value, err := positiveInt("7"); err != nil || value != 7 {
		t.Fatalf("valid revision rejected: %d %v", value, err)
	}
	for _, raw := range []string{"0", "-1", "x", ""} {
		if _, err := positiveInt(raw); err == nil {
			t.Fatalf("revision accepted: %q", raw)
		}
	}
}
