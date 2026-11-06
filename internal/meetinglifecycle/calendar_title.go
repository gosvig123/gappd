package meetinglifecycle

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/gappd-dev/gappd/internal/db"
)

// SetCalendarTitle names the Meeting after the Calendar event the user linked. An empty event title
// means the user unlinked the event: a Calendar title then gives way to the AI title, or else to fallback.
func (w Module) SetCalendarTitle(ctx context.Context, id, eventTitle, fallback string) (*db.Meeting, error) {
	meeting, err := w.store.GetMeeting(id)
	if err != nil {
		return nil, err
	}
	title, source := cleanGeneratedMeetingTitle(eventTitle), db.TitleSourceCalendar
	if title == "" {
		if meeting.TitleSource != db.TitleSourceCalendar {
			return meeting, nil
		}
		title, source = extractionTitle(meeting.ExtractionJSON), ""
		if title == "" {
			title = strings.TrimSpace(fallback)
		}
		if title == "" {
			title = meeting.Title
		}
	}
	if err := w.store.SetMeetingTitle(ctx, id, title, source); err != nil {
		return nil, err
	}
	return w.store.GetMeeting(id)
}

func extractionTitle(extractionJSON *string) string {
	if extractionJSON == nil {
		return ""
	}
	var extraction struct {
		Title string `json:"title"`
	}
	if json.Unmarshal([]byte(*extractionJSON), &extraction) != nil {
		return ""
	}
	return cleanGeneratedMeetingTitle(extraction.Title)
}
