package db

import (
	"fmt"
	"strings"
)

// NotedMeeting is a Meeting with notes data, as an agenda source.
type NotedMeeting struct {
	ID             string
	Title          string
	StartedAt      string
	Language       string
	ExtractionJSON string
	// PersonEmails are the emails of People labeled on its speakers, lowercase.
	PersonEmails []string
}

// NotedMeetings lists Meetings with notes data that started in [since, before), newest first.
// Both bounds are RFC 3339 UTC times, the format of started_at.
func (d *DB) NotedMeetings(since, before string) ([]NotedMeeting, error) {
	rows, err := d.Conn.Query(`SELECT m.id, COALESCE(m.title,''), m.started_at, m.language, m.extraction_json,
 COALESCE((SELECT group_concat(lower(p.email), ',') FROM meeting_speakers s JOIN people p ON p.id=s.person_id
  WHERE s.meeting_id=m.id AND p.email<>''), '')
FROM meetings m
WHERE json_valid(m.extraction_json) AND m.started_at >= ? AND m.started_at < ?
ORDER BY m.started_at DESC`, since, before)
	if err != nil {
		return nil, fmt.Errorf("list meetings with notes: %w", err)
	}
	defer rows.Close()
	meetings := make([]NotedMeeting, 0)
	for rows.Next() {
		var meeting NotedMeeting
		var emails string
		if err := rows.Scan(&meeting.ID, &meeting.Title, &meeting.StartedAt, &meeting.Language, &meeting.ExtractionJSON, &emails); err != nil {
			return nil, fmt.Errorf("list meetings with notes: %w", err)
		}
		if emails != "" {
			meeting.PersonEmails = strings.Split(emails, ",")
		}
		meetings = append(meetings, meeting)
	}
	return meetings, rows.Err()
}
