// Package agenda drafts an Agenda for an upcoming Calendar event from the notes of
// Related Meetings.
package agenda

import (
	"sort"
	"strings"

	"github.com/gappd-dev/gappd/internal/db"
)

const (
	// MaxRelated is the number of Related Meetings an Agenda draws from.
	MaxRelated = 5
	// minOverlap is the smallest share of people (Jaccard index) that relates a Meeting
	// outside the event's series.
	minOverlap = 0.25
)

// Event is the upcoming Calendar event. Emails excludes the user's own accounts.
type Event struct {
	Start  string   `json:"start"`
	Series string   `json:"series,omitempty"`
	Emails []string `json:"emails"`
	Self   []string `json:"self,omitempty"`
}

// LinkedMeeting is a past Meeting with the Calendar event the user linked to it.
type LinkedMeeting struct {
	ID     string   `json:"id"`
	Series string   `json:"series,omitempty"`
	Emails []string `json:"emails"`
}

// Related is a past Meeting that shares the event's series or its people.
type Related struct {
	Meeting    db.NotedMeeting
	SameSeries bool
	Overlap    float64
}

// FindRelated picks up to MaxRelated Meetings: the newest Meetings of the same series
// first, then the Meetings that share the most people. A Meeting's people are the
// invitees of its linked event and the People labeled on its speakers.
func FindRelated(event Event, linked []LinkedMeeting, meetings []db.NotedMeeting) []Related {
	self := emailSet(event.Self)
	want := emailSet(event.Emails)
	for email := range self {
		delete(want, email)
	}
	links := make(map[string]LinkedMeeting, len(linked))
	for _, link := range linked {
		links[link.ID] = link
	}
	var series, shared []Related
	for _, meeting := range meetings {
		link := links[meeting.ID]
		people := emailSet(append(append([]string{}, link.Emails...), meeting.PersonEmails...))
		for email := range self {
			delete(people, email)
		}
		related := Related{Meeting: meeting, SameSeries: event.Series != "" && link.Series == event.Series, Overlap: jaccard(want, people)}
		switch {
		case related.SameSeries:
			series = append(series, related)
		case related.Overlap >= minOverlap:
			shared = append(shared, related)
		}
	}
	sort.SliceStable(series, func(i, j int) bool { return series[i].Meeting.StartedAt > series[j].Meeting.StartedAt })
	sort.SliceStable(shared, func(i, j int) bool {
		if shared[i].Overlap != shared[j].Overlap {
			return shared[i].Overlap > shared[j].Overlap
		}
		return shared[i].Meeting.StartedAt > shared[j].Meeting.StartedAt
	})
	out := append(series, shared...)
	if len(out) > MaxRelated {
		out = out[:MaxRelated]
	}
	return out
}

func emailSet(emails []string) map[string]bool {
	set := make(map[string]bool, len(emails))
	for _, email := range emails {
		if email = strings.ToLower(strings.TrimSpace(email)); email != "" {
			set[email] = true
		}
	}
	return set
}

func jaccard(left, right map[string]bool) float64 {
	shared := 0
	for email := range left {
		if right[email] {
			shared++
		}
	}
	union := len(left) + len(right) - shared
	if shared == 0 || union == 0 {
		return 0
	}
	return float64(shared) / float64(union)
}
