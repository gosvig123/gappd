package meetingdocument

import (
	"strings"

	"github.com/gappd-dev/gappd/internal/db"
)

// Sample data and single-field mutators shared by the document tests.

func withTitle(m *db.Meeting, title string) *db.Meeting { m.Title = title; return m }
func withStart(m *db.Meeting, start string) *db.Meeting { m.StartedAt = start; return m }
func withEnd(m *db.Meeting, end string) *db.Meeting     { m.EndedAt = &end; return m }
func withSummary(m *db.Meeting, summary string) *db.Meeting {
	m.Summary = &summary
	return m
}
func withLanguage(m *db.Meeting, language string) *db.Meeting { m.Language = language; return m }

func unsorted() []db.Segment {
	return []db.Segment{{Start: 5, End: 9, Text: "second", Speaker: "You"}, {Start: 0, End: 4, Text: "first", Speaker: "You"}}
}

func overlapping() []db.Segment {
	return []db.Segment{{Start: 0, End: 6, Text: "first", Speaker: "You"}, {Start: 5, End: 9, Text: "second", Speaker: "You"}}
}

func longTurn() []db.Segment {
	return []db.Segment{{Start: 0, End: 1, Text: strings.Repeat("t", MaxTurnBytes+1), Speaker: "You"}}
}

func noSpeaker() []db.Segment {
	return []db.Segment{{Start: 0, End: 1, Text: "Hi."}}
}

func longSpeaker() []db.Segment {
	return []db.Segment{{Start: 0, End: 1, Text: "Hi.", SpeakerKey: strings.Repeat("s", MaxSpeakerBytes+1)}}
}

func manySpeakers() []db.Segment {
	out := make([]db.Segment, 0, MaxSpeakers+1)
	for index := 0; index <= MaxSpeakers; index++ {
		out = append(out, db.Segment{Start: float64(index), End: float64(index) + 0.5, Text: "Hi.", SpeakerKey: string(rune('a'+index%26)) + string(rune('0'+index/26))})
	}
	return out
}
