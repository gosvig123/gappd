package db

import "database/sql"

// AgendaMeeting carries only explicit Person email evidence, never inferred speaker names.
type AgendaMeeting struct {
	ID        string
	Title     string
	StartedAt string
	Emails    []string
}

func (d *DB) AgendaHistory() ([]AgendaMeeting, error) {
	rows, err := d.Conn.Query(`SELECT m.id,m.title,m.started_at,COALESCE(p.email,'')
 FROM meetings m LEFT JOIN meeting_speakers s ON s.meeting_id=m.id AND s.speaker_key<>?
 LEFT JOIN people p ON p.id=s.person_id
 WHERE m.capture_status=? AND m.transcript IS NOT NULL AND trim(m.transcript)<>''
 ORDER BY m.started_at,m.id`, SpeakerYou, CaptureStatusCaptured)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAgendaHistory(rows)
}

func scanAgendaHistory(rows *sql.Rows) ([]AgendaMeeting, error) {
	result := make([]AgendaMeeting, 0)
	for rows.Next() {
		var meeting AgendaMeeting
		var email string
		if err := rows.Scan(&meeting.ID, &meeting.Title, &meeting.StartedAt, &email); err != nil {
			return nil, err
		}
		if len(result) == 0 || result[len(result)-1].ID != meeting.ID {
			meeting.Emails = []string{}
			result = append(result, meeting)
		}
		if email != "" {
			result[len(result)-1].Emails = append(result[len(result)-1].Emails, email)
		}
	}
	return result, rows.Err()
}
