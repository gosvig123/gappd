package service

import "testing"

// pinnedLocalDocument is the exact bytes cmd/gappd's meeting-document export produces for the
// shared sample Meeting. internal/meetingdocument keeps the same literal, so a contract change
// on either side fails its own test instead of silently breaking every upload.
const pinnedLocalDocument = `{"version":1,"meeting_id":"72619a1d-f713-4f46-a2b8-c74e568726b1","revision":4,"title":"Weekly sync","started_at":"2026-09-14T12:00:00Z","ended_at":"2026-09-14T12:31:00Z","language":"en","summary":"Prototype review.","speakers":[{"key":"You","label":"Kristian"},{"key":"Other","label":"Sam"}],"turns":[{"start_sec":0,"end_sec":4.5,"speaker_key":"You","text":"Hello."},{"start_sec":5,"end_sec":9,"speaker_key":"Other","text":"Hi there."}]}`

// The cloud must accept what the local builder produces, without any field edit.
func TestCloudAcceptsTheLocalDocument(t *testing.T) {
	document, err := ParseMeetingDocument([]byte(pinnedLocalDocument))
	if err != nil {
		t.Fatalf("cloud rejected a locally built document: %v", err)
	}
	if document.Revision != 4 || len(document.Turns) != 2 || document.Speakers[1].Label != "Sam" {
		t.Fatalf("parsed: %+v", document)
	}
	if document.Transcript() != "[0:00] Kristian: Hello.\n[0:05] Sam: Hi there." {
		t.Fatalf("transcript: %q", document.Transcript())
	}
	if len([]byte(pinnedLocalDocument)) > MaxDocumentBytes {
		t.Fatal("pinned document exceeds the upload bound")
	}
}
