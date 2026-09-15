package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// documentCheck is one mutation of a valid document with its expected verdict.
type documentCheck struct {
	name  string
	edit  func(*MeetingDocument)
	valid bool
}

const validDocument = `{"version":1,"meeting_id":"72619a1d-f713-4f46-a2b8-c74e568726b1",` +
	`"revision":4,"title":"Weekly sync","started_at":"2026-09-14T12:00:00Z",` +
	`"ended_at":"2026-09-14T12:31:00Z","language":"en","summary":"Prototype review.",` +
	`"speakers":[{"key":"You","label":"Kristian"},{"key":"Other","label":"Sam"}],` +
	`"turns":[{"start_sec":0,"end_sec":4.5,"speaker_key":"You","text":"Hello."},` +
	`{"start_sec":5,"end_sec":9,"speaker_key":"Other","text":"Hi there."}]}`

// documentBytes parses a fresh valid document, applies one edit, and re-encodes it.
func documentBytes(t *testing.T, edit func(*MeetingDocument)) []byte {
	t.Helper()
	parsed, err := ParseMeetingDocument([]byte(validDocument))
	if err != nil {
		t.Fatal(err)
	}
	edit(&parsed)
	body, err := json.Marshal(parsed)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestParseMeetingDocumentAcceptsValidDocument(t *testing.T) {
	parsed, err := ParseMeetingDocument([]byte(validDocument))
	if err != nil {
		t.Fatalf("rejected valid document: %v", err)
	}
	if parsed.Revision != 4 || len(parsed.Turns) != 2 || parsed.Speakers[0].Label != "Kristian" {
		t.Fatalf("parsed: %+v", parsed)
	}
	if parsed.Transcript() != "[0:00] Kristian: Hello.\n[0:05] Sam: Hi there." {
		t.Fatalf("transcript: %q", parsed.Transcript())
	}
}

func TestParseMeetingDocumentAllowsTranscriptFreeMeeting(t *testing.T) {
	body := documentBytes(t, func(d *MeetingDocument) { d.Speakers, d.Turns, d.EndedAt = nil, nil, "" })
	parsed, err := ParseMeetingDocument(body)
	if err != nil || parsed.Transcript() != "" {
		t.Fatalf("empty Meeting: %v %q", err, parsed.Transcript())
	}
}

// The document is the privacy boundary, so unknown fields must fail closed.
func TestParseMeetingDocumentRejectsLocalOnlyData(t *testing.T) {
	local := []string{
		`"audio_path":"/Users/krisitan/secret.wav"`,
		`"person_id":"p1"`,
		`"voice_sample":"AAAA"`,
		`"agenda_draft":"private"`,
		`"credentials":{"token":"x"}`,
		`"calendar_cache":[]`,
		`"transcript_revision":9`,
	}
	for _, extra := range local {
		envelope := `{` + extra + `,` + strings.TrimPrefix(validDocument, `{`)
		turn := strings.Replace(validDocument, `"text":"Hello."}`, `"text":"Hello.",`+extra+`}`, 1)
		for _, body := range []string{envelope, turn} {
			if _, err := ParseMeetingDocument([]byte(body)); err == nil {
				t.Fatalf("accepted local-only field %s", extra)
			}
		}
	}
}

func TestParseMeetingDocumentRejectsBadEnvelopes(t *testing.T) {
	checkDocuments(t, []documentCheck{
		{"version 2", func(d *MeetingDocument) { d.Version = 2 }, false},
		{"version 0", func(d *MeetingDocument) { d.Version = 0 }, false},
		{"revision 0", func(d *MeetingDocument) { d.Revision = 0 }, false},
		{"revision negative", func(d *MeetingDocument) { d.Revision = -1 }, false},
		{"revision too large", func(d *MeetingDocument) { d.Revision = MaxRevision + 1 }, false},
		{"missing id", func(d *MeetingDocument) { d.MeetingID = "" }, false},
		{"non uuid id", func(d *MeetingDocument) { d.MeetingID = "not-a-uuid" }, false},
		{"empty title", func(d *MeetingDocument) { d.Title = "" }, false},
		{"long title", func(d *MeetingDocument) { d.Title = strings.Repeat("a", MaxTitleBytes+1) }, false},
		{"long summary", func(d *MeetingDocument) { d.Summary = strings.Repeat("a", MaxSummaryBytes+1) }, false},
		{"long language", func(d *MeetingDocument) { d.Language = strings.Repeat("a", MaxLanguageBytes+1) }, false},
		{"no start", func(d *MeetingDocument) { d.StartedAt = "" }, false},
		{"date only", func(d *MeetingDocument) { d.StartedAt = "2026-09-14" }, false},
		{"end before start", func(d *MeetingDocument) { d.EndedAt = "2026-09-14T11:00:00Z" }, false},
		{"bad end", func(d *MeetingDocument) { d.EndedAt = "tomorrow" }, false},
		{"end equals start", func(d *MeetingDocument) { d.EndedAt = d.StartedAt }, true},
		{"title at limit", func(d *MeetingDocument) { d.Title = strings.Repeat("a", MaxTitleBytes) }, true},
	})
}

func TestParseMeetingDocumentRejectsBadSpeakers(t *testing.T) {
	checkDocuments(t, []documentCheck{
		{"duplicate key", func(d *MeetingDocument) { d.Speakers[1].Key = "You" }, false},
		{"empty key", func(d *MeetingDocument) { d.Speakers[0].Key = "" }, false},
		{"long key", func(d *MeetingDocument) { d.Speakers[0].Key = strings.Repeat("k", MaxSpeakerBytes+1) }, false},
		{"long label", func(d *MeetingDocument) { d.Speakers[0].Label = strings.Repeat("l", MaxSpeakerBytes+1) }, false},
		{"empty label", func(d *MeetingDocument) { d.Speakers[0].Label = "" }, true},
		{"too many speakers", func(d *MeetingDocument) { d.Speakers = speakers(MaxSpeakers + 1) }, false},
		{"speaker dropped", func(d *MeetingDocument) { d.Speakers = d.Speakers[:1] }, false},
	})
}

func TestParseMeetingDocumentRejectsBadTurns(t *testing.T) {
	checkDocuments(t, []documentCheck{
		{"out of order", func(d *MeetingDocument) { d.Turns[1].StartSec, d.Turns[1].EndSec = 1, 2 }, false},
		{"overlap", func(d *MeetingDocument) { d.Turns[1].StartSec = 4 }, false},
		{"negative start", func(d *MeetingDocument) { d.Turns[0].StartSec = -1 }, false},
		{"end before start", func(d *MeetingDocument) { d.Turns[0].EndSec = -2 }, false},
		{"unknown speaker", func(d *MeetingDocument) { d.Turns[0].SpeakerKey = "Nobody" }, false},
		{"empty speaker", func(d *MeetingDocument) { d.Turns[0].SpeakerKey = "" }, false},
		{"long turn", func(d *MeetingDocument) { d.Turns[0].Text = strings.Repeat("t", MaxTurnBytes+1) }, false},
		{"beyond a day", func(d *MeetingDocument) { d.Turns[1].EndSec = MaxMeetingSeconds + 1 }, false},
		{"too many turns", func(d *MeetingDocument) { d.Turns = turns(MaxTurns + 1) }, false},
		{"transcript too large", func(d *MeetingDocument) { d.Turns = turnsOf(MaxTranscriptBytes/MaxTurnBytes + 1) }, false},
		{"touching turns", func(d *MeetingDocument) { d.Turns[1].StartSec = d.Turns[0].EndSec }, true},
	})
}

func TestParseMeetingDocumentRejectsMalformedInput(t *testing.T) {
	for _, body := range []string{
		"", "null", "[]", "{}", "0", `"text"`,
		validDocument + "{}", validDocument + " trailing", validDocument + `{"version":1}`,
	} {
		if _, err := ParseMeetingDocument([]byte(body)); err == nil {
			t.Fatalf("accepted %q", body)
		}
	}
	oversize := append([]byte(validDocument), bytes.Repeat([]byte(" "), MaxDocumentBytes)...)
	if _, err := ParseMeetingDocument(oversize); err == nil {
		t.Fatal("oversize document accepted")
	}
}

func checkDocuments(t *testing.T, checks []documentCheck) {
	t.Helper()
	for _, check := range checks {
		_, err := ParseMeetingDocument(documentBytes(t, check.edit))
		if (err == nil) != check.valid {
			t.Fatalf("%s: err=%v want valid=%v", check.name, err, check.valid)
		}
	}
}

func speakers(count int) []DocumentSpeaker {
	list := make([]DocumentSpeaker, 0, count)
	for index := 0; index < count; index++ {
		list = append(list, DocumentSpeaker{Key: fmt.Sprintf("k%d", index), Label: "L"})
	}
	return list
}

func turns(count int) []DocumentTurn {
	list := make([]DocumentTurn, 0, count)
	for index := 0; index < count; index++ {
		list = append(list, DocumentTurn{StartSec: float64(index), EndSec: float64(index) + 1,
			SpeakerKey: "You", Text: "x"})
	}
	return list
}

func turnsOf(count int) []DocumentTurn {
	list := turns(count)
	for index := range list {
		list[index].Text = strings.Repeat("x", MaxTurnBytes)
	}
	return list
}
