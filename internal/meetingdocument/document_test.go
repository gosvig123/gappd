package meetingdocument

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
)

func meeting() *db.Meeting {
	transcript, summary, ended := "Hello.", "Prototype review.", "2026-09-14T12:31:00Z"
	return &db.Meeting{ID: "72619a1d-f713-4f46-a2b8-c74e568726b1", Title: "Weekly sync",
		StartedAt: "2026-09-14T12:00:00Z", EndedAt: &ended, Language: "en",
		Transcript: &transcript, Summary: &summary}
}

func segments() []db.Segment {
	return []db.Segment{
		{ID: "s1", Start: 0, End: 4.5, Text: "Hello.", Speaker: "Kristian", SpeakerKey: "You"},
		{ID: "s2", Start: 5, End: 9, Text: "Hi there.", Speaker: "Sam", SpeakerKey: "Other"},
	}
}

func TestBuildProducesTheVersionOneDocument(t *testing.T) {
	data, err := Build(meeting(), segments(), 4)
	if err != nil {
		t.Fatal(err)
	}
	var document Document
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	if document.Version != 1 || document.MeetingID != meeting().ID || document.Revision != 4 {
		t.Fatalf("envelope: %+v", document)
	}
	if len(document.Turns) != 2 || len(document.Speakers) != 2 {
		t.Fatalf("content: %+v", document)
	}
	if document.Speakers[0] != (Speaker{Key: "You", Label: "Kristian"}) {
		t.Fatalf("speaker: %+v", document.Speakers[0])
	}
	if document.Turns[1].StartSec != 5 || document.Turns[1].SpeakerKey != "Other" {
		t.Fatalf("turn: %+v", document.Turns[1])
	}
	if document.EndedAt != "2026-09-14T12:31:00Z" || document.Language != "en" {
		t.Fatalf("optional fields: %+v", document)
	}
}

// The cloud rejects unknown fields, so the document must never carry local-only data.
func TestBuildCarriesNoLocalOnlyData(t *testing.T) {
	data, err := Build(meeting(), segments(), 1)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"audio", "person_id", "embedding", "voice", "path", "token", "agenda", "calendar", "people"} {
		if strings.Contains(strings.ToLower(string(data)), forbidden) {
			t.Fatalf("document carries %q: %s", forbidden, data)
		}
	}
}

func TestBuildAcceptsAMeetingWithoutTurns(t *testing.T) {
	data, err := Build(meeting(), nil, 1)
	if err != nil {
		t.Fatal(err)
	}
	var document Document
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	if len(document.Turns) != 0 || len(document.Speakers) != 0 {
		t.Fatalf("empty Meeting: %+v", document)
	}
	if string(data) == "" || !strings.Contains(string(data), `"speakers":[]`) {
		t.Fatalf("empty arrays must be present: %s", data)
	}
}

func TestBuildRejectsUnusableMeetings(t *testing.T) {
	cases := []struct {
		name     string
		meeting  *db.Meeting
		revision int
	}{
		{"nil meeting", nil, 1},
		{"no id", &db.Meeting{}, 1},
		{"revision zero", meeting(), 0},
		{"negative revision", meeting(), -1},
		{"no title", withTitle(meeting(), ""), 1},
		{"long title", withTitle(meeting(), strings.Repeat("a", MaxTitleBytes+1)), 1},
		{"no start", withStart(meeting(), ""), 1},
		{"bad start", withStart(meeting(), "yesterday"), 1},
		{"end before start", withEnd(meeting(), "2026-09-14T11:00:00Z"), 1},
		{"long summary", withSummary(meeting(), strings.Repeat("a", MaxSummaryBytes+1)), 1},
		{"long language", withLanguage(meeting(), strings.Repeat("a", MaxLanguageBytes+1)), 1},
	}
	for _, test := range cases {
		if _, err := Build(test.meeting, nil, test.revision); err == nil {
			t.Fatalf("%s accepted", test.name)
		}
	}
}

func TestBuildRejectsUnusableTurns(t *testing.T) {
	cases := []struct {
		name     string
		segments []db.Segment
	}{
		{"unsorted segments", unsorted()},
		{"overlapping segments", overlapping()},
		{"long turn", longTurn()},
		{"no speaker", noSpeaker()},
		{"long speaker", longSpeaker()},
		{"too many speakers", manySpeakers()},
	}
	for _, test := range cases {
		if _, err := Build(meeting(), test.segments, 1); err == nil {
			t.Fatalf("%s accepted", test.name)
		}
	}
}

// A blank segment is simply not a turn, so it must not fail the document.
func TestBuildSkipsBlankSegments(t *testing.T) {
	data, err := Build(meeting(), append(segments(), db.Segment{ID: "s3", Start: 10, End: 11, Text: "", Speaker: "You", SpeakerKey: "You"}), 1)
	if err != nil {
		t.Fatal(err)
	}
	var document Document
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	if len(document.Turns) != 2 {
		t.Fatalf("blank segment became a turn: %+v", document.Turns)
	}
}

func TestBuildFallsBackToTheLabelWhenNoKeyExists(t *testing.T) {
	data, err := Build(meeting(), []db.Segment{{Start: 0, End: 1, Text: "Hi.", Speaker: "Other"}}, 1)
	if err != nil {
		t.Fatal(err)
	}
	var document Document
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	if document.Turns[0].SpeakerKey != "Other" {
		t.Fatalf("key: %+v", document.Turns[0])
	}
}

// PinnedDocument is the exact bytes this package produces for the shared sample Meeting.
// The cloud keeps the same literal in its own test, so drift between the two modules
// breaks one of them instead of silently breaking uploads.
const PinnedDocument = `{"version":1,"meeting_id":"72619a1d-f713-4f46-a2b8-c74e568726b1","revision":4,"title":"Weekly sync","started_at":"2026-09-14T12:00:00Z","ended_at":"2026-09-14T12:31:00Z","language":"en","summary":"Prototype review.","speakers":[{"key":"You","label":"Kristian"},{"key":"Other","label":"Sam"}],"turns":[{"start_sec":0,"end_sec":4.5,"speaker_key":"You","text":"Hello."},{"start_sec":5,"end_sec":9,"speaker_key":"Other","text":"Hi there."}]}`

func TestBuildMatchesThePinnedDocument(t *testing.T) {
	data, err := Build(meeting(), segments(), 4)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != PinnedDocument {
		t.Fatalf("document drifted:\n got %s\nwant %s", data, PinnedDocument)
	}
}
